"""Validate writable profile values before touching ORM attributes."""
import json
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError


class Education(BaseModel):
    model_config = ConfigDict(extra='allow', strict=True)
    level: str = ''
    degree: str = ''
    degree_alt: str = ''
    specialization: str = ''
    university: str = ''
    course_type: str = ''
    start_year: str | int = ''
    end_year: str | int = ''
    grading_system: str = ''
    gpa: str | int | float = ''


class Certification(BaseModel):
    model_config = ConfigDict(extra='allow', strict=True)
    name: str = ''
    issuer: str = ''
    credential_id: str = ''
    credential_url: str = ''
    issue_date: str = ''
    expiry_date: str = ''
    does_not_expire: bool = False


_JSON_TYPES = {
    'skill_experience': TypeAdapter(dict[Annotated[str, Field(min_length=1, max_length=200)],
                                             Annotated[float, Field(strict=True, ge=0, le=100)]]),
    'skills': TypeAdapter(list[Annotated[str, Field(min_length=1, max_length=200)]]),
    'education_records': TypeAdapter(list[Education]),
    'certifications': TypeAdapter(list[Certification]),
}
_STRING = TypeAdapter(Annotated[str, Field(max_length=50_000)])
_INTEGER = TypeAdapter(Annotated[int, Field(ge=0, le=10_000)])
_BOOLEAN = TypeAdapter(bool)


class ProfileValidationError(ValueError):
    pass


def validate_update(data: dict, defaults: dict) -> dict:
    validated = {}
    # Only user-editable fields; never assign id, timestamps or ORM internals.
    for key in defaults.keys() & data.keys():
        value = data[key]
        try:
            if key in _JSON_TYPES:
                if isinstance(value, str):
                    if len(value) > 200_000:
                        raise ValueError('JSON too large')
                    value = json.loads(value)
                if not isinstance(value, dict if key == 'skill_experience' else list) or len(value) > 500:
                    raise ValueError('Expected a bounded collection')
                items = _JSON_TYPES[key].validate_python(value, strict=True)
                value = json.dumps(items if isinstance(items, dict) else [
                    item.model_dump(exclude_unset=True) if isinstance(item, BaseModel) else item
                    for item in items], allow_nan=False)
                if len(value) > 200_000:
                    raise ValueError('JSON too large')
            elif isinstance(defaults[key], bool):
                value = _BOOLEAN.validate_python(value, strict=True)
            elif isinstance(defaults[key], int):
                value = _INTEGER.validate_python(value, strict=True)
            else:
                value = _STRING.validate_python(value, strict=True)
        except (ValueError, TypeError, ValidationError) as exc:
            # Do not echo personal data or malformed JSON into API errors.
            raise ProfileValidationError(f'Invalid profile field: {key}') from exc
        validated[key] = value
    return validated
