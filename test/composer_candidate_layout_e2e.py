"""Candidate previews stay local and cannot push the conversation outside its column."""
from __future__ import annotations

import os
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import base_entry, extension_session


def assert_centered(page):
    metrics = page.evaluate("""() => {
      const rect = selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return {left:r.left, right:r.right, width:r.width, center:(r.left+r.right)/2};
      };
      return {viewport:innerWidth, chat:rect('.composer-chat'), body:rect('.composer-chat-inner'),
        input:rect('.composer-input-box'), sources:rect('.composer-library-results')};
    }""")
    for key in ['body', 'input', 'sources']:
        box = metrics[key]
        assert box['left'] >= metrics['chat']['left'] and box['right'] <= metrics['viewport'], metrics
        assert abs(box['center'] - metrics['chat']['center']) <= 1, metrics
    return metrics


def main():
    entries = []
    for index in range(24):
        entry = base_entry(f'candidate-{index}', f'{index + 1:02d} · 雨夜追逐镜头与导演布光参考 / ' + '超长案例标题' * 8,
                           '这是明确标注的布局测试资料。', 'content:reference')
        if index % 3 != 1:
            entry['mediaAssets'] = [{'id': f'image-{index}', 'kind':'image', 'usage':'content',
                                     'storageMode':'managed', 'mimeType':'image/png', 'width':240, 'height':160}]
            entry['primaryMediaId'] = f'image-{index}'
        if index == 0:
            entry['mediaAssets'].append({**entry['mediaAssets'][0], 'id':'image-second'})
        entries.append(entry)
    candidates = [{'caseId':e['id'], 'title':e['title'], 'excerpt':e['text']} for e in entries]
    session = {'id':'candidate-layout', 'title':'查询候选布局测试', 'targetType':'image',
               'libraryTools':{'candidates':candidates, 'events':[{'callId':'search-1','name':'search_cases', 'status':'completed','userMessageId':'question', 'label':'找到 24 个案例，本页 24 个', 'candidates':candidates}]}, 'messages':[
                   {'id':'question', 'role':'user', 'type':'request', 'content':'找一下雨夜追逐相关案例，先列候选。'},
                   {'id':'answer', 'role':'assistant', 'type':'prompt', 'content':'找到了相关案例，请在下方查看候选。'}]}
    with extension_session('prompt-director-candidate-layout-', viewport={'width':1853, 'height':845}) as run:
        setup = run.open_page('collector.html')
        run.seed_storage(setup, {'schemaVersion':24, 'entries':entries, 'composerSessions':[session]})
        setup.evaluate("""async () => {
          const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
          const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 160;
          const ctx = canvas.getContext('2d');
          for (let i=0;i<24;i++) {
            if (i%3 === 1) continue;
            ctx.fillStyle = i%2 ? '#65486d' : '#163e57'; ctx.fillRect(0,0,240,160);
            ctx.fillStyle = '#d4f536'; ctx.fillRect(35+i*2,35,60,90);
            ctx.fillStyle = '#fff'; ctx.font = '16px sans-serif'; ctx.fillText('TEST ' + (i+1), 120,85);
            await saveMediaBlob('image-'+i, await new Promise(resolve=>canvas.toBlob(resolve,'image/png')));
          }
          await saveMediaBlob('image-second', await new Promise(resolve=>canvas.toBlob(resolve,'image/png')));
        }""")
        page = run.open_page('composer.html?session=candidate-layout')
        expect(page.locator('.composer-library-candidate')).to_have_count(24)
        artifacts = os.environ.get('PROMPTDIRECTOR_E2E_ARTIFACT_DIR')
        if artifacts:
            Path(artifacts).mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(Path(artifacts)/'candidate-desktop.png'), full_page=True)
        assert_centered(page)
        image = page.locator('.composer-library-candidate img').first
        expect(image).to_be_visible()
        page.wait_for_function("() => { const image = document.querySelector('.composer-library-candidate img'); return image?.complete && image.naturalWidth > 0; }")
        expect(page.locator('.composer-library-candidate').nth(1)).to_contain_text('文字资料')
        assert page.locator('.composer-library-candidate-open').first.get_attribute('href').endswith('case=candidate-0')
        expect(page.locator('.composer-input-area .composer-library-candidate')).to_have_count(0)
        expect(page.locator('#composer-reference-count')).to_have_text('0')
        with page.expect_popup() as popup:
            page.locator('.composer-library-candidate-open').first.click()
        detail = popup.value
        assert 'library.html?case=candidate-0' in detail.url
        detail.close()
        expect(page.locator('#composer-reference-count')).to_have_text('0')
        select = page.locator('.composer-library-candidate-select').first
        select.click()
        expect(page.locator('.composer-case-option')).to_have_count(1)
        second = page.locator('.composer-case-option[data-entry-id="candidate-0"] [data-asset-id="image-second"] input')
        second.check()
        page.locator('#composer-reference-cancel').click()
        expect(page.locator('#composer-reference-count')).to_have_text('0')
        select.click()
        expect(second).not_to_be_checked()
        second.check()
        page.locator('#composer-reference-apply').click()
        expect(page.locator('#composer-reference-count')).to_have_text('1')
        expect(select).to_have_text('调整参考')
        saved = page.evaluate("""async () => (await chrome.runtime.sendMessage({type:'GET_COMPOSER_SESSION',sessionId:'candidate-layout'})).session""")
        assert len(saved['referenceSnapshots']) == 1
        assert [image['visualId'] for image in saved['referenceSnapshots'][0]['imageRefs']] == ['image-second']
        page.locator('.composer-library-candidate-select').nth(1).click()
        expect(page.locator('.composer-case-option')).to_have_count(1)
        page.locator('.composer-case-option > input').check()
        page.locator('#composer-reference-apply').click()
        expect(page.locator('#composer-reference-count')).to_have_text('2')
        page.locator('#composer-reference-open').click()
        expect(page.locator('.composer-case-option')).to_have_count(24)
        page.locator('#composer-reference-cancel').click()
        row = page.locator('.composer-library-candidate-list')
        expect(row).to_be_visible()
        expect(row.locator('.composer-library-candidate')).to_have_count(24)
        widths = row.evaluate('node => ({scroll:node.scrollWidth, client:node.clientWidth, display:getComputedStyle(node).display})')
        assert widths['scroll'] > widths['client'], widths
        row.evaluate('node => node.scrollLeft = node.scrollWidth')
        expect(page.locator('.composer-library-candidate').last.locator('img')).to_have_js_property('complete', True)
        assert_centered(page)
        for width in [1280, 768, 390]:
            page.set_viewport_size({'width':width, 'height':845})
            expect(page.locator('.composer-nav')).not_to_be_in_viewport() if width == 390 else None
            assert_centered(page)
            expect(page.locator('#composer-action')).to_be_in_viewport()
            assert page.locator('.composer-type-switch').evaluate("node => getComputedStyle(node).whiteSpace") == 'nowrap'
            row.evaluate('node => node.scrollLeft = 0')
            if artifacts:
                page.screenshot(path=str(Path(artifacts)/f'candidate-{width}.png'), full_page=True)
        page.reload()
        expect(page.locator('.composer-library-candidate')).to_have_count(24)
        assert_centered(page)
        expect(page.locator('#composer-reference-count')).to_have_text('2')
        print('PASS: 24 long titles, local image previews, text fallback, detail links, scrolling, centered desktop/tablet/mobile and reload')


if __name__ == '__main__':
    main()
