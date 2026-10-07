"""Visible title and prompt saves retain unrelated cards, drafts and the playing media node."""
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session


def main():
    with extension_session('pd-library-edit-incremental-', viewport={'width': 1440, 'height': 900}) as run:
        setup = run.open_page('collector.html')
        video = {'id': 'video', 'kind': 'video', 'storageMode': 'managed', 'mimeType': 'video/mp4', 'width': 320, 'height': 180}
        entries = [{'id': 'editing', 'title': '编辑中的案例', 'text': '保存前的完整原词', 'textRevision': 1,
                    'sourceFacts': {'originalPromptAvailable': True}, 'customLabels': ['保留标签'],
                    'mediaAssets': [video], 'primaryMediaId': 'video'},
                   {'id': 'other', 'title': '并发编辑案例', 'text': '另外的完整内容'},
                   {'id': 'untouched', 'title': '保留卡片', 'text': '不应重复渲染'}]
        run.seed_storage(setup, {'entries': entries, 'dataSafetyOnboardingSeen': True,
                               'uiPreferences': {'locale': 'zh-CN', 'motion': 'reduced'}})
        raw = (Path(__file__).parent / 'fixtures/review-workspace-smoke.mp4').read_bytes()
        setup.evaluate("""async bytes => { const {saveMediaBlob}=await import('./media-store.js');
          await saveMediaBlob('video',new Blob([new Uint8Array(bytes)],{type:'video/mp4'})); }""", list(raw))
        page = run.open_page('library.html')
        page.wait_for_selector('body[data-library-state="ready"]')
        page.locator('.case-card[data-entry-id=editing]').click()
        expect(page.locator('.detail-video')).to_be_visible()
        page.wait_for_timeout(300)
        page.evaluate("""() => {
          window.pdReads=0; const get=chrome.storage.local.get.bind(chrome.storage.local);
          chrome.storage.local.get=keys=>{if(keys==null||[keys].flat().includes('entries'))window.pdReads++;return get(keys)};
          window.pdUntouched=document.querySelector('.case-card[data-entry-id=untouched]');
          window.pdVideo=document.querySelector('.detail-video'); pdVideo.currentTime=0.2;
        }""")
        editor = page.locator('.entry-editor-inline')
        editor.locator('summary').click()
        title = editor.locator('.entry-edit-row input').first
        title.fill('标题保存后的案例')
        original = page.locator('.original-prompt-panel')
        original.get_by_role('button', name='编辑原始提示词', exact=True).click()
        original.locator('textarea').fill('尚未提交的原词草稿')
        editor.locator('.entry-edit-row').first.get_by_role('button', name='保存', exact=True).click()
        expect(page.locator('#feedback')).to_contain_text('标题已保存')
        expect(original.locator('textarea')).to_have_value('尚未提交的原词草稿')
        assert page.evaluate("pdUntouched===document.querySelector('.case-card[data-entry-id=untouched]')"), 'title save rebuilt an unrelated card'
        # A second page commits while the local prompt reply is held: only the local echo may be consumed.
        page.evaluate("""() => { const send=chrome.runtime.sendMessage.bind(chrome.runtime);
          chrome.runtime.sendMessage=async message=>{const result=await send(message);
            if(message.type==='UPDATE_ENTRY_TEXT'){window.pdReplyReady=true;await new Promise(resolve=>window.pdReleaseReply=resolve)}return result};
        }""")
        original.locator('textarea').fill('第一次保存的完整原词')
        original.locator('.prompt-edit-actions').get_by_role('button', name='保存', exact=True).click()
        page.wait_for_function('() => window.pdReplyReady===true')
        result = setup.evaluate("() => chrome.runtime.sendMessage({type:'UPDATE_ENTRY_TITLE',entryId:'other',title:'另一页面已更新'})")
        assert result['ok'], result
        page.evaluate('window.pdReleaseReply()')
        expect(original.locator('.prompt-read-body')).to_have_text('第一次保存的完整原词')
        page.wait_for_function("() => document.querySelector('.case-card[data-entry-id=other]').textContent.includes('另一页面已更新')")
        # Saving again must use the fresh revision, with the same video node and no unrelated card rebuild.
        original.get_by_role('button', name='编辑原始提示词', exact=True).click()
        original.locator('textarea').fill('第二次保存的完整原词')
        page.evaluate("window.pdReleaseReply=undefined;window.pdReplyReady=false")
        original.locator('.prompt-edit-actions').get_by_role('button', name='保存', exact=True).click()
        page.wait_for_function('() => window.pdReplyReady===true');page.evaluate('window.pdReleaseReply()')
        expect(original.locator('.prompt-read-body')).to_have_text('第二次保存的完整原词')
        # A no-op title response cannot overwrite a later writer while another form holds a draft.
        original.get_by_role('button', name='编辑原始提示词', exact=True).click()
        original.locator('textarea').fill('仍需保留的另一份草稿')
        page.evaluate('''() => {const send=chrome.runtime.sendMessage.bind(chrome.runtime);
          chrome.runtime.sendMessage=async message=>{if(message.type!=='UPDATE_ENTRY_TITLE')return send(message);
            await send({type:'UPDATE_ENTRY_TITLE',entryId:message.entryId,title:message.title});
            const result=await send(message);window.pdTitleNoop=result.changed===false;
            await new Promise(resolve=>window.pdReleaseTitle=resolve);return result};}''')
        title.fill('后台已有的相同标题')
        editor.locator('.entry-edit-row').first.get_by_role('button', name='保存', exact=True).click()
        page.wait_for_function('() => typeof window.pdReleaseTitle === "function"')
        assert page.evaluate('window.pdTitleNoop'), 'fixture must exercise an actual no-op commit'
        assert setup.evaluate("() => chrome.runtime.sendMessage({type:'UPDATE_ENTRY_TITLE',entryId:'editing',title:'另一页面更新后的最终标题'})")['ok']
        page.evaluate('window.pdReleaseTitle()')
        expect(title).to_have_value('另一页面更新后的最终标题')
        expect(page.locator('.detail-title')).to_have_text('另一页面更新后的最终标题')
        expect(original.locator('textarea')).to_have_value('仍需保留的另一份草稿')
        page.wait_for_timeout(200)
        result = page.evaluate("""() => ({reads:pdReads,cardKept:pdUntouched===document.querySelector('.case-card[data-entry-id=untouched]'),
            videoKept:pdVideo===document.querySelector('.detail-video'),time:pdVideo.currentTime})""")
        assert result['reads'] == 0 and result['cardKept'] and result['videoKept'] and result['time'] >= 0.19, result
        stored = setup.evaluate("async()=>{const{getLibraryStorage}=await import('./library-storage.js');return(await getLibraryStorage().get('entries')).entries}")
        assert next(item for item in stored if item['id']=='editing')['text']=='第二次保存的完整原词'
        print(result)


if __name__ == '__main__':
    main()
