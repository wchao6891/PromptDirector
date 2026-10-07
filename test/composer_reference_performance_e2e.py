"""Large-library reference opening must paint a bounded window, retaining full selection."""
from __future__ import annotations
import json
import os
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import base_entry, extension_session


def assert_window_bounded(page):
    # Scroll and responsive layout use a scheduled animation frame.
    page.evaluate('async () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    geometry = page.evaluate(r"""() => {
      const list = document.querySelector('#composer-case-list');
      const picker = document.querySelector('#composer-case-picker');
      const root = getComputedStyle(picker).overflowY === 'visible' ? picker.parentElement : picker;
      const cards = [...list.querySelectorAll('.composer-case-option')];
      return {count: cards.length, columns: getComputedStyle(list).gridTemplateColumns.split(/\s+/).length,
        height: root.clientHeight, cardHeight: Math.min(...cards.map(card => card.getBoundingClientRect().height))};
    }""")
    # Three viewport heights, two partial edge rows and one focused offscreen card.
    import math
    bound = geometry['columns'] * (math.ceil(3 * geometry['height'] / geometry['cardHeight']) + 2) + 1
    assert geometry['count'] <= bound, (geometry, bound)


def main():
    total = 11000
    entries = [base_entry(f'reference-{i}', f'参考案例 {i:05d}', f'完整提示词 {i}\n保留原始正文。', 'content:prompt:image') for i in range(total)]
    with extension_session('pd-composer-reference-performance-') as run:
        setup = run.open_page('collector.html')
        run.seed_storage(setup, {'schemaVersion': 24, 'entries': entries, 'organizerState': {'collections': [{'id': 'last-project', 'name': '最后项目', 'entryIds': [entries[-1]['id']]}]}})
        page = run.open_page('composer.html')
        expect(page.locator('#composer-save-state')).to_have_text('新对话')
        result = page.evaluate("""async () => {
          const tasks = []; const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => e.duration)));
          observer.observe({type: 'longtask', buffered: false});
          const before = performance.now(); document.querySelector('#composer-reference-open').click();
          const handlerMs = performance.now() - before;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const result = {handlerMs, paintMs: performance.now()-before,
            mounted: document.querySelectorAll('.composer-case-option').length,
            domNodes: document.querySelector('#composer-case-list').querySelectorAll('*').length};
          await new Promise(resolve => setTimeout(resolve, 50)); observer.disconnect();
          result.longTasks = tasks; return result;
        }""")
        print(json.dumps({'totalCases': total, 'opening': result}, ensure_ascii=False), flush=True)
        evidence_dir = os.environ.get('PD_REFERENCE_EVIDENCE_DIR')
        if evidence_dir:
            Path(evidence_dir).mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(Path(evidence_dir) / 'references-wide.png'))
        if os.environ.get('PD_REFERENCE_MEASURE_ONLY') == '1':
            return
        assert result['mounted'] < total, 'Reference opening constructed every case before showing the interface'
        assert_window_bounded(page)
        first_ids = page.locator('.composer-case-option').evaluate_all('nodes => nodes.map(n => n.dataset.entryId)')
        assert first_ids == [entry['id'] for entry in entries[:len(first_ids)]], first_ids
        first = page.locator('.composer-case-option').first
        first.locator(':scope > input[type=checkbox]').check()
        page.locator('#composer-case-picker').evaluate('(node) => node.scrollTop = node.scrollHeight')
        last = page.locator(f'.composer-case-option[data-entry-id="{entries[-1]["id"]}"]')
        expect(last).to_be_visible()
        assert_window_bounded(page)
        last.locator(':scope > input[type=checkbox]').check()
        page.locator('#composer-reference-search').fill('完整提示词 9876')
        expect(page.locator('.composer-case-option')).to_have_count(1)
        expect(page.locator('.composer-case-option')).to_have_attribute('data-entry-id', 'reference-9876')
        page.locator('#composer-reference-search').fill('')
        page.locator('#composer-reference-project-filter').select_option('last-project')
        expect(page.locator('.composer-case-option')).to_have_count(1)
        expect(last.locator(':scope > input[type=checkbox]')).to_be_checked()
        page.locator('#composer-reference-apply').click()
        page.wait_for_function("() => new URL(location.href).searchParams.has('session')")
        session = page.evaluate("""async () => (await chrome.runtime.sendMessage({type:'GET_COMPOSER_SESSION',sessionId:new URL(location.href).searchParams.get('session')})).session""")
        assert [item['entryId'] for item in session['referenceSnapshots']] == [entries[0]['id'], entries[-1]['id']]
        assert [item['originalText'] for item in session['referenceSnapshots']] == [entries[0]['text'], entries[-1]['text']]
        page.locator('#composer-reference-open').click()
        expect(last.locator(':scope > input[type=checkbox]')).to_be_checked()
        page.locator('#composer-reference-project-filter').select_option('')
        expect(page.locator('.composer-case-option').first.locator(':scope > input[type=checkbox]')).to_be_checked()
        # Resizing at the end must not mount the entire library or lose the end.
        page.locator('#composer-case-picker').evaluate('(node) => node.scrollTop = node.scrollHeight')
        expect(last).to_be_visible()
        page.set_viewport_size({'width':950, 'height':900})
        expect(last).to_be_visible()
        assert_window_bounded(page)
        # The mobile layout scrolls the outer body rather than the case picker.
        page.set_viewport_size({'width':390, 'height':844})
        page.locator('#composer-reference-search').fill('')
        page.locator('.composer-reference-body').evaluate('(node) => node.scrollTop = node.scrollHeight')
        expect(last).to_be_visible()
        expect(last.locator(':scope > input[type=checkbox]')).to_be_checked()
        assert_window_bounded(page)
        if evidence_dir:
            page.screenshot(path=str(Path(evidence_dir) / 'references-narrow-end.png'))
        print('PASS: reference window, stable order, full-library search, project, offscreen selections and narrow scrolling')

if __name__ == '__main__': main()
