"""Synthetic current-post responses. Actual extension capture, local MP4 and independent HLS playback."""
import json, tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import EXTENSION_DIR, extension_session
from page_capture_e2e import fixture_png

WORK='https://x.com/director/status/123'
CDN='https://video.twimg.com'
MEDIA=Path(__file__).parent/'fixtures/hls-audio-video'


def main():
    with tempfile.TemporaryDirectory(prefix='x-video-extension-') as temp:
        extension=Path(temp)
        for file in EXTENSION_DIR.iterdir():
            if file.name not in {'manifest.json','.git','node_modules','dist'}:
                (extension/file.name).symlink_to(file,target_is_directory=file.is_dir())
        # Chrome dynamic content scripts must be real files, as in the final archive.
        (extension/'x-video-observer.js').unlink()
        (extension/'x-video-observer.js').write_bytes((EXTENSION_DIR/'x-video-observer.js').read_bytes())
        manifest=json.loads((EXTENSION_DIR/'manifest.json').read_text())
        manifest['host_permissions']+=['https://x.com/*',CDN+'/*','https://pbs.twimg.com/*']
        (extension/'manifest.json').write_text(json.dumps(manifest))
        with extension_session('x-video-playback-',extension_dir=extension) as run:
            mode={'stream':False}; loads=[]
            video_bytes=b''.join((MEDIA/name).read_bytes() for name in ['init.mp4','stream0.m4s','stream1.m4s','stream2.m4s'])
            document='''<html><head><link rel="canonical" href="'''+WORK+'''"></head><body><main><article data-testid="tweet">
            <div data-testid="User-Name"><a href="/director"><span>Director</span></a></div>
            <div data-testid="tweetText">A cinematic fight scene with a real video. Preserve this description without inventing a prompt.</div>
            <video poster="https://pbs.twimg.com/custom.jpg" style="width:640px;height:360px"></video>
            <a href="/director/status/123"><time datetime="2026-09-09T00:00:00Z">Today</time></a>
            </article></main><script>fetch('/i/api/graphql/fixture').then(r=>r.json());</script></body></html>'''
            def site(route):
                if '/i/api/' in route.request.url:
                    variant={'url':CDN+('/stream.m3u8' if mode['stream'] else '/work.mp4'),'content_type':'application/x-mpegURL' if mode['stream'] else 'video/mp4','bitrate':100}
                    post=lambda id,variants:{'rest_id':id,'legacy':{'extended_entities':{'media':[{'id_str':'video-'+id,'media_url_https':'https://pbs.twimg.com/custom.jpg','video_info':{'variants':variants}}]}}}
                    route.fulfill(json={'data':[post('999',[{'url':CDN+'/wrong.mp4','content_type':'video/mp4','bitrate':999999}]),post('123',[variant])]})
                else:
                    loads.append(route.request.url);route.fulfill(body=document,content_type='text/html')
            def media(route):
                name=route.request.url.rsplit('/',1)[-1]
                if name=='work.mp4':route.fulfill(body=video_bytes,content_type='video/mp4')
                elif (MEDIA/name).is_file():route.fulfill(body=(MEDIA/name).read_bytes(),content_type='application/vnd.apple.mpegurl' if name.endswith('m3u8') else 'video/mp4',headers={'Access-Control-Allow-Origin':'*'})
                else:route.fulfill(status=403)
            run.context.route('https://x.com/**',site)
            run.context.route(CDN+'/**',media)
            run.context.route('https://pbs.twimg.com/**',lambda r:r.fulfill(body=fixture_png(r.request.url),content_type='image/png'))
            collector=run.open_page('collector.html');run.seed_storage(collector,{'entries':[]})
            source=run.context.new_page();source.goto(WORK,wait_until='networkidle');source.bring_to_front()
            batch=collector.evaluate("async()=>{const r=await chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'});if(!r.ok)throw Error(r.message);return r.batch;}")
            candidate=batch['candidates'][0]
            assert candidate['media'][0]['url']==CDN+'/work.mp4',batch
            assert len(loads)==2,loads
            assert collector.evaluate('async()=> (await chrome.scripting.getRegisteredContentScripts()).length')==0
            batch['selections']=[{'candidateId':candidate['id'],'includeText':True,'selectedMediaIds':[candidate['media'][0]['id']],'mediaDecision':'confirmed'}]
            result=collector.evaluate("async batch=>chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch})",batch)
            assert result['ok'],result
            entries=collector.evaluate("async()=> (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
            asset=next(a for a in entries[0]['mediaAssets'] if a['kind']=='video')
            assert asset['storageMode']=='managed' and asset['byteSize']==len(video_bytes),asset
            library=run.open_page('library.html');library.locator('.case-card').first.click()
            video=library.locator('#detail-drawer video').first
            video.evaluate('(v)=>{v.muted=true;return v.play();}')
            library.wait_for_function("()=>{const v=document.querySelector('#detail-drawer video');return v?.ended;}")
            assert video.evaluate('v=>v.webkitAudioDecodedByteCount>0 && v.webkitVideoDecodedByteCount>0')
            library.locator('#detail-close').click()
            # Exercise a second capture with HLS-only normal page data, then the real save path.
            mode['stream']=True
            collector.evaluate("async()=>chrome.storage.local.set({entries:[]})")
            source.bring_to_front()
            stream_batch=collector.evaluate("async()=>{const r=await chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'});if(!r.ok)throw Error(r.message);return r.batch;}")
            stream_candidate=stream_batch['candidates'][0]
            assert stream_candidate['media'][0]['streamUrl']==CDN+'/stream.m3u8',stream_batch
            stream_batch['selections']=[{'candidateId':stream_candidate['id'],'includeText':True,'selectedMediaIds':[stream_candidate['media'][0]['id']],'mediaDecision':'confirmed'}]
            stream_result=collector.evaluate("async batch=>chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch})",stream_batch)
            assert stream_result['ok'],stream_result
            stream_entries=collector.evaluate("async()=> (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
            stream_asset=next(a for a in stream_entries[0]['mediaAssets'] if a['kind']=='video')
            assert stream_asset['storageMode']=='reference' and stream_asset['reference']['url']==WORK,stream_asset
            library.reload();library.locator('.case-card').first.click()
            video=library.locator('.referenced-video-stream video');expect(video).to_be_visible()
            expect(library.locator('.referenced-video-stream iframe')).to_have_count(0)
            video.evaluate('(v)=>{v.muted=true;return v.play();}')
            library.wait_for_function("()=>{const v=document.querySelector('.referenced-video-stream video');return v?.currentTime>0.5;}")
            video.evaluate('(v)=>v.currentTime=2')
            library.wait_for_function("()=>document.querySelector('.referenced-video-stream video')?.ended")
            evidence=video.evaluate('v=>({audio:v.webkitAudioDecodedByteCount,video:v.webkitVideoDecodedByteCount,duration:v.duration})')
            assert evidence['audio']>0 and evidence['video']>0 and abs(evidence['duration']-3.2)<0.01,evidence
            library.evaluate("()=>window.closedPlayer=document.querySelector('.referenced-video-stream video')")
            library.locator('#detail-close').click()
            assert library.evaluate("()=>window.closedPlayer.paused && !window.closedPlayer.getAttribute('src')")
            run.context.route(CDN+'/stream.m3u8',lambda r:r.fulfill(status=403))
            library.locator('.case-card').first.click()
            expect(library.locator('.referenced-video-stream .media-playback-status')).to_contain_text('视频暂不可播放')
            expect(library.locator('.referenced-video-stream iframe')).to_have_count(0)
            library.locator('#detail-close').click()
            print({'selected_post_only':True,'local_video_with_audio':True,'hls_audio_video_seek':evidence,'no_post_embed':True,'temporary_observer_removed':True})

if __name__=='__main__':main()
