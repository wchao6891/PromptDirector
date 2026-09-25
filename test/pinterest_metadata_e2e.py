"""User-reported public Pin metadata survives both board and detail capture."""
import json,tempfile
from pathlib import Path
from datetime import datetime,timezone
from e2e_support import EXTENSION_DIR,extension_session
from page_capture_e2e import PNG


def main():
    pin=json.loads((Path(__file__).parent/'fixtures/pinterest-pin-metadata.json').read_text())
    url=f'https://www.pinterest.com/pin/{pin["entityId"]}/'
    board='https://www.pinterest.com/fixture/metadata/'
    script='<script>window.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__=()=>{};window.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__("public", '+json.dumps({'data':{'v3GetPinQueryv2':{'data':pin}}})+');</script>'
    detail=script+f'''<main aria-label="Closeup content container"><h1>{pin['title']}</h1><img src="{pin['images_orig']['url']}" width=240 height=320><div><div><div><div><button aria-label="回应">回应</button></div></div><span>252</span></div><div><button aria-label="评论"></button></div></div></main>'''
    with tempfile.TemporaryDirectory(prefix='pd-pin-metadata-') as tmp:
        extension=Path(tmp)
        for path in EXTENSION_DIR.iterdir():
            if path.name!='manifest.json':(extension/path.name).symlink_to(path,target_is_directory=path.is_dir())
        manifest=json.loads((EXTENSION_DIR/'manifest.json').read_text());manifest['host_permissions']+=['https://www.pinterest.com/*','https://i.pinimg.com/*']
        (extension/'manifest.json').write_text(json.dumps(manifest))
        with extension_session('pd-pin-metadata-',extension_dir=extension) as run:
            run.context.route('https://i.pinimg.com/**',lambda r:r.fulfill(status=200,content_type='image/png',body=PNG))
            run.context.route('https://www.pinterest.com/**',lambda r:r.fulfill(status=200,content_type='text/html; charset=utf-8',body=detail if '/pin/' in r.request.url else f'<main><div data-test-id="pinWrapper"><a href="{url}"><img alt="其中包括图片：" src="{pin["images_orig"]["url"]}" width=240 height=320></a></div></main>'))
            setup=run.open_page('collector.html');run.seed_storage(setup,{'entries':[],'capturePermissionOnboarding':{'version':1,'acknowledgedAt':datetime.now(timezone.utc).isoformat(),'clipboardIncluded':True}})
            source=run.context.new_page()
            for page in [board,url]:
                source.goto(page);source.bring_to_front()
                captured=setup.evaluate("async()=>chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'})")
                assert captured.get('ok'),captured
                c=captured['batch']['candidates'][0]
                assert c['title']=='Wukong vs heaven',c
                assert c['sourceFacts']['author']=='ʀᴇᴅɢʀᴀᴠᴇ',c
                assert c['sourceFacts']['engagement']['repins']==471,c
                if page==url:
                    assert c['sourceFacts']['engagement']['reactions']==252,c
                    chosen=setup.evaluate("async c=>(await import('./page-capture.js')).pageCaptureDefaultMediaIds(c)",c)
                    assert len(chosen)==1,c
            batch=captured['batch']
            batch['selections']=[{'candidateId':c['id'],'includeText':True,'selectedMediaIds':[m['id'] for m in c['media']],'mediaDecision':'confirmed'}]
            saved=setup.evaluate("async batch=>chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch})",batch);assert saved.get('ok'),saved
            setup.reload();entries=setup.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
            assert len(entries)==1,entries
            work=entries[0];assert work['title']=='Wukong vs heaven',work
            facts=work['sourceFacts'];assert facts['authorUrl']=='https://www.pinterest.com/LastSon_/',facts
            assert facts['engagement']=={'repins':471,'reactions':252},facts
            assert facts['publishedAt'] and facts['imageDescription'],facts
            print('PASS board detail hydration and single Pin save/reload: title, creator/profile, published time, image description, 471 saves and 252 reactions')

if __name__=='__main__':main()
