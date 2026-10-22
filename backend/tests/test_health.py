def test_health_identifies_service_without_candidate_data(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"service": "job-copilot", "status": "ok"}


def test_health_keeps_origin_boundary(client):
    response = client.get("/api/health", headers={"Origin": "https://untrusted.example"})
    assert response.status_code == 403
