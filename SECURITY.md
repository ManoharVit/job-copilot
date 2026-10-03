# Security Policy

## Supported Versions
Only the latest branch is currently supported for security updates.

## Reporting a Vulnerability

If you discover a security vulnerability within Job Copilot, please do not open a public issue. Instead, please reach out to the repository maintainer directly. 

## Local Development Warning
Job Copilot currently lacks multi-user authentication. It should **only** be run locally bound to the loopback interface (`127.0.0.1`). Exposing the server to the public internet or binding it to `0.0.0.0` will allow anyone to view and edit your personal profile, application history, and consume your AI provider quota.

Do not commit your `.env` file or any files containing your real personal data to version control.
