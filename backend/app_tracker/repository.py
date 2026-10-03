"""Owner-scoped persistence for applications.

Every query filters by ``owner_id``. There is intentionally no method that can
read or modify another owner's rows. Repositories flush but never commit; the
service owns the transaction boundary.
"""
from __future__ import annotations

import datetime as dt
from collections.abc import Sequence

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from models import Application, ApplicationStatusHistory


class ApplicationRepository:
    def __init__(self, session: Session, owner_id: int) -> None:
        self._session = session
        self._owner_id = owner_id

    # -- queries -------------------------------------------------------------
    def _owned(self) -> Select:
        return select(Application).where(Application.owner_id == self._owner_id)

    def _filtered(self, statuses: Sequence[str] | None) -> Select:
        stmt = self._owned()
        if statuses:
            stmt = stmt.where(Application.status.in_(list(statuses)))
        return stmt

    def get(self, application_id: int) -> Application | None:
        return self._session.scalar(self._owned().where(Application.id == application_id))

    def list(self, statuses: Sequence[str] | None, offset: int, limit: int) -> list[Application]:
        stmt = (
            self._filtered(statuses)
            .order_by(Application.applied_at.desc(), Application.id.desc())
            .offset(offset)
            .limit(limit)
        )
        return list(self._session.scalars(stmt))

    def count(self, statuses: Sequence[str] | None = None) -> int:
        stmt = select(func.count()).select_from(self._filtered(statuses).subquery())
        return int(self._session.scalar(stmt) or 0)

    def all(self) -> list[Application]:
        stmt = self._owned().order_by(Application.applied_at.desc(), Application.id.desc())
        return list(self._session.scalars(stmt))

    def find_recent_by_url(self, url: str, since: dt.datetime) -> Application | None:
        stmt = (
            self._owned()
            .where(Application.url == url, Application.applied_at >= since)
            .order_by(Application.id.desc())
            .limit(1)
        )
        return self._session.scalar(stmt)

    def count_since(self, since: dt.datetime) -> int:
        stmt = select(func.count()).where(
            Application.owner_id == self._owner_id, Application.applied_at >= since
        )
        return int(self._session.scalar(stmt) or 0)

    def counts_by(self, column_name: str) -> dict[str, int]:
        column = {"status": Application.status, "platform": Application.platform}[column_name]
        stmt = (
            select(column, func.count(Application.id))
            .where(Application.owner_id == self._owner_id)
            .group_by(column)
        )
        return {key: int(n) for key, n in self._session.execute(stmt).all()}

    def history(self, application_id: int) -> list[ApplicationStatusHistory]:
        stmt = (
            select(ApplicationStatusHistory)
            .join(Application, ApplicationStatusHistory.application_id == Application.id)
            .where(Application.id == application_id, Application.owner_id == self._owner_id)
            .order_by(ApplicationStatusHistory.id.asc())
        )
        return list(self._session.scalars(stmt))

    # -- writes --------------------------------------------------------------
    def add(self, application: Application) -> Application:
        application.owner_id = self._owner_id
        self._session.add(application)
        self._session.flush()
        return application

    def add_history(self, entry: ApplicationStatusHistory) -> None:
        self._session.add(entry)
        self._session.flush()

    def delete(self, application: Application) -> None:
        if application.owner_id != self._owner_id:  # defence in depth
            raise PermissionError("refusing to delete a row owned by another user")
        self._session.delete(application)
        self._session.flush()
