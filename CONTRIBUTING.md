# Contributing to Job Copilot

Thank you for your interest in contributing to Job Copilot! This guide provides everything you need to know about setting up your development environment, adhering to project conventions, running tests and linters, and submitting pull requests.

---

## 1. Security & Privacy Model

Job Copilot is an AI-assisted career platform currently in **active development** designed specifically for **local-first, single-user operation**. Before contributing code, please review our [SECURITY.md](SECURITY.md) guidelines:

- **Local Loopback Only**: The backend server binds strictly to `127.0.0.1`. Do not modify server bindings to `0.0.0.0` or expose endpoints publicly, as the project currently lacks multi-user authentication.
- **Data Protection**: Personal resumes, profile data, application history, and SQLite databases (`data/copilot.db` or `*.db`) contain sensitive personal data and must **never** be committed to version control.
- **Secret Hygiene**: Never commit `.env` files, API keys (such as `GEMINI_API_KEY`), or credential files.
- **Reporting Vulnerabilities**: If you identify a security issue, do **not** open a public issue. Please follow the disclosure instructions in [SECURITY.md](SECURITY.md) to contact repository maintainers directly.

---

## 2. Development Setup

### Prerequisites
- **Python 3.12**
- **Node.js 18+** & **npm** (for frontend development)
- **Git**

### Step-by-Step Environment Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ManoharVit/job-copilot.git
   cd job-copilot
   ```

2. **Create and activate a virtual environment:**
   ```bash
   python3.12 -m venv .venv
   source .venv/bin/activate
   ```

3. **Install dependencies:**
   Dependencies are securely versioned with pinned hashes for reproducible builds:
   ```bash
   pip install -r requirements.txt
   pip install -r requirements-dev.txt
   ```

4. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   *(Optional: Populate `GEMINI_API_KEY` in `.env` if developing or testing AI-assisted resume and cover letter tailoring features).*

5. **Run the local application:**
   ```bash
   ./start.sh
   ```
   This creates the schema for a brand-new empty database, then launches the FastAPI server on `http://127.0.0.1:8000`. It never auto-migrates an existing database; if the schema is outdated it refuses to start — back up `data/copilot.db` and run `cd backend && alembic upgrade head`.

---

## 3. Project Architecture & Code Organization

Job Copilot consists of three primary subsystems:

- **`backend/`**: Python FastAPI application server, SQLAlchemy models, and business logic.
  - `backend/server.py`: FastAPI application entrypoint, middleware, and route mounting.
  - `backend/app_tracker/`: Canonical application tracking module containing domain entities, state transitions, repository, router, and service layers.
  - `backend/models.py`: SQLAlchemy database models (`User`, `Application`, `ApplicationStatusHistory`).
  - `backend/migrations/`: Alembic database migration revisions.
  - `backend/schema_guard.py`: Startup verification ensuring the database schema matches the latest migration revision.
  - `backend/ai_writer.py`: AI tailoring service powered by the Google GenAI SDK.
  - `backend/tracker.py`: Legacy compatibility layer translating between legacy and canonical application statuses.
  - `backend/tests/`: Comprehensive test suite.
- **`frontend/`**: React application built with Vite and Tailwind CSS.
- **`extension/`**: Chrome browser extension for capturing job application data directly from job boards.
- **`docs/`**: Architecture and module documentation (see `docs/modules/application-tracker.md` and `docs/development.md`).

---

## 4. Frontend Asset Routing & Build Conventions

When developing or building the frontend, you must adhere to the asset routing rule documented in `docs/development.md` and `GEMINI.md`:

- **Vite Base Path**: In `frontend/vite.config.js`, `base: '/static/'` is strictly required.
  ```javascript
  export default defineConfig({
    base: '/static/',
    // ...
  })
  ```
- **FastAPI Static Mount**: The FastAPI backend mounts the static directory at `/static`:
  ```python
  app.mount("/static", StaticFiles(directory=static_dir), name="static")
  ```
- **Asset Validation**: Build outputs and deployment scripts (`deploy.sh`) validate that script and stylesheet references in `index.html` use `/static/assets/` rather than `/assets/`.

To build the frontend locally:
```bash
cd frontend
npm install
npm run build
```

---

## 5. Testing & Code Quality

All contributions must pass automated tests and linter checks before being merged.

### Running Backend Tests
Execute the test suite from the repository root:
```bash
PYTHONPATH=backend python -m pytest backend/tests/ -v
```

> **Why `PYTHONPATH=backend`?**  
> Backend modules import internal dependencies using root-level module names (e.g. `import models`, `from database import get_db`). Setting `PYTHONPATH=backend` ensures Python resolves these imports consistently across local runs and CI.

### Test Isolation
Tests in `backend/tests/conftest.py` run in complete isolation:
- Live AI features are disabled by enforcing an empty `GEMINI_API_KEY`.
- Tests run against isolated, temporary SQLite databases built from Alembic migrations.
- The actual local database (`data/copilot.db`) is protected and verified to ensure it is never accessed during test execution.

### Linting & Formatting
Python code is analyzed using **Ruff**:
```bash
# ruff is pinned (with hashes) in requirements-dev.txt; no separate install needed
ruff check backend/
```

Frontend linting:
```bash
cd frontend
npm run lint
```

---

## 6. Contribution & Pull Request Workflow

1. **Create a topic branch:**
   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

2. **Develop and test your changes:**
   - Write clean, documented code aligned with existing architecture.
   - Add new tests in `backend/tests/` to cover new features or prevent bug regressions.
   - Ensure all existing tests pass (`PYTHONPATH=backend python -m pytest backend/tests/ -v`).
   - Run the linter (`ruff check backend/`).

3. **Commit your changes:**
   - Use concise, imperative commit messages (e.g. `Add status history filter to application tracker`, `Fix Vite asset path validation`).

4. **Submit a Pull Request:**
   - Push your branch to GitHub and open a pull request against `main`.
   - Complete all sections of the [Pull Request Template](PULL_REQUEST_TEMPLATE.md).
   - Reference associated issues (e.g. `Closes #42`).
   - Ensure all automated GitHub Actions CI checks pass.

---

## 7. Reporting Issues

- **Bug Reports**: Open an issue using the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) template. Provide complete reproduction steps and environment details.
- **Feature Requests**: Open an issue using the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) template. Clearly state the problem, proposed solution, and affected components.
- **Security Redaction**: When sharing logs or screenshots in public issues, always redact personal information, emails, API keys, and resume contents.
