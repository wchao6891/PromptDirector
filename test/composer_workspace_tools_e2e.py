"""Isolated native tool replies exercise real module reads and reviewed persistence, without paid API calls."""
import json
import os
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import ai_configuration_fixture, base_entry, extension_session, wait_for_async_condition


def main():
    entry=base_entry('portrait','人像参考','逆光突出轮廓，脸部保留柔和补光。','content:reference')
    entry['customLabels']=['用户已有标签']
    with extension_session('prompt-director-workspace-tools-') as run:
        setup=run.open_page('collector.html')
        run.seed_storage(setup,{'schemaVersion':24,'entries':[entry],**ai_configuration_fixture(providers={'deepseek':{
            'apiKey':'isolated-fixture','consent':True,'models':{'creativePlanning':'deepseek-flash'}}},assignments={'creativePlanning':{'providerId':'deepseek','model':'deepseek-flash'}})})
        run.context.add_init_script("""(() => {
          if (!location.pathname.endsWith('/composer.html') || new URL(location.href).searchParams.has('session')) return;
          const send = chrome.runtime.sendMessage.bind(chrome.runtime);
          const ready = new Promise(resolve => { window.__releaseComposerReady = resolve; });
          let held = false;
          chrome.runtime.sendMessage = (...args) => {
            const result = send(...args);
            if (args[0]?.type === 'GET_STATE' && !held) {
              held = true;
              return result.then(async response => { await ready; return response; });
            }
            return result;
          };
        })();""")
        page=run.open_page('composer.html')
        requests=[]
        mode='skill'
        def reply(route):
            body=route.request.post_data_json;requests.append(body)
            results=[m for m in body['messages'] if m['role']=='tool']
            names={t['function']['name'] for t in body.get('tools',[])}
            assert {'get_plugin_help','list_skills','read_skill','draft_skill','check_curated_library'}<=names
            step=None
            if mode=='skill' and not results:
                step=('draft_skill',{'callName':'肖像布光','description':'从实例提炼的可复用布光流程','skillMarkdown':'# 肖像布光\n先判断环境光，再选择主光方向。\n把角色、环境和情绪作为输入变量。'})
            elif mode=='tags' and not results:
                step=('search_cases',{'query':'人像'})
            elif mode=='tags' and len(results)==1:
                step=('draft_case_tags',{'caseId':'portrait','tags':['逆光','轮廓光']})
            elif mode=='read' and not results:
                step=('list_skills',{'query':'用户改名'})
            elif mode=='read' and len(results)==1:
                skill=json.loads(results[-1]['content'])['items'][0]
                step=('read_skill',{'skillId':skill['id']})
            elif mode=='help' and not results:step=('get_plugin_help',{})
            if step:
                delta={'tool_calls':[{'index':0,'id':f'{mode}-{len(results)}','type':'function','function':{'name':step[0],'arguments':json.dumps(step[1],ensure_ascii=False)}}]};finish='tool_calls'
            else:delta={'content':'{"route":"chat","status":"ready"}\n已准备好，请查看下方内容。'};finish='stop'
            route.fulfill(status=200,content_type='text/event-stream',body='data: '+json.dumps({'model':'deepseek-flash','choices':[{'delta':delta,'finish_reason':finish}]},ensure_ascii=False)+'\n\ndata: [DONE]\n\n')
        page.route('https://api.deepseek.com/**',reply)
        def send(text,count):
            before=len(requests);answers=page.locator('.composer-message.chat').count()
            page.locator('#composer-instruction').fill(text);page.locator('#composer-action').click()
            expect(page.locator('.composer-message.chat')).to_have_count(answers+1)
            wait_for_async_condition(page,"""async()=>{const id=new URL(location.href).searchParams.get('session');return !(await chrome.runtime.sendMessage({type:'GET_COMPOSER_SESSION',sessionId:id})).session.activeTurn;}""")
            assert len(requests)==before+count
            assert all('data:image' not in json.dumps(r) for r in requests[before:])
        expect(page.locator('#composer-instruction')).to_be_disabled()
        expect(page.locator('#composer-action')).to_be_disabled()
        assert not requests, 'Loading the workspace must not send a model request'
        page.evaluate('window.__releaseComposerReady()')
        expect(page.locator('#composer-instruction')).to_be_editable()
        send('把刚才的方法提炼成 Skill',2)
        stored=page.evaluate("async()=>chrome.storage.local.get('creativeSkills')")
        assert not stored.get('creativeSkills',{}).get('items',[])
        card=page.locator('.composer-tool-draft').first
        card.get_by_role('button',name='查看并保存').click()
        dialog=page.get_by_role('dialog',name='查看并保存 Skill')
        expect(dialog).to_be_visible()
        dialog.locator('[name=callName]').fill('用户改名的布光')
        dialog.locator('[name=skillMarkdown]').fill('# 用户确认\n保留环境层次，不生搬硬套案例。')
        artifacts=os.environ.get('PROMPTDIRECTOR_E2E_ARTIFACT_DIR')
        if artifacts:
            Path(artifacts).mkdir(parents=True,exist_ok=True);page.screenshot(path=str(Path(artifacts)/'skill-draft-review.png'))
        dialog.get_by_role('button',name='保存到 Skill 中心').click()
        expect(dialog).to_have_count(0);expect(card.get_by_role('link',name='在 Skill 中心查看')).to_be_visible()
        assert len(requests)==2, 'Saving must not call a model'
        skill=page.evaluate("async()=> (await chrome.storage.local.get('creativeSkills')).creativeSkills.items[0]")
        assert skill['callName']=='用户改名的布光'
        skills=run.open_page(f"skills.html?view=detail&skill={skill['id']}")
        expect(skills.locator('#skill-detail-title')).to_contain_text('用户改名的布光')
        page.reload();expect(page.get_by_role('link',name='在 Skill 中心查看')).to_be_visible()
        mode='read';send('使用用户改名的布光 Skill 讨论下一步',3)
        read=json.loads([m for m in requests[-1]['messages'] if m['role']=='tool'][-1]['content'])
        assert '用户确认' in read['skillMarkdown']
        mode='tags';send('找到人像案例，建议合适的标签',3)
        page.locator('.composer-tool-draft').last.get_by_role('button',name='查看并保存').click()
        dialog=page.get_by_role('dialog',name='查看并保存标签')
        dialog.locator('[name=tags]').fill('用户确认的逆光')
        dialog.get_by_role('button',name='添加到案例').click();expect(dialog).to_have_count(0)
        labels=page.evaluate("async()=> (await chrome.storage.local.get('entries')).entries[0].customLabels")
        assert labels==['用户已有标签','用户确认的逆光'],labels
        page.locator('#composer-library-search').click()
        mode='help';send('关闭查库后，还能用哪些插件功能？',2)
        assert 'search_cases' not in {t['function']['name'] for t in requests[-1]['tools']}
        assert 'get_plugin_help' in {t['function']['name'] for t in requests[-1]['tools']}
        if artifacts:page.screenshot(path=str(Path(artifacts)/'workspace-conversation.png'),full_page=True)
        assert not run.page_errors,run.page_errors
        print('PASS: same-turn drafts, explicit edited saves, real Skill center/readback, additive tags, persisted receipts, help with search off, zero analysis calls/images')

if __name__=='__main__': main()
