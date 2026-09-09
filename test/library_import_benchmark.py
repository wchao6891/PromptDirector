"""Opt-in 2 GiB synthetic transport timing; not a user-machine acceptance test."""
import sys, json, tempfile, zipfile
from pathlib import Path
from e2e_support import extension_session, base_entry
with tempfile.TemporaryDirectory(prefix='pd-import-benchmark-') as temporary, extension_session('pd-import-perf-') as s:
    root=Path(temporary)
    p=s.open_page('collector.html')
    archive=root/'synthetic-2g.zip'
    if not archive.exists():
        entry=base_entry('perf-case','Synthetic 2 GiB transport','Synthetic original attachments; not user data','content:prompt:text')
        entry['mediaAssets']=[dict(id=f'perf-{i}',kind='attachment',storageMode='managed',mimeType='image/vnd.adobe.photoshop',sourceFormat='psd',byteSize=4*1024*1024,capturedAt='2026-09-09T00:00:00.000Z',assetPath=f'attachments/{i}.psd') for i in range(512)]
        entry['primaryMediaId']='perf-0'
        library=p.evaluate("async entry => (await import(chrome.runtime.getURL('lib.js'))).renderLibraryJson([entry])", entry)
        block=bytes(range(256))*16384
        with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_STORED) as z:
            z.writestr('library.json',library)
            for a in entry['mediaAssets']: z.writestr(a['assetPath'],block)
    p.evaluate("() => { const input=document.createElement('input'); input.type='file'; input.id='perf-file';document.body.append(input); }")
    p.locator('#perf-file').set_input_files(str(archive))
    result=p.evaluate('''async mode => {
      const {openZipBlob}=await import(chrome.runtime.getURL('zip.js'));
      const {inspectLibraryTransfer}=await import(chrome.runtime.getURL('library-transfer.js'));
      const store=await import(chrome.runtime.getURL('media-store.js'));
      const {libraryTransferLimits}=await import(chrome.runtime.getURL('resource-limits.js'));
      const start=performance.now(); const reader=await openZipBlob(document.querySelector('#perf-file').files[0],libraryTransferLimits());
      const indexed=performance.now();
      const {readZipResources}=await import(chrome.runtime.getURL('zip-reader.js'));
      const files=mode==='worker' ? await readZipResources(document.querySelector('#perf-file').files[0],null,libraryTransferLimits()) : await reader.read();
      const read=performance.now();
      const library=JSON.parse(await files.get('library.json').text());
      const inspection=await inspectLibraryTransfer({sourceType:'share-package',library,files,limits:libraryTransferLimits()});
      const checked=performance.now();
      const writes=[...inspection.resources.assets].map(([assetId,blob])=>({assetId,blob}));
      if(mode!=='serial') await store.savePortableAssetBlobs(writes,{checkCapacity:false});
      else for(const {assetId,blob} of writes) await store.savePortableAssetBlob(assetId,blob,{checkCapacity:false});
      const saved=performance.now(); let bytes=0;
      for(const {assetId,blob} of writes) { const actual=await store.getMediaBlob(assetId); if(actual.size!==blob.size) throw Error('Byte size differs');bytes+=actual.size; }
      return {mode,bytes,files:writes.length,indexMs:indexed-start,readCrcMs:read-indexed,inspectMs:checked-read,writeMs:saved-checked,totalMs:saved-start};
    }''',sys.argv[1] if len(sys.argv)>1 else 'worker')
    print(json.dumps(result),flush=True)
