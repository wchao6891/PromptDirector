"""Shared operations against an isolated Chromium library, never the daily profile."""
import base64
import hashlib
import json
import tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import EXTENSION_DIR, extension_session


def main():
    with tempfile.TemporaryDirectory(prefix='pd-case-ops-code-') as tmp:
        ext = Path(tmp)
        for path in EXTENSION_DIR.iterdir():
            if path.name != 'background.js':
                (ext / path.name).symlink_to(path, target_is_directory=path.is_dir())
        (ext / 'background.js').write_text((EXTENSION_DIR / 'background.js').read_text() +
            '\n// Test-only transport boundary, absent from the production extension.\n' +
            'globalThis.agentTestDispatch = dispatchAgentOperation;\n')
        with extension_session('pd-case-ops-profile-', extension_dir=ext) as run:
            page = run.open_page('library.html')
            png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=')
            assets = [{'id': asset_id, 'kind': 'image', 'storageMode': 'managed', 'mimeType': 'image/png', 'name': asset_id + '.png',
                       'byteSize': len(png), 'originalWorkUrl': 'https://x.com/author/status/' + post}
                      for asset_id, post in [('first-image', '101'), ('second-image', '202')]]
            run.seed_storage(page, {'entries': [{'id': 'mixed', 'title': '原始案例', 'text': '人工编辑原文',
                'url': 'https://x.com/author/status/101/history', 'sourceFacts': {'provider': 'x', 'itemId': 'history'},
                'savedAt': '2026-09-01T00:00:00Z', 'mediaAssets': assets, 'primaryMediaId': assets[0]['id'],
                'mediaPrompts': [{'assetId': 'second-image', 'text': '逐图原词', 'source': 'manual'}]}]})
            page.evaluate('''async ({assets, bytes}) => {
              const {saveMediaBlob} = await import('./media-store.js');
              for (const asset of assets) await saveMediaBlob(asset.id, new Blob([new Uint8Array(bytes)], {type:'image/png'}));
            }''', {'assets': assets, 'bytes': list(png)})
            backup_before = page.evaluate("async () => Object.entries(await chrome.storage.local.get()).filter(([k]) => /backup/i.test(k))")
            worker = run.context.service_workers[0]
            def call(op, data):
                return worker.evaluate('([op, data]) => agentTestDispatch(op, data)', [op, data])
            def read(case_id, part='overview'):
                return call('read_case_details', {'caseId': case_id, 'part': part})
            combined = call('read_case_details', {'caseId': 'mixed', 'parts': ['overview', 'source', 'media', 'document', 'annotations']})
            assert combined['nextOffset'] is None
            combined_parts = json.loads(combined['content'])
            for part, value in combined_parts.items():
                single = read('mixed', part)
                assert single['revision'] == combined['revision']
                assert json.loads(single['content']) == value
            internal = page.evaluate("""async () => {
                const {withComposerCaseOperations}=await import('./composer-case-operations.js');
                const wrapper=withComposerCaseOperations({tools:{specs:[],instructions:''},
                    session:{messages:[{id:'u'}],referenceSnapshots:[{entryId:'mixed'}]},
                    invoke:(operation,input)=>chrome.runtime.sendMessage({type:'CASE_OPERATION',operation,input})});
                return wrapper.execute('read_case_details',{caseId:'mixed',parts:['source','media']},{ });
            }""")
            assert internal['data']['ok'],internal
            assert json.loads(internal['data']['content']) == {key:combined_parts[key] for key in ['source','media']}
            before = read('mixed')
            split = {'requestId': 'browser-split', 'caseId': 'mixed', 'expectedRevision': before['revision'], 'action': 'split_media',
                     'groups': [{'assetIds': ['second-image'], 'title': '第二作品', 'text': '核实后的第二帖', 'sourceUrl': 'https://x.com/author/status/202/history'}]}
            result = call('organize_case', split)
            new_id = result['cases'][1]['caseId']
            for item in result['cases']:
                assert read(item['caseId'])['revision'] == item['revision'], 'Receipt version must survive real readState normalization'
            assert call('organize_case', split)['replayed'] is True
            assert json.loads(read('mixed', 'document')['content'])['text'] == '人工编辑原文'
            assert json.loads(read(new_id, 'document')['content'])['text'] == '核实后的第二帖'
            assert json.loads(read(new_id, 'annotations')['content'])['mediaPrompts'][0]['text'] == '逐图原词'
            for case_id, asset_id in [('mixed', 'first-image'), (new_id, 'second-image')]:
                media = call('read_media', {'caseId': case_id, 'assetId': asset_id})
                assert base64.b64decode(media['data']) == png
                assert media['sha256'] == hashlib.sha256(png).hexdigest()
            # Real creative-workspace adapter invokes the exact same background service.
            revision = read('mixed')['revision']
            edited = page.evaluate('''async ({revision}) => {
              const {withComposerCaseOperations} = await import('./composer-case-operations.js');
              const wrapper = withComposerCaseOperations({tools:{specs:[],instructions:''},
                session:{messages:[{id:'u'}],referenceSnapshots:[{entryId:'mixed'}]},
                invoke:(operation,input)=>chrome.runtime.sendMessage({type:'CASE_OPERATION',operation,input})});
              return wrapper.execute('edit_case',{requestId:'workspace-edit',caseId:'mixed',expectedRevision:revision,
                sourceCorrection:{reason:'核对原作品来源',fields:['sourceUrl','sourceFacts']},
                patch:{title:'已核对原作品',sourceUrl:'https://x.com/author/status/101/history',sourceFacts:{itemId:'101'}}},{});
            }''', {'revision': revision})
            assert edited['data']['ok'], edited
            assert json.loads(read('mixed', 'source')['content'])['sourceFacts']['itemId'] == '101'
            assert edited['data']['cases'][0]['revision'] == read('mixed')['revision']
            page.reload()
            state = page.evaluate("async () => chrome.runtime.sendMessage({type:'GET_STATE'})")
            assert len(state['entries']) == 2
            assert next(e for e in state['entries'] if e['id'] == 'mixed')['title'] == '已核对原作品'
            assert page.evaluate("async () => Object.entries(await chrome.storage.local.get()).filter(([k]) => /backup/i.test(k))") == backup_before
            assert call('organize_case', split)['replayed'] is True
            print('PASS: actual background and creative-workspace operations, stable versions, source identity, original bytes, prompt association, persistent receipts, no new backups')

            # Lossless organization and the consumer readback, with real stored originals.
            base = page.evaluate("async () => chrome.runtime.sendMessage({type:'GET_STATE'})")
            group = next(n for n in base['facetCatalog']['nodes'] if n['kind'] == 'group')
            def assignment(asset_id):
                return {'facetId': group['facetId'], 'nodeId': group['id'], 'source': 'vision_model', 'status': 'confirmed', 'visualId': asset_id}
            for action in ['split_media', 'move_media']:
                for target_has_document in [False, True]:
                    caption = {'id': 'caption-block', 'kind': 'image', 'assetId': 'first-image', 'label': '人工图注必须保留',
                               'text': '随图保留的描述', 'sourceUrl': 'https://example.com/first-image', 'sourceOrder': 1}
                    source = {'id': 'source', 'title': '来源文章', 'text': '来源正文', 'schemaVersion': base['schemaVersion'],
                              'classification': {'pathIds': ['content:reference'], 'status': 'confirmed', 'source': 'manual'},
                              'sourceFacts': {'originalPromptAvailable': False}, 'mediaAssets': assets, 'primaryMediaId': 'first-image',
                              'facetAssignments': [assignment('first-image'), assignment('second-image')],
                              'articleDocument': {'version': 1, 'blocks': [{'id': 'source-body', 'kind': 'paragraph', 'text': '来源正文', 'sourceOrder': 0}, caption]}}
                    target = {'id': 'target', 'title': '目标文章', 'text': '目标正文', 'schemaVersion': base['schemaVersion'],
                              'classification': source['classification'], 'sourceFacts': {'originalPromptAvailable': False},
                              'mediaAssets': [{'id': 'target-image', 'kind': 'image', 'storageMode': 'managed', 'mimeType': 'image/png'}],
                              'facetAssignments': [assignment('target-image')]}
                    if target_has_document:
                        target['articleDocument'] = {'version': 1, 'blocks': [{'id': 'caption-block', 'kind': 'paragraph', 'text': '目标正文', 'sourceOrder': 0}]}
                    run.seed_storage(page, {'schemaVersion': base['schemaVersion'], 'taxonomy': base['taxonomy'], 'facetCatalog': base['facetCatalog'],
                                           'organizerState': base['organizerState'], 'entries': [source, target], 'compoundCases': []})
                    page.evaluate('''async bytes => {
                      const {saveMediaBlob} = await import('./media-store.js');
                      await saveMediaBlob('target-image', new Blob([new Uint8Array(bytes)], {type:'image/png'}));
                    }''', list(png))
                    args = {'requestId': 'continuity', 'caseId': 'source', 'expectedRevision': read('source')['revision'], 'action': action}
                    if action == 'split_media':
                        args['groups'] = [{'assetIds': ['first-image'], 'title': '独立作品', 'text': '作品正文',
                                          'sourceUrl': 'https://example.com/first-image', 'sourceFacts': {'originalPromptAvailable': False}}]
                    else:
                        args.update({'assetIds': ['first-image'], 'targetCaseId': 'target', 'targetRevision': read('target')['revision']})
                    result = call('organize_case', args)
                    assert result['ok'], result
                    receiver_id = result['cases'][1]['caseId']
                    page.reload()
                    document = json.loads(read(receiver_id, 'document')['content'])['articleDocument']
                    moved_block = next(b for b in document['blocks'] if b.get('assetId') == 'first-image')
                    for key in ['kind', 'assetId', 'label', 'text', 'sourceUrl']:
                        assert moved_block[key] == caption[key], (action, key, moved_block)
                    assert len({b['id'] for b in document['blocks']}) == len(document['blocks'])
                    receiver_tags = json.loads(read(receiver_id, 'annotations')['content'])['facetAssignments']
                    assert any(a.get('visualId') == 'first-image' for a in receiver_tags)
                    source_tags = json.loads(read('source', 'annotations')['content'])['facetAssignments']
                    assert not any(a.get('visualId') == 'first-image' for a in source_tags)
                    assert any(a.get('visualId') == 'second-image' for a in source_tags)
                    if action == 'move_media':
                        assert any(a.get('visualId') == 'target-image' for a in receiver_tags)
                        page.goto(f'chrome-extension://{run.extension_id}/library.html?case={receiver_id}')
                        expect(page.get_by_text('人工图注必须保留', exact=True)).to_be_visible()
                    original = call('read_media', {'caseId': receiver_id, 'assetId': 'first-image'})
                    assert base64.b64decode(original['data']) == png
                    assert original['sha256'] == hashlib.sha256(png).hexdigest()

                    # Ordinary body is reference prose; manual original wins over a webpage copy.
                    selection = page.evaluate('''async caseId => chrome.runtime.sendMessage({type:'SET_REFERENCE_SELECTION',input:{expectedRevision:0,caseIds:[caseId]}})''', receiver_id)
                    assert selection['ok'], selection
                    overview = call('read_workspace_context', {})
                    ref = next(r for r in overview['references'] if r['assetId'] == 'first-image')
                    content = call('read_workspace_content', {'part': 'reference', 'expectedRevision': overview['revision'], 'referenceId': ref['referenceId']})
                    assert json.loads(content['content'])['originalText'] == ''
                    assert ref['originalPromptCharacters'] == 0
                    edit = call('edit_case', {'requestId': 'original-edit', 'sourceCorrection': {'reason':'人工明确修正原词来源', 'fields':['mediaPrompts']}, 'caseId': receiver_id, 'expectedRevision': read(receiver_id)['revision'],
                        'patch': {'mediaPrompts': [{'assetId': 'first-image', 'source': 'manual', 'text': '人工修正词'}, {'assetId': 'first-image', 'source': 'webpage', 'text': '旧网页词'}]}})
                    assert edit['ok'], edit
                    overview = call('read_workspace_context', {})
                    ref = next(r for r in overview['references'] if r['assetId'] == 'first-image')
                    content = call('read_workspace_content', {'part': 'reference', 'expectedRevision': overview['revision'], 'referenceId': ref['referenceId']})
                    assert json.loads(content['content'])['originalText'] == '人工修正词'
                    internal = page.evaluate('''async caseId => {
                      const {createReferenceSnapshots}=await import('./composer.js');
                      const state=await chrome.runtime.sendMessage({type:'GET_STATE'});
                      return createReferenceSnapshots(state.entries,[{entryId:caseId,assetIds:['first-image']}],'zh-CN','image')[0].originalText;
                    }''', receiver_id)
                    assert internal == '人工修正词'
            print('PASS: split/move with/without target document, captions/sources and ID collisions, same-tag media ownership after reload, original bytes, internal/external original rules')

            # A real create/delete/undo/restore sequence, without a paid model request.
            created = page.evaluate('''async group => chrome.runtime.sendMessage({type:'CREATE_FACET_NODE',facetId:group.facetId,parentId:group.id,name:'回收站保护验证'})''', group)
            assert created['ok'], created
            new_node = next(n for n in created['facetCatalog']['nodes'] if n['name'] == '回收站保护验证')
            page.evaluate('''async ({caseId,group}) => {
              const {applyVisionAnalysis}=await import('./analysis-candidates.js');
              const {updateEntryVisual}=await import('./visuals.js');
              const state=await chrome.runtime.sendMessage({type:'GET_STATE'});
              const applied=applyVisionAnalysis(state,caseId,{reconstructionPrompt:'完整独立逆推',tags:[{g:group.id,t:'回收站保护验证'}]},{visualId:'first-image'});
              const entry=applied.state.entries.find(e=>e.id===caseId), analysis=entry.visionAnalysis;
              delete entry.visionAnalysis;
              applied.state.entries=applied.state.entries.map(e=>e.id===caseId?updateEntryVisual(entry,'first-image',a=>({...a,visionAnalysis:analysis})):e);
              await (await import('./library-storage.js')).getLibraryStorage().set({entries:applied.state.entries,facetCatalog:applied.state.facetCatalog});
            }''', {'caseId': receiver_id, 'group': group})
            deleted = page.evaluate('''async caseId => chrome.runtime.sendMessage({type:'DELETE_ENTRY_VISUAL',entryId:caseId,visualId:'first-image'})''', receiver_id)
            assert deleted['ok'], deleted
            undo = page.evaluate("async () => chrome.runtime.sendMessage({type:'UNDO_FACET_UPDATE'})")
            assert not undo['ok'] and '回收站' in undo['message'], undo
            restored = page.evaluate('''async itemIds => chrome.runtime.sendMessage({type:'RESTORE_TRASH_ITEMS',itemIds})''', deleted['movedItemIds'])
            assert restored['ok'], restored
            page.reload()
            current = page.evaluate("async () => chrome.runtime.sendMessage({type:'GET_STATE'})")
            assert any(n['id'] == new_node['id'] for n in current['facetCatalog']['nodes'])
            recovered = next(e for e in current['entries'] if e['id'] == receiver_id)
            assert any(a['nodeId'] == new_node['id'] and a.get('visualId') == 'first-image' for a in recovered['facetAssignments'])
            assert call('read_media', {'caseId': receiver_id, 'assetId': 'first-image'})['sha256'] == hashlib.sha256(png).hexdigest()
            print('PASS: actual tag create, stored analysis adoption, media deletion, catalog undo refusal, media restore and reload preserve tag identity and original')


if __name__ == '__main__':
    main()
