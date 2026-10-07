"""Real extension dispatch for unsaved-text search and recoverable Agent removal.

Uses a temporary transport hook and isolated profile; no native host acceptance or paid AI calls.
"""
import base64
import hashlib
import json
import tempfile
from pathlib import Path
from e2e_support import EXTENSION_DIR, extension_session


def main():
    with tempfile.TemporaryDirectory(prefix='pd-agent-common-code-') as tmp:
        ext = Path(tmp)
        for path in EXTENSION_DIR.iterdir():
            if path.name != 'background.js':
                (ext / path.name).symlink_to(path, target_is_directory=path.is_dir())
        (ext / 'background.js').write_text((EXTENSION_DIR / 'background.js').read_text() +
            '\n// Test-only transport boundary, absent from the product.\n'
            'globalThis.agentTestDispatch = dispatchAgentOperation;\n')
        with extension_session('pd-agent-common-profile-', extension_dir=ext) as run:
            page = run.open_page('collector.html')
            png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jW6kAAAAASUVORK5CYII=')
            entries = []
            for case_id, text, kind in [('a', 'aerial orbit palace', 'image'), ('b', 'garden flower painting', 'image'),
                                        ('missing', '', 'image'), ('video', 'aerial orbit palace', 'video')]:
                asset_id = 'original-' + case_id
                entries.append({'id': case_id, 'title': case_id, 'text': text,
                    'sourceFacts': {'originalPromptAvailable': bool(text)},
                    'mediaAssets': [{'id': asset_id, 'kind': kind, 'storageMode': 'managed',
                                     'mimeType': 'image/png' if kind == 'image' else 'video/mp4', 'byteSize': len(png)}],
                    'primaryMediaId': asset_id, 'customLabels': ['人工标签'],
                    'mediaPrompts': [{'assetId': asset_id, 'source': 'manual', 'text': text}] if text else []})
            run.seed_storage(page, {'entries': entries, 'organizerState': {'version': 1, 'collections': [
                {'id': 'project', 'name': '恢复原项目', 'entryIds': [entry['id'] for entry in entries]}]},
                'dataSafetyOnboardingSeen': True, 'uiPreferences': {'locale': 'zh-CN', 'motion': 'reduced'}})
            page.evaluate('''async bytes => {
              const {saveMediaBlob}=await import('./media-store.js');
              for(const id of ['a','b','missing']) await saveMediaBlob('original-'+id,new Blob([new Uint8Array(bytes)],{type:'image/png'}));
            }''', list(png))
            worker = run.context.service_workers[0]

            def call(operation, payload):
                return worker.evaluate('([op,input])=>agentTestDispatch(op,input)', [operation, payload])

            def failure(operation, payload):
                return worker.evaluate('''async ([op,input])=>{try {await agentTestDispatch(op,input);return null;}
                    catch(error){return {code:error.code,message:error.message};}}''', [operation, payload])

            def read(case_id, parts=None):
                return call('read_case_details', {'caseId': case_id, **({'parts': parts, 'length': 49152} if parts else {})})

            def stored_entries():
                return page.evaluate("async()=> (await (await import('./library-storage.js')).getLibraryStorage().get('entries')).entries")

            status = call('status', {})
            assert {'trash_case', 'capture_workspace'}.issubset(status['capabilities']), status
            assert 'similarText' in status['searchFilters'], status
            assert not {'start_case_analysis', 'read_case_analysis', 'cancel_case_analysis'}.intersection(status['capabilities'])
            before = stored_entries()
            scope = {'similarText': 'aerial orbit palace', 'mediaKind': 'image'}
            results = call('search', scope)
            assert [item['caseId'] for item in results['cases']] == ['a', 'b'], results
            assert results['similarityCoverage']['referenceType'] == 'provided_text'
            assert results['similarityCoverage']['comparedCases'] == 2
            assert results['similarityCoverage']['unknownExcluded'] == 1
            assert results['similarityCoverage']['differentDomainCases'] == 1
            query = {**scope, 'query': 'palace', 'where': {'field': 'similarity.score', 'op': 'gt', 'value': 0}}
            assert [item['caseId'] for item in call('search', query)['cases']] == ['a']
            assert failure('search', {**scope, 'similarTo': {'caseId': 'a'}})['code'] == 'invalid_case_query'
            assert stored_entries() == before, 'unsaved references must never be persisted as cases'
            internal = page.evaluate('''async input=>{
              const {createComposerLibraryTools}=await import('./composer-library-tools.js');
              const {createComposerSession}=await import('./composer.js');
              const {buildSearchIndex}=await import('./search-index.js');
              const state=await chrome.runtime.sendMessage({type:'GET_STATE'});
              const tool=createComposerLibraryTools({session:createComposerSession({messages:[{id:'u',role:'user',content:'找相似'}]}),
                vision:false,maxCharacters:1000000,loadLibrary:async()=>({...state,searchIndex:buildSearchIndex(state.entries,state.facetCatalog)})});
              return tool.execute('search_cases',input,{callId:'similar'});
            }''', query)
            assert [item['caseId'] for item in internal['data']['candidates']] == ['a'], internal
            print('PASS: real search and internal workspace share unsaved full-text similarity, exact filters, missing evidence and no case writes', flush=True)

            combined = call('organize_case', {'requestId': 'common-combine', 'caseId': 'a', 'expectedRevision': read('a')['revision'],
                'action': 'combine_cases', 'title': '原件完整组合', 'additionalCases': [{'caseId': 'b', 'expectedRevision': read('b')['revision']}]})
            group_id = next(item['caseId'] for item in combined['cases'] if item['caseId'] not in ['a', 'b'])
            stale = {'requestId': 'common-stale', 'caseId': group_id, 'expectedRevision': read(group_id)['revision']}
            call('edit_case', {'requestId': 'common-later-edit', 'caseId': 'a', 'expectedRevision': read('a')['revision'], 'patch': {'title': '保留后来的修改'}})
            assert failure('trash_case', stale)['code'] == 'case_conflict'
            assert len(stored_entries()) == 4
            parts = ['document', 'media', 'annotations', 'organization']
            originals = {case_id: json.loads(read(case_id, parts)['content']) for case_id in ['a', 'b']}
            group_before = json.loads(read(group_id)['content'])
            request = {'requestId': 'common-trash', 'caseId': group_id, 'expectedRevision': read(group_id)['revision']}
            removed = call('trash_case', request)
            assert removed['restorable'] and set(removed['movedEntryIds']) == {'a', 'b'}, removed
            assert set(entry['id'] for entry in stored_entries()) == {'missing', 'video'}
            restored = page.evaluate("itemIds=>chrome.runtime.sendMessage({type:'RESTORE_TRASH_ITEMS',itemIds})", removed['movedItemIds'])
            assert restored['ok'], restored
            for case_id, original in originals.items():
                recovered = json.loads(read(case_id, parts)['content'])
                # Existing restore marks the compound relationship as updated; every other
                # field (including its original creation time) must remain byte-for-byte equal.
                before_groups = original['organization']['compounds']
                after_groups = recovered['organization']['compounds']
                assert len(after_groups) == len(before_groups)
                for after_group, before_group in zip(after_groups, before_groups):
                    assert after_group['updatedAt'] >= before_group['updatedAt']
                    after_group['updatedAt'] = before_group['updatedAt']
                assert recovered == original, {'caseId': case_id, 'before': original, 'after': recovered}
                media = call('read_media', {'caseId': group_id, 'assetId': 'original-' + case_id})
                assert base64.b64decode(media['data']) == png
                assert media['sha256'] == hashlib.sha256(png).hexdigest()
            group_after = json.loads(read(group_id)['content'])
            assert group_after['updatedAt'] >= group_before['updatedAt']
            group_after['updatedAt'] = group_before['updatedAt']
            assert group_after == group_before
            assert call('trash_case', request)['replayed'] is True
            assert len(stored_entries()) == 4, 'replayed deletion must not delete cases restored after the original request'
            print('PASS: stale compound deletion rejected; recoverable group deletion/restoration retains exact original PNG bytes, text, annotations and relationships; replay does not delete restored cases', flush=True)

            member_revision = read('b')['revision']
            internal_trash = page.evaluate('''async expectedRevision=>{
              const {withComposerCaseOperations}=await import('./composer-case-operations.js');
              const tool=withComposerCaseOperations({tools:{specs:[],instructions:''},
                session:{messages:[{id:'u'}],referenceSnapshots:[{entryId:'b'}]},
                invoke:(operation,input)=>chrome.runtime.sendMessage({type:'CASE_OPERATION',operation,input})});
              return tool.execute('trash_case',{requestId:'common-composer-trash',caseId:'b',expectedRevision},{callId:'trash'});
            }''', member_revision)
            assert internal_trash['data']['ok'], internal_trash
            assert internal_trash['data']['movedEntryIds'] == ['b']
            assert set(entry['id'] for entry in stored_entries()) == {'a', 'missing', 'video'}
            restored = page.evaluate("itemIds=>chrome.runtime.sendMessage({type:'RESTORE_TRASH_ITEMS',itemIds})", internal_trash['data']['movedItemIds'])
            assert restored['ok'], restored
            assert base64.b64decode(call('read_media', {'caseId': group_id, 'assetId': 'original-b'})['data']) == png
            assert not run.page_errors, run.page_errors
            print('PASS: composer uses the same recoverable trash service; status exposes screenshot/trash/search and no new paid analysis tools', flush=True)


if __name__ == '__main__':
    main()
