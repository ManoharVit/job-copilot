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
