"""Compensation is saved data, never model-inferred compensation policy."""
from unittest.mock import patch

import pytest

import ai_writer
from compensation import compensation_answer
from field_matcher import match_fields
from .conftest import downgrade, migrate, make_engine
import profile_manager
from sqlalchemy import text


@pytest.fixture
def pay():
    # Synthetic values; real candidate compensation belongs only in local DB.
    return {
        "current_ctc": "12 LPA", "current_fixed_ctc": "9 LPA", "current_variable_ctc": "3 LPA",
        "expected_ctc": "18 LPA", "expected_fixed_ctc": "14 LPA", "expected_variable_ctc": "4 LPA",
    }


QUESTION = (
    "7. What is your current annual CTC and expected CTC? "
    "(please mention: fixed CTC + variable CTC + ESOPs, if any)"
)


def test_combined_question_uses_saved_breakdowns_offline(pay):
    with patch.object(ai_writer, "AI_AVAILABLE", False), patch.object(ai_writer, "_call_gemini") as model:
        answer = ai_writer.generate_answer(QUESTION, pay)
    assert answer == (
        "Current annual total CTC: 12 LPA; fixed pay: 9 LPA; variable pay: 3 LPA. "
        "Expected annual total CTC: 18 LPA; fixed pay: 14 LPA; variable pay: 4 LPA. "
        "ESOPs: not specified."
    )
    model.assert_not_called()


@pytest.mark.parametrize(("label", "key"), [
    ("Current CTC", "current_ctc"),
    ("Expected CTC", "expected_ctc"),
    ("Current annual fixed compensation (Rs LPA)", "current_fixed_ctc"),
    ("Expected fixed annual compensation", "expected_fixed_ctc"),
    ("Current variable pay", "current_variable_ctc"),
    ("Desired variable CTC", "expected_variable_ctc"),
    ("Current base salary", "current_fixed_ctc"),
    ("Salary expectations", "expected_ctc"),
])
def test_text_numeric_and_dropdown_components(pay, label, key):
    value = pay[key]
    fields = [
        {"index": 0, "label": label, "type": "text"},
        {"index": 1, "label": label, "type": "number"},
        {"index": 2, "label": label, "type": "select", "options": ["0 LPA", value]},
    ]
    assert match_fields(fields, pay) == {0: value, 1: value.split()[0], 2: value}


def test_missing_fixed_is_not_replaced_with_total():
    assert match_fields([{"index": 0, "label": "Current fixed compensation"}], {"current_ctc": "12 LPA"}) == {}
    answer = compensation_answer(QUESTION, {"current_ctc": "12 LPA", "expected_ctc": "18 LPA"})
    assert "fixed pay: not specified" in answer
    assert "variable pay: not specified" in answer
    assert "ESOPs: not specified" in answer


def test_combined_autofill_uses_narrative_only_in_text_controls(pay):
    fields = [{"index": i, "label": QUESTION, "type": kind}
              for i, kind in enumerate(["textarea", "number", "select"])]
    assert match_fields(fields, pay) == {0: compensation_answer(QUESTION, pay)}


def test_current_fixed_expected_variable_are_independent(pay):
    answer = compensation_answer("Please mention current fixed pay and expected variable pay", pay)
    assert answer == "Current annual fixed pay: 9 LPA. Expected annual variable pay: 4 LPA."


@pytest.mark.parametrize("label", [
    "Expected monthly salary", "Expected hourly salary", "Expected CTC in USD",
    "Current variable pay percentage", "Current CTC and notice period",
    "Explain why your expected CTC is justified", "Equity Compensation", "Workers Compensation Claim",
])
def test_unsupported_and_unrelated_fields_are_not_filled(pay, label):
    assert match_fields([{"index": 0, "label": label}], pay) == {}


def test_unrequested_current_salary_is_not_disclosed(pay):
    answer = compensation_answer("What is your expected CTC?", pay)
    assert answer == "Expected annual total CTC: 18 LPA."
    assert "12 LPA" not in answer


def test_compensation_context_for_complex_question_is_scoped(pay):
    with patch.object(ai_writer, "AI_AVAILABLE", True), patch.object(ai_writer, "_call_gemini", return_value="Draft") as model:
        ai_writer.generate_answer("Explain why your expected CTC is justified", pay)
        prompt = model.call_args.args[1]
        assert "18 LPA" in prompt and "12 LPA" not in prompt
        ai_writer.generate_answer("Describe your Python experience", pay)
        assert "LPA" not in model.call_args.args[1]


def test_eligibility_guard_runs_before_compensation(pay):
    answer = ai_writer.generate_answer("What is your current CTC and visa sponsorship status?", pay)
    assert answer.startswith("[Error]")
    assert "LPA" not in answer


def test_missing_compensation_returns_error():
    assert compensation_answer(QUESTION, {}).startswith("[Error]")


def test_profile_api_persists_all_components_and_match_generate_agree(client, pay):
    assert client.put("/api/profile", json=pay).status_code == 200
    saved = client.get("/api/profile").json()
    assert {key: saved[key] for key in pay} == pay
    assert client.put("/api/profile", json={"current_title": "Engineer"}).status_code == 200
    assert client.get("/api/profile").json()["current_fixed_ctc"] == "9 LPA"
    response = client.post("/api/generate-answer", json={"question": QUESTION})
    assert response.status_code == 200
    fields = [{"index": 0, "label": QUESTION, "type": "textarea"}]
    assert client.post("/api/match-fields", json=fields).json() == {"0": response.json()["answer"]}
    assert client.put("/api/profile", json={"current_fixed_ctc": []}).status_code == 422


def test_migration_preserves_totals_and_does_not_infer_split(tmp_path):
    path = tmp_path / "salary.db"
    url = f"sqlite:///{path}"
    migrate(url, "0004_education_records")
    engine = make_engine(path)
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO profiles (name, current_ctc, expected_ctc) VALUES (:name, :current, :expected)"),
                           {"name": "Synthetic Person", "current": "12 LPA", "expected": "18 LPA"})
    migrate(url)
    with engine.connect() as connection:
        row = connection.execute(text("SELECT name, current_ctc, expected_ctc, current_fixed_ctc, expected_variable_ctc FROM profiles")).one()
        assert tuple(row) == ("Synthetic Person", "12 LPA", "18 LPA", "", "")
    downgrade(url, "0004_education_records")
    with engine.connect() as connection:
        assert connection.execute(text("SELECT current_ctc, expected_ctc FROM profiles")).one() == ("12 LPA", "18 LPA")
    engine.dispose()
