"""OpenAPI documentation must be complete and its examples must actually work.

Examples are executed against the API (isolated test DB, no AI calls) so a stale or
wrong example fails CI instead of misleading readers of /docs or docs/api.md.
"""
import pytest

AI_PATHS = {
    "/api/generate-cover-letter",
    "/api/generate-answer",
    "/api/tailor-resume",
    "/api/humanize",
    "/api/interview-prep",
}


@pytest.fixture()
def spec(client):
    response = client.get("/openapi.json")
    assert response.status_code == 200
    return response.json()


def _operations(spec):
    for path, methods in spec["paths"].items():
        for method, op in methods.items():
            yield path, method, op


def _body_examples(spec, op) -> list:
    """Examples from openapi_examples on the body, or from the referenced schema."""
    content = op.get("requestBody", {}).get("content", {}).get("application/json", {})
    if content.get("examples"):
        return [e["value"] for e in content["examples"].values()]
    ref = content.get("schema", {}).get("$ref", "")
    if ref:
        schema = spec["components"]["schemas"][ref.rsplit("/", 1)[-1]]
        return list(schema.get("examples", []))
    return []


def test_every_operation_has_summary_and_tag(spec):
    missing = [f"{m.upper()} {p}" for p, m, op in _operations(spec) if not op.get("summary") or not op.get("tags")]
    assert missing == []


def test_every_request_body_has_an_example(spec):
    missing = [
        f"{m.upper()} {p}"
        for p, m, op in _operations(spec)
        if "requestBody" in op and not _body_examples(spec, op)
    ]
    assert missing == []


def test_dashboard_route_is_not_in_schema(spec):
    assert "/" not in spec["paths"]


def _examples_for(spec, path, method):
    return _body_examples(spec, spec["paths"][path][method])


def test_match_fields_example_produces_matches(client, spec):
    client.put("/api/profile", json={"name": "Alex Example", "email": "alex@example.com"})
    (example,) = _examples_for(spec, "/api/match-fields", "post")
    result = client.post("/api/match-fields", json=example)
    assert result.status_code == 200
    # Every example field carries an index and is recognisable -> both are filled.
    assert result.json() == {"0": "Alex", "1": "alex@example.com"}


def test_log_application_example_works(client, spec):
    (example,) = _examples_for(spec, "/api/log-application", "post")
    response = client.post("/api/log-application", json=example)
    assert response.status_code == 200 and response.json()["status"] == "success"


def test_profile_example_works(client, spec):
    (example,) = _examples_for(spec, "/api/profile", "put")
    assert client.put("/api/profile", json=example).status_code == 200
    profile = client.get("/api/profile").json()
    assert all(profile[k] == v for k, v in example.items())


def test_legacy_update_examples_work(client, spec):
    created = client.post("/api/v1/applications", json={"title": "SWE", "company": "Acme", "status": "submitted"})
    app_id = created.json()["id"]
    for example in _examples_for(spec, "/api/applications/{app_id}", "put"):
        response = client.put(f"/api/applications/{app_id}", json=example)
        assert response.status_code == 200, (example, response.json())


def test_v1_create_and_update_examples_work(client, spec):
    (create,) = _examples_for(spec, "/api/v1/applications", "post")
    created = client.post("/api/v1/applications", json=create)
    assert created.status_code == 201, created.json()
    app_id = created.json()["id"]
    # The status example expects the application to be in `screening` first.
    assert client.patch(f"/api/v1/applications/{app_id}", json={"status": "screening"}).status_code == 200
    for example in _examples_for(spec, "/api/v1/applications/{application_id}", "patch"):
        response = client.patch(f"/api/v1/applications/{app_id}", json=example)
        assert response.status_code == 200, (example, response.json())


@pytest.mark.parametrize(
    ("fmt", "content_type"),
    [
        ("pdf", "application/pdf"),
        ("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        ("tex", "application/x-tex"),
    ],
)
def test_export_doc_examples_work(client, spec, fmt, content_type):
    examples = {e["format"]: e for e in _examples_for(spec, "/api/export-doc", "post")}
    response = client.post("/api/export-doc", json=examples[fmt])
    assert response.status_code == 200
    assert response.headers["content-type"].startswith(content_type)
    assert len(response.content) > 0


def test_ai_examples_satisfy_required_fields(spec):
    # Not executed (would call a paid API when a key is configured); check the
    # examples contain the fields each handler rejects with 400 when missing.
    required = {
        "/api/generate-cover-letter": {"job_description"},
        "/api/generate-answer": {"question"},
        "/api/tailor-resume": {"bullets", "job_description"},
        "/api/humanize": {"text"},
        "/api/interview-prep": {"job_description"},
    }
    assert set(required) == AI_PATHS
    for path, fields in required.items():
        for example in _examples_for(spec, path, "post"):
            assert fields <= {k for k, v in example.items() if v}, path
