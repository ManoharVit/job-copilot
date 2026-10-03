"""Tracker business-rule errors (HTTP mapping lives in the router)."""
from __future__ import annotations

from api_errors import DomainError

from .domain import ApplicationStatus


class ApplicationNotFound(DomainError):
    """Raised for missing records AND records owned by someone else.

    Both cases deliberately look identical so callers cannot probe which IDs
    exist.
    """

    code = "application_not_found"

    def __init__(self, application_id: int) -> None:
        super().__init__(f"Application {application_id} was not found.")


class InvalidStatusTransition(DomainError):
    code = "invalid_status_transition"

    def __init__(self, current: ApplicationStatus, target: ApplicationStatus, allowed: list[ApplicationStatus]) -> None:
        super().__init__(
            f"Cannot change status from '{current}' to '{target}'.",
            details={
                "current_status": str(current),
                "requested_status": str(target),
                "allowed_next_statuses": [str(s) for s in allowed],
            },
        )


class StatusConflict(DomainError):
    """``expected_status`` did not match: someone else changed it first."""

    code = "status_conflict"

    def __init__(self, expected: ApplicationStatus, actual: ApplicationStatus) -> None:
        super().__init__(
            f"Expected current status '{expected}' but it is '{actual}'. Reload and retry.",
            details={"expected_status": str(expected), "current_status": str(actual)},
        )


class UnknownStatus(DomainError):
    code = "unknown_status"

    def __init__(self, value: str) -> None:
        # Truncate: never reflect large or unbounded client input.
        super().__init__(f"Unknown status '{value[:40]}'.")
