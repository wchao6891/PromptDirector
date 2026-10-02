"""Isolated browser read/save benchmark. Does not measure model generation or daily Chrome."""
import argparse
import hashlib
import json
import tempfile
import time
from pathlib import Path
from e2e_support import EXTENSION_DIR, extension_session


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline-dir', type=Path)
    parser.add_argument('--samples', type=int, default=3)
    parser.add_argument('--new-project', action='store_true')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='pd-workflow-code-') as tmp:
        ext = Path(tmp)
        for path in EXTENSION_DIR.iterdir():
            if path.name == 'background.js':
                continue
            old = args.baseline_dir / path.name if args.baseline_dir else None
            if old and old.exists():
                (ext / path.name).write_bytes(old.read_bytes())
            else:
                (ext / path.name).symlink_to(path, target_is_directory=path.is_dir())
        (ext / 'background.js').write_text((EXTENSION_DIR / 'background.js').read_text() + '\nglobalThis.workflowDispatch=dispatchAgentOperation;\n')
        with extension_session('pd-workflow-profile-', extension_dir=ext) as run:
            page = run.open_page('library.html')
            # Synthetic count follows the observed 4,459-case/149-project library.
            # No claim that these small records represent its actual byte size.
            prompts = ['甲：镜头从太空推进到雷神的瞳孔。' * 130, '乙：雨滴从巨兽的鳞片滑落，烟雾汇聚。' * 120]
            entries = [{'id': f'c{i}', 'title': f'案例{i}', 'text': prompts[i] if i < 2 else '合成正文',
                        'savedAt': '2026-10-01T00:00:00Z',
                        **({'mediaAssets': [{'id': f'm{i}', 'kind': 'video', 'mimeType': 'video/mp4', 'storageMode': 'managed',
                                             'byteSize': 1024, 'width': 1920, 'height': 1080, 'durationMs': 15000}],
                            'primaryMediaId': f'm{i}', 'mediaPrompts': [{'assetId': f'm{i}', 'text': prompts[i], 'source': 'manual'}]} if i < 2 else {})}
                       for i in range(4459)]
            projects = [{'id': f'p{i}', 'name': f'项目{i}', 'entryIds': [], 'requirements': '完整创作要求。' * 20} for i in range(149)]
            setup_started = time.monotonic()
            run.seed_storage(page, {'entries': entries, 'organizerState': {'collections': projects},
                                    'agentReferenceSelection': {'version': 1, 'revision': 1, 'caseIds': ['c0', 'c1']}})
            worker = run.context.service_workers[0]
            setup_ms = (time.monotonic() - setup_started) * 1000
            trace = []

            def call(op, data=None):
                begin = time.monotonic()
                result = worker.evaluate('([op,data])=>workflowDispatch(op,data)', [op, data or {}])
                trace.append({'operation': op, 'start': begin, 'end': time.monotonic(),
                              'characters': len(json.dumps(result, ensure_ascii=False))})
                return result

            for sample in range(args.samples):
                trace.clear()
                start = time.monotonic()
                context = call('read_workspace_context')
                content, offset = '', 0
                while offset is not None:
                    part = call('read_workspace_content', {'part': 'selection', 'expectedRevision': context['revision'], 'offset': offset})
                    content += part['content']; offset = part['nextOffset']
                bundle = json.loads(content)
                sources = []
                for i, ref in enumerate(bundle['references']):
                    assert ref['originalText'] == prompts[i]
                    if args.baseline_dir:
                        details = call('read_case_details', {'caseId': f'c{i}', 'part': 'media'})
                        revision = details['revision']
                    else:
                        revision = ref['caseSources'][0]['revision']
                        assert ref['media'][0]['durationMs'] == 15000
                    sources.append({'caseId': f'c{i}', 'expectedRevision': revision, 'assetId': f'm{i}'})
                read_ms = (time.monotonic() - start) * 1000
                print(json.dumps({'mode': 'before' if args.baseline_dir else 'after', 'sample': sample, 'scenario': 'T1-data',
                                  'ms': read_ms, 'calls': len(trace), 'returnedCharacters': sum(t['characters'] for t in trace),
                                  'bundleCharacters': len(content), 'promptCopies': [content.count(p) for p in prompts],
                                  'trace': trace, 'fixtureSetupMs': setup_ms, 'modelHostGaps': 'not measured'}, ensure_ascii=False), flush=True)
                trace.clear(); start = time.monotonic()
                target_name = f'新项目{sample}' if args.new_project else '项目148'
                if args.baseline_dir:
                    content, offset, revision = '', 0, None
                    while offset is not None:
                        data = {'offset': offset, **({'expectedRevision': revision} if revision else {})}
                        part = call('read_projects', data); content += part['content']; offset = part['nextOffset']; revision = part['revision']
                    project = next((p for p in json.loads(content) if p['name'] == target_name), None)
                else:
                    part = call('read_projects', {'name': target_name})
                    matches = json.loads(part['content'])
                    project = matches[0] if matches else None
                if not project:
                    project = call('create_project', {'requestId': f'new-project-{sample}', 'name': target_name})['project']
                body = '既定创作正文：雷光照亮烟雾，巨兽收拢翅膀。' * 80
                request = {'requestId': f'performance-{sample}', 'title': f'隔离性能成果{sample}', 'text': body, 'kind': 'creation',
                           'project': project['id'], 'projectRevision': project['revision'], 'sourceReferences': sources}
                call('save_material', request)
                receipt = call('get_task', {'requestId': request['requestId'], **({} if args.baseline_dir else {'waitMs': 15000})})
                while receipt['state'] in ('queued', 'running'):
                    time.sleep(0.05)
                    receipt = call('get_task', {'requestId': request['requestId']})
                assert receipt['state'] == 'completed', receipt
                saved = receipt['result']['results'][0]
                save_ms = (time.monotonic() - start) * 1000
                save_trace = list(trace)
                # Independent verification outside the timed normal after-flow.
                readback = call('read_case', {'caseId': saved['entryId']})
                assert readback['content'] == body
                lineage = call('read_case_details', {'caseId': saved['entryId'], 'part': 'source'})
                provenance = json.loads(lineage['content'])['provenance']
                assert len(provenance['references']) == 2
                assert provenance['project']['id'] == project['id']
                if not args.baseline_dir:
                    assert saved['revision'] == lineage['revision'], 'Receipt revision must match independent normalized read'
                    assert saved['body']['sha256'] == hashlib.sha256(body.encode()).hexdigest()
                    current_project = json.loads(call('read_projects', {'name': target_name})['content'])[0]
                    assert saved['project']['revision'] == current_project['revision']
                print(json.dumps({'mode': 'before' if args.baseline_dir else 'after', 'sample': sample, 'scenario': 'T2-data-new-project' if args.new_project else 'T2-data',
                                  'ms': save_ms, 'domainCalls': len(save_trace), 'returnedCharacters': sum(t['characters'] for t in save_trace),
                                  'trace': save_trace, 'independentReadback': True, 'modelHostGaps': 'not measured'}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
