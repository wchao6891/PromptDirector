"""A main post, quoted video and author prompt share the real original save path."""
import json
import tempfile
from pathlib import Path
from e2e_support import EXTENSION_DIR, extension_session
from page_capture_e2e import fixture_png

WORK = 'https://x.com/director/status/123'
QUOTE = 'https://x.com/director/status/100'
CDN = 'https://video.twimg.com/quoted.mp4'
POSTER = 'https://pbs.twimg.com/amplify_video_thumb/555/img/cover.jpg'
FULL = 'Full author prompt\n' + '\n'.join(f'Shot {i}: preserve the original movement.' for i in range(90))
BYTES = (Path(__file__).parent / 'fixtures/zhipu-local-video-smoke.mp4').read_bytes()


def main():
    with tempfile.TemporaryDirectory(prefix='x-quoted-extension-') as temp:
        ext = Path(temp)
        for file in EXTENSION_DIR.iterdir():
            # Chrome's dynamically registered scripts must be real files in the
            # installed extension; a symlink is accepted by executeScript but
            # silently omitted at document_start. Packages contain real files.
            if file.name == 'x-video-observer.js':
                (ext / file.name).write_bytes(file.read_bytes())
            elif file.name != 'manifest.json':
                (ext / file.name).symlink_to(file, target_is_directory=file.is_dir())
        manifest = json.loads((EXTENSION_DIR / 'manifest.json').read_text())
        manifest['host_permissions'] += ['https://x.com/*', 'https://video.twimg.com/*', 'https://pbs.twimg.com/*']
        (ext / 'manifest.json').write_text(json.dumps(manifest))
        media = {'expanded_url': QUOTE + '/video/1', 'media_url_https': POSTER, 'video_info': {'variants': [{'content_type': 'video/mp4', 'url': CDN, 'bitrate': 10}]}}
        data = {'data': {'tweet': {'rest_id': '123', 'quoted_tweet_results': {'result': {'rest_id': '100', 'media_entities2': [media]}}}}}
        metadata = '<script type="application/x-fixture">($R=>$R[0]={kind:"GraphQLRequestStream.Completed",result:{value:' + json.dumps(json.dumps(data)) + '}})($R["tsr"])</script>'
        images = ''.join(f'<a href="{WORK}/photo/{i}"><img src="https://pbs.twimg.com/media/list-image-{i}.jpg" width="100" height="100"></a>' for i in range(1, 5))
        html = f'''<html><head><link rel="canonical" href="{WORK}"></head><body><main>
        <article data-testid="tweet"><div data-testid="User-Name"><a href="/director"><span>Director</span></a></div>
        <div data-testid="tweetText">Main post; assets and the prompt below.</div>{images}
        <div role="link" tabindex="0"><div data-testid="tweetText">Quoted original video.</div><video poster="{POSTER}" width="320" height="180"></video></div>
        <a href="/director/status/123"><time>Today</time></a></article>
        <article data-testid="tweet"><div data-testid="User-Name"><a href="/director"><span>Director</span></a></div>
        <div data-testid="tweetText">Full author prompt preview<button data-testid="tweet-text-show-more-link" onclick="this.parentElement.textContent=window.fullPrompt">Show more</button></div>
        <a href="/director/status/124"><time>Today</time></a></article>
        <article data-testid="tweet"><div data-testid="User-Name"><a href="/other">Other</a></div><div data-testid="tweetText">UNRELATED COMMENT</div><a href="/other/status/125"><time>Today</time></a></article>
        </main>{metadata}<script>window.fullPrompt={json.dumps(FULL)};fetch('/i/api/graphql/fixture').then(r=>r.json());</script></body></html>'''
        with extension_session('x-quoted-original-', extension_dir=ext) as run:
            response = {'data': [{'rest_id': '123', 'legacy': {'extended_entities': {'media': []}}, 'quoted_status_result': {'result': {'rest_id': '100', 'legacy': {'extended_entities': {'media': [media]}}}}}]}
            run.context.route('https://x.com/**', lambda route: route.fulfill(json=response) if '/i/api/' in route.request.url else route.fulfill(body=html, content_type='text/html'))
            run.context.route('https://pbs.twimg.com/**', lambda route: route.fulfill(body=fixture_png(route.request.url), content_type='image/png'))
            run.context.route(CDN, lambda route: route.fulfill(body=BYTES, content_type='video/mp4'))
            collector = run.open_page('collector.html')
            run.seed_storage(collector, {'entries': [], 'dataSafetyOnboardingSeen': True})
            worker = run.context.service_workers[0]
            worker.evaluate("""body=>{const original=fetch;globalThis.fetch=(url,options)=>String(url)==='https://x.com/director/status/123'?Promise.resolve(new Response(body,{headers:{'content-type':'text/html'}})):original(url,options)}""", html)
            source = run.context.new_page()
            source.goto(WORK)
            source.bring_to_front()
            batch = collector.evaluate("async()=>{const r=await chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'});if(!r.ok)throw Error(r.message);return r.batch;}")
            c = batch['candidates'][0]
            video = next(m for m in c['media'] if m['kind'] == 'video')
            assert video['url'] == CDN and video['originalWorkUrl'] == QUOTE and video['isQuoted'], video
            supplement = collector.evaluate("async ({item,tabId})=>chrome.runtime.sendMessage({type:'READ_PAGE_CAPTURE_SUPPLEMENT',supplement:item,sourceTabId:tabId,sourceUrl:'https://x.com/director/status/123'})", {'item':c['supplements'][0], 'tabId':batch['tabId']})
            assert supplement['ok'] and supplement['supplement']['text'] == FULL, supplement
            # Replay the unresolved selected/persisted fragment through COMMIT,
            # which previously skipped the whole-page original resolver entirely.
            video['url'] = ''
            video['variants'] = []
            c['articleDocument']['blocks'] = [b for b in c['articleDocument']['blocks'] if b.get('assetId') != video['id']]
            batch = collector.evaluate("""async ({batch,item})=>{const {appendCaptureCandidate}=await import('./capture-additions.js');const c=batch.candidates[0];const selection={candidateId:c.id,includeText:true,selectedMediaIds:c.media.map(m=>m.id),mediaDecision:'confirmed'};const block={id:item.id,kind:'paragraph',text:item.text};const r=appendCaptureCandidate(c,{id:item.id,textBlocks:[block],articleDocument:{blocks:[{id:'source',kind:'link',sourceUrl:item.sourceUrl,label:'Author prompt'},block]}},selection);return {...batch,candidates:[r.candidate],selections:[r.selection]};}""", {'batch':batch,'item':supplement['supplement']})
            # Anonymous metadata can be rejected even while the signed-in page
            # has its normal media response. Save must use the real generated
            # document-start observer in a temporary page, leaving source intact.
            worker.evaluate("""()=>{
              const original=fetch;globalThis.fetch=(url,options)=>String(url)==='https://x.com/director/status/123'?Promise.resolve(new Response('',{status:403})):original(url,options);
              const create=chrome.tabs.create.bind(chrome.tabs);
              chrome.tabs.create=async options=>{const tab=await create({...options,url:'about:blank'});await new Promise(resolve=>globalThis.fixtureTabReady=resolve);return tab;};
            }""")
            with run.context.expect_page() as opened:
                collector.evaluate("batch=>{window.savePromise=chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch});}", batch)
            opened.value.goto(WORK)
            worker.evaluate('()=>globalThis.fixtureTabReady()')
            result = collector.evaluate('()=>window.savePromise')
            assert result['ok'] and not result['results'][0]['warnings'], result
            collector.reload()
            saved = collector.evaluate("""async()=>{const s=await chrome.runtime.sendMessage({type:'GET_STATE'}),e=s.entries[0],a=e.mediaAssets.find(a=>a.kind==='video');return {count:s.entries.length,text:e.text,assets:e.mediaAssets,size:(await(await import('./media-store.js')).getMediaBlob(a.id)).size};}""")
            assert saved['count'] == 1 and FULL in saved['text'] and 'UNRELATED COMMENT' not in saved['text'], saved
            assert saved['size'] == len(BYTES) and len([a for a in saved['assets'] if a['kind'] == 'image']) >= 4, saved
            assert all(a['storageMode'] == 'managed' for a in saved['assets']), saved
            assert source.url == WORK and opened.value.is_closed()
            print('PASS: metadata HTTP403 recovered through normal responses in a closed temporary tab; quoted source ownership; current JSON response; author full prompt; unresolved selected fragment resolves at save; four images and original video survive reload in one case')


if __name__ == '__main__':
    main()
