"""Request identity.

Authentication is NOT implemented yet. In ``local`` mode (the only supported
mode) every request acts as one bootstrap local user, created by migration
``0002``. All tracker data is still stored and queried per ``owner_id`` so a
real authentication dependency can replace :func:`get_current_user` later
without touching services or repositories.
"""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from models import User
from settings import Settings, get_settings

LOCAL_USER_EMAIL = "local-user@localhost"
LOCAL_USER_DISPLAY_NAME = "Local user"


@dataclass(frozen=True)
class CurrentUser:
    id: int
    email: str


def get_or_create_local_user(db: Session) -> User:
    user = db.scalar(select(User).where(User.email == LOCAL_USER_EMAIL))
    if user is None:
        user = User(email=LOCAL_USER_EMAIL, display_name=LOCAL_USER_DISPLAY_NAME)
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def get_current_user(
    db: Session = Depends(get_db), settings: Settings = Depends(get_settings)
) -> CurrentUser:
    if settings.auth_mode != "local":  # pragma: no cover - guarded by the Literal type
        raise RuntimeError(f"Unsupported AUTH_MODE: {settings.auth_mode}")
    user = get_or_create_local_user(db)
    return CurrentUser(id=user.id, email=user.email)
