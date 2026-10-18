"""Password-free trial admission and bounded usage, serialized in Cloud SQL.

Browser leases are anonymous capacity controls, not proof of a person's identity.
No IP addresses, credentials or user content are stored in the limiter ledger.
"""
import asyncio
import hashlib
import hmac
import ipaddress
import os
import re
import secrets
import threading
import time
from urllib.parse import urlparse

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, RedirectResponse

from career_twin.shared.core.config import WEB
from career_twin.shared.core.errors import AppError

COOKIE = 'career_trial'
def limit(name, default, maximum):
    return max(1, min(maximum, int(os.getenv('CAREER_BETA_' + name, str(default)))))


MAX_USERS = limit('MAX_USERS', 50, 50)
IDLE_SECONDS = 600
MAX_AI = limit('MAX_AI', 50, 50)
AI_DAILY = limit('AI_DAILY', 10000, 100000)  # Operations, not tokens or dollars.
API_PER_MINUTE = limit('API_PER_MINUTE', 20000, 100000)
IP_PER_MINUTE = limit('IP_PER_MINUTE', 10000, 100000)
USER_PER_MINUTE = limit('USER_PER_MINUTE', 300, 2000)
AI_PER_MINUTE = limit('AI_PER_MINUTE', 30, 300)
AI_PER_HOUR = limit('AI_PER_HOUR', 600, 10000)
RESUMABLE = {'/api/career/extract', '/api/career/normalize',
             '/api/career/clarifications/analyze', '/api/career/clarifications/prepare'}
LEASE_SECONDS = 600
MESSAGES = {
    'trial_full': f'目前已有 {MAX_USERS} 位使用者使用中，請稍後再試。 / All {MAX_USERS} places are occupied. Please try again later.',
    'trial_rate': '操作太頻繁，請稍候再試。 / Too many requests. Please try again shortly.',
    'trial_ai_busy': 'AI 正在處理其他請求，請稍候重試。 / AI is busy. Please try again shortly.',
    'trial_daily': '今天的 AI 測試用量已達上限，請明天再試；已保存的資料仍可查看。 / Today’s AI trial allowance is exhausted; saved work remains available.',
    'trial_session': '請重新整理頁面以進入測試，已有專案仍保留。 / Refresh this page to rejoin the trial; saved projects are retained.',
    'trial_unavailable': '測試服務暫時無法使用，請稍後重試。 / The trial is temporarily unavailable.',
    'trial_timeout': '請求逾時，請稍後重試；已有資料仍保留。 / Request timed out; saved work is retained.',
    'request_cancelled': '已取消這次處理；已有資料保留。 / Processing cancelled; saved work is retained.',
    'operation_in_progress': '你已有一項處理正在進行，請回到原專案查看進度。 / Your previous operation is still running. Return to that project to view progress.',
    'operation_already_finished': '這項處理已結束，請重新載入最新資料。 / This operation has finished. Reload the latest saved information.',
}


def transition(state, *, identity='', address='', kind='api', ticket='', request_id='', timestamp=None, stage='', stage_limit=None,
               project_id='', path='', outcome='completed', error_code='', parallel_jd=False):
    """One atomic decision. Caller must lock, persist even denials, then unlock."""
    now = int(time.time() if timestamp is None else timestamp)
    sessions = state.setdefault('sessions', {})
    counters = state.setdefault('counters', {})
    jobs = state.setdefault('jobs', {})
    cancellations = state.setdefault('cancellations', {})
    operations = state.setdefault('operations', {})
    def remember(job, status, code=''):
        if not job.get('project_id') or not job.get('request_id'):
            return
        operations[job['owner'] + ':' + job['project_id']] = {
            **job, 'status': status, 'finished': now, 'expires': now + 86400, 'error_code': code}
        # Metadata only, at most one latest completion per owner/project.
        if len(operations) > 4000:
            oldest = min(operations, key=lambda k: operations[k].get('finished', 0))
            del operations[oldest]
    for key in list(operations):
        if operations[key]['expires'] <= now:
            del operations[key]
    for key in list(cancellations):
        if cancellations[key] <= now:
            del cancellations[key]
    for key in list(sessions):
        if sessions[key] <= now:
            del sessions[key]
    for key in list(counters):
        if counters[key][0] <= now:
            del counters[key]
    for key in list(jobs):
        if jobs[key]['expires'] <= now:
            remember(jobs[key], 'interrupted', 'operation_interrupted')
            del jobs[key]
    if kind == 'finish':
        job = jobs.pop(ticket, None)
        if job:
            remember(job, outcome, error_code)
        return {'ok': True}
    if kind == 'leave':
        sessions.pop(identity, None)
        # In-flight AI remains counted until its own finally block or expiry.
        return {'ok': True}
    if kind == 'progress':
        from career_twin.shared.core.request_lifecycle import STAGES
        job=jobs.get(ticket)
        if job and job['owner']==identity and stage in STAGES:
            job.update(stage=stage,stage_started=now,stage_limit=STAGES[stage])
        return {'ok':True}
    if kind in ('cancel', 'operation'):
        key = identity + ':' + request_id
        if kind == 'cancel':
            if key not in cancellations and len(cancellations) >= 4000:
                return {'ok': False, 'code': 'trial_rate', 'retry': 5}
            # Also covers cancel arriving just before the original admission.
            cancellations[key] = now + LEASE_SECONDS
        matches = lambda j: j['owner'] == identity and (not project_id or j.get('project_id') == project_id) and (not request_id or j.get('request_id') == request_id)
        job = next((j for j in jobs.values() if matches(j)), None)
        pending = job is not None
        completed = next((j for j in operations.values() if matches(j)), None) if not pending else None
        progress=({'stage':job.get('stage','starting'),'elapsed_seconds':max(0,now-job.get('started',now)),
                   'stage_elapsed_seconds':max(0,now-job.get('stage_started',now)),
                   'stage_limit_seconds':job.get('stage_limit')} if job else None)
        record = job or completed
        operation = ({k: record.get(k) for k in ('request_id', 'project_id', 'path', 'started', 'finished', 'error_code')}
                     | {'status': 'running' if pending else record['status']}) if record else None
        return {'ok': True, 'pending': pending, 'cancelled': key in cancellations, 'progress':progress, 'operation':operation}

    def denied(code, retry=60):
        return {'ok': False, 'code': code, 'retry': retry}

    def rate(key, limit, seconds):
        expiry = (now // seconds + 1) * seconds
        if key not in counters and len(counters) >= 10000:
            return False
        old = counters.get(key, [expiry, 0])
        count = old[1] if old[0] == expiry else 0
        counters[key] = [expiry, min(count + 1, limit + 1)]
        return count < limit

    # Cheap counters are bounded even for repeated admission attempts.
    if not rate('all', API_PER_MINUTE, 60) or not rate('ip:'+address, IP_PER_MINUTE, 60):
        return denied('trial_rate')
    if not rate('browser:'+identity, USER_PER_MINUTE, 60):
        return denied('trial_rate')
    if identity not in sessions and len(sessions) >= MAX_USERS:
        return denied('trial_full', 30)
    sessions[identity] = now + IDLE_SECONDS
    if kind == 'ai':
        if request_id and identity + ':' + request_id in cancellations:
            return denied('request_cancelled', 0)
        owned = [j for j in jobs.values() if j['owner'] == identity]
        if owned and not (parallel_jd and len(owned) < 3 and all(j.get('path') == '/api/career/job/extract' for j in owned)):
            return denied('operation_in_progress', 2)
        if any(j['owner'] == identity and j.get('request_id') == request_id for j in operations.values()) and request_id:
            return denied('operation_already_finished', 0)
        if len(jobs) >= MAX_AI:
            return denied('trial_ai_busy', 5)
        # Check the global daily quota before charging per-browser usage.
        daily = counters.get('ai:day', [0, 0])
        if daily[0] > now and daily[1] >= AI_DAILY:
            return denied('trial_daily', (now // 86400 + 1) * 86400 - now)
        if not rate('ai:ip:'+address, MAX_USERS * AI_PER_MINUTE, 60) or not rate('ai:minute:'+identity, AI_PER_MINUTE, 60) or not rate('ai:hour:'+identity, AI_PER_HOUR, 3600):
            return denied('trial_rate')
        if not rate('ai:day', AI_DAILY, 86400):
            return denied('trial_rate')
        jobs[ticket] = {'owner': identity, 'expires': now + LEASE_SECONDS, 'request_id': request_id,
                        'started':now, 'project_id':project_id, 'path':path}
    return {'ok': True}


class LocalLedger:
    """Local/test fallback only. Cloud mode always requires durable SQL storage."""
    def __init__(self):
        self.state, self.lock = {}, threading.Lock()

    def beta_change(self, **kwargs):
        with self.lock:
            return transition(self.state, **kwargs)


local_ledger = LocalLedger()


def ledger():
    if os.getenv('K_SERVICE') or os.getenv('CAREER_PROJECT_STORAGE') == 'postgres':
        from career_twin.shared.projects.project_store import get_store
        return get_store()
    return local_ledger


def key():
    from career_twin.shared.projects.project_context import key as workspace_key
    return workspace_key()


def sign(identity):
    return identity+'.'+hmac.new(key(), ('trial:'+identity).encode(), hashlib.sha256).hexdigest()


def browser(request):
    value = request.cookies.get(COOKIE, '')
    identity = value.split('.')[0]
    if len(identity) == 32 and all(c in '0123456789abcdef' for c in identity) and hmac.compare_digest(value.encode('utf-8'), sign(identity).encode('ascii')):
        return identity
    return ''


def address_hash(request):
    # The trusted Cloud Run ingress appends the connecting IP. A client-supplied
    # first XFF entry must not reset this supplemental rate limit.
    raw = request.headers.get('x-forwarded-for', '').split(',')[-1].strip() if os.getenv('K_SERVICE') else ''
    try:
        address = str(ipaddress.ip_address(raw or request.client.host))
    except (ValueError, AttributeError):
        address = 'unknown'
    return hmac.new(key(), ('trial-ip:'+address).encode(), hashlib.sha256).hexdigest()


def expensive(path, method):
    if method in ('GET', 'HEAD', 'OPTIONS', 'DELETE'):
        return False
    if path.startswith('/api/projects'):
        return False
    if path in ('/api/career/job/overview','/api/career/job/questions'):
        return False  # grounded read/proposal preparation; no model generation
    if path.startswith('/api/career-memory') and path!='/api/career-memory/sync':
        # Corrections, permission withdrawal and deletion must work while AI is
        # busy. They only commit authority/outbox; sync is a separate operation.
        return False
    if path.startswith('/api/interview/') and path.endswith(('/stop', '/end')):
        return False
    if path.startswith('/api/pilot/') and path != '/api/pilot/turn':
        return False
    if path in {'/api/career/parse', '/api/career/preferences', '/api/career/item', '/api/career/items',
                '/api/career/profile/edit', '/api/career/profile/decision', '/api/career/profile/restore',
                '/api/career/base-confirm', '/api/career/export', '/api/profile/review', '/api/settings',
                '/api/plan', '/api/plan/progress', '/api/chat/fact','/api/career/clarifications/save'}:
        return False
    # Conservatively protect every other mutation, including future AI routes.
    return True


def error(code, status=429, retry=60):
    return JSONResponse({'error': {'code': code, 'message': MESSAGES.get(code, MESSAGES['trial_unavailable'])}},
                        status_code=status, headers={'Retry-After': str(retry)})


async def serve(app, scope, receive, send):
    from career_twin.shared.core.site_auth import LoginGate, cloud, origin_ok
    reply = lambda response: LoginGate.reply(response, scope, receive, send)
    if scope['type'] == 'websocket':
        return await send({'type': 'websocket.close', 'code': 4403})
    request = Request(scope, receive)
    path, method = request.url.path, request.method
    try:
        if cloud() and (os.getenv('CAREER_IAP_AUDIENCE') or os.getenv('CAREER_PROJECT_STORAGE') != 'postgres'
                        or len(os.getenv('CAREER_WORKSPACE_SIGNING_KEY', '')) < 40):
            return await reply(error('trial_unavailable', 503))
        hosts = {urlparse(x.strip()).netloc for x in os.getenv('CAREER_LOGIN_ORIGINS', '').split(',') if x.strip()}
        if cloud() and (not hosts or request.headers.get('host') not in hosts):
            return await reply(JSONResponse({'error': {'code': 'invalid_host'}}, status_code=400))
        # These boundaries apply even with password login removed.
        if path.startswith(('/admin', '/api/admin/')) or path in ('/docs', '/redoc', '/openapi.json', '/api/health/database', '/static/career-admin.html'):
            return await reply(JSONResponse({'error': {'code': 'admin_separate_service'}}, status_code=403))
        if method not in ('GET', 'HEAD', 'OPTIONS') and not origin_ok(request):
            return await reply(JSONResponse({'error': {'code': 'request_rejected'}}, status_code=403))
        if path == '/healthz' and method in ('GET', 'HEAD'):
            return await reply(JSONResponse({'status': 'ok'}))
        if path == '/auth/status' and method == 'GET':
            return await reply(JSONResponse({'mode': 'beta', 'authenticated': True, 'csrf': '',
                                             'max_users': MAX_USERS, 'idle_seconds': IDLE_SECONDS}))
        if path == '/login' and method == 'GET':
            return await reply(RedirectResponse('/', status_code=303))
        if path.startswith('/static/') and method in ('GET', 'HEAD'):
            return await app(scope, receive, send)
        identity = browser(request)
        if path == '/auth/logout' and method == 'POST':
            if identity:
                await run_in_threadpool(ledger().beta_change, kind='leave', identity=identity)
            return await reply(JSONResponse({'signed_out': True, 'mode': 'beta'}))
        if path.startswith('/auth/') or not (path in ('/', '/legacy') or path.startswith('/api/')):
            return await reply(JSONResponse({'error': {'code': 'not_found'}}, status_code=404))
        page = path in ('/', '/legacy') and method in ('GET', 'HEAD')
        if not identity and not page:
            return await reply(error('trial_session', 428))
        fresh = not identity
        identity = identity or secrets.token_hex(16)
        request_id = request.headers.get('x-career-request-id', '')
        if request_id and not re.fullmatch(r'[A-Za-z0-9_-]{16,64}', request_id):
            return await reply(JSONResponse({'error': {'code': 'invalid_request_id'}}, status_code=400))
        project_id = request.headers.get('x-career-project', '')
        resumable = path in RESUMABLE and method == 'POST' and bool(project_id and request_id)
        if (path == '/api/operations/status' or resumable) and project_id:
            # Status is protected by both the signed trial identity and project ownership.
            from career_twin.shared.projects.project_context import owner
            from career_twin.shared.projects.project_store import get_store
            scope.setdefault('state', {})['career_authenticated'] = True
            project_owner = owner(request)
            await run_in_threadpool(get_store().get, project_owner, project_id, active=True)
        if path == '/api/operations/status' and method == 'GET':
            admitted=await run_in_threadpool(ledger().beta_change,identity=identity,address=address_hash(request))
            if not admitted['ok']:return await reply(error(admitted['code'],retry=admitted['retry']))
            if not request_id and not project_id:return await reply(JSONResponse({'error':{'code':'invalid_request_id'}},status_code=400))
            decision=await run_in_threadpool(ledger().beta_change,kind='operation',identity=identity,request_id=request_id,project_id=project_id)
            return await reply(JSONResponse({k:decision[k] for k in ('pending','progress','operation')}))
        if path == '/api/operations/cancel' and method == 'POST':
            admitted = await run_in_threadpool(ledger().beta_change, identity=identity, address=address_hash(request))
            if not admitted['ok']:
                return await reply(error(admitted['code'], retry=admitted['retry']))
            if not request_id:
                return await reply(JSONResponse({'error': {'code': 'invalid_request_id'}}, status_code=400))
            decision = await run_in_threadpool(ledger().beta_change, kind='cancel', identity=identity, request_id=request_id)
            if not decision['ok']:
                return await reply(error(decision['code'], retry=decision['retry']))
            from career_twin.shared.core.request_lifecycle import signal
            signal(identity, request_id)
            for _ in range(25):
                decision = await run_in_threadpool(ledger().beta_change, kind='operation', identity=identity, request_id=request_id)
                if not decision['pending']:
                    break
                await asyncio.sleep(.2)
            return await reply(JSONResponse({'pending': decision['pending']}))
        is_ai = expensive(path, method)
        ticket = secrets.token_hex(16) if is_ai else ''
        decision = await run_in_threadpool(ledger().beta_change, identity=identity, address=address_hash(request),
                                          kind='ai' if is_ai else 'api', ticket=ticket, request_id=request_id,
                                          project_id=project_id if resumable else '',
                                          path=path if resumable or path == '/api/career/job/extract' else '',
                                          parallel_jd=path == '/api/career/job/extract')
        if not decision['ok']:
            if page and decision['code'] == 'trial_full':
                return await reply(FileResponse(WEB/'trial-full.html', status_code=429, headers={'Retry-After': '30'}))
            return await reply(error(decision['code'], status=409 if decision['code'] in ('request_cancelled','operation_in_progress','operation_already_finished') else 429, retry=decision['retry']))
    except AppError as failure:
        if failure.status_code in (401,403,404):
            return await reply(JSONResponse({'error':{'code':failure.code,'message':failure.message}},status_code=failure.status_code))
        return await reply(error('trial_unavailable', 503))
    except ValueError:
        return await reply(error('trial_unavailable', 503))

    scope.setdefault('state', {})['career_authenticated'] = True
    started = False
    response_status = 500
    outcome, failure_code = 'failed', 'operation_failed'
    ticket_released = False

    async def send_cookie(message):
        nonlocal started, response_status, ticket_released
        if message['type'] == 'http.response.start':
            started = True
            response_status = message['status']
            if fresh:
                response = JSONResponse({})
                response.set_cookie(COOKIE, sign(identity), max_age=365*86400, path='/',
                                    secure=cloud(), httponly=True, samesite='strict')
                message = {**message, 'headers': [*message.get('headers', []),
                           *[(k, v) for k, v in response.raw_headers if k == b'set-cookie']]}
        if (is_ai and path == '/api/career/job/extract' and message['type'] == 'http.response.body'
                and not message.get('more_body', False)):
            # Free this completed slot before the browser starts its next JD.
            # Otherwise a finished HTTP response briefly still occupies the cap.
            try:
                await run_in_threadpool(ledger().beta_change, kind='finish', ticket=ticket,
                                       outcome='completed' if response_status < 400 else 'failed', error_code='')
                ticket_released = True
            except AppError:
                pass
        await send(message)

    try:
        if is_ai:
            # Always shorter than the durable job lease, including streaming.
            from career_twin.shared.core.request_lifecycle import run
            async def cancelled():
                if not request_id:
                    return False
                decision = await run_in_threadpool(ledger().beta_change, kind='operation', identity=identity, request_id=request_id)
                return decision['cancelled']
            async def progress(stage,limit):
                await run_in_threadpool(ledger().beta_change,kind='progress',identity=identity,ticket=ticket,stage=stage,stage_limit=limit)
            async with asyncio.timeout(240):
                outcome = await run(app, scope, receive, send_cookie, identity, request_id or ticket, cancelled,progress,
                                    continue_on_disconnect=resumable or path in ('/api/career/job/extract','/api/career/job/deep','/api/career/supplement'))
                if outcome == 'completed' and response_status >= 400:
                    outcome = 'failed'
                if outcome == 'completed':failure_code = ''
                elif outcome == 'cancelled':failure_code = 'request_cancelled'
                elif outcome == 'disconnected':failure_code = 'operation_interrupted'
                if outcome == 'cancelled' and not started:
                    await reply(error('request_cancelled', 409, 0))
        else:
            await app(scope, receive, send_cookie)
    except TimeoutError:
        outcome, failure_code = 'failed', 'trial_timeout'
        if not started:
            await reply(error('trial_timeout', 504))
        else:
            await send({'type': 'http.response.body', 'body': b'', 'more_body': False})
    finally:
        if is_ai and not ticket_released:
            try:
                await asyncio.shield(run_in_threadpool(ledger().beta_change, kind='finish', ticket=ticket,
                                                       outcome=outcome, error_code=failure_code))
            except AppError:
                pass  # Keep the lease until expiry if SQL is unavailable.
