# Job Copilot

[![CI](https://github.com/ManoharVit/job-copilot/actions/workflows/ci.yml/badge.svg)](https://github.com/ManoharVit/job-copilot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

![Application Tracker](docs/screenshots/application-tracker.png)


Job Copilot is an AI-assisted career platform designed to help job seekers discover roles, tailor resumes, prepare for interviews, and track job applications efficiently. 

> **SECURITY & DEVELOPMENT NOTICE**
> 
> This project is currently in **active development** and is designed for **local use only**. 
> - **No Authentication Yet:** The server binds to `127.0.0.1` and assumes a single local user. Do not deploy this to a public server or expose it to the internet.
> - **Data Privacy:** Your profile, resumes, and application tracking data are stored locally in an SQLite database. Never commit your `.env` or personal data.

## Features & Status

| Feature | Status | Notes |
|---------|--------|-------|
| **Application Tracking** | Implemented | Local-only tracking with status history. |
| **Profile Management** | Implemented | Single-user local profile. |
| **Resume Tailoring** | Experimental | Requires Gemini API Key. |
| **Cover Letter Gen** | Experimental | Requires Gemini API Key. |
| **Interview Prep** | Experimental | Requires Gemini API Key. |
| **Authentication** | Planned | Local single-user mode only right now. |
| **External Integrations** | Planned | No live job board submissions yet. |

## Quickstart

1. **Clone the repository and prepare the environment:**
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Configure your environment:**
   Copy `.env.example` to `.env` and fill in your Gemini API key if you want to use the AI features.
   ```bash
   cp .env.example .env
   ```

3. **Run the application:**
   ```bash
   ./start.sh
   ```
   On first run, `start.sh` creates the schema for a brand-new empty database. If you already have a database with an older schema, it **refuses to start and changes nothing** until you migrate it explicitly (below).

   **Upgrading an existing database** (back it up first!):
   ```bash
   cp data/copilot.db data/copilot.db.bak
   cd backend && alembic upgrade head
   ```

## Chrome extension development

The extension now uses WXT and TypeScript. From `extension/`, run `npm ci`,
`npm run typecheck`, `npm test`, and `npm run build:unpacked`. Keep loading the
existing `extension/` directory in Chrome, then reload the extension and job
page after a build. This keeps the unpacked extension ID used by the backend
CORS configuration.

See [extension development and testing](extension/README.md) for the source
layout, generated assets, and remaining browser integration checks.

## Architecture

Job Copilot runs entirely on your machine: a FastAPI backend with a local SQLite database
serves both the dashboard and the browser extension.

```mermaid
flowchart TD
    subgraph Clients
        UI["Dashboard (served at /)"]
        EXT["Browser extension"]
    end

    subgraph API["API layer - FastAPI"]
        V1["/api/v1/applications<br/>app_tracker/router.py"]
        LEGACY["Legacy + extension routes<br/>server.py"]
        AIR["AI and export routes<br/>server.py"]
        ID["identity.py<br/>single local user"]
    end

    subgraph Services
        SVC["ApplicationService<br/>ownership, lifecycle, history"]
        COMPAT["tracker.py<br/>legacy compatibility adapter"]
        DOMAIN["domain.py<br/>statuses + allowed transitions"]
        PROF["profile_manager.py"]
        MATCH["field_matcher.py"]
        WRITER["ai_writer.py"]
    end

    subgraph Data
        REPO["ApplicationRepository"]
        ORM["SQLAlchemy models"]
        DB[("SQLite<br/>schema managed by Alembic")]
    end

    GEMINI(["Google Gemini API<br/>only if GEMINI_API_KEY is set"])

    UI --> LEGACY
    UI --> AIR
    EXT --> LEGACY
    V1 --> ID
    LEGACY --> ID
    V1 --> SVC
    LEGACY --> COMPAT
    LEGACY --> PROF
    LEGACY --> MATCH
    COMPAT --> SVC
    SVC --> DOMAIN
    SVC --> REPO
    AIR --> WRITER
    AIR --> PROF
    WRITER -.-> GEMINI
    REPO --> ORM
    PROF --> ORM
    ORM --> DB
```

- **Application Tracker** follows API → Service → Repository → Database. Business rules (ownership,
  allowed status transitions, history) live in the service and domain layers, not the routes.
- **Legacy routes** keep the original dashboard and extension working. They delegate to the same
  service through `tracker.py`, so both paths enforce the same rules.
- **AI features** are optional. With no API key, they make no external calls.

Further reading:

- [API reference with curl examples](docs/api.md), or interactive docs at `http://127.0.0.1:8765/docs` while the server runs
- [Application Tracker design](docs/modules/application-tracker.md)
- [Development notes](docs/development.md) and [Contributing guide](CONTRIBUTING.md)

## Code review and current limits

See the [15 October 2026 code review](docs/review-2026-10-15.md) for applied
security/data-integrity corrections, verification, and remaining release work.
The currently served dashboard is `backend/static/index.html`; React builds into
`backend/static_staging` and is not promoted by `start.sh`. Browser integration
testing remains deferred. Unknown/eligibility fields require manual answers.

## Automatic resume attachment

Open **Profile → Resume for Autofill** in the dashboard, choose a PDF or DOCX
(up to 5 MB), and click **Save resume**. On a job application, click Autofill to
fill fields and attach that saved resume to a clearly identified supported upload
field. Review the portal's attachment confirmation before submitting.

The resume is stored locally in `data/resume.json` with private file permissions.
It is sent to the job portal only when you invoke Autofill and the portal's file
handler uploads it; it is not sent to Gemini. Existing application attachments
are preserved. Ambiguous/incompatible fields require manual attachment.

## Engineering and release checks

See [engineering workflow and security boundaries](docs/engineering.md) and the
[hardening acceptance criteria](docs/specs/engineering-hardening.md). CI includes
security lint, dependency audits, tracked-file privacy checks and regression tests.
Live browser/ATS behavior requires the separate pilot checks documented there.

See the [22 October hardening review](docs/review-2026-10-22.md) for applied fixes,
verification results and explicitly outstanding work.
