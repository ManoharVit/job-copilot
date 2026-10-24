"""Share saved compensation facts between Autofill and inline Generate.

Amounts retain their saved units. Never infer a fixed/variable split, convert
currencies or pay periods, or interpret an unspecified ESOP as zero.
"""
from dataclasses import dataclass
import re


@dataclass(frozen=True)
class CompensationRequest:
    targets: tuple[tuple[str, str], ...]
    esops: bool
    supported: bool


_PERIOD = re.compile(r"\b(current|present|existing|expected|desired|target)\b")
_COMPENSATION = re.compile(
    r"\b(?:ctc|salary|compensation|remuneration|lpa|fixed pay|variable pay|base pay|base salary)\b"
)
_EXCLUDED = re.compile(
    r"\b(?:worker|workers|workman|unemployment|claim|claims|committee|board|account)\b"
)
_UNSUPPORTED = re.compile(
    r"\b(?:month|monthly|hour|hourly|weekly|daily|usd|eur|gbp|dollars?|euros?|"
    r"percent|percentage|inr|rupees?)\b|[%$€£₹]"
)
# Only factual labels use the local shortcut. Multi-part/reasoning questions
# continue through the writer, with narrowly scoped compensation context.
_SIMPLE_WORDS = set("""
what is are was were your you my the a an and or of for in as to with at per
please kindly mention specify provide share state enter tell me us much how
current present existing expected desired target annual annually yearly year
ctc salary compensation remuneration package pay lpa rs lac lacs lakh lakhs
fixed variable base total split breakdown component components including include
includes esop esops equity stock options if any amount amounts details detail
cost company on based n number question input field required
""".split())


def _normalize(text: str) -> str:
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", text).lower()
    text = text.replace("_", " ").replace("-", " ")
    return re.sub(r"\b(current|expected|desired|present)(ctc|salary)\b", r"\1 \2", text)


def _components(text: str) -> tuple[str, ...]:
    components = []
    if re.search(r"\b(?:fixed|base)\b", text):
        components.append("fixed")
    if re.search(r"\bvariable\b", text):
        components.append("variable")
    if not components or re.search(r"\btotal\b", text) or (
        len(components) > 1 and re.search(r"\b(?:ctc|salary|compensation|breakdown)\b", text)
    ):
        components.insert(0, "total")
    return tuple(components)


def compensation_request(text: str) -> CompensationRequest | None:
    text = _normalize(text)
    if _EXCLUDED.search(text):
        return None
    if not _COMPENSATION.search(text) and not (
        _PERIOD.search(text) and re.search(r"\bpackage\b", text)
    ):
        return None
    # Equity-only questions are not requests for cash salary.
    if re.search(r"\b(?:equity|stock|esops?)\b", text) and not re.search(
        r"\b(?:ctc|salary|fixed|variable|base|total)\b", text
    ):
        return None
    text = re.sub(r"\bexpectations?\b", "expected", text)
    periods = []
    matches = list(_PERIOD.finditer(text))
    for match in matches:
        period = "expected" if match[0] in {"expected", "desired", "target"} else "current"
        if period not in periods:
            periods.append(period)
    periods = periods or ["current"]
    components = _components(text)
    targets = [(period, component) for period in periods for component in components]
    # Distinct requests such as "current fixed and expected variable pay" must
    # not apply the same component to both periods.
    if len(periods) == 2:
        first = matches[0]
        second = next(m for m in matches if (
            "expected" if m[0] in {"expected", "desired", "target"} else "current"
        ) != periods[0])
        first_text = text[first.start():second.start()]
        if re.search(r"\b(?:fixed|base|variable)\b", first_text):
            targets = [(periods[0], c) for c in _components(first_text)]
            targets += [(periods[1], c) for c in _components(text[second.start():])]
    return CompensationRequest(
        tuple(targets), bool(re.search(r"\b(?:esops?|equity|stock)\b", text)),
        not bool(_UNSUPPORTED.search(text)),
    )


def _key(period: str, component: str) -> str:
    return f"{period}_ctc" if component == "total" else f"{period}_{component}_ctc"


def _render(request: CompensationRequest, profile: dict) -> str:
    sentences = []
    for period in ("current", "expected"):
        parts = []
        for requested_period, component in request.targets:
            if requested_period == period:
                label = "total CTC" if component == "total" else f"{component} pay"
                value = profile.get(_key(period, component)) or "not specified"
                parts.append(f"{label}: {value}")
        if parts:
            sentences.append(f"{period.capitalize()} annual " + "; ".join(parts) + ".")
    if request.esops:
        sentences.append("ESOPs: not specified.")
    return " ".join(sentences)


def _simple(text: str) -> bool:
    return set(re.findall(r"[a-z]+", _normalize(text))) <= _SIMPLE_WORDS


def compensation_answer(question: str, profile: dict) -> str | None:
    request = compensation_request(question)
    if request is None or not _simple(question):
        return None
    if not request.supported:
        return "[Error] Compensation units require manual review. No conversion was made."
    if not any(profile.get(_key(*target)) for target in request.targets):
        return "[Error] Requested compensation details are not saved in your profile."
    return _render(request, profile)


def compensation_context(question: str, profile: dict) -> str:
    request = compensation_request(question)
    if request is None:
        return ""
    return (
        "SAVED COMPENSATION FACTS: " + _render(request, profile)
        + " Use these facts verbatim. Never infer unsaved components, ESOPs, "
        "currency conversions, pay-period conversions, percentages, or negotiability."
    )


def compensation_field(text: str, field_type: str, options: list, profile: dict, formatter) -> str | None:
    request = compensation_request(text)
    if request is None or not request.supported:
        return None
    # Do not fill a salary amount into a compound salary-and-notice question.
    if re.search(r"\b(?:notice|joining|experience|why|explain|justify|negotiate)\b", _normalize(text)):
        return None
    if len(request.targets) != 1 or request.esops:
        if field_type not in {"", "text", "textarea"} or options:
            return None
        if not any(profile.get(_key(*target)) for target in request.targets):
            return None
        return _render(request, profile)
    value = profile.get(_key(*request.targets[0]), "")
    if not value:
        return None
    if options:
        numeric = formatter(value, "number", text)
        for option in options:
            if value.strip().lower() == option.strip().lower():
                return option
            match = re.fullmatch(r"\s*([0-9]+(?:\.[0-9]+)?)\s*(?:lpa|lakhs?|lacs?)?\s*", option, re.I)
            if match and re.fullmatch(r"\d+(?:\.\d+)?", numeric or "") and float(numeric) == float(match[1]):
                return option
        return None
    return formatter(value, field_type, text)
