"""Real detail controls: deep projects, stable tag input, actual image transparency."""
import json, os
from pathlib import Path
from tempfile import mkdtemp
from playwright.sync_api import expect
from e2e_support import extension_session

def main():
    out = Path(os.environ.get('PD_E2E_ARTIFACT_DIR') or mkdtemp(prefix='pd-detail-selector-'))
    out.mkdir(parents=True, exist_ok=True)
    assets = [dict(id=id, kind='image', storageMode='managed', mimeType='image/png', width=400, height=300) for id in ['opaque', 'alpha']]
    entry = dict(id='case', title='图像和项目选择', text='原始提示词保持完整', mediaAssets=assets, primaryMediaId='opaque', customLabels=['镜头参考'], url='https://example.com/source')
    single = dict(id='single', title='单图原词', text='来源正文不能被媒体原词编辑覆盖', sourceFacts={'originalPromptAvailable':False}, mediaAssets=[dict(assets[0],id='single-image')], primaryMediaId='single-image', mediaPrompts=[dict(assetId='single-image',source='webpage',text='单图来源原词')])
    projects = [dict(id=f'p{i}', name=f'项目 {i}', parentId=None, order=i, entryIds=[]) for i in range(30)]
    projects += [dict(id='child',name='子项目',parentId='p0',order=0,entryIds=[]), dict(id='leaf',name='深层项目',parentId='child',order=0,entryIds=['case'])]
    with extension_session('pd-detail-selector-', viewport={'width':1440,'height':900}) as run:
        setup=run.open_page('collector.html')
        run.seed_storage(setup, {'entries':[entry,single], 'organizerState':{'version':4,'collections':projects}, 'uiPreferences':{'locale':'zh-CN','theme':'dark','motion':'reduced'}})
        setup.evaluate('''async()=>{const{saveMediaBlob}=await import('./media-store.js');const c=document.createElement('canvas');c.width=400;c.height=300;const x=c.getContext('2d');x.fillStyle='#789abc';x.fillRect(0,0,400,300);for(const id of ['opaque','single-image'])await saveMediaBlob(id,await new Promise(r=>c.toBlob(r,'image/png')));x.clearRect(0,0,100,100);await saveMediaBlob('alpha',await new Promise(r=>c.toBlob(r,'image/png')))}''')
        p=run.open_page('library.html');p.locator('.case-card[data-entry-id=case]').click()
        expect(p.locator('.detail-image')).to_be_visible()
        expect(p.locator('.detail-image.has-alpha-channel')).to_have_count(0)
        expect(p.get_by_role('tab',name='AI 逆推',exact=True)).to_have_count(0)
        expect(p.get_by_role('button',name='分析图片',exact=True)).to_be_visible()
        p.get_by_role('button',name='下一项媒体',exact=True).click()
        expect(p.locator('.detail-image.has-alpha-channel')).to_be_visible()
        p.wait_for_function("()=>getComputedStyle(document.querySelector('.detail-image')).backgroundImage!=='none'")
        for theme,color in [('dark','rgb(0, 0, 0)'),('light','rgb(255, 255, 255)'),('dark','rgb(0, 0, 0)')]:
            if p.locator('html').get_attribute('data-theme') != theme:
                with p.expect_navigation(wait_until='domcontentloaded'):
                    p.evaluate("async theme=>{const{updateUiPreferences}=await import('./i18n.js');const{uiPreferences}=await chrome.storage.local.get('uiPreferences');await updateUiPreferences({...uiPreferences,theme})}",theme)
                p.locator('.case-card[data-entry-id=case]').click();p.get_by_role('button',name='下一项媒体',exact=True).click()
                expect(p.locator('.detail-image.has-alpha-channel')).to_be_visible()
            p.wait_for_function('(color)=>getComputedStyle(document.querySelector(".detail-visual-caption")).backgroundColor===color',arg=color)
            background=p.locator('.detail-visual-caption').evaluate('e=>({color:getComputedStyle(e).backgroundColor,image:getComputedStyle(e).backgroundImage})')
            assert background == {'color':color,'image':'none'}, background
            p.screenshot(path=str(out/f'transparency-{theme}.png'))
        p.get_by_role('button',name='切换侧栏详情',exact=True).click()
        menu=p.locator('.detail-project-menu');menu.locator('summary').click()
        tree=menu.get_by_role('tree');leaf=tree.locator('[data-collection-id=leaf]')
        expect(leaf).to_be_visible();expect(leaf).to_have_attribute('aria-checked','true')
        p.screenshot(path=str(out/'project-tree.png'))
        root=tree.locator('[data-collection-id=p0]');root.focus();root.press('ArrowLeft');expect(leaf).to_have_count(0)
        root.press('ArrowRight');child=tree.locator('[data-collection-id=child]');expect(child).to_be_visible()
        child.focus();child.press('ArrowRight');expect(leaf).to_be_focused()
        search=menu.get_by_role('searchbox');search.fill('深层项目');expect(tree.get_by_role('treeitem')).to_have_count(1)
        leaf.locator('input').uncheck()
        p.wait_for_function("()=>chrome.storage.local.get('organizerState').then(s=>!s.organizerState.collections.find(c=>c.id==='leaf').entryIds.includes('case'))")
        leaf=tree.locator('[data-collection-id=leaf]');expect(leaf).to_have_attribute('aria-checked','false')
        # The tree now saves only this case's membership change (BATCH_SET_PROJECT) instead of rewriting the
        # whole project member list (REPLACE_COLLECTION_ENTRIES), so concurrent additions survive; fail that write.
        p.evaluate("()=>{window.realSend=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.runtime.sendMessage=msg=>msg.type==='BATCH_SET_PROJECT'?Promise.resolve({ok:false,message:'测试保存失败'}):window.realSend(msg)}")
        leaf.locator('input').click();expect(leaf.locator('input')).to_be_enabled();expect(leaf).to_have_attribute('aria-checked','false')
        assert p.evaluate("()=>chrome.storage.local.get('organizerState').then(s=>s.organizerState.collections.find(c=>c.id==='leaf').entryIds.includes('case'))") is False
        p.evaluate('()=>chrome.runtime.sendMessage=window.realSend')
        leaf.locator('input').check();expect(leaf).to_have_attribute('aria-checked','true')
        leaf.focus();leaf.press('Escape');expect(menu).not_to_have_attribute('open','')
        expect(p.locator('.detail-quick-organization')).to_be_visible()
        for width in [1440,900,390]:
            p.set_viewport_size({'width':width,'height':900})
            org=p.locator('.detail-quick-organization');org.scroll_into_view_if_needed()
            def layout():
                return org.evaluate('''e=>[...e.querySelectorAll('.detail-project-menu > summary,.metadata-actions')].map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})''')
            before=layout();org.get_by_role('button',name='添加标签',exact=True).click()
            field=org.get_by_role('textbox',name='添加标签',exact=True);expect(field).to_be_visible()
            assert layout()==before, (width,before,layout())
            bounds=field.bounding_box();assert bounds['x']>=0 and bounds['x']+bounds['width']<=width,(width,bounds)
            p.wait_for_function("()=>!document.querySelector('#feedback').textContent.trim()")
            field.fill('位置稳定');p.screenshot(path=str(out/f'tags-open-{width}.png'))
            field.press('Enter');expect(field).to_have_value('');field.press('Escape')
        p.get_by_role('button',name='关闭详情',exact=True).click();p.locator('.case-card[data-entry-id=single]').click()
        expect(p.get_by_role('tab',name='当前媒体',exact=True)).to_have_count(0)
        expect(p.locator('.original-prompt-panel .prompt-read-body')).to_have_text('单图来源原词')
        p.get_by_role('button',name='编辑原始提示词',exact=True).click();p.locator('.original-prompt-panel textarea').fill('单图人工修订')
        p.locator('.original-prompt-panel').get_by_role('button',name='保存',exact=True).click()
        expect(p.locator('.original-prompt-panel .prompt-read-body')).to_have_text('单图人工修订')
        stored=p.evaluate("()=>import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get('entries')).then(s=>s.entries.find(e=>e.id==='single'))")
        assert stored['text']==single['text'] and stored['sourceFacts']==single['sourceFacts']
        assert next(x for x in stored['mediaPrompts'] if x['source']=='webpage')['text']=='单图来源原词'
        assert next(x for x in stored['mediaPrompts'] if x['source']=='manual')['text']=='单图人工修订'
        # Projects follow the folder model the user confirmed on 2026-09-23 (default move, a case lives in one
        # project; copying makes an independent case): ticking another project moves the case there.
        p.get_by_role('button',name='关闭详情',exact=True).click();p.locator('.case-card[data-entry-id=case]').click()
        menu=p.locator('.detail-project-menu');menu.locator('summary').click();tree=menu.get_by_role('tree')
        expect(tree.locator('[data-collection-id=leaf]')).to_have_attribute('aria-checked','true')
        second=tree.locator('[data-collection-id=p1]');second.locator('input').check();expect(second).to_have_attribute('aria-checked','true')
        p.wait_for_function("()=>chrome.storage.local.get('organizerState').then(s=>s.organizerState.collections.find(c=>c.id==='p1').entryIds.includes('case'))")
        memberships=p.evaluate("()=>chrome.storage.local.get('organizerState').then(s=>s.organizerState.collections.filter(c=>c.entryIds.includes('case')).map(c=>c.id).sort())")
        assert memberships==['p1'], ('勾选另一个项目是移动，案例只在一个项目里', memberships)
        expect(tree.locator('[data-collection-id=leaf]')).to_have_attribute('aria-checked','false')
        entry_count=p.evaluate("()=>import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get('entries')).then(s=>s.entries.filter(e=>e.id==='case').length)")
        assert entry_count==1, '移动不复制也不丢失案例'
        print(json.dumps({'actualAlphaOnly':True,'solidFootersBothThemes':True,'conditionalTabs':True,'treeKeyboardSearchSaveRollback':True,'tagEditorAnchorStable':[1440,900,390],'singleSourceEvidencePreserved':True,'evidence':str(out)}))

if __name__=='__main__':main()
