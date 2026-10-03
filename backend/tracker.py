"""Legacy adapters for the original ``/api/*`` tracker routes.

The original dashboard and browser extension depend on these response shapes,
so they are preserved here while all business rules live in
``app_tracker.service``. Status values are translated with the documented,
lossy legacy mapping in ``app_tracker.domain``.
"""
import csv
import datetime
import io

from sqlalchemy.orm import Session

from app_tracker.domain import ChangeSource, parse_status_input, to_legacy
from app_tracker.errors import UnknownStatus
from app_tracker.repository import ApplicationRepository
from app_tracker.service import ApplicationService

LEGACY_LIST_MAX = 1000
_CSV_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def log_application(db: Session, owner_id: int, url: str, title: str, company: str, platform: str, job_description: str = ""):
    return ApplicationService(db, owner_id).log_from_extension(
        url=url, title=title, company=company, platform=platform, job_description=job_description
    )


def get_applications(db: Session, owner_id: int, limit: int = 100, offset: int = 0):
    limit = max(1, min(limit, LEGACY_LIST_MAX))
    offset = max(0, offset)
    apps = ApplicationRepository(db, owner_id).list(None, offset=offset, limit=limit)
    return [{"id": a.id, "url": a.url, "title": a.title, "company": a.company,
             "platform": a.platform, "status": to_legacy(a.status),
             "applied_at": a.applied_at.isoformat(), "notes": a.notes} for a in apps]


def get_stats(db: Session, owner_id: int) -> dict:
    repo = ApplicationRepository(db, owner_id)
    today_start = datetime.datetime.now(datetime.timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    by_status: dict[str, int] = {}
    for status, count in repo.counts_by("status").items():
        legacy = to_legacy(status)
        by_status[legacy] = by_status.get(legacy, 0) + count

    return {
        "today": repo.count_since(today_start),
        "total": repo.count(),
        "by_platform": repo.counts_by("platform"),
        "by_status": by_status,
    }


def update_application(db: Session, owner_id: int, app_id: int, status: str = None, notes: str = None) -> None:
    """Apply a legacy status and/or notes update.

    Raises ApplicationNotFound (404), UnknownStatus (400) or
    InvalidStatusTransition (409); legacy routes render these as ``{"detail"}``.
    Selecting the legacy bucket the application is already in (for example
    "applied" while it is ``screening``) is a no-op, not a regression.
    """
    service = ApplicationService(db, owner_id)
    if status is not None:
        requested = status.strip().lower()
        target = parse_status_input(requested)
        if target is None:
            raise UnknownStatus(status)
        is_canonical_value = target.value == requested
        already_in_legacy_bucket = (
            not is_canonical_value and to_legacy(service.get(app_id).status) == requested
        )
        if not already_in_legacy_bucket:
            service.change_status(app_id, target, source=ChangeSource.LEGACY_API)
    if notes is not None:
        service.update_notes(app_id, notes)


def delete_application(db: Session, owner_id: int, app_id: int) -> None:
    ApplicationService(db, owner_id).delete(app_id)


def _csv_safe(value) -> str:
    """Neutralise spreadsheet formula injection (values may come from scraped pages)."""
    text = "" if value is None else str(value)
    return "'" + text if text.startswith(_CSV_FORMULA_PREFIXES) else text


def export_applications_csv(db: Session, owner_id: int) -> str:
    apps = ApplicationRepository(db, owner_id).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "URL", "Title", "Company", "Platform", "Status", "Applied At", "Notes", "Job Description"])
    for a in apps:
        writer.writerow([
            a.id,
            _csv_safe(a.url),
            _csv_safe(a.title),
            _csv_safe(a.company),
            _csv_safe(a.platform),
            a.status,
            a.applied_at.isoformat() if a.applied_at else "",
            _csv_safe(a.notes),
            _csv_safe(a.job_description),
        ])
    return output.getvalue()
