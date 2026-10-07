"""Shared detail inspector: source-safe tabs, compact organization and stable mixed media."""
import json, os, hashlib
from pathlib import Path
from tempfile import mkdtemp
from playwright.sync_api import expect
from e2e_support import extension_session

def main():
 out=Path(os.environ.get('PD_E2E_ARTIFACT_DIR') or mkdtemp(prefix='pd-detail-information-'));out.mkdir(parents=True,exist_ok=True)
 raw=(Path(__file__).parent/'fixtures/review-workspace-smoke.mp4').read_bytes()
 assets=[{'id':'v','kind':'video','storageMode':'managed','mimeType':'video/mp4','width':320,'height':180}, {'id':'i','kind':'image','storageMode':'managed','mimeType':'image/png','width':50,'height':200}]
 entry={'id':'mixed','title':'car Photography photoshoot photoshop Socialmedia design architecture','text':'原始提示词完整内容：不应被删除。','sourceFacts':{'originalPromptAvailable':True,'author':'原始作者'},'url':'https://example.com/source','customLabels':['镜头参考','汽车广告'],'mediaAssets':assets,'primaryMediaId':'v'}
 web={'id':'web','title':'网页原词独立保护','text':'原页面说明，不应被写媒体词覆盖。','sourceFacts':{'originalPromptAvailable':True,'author':'来源作者'},'mediaAssets':[dict(assets[1],id='wi'),dict(assets[1],id='wj')],'primaryMediaId':'wi', 'mediaPrompts':[{'assetId':'wi','source':'webpage','text':'第一张采集原词'},{'assetId':'wj','source':'webpage','text':'第二张采集原词'},{'assetId':'wi','source':'manual','text':'第一张自写词'},{'assetId':'wi','source':'ai-suggestion','text':'第一张AI词'}]}
 with extension_session('pd-detail-information-',viewport={'width':1440,'height':900}) as run:
  setup=run.open_page('collector.html');run.seed_storage(setup,{'entries':[entry,web], 'uiPreferences':{'locale':'zh-CN','theme':'dark','motion':'reduced'}})
  setup.evaluate('''async bytes=>{const{saveMediaBlob}=await import('./media-store.js');await saveMediaBlob('v',new Blob([new Uint8Array(bytes)],{type:'video/mp4'}));const c=document.createElement('canvas');c.width=50;c.height=200;for(const id of ['i','wi','wj'])await saveMediaBlob(id,await new Promise(r=>c.toBlob(r,'image/png')))}''',list(raw))
  p=run.open_page('library.html');p.locator('.case-card[data-entry-id=mixed]').click()
  expect(p.locator('.media-prompt-section')).to_be_visible()
  expect(p.locator('.detail-header-section .palette:not([hidden]),.detail-header-section .detail-meta,.prompt-more,.detail-body > .metadata-section,.detail-footer-actions')).to_have_count(0)
  expect(p.get_by_role('tab',name='原始提示词',exact=True)).to_have_attribute('aria-selected','true')
  expect(p.locator('.original-prompt-panel .prompt-read-body')).to_have_text(entry['text'])
  expect(p.locator('.source-open-action')).to_have_attribute('href',entry['url'])
  assert '原始作者' in p.locator('.source-open-action').get_attribute('title')
  expect(p.locator('.detail-delete-action')).to_have_count(1)
  expect(p.locator('.detail-quick-organization .tag-editor-row')).to_be_hidden()
  p.get_by_role('button',name='添加标签',exact=True).click()
  p.evaluate("()=>{window.realSend=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.runtime.sendMessage=msg=>msg.type==='UPDATE_ENTRY_CUSTOM_LABELS'?Promise.resolve({ok:false,message:'测试保存失败'}):window.realSend(msg)}")
  p.locator('.detail-quick-organization input[aria-label=添加标签]').fill('失败草稿')
  p.locator('.detail-quick-organization input[aria-label=添加标签]').press('Enter')
  expect(p.locator('.detail-quick-organization .tag-editor-chip')).to_have_count(2)
  expect(p.locator('.detail-quick-organization input[aria-label=添加标签]')).to_have_value('失败草稿')
  p.evaluate("()=>{chrome.runtime.sendMessage=window.realSend}")
  p.locator('.detail-quick-organization input[aria-label=添加标签]').fill('新增标签')
  p.locator('.detail-quick-organization input[aria-label=添加标签]').press('Enter')
  p.wait_for_function("async()=>{const{getLibraryStorage}=await import('./library-storage.js');return (await getLibraryStorage().get('entries')).entries[0].customLabels.includes('新增标签')}")
  p.locator('.detail-quick-organization input[aria-label=添加标签]').press('Escape')
  p.locator('.detail-project-menu > summary').click();p.locator('.detail-new-project input').fill('汽车KV')
  p.get_by_role('button',name='新建并加入',exact=True).click()
  expect(p.locator('.detail-project-summary-text')).to_have_text('汽车KV')
  p.get_by_role('tab',name='当前媒体',exact=True).click()
  expect(p.locator('.media-prompt-section button[aria-label^=添加]:visible')).to_have_count(1)
  p.get_by_role('button',name='添加当前媒体提示词',exact=True).click()
  p.locator('.media-original-prompt-panel textarea').fill('新写的当前视频提示词。')
  p.locator('.media-original-prompt-panel').get_by_role('button',name='保存',exact=True).click()
  expect(p.locator('.media-original-prompt-panel .prompt-read-body')).to_have_text('新写的当前视频提示词。')
  p.get_by_role('tab',name='原始提示词',exact=True).click()
  expect(p.locator('.original-prompt-panel .prompt-read-body')).to_have_text(entry['text'])
  # Switching tabs must not silently discard an unsaved draft.
  p.get_by_role('button',name='编辑原始提示词',exact=True).click();p.locator('.original-prompt-panel textarea').fill('保留的未保存草稿')
  p.get_by_role('tab',name='当前媒体',exact=True).click()
  confirm=p.locator('.app-dialog[open]');expect(confirm).to_be_visible();confirm.get_by_role('button',name='取消',exact=True).click()
  expect(p.locator('.original-prompt-panel textarea')).to_have_value('保留的未保存草稿')
  p.locator('.original-prompt-panel .prompt-edit-actions').get_by_role('button',name='取消',exact=True).click()
  # Tabs use keyboard navigation without hijacking textarea editing.
  tab=p.get_by_role('tab',name='原始提示词',exact=True);tab.focus();tab.press('End');expect(p.get_by_role('tab',name='当前媒体',exact=True)).to_be_focused()
  p.get_by_role('tab',name='当前媒体',exact=True).press('Home');expect(tab).to_be_focused()
  def measure():
   return p.evaluate('''()=>{const bar=document.querySelector('.detail-visual-caption'), nav=bar.querySelector('.detail-media-navigation'), section=document.querySelector('.media-prompt-section');const r=e=>e.getBoundingClientRect();const visible=[...section.children].filter(e=>e.getClientRects().length);const create=section.querySelector('.detail-core-actions'), prior=visible[visible.indexOf(create)-1];const buttons=[...bar.querySelectorAll('button')];return{center:r(nav).x+r(nav).width/2,barCenter:r(bar).x+r(bar).width/2,gap:prior?r(create).top-r(prior).bottom:null,height:r(bar).height,rows:[...new Set(buttons.map(e=>Math.round(r(e).top)))],stage:r(document.querySelector('.detail-visual-stage')).height}}''')
  result=[]
  for width in [1440,900,390]:
   p.set_viewport_size({'width':width,'height':900});p.get_by_role('button',name='上一项媒体',exact=True).click() if p.get_by_role('button',name='上一项媒体',exact=True).is_enabled() else None
   expect(p.locator('.detail-video')).to_be_visible();a=measure()
   p.get_by_role('button',name='下一项媒体',exact=True).click();expect(p.locator('.detail-image')).to_be_visible();b=measure()
   assert abs(a['center']-b['center'])<1 and abs(a['center']-a['barCenter'])<1,(width,a,b)
   assert abs(a['gap']-b['gap'])<1 and a['height']==b['height'] and abs(a['stage']-b['stage'])<1,(width,a,b)
   assert len(a['rows'])==1 and len(b['rows'])==1,(width,a,b)
   result.append({'width':width,'video':a,'image':b})
   p.screenshot(path=str(out/f'mixed-detail-{width}.png'))
  p.set_viewport_size({'width':1440,'height':900});p.get_by_role('button',name='审片',exact=True).click()
  review_image=measure();p.get_by_role('button',name='上一项媒体',exact=True).click()
  expect(p.locator('.detail-video')).to_be_visible();expect(p.locator('.review-range-controls')).to_be_visible();review_video=measure()
  assert abs(review_image['center']-review_video['center'])<1 and review_image['height']==review_video['height']
  p.get_by_role('button',name='退出审片',exact=True).click()
  p.get_by_role('button',name='切换侧栏详情',exact=True).click()
  expect(p.locator('.detail-visual-gallery')).to_be_hidden();expect(p.get_by_role('button',name='编辑分析规则',exact=True)).to_be_visible()
  expect(p.locator('.prompt-more')).to_have_count(0)
  p.locator('.detail-body').screenshot(path=str(out/'B-implemented-sidebar.png'))
  with p.expect_navigation(wait_until='domcontentloaded'):
   p.evaluate("async()=>{const{updateUiPreferences}=await import('./i18n.js');const{uiPreferences}=await chrome.storage.local.get('uiPreferences');await updateUiPreferences({...uiPreferences,theme:'light',locale:'en'})}")
  p.locator('.case-card[data-entry-id=mixed]').click()
  expect(p.get_by_role('tab',name='Original prompt',exact=True)).to_be_visible();p.locator('.detail-body').screenshot(path=str(out/'B-implemented-sidebar-light-en.png'))
  with p.expect_navigation(wait_until='domcontentloaded'):
   p.evaluate("async()=>{const{updateUiPreferences}=await import('./i18n.js');const{uiPreferences}=await chrome.storage.local.get('uiPreferences');await updateUiPreferences({...uiPreferences,theme:'dark',locale:'zh-CN'})}")
  p.reload();p.locator('.case-card[data-entry-id=mixed]').click();expect(p.locator('.original-prompt-panel .prompt-read-body')).to_have_text(entry['text'])
  stored=p.evaluate("async()=> (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries[0]")
  assert stored['text']==entry['text'] and stored['customLabels']==['镜头参考','汽车广告','新增标签']
  assert next(x for x in stored['mediaPrompts'] if x['assetId']=='v')['text']=='新写的当前视频提示词。'
  assert stored['sourceFacts']==entry['sourceFacts'] and stored['url']==entry['url']
  saved=p.evaluate("async()=>{const{getMediaBlob}=await import('./media-store.js');return Array.from(new Uint8Array(await(await getMediaBlob('v')).arrayBuffer()))}")
  assert hashlib.sha256(bytes(saved)).digest()==hashlib.sha256(raw).digest()
  p.get_by_role('button',name='关闭详情',exact=True).click();p.locator('.case-card[data-entry-id=web]').click()
  p.get_by_role('tab',name='原始提示词',exact=True).click()
  expect(p.locator('.original-prompt-panel .prompt-read-body')).to_contain_text('第二张采集原词')
  expect(p.locator('.original-prompt-panel button[aria-label*=原始提示词]')).to_have_count(0)
  p.get_by_role('button',name='复制提示词',exact=True).click();assert '第二张采集原词' in p.evaluate('()=>navigator.clipboard.readText()')
  p.get_by_role('tab',name='当前媒体',exact=True).click();p.get_by_role('button',name='编辑当前媒体提示词',exact=True).click()
  p.locator('.media-original-prompt-panel textarea').fill('第一张人工修订');p.locator('.media-original-prompt-panel').get_by_role('button',name='保存',exact=True).click()
  expect(p.locator('.media-original-prompt-panel .prompt-read-body')).to_have_text('第一张人工修订')
  p.get_by_role('tab',name='AI 逆推',exact=True).click();p.get_by_role('button',name='编辑 AI 逆推提示词',exact=True).click()
  p.locator('.image-reconstruction-current textarea').fill('第一张AI人工修订');p.locator('.image-reconstruction-current').get_by_role('button',name='保存',exact=True).click()
  expect(p.locator('.image-reconstruction-current .prompt-read-body')).to_have_text('第一张AI人工修订')
  webstored=p.evaluate("async()=> (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries.find(e=>e.id==='web')")
  assert webstored['text']==web['text'] and webstored['sourceFacts']==web['sourceFacts']
  assert [x['text'] for x in webstored['mediaPrompts'] if x['source']=='webpage']==['第一张采集原词','第二张采集原词']
  assert next(x for x in webstored['mediaPrompts'] if x['source']=='manual')['text']=='第一张人工修订'
  assert next(x for x in webstored['mediaPrompts'] if x['source']=='ai-suggestion')['text']=='第一张AI人工修订'
  p.locator('.source-open-action').click();expect(p.locator('.app-dialog .metadata-list')).to_contain_text('来源作者');p.locator('.app-dialog').get_by_role('button',name='关闭',exact=True).last.click()
  p.locator('.detail-project-menu > summary').click();p.locator('.detail-project-option').filter(has_text='汽车KV').locator('input').check()
  p.wait_for_function("()=>chrome.runtime.sendMessage({type:'GET_STATE'}).then(s=>s.organizerState.collections.some(c=>c.name==='汽车KV'&&c.entryIds.includes('web')))")
  p.get_by_role('button',name='关闭详情',exact=True).click()
  group=p.evaluate("async()=>chrome.runtime.sendMessage({type:'CREATE_COMPOUND_CASE',title:'组合阅读测试',memberEntryIds:['mixed','web']})")
  assert group['ok'],group
  p.reload();p.locator(f'.case-card[data-entry-id="{group["compoundCase"]["id"]}"]').click()
  member=p.locator('.compound-part .media-prompt-section').first
  member.get_by_role('tab',name='原始提示词',exact=True).click();member.get_by_role('button',name='编辑原始提示词',exact=True).click()
  member.get_by_role('tab',name='当前媒体',exact=True).click();expect(member.get_by_role('tab',name='当前媒体',exact=True)).to_have_attribute('aria-selected','true')
  part=p.locator('.compound-part').first;other=p.locator('.compound-part').nth(1)
  other.locator(':scope > .entry-editor summary').click();other_title=other.locator(':scope > .entry-editor .entry-edit-row input').first;other_title.fill('另一成员待保存标题')
  p.evaluate("()=>{window.compoundVideo=document.querySelector('.compound-part .detail-video')}")
  for body in ['组合成员第一次完整修订','组合成员第二次完整修订']:
   member.get_by_role('tab',name='原始提示词',exact=True).click();member.get_by_role('button',name='编辑原始提示词',exact=True).click()
   member.locator('.original-prompt-panel textarea').fill(body);member.locator('.original-prompt-panel .prompt-edit-actions').get_by_role('button',name='保存',exact=True).click()
   expect(member.locator('.original-prompt-panel .prompt-read-body')).to_have_text(body);expect(other_title).to_have_value('另一成员待保存标题')
  part.locator(':scope > .entry-editor summary').click();part.locator(':scope > .entry-editor .entry-edit-row input').first.fill('组合成员保存后标题')
  part.locator(':scope > .entry-editor .entry-edit-row').first.get_by_role('button',name='保存',exact=True).click()
  expect(part.locator('.compound-part-heading h3')).to_have_text('组合成员保存后标题');expect(other_title).to_have_value('另一成员待保存标题')
  assert p.evaluate("()=>window.compoundVideo===document.querySelector('.compound-part .detail-video')")
  print(json.dumps({'compoundTabSwitch':True,'webpageManualAiIndependent':True,'tagFailureDraftPreserved':True,'layout':result,'sourceOriginalPreserved':True,'sourceFactsPreserved':True,'videoShaUnchanged':True,'compactTagAndProjectSaved':True,'draftGuardAndKeyboardTabs':True,'sidebarDirectActions':True,'reviewNavigationStable':True,'evidence':str(out)},ensure_ascii=False))

if __name__=='__main__':main()
