"""Shared save path: background 403, selected-page media succeeds, persisted poster and full receipt."""
import json, tempfile
from pathlib import Path
from e2e_support import EXTENSION_DIR, extension_session
from page_capture_e2e import fixture_png

WORK='https://www.midjourney.com/jobs/5ca4c5a5-5a4a-49b9-b4c6-bb451381b849?index=0'
CDN='https://cdn.midjourney.com'
VIDEO=CDN+'/video/5ca4c5a5-5a4a-49b9-b4c6-bb451381b849/0.mp4'
POSTER=CDN+'/video/5ca4c5a5-5a4a-49b9-b4c6-bb451381b849/0_640_N.webp'
with tempfile.TemporaryDirectory(prefix='session-video-extension-') as temp:
    extension=Path(temp)
    for file in EXTENSION_DIR.iterdir():
        if file.name!='manifest.json': (extension/file.name).symlink_to(file,target_is_directory=file.is_dir())
    manifest=json.loads((EXTENSION_DIR/'manifest.json').read_text())
    manifest['host_permissions']+=['https://www.midjourney.com/*',CDN+'/*']
    (extension/'manifest.json').write_text(json.dumps(manifest))
    with extension_session('session-video-',extension_dir=extension) as run:
        run.context.route(WORK,lambda r:r.fulfill(body='<html>Selected video source</html>',content_type='text/html'))
        run.context.route(VIDEO,lambda r:r.fulfill(body=(Path(__file__).parent/'fixtures/detail-portrait-smoke.mp4').read_bytes(),content_type='video/mp4',headers={'Access-Control-Allow-Origin':'https://www.midjourney.com','Access-Control-Allow-Credentials':'true'}))
        run.context.route(POSTER,lambda r:r.fulfill(body=fixture_png(POSTER),content_type='image/png',headers={'Access-Control-Allow-Origin':'https://www.midjourney.com','Access-Control-Allow-Credentials':'true'}))
        run.context.route(CDN+'/failed.mp4',lambda r:r.fulfill(status=403))
        source=run.context.new_page();source.goto(WORK)
        page=run.open_page('collector.html');run.seed_storage(page,{'entries':[]})
        # Only background requests fail: page fetch must really traverse the scoped transfer.
        run.context.service_workers[0].evaluate('''()=>{const real=fetch;globalThis.fetch=(url,options)=>String(url).startsWith('https://cdn.midjourney.com')?Promise.resolve(new Response('',{status:403})):real(url,options)}''')
        result=page.evaluate('''async ({work,url,poster})=>{
          const {normalizePageCaptureBatch}=await import('./page-capture.js');
          const [tab]=await chrome.tabs.query({url:work});
          const c={id:'selected',pageType:'video',title:'Session video',canonicalUrl:work,contentText:'Preserve this prompt',media:[{id:'video',kind:'video',url,posterUrl:poster,sourceKind:'site-original'}]};
          const batch=normalizePageCaptureBatch({tabId:tab.id,sourceUrl:work,sessionMediaAllowed:true,candidates:[c],selections:[{candidateId:c.id,includeText:true,selectedMediaIds:['video'],mediaDecision:'confirmed'}]});
          const response=await chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch});
          const entries=(await chrome.storage.local.get('entries')).entries;
          const e=entries.find(e=>e.id===response.results?.[0]?.entryId);
          const {savedPageCaptureCandidateIds}=await import('./capture-additions.js');
          const {getMediaBlob}=await import('./media-store.js');
          const video=e?.mediaAssets.find(a=>a.kind==='video');
          return {response,video,posterStored:!!(video?.posterAssetId&&await getMediaBlob(video.posterAssetId)),cleared:[...savedPageCaptureCandidateIds(batch,batch.candidates,response.results)]};
        }''',{'work':WORK,'url':VIDEO,'poster':POSTER})
        assert result['video']['storageMode']=='managed',result
        assert result['posterStored'],result
        assert result['cleared']==['selected'],result
        assert result['response']['results'][0]['pendingMediaIds']==[],result
        failed=page.evaluate('''async ({work,url,poster})=>{
          const {normalizePageCaptureBatch}=await import('./page-capture.js');
          const [tab]=await chrome.tabs.query({url:work});
          const c={id:'failed',pageType:'video',title:'Partial session video',canonicalUrl:work+'&failed=1',contentText:'Retain this prompt',media:[{id:'failed-video',kind:'video',url,posterUrl:poster,sourceKind:'site-original'}]};
          const batch=normalizePageCaptureBatch({tabId:tab.id,sourceUrl:work,sessionMediaAllowed:true,candidates:[c],selections:[{candidateId:c.id,includeText:true,selectedMediaIds:['failed-video'],mediaDecision:'confirmed'}]});
          const response=await chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch});
          const entries=(await chrome.storage.local.get('entries')).entries;
          const e=entries.find(e=>e.id===response.results?.[0]?.entryId);
          const video=e?.mediaAssets.find(a=>a.kind==='video');
          const {getMediaBlob}=await import('./media-store.js');
          const {savedPageCaptureCandidateIds}=await import('./capture-additions.js');
          return {response,video,posterStored:!!(video?.posterAssetId&&await getMediaBlob(video.posterAssetId)),cleared:[...savedPageCaptureCandidateIds(batch,batch.candidates,response.results)]};
        }''',{'work':WORK,'url':CDN+'/failed.mp4','poster':POSTER})
        assert failed['video']['storageMode']=='reference' and failed['posterStored'],failed
        assert failed['cleared']==[] and failed['response']['results'][0]['pendingMediaIds']==['failed-video'],failed
        print({'failedVideoRetainsPosterAndRetry':True})
        print({'background403PageSessionSaved':True,'posterStored':True,'sharedCleanupReceipt':True})
