"""Visible library cards must play animated originals, including with a stale still thumbnail."""
import base64
import sys
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session, base_entry

def assert_animates(image, page, label):
    first=image.screenshot()
    # Sample across the fixture's frame interval rather than landing on the
    # same frame of its loop because screenshot rendering also consumes time.
    for _ in range(8):
        page.wait_for_timeout(70)
        if image.screenshot()!=first: return
    raise AssertionError(label+': displayed pixels do not animate')

with extension_session('pd-animation-preview-', viewport={'width':1440,'height':900}) as run:
    setup=run.open_page('collector.html')
    files=[{'name':Path(p).name,'data':base64.b64encode(Path(p).read_bytes()).decode()} for p in sys.argv[1:]]
    if not files:
        generated=setup.evaluate('''async()=>{
          const chunk=(name,data)=>{const out=new Uint8Array(8+data.length+(data.length%2));out.set(new TextEncoder().encode(name));new DataView(out.buffer).setUint32(4,data.length,true);out.set(data,8);return out;};
          const join=parts=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};
          const frames=[];
          for(const color of ['red','blue']){const c=document.createElement('canvas');c.width=800;c.height=400;c.getContext('2d').fillStyle=color;c.getContext('2d').fillRect(0,0,800,400);
            const b=await new Promise(r=>c.toBlob(r,'image/webp'));const bytes=new Uint8Array(await b.arrayBuffer());
            const header=new Uint8Array(16);header[6]=31;header[7]=3;header[9]=143;header[10]=1;header[12]=200;
            const parts=[];for(let at=12;at+8<=bytes.length;){const tag=new TextDecoder().decode(bytes.slice(at,at+4)),size=new DataView(bytes.buffer).getUint32(at+4,true),end=at+8+size+(size%2);if(['VP8 ','VP8L','ALPH'].includes(tag))parts.push(bytes.slice(at,end));at=end;}frames.push(chunk('ANMF',join([header,...parts])));}
          const ext=new Uint8Array(10);ext[0]=2;ext[4]=31;ext[5]=3;ext[7]=143;ext[8]=1;
          const payload=join([new TextEncoder().encode('WEBP'),chunk('VP8X',ext),chunk('ANIM',new Uint8Array(6)),...frames]);
          return btoa(String.fromCharCode(...chunk('RIFF',payload)));
        }''')
        files=[{'name':'animated.webp','data':generated}]
    entries=[]
    for i,f in enumerate(files):
        entry=base_entry('animation-'+str(i),f['name'],'Animation preview','content-film')
        entry.update(mediaAssets=[{'id':'animation-asset-'+str(i),'kind':'image','mimeType':'image/webp','storageMode':'managed','width':800,'height':400}],primaryMediaId='animation-asset-'+str(i))
        entries.append(entry)
    run.seed_storage(setup,{'entries':entries})
    setup.evaluate('''async files=>{
      const {saveMediaBlob,saveDerivedMedia}=await import('./media-store.js');
      for(let i=0;i<files.length;i++){
        const bytes=Uint8Array.from(atob(files[i].data),c=>c.charCodeAt(0));const blob=new Blob([bytes],{type:'image/webp'});
        await saveMediaBlob('animation-asset-'+i,blob);
        const bitmap=await createImageBitmap(blob),c=document.createElement('canvas');c.width=200;c.height=100;c.getContext('2d').drawImage(bitmap,0,0,200,100);bitmap.close();
        await saveDerivedMedia('animation-asset-'+i,{thumbnail:await new Promise(r=>c.toBlob(r,'image/webp'))});
      }
    }''',files)
    page=run.open_page('library.html',wait_until='networkidle')
    for i,f in enumerate(files):
        card=page.locator('[data-entry-id="animation-'+str(i)+'"].case-card');expect(card).to_be_visible()
        image=card.locator('img').first
        expect(image).to_have_attribute('src',__import__('re').compile('blob:'))
        captured=image.evaluate('async image=>{const b=await (await fetch(image.src)).blob();return new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(",")[1]);r.readAsDataURL(b)})}')
        assert captured==f['data'],f['name']+': the card uses a static derivative instead of the animated original'
        assert_animates(image,page,f['name'])
    print('PASS: animated originals play in visible library cards even when old static thumbnails exist; original bytes retained',len(files))
    origin='https://wchao6891.github.io'
    def route(r):
        path=r.request.url.split(origin)[-1]
        if path.endswith('.webp'):
            return r.fulfill(body=base64.b64decode(files[int(path.split('/')[-1].split('.')[0])]['data']),content_type='image/webp')
        r.fulfill(body='<main><h1>Animation capture</h1><p>Original animated media preview</p>'+''.join('<img width="800" height="400" src="/'+str(i)+'.webp">' for i in range(len(files)))+'</main>',content_type='text/html')
    run.context.route(origin+'/**',route)
    source=run.context.new_page();source.goto(origin+'/animations');source.bring_to_front()
    setup.evaluate("()=>chrome.storage.local.set({capturePermissionOnboarding:{version:1,acknowledgedAt:new Date().toISOString(),clipboardIncluded:true}})")
    setup.reload()
    source.bring_to_front();setup.locator('#start-page-capture').evaluate('e=>e.click()')
    preview=setup.locator('.page-capture-thumbnail img').first
    expect(preview).to_have_attribute('src',origin+'/0.webp')
    setup.bring_to_front()
    assert_animates(preview,setup,'Capture preview')
    print('PASS: generic capture preview uses and animates source media before saving')
