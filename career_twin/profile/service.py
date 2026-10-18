"""Scoped state transitions; no new database or browser-owned profile store."""
import copy
import time
from uuid import uuid4
from career_twin.shared.core.errors import AppError
from career_twin.shared.projects.project_context import current
from career_twin.shared.projects.project_store import get_store, conflict
from . import provider
from .projection import project


def context():
    value = current.get()
    if value is None:
        raise AppError('project_required', '請先建立或開啟專案。', 422)
    return value


def saved_state(body=None):
    ctx = context()
    state = ctx.project.get('state')
    if not state:
        raise AppError('cv_missing', '請先保存 CV。', 422)
    if body and (body.expected_revision != state['revision'] or body.state.get('id') != state['id']):
        raise conflict()
    return copy.deepcopy(state)


def save(state, kind):
    from career_twin.shared.matching.service import refresh
    refresh(state)
    ctx = context()
    get_store().save_state(ctx.owner, ctx.project['id'], ctx.project['state_version'], state, kind)
    ctx.project = {**ctx.project, 'state': state, 'state_version': ctx.project['state_version'] + 1}
    return state


def expire(state):
    changed = False
    attempt = state.get('cv_extraction', {})
    if attempt.get('status') == 'running' and time.time() > attempt['deadline_at']:
        state['cv_extraction'] = {**attempt, 'status': 'timeout', 'error_code': 'cv_timeout',
            'message': 'CV 抽取已超時或中斷，原文及上次成功結果已保留，可手動重試。'}
        changed = True
    for record in (state.get('evidence_profile') or {}).get('supplemental_evidence', []):
        if record.get('analysis_status') == 'running' and time.time() > record['deadline_at']:
            record.update(analysis_status='timeout', message='補充原文已保存；分析已超時或中斷，可重試這段補充。')
            changed = True
    if changed:
        state['revision'] += 1
        save(state, 'cv_timeout')
    return state


async def extract_state(body):
    from .supplements import records, active, preserve
    state = saved_state(body)
    if any(active(record) for record in records(state)):
        raise AppError('cv_in_progress', '補充資訊正在更新，請等待完成。', 409)
    if state.get('cv_extraction', {}).get('status') == 'running':
        state = expire(state)
        if state['cv_extraction']['status'] == 'running':
            raise AppError('cv_in_progress', '這份 CV 正在抽取，請等待結果。', 409)
    started = time.perf_counter()
    attempt = dict(id=uuid4().hex, document_id=state['document']['id'], status='running',
                   started_at=time.time(), deadline_at=time.time() + 30, model='deepseek-flash')
    state['cv_extraction'] = attempt
    state['revision'] += 1
    save(state, 'cv_extract_started')
    try:
        result = await provider.extract(state['document']['text'])
        projection = preserve(state, project(state['document'], result))
        state.update(projection)
        outcome = dict(status='success', message='CV 抽取成功。')
    except AppError as error:
        outcome = dict(status='timeout' if error.code == 'cv_timeout' else 'failed',
                       error_code=error.code, message=error.message)
    except Exception:
        outcome = dict(status='failed', error_code='cv_extract_failed', message='CV 抽取失敗，原文及上次成功結果已保留。')
    # Reload the latest version: UI/interview writes may have occurred while AI ran.
    # Only this attempt may commit; never overwrite a replacement CV or newer attempt.
    ctx = context()
    latest = get_store().get(ctx.owner, ctx.project['id'], active=True)
    current_state = latest['state']
    if (current_state['document']['id'] != attempt['document_id'] or
            current_state.get('cv_extraction', {}).get('id') != attempt['id'] or
            current_state['cv_extraction']['status'] != 'running'):
        raise conflict()
    ctx.project = latest
    if outcome['status'] == 'success':
        current_state.update(projection)
    current_state['revision'] += 1
    elapsed = round(time.perf_counter() - started, 3)
    current_state['cv_extraction'] = {**attempt, **outcome, 'elapsed_seconds': elapsed,
        'processing_seconds': round(elapsed + state['document'].get('parse_seconds', 0), 3)}
    return save(current_state, 'cv_extract_' + outcome['status'])
