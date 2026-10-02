"""Project and creation round trip in an isolated browser; no daily-library writes."""
import json
import os
import tempfile
import time
from pathlib import Path
from e2e_support import EXTENSION_DIR, extension_session


def main():
    with tempfile.TemporaryDirectory(prefix='pd-project-code-') as tmp:
        ext = Path(tmp)
        for path in EXTENSION_DIR.iterdir():
            if path.name != 'background.js':
                (ext / path.name).symlink_to(path, target_is_directory=path.is_dir())
        (ext / 'background.js').write_text((EXTENSION_DIR / 'background.js').read_text() +
            '\n// Isolated test transport; never packaged.\nglobalThis.agentTestDispatch = dispatchAgentOperation;\n')
        with extension_session('pd-project-profile-', extension_dir=ext) as run:
            page = run.open_page('library.html')
            run.seed_storage(page, {'entries': []})
            worker = run.context.service_workers[0]

            def call(op, data):
                return worker.evaluate('([op,data])=>agentTestDispatch(op,data)', [op, data])

            def save(args):
                call('save_material', args)
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    receipt = call('get_task', {'requestId': args['requestId']})
                    if receipt['state'] not in ('queued', 'running'):
                        assert receipt['state'] == 'completed', receipt
                        return receipt['result']['results'][0]['entryId']
                    time.sleep(0.05)
                raise AssertionError('Save did not finish')

            root = call('create_project', {'requestId': 'project-root', 'name': '影片开发'})['project']
            brief = '雨夜追逐；主角始终保持冷静。\n结尾留出悬念。'
            args = {'requestId': 'project-child', 'name': '预告片', 'parentId': root['id'], 'requirements': brief}
            child = call('create_project', args)['project']
            assert call('create_project', args)['replayed']
            projects = json.loads(call('read_projects', {})['content'])
            assert projects[1]['requirements'] == brief
            assert projects[1]['revision'] == child['revision'], 'Revision must survive real organizer normalization'
            first_args = {'requestId': 'first', 'title': '雨夜追逐第一稿', 'text': '雨水敲在路面，主角循着脚步声转入巷口。',
                          'kind': 'creation', 'project': child['id'], 'projectRevision': child['revision']}
            first = save(first_args)
            assert save(first_args) == first
            first_version = call('read_case_details', {'caseId': first})['revision']
            projects = json.loads(call('read_projects', {})['content'])
            second = save({'requestId': 'second', 'title': '雨夜追逐第二稿', 'text': '路灯熄灭，主角在倒影里看见身后的追踪者。',
                          'kind': 'creation', 'project': child['id'], 'projectRevision': projects[1]['revision'],
                          'sourceReferences': [{'caseId': first, 'expectedRevision': first_version}],
                          'previousCreation': {'caseId': first, 'expectedRevision': first_version}})
            assert call('read_case', {'caseId': first})['content'] == first_args['text']
            provenance = json.loads(call('read_case_details', {'caseId': second, 'part': 'source'})['content'])['provenance']
            assert provenance['creationVersion']['previous']['caseId'] == first
            assert provenance['creationVersion']['number'] == 2
            assert provenance['references'][0]['revision'] == first_version
            # Actual internal adapter uses the same service, not a mock save function.
            internal = page.evaluate('''async () => {
              const {withComposerCaseOperations}=await import('./composer-case-operations.js');
              const tools=withComposerCaseOperations({tools:{specs:[],instructions:''},session:{messages:[{id:'u'}]},
                invoke:(operation,input)=>chrome.runtime.sendMessage({type:'CASE_OPERATION',operation,input})});
              const created=(await tools.execute('create_project',{requestId:'internal-project',name:'创作台故事'},{})).data;
              const input={requestId:'internal-save',title:'创作台段落',text:'风暴来临之前，码头上只剩一盏灯。',kind:'creation',project:created.project.id};
              const saved=(await tools.execute('save_material',input,{})).data;
              const retry=(await tools.execute('save_material',input,{})).data;
              return {created,saved,retry};
            }''')
            assert internal['saved']['ok'], internal
            assert internal['retry']['replayed'] is True
            page.reload()
            page.wait_for_function("async () => (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries.length === 3")
            # Inspect actual rendered cards before opening one by its visible title.
            page.get_by_text('雨夜追逐第二稿', exact=True).first.wait_for()
            page.get_by_text('雨夜追逐第二稿', exact=True).first.click()
            page.get_by_text('路灯熄灭，主角在倒影里看见身后的追踪者。', exact=True).first.wait_for()
            evidence = Path(os.environ.get('PROMPTDIRECTOR_LAB_EVIDENCE_DIR', tmp))
            evidence.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(evidence / 'project-creation-detail.png'))
            state = page.evaluate("async()=>chrome.runtime.sendMessage({type:'GET_STATE'})")
            target = next(p for p in state['organizerState']['collections'] if p['id'] == child['id'])
            assert target['entryIds'] == [first, second]
            assert target['requirements'] == brief
            assert len(state['entries']) == 3
            print('PASS: external and internal create/save, hierarchy, full brief, normalized revisions, old content, lineage, retries, persisted project and visible detail')


if __name__ == '__main__':
    main()
