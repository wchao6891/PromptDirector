"""External batch results through the actual extension; isolated profile, no model calls."""
import json
import tempfile
from pathlib import Path
from e2e_support import EXTENSION_DIR, extension_session


def main():
    with tempfile.TemporaryDirectory(prefix='pd-batch-code-') as tmp:
        ext = Path(tmp)
        for path in EXTENSION_DIR.iterdir():
            if path.name != 'background.js':
                (ext / path.name).symlink_to(path, target_is_directory=path.is_dir())
        (ext / 'background.js').write_text((EXTENSION_DIR / 'background.js').read_text() + '\nglobalThis.agentTestDispatch=dispatchAgentOperation;\n')
        with extension_session('pd-batch-profile-', extension_dir=ext) as run:
            page = run.open_page('library.html')
            run.seed_storage(page, {'entries': [{'id': 'first', 'title': '案例一', 'text': '人工正文', 'savedAt': '2026-10-01T00:00:00Z',
                'mediaAssets': [{'id': 'picture', 'kind': 'image', 'storageMode': 'managed', 'mimeType': 'image/png'}],
                'primaryMediaId': 'picture', 'mediaPrompts': [{'assetId': 'picture', 'source': 'manual', 'text': '原始提示词'}]},
                {'id': 'second', 'title': '案例二', 'text': '保留正文', 'savedAt': '2026-10-01T00:00:00Z'}]})
            digest = page.evaluate('''async () => {
              const {saveMediaBlob}=await import('./media-store.js');
              const {sha256Blob}=await import('./blob-digest.js');
              const blob=new Blob(['original fixture'],{type:'image/png'});
              await saveMediaBlob('picture',blob);return sha256Blob(blob);
            }''')
            delivered = page.evaluate('''async () => {
              const {createLocalComposerLibraryTools}=await import('./composer-library-host.js');
              const {createComposerSession}=await import('./composer.js');
              const session=createComposerSession({messages:[{id:'u',role:'user',content:'使用案例一的图片'}]});
              const tools=createLocalComposerLibraryTools({session,vision:true});
              return tools.execute('use_case_images',{caseId:'first',imageIds:['picture']},{callId:'image'});
            }''')
            assert delivered['data']['media'][0]['sha256'] == digest, delivered
            assert len(delivered['images']) == 1
            worker = run.context.service_workers[0]
            def call(name, args):
                return worker.evaluate('''async ([name,input])=>{try{return await agentTestDispatch(name,input);}catch(e){return {error:e.message,code:e.code};}}''', [name, args])
            def read():
                return call('read_analysis_batch', {'batchId': 'browser-batch'})
            def control(action, request, **more):
                return call('manage_analysis_batch', {'action': action, 'requestId': request, 'batchId': 'browser-batch', 'expectedRevision': read()['revision'], **({'epoch': read()['epoch']} if action == 'cancel' else {}), **more})
            first = call('read_case_details', {'caseId': 'first'})
            second = call('read_case_details', {'caseId': 'second'})
            created = call('manage_analysis_batch', {'action': 'create', 'requestId': 'browser-batch', 'instruction': '批量提炼已选资料', 'items': [
                {'caseId': 'first', 'expectedRevision': first['revision'], 'assets': [{'assetId': 'picture', 'sha256': digest, 'coverage': '隔离测试原件，无真实模型分析'}]},
                {'caseId': 'second', 'expectedRevision': second['revision'], 'assets': []}]})
            assert created['ok'], created
            assert control('seal', 'seal')['ok']
            rows = read()['items']
            submit = {'batchId': 'browser-batch', 'requestId': 'save-first', 'caseId': 'first', 'attemptId': rows[0]['attemptId'], 'epoch': 0,
                      'model': 'isolated-fixture', 'result': {'mediaPrompts': [{'assetId': 'picture', 'text': 'AI逆推测试'}], 'tags': [{'g': 'scene.place', 't': '摄影棚'}]}}
            saved = call('submit_analysis_result', submit)
            assert saved['item']['state'] == 'saved', saved
            assert call('submit_analysis_result', submit)['replayed']
            internal = page.evaluate('''async () => chrome.runtime.sendMessage({type:'CASE_OPERATION',operation:'read_analysis_batch',input:{batchId:'browser-batch'}})''')
            assert internal == read(), internal
            after = call('read_case_details', {'caseId': 'first', 'part': 'annotations'})
            assert after['revision'] == saved['item']['savedRevision'], (after, saved)
            annotations = json.loads(after['content'])
            assert any(p['source'] == 'manual' and p['text'] == '原始提示词' for p in annotations['mediaPrompts'])
            assert any(p['source'] == 'ai-suggestion' and p['text'] == 'AI逆推测试' for p in annotations['mediaPrompts'])
            assert annotations['facetAssignments'][0]['visualId'] == 'picture'
            edited = call('edit_case', {'caseId': 'second', 'expectedRevision': second['revision'], 'requestId': 'human-edit', 'patch': {'text': '人工后来改过'}})
            assert edited['ok'], edited
            stale = call('submit_analysis_result', {'batchId': 'browser-batch', 'requestId': 'stale', 'caseId': 'second', 'epoch': 0,
                'attemptId': rows[1]['attemptId'], 'result': {'tags': [{'g': 'scene.weather'}]}})
            assert stale['item']['error']['code'] == 'case_conflict', stale
            assert stale['status'] == 'partial'
            assert control('cancel', 'cancel')['status'] == 'canceled'
            assert control('resume', 'resume')['epoch'] == 1
            new_input = {'caseId': 'second', 'expectedRevision': edited['cases'][0]['revision'], 'assets': []}
            retried = control('retry', 'retry', items=[new_input])
            assert retried['item']['attemptId'] != rows[1]['attemptId']
            result = call('submit_analysis_result', {'batchId': 'browser-batch', 'requestId': 'save-second', 'caseId': 'second', 'epoch': 1,
                'attemptId': retried['item']['attemptId'], 'result': {'tags': [{'g': 'scene.weather'}]}})
            assert result['status'] == 'completed', result
            page.reload()
            assert read()['saved'] == 2 and read()['failed'] == 0
            found = call('list_analysis_batches', {'query': '批量提炼', 'status': 'completed'})
            assert found['total'] == 1 and found['batches'][0]['id'] == 'browser-batch', found
            discovered = page.evaluate("async () => chrome.runtime.sendMessage({type:'CASE_OPERATION',operation:'list_analysis_batches',input:{}})")
            assert discovered['total'] == 1, discovered
            document = json.loads(call('read_case_details', {'caseId': 'second', 'part': 'document'})['content'])
            assert document['text'] == '人工后来改过'
            detail = json.loads(call('read_analysis_batch', {'batchId': 'browser-batch', 'part': 'result', 'caseId': 'second'})['content'])
            assert detail['previousAttempts'][0]['error']['code'] == 'case_conflict'
            page_items = [{'caseId': case_id, 'expectedRevision': call('read_case_details', {'caseId': case_id})['revision'], 'assets': []}
                          for case_id in ['first', 'second']]
            assert call('manage_analysis_batch', {'action': 'create', 'requestId': 'page-batch', 'instruction': '合并结果测试', 'items': page_items})['ok']
            page_rows = call('read_analysis_batch', {'batchId': 'page-batch'})['items']
            assert call('edit_case', {'caseId': 'second', 'expectedRevision': page_items[1]['expectedRevision'], 'requestId': 'page-human-edit', 'patch': {'text': '合并提交前人工新改'}})['ok']
            page_submit = {'requestId': 'save-page', 'batchId': 'page-batch', 'epoch': 0, 'items': [
                {'caseId': row['caseId'], 'attemptId': row['attemptId'], 'result': {'tags': [{'g': 'scene.weather', 't': '晴天'}]}} for row in page_rows]}
            page_saved = call('submit_analysis_results', page_submit)
            assert [item['state'] for item in page_saved['items']] == ['saved', 'failed'], page_saved
            assert page_saved['items'][1]['error']['code'] == 'case_conflict'
            assert call('submit_analysis_results', page_submit)['replayed']
            page.reload()
            assert call('read_analysis_batch', {'batchId': 'page-batch'})['saved'] == 1
            assert json.loads(call('read_case_details', {'caseId': 'second', 'part': 'document'})['content'])['text'] == '合并提交前人工新改'
            assert page_saved['items'][0]['savedRevision'] == call('read_case_details', {'caseId': 'first'})['revision']
            print('PASS: task discovery after reload and shared internal endpoint; merged page partial save, conflict preservation, receipt replay and persisted revision readback')
            print('PASS: isolated real extension batch register/write/readback, shared internal endpoint, native normalization revisions, original/manual preservation, conflict/partial/retry/cancel/resume, durable reload and failed-attempt evidence; no real library or model calls')


if __name__ == '__main__':
    main()
