import copy
import pytest
from career_twin.profile import provider
from career_twin.shared.core.errors import AppError
from career_twin.shared.projects.project_store import get_store, ProjectStore
from career_twin.shared.projects.project_context import Context, current
from career_twin.interview.context import build
from tests.profile.test_extraction import client, start, extract
from tests.profile.fixtures import SUPPLEMENT, model_result, supplement_result


def submit(client, state, submission='submission-1', retry=False, text=SUPPLEMENT):
    return client.post('/api/career/supplement', json={'state': state, 'expected_revision': state['revision'],
        'item_id': state['items'][0]['id'], 'text': text, 'submission_id': submission, 'retry': retry})


def prepared(client, monkeypatch):
    async def fake(text): return model_result(text)
    monkeypatch.setattr(provider, 'extract', fake)
    return extract(client, start(client)).json()


def latest_project(client):
    return client.get('/api/projects/' + client.headers['X-Career-Project']).json()


def test_save_before_ai_idempotency_source_separation_and_downstream(client, monkeypatch):
    state = prepared(client, monkeypatch)
    calls = []
    async def fake(text):
        calls.append(text)
        # A separate DB read sees the committed raw source before AI returns.
        owner = client.cookies.get('career_workspace').split('.')[0]
        saved = get_store().get(owner, client.headers['X-Career-Project'])['state']
        assert saved['evidence_profile']['supplemental_evidence'][0]['text'] == SUPPLEMENT
        assert saved['skill_evidence'] == state['skill_evidence']
        return supplement_result(text)
    monkeypatch.setattr(provider, 'extract', fake)
    response = submit(client, state)
    assert response.status_code == 200, response.text
    result = response.json()
    assert calls == [SUPPLEMENT]  # No full CV in the incremental provider request.
    source = result['evidence_profile']['supplemental_evidence'][0]
    assert source['analysis_status'] == 'success'
    assert result['document'] == state['document'] and result['items'] == state['items']
    assert source['fields'][0]['資格'] == 'AWS Cloud Practitioner'
    evidence = [r for r in result['skill_evidence'] if r['source_id'] == source['source_id']]
    assert len(evidence) == 2
    assert all('document_spans' not in row for row in evidence)
    assert all(SUPPLEMENT[s['start']:s['end']] == s['quote'] for row in evidence for s in row['source_spans'])
    assert submit(client, state).json() == result  # Same token with stale revision.
    assert submit(client, result, submission='another-token').json() == result  # Same content.
    assert len(calls) == 1
    assert submit(client, result, text='Different text').status_code == 409
    saved = latest_project(client)
    assert saved['state'] == result
    assert client.get('/api/pilot/snapshot').json()['state'] == result
    ctx = Context(client.cookies.get('career_workspace').split('.')[0], saved, 'interview')
    token = current.set(ctx)
    try:
        interview = build('interview')
        assert interview.data['supplemental_self_report'] == SUPPLEMENT
        assert SUPPLEMENT not in interview.data['cv_self_report']
        assert interview.revision == saved['state_version']
    finally:
        current.reset(token)
    async def original(text): return model_result(text)
    monkeypatch.setattr(provider, 'extract', original)
    reextracted = extract(client, result).json()
    assert reextracted['cv_extraction']['status'] == 'success'
    assert reextracted['evidence_profile']['supplemental_evidence'] == [source]
    assert len([r for r in reextracted['skill_evidence'] if r['source_id'] == source['source_id']]) == 2


@pytest.mark.parametrize('error,status', [('cv_timeout', 'timeout'), ('cv_invalid_output', 'failed')])
def test_failed_analysis_keeps_source_and_targeted_retry(client, monkeypatch, error, status):
    state = prepared(client, monkeypatch)
    async def failure(text): raise AppError(error, 'Synthetic failure')
    monkeypatch.setattr(provider, 'extract', failure)
    result = submit(client, state).json()
    source = result['evidence_profile']['supplemental_evidence'][0]
    assert source['analysis_status'] == status and source['text'] == SUPPLEMENT
    assert result['skill_evidence'] == state['skill_evidence']
    async def success(text): return supplement_result(text)
    monkeypatch.setattr(provider, 'extract', success)
    result = submit(client, result, retry=True).json()
    assert len(result['evidence_profile']['supplemental_evidence']) == 1
    assert result['evidence_profile']['supplemental_evidence'][0]['analysis_status'] == 'success'


def test_final_db_failure_never_reports_saved_derived_data(client, monkeypatch):
    state = prepared(client, monkeypatch)
    async def fake(text): return supplement_result(text)
    monkeypatch.setattr(provider, 'extract', fake)
    original = ProjectStore.event
    def fail_event(self, db, owner, project_id, kind, detail, document_id=None):
        if kind == 'supplement_success':
            raise AppError('workspace_unavailable', 'Synthetic DB failure', 503)
        return original(self, db, owner, project_id, kind, detail, document_id)
    monkeypatch.setattr(ProjectStore, 'event', fail_event)
    response = submit(client, state)
    assert response.status_code == 503
    saved = latest_project(client)['state']
    assert saved['skill_evidence'] == state['skill_evidence']
    assert saved['evidence_profile']['supplemental_evidence'][0]['text'] == SUPPLEMENT
    assert saved['evidence_profile']['supplemental_evidence'][0]['analysis_status'] == 'running'


def test_failure_before_source_commit_does_not_call_ai(client, monkeypatch):
    state = prepared(client, monkeypatch)
    async def forbidden(text): raise AssertionError('AI must not run before source commit')
    monkeypatch.setattr(provider, 'extract', forbidden)
    original = ProjectStore.event
    def fail_event(self, db, owner, project_id, kind, detail, document_id=None):
        if kind == 'supplement_saved': raise AppError('workspace_unavailable', 'Synthetic DB failure', 503)
        return original(self, db, owner, project_id, kind, detail, document_id)
    monkeypatch.setattr(ProjectStore, 'event', fail_event)
    assert submit(client, state).status_code == 503
    assert latest_project(client)['state'] == state
