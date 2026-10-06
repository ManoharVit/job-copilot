import importlib
import pytest
from fastapi.testclient import TestClient

def test_cors_frontend_origin(client: TestClient):
    response = client.options(
        "/api/match-fields",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type"
        }
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "POST" in response.headers.get("access-control-allow-methods", "")

def test_cors_untrusted_origin(client: TestClient):
    response = client.options(
        "/api/match-fields",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type"
        }
    )
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers

def test_cors_configured_extension_origin(monkeypatch):
    monkeypatch.setenv("CORS_EXTENSION_ORIGIN", "chrome-extension://test-id ")
    import settings
    settings.get_settings.cache_clear()
    import server
    importlib.reload(server)
    
    test_client = TestClient(server.app)
    response = test_client.options(
        "/api/match-fields",
        headers={
            "Origin": "chrome-extension://test-id",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type"
        }
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "chrome-extension://test-id"
    
    # Restore the server module for subsequent tests just in case
    monkeypatch.delenv("CORS_EXTENSION_ORIGIN", raising=False)
    settings.get_settings.cache_clear()
    importlib.reload(server)
