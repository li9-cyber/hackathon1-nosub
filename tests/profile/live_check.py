"""Explicit opt-in acceptance run: two real Flash calls on synthetic CVs only.

Run: .venv/Scripts/python.exe -m tests.profile.live_check
"""
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter
from fastapi.testclient import TestClient
from career_twin.api.main import app
from tests.profile.fixtures import document_bytes


def main():
    root = Path('.test-runs')
    root.mkdir(exist_ok=True)
    reports = []
    with TemporaryDirectory(dir=root, prefix='live-cv-') as folder:
        os.environ['CAREER_PROJECT_DATA_DIR'] = str(Path(folder) / 'data')
        os.environ['CAREER_LOGIN_ENABLED'] = '0'
        os.environ.pop('CAREER_PROJECT_STORAGE', None)
        os.environ.pop('K_SERVICE', None)
        with TestClient(app, base_url='http://localhost', client=('127.0.0.1', 23456), headers={'origin': 'http://localhost'}) as client:
            client.get('/api/projects/session')
            for extension in ['pdf', 'docx']:
                created = client.post('/api/projects', json={'name': 'Synthetic live CV QA'}).json()
                client.headers['X-Career-Project'] = created['id']
                started = perf_counter()
                response = client.post('/api/career/parse', params={'filename': 'synthetic.' + extension}, content=document_bytes(extension, pages=3))
                response.raise_for_status()
                document = response.json()
                response = client.post('/api/career/start', json={'document': document})
                response.raise_for_status()
                state = response.json()
                response = client.post('/api/career/extract', json={'state': state, 'expected_revision': state['revision']})
                response.raise_for_status()
                state = response.json()
                elapsed = round(perf_counter() - started, 3)
                restored = client.get('/api/projects/' + created['id']).json()['state']
                assert restored == state
                for record in state['skill_evidence']:
                    item = next(i for i in state['items'] if i['id'] == record['experience_id'])
                    assert all(item['text'][s['start']:s['end']] == s['quote'] for s in record['source_spans'])
                    assert all(document['text'][s['start']:s['end']] == s['quote'] for s in record['document_spans'])
                report = dict(format=extension, pages=3 if extension == 'pdf' else 1, end_to_end_seconds=elapsed,
                    extraction=state['cv_extraction'], entries=len(state['items']),
                    skill_evidence=len(state['skill_evidence']),
                    skill_names=sorted(set(s['canonical_name'] for s in state['skill_evidence'])),
                    skills_section=any(i['section'] == 'skill' for i in state['items']), reload_equal=restored == state)
                reports.append(report)
                print(json.dumps(report, ensure_ascii=True))
    (root / 'live-cv-results.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
