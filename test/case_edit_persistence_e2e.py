"""Isolated fixtures verify user deletions persist without discarding editing drafts."""
from playwright.sync_api import expect
from e2e_support import base_entry, extension_session

PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='


def main():
    with extension_session('case-edit-persistence-') as session:
        setup = session.open_page('collector.html')
        fixture = base_entry('edit-case', '编辑验证', '原始提示词', 'content:prompt:image')
        fixture['mediaAssets'] = [{'id': 'edit-image', 'kind': 'image', 'usage': 'content', 'storageMode': 'managed', 'mimeType': 'image/png'}]
        fixture['primaryMediaId'] = 'edit-image'
        setup.evaluate('''async ({entry,png}) => {
          const {createDefaultFacetCatalog} = await import(chrome.runtime.getURL('facets.js'));
          const {applyVisionAnalysis} = await import(chrome.runtime.getURL('analysis-candidates.js'));
          const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
          const analyzed = applyVisionAnalysis({entries:[entry],facetCatalog:createDefaultFacetCatalog()},entry.id,
            {reconstructionPrompt:'AI逆推测试原文',tags:[{g:'style.render',t:'电影写实'}]}, {version:2,visualId:'edit-image',imageFingerprint:'fixture'}).state;
          analyzed.entries[0].mediaAssets[0].visionAnalysis = analyzed.entries[0].visionAnalysis;
          delete analyzed.entries[0].visionAnalysis;
          await chrome.storage.local.set({...analyzed,uiPreferences:{locale:'zh-CN',theme:'light',motion:'reduced'}});
          await saveMediaBlob('edit-image', new Blob([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],{type:'image/png'}),{checkCapacity:false});
        }''', {'entry': fixture, 'png': PNG})
        page = session.open_page('library.html')
        page.locator('[data-entry-id="edit-case"].case-card').click()
        editor = page.locator('.entry-editor-inline')
        editor.locator('summary').click()
        title = editor.locator('.entry-edit-row input').first
        title.fill('尚未保存标题')
        original = editor.locator('.entry-original-summary')
        original.get_by_role('button', name='编辑原始提示词', exact=True).click()
        original.locator('textarea').fill('尚未保存原始提示词')
        remove = editor.locator('.selected-edit-tags button').first
        label = remove.inner_text()
        page.evaluate('''() => {
          const send = chrome.runtime.sendMessage.bind(chrome.runtime);
          chrome.runtime.sendMessage = (message,...args) => message.type === 'SET_ENTRY_FACET'
            ? Promise.resolve({ok:false,message:'测试保存失败'}) : send(message,...args);
          window.restoreTagTransport = () => { chrome.runtime.sendMessage = send; };
        }''')
        remove.click()
        expect(page.locator('#feedback')).to_contain_text('测试保存失败')
        expect(editor.locator('.selected-edit-tags button')).to_have_count(1)
        page.evaluate('() => window.restoreTagTransport()')
        remove.click()
        expect(editor.locator('.selected-edit-tags button')).to_have_count(0)
        expect(title).to_have_value('尚未保存标题')
        expect(original.locator('textarea')).to_have_value('尚未保存原始提示词')
        expect(editor.locator('select[aria-label="选择创作维度"]')).to_be_focused()
        stored = page.evaluate("async()=> (await chrome.storage.local.get('entries')).entries.find(e=>e.id==='edit-case')")
        assert not stored['facetAssignments']
        assert stored['title'] == fixture['title'] and stored['text'] == fixture['text']
        original.get_by_role('button', name='取消', exact=True).click()
        node = page.evaluate("async()=> (await chrome.storage.local.get('facetCatalog')).facetCatalog.nodes.find(n=>n.name==='电影写实')")
        editor.locator('select[aria-label="选择创作维度"]').select_option(node['facetId'])
        editor.locator('select[aria-label="选择创作标签"]').select_option(node['id'])
        editor.get_by_role('button', name='添加标签', exact=True).click()
        expect(editor.locator('.selected-edit-tags button')).to_have_count(1)
        expect(title).to_have_value('尚未保存标题')
        expect(editor.locator('h4', has_text='创作标签')).to_have_count(1)
        # No prompt edit is active now: the normal full refresh must also preserve title drafts.
        editor.locator('.selected-edit-tags button').click()
        expect(editor.locator('.selected-edit-tags button')).to_have_count(0)
        expect(title).to_have_value('尚未保存标题')
        page.reload()
        expect(page.locator('[data-entry-id="edit-case"].case-card')).to_be_visible()
        page.locator('[data-entry-id="edit-case"].case-card').click()
        ai = page.locator('.image-reconstruction-current')
        ai.get_by_role('button', name='编辑 AI 逆推提示词', exact=True).click()
        ai.locator('textarea').fill('')
        ai.get_by_role('button', name='保存', exact=True).click()
        expect(page.locator('.image-reconstruction-current')).to_have_count(0)
        page.reload()
        page.locator('[data-entry-id="edit-case"].case-card').click()
        expect(page.locator('.image-reconstruction-current')).to_have_count(0)
        stored = page.evaluate("async()=> (await chrome.storage.local.get('entries')).entries.find(e=>e.id==='edit-case')")
        analysis = stored['mediaAssets'][0]['visionAnalysis']
        assert analysis['reconstructionPrompt'] == '' and analysis['userEdited']
        assert analysis['tags'] and analysis['imageFingerprint'] == 'fixture'
        assert stored['text'] == fixture['text'] and stored['mediaAssets'][0]['id'] == 'edit-image'
        # Adopted AI clearing must clear the displayed layer and its underlying text together.
        result = page.evaluate('''async () => {
          const {entries} = await chrome.storage.local.get('entries');
          const entry=entries.find(e=>e.id==='edit-case');
          entry.mediaAssets[0].visionAnalysis.reconstructionPrompt='底层旧AI';
          entry.mediaPrompts=[{assetId:'edit-image',source:'ai-suggestion',text:'采用AI'}];
          await chrome.storage.local.set({entries});
          return chrome.runtime.sendMessage({type:'UPDATE_ENTRY_MEDIA_PROMPT',entryId:entry.id,assetId:'edit-image',text:'',preserveAiSource:true});
        }''')
        assert result['ok'], result
        page.reload()
        page.locator('[data-entry-id="edit-case"].case-card').click()
        expect(page.locator('.image-reconstruction-current')).to_have_count(0)
        print({'ok': True, 'removedTag': label, 'checks': ['failed save preserved tag', 'successful save removed tag immediately', 'title and original drafts preserved', 'focus preserved', 'AI clear survives reload', 'adopted AI does not resurrect underlying text']})


if __name__ == '__main__':
    main()
