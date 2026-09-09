"""Reduced fixtures based on LibTV's public feed and read-only workflow DOM."""
from __future__ import annotations
import json
import tempfile
from pathlib import Path
from e2e_support import EXTENSION_DIR, extension_session
from page_capture_e2e import PNG

SITE = 'https://www.liblib.tv'
CDN = 'https://libtv-res.liblib.art'


def main():
    records = [{"templateUuid": f"work-{i}", "name": f"Public work {i}", "description": "Public description, not a prompt",
                "finalOutput": f"{CDN}/video-{i}.mp4", "coverUrl": f"{CDN}/cover.png", "nickname": "Fixture creator"} for i in range(2)]
    frame = json.dumps([1, '70:' + json.dumps({"items": records})])
    html = f'<html><head><title>LibTV public fixture</title></head><body><main>{"".join(f"<img alt=\"{r['name']}\" src=\"{r['coverUrl']}\">" for r in records)}</main><script>self.__next_f=[]</script><script>self.__next_f.push({frame})</script></body></html>'
    with tempfile.TemporaryDirectory(prefix='libtv-extension-') as temp:
        extension = Path(temp)
        for file in EXTENSION_DIR.iterdir():
            if file.name not in {'manifest.json', '.git', 'node_modules', 'dist'}:
                (extension / file.name).symlink_to(file, target_is_directory=file.is_dir())
        manifest = json.loads((EXTENSION_DIR / 'manifest.json').read_text())
        manifest['host_permissions'] += [f'{SITE}/*', f'{CDN}/*']
        (extension / 'manifest.json').write_text(json.dumps(manifest))
        with extension_session('libtv-public-capture-', extension_dir=extension) as run:
            video = (Path(__file__).parent / 'fixtures/zhipu-local-video-smoke.mp4').read_bytes()
            run.context.route(f'{SITE}/**', lambda route: route.fulfill(status=200, body=html, content_type='text/html'))
            run.context.route(f'{CDN}/**', lambda route: route.fulfill(status=200,
                body=video if '.mp4' in route.request.url else PNG, content_type='video/mp4' if '.mp4' in route.request.url else 'image/png'))
            collector = run.open_page('collector.html')
            run.seed_storage(collector, {'entries': []})
            source = run.context.new_page()
            source.goto(SITE)
            source.bring_to_front()
            def capture():
                return collector.evaluate('''async () => {
                  const {pageCaptureDefaultMediaIds}=await import('./page-capture.js');
                  const response=await chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'});
                  if (!response.ok) throw new Error(response.message);
                  const batch=response.batch;
                  batch.selections=batch.candidates.map(c=>({candidateId:c.id,includeText:true,selectedMediaIds:pageCaptureDefaultMediaIds(c),mediaDecision:'confirmed'}));
                  return batch;
                }''')
            batch = capture()
            assert len(batch['candidates']) == 2, batch
            saved = collector.evaluate("async batch=>chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch})", batch)
            assert saved['ok'] and all(r['status'] == 'saved' for r in saved['results']), saved
            entries = collector.evaluate("async ()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
            assert len(entries) == 2, 'Different public works on one feed URL must remain separate'
            assert all(not e['text'] and e['sourceFacts']['description'] == 'Public description, not a prompt' for e in entries)
            assert all(e['classification']['pathIds'] == ['content:video-case'] for e in entries), entries
            assert all(any(a['kind'] == 'video' and a['storageMode'] == 'managed' for a in e['mediaAssets']) for e in entries)
            assert all(next(a for a in e['mediaAssets'] if a['kind']=='video')['sourceUrl'].startswith(CDN+'/video-') for e in entries), entries
            repeated = collector.evaluate("async batch=>chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch})", batch)
            assert all(r['status'] == 'duplicate' for r in repeated['results']), repeated
            source.evaluate('''cdn => {
              document.body.insertAdjacentHTML('beforeend', `<div role="dialog">Public process\n只读模式
                <div class="react-flow__node react-flow__node-video" data-id="v-one"><div data-nodeid="v-one"><div>Video node</div><img src="${cdn}/video.mp4?x-oss-process=video/snapshot,t_0,f_jpg,w_400"></div><textarea>Original node prompt</textarea></div>
                <div class="react-flow__node react-flow__node-image" data-id="i-one"><div data-nodeid="i-one"><div>Image node</div><img src="${cdn}/original.png?x-oss-process=image/resize,w_400/format,webp"></div></div></div>`);
            }''', CDN)
            source.bring_to_front()
            workflow = capture()
            assert len(workflow['candidates']) == 2, workflow
            assert workflow['candidates'][0]['contentText'] == 'Original node prompt'
            assert workflow['candidates'][0]['media'][0]['url'] == f'{CDN}/video.mp4'
            assert workflow['candidates'][1]['media'][0]['url'] == f'{CDN}/original.png'
            # A failed video download keeps a real source poster and a visible failure.
            run.context.route(f'{CDN}/video.mp4', lambda route: route.fulfill(status=503, body='Unavailable'))
            workflow['candidates'] = workflow['candidates'][:1]
            workflow['candidates'][0]['media'][0]['posterUrl'] = f'{CDN}/cover.png'
            workflow['selections'] = workflow['selections'][:1]
            partial = collector.evaluate("async batch=>chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch})", workflow)
            assert partial['ok'] and partial['results'][0]['status'] == 'partial', partial
            assert any('HTTP 503' in w for w in partial['results'][0]['warnings']), partial
            failed_entry = collector.evaluate("async id=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).entries.find(e=>e.id===id)", partial['results'][0]['entryId'])
            reference = next(a for a in failed_entry['mediaAssets'] if a['kind'] == 'video')
            assert reference['storageMode'] == 'reference' and reference.get('posterAssetId'), failed_entry
            assert any(a['id'] == reference['posterAssetId'] and a['storageMode'] == 'managed' for a in failed_entry['mediaAssets'])
            print({'publicWorks': 2, 'originalVideoSaved': True, 'descriptionNotPrompt': True, 'repeatNotDuplicated': True, 'publicWorkflowNodes': 2})


if __name__ == '__main__':
    main()
