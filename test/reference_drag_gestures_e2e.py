"""Native mouse gestures in an isolated profile; never access the daily library."""
import base64
import json
import shutil
import tempfile
from contextlib import contextmanager
from pathlib import Path
from e2e_support import EXTENSION_DIR, extension_session

RECEIVER = 'https://pd-drag-receiver.test/'

@contextmanager
def receiver_extension():
    # Permit only this routed fixture in the copied test extension. Product
    # permissions and CSP remain unchanged; no request reaches a real website.
    with tempfile.TemporaryDirectory(prefix='pd-drop-fixture-') as folder:
        target = Path(folder) / 'extension'
        shutil.copytree(EXTENSION_DIR, target)
        manifest = json.loads((target / 'manifest.json').read_text())
        manifest['host_permissions'].append(RECEIVER + '*')
        (target / 'manifest.json').write_text(json.dumps(manifest))
        yield target


def main():
    with receiver_extension() as extension, extension_session('pd-reference-gestures-', extension_dir=extension) as run:
        page = run.open_page('library.html')
        page.on('console', lambda message: print(message.text) if message.text.startswith('PromptDirector original file drop:') else None)
        def entry(case_id, **fields):
            return {'id': case_id, 'title': f'{case_id}名称', 'text': '完整正文',
                    'savedAt': '2026-10-01T00:00:00Z', **fields}
        def image(asset_id):
            return {'id': asset_id, 'kind': 'image', 'storageMode': 'managed',
                    'mimeType': 'image/png', 'sourceTitle': f'{asset_id}.png'}
        run.seed_storage(page, {'entries': [
            entry('pictures', primaryMediaId='image', mediaAssets=[image('image'), image('second')]),
            entry('video', primaryMediaId='clip', mediaAssets=[
                {'id': 'clip', 'kind': 'video', 'storageMode': 'managed', 'mimeType': 'video/mp4',
                 'posterAssetId': 'poster', 'sourceTitle': 'original-video.mp4'},
                {**image('poster'), 'usage': 'poster', 'derivedFromAssetId': 'clip'}]),
            entry('article', url='https://example.org/article', articleDocument={'version': 1, 'blocks': [
                {'id': 'paragraph', 'kind': 'paragraph', 'text': '文章正文', 'sourceOrder': 0}]}),
            entry('document', primaryMediaId='doc', coverVisualId='document-cover', mediaAssets=[
                {'id': 'doc', 'kind': 'document', 'storageMode': 'managed',
                 'mimeType': 'text/markdown', 'sourceTitle': '文章.md'}, image('document-cover')]),
            entry('member-image', primaryMediaId='group-image', mediaAssets=[image('group-image')]),
            entry('member-text'),
        ], 'compoundCases': [{'id': 'compound', 'title': '组合名称',
            'memberEntryIds': ['member-image', 'member-text'], 'coverVisualId': 'group-image'}]})
        page.evaluate('''async () => {
          const {saveMediaBlob}=await import('./media-store.js');
          const blob=await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==')).blob();
          for(const id of ['image','second','poster','group-image','document-cover']) await saveMediaBlob(id,blob);
          await saveMediaBlob('doc',new Blob(['文章正文'.repeat(20000)],{type:'text/markdown'}));
        }''')
        page.evaluate('''async data => {
          const {saveMediaBlob}=await import('./media-store.js');
          await saveMediaBlob('clip',new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'video/mp4'}));
        }''', base64.b64encode((Path(__file__).parent / 'fixtures/detail-portrait-smoke.mp4').read_bytes()).decode())
        page.reload()
        page.locator('.case-card').first.wait_for()

        def native_drag(selector, expect_drop=True):
            page.evaluate('''() => {
              document.querySelector('#drag-test-drop')?.remove();
              const drop=document.createElement('div'); drop.id='drag-test-drop';
              drop.style.cssText='position:fixed;right:10px;bottom:10px;width:100px;height:60px;z-index:99999;background:white';
              drop.textContent='drop'; document.body.append(drop); window.dragTestResult=null;
              window.dragTestSource=null;
              if(window.dragTestObserve) window.removeEventListener('dragstart',window.dragTestObserve);
              window.dragTestObserve=e=>{window.dragTestSource=Object.fromEntries(
                [...e.dataTransfer.types].map(t=>[t,e.dataTransfer.getData(t)]));};
              window.addEventListener('dragstart',window.dragTestObserve);
              drop.addEventListener('dragover',e=>e.preventDefault());
              drop.addEventListener('drop',async e=>{e.preventDefault();
                const strings=Object.fromEntries([...e.dataTransfer.types].map(t=>[t,e.dataTransfer.getData(t)]));
                const files=Array.from(e.dataTransfer.files);
                window.dragTestResult={...strings,_files:await Promise.all(files.map(async file=>({
                  name:file.name,type:file.type,size:file.size,sha256:Array.from(new Uint8Array(
                    await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('')
                })))};
              });
            }''')
            node = page.locator(selector).first
            node.scroll_into_view_if_needed()
            node.hover()
            if node.locator('.case-shot').count():
                page.wait_for_function('''selector => {
                  const card=document.querySelector(selector);return card.querySelector('.case-shot')?.src.startsWith('blob:');
                }''', arg=selector)
            bounds = node.bounding_box()
            target = page.locator('#drag-test-drop').bounding_box()
            page.mouse.move(bounds['x'] + bounds['width'] / 2, bounds['y'] + min(35, bounds['height'] / 2))
            page.mouse.down()
            page.mouse.move(target['x'] + 50, target['y'] + 30, steps=20)
            page.mouse.up()
            if expect_drop: page.wait_for_function('window.dragTestResult !== null', timeout=3000)
            return page.evaluate('window.dragTestResult && ({...window.dragTestResult,_source:window.dragTestSource})')

        for view in ['waterfall', 'list']:
            page.locator(f'[data-gallery-view="{view}"]').click()
            for case_id in ['pictures', 'video', 'article', 'document', 'compound']:
                selector = f'.case-card[data-entry-id="{case_id}"]'
                payload = native_drag(selector)
                assert payload and 'application/x-promptdirector-reference' in payload, (view, case_id, payload)
                assert f'case={case_id}' in payload['application/x-promptdirector-reference'], payload
                link = page.evaluate('''value => new DOMParser().parseFromString(value,'text/html').querySelector('a').href''', payload['text/html'])
                identity = page.evaluate('''async link => (await import('./pd-reference.js')).parsePdReference(link)''', link)
                assert identity['caseId'] == case_id and identity['assetId'] == '', identity
                html = page.evaluate('''value => {
                  const doc=new DOMParser().parseFromString(value,'text/html');
                  const image=doc.querySelector('img');
                  const file={image:image?.src,hidden:image?.hidden};
                  for(const hidden of doc.querySelectorAll('[hidden], [aria-hidden="true"]')) hidden.remove();
                  return {href:doc.querySelector('a')?.href,images:doc.querySelectorAll('img').length,text:doc.body.textContent,file};
                }''', payload['text/html'])
                assert html['images'] == 0 and html['href'] == link, html
                assert html['text'] == ('组合名称' if case_id == 'compound' else f'{case_id}名称'), html
                if case_id == 'article': assert link.startswith('https://example.org/article#pd-reference='), link
                original_id = {'pictures':'image', 'video':'clip', 'document':'doc', 'compound':'group-image'}.get(case_id)
                if original_id:
                    assert payload['text/plain'] == payload['text/uri-list'] and payload['text/plain'].startswith('blob:'), payload
                    # Chrome converts DownloadURL into a native file promise;
                    # browser drop targets receive URI/HTML instead of that key.
                    download = payload['_source']['downloadurl']
                    assert download.endswith(':' + payload['text/uri-list']), payload
                    hashes = page.evaluate('''async ({id,url}) => {
                      const {getMediaBlob}=await import('./media-store.js');
                      const {sha256Blob}=await import('./blob-digest.js');
                      return [await sha256Blob(await getMediaBlob(id)),await sha256Blob(await (await fetch(url)).blob())];
                    }''', {'id':original_id,'url':payload['text/uri-list']})
                    assert hashes[0] == hashes[1], (case_id, hashes)
                    assert payload['_files'] == [], 'Agent rich text must retain its name link rather than become a file attachment'
                    if case_id in ['pictures','compound']:
                        assert html['file']['image'] == payload['text/uri-list'] and html['file']['hidden'], html
                    if case_id == 'video':
                        assert download.startswith('video/mp4:original-video.mp4:'), payload
                    if case_id == 'document':
                        assert download.startswith('text/markdown:文章.md:'), payload
                print(f'PASS: native {view} drag {case_id}: exact name identity and original file flavors verified')
        # A genuinely different web origin, using File-only dragover/drop rules
        # observed in the canvas receivers. The native drop must become a File
        # with original bytes before the receiver's normal upload handler runs.
        page.wait_for_function('''async () => (await chrome.scripting.getRegisteredContentScripts()).some(s=>s.id==='pd-original-file-drop')''')
        run.context.route(RECEIVER, lambda route: route.fulfill(content_type='text/html', body='''
          <html><body style="margin:0;height:100vh;background:#fff">File canvas
          <script>
          window.received=[]; window.originalDrops=0;
          document.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files')) e.preventDefault()});
          document.addEventListener('drop',async e=>{
            if(!e.dataTransfer.files.length){window.originalDrops++;return}
            e.preventDefault();const file=e.dataTransfer.files[0];
            const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
            window.received.push({name:file.name,type:file.type,size:file.size,sha256});
          });
          </script></body></html>'''))
        receiver = run.context.new_page()
        receiver.on('console', lambda message: print(message.text) if message.text.startswith('PromptDirector original file drop:') else None)
        receiver.goto(RECEIVER)
        # Replay the flavors actually observed at a native drop, using Chrome's
        # trusted drag dispatcher on the foreign top-level page. This covers the
        # origin/extension/receiver boundary separately from the ten gestures.
        target_cdp=run.context.new_cdp_session(receiver)
        for case_id, asset_id in [('pictures','image'),('video','clip'),('document','doc'),('compound','group-image')]:
            page.bring_to_front()
            count=receiver.evaluate('window.received.length')
            payload=native_drag(f'.case-card[data-entry-id="{case_id}"]')
            data={'items':[{'mimeType':key,'data':value} for key,value in payload.items() if not key.startswith('_')], 'dragOperationsMask':1}
            for action in ['dragEnter','dragOver','drop']:
                target_cdp.send('Input.dispatchDragEvent',{'type':action,'x':400,'y':300,'data':data})
            try:
                receiver.wait_for_function('count=>window.received.length>count',arg=count)
            except Exception:
                print('Canvas receive failure:',receiver.locator('body').inner_text(),receiver.evaluate('window.originalDrops'))
                raise
            result=receiver.evaluate('window.received.at(-1)')
            expected=page.evaluate('''async id=>{
              const {getMediaBlob}=await import('./media-store.js');const {sha256Blob}=await import('./blob-digest.js');
              const blob=await getMediaBlob(id);return {size:blob.size,sha256:await sha256Blob(blob)};
            }''',asset_id)
            assert result['sha256']==expected['sha256'] and result['size']==expected['size'],result
            assert receiver.evaluate('window.originalDrops')==0, 'Receiver must never get the original link drop or navigate away'
            assert receiver.url==RECEIVER
            print(f'PASS: foreign canvas receives {case_id} as original File: {result}')
        target_cdp.detach();receiver.close()
        # Cached cards must regain dragging when management/sweep selection ends.
        page.locator('#select-cases').click()
        assert page.locator('.case-card[draggable="true"]').count() == 0
        assert native_drag('.case-card[data-entry-id="pictures"]', expect_drop=False) is None, 'management sweep must not leak native image metadata'
        page.locator('#share-cancel').click()
        payload = native_drag('.case-card[data-entry-id="article"]')
        assert payload and 'case=article' in payload['application/x-promptdirector-reference'], payload
        print('PASS: management selection does not leak native media drags; exit restores whole-card dragging')


if __name__ == '__main__':
    main()
