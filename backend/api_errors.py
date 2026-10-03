"""Shared API error handling and request-ID propagation.

* ``DomainError`` is the base for business-rule errors raised by services.
  Services never import HTTP concepts; routers register an HTTP status per
  error type with :func:`register_domain_error`.
* Responses for ``/api/v1/*`` use a consistent envelope::

      {"error": {"code": "...", "message": "...", "details": ..., "request_id": "..."}}

* Legacy ``/api/*`` routes keep FastAPI's original ``{"detail": ...}`` shape so
  the existing dashboard and extension are unaffected.
* Internal exception text and stack traces are never returned to clients.
"""
from __future__ import annotations

import logging
import re
import uuid
from contextvars import ContextVar
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exception_handlers import (
    http_exception_handler,
    request_validation_exception_handler,
)
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("job_copilot.api")

V1_PREFIX = "/api/v1"
REQUEST_ID_HEADER = "X-Request-ID"
_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,128}$")

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")


class DomainError(Exception):
    """Base class for expected business-rule failures."""

    code = "domain_error"

    def __init__(self, message: str, details: Any | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details


_DOMAIN_ERROR_STATUS: dict[type[DomainError], int] = {}


def register_domain_error(error_type: type[DomainError], status_code: int) -> None:
    _DOMAIN_ERROR_STATUS[error_type] = status_code


def _status_for(error: DomainError) -> int:
    for cls in type(error).__mro__:
        if cls in _DOMAIN_ERROR_STATUS:
            return _DOMAIN_ERROR_STATUS[cls]
    return 400


def _is_v1(request: Request) -> bool:
    return request.url.path.startswith(V1_PREFIX)


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", None) or request_id_var.get()


def error_envelope(
    request: Request, status_code: int, code: str, message: str, details: Any | None = None
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": details,
                "request_id": _request_id(request),
            }
        },
    )


def _safe_validation_details(exc: RequestValidationError) -> list[dict[str, Any]]:
    # Drop "input" and "ctx" so submitted values (possibly personal data) are
    # never echoed back or logged.
    return [
        {"loc": list(err.get("loc", ())), "msg": err.get("msg", ""), "type": err.get("type", "")}
        for err in exc.errors()
    ]


async def _handle_domain_error(request: Request, exc: DomainError) -> JSONResponse:
    status_code = _status_for(exc)
    if _is_v1(request):
        return error_envelope(request, status_code, exc.code, exc.message, exc.details)
    return JSONResponse(status_code=status_code, content={"detail": exc.message})


async def _handle_validation_error(request: Request, exc: RequestValidationError):
    if _is_v1(request):
        return error_envelope(
            request, 422, "validation_error", "Request validation failed.", _safe_validation_details(exc)
        )
    return await request_validation_exception_handler(request, exc)


async def _handle_http_exception(request: Request, exc: StarletteHTTPException):
    if _is_v1(request):
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
        message = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return error_envelope(request, exc.status_code, code, message)
    return await http_exception_handler(request, exc)


async def _handle_unexpected_error(request: Request, exc: Exception):
    # Full details go to server logs only, tagged with the request ID.
    logger.exception("Unhandled error (request_id=%s)", _request_id(request))
    if _is_v1(request):
        return error_envelope(request, 500, "internal_error", "An unexpected error occurred.")
    return PlainTextResponse("Internal Server Error", status_code=500)


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(DomainError, _handle_domain_error)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)
    app.add_exception_handler(StarletteHTTPException, _handle_http_exception)
    app.add_exception_handler(Exception, _handle_unexpected_error)


class RequestIDMiddleware:
    """Attach a request ID to every request and echo it in ``X-Request-ID``.

    A well-formed inbound ID is reused (for client-side correlation); anything
    else is replaced with a fresh UUID. Implemented as pure ASGI so streaming
    responses (CSV/PDF exports) are not buffered.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        inbound = ""
        for name, value in scope.get("headers", []):
            if name == b"x-request-id":
                inbound = value.decode("latin-1")
                break
        request_id = inbound if _VALID_REQUEST_ID.match(inbound) else uuid.uuid4().hex

        scope.setdefault("state", {})["request_id"] = request_id
        token = request_id_var.set(request_id)

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", request_id.encode("latin-1")))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            request_id_var.reset(token)
