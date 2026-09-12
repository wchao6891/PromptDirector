from __future__ import annotations

from playwright.sync_api import expect
from e2e_support import extension_session, base_entry

# Publicly shaped fixtures in a disposable install; no provider or public submission request is sent.
with extension_session('pd-six-surfaces-', viewport={'width':1440,'height':960}) as session:
 page=session.open_page('collector.html',wait_until='networkidle')
 session.seed_storage(page, {'entries':[base_entry('frontend-review-case','界面验收案例','光线与构图参考','content:prompt:image',0)], 'uiPreferences':{'locale':'zh-CN','theme':'dark','motion':'reduced'}})
 page=session.open_page('library.html',wait_until='networkidle')
 page.locator('#open-settings').click()
 page.locator('[data-settings-tab="rules"]').click()
 text=page.locator('#analysis-instructions-zh');original=text.input_value()
 text.fill('保留尚未保存的规则')
 expect(page.locator('#ai-settings-status')).to_have_text('未保存')
 page.locator('[data-analysis-kind="vision"]').click()
 page.locator('#vision-instructions-zh').fill('保留图片规则')
 page.locator('[data-analysis-kind="text"]').click()
 expect(text).to_have_value('保留尚未保存的规则')
 page.locator('#settings-close').click();page.locator('#open-settings').click();page.locator('[data-settings-tab="rules"]').click()
 expect(text).to_have_value('保留尚未保存的规则')
 page.locator('#ai-settings-form button[type=submit]').click()
 expect(page.locator('#ai-settings-status')).to_have_text('分析规则已保存')
 saved=page.evaluate("async()=> (await chrome.runtime.sendMessage({type:'GET_STATE'})).aiSettings.analysisInstructionsByLocale['zh-CN']")
 assert saved=='保留尚未保存的规则',saved
 page.locator('[data-analysis-kind="composer"]').click()
 page.locator('#composer-agent-instruction').fill('独立的系统指令草稿')
 page.locator('#composer-task-method').fill('图片方法草稿')
 page.locator('#composer-task-key').select_option('compose.video');page.locator('#composer-task-method').fill('视频方法草稿')
 page.locator('#composer-task-key').select_option('compose.image');expect(page.locator('#composer-task-method')).to_have_value('图片方法草稿')
 page.locator('#composer-settings-form button[type=submit]').click();expect(page.locator('#composer-task-save-state')).to_have_text('已保存')
 expect(page.locator('#composer-agent-instruction')).to_have_value('独立的系统指令草稿')
 page.locator('#composer-task-key').select_option('compose.video');expect(page.locator('#composer-task-method')).to_have_value('视频方法草稿')
 page.locator('[data-analysis-kind="text"]').click();page.locator('#restore-analysis-default').click();expect(text).to_have_value(original);expect(page.locator('#ai-settings-status')).to_have_text('未保存')
 for width,height,locale,theme in [(1440,960,'zh-CN','dark'),(390,844,'en','light')]:
  page.set_viewport_size({'width':width,'height':height})
  page.locator('[data-settings-tab="general"]').click()
  for selector,value in [('#ui-theme',theme),('#ui-locale',locale)]:
   if page.locator(selector).input_value()!=value:
    with page.expect_navigation(wait_until='networkidle'):
     page.locator(selector).select_option(value)
    page.locator('#open-settings').click()
  for tab in ['ai','rules','tasks']:
   page.locator(f'[data-settings-tab="{tab}"]').click()
   metrics=page.locator(f'#settings-{tab}-panel').evaluate('(e)=>({width:e.clientWidth,scroll:e.scrollWidth})')
   assert metrics['scroll']<=metrics['width']+1,(tab,metrics)
  centers=page.evaluate("""()=>{const a=document.querySelector('#text-batch-card h3').getBoundingClientRect(),b=document.querySelector('#preview-analysis-batch').getBoundingClientRect();return Math.abs(a.top+a.height/2-b.top-b.height/2)}""")
  if width >= 600: assert centers<=1,centers
  expect(page.locator("#batch-status-badge")).to_be_hidden()
 page.set_viewport_size({'width':1440,'height':960});page.locator('#settings-close').click()
 page.locator('#select-cases').click();page.locator('#selection-select-filtered').click();page.locator('#selection-more-menu > summary').click();page.locator('#share-export').click()
 expect(page.locator('#share-dialog .eyebrow')).to_be_visible();expect(page.locator('#share-dialog-public-panel')).to_be_hidden()
 page.locator('#share-dialog-public').click();expect(page.locator('#share-dialog-submit')).to_be_disabled();page.locator('#share-dialog-disclosure').check();expect(page.locator('#share-dialog-submit')).to_be_enabled()
 page.evaluate("""()=>{const send=chrome.runtime.sendMessage.bind(chrome.runtime);window.frontendCalls=[];chrome.runtime.sendMessage=async m=>{if(['EXPORT_ARCHIVE','EXPORT_CURATED_SUBMISSION'].includes(m.type)){window.frontendCalls.push(m);return {ok:false,message:'Isolated failure fixture'}}return send(m)}}""")
 page.locator('#share-dialog-submit').click();expect(page.locator('#share-dialog-submit')).to_be_enabled();page.locator('#share-dialog-export').click();expect(page.locator('#share-dialog-export')).to_be_enabled()
 calls=page.evaluate('window.frontendCalls');assert [c['type'] for c in calls]==['EXPORT_CURATED_SUBMISSION','EXPORT_ARCHIVE'],calls
 assert all(c['entryIds']==['frontend-review-case'] for c in calls),calls
 page.locator('#share-dialog-close').click()
 page.locator('#media-file').set_input_files([{'name':'review.txt','mimeType':'text/plain','buffer':b'Frontend import fixture'}])
 expect(page.locator('#import-confirmation')).to_be_visible();tags=page.locator('#import-label-editor input');tags.fill('manual-tag');tags.press('Enter');expect(page.locator('#import-label-editor')).to_contain_text('manual-tag')
 page.set_viewport_size({'width':390,'height':844})
 assert page.locator('.tag-editor-row').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
 assert not session.page_errors,session.page_errors
 print({'rules_save_and_draft_retention':True,'independent_composer_drafts':True,'share_original_payloads':True,'manual_tags':True,'responsive_alignment':True})
