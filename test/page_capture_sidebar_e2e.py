"""Capture cancellation, real rescan, and content-attached highlights in a disposable profile."""
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import expect

from e2e_support import extension_session
from page_capture_e2e import ARTICLE, PNG, FIXTURE_ORIGIN


def main():
    with extension_session('pd-capture-sidebar-') as run:
        url = FIXTURE_ORIGIN + '/capture-sidebar-fixture'
        run.context.route(FIXTURE_ORIGIN + '/**', lambda route: route.fulfill(
            body=ARTICLE if route.request.url == url else PNG,
            content_type='text/html' if route.request.url == url else 'image/png'))
        panel = run.open_page('collector.html', wait_until='networkidle')
        panel.set_viewport_size({'width': 390, 'height': 844})
        run.seed_storage(panel, {'entries': [], 'capturePermissionOnboarding': {
            'version': 1, 'acknowledgedAt': '2026-09-07T00:00:00Z', 'clipboardIncluded': True}})
        page = run.context.new_page()
        page.goto(url)
        page.bring_to_front()
        panel.evaluate("""() => {
          window.captureMessages = [];
          const send = chrome.runtime.sendMessage.bind(chrome.runtime);
          chrome.runtime.sendMessage = (...args) => {
            window.captureMessages.push(args[0]?.type);
            const result = send(...args);
            if (args[0]?.type === 'START_PAGE_CAPTURE' && window.holdNextCaptureReply) {
              window.holdNextCaptureReply = false;
              return result.then(value => new Promise(resolve => {window.releaseCaptureReply = () => resolve(value)}));
            }
            return result;
          };
        }""")
        panel.locator('#start-page-capture').evaluate('e => e.click()')
        expect(panel.locator('.page-capture-item').first).to_be_visible(timeout=10000)
        if '--highlight' not in sys.argv:
            panel.locator('.page-capture-confirm').first.click()
            panel.locator('.page-capture-tools > summary').click()
            panel.locator('#page-capture-clear').click()
            expect(panel.locator('#page-capture-save')).to_be_disabled()
            scans = panel.evaluate("window.captureMessages.filter(t => t === 'START_PAGE_CAPTURE').length")
            panel.locator('#page-capture-scan').click()
            panel.wait_for_function("n => window.captureMessages.filter(t => t === 'START_PAGE_CAPTURE').length > n", arg=scans, timeout=4000)
            expect(panel.locator('.page-capture-confirm').first).to_be_enabled(timeout=10000)
            expect(panel.locator('#page-capture-list-setup')).to_be_hidden()
            panel.locator('.page-capture-confirm').first.click()
            expect(panel.locator('#page-capture-save')).to_be_enabled()
            panel.locator('#page-capture-cancel').click()
            expect(panel.locator('#page-capture')).to_be_hidden()
            page.bring_to_front()
            panel.locator('#start-page-capture').evaluate('e => e.click()')
            expect(panel.locator('.page-capture-confirm').first).to_be_enabled(timeout=10000)

        page.evaluate('window.scrollTo(0,0)')
        panel.locator('.page-capture-confirm').first.click()
        page.wait_for_timeout(500)
        assert page.evaluate('window.scrollY') == 0, 'Selecting content must not move the reader to the middle of an article'
        target = page.locator('article p').first
        expect(target).to_have_attribute('data-promptdirector-capture-highlight', 'true')
        assert target.evaluate("e => getComputedStyle(e).outlineStyle") == 'solid'
        assert page.locator('#promptdirector-page-capture-region-preview').evaluate('e => e.tagName') == 'STYLE'
        before = target.bounding_box()
        page.evaluate('window.scrollBy(0,350)')
        after = target.bounding_box()
        assert abs(before['y'] - after['y'] - 350) < 1
        assert target.evaluate("e => getComputedStyle(e).outlineStyle") == 'solid'
        # Browser layout owns the outline: an inner scroll or reflow moves the
        # marked content, without a stale viewport-sized rectangle.
        page.locator('main').evaluate("e => {e.style.height='220px';e.style.overflow='auto'}")
        before_inner = target.bounding_box()
        page.locator('main').evaluate('e => e.scrollTop = 100')
        after_inner = target.bounding_box()
        assert abs(before_inner['y'] - after_inner['y'] - 100) < 1
        page.set_viewport_size({'width': 900, 'height': 700})
        assert target.evaluate("e => getComputedStyle(e).outlineStyle") == 'solid'
        page.locator('main').evaluate("e => {e.removeAttribute('style')}")

        panel.locator('#page-capture-media-review > summary').click()
        first_media = panel.locator('.page-capture-media-review-item').first
        first_media.get_by_role('button', name='排除', exact=True).click()
        expect(first_media).to_have_class('page-capture-media-review-item media-excluded media-pending')
        first_media.get_by_role('button', name='恢复', exact=True).click()
        expect(first_media).to_have_class('page-capture-media-review-item media-proposed media-pending')
        panel.locator('#page-capture-media-review > summary').click()
        panel.locator('.page-capture-tools > summary').click()
        panel.locator('#page-capture-add-region').click()
        expect(page.locator('#promptdirector-page-capture-region-editor')).to_be_visible()
        panel.locator('#page-capture-edit-cancel').click()
        expect(page.locator('#promptdirector-page-capture-region-editor')).to_have_count(0)
        expect(panel.locator('#page-capture-save')).to_be_enabled()
        expect(target).to_have_attribute('data-promptdirector-capture-highlight', 'true')

        # A completed but late response from a cancelled scan must not replace
        # the fresh result or the user's new selection.
        panel.evaluate('window.holdNextCaptureReply = true')
        page.bring_to_front()
        panel.locator('#page-capture-scan').click()
        panel.wait_for_function("() => typeof window.releaseCaptureReply === 'function'")
        panel.locator('#page-capture-cancel').click()
        expect(panel.locator('#page-capture-scan')).to_be_enabled()
        panel.locator('#page-capture-scan').click()
        expect(panel.locator('.page-capture-confirm').first).to_be_enabled(timeout=10000)
        panel.locator('.page-capture-confirm').first.click()
        panel.evaluate('window.releaseCaptureReply()')
        expect(panel.locator('.page-capture-item.confirmed')).to_have_count(1)
        expect(panel.locator('#page-capture-save')).to_be_enabled()
        for width in [320, 390]:
            panel.set_viewport_size({'width': width, 'height': 640})
            box = panel.locator('#page-capture-save').bounding_box()
            assert box and box['y'] >= 0 and box['y'] + box['height'] <= 640, box
            assert panel.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert panel.locator('.page-capture-confirm').first.evaluate('e => getComputedStyle(e).backgroundColor') != panel.locator('#page-capture-save').evaluate('e => getComputedStyle(e).backgroundColor')
        panel.screenshot(path=str(Path(tempfile.gettempdir()) / 'promptdirector-capture-sidebar-implemented.png'))
        panel.locator('.page-capture-tools > summary').click()
        panel.locator('#page-capture-clear').click()
        expect(page.locator('[data-promptdirector-capture-highlight]')).to_have_count(0)
        assert panel.evaluate("() => chrome.storage.local.get('entries').then(s => s.entries.length)") == 0
        print({'rescan': '--highlight' not in sys.argv, 'selectPreservesScroll': True, 'contentAttachedOutline': True,
               'innerScrollAndResize': True, 'cancelRegionEdit': True, 'lateResponseIgnored': True,
               'saveVisibleAt320And390': True, 'clearRemovesHighlight': True})


if __name__ == '__main__':
    main()
