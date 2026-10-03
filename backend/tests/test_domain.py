import pytest

import models
from app_tracker.domain import (
    ALLOWED_TRANSITIONS,
    CANONICAL_TO_LEGACY,
    TERMINAL_STATUSES,
    ApplicationStatus as S,
    allowed_next,
    can_transition,
    parse_status_input,
    to_legacy,
)

EXPECTED = {
    S.DRAFT: {S.SUBMITTED, S.WITHDRAWN, S.ARCHIVED},
    S.SUBMITTED: {S.UNDER_REVIEW, S.SCREENING, S.INTERVIEWING, S.OFFER, S.REJECTED, S.WITHDRAWN, S.ARCHIVED},
    S.UNDER_REVIEW: {S.SCREENING, S.INTERVIEWING, S.OFFER, S.REJECTED, S.WITHDRAWN, S.ARCHIVED},
    S.SCREENING: {S.INTERVIEWING, S.OFFER, S.REJECTED, S.WITHDRAWN, S.ARCHIVED},
    S.INTERVIEWING: {S.OFFER, S.REJECTED, S.WITHDRAWN, S.ARCHIVED},
    S.OFFER: {S.REJECTED, S.WITHDRAWN, S.ARCHIVED},
    S.REJECTED: {S.ARCHIVED},
    S.WITHDRAWN: {S.ARCHIVED},
    S.ARCHIVED: set(),
}


@pytest.mark.parametrize("current", list(S))
@pytest.mark.parametrize("target", list(S))
def test_transition_matrix(current, target):
    assert can_transition(current, target) is (target in EXPECTED[current])


def test_no_self_transitions_listed():
    assert all(s not in targets for s, targets in ALLOWED_TRANSITIONS.items())


def test_archived_is_the_only_terminal_status():
    assert TERMINAL_STATUSES == {S.ARCHIVED}


def test_allowed_next_is_in_lifecycle_order():
    assert allowed_next(S.SUBMITTED) == [S.UNDER_REVIEW, S.SCREENING, S.INTERVIEWING, S.OFFER, S.REJECTED, S.WITHDRAWN, S.ARCHIVED]


def test_db_check_constraint_matches_enum():
    assert set(models.APPLICATION_STATUS_VALUES) == {s.value for s in S}


def test_every_status_has_a_legacy_bucket():
    assert set(CANONICAL_TO_LEGACY) == set(S)
    assert {to_legacy(s) for s in S} == {"applied", "interview", "offer", "rejected"}


@pytest.mark.parametrize(
    "raw,expected",
    [("applied", S.SUBMITTED), ("interview", S.INTERVIEWING), (" Offer ", S.OFFER),
     ("rejected", S.REJECTED), ("screening", S.SCREENING), ("draft", S.DRAFT),
     ("ghosted", None), ("", None)],
)
def test_parse_status_input(raw, expected):
    assert parse_status_input(raw) == expected
