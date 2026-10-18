import asyncio
import copy
import json
import time
import httpx
import pymupdf
import pytest
from fastapi.testclient import TestClient
from career_twin.api.main import app
from career_twin.profile import provider
from career_twin.profile.documents import parse_document
from career_twin.profile.projection import project, spans
from career_twin.shared.core.errors import AppError
from career_twin.shared.projects.project_store import get_store
from tests.profile.fixtures import TEXT, NAMES, document_bytes, model_result, mock_response


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('CAREER_PROJECT_DATA_DIR', str(tmp_path))
    monkeypatch.setenv('CAREER_LOGIN_ENABLED', '0')
    monkeypatch.setenv('DEEPSEEK_API_KEY', 'test-only')
    monkeypatch.delenv('K_SERVICE', raising=False)
    monkeypatch.delenv('CAREER_PROJECT_STORAGE', raising=False)
    with TestClient(app, base_url='http://localhost', client=('127.0.0.1', 12345), headers={'origin': 'http://localhost'}) as client:
        assert client.get('/api/projects/session').status_code == 200
        created = client.post('/api/projects', json={'name': 'Synthetic CV QA'}).json()
        client.headers['X-Career-Project'] = created['id']
        yield client


def start(client, extension='txt'):
    response = client.post('/api/career/parse', params={'filename': 'synthetic.' + extension}, content=document_bytes(extension))
    assert response.status_code == 200, response.text
    response = client.post('/api/career/start', json={'document': response.json()})
    assert response.status_code == 200, response.text
    return response.json()


def extract(client, state):
    return client.post('/api/career/extract', json={'state': state, 'expected_revision': state['revision']})


@pytest.mark.parametrize('extension', ['pdf', 'docx', 'txt'])
def test_round_trip_single_call_and_all_skills(client, monkeypatch, extension):
    calls = []
    original = httpx.AsyncClient
    def transport(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json=mock_response(request))
    monkeypatch.setattr(provider.httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(transport), **kwargs))
    state = start(client, extension)
    response = extract(client, state)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['cv_extraction']['status'] == 'success', result['cv_extraction']
    assert len(calls) == 1
    assert calls[0]['model'] == 'deepseek-flash'
    assert calls[0]['thinking'] == {'type': 'disabled'}
    assert calls[0]['response_format'] == {'type': 'json_object'}
    assert len(result['skill_evidence']) == len(NAMES) + 3
    unknown = next(s for s in result['skill_evidence'] if s['canonical_name'] == 'CustomTool-X')
    assert unknown['normalization'] == 'unmapped'
    for record in result['skill_evidence']:
        item = next(i for i in result['items'] if i['id'] == record['experience_id'])
        for span in record['source_spans']:
            assert item['text'][span['start']:span['end']] == span['quote']
        for span in record['document_spans']:
            assert result['document']['text'][span['start']:span['end']] == span['quote']
    saved = client.get('/api/projects/' + client.headers['X-Career-Project']).json()['state']
    assert saved == result
    download = client.get('/api/projects/' + client.headers['X-Career-Project'] + '/cv', params={'document_id': state['document']['id']})
    assert download.content == document_bytes(extension) if extension == 'txt' else len(download.content) == state['document']['file_size']
    ui = client.put('/api/projects/' + client.headers['X-Career-Project'] + '/ui', json={'expected_revision': 0, 'ui': {'profileStage': 'stage-b'}})
    assert ui.json() == {'ui_revision': 1}


def test_three_page_pdf_and_unicode_offsets():
    document = parse_document('three.pdf', document_bytes('pdf', pages=3))
    assert all(s in document['text'] for s in ['EXPERIENCE', 'SKILLS', 'CERTIFICATION'])
    text = '😀 中文\r\n' + TEXT
    document = parse_document('unicode.txt', text.encode('utf-8'))
    result = project(document, model_result(document['text']))
    assert result['items'][0]['document_span']['start'] == len('😀 中文\n')
    assert spans('Python / Python', 'Python') == [{'start': 0, 'end': 6, 'quote': 'Python'}, {'start': 9, 'end': 15, 'quote': 'Python'}]


def test_invalid_quotes_and_rewritten_facts_rejected():
    document = {'id': 'test', 'text': TEXT}
    result = model_result(TEXT)
    result.entries[0].skills[0].quotes = ['Rewritten Python evidence']
    with pytest.raises(AppError, match='cv_evidence_invalid'):
        project(document, result)
    result = model_result(TEXT)
    result.entries[0].role = 'Senior Analyst'
    with pytest.raises(AppError, match='cv_evidence_invalid'):
        project(document, result)


@pytest.mark.parametrize('code,status', [('cv_timeout', 'timeout'), ('cv_provider_failed', 'failed'), ('cv_invalid_output', 'failed')])
def test_terminal_failure_keeps_previous_result(client, monkeypatch, code, status):
    async def success(text): return model_result(text)
    monkeypatch.setattr(provider, 'extract', success)
    state = extract(client, start(client)).json()
    async def fail(text): raise AppError(code, 'Synthetic failure')
    monkeypatch.setattr(provider, 'extract', fail)
    result = extract(client, state).json()
    assert result['cv_extraction']['status'] == status
    assert result['items'] == state['items'] and result['skill_evidence'] == state['skill_evidence']
    assert client.get('/api/career/extraction').json() == result


@pytest.mark.parametrize('kind', ['timeout', 'malformed', 'truncated', 'http_error'])
def test_provider_no_retries(monkeypatch, kind):
    monkeypatch.setenv('DEEPSEEK_API_KEY', 'test-only')
    calls = []
    original = httpx.AsyncClient
    def transport(request):
        calls.append(request)
        if kind == 'timeout': raise httpx.ReadTimeout('test')
        if kind == 'http_error': return httpx.Response(503)
        result = mock_response(request)
        if kind == 'truncated': result['choices'][0]['finish_reason'] = 'length'
        else: result['choices'][0]['message']['content'] = '{}'
        return httpx.Response(200, json=result)
    monkeypatch.setattr(provider.httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(transport), **kwargs))
    with pytest.raises(AppError): asyncio.run(provider.extract(TEXT))
    assert len(calls) == 1


def test_no_ocr_and_invalid_files():
    with pymupdf.open() as document:
        document.new_page()
        content = document.tobytes()
    with pytest.raises(AppError, match='cv_no_text'): parse_document('scanned.pdf', content)
    with pytest.raises(AppError, match='cv_parse_failed'): parse_document('bad.docx', b'not a docx')
    with pytest.raises(AppError, match='cv_format'): parse_document('bad.png', b'image')
    assert parse_document('utf16.txt', TEXT.encode('utf-16'))['text'] == TEXT


def test_stale_write_and_owner_isolation(client, monkeypatch):
    async def success(text): return model_result(text)
    monkeypatch.setattr(provider, 'extract', success)
    original = start(client)
    assert extract(client, original).status_code == 200
    assert extract(client, original).status_code == 409
    client.cookies.clear()
    assert client.get('/api/career/extraction').status_code == 401


def test_interrupted_attempt_expires_without_ai(client, monkeypatch):
    state = start(client)
    identity = client.cookies.get('career_workspace').split('.')[0]
    store = get_store()
    saved = store.get(identity, client.headers['X-Career-Project'])
    state['cv_extraction'] = {'status': 'running', 'id': 'expired', 'deadline_at': time.time() - 1}
    store.save_state(identity, saved['id'], saved['state_version'], state, 'test')
    assert client.get('/api/career/extraction').json()['cv_extraction']['status'] == 'timeout'


def test_unrelated_routes_remain_archived(client):
    assert client.post('/api/career/planning', json={}).status_code == 410
    assert client.post('/api/career/plan', json={}).status_code == 410


def test_cv_result_commit_failure_is_not_success(client, monkeypatch):
    from career_twin.shared.projects.project_store import ProjectStore
    async def success(text): return model_result(text)
    monkeypatch.setattr(provider, 'extract', success)
    state = start(client)
    original = ProjectStore.event
    def fail(self, db, owner, project_id, kind, detail, document_id=None):
        if kind == 'cv_extract_success':
            raise AppError('workspace_unavailable', 'Synthetic DB failure', 503)
        return original(self, db, owner, project_id, kind, detail, document_id)
    monkeypatch.setattr(ProjectStore, 'event', fail)
    assert extract(client, state).status_code == 503
    saved = client.get('/api/career/extraction').json()
    assert not saved['extracted'] and saved['items'] == []
    assert saved['cv_extraction']['status'] == 'running'
