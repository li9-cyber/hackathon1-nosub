"""Regression: existing projects use predicate groups, not requirement.name."""
import copy
from playwright.sync_api import sync_playwright
from career_twin.shared.projects.project_store import get_store
from career_twin.shared.matching import service as matching
from tests.profile.test_extraction import client
from tests.profile.test_browser import server, open_project, wait_js
from tests.profile.fixtures import document_bytes
from tests.jobs.test_flow import setup_profile


def legacy_job():
    def predicate(name):
        return dict(id='p_'+name, name=name, raw_name=name, kind='skill', minimum_level=None)
    return dict(id='legacy_job', version='legacy_v1', title='Saved Analyst', company='Example',
                source='manual', normalized=True, full_description=True, requirements_complete=True,
                analysis_status='complete', jd='Python and COBOL required. Tableau or Python preferred.',
                requirements=[
                    dict(id='old_and', description='Python and COBOL', quote='Python and COBOL required.',
                         required=True, alternatives=[[predicate('Python'), predicate('COBOL')]]),
                    dict(id='old_or', description='Tableau or Python', quote='Tableau or Python preferred.',
                         required=False, alternatives=[[predicate('Tableau')], [predicate('Python')]])])


def seed(owner, project_id):
    store=get_store();project=store.get(owner,project_id);state=project['state']
    state['jobs']=[legacy_job(),dict(legacy_job(),id='legacy_unanalysed',normalized=False,analysis_status='unanalysed',requirements=[])]
    state['matches']=[dict(job_id='legacy_job',job_version='legacy_v1',basis='old',status='unknown',conditions=[])]
    state['revision']+=1
    store.save_state(owner,project_id,project['state_version'],state,'test_legacy')
    store.save_ui(owner,project_id,project['ui_revision'],{**project['ui'],'selectedJob':'legacy_job'})
    return state


def test_legacy_open_overview_replace_without_provider_calls(client,monkeypatch):
    setup_profile(client,monkeypatch)
    pid=client.headers['X-Career-Project'];owner=client.cookies['career_workspace'].split('.')[0]
    original=seed(owner,pid)
    response=client.get('/api/projects/'+pid)
    assert response.status_code==200,response.text
    state=response.json()['state'];match=state['matches'][0]
    assert match['score'] is not None
    assert [u['e'] for u in match['units']]==[0,1]  # AND must not become OR.
    assert state['jobs'][0]['requirements']==original['jobs'][0]['requirements']
    for unit in match['units']:
        for span in unit['source_spans']:
            assert state['jobs'][0]['jd'][span['start']:span['end']]==span['quote']
    assert client.get('/api/projects/'+pid).json()['state']['revision']==state['revision']
    assert client.post('/api/career/job/overview',json={}).status_code==200
    document=client.post('/api/career/parse',params={'filename':'replacement.txt'},content=document_bytes('txt')).json()
    replaced=client.post('/api/career/replace',json=dict(state=state,expected_revision=state['revision'],document=document))
    assert replaced.status_code==200,replaced.text
    assert replaced.json()['jobs']==state['jobs']
    assert replaced.json()['matches'][0]['score']==0


def test_legacy_missing_quote_does_not_block_match():
    job=legacy_job();job['requirements'].append(dict(id='unknown',description='Custom requirement',quote='Not in JD',required=True))
    original=copy.deepcopy(job)
    result=matching.match({},job)
    assert result['score']==0 and len(result['units'])==3
    assert result['units'][-1]['source_spans']==[]
    assert job==original


def test_summary_refresh_failure_preserves_saved_requirements(client,monkeypatch):
    from career_twin.jobs import ai
    from career_twin.shared.core.errors import AppError
    setup_profile(client,monkeypatch)
    pid=client.headers['X-Career-Project'];owner=client.cookies['career_workspace'].split('.')[0]
    original=seed(owner,pid)
    async def fail(text):raise AppError('deepseek_timeout','Test timeout',504)
    monkeypatch.setattr(ai,'extract',fail)
    response=client.post('/api/career/job/extract',json={'job_id':'legacy_job','retry':True,'refresh':True})
    assert response.status_code==200
    job=next(j for j in response.json()['jobs'] if j['id']=='legacy_job')
    assert job['normalized'] and job['requirements']==original['jobs'][0]['requirements']
    assert job['extraction']['status']=='timeout'


def test_open_saved_project_button_and_reload(server,monkeypatch):
    from career_twin.jobs import ai
    extracted=[]
    async def extract_jd(text):
        extracted.append(text)
        return {'requirements':[dict(name='Python',label='Python 資料處理',kind='skill',quote='Python and COBOL required.')]}
    monkeypatch.setattr(ai,'extract',extract_jd)
    url,calls=server
    with sync_playwright() as p:
        browser=p.chromium.launch(channel='chrome',headless=True)
        page=browser.new_page(reduced_motion='reduce');errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        open_project(page,url)
        page.locator('[name="cv-mode"][value="file"]').check()
        page.locator('#cv-file').set_input_files(dict(name='synthetic.txt',mimeType='text/plain',buffer=document_bytes('txt')))
        page.locator('#submit-cv').click()
        wait_js(page,"CareerWorkspace.getState()?.cv_extraction?.status==='success'")
        pid=page.evaluate('CareerProjects.id()')
        owner=next(c['value'] for c in page.context.cookies() if c['name']=='career_workspace').split('.')[0]
        seed(owner,pid)
        page.goto(url+'/#projects')
        wait_js(page,'CareerProjects.isReady()')
        page.locator('#all-projects').get_by_role('button',name='開啟專案').click()
        wait_js(page,"CareerProjects.isReady() && document.body.dataset.page==='overview'")
        assert page.evaluate('CareerWorkspace.getState().matches[0].algorithm')=='FCDT A_80_20'
        assert '不符合' in page.locator('#project-features').inner_text()
        page.get_by_role('button',name='職位與申請',exact=True).click()
        assert page.locator('#job-analysis-home .saved-job-card').count()==0
        assert page.locator('#job-analysis-home [data-skill-id]').count()>0
        page.evaluate("CareerLayout.navigate('jobs')")
        card=page.locator('#job-results [data-job-id="legacy_job"]')
        assert card.count()==1 and card.locator('.saved-job-score strong').inner_text()=='不符合'
        assert '/ 100' not in card.inner_text()
        assert '必要 · Python + COBOL' in card.inner_text()
        assert page.locator('#job-results [data-job-id="legacy_unanalysed"]').get_by_role('button',name='分析這份 JD',exact=True).is_enabled()
        card.locator('.job-skill-chip').first.click()
        assert page.locator('dialog[open] mark').count()>0
        page.locator('dialog[open]').get_by_role('button',name='關閉',exact=True).click()
        page.reload();wait_js(page,'CareerProjects.isReady() && !!CareerWorkspace.getState()')
        assert page.locator('#job-results .saved-job-card').count()==2
        assert not extracted  # Merely opening legacy jobs never consumes an AI request.
        page.locator('#analyze-saved-jobs').click()
        wait_js(page,"CareerWorkspace.getState().jobs.every(j=>j.normalized)")
        assert len(extracted)==1
        assert 'Python 資料處理' in page.locator('#job-results [data-job-id="legacy_unanalysed"]').inner_text()
        assert '100%' in page.locator('#saved-analysis-summary').inner_text()
        card=page.locator('#job-results [data-job-id="legacy_job"]')
        card.get_by_role('button',name='查看已保存 JD',exact=True).click()
        page.locator('dialog[open]').get_by_role('button',name='更新要求摘要',exact=True).click()
        wait_js(page,"CareerWorkspace.getState().jobs.find(j=>j.id==='legacy_job').requirements[0].label==='Python 資料處理'")
        assert len(extracted)==2
        assert page.locator('dialog[open] mark').count()>0
        assert page.locator('dialog[open]').get_by_role('button',name='更新要求摘要',exact=True).count()==0
        assert not errors,errors
        assert len(calls)==1
        browser.close()
