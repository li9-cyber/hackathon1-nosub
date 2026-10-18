"""CV endpoints adapt requests to profile services; other workflows stay untouched."""
import copy
from typing import Literal
from urllib.parse import quote
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from career_twin.shared.core.errors import AppError
from career_twin.shared.projects.project_context import owner
from career_twin.shared.projects.project_store import get_store, conflict
from .documents import MAX_CHARS, parse_document, validate_text
from .projection import initial_state
from .service import context, saved_state, save, expire, extract_state

router = APIRouter()


class Document(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=MAX_CHARS)
    format: Literal['text', 'txt', 'pdf', 'docx'] = 'text'
    file_name: str = Field(default='', max_length=255)
    file_size: int = Field(default=0, ge=0)
    parse_seconds: float = Field(default=0, ge=0)


class Preferences(BaseModel):
    minimum_salary: int = Field(default=0, ge=0)
    currency: str = 'HKD'
    period: str = 'month'
    target_role: str | None = None
    job_type: str | None = None


class Start(BaseModel):
    document: Document
    preferences: Preferences = Field(default_factory=Preferences)


class Mutation(BaseModel):
    state: dict
    expected_revision: int = Field(ge=1)


class Replace(Mutation, Start):
    pass


class PreferenceUpdate(Mutation):
    preferences: Preferences


class NewProject(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    mode: Literal['fresh'] = 'fresh'


class Supplement(Mutation):
    item_id: str = Field(min_length=1, max_length=100)
    submission_id: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=4000)
    retry: bool = False


@router.post('/api/career/supplement')
async def supplement(body: Supplement):
    from .supplements import submit
    return await submit(body)


@router.post('/api/projects')
def create_project(body: NewProject, identity=Depends(owner)):
    return get_store().create(identity, body.name)


@router.get('/api/projects/{project_id}/cv')
def download_cv(project_id: str, document_id: str, identity=Depends(owner)):
    store = get_store()
    stored = store.get_cv_file(identity, project_id, document_id)
    if stored:
        content, filename = stored['content'], stored['filename']
    else:
        state = store.get(identity, project_id)['state']
        if not state or state['document']['id'] != document_id:
            raise AppError('cv_missing', '找不到這份 CV。', 404)
        content, filename = state['document']['text'].encode('utf-8'), 'CV.txt'
    return Response(content, media_type='application/octet-stream',
                    headers={'Content-Disposition': "attachment; filename*=UTF-8''" + quote(filename)})


@router.post('/api/career/parse')
async def parse(request: Request, filename: str):
    ctx = context()
    content = await request.body()
    from starlette.concurrency import run_in_threadpool
    document = await run_in_threadpool(parse_document, filename, content)
    get_store().save_cv_file(ctx.owner, ctx.project['id'], ctx.project['state_version'],
                            document['id'], document['file_name'], content)
    return document


def checked_document(document):
    result = document.model_dump()
    if document.file_name:
        ctx = context()
        stored = get_store().get_cv_file(ctx.owner, ctx.project['id'], document.id)
        if not stored or stored['filename'] != document.file_name or len(stored['content']) != document.file_size:
            raise AppError('cv_file_missing', '原檔未保存，請重新上傳。', 409)
        result = parse_document(stored['filename'], stored['content'])
        result['id'] = document.id
    else:
        result['text'] = validate_text(document.text)
        result.update(format='text', file_size=0, parse_seconds=0)
    return result


@router.post('/api/career/start')
def start(body: Start):
    if context().project['state']:
        raise conflict()
    return save(initial_state(checked_document(body.document), body.preferences.model_dump()), 'start')


@router.post('/api/career/replace')
def replace(body: Replace):
    old = saved_state(body)
    fresh = initial_state(checked_document(body.document), body.preferences.model_dump())
    if fresh['document']['id'] == old['document']['id']:
        raise conflict()
    # Replace CV-owned fields only; retain other feature state and prior artifacts.
    state = copy.deepcopy(old)
    keys = ('document', 'preferences', 'items', 'sources', 'questions', 'claims', 'capabilities',
            'skill_evidence', 'activity_evidence', 'clarifications', 'evidence_updates', 'activity_issues',
            'extracted', 'standardized_cv', 'evidence_profile', 'cv_skill_version', 'normalization_notice',
            'skill_analysis_notice', 'cv_extraction')
    state.update({key: fresh[key] for key in keys})
    state['revision'] += 1
    return save(state, 'replace')


@router.post('/api/career/preferences')
def preferences(body: PreferenceUpdate):
    state = saved_state(body)
    state['preferences'] = body.preferences.model_dump()
    state['revision'] += 1
    return save(state, 'preferences')


@router.post('/api/career/extract')
async def extract(body: Mutation):
    return await extract_state(body)


@router.get('/api/career/extraction')
def extraction_status():
    return expire(saved_state())
