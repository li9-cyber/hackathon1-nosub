"""Project one validated extraction into the existing items/evidence/view contract."""
from career_twin.shared.core.errors import AppError
from career_twin.shared.core.identifiers import stable_id
from career_twin.shared.evidence.concepts import normalize_concept

VERSION = 'cv-single-pass-1'


def spans(text, quote):
    if not quote or not quote.strip():
        raise ValueError('empty_quote')
    found, cursor = [], 0
    while (start := text.find(quote, cursor)) != -1:
        found.append(dict(start=start, end=start + len(quote), quote=quote))
        cursor = start + 1
    if not found:
        raise ValueError('quote_not_exact')
    return found


def project(document, result):
    items, entries, skills, activities = [], [], [], []
    try:
        for number, entry in enumerate(result.entries):
            origin = spans(document['text'], entry.source_quote)[entry.occurrence]
            source = document['text'][origin['start']:origin['end']]
            # Never display rewritten factual fields as if they came from the CV.
            for value in [entry.organization, entry.role, entry.date_range, *entry.fields.values(), *entry.activities]:
                if value and value not in source:
                    raise ValueError('field_not_exact')
            item_id = stable_id('item', document['id'], number, origin)
            source_id = stable_id('source', item_id)
            fields = dict(entry.fields)
            fields.update({k: v for k, v in [('公司', entry.organization), ('職位', entry.role), ('日期', entry.date_range)] if v})
            item = dict(id=item_id, source_id=source_id, text=source, section=entry.section,
                        title=entry.title, fields=fields, organization=entry.organization,
                        role=entry.role, date_range=entry.date_range, experience_type=entry.experience_type,
                        participation='unknown', origin='cv_explicit', review='confirmed', revision=1,
                        user_locked=False, capability_basis=VERSION, document_span=origin)
            items.append(item)
            entries.append(dict(id=stable_id('entry', item_id), section=entry.section, title=entry.title,
                                text=source, fields=fields, source_item_ids=[item_id], needs_confirmation=False))
            for activity in entry.activities:
                local = spans(source, activity)
                activities.append(dict(activity_id=stable_id('activity', item_id, activity), experience_id=item_id,
                    source_id=source_id, description=activity, source_spans=local,
                    document_spans=[dict(s, start=s['start'] + origin['start'], end=s['end'] + origin['start']) for s in local]))
            grouped = {}
            for skill in entry.skills:
                concept = normalize_concept(skill.name)
                record = grouped.setdefault(concept.concept_id, dict(
                    id=stable_id('evidence', item_id, concept.concept_id), skill_id=concept.concept_id,
                    canonical_name=concept.canonical_name if concept.known else skill.name,
                    original_names=[], normalization='matched' if concept.known else 'unmapped',
                    experience_id=item_id, source_id=source_id, source_spans=[], document_spans=[],
                    evidence_type='explicit', evidence_origin='cv', display=True, activity_ids=[]))
                if skill.name not in record['original_names']:
                    record['original_names'].append(skill.name)
                for quote in skill.quotes:
                    for span in spans(source, quote):
                        if span not in record['source_spans']:
                            record['source_spans'].append(span)
                            record['document_spans'].append(dict(span, start=span['start'] + origin['start'], end=span['end'] + origin['start']))
            skills.extend(grouped.values())
    except (ValueError, IndexError):
        raise AppError('cv_evidence_invalid', '抽取引用與 CV 原文不一致，未採用這次結果；原文及上次成功結果已保留。', 502) from None
    return dict(items=items, sources=[dict(id=i['source_id'], text=i['text'], document_id=document['id'],
                                         document_span=i['document_span']) for i in items],
                skill_evidence=skills, activity_evidence=activities,
                standardized_cv=dict(id=stable_id('standardized', document['id'], entries), entries=entries),
                evidence_profile=dict(status='current', capability_links=skills, activities=activities,
                                      supplemental_evidence=[], analysis_status={i['id']: 'complete' for i in items}),
                extracted=True, cv_skill_version=VERSION, normalization_notice='', skill_analysis_notice='')


def initial_state(document, preferences):
    state = {key: [] for key in ('items', 'sources', 'questions', 'claims', 'capabilities', 'skill_evidence',
        'activity_evidence', 'clarifications', 'evidence_updates', 'jobs', 'matches', 'catalog_jobs',
        'catalog_matches', 'search_directions', 'research', 'tailored', 'plans', 'activity_issues')}
    state.update(id=stable_id('career', document['id']), revision=1, document=document, preferences=preferences,
        extracted=False, standardized_cv=None, evidence_profile=None, cv_skill_version=VERSION,
        normalization_notice='', skill_analysis_notice='', source_notice='', tools='',
        constraints={'hours': None, 'budget_hkd': None}, job_search={'provider': 'archived'},
        runtime_options={'skills': False, 'memory': False}, interview_context=None,
        cv_extraction={'status': 'idle', 'document_id': document['id']})
    return state
