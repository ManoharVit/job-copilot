"""AI prompt relevance, rejection of unrelated location answers, and safe failure.

Offline or rejected output must leave the candidate to provide factual details;
no static anecdote is substituted for their actual work history.
"""
import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import ai_writer
from server import app


@pytest.fixture
def candidate_profile():
    return {
        "name": "Alex Morgan Example",
        "current_title": "Python Developer",
        "years_experience": 2,
        "location": "Pune, Maharashtra, India",
        "skills": json.dumps([
            "Python", "SQL", "FastAPI", "SQLAlchemy", "Pydantic", "Celery",
            "PostgreSQL", "Redis", "Docker", "AWS", "pytest",
        ]),
        "cover_letter_template": (
            "Versatile Python Developer with an MS from Example Graduate University and "
            "experience building configurable fraud rule engines, transaction ingestion APIs "
            "with sub-100ms latency, and AI-powered advisory tools. Hands-on with FastAPI, "
            "PostgreSQL, Docker, AWS, and ML/AI tools. Maintained 87% test coverage across production systems."
        ),
        "education_level": "Master of Science in Data Analytics Engineering",
        "education_records": json.dumps([
            {
                "level": "master",
                "degree": "M.Sc",
                "specialization": "Data Analytics Engineering",
                "university": "Example Graduate University",
            },
            {
                "level": "bachelor",
                "degree": "B.Tech",
                "specialization": "Computer Science and Engineering",
                "university": "Example Institute of Technology",
            },
        ]),
    }


DOVER_Q1 = "Tell me about the last time an AI coding tool (Claude Code, Codex, Copilot, etc.) generated code you rejected or had to fix. How did you catch the problem? *"
DOVER_Q2 = "Tell me about a time you spotted a missing requirement or edge case BEFORE you started building. What was it, and what did you ask? *"
DOVER_Q3 = "Walk me through the hardest bug you have root-caused. What did the logs or evidence first tell you, what did you rule out, and how did you confirm the fix? *"
DOVER_Q4 = "Pick one feature you built across at least two layers of the stack (app, web, API, data, or infra): what was personally yours, what broke or nearly broke, and what did you change afterward? *"
DOVER_LOCATION_Q = "This role is full-time and in-person at our Jayanagar, Bengaluru office. Can you work from the office? * (o) Yes () No"


def test_fallback_answers_relevance(candidate_profile):
    """Unavailable AI must fail visibly instead of inventing personal anecdotes."""
    with patch.object(ai_writer, "AI_AVAILABLE", False):
        # Q1: AI code rejection
        ans1 = ai_writer.generate_answer(DOVER_Q1, candidate_profile)
        assert ans1.startswith("[Error]")
        assert "jayanagar" not in ans1.lower()
        assert "bengaluru" not in ans1.lower()
        assert "versatile python developer" not in ans1.lower()

        # Q2: Missing requirement / edge case
        ans2 = ai_writer.generate_answer(DOVER_Q2, candidate_profile)
        assert ans2.startswith("[Error]")
        assert "jayanagar" not in ans2.lower()
        assert "bengaluru" not in ans2.lower()

        # Q3: Hardest bug
        ans3 = ai_writer.generate_answer(DOVER_Q3, candidate_profile)
        assert ans3.startswith("[Error]")
        assert "jayanagar" not in ans3.lower()
        assert "bengaluru" not in ans3.lower()

        # Q4: Two layers of stack
        ans4 = ai_writer.generate_answer(DOVER_Q4, candidate_profile)
        assert ans4.startswith("[Error]")
        assert "jayanagar" not in ans4.lower()
        assert "bengaluru" not in ans4.lower()

        # Location question
        ans_loc = ai_writer.generate_answer(DOVER_LOCATION_Q, candidate_profile)
        assert ans_loc.startswith("[Error]")


def test_gemini_prompt_includes_profile_details(candidate_profile):
    """When calling Gemini, prompt must include profile engineering background and strict instructions."""
    captured_prompts = []

    def mock_call_gemini(system_instruction, prompt, temperature=0.8):
        captured_prompts.append((system_instruction, prompt))
        return "Grounded technical response."

    with patch.object(ai_writer, "AI_AVAILABLE", True), \
         patch.object(ai_writer, "_call_gemini", side_effect=mock_call_gemini):
        ai_writer.generate_answer(DOVER_Q1, candidate_profile)

    assert len(captured_prompts) == 1
    system_inst, prompt = captured_prompts[0]

    # Verify system instruction contains strict rules
    assert "DIRECTLY ANSWER the specific question asked" in system_inst
    assert "NEVER give a location, commute, or office-attendance answer" in system_inst
    assert "NEVER regurgitate a cover letter introduction" in system_inst

    # Verify prompt contains candidate details
    assert "Alex Morgan Example" in prompt
    assert "Python Developer" in prompt
    assert "FastAPI" in prompt
    assert "PostgreSQL" in prompt
    assert "fraud rule engines" in prompt
    assert DOVER_Q1 in prompt


def test_safety_check_intercepts_hallucinated_location(candidate_profile):
    """If Gemini returns a location answer for a technical bug question, the safety guard catches it."""
    # Test 1: Bengaluru/Jayanagar hallucination
    with patch.object(ai_writer, "AI_AVAILABLE", True), \
         patch.object(ai_writer, "_call_gemini", return_value="Yep, I live nearby in Bengaluru so commuting to Jayanagar daily isn't an issue at all."):
        ans = ai_writer.generate_answer(DOVER_Q3, candidate_profile)
    assert "jayanagar" not in ans.lower()
    assert "bengaluru" not in ans.lower()
    assert ans.startswith("[Error]")

    # Test 2: San Francisco / generic on-site hallucination without city name
    with patch.object(ai_writer, "AI_AVAILABLE", True), \
         patch.object(ai_writer, "_call_gemini", return_value="I am willing to relocate and work on-site full-time at your San Francisco office."):
        ans2 = ai_writer.generate_answer(DOVER_Q1, candidate_profile)
    assert "san francisco" not in ans2.lower()
    assert "on-site" not in ans2.lower()
    assert ans2.startswith("[Error]")

    # Test 3: Generic commute/relocation statement without any tech
    with patch.object(ai_writer, "AI_AVAILABLE", True), \
         patch.object(ai_writer, "_call_gemini", return_value="Yes, commuting to the office is no problem and I can start in-person immediately."):
        ans3 = ai_writer.generate_answer(DOVER_Q4, candidate_profile)
    assert "in-person" not in ans3.lower()
    assert ans3.startswith("[Error]")


def test_legitimate_tech_answer_not_intercepted(candidate_profile):
    """A real technical answer that happens to mention working from an office is preserved."""
    legit_tech_answer = "While working from our team office, I resolved an asynchronous connection pool leak in our FastAPI transaction service by isolating session lifecycles."
    with patch.object(ai_writer, "AI_AVAILABLE", True), \
         patch.object(ai_writer, "_call_gemini", return_value=legit_tech_answer):
        ans = ai_writer.generate_answer(DOVER_Q3, candidate_profile)
    assert ans == legit_tech_answer


def test_api_generate_answer_endpoint(client, candidate_profile):
    """The /api/generate-answer HTTP endpoint generates relevant answers."""
    # Test error on missing question
    resp = client.post("/api/generate-answer", json={"question": ""})
    assert resp.status_code == 400

    # Test success on technical question
    with patch.object(ai_writer, "AI_AVAILABLE", True), patch.object(
        ai_writer, "_call_gemini", return_value="I tested the request boundaries and fixed a reproducible bug."
    ):
        resp = client.post("/api/generate-answer", json={"question": DOVER_Q1})
    assert resp.status_code == 200
    data = resp.json()
    assert "answer" in data
    assert len(data["answer"]) > 20
    assert "jayanagar" not in data["answer"].lower()
    assert "bengaluru" not in data["answer"].lower()
