import asyncio
import json
import time
import httpx
import pytest
from career_twin.jobs import ai, provider, service
from career_twin.shared.matching import service as matching
from career_twin.shared.matching.fcdt.scoring import score_a
from tests.profile.test_extraction import client, start, extract
from tests.profile.fixtures import model_result, TEXT
from career_twin.profile import provider as cv_provider

JD='Requirements: Python and Tableau required. COBOL preferred. Docker preferred. Bachelor degree required.'

def result():
    return {'role_code':'fintech_financial_data','requirements':[
        dict(name=name,names=[name],kind=kind,type=type_,quote=quote,level='unspecified') for name,kind,type_,quote in [
            ('Python','skill','Required','Python and Tableau required.'),
            ('Tableau','tool','Required','Python and Tableau required.'),
            ('COBOL','skill','Preferred','COBOL preferred.'),
            ('Docker','tool','Preferred','Docker preferred.'),
            ('Bachelor degree','education','Required','Bachelor degree required.')]]}

def page():
    return {'result':[dict(id=str(i),title=f'Analyst {i}',countryCode='hk',city='Hong Kong',jsonLD=dict(description=JD,url=f'https://example.com/job/{i}',hiringOrganization={'name':'Synthetic Company'},employmentType='FULL_TIME')) for i in range(10)],'totalCount':10}

def setup_profile(client,monkeypatch):
    async def fake(text):return model_result(text)
    monkeypatch.setattr(cv_provider,'extract',fake)
    return extract(client,start(client)).json()

def test_saved_pipeline_latest_profile_and_deep_cache(client,monkeypatch):
    setup_profile(client,monkeypatch)
    calls=[];original=httpx.AsyncClient
    def transport(request):
        calls.append(request)
        return httpx.Response(200,json=page())
    monkeypatch.setenv('TECHMAP_RAPIDAPI_KEY','test')
    monkeypatch.setattr(provider.httpx,'AsyncClient',lambda **kw:original(transport=httpx.MockTransport(transport),**kw))
    async def fake(text):return result()
    deep_calls=[]
    async def fake_deep(*args):deep_calls.append(1);return dict(strengths=['Python'],gaps=['COBOL 目前未找到證據'],suggestions=['補充經歷'])
    monkeypatch.setattr(ai,'extract',fake);monkeypatch.setattr(ai,'deep',fake_deep)
    body=dict(request_id='one',keywords='Analyst',city='Kowloon',minimum_salary=20000,work_type='fulltime',contract_type='permanent',work_place='hybrid')
    response=client.post('/api/career/search',json=body);assert response.status_code==200,response.text
    state=response.json();assert len(state['jobs'])==10 and len(calls)==1
    assert dict(calls[0].url.params)['minSalary']=='20000'
    assert dict(calls[0].url.params)['city']=='Kowloon'
    client.post('/api/career/search',json=body);assert len(calls)==1
    id=state['jobs'][0]['id']
    state=client.post('/api/career/job/extract',json={'job_id':id}).json()
    assert state['jobs'][0]['analysis_status']=='success',state['jobs'][0]
    m=state['matches'][0];assert m['score'] is not None
    assert {u['status'] for u in m['units']}=={'high','medium','low'}
    assert next(u for u in m['units'] if u['name']=='COBOL')['reason']=='目前未找到匹配證據'
    for _ in range(2):state=client.post('/api/career/job/deep',json={'job_id':id}).json()
    assert len(deep_calls)==1
    assert state['jobs'][0]['deep_analysis']['score']==m['score']
    reloaded=client.get('/api/career/jobs').json()
    assert reloaded['jobs'][0]['deep_analysis']==state['jobs'][0]['deep_analysis']
    assert len(calls)==1

def test_formula_and_unknown_skills():
    assert score_a({'Required':[dict(u=5,e=1)],'Preferred':[dict(u=2,e=.5)]})==90
    assert matching.normalize('MS Excel')['skill_id']==matching.normalize('Microsoft Excel')['skill_id']
    req=ai.prepare({'requirements':[dict(name='未知工具',quote='不存在') ]},JD)
    job=dict(id='x',version='1',**req)
    match=matching.match({},job)
    assert match['score']==0 and match['units'][0]['name']=='未知工具'


def test_bookmarks_persist_idempotently_and_survive_new_jd_version(client,monkeypatch):
    setup_profile(client,monkeypatch)
    rows=page()['result']
    async def fake_search(body):return dict(jobs=[provider.map_job(r) for r in rows],total_count=10,parameters={})
    monkeypatch.setattr(provider,'search',fake_search)
    state=client.post('/api/career/search',json={'request_id':'a','keywords':'Analyst'}).json()
    id=state['jobs'][0]['id']
    body={'job_id':id,'bookmarked':True}
    saved=client.post('/api/career/job/bookmark',json=body).json()
    assert saved['jobs'][0]['bookmarked']
    assert client.post('/api/career/job/bookmark',json=body).json()['revision']==saved['revision']
    assert client.get('/api/career/jobs').json()['jobs'][0]['bookmarked']
    rows[0]['jsonLD']['description']+=' Updated requirement.'
    updated=client.post('/api/career/search',json={'request_id':'b','keywords':'Analyst'}).json()
    assert updated['jobs'][0]['bookmarked'] and updated['jobs'][0]['version']!=saved['jobs'][0]['version']
    assert client.post('/api/career/job/bookmark',json={'job_id':id,'bookmarked':'true'}).status_code==422
    assert client.post('/api/career/job/bookmark',json={'job_id':'missing','bookmarked':True}).status_code==404
    removed=client.post('/api/career/job/bookmark',json={'job_id':id,'bookmarked':False}).json()
    assert not removed['jobs'][0]['bookmarked'] and removed['jobs'][0]['jd']==updated['jobs'][0]['jd']
    client.cookies.clear()
    assert client.post('/api/career/job/bookmark',json=body).status_code==401

def test_flash_single_call_and_timeout(monkeypatch):
    calls=[];original=httpx.AsyncClient
    async def transport(request):
        calls.append(json.loads(request.content));await asyncio.sleep(.15)
        return httpx.Response(200,json={'choices':[{'message':{'content':json.dumps(result())}}]})
    monkeypatch.setattr(ai.httpx,'AsyncClient',lambda **kw:original(transport=httpx.MockTransport(transport),**kw))
    monkeypatch.setenv('DEEPSEEK_API_KEY','test');monkeypatch.setattr(ai,'JD_SECONDS',.05)
    started=time.perf_counter()
    with pytest.raises(Exception,match='deepseek_timeout'):asyncio.run(ai.extract(JD))
    assert time.perf_counter()-started<.3 and len(calls)==1
    assert calls[0]['thinking']=={'type':'disabled'} and calls[0]['model']=='deepseek-flash'

def test_failure_isolated_and_replay(client,monkeypatch):
    setup_profile(client,monkeypatch)
    async def search(body):return dict(jobs=[provider.map_job(r) for r in page()['result']],total_count=10,parameters={})
    calls=[]
    async def extract_jd(text):
        calls.append(1)
        if len(calls)==1:raise service.AppError('deepseek_timeout','系統處理超過最終上限，請稍後手動重試。',504)
        return result()
    monkeypatch.setattr(provider,'search',search);monkeypatch.setattr(ai,'extract',extract_jd)
    state=client.post('/api/career/search',json=dict(keywords='Analyst',request_id='isolation')).json()
    for job in state['jobs']:state=client.post('/api/career/job/extract',json=dict(job_id=job['id'])).json()
    assert len(state['matches'])==9 and state['jobs'][0]['analysis_status']=='timeout'
    assert client.get('/api/career/jobs').json()['jobs'][0]['analysis_status']=='timeout'
    assert len(calls)==10
    # A new, explicitly requested search can return the same failed JD. Only
    # that saved failure is queued again; nine completed extractions are reused.
    state=client.post('/api/career/search',json=dict(keywords='Analyst',request_id='isolation-new')).json()
    assert state['jobs'][0]['analysis_status']=='pending'
    state=client.post('/api/career/job/extract',json=dict(job_id=state['jobs'][0]['id'])).json()
    assert len(state['matches'])==10 and len(calls)==11

def test_application_save_edit_export(client,monkeypatch):
    setup_profile(client,monkeypatch)
    async def fake(text):return result()
    monkeypatch.setattr(ai,'extract',fake)
    state=client.post('/api/career/job',json=dict(jd=JD)).json()
    item=state['items'][0]
    async def draft(*args):return dict(cv=[dict(text=item['text'],item_ids=[item['id']],reason='Relevant source')],cover_letter=[],strategy=['Use relevant evidence'])
    monkeypatch.setattr(ai,'call',draft)
    response=client.post('/api/career/tailor',json=dict(job_id=state['jobs'][0]['id'],confirmed_job=True,include_cv=True,include_cover=False))
    assert response.status_code==200,response.text
    version=response.json()['tailored'][0]
    edit=client.post('/api/career/draft',json=dict(version_id=version['id'],draft=version['final'],confirm=True))
    assert edit.status_code==200 and len(edit.json()['tailored'])==2
    exported=client.post('/api/career/export',json=dict(version_id=version['id'],format='txt',material='cv'))
    assert exported.status_code==200 and item['text'] in exported.text

def test_cloud_gate_allows_three_jds_only():
    from career_twin.shared.core.beta_access import transition
    ledger={}
    for i in range(3):
        assert transition(ledger,identity='qa',kind='ai',ticket=str(i),request_id=str(i),path='/api/career/job/extract',parallel_jd=True)['ok']
    assert not transition(ledger,identity='qa',kind='ai',ticket='4',path='/api/career/job/extract',parallel_jd=True)['ok']
    assert not transition(ledger,identity='qa',kind='ai',ticket='cv')['ok']
    transition(ledger,kind='finish',ticket='0')
    assert transition(ledger,identity='qa',kind='ai',ticket='next',path='/api/career/job/extract',parallel_jd=True)['ok']
