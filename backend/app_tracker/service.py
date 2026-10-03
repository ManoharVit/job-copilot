"""Application Tracker business logic.

Owns the transaction boundary: each public method either commits once or
rolls back completely, so a rejected transition never leaves partial writes.
"""
from __future__ import annotations

import datetime as dt
from collections.abc import Callable, Sequence
from typing import TypeVar

from sqlalchemy.orm import Session

from models import Application, ApplicationStatusHistory

from .domain import ApplicationStatus, ChangeSource, allowed_next, can_transition
from .errors import ApplicationNotFound, InvalidStatusTransition, StatusConflict
from .repository import ApplicationRepository
from .schemas import ApplicationCreate, ApplicationUpdate

T = TypeVar("T")

EXTENSION_DEDUPE_WINDOW = dt.timedelta(days=1)


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class ApplicationService:
    def __init__(
        self, session: Session, owner_id: int, clock: Callable[[], dt.datetime] = utcnow
    ) -> None:
        self._session = session
        self._repo = ApplicationRepository(session, owner_id)
        self._clock = clock

    # -- transaction helper --------------------------------------------------
    def _atomic(self, work: Callable[[], T]) -> T:
        try:
            result = work()
            self._session.commit()
            return result
        except Exception:
            self._session.rollback()
            raise

    # -- reads ---------------------------------------------------------------
    def get(self, application_id: int) -> Application:
        application = self._repo.get(application_id)
        if application is None:
            raise ApplicationNotFound(application_id)
        return application

    def list(
        self, statuses: Sequence[ApplicationStatus] | None, page: int, page_size: int
    ) -> tuple[list[Application], int]:
        status_values = [str(s) for s in statuses] if statuses else None
        items = self._repo.list(status_values, offset=(page - 1) * page_size, limit=page_size)
        return items, self._repo.count(status_values)

    def history(self, application_id: int) -> list[ApplicationStatusHistory]:
        self.get(application_id)  # ownership check -> 404 if not owned
        return self._repo.history(application_id)

    @staticmethod
    def allowed_next_statuses(application: Application) -> list[ApplicationStatus]:
        return allowed_next(ApplicationStatus(application.status))

    # -- writes --------------------------------------------------------------
    def create(self, data: ApplicationCreate, source: ChangeSource = ChangeSource.API) -> Application:
        def work() -> Application:
            now = self._clock()
            application = self._repo.add(
                Application(
                    title=data.title,
                    company=data.company,
                    url=data.url,
                    platform=data.platform,
                    status=str(data.status),
                    applied_at=data.applied_at or now,
                    updated_at=now,
                    notes=data.notes,
                    job_description=data.job_description,
                )
            )
            self._record(application, None, data.status, "Created", source, now)
            return application

        return self._atomic(work)

    def update(
        self, application_id: int, data: ApplicationUpdate, source: ChangeSource = ChangeSource.API
    ) -> Application:
        def work() -> Application:
            application = self.get(application_id)
            changed = False
            if data.status is not None:
                changed = self._apply_status(
                    application, data.status, data.expected_status, data.transition_note or "", source
                )
            for name, value in data.field_changes().items():
                if getattr(application, name) != value:
                    setattr(application, name, value)
                    changed = True
            if changed:
                application.updated_at = self._clock()
            self._session.flush()
            return application

        return self._atomic(work)

    def change_status(
        self,
        application_id: int,
        target: ApplicationStatus,
        *,
        expected: ApplicationStatus | None = None,
        note: str = "",
        source: ChangeSource = ChangeSource.API,
    ) -> Application:
        def work() -> Application:
            application = self.get(application_id)
            if self._apply_status(application, target, expected, note, source):
                application.updated_at = self._clock()
            return application

        return self._atomic(work)

    def update_notes(self, application_id: int, notes: str) -> Application:
        def work() -> Application:
            application = self.get(application_id)
            if application.notes != notes:
                application.notes = notes
                application.updated_at = self._clock()
            return application

        return self._atomic(work)

    def delete(self, application_id: int) -> None:
        def work() -> None:
            self._repo.delete(self.get(application_id))

        self._atomic(work)

    def log_from_extension(
        self, *, url: str, title: str, company: str, platform: str, job_description: str
    ) -> Application:
        """Record a page the extension autofilled.

        Autofill is not submission, so new records start as ``draft``. Repeat
        calls for the same URL within 24 hours return the existing record
        (idempotent), scoped to the current owner.
        """

        def work() -> Application:
            now = self._clock()
            if url:
                existing = self._repo.find_recent_by_url(url, now - EXTENSION_DEDUPE_WINDOW)
                if existing is not None:
                    return existing
            application = self._repo.add(
                Application(
                    url=url,
                    title=title,
                    company=company,
                    platform=platform,
                    status=str(ApplicationStatus.DRAFT),
                    applied_at=now,
                    updated_at=now,
                    notes="",
                    job_description=job_description,
                )
            )
            self._record(
                application, None, ApplicationStatus.DRAFT, "Logged by browser extension after autofill",
                ChangeSource.EXTENSION, now,
            )
            return application

        return self._atomic(work)

    # -- internals -----------------------------------------------------------
    def _apply_status(
        self,
        application: Application,
        target: ApplicationStatus,
        expected: ApplicationStatus | None,
        note: str,
        source: ChangeSource,
    ) -> bool:
        current = ApplicationStatus(application.status)
        if expected is not None and expected != current:
            raise StatusConflict(expected, current)
        if target == current:
            return False  # idempotent no-op: no history row
        if not can_transition(current, target):
            raise InvalidStatusTransition(current, target, allowed_next(current))
        application.status = str(target)
        self._record(application, current, target, note, source, self._clock())
        return True

    def _record(
        self,
        application: Application,
        from_status: ApplicationStatus | None,
        to_status: ApplicationStatus,
        note: str,
        source: ChangeSource,
        at: dt.datetime,
    ) -> None:
        self._repo.add_history(
            ApplicationStatusHistory(
                application_id=application.id,
                from_status=str(from_status) if from_status is not None else None,
                to_status=str(to_status),
                changed_at=at,
                note=note,
                source=str(source),
            )
        )
