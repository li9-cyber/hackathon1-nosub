"""Save independent user sources first, then analyze only the submitted passage."""
import copy
import time
from career_twin.shared.core.errors import AppError
from career_twin.shared.core.identifiers import stable_id
from career_twin.shared.projects.project_store import get_store, conflict
from . import provider
from .documents import validate_text
from .projection import project
from .service import context, saved_state, save


def records(state):
    return (state.get('evidence_profile') or {}).get('supplemental_evidence', [])


def active(record):
    return record.get('analysis_status') == 'running' and record.get('deadline_at', 0) > time.time()


def evidence_projection(state, record, output):
    projection = project({'id': record['source_id'], 'text': record['text']}, output)
    skills, activities = [], []
    # The model may split a supplement into entries. Remap all to the one saved
    # user source and affected experience, never to original CV offsets.
    for key, target in [('skill_evidence', skills), ('activity_evidence', activities)]:
        for row in projection[key]:
            row = copy.deepcopy(row)
            row.update(experience_id=record['experience_id'], source_id=record['source_id'],
                       source_spans=row.pop('document_spans'), evidence_origin='user_provided')
            target.append(row)
    record['fields'] = [entry['fields'] for entry in projection['standardized_cv']['entries'] if entry['fields']]
    for key, new in [('skill_evidence', skills), ('activity_evidence', activities)]:
        state[key] = [r for r in state.get(key, []) if r['source_id'] != record['source_id']] + new
    state['evidence_profile']['capability_links'] = state['skill_evidence']
    state['evidence_profile']['activities'] = state['activity_evidence']


async def submit(body):
    ctx = context()
    state = saved_state()
    text = validate_text(body.text)
    identity = stable_id('supplement', state['document']['id'], body.item_id, text)
    existing = next((r for r in records(state) if r.get('id') == identity or r.get('submission_id') == body.submission_id), None)
    if existing:
        if existing['text'] != text or existing['experience_id'] != body.item_id:
            raise conflict()
        if existing.get('analysis_status') == 'success' or active(existing) or not body.retry:
            return state  # Idempotency works even with the original stale revision.
    state = saved_state(body)
    if state.get('cv_extraction', {}).get('status') == 'running' or any(active(r) for r in records(state)):
        raise AppError('cv_in_progress', '資料正在更新，請等待完成。', 409)
    if not state.get('extracted') or not any(i['id'] == body.item_id for i in state['items']):
        raise AppError('cv_item_missing', '請先完成 CV 抽取並選擇現有經歷。', 422)
    profile = state['evidence_profile']
    record = next((r for r in records(state) if r.get('id') == identity), None)
    if record is None:
        record = dict(id=identity, source_id=identity, clarification_id=identity,
            submission_id=body.submission_id, experience_id=body.item_id,
            document_id=state['document']['id'], text=text, origin='user_supplied', fields=[])
        profile.setdefault('supplemental_evidence', []).append(record)
        state['sources'].append(dict(id=identity, text=text, kind='user_supplied', document_id=state['document']['id']))
    record.update(analysis_status='running', deadline_at=time.time() + 30, message='補充內容已保存，正在更新技能與證據。')
    state['revision'] += 1
    save(state, 'supplement_saved')  # Transaction commits source before provider access.
    started = time.perf_counter()
    try:
        output = await provider.extract(text)
        # Validate before any derived state is written.
        evidence_projection(copy.deepcopy(state), copy.deepcopy(record), output)
        outcome = {'analysis_status': 'success', 'message': '補充內容、技能與證據已保存。'}
    except AppError as error:
        outcome = {'analysis_status': 'timeout' if error.code == 'cv_timeout' else 'failed',
                   'error_code': error.code, 'message': '補充原文已保存；' + error.message}
    except Exception:
        outcome = {'analysis_status': 'failed', 'error_code': 'supplement_failed', 'message': '補充原文已保存；分析失敗，可重試這段補充。'}
    latest = get_store().get(ctx.owner, ctx.project['id'], active=True)
    state = latest['state']
    current_record = next((r for r in records(state) if r['id'] == identity), None)
    if not current_record or current_record.get('analysis_status') != 'running':
        raise conflict()
    ctx.project = latest
    if outcome['analysis_status'] == 'success':
        evidence_projection(state, current_record, output)
    current_record.update(outcome, elapsed_seconds=round(time.perf_counter() - started, 3))
    state['revision'] += 1
    return save(state, 'supplement_' + outcome['analysis_status'])


def preserve(state, projection):
    """Keep independently saved supplements across an explicit full CV re-extract."""
    supplements = copy.deepcopy(records(state))
    if not supplements:
        return projection
    mapping = {}
    for record in supplements:
        old_id = record['experience_id']
        if old_id not in mapping:
            old = next(i for i in state['items'] if i['id'] == old_id)
            span = old.get('document_span', {})
            candidates = [i for i in projection['items'] if i['section'] == old['section']]
            def overlap(item):
                other = item['document_span']
                return max(0, min(other['end'], span.get('end', 0)) - max(other['start'], span.get('start', 0)))
            target = max(candidates, key=overlap, default=None)
            if not target or not overlap(target):
                target = copy.deepcopy(old)
                projection['items'].append(target)
                projection['standardized_cv']['entries'].extend(copy.deepcopy(e) for e in state['standardized_cv']['entries'] if old_id in e['source_item_ids'])
                projection['sources'].extend(copy.deepcopy(s) for s in state['sources'] if s['id'] == old['source_id'])
            mapping[old_id] = target['id']
        record['experience_id'] = mapping[old_id]
        projection['sources'].append(dict(id=record['source_id'], text=record['text'], kind='user_supplied', document_id=record['document_id']))
    for key in ('skill_evidence', 'activity_evidence'):
        for evidence in state.get(key, []):
            if evidence['source_id'] in {r['source_id'] for r in supplements}:
                projection[key].append({**copy.deepcopy(evidence), 'experience_id': mapping[evidence['experience_id']]})
    projection['evidence_profile'].update(supplemental_evidence=supplements,
        capability_links=projection['skill_evidence'], activities=projection['activity_evidence'])
    return projection
