# API Reference

Job Copilot exposes a local HTTP API (FastAPI). The full, always-current schema is generated
from the code. With the server running:

- Interactive docs (Swagger UI): <http://127.0.0.1:8000/docs>
- ReDoc: <http://127.0.0.1:8000/redoc>
- Raw OpenAPI schema: <http://127.0.0.1:8000/openapi.json>

Every endpoint in the schema has a summary, a tag and (where it takes a body) a request
example. `backend/tests/test_openapi_docs.py` runs those examples against the API, so they
should stay correct.

> [!IMPORTANT]
> **No authentication.** Every request acts as the single bootstrap local user. The server
> binds to `127.0.0.1`; do not expose it to a network. See [SECURITY.md](../SECURITY.md).

The examples below assume the server is running (`./start.sh`) and use:

```bash
BASE=http://127.0.0.1:8000
```

Endpoint groups:

| Tag | Prefix | Status |
|-----|--------|--------|
| `applications` | `/api/v1/applications` | Implemented. Typed schemas, validation, status lifecycle, history. **Use this for new code.** |
| `legacy (v0)` | `/api/applications`, `/api/stats`, `/api/export` | Implemented. Kept for the original dashboard; maps statuses lossily. |
| `extension` | `/api/log-application`, `/api/match-fields` | Implemented. Used by the browser extension. |
| `profile` | `/api/profile` | Implemented. Single local profile. |
| `documents` | `/api/export-doc` | Implemented. PDF / DOCX / LaTeX export. |
| `ai (experimental)` | `/api/generate-*`, `/api/tailor-resume`, `/api/humanize`, `/api/interview-prep` | Experimental. Calls Gemini **only if `GEMINI_API_KEY` is set**; otherwise returns placeholder output (see below). |

---

## Applications (v1)

### Create

```bash
curl -s -X POST "$BASE/api/v1/applications" \
  -H "Content-Type: application/json" \
  -d '{
        "title": "Backend Engineer",
        "company": "Example Corp",
        "url": "https://jobs.example.com/postings/1234",
        "platform": "company_site",
        "status": "submitted",
        "notes": "Referred by a former colleague."
      }'
```

Returns `201 Created` with a `Location` header and the full application, including
`allowed_next_statuses`. Unknown fields are rejected (`422`).

To capture the new id for the next examples:

```bash
ID=$(curl -s -X POST "$BASE/api/v1/applications" \
  -H "Content-Type: application/json" \
  -d '{"title": "Platform Engineer", "company": "Example Corp", "status": "submitted"}' \
  | python3 -c 'import sys, json; print(json.load(sys.stdin)["id"])')
echo "$ID"
```

### List, filter and paginate

Newest first. Repeat `status` to filter on several values. `page_size` is capped at 100.

```bash
curl -s "$BASE/api/v1/applications?status=submitted&status=screening&page=1&page_size=20"
```

Response shape: `{"items": [...], "total": 2, "page": 1, "page_size": 20}`. List items omit
`job_description`.

### Get one

```bash
curl -s "$BASE/api/v1/applications/$ID"
```

### Update fields and change status

Only the fields you send are changed. A `status` change must be an allowed transition.

```bash
curl -s -X PATCH "$BASE/api/v1/applications/$ID" \
  -H "Content-Type: application/json" \
  -d '{"status": "screening", "transition_note": "Recruiter call booked"}'
```

Add `expected_status` for optimistic concurrency: the request fails with `409` if the status
changed since you read it.

```bash
curl -s -X PATCH "$BASE/api/v1/applications/$ID" \
  -H "Content-Type: application/json" \
  -d '{"status": "interviewing", "expected_status": "screening", "transition_note": "Onsite booked"}'
```

### Status history

Oldest first, including the initial status.

```bash
curl -s "$BASE/api/v1/applications/$ID/history"
```

### Allowed transitions

```bash
curl -s "$BASE/api/v1/applications/status-transitions"
```

### Delete

Permanently deletes the application and its history (`204 No Content`). To keep it, move it to
`archived` instead.

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE "$BASE/api/v1/applications/$ID"
```

### Errors

v1 errors use one envelope. `request_id` matches the `X-Request-ID` response header.

```bash
curl -s "$BASE/api/v1/applications/999999"
```

```json
{"error": {"code": "application_not_found", "message": "...", "details": null, "request_id": "..."}}
```

| Status | When |
|--------|------|
| `404` | Application does not exist (or belongs to another user). |
| `409` | Disallowed status transition, or `expected_status` mismatch. |
| `422` | Body or query validation failed (`details` lists the fields). |

---

## Profile

```bash
curl -s "$BASE/api/profile"
```

```bash
curl -s -X PUT "$BASE/api/profile" \
  -H "Content-Type: application/json" \
  -d '{"name": "Alex Example", "email": "alex@example.com", "location": "Remote"}'
```

---

## Extension endpoints

Log an application. It's deduplicated by URL for the current user and created as `draft`:

```bash
curl -s -X POST "$BASE/api/log-application" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://jobs.example.com/postings/9876", "title": "Data Engineer",
       "company": "Example Corp", "platform": "greenhouse", "job_description": "..."}'
```

Suggest profile values for scraped form fields. `index` is required. The result maps each
`index` to a value; fields with no confident match are omitted.

```bash
curl -s -X POST "$BASE/api/match-fields" \
  -H "Content-Type: application/json" \
  -d '[{"index": 0, "label": "First name", "name": "first_name", "type": "text", "tag": "input"},
       {"index": 1, "label": "Email address", "name": "email", "type": "email", "tag": "input"}]'
```

---

## Legacy (v0) endpoints

These remain for the original dashboard. Statuses use the old four-value vocabulary
(`applied | interview | offer | rejected`), which maps **lossily** onto the v1 lifecycle.
Errors are `{"detail": "..."}`, not the v1 envelope.

```bash
curl -s "$BASE/api/stats"
curl -s "$BASE/api/applications?limit=10&offset=0"
```

```bash
LEGACY_ID=$(curl -s "$BASE/api/applications?limit=1" \
  | python3 -c 'import sys, json; print(json.load(sys.stdin)[0]["id"])')
curl -s -X PUT "$BASE/api/applications/$LEGACY_ID" \
  -H "Content-Type: application/json" \
  -d '{"notes": "Followed up by email."}'
```

Export everything as CSV:

```bash
curl -s -o applications.csv "$BASE/api/export"
```

---

## Document export

`format` is `pdf`, `docx` or `tex`. With `"doc_type": "Cover Letter"` a header built from
your profile is added.

```bash
curl -s -o letter.pdf -X POST "$BASE/api/export-doc" \
  -H "Content-Type: application/json" \
  -d '{"text": "Dear Hiring Manager,\n\nI am applying for...", "format": "pdf", "doc_type": "Cover Letter"}'
```

---

## AI endpoints (experimental)

> [!WARNING]
> With `GEMINI_API_KEY` set, each call sends your request **and your stored profile** to
> Google's Gemini API and may cost money. Output is AI-generated: review it before you use it.
>
> Without a key, no external call is made and the response is placeholder output. Cover
> letters return your profile's saved `cover_letter_template` (empty on a fresh install).
> Answers use a short canned sentence. Interview prep returns a "not available" message.
> Resume tailoring and humanize return your input unchanged.

```bash
curl -s -X POST "$BASE/api/generate-cover-letter" \
  -H "Content-Type: application/json" \
  -d '{"job_description": "We are looking for a Python engineer...", "company_name": "Example Corp"}'
```

The other AI endpoints have the same request style. Their examples are in `/docs`:

| Endpoint | Required fields | Response key |
|----------|-----------------|--------------|
| `POST /api/generate-cover-letter` | `job_description` | `cover_letter` |
| `POST /api/generate-answer` | `question` | `answer` |
| `POST /api/tailor-resume` | `bullets` (list), `job_description` | `bullets` |
| `POST /api/humanize` | `text` | `text` |
| `POST /api/interview-prep` | `job_description` | `prep` |

A missing required field returns `400`.
