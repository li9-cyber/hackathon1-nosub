"""Explicit live acceptance runner. Search has a durable one-request guard.

Private CV/state and browser session stay in ignored .test-runs. Public reports
contain timings/counts only. This script is never included in deployment images.
"""
import json
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
PRIVATE=ROOT/'.test-runs/cloud-jobs-qa'
OUT=ROOT/'test-results'
URL='https://hackathon.betatkl.com'
CV=Path(r'C:\Users\Li\Downloads\HK_MidTier_NonFinance_Student_CV.docx')

def wait(page,expression,seconds=90):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        if page.evaluate('() => Boolean('+expression+')'):return
        page.wait_for_timeout(250)
    raise AssertionError('Timed out: '+expression)

def run(phase):
    PRIVATE.mkdir(exist_ok=True,parents=True);OUT.mkdir(exist_ok=True)
    report_path=OUT/'cloud-jobs-validation.json'
    report=json.loads(report_path.read_text(encoding='utf-8')) if report_path.exists() else {'url':URL,'phases':{}}
    started=time.perf_counter();errors=[];requests=[];load_seconds=None
    with sync_playwright() as p:
        context=p.chromium.launch_persistent_context(str(PRIVATE/'chrome'),channel='chrome',headless=True,viewport={'width':1440,'height':1050},reduced_motion='reduce')
        page=context.pages[0] if context.pages else context.new_page()
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('request',lambda r:requests.append(r.url.split('?')[0]) if '/api/career/' in r.url else None)
        try:
            saved_project=json.loads((PRIVATE/'project.json').read_text())['id'] if (PRIVATE/'project.json').exists() else None
            page.goto(URL+('?project='+saved_project if saved_project else ''),wait_until='domcontentloaded')
            wait(page,'window.CareerWorkspace && window.CareerProjects',30)
            if phase=='cv':
                if not saved_project:
                    wait(page,"document.querySelector('#home-projects')?.children.length",30)
                    page.evaluate("CareerLayout.navigate('projects')")
                    page.locator('[data-create-project]:visible').first.click()
                    page.locator('#new-project-name').fill('Cloud acceptance 2026-10-18')
                    page.locator('#create-project-submit').click();wait(page,'CareerProjects.id()',30)
                    (PRIVATE/'project.json').write_text(json.dumps({'id':page.evaluate('CareerProjects.id()')}),encoding='utf-8')
                wait(page,"CareerProjects.id() && document.getElementById('workspace-message').textContent.includes('已保存')",45)
                assert not page.evaluate('CareerWorkspace.getState()?.extracted'),'CV already extracted; refuse duplicate call'
                page.evaluate("CareerLayout.navigate('input')")
                page.locator('[name="cv-mode"][value="file"]').check()
                page.locator('#cv-file').set_input_files(str(CV))
                t=time.perf_counter();page.locator('#submit-cv').click()
                wait(page,"['success','failed','timeout'].includes(CareerWorkspace.getState()?.cv_extraction?.status)",75)
                state=page.evaluate('CareerWorkspace.getState()')
                report['phases']['cv']={'browser_seconds':round(time.perf_counter()-t,3),**state['cv_extraction'],'items':len(state['items']),'skills':len(state['skill_evidence'])}
                assert state['cv_extraction']['status']=='success',state['cv_extraction']
                page.evaluate("CareerLayout.navigate('profile')")
                tags=page.locator('.cv-skill-tag')
                assert tags.count()>0
                tags.first.hover();assert page.locator('.cv-source-text mark').count()>0
                report['phases']['cv']['hover_highlight']=True
                page.locator('.cv-evidence-card').first.screenshot(path=str(OUT/'cloud-cv-card.png'))
            else:
                wait(page,'CareerWorkspace.getState()',30)
                wait(page,"document.getElementById('workspace-message').textContent.includes('已保存')",45)
                load_seconds=round(time.perf_counter()-started,3)
                expected=json.loads((PRIVATE/'project.json').read_text())['id']
                assert page.evaluate('CareerProjects.id()')==expected,'Refuse to mutate another project'
                if phase=='manual':
                    source=json.loads((ROOT/'.test-runs/manual-hsbc-job.json').read_text(encoding='utf-8'))
                    state=page.evaluate('CareerWorkspace.getState()');assert not any(j.get('url')==source['url'] for j in state['jobs']),'Manual JD already saved'
                    page.evaluate("CareerLayout.navigate('jobs')")
                    page.locator('#manual-job-entry').evaluate('(e)=>e.open=true')
                    page.locator('#job-url').fill(source['url']);page.locator('#job-jd').fill(source['jd'])
                    t=time.perf_counter();page.locator('#submit-job').click()
                    wait(page,"CareerWorkspace.getState()?.jobs?.some(j=>j.source==='pasted_jd'&&['success','failed','timeout'].includes(j.analysis_status))",90)
                    state=page.evaluate('CareerWorkspace.getState()');job=next(j for j in state['jobs'] if j['source']=='pasted_jd')
                    report['phases']['manual']={'browser_seconds':round(time.perf_counter()-t,3),'status':job['analysis_status'],'extraction':job.get('extraction'),'source_url':source['url']}
                    assert job['analysis_status']=='success',job.get('details_notice')
                    page.evaluate("CareerLayout.navigate('jobs')");verify_card(page,job,report['phases']['manual'])
                    assert not any(u.endswith('/search') for u in requests)
                elif phase=='search':
                    guard=PRIVATE/'techmap-once.json'
                    assert not guard.exists(),'Techmap already attempted; do not search again'
                    page.evaluate("CareerLayout.navigate('jobs')")
                    page.locator('#search-title').fill('Finance Analyst')
                    page.locator('#search-location').select_option('Hong Kong');page.locator('#search-salary').fill('0')
                    page.locator('#search-work-type').select_option('');page.locator('#search-contract-type').select_option('');page.locator('#search-work-place').select_option('')
                    assert not any(u.endswith('/search') for u in requests)
                    guard.write_text(json.dumps({'attempted_at':time.time(),'query':'Finance Analyst'}),encoding='utf-8')
                    t=time.perf_counter();page.locator('#search-jobs').click()
                    wait(page,"['success','failed','timeout'].includes(CareerWorkspace.getState()?.job_search?.status)",50)
                    state=page.evaluate('CareerWorkspace.getState()');report['phases']['search']=state['job_search']
                    assert state['job_search']['status']=='success',state['job_search']
                    wait(page,"CareerWorkspace.getState().jobs.filter(j=>j.source==='techmap').every(j=>['success','failed','timeout'].includes(j.analysis_status))",240)
                    state=page.evaluate('CareerWorkspace.getState()');jobs=[j for j in state['jobs'] if j['source']=='techmap']
                    report['phases']['search'].update(browser_all_cards_seconds=round(time.perf_counter()-t,3),search_requests=sum(u.endswith('/search') for u in requests),jobs=[summary(state,j) for j in jobs])
                    assert len(jobs)<=10 and sum(u.endswith('/search') for u in requests)==1
                    for job in jobs:
                        if job.get('normalized'):verify_card(page,job,report['phases']['search'])
                    page.screenshot(path=str(OUT/'cloud-jobs-desktop.png'),full_page=True)
                    page.locator('#job-results .saved-job-card').first.screenshot(path=str(OUT/'cloud-job-card.png'))
                elif phase in ('deep','deep_cache','deep_updated'):
                    page.evaluate("CareerLayout.navigate('jobs')")
                    state=page.evaluate('CareerWorkspace.getState()');job=next(j for j in state['jobs'] if j.get('normalized'))
                    card=page.locator('#job-results [data-job-id="'+job['id']+'"]')
                    t=time.perf_counter();card.get_by_role('button',name='查看深度分析' if job.get('deep_analysis') else '深度分析',exact=True).click()
                    wait(page,"!!document.querySelector('.saved-job-dialog[open]')",90)
                    state=page.evaluate('CareerWorkspace.getState()');job=next(j for j in state['jobs'] if j['id']==job['id'])
                    saved=job.get('deep_analysis');report['phases'][phase]={'browser_seconds':round(time.perf_counter()-t,3),'saved':bool(saved),'attempt':job.get('deep_attempt'),'deep_requests':sum(u.endswith('/job/deep') for u in requests),'score':saved.get('score') if saved else None}
                    assert saved,job.get('deep_attempt')
                    assert len(page.locator('dialog[open]').inner_text())>100
                    page.locator('dialog[open]').screenshot(path=str(OUT/'cloud-deep.png'))
                    if phase=='deep_cache':assert report['phases'][phase]['deep_requests']==0
                elif phase=='supplement':
                    state=page.evaluate('CareerWorkspace.getState()');old={m['job_id']:m['basis'] for m in state['matches']}
                    # Reuse an actual CV passage. No fabricated experience is added.
                    item=next(i for i in state['items'] if i['section'] in ('experience','project'))
                    page.evaluate("CareerLayout.navigate('profile')")
                    card=page.locator('.cv-evidence-card[data-item-id="'+item['id']+'"]')
                    form=card.locator('.cv-clarification')
                    form.locator('textarea').fill(item['text'][:3500])
                    t=time.perf_counter();form.get_by_role('button',name='保存並更新個人資料',exact=True).click()
                    wait(page,"CareerWorkspace.getState()?.evidence_profile?.supplemental_evidence?.some(s=>['success','failed','timeout'].includes(s.analysis_status))",75)
                    state=page.evaluate('CareerWorkspace.getState()');record=state['evidence_profile']['supplemental_evidence'][-1]
                    report['phases'][phase]={'browser_seconds':round(time.perf_counter()-t,3),'status':record['analysis_status'],'rematched':sum(m['basis']!=old.get(m['job_id']) for m in state['matches']),'techmap_requests':sum(u.endswith('/search') for u in requests),'jd_extractions':sum(u.endswith('/job/extract') for u in requests)}
                    assert record['analysis_status']=='success',record.get('message')
                    assert not any(u.endswith(('/search','/job/extract')) for u in requests)
                elif phase=='view':
                    state=page.evaluate('CareerWorkspace.getState()');page.evaluate("CareerLayout.navigate('jobs')")
                    cards=page.locator('#job-results .saved-job-card');assert cards.count()==len(state['jobs'])
                    for job in state['jobs']:
                        if job.get('normalized'):verify_card(page,job,report['phases'].setdefault('view',{}))
                    for color in ('high','medium','low'):
                        chip=page.locator('#job-results .job-skill-chip.match-'+color).first
                        assert chip.count(),color
                        chip.click();dialog=page.locator('dialog[open]')
                        assert dialog.locator('mark').count()>0
                        if color!='low':assert '原文證據' in dialog.inner_text() or '補充資訊證據' in dialog.inner_text()
                        dialog.get_by_role('button',name='關閉',exact=True).click()
                    external=cards.first.locator('.job-source-top')
                    with page.expect_popup() as popup:external.click()
                    popup.value.wait_for_load_state('domcontentloaded',timeout=30000)
                    report['phases']['view']['external_opened_url']=popup.value.url;popup.value.close()
                    formats=cards.evaluate_all("cards=>cards.map(c=>{const s=getComputedStyle(c);const title=getComputedStyle(c.querySelector('.job-open'));const score=getComputedStyle(c.querySelector('.saved-job-score'));return JSON.stringify([s.display,s.gridTemplateColumns,title.fontSize,title.fontFamily,score.padding])})")
                    assert len(set(formats))==1
                    page.locator('#job-results .saved-job-card').first.screenshot(path=str(OUT/'cloud-job-card.png'))
                    page.set_viewport_size({'width':390,'height':844});cards.first.scroll_into_view_if_needed()
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                    page.screenshot(path=str(OUT/'cloud-mobile-viewport.png'))
                    report['phases']['view'].update(cards=cards.count(),no_horizontal_overflow=True,consistent_card_format=True,three_color_evidence_checked=True,provider_requests=sum(u.endswith(('/search','/job/extract','/job/deep')) for u in requests))
                elif phase=='applications':
                    state=page.evaluate('CareerWorkspace.getState()');job=next(j for j in state['jobs'] if j.get('normalized'))
                    before=len(state['tailored']);assert before==0,'Application generation already tested'
                    page.evaluate("CareerLayout.navigate('applications')")
                    page.locator('#application-job').select_option(job['id']);page.locator('#confirm-jd').check()
                    t=time.perf_counter();page.locator('#generate-both').click()
                    wait(page,'CareerWorkspace.getState().tailored.length>0',100)
                    state=page.evaluate('CareerWorkspace.getState()');version=state['tailored'][-1]
                    assert version['final']['cv'] and version['final']['cover_letter']
                    report['phases'][phase]={'generation_seconds':round(time.perf_counter()-t,3),'cv_paragraphs':len(version['final']['cv']),'cover_paragraphs':len(version['final']['cover_letter'])}
                    page.locator('#versions').get_by_role('button',name='確認這份內容並保存',exact=True).click()
                    wait(page,'CareerWorkspace.getState().tailored.length===2',30)
                    with page.expect_download() as download:
                        page.locator('#versions').get_by_role('button',name='下載 TXT',exact=True).click()
                    download.value.save_as(str(PRIVATE/'application-export.txt'))
                    report['phases'][phase].update(saved_edit=True,txt_export_bytes=(PRIVATE/'application-export.txt').stat().st_size)
            state=page.evaluate('CareerWorkspace.getState()')
            (PRIVATE/'saved-state.json').write_text(json.dumps(state,ensure_ascii=False),encoding='utf-8')
            assert not errors,errors
            report['phases'].setdefault(phase,{}).update(passed=True,phase_seconds=round(time.perf_counter()-started,3),load_seconds=load_seconds,browser_errors=errors)
        except Exception as error:
            report['phases'].setdefault(phase,{}).update(passed=False,error=str(error)[:700],browser_errors=errors)
            page.screenshot(path=str(OUT/('cloud-'+phase+'-failure.png')))
            raise
        finally:
            report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
            context.close()
            print(json.dumps({'phase':phase,'result':report['phases'].get(phase)},ensure_ascii=False),flush=True)

def summary(state,job):
    m=next((m for m in state['matches'] if m['job_id']==job['id']),{})
    return dict(job_id=job['id'],jd_characters=len(job.get('jd','')),status=job['analysis_status'],extraction_seconds=job.get('extraction',{}).get('elapsed_seconds'),match_seconds=m.get('elapsed_seconds'),score=m.get('score'),band=m.get('band'),requirements=len(m.get('units',[])),colors={k:sum(u['status']==k for u in m.get('units',[])) for k in ('high','medium','low')})

def verify_card(page,job,report):
    card=page.locator('#job-results [data-job-id="'+job['id']+'"]');assert card.count()==1
    assert card.locator('.saved-job-score strong').inner_text() in ('高度符合','中度符合','不符合')
    assert card.locator('.job-skill-chip').count()==len(job['requirements'])
    if job.get('url'):assert card.locator('.job-source-top').get_attribute('href')==job['url']
    chips=card.locator('.job-skill-chip');chips.first.click()
    assert page.locator('dialog[open] .saved-jd-source mark').count()>0
    page.locator('dialog[open]').get_by_role('button',name='關閉',exact=True).click()
    report['cards_score_band_highlight_checked']=report.get('cards_score_band_highlight_checked',0)+1

if __name__=='__main__':run(sys.argv[1])
