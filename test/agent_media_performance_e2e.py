"""Disposable Chrome: complete large-original read, verified reuse, no source edits.

Optional original path uses existing local bytes as a read-only fixture. Browser
transport timings do not include a model, native socket, or external Agent.
"""
import base64
import hashlib
import json
import sys
import tempfile
import time
from pathlib import Path
from e2e_support import EXTENSION_DIR, extension_session


def run_case(legacy=False, original_path=None):
    with tempfile.TemporaryDirectory(prefix='pd-media-perf-runtime-') as tmp:
        extension = Path(tmp)
        overrides = {'background.js', 'agent-library.js'}
        for file in EXTENSION_DIR.iterdir():
            if file.name not in overrides:
                (extension/file.name).symlink_to(file, target_is_directory=file.is_dir())
        (extension/'background.js').write_text((EXTENSION_DIR/'background.js').read_text()+'\nglobalThis.agentTestDispatch=dispatchAgentOperation;\n')
        library = (EXTENSION_DIR/'agent-library.js').read_text()
        if legacy:
            library = library.replace('offset + agentDownloadChunkBytes()', 'offset + AGENT_CHUNK_BYTES')
        (extension/'agent-library.js').write_text(library)
        with extension_session('pd-media-perf-', extension_dir=extension) as session:
            page=session.open_page('collector.html')
            session.seed_storage(page, {'entries':[]})
            if original_path:
                page.evaluate("()=>{const input=document.createElement('input');input.type='file';input.id='fixture-original';document.body.append(input)}")
                page.locator('#fixture-original').set_input_files(str(original_path))
            original=page.evaluate('''async fromFile=>{
              const {saveMediaBlob}=await import('./media-store.js');const {sha256Blob}=await import('./blob-digest.js');
              const source=fromFile?document.querySelector('#fixture-original').files[0]:new Blob([new Uint8Array(32*1024*1024+47).fill(109)]);
              const blob=new Blob([source],{type:'video/mp4'});const sha256=await sha256Blob(blob);
              await saveMediaBlob('perf-original',blob);await saveMediaBlob('perf-poster',new Blob(['poster'],{type:'image/png'}));
              const entry={id:'perf-source',title:'Original source stays unchanged',text:'Full prompt '.repeat(300),savedAt:'2026-10-02T00:00:00Z',mediaAssets:[
                {id:'perf-original',kind:'video',storageMode:'managed',mimeType:blob.type,byteSize:blob.size,contentHash:sha256,posterAssetId:'perf-poster'},
                {id:'perf-poster',kind:'image',usage:'poster',storageMode:'managed',mimeType:'image/png',byteSize:6,derivedFromAssetId:'perf-original'}]};
              const entries=[entry,...Array.from({length:3870},(_,i)=>({id:'fixture-'+i,title:'Synthetic case '+i,text:'Complete scene reference. '.repeat(128),savedAt:'2026-10-02T00:00:00Z'}))];
              await chrome.storage.local.set({entries});await chrome.runtime.sendMessage({type:'GET_STATE'});
              return {byteSize:blob.size,sha256};
            }''',bool(original_path))
            worker=session.context.service_workers[0]
            def call(op,args):
                return worker.evaluate('([op,args])=>globalThis.agentTestDispatch(op,args)',[op,args])
            expected_source=call('read_case_details',{'caseId':'perf-source'})
            digest=hashlib.sha256();offset=0;count=0
            start=time.monotonic()
            while True:
                part=call('read_media',{'caseId':'perf-source','assetId':'perf-original','offset':offset,**({'expectedHash':original['sha256']} if offset else {})})
                data=base64.b64decode(part['data']);digest.update(data);count+=1
                assert part['offset']==offset and part['byteSize']==original['byteSize'] and part['sha256']==original['sha256']
                offset+=len(data)
                if part['nextOffset'] is None:
                    break
                assert part['nextOffset']==offset
            elapsed=time.monotonic()-start
            assert offset==original['byteSize'] and digest.hexdigest()==original['sha256']
            if not legacy:
                assert count<=((offset+16*1024*1024-1)//(16*1024*1024))
                save_start=time.monotonic()
                record={'name':'original.mp4','mimeType':'video/mp4',**original}
                receipt=call('begin_transfer',{'id':'perf-reuse',**record})
                assert receipt['state']=='ready' and receipt['offset']==offset, receipt
                assert call('finish_transfer',{'id':'perf-reuse'})['assetId']=='perf-original'
                args={'requestId':'perf-save','title':'Complete workflow result','text':'Complete analysis remains free to the external Agent.',
                      'transferIds':['perf-reuse'],'sourceCaseIds':['perf-source'],'filePrompts':{'perf-reuse':'Retain this exact full prompt.'}}
                call('save_material',args)
                result=call('get_task',{'requestId':'perf-save','waitMs':15000})
                assert result['state']=='completed', result
                case_id=result['result']['results'][0]['entryId']
                saved=call('read_case_details',{'caseId':case_id,'part':'media'})
                assert {a['id'] for a in json.loads(saved['content'])}=={'perf-original','perf-poster'}, saved
                assert call('read_case_details',{'caseId':'perf-source'})==expected_source, 'Reuse changed the source case'
                # IndexedDB contains the original and its poster, no second video or chunks.
                keys=page.evaluate('''()=>new Promise((resolve,reject)=>{
                  const request=indexedDB.open('prompt-case-collector');request.onerror=()=>reject(request.error);
                  request.onsuccess=()=>{const db=request.result;const read=db.transaction('media').objectStore('media').getAllKeys();
                    read.onsuccess=()=>{resolve(read.result);db.close()};read.onerror=()=>reject(read.error)};
                })''')
                assert set(keys)=={'perf-original','perf-poster'},keys
                page.reload()
                persisted=call('read_case',{'caseId':case_id})
                assert persisted['content']==args['text']
                prompts=call('read_case_details',{'caseId':case_id,'part':'annotations'})
                assert json.loads(prompts['content'])['mediaPrompts'][0]['text']==args['filePrompts']['perf-reuse']
                save_elapsed=time.monotonic()-save_start
                removed=page.evaluate("async id=>chrome.runtime.sendMessage({type:'BATCH_MOVE_TO_TRASH',entryIds:[id]})",case_id)
                assert removed['ok'],removed
                trash=page.evaluate("async()=>chrome.runtime.sendMessage({type:'GET_TRASH_ITEMS'})")
                assert len(trash['items'])==1,trash
                deleted=page.evaluate("async ids=>chrome.runtime.sendMessage({type:'PERMANENT_DELETE_TRASH_ITEMS',itemIds:ids})",[item['id'] for item in trash['items']])
                assert deleted['ok'],deleted
                assert call('read_case_details',{'caseId':'perf-source'})==expected_source
                remaining=page.evaluate("async()=>{const {getMediaBlob}=await import('./media-store.js');const {sha256Blob}=await import('./blob-digest.js');return {sha256:await sha256Blob(await getMediaBlob('perf-original')),poster:!!await getMediaBlob('perf-poster')}}")
                assert remaining=={'sha256':original['sha256'],'poster':True},remaining
            print(json.dumps({'mode':'old_chunk' if legacy else 'new_chunk','synthetic_cases':3871,'original_bytes':offset,'chunks':count,
                 'complete_read_seconds':round(elapsed,3),'sha256_verified':True,
                 **({} if legacy else {'same_original_uploaded_bytes':0,'save_and_readback_seconds':round(save_elapsed,3),'source_unchanged':True,'persisted_media_blobs':len(keys),'deleting_result_keeps_source_bytes_and_poster':True})},ensure_ascii=False),flush=True)


if __name__=='__main__':
    if len(sys.argv)>1:
        run_case(original_path=Path(sys.argv[1]))
    else:
        run_case(legacy=True)
        run_case()
