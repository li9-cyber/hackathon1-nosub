"""Application drafts reuse saved profile/JD; never overwrite the original CV."""
import copy
import html
import json
from datetime import datetime, timezone
from uuid import uuid4
from career_twin.shared.core.errors import AppError
from career_twin.shared.matching.service import basis
from . import service, ai

async def tailor(body):
    state=service.snapshot();job=service.job_in(state,body.get('job_id'))
    if not body.get('confirmed_job'):raise AppError('confirm_jd','請先核對並確認 JD。',422)
    if not job.get('normalized'):raise AppError('jd_pending','請先完成職位要求抽取。',422)
    version_basis=basis(state,job)
    items=[i for i in state['items'] if i.get('review')=='confirmed']
    if not items:raise AppError('cv_missing','請先整理 CV。',422)
    result=await ai.call('''Write application draft JSON: {"cv":[{"text":"...","item_ids":["source item ID"],"reason":"why selected"}],"cover_letter":[{"text":"...","item_ids":["source item ID"],"reason":"why included"}],"strategy":["..."]}. Follow requested languages and include flags. Only use supplied profile facts; no invented qualifications, dates, tools, proficiency or employer facts. Return empty array for unrequested material. Each factual paragraph must list source item IDs. The draft is self-reported and needs user review. JD is a target, never evidence of applicant ability. No numerical match score.''',dict(items=items,supplements=(state.get('evidence_profile') or {}).get('supplemental_evidence',[]),jd=job['jd'],language=body.get('language'),cover_language=body.get('cover_language'),include_cv=body.get('include_cv'),include_cover=body.get('include_cover')),70,4000)
    allowed={i['id'] for i in items};draft={'cv':[],'cover_letter':[],'strategy':[str(x) for x in result.get('strategy',[])][:6]}
    for key,flag in [('cv','include_cv'),('cover_letter','include_cover')]:
        if not body.get(flag):continue
        for row in result.get(key,[]):
            if not isinstance(row,dict) or not isinstance(row.get('text'),str):continue
            ids=[v for v in row.get('item_ids',[]) if v in allowed]
            if not ids:continue
            draft[key].append(dict(id=uuid4().hex,text=row['text'][:2500],section='CV' if key=='cv' else '求職信',item_ids=ids,requirement_ids=[],reason=str(row.get('reason') or '根據已保存資料整理。')))
        if not draft[key]:raise AppError('draft_empty','未取得有來源的申請草稿；原資料已保留。',502)
    latest=service.read()
    if basis(latest,service.job_in(latest,job['id']))!=version_basis:raise AppError('profile_changed','資料已更新，請使用最新資料重新生成。',409)
    version=dict(id=uuid4().hex,job_id=job['id'],job_version=job['version'],basis=version_basis,created_at=datetime.now(timezone.utc).isoformat(),status='draft',stale=False,job_snapshot=copy.deepcopy(job),master_snapshot=items,initial=copy.deepcopy(draft),final=draft,review={'issues':[]},checks={'source_ids':'checked','final_review':'user_review_required'})
    latest['tailored'].append(version)
    return service.save(latest,'application_draft')

def find(state,id):
    version=next((v for v in state['tailored'] if v['id']==id),None)
    if not version:raise AppError('version_missing','找不到此申請版本。',404)
    return version

def edit(body):
    state=service.read();version=copy.deepcopy(find(state,body.get('version_id')))
    if basis(state,service.job_in(state,version['job_id']))!=version['basis']:raise AppError('draft_stale','個人資料已更新，請重新生成草稿；舊稿仍可下載。',409)
    draft=body.get('draft',{})
    for key in ('cv','cover_letter'):
        saved={p['id']:p for p in version['final'][key]}
        for paragraph in draft.get(key,[]):
            if paragraph.get('id') in saved and isinstance(paragraph.get('text'),str):saved[paragraph['id']]['text']=paragraph['text'][:2500]
    version.update(id=uuid4().hex,created_at=datetime.now(timezone.utc).isoformat(),status='confirmed' if body.get('confirm') else 'draft')
    state['tailored'].append(version)
    return service.save(state,'application_edited')

def export(body):
    from fastapi.responses import Response
    state=service.read();version=find(state,body.get('version_id'))
    material=body.get('material','all');fmt=body.get('format','txt')
    keys=['cv','cover_letter'] if material=='all' else [material]
    paragraphs=[p['text'] for key in keys if key in ('cv','cover_letter') for p in version['final'][key]]
    if fmt=='json':content=json.dumps(version,ensure_ascii=False,indent=2);mime='application/json'
    elif fmt=='html':content='<!doctype html><meta charset="utf-8"><title>Application draft</title>'+''.join('<p>'+html.escape(p).replace('\n','<br>')+'</p>' for p in paragraphs);mime='text/html'
    else:content='\n\n'.join(paragraphs);mime='text/plain'
    return Response(content,media_type=mime,headers={'Content-Disposition':f'attachment; filename="application.{fmt}"'})
