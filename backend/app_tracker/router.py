"""HTTP layer for /api/v1/applications. Handlers stay thin: parse, delegate, shape."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from api_errors import register_domain_error
from database import get_db
from identity import CurrentUser, get_current_user
from models import Application

from .domain import ALLOWED_TRANSITIONS, TERMINAL_STATUSES, ApplicationStatus, allowed_next
from .errors import ApplicationNotFound, InvalidStatusTransition, StatusConflict, UnknownStatus
from .schemas import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    ApplicationCreate,
    ApplicationDetail,
    ApplicationSummary,
    ApplicationUpdate,
    ErrorEnvelope,
    Page,
    StatusHistoryEntry,
    StatusTransitions,
)
from .service import ApplicationService

register_domain_error(ApplicationNotFound, status.HTTP_404_NOT_FOUND)
register_domain_error(InvalidStatusTransition, status.HTTP_409_CONFLICT)
register_domain_error(StatusConflict, status.HTTP_409_CONFLICT)
register_domain_error(UnknownStatus, status.HTTP_400_BAD_REQUEST)

router = APIRouter(prefix="/api/v1/applications", tags=["applications"])

_NOT_FOUND = {404: {"model": ErrorEnvelope, "description": "Application not found (or owned by another user)."}}
_VALIDATION = {422: {"model": ErrorEnvelope, "description": "Request validation failed."}}
_CONFLICT = {
    409: {
        "model": ErrorEnvelope,
        "description": "Invalid status transition, or `expected_status` did not match the current status.",
    }
}


def get_application_service(
    db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)
) -> ApplicationService:
    return ApplicationService(db, owner_id=user.id)


ServiceDep = Annotated[ApplicationService, Depends(get_application_service)]


def _summary(application: Application) -> ApplicationSummary:
    return ApplicationSummary.model_validate(
        {**_columns(application), "allowed_next_statuses": allowed_next(ApplicationStatus(application.status))}
    )


def _detail(application: Application) -> ApplicationDetail:
    return ApplicationDetail.model_validate(
        {
            **_columns(application),
            "job_description": application.job_description or "",
            "allowed_next_statuses": allowed_next(ApplicationStatus(application.status)),
        }
    )


def _columns(application: Application) -> dict:
    return {
        "id": application.id,
        "title": application.title or "",
        "company": application.company or "",
        "url": application.url or "",
        "platform": application.platform or "",
        "status": application.status,
        "applied_at": application.applied_at,
        "updated_at": application.updated_at,
        "notes": application.notes or "",
    }


@router.post(
    "",
    response_model=ApplicationDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Create an application",
    description="Creates an application owned by the current user and records its initial status in history.",
    responses=_VALIDATION,
)
def create_application(body: ApplicationCreate, service: ServiceDep, response: Response) -> ApplicationDetail:
    application = service.create(body)
    response.headers["Location"] = f"{router.prefix}/{application.id}"
    return _detail(application)


@router.get(
    "",
    response_model=Page[ApplicationSummary],
    summary="List applications",
    description=(
        "Newest first. Filter with one or more `status` parameters, e.g. "
        "`?status=screening&status=interviewing`. List items omit `job_description`."
    ),
    responses=_VALIDATION,
)
def list_applications(
    service: ServiceDep,
    status_filter: Annotated[list[ApplicationStatus] | None, Query(alias="status")] = None,
    page: Annotated[int, Query(ge=1, le=100_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> Page[ApplicationSummary]:
    items, total = service.list(status_filter, page, page_size)
    return Page[ApplicationSummary](
        items=[_summary(a) for a in items], total=total, page=page, page_size=page_size
    )


@router.get(
    "/status-transitions",
    response_model=StatusTransitions,
    summary="Allowed status transitions",
    description="The lifecycle rules enforced by PATCH. Useful for building status pickers.",
)
def get_status_transitions() -> StatusTransitions:
    return StatusTransitions(
        transitions={s: allowed_next(s) for s in ALLOWED_TRANSITIONS},
        terminal_statuses=[s for s in ApplicationStatus if s in TERMINAL_STATUSES],
    )


@router.get(
    "/{application_id}",
    response_model=ApplicationDetail,
    summary="Get an application",
    responses=_NOT_FOUND,
)
def get_application(application_id: int, service: ServiceDep) -> ApplicationDetail:
    return _detail(service.get(application_id))


@router.patch(
    "/{application_id}",
    response_model=ApplicationDetail,
    summary="Update an application and/or change its status",
    description=(
        "Applies only the fields present in the body. A `status` change must be an allowed "
        "transition (see `/status-transitions`) and is recorded in history. Requesting the "
        "current status is an idempotent no-op. Supply `expected_status` to fail with 409 if "
        "the status changed since you last read it."
    ),
    responses={**_NOT_FOUND, **_CONFLICT, **_VALIDATION},
)
def update_application(
    application_id: int, body: ApplicationUpdate, service: ServiceDep
) -> ApplicationDetail:
    return _detail(service.update(application_id, body))


@router.get(
    "/{application_id}/history",
    response_model=list[StatusHistoryEntry],
    summary="Status history",
    description="All status changes for the application, oldest first, including the initial status.",
    responses=_NOT_FOUND,
)
def get_application_history(application_id: int, service: ServiceDep) -> list[StatusHistoryEntry]:
    return [StatusHistoryEntry.model_validate(h) for h in service.history(application_id)]


@router.delete(
    "/{application_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an application",
    description="Permanently deletes the application and its status history. Use status `archived` to keep it.",
    responses=_NOT_FOUND,
)
def delete_application(application_id: int, service: ServiceDep) -> Response:
    service.delete(application_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
