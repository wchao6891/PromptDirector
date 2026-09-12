"""Isolated Chrome: real queue/storage/palette generation, deterministic AI response fixture."""
import base64
import json
import os
import tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import ai_configuration_fixture, base_entry, extension_session, wait_for_async_condition

_artifacts = tempfile.TemporaryDirectory(prefix='pd-tagging-artifacts-')
ARTIFACTS = Path(os.environ.get('PROMPTDIRECTOR_ARTIFACT_DIR', _artifacts.name))

def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    selected = base_entry('tag-selected', '已打标案例', '雾中庭院', 'content:prompt:image')
    outside = base_entry('tag-outside', '未选案例', '未选的提示词', 'content:prompt:image', 1)
    empty = base_entry('tag-empty', '无文字图片', '', 'content:image-case', 2)
    empty.update(mediaAssets=[{'id':'palette-missing','name':'original.gif','kind':'image','usage':'content','storageMode':'managed','mimeType':'image/gif'}],primaryMediaId='palette-missing')
    with extension_session('pd-text-maintenance-', viewport={'width':1280,'height':900}) as session:
        setup = session.open_page('collector.html')
        session.seed_storage(setup, {'schemaVersion':28,'entries':[selected,outside,empty], 'uiPreferences':{'locale':'zh-CN','theme':'dark'},
            **ai_configuration_fixture(providers={'deepseek':{'apiKey':'test-fixture-key','consent':True,'models':{'textTags':'deepseek-v4-flash'}}},assignments={'textTags':{'providerId':'deepseek','model':'deepseek-v4-flash'}})})
        setup.evaluate('''async data => {
          const {savePortableAssetBlob}=await import(chrome.runtime.getURL('media-store.js'));
          const {createLibraryMaintenanceJob,completeLibraryMaintenanceItem}=await import(chrome.runtime.getURL('library-maintenance.js'));
          const state=await chrome.runtime.sendMessage({type:'GET_STATE'});
          const group=state.facetCatalog.nodes.find(n=>!n.parentId && n.status!=='archived');
          const entry=state.entries.find(e=>e.id==='tag-selected');
          entry.facetAssignments=[{nodeId:group.id,source:'manual'},{nodeId:group.id,source:'deepseek_text'}];
          entry.analysisMeta={textRevision:1};
          const job=completeLibraryMaintenanceItem(createLibraryMaintenanceJob({id:'old-complete',paletteAssetIds:['old']}),{ok:true});
          await chrome.storage.local.set({entries:state.entries,libraryMaintenanceJob:job});
          await savePortableAssetBlob('palette-missing',new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'image/gif'}),{checkCapacity:false});
        }''',base64.b64encode((Path(__file__).parent/'fixtures/transfer-media/original.gif').read_bytes()).decode())
        worker=session.context.service_workers[0]
        worker.evaluate('''() => {
          globalThis.testPaletteCalls=0; globalThis.testTextCalls=0;
          const send=chrome.runtime.sendMessage.bind(chrome.runtime);
          chrome.runtime.sendMessage=(...args)=>{if(args[0]?.type==='ANALYZE_STORED_SCREENSHOT') testPaletteCalls++;return send(...args);};
          const realFetch=globalThis.fetch;
          globalThis.fetch=async (...args)=>{
            if(!String(args[0]).includes('api.deepseek.com')) return realFetch(...args);
            if(!String(args[0]).includes('chat/completions')) return new Response(JSON.stringify({data:[]}));
            testTextCalls++;
            if(globalThis.testFailOutside && String(args[1]?.body).includes('未选的提示词')) return new Response(JSON.stringify({error:{message:'fixture text failure'}}),{status:400});
            const state=await chrome.storage.local.get('facetCatalog');
            const tags=state.facetCatalog.nodes.filter(n=>!n.parentId && n.status!=='archived').slice(0,6).map(n=>({g:n.id,t:''}));
            return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({tags})}}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}),{status:200,headers:{'Content-Type':'application/json'}});
          };
        }''')
        page=session.open_page('library.html',wait_until='networkidle')
        page.locator('#open-settings').click();page.locator('[data-settings-tab="tasks"]').click()
        expect(page.locator('#reanalyze-preview')).to_contain_text('1 张图片色卡')
        expect(page.locator('#reanalyze-preview')).not_to_contain_text('已完整')
        page.locator('#preview-analysis-batch').click()
        expect(page.locator('#analysis-batch-summary')).to_have_text('待补全 1 个案例')
        expect(page.locator('#preview-analysis-batch')).to_be_hidden()
        expect(page.locator('#batch-status-badge')).to_be_hidden()
        page.locator('#start-analysis-batch').click()
        confirmation=page.locator('#promptdirector-app-dialog')
        expect(confirmation).to_contain_text('API 费用')
        assert worker.evaluate('testTextCalls')==0
        confirmation.get_by_role('button',name='取消',exact=True).click()
        assert worker.evaluate('testTextCalls')==0
        page.screenshot(path=str(ARTIFACTS/'settings-wide.png'))
        page.set_viewport_size({'width':650,'height':800})
        assert page.locator('#settings-dialog').evaluate('(e)=>e.scrollWidth<=e.clientWidth')
        page.screenshot(path=str(ARTIFACTS/'settings-narrow.png'))
        page.set_viewport_size({'width':1280,'height':900})
        page.locator('#apply-reanalyze').click()
        expect(page.locator('#reanalyze-preview')).to_have_text('资料索引已完整',timeout=30000)
        assert worker.evaluate('testPaletteCalls')==1
        page.locator('#preview-reanalyze').click()
        expect(page.locator('#reanalyze-preview')).to_have_text('资料索引已完整')
        assert worker.evaluate('testPaletteCalls')==1
        page.locator('#settings-close').click()
        page.locator('#select-cases').click()
        page.locator('.case-card[data-entry-id="tag-selected"]').click()
        page.locator('.case-card[data-entry-id="tag-empty"]').click()
        page.locator('#selection-more-menu > summary').click()
        page.locator('#selection-text-analyze').click()
        expect(page.locator('#text-batch-dialog')).to_be_visible()
        expect(page.locator('#settings-dialog')).not_to_be_visible()
        expect(page.locator('#analysis-batch-summary')).to_have_text('已选 1 个案例 · 跳过 1 个无文字案例')
        page.screenshot(path=str(ARTIFACTS/'selected-text.png'))
        page.locator('#start-analysis-batch').click()
        confirmation=page.locator('#promptdirector-app-dialog')
        expect(confirmation).to_contain_text('1 个案例')
        expect(confirmation).to_contain_text('API 费用')
        assert worker.evaluate('testTextCalls')==0
        confirmation.get_by_role('button',name='取消',exact=True).click()
        assert worker.evaluate('testTextCalls')==0
        page.locator('#start-analysis-batch').click()
        confirmation.get_by_role('button',name='确认付费',exact=True).click()
        result=wait_for_async_condition(page,'''async()=>{const s=await chrome.runtime.sendMessage({type:'GET_STATE'});return s.analysisBatchJob?.status==='completed'?s:null;}''')
        assert result['analysisBatchJob']['mode']=='selected'
        assert [i['entryId'] for i in result['analysisBatchJob']['items']]==['tag-selected']
        selected_result=next(e for e in result['entries'] if e['id']=='tag-selected')
        assert any(a['source']=='manual' for a in selected_result['facetAssignments'])
        assert not next(e for e in result['entries'] if e['id']=='tag-outside').get('analysisMeta')
        assert worker.evaluate('testTextCalls')==1
        expect(page.locator('#text-batch-dialog')).not_to_be_visible(timeout=10000)
        # A mixed-result task retains successes; retry sends only its failed item.
        stale=page.evaluate("async()=>chrome.runtime.sendMessage({type:'CREATE_ANALYSIS_BATCH',mode:'incremental',expectedEntryIds:[]})")
        assert not stale['ok'] and '已变化' in stale['message']
        assert worker.evaluate('testTextCalls')==1
        worker.evaluate('globalThis.testFailOutside=true')
        created=page.evaluate("async()=>chrome.runtime.sendMessage({type:'CREATE_ANALYSIS_BATCH',mode:'selected',entryIds:['tag-selected','tag-outside']})")
        assert created['ok'],created
        partial=wait_for_async_condition(page,"""async()=>{const s=await chrome.runtime.sendMessage({type:'GET_STATE'});return s.analysisBatchJob?.status==='partial'?s.analysisBatchJob:null;}""")
        assert partial['counts']['succeeded']==1 and partial['counts']['failed']==1
        calls_before_retry=worker.evaluate('testTextCalls')
        worker.evaluate('globalThis.testFailOutside=false')
        page.locator('#open-settings').click();page.locator('[data-settings-tab="tasks"]').click()
        page.locator('#retry-analysis-failures').click()
        confirmation=page.locator('#promptdirector-app-dialog')
        expect(confirmation).to_contain_text('1 个案例')
        assert worker.evaluate('testTextCalls')==calls_before_retry
        confirmation.get_by_role('button',name='取消',exact=True).click()
        assert worker.evaluate('testTextCalls')==calls_before_retry
        page.locator('#retry-analysis-failures').click()
        confirmation.get_by_role('button',name='确认付费',exact=True).click()
        wait_for_async_condition(page,"""async()=>{const s=await chrome.runtime.sendMessage({type:'GET_STATE'});return s.analysisBatchJob?.status==='completed';}""")
        assert worker.evaluate('testTextCalls')==calls_before_retry+1
        page.locator('#settings-close').click()
        # Existing cached and inline palettes are skipped even if already queued.
        page.evaluate("""async()=>{const {createLibraryMaintenanceJob}=await import(chrome.runtime.getURL('library-maintenance.js'));const {PALETTE_VERSION}=await import(chrome.runtime.getURL('palette.js'));
          const {entries}=await chrome.storage.local.get('entries');entries.find(e=>e.id==='tag-empty').mediaAssets.push({id:'current-inline',kind:'image',usage:'content',palette:{version:PALETTE_VERSION,colors:['#223344']}});
          await chrome.storage.local.set({entries,libraryMaintenanceJob:createLibraryMaintenanceJob({paletteAssetIds:['palette-missing','current-inline']})});
          await chrome.runtime.sendMessage({type:'RESUME_LIBRARY_MAINTENANCE'});}""")
        wait_for_async_condition(page,"""async()=>{const r=await chrome.runtime.sendMessage({type:'GET_LIBRARY_MAINTENANCE_STATUS'});return r.maintenanceJob?.status==='completed';}""")
        assert worker.evaluate('testPaletteCalls')==1
        # Freshly missing media must supersede the completed maintenance job, including failures.
        page.locator('#text-batch-close').click() if page.locator('#text-batch-dialog').is_visible() else None
        page.evaluate('''async()=>{const {entries}=await chrome.storage.local.get('entries');const e=entries.find(e=>e.id==='tag-empty');e.mediaAssets.push({id:'unavailable',name:'missing.gif',kind:'image',usage:'content',storageMode:'managed',mimeType:'image/gif'});await chrome.storage.local.set({entries});}''')
        page.locator('#open-settings').click();page.locator('[data-settings-tab="tasks"]').click()
        expect(page.locator('#reanalyze-preview')).to_contain_text('1 张图片色卡')
        page.locator('#apply-reanalyze').click()
        expect(page.locator('#reanalyze-preview')).to_contain_text('missing.gif',timeout=30000)
        expect(page.locator('#reanalyze-preview')).not_to_contain_text('已完整')
        expect(page.locator('#retry-library-maintenance')).to_be_visible()
        assert worker.evaluate('testPaletteCalls')==2
        # Large-library paid action: explicit confirmation of the whole count, zero requests on cancel.
        page.locator('#settings-close').click()
        fixture=[{**outside,'id':f'fee-case-{i}','title':f'费用确认测试 {i}'} for i in range(1764)]
        page.evaluate("async entries=>chrome.storage.local.set({entries})",fixture)
        page.locator('#open-settings').click();page.locator('[data-settings-tab="tasks"]').click()
        page.locator('#preview-analysis-batch').click()
        expect(page.locator('#analysis-batch-summary')).to_have_text('待补全 1764 个案例')
        calls=worker.evaluate('testTextCalls')
        page.locator('#start-analysis-batch').click()
        confirmation=page.locator('#promptdirector-app-dialog')
        expect(confirmation).to_contain_text('1764 个案例')
        expect(confirmation).to_contain_text('API 费用')
        page.screenshot(path=str(ARTIFACTS/'payment-confirmation.png'))
        confirmation.get_by_role('button',name='取消',exact=True).click()
        assert worker.evaluate('testTextCalls')==calls
        print(json.dumps({'payment_cancel_zero_requests':True,'large_batch_confirmation':1764,'selected_retag':True,'manual_preserved':True,'outside_unchanged':True,'partial_retry_only_failures':True,'real_palette_calls':2,'recheck_no_duplicate':True,'missing_file_reported':True}))

if __name__=='__main__':main()
