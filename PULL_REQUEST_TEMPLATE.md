## Description
<!-- Provide a clear and concise summary of the changes introduced in this pull request and the motivation behind them. -->

Closes #<!-- Issue number, e.g. Closes #123 -->

## Type of Change
<!-- Please mark the applicable option with an [x]: -->
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that causes existing functionality to change)
- [ ] Refactoring / Code cleanup
- [ ] Documentation update
- [ ] CI / Build tooling / Repository metadata

## Affected Components
<!-- Select which component(s) are modified: -->
- [ ] Backend API / Services (`backend/server.py`, `backend/app_tracker/`)
- [ ] Database Models & Migrations (`backend/models.py`, `backend/migrations/`)
- [ ] AI Integration (`backend/ai_writer.py`)
- [ ] Frontend Application (`frontend/`)
- [ ] Browser Extension (`extension/`)
- [ ] Documentation & Configuration (`docs/`, `.github/`, config files)

## Testing Performed
<!-- Describe the testing executed to verify these changes: -->
- [ ] Ran backend test suite: `PYTHONPATH=backend python -m pytest backend/tests/ -v`
- [ ] Ran backend linter: `ruff check backend/`
- [ ] Verified local server execution on `http://127.0.0.1:8000` (`./start.sh`)
- [ ] Frontend changes: Verified `base: '/static/'` in `frontend/vite.config.js` and confirmed `/static/assets/` routing (per `GEMINI.md` and `docs/development.md`)
- [ ] Added new unit/integration tests for introduced functionality or bug fixes

## Contributor Checklist
<!-- Ensure all items below are reviewed and checked before submitting: -->
- [ ] My code adheres to the project's architecture and coding conventions.
- [ ] I have performed a self-review of my own code.
- [ ] I have commented complex or non-obvious logic where appropriate.
- [ ] I have updated corresponding documentation (`README.md`, `docs/`, etc.) if needed.
- [ ] My changes generate no new warnings or unhandled exceptions.
- [ ] **Security & Privacy Audit (per `SECURITY.md`)**:
  - [ ] No secrets, API keys (e.g. `GEMINI_API_KEY`), or `.env` files are committed.
  - [ ] No local database files (`data/copilot.db` or `*.db`) or personal user data committed.
  - [ ] Network listeners remain bound to loopback `127.0.0.1` and are NOT exposed to `0.0.0.0` or public interfaces.
