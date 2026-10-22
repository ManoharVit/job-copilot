# Engineering workflow and security boundaries

## What each layer does

| Layer | Responsibility | Boundary |
| --- | --- | --- |
| Extension popup | Explicit permissions and Autofill actions | Employer, embedded ATS, and backend grants are separate |
| Content controller/adapters | Find fields, capture stable targets, attach the selected resume | Page text is untrusted; stale/user-edited targets are skipped |
| Background worker | Frame injection/delivery and API proxy | Fixed loopback origin, route/method allowlist; no arbitrary fetch proxy |
| FastAPI | Validate inputs, match fields, track applications, generate/export documents | Host/Origin checks; strict AI contracts; bounded bodies; no-store responses |
| SQLite/resume store | Local candidate data | No migrations or candidate-data changes during this hardening release |
| Gemini client | Explicit generation requests | Configured model only; 10-second SDK request timeout, maximum two SDK attempts, two concurrent calls |

The SDK timeout is a network-request setting, not a proof that every operation
will stop at an exact wall-clock deadline. A browser disconnect does not cancel
an in-flight synchronous provider request. No automatic model switching occurs.

## Local-only security model

`start.sh` binds to 127.0.0.1:8765. This is an unauthenticated, single-user service.
Host/Origin checks reject common browser-origin attacks; they do not authenticate
local processes. Anyone running code under the same OS account can access the
local service and files. Do not expose it with a tunnel or public bind. Remote
hosting requires explicit authentication, per-user authorization, TLS, protected
storage, abuse controls, and a separate threat review. Container published ports
are also restricted to loopback; their internal service binds are not host ports.

Profile/resume/API responses use no-store. General API write bodies are limited
to 512 KiB; the resume route retains its own streaming size/file validation.
AI input fields have independent type/length bounds. Invalid payloads return 4xx
without echoing submitted values. Generation failure returns HTTP 503 and leaves
client drafts intact. Eligibility and consent questions remain manual.

Document export accepts plain text, not executable LaTeX. Filenames are sanitized,
LaTeX metacharacters are escaped, and no compiler is run by the export endpoint.
These controls do not certify external editors or compilers as safe.

## Change workflow

1. Record the trigger, expected result, trust boundary and non-goals in a small
   spec. Use [the hardening spec](specs/engineering-hardening.md) as an example.
2. Reproduce a defect with a focused negative-path test. Fix the source module,
   then build generated files; do not hand-edit compiled extension bundles.
3. Run the relevant suites and all release checks below. Document uncertainty,
   failure output and skipped live checks. Never label mocked tests as live proof.
4. Inspect the diff for secrets, data files, new permissions and dependency changes.
   CI must pass before merging. A second model may review it, but independent
   evidence and human review of security boundaries remain necessary.
5. For ATS changes, test a direct form and an embedded form in a controlled pilot.
   Check every filled value, attachment and permission. Never automatically submit.

## Local and CI checks

```bash
PYTHONPATH=backend .venv/bin/python -m pytest backend/tests -q
.venv/bin/ruff check backend scripts
.venv/bin/ruff check backend --select S --exclude tests
.venv/bin/python scripts/check_repository.py
.venv/bin/python -m pip_audit -r requirements.txt --require-hashes --disable-pip
(cd frontend && npm ci && npm audit --audit-level=high && npm run lint && npm run build && npm test)
.venv/bin/python scripts/check_dashboard.py backend/static
(cd extension && npm ci && npm audit --audit-level=high && npm run typecheck && npm test && npm run build:unpacked && npm run test:build)
```

Python dependency advisories block CI; npm high/critical advisories block CI.
Advisory results depend on the feeds at scan time. Tracked-file checks reject
private data filenames and several recognizable credential formats without
printing credentials; they cannot detect all secrets. Neither scanners nor tests
constitute a security certification. GitHub CI is configured here; its hosted
run is not established by local execution.

`deploy.sh` now builds and verifies the current static directory. `--dry-run`
validates existing files without building. It no longer expects the removed
static_staging directory. Startup repairs missing/empty referenced assets by
building and validating them. It does not infer source freshness from timestamps.

## Pilot evidence still required

- Chrome permission prompt with only employer + ATS origin grants.
- Embedded-frame Autofill, React input reconciliation and SPA step changes.
- Resume attachment to the intended control; no unintended submission.
- Candidate review of generated factual claims and manual eligibility answers.
- A task log of incorrect/skipped fields and time saved, with no candidate data
  in reports. User demand, accuracy and performance require measurement.

## Debug a failure by layer

For a broken Autofill action, identify the failing boundary first: Chrome origin
grant, frame injection/delivery, backend connectivity, field match, then DOM
application. The popup distinguishes backend errors from site access errors.
Use `/api/health` to check service identity; avoid pasting profile responses or
resume contents into logs. Reproduce a wrong match with a synthetic field/profile
fixture before changing matcher heuristics. Keep the first failing test and
record what observation disproved the original assumption.
