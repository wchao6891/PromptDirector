"""Isolated case operations and actual card drag payloads; no model or real-library writes."""
import json
import tempfile
from pathlib import Path
from e2e_support import EXTENSION_DIR, extension_session


def main():
    with tempfile.TemporaryDirectory(prefix='pd-coverage-code-') as tmp:
        ext = Path(tmp)
        for path in EXTENSION_DIR.iterdir():
            if path.name != 'background.js':
                (ext / path.name).symlink_to(path, target_is_directory=path.is_dir())
        (ext / 'background.js').write_text((EXTENSION_DIR / 'background.js').read_text() + '\nglobalThis.agentTestDispatch=dispatchAgentOperation;\n')
        with extension_session('pd-coverage-profile-', extension_dir=ext) as run:
            page = run.open_page('library.html')
            run.seed_storage(page, {'entries': [
                {'id': 'pictures', 'title': '同名参考', 'text': '图片原文', 'savedAt': '2026-10-01T00:00:00Z', 'primaryMediaId': 'image',
                 'mediaAssets': [{'id': 'image', 'kind': 'image', 'storageMode': 'managed', 'mimeType': 'image/png', 'sourceTitle': '原图.png'},
                                 {'id': 'second', 'kind': 'image', 'storageMode': 'managed', 'mimeType': 'image/png', 'sourceTitle': '图二.png'}],
                 'mediaPrompts': [{'assetId': 'image', 'source': 'manual', 'text': '逐图原始提示词'}]},
                {'id': 'video', 'title': '同名参考', 'text': '视频原文', 'savedAt': '2026-10-01T00:00:00Z', 'primaryMediaId': 'clip',
                 'mediaAssets': [{'id': 'clip', 'kind': 'video', 'storageMode': 'reference', 'mimeType': 'video/mp4',
                                  'sourceUrl': 'https://example.org/video.mp4', 'posterAssetId': 'poster', 'sourceTitle': '原视频.mp4'},
                                 {'id': 'poster', 'kind': 'image', 'usage': 'poster', 'derivedFromAssetId': 'clip',
                                  'storageMode': 'managed', 'mimeType': 'image/png'}]}],
                'organizerState': {'collections': [{'id': 'p', 'name': '图片项目', 'entryIds': ['pictures']},
                                                   {'id': 'q', 'name': '视频项目', 'entryIds': ['video']}]}})
            digest = page.evaluate('''async () => {
              const {saveMediaBlob}=await import('./media-store.js');
              const {sha256Blob}=await import('./blob-digest.js');
              const blob=await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==')).blob();
              for(const id of ['image','second','poster']) await saveMediaBlob(id,blob);
              return sha256Blob(blob);
            }''')
            worker = run.context.service_workers[0]
            def call(name, args):
                return worker.evaluate('''async ([name,input])=>{try{return await agentTestDispatch(name,input);}catch(e){return {error:e.message,code:e.code};}}''', [name, args])
            def read(case_id):
                return call('read_case_details', {'caseId': case_id})
            original = page.evaluate("async () => (await chrome.runtime.sendMessage({type:'GET_STATE'}))")
            first, second = read('pictures'), read('video')
            saved = call('edit_case', {'requestId': 'cover', 'caseId': 'video', 'expectedRevision': second['revision'], 'patch': {'coverVisualId': 'poster'}})
            assert saved['ok'], saved
            assert json.loads(read('video')['content'])['coverVisualId'] == 'poster'
            combine_input = {'requestId': 'cross-project-combine', 'caseId': 'pictures', 'expectedRevision': first['revision'],
                'action': 'combine_cases', 'title': '图片视频组合', 'coverVisualId': 'image',
                'additionalCases': [{'caseId': 'video', 'expectedRevision': read('video')['revision']}]}
            # Combining establishes a relation while each physical member keeps
            # its own project. No explicit or implicit move is needed.
            original = page.evaluate("async () => (await chrome.runtime.sendMessage({type:'GET_STATE'}))")
            combined = call('organize_case', {**combine_input, 'requestId': 'combine', 'expectedRevision': read('pictures')['revision'],
                'additionalCases': [{'caseId': 'video', 'expectedRevision': read('video')['revision']}]})
            assert combined['ok'], combined
            compound_id = combined['cases'][0]['caseId']
            assert json.loads(read(compound_id)['content'])['memberEntryIds'] == ['pictures', 'video']
            page.reload()
            card = page.locator(f'.case-card[data-entry-id="{compound_id}"]')
            card.wait_for()
            card.hover()
            page.wait_for_function("() => document.querySelector('.case-card .case-shot')?.src.startsWith('blob:')")
            # Exercise the rendered card's real handlers, not only the payload helper.
            def drag(selector):
                return page.locator(selector).first.evaluate('''node => {
                  const dataTransfer=new DataTransfer();
                  const event=new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer});
                  node.dispatchEvent(event);
                  return {cancelled:event.defaultPrevented,data:Object.fromEntries([...dataTransfer.types].map(t=>[t,dataTransfer.getData(t)]))};
                }''')
            payload = drag(f'.case-card[data-entry-id="{compound_id}"]')
            assert not payload['cancelled'], payload
            assert payload['data']['text/plain'].startswith('blob:'), payload
            assert '#pd-reference=' in payload['data']['text/html'], payload
            resolved = call('resolve_reference', {'reference': payload['data']['application/x-promptdirector-reference']})
            assert resolved['caseId'] == compound_id and resolved['assetId'] == '', resolved
            named_link = page.evaluate('''html => new DOMParser().parseFromString(html,'text/html').querySelector('a').href''', payload['data']['text/html'])
            assert call('resolve_reference', {'reference': named_link})['caseId'] == compound_id
            assert sorted(a['assetId'] for a in resolved['media']) == ['clip', 'image', 'poster', 'second'], resolved
            assert payload['data']['downloadurl'].startswith('image/png:原图.png:blob:'), payload
            card.click()
            page.locator('.detail-image').first.wait_for()
            media_payload = drag('.detail-image')
            assert media_payload['data']['text/plain'].startswith('blob:'), media_payload
            assert '>原图.png</a>' in media_payload['data']['text/html'], media_payload
            resolved_image = call('resolve_reference', {'reference': media_payload['data']['application/x-promptdirector-reference']})
            assert resolved_image['assetId'] == 'image'
            internal = page.evaluate('''async input => chrome.runtime.sendMessage({type:'CASE_OPERATION',operation:'organize_case',input})''',
                {'requestId': 'split', 'caseId': compound_id, 'expectedRevision': read(compound_id)['revision'], 'action': 'split_compound'})
            assert internal['ok'], internal
            page.reload()
            page.locator('.case-card[data-entry-id="video"]').wait_for()
            video_payload = drag('.case-card[data-entry-id="video"]')
            assert 'downloadurl' not in video_payload['data'], video_payload
            assert video_payload['data']['text/plain'].startswith('[同名参考](https://'), video_payload
            assert call('resolve_reference', {'reference': video_payload['data']['application/x-promptdirector-reference']})['caseId'] == 'video'
            after = page.evaluate("async () => (await chrome.runtime.sendMessage({type:'GET_STATE'}))")
            assert after['organizerState'] == original['organizerState'], (original['organizerState'], after['organizerState'])
            for old, new in zip(original['entries'], after['entries']):
                for field in ['text', 'mediaAssets', 'mediaPrompts']:
                    assert new.get(field) == old.get(field), field
            hashes = page.evaluate('''async () => {
              const {getMediaBlob}=await import('./media-store.js'); const {sha256Blob}=await import('./blob-digest.js');
              return Promise.all(['image','second','poster'].map(async id=>sha256Blob(await getMediaBlob(id))));
            }''')
            assert hashes == [digest] * 3, hashes
            assert 'combine_cases' in call('status', {})['caseOperationFeatures']['organize_case']
            print('PASS: actual extension cover/combine/split through external and internal endpoints, refresh persistence, original hashes/prompts/project relations preserved')
            print('PASS: rendered compound/image/video card drag data resolves exact identities; original image payload preserved; video does not export poster; native Codex drop remains separate acceptance')


if __name__ == '__main__':
    main()
