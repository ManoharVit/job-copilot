"""Strict, bounded contracts for AI and plain-text document requests."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field

ShortText = Annotated[str, Field(strict=True, max_length=500)]
Description = Annotated[str, Field(strict=True, max_length=30_000)]
DocumentText = Annotated[str, Field(strict=True, max_length=100_000)]


class WriterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CoverLetterRequest(WriterRequest):
    job_description: Description = ""
    company_name: ShortText = ""
    target_product: ShortText = ""


class AnswerRequest(WriterRequest):
    question: Annotated[str, Field(strict=True, max_length=5_000)] = ""
    job_description: Description = ""


class TailorRequest(WriterRequest):
    bullets: list[Annotated[str, Field(strict=True, min_length=1, max_length=2_000)]] = Field(default_factory=list, max_length=100)
    job_description: Description = ""


class HumanizeRequest(WriterRequest):
    text: DocumentText = ""


class InterviewRequest(WriterRequest):
    job_description: Description = ""


class ExportRequest(WriterRequest):
    text: DocumentText = ""
    format: Literal["pdf", "docx", "tex"] = "tex"
    doc_type: ShortText = "Document"
