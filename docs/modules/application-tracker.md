# Application Tracker

## Overview
The Application Tracker module manages the lifecycle of job applications, maintaining state transitions and preserving a comprehensive history of changes.

## Status State Machine
Applications transition through a strict set of canonical statuses:

- `draft`
- `submitted`
- `under_review`
- `screening`
- `interviewing`
- `offer`
- `rejected`
- `withdrawn`
- `archived`

Transitions are generally forward-only (e.g., you cannot go from `offer` back to `screening`). The `archived` status is currently terminal.

## Endpoints

### Canonical API (`/api/v1/applications`)
- `POST /api/v1/applications`: Create a new application.
- `GET /api/v1/applications`: List applications (paginated, supports `?status=`).
- `GET /api/v1/applications/{id}`: Retrieve an application by ID.
- `PATCH /api/v1/applications/{id}`: Update an application. Supports optimistic concurrency via `expected_status`.
- `GET /api/v1/applications/{id}/history`: Retrieve the status change history for an application.
- `DELETE /api/v1/applications/{id}`: Hard delete an application (cascades to history).

### Legacy Mapping
To support the existing React Dashboard and Chrome Extension, legacy endpoints (`/api/applications`, `/api/stats`, `/api/export`, `/api/log-application`) are maintained as adapters.
The canonical statuses map lossily to the 4 legacy statuses (`applied`, `interview`, `offer`, `rejected`). 
New items tracked via the extension begin as `draft`.

## Limitations
- **Ownership**: Data is scoped to an `owner_id`. Currently implemented via a hardcoded bootstrap local user since authentication is not yet available.
- **Background Tracking**: Not yet implemented.
- **External Submission**: Not yet implemented.
