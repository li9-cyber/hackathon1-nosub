"""Signed local workspace identity and request-scoped project authorization."""
import hashlib
import hmac
import os
import secrets
from contextvars import ContextVar
from dataclasses import dataclass
from urllib.parse import urlparse
from fastapi import Request

from career_twin.shared.core.errors import AppError
from career_twin.shared.projects.project_store import data_dir, get_store, conflict

COOKIE = 'career_workspace'
current = ContextVar('career_project', default=None)


def active(request):
    cloud = bool(os.getenv('K_SERVICE'))
    if cloud:
        if os.getenv('CAREER_PROJECT_STORAGE') != 'postgres' or not getattr(request.state, 'career_authenticated', False):
            raise AppError('projects_login_required', '請先登入工作區。', 403)
    elif request.url.hostname not in ('localhost', '127.0.0.1', '::1') or not request.client or request.client.host not in ('127.0.0.1', '::1'):
        raise AppError('projects_local_only', '專案工作區目前供本機使用。', 403)
    if request.method not in ('GET', 'HEAD', 'OPTIONS'):
        origin = urlparse(request.headers.get('origin', ''))
        if origin.scheme != ('https' if cloud else request.url.scheme) or origin.netloc != request.headers.get('host'):
            raise AppError('project_origin', '請從目前工作區操作。', 403)


def key():
    if os.getenv('K_SERVICE'):
        value = os.getenv('CAREER_WORKSPACE_SIGNING_KEY', '')
        if len(value) < 40:
            raise AppError('workspace_unavailable', '工作區設定尚未完成。', 503)
        return value.encode()
    path = data_dir() / 'identity.key'
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open('xb') as f:
            f.write(secrets.token_bytes(32))
    except FileExistsError:
        pass
    return path.read_bytes()


def owner(request: Request):
    active(request)
    parts = request.cookies.get(COOKIE, '').split('.')
    if len(parts) == 2 and len(parts[0]) == 32 and all(c in '0123456789abcdef' for c in parts[0]):
        expected = hmac.new(key(), parts[0].encode(), hashlib.sha256).hexdigest()
        if hmac.compare_digest(parts[1], expected):
            return parts[0]
    raise AppError('workspace_session', '請重新開啟工作區以建立本機連線。', 401)


def set_cookie(response, identity):
    signature = hmac.new(key(), identity.encode(), hashlib.sha256).hexdigest()
    response.set_cookie(COOKIE, identity + '.' + signature, httponly=True, secure=bool(os.getenv('K_SERVICE')), samesite='strict', path='/api', max_age=365 * 86400)


@dataclass
class Context:
    owner: str
    project: dict
    action: str

    @property
    def scoped_owner(self):
        return hashlib.sha256((self.owner + ':' + self.project['id']).encode()).hexdigest()


def record_interview(document_id, detail):
    context = current.get()
    if context:
        get_store().interview(context.owner, context.project['id'], document_id, detail)
