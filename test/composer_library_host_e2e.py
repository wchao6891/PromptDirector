"""Video/offscreen tools use real worker dispatch and preserve canonical user work."""
import json

from e2e_support import base_entry, extension_session


def main():
    original = '保留完整原词。' * 1000
    with extension_session('pd-composer-worker-tools-') as run:
        page = run.open_page('collector.html')
        run.seed_storage(page, {'entries': [base_entry('bridge-case', '工具读取案例', original,
                                                     'content:prompt:image', 1)]})
        skill = page.evaluate("""async () => {
          const response = await chrome.runtime.sendMessage({type:'CREATE_CREATIVE_SKILL',
            skill:{callName:'完整方法',description:'后台工具回归',skillMarkdown:'保留完整方法正文'}});
          if (!response.ok) throw Error(response.message);
          const {createComposerSession}=await import('./composer.js');
          await chrome.storage.local.set({composerSessions:[createComposerSession({id:'bridge-session',
            libraryTools:{candidates:[{caseId:'bridge-case',title:'工具读取案例'}]},
            messages:[{id:'request',role:'user',content:'读取参考'},
                      {id:'other-request',role:'user',content:'另一个任务'}],
            toolContinuations:{'other-request':{protocol:'chat_completions',
              body:{model:'fixture-model'},marker:'保留另一个任务'}}})]});
          return response.skill;
        }""")

        def call(operation, value):
            result = page.evaluate("""async ([operation,input]) => chrome.runtime.sendMessage({
              type:'COMPOSER_LIBRARY_HOST',operation,input,sessionId:'bridge-session',userMessageId:'request'})""",
                                   [operation, value])
            assert result['ok'], result
            return result

        def execute(name, args):
            result = call('execute', {'name': name, 'args': args, 'callId': name})
            data = result['data']['data']
            assert not data.get('error'), result
            assert [event['status'] for event in result['events']] == ['running', 'completed'], result
            return data

        found = execute('search_cases', {'query': '工具读取案例'})
        assert any(item['caseId'] == 'bridge-case' for item in found['candidates']), found
        overview = execute('read_case_details', {'caseId': 'bridge-case'})
        document = execute('read_case_details', {'caseId': 'bridge-case', 'part': 'document',
                                               'expectedRevision': overview['revision'], 'length': 12000})
        assert original in document['content'], document
        assert document['nextOffset'] is None and document['revision'] == overview['revision'], document
        method = execute('read_skill', {'skillId': skill['id']})
        assert method['content'] == '保留完整方法正文', method

        checkpoint = {'protocol': 'chat_completions', 'body': {'model': 'fixture-model'}, 'nextOffset': 7000}
        call('saveContinuation', checkpoint)
        page.reload()
        assert call('loadContinuation', {'model': 'fixture-model', 'protocol': 'chat_completions'})['data'] == checkpoint
        call('clearContinuation', None)
        assert call('loadContinuation', {'model': 'fixture-model', 'protocol': 'chat_completions'})['data'] is None
        stored = page.evaluate("async () => import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get(['entries','composerSessions']))")
        assert original in json.dumps(stored['entries'], ensure_ascii=False)
        assert stored['composerSessions'][0]['toolContinuations']['other-request']['marker'] == '保留另一个任务'
        assert not run.page_errors, run.page_errors
        print(json.dumps({'workerCaseRead': True, 'workerSearch': True, 'workerSkillRead': True,
                          'continuationReload': True, 'otherTaskPreserved': True}, ensure_ascii=False))


if __name__ == '__main__':
    main()
