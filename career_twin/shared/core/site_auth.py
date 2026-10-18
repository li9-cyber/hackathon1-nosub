"""Small password gate. Secrets stay server-side; workspace identities are separate."""
import base64
import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import threading
import time
from urllib.parse import quote, urlparse

from argon2 import PasswordHasher, extract_parameters
from argon2.exceptions import InvalidHashError, VerificationError
from argon2.low_level import Type
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, RedirectResponse

from career_twin.shared.core.config import WEB
from career_twin.shared.core.errors import AppError

SESSION_COOKIE = 'career_login'
CSRF_COOKIE = 'career_csrf'
SESSION_SECONDS = 8*3600
PUBLIC_FILES = {'/static/login.js', '/static/login.css', '/static/ui/tokens.css', '/static/ui/theme.js', '/static/services/base-path.js',
    '/static/brand/icon-dark.svg', '/static/brand/icon-light.svg', '/static/brand/favicon.svg'}
hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=1, hash_len=32, salt_len=16)
_attempts = {}
_lock = threading.Lock()


def enabled():
    # Existing IAP-only services retain their separate Google identity boundary.
    return os.getenv('CAREER_LOGIN_ENABLED') == '1' or bool(os.getenv('K_SERVICE') and not os.getenv('CAREER_IAP_AUDIENCE'))


def cloud():
    return bool(os.getenv('K_SERVICE'))


def signing_key():
    value = os.getenv('CAREER_LOGIN_SESSION_KEY', '')
    if len(value) < 40:
        raise ValueError('login configuration incomplete')
    return value.encode()


def validate_config():
    signing_key()
    parameters = extract_parameters(os.getenv('CAREER_LOGIN_PASSWORD_HASH', ''))
    if parameters.type is not Type.ID or parameters.memory_cost < 19456 or parameters.time_cost < 2:
        raise ValueError('invalid password hash configuration')
    if cloud() and (os.getenv('CAREER_PROJECT_STORAGE') != 'postgres'
            or len(os.getenv('CAREER_WORKSPACE_SIGNING_KEY', '')) < 40):
        raise ValueError('durable workspace configuration incomplete')


def b64(value):
    return base64.urlsafe_b64encode(value).rstrip(b'=').decode()


def token(purpose, seconds):
    payload = b64(json.dumps({'expires': int(time.time())+seconds, 'nonce': secrets.token_hex(24)}, separators=(',', ':')).encode())
    signature = b64(hmac.new(signing_key(), (purpose+'.'+payload).encode(), hashlib.sha256).digest())
    return payload+'.'+signature


def valid(value, purpose):
    try:
        if len(value) > 600:
            return False
        payload, signature = value.split('.')
        expected = b64(hmac.new(signing_key(), (purpose+'.'+payload).encode(), hashlib.sha256).digest())
        data = json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4)))
        return hmac.compare_digest(signature, expected) and isinstance(data['expires'], int) and data['expires'] > time.time()
    except (ValueError, KeyError, TypeError, UnicodeError):
        return False


def origin_ok(request):
    origin = request.headers.get('origin', '')
    expected = ('https' if cloud() else request.url.scheme)+'://'+request.headers.get('host', '')
    return bool(origin) and origin == expected and request.headers.get('sec-fetch-site') != 'cross-site'


def cookie(response, name, value, seconds):
    response.set_cookie(name, value, max_age=seconds, path='/', secure=cloud(), httponly=True, samesite='strict')


def result(code, status):
    return JSONResponse({'error': {'code': code}}, status_code=status)


def reserve_attempt(request):
    # Cloud Run appends the connecting address; never trust an arbitrary first XFF item.
    raw = request.headers.get('x-forwarded-for', '').split(',')[-1].strip() if cloud() else ''
    try:
        address = str(ipaddress.ip_address(raw or request.client.host))
    except (ValueError, AttributeError):
        address = 'unknown'
    bucket = hmac.new(signing_key(), ('login-ip:'+address).encode(), hashlib.sha256).hexdigest()
    buckets = [('global', 60, 60), (bucket, 5, 60)]
    if os.getenv('CAREER_PROJECT_STORAGE') == 'postgres':
        from career_twin.shared.projects.project_store import get_store
        return get_store().allow_login(buckets)
    timestamp = int(time.time())
    with _lock:
        for key in list(_attempts):
            if _attempts[key][0] < timestamp-120:
                del _attempts[key]
        accepted = True
        for key, limit, seconds in buckets:
            window = timestamp//seconds*seconds
            previous, count = _attempts.get(key, (window, 0))
            count = count+1 if previous == window else 1
            _attempts[key] = (window, count)
            accepted = count <= limit and accepted
        return accepted


def verify_password(password):
    try:
        return hasher.verify(os.environ['CAREER_LOGIN_PASSWORD_HASH'], password)
    except (VerificationError, InvalidHashError):
        return False


class LoginGate:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        # This exact machine route performs its own Google OIDC validation.
        # No browser cookie, password gate or workspace authorization is reused.
        if scope.get('type')=='http' and scope.get('path')=='/internal/career-memory/sync':
            return await self.app(scope,receive,send)
        if scope['type'] not in ('http', 'websocket') or not enabled():
            return await self.app(scope, receive, send)
        if os.getenv('CAREER_ACCESS_MODE') == 'beta':
            from career_twin.shared.core.beta_access import serve
            return await serve(self.app, scope, receive, send)
        if scope['type'] == 'websocket':
            # There are no WebSocket endpoints in the current voice runtime.
            return await send({'type': 'websocket.close', 'code': 4401})
        request = Request(scope, receive)
        try:
            validate_config()
        except (ValueError, InvalidHashError):
            return await self.reply(result('login_unavailable', 503), scope, receive, send)
        hosts = {urlparse(x.strip()).netloc for x in os.getenv('CAREER_LOGIN_ORIGINS', '').split(',') if x.strip()}
        if cloud() and (not hosts or request.headers.get('host') not in hosts):
            return await self.reply(result('invalid_host', 400), scope, receive, send)
        authenticated = valid(request.cookies.get(SESSION_COOKIE, ''), 'session')
        scope.setdefault('state', {})['career_authenticated'] = authenticated
        path, method = request.url.path, request.method
        response = None
        if path == '/healthz' and method in ('GET', 'HEAD'):
            response = JSONResponse({'status': 'ok'})
        elif path == '/login' and method == 'GET':
            response = FileResponse(WEB/'login.html')
        elif path == '/auth/status' and method == 'GET':
            csrf = request.cookies.get(CSRF_COOKIE, '')
            if not valid(csrf, 'csrf'):
                csrf = token('csrf', 600)
            response = JSONResponse({'authenticated': authenticated, 'csrf': csrf})
            cookie(response, CSRF_COOKIE, csrf, 600)
        elif path in ('/auth/login', '/auth/logout') and method == 'POST':
            csrf = request.headers.get('x-career-csrf', '')
            if not origin_ok(request) or not valid(csrf, 'csrf') or not hmac.compare_digest(csrf, request.cookies.get(CSRF_COOKIE, '')):
                response = result('request_rejected', 403)
            elif path == '/auth/logout':
                response = JSONResponse({'signed_out': True})
                response.delete_cookie(SESSION_COOKIE, path='/', secure=cloud(), httponly=True, samesite='strict')
                response.delete_cookie(CSRF_COOKIE, path='/', secure=cloud(), httponly=True, samesite='strict')
            else:
                try:
                    if not await run_in_threadpool(reserve_attempt, request):
                        response = result('try_later', 429)
                        response.headers['Retry-After'] = '60'
                    else:
                        body = b''
                        async for chunk in request.stream():
                            body += chunk
                            if len(body) > 2048:
                                break
                        password = json.loads(body).get('password') if len(body) <= 2048 else None
                        if not isinstance(password, str) or not 1 <= len(password) <= 256:
                            response = result('invalid_credentials', 401)
                        elif await run_in_threadpool(verify_password, password):
                            response = JSONResponse({'authenticated': True})
                            cookie(response, SESSION_COOKIE, token('session', SESSION_SECONDS), SESSION_SECONDS)
                        else:
                            response = result('invalid_credentials', 401)
                except (ValueError, TypeError, AttributeError):
                    response = result('invalid_credentials', 401)
                except AppError:
                    response = result('login_unavailable', 503)
        elif path in PUBLIC_FILES and method in ('GET', 'HEAD'):
            return await self.app(scope, receive, send)
        elif path.startswith('/auth/'):
            response = result('not_found', 404)
        elif not authenticated:
            if path.startswith('/api/'):
                response = result('login_required', 401)
            else:
                target = request.url.path+('?' + request.url.query if request.url.query else '')
                response = RedirectResponse('/login?next='+quote(target, safe=''), status_code=303)
        elif method not in ('GET', 'HEAD', 'OPTIONS') and not origin_ok(request):
            response = result('request_rejected', 403)
        elif os.getenv('CAREER_ADMIN_DISABLED') == '1' and (path.startswith('/admin') or path.startswith('/api/admin/')):
            response = result('admin_separate_service', 403)
        if response is not None:
            return await self.reply(response, scope, receive, send)
        return await self.app(scope, receive, send)

    @staticmethod
    async def reply(response, scope, receive, send):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"
        if cloud():
            response.headers['Strict-Transport-Security'] = 'max-age=31536000'
        await response(scope, receive, send)
