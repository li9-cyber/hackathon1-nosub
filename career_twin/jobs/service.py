"""Job-owned fields merged into latest existing project state before atomic CAS."""
import copy
import time
from uuid import uuid4
from career_twin.shared.core.errors import AppError
from career_twin.shared.projects.project_context import current
from career_twin.shared.projects.project_store import get_store
from career_twin.shared.matching import service as matching
from . import ai, provider

def context():
    ctx=current.get()
    if not ctx:raise AppError('project_required','請先建立或開啟專案。',422)
    return ctx

def read():
    ctx=context();ctx.project=get_store().get(ctx.owner,ctx.project['id'],active=True)
    state=copy.deepcopy(ctx.project['state'])
    if not state:raise AppError('cv_missing','請先保存個人資料，再搜尋職位。',422)
    return state

def save(state,kind):
    ctx=context();state['revision']+=1
    matching.refresh(state)
    get_store().save_state(ctx.owner,ctx.project['id'],ctx.project['state_version'],state,kind)
    ctx.project={**ctx.project,'state':state,'state_version':ctx.project['state_version']+1}
    return state

def job_in(state,id):
    job=next((j for j in state['jobs'] if j['id']==id),None)
    if not job:raise AppError('job_missing','找不到此專案的職位。',404)
    return job

def bookmark(id,enabled):
    if not isinstance(enabled,bool):raise AppError('bookmark_invalid','請指定書籤狀態。',422)
    state=read();job=job_in(state,id)
    if bool(job.get('bookmarked'))==enabled:return state
    job['bookmarked']=enabled
    return save(state,'job_bookmark')

def snapshot():
    state=read();changed=matching.refresh(state)
    for job in state['jobs']:
        for key in ('extraction','deep_attempt'):
            attempt=job.get(key,{})
            if attempt.get('status')=='running' and time.time()>attempt['deadline']:
                attempt.update(status='timeout',message='處理已超時或中斷；資料已保存，可手動重試。')
                if key=='extraction':job.update(analysis_status='timeout',details_notice=attempt['message'])
                changed=True
    search=state.get('job_search',{})
    if search.get('status')=='running' and time.time()>search.get('deadline',0):
        search.update(status='timeout',message='搜尋已超時或中斷；沒有自動重試。');changed=True
    return save(state,'jobs_refresh') if changed else state

async def search(body):
    state=snapshot()
    prior=state.get('job_search',{})
    request_id=body.get('request_id')
    if not isinstance(request_id,str) or not request_id:raise AppError('request_id','搜尋缺少請求編號。',422)
    if prior.get('request_id')==request_id or prior.get('status')=='running':return state
    query={k:body.get(k) for k in ('keywords','city','minimum_salary','work_type','contract_type','work_place')}
    if body.get('use_cv') and not query['keywords']:
        query['keywords']=state.get('preferences',{}).get('target_role') or next((i.get('role') for i in state.get('items',[]) if i.get('role')),None)
    if not query['keywords']:raise AppError('search_title','請輸入職位名稱。',422)
    if not isinstance(query.get('minimum_salary'),(int,float)) or query['minimum_salary']<0:query['minimum_salary']=0
    started=time.perf_counter()
    attempt=dict(provider='techmap',status='running',request_id=request_id,query=query,result_ids=prior.get('result_ids',[]),deadline=time.time()+31,message='正在搜尋，最多一次請求／10 個職位。')
    state['job_search']=attempt;save(state,'job_search_started')
    try:
        result=await provider.search(query)
        state=read()
        existing={j['id']:j for j in state['jobs']}
        for job in result['jobs']:
            saved=existing.get(job['id'],{})
            if saved.get('version')!=job['version']:
                job['bookmarked']=bool(saved.get('bookmarked'))
                existing[job['id']]=job
            elif not saved.get('normalized') and saved.get('extraction',{}).get('status')!='running':
                # An explicit new search may return a previously failed legacy JD.
                # Reuse its saved body and start one new extraction, not another search.
                saved.update(analysis_status='pending',details_notice='等待抽取要求')
                saved.pop('extraction',None)
        state['jobs']=list(existing.values())
        attempt.update(status='success',result_ids=[j['id'] for j in result['jobs']],total_count=result['total_count'],parameters=result['parameters'],fetched_at=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),message=f"已保存 {len(result['jobs'])} 個職位；逐張抽取要求。")
    except AppError as error:
        state=read();attempt.update(status='timeout' if error.code.endswith('timeout') else 'failed',message=error.message,error_code=error.code)
    attempt['elapsed_seconds']=round(time.perf_counter()-started,3)
    state['job_search']=attempt
    return save(state,'job_search_'+attempt['status'])

async def extract(id,retry=False,refresh=False):
    state=snapshot();job=job_in(state,id)
    if (job.get('normalized') and not refresh) or job.get('extraction',{}).get('status')=='running':return state
    if job.get('analysis_status') in ('failed','timeout') and not retry:return state
    if not job.get('jd'):raise AppError('jd_missing','來源未提供 JD；請貼上完整職位內容。',422)
    if len(job['jd'])>50000:raise AppError('jd_too_long','JD 超過 50,000 字元，請保留相關職位內容。',422)
    attempt=dict(id=uuid4().hex,status='running',started_at=time.time(),deadline=time.time()+60,model='deepseek-flash')
    version=job['version'];jd=job['jd'];started=time.perf_counter()
    job['extraction']=attempt;job['analysis_status']='running';save(state,'jd_started')
    try:
        result=ai.prepare(await ai.extract(jd),jd)
        attempt.update(status='success',message='要求已抽取並保存。')
    except AppError as error:
        result={};attempt.update(status='timeout' if error.code.endswith('timeout') else 'failed',message=error.message,error_code=error.code)
    except Exception:
        result={};attempt.update(status='failed',message='職位分析失敗；原文已保存，可手動重試。')
    state=read();job=job_in(state,id)
    if job['version']!=version or job.get('extraction',{}).get('id')!=attempt['id']:return state
    attempt['elapsed_seconds']=round(time.perf_counter()-started,3)
    for key,value in result.pop('job_information',{}).items():
        if not job.get(key) or job.get(key)=='未提供':job[key]=value
    job.update(result,extraction=attempt,analysis_status=attempt['status'],details_notice=attempt['message'])
    return save(state,'jd_'+attempt['status'])

async def deep(id):
    state=snapshot();job=job_in(state,id)
    if not job.get('normalized'):raise AppError('jd_pending','請先完成 JD 要求抽取。',422)
    match=next(m for m in state['matches'] if m['job_id']==id)
    if job.get('deep_analysis',{}).get('basis')==match['basis']:return state
    if job.get('deep_attempt',{}).get('status')=='running':return state
    attempt=dict(id=uuid4().hex,status='running',started_at=time.time(),deadline=time.time()+75)
    job['deep_attempt']=attempt;save(state,'deep_started');started=time.perf_counter()
    try:
        result=await ai.deep(state,job,match)
        content={k:[str(v) for v in result.get(k,[])[:6]] for k in ('strengths','gaps','suggestions') if isinstance(result.get(k),list)}
        if not any(content.values()):raise AppError('deep_empty','分析沒有返回內容，可手動重試。',502)
        attempt.update(status='success',message='深度分析已保存。')
    except AppError as error:
        content={};attempt.update(status='timeout' if error.code.endswith('timeout') else 'failed',message=error.message)
    except Exception:
        content={};attempt.update(status='failed',message='深度分析失敗；已保存資料不受影響。')
    state=read();job=job_in(state,id)
    if job.get('deep_attempt',{}).get('id')!=attempt['id']:return state
    attempt['elapsed_seconds']=round(time.perf_counter()-started,3)
    if matching.basis(state,job)!=match['basis']:
        attempt.update(status='stale',message='個人資料或 JD 已更新，請按深度分析使用最新資料。')
    elif attempt['status']=='success':job['deep_analysis']=dict(basis=match['basis'],content=content,score=match['score'],elapsed_seconds=attempt['elapsed_seconds'])
    job['deep_attempt']=attempt
    return save(state,'deep_'+attempt['status'])

async def manual(body):
    if not body.get('jd'):
        if body.get('job_id'):return await extract(body['job_id'],retry=True)
        raise AppError('jd_required','請貼上 JD 正文；網址會保存為原始連結。',422)
    state=read();jd=str(body['jd']).strip()
    if not 1<=len(jd)<=50000:raise AppError('jd_length','JD 需為 1–50,000 字元。',422)
    if body.get('job_id'):
        job=job_in(state,body['job_id']);job.update(jd=jd,version=matching.digest(jd),normalized=False,requirements=[],analysis_status='pending');job.pop('deep_analysis',None)
    else:
        job=provider.map_job(dict(id=matching.digest(jd),title=jd.splitlines()[0][:160],jsonLD=dict(description=jd,url=body.get('url'))))
        job.update(source='pasted_jd',jd=jd,full_description=True)
        if any(j['id']==job['id'] for j in state['jobs']):return state
        state['jobs'].append(job)
    save(state,'jd_saved')
    return await extract(job['id'])
