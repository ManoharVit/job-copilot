"""Bounded form metadata accepted by the deterministic matching endpoint."""
from typing import Annotated, Literal

from pydantic import BaseModel, Field, TypeAdapter

Text = Annotated[str, Field(max_length=10_000, strict=True)]


class MatchField(BaseModel):
    index: Annotated[int, Field(ge=0, le=10_000, strict=True)]
    label: Text = ''
    context: Text = ''
    name: Text = ''
    id: Text = ''
    placeholder: Text = ''
    type: Text = ''
    tag: Text = ''
    options: Annotated[list[Text], Field(max_length=500)] = Field(default_factory=list)
    degree_preference: Literal['master', 'bachelor'] | None = None


Fields = Annotated[list[MatchField], Field(max_length=1000)]


class MatchEnvelope(BaseModel):
    fields: Fields = Field(default_factory=list)
    degree_preference: Literal['master', 'bachelor'] | None = None


MATCH_PAYLOAD = TypeAdapter(Fields | MatchEnvelope)
