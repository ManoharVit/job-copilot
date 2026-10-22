# Engineering hardening — 22 October 2026

## Scope and trust boundaries
Job Copilot is a single-user assistant bound to 127.0.0.1:8765. Chrome and the
local React dashboard call FastAPI; SQLite and the selected resume remain local.
Gemini receives only explicitly requested generation context. This release adds
no remote access, account system, cloud deployment, database migration, or paid
model test. Local processes with OS access are trusted; CORS/Host checks are not
authentication. Remote/multi-user hosting requires a separate auth design.

## Acceptance criteria
1. AI and document inputs have strict types and length bounds; malformed input
   returns 4xx before generation. Eligibility/consent remains manual.
2. API request bodies are bounded even without Content-Length. Resume uploads
   retain their existing independent 5 MB file limit. API responses are not cached.
3. Generation uses only the configured model, an explicit SDK request timeout,
   and bounded SDK retries/concurrency. There are no application retry/fallback
   loops. Failure never returns an original document or a fabricated answer as
   successfully generated output; private upstream exception text is not returned.
4. Document filenames cannot inject headers. Plain text is escaped for LaTeX;
   export never executes a compiler or interprets text as LaTeX commands.
5. AI dashboard errors preserve the current draft and show failure; a failed
   humanize request cannot show a success toast. No detection-bypass guarantee.
6. Startup validates the actual index and every referenced JS/CSS asset, not
   merely the presence of an assets directory. The old staging deploy entrypoint
   uses the current build/validation workflow.
7. CI blocks on backend tests/lint/security lint, dashboard lint/tests/build,
   extension typechecks/tests/build checks, and dependency vulnerability audits.
   Security scanner suppressions must be narrow and documented.

## Verification and release evidence
Use synthetic profiles and mocked Gemini responses. Test malformed and oversized
inputs, API error redaction, generation concurrency/retry configuration, document
escaping, failed AI requests, incomplete dashboard artifacts, and startup checks.
Run the existing regression suites and advisory audits. Preserve the real DB,
resume and .env. Live Chrome permission prompts and real ATS submissions are
separate manual release gates; passing unit tests does not establish those.

## User validation
The owner should test one direct ATS form and one embedded form using specific
site grants, inspect values and resume selection, and report incorrect/skipped
fields and permission failures. Record browser/provider and expected/observed
behavior without candidate data. Never mark this gate passed from mocked tests.
