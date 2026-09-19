"""Read-only import planning survives background shutdown, cancels, and cannot commit stale data.
The 649 generated cases reproduce case count, not the user's unavailable ZIP/media.
"""
import json
from e2e_support import base_entry, extension_session

with extension_session('pd-import-preview-') as session:
    page = session.open_page('collector.html')
    original = base_entry('local', '本机资料', '保留用户修改', 'content:text-case', 1)
    session.seed_storage(page, {'entries': [original]})
    worker = session.context.service_workers[0]
    cdp = session.context.new_cdp_session(page)
    versions = []
    cdp.on('ServiceWorker.workerVersionUpdated', lambda event: versions.extend(event['versions']))
    cdp.send('ServiceWorker.enable')
    page.evaluate('''async entry => {
      const {renderLibraryJson} = await import('./lib.js');
      window.previewInput = {
        currentState: await chrome.runtime.sendMessage({type:'GET_FOLDER_BACKUP_STATE'}),
        inspections:[{sourceType:'share-package',
          state:JSON.parse(renderLibraryJson(Array.from({length:649}, (_,i) => ({...entry,
            id:`incoming-${i}`, title:`案例${i}`, text:`完整原始提示词${i}`})), {})),
          report:{status:'ready',diagnostics:[],stats:{}},resourceIndex:{mediaAssetIds:[],skillAssetIds:[]}}],
        options:{preserveLibraryConfiguration:true}
      };
    }''', original)
    version = next(v for v in reversed(versions) if v.get('scriptURL') == worker.url and v.get('runningStatus') == 'running')
    cdp.send('ServiceWorker.stopWorker', {'versionId': version['versionId']})
    proof = page.evaluate('''async () => {
      const {previewLibraryImportInWorker} = await import('./library-import-preview.js');
      let ticks = 0;
      const timer = setInterval(() => ticks++, 0);
      const start = performance.now();
      window.preview = await previewLibraryImportInWorker(window.previewInput);
      clearInterval(timer);
      const controller = new AbortController();
      const pending = previewLibraryImportInWorker(window.previewInput,{signal:controller.signal});
      controller.abort();
      let cancelled = false;
      try { await pending; } catch(error) { cancelled=error.name==='AbortError'; }
      return {imported:preview.importedCount,ticks,cancelled,milliseconds:performance.now()-start};
    }''')
    assert proof['imported'] == 649 and proof['ticks'] > 0 and proof['cancelled'], proof
    result = page.evaluate('''async () => {
      const inspection = previewInput.inspections[0];
      window.request = {type:'APPLY_LIBRARY_IMPORT_BATCH', operationId:crypto.randomUUID(),
        planToken:preview.planToken, plan:preview.plan,
        packages:[{library:inspection.state, sourceType:inspection.sourceType,
          importReport:inspection.report, resourceIndex:inspection.resourceIndex}]};
      const result = await chrome.runtime.sendMessage(request);
      const replay = await chrome.runtime.sendMessage(request);
      const entries = (await chrome.storage.local.get('entries')).entries;
      return {result,replay,count:entries.length,original:entries.find(e=>e.id==='local').text};
    }''')
    assert result['result']['ok'] and result['replay'] == result['result'], result
    assert result['count'] == 650 and result['original'] == original['text'], result
    stale = page.evaluate('''async () => {
      const {previewLibraryImportInWorker} = await import('./library-import-preview.js');
      previewInput.currentState = await chrome.runtime.sendMessage({type:'GET_FOLDER_BACKUP_STATE'});
      const preview = await previewLibraryImportInWorker(previewInput);
      const entries = (await chrome.storage.local.get('entries')).entries;
      entries.find(e=>e.id==='local').text = '核对之后的用户编辑';
      await chrome.storage.local.set({entries});
      const result = await chrome.runtime.sendMessage({...request, operationId:crypto.randomUUID(),
        planToken:preview.planToken, plan:preview.plan});
      return {result,text:(await chrome.storage.local.get('entries')).entries.find(e=>e.id==='local').text};
    }''')
    assert not stale['result']['ok'] and '预览后' in stale['result']['message'], stale
    assert stale['text'] == '核对之后的用户编辑', stale
    print(json.dumps({'synthetic_cases':649,'preview':proof,'replay_preserved':True,'stale_write_rejected':True}))
