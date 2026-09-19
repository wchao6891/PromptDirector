"""Batch category change through the real library UI, with isolated storage."""
import os
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import base_entry, extension_session

def main():
    with extension_session('batch-classification-',viewport={'width':1280,'height':844}) as run:
        setup=run.open_page('collector.html')
        entries=[base_entry(f'category-{i}',f'待整理案例{i}',f'保留原始提示词{i}','content:image-case',i) for i in range(3)]
        run.seed_storage(setup,{'entries':entries,'uiPreferences':{'locale':'zh-CN','theme':'dark','motion':'reduced'}})
        page=run.open_page('library.html')
        expect(page.locator('.case-card')).to_have_count(3)
        page.locator('#select-cases').click()
        page.locator('.case-card[data-entry-id="category-0"]').click()
        page.locator('.case-card[data-entry-id="category-1"]').click()
        page.locator('#selection-classification-menu > summary').click()
        expect(page.locator('#selection-classification-impact')).to_have_text('将修改 2 个案例')
        expect(page.locator('#selection-classification-menu label')).to_have_count(0)
        expect(page.get_by_role('combobox', name='案例类型', exact=True)).to_be_visible()
        page.locator('#selection-content-type').select_option('content:prompt:video')
        out=Path(os.environ.get('PD_TEST_SCREENSHOTS','/tmp/pd-batch-category'));out.mkdir(parents=True,exist_ok=True)
        for theme in ['dark','light']:
            page.evaluate('(theme)=>document.documentElement.dataset.theme=theme',theme)
            for width in [1280,390]:
                page.set_viewport_size({'width':width,'height':844})
                page.locator('#selection-classification-menu').evaluate('e=>e.open=true')
                page.screenshot(path=str(out/f'category-{theme}-{width}.png'))
                assert page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth')
        # A transient failure keeps the selected cases and chosen category for retry.
        page.evaluate("""()=>{const send=chrome.runtime.sendMessage.bind(chrome.runtime);window.failCategoryOnce=true;
          chrome.runtime.sendMessage=async m=>{if(m.type==='BATCH_SET_CLASSIFICATION'&&window.failCategoryOnce){window.failCategoryOnce=false;return {ok:false,message:'测试保存失败'};}return send(m);};}""")
        page.locator('#selection-set-classification').click()
        expect(page.locator('.case-card.selected-for-share')).to_have_count(2)
        page.locator('#selection-classification-menu > summary').click()
        expect(page.locator('#selection-content-type')).to_have_value('content:prompt:video')
        page.locator('#selection-set-classification').click()
        expect(page.locator('.case-card.selected-for-share')).to_have_count(0)
        stored=setup.evaluate("async()=>(await chrome.storage.local.get('entries')).entries")
        assert [e['classification']['pathIds'][0] for e in stored]==['content:prompt:video','content:prompt:video','content:image-case'],stored
        assert all(stored[i]['text']==entries[i]['text'] for i in range(3))
        assert all(stored[i]['classification']['source']=='manual' for i in range(2))
        # Invalid/missing targets do not partially update a batch.
        response=setup.evaluate("async()=>chrome.runtime.sendMessage({type:'BATCH_SET_CLASSIFICATION',entryIds:['category-0','missing'],pathIds:['content:reference']})")
        assert response['ok'] is False,response
        assert setup.evaluate("async()=>(await chrome.storage.local.get('entries')).entries[0].classification.pathIds[0]")=='content:prompt:video'
        group=setup.evaluate("async()=>chrome.runtime.sendMessage({type:'CREATE_COMPOUND_CASE',title:'组合分类测试',memberEntryIds:['category-0','category-1']})")
        assert group['ok'],group
        page.reload()
        expect(page.locator('.case-card')).to_have_count(2)
        page.locator('#select-cases').click()
        page.locator(f'.case-card[data-entry-id="{group["compoundCase"]["id"]}"]').click()
        page.locator('#selection-classification-menu > summary').click()
        expect(page.locator('#selection-classification-impact')).to_have_text('将修改 2 个案例')
        expect(page.locator('#selection-classification-menu label')).to_have_count(0)
        expect(page.get_by_role('combobox', name='案例类型', exact=True)).to_be_visible()
        page.locator('#selection-content-type').select_option('content:reference')
        page.locator('#selection-set-classification').click()
        expect(page.locator('.case-card.selected-for-share')).to_have_count(0)
        grouped=setup.evaluate("async()=>(await chrome.storage.local.get('entries')).entries")
        assert [e['classification']['pathIds'][0] for e in grouped]==['content:reference','content:reference','content:image-case']
        assert not run.page_errors,run.page_errors
        print({'batchChanged':2,'unselectedPreserved':True,'textPreserved':True,'missingTargetAtomic':True,'failedSelectionPreserved':True,'compoundMembersChanged':True,'screenshots':str(out)})

if __name__=='__main__':main()
