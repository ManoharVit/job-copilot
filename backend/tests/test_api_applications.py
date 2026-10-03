import pytest

BASE = "/api/v1/applications"


def create(client, **overrides):
    payload = {"title": "Backend Engineer", "company": "Example Corp", **overrides}
    response = client.post(BASE, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def assert_error(response, status_code, code):
    assert response.status_code == status_code, response.text
    body = response.json()
    assert body["error"]["code"] == code
    assert body["error"]["request_id"] == response.headers["X-Request-ID"]
    return body["error"]


# --- create -------------------------------------------------------------------

def test_create_returns_201_detail_and_location(client):
    response = client.post(BASE, json={"title": " Data Engineer ", "company": "Acme", "url": "https://acme.example/jobs/9"})
    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "Data Engineer"  # whitespace trimmed
    assert body["status"] == "draft"
    assert body["allowed_next_statuses"] == ["submitted", "withdrawn", "archived"]
    assert body["applied_at"].endswith("Z") or body["applied_at"].endswith("+00:00")
    assert response.headers["Location"] == f"{BASE}/{body['id']}"
    assert response.headers["X-Request-ID"]


@pytest.mark.parametrize(
    "payload",
    [
        {"company": "Acme"},                                              # missing title
        {"title": "", "company": "Acme"},                                 # empty title
        {"title": "X", "company": "Acme", "url": "javascript:alert(1)"},  # unsafe scheme
        {"title": "X", "company": "Acme", "url": "/relative/path"},       # not absolute
        {"title": "X", "company": "Acme", "notes": "n" * 10_001},         # too long
        {"title": "X", "company": "Acme", "status": "ghosted"},           # unknown status
        {"title": "X", "company": "Acme", "owner_id": 999},               # unknown field
        {"title": "X", "company": "Acme", "applied_at": "2999-01-01T00:00:00Z"},  # future
    ],
)
def test_create_validation_errors_use_envelope_without_echoing_input(client, payload):
    error = assert_error(client.post(BASE, json=payload), 422, "validation_error")
    assert all(set(item) == {"loc", "msg", "type"} for item in error["details"])
    assert "alert(1)" not in str(error)


# --- read / list ----------------------------------------------------------------

def test_get_detail_includes_job_description(client):
    created = create(client, job_description="Python, FastAPI")
    body = client.get(f"{BASE}/{created['id']}").json()
    assert body["job_description"] == "Python, FastAPI"


def test_list_paginates_and_omits_job_description(client):
    for i in range(25):
        create(client, title=f"Role {i:02d}", applied_at=f"2026-09-01T00:{i:02d}:00Z")
    page1 = client.get(BASE).json()
    assert (page1["total"], page1["page"], page1["page_size"], len(page1["items"])) == (25, 1, 20, 20)
    assert page1["items"][0]["title"] == "Role 24"  # newest first
    assert "job_description" not in page1["items"][0]
    page2 = client.get(BASE, params={"page": 2}).json()
    assert len(page2["items"]) == 5 and page2["items"][-1]["title"] == "Role 00"


@pytest.mark.parametrize("params", [{"page_size": 101}, {"page_size": 0}, {"page": 0}, {"status": "ghosted"}])
def test_list_rejects_bad_query_params(client, params):
    assert_error(client.get(BASE, params=params), 422, "validation_error")


def test_list_filters_by_multiple_statuses(client):
    create(client, title="A", status="screening")
    create(client, title="B", status="interviewing")
    create(client, title="C", status="submitted")
    body = client.get(f"{BASE}?status=screening&status=interviewing").json()
    assert body["total"] == 2 and {i["title"] for i in body["items"]} == {"A", "B"}


def test_status_transitions_endpoint(client):
    body = client.get(f"{BASE}/status-transitions").json()
    assert body["transitions"]["rejected"] == ["archived"]
    assert body["terminal_statuses"] == ["archived"]


# --- update / transitions ---------------------------------------------------------

def test_patch_fields_only(client):
    created = create(client)
    body = client.patch(f"{BASE}/{created['id']}", json={"notes": "Followed up"}).json()
    assert body["notes"] == "Followed up" and body["status"] == "draft"


def test_patch_valid_transition_records_history(client):
    created = create(client, status="submitted")
    response = client.patch(
        f"{BASE}/{created['id']}",
        json={"status": "screening", "expected_status": "submitted", "transition_note": "Recruiter call"},
    )
    assert response.status_code == 200 and response.json()["status"] == "screening"
    history = client.get(f"{BASE}/{created['id']}/history").json()
    assert [(h["from_status"], h["to_status"], h["source"]) for h in history] == [
        (None, "submitted", "api"), ("submitted", "screening", "api")
    ]
    assert history[1]["note"] == "Recruiter call"


def test_patch_same_status_is_idempotent(client):
    created = create(client, status="submitted")
    for _ in range(3):
        assert client.patch(f"{BASE}/{created['id']}", json={"status": "submitted"}).status_code == 200
    assert len(client.get(f"{BASE}/{created['id']}/history").json()) == 1


def test_patch_invalid_transition_409(client):
    created = create(client, status="rejected")
    error = assert_error(client.patch(f"{BASE}/{created['id']}", json={"status": "offer"}), 409, "invalid_status_transition")
    assert error["details"] == {"current_status": "rejected", "requested_status": "offer", "allowed_next_statuses": ["archived"]}


def test_patch_archived_is_terminal(client):
    created = create(client, status="archived")
    assert_error(client.patch(f"{BASE}/{created['id']}", json={"status": "submitted"}), 409, "invalid_status_transition")


def test_patch_expected_status_conflict_409(client):
    created = create(client, status="screening")
    assert_error(
        client.patch(f"{BASE}/{created['id']}", json={"status": "interviewing", "expected_status": "submitted"}),
        409, "status_conflict",
    )


@pytest.mark.parametrize(
    "payload",
    [{}, {"title": None}, {"transition_note": "x"}, {"expected_status": "draft"}, {"status": "nope"}, {"id": 5}],
)
def test_patch_validation(client, payload):
    created = create(client)
    assert_error(client.patch(f"{BASE}/{created['id']}", json=payload), 422, "validation_error")


# --- ownership ------------------------------------------------------------------

def test_other_users_records_are_invisible(client, acting_as, users):
    created = create(client)
    acting_as.user = users["bob"]
    assert client.get(BASE).json()["total"] == 0
    for method, path, kwargs in [
        ("get", f"{BASE}/{created['id']}", {}),
        ("patch", f"{BASE}/{created['id']}", {"json": {"notes": "x"}}),
        ("get", f"{BASE}/{created['id']}/history", {}),
        ("delete", f"{BASE}/{created['id']}", {}),
    ]:
        assert_error(getattr(client, method)(path, **kwargs), 404, "application_not_found")
    acting_as.user = users["alice"]
    assert client.get(f"{BASE}/{created['id']}").json()["notes"] == ""


def test_missing_record_404_looks_identical(client):
    assert_error(client.get(f"{BASE}/999999"), 404, "application_not_found")


# --- delete ---------------------------------------------------------------------

def test_delete_204_then_404(client):
    created = create(client)
    response = client.delete(f"{BASE}/{created['id']}")
    assert response.status_code == 204 and response.content == b""
    assert_error(client.get(f"{BASE}/{created['id']}"), 404, "application_not_found")


# --- request IDs ----------------------------------------------------------------

def test_valid_inbound_request_id_is_echoed(client):
    response = client.get(BASE, headers={"X-Request-ID": "trace-abc_123"})
    assert response.headers["X-Request-ID"] == "trace-abc_123"


def test_malformed_inbound_request_id_is_replaced(client):
    response = client.get(BASE, headers={"X-Request-ID": "bad id with spaces <script>"})
    assert response.headers["X-Request-ID"] != "bad id with spaces <script>"
    assert len(response.headers["X-Request-ID"]) == 32


def test_openapi_documents_examples(client):
    spec = client.get("/openapi.json").json()
    assert "/api/v1/applications/{application_id}" in spec["paths"]
    create_schema = spec["components"]["schemas"]["ApplicationCreate"]
    assert create_schema.get("examples")
