"""Frontend bootstrap and existing interview projects; no archived workflows."""
import copy
import os
import secrets
from typing import Literal
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from career_twin.shared.core.errors import AppError
from career_twin.shared.projects.project_context import active, owner, set_cookie, current
from career_twin.shared.projects.project_store import get_store, conflict

router = APIRouter()


@router.get('/api/career/config')
def shell_config():
    from career_twin.shared.core.config import get_techmap_settings
    return dict(active_features=['ai_interview', 'cv_extraction', 'jobs'], archived=True,
        profile_editing_enabled=False, cv_diagnostics_enabled=False,
        skill_analysis_version='cv-single-pass-1', cv_extraction_mode='single_pass',
        salary=dict(min=0, max=100000, step=1000, default=0, currency='HKD', period='month'),
        sections={'personal':'基本資料','education':'學歷','experience':'工作、實習與其他經歷',
                  'project':'項目與作品','skill':'專業技能','language':'語言能力','credential':'證照、獎項與其他'},
        max_file_bytes=5*1024*1024, max_cv_chars=20000, region='Hong Kong',
        search_limit=10, search_cache_seconds=0, search_configured=bool(get_techmap_settings().api_key),
        search_provider='techmap', search_location='Hong Kong')


@router.get('/api/projects/session')
def session(request: Request, response: Response):
    active(request)
    try:
        identity = owner(request)
    except AppError:
        identity = secrets.token_hex(16)
        set_cookie(response, identity)
    return {'enabled': True, 'career_memory_available': False,
            'storage': 'cloud_sql' if os.getenv('CAREER_PROJECT_STORAGE') == 'postgres' else 'local_sqlite',
            'projects': get_store().list(identity)}


@router.get('/api/projects')
def projects(identity=Depends(owner)):
    return {'projects': get_store().list(identity)}


@router.get('/api/projects/{project_id}')
def project(project_id: str, identity=Depends(owner)):
    from career_twin.shared.matching.service import refresh
    store = get_store()
    saved = store.get(identity, project_id)
    state = saved.get('state')
    # Existing projects may contain the pre-single-pass JD format. Reuse saved
    # requirements before rendering, without calling either external provider.
    if state and saved['status'] == 'active' and refresh(state):
        state['revision'] += 1
        store.save_state(identity, project_id, saved['state_version'], state, 'jobs_refresh')
        saved['state_version'] += 1
    return saved


@router.get('/api/projects/{project_id}/history')
def history(project_id: str, identity=Depends(owner)):
    return {'items': get_store().history(identity, project_id)}


class UI(BaseModel):
    expected_revision: int = Field(ge=0)
    ui: dict = Field(default_factory=dict)


@router.put('/api/projects/{project_id}/ui')
def ui(project_id: str, body: UI, identity=Depends(owner)):
    return {'ui_revision': get_store().save_ui(identity, project_id, body.expected_revision, body.ui)}


class Transcript(BaseModel):
    document_id: str
    answer: str = Field(max_length=12000)
    reply: str = Field(max_length=16000)
    mode: Literal['voice'] = 'voice'


@router.post('/api/projects/{project_id}/interviews')
def transcript(project_id: str, body: Transcript, identity=Depends(owner)):
    get_store().interview(identity, project_id, body.document_id, body.model_dump(exclude={'document_id'}))
    return {'saved': True}


def project_context():
    context = current.get()
    if context is None:
        raise AppError('project_required', '請先開啟既有專案，或使用一般面試練習。', 422)
    return context


@router.get('/api/pilot/session')
def interview_context_session():
    context = project_context()
    return dict(revision=context.project['state_version'], consent=False,
                skills_available=False, memory_available=False, memory_backend='disabled')


@router.get('/api/pilot/memories')
def no_memories():
    project_context()
    return dict(items=[], memory_backend='disabled', fallback=False, pending_cleanup=0)


@router.get('/api/pilot/snapshot')
def snapshot():
    context = project_context()
    return {'state': context.project['state'], 'revision': context.project['state_version']}


class Sync(BaseModel):
    state: dict
    expected_revision: int = Field(ge=0)


def select_context(context, selected):
    state = copy.deepcopy(context.project['state'])
    if not state:
        raise AppError('profile_missing', '此專案沒有已保存的 CV；可使用一般面試練習。', 422)
    selected = selected or {}
    job_id, version_id = selected.get('job_id'), selected.get('version_id')
    if job_id and not any(j['id'] == job_id for j in state.get('jobs', []) + state.get('catalog_jobs', [])):
        raise AppError('project_job', '此職位不屬於目前專案。', 422)
    if version_id and not any(v['id'] == version_id and v['job_id'] == job_id for v in state.get('tailored', [])):
        raise AppError('project_version', '此版本不屬於目前面試職位。', 422)
    state['interview_context'] = {'job_id': job_id, 'version_id': version_id}
    if state != context.project['state']:
        get_store().save_state(context.owner, context.project['id'], context.project['state_version'], state, 'interview')
        context.project = {**context.project, 'state': state, 'state_version': context.project['state_version'] + 1}
    return state


@router.post('/api/pilot/sync')
def select_interview_context(body: Sync):
    context = project_context()
    state = context.project['state'] or {}
    if body.expected_revision != context.project['state_version'] or any(
            body.state.get(key) != state.get(key) for key in ('id', 'revision', 'document')):
        raise conflict()
    # The browser selects saved targets; it cannot replace CV/evidence content.
    select_context(context, body.state.get('interview_context'))
    return {'revision': context.project['state_version'], 'memory_backend': 'disabled'}


class Interview(BaseModel):
    state: dict
    expected_revision: int
    job_id: str | None = None
    version_id: str | None = None


@router.post('/api/career/interview')
def prepare_interview(body: Interview):
    context = project_context()
    state = context.project['state'] or {}
    if body.expected_revision != state.get('revision') or body.state.get('id') != state.get('id'):
        raise conflict()
    return select_context(context, {'job_id': body.job_id, 'version_id': body.version_id})
