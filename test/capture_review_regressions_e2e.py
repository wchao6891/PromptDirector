import sys,json
# Synthetic source data; production background save and persisted library readback.
from e2e_support import extension_session

with extension_session('pd-review-commits-') as run:
    page=run.open_page('collector.html')
    run.seed_storage(page,{'entries':[]})
    result=page.evaluate('''async()=>{
      const {normalizePageCaptureBatch}=await import('./page-capture.js');
      const {addDiscoveredVideos,videoResource}=await import('./video-discovery.js');
      const candidate={id:'review-article',title:'Review fixture',canonicalUrl:'https://example.com/review-article',pageType:'article',contentText:'Review fixture text',textBlocks:[{id:'text',text:'Review fixture text'}],media:[],sourceFacts:{provider:'example.com',pageType:'article',extractionMethod:'structured'}};
      const batch=normalizePageCaptureBatch({sourceUrl:candidate.canonicalUrl,candidates:[candidate],selections:[{candidateId:candidate.id,includeText:true,selectedTextBlockIds:['text'],selectedMediaIds:[],mediaDecision:'confirmed'}]});
      const first=await chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch,contentTypeExplicit:true,contentTypeId:'content:reference'});
      const second=await chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch,contentTypeExplicit:true,contentTypeId:'content:video-case'});
      const entry=(await chrome.storage.local.get('entries')).entries.find(e=>e.id===first.results[0].entryId);
      await chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch});
      const preserved=(await chrome.storage.local.get('entries')).entries.find(e=>e.id===entry.id).classification.pathIds[0];
      const next={...candidate,id:'new',canonicalUrl:'https://example.com/new-article'};
      const mixed=normalizePageCaptureBatch({sourceUrl:candidate.canonicalUrl,candidates:[candidate,next],selections:[candidate,next].map(c=>({candidateId:c.id,includeText:true,selectedTextBlockIds:['text'],selectedMediaIds:[],mediaDecision:'confirmed'}))});
      const mixedSaved=await chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch:mixed,contentTypeExplicit:true,contentTypeId:'content:image-case'});
      const mixedEntries=(await chrome.storage.local.get('entries')).entries;
      const mixedTypes=mixedSaved.results.map(r=>mixedEntries.find(e=>e.id===r.entryId).classification.pathIds[0]);
      const resource=videoResource({tabId:1,statusCode:200,url:'https://media.example.com/playlist.m3u8',responseHeaders:[{name:'Content-Type',value:'application/vnd.apple.mpegurl'}]});
      const discovered=addDiscoveredVideos({sourceUrl:'https://example.com/review-player',candidates:[{id:'review-hls',title:'Review HLS fixture',canonicalUrl:'https://example.com/review-player',pageType:'video',media:[]}]},[resource]);
      discovered.selections=[{candidateId:'review-hls',selectedMediaIds:[discovered.candidates[0].media[0].id],mediaDecision:'confirmed'}];
      const saved=await chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch:normalizePageCaptureBatch(discovered)});
      const hls=(await chrome.storage.local.get('entries')).entries.find(e=>e.id===saved.results[0].entryId);
      return {preserved,mixedTypes,duplicateClassification:{firstStatus:first.results[0].status,secondStatus:second.results[0].status,requested:'content:video-case',stored:entry.classification.pathIds[0]},hls:{status:saved.results[0].status,media:hls.mediaAssets.map(a=>({kind:a.kind,storageMode:a.storageMode,reference:a.reference}))}};
    }''')
    assert result['duplicateClassification']['stored']=='content:video-case',result
    assert result['duplicateClassification']['secondStatus']=='duplicate',result
    assert result['preserved']=='content:video-case' and result['mixedTypes']==['content:image-case','content:image-case'],result
    reference=result['hls']['media'][0]['reference']
    assert reference.get('streamUrl')=='https://media.example.com/playlist.m3u8',result
    print(json.dumps(result,ensure_ascii=False,indent=2))
