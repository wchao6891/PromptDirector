"""Isolated release regression: 344 MB X video, full-byte readback and safe reuse.

The MP4 fixture has a valid free box appended to exercise large originals;
this proves storage/transport continuity, not the live X service or its speed.
"""
import base64
import hashlib
import json
import tempfile
from pathlib import Path
from e2e_support import EXTENSION_DIR, extension_session

SIZE = 344284911  # Observed complete X case byte count; stress one original at that size.
WORK = 'https://x.com/director/status/123'
VIDEO = 'https://video.twimg.com/fixture-original.mp4'
POSTER = 'https://pbs.twimg.com/fixture-poster.png'


def main():
    prefix = (Path(__file__).parent / 'fixtures/detail-portrait-smoke.mp4').read_bytes()
    free_size = SIZE - len(prefix)
    header = prefix + free_size.to_bytes(4, 'big') + b'free'
    digest = hashlib.sha256(header)
    remaining = SIZE - len(header)
    zero = bytes(1024 * 1024)
    while remaining:
        chunk = zero[:min(remaining, len(zero))]
        digest.update(chunk)
        remaining -= len(chunk)
    expected = digest.hexdigest()
    with tempfile.TemporaryDirectory(prefix='pd-x-large-extension-') as temp:
        extension = Path(temp)
        for file in EXTENSION_DIR.iterdir():
            if file.name != 'manifest.json':
                (extension / file.name).symlink_to(file, target_is_directory=file.is_dir())
        manifest = json.loads((EXTENSION_DIR / 'manifest.json').read_text())
        manifest['host_permissions'] += ['https://x.com/*', 'https://video.twimg.com/*', 'https://pbs.twimg.com/*']
        (extension / 'manifest.json').write_text(json.dumps(manifest))
        with extension_session('pd-x-large-media-', extension_dir=extension) as run:
            run.context.route('https://x.com/**', lambda route: route.fulfill(body='<html>Selected X post</html>', content_type='text/html'))
            source = run.context.new_page()
            source.goto(WORK)
            page = run.open_page('collector.html')
            run.seed_storage(page, {'entries': []})
            # Both responses use browser Blob streams: no full-file base64 or Python route copy.
            script = """({header,size,video,poster,failVideo})=>{
              const bytes=Uint8Array.from(atob(header),c=>c.charCodeAt(0));
              const zero=new Uint8Array(1024*1024),parts=[bytes];
              for(let left=size-bytes.length;left>0;left-=zero.length)parts.push(zero.subarray(0,Math.min(left,zero.length)));
              const blob=new Blob(parts,{type:'video/mp4'});
              const real=fetch;
              globalThis.fetch=(url,options)=>String(url)===video?Promise.resolve(failVideo?new Response('',{status:403}):new Response(blob))
                :String(url)===poster?Promise.resolve(new Response(new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],{type:'image/png'})))
                :real(url,options);
            }"""
            args = {'header': base64.b64encode(header).decode(), 'size': SIZE, 'video': VIDEO, 'poster': POSTER, 'failVideo': False}
            worker = run.context.service_workers[0]
            worker.evaluate(script, args)
            save = """async ({work,video,poster,suffix})=>{
              const {normalizePageCaptureBatch}=await import('./page-capture.js');
              const [tab]=await chrome.tabs.query({url:work});
              const candidate={id:'large-'+suffix,title:'Large X original '+suffix,canonicalUrl:suffix==='direct'?work:work.replace('/123','/456'),
                pageType:'video',contentText:'Complete prompt remains unchanged '+suffix,
                media:[{id:'selected-video',kind:'video',url:video,posterUrl:poster,sourceKind:'site-original'}]};
              const batch=normalizePageCaptureBatch({adapter:'x',tabId:tab.id,sourceUrl:work,sessionMediaAllowed:true,
                candidates:[candidate],selections:[{candidateId:candidate.id,includeText:true,selectedMediaIds:['selected-video'],mediaDecision:'confirmed'}]});
              const result=await chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch});
              const entry=(await import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get('entries'))).entries.find(item=>item.id===result.results?.[0]?.entryId);
              const asset=entry?.mediaAssets.find(item=>item.kind==='video');
              const {getMediaBlob}=await import('./media-store.js');
              const {sha256Blob}=await import('./blob-digest.js');
              const blob=asset&&await getMediaBlob(asset.id);
              return {result,entryId:entry?.id,text:entry?.text,asset,bytes:blob?.size,sha256:blob?await sha256Blob(blob):null,
                poster:entry?.mediaAssets.find(item=>item.id===asset?.posterAssetId)};
            }"""
            save_args = {'work': WORK, 'video': VIDEO, 'poster': POSTER, 'suffix': 'direct'}
            direct = page.evaluate(save, save_args)
            assert direct['asset']['storageMode'] == 'managed', direct
            assert direct['bytes'] == SIZE and direct['sha256'] == expected, direct
            assert direct['result']['results'][0]['pendingMediaIds'] == [], direct
            # Reuse a source whose cover was historically marked content. The new case must
            # correct the cover role while leaving the original source metadata untouched.
            page.evaluate("""async id=>{const stored=await import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get('entries'));
              const e=stored.entries.find(item=>item.id===id);e.mediaAssets.find(item=>item.id===e.mediaAssets.find(a=>a.kind==='video').posterAssetId).usage='content';
              await import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().set({entries:stored.entries}));}""", direct['entryId'])
            before = page.evaluate("async id=>(await import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get('entries'))).entries.find(e=>e.id===id)", direct['entryId'])
            source.evaluate(script, args)
            worker.evaluate(script, {**args, 'failVideo': True})
            reused = page.evaluate(save, {**save_args, 'suffix': 'session-reuse'})
            assert reused['asset']['id'] == direct['asset']['id'], reused
            assert reused['bytes'] == SIZE and reused['sha256'] == expected, reused
            assert reused['poster']['usage'] == 'poster' and reused['poster']['derivedFromAssetId'] == direct['asset']['id'], reused
            assert reused['result']['results'][0]['pendingMediaIds'] == [], reused
            page.reload()
            readback = page.evaluate("""async ids=>{
              const {getMediaBlob}=await import('./media-store.js');const {sha256Blob}=await import('./blob-digest.js');
              const entries=(await import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get('entries'))).entries;
              const blob=await getMediaBlob(ids.assetId);
              return {source:entries.find(e=>e.id===ids.sourceId),result:entries.find(e=>e.id===ids.resultId),bytes:blob.size,sha256:await sha256Blob(blob)};
            }""", {'assetId': direct['asset']['id'], 'sourceId': direct['entryId'], 'resultId': reused['entryId']})
            assert readback['source'] == before, 'Reusing large bytes changed the original case'
            assert readback['bytes'] == SIZE and readback['sha256'] == expected
            assert readback['result']['text'] == reused['text']
            assert source.evaluate("()=>globalThis.__PROMPTDIRECTOR_PAGE_SESSION_MEDIA__?.size||0") == 0, 'Page transfer resources were not released'
            print(json.dumps({'original_bytes': SIZE, 'sha256': expected, 'direct_capture_save': True,
              'page_session_capture_save': True, 'shared_original_preserved': True, 'source_unchanged': True,
              'reload_full_byte_readback': True, 'temporary_media_released': True}))


if __name__ == '__main__':
    main()
