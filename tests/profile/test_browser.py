"""Real Chromium interactions against the app, with only the AI response mocked."""
import asyncio
import json
import os
import socket
import threading
import time
from pathlib import Path
import pytest
import uvicorn
from playwright.sync_api import sync_playwright
from career_twin.api.main import app
from career_twin.profile import provider
from tests.profile.fixtures import document_bytes, model_result, supplement_result, NAMES, SUPPLEMENT


def wait_js(page, expression, timeout=15000):
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        if page.evaluate('() => Boolean(' + expression + ')'):
            return
        page.wait_for_timeout(100)
    raise AssertionError('UI did not reach expected state: ' + expression)


def open_project(page, url):
    page.goto(url)
    wait_js(page, 'window.CareerWorkspace && window.CareerProjects', timeout=5000)
    page.evaluate("CareerLayout.navigate('projects')")
    page.locator('[data-create-project]:visible').first.click()
    page.locator('#new-project-name').fill('Synthetic browser QA')
    page.locator('#create-project-submit').click()
    wait_js(page, 'window.CareerProjects?.id() && CareerProjects.isReady()')
    page.evaluate("CareerLayout.navigate('input')")


@pytest.fixture
def server(tmp_path, monkeypatch):
    monkeypatch.setenv('CAREER_PROJECT_DATA_DIR', str(tmp_path / 'data'))
    monkeypatch.setenv('CAREER_LOGIN_ENABLED', '0')
    monkeypatch.delenv('K_SERVICE', raising=False)
    monkeypatch.delenv('CAREER_PROJECT_STORAGE', raising=False)
    calls = []
    real_extract = provider.extract
    async def fake(text):
        calls.append(text)
        if os.getenv('CV_LIVE_QA') == '1':
            result = await real_extract(text)
            (tmp_path / ('provider-' + str(len(calls)) + '.json')).write_text(result.model_dump_json(indent=2), encoding='utf-8')
            return result
        await asyncio.sleep(.15)
        return model_result(text) if 'EXPERIENCE' in text else supplement_result(text)
    monkeypatch.setattr(provider, 'extract', fake)
    sock = socket.socket()
    sock.bind(('127.0.0.1', 0))
    url = 'http://127.0.0.1:' + str(sock.getsockname()[1])
    runner = uvicorn.Server(uvicorn.Config(app, log_level='error', access_log=False))
    thread = threading.Thread(target=runner.run, kwargs={'sockets': [sock]}, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not runner.started and time.monotonic() < deadline:
        time.sleep(.05)
    assert runner.started
    yield url, calls
    runner.should_exit = True
    thread.join(timeout=5)
    sock.close()


@pytest.mark.parametrize('extension', ['pdf', 'docx', 'txt'])
def test_existing_ui_upload_hover_scroll_and_reload(server, tmp_path, extension):
    url, calls = server
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        open_project(page, url)
        assert not errors, errors
        page.locator('[name="cv-mode"][value="file"]').check()
        page.locator('#cv-file').set_input_files({'name': 'synthetic.' + extension, 'mimeType': 'application/octet-stream', 'buffer': document_bytes(extension)})
        started = time.perf_counter()
        page.locator('#submit-cv').click()
        wait_js(page, "['success','failed','timeout'].includes(CareerWorkspace.getState()?.cv_extraction?.status)", timeout=35000)
        assert page.evaluate('CareerWorkspace.getState().cv_extraction.status') == 'success', page.evaluate('CareerWorkspace.getState().cv_extraction')
        wait_js(page, "CareerWorkspace.getState()?.cv_extraction?.status === 'success'", timeout=35000)
        assert len(calls) == 1
        elapsed = time.perf_counter() - started
        card = page.locator('.cv-evidence-card').first
        source = card.locator('.cv-source-text').first
        assert card.locator('.cv-original-column').bounding_box()['x'] < card.locator('.cv-capability-column').bounding_box()['x']
        python = card.locator('[data-skill-id="sk_python"]')
        python.hover()
        assert source.locator('mark').count() == 2
        assert page.locator('[data-profile-section="skill"] mark').count() >= 1
        before = source.text_content()
        card.locator('h4').hover()
        assert source.locator('mark').count() == 0
        assert source.text_content() == before
        python.focus()
        assert source.locator('mark').count() == 2
        python.press('Escape')
        assert source.locator('mark').count() == 0
        python.click()
        card.locator('h4').hover()
        assert source.locator('mark').count() == 2
        python.press('Escape')
        skills = page.locator('[data-profile-section="skill"] .cv-evidence-card')
        assert skills.locator('.cv-skill-tag').count() == len(NAMES)
        rail = skills.locator('.cv-skill-rail')
        assert rail.evaluate('(node)=>node.scrollWidth>node.clientWidth')
        skills.locator('.cv-skill-scroll-arrow').last.click()
        assert rail.evaluate('(node)=>node.scrollLeft') > 0
        unknown = skills.get_by_role('button', name='CustomTool-X', exact=True)
        unknown.hover()
        assert 'CustomTool-X' in ''.join(skills.locator('mark').all_text_contents())
        saved = page.evaluate('CareerWorkspace.getState()')
        assert saved['activity_evidence']
        assert card.locator('.cv-extracted-activities').count() == 0
        assert 'Example Bank' in card.locator('.cv-capability-column .profile-fields').inner_text()
        page.reload()
        wait_js(page, "window.CareerWorkspace?.getState()?.cv_extraction?.status === 'success'")
        page.evaluate("CareerLayout.navigate('profile')")
        assert page.locator('.cv-evidence-card').first.locator('.cv-source-text').text_content() == before
        assert page.evaluate('CareerWorkspace.getState().skill_evidence') == saved['skill_evidence']
        assert page.evaluate('CareerWorkspace.getState().activity_evidence') == saved['activity_evidence']
        assert page.evaluate('CareerWorkspace.getState().items') == saved['items']
        page.locator('.cv-evidence-card').first.locator('[data-skill-id="sk_python"]').hover()
        assert page.locator('.cv-evidence-card').first.locator('mark').count() == 2
        assert len(calls) == 1
        # Narrow viewport keeps the native rail scrollable without page overflow.
        original = page.locator('.cv-evidence-card').first.locator('.cv-original-column > .cv-source-text').text_content()
        form = page.locator('.cv-evidence-card').first.locator('.cv-clarification')
        form.locator('textarea').fill(SUPPLEMENT)
        supplement_started = time.perf_counter()
        form.get_by_role('button', name='保存並更新個人資料', exact=True).click()
        wait_js(page, "CareerWorkspace.getState().evidence_profile.supplemental_evidence[0]?.analysis_status === 'success'", timeout=35000)
        supplement_elapsed = time.perf_counter() - supplement_started
        assert len(calls) == 2 and calls[-1] == SUPPLEMENT
        card = page.locator('.cv-evidence-card').first
        card.locator('[data-skill-id]').filter(has_text='Docker').hover()
        assert card.locator('.cv-original-column > .cv-source-text mark').count() == 0
        assert card.locator('.cv-answer-source mark').count() == 1
        assert card.locator('.cv-original-column > .cv-source-text').text_content() == original
        card.locator('[data-skill-id="sk_python"]').hover()
        assert card.locator('.cv-original-column > .cv-source-text mark').count() == 2
        assert card.locator('.cv-answer-source mark').count() == 1
        supplement_state = page.evaluate('CareerWorkspace.getState()')
        page.reload()
        wait_js(page, "window.CareerWorkspace?.getState()?.evidence_profile?.supplemental_evidence[0]?.analysis_status === 'success'")
        page.evaluate("CareerLayout.navigate('profile')")
        assert page.evaluate('CareerWorkspace.getState().skill_evidence') == supplement_state['skill_evidence']
        assert page.locator('.cv-evidence-card').first.locator('.cv-clarification textarea').input_value() == ''
        assert len(calls) == 2
        page.locator('.cv-evidence-card').first.screenshot(path=str(tmp_path / ('desktop-card-' + extension + '.png')))
        page.set_viewport_size({'width': 390, 'height': 844})
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        page.screenshot(path=str(tmp_path / ('profile-' + extension + '.png')), full_page=True)
        assert not errors, errors
        print(json.dumps({'format': extension, 'provider': 'live' if os.getenv('CV_LIVE_QA') == '1' else 'mock',
            'browser_end_to_end_seconds': round(elapsed, 3), 'supplement_seconds': round(supplement_elapsed, 3),
            'skills': len(saved['skill_evidence']), 'screenshot': str(tmp_path / ('desktop-card-' + extension + '.png'))}))
        browser.close()


@pytest.mark.parametrize('action', ['reload', 'cancel_wait'])
def test_reload_during_extraction_uses_saved_attempt(server, monkeypatch, action):
    url, _ = server
    entered = threading.Event()
    calls = []
    async def delayed(text):
        calls.append(text)
        entered.set()
        await asyncio.sleep(2)
        return model_result(text)
    monkeypatch.setattr(provider, 'extract', delayed)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)
        page = browser.new_page()
        open_project(page, url)
        page.locator('#cv-text').fill(document_bytes('txt').decode())
        page.locator('#submit-cv').click()
        assert entered.wait(5)
        if action == 'reload':
            page.reload()
        else:
            page.locator('#cancel-profile').click()
            wait_js(page, "document.body.getAttribute('aria-busy') === 'false'")
        wait_js(page, "window.CareerWorkspace?.getState()?.cv_extraction?.status === 'success'")
        wait_js(page, "document.body.getAttribute('aria-busy') === 'false'")
        assert len(calls) == 1
        page.evaluate("CareerLayout.navigate('profile')")
        assert page.locator('.cv-skill-tag').count() == len(NAMES) + 3
        browser.close()
