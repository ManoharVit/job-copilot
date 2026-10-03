"""Typed request/response models for /api/v1/applications."""
from __future__ import annotations

import datetime as dt
from typing import Annotated, Generic, TypeVar
from urllib.parse import urlsplit

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator

from .domain import ApplicationStatus

MAX_TITLE = 300
MAX_COMPANY = 300
MAX_URL = 2048
MAX_PLATFORM = 50
MAX_NOTES = 10_000
MAX_JOB_DESCRIPTION = 50_000
MAX_TRANSITION_NOTE = 1_000
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


def _ensure_utc(value: dt.datetime) -> dt.datetime:
    # SQLite returns naive datetimes; everything is stored in UTC.
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.timezone.utc)
    return value.astimezone(dt.timezone.utc)


UtcDatetime = Annotated[dt.datetime, AfterValidator(_ensure_utc)]


def _validate_url(value: str) -> str:
    if value == "":
        return value
    parts = urlsplit(value)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ValueError("url must be an absolute http(s) URL")
    return value


# ---------------------------------------------------------------- requests --

_EXAMPLE_CREATE = {
    "title": "Backend Engineer",
    "company": "Example Corp",
    "url": "https://jobs.example.com/postings/1234",
    "platform": "company_site",
    "status": "submitted",
    "notes": "Referred by a former colleague.",
    "job_description": "We are looking for a Python engineer with FastAPI experience...",
}


class ApplicationCreate(BaseModel):
    model_config = ConfigDict(
        extra="forbid", str_strip_whitespace=True, json_schema_extra={"examples": [_EXAMPLE_CREATE]}
    )

    title: str = Field(min_length=1, max_length=MAX_TITLE)
    company: str = Field(min_length=1, max_length=MAX_COMPANY)
    url: Annotated[str, AfterValidator(_validate_url)] = Field(default="", max_length=MAX_URL)
    platform: str = Field(default="other", min_length=1, max_length=MAX_PLATFORM)
    status: ApplicationStatus = Field(
        default=ApplicationStatus.DRAFT,
        description="Initial status. Any status is accepted so existing applications can be back-filled.",
    )
    applied_at: dt.datetime | None = Field(
        default=None, description="When the application was created/sent. Defaults to now; may not be in the future."
    )
    notes: str = Field(default="", max_length=MAX_NOTES)
    job_description: str = Field(default="", max_length=MAX_JOB_DESCRIPTION)

    @field_validator("applied_at")
    @classmethod
    def _not_in_future(cls, value: dt.datetime | None) -> dt.datetime | None:
        if value is None:
            return None
        value = _ensure_utc(value)
        if value > dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5):
            raise ValueError("applied_at may not be in the future")
        return value


_NON_NULLABLE_UPDATE_FIELDS = ("title", "company", "url", "platform", "notes", "job_description", "status")


class ApplicationUpdate(BaseModel):
    """Partial update. Only fields present in the request body are applied."""

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        json_schema_extra={
            "examples": [
                {"status": "interviewing", "expected_status": "screening", "transition_note": "Onsite booked"},
                {"notes": "Followed up by email."},
            ]
        },
    )

    title: str | None = Field(default=None, min_length=1, max_length=MAX_TITLE)
    company: str | None = Field(default=None, min_length=1, max_length=MAX_COMPANY)
    url: Annotated[str, AfterValidator(_validate_url)] | None = Field(default=None, max_length=MAX_URL)
    platform: str | None = Field(default=None, min_length=1, max_length=MAX_PLATFORM)
    notes: str | None = Field(default=None, max_length=MAX_NOTES)
    job_description: str | None = Field(default=None, max_length=MAX_JOB_DESCRIPTION)
    status: ApplicationStatus | None = Field(default=None, description="Target status; must be an allowed transition.")
    expected_status: ApplicationStatus | None = Field(
        default=None,
        description="Optimistic concurrency guard: the update fails with 409 unless the current status matches.",
    )
    transition_note: str | None = Field(default=None, max_length=MAX_TRANSITION_NOTE)

    @model_validator(mode="after")
    def _check_consistency(self) -> "ApplicationUpdate":
        provided = self.model_fields_set
        if not provided:
            raise ValueError("request body must contain at least one field")
        for name in _NON_NULLABLE_UPDATE_FIELDS:
            if name in provided and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        if self.status is None and ({"expected_status", "transition_note"} & provided):
            raise ValueError("expected_status and transition_note require status")
        return self

    def field_changes(self) -> dict[str, str]:
        """Plain (non-status) fields explicitly provided in the request."""
        return {
            name: getattr(self, name)
            for name in ("title", "company", "url", "platform", "notes", "job_description")
            if name in self.model_fields_set
        }


# --------------------------------------------------------------- responses --


class ApplicationSummary(BaseModel):
    """List item. Excludes ``job_description`` to keep pages small."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    company: str
    url: str
    platform: str
    status: ApplicationStatus
    allowed_next_statuses: list[ApplicationStatus]
    applied_at: UtcDatetime
    updated_at: UtcDatetime | None
    notes: str


class ApplicationDetail(ApplicationSummary):
    job_description: str

    model_config = ConfigDict(
        from_attributes=True,
        json_schema_extra={
            "examples": [
                {
                    "id": 42,
                    **{k: v for k, v in _EXAMPLE_CREATE.items() if k != "status"},
                    "status": "screening",
                    "allowed_next_statuses": ["interviewing", "offer", "rejected", "withdrawn", "archived"],
                    "applied_at": "2026-09-30T10:15:00Z",
                    "updated_at": "2026-10-02T08:00:00Z",
                }
            ]
        },
    )


class StatusHistoryEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    from_status: ApplicationStatus | None
    to_status: ApplicationStatus
    changed_at: UtcDatetime
    note: str
    source: str


class StatusTransitions(BaseModel):
    transitions: dict[ApplicationStatus, list[ApplicationStatus]]
    terminal_statuses: list[ApplicationStatus]


ItemT = TypeVar("ItemT")


class Page(BaseModel, Generic[ItemT]):
    items: list[ItemT]
    total: int
    page: int
    page_size: int


class ErrorBody(BaseModel):
    code: str
    message: str
    details: object | None = None
    request_id: str


class ErrorEnvelope(BaseModel):
    error: ErrorBody
