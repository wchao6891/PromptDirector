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
            first = call('search', {**filters, 'limit': 1})
            assert first['total'] == 3 and first['durationCoverage']['unknownDurationMedia'] == 1, first
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
            edited = call('edit_case', {'requestId': 'search-edit', 'caseId': 'case-2', 'expectedRevision': current['revision'],
                                        'patch': {'text': '修改后的精确检索词'}})
            assert edited['ok'], edited
            assert call('search', {**filters, 'offset': 1, 'expectedRevision': first['revision']})['code'] == 'search_changed'
            found = call('search', {'query': '精确检索词'})
            assert [c['caseId'] for c in found['cases']] == ['case-2']
            page.reload()
            refreshed = call('search', filters)
            assert refreshed['total'] == 3
            assert refreshed['revision'] != first['revision']
            print('PASS: actual internal/external same revision, duration/unknown coverage, protected pagination, edits invalidate cached search, reload preserves current results')


if __name__ == '__main__':
    main()
