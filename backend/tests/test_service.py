import datetime as dt

import pytest
from sqlalchemy import func, select

from app_tracker.domain import ApplicationStatus as S, ChangeSource
from app_tracker.errors import ApplicationNotFound, InvalidStatusTransition, StatusConflict
from app_tracker.schemas import ApplicationCreate, ApplicationUpdate
from app_tracker.service import ApplicationService
from models import Application, ApplicationStatusHistory


class FakeClock:
    def __init__(self) -> None:
        self.now = dt.datetime(2026, 10, 1, 9, 0, tzinfo=dt.timezone.utc)

    def __call__(self) -> dt.datetime:
        return self.now

    def advance(self, **kwargs) -> None:
        self.now += dt.timedelta(**kwargs)


@pytest.fixture()
def clock():
    return FakeClock()


@pytest.fixture()
def alice_service(db, users, clock):
    return ApplicationService(db, users["alice"].id, clock=clock)


@pytest.fixture()
def bob_service(db, users, clock):
    return ApplicationService(db, users["bob"].id, clock=clock)


def _create(service, **overrides):
    payload = {"title": "Backend Engineer", "company": "Example Corp", **overrides}
    return service.create(ApplicationCreate(**payload))


def _history_count(db, app_id):
    return db.scalar(select(func.count()).where(ApplicationStatusHistory.application_id == app_id))


def test_create_records_initial_history(alice_service, db):
    app = _create(alice_service)
    assert app.status == "draft"
    [entry] = alice_service.history(app.id)
    assert (entry.from_status, entry.to_status, entry.source) == (None, "draft", "api")


def test_valid_transition_appends_history_and_bumps_updated_at(alice_service, clock):
    app = _create(alice_service, status="submitted")
    clock.advance(hours=1)
    alice_service.update(app.id, ApplicationUpdate(status=S.SCREENING, transition_note="Recruiter call"))
    history = alice_service.history(app.id)
    assert [(h.from_status, h.to_status) for h in history] == [(None, "submitted"), ("submitted", "screening")]
    assert history[-1].note == "Recruiter call"
    assert alice_service.get(app.id).updated_at.replace(tzinfo=dt.timezone.utc) == clock.now


def test_same_status_is_idempotent_no_op(alice_service, db, clock):
    app = _create(alice_service, status="submitted")
    before = alice_service.get(app.id).updated_at
    clock.advance(hours=1)
    alice_service.update(app.id, ApplicationUpdate(status=S.SUBMITTED))
    assert _history_count(db, app.id) == 1
    assert alice_service.get(app.id).updated_at == before


def test_invalid_transition_raises_and_writes_nothing(alice_service, db):
    app = _create(alice_service, status="rejected")
    with pytest.raises(InvalidStatusTransition) as exc:
        alice_service.update(app.id, ApplicationUpdate(status=S.INTERVIEWING, notes="should not persist"))
    assert exc.value.details["allowed_next_statuses"] == ["archived"]
    db.expire_all()
    fresh = alice_service.get(app.id)
    assert (fresh.status, fresh.notes) == ("rejected", "")
    assert _history_count(db, app.id) == 1


def test_expected_status_mismatch_raises_conflict(alice_service):
    app = _create(alice_service, status="screening")
    with pytest.raises(StatusConflict):
        alice_service.update(app.id, ApplicationUpdate(status=S.INTERVIEWING, expected_status=S.SUBMITTED))
    assert alice_service.get(app.id).status == "screening"


def test_owner_isolation(alice_service, bob_service):
    app = _create(alice_service)
    with pytest.raises(ApplicationNotFound):
        bob_service.get(app.id)
    with pytest.raises(ApplicationNotFound):
        bob_service.update(app.id, ApplicationUpdate(notes="hijack"))
    with pytest.raises(ApplicationNotFound):
        bob_service.delete(app.id)
    with pytest.raises(ApplicationNotFound):
        bob_service.history(app.id)
    assert bob_service.list(None, 1, 20) == ([], 0)
    assert alice_service.get(app.id).notes == ""


def test_delete_cascades_history(alice_service, db):
    app = _create(alice_service, status="submitted")
    alice_service.update(app.id, ApplicationUpdate(status=S.SCREENING))
    alice_service.delete(app.id)
    assert db.get(Application, app.id) is None
    assert _history_count(db, app.id) == 0


def test_list_filters_and_paginates_newest_first(alice_service, clock):
    for i in range(5):
        clock.advance(minutes=1)
        _create(alice_service, title=f"Role {i}", status="screening" if i % 2 else "submitted")
    items, total = alice_service.list([S.SCREENING], page=1, page_size=10)
    assert total == 2 and [a.title for a in items] == ["Role 3", "Role 1"]
    page2, total_all = alice_service.list(None, page=2, page_size=2)
    assert total_all == 5 and [a.title for a in page2] == ["Role 2", "Role 1"]


def test_extension_log_is_draft_and_deduplicated_per_owner(alice_service, bob_service, clock):
    kwargs = dict(url="https://jobs.example.com/1", title="SWE", company="Example", platform="greenhouse", job_description="")
    first = alice_service.log_from_extension(**kwargs)
    assert first.status == "draft"
    assert alice_service.history(first.id)[0].source == ChangeSource.EXTENSION
    clock.advance(hours=23)
    assert alice_service.log_from_extension(**kwargs).id == first.id
    assert bob_service.log_from_extension(**kwargs).id != first.id  # other owner: no dedupe
    clock.advance(hours=2)
    assert alice_service.log_from_extension(**kwargs).id != first.id  # window expired
