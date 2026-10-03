---
name: Bug Report
about: Create a report to help us improve Job Copilot
title: '[BUG] '
labels: bug
assignees: ''
---

> **⚠️ SECURITY & PRIVACY NOTICE**
> - **Security Vulnerabilities**: If you have found a security vulnerability, please **DO NOT** open a public issue. Review our [Security Policy](../../SECURITY.md) for private reporting instructions.
> - **Redact Sensitive Data**: Job Copilot runs locally and processes personal resumes, application histories, and AI credentials. **NEVER** share your `.env` file, API keys (e.g. `GEMINI_API_KEY`), or unredacted personal information (PII) in issue reports, logs, or screenshots.

## Bug Description
A clear and concise description of what the bug is.

## Steps to Reproduce
Steps to reproduce the behavior:
1. Start the server via `bash start.sh` (or `uvicorn ...`)
2. Go to '...'
3. Click on '....'
4. Scroll down to '....'
5. See error

## Expected Behavior
A clear and concise description of what you expected to happen.

## Actual Behavior & Logs
What happened instead? If applicable, add terminal output, error logs, or stack traces below (please sanitize any secrets or PII):

```text
<paste error logs / traceback here>
```

## Screenshots / Screen Recordings
If applicable, add screenshots to help explain your problem. (Ensure personal information and credentials are redacted).

## Environment
Please provide details of your local environment:
- **OS**: [e.g. macOS 14.5 Sonoma, Ubuntu 22.04, Windows 11 (WSL2)]
- **Python Version**: [e.g. Python 3.12.2] *(Note: Job Copilot targets Python 3.12)*
- **Browser & Version**: [e.g. Chrome 124.0.0, Safari 17.4]
- **Extension Installed**: [e.g. Yes / No / Version]
- **AI Feature Enabled**: [e.g. Yes (Gemini API Key configured) / No]
- **Branch / Commit**: [e.g. `main` / `git rev-parse --short HEAD`]

## Additional Context
Add any other context about the problem here (e.g., database migration state, recent dependency changes).
