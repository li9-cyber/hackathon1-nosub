import asyncio
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright
from tests.profile.test_browser import server,open_project,wait_js
from tests.profile.fixtures import document_bytes,SUPPLEMENT
from tests.jobs.test_flow import page as response_page,result,JD
from career_twin.jobs import provider,ai
from career_twin.jobs import service

def test_ten_cards_evidence_deep_reload_filters(server,monkeypatch,tmp_path):
    url,cv_calls=server
    searches=[];extractions=[];deep_calls=[];active=0;peak=0
    async def search(body):
        searches.append(body)
        return dict(jobs=[provider.map_job(r) for r in response_page()['result']],total_count=10,parameters=provider.parameters(body))
    async def extract(text):
        nonlocal active,peak
        active+=1;peak=max(peak,active);extractions.append(text);await asyncio.sleep(.15);active-=1
        return result()
    async def deep(*args):deep_calls.append(1);await asyncio.sleep(.1);return dict(strengths=['Python 使用經歷'],gaps=['目前未找到 COBOL 證據'],suggestions=['補充實際使用經歷'])
    monkeypatch.setattr(provider,'search',search);monkeypatch.setattr(ai,'extract',extract);monkeypatch.setattr(ai,'deep',deep)
    with sync_playwright() as p:
        browser=p.chromium.launch(channel='chrome',headless=True)
        page=browser.new_page(viewport=dict(width=1440,height=1100),reduced_motion='reduce')
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        open_project(page,url)
        page.locator('[name="cv-mode"][value="file"]').check()
        page.locator('#cv-file').set_input_files(dict(name='synthetic.txt',mimeType='text/plain',buffer=document_bytes('txt')))
        page.locator('#submit-cv').click();wait_js(page,"CareerWorkspace.getState()?.cv_extraction?.status==='success'")
        page.evaluate("CareerLayout.navigate('jobs')")
        page.locator('#search-title').fill('Analyst');page.locator('#search-location').select_option('Kowloon')
        page.locator('#search-salary').fill('20000');page.locator('#search-work-type').select_option('fulltime')
        page.wait_for_timeout(200);assert searches==[]
        started=time.perf_counter();page.locator('#search-jobs').click()
        wait_js(page,"CareerWorkspace.getState()?.matches?.length===10",20000)
        assert len(searches)==1 and len(extractions)==10 and peak<=3 and peak>1
        assert page.locator('#bookmarked-job-results .saved-job-card').count()==0
        page.locator('#job-area-shell .job-area-home').click()
        expected=page.evaluate('Array.from(new Set(CareerWorkspace.getState().skill_evidence.filter(r=>r.display!==false).map(r=>r.skill_id))).sort()')
        assert sorted(page.locator('#job-analysis-home [data-skill-id]').evaluate_all('(nodes)=>nodes.map(n=>n.dataset.skillId)'))==expected
        assert page.locator('#job-analysis-home .saved-job-card').count()==0
        assert page.locator('#job-area-shell .job-area-children button').count()==4
        page.locator('#job-area-shell [data-page="jobs"]').click()
        assert searches[0]['city']=='Kowloon' and searches[0]['minimum_salary']==20000
        cards=page.locator('#job-results .saved-job-card');assert cards.count()==10
        card=cards.first
        assert card.locator('.job-skill-chip').first.evaluate('(n)=>parseFloat(getComputedStyle(n).fontSize)')>=18
        badge=card.locator('.saved-job-score').bounding_box();deep_size=card.locator('.job-next-action>.button-primary:not(.job-apply)').bounding_box()
        assert abs(badge['height']-deep_size['height'])<1 and abs(badge['width']-deep_size['width'])<1
        page.route('**/api/career/job/bookmark',lambda route:route.fulfill(status=503,content_type='application/json',body=json.dumps({'error':{'code':'test_failure','message':'Synthetic save failure'}})))
        card.locator('.job-bookmark').click()
        page.locator('#search-notice').get_by_text('書籤未能保存：',exact=False).wait_for()
        assert card.locator('.job-bookmark').get_attribute('aria-pressed')=='false'
        assert page.locator('#bookmarked-job-results .saved-job-card').count()==0
        page.unroute('**/api/career/job/bookmark')
        card.locator('.job-bookmark').click()
        wait_js(page,"CareerWorkspace.getState().jobs[0].bookmarked===true")
        page.locator('#job-area-shell [data-page="saved-jobs"]').click()
        assert page.locator('#bookmarked-job-results .saved-job-card').count()==1
        page.reload();wait_js(page,"CareerProjects.isReady() && document.body.dataset.page==='saved-jobs' && CareerWorkspace.getState()?.jobs[0]?.bookmarked===true")
        assert page.locator('#view-saved-jobs').is_visible()
        assert page.locator('#bookmarked-job-results .job-bookmark').get_attribute('aria-pressed')=='true'
        page.locator('#bookmarked-job-results .job-bookmark').click()
        wait_js(page,"CareerWorkspace.getState().jobs[0].bookmarked===false")
        assert page.locator('#bookmarked-job-results .saved-job-card').count()==0
        page.locator('#job-area-shell [data-page="jobs"]').click()
        assert cards.count()==10 and card.locator('.job-bookmark').get_attribute('aria-pressed')=='false'
        assert len(extractions)==10 and len(searches)==1 and len(cv_calls)==1
        assert page.locator('#view-jobs .job-match-legend>div').count()==3
        assert card.locator('.hint').count()==0
        card.get_by_role('button',name='申請',exact=True).click()
        wait_js(page,"document.body.dataset.page==='applications' && !!CareerWorkspace.getState().jobs[0].bookmarked")
        chosen=page.evaluate('CareerWorkspace.getState().jobs[0].id')
        assert page.locator('#application-job').input_value()==chosen
        page.get_by_text('查看職位內容與目前資格結果',exact=True).click()
        assert page.locator('#selected-job-description').inner_text()==JD
        assert 'Synthetic Company' in page.locator('#selected-job-title').inner_text()
        assert page.locator('#selected-job-match .job-source-top').get_attribute('href')=='https://example.com/job/0'
        page.wait_for_timeout(700)
        page.reload();wait_js(page,"CareerWorkspace.getState()?.matches?.length===10")
        wait_js(page,"CareerProjects.isReady() && document.body.dataset.page==='applications'")
        assert page.locator('#application-job').input_value()==chosen
        assert page.locator('#bookmarked-job-results .saved-job-card').count()==1
        assert not page.evaluate('CareerWorkspace.getState().tailored.length')
        assert len(extractions)==10 and len(searches)==1 and len(cv_calls)==1 and not deep_calls
        page.locator('#job-area-shell [data-page="jobs"]').click()
        assert card.locator('.match-high').count()>0 and card.locator('.match-medium').count()>0 and card.locator('.match-low').count()>0
        assert card.locator('.job-identity').bounding_box()['x']<card.locator('.job-analysis-column').bounding_box()['x']
        assert card.locator('.job-source-top').get_attribute('href')=='https://example.com/job/0'
        with page.expect_popup() as popup:
            card.locator('.job-source-top').click()
        popup.value.wait_for_url('https://example.com/job/0');popup.value.close()
        card.locator('.job-skill-chip').first.click()
        assert page.locator('dialog mark').count()>0
        assert 'CV 原文證據' in page.locator('dialog[open]').inner_text()
        page.locator('dialog[open]').get_by_role('button',name='關閉',exact=True).click()
        card.get_by_role('button',name='深度分析',exact=True).click();wait_js(page,"!!CareerWorkspace.getState()?.jobs[0].deep_analysis")
        assert len(deep_calls)==1
        page.locator('dialog[open]').get_by_role('button',name='關閉',exact=True).click()
        page.reload();wait_js(page,"CareerWorkspace.getState()?.matches?.length===10")
        page.evaluate("CareerLayout.navigate('jobs')")
        page.locator('#job-results .saved-job-card').first.get_by_role('button',name='查看深度分析').click()
        assert len(deep_calls)==1 and len(extractions)==10 and len(searches)==1
        page.locator('dialog[open]').get_by_role('button',name='關閉',exact=True).click()
        old_score=page.evaluate('CareerWorkspace.getState().matches[0].score')
        page.evaluate("CareerLayout.navigate('profile')")
        form=page.locator('.cv-evidence-card').first.locator('.cv-clarification')
        form.locator('textarea').fill(SUPPLEMENT)
        form.get_by_role('button',name='保存並更新個人資料',exact=True).click()
        wait_js(page,"CareerWorkspace.getState()?.evidence_profile?.supplemental_evidence[0]?.analysis_status==='success'")
        assert page.evaluate('CareerWorkspace.getState().matches[0].score')>old_score
        assert not page.evaluate('Boolean(CareerWorkspace.getState().jobs[0].deep_analysis)')
        assert len(searches)==1 and len(extractions)==10
        page.evaluate("CareerLayout.navigate('jobs')")
        page.locator('#job-results .saved-job-card').first.get_by_role('button',name='Docker：有對應技能及實際使用證據',exact=True).click()
        assert '補充資訊證據' in page.locator('dialog[open]').inner_text()
        page.locator('dialog[open]').get_by_role('button',name='關閉',exact=True).click()
        page.locator('#job-results .saved-job-card').last.scroll_into_view_if_needed()
        assert page.locator('#job-results .saved-job-card').last.is_visible()
        page.screenshot(path=str(tmp_path/'jobs-desktop.png'),full_page=True)
        page.set_viewport_size(dict(width=390,height=844));page.wait_for_timeout(300)
        assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')
        mobile_card=page.locator('#job-results .saved-job-card').last
        badge=mobile_card.locator('.saved-job-score').bounding_box();deep_size=mobile_card.locator('.job-next-action>.button-primary:not(.job-apply)').bounding_box()
        assert abs(badge['height']-deep_size['height'])<1 and abs(badge['width']-deep_size['width'])<1
        page.screenshot(path=str(tmp_path/'jobs-mobile.png'),full_page=True)
        assert not errors,errors
        (tmp_path/'browser-result.json').write_text(json.dumps(dict(seconds=round(time.perf_counter()-started,3),searches=len(searches),extractions=len(extractions),max_parallel=peak,deep_calls=len(deep_calls),errors=errors)),encoding='utf-8')
        browser.close()

def test_slow_jd_shows_longer_message_then_result(server,monkeypatch):
    url,_=server
    async def slow(text):
        state=service.read();job=state['jobs'][0]
        job['extraction']['started_at']-=21
        service.save(state,'qa_elapsed_target')
        await asyncio.sleep(3)
        return result()
    monkeypatch.setattr(ai,'extract',slow)
    async def search(body):return dict(jobs=[provider.map_job(response_page()['result'][0])],total_count=1,parameters={})
    monkeypatch.setattr(provider,'search',search)
    with sync_playwright() as p:
        browser=p.chromium.launch(channel='chrome',headless=True)
        page=browser.new_page();open_project(page,url)
        page.locator('#cv-text').fill(document_bytes('txt').decode())
        page.locator('#submit-cv').click();wait_js(page,"CareerWorkspace.getState()?.cv_extraction?.status==='success'")
        page.evaluate("CareerLayout.navigate('jobs')")
        page.locator('#search-title').fill('Analyst');page.locator('#search-jobs').click()
        page.get_by_text('系統需要更長時間處理，完成後會自動顯示。',exact=True).wait_for(timeout=10000)
        wait_js(page,"CareerWorkspace.getState()?.matches?.length===1")
        assert page.locator('.saved-job-score').first.inner_text()
        browser.close()
