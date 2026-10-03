from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from database import Base
import datetime


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


# Canonical application statuses. Kept in sync with
# app_tracker.domain.ApplicationStatus (asserted by tests) and enforced in the
# database by ck_applications_status_valid (migration 0002).
APPLICATION_STATUS_VALUES = (
    "draft",
    "submitted",
    "under_review",
    "screening",
    "interviewing",
    "offer",
    "rejected",
    "withdrawn",
    "archived",
)
_STATUS_CHECK_SQL = "status IN ({})".format(", ".join(f"'{s}'" for s in APPLICATION_STATUS_VALUES))


class User(Base):
    """Owner of tracker data. Authentication fields are added in a later phase."""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(320), nullable=False, unique=True)
    display_name = Column(String(200), nullable=False, default="")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=_utcnow)


class Profile(Base):
    __tablename__ = "profiles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, default="")
    email = Column(String, default="")
    phone = Column(String, default="")
    location = Column(String, default="")
    linkedin_url = Column(String, default="")
    github_url = Column(String, default="")
    portfolio_url = Column(String, default="")
    
    current_title = Column(String, default="")
    years_experience = Column(Integer, default=0)
    
    education_level = Column(String, default="")
    graduation_year = Column(Integer, default=0)
    gpa = Column(String, default="")
    
    skills = Column(Text, default="[]") # JSON list
    
    expected_ctc = Column(String, default="")
    current_ctc = Column(String, default="")
    notice_period = Column(String, default="")
    
    willing_to_relocate = Column(Boolean, default=True)
    work_authorized = Column(Boolean, default=True)
    gender = Column(String, default="")
    date_of_birth = Column(String, default="")
    
    cover_letter_template = Column(Text, default="")
    
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), onupdate=lambda: datetime.datetime.now(datetime.timezone.utc))

class Application(Base):
    __tablename__ = "applications"
    __table_args__ = (
        CheckConstraint(_STATUS_CHECK_SQL, name="ck_applications_status_valid"),
        Index("ix_applications_owner_status", "owner_id", "status"),
        Index("ix_applications_owner_applied_at", "owner_id", "applied_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    url = Column(String, default="")
    title = Column(String, default="")
    company = Column(String, default="")
    platform = Column(String, default="")
    status = Column(String, nullable=False, default="draft")
    applied_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
    notes = Column(Text, default="")
    job_description = Column(Text, default="")

    status_history = relationship(
        "ApplicationStatusHistory",
        back_populates="application",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ApplicationStatusHistory.id",
    )


class ApplicationStatusHistory(Base):
    """Append-only record of every status change (including the initial status)."""

    __tablename__ = "application_status_history"

    id = Column(Integer, primary_key=True)
    application_id = Column(
        Integer, ForeignKey("applications.id", ondelete="CASCADE"), nullable=False, index=True
    )
    from_status = Column(String(32), nullable=True)
    to_status = Column(String(32), nullable=False)
    changed_at = Column(DateTime, nullable=False, default=_utcnow)
    note = Column(Text, nullable=False, default="")
    # api | legacy_api | extension | migration
    source = Column(String(32), nullable=False, default="api")

    application = relationship("Application", back_populates="status_history")
