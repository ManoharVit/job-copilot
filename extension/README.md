# Job Copilot extension

The extension uses WXT, TypeScript in strict mode, and Node.js 22 or newer.
Edit `src/`; the JavaScript, CSS, manifest, and popup copied into this directory
are generated runtime files.

## Build and load

From `extension/`:

```sh
npm ci
npm run typecheck
npm test
npm run build:unpacked
npm run test:build
```

Keep loading this existing `extension/` directory as the unpacked extension.
After rebuilding, reload Job Copilot at `chrome://extensions` and reload the job
page. Building does not reload Chrome or grant site permissions.

`build:unpacked` copies the production `.output/chrome-mv3/` bundle into the
existing unpacked directory. Keeping the path preserves the extension ID and
the backend's configured `CORS_EXTENSION_ORIGIN`. Loading `.output/chrome-mv3/`
as a separate extension can create a different ID; update the exact CORS origin
if deliberately choosing that installation method.

Chrome must allow the extension on both the employer page and its ATS iframe
origin. For the Hyperproof test these are `https://hyperproof.io` and
`https://job-boards.greenhouse.io`. Those grants still require live verification.

`npm run dev` starts WXT's development browser workflow. Use production
`build:unpacked` for the existing extension in your normal Chrome profile.

## Source layout

- `src/entrypoints/`: WXT background, content, and popup entrypoints.
- `src/background.ts`: injection, API proxy, and per-frame autofill delivery.
- `src/content.ts`: the current form controller and SPA detection lifecycle.
- `src/adapters/`: the adapter interface, registry, Greenhouse, Lever, Workday, Ashby,
  and generic fallback detection.
- `src/core/fields.ts`: field labels and isolated essay question extraction.
- `src/core/autofill.ts`: captured field targets, stale-response checks, and shared
  first/second-pass filling.
- `src/core/api-proxy.ts`: local endpoint/method allowlist and fixed fetch options.
- `src/core/dom.ts`: native value setters, React tracking, and length limits.
- `src/shared/messages.ts`: shared message/API types and packaged asset paths.

## ATS adapters

The registry resolves the current document's hostname first, then checks for an
embedded provider, then uses the generic fallback. It resolves on each call so
late or replaced iframes can change the selected adapter. Each frame resolves
independently; the existing background broadcast still handles cross-frame
autofill.

Greenhouse, Lever, Workday, and Ashby provide provider detection, job-description extraction,
company detection, and textarea wrapper selection. Provider hostname matching
checks domain boundaries. Description extraction skips application forms and
excludes form controls, labels, editable drafts, hidden markers, and extension UI
from both selected description containers and the generic body fallback. Text
traversal is bounded; these filters cannot guarantee that arbitrary employer
markup contains no personal data.

The generic adapter retains the existing platform, company, degree preference,
and description heuristics when a provider has no result. Custom modal handling
for unrecognized portals remains in the shared controller; known ATS adapters
skip the legacy Shine-style skills click sequence. `handleCustomModals` remains
an optional hook for future provider-specific modal workflows.

## Validation

`npm test` runs DOM extraction, frame lifecycle/security, native value setter,
ATS adapter, API proxy, stale-target, controller lifecycle, and site-access
recovery regressions. These tests use synthetic fixtures and mocked Chrome APIs;
they do not verify actual Chrome permission prompts or cross-origin execution.
The current suite has 175 Node tests plus four DOM extraction scenarios, followed
by three compiled bundle checks (182 extension checks in total).

`test:build` checks the
production manifest and popup assets, runs the compiled background worker with
mock Chrome APIs, and checks content startup/reinjection. These tests use
synthetic data and do not contact the backend, Gemini, or job portals.

CI installs the locked dependencies, checks types, runs source tests, builds,
and checks the compiled bundle. Real Chromium integration tests and manual ATS
testing remain separate work.

## Request and fill safety

Injected Autofill and Generate buttons ignore synthetic page clicks. The
extension popup and Chrome shortcut still dispatch through the background
worker. Toast relay uses extension messaging only. Form/answer responses are
applied only while the captured element, question, value, and document URL
remain unchanged. Hidden/password fields are excluded from both fill passes.

The API proxy accepts only the configured localhost origin and named endpoints
with fixed methods. It disables redirects/credentials and sets a 60-second
client deadline. The local backend also validates Host and non-preflight Origin
headers; it remains a single-user, unauthenticated loopback service.

Eligibility/visa/consent questions and unknown choices need manual answers.
Missing education facts and unmatched options are skipped. AI failures produce an explicit error rather
than substituting a fabricated employment anecdote. All generated text still
requires candidate review.

## Step 3 Phase 2 — Workday and Ashby

Dedicated modules now handle these providers:

| Behavior | Workday | Ashby |
| --- | --- | --- |
| Hosted pages | `*.myworkdayjobs.com`; `*.myworkdaysite.com/[locale/]recruiting/...` | `jobs.ashbyhq.com` |
| Embedded/custom pages | Matching iframe URLs; candidate-flow or paired posting markers | Matching iframe URLs; `#ashby_embed`; application container |
| Field labels and essay placement | `data-automation-id` form containers and labels | Application field entries and question titles |
| Education | Preference per education entry from its explicit heading/selected degree | Preference per fieldset/entry from explicit context |
| Custom text comboboxes | Read rendered options via `aria-controls` or `aria-owns` | Same association rule, excluding hidden/disabled options |
| Employer and job context | Posting containers, bounded JobPosting metadata, employer metadata | Posting containers, bounded JobPosting metadata, employer metadata |

The controller uses adapter labels and options on both fill passes and sends a
separate degree preference for each field. Snapshots reject responses when a
field, label, document URL, or local degree preference changes while a request
is pending. Replaced wizard steps are rescanned; character-data changes also
trigger detection for reused labels. Generate button ownership stays attached
to each textarea, and eligibility questions remain manual.

Fill the currently rendered step, then advance it yourself and invoke Autofill
again. This phase does not click Next/Submit, upload files, authenticate, or
enumerate every item in a virtualized dropdown. Native inputs/selects/textareas
and editable ARIA comboboxes use the existing guarded setters. Button-only,
readonly, unassociated, or unrendered custom options require manual selection.
Closed shadow roots are not supported by this phase.

Provider CSS/automation selectors are fixture-tested heuristics, not vendor API
contracts. Actual Workday/Ashby UI behavior, site grants, frame timing, and React
state reconciliation still require browser testing. No job applications or paid
AI requests are used by the tests. No backend API or database schema changed.

References used for the extraction:

- [Ashby's embed setup](https://docs.ashbyhq.com/embedding-ashby-job-boards-in-an-external-careers-page)
  documents the `ashby_embed` placeholder and the hosted embed URL.
- [Schema.org JobPosting](https://schema.org/JobPosting) defines the employer and
  description metadata fields. Only bounded JSON is read; publisher HTML is not
  inserted into a document.
- [An employer's Workday recruiting link](https://www.law.upenn.edu/live/files/11487-evaluation-manager-conviction-integrity-projects)
  demonstrates the locale-prefixed `myworkdaysite.com` recruiting route. This
  reference does not verify current form selectors.

Status: Step 3 Phase 2 implementation complete. Live browser integration remains
deferred; Step 4 and launcher/deployment work are separate workstreams.

## Recovering an embedded form access failure

If the parent page shows Autofill but the application iframe cannot be reached:

1. After a code update, reload Job Copilot at `chrome://extensions`, then reload
   the employer page. Keep using this existing unpacked extension directory.
2. Open the Job Copilot popup. Its Application site access section lists only
   the current employer and recognized ATS frame origins, excluding unrelated
   chatbot/advertising frames and lookalike domains.
3. Click **Allow these sites** and accept Chrome's site permission prompt if shown.
   For the Hyperproof case the list should contain `https://hyperproof.io` and
   `https://job-boards.greenhouse.io`.
4. The popup reinjects scripts without filling or submitting anything. Click
   **Autofill This Page** afterwards; reload the application page if still needed.

The worker now reports script, stylesheet, and message-delivery failures
separately. Permission errors include only the origin, never URL paths or query
parameters. An unavailable frame, an empty form, and a failed backend operation
have separate messages; a permission failure cannot fall back to filling an
unrelated parent-page form. The popup recovery control works independently of
backend profile loading. Denying access leaves the form untouched.

Chrome requires permissions requests to originate in a user gesture. The popup
requests the displayed origins synchronously from a trusted click and checks
that the active tab/sites still match before reinjection. Required host
permissions withheld by the user may be requested this way, as described in
[Chrome's permissions API documentation](https://developer.chrome.com/docs/extensions/reference/api/permissions#method-request).
Actual grants and form behavior still require live Chrome verification.

## Local backend connection

Employer/ATS site access and backend connectivity are independent. The popup's
**Local backend connection** panel checks the loopback grant before loading the
profile. Click **Connect local backend** to request access only to `http://127.0.0.1:8765/*`
from a real user gesture, then retry loading the profile/stats through the
background worker. The grant does not permit arbitrary worker requests: the API
proxy still accepts only `http://127.0.0.1:8765`, named routes, and fixed methods,
with redirects/credentials disabled. No paid AI requests or form filling occur
when connecting.

All popup and content-script API requests now use that same worker path. IPv4
loopback matches the daemon's bind address explicitly. The worker distinguishes
withheld loopback permissions, network failures, HTTP rejection, and invalid JSON.
An HTTP 403 explains the extension-origin setting instead of reporting that the
server is down. Autofill failures remain failures rather than successful zero-field
operations, and the original backend error reaches the popup.

Run `./start.sh` from the project root and leave it running. A native HTTP check
only confirms the server; it cannot confirm Chrome host/local-network grants.
After this extension update, reload Job Copilot and the application page, reopen
the popup, and use **Connect local backend**. Chrome's extension error page keeps
old records; clearing those records before retrying separates old failures from
new ones. Do not disable CORS or grant all websites to address this connection.

[Chrome's cross-origin request documentation](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
explains the host-permission requirement for requests from extension contexts.
Actual Chrome connectivity still requires live browser verification.

The local backend host grant specifies port 8765 explicitly; it does not request
all HTTP ports on loopback. Chrome documents explicit port matching in its
[match-pattern syntax](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns).

## Resume attachment on Autofill

In the React dashboard, open **Profile → Resume for Autofill**, choose a PDF or
DOCX up to 5 MB, and click **Save resume**. Replacement/removal use that same card;
the normal profile Save Changes button does not manage the resume. The backend
stores one private, mode-0600 `data/resume.json` record and never sends it to Gemini.
No database migration is needed. The saved file persists across browser/server
restarts and is never exposed by the static-files route.

After rebuilding, reload Job Copilot at `chrome://extensions` and reload the job
page. The same Autofill action now fills fields and attaches the saved resume
when exactly one clearly labelled Resume/CV native file input is available.
Hidden native file inputs used by upload buttons are supported. Existing selected
files are preserved, repeated actions on the same upload control are guarded,
and changed/navigated controls invalidate an attachment waiting for the backend.
The portal's accepted extensions/MIME types are checked before assigning a file.

Cover letters, photos, certificates, generic attachments, ambiguous upload fields,
and incompatible formats are skipped. Widgets without a native file input and
closed shadow roots require manual attachment. Replacing the saved resume does
not overwrite a document already selected on an application page. The extension
uses File/DataTransfer and input/change events; it does not click Upload/Next/
Submit or claim the portal server accepted a file. Check its upload confirmation.
Clicking Autofill can send the document to the job portal through its own upload
handler; choosing and saving it in the dashboard alone stays local.

The worker can read only GET `/api/resume/file` through its existing fixed-origin
proxy; resume create/delete remain dashboard actions. Request body, file size,
filename, PDF signature, and DOCX archive structure are validated by the backend.
Metadata responses omit the base64 contents and all resume responses use no-store.
Resume file bytes are never added to profile responses, tracker records or AI prompts.

`npm run test:resume-browser` additionally runs an offline Chrome/Chromium fixture
using a temporary profile and synthetic PDF. Set `CHROME_BIN` if Chrome is not in
its usual macOS/Linux location. It verifies native FileList assignment, unchanged
file bytes, input/change events, cover-letter isolation, the repeat guard, and no
form submission. It does not test a real employer upload or existing Chrome grants.
The normal 182 extension checks use source and bundle tests as described above.
The [HTML input files setter](https://html.spec.whatwg.org/multipage/input.html#dom-input-files)
and [DataTransfer constructor](https://developer.mozilla.org/en-US/docs/Web/API/DataTransfer/DataTransfer)
describe the browser APIs used here.

### Autofill with per-site access

Chrome's **When you click the extension** access covers the employer page, but
a form embedded from another origin (such as Greenhouse) needs its own grant.
Open the Job Copilot toolbar popup and click **Autofill This Page**: it requests
only the employer and recognized ATS origins listed in the popup, reconnects
their scripts, and fills after permission is granted. Declining or a changed
application tab stops the operation. **Allow these sites** remains available
for reconnecting without filling.

The floating page button cannot display Chrome's host permission prompt. If it
reports blocked form access, use **Autofill This Page** in the toolbar popup.
You do not need **On all sites**. The local backend grant remains separate.
