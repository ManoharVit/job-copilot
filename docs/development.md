# Development Guide

## Frontend Build & Asset Routing

The frontend is a React application built with Vite, outputting to `backend/static_staging` (and subsequently deployed to `backend/static`).

### Asset Path Configuration

In `frontend/vite.config.js`, it is strictly required to set `base: '/static/'`.

**Why is this required?**
By default, Vite generates asset paths starting at the domain root (e.g., `src="/assets/index-xyz.js"`). However, the FastAPI backend mounts the `static` directory at the `/static` route:
```python
app.mount("/static", StaticFiles(directory=static_dir), name="static")
```
When `index.html` is served by FastAPI (at `/`), the browser will attempt to fetch assets. If the paths were `/assets/...`, FastAPI would return `404 Not Found`. By setting `base: '/static/'`, Vite prepends `/static` to all asset paths in `index.html` (e.g., `src="/static/assets/index-xyz.js"`), which correctly routes the request to FastAPI's mounted static directory.

**What to check if assets break in the future:**
1. **`vite.config.js`:** Ensure the `base` property is accurately set to `/static/`.
2. **`server.py`:** Ensure the `app.mount` path for the static directory remains `/static`.
3. **Deploy Script (`deploy.sh`):** Be aware that any script validation parsing `index.html` must account for the `/static/assets/` path structure. If deployment scripts strictly regex-match `="/assets/"`, they will erroneously fail the asset validation.

## CORS Configuration

Job Copilot handles personal user data locally. To protect against malicious websites accessing this local API, the server enforces an explicit CORS allowlist. **Never use `allow_origins=["*"]` for this project.**

### Configuring Development Origins

By default, the server permits requests from standard local development ports (`http://127.0.0.1:8000`, `http://localhost:5173`, etc.). If you are running the Vite frontend on a different port, set the `CORS_ORIGINS` environment variable in your `.env` file with a comma-separated list of allowed origins.

### Configuring the Chrome Extension

When testing the Chrome extension locally as an unpacked extension, Chrome assigns it a random extension ID. To allow the extension to communicate with the local backend:

1. Go to `chrome://extensions` in your browser.
2. Find the "Job Copilot" extension and copy its ID.
3. Add `CORS_EXTENSION_ORIGIN=chrome-extension://YOUR_EXTENSION_ID` to your `.env` file (replace with your actual ID).
4. Restart the backend server.
