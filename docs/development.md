# Development Guide

## Frontend Build & Asset Routing

The frontend is a React application built with Vite, outputting directly to `backend/static` (with `legacy.html` preserved as fallback).

### Asset Path Configuration

In `frontend/vite.config.js`, it is strictly required to set `base: '/static/'` and `outDir: '../backend/static'`.

**Why is this required?**
By default, Vite generates asset paths starting at the domain root (e.g., `src="/assets/index-xyz.js"`). However, the FastAPI backend mounts the `static` directory at the `/static` route:
```python
app.mount("/static", StaticFiles(directory=static_dir), name="static")
```
When `index.html` is served by FastAPI (at `/`), the browser will attempt to fetch assets. If the paths were `/assets/...`, FastAPI would return `404 Not Found`. By setting `base: '/static/'`, Vite prepends `/static` to all asset paths in `index.html` (e.g., `src="/static/assets/index-xyz.js"`), which correctly routes the request to FastAPI's mounted static directory.

The legacy vanilla dashboard is preserved at `backend/static/legacy.html` and served at `GET /legacy`.

**What to check if assets break in the future:**
1. **`vite.config.js`:** Ensure the `base` property is accurately set to `/static/` and `outDir` is `../backend/static`.
2. **`server.py`:** Ensure the `app.mount` path for the static directory remains `/static`.
3. **Legacy Fallback:** If needed for comparisons or testing, the legacy dashboard is always accessible at `http://127.0.0.1:8765/legacy`.

## CORS Configuration

Job Copilot handles personal user data locally. To protect against malicious websites accessing this local API, the server enforces an explicit CORS allowlist. **Never use `allow_origins=["*"]` for this project.**

### Configuring Development Origins

By default, the server permits requests from standard local development ports (`http://127.0.0.1:8765`, `http://localhost:5173`, etc.). If you are running the Vite frontend on a different port, set the `CORS_ORIGINS` environment variable in your `.env` file with a comma-separated list of allowed origins.

### Configuring the Chrome Extension

When testing the Chrome extension locally as an unpacked extension, Chrome assigns it a random extension ID. To allow the extension to communicate with the local backend:

1. Go to `chrome://extensions` in your browser.
2. Find the "Job Copilot" extension and copy its ID.
3. Add `CORS_EXTENSION_ORIGIN=chrome-extension://YOUR_EXTENSION_ID` to your `.env` file (replace with your actual ID).
4. Restart the backend server.

### Dedicated local address

Job Copilot uses `http://127.0.0.1:8765` to avoid the common development port 8000.
`./start.sh` reuses an already healthy Job Copilot instance; if another process
occupies port 8765, it exits with an explanation and leaves that process alone.
After updating, reload Job Copilot in `chrome://extensions`, reload application
pages, and click **Connect local backend** in its popup to grant the new port.
Existing profile and resume files stay in place.

## Release guardrails

Follow [engineering.md](engineering.md) for specifications, trust boundaries and
CI checks. AI endpoints now return 422 for malformed/oversized fields and 503
when generation is unavailable. They do not substitute original text as generated
output. `./deploy.sh` builds/validates the current served assets; `--dry-run`
validates only. No static_staging directory or manifest handoff is required.
