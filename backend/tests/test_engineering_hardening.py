"""Negative-path contracts: no paid calls, candidate data or real browser writes."""
import asyncio
from pathlib import Path
from threading import BoundedSemaphore
from unittest.mock import MagicMock, patch

import pytest
import ai_writer
from security import LocalAPIMiddleware
from scripts.check_dashboard import DashboardInvalid, validate_dashboard


@pytest.mark.parametrize("path,payload", [
    ("generate-cover-letter", {"job_description": ["wrong type"]}),
    ("generate-answer", {"question": "Why this role?", "job_description": {"private": "SECRET_INPUT"}}),
    ("tailor-resume", {"bullets": "not a list", "job_description": "Role"}),
    ("tailor-resume", {"bullets": [42], "job_description": "Role"}),
    ("humanize", {"text": ["SECRET_INPUT"]}),
    ("interview-prep", {"job_description": 123}),
    ("export-doc", {"text": {"private": "SECRET_INPUT"}}),
    ("export-doc", {"text": "hello", "format": "html"}),
    ("generate-answer", {"question": "Why?", "unexpected": "SECRET_INPUT"}),
])
def test_invalid_writer_inputs_reject_without_echoing_private_values(client, path, payload):
    response = client.post("/api/" + path, json=payload)
    assert response.status_code == 422
    assert "SECRET_INPUT" not in response.text
    assert "input" not in response.json()["detail"][0]


@pytest.mark.parametrize("path,payload", [
    ("generate-answer", {"question": "x" * 5001}),
    ("humanize", {"text": "x" * 100001}),
    ("tailor-resume", {"job_description": "Role", "bullets": ["bullet"] * 101}),
])
def test_writer_length_limits(client, path, payload):
    assert client.post("/api/" + path, json=payload).status_code == 422


@pytest.mark.parametrize("path,payload", [
    ("generate-cover-letter", {"job_description": "Role"}),
    ("generate-answer", {"question": "Why this role?"}),
    ("tailor-resume", {"bullets": ["Built tests"], "job_description": "Role"}),
    ("humanize", {"text": "Original draft"}),
    ("interview-prep", {"job_description": "Role"}),
])
def test_unavailable_ai_is_http_failure_not_fallback_success(client, path, payload):
    with patch.object(ai_writer, "AI_AVAILABLE", False):
        response = client.post("/api/" + path, json=payload)
    assert response.status_code == 503
    assert "draft was not changed" in response.json()["detail"]


def test_provider_exception_is_not_exposed(client):
    with patch.object(ai_writer, "AI_AVAILABLE", True), patch.object(
        ai_writer, "_call_gemini", side_effect=RuntimeError("SECRET_PROVIDER_CONTEXT")
    ):
        response = client.post("/api/interview-prep", json={"job_description": "Role"})
    assert response.status_code == 503
    assert "SECRET_PROVIDER_CONTEXT" not in response.text


def test_generation_client_has_explicit_timeout_and_bounded_sdk_attempts():
    with patch.object(ai_writer.genai, "Client") as constructor:
        ai_writer._build_client("synthetic-key")
    options = constructor.call_args.kwargs["http_options"]
    assert options.timeout == 10_000
    assert options.retry_options.attempts == 2


def test_application_does_not_retry_or_switch_models_on_provider_error(monkeypatch):
    sdk = MagicMock()
    sdk.models.generate_content.side_effect = RuntimeError("failure")
    monkeypatch.setattr(ai_writer, "client", sdk)
    monkeypatch.setattr(ai_writer, "AI_AVAILABLE", True)
    monkeypatch.setattr(ai_writer, "_generation_slots", BoundedSemaphore(2))
    for _ in range(3):
        with pytest.raises(RuntimeError):
            ai_writer._call_gemini("instruction", "fixture")
    assert sdk.models.generate_content.call_count == 3
    assert all(call.kwargs["model"] == ai_writer.MODEL for call in sdk.models.generate_content.call_args_list)


def test_generation_concurrency_rejects_busy_call_without_contacting_provider(monkeypatch):
    slots = BoundedSemaphore(2)
    slots.acquire()
    slots.acquire()
    sdk = MagicMock()
    monkeypatch.setattr(ai_writer, "client", sdk)
    monkeypatch.setattr(ai_writer, "AI_AVAILABLE", True)
    monkeypatch.setattr(ai_writer, "_generation_slots", slots)
    with pytest.raises(RuntimeError, match="busy"):
        ai_writer._call_gemini("instruction", "fixture")
    sdk.models.generate_content.assert_not_called()


def test_oversized_api_body_is_rejected_even_without_content_length(client):
    response = client.post("/api/profile", content=iter([b'{"name":"', b"x" * (512 * 1024), b'"}']),
                           headers={"Content-Type": "application/json"})
    assert response.status_code == 413


def test_streaming_body_limit_counts_chunks_and_never_calls_application():
    async def exercise():
        called = False
        async def app(scope, receive, send):
            nonlocal called
            called = True
        chunks = iter([{"type": "http.request", "body": b"123", "more_body": True},
                       {"type": "http.request", "body": b"456", "more_body": False}])
        async def receive():
            return next(chunks)
        sent = []
        async def send(message):
            sent.append(message)
        await LocalAPIMiddleware(app, max_body_bytes=5)(
            {"type": "http", "path": "/api/profile", "method": "PUT", "headers": []}, receive, send)
        assert not called
        assert sent[0]["status"] == 413
    asyncio.run(exercise())


@pytest.mark.parametrize("path", ["/api/profile", "/api/stats", "/api/health", "/api/resume"])
def test_private_api_responses_cannot_be_cached(client, path):
    response = client.get(path)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_export_filename_cannot_inject_headers(client):
    response = client.post("/api/export-doc", json={"text": "Fixture", "doc_type": 'x"\r\nX-Injected: yes', "format": "tex"})
    assert response.status_code == 200
    header = response.headers["content-disposition"]
    assert "\r" not in header and "\n" not in header
    assert "x-injected" not in response.headers


def test_latex_export_treats_commands_and_all_metacharacters_as_plain_text(client):
    response = client.post("/api/export-doc", json={"text": r"\input{/private/secret} & 50% $x_y# ^ ~", "format": "tex"})
    assert response.status_code == 200
    assert r"\input{" not in response.text
    for escaped in [r"\textbackslash{}input\{", r"\&", r"\%", r"\$", r"\_", r"\#", r"\textasciicircum{}", r"\textasciitilde{}"]:
        assert escaped in response.text


def _dashboard(tmp_path: Path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets/app.js").write_text("fixture")
    (tmp_path / "assets/app.css").write_text("fixture")
    (tmp_path / "index.html").write_text('<div id="root"></div><script src="/static/assets/app.js"></script><link rel="stylesheet" href="/static/assets/app.css">')
    return tmp_path


def test_dashboard_check_accepts_complete_bundle(tmp_path):
    validate_dashboard(_dashboard(tmp_path))


@pytest.mark.parametrize("missing", ["index.html", "assets/app.js", "assets/app.css"])
def test_dashboard_check_rejects_missing_referenced_files_even_with_assets_directory(tmp_path, missing):
    directory = _dashboard(tmp_path)
    (directory / missing).unlink()
    with pytest.raises(DashboardInvalid):
        validate_dashboard(directory)


def test_dashboard_check_rejects_empty_and_outside_assets(tmp_path):
    directory = _dashboard(tmp_path)
    (directory / "assets/app.js").write_text("")
    with pytest.raises(DashboardInvalid):
        validate_dashboard(directory)
    (directory / "index.html").write_text('<div id="root"></div><script src="/static/assets/../../secret.js"></script>')
    with pytest.raises(DashboardInvalid):
        validate_dashboard(directory)


def test_repository_guard_rejects_private_filenames_without_reading_them(tmp_path):
    from scripts.check_repository import check_files
    problems = check_files(tmp_path, [".env", "data/resume.json", "archive.sqlite3"])
    assert len(problems) == 3


def test_repository_guard_reports_only_path_for_credential_match(tmp_path):
    from scripts.check_repository import check_files
    secret = "AIza" + "A" * 35
    (tmp_path / "config.py").write_text("key = " + repr(secret))
    problems = check_files(tmp_path, ["config.py"])
    assert len(problems) == 1 and "config.py" in problems[0]
    assert secret not in problems[0]


def test_repository_guard_allows_environment_example(tmp_path):
    from scripts.check_repository import check_files
    (tmp_path / ".env.example").write_text("GEMINI_API_KEY=your-key-here")
    assert check_files(tmp_path, [".env.example"]) == []


def test_oversized_v1_body_keeps_the_versioned_error_contract(client):
    response = client.post("/api/v1/applications", content=b"x" * (512 * 1024 + 1),
                           headers={"Content-Type": "application/json"})
    assert response.status_code == 413
    error = response.json()["error"]
    assert error["code"] == "payload_too_large"
    assert error["request_id"] == response.headers["x-request-id"]
