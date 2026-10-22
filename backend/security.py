"""Browser request boundary for the unauthenticated, loopback-only service."""
from starlette.datastructures import Headers
from starlette.requests import Request
from api_errors import error_envelope
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send


class OriginGuardMiddleware:
    def __init__(self, app: ASGIApp, allowed_origins: list[str]) -> None:
        if '*' in allowed_origins or 'null' in allowed_origins:
            raise ValueError('The local API requires explicit, non-opaque origins')
        self.app = app
        self.allowed_origins = frozenset(allowed_origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope['type'] == 'http' and scope['method'] != 'OPTIONS':
            origin = Headers(scope=scope).get('origin')
            # CORS controls response visibility; it does not reject simple requests.
            # Requests without Origin remain available to local CLI/extension clients.
            if origin is not None and origin not in self.allowed_origins:
                await JSONResponse({'detail': 'Origin is not allowed'}, status_code=403)(scope, receive, send)
                return
        await self.app(scope, receive, send)


class LocalAPIMiddleware:
    """Bound API bodies before JSON parsing and prevent private response caching.

    Resume PUT has a separate streaming limit in resume_routes. Body limits
    count received bytes, so a missing/false Content-Length cannot bypass them.
    """

    def __init__(self, app: ASGIApp, max_body_bytes: int = 512 * 1024) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            await self.app(scope, receive, send)
            return

        async def private_send(message):
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != b"cache-control"]
                headers.extend([(b"cache-control", b"no-store"), (b"x-content-type-options", b"nosniff")])
                message = {**message, "headers": headers}
            await send(message)

        if scope["method"] not in {"POST", "PUT", "PATCH"} or scope["path"] == "/api/resume":
            await self.app(scope, receive, private_send)
            return
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            if message["type"] != "http.request":
                continue
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > self.max_body_bytes:
                response = error_envelope(Request(scope), 413, "payload_too_large", "Request body exceeds 512 KiB") if scope["path"].startswith("/api/v1/") else JSONResponse({"detail": "Request body exceeds 512 KiB"}, status_code=413)
                await response(scope, receive, private_send)
                return
            body.extend(chunk)
            if not message.get("more_body", False):
                break
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay, private_send)
