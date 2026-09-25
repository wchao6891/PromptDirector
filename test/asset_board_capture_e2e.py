"""Reduced real-DOM regressions for asset-dialog ownership and Pinterest boards."""
import json
import tempfile
from pathlib import Path
from datetime import datetime, timezone
from e2e_support import EXTENSION_DIR, extension_session
from page_capture_e2e import PNG

HIGGS = 'https://higgsfield.ai/'
BOARD = 'https://www.pinterest.com/fixture/board/'
CDN = 'https://d8j0ntlcm91z4.cloudfront.net'
PROMPT = 'Original asset prompt.\n' + ' '.join(['Detailed original direction.'] * 420) + '\nFinal prompt paragraph must survive.'


def main():
    with tempfile.TemporaryDirectory(prefix='pd-capture30-extension-') as temp:
        extension = Path(temp)
        for path in EXTENSION_DIR.iterdir():
            if path.name != 'manifest.json':
                (extension/path.name).symlink_to(path, target_is_directory=path.is_dir())
        manifest = json.loads((EXTENSION_DIR/'manifest.json').read_text())
        manifest['host_permissions'] += ['https://higgsfield.ai/*', CDN+'/*', 'https://www.pinterest.com/*', 'https://i.pinimg.com/*']
        (extension/'manifest.json').write_text(json.dumps(manifest))
        with extension_session('pd-capture30-', extension_dir=extension) as run:
            video_bytes=(Path(__file__).parent/'fixtures/zhipu-local-video-smoke.mp4').read_bytes()
            def route(r):
                u=r.request.url
                if u.startswith(CDN) or u.startswith('https://i.pinimg.com/'):
                    r.fulfill(status=200,content_type='video/mp4' if '.mp4' in u else 'image/png',body=video_bytes if '.mp4' in u else PNG)
                else:r.fulfill(status=200,content_type='text/html',body='<html><body></body></html>')
            for host in ['https://higgsfield.ai/**','https://www.pinterest.com/**',CDN+'/**','https://i.pinimg.com/**']:run.context.route(host,route)
            collector=run.open_page('collector.html')
            run.seed_storage(collector,{'schemaVersion':24,'entries':[],'capturePermissionOnboarding':{'version':1,'acknowledgedAt':datetime.now(timezone.utc).isoformat(),'clipboardIncluded':True}})
            source=run.context.new_page()
            def capture():
                source.bring_to_front()
                result=collector.evaluate("async()=>chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'})")
                assert result.get('ok'),result
                return result['batch']
            source.goto(HIGGS)
            background='<section aria-label="Project brief: wrong"><p>BACKGROUND PROJECT MUST NOT BE CAPTURED</p><img src="'+CDN+'/background.png"></section>'
            for index,kind in enumerate(['video','image']):
                media=f'<video src="{CDN}/movie.mp4" poster="{CDN}/poster.png" controls></video>' if kind=='video' else f'<img alt="raw media image" src="{CDN}/output.png">'
                reference = f'<a href="/asset/all?inputMediaId=reference&inputMediaType=image&assetId=asset-{index}"><img src="{CDN}/reference.png"></a>' if index else ''
                source.set_content(background+f'''<div role="dialog" aria-description="asset showcase dialog view" data-state="open">
                {media}<h2 hidden>Asset showcase</h2><h2>Fixture author</h2><div role="tabpanel"><p>Prompt</p>{reference}<div role="textbox" style="white-space:pre-wrap">{PROMPT}</div></div></div>''')
                batch=capture(); assert len(batch['candidates'])==1,batch
                c=batch['candidates'][0]
                assert c['contentText']==PROMPT,c
                assert c['title']==' '.join(PROMPT.split())[:160],c
                assert c['sourceFacts']['author']=='Fixture author',c
                assert all(m.get('placement')=='inline' for m in c['media']),c
                assert len(c['media'])==1 and c['media'][0]['kind']==kind,c
                assert c['canonicalUrl'] == (HIGGS if not index else HIGGS+'asset/all?assetId=asset-1'),c
                selected=collector.evaluate("async c=>(await import('./page-capture.js')).pageCaptureDefaultMediaIds(c)",c)
                assert len(selected)==1,c
                batch['selections']=[{'candidateId':c['id'],'includeText':True,'selectedMediaIds':selected,'mediaDecision':'confirmed'}]
                saved=collector.evaluate("async batch=>chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch})",batch)
                assert saved.get('ok'),saved
            stored=collector.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
            assert len(stored)==2,stored
            assert all(e['text']==PROMPT for e in stored),stored
            assert all(any(m.get('storageMode')=='managed' for m in e['mediaAssets']) for e in stored),stored
            source.set_content(background + '<section data-asset-id=other><img src="'+CDN+'/other.png"></section>')
            article = capture()['candidates'][0]
            assert 'BACKGROUND PROJECT MUST NOT BE CAPTURED' in article['contentText'],article
            assert all(m['url'].endswith('/background.png') for m in article['media']),article
            source.goto(BOARD)
            def cards(count):
                return '<main><h1>Fixture board</h1><p>Save Share More actions</p>'+''.join(f'''<div data-grid-item><div data-test-id="pin"><div data-test-id="pinWrapper"><a href="/pin/{100000+i}/"><img alt="Artwork {i}" style="width:240px;height:320px" src="https://i.pinimg.com/236x/{i}.png" srcset="https://i.pinimg.com/236x/{i}.png 1x, https://i.pinimg.com/originals/{i}.png 4x"></a><button>Save</button></div></div></div>''' for i in range(count))+'</main>'
            for count in [1,3]:
                source.set_content(cards(count))
                # The same Pin gets transient board/save controls under hover.
                source.locator('[data-test-id="pinWrapper"]').last.evaluate("node=>node.insertAdjacentHTML('beforeend','<div role=button><p>Board name</p><button>Save</button></div>')")
                batch=capture();cs=batch['candidates']
                assert len(cs)==count,(count,cs)
                assert len({c['canonicalUrl'] for c in cs})==count,cs
                assert all('/pin/' in c['canonicalUrl'] for c in cs),cs
                assert all(len(c['media'])==1 and '/originals/' in c['media'][0]['url'] for c in cs),cs
                assert all(not c['contentText'] and not c['textBlocks'] for c in cs),cs
                assert collector.evaluate("async cs=>{const {pageCaptureStructureMatches}=await import('./page-capture.js');return cs.every(c=>pageCaptureStructureMatches(cs[0],c))}",cs),cs
            # Board-wide metadata must not become the metadata of every artwork.
            source.set_content('<meta name="author" content="BOARD OWNER"><meta property="article:published_time" content="2024-01-01T00:00:00Z"><script type="application/ld+json">'+json.dumps({'@type':'CollectionPage','name':'BOARD TITLE','author':{'name':'BOARD OWNER'},'url':BOARD})+'</script>'+cards(3))
            for i, label in enumerate(['其中包括图片：', '其中包括图片： Dragon and Artemis', 'This may contain: Forest temple']):
                source.locator('[data-test-id="pinWrapper"] img').nth(i).evaluate('(node,label)=>node.alt=label',label)
            batch=capture();cs=batch['candidates']
            assert cs[0]['title']=='Pinterest · 100000',cs
            assert cs[1]['title']=='Dragon and Artemis' and cs[2]['title']=='Forest temple',cs
            assert all(not c['sourceFacts']['author'] and not c['sourceFacts']['publishedAt'] for c in cs),cs
            selections=collector.evaluate("""async candidates => {
              const {pageCaptureDefaultMediaIds}=await import('./page-capture.js');
              return candidates.map(c=>({candidateId:c.id,includeText:true,
                selectedMediaIds:pageCaptureDefaultMediaIds(c),mediaDecision:'confirmed'}));
            }""",cs)
            assert all(len(s['selectedMediaIds'])==1 for s in selections),selections
            batch['selections']=selections
            saved=collector.evaluate("async batch=>chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch})",batch)
            assert saved.get('ok'),saved
            collector.reload()
            readback=collector.evaluate("""async () => {
              const {entries}=await chrome.runtime.sendMessage({type:'GET_STATE'});
              const {getMediaBlob}=await import('./media-store.js');
              const {sha256Blob}=await import('./blob-digest.js');
              return Promise.all(entries.filter(e=>e.url.includes('pinterest.com')).map(async e=>({
                url:e.url,title:e.title,media:await Promise.all(e.mediaAssets.map(async a=>{
                  const blob=await getMediaBlob(a.id);
                  return {name:a.sourceTitle,mode:a.storageMode,bytes:blob?.size,hash:blob?await sha256Blob(blob):null};
                }))
              })));
            }""")
            import hashlib
            assert len(readback)==3,readback
            assert {e['title'] for e in readback}=={c['title'] for c in cs},readback
            assert all('其中包括' not in m['name'] and m['name'] for e in readback for m in e['media']),readback
            assert {e['url'] for e in readback}=={c['canonicalUrl'] for c in cs},readback
            assert all(len(e['media'])==1 and e['media'][0]['mode']=='managed' and
                       e['media'][0]['hash']==hashlib.sha256(PNG).hexdigest() for e in readback),readback
            source.set_content(cards(1))
            source.locator('[data-test-id="pinWrapper"]').evaluate("node=>node.insertAdjacentHTML('beforeend','<p>Original artwork description</p><div role=button><p>Board name</p><button>Save</button></div>')")
            described=capture()['candidates'][0]
            # Existing section selection may put short descriptions in review;
            # filtering controls must still preserve their text and document block.
            assert 'Original artwork description' in [described['contentText']]+[b['text'] for b in described['possibleOmissions']],described
            assert any(b.get('text')=='Original artwork description' for b in described['articleDocument']['blocks']),described
            assert all('Board name' not in b.get('text','') for b in described['articleDocument']['blocks']),described
            print('PASS asset image/video prompt ownership, managed save/readback; Pinterest singleton/nested cards/original variants')

if __name__=='__main__':main()
