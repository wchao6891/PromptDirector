"""Shared search semantics against an isolated browser, including concurrent edits."""
import json
import tempfile
from pathlib import Path
from e2e_support import EXTENSION_DIR, extension_session


def main():
    with tempfile.TemporaryDirectory(prefix='pd-search-code-') as tmp:
        ext = Path(tmp)
        for path in EXTENSION_DIR.iterdir():
            if path.name != 'background.js':
                (ext / path.name).symlink_to(path, target_is_directory=path.is_dir())
        (ext / 'background.js').write_text((EXTENSION_DIR / 'background.js').read_text() +
            '\n// Isolated test transport.\nglobalThis.agentTestDispatch=dispatchAgentOperation;\n')
        with extension_session('pd-search-profile-', extension_dir=ext) as run:
            page = run.open_page('library.html')
            entries = [{'id': 'case-' + str(i), 'title': '动作片段 ' + str(i), 'text': '搜索正文',
                        'savedAt': '2026-09-27T00:00:00Z', 'primaryMediaId': 'video-' + str(i),
                        'sourceFacts': {'provider': 'x', 'handle': 'Other' if i == 2 else 'Arvin', 'engagement': {'likes': i * 10}, 'engagementObservedAt': '2026-10-03T00:00:00Z'},
                        'mediaAssets': [{'id': 'video-' + str(i), 'kind': 'video', 'mimeType': 'video/mp4',
                                         'storageMode': 'reference', 'sourceUrl': 'https://example.org/video.mp4',
                                         **({'durationMs': i * 1000} if i else {})}]}
                       for i in range(4)]
            run.seed_storage(page, {'entries': entries})
            worker = run.context.service_workers[0]

            def call(op, args):
                return worker.evaluate('''async ([op,input])=>{
                  try {return await agentTestDispatch(op,input);}
                  catch(e){return {error:e.message,code:e.code};}
                }''', [op, args])

            filters = {'query': '动作', 'mediaKind': 'video', 'minDurationMs': 1000, 'maxDurationMs': 3000}
            worker.evaluate('''() => {
              globalThis.searchStorageReads = [];
              const get = chrome.storage.local.get.bind(chrome.storage.local);
              chrome.storage.local.get = async keys => {
                searchStorageReads.push({keys, caseRead: new Error().stack.includes('/case-library-state.js')});
                return get(keys);
              };
            }''')
            first = call('search', {**filters, 'limit': 1})
            reads = worker.evaluate('searchStorageReads')
            # Background sync and UI refresh may read their own state concurrently.
            # Attribute reads to the case reader rather than asserting global silence.
            case_reads = [read['keys'] for read in reads if read['caseRead']]
            assert case_reads and not any(isinstance(keys, list) and 'composerSessions' in keys for keys in case_reads), reads
            assert first['total'] == 3 and first['durationCoverage']['unknownDurationMedia'] == 1, first
            assert 'projects' not in first
            assert 'projects' not in call('search', {'countOnly': True})
            popularity = {'query': '', 'provider': 'x', 'authorHandle': '@ARVIN', 'sort': 'engagement', 'engagementMetric': 'likes'}
            ranked = call('search', popularity)
            assert [c['caseId'] for c in ranked['cases']] == ['case-3', 'case-1', 'case-0'], ranked
            assert ranked['cases'][0]['sources'][0]['engagement']['likes'] == 30
            assert ranked['cases'][0]['sources'][0]['engagementObservedAt'] == '2026-10-03T00:00:00Z'
            assert call('status', {})['caseTextReadVersion'] == 2
            assert call('status', {})['caseQueryVersion'] == 1
            help_result = call('describe_case_query', {})
            assert help_result['engagementMetrics'] == ['likes'], help_result
            structured = {'provider': 'x', 'where': {'scope': 'media', 'where': {'all': [
                {'field': 'media.kind', 'op': 'eq', 'value': 'video'},
                {'field': 'media.durationMs', 'op': 'gte', 'value': 1000}]}},
                'select': ['title', 'mediaCount'], 'orderBy': [{'field': 'source.engagement.likes', 'direction': 'desc', 'reduce': 'max'}],
                'aggregates': [{'name': 'total', 'op': 'count'}], 'limit': 1}
            structured_result = call('search', structured)
            assert [row['caseId'] for row in structured_result['cases']] == ['case-3'], structured_result
            assert structured_result['aggregates']['total']['value'] == 3
            structured_internal = page.evaluate('''async input=>{
              const {createLocalComposerLibraryTools}=await import('./composer-library-host.js');
              const {createComposerSession}=await import('./composer.js');
              const tools=createLocalComposerLibraryTools({session:createComposerSession({messages:[{id:'u',role:'user',content:'查找'}]}),vision:false});
              return (await tools.execute('search_cases',input,{callId:'structured'})).data;
            }''', structured)
            assert structured_internal['revision'] == structured_result['revision'], [structured_internal, structured_result]
            assert structured_internal['candidates'] == structured_result['cases']
            grouped = call('search', {'groupBy': ['source.handle'], 'aggregates': [{'name': 'total', 'op': 'count'}], 'limit': 1})
            assert grouped['groupTotal'] == 2 and grouped['aggregates']['total']['value'] == 4, grouped
            assert call('search', {'where': {'field': 'not_a_field', 'op': 'eq', 'value': 'x'}})['code'] == 'invalid_case_query'
            second = call('search', {**filters, 'limit': 1, 'offset': first['nextOffset'], 'expectedRevision': first['revision']})
            assert second['cases'][0]['caseId'] != first['cases'][0]['caseId']
            assert call('search', {**filters, 'offset': 1})['code'] == 'search_revision_required'
            internal = page.evaluate('''async input=>{
              const {createLocalComposerLibraryTools}=await import('./composer-library-host.js');
              const {createComposerSession}=await import('./composer.js');
              const tools=createLocalComposerLibraryTools({session:createComposerSession({messages:[{id:'u',role:'user',content:'查找动作视频'}]}),vision:false});
              return (await tools.execute('search_cases',input,{callId:'search'})).data;
            }''', filters)
            assert internal['total'] == first['total'] and internal['revision'] == first['revision'], internal
            assert internal['durationCoverage'] == first['durationCoverage']
            current = call('read_case_details', {'caseId': 'case-2'})
            text_page = call('read_case', {'caseId': 'case-2', 'length': 2})
            assert 'media' not in text_page and 'sourcePages' not in text_page
            edited = call('edit_case', {'requestId': 'search-edit', 'caseId': 'case-2', 'expectedRevision': current['revision'],
                                        'sourceCorrection': {'reason': 'Fixture author corrects the original text to verify search invalidation', 'fields': ['text']},
                                        'patch': {'text': '修改后的精确检索词'}})
            assert edited.get('ok'), edited
            assert call('read_case', {'caseId': 'case-2', 'offset': text_page['nextOffset'], 'expectedRevision': text_page['revision']})['code'] == 'case_text_changed'
            assert call('read_case', {'caseId': 'case-2', 'offset': 2})['code'] == 'case_revision_required'
            assert call('search', {**filters, 'offset': 1, 'expectedRevision': first['revision']})['code'] == 'search_changed'
            found = call('search', {'query': '精确检索词'})
            assert [c['caseId'] for c in found['cases']] == ['case-2']
            page.reload()
            refreshed = call('search', filters)
            assert refreshed['total'] == 3
            assert refreshed['revision'] != first['revision']
            # A mixed reference must find pure videos by their video prompts.
            entries[0]['mediaAssets'].append({'id': 'content-image', 'kind': 'image', 'usage': 'content'})
            entries[0]['mediaPrompts'] = [
                {'assetId': 'video-0', 'source': 'webpage', 'text': 'highway car chase'},
                {'assetId': 'content-image', 'source': 'webpage', 'text': 'flowers'}]
            entries[1]['text'] = 'highway car chase'
            entries[2]['text'] = ''
            entries[2]['sourceFacts']['originalPromptAvailable'] = False
            entries[3]['text'] = ''
            entries[3]['mediaPrompts'] = [{'assetId': 'video-3', 'source': 'ai-suggestion', 'text': 'highway car chase'}]
            run.seed_storage(page, {'entries': entries})
            prompt_input = {'similarTo': {'caseId': 'case-0'}, 'mediaKind': 'video', 'limit': 1}
            prompt_result = call('search', prompt_input)
            assert prompt_result['total'] == 2, prompt_result
            assert prompt_result['cases'][0]['caseId'] == 'case-1', prompt_result
            assert prompt_result['cases'][0]['excerpt'] == 'highway car chase'
            assert prompt_result['similarityCoverage']['referencePrompt']['excerpt'] == 'highway car chase'
            assert prompt_result['similarityCoverage']['unknownExcluded'] == 1
            next_prompt = call('search', {**prompt_input, 'offset': prompt_result['nextOffset'], 'expectedRevision': prompt_result['revision']})
            assert next_prompt['cases'][0]['similarity']['promptEvidence']['sources'] == ['ai'], next_prompt
            assert [c['caseId'] for c in call('search', {'mediaKind': 'video', 'hasPrompt': False})['cases']] == ['case-2']
            assert call('search', {**prompt_input, 'similarTo': {'caseId': 'case-0', 'method': 'local'}})['total'] == 0
            page.reload()
            assert call('search', prompt_input)['revision'] == prompt_result['revision']
            print('PASS: prompt-first mixed/pure video search, original/AI provenance, missing-prompt expansion, local behavior unchanged, reload stable')
            print('PASS: actual internal/external same revision, duration/unknown coverage, protected pagination, edits invalidate cached search, reload preserves current results')


if __name__ == '__main__':
    main()
