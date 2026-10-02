"""Small cleanup batch: real menu removal, persisted compound undo and consistent controls."""
import json
import tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session, base_entry

with extension_session('pd-quick-cleanup-', viewport={'width':1440,'height':900}) as s:
    setup=s.open_page('collector.html')
    entries=[base_entry(i,t,'完整提示词\n原始内容保留','content:prompt:image') for i,t in [('a','成员甲'),('b','成员乙'),('copy','未选择副本')]]
    for e in entries: e['customLabels']=['要移除','要保留']
    s.seed_storage(setup,{'entries':entries,'organizerState':{'version':7,'collections':[{'id':'p','name':'测试项目','entryIds':['a','b','copy']}]},'uiPreferences':{'locale':'zh-CN','motion':'reduced'}})
    setup.evaluate("""async () => {
      const {createFacetNode}=await import('./facets.js');
      const state=await chrome.runtime.sendMessage({type:'GET_STATE'});
      const facet=state.facetCatalog.facets[0];
      const catalog=createFacetNode(state.facetCatalog,{facetId:facet.id,name:'分类待移除'});
      const node=catalog.nodes.find(n=>n.name==='分类待移除');
      const entries=state.entries.map(e=>({...e,facetAssignments:[{facetId:facet.id,nodeId:node.id,source:'manual',status:'confirmed',confidence:1,evidence:'人工确认'}]}));
      const {normalizeCompoundCases}=await import('./compound-cases.js');
      const compoundCases=normalizeCompoundCases([{id:'group',title:'验收组合',memberEntryIds:['a','b'],customLabels:['组合专属'],createdAt:'2026-10-01T00:00:00.000Z'}],entries);
      await chrome.storage.local.set({entries,facetCatalog:catalog,compoundCases});
    }""")
    before=setup.evaluate("()=>chrome.runtime.sendMessage({type:'GET_STATE'})")
    page=s.open_page('library.html',wait_until='networkidle')
    page.locator('#select-cases').click()
    page.locator('.case-card[data-entry-id="group"]').click()
    page.locator('#selection-label-menu > summary').click()
    expect(page.locator('#selection-removable-tags')).to_be_hidden()
    page.locator('#selection-label-mode').select_option('remove')
    expect(page.locator('#selection-label-add-field')).to_be_hidden()
    for title in ['要移除','组合专属']:
        page.locator('#selection-removable-tags').get_by_label(title,exact=True).check()
    page.locator('#selection-removable-tags label').filter(has_text='分类待移除').locator('input').check()
    page.screenshot(path=str(Path(tempfile.gettempdir())/'pd-quick-tags.png'))
    page.locator('#selection-remove-labels').click()
    expect(page.locator('#share-bar')).to_be_hidden()
    page.reload(wait_until='networkidle')
    after=setup.evaluate("()=>chrome.runtime.sendMessage({type:'GET_STATE'})")
    for e in after['entries']:
        old=next(x for x in before['entries'] if x['id']==e['id'])
        if e['id']=='copy': assert e==old
        else:
            assert e['customLabels']==['要保留'],e
            assert e['facetAssignments']==[],e
            for field in ['text','mediaAssets']: assert e.get(field)==old.get(field)
    assert after['compoundCases'][0]['customLabels']==[]
    assert after['facetCatalog']==before['facetCatalog']
    # Later material must survive undo from the visible recovery control.
    later=base_entry('later','后来新增','后来新增的完整原词','content:prompt:image')
    later['schemaVersion']=before['schemaVersion']
    setup.evaluate("async e=>{const s=await chrome.storage.local.get('entries');await chrome.storage.local.set({entries:[...s.entries,e]})}",later)
    page.locator('#manage-facets').click()
    page.locator('[data-manager-tab="vocabulary"]').click()
    page.locator('#facet-recovery-actions summary').click()
    page.locator('#undo-facet').click()
    expect(page.locator('#manager-feedback')).to_contain_text('已撤回')
    restored=setup.evaluate("()=>chrome.runtime.sendMessage({type:'GET_STATE'})")
    for e in before['entries']:
        current=next(x for x in restored['entries'] if x['id']==e['id'])
        assert current==e, {k:[e.get(k),current.get(k)] for k in set(e)|set(current) if e.get(k)!=current.get(k)}
    assert restored['compoundCases']==before['compoundCases']
    assert next(x for x in restored['entries'] if x['id']=='later')['text']==later['text']
    page.locator('#manager-close').click()
    page.reload(wait_until='networkidle')
    # Existing left project management and trash controls, both themes.
    for theme in ['light','dark']:
        page.close()
        setup.evaluate("async t=>chrome.storage.local.set({uiPreferences:{locale:'zh-CN',motion:'reduced',theme:t}})",theme)
        page=s.open_page('library.html',wait_until='networkidle')
        page.set_viewport_size({'width':960 if theme=='light' else 1440,'height':900})
        menu=page.locator('[data-collection-id="p"] .project-menu').first
        menu.locator('summary').click()
        button=menu.get_by_role('button',name='管理案例',exact=True)
        expect(button).to_be_visible()
        button.hover()
        bounds=menu.locator('.project-menu-panel').bounding_box()
        assert bounds['x']>=0 and bounds['x']+bounds['width']<=page.viewport_size['width']
        expect(button).to_have_class(__import__('re').compile('button-secondary'))
        assert button.evaluate("e=>getComputedStyle(e).borderRadius===getComputedStyle(document.documentElement).getPropertyValue('--ui-control-radius').trim()")
        page.screenshot(path=str(Path(tempfile.gettempdir())/f'pd-quick-project-{theme}.png'))
        menu.locator('summary').click()
    # Only isolated fixture moved to trash; no real library is used.
    response=setup.evaluate("()=>chrome.runtime.sendMessage({type:'BATCH_MOVE_TO_TRASH',entryIds:['copy']})")
    assert response.get('ok'),response
    page.reload(wait_until='networkidle')
    for theme in ['light','dark']:
        page.close()
        setup.evaluate("async t=>chrome.storage.local.set({uiPreferences:{locale:'zh-CN',motion:'reduced',theme:t}})",theme)
        page=s.open_page('library.html',wait_until='networkidle')
        page.set_viewport_size({'width':960 if theme=='light' else 1440,'height':900})
        expect(page.locator('body')).to_have_attribute('data-library-state','ready')
        page.locator('#open-trash').click()
        expect(page.locator('#trash-list')).to_contain_text('未选择副本')
        page.screenshot(path=str(Path(tempfile.gettempdir())/f'pd-quick-trash-{theme}.png'))
        page.locator('#trash-close').click()
    assert not s.page_errors,s.page_errors
    print('PASS: selected compound/member tags removed; refreshed readback; safe undo preserves later material; project/trash screenshots in both themes')
