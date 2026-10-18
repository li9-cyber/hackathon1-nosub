"""Shared HTTP limits, safe errors, security headers and identity contexts."""
from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from career_twin.shared.core.errors import AppError
from career_twin.interview.runtime.cloudrun.store import Rejected as VoiceRejected

class RequestBodyLimit:
    """Bound actual bytes, including requests without Content-Length."""
    def __init__(self, app, max_bytes=1_000_000):
        self.app, self.max_bytes = app, max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in ("POST", "PUT", "PATCH"):
            return await self.app(scope, receive, send)
        chunks, total = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            total += len(chunk)
            limit = 6_600_000 if scope["path"].startswith("/api/interview/") and scope["path"].endswith("/chat-stream") else 5 * 1024 * 1024 if scope["path"] == "/api/career/parse" else 3 * 1024 * 1024 if scope["path"].startswith(("/api/career/", "/api/projects")) else self.max_bytes
            if total > limit:
                response = JSONResponse(status_code=413, content={"error": {"code": "too_large", "message": "資料或檔案超出大小限制，請縮小後再試；已有資料仍保留。"}})
                return await response(scope, receive, send)
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


def install_http(app):
    @app.middleware("http")
    async def response_headers(request: Request, call_next):
        if request.url.path.startswith('/api/interview/') and request.method == 'POST':
            origin = request.headers.get('origin')
            if (origin and origin != str(request.base_url).rstrip('/')) or request.headers.get('sec-fetch-site') == 'cross-site':
                return JSONResponse(status_code=403, content={'error': {'code': 'ORIGIN_REQUIRED'}})
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        if request.url.path in ("/", "/legacy"):
            response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
            if request.url.path == "/legacy":
                response.headers["Content-Security-Policy"] = response.headers["Content-Security-Policy"].replace("frame-ancestors 'none'", "frame-ancestors 'self'")
        if request.url.path == '/static/interview/avatar.html':
            response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; media-src 'self' blob:; img-src 'self' blob:; style-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"
        if request.url.path == '/static/interview/attention/realeye-worker.js':
            # Inference runs in this same-origin worker; grant WASM only here.
            response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; object-src 'none'"
        if request.url.path.startswith('/static/interview/vendor/sr-20261002-v1/'):
            response.headers['Cache-Control'] = 'private, max-age=31536000, immutable'
        return response


    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, error: AppError):
        body = {"code": error.code, "message": error.message}
        if error.retry_at:
            body['retry_at'] = error.retry_at
        return JSONResponse(status_code=error.status_code, content={"error": body})


    @app.exception_handler(VoiceRejected)
    async def voice_error_handler(request: Request, error: VoiceRejected):
        return JSONResponse(status_code=error.status, content={'error': {'code': error.code}})


    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, error: RequestValidationError):
        # FastAPI's default errors echo submitted input. Never expose those payloads.
        return JSONResponse(status_code=422, content={"error": {
            "code": "invalid_input", "message": "輸入不完整或格式不正確。請確認必填內容、文字長度、金額單位及非負數值。",
        }})


    @app.exception_handler(Exception)
    async def unexpected_error_handler(request: Request, error: Exception):
        return JSONResponse(status_code=500, content={"error": {
            "code": "internal_error", "message": "服務暫時無法完成請求，請確認後端設定後重試。",
        }})


def install_identity_context(app):
    @app.middleware('http')
    async def project_identity_context(request: Request, call_next):
        from career_twin.shared.projects.project_context import current, Context, owner as workspace_owner
        from career_twin.shared.projects.project_store import get_store as project_store
        token = None
        try:
            project_id = request.headers.get('x-career-project')
            if project_id:
                identity = workspace_owner(request)
                project = project_store().get(identity, project_id, active=True)
                token = current.set(Context(identity, project, request.url.path.rsplit('/', 1)[-1]))
            return await call_next(request)
        except AppError as error:
            return JSONResponse(status_code=error.status_code, content={'error': {'code': error.code, 'message': error.message}})
        finally:
            if token is not None:
                current.reset(token)

