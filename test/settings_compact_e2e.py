from __future__ import annotations
import os
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session

# Layout and action-state fixtures run only in a disposable Chrome profile.
with extension_session('pd-settings-compact-', viewport={'width':1440,'height':1000}) as session:
 page=session.open_page('library.html')
 page.locator('#open-settings').dispatch_event('click')
 expect(page.locator('#settings-general-panel')).to_be_visible()
 page.locator('#ui-theme').select_option('dark')
 page.locator('#library-name-setting').fill('设置保存验证')
 page.locator('#save-library-settings').click()
 expect(page.locator('#library-settings-feedback')).to_have_text('已保存')
 saved=page.evaluate("async()=> (await chrome.runtime.sendMessage({type:'GET_STATE'})).settings.libraryTitle")
 assert saved=='设置保存验证',saved
 page.evaluate("() => { window.originalSettingsSend=chrome.runtime.sendMessage.bind(chrome.runtime); chrome.runtime.sendMessage=async m=>m.type==='UPDATE_SETTINGS'?{ok:false,message:'保存失败测试'}:window.originalSettingsSend(m); }")
 page.locator('#library-name-setting').fill('保留未保存的修改')
 page.locator('#save-library-settings').click()
 expect(page.locator('#library-settings-feedback')).to_have_text('保存失败测试')
 expect(page.locator('#library-name-setting')).to_have_value('保留未保存的修改')
 expect(page.locator('#save-library-settings')).to_be_enabled()
 page.evaluate('() => { chrome.runtime.sendMessage=window.originalSettingsSend; }')
 page.locator('#library-name-setting').fill('设置保存验证')
 page.locator('#sync-settings summary').click()
 expect(page.locator('#connect-sync-folder')).to_be_visible()
 expect(page.locator('#sync-password')).to_be_visible()
 expect(page.locator('#unlock-sync-vault')).to_be_hidden()
 page.evaluate('''() => {
   window.settingsSendMessage=chrome.runtime.sendMessage.bind(chrome.runtime);
   window.settingsFixture={connected:true,permission:'granted',unlocked:false};
   chrome.runtime.sendMessage=async message=>message.type==='GET_DATA_SAFETY_STATUS'
     ? {ok:true,entryCount:0,mediaCount:0,videoCount:0,syncStatus:window.settingsFixture}
     : window.settingsSendMessage(message);
 }''')
 async_states=[({'connected':True,'permission':'granted','unlocked':False},'unlock-sync-vault'),
  ({'connected':True,'permission':'granted','unlocked':True},'sync-now'),
  ({'connected':True,'permission':'granted','unlocked':True,'active':True},'cancel-sync'),
  ({'connected':False},'connect-sync-folder')]
 for state,visible in async_states:
  page.evaluate('(value)=>window.settingsFixture=value',state)
  page.locator('[data-settings-tab="ai"]').click()
  page.locator('[data-settings-tab="general"]').click()
  expect(page.locator('#'+visible)).to_be_visible()
 page.evaluate('() => { chrome.runtime.sendMessage=window.settingsSendMessage; }')
 for width,height in [(1440,1000),(390,844)]:
  page.set_viewport_size({'width':width,'height':height})
  page.locator('[data-settings-tab="ai"]').click()
  page.locator('[data-settings-tab="general"]').click()
  expect(page.locator('#connect-sync-folder')).to_be_visible()
  page.locator('#sync-password').scroll_into_view_if_needed()
  rects=page.evaluate('''() => {
   const rect = selector => {const r=document.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
   return {password:rect('#sync-password'),connect:rect('#connect-sync-folder'),permissions:[...document.querySelectorAll('.capture-permission-row')].map(row=>{
    const s=row.querySelector('span').getBoundingClientRect(), b=row.querySelector('button').getBoundingClientRect();return {gap:b.left-s.right,topDelta:Math.abs(b.top-s.top)};
   }),scrollWidth:document.querySelector('#settings-general-panel').scrollWidth,clientWidth:document.querySelector('#settings-general-panel').clientWidth};
  }''')
  assert abs(rects['password']['top']-rects['connect']['top'])<4,rects
  assert 0<=rects['connect']['left']-rects['password']['right']<=13,rects
  assert all(0<=r['gap']<=13 for r in rects['permissions']),rects
  assert rects['scrollWidth']<=rects['clientWidth'],rects
  if width>680:
   full=page.locator('.setting-section').first.bounding_box()
   panel=page.locator('#settings-general-panel').bounding_box()
   assert abs(full['width']-panel['width'])<20,(full,panel)
  output=os.environ.get('PROMPTDIRECTOR_SETTINGS_SCREENSHOT_DIR')
  if output:
   dest=Path(output);dest.mkdir(parents=True,exist_ok=True)
   page.locator('#settings-general-panel').evaluate('el=>el.scrollTop=0')
   page.screenshot(path=str(dest/f'settings-actual-{width}-sync.png'))
   page.locator('#sync-settings summary').click()
   page.screenshot(path=str(dest/f'settings-actual-{width}.png'))
   if width>680: page.locator('#settings-dialog').screenshot(path=str(dest/'settings-actual-panel.png'))
   page.locator('#sync-settings summary').click()
 page.locator('#open-about').click()
 expect(page.locator('#promptdirector-app-dialog')).to_contain_text('关于 PromptDirector')
 expect(page.locator('#promptdirector-app-dialog')).to_contain_text('选择已下载的更新包')
 print({'compact_settings':'passed','save':'persisted','sync_states':4,'viewports':[1440,390]})
