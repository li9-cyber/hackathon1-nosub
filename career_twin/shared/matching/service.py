"""Shared normalization and FCDT coverage. Missing evidence is not lack of ability.

Product adapter permits unknown skills/roles (W=0), without the handoff engine's
UI eligibility gates. Qualifications are reported separately from skill score.
"""
import hashlib
import json
import re
import time
from functools import lru_cache
from pathlib import Path
from career_twin.shared.evidence.concepts import normalize_concept, normalized
from .fcdt.market import MarketIndex
from .fcdt.taxonomy import role_id
from .fcdt.scoring import score_a
from . import policy
from .compatibility import requirements

def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()

def profile_basis(state):
    return digest([state.get(k) for k in ('document','items','skill_evidence','activity_evidence','evidence_profile')])

def basis(state, job):
    return digest([profile_basis(state),job['version'],job.get('requirements'),policy.VERSION])

@lru_cache
def market():
    return MarketIndex(json.loads((Path(__file__).parent/'data/HK_Finance_Market_Baseline_304_20261017.json').read_text(encoding='utf-8')))

def normalize(value):
    c = normalize_concept(value)
    return dict(skill_id=c.concept_id,name=c.canonical_name if c.known else value,scoring_id=c.scoring_id,known=c.known)

def sources(state):
    result = {s['id']:dict(s,origin='cv') for s in state.get('sources',[])}
    for s in (state.get('evidence_profile') or {}).get('supplemental_evidence',[]):
        result[s['source_id']] = dict(id=s['source_id'],text=s['text'],origin='supplement')
    return result

def evidence(state):
    source_map = sources(state)
    items = {i['id']:i for i in state.get('items',[])}
    output = []
    for record in state.get('skill_evidence',[]):
        source = source_map.get(record.get('source_id'))
        if not source: continue
        spans = [s for s in record.get('source_spans',[]) if isinstance(s.get('start'),int) and isinstance(s.get('end'),int) and 0 <= s['start'] < s['end'] <= len(source['text']) and source['text'][s['start']:s['end']] == s.get('quote')]
        if not spans: continue
        concept = normalize(record.get('canonical_name') or record.get('original_names',[''])[0])
        output.append(dict(**concept,item_id=record.get('experience_id'),source_id=source['id'],text=source['text'],source_spans=spans,origin=source['origin'],section=items.get(record.get('experience_id'),{}).get('section')))
    return output

def match(state, job):
    started = time.perf_counter()
    pool = evidence(state)
    role = role_id(job.get('role_code'))
    units, gates, groups = [], [], {'Required':[], 'Preferred':[]}
    for requirement in requirements(job):
        names = requirement.get('names') or [requirement['name']]
        concepts = [normalize(n) for n in names]
        candidates = [p for p in pool if p['skill_id'] in {c['skill_id'] for c in concepts}]
        related = [p for p in pool if any(normalized(p['name']) in policy.RELATED.get(normalized(c['name']),set()) for c in concepts)]
        level = requirement.get('level','unspecified')
        direct = [p for p in candidates if p['section'] in ('experience','project') and level in ('basic','unspecified')]
        citations = direct or candidates or related
        e = 1.0 if direct else .5 if citations else 0.0
        if requirement.get('kind') not in ('skill','tool'):
            citations = []
            for source in sources(state).values():
                for name in names:
                    found = re.search(r'(?<!\w)'+re.escape(name)+r'(?!\w)',source['text'],re.I)
                    if found:
                        citations.append(dict(source_id=source['id'],text=source['text'],origin=source['origin'],source_spans=[dict(start=found.start(),end=found.end(),quote=found.group())]))
            e = .5 if citations else 0.0
        # Old requirements are OR-of-AND predicate groups, not a flat OR list.
        # Score each branch by its least-supported condition and keep the best branch.
        if requirement.get('alternative_groups'):
            branches = []
            for group in requirement['alternative_groups']:
                child_job = dict(job, requirements=[dict(p, id=str(i), type='Required') for i,p in enumerate(group)])
                children = match(state, child_job)['units']
                branches.append((min(u['e'] for u in children), children))
            e, children = max(branches, key=lambda branch: branch[0])
            citations = [c for u in children for c in u['citations']]
        status = 'high' if e==1 else 'medium' if e else 'low'
        reason = '有對應技能及實際使用證據' if e==1 else '有相關或自述證據；程度／資格仍待確認' if e else '目前未找到匹配證據'
        weights = [market().lookup(role,c['scoring_id']).value for c in concepts] if role else [0]
        unit = dict(requirement,concepts=concepts,e=e,u=1+max(weights),W=max(weights),status=status,reason=reason,citations=citations)
        units.append(unit)
        if requirement.get('kind') in ('skill','tool'): groups[requirement['type']].append(unit)
        else: gates.append(unit)
    score = score_a(groups)
    scope = 'skills'
    if score is None and gates:
        scope = 'requirements'
        score = score_a({k:[u for u in gates if u['type']==k] for k in groups})
    score = round(score,2) if score is not None else None
    return dict(job_id=job['id'],job_version=job['version'],basis=basis(state,job),status='complete' if score is not None else 'no_requirements',score=score,band=policy.band(score) if score is not None else None,units=units,score_scope=scope,algorithm='FCDT A_80_20',policy_version=policy.VERSION,role_code=role,market_default=not bool(role),elapsed_seconds=round(time.perf_counter()-started,4))

def refresh(state):
    existing = {m['job_id']:m for m in state.get('matches',[])}
    changed = False
    for job in state.get('jobs',[]):
        if not job.get('normalized'): continue
        if existing.get(job['id'],{}).get('basis') != basis(state,job):
            existing[job['id']] = match(state,job)
            job.pop('deep_analysis',None)
            changed = True
    state['matches'] = list(existing.values())
    for version in state.get('tailored',[]):
        job=next((j for j in state['jobs'] if j['id']==version['job_id']),None)
        if job and version.get('basis')!=basis(state,job):version['stale']=True
    return changed
