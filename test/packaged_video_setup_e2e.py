"""Fresh extension -> setup UI -> real packaged Native Messaging -> original readback.

Run after package:video-component with VIDEO_COMPONENT_DIRECTORY pointing to the
payload (or extracted installed directory). Download transport and the OS install
click are controlled fixtures; native readiness and the saved video are real.
"""
import json
import os
import shutil
import tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import EXTENSION_DIR, extension_session, wait_for_async_condition


def main():
    payload = Path(os.environ['VIDEO_COMPONENT_DIRECTORY']).resolve()
    evidence = Path(os.environ.get('VIDEO_COMPONENT_EVIDENCE', tempfile.mkdtemp(prefix='video-setup-evidence-')))
    evidence.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='video-setup-extension-') as temp:
        extension = Path(temp) / 'extension'
        extension.mkdir()
        installed = Path(temp) / 'installed-video'
        # Native apps inherit macOS privacy restrictions from Chrome. The build
        # checkout may live in protected Desktop/Documents; real installers put
        # the executable outside those folders. Exercise that same boundary.
        shutil.copytree(payload, installed)
        payload = installed
        for file in EXTENSION_DIR.iterdir():
            if file.name not in ['manifest.json', 'background.js']:
                (extension / file.name).symlink_to(file, target_is_directory=file.is_dir())
        manifest = json.loads((EXTENSION_DIR / 'manifest.json').read_text())
        # A Chrome permission dialog is outside this fixture. The actual setup
        # button still calls permissions.request inside its user gesture.
        for permission in ['nativeMessaging', 'downloads.open']:
            manifest['optional_permissions'].remove(permission)
            manifest['permissions'].append(permission)
        (extension / 'manifest.json').write_text(json.dumps(manifest))
        (extension / 'background.js').write_text("import './setup-transport-fixture.js';\n" + (EXTENSION_DIR / 'background.js').read_text())
        (extension / 'setup-transport-fixture.js').write_text("""
          const fetchOriginal = globalThis.fetch;
          globalThis.fetch = (url, options) => String(url).includes('/video-v') && options?.method === 'HEAD'
            ? Promise.resolve(new Response(null, {status:200})) : fetchOriginal(url,options);
          chrome.downloads.download = async options => {await chrome.storage.local.set({setupDownload: options}); return 123;};
          chrome.downloads.search = async () => [{state: (await chrome.storage.local.get('setupComplete')).setupComplete ? 'complete':'in_progress',bytesReceived:100,totalBytes:1000}];
          chrome.downloads.open = async id => chrome.storage.local.set({setupOpened:id});
        """)
        with extension_session('video-setup-profile-', extension_dir=extension) as run:
            collector = run.open_page('collector.html')
            run.seed_storage(collector, {'entries': [], 'dataSafetyOnboardingSeen': True})
            response = collector.evaluate("""async()=>{
              const {normalizePageCaptureBatch}=await import('./page-capture.js');
              const url='https://www.youtube.com/watch?v=jNQXAC9IVRw';
              const batch=normalizePageCaptureBatch({sourceUrl:url,sessionMediaAllowed:false,candidates:[{id:'zoo',title:'Me at the zoo',canonicalUrl:url,contentText:'Original video',pageType:'video',media:[{id:'video',kind:'video',url,originalWorkUrl:url}]}],selections:[{candidateId:'zoo',includeText:true,selectedMediaIds:['video'],mediaDecision:'confirmed'}]});
              return chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch});
            }""")
            assert response.get('code') == 'video_component_required', response
            collector.reload()
            expect(collector.locator('#video-component-setup button')).to_have_text('安装视频组件')
            for width in [390, 1280]:
                collector.set_viewport_size({'width': width, 'height': 850})
                collector.screenshot(path=str(evidence / f'required-{width}.png'))
            collector.locator('#video-component-setup button').click()
            expect(collector.locator('#video-component-setup')).to_contain_text('正在下载安装包')
            collector.screenshot(path=str(evidence / 'downloading.png'))
            collector.close()
            collector = run.open_page('collector.html')
            expect(collector.locator('#video-component-setup')).to_contain_text('正在下载安装包')
            collector.evaluate("async()=>chrome.storage.local.set({setupComplete:true})")
            expect(collector.locator('#video-component-setup button')).to_have_text('打开安装包', timeout=15000)
            collector.screenshot(path=str(evidence / 'open-installer.png'))
            collector.evaluate("() => {chrome.downloads.open = async id => chrome.storage.local.set({setupOpened:id});}")
            collector.locator('#video-component-setup button').click()
            assert wait_for_async_condition(collector, "async()=>(await chrome.storage.local.get('setupOpened')).setupOpened") == 123
            # Register the real offline payload for this disposable browser only.
            registration = run.profile_dir / 'NativeMessagingHosts/com.promptdirector.video.json'
            registration.parent.mkdir(parents=True, exist_ok=True)
            launcher = run.profile_dir / ('video-host.cmd' if os.name == 'nt' else 'video-host')
            node = payload / 'bin' / ('node.exe' if os.name == 'nt' else 'node')
            host = payload / 'connector/video-host.mjs'
            if os.name == 'nt':
                launcher.write_text(f'@echo off\r\n"{node}" "{host}" %*\r\n')
            else:
                import shlex
                launcher.write_text(f'#!/bin/sh\nexport PROMPTDIRECTOR_DEBUG=1\nexec {shlex.quote(str(node))} {shlex.quote(str(host))} "$@" 2>>{shlex.quote(str(evidence / "native-debug.log"))}\n')
                launcher.chmod(0o700)
            registration.write_text(json.dumps({'name':'com.promptdirector.video','description':'Isolated packaged component','path':str(launcher),'type':'stdio','allowed_origins':[f'chrome-extension://{run.extension_id}/']}))
            status = collector.evaluate("async()=>chrome.runtime.sendMessage({type:'GET_NATIVE_VIDEO_STATUS'})")
            print('Registered packaged host', status, flush=True)
            assert status.get('available'), status
            entry = wait_for_async_condition(collector, "async()=>{const s=await chrome.runtime.sendMessage({type:'GET_STATE'});return s.entries?.find(e=>e.title==='Me at the zoo');}", timeout=180000)
            collector.reload()
            readback = collector.evaluate("""async id=>{
              const s=await chrome.runtime.sendMessage({type:'GET_STATE'}),e=s.entries.find(e=>e.id===id),a=e.mediaAssets.find(a=>a.kind==='video');
              const b=await(await import('./media-store.js')).getMediaBlob(a.id);
              const v=document.createElement('video');v.muted=true;v.src=URL.createObjectURL(b);document.body.append(v);
              await new Promise((ok,no)=>{v.onloadeddata=ok;v.onerror=no;v.load()});await v.play();await new Promise(r=>setTimeout(r,200));
              const result={bytes:b.size,duration:v.duration,width:v.videoWidth,height:v.videoHeight,time:v.currentTime,storage:a.storageMode,count:s.entries.length};v.pause();return result;
            }""", entry['id'])
            assert readback['storage'] == 'managed' and readback['bytes'] > 0 and readback['time'] > 0 and readback['count'] == 1, readback
            wait_for_async_condition(collector, "async()=>!(await chrome.runtime.sendMessage({type:'GET_CAPTURE_SAVE_TASK'})).task")
            for locale, theme in [('zh-CN', 'dark'), ('en', 'light')]:
                collector.evaluate("async p=>chrome.runtime.sendMessage({type:'UPDATE_UI_PREFERENCES',preferences:p})", {'locale':locale,'theme':theme})
                library = run.open_page('library.html')
                expect(library.locator('#library-loading')).to_be_hidden()
                library.locator('#open-settings').click()
                expect(library.locator('#settings-dialog')).to_be_visible()
                library.locator('[data-settings-tab="general"]').click()
                for width in [390, 1280]:
                    library.set_viewport_size({'width':width,'height':850})
                    library.locator('#video-online-only').scroll_into_view_if_needed()
                    library.screenshot(path=str(evidence / f'settings-{locale}-{width}.png'))
                library.close()
            (evidence / 'receipt.json').write_text(json.dumps({'entryId':entry['id'],'readback':readback,'boundaries':['installer transfer controlled','OS installer UI not exercised','real bundled Node/yt-dlp/FFmpeg and Chrome native protocol']},ensure_ascii=False,indent=2))
            print(json.dumps(readback), evidence)


if __name__ == '__main__':
    main()
