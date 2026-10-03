"""Central application settings.

Values come from environment variables first, then from the project-level
``.env`` file. Unknown keys in ``.env`` (for example ``GEMINI_API_KEY``, which
``ai_writer`` still reads itself) are ignored here.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SQLITE_PATH = PROJECT_ROOT / "data" / "copilot.db"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # SQLAlchemy database URL. Defaults to the existing local SQLite file so
    # current installs keep working without any configuration change.
    database_url: str = f"sqlite:///{DEFAULT_SQLITE_PATH}"

    # Identity mode. Only "local" exists today: every request acts as the
    # single bootstrap local user. Real authentication is not implemented yet,
    # so the server must stay bound to 127.0.0.1.
    auth_mode: Literal["local"] = "local"


@lru_cache
def get_settings() -> Settings:
    """Return cached settings. Tests call ``get_settings.cache_clear()``."""
    return Settings()
