"""Synthetic WeChat-style rich text. No request to a real WeChat article is made."""
import json,tempfile,hashlib,struct,zlib
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import EXTENSION_DIR,extension_session
def image_bytes(url):
 # Distinct valid pixels prevent the library's content deduplication merging fixture images.
 rgb=hashlib.sha256(url.encode()).digest()[:3]
 def chunk(kind,data):
  return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b'\0'+rgb))+chunk(b'IEND',b'')
URL='https://mp.weixin.qq.com/s/promptdirector-synthetic-article'
HTML='''<html><head><meta charset="utf-8"><title>Rich text cases</title></head><body><h1 id="activity-name">Rich text cases</h1><span id="js_name">Fixture author</span><div id="js_content"><p>Article introduction</p><img data-src="https://mmbiz.qpic.cn/intro.png" width="160" height="120">'''+''.join(f'''<section><section><strong>{i}、案例{i}</strong></section><section><span>提示词：</span></section><section><span>Generate scene {i} with its own visual composition.</span></section>'''+''.join(f'<img data-src="https://mmbiz.qpic.cn/case-{i}-{n}.png" width="160" height="120">' for n in range(i))+ '</section>' for i in range(1,4))+ '</div></body></html>'

def main():
 with tempfile.TemporaryDirectory(prefix='pd-article-case-fixture-') as tmp:
  ext=Path(tmp)
  for f in EXTENSION_DIR.iterdir():
   if f.name!='manifest.json':(ext/f.name).symlink_to(f,target_is_directory=f.is_dir())
  manifest=json.loads((EXTENSION_DIR/'manifest.json').read_text());manifest['host_permissions']+=['https://mp.weixin.qq.com/*','https://*.qpic.cn/*']
  (ext/'manifest.json').write_text(json.dumps(manifest))
  with extension_session('pd-article-cases-',extension_dir=ext) as run:
   run.context.route('https://mp.weixin.qq.com/**',lambda r:r.fulfill(body=HTML,content_type='text/html'))
   run.context.route('https://*.qpic.cn/**',lambda r:r.fulfill(body=image_bytes(r.request.url),content_type='image/png'))
   panel=run.open_page('collector.html');panel.set_viewport_size({'width':390,'height':844})
   run.seed_storage(panel,{'entries':[],'capturePermissionOnboarding':{'version':1,'acknowledgedAt':'2026-09-12T00:00:00Z','clipboardIncluded':True}})
   source=run.context.new_page();source.goto(URL);source.bring_to_front()
   panel.locator('#start-page-capture').evaluate('e=>e.click()')
   expect(panel.locator('.page-capture-item')).to_have_count(1)
   panel.locator('#page-capture-mode').select_option('article')
   expect(panel.locator('.page-capture-item')).to_have_count(4,timeout=30000)
   expect(panel.locator('#page-capture-mode')).to_have_value('article')
   expect(panel.locator('#page-capture-save-mode')).to_have_value('multiple')
   expect(panel.locator('#page-capture-list-summary')).to_contain_text('3 个案例')
   expect(panel.locator('#page-capture-list-summary')).to_contain_text('1 组')
   panel.screenshot(path=str(ext/'article-cases-preview.png'),full_page=True)
   # Whole article remains available via the same mode control.
   source.bring_to_front()
   panel.locator('#page-capture-mode').select_option('single')
   expect(panel.locator('.page-capture-item')).to_have_count(1,timeout=30000)
   expect(panel.locator('#page-capture-mode')).to_have_value('single')
   result=panel.evaluate("async()=>chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'})")
   assert len(result['batch']['candidates'])==1
   assert len(result['batch']['candidates'][0]['media'])==7
   batch_result=panel.evaluate("async()=>chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'list',targetCount:6})")
   assert batch_result['ok'] and len(batch_result['batch']['candidates'])==4,batch_result
   source.bring_to_front()
   panel.locator('#page-capture-mode').select_option('article')
   expect(panel.locator('.page-capture-item')).to_have_count(4,timeout=30000)
   panel.locator('#page-capture-save').click()
   panel.wait_for_function("async()=>{const s=await chrome.runtime.sendMessage({type:'GET_STATE'});return s.entries.length===3}")
   entries=panel.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
   for i in range(1,4):
    entry=next(e for e in entries if e['title']==f'{i}、案例{i}')
    assert len(entry['mediaAssets'])==i,(i,entry)
    assert f'Generate scene {i}' in entry['text']
    assert 'Article introduction' not in entry['text']
    assert all(a.get('byteSize',0)>0 for a in entry['mediaAssets'])
   print('PASS: rich-text paragraph boundaries, per-case image sets, unassigned intro, UI mode/saving and whole-article retention')

if __name__=='__main__':main()
