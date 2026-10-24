"""Use explicitly confirmed skill durations, never total tenure as a proxy."""
import json
import math
import re

_ALIASES = {
    'python': r'\bpython\b',
    'ai apis': r'\bai apis?\b',
    'llms': r'\b(?:llms?|large language models?)\b',
    'rag': r'\b(?:rag|retrieval augmented generation)\b',
    'vector search': r'\bvector search\b',
    'ffmpeg': r'\bffmpeg\b',
    'video processing': r'\b(?:video|media)(?:\s*/\s*media)?\s+processing\b',
}


def confirmed_skill_years(text: str, profile: dict) -> tuple[bool, float | None]:
    text = re.sub(r'[_-]+', ' ', text.lower())
    raw = profile.get('skill_experience', {})
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (ValueError, TypeError):
            raw = {}
    records = {str(key).strip().lower(): value for key, value in raw.items()} if isinstance(raw, dict) else {}
    aliases = {**{key: r'\b' + re.escape(key) + r'\b' for key in records}, **_ALIASES}
    requested = [key for key, pattern in aliases.items() if re.search(pattern, text)]
    if not requested:
        return False, None
    values = [records.get(key) for key in requested]
    if any(isinstance(value, bool) or not isinstance(value, (int, float))
           or not math.isfinite(value) or not 0 <= value <= 100 for value in values):
        return True, None
    # One range cannot represent differing or partially unknown durations.
    if len(set(values)) != 1:
        return True, None
    return True, values[0]
