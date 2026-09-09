"""Real IndexedDB atomicity and worker transport; synthetic bytes, isolated profile."""
from e2e_support import extension_session


def main():
    with extension_session('pd-import-resources-') as session:
        page=session.open_page('collector.html')
        result=page.evaluate('''async () => {
          const {savePortableAssetBlobs,getMediaBlob}=await import('./media-store.js');
          const {createZipBlob}=await import('./zip.js');
          const {readZipResources}=await import('./zip-reader.js');
          const {sha256Blob}=await import('./blob-digest.js');
          const bytes=crypto.getRandomValues(new Uint8Array(65536));
          const blob=new Blob([bytes,bytes,bytes],{type:'application/octet-stream'});
          const archive=await createZipBlob(Array.from({length:24},(_,i)=>({name:`attachments/${i}.psd`,data:blob})));
          const progress=[];
          const files=await readZipResources(archive,null,{}, {onProgress:value=>progress.push(value)});
          if(!progress.length) throw Error('Missing worker progress');
          const expected=await sha256Blob(blob);
          const items=[...files].map(([name,blob])=>({assetId:name,blob}));
          const originalPut=IDBObjectStore.prototype.put;
          let inserted=0;
          IDBObjectStore.prototype.put=function(...args){
            if(this.name==='media' && ++inserted===3) throw new DOMException('Injected write failure','DataError');
            return originalPut.apply(this,args);
          };
          let failed=false;
          try { await savePortableAssetBlobs(items,{checkCapacity:false}); }
          catch(error){failed=error.code==='storage_write_failed';}
          finally { IDBObjectStore.prototype.put=originalPut; }
          if(!failed) throw Error('Expected write failure');
          for(const {assetId} of items) if(await getMediaBlob(assetId)) throw Error('Partial resource leaked after abort');
          const writes=[];
          await savePortableAssetBlobs(items,{onProgress:value=>writes.push(value)});
          for(const {assetId} of items) if(await sha256Blob(await getMediaBlob(assetId))!==expected) throw Error('Original bytes differ');
          if(writes.at(-1).completed!==items.length) throw Error('Missing write progress');
          const controller=new AbortController();
          let aborted=false;
          try { await readZipResources(archive,null,{}, {signal:controller.signal,onProgress:()=>controller.abort()}); }
          catch(error){aborted=error.name==='AbortError';}
          if(!aborted) throw Error('Worker cancellation did not stop reading');
          const damaged=new Blob([archive.slice(0,60),new Uint8Array([99]),archive.slice(61)]);
          let rejected=false;
          try { await readZipResources(damaged,null,{}); } catch { rejected=true; }
          if(!rejected) throw Error('Corrupt ZIP accepted');
          return {resources:items.length,rollback:true,originalHashes:true,cancellation:true,corruption:true};
        }''')
        print(result,flush=True)

if __name__=='__main__': main()
