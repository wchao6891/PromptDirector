"""Local draft UI localization; no model requests or formal library writes."""
import json
import re
import tempfile
from pathlib import Path

from playwright.sync_api import expect
from e2e_support import EXTENSION_DIR, extension_session


def main():
    evidence = Path(tempfile.mkdtemp(prefix='pd-tool-draft-localization-evidence-'))
    with tempfile.TemporaryDirectory(prefix='pd-tool-draft-ui-code-') as code:
        extension = Path(code)
        for item in EXTENSION_DIR.iterdir():
            (extension / item.name).symlink_to(item, target_is_directory=item.is_dir())
        (extension / 'draft-ui-test.html').write_text('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ui-foundation.css"><link rel="stylesheet" href="library.css"><link rel="stylesheet" href="composer-page.css"></head><body></body></html>')
        with extension_session('pd-tool-draft-ui-profile-', extension_dir=extension) as run:
            page = run.open_page('draft-ui-test.html')
            page.evaluate('''async()=>{
              const {initializeUi}=await import('./i18n.js');
              await initializeUi({locale:'en',theme:'dark',motion:'reduced'});
              const {createToolDraftCard}=await import('./composer-tool-draft-ui.js');
              window.messages=[];window.saved=[];window.responses=[];
              const original=chrome.runtime.sendMessage.bind(chrome.runtime);
              chrome.runtime.sendMessage=async message=>{
                if(message.type!=='SAVE_COMPOSER_TOOL_DRAFT')return original(message);
                messages.push(structuredClone(message));return responses.shift();
              };
              window.showDraft=draft=>document.body.append(createToolDraftCard({callId:'tool-1',userMessageId:'user-1',draft},
                {sessionId:'session-1',onSaved:session=>saved.push(session)}));
              showDraft({kind:'tags',caseId:'case-1',title:'取消',tags:['保存','中文标签']});
            }''')
            card = page.locator('.composer-tool-draft').last
            try:
                expect(card.locator('strong')).to_have_text('Tag suggestions · 取消')
            except AssertionError:
                page.screenshot(path=str(evidence / 'draft-card-untranslated.png'))
                print(json.dumps({'card': card.inner_text(), 'evidence': str(evidence)}, ensure_ascii=False), flush=True)
                raise
            expect(card.locator('p')).to_have_text('保存、中文标签')
            card.get_by_role('button', name='Review and save', exact=True).click()
            dialog = page.locator('.composer-tool-draft-dialog')
            expect(dialog).to_have_attribute('aria-label', 'Review and save tags')
            expect(dialog.locator('header')).to_have_text('Tag suggestions · 取消')
            expect(dialog.get_by_label('Tags to add (one per line)', exact=True)).to_have_value('保存\n中文标签')
            dialog.locator('textarea').fill('取消\n新中文标签')
            page.evaluate("()=>responses.push({ok:false,message:'原案例已删除，未写入标签'})")
            dialog.get_by_role('button', name='Add to case', exact=True).click()
            expect(dialog.get_by_role('status')).to_have_text('The original case was deleted. No tags were added.')
            expect(dialog.locator('textarea')).to_have_value('取消\n新中文标签')
            page.screenshot(path=str(evidence / 'english-tags-error-preserves-input.png'))
            page.evaluate("()=>responses.push({ok:true,session:{id:'tags-saved'}})")
            dialog.get_by_role('button', name='Add to case', exact=True).click()
            expect(dialog).to_have_count(0)
            payload = page.evaluate('()=>messages.at(-1)')
            assert payload == {'type': 'SAVE_COMPOSER_TOOL_DRAFT', 'sessionId': 'session-1', 'callId': 'tool-1',
                               'userMessageId': 'user-1', 'draft': {'tags': ['取消', '新中文标签']}}, payload
            page.evaluate("()=>showDraft({kind:'tags',title:'取消',tags:['保存'],savedId:'case-1'})")
            expect(page.locator('.composer-tool-draft').last.get_by_role('link', name='View cases', exact=True)).to_have_attribute('href', 'library.html?case=case-1')

            skill = {'kind': 'skill', 'callName': '取消', 'description': '说明', 'skillMarkdown': '# 保存\n保留中文原词'}
            page.evaluate('draft=>showDraft(draft)', skill)
            card = page.locator('.composer-tool-draft').last
            expect(card.locator('strong')).to_have_text('取消')
            expect(card.locator('p')).to_have_text('说明')
            card.get_by_role('button', name='Review and save', exact=True).click()
            expect(dialog).to_have_attribute('aria-label', 'Review and save Skill')
            expect(dialog.get_by_label('Call name', exact=True)).to_have_value('取消')
            expect(dialog.get_by_label('Description', exact=True)).to_have_value('说明')
            expect(dialog.get_by_label('Skill content', exact=True)).to_have_value(skill['skillMarkdown'])
            controls = dialog.evaluate(r'''node=>[...node.querySelectorAll('header,button,label')].map(el=>
              el.tagName==='LABEL'?[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join(''):el.textContent).join('\n')''')
            assert not re.search(r'[\u3400-\u9fff]', controls), controls
            count = page.evaluate('()=>messages.length')
            dialog.get_by_role('button', name='Cancel', exact=True).click()
            expect(dialog).to_have_count(0)
            assert page.evaluate('()=>messages.length') == count
            card.get_by_role('button', name='Review and save', exact=True).click()
            edited = {'callName': '原词方法', 'description': '说明不自动翻译', 'skillMarkdown': '# 原文\n新中文内容'}
            for field, value in edited.items():
                dialog.locator(f'[name="{field}"]').fill(value)
            page.evaluate('()=>responses.push(null)')
            dialog.get_by_role('button', name='Save to Skill Center', exact=True).click()
            expect(dialog.get_by_role('status')).to_have_text('Could not save. Please try again.')
            for field, value in edited.items():
                expect(dialog.locator(f'[name="{field}"]')).to_have_value(value)
            page.screenshot(path=str(evidence / 'english-skill-editor.png'))
            page.set_viewport_size({'width': 390, 'height': 844})
            dialog.get_by_role('button', name='Save to Skill Center', exact=True).scroll_into_view_if_needed()
            layout = dialog.evaluate('''node=>({width:innerWidth,dialog:node.getBoundingClientRect().toJSON(),
              controls:[...node.querySelectorAll('button,input,textarea')].map(el=>el.getBoundingClientRect().toJSON())})''')
            assert layout['dialog']['left'] >= 0 and layout['dialog']['right'] <= layout['width'], layout
            assert all(box['left'] >= layout['dialog']['left'] and box['right'] <= layout['dialog']['right'] for box in layout['controls']), layout
            page.screenshot(path=str(evidence / 'english-skill-editor-narrow.png'))
            page.set_viewport_size({'width': 1280, 'height': 900})
            page.evaluate("()=>responses.push({ok:true,session:{id:'skill-saved'}})")
            dialog.get_by_role('button', name='Save to Skill Center', exact=True).click()
            expect(dialog).to_have_count(0)
            assert page.evaluate('()=>messages.at(-1).draft') == edited
            assert page.evaluate('()=>saved') == [{'id': 'tags-saved'}, {'id': 'skill-saved'}]
            page.evaluate("draft=>showDraft({...draft,savedId:'skill-1'})", skill)
            expect(page.locator('.composer-tool-draft').last.get_by_role('link', name='View in Skill Center')).to_have_attribute('href', 'skills.html?source=composer&session=session-1&view=detail&skill=skill-1')
            page.evaluate("async()=>{await (await import('./i18n.js')).initializeUi({locale:'zh-CN'});showDraft({kind:'tags',title:'取消',tags:['保存']});}")
            expect(page.locator('.composer-tool-draft').last.locator('strong')).to_have_text('标签建议 · 取消')
            expect(page.locator('.composer-tool-draft').last.get_by_role('button', name='查看并保存', exact=True)).to_be_visible()
            assert not run.page_errors, run.page_errors
            print(json.dumps({'passed': True, 'english_controls': True, 'user_text_unchanged': True,
                              'edit_retry_save_contract': True, 'cancel_no_write': True, 'chinese_locale': True,
                              'evidence': str(evidence)}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
