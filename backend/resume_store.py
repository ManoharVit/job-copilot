"""One private local resume; atomic replacement, no database migration or AI use."""
from __future__ import annotations

import base64
import binascii
import hashlib
import io
import json
import os
import re
import tempfile
import zipfile

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from settings import get_settings

MAX_RESUME_BYTES = 5 * 1024 * 1024
MAX_BASE64_BYTES = 4 * ((MAX_RESUME_BYTES + 2) // 3)
MAX_REQUEST_BYTES = MAX_BASE64_BYTES + 4096
DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class ResumeInvalid(ValueError):
    pass


class ResumeUpload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    filename: str = Field(min_length=1, max_length=160)
    content_base64: str = Field(min_length=1, max_length=MAX_BASE64_BYTES)


def validated_record(value: dict) -> dict:
    try:
        upload = ResumeUpload.model_validate(value)
        name = upload.filename
        if name != name.strip() or re.search(r"[\\/\x00-\x1f\x7f]", name):
            raise ValueError("Invalid filename")
        blob = base64.b64decode(upload.content_base64, validate=True)
        if not blob or len(blob) > MAX_RESUME_BYTES:
            raise ValueError("Invalid file size")
        suffix = name.rsplit(".", 1)[-1].lower()
        if suffix == "pdf" and blob.startswith(b"%PDF-"):
            mime_type = "application/pdf"
        elif suffix == "docx":
            with zipfile.ZipFile(io.BytesIO(blob)) as archive:
                entries = archive.infolist()
                names = {entry.filename for entry in entries}
                if not {"[Content_Types].xml", "word/document.xml"} <= names:
                    raise ValueError("Not a Word document")
                if len(entries) > 500 or sum(entry.file_size for entry in entries) > 50 * 1024 * 1024:
                    raise ValueError("Archive too large")
                if any(entry.flag_bits & 1 for entry in entries) or "word/vbaProject.bin" in names:
                    raise ValueError("Encrypted or macro-enabled document")
            mime_type = DOCX_TYPE
        else:
            raise ValueError("Unsupported file")
    except (ValueError, TypeError, ValidationError, binascii.Error, zipfile.BadZipFile) as exc:
        raise ResumeInvalid("Choose a valid PDF or DOCX resume, up to 5 MB, with a plain filename.") from exc
    return {"filename": name, "mime_type": mime_type, "size": len(blob),
            "sha256": hashlib.sha256(blob).hexdigest(), "content_base64": upload.content_base64}


def load_resume() -> dict | None:
    path = get_settings().resume_path
    try:
        with path.open("rb") as source:
            raw = source.read(MAX_REQUEST_BYTES + 1)
        if len(raw) > MAX_REQUEST_BYTES:
            raise ValueError("Stored file too large")
        record = json.loads(raw)
        result = validated_record({"filename": record["filename"], "content_base64": record["content_base64"]})
        if any(result[key] != record.get(key) for key in ("mime_type", "size", "sha256")):
            raise ValueError("Stored file integrity mismatch")
        return result
    except FileNotFoundError:
        return None
    except (ValueError, KeyError, TypeError) as exc:
        raise ResumeInvalid("The saved resume is invalid. Replace it in Profile → Resume.") from exc


def save_resume(value: dict) -> dict:
    record = validated_record(value)
    path = get_settings().resume_path
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        # Both filename and contents are replaced together; concurrent readers see
        # either the old complete record or the new complete record.
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as target:
            temporary = target.name
            os.chmod(target.name, 0o600)
            json.dump(record, target, ensure_ascii=True)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)
    return record


def metadata(record: dict | None) -> dict:
    return {"configured": True, **{key: value for key, value in record.items() if key != "content_base64"}} if record else {"configured": False}


def delete_resume() -> None:
    get_settings().resume_path.unlink(missing_ok=True)
