"""The original dashboard and extension must keep working unchanged."""
import csv
import io

V1 = "/api/v1/applications"
LEGACY_KEYS = {"id", "url", "title", "company", "platform", "status", "applied_at", "notes"}


def v1_create(client, **overrides):
    payload = {"title": "Engineer", "company": "Acme", **overrides}
    return client.post(V1, json=payload).json()


def test_log_application_creates_draft_and_dedupes(client):
    payload = {"url": "https://jobs.example.com/42", "title": "SWE - Acme", "company": "Acme",
               "platform": "greenhouse", "job_description": "Python", "timestamp": "ignored"}
    first = client.post("/api/log-application", json=payload)
    assert first.status_code == 200 and first.json()["status"] == "success"
    second = client.post("/api/log-application", json=payload).json()
    assert second["id"] == first.json()["id"]
    detail = client.get(f"{V1}/{second['id']}").json()
    assert detail["status"] == "draft"
    assert client.get(f"{V1}/{second['id']}/history").json()[0]["source"] == "extension"


def test_legacy_list_shape_and_status_mapping(client):
    v1_create(client, status="screening")
    v1_create(client, status="interviewing")
    rows = client.get("/api/applications", params={"limit": 10}).json()
    assert isinstance(rows, list)
    assert all(set(r) == LEGACY_KEYS for r in rows)
    assert sorted(r["status"] for r in rows) == ["applied", "interview"]


def test_legacy_list_limit_is_capped(client):
    assert client.get("/api/applications", params={"limit": 10**9}).status_code == 200


def test_legacy_put_status_goes_through_lifecycle(client):
    app = v1_create(client, status="submitted")
    response = client.put(f"/api/applications/{app['id']}", json={"status": "interview"})
    assert response.json() == {"status": "success"}
    assert client.get(f"{V1}/{app['id']}").json()["status"] == "interviewing"
    assert client.get(f"{V1}/{app['id']}/history").json()[-1]["source"] == "legacy_api"


def test_legacy_put_same_bucket_is_noop(client):
    app = v1_create(client, status="screening")  # legacy bucket "applied"
    assert client.put(f"/api/applications/{app['id']}", json={"status": "applied"}).status_code == 200
    assert client.get(f"{V1}/{app['id']}").json()["status"] == "screening"


def test_legacy_put_invalid_transition_keeps_legacy_error_shape(client):
    app = v1_create(client, status="rejected")
    response = client.put(f"/api/applications/{app['id']}", json={"status": "interview"})
    assert response.status_code == 409
    assert set(response.json()) == {"detail"}


def test_legacy_put_unknown_status_400(client):
    app = v1_create(client)
    response = client.put(f"/api/applications/{app['id']}", json={"status": "ghosted"})
    assert response.status_code == 400 and set(response.json()) == {"detail"}


def test_legacy_put_notes_and_empty_body(client):
    app = v1_create(client)
    assert client.put(f"/api/applications/{app['id']}", json={"notes": "hello"}).status_code == 200
    assert client.get(f"{V1}/{app['id']}").json()["notes"] == "hello"
    assert client.put(f"/api/applications/{app['id']}", json={}).status_code == 400


def test_legacy_put_and_delete_missing_404(client):
    assert client.put("/api/applications/999999", json={"notes": "x"}).status_code == 404
    response = client.delete("/api/applications/999999")
    assert response.status_code == 404 and set(response.json()) == {"detail"}


def test_legacy_delete(client):
    app = v1_create(client)
    assert client.delete(f"/api/applications/{app['id']}").json() == {"status": "success"}
    assert client.get(f"{V1}/{app['id']}").status_code == 404


def test_legacy_stats_keys_used_by_dashboard(client):
    v1_create(client, status="interviewing", platform="linkedin")
    v1_create(client, status="offer", platform="linkedin")
    v1_create(client, status="withdrawn", platform="other")
    stats = client.get("/api/stats").json()
    assert set(stats) == {"today", "total", "by_platform", "by_status"}
    assert stats["total"] == 3
    assert stats["by_status"] == {"interview": 1, "offer": 1, "rejected": 1}
    assert stats["by_platform"] == {"linkedin": 2, "other": 1}


def test_legacy_endpoints_are_owner_scoped(client, acting_as, users):
    app = v1_create(client)
    acting_as.user = users["bob"]
    assert client.get("/api/applications").json() == []
    assert client.get("/api/stats").json()["total"] == 0
    assert client.put(f"/api/applications/{app['id']}", json={"notes": "x"}).status_code == 404
    assert client.delete(f"/api/applications/{app['id']}").status_code == 404


def test_csv_export_header_and_formula_injection_guard(client):
    v1_create(client, title="=HYPERLINK(\"https://evil.example\")", company="@Acme", notes="+1 call")
    response = client.get("/api/export")
    assert response.headers["content-type"].startswith("text/csv")
    rows = list(csv.reader(io.StringIO(response.text)))
    assert rows[0] == ["ID", "URL", "Title", "Company", "Platform", "Status", "Applied At", "Notes", "Job Description"]
    assert rows[1][2].startswith("'=") and rows[1][3] == "'@Acme" and rows[1][7] == "'+1 call"
