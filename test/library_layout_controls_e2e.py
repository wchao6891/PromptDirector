"""Real library controls: one-click sorts, shared zoom and stable centered context."""
from pathlib import Path
import os,json
from playwright.sync_api import expect
from e2e_support import extension_session,base_entry

OUT=Path(os.environ.get('PD_LAYOUT_EVIDENCE','/tmp/pd-layout-controls'))
OUT.mkdir(exist_ok=True,parents=True)

def main():
 with extension_session('pd-layout-controls-',viewport={'width':1440,'height':820}) as s:
  setup=s.open_page('collector.html')
  entries=[base_entry(f'case-{i}',f'案例 {i:03}','完整原词\n不能改变','content:prompt:image',i%60) for i in range(180)]
  for i,e in enumerate(entries):
   e['customLabels']=['角色' if i%2 else '场景','参考'];e['url']=f'https://example.com/{i}'
   e['mediaAssets']=[{'id':f'asset-{i}','kind':'image','usage':'content','width':160,'height':100 if i%2 else 220,'byteSize':100+i,'mimeType':'image/png','storageMode':'managed','assetPath':f'media/asset-{i}.png'}]
  s.seed_storage(setup,{'entries':entries,'uiPreferences':{'locale':'zh-CN','theme':'dark','motion':'reduced','galleryView':'list'},'organizerState':{'version':7,'collections':[{'id':'p','name':'参考项目','entryIds':['case-0','case-1','case-2']},{'id':'child','parentId':'p','name':'子项目','entryIds':['case-3']},{'id':'empty','name':'空项目','entryIds':[]}]}})
  # Locally generated test images, saved only into this disposable profile.
  setup.evaluate("""async () => {
    const {saveMediaBlob}=await import('./media-store.js');
    const c=document.createElement('canvas');c.width=160;c.height=220;
    const ctx=c.getContext('2d');ctx.fillStyle='#446f78';ctx.fillRect(0,0,160,220);ctx.fillStyle='#b9d687';ctx.fillRect(35,35,90,90);
    const blob=await new Promise(r=>c.toBlob(r,'image/png'));
    for(let i=0;i<180;i++)await saveMediaBlob('asset-'+i,blob);
  }""")
  before=setup.evaluate("()=>import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get(['entries','organizerState']))")
  page=s.open_page('library.html',wait_until='networkidle');expect(page.locator('body')).to_have_attribute('data-library-state','ready')
  assert page.locator('#gallery-sort').count()==0
  expect(page.locator('#case-list .case-row-tags').first).to_contain_text('参考')
  assert page.locator('[role="columnheader"]').count()==7
  page.locator('[data-sort-column="title"]').click()
  expect(page.locator('#case-list .case-card').first).to_have_attribute('data-entry-id','case-0')
  page.locator('[data-sort-column="title"]').click()
  expect(page.locator('#case-list .case-card').first).to_have_attribute('data-entry-id','case-179')
  expect(page.locator('[data-column="title"][role="columnheader"]')).to_have_attribute('aria-sort','descending')
  page.locator('[data-sort-column="size"]').click()
  expect(page.locator('#case-list .case-card').first).to_have_attribute('data-entry-id','case-0')
  page.locator('[data-sort-column="size"]').click()
  expect(page.locator('#case-list .case-card').first).to_have_attribute('data-entry-id','case-179')
  page.locator('#list-column-menu summary').click();page.locator('[data-list-column="tags"]').uncheck()
  expect(page.locator('#case-list .case-row-tags').first).to_be_hidden()
  page.locator('#list-column-menu summary').click()
  page.locator('#gallery-size').fill('88');page.locator('#gallery-size').dispatch_event('change')
  page.wait_for_function("getComputedStyle(document.querySelector('.gallery-shell')).getPropertyValue('--list-thumb')==='72px'")
  # Zoom an already loaded deep window. The visible case must stay at the same screen position.
  for _ in range(4):
   page.locator('#case-list .case-card').last.scroll_into_view_if_needed();page.wait_for_timeout(100)
  anchor=page.locator('#case-list .case-card').evaluate_all("els=>{const e=els.find(e=>{const r=e.getBoundingClientRect();return r.top>=100&&r.bottom<innerHeight});return {id:e.dataset.entryId,top:e.getBoundingClientRect().top}}")
  page.locator('#gallery-size').fill('25');page.locator('#gallery-size').dispatch_event('change');page.wait_for_timeout(150)
  box=page.locator(f'[data-entry-id="{anchor["id"]}"]').bounding_box()
  assert abs(box['y']-anchor['top'])<100,(anchor,box)
  page.evaluate('scrollTo(0,0)')
  page.locator('[data-gallery-view="waterfall"]').click();expect(page.locator('#case-list .case-card').first).to_have_attribute('data-entry-id','case-179')
  page.wait_for_function("document.querySelector('#case-list .case-card').getBoundingClientRect().width < document.querySelector('#case-list').clientWidth / 2")
  initial=page.locator('#case-list .case-card').first.bounding_box()['width']
  page.locator('#gallery-size').fill('90');page.locator('#gallery-size').dispatch_event('change')
  page.wait_for_function("w=>document.querySelector('#case-list .case-card').getBoundingClientRect().width>w",arg=initial)
  assert page.locator('#case-list .case-card').first.bounding_box()['width']>initial
  for _ in range(3):
   page.locator('#case-list .case-card').last.scroll_into_view_if_needed();page.wait_for_timeout(100)
  image_anchor=page.locator('#case-list .case-card').evaluate_all("els=>{const e=els.find(e=>{const r=e.getBoundingClientRect();return r.bottom>56&&r.top<innerHeight});return {id:e.dataset.entryId,top:e.getBoundingClientRect().top}}")
  page.locator('#gallery-size').fill('57');page.locator('#gallery-size').dispatch_event('change');page.wait_for_timeout(250)
  image_box=page.locator(f'[data-entry-id="{image_anchor["id"]}"]').bounding_box()
  assert abs(image_box['y']-image_anchor['top'])<2,(image_anchor,image_box)
  page.evaluate('scrollTo(0,0)')
  page.locator('[data-gallery-view="list"]').click();expect(page.locator('#gallery-size')).to_have_value('57')
  page.wait_for_timeout(100);page.reload(wait_until='networkidle')
  expect(page.locator('#gallery-size')).to_have_value('57');expect(page.locator('[data-column="size"][role="columnheader"]')).to_have_attribute('aria-sort','descending')
  expect(page.locator('#case-list .case-row-tags').first).to_be_hidden()
  # Column coordinates must match their row cells, not centered headings offset from data.
  coords=page.evaluate("""()=>['title','type','count','source','size','added'].map(k=>({key:k,head:document.querySelector('[role=columnheader][data-column='+k+']').getBoundingClientRect().left,row:document.querySelector('.case-row-details [data-column='+k+']').getBoundingClientRect().left}))""")
  assert all(abs(x['head']-x['row'])<2 for x in coords),coords
  positions=[]
  for theme in ['dark','light']:
   if theme=='light':
    page.evaluate("async()=>{const {uiPreferences:p}=await chrome.storage.local.get('uiPreferences');await chrome.runtime.sendMessage({type:'UPDATE_UI_PREFERENCES',preferences:{...p,theme:'light'}})}");page.wait_for_timeout(200);page.wait_for_load_state('networkidle')
   for width in [1440,960,420]:
    page.set_viewport_size({'width':width,'height':820});page.wait_for_timeout(80)
    for state in ['browse','manage','project','analysis']:
     if state=='manage':page.locator('#select-cases').click();page.locator('#case-list .case-card').first.click()
     if state in ['project','analysis']:
      if not page.locator('#sidebar-projects-body').is_visible():page.locator('[data-sidebar-module="projects"] .sidebar-module-toggle').click()
      menu=page.locator('[data-collection-id="p"] .project-menu');menu.locator('summary').click();menu.get_by_role('button',name='管理案例' if state=='project' else '批量分析',exact=True).click()
     dims=page.evaluate("""()=>{const mid=e=>{const r=e.getBoundingClientRect();return r.y+r.height/2};return {bar:mid(document.querySelector('.topbar')),title:mid(document.querySelector('#library-title')),count:mid(document.querySelector('#result-count')),overflow:document.documentElement.scrollWidth>innerWidth+1}}""")
     assert abs(dims['title']-dims['bar'])<2 and abs(dims['count']-dims['bar'])<2,dims
     assert not dims['overflow'],(width,state,dims)
     positions.append({'theme':theme,'width':width,'state':state,**dims})
     if state=='browse':
      page.locator('.case-table-scroll').evaluate('e=>{e.scrollLeft=e.scrollWidth;e.dispatchEvent(new Event("scroll"))}')
      aligned=page.evaluate("""()=>['title','type','count','source','size','added'].map(k=>({key:k,head:document.querySelector('[role=columnheader][data-column='+k+']').getBoundingClientRect().left,row:document.querySelector('.case-row-details [data-column='+k+']').getBoundingClientRect().left}))""")
      assert all(abs(x['head']-x['row'])<2 for x in aligned),(width,aligned)
      page.locator('.case-table-scroll').evaluate('e=>{e.scrollLeft=0;e.dispatchEvent(new Event("scroll"))}')
     page.mouse.move(5,810);page.screenshot(path=str(OUT/f'{theme}-{width}-{state}.png'))
     if state=='manage':page.locator('#share-cancel').click()
     if state in ['project','analysis']:page.locator('#project-selection-cancel').click()
  page.set_viewport_size({'width':1440,'height':820});page.locator('[data-collection-id="empty"] .project-filter').click()
  expect(page.locator('#empty-filter')).to_contain_text('这个项目还没有案例');expect(page.locator('#case-list-header')).to_be_hidden()
  page.screenshot(path=str(OUT/'empty-project.png'))
  page.locator('#empty-filter button').click();expect(page.locator('#project-selection-actions')).to_be_visible();page.locator('#project-selection-cancel').click()
  after=setup.evaluate("()=>import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get(['entries','organizerState']))");assert before==after
  (OUT/'checks.json').write_text(json.dumps({'positions':positions,'headerCoordinates':coords,'dataUnchanged':before==after,'deepZoomAnchor':anchor},ensure_ascii=False,indent=2))
  page.close()
  s.seed_storage(setup,{'entries':[],'organizerState':{'version':7,'collections':[]}})
  empty=s.open_page('library.html',wait_until='networkidle')
  if empty.locator('#settings-dialog').is_visible():
   empty.locator('#settings-close').click()
  expect(empty.locator('#empty-library')).to_be_visible()
  expect(empty.locator('#empty-import')).to_be_visible()
  expect(empty.locator('#empty-curated')).to_be_visible()
  expect(empty.locator('#case-list-header')).to_be_hidden()
  empty.screenshot(path=str(OUT/'empty-library.png'))
  assert not s.page_errors,s.page_errors
  print('PASS: sort full result, metadata, zoom persistence, column visibility, alignment/states/themes, data unchanged')

if __name__=='__main__':main()
