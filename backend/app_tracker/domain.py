"""Pure domain rules for the application lifecycle (no I/O, no HTTP)."""
from __future__ import annotations

from enum import StrEnum
from types import MappingProxyType
from typing import Mapping


class ApplicationStatus(StrEnum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    SCREENING = "screening"
    INTERVIEWING = "interviewing"
    OFFER = "offer"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"
    ARCHIVED = "archived"


class ChangeSource(StrEnum):
    """Where a status change originated (stored on each history row)."""

    API = "api"
    LEGACY_API = "legacy_api"
    EXTENSION = "extension"
    MIGRATION = "migration"


S = ApplicationStatus

# Allowed forward transitions. Same-status updates are handled by the service
# as idempotent no-ops and are intentionally NOT listed here.
ALLOWED_TRANSITIONS: Mapping[ApplicationStatus, frozenset[ApplicationStatus]] = MappingProxyType(
    {
        S.DRAFT: frozenset({S.SUBMITTED, S.WITHDRAWN, S.ARCHIVED}),
        S.SUBMITTED: frozenset(
            {S.UNDER_REVIEW, S.SCREENING, S.INTERVIEWING, S.OFFER, S.REJECTED, S.WITHDRAWN, S.ARCHIVED}
        ),
        S.UNDER_REVIEW: frozenset(
            {S.SCREENING, S.INTERVIEWING, S.OFFER, S.REJECTED, S.WITHDRAWN, S.ARCHIVED}
        ),
        S.SCREENING: frozenset({S.INTERVIEWING, S.OFFER, S.REJECTED, S.WITHDRAWN, S.ARCHIVED}),
        S.INTERVIEWING: frozenset({S.OFFER, S.REJECTED, S.WITHDRAWN, S.ARCHIVED}),
        S.OFFER: frozenset({S.REJECTED, S.WITHDRAWN, S.ARCHIVED}),
        S.REJECTED: frozenset({S.ARCHIVED}),
        S.WITHDRAWN: frozenset({S.ARCHIVED}),
        S.ARCHIVED: frozenset(),
    }
)

TERMINAL_STATUSES: frozenset[ApplicationStatus] = frozenset(
    s for s, targets in ALLOWED_TRANSITIONS.items() if not targets
)


def can_transition(current: ApplicationStatus, target: ApplicationStatus) -> bool:
    return target in ALLOWED_TRANSITIONS[current]


def allowed_next(current: ApplicationStatus) -> list[ApplicationStatus]:
    """Allowed targets in lifecycle (enum) order, for stable API output."""
    targets = ALLOWED_TRANSITIONS[current]
    return [s for s in ApplicationStatus if s in targets]


# --- Legacy vocabulary (original dashboard dropdown + extension) -------------
# The original UI only knows four values. The mapping below is LOSSY and is for
# display/compatibility only until the dashboard adopts canonical statuses.
LEGACY_TO_CANONICAL: Mapping[str, ApplicationStatus] = MappingProxyType(
    {
        "applied": S.SUBMITTED,
        "interview": S.INTERVIEWING,
        "offer": S.OFFER,
        "rejected": S.REJECTED,
    }
)

CANONICAL_TO_LEGACY: Mapping[ApplicationStatus, str] = MappingProxyType(
    {
        S.DRAFT: "applied",
        S.SUBMITTED: "applied",
        S.UNDER_REVIEW: "applied",
        S.SCREENING: "applied",
        S.INTERVIEWING: "interview",
        S.OFFER: "offer",
        S.REJECTED: "rejected",
        S.WITHDRAWN: "rejected",
        S.ARCHIVED: "rejected",
    }
)


def to_legacy(status: ApplicationStatus | str) -> str:
    return CANONICAL_TO_LEGACY[ApplicationStatus(status)]


def parse_status_input(value: str) -> ApplicationStatus | None:
    """Accept a legacy value or a canonical value; return None if unknown."""
    normalized = value.strip().lower()
    if normalized in LEGACY_TO_CANONICAL:
        return LEGACY_TO_CANONICAL[normalized]
    try:
        return ApplicationStatus(normalized)
    except ValueError:
        return None
