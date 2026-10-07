"""User feedback: shared zoom, poster centers, quiet headers and consistent menus."""
from pathlib import Path
import os,json
from playwright.sync_api import expect
from e2e_support import extension_session,base_entry

OUT=Path(os.environ.get('PD_LAYOUT_FEEDBACK_EVIDENCE','/tmp/pd-layout-feedback'))
OUT.mkdir(parents=True,exist_ok=True)

def main():
 with extension_session('pd-layout-feedback-',viewport={'width':1440,'height':820}) as s:
  setup=s.open_page('collector.html')
  entries=[]
  for i in range(18):
   w,h=(640,360) if i%2==0 else (360,640)
   e=base_entry(f'v{i}',f'视频案例 {i:02}','完整视频原词','content:video-case',i)
   e.update(mediaAssets=[{'id':f'v{i}','kind':'video','storageMode':'managed','width':w,'height':h,'durationMs':15000},
      {'id':f'p{i}','kind':'image','usage':'poster','width':w,'height':h,'mimeType':'image/png','storageMode':'managed','assetPath':f'media/p{i}.png'}],primaryMediaId=f'v{i}',coverMediaId=f'p{i}')
   entries.append(e)
  s.seed_storage(setup,{'entries':entries,'uiPreferences':{'locale':'zh-CN','motion':'reduced','galleryZoom':50},'organizerState':{'version':7,'collections':[{'id':'root','name':'项目','entryIds':['v0']},{'id':'child','parentId':'root','name':'子项目','entryIds':['v1']}]}})
  setup.evaluate("""async()=>{const {saveMediaBlob}=await import('./media-store.js');for(let i=0;i<18;i++){const c=document.createElement('canvas');c.width=i%2?360:640;c.height=i%2?640:360;const ctx=c.getContext('2d');ctx.fillStyle=i%2?'#8a6040':'#386578';ctx.fillRect(0,0,c.width,c.height);await saveMediaBlob('p'+i,await new Promise(r=>c.toBlob(r)));}}""")
  before=setup.evaluate("()=>import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get(['entries','organizerState']))")
  p=s.open_page('library.html',wait_until='networkidle');expect(p.locator('#gallery-size')).to_have_value('50')
  assert p.locator('.size-mark').count()==0
  centers=[]
  for view in ['waterfall','list']:
   p.locator(f'[data-gallery-view="{view}"]').click();expect(p.locator('.gallery-shell')).to_have_attribute('data-view',view)
   for zoom in [0,50,100]:
    p.locator('#gallery-size').fill(str(zoom));p.locator('#gallery-size').dispatch_event('change');p.wait_for_timeout(150)
    values=p.locator('.case-video-poster').evaluate_all("""els=>els.map(e=>{const r=e.getBoundingClientRect(),c=e.querySelector('.case-video-cue').getBoundingClientRect(),a=e.closest('.case-card').getBoundingClientRect();return {width:r.width,cardWidth:a.width,x:r.x+r.width/2-c.x-c.width/2,y:r.y+r.height/2-c.y-c.height/2}})""")
    assert values and all(abs(v['x'])<1 and abs(v['y'])<1 and v['width']<=v['cardWidth'] for v in values),(view,zoom,values)
    centers.append({'view':view,'zoom':zoom,'values':values})
    if zoom==0:p.screenshot(path=str(OUT/f'{view}-small.png'))
   p.locator('#gallery-size').dblclick();expect(p.locator('#gallery-size')).to_have_value('50')
   p.wait_for_function("getComputedStyle(document.querySelector('.gallery-shell')).getPropertyValue('--list-thumb')==='48px'")
   p.wait_for_function("getComputedStyle(document.querySelector('.gallery-shell')).getPropertyValue('--masonry-card-min-width')==='270px'")
  # Switching view keeps exactly the same slider position, including after reload.
  p.locator('#gallery-size').fill('76');p.locator('#gallery-size').dispatch_event('change')
  p.locator('[data-gallery-view="waterfall"]').click();expect(p.locator('#gallery-size')).to_have_value('76')
  p.locator('[data-gallery-view="list"]').click();expect(p.locator('#gallery-size')).to_have_value('76')
  p.reload(wait_until='networkidle');expect(p.locator('#gallery-size')).to_have_value('76')
  p.locator('#gallery-size').dblclick();expect(p.locator('#gallery-size')).to_have_value('50')
  # Pointer sorting has no full-cell hover fill or focus frame; keyboard focus is visible.
  title=p.locator('[data-sort-column="title"]');title.click();title.hover()
  css=title.evaluate("e=>{const c=getComputedStyle(e);return {background:c.backgroundColor,outline:c.outlineStyle,shadow:c.boxShadow}}")
  assert css=={'background':'rgba(0, 0, 0, 0)','outline':'none','shadow':'none'},css
  p.keyboard.press('Tab')
  assert p.evaluate("getComputedStyle(document.activeElement).boxShadow!=='none'")
  title.click();p.mouse.move(5,810);p.screenshot(path=str(OUT/'list-header.png'))
  # Scope is a topbar control only, reads and saves the same preference.
  p.locator('[data-collection-id="root"] .project-filter').click()
  scope=p.locator('#include-subprojects');expect(scope).to_be_visible();expect(scope).not_to_be_checked()
  assert scope.evaluate("e=>!!e.closest('.topbar')")
  assert p.locator('.project-menu .include-subprojects').count()==0
  expect(p.locator('#case-list .case-card')).to_have_count(1)
  scope.check();expect(p.locator('#case-list .case-card')).to_have_count(2)
  p.reload(wait_until='networkidle')
  project=p.locator('[data-collection-id="root"] .project-filter')
  if project.get_attribute('aria-pressed')!='true':project.click()
  expect(scope).to_be_visible();expect(scope).to_be_checked()
  expect(p.locator('#case-list .case-card')).to_have_count(2)
  p.screenshot(path=str(OUT/'project-scope.png'))
  p.locator('#select-cases').click();p.locator('#case-list .case-card').first.click();p.locator('#selection-more-menu summary').click()
  menu=p.locator('#selection-more-menu .ui-action-menu');expect(menu).to_be_visible()
  assert menu.locator('button .ui-icon').count()==6
  expect(menu.locator('#share-export')).to_have_class('button-primary')
  p.screenshot(path=str(OUT/'management-menu.png'))
  p.locator('#selection-more-menu summary').click();p.locator('#share-cancel').click()
  after=setup.evaluate("()=>import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get(['entries','organizerState']))");assert after==before
  assert not s.page_errors,s.page_errors
  (OUT/'checks.json').write_text(json.dumps({'centers':centers,'pointerHeader':css,'dataUnchanged':True},ensure_ascii=False,indent=2))
  print('PASS: shared zoom/reset, video centers at min/default/max, pointer/keyboard headers, topbar scope, shared menu and unchanged data')

if __name__=='__main__':main()
