"""Offline, playable media: reading anchors and DOM continuity, not model quality."""
import base64
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import base_entry, extension_session


def main():
    video = base_entry("stable-video", "视觉稳定视频", "", "content:prompt:video")
    video["mediaAssets"] = [{"id": "stable-media", "kind": "video", "usage": "content", "storageMode": "managed", "mimeType": "video/webm"}]
    video["primaryMediaId"] = "stable-media"
    video["videoAnalyses"] = [{"id": "offline-result", "assetId": "stable-media", "mode": "visual-reconstruction",
        "requestId": "offline-fixture", "contractVersion": "reconstruction-tags-json-v4-evidence", "analysisScope": "video", "includeTags": False,
        "reconstructionPrompt": "整体设定：\n" + "主体在空间中移动，镜头稳定推进。\n\n" * 140,
        "tags": [], "uncertainties": ["离线夹具不提供音轨证据"], "finishReason": "stop"}]
    related = [base_entry(f"related-{i}", f"视觉稳定参考 {i}", "主体在空间中移动，镜头稳定推进。", "content:prompt:video") for i in range(25)]
    with extension_session("detail-visual-stability-") as s:
        setup = s.open_page("collector.html")
        s.seed_storage(setup, {"entries": [video, *related], "uiPreferences": {"locale": "zh-CN", "motion": "reduced"}})
        setup.evaluate("""async () => {
          const canvas = document.createElement('canvas'); canvas.width=320; canvas.height=180;
          const ctx = canvas.getContext('2d'); ctx.fillStyle='#305070'; ctx.fillRect(0,0,320,180);
          const stream = canvas.captureStream(24), chunks=[];
          const recorder = new MediaRecorder(stream, {mimeType:'video/webm'});
          const done = new Promise(resolve => recorder.onstop=resolve);
          recorder.ondataavailable=e=>chunks.push(e.data); recorder.start();
          await new Promise(resolve => setTimeout(resolve,800)); recorder.stop(); await done;
          stream.getTracks().forEach(t=>t.stop());
          const {saveMediaBlob}=await import(chrome.runtime.getURL('media-store.js'));
          await saveMediaBlob('stable-media',new Blob(chunks,{type:'video/webm'}),{checkCapacity:false});
        }""")
        page = s.context.new_page()
        page.add_init_script("""const send=chrome.runtime.sendMessage.bind(chrome.runtime);
          chrome.runtime.sendMessage=async (...args)=>{
            const result=await send(...args);
            if(args[0]?.type==='GET_ENTRY_VIDEO_ANALYSIS_TASK') await new Promise(resolve=>window.releaseTaskQuery=resolve);
            return result;
          };""")
        page.goto(f"chrome-extension://{s.extension_id}/library.html", wait_until="networkidle")
        page.locator('.case-card[data-entry-id="stable-video"]').click()
        player = page.locator("video.detail-video")
        expect(player).to_be_visible()
        player.evaluate("async v=>{await new Promise(r=>v.readyState>=2?r():v.addEventListener('loadeddata',r,{once:true})); v.loop=true;v.muted=true;await v.play();window.stablePlayer=v;window.stableUrl=v.src;}")
        page.wait_for_function("() => !!window.releaseTaskQuery")
        page.evaluate("() => window.releaseTaskQuery()")
        page.evaluate("() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
        assert player.evaluate("v=>v===window.stablePlayer && v.src===window.stableUrl && !v.paused"), "空任务查询不能重建或暂停播放器"
        task = {"id": "offline-task", "status": "running", "phase": "analyzing", "request": {"kind": "entry_video", "entryId": video["id"], "assetId": "stable-media"}, "attempts": []}
        setup.evaluate("task=>chrome.runtime.sendMessage({type:'ANALYSIS_TASK_UPDATED',task})", task)
        expect(page.locator(".video-analysis-task-status")).to_be_visible()
        assert player.evaluate("v=>v===window.stablePlayer && v.src===window.stableUrl && !v.paused"), "进度反馈不能中断播放"
        panel = page.locator(".video-reconstruction-current")
        panel.get_by_role("button", name="编辑 AI 逆推提示词", exact=True).click()
        panel.locator("textarea").fill("不能丢失的用户草稿")
        setup.evaluate("task=>chrome.runtime.sendMessage({type:'ANALYSIS_TASK_UPDATED',task:{...task,phase:'processing'}})", task)
        expect(panel.locator("textarea")).to_have_value("不能丢失的用户草稿")
        setup.evaluate("""async task=>{
          const {entries}=await chrome.storage.local.get('entries');
          entries.find(e=>e.id===task.request.entryId).videoAnalyses[0].reconstructionPrompt += '\\n新的后台结果';
          await chrome.storage.local.set({entries});
          await chrome.runtime.sendMessage({type:'ANALYSIS_TASK_UPDATED',task:{...task,status:'completed',phase:'completed'}});
        }""", task)
        expect(panel.locator("textarea")).to_have_value("不能丢失的用户草稿")
        expect(page.locator(".video-analysis-task-status")).to_have_count(0)
        assert player.evaluate("v=>v===window.stablePlayer && v.src===window.stableUrl && !v.paused"), "完成反馈不能重建播放器"
        panel.get_by_role("button", name="取消", exact=True).click()
        expect(panel.locator(".prompt-read-body")).to_contain_text("新的后台结果")
        for width in (1280, 390):
            page.set_viewport_size({"width": width, "height": 844})
            panel.get_by_role("button", name="展开全文", exact=True).click()
            panel.get_by_role("button", name="收起", exact=True).click()
            location = panel.locator("h3").evaluate("e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight,scroll:document.querySelector('#detail-content').scrollTop}}")
            assert location["top"] >= 0 and location["bottom"] < location["height"], ("从底部收起须回到当前提示词标题", width, location)
            expect(panel.locator("h3")).to_be_focused()
            assert panel.get_by_role("button", name="编辑 AI 逆推提示词", exact=True).evaluate("e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}"), "收起后的编辑按钮不能被固定关闭按钮遮挡"
        expect(page.locator(".video-analysis-uncertainties, .prompt-route")).to_have_count(0)
        expect(page.get_by_role("button", name="添加原始提示词", exact=True)).to_have_count(0)
        panel.get_by_role("button", name="编辑 AI 逆推提示词", exact=True).click()
        panel.locator("textarea").fill("已保存的用户修订")
        panel.get_by_role("button", name="保存", exact=True).click()
        expect(panel.locator(".prompt-read-body")).to_have_text("已保存的用户修订")
        assert player.evaluate("v=>v===window.stablePlayer && v.src===window.stableUrl && !v.paused"), "保存提示词不能重新加载视频"
        page.get_by_role("button", name="关闭详情", exact=True).click()
        page.locator('.case-card[data-entry-id="related-0"]').click()
        page.locator(".detail-title").evaluate("e=>window.otherTitle=e")
        setup.evaluate("task=>chrome.runtime.sendMessage({type:'ANALYSIS_TASK_UPDATED',task})", task)
        assert page.locator(".detail-title").evaluate("e=>e===window.otherTitle"), "迟到消息不能刷新其他案例"
        expect(page.locator(".video-analysis-task-status")).to_have_count(0)
        print({"playableVideo": True, "emptyQuery": True, "progressContinuity": True, "draftProtected": True, "collapseAnchor": True})
        mp4 = base_entry("playable-mp4", "本地 MP4 播放回归", "原始提示词", "content:prompt:video")
        mp4["mediaAssets"] = [{"id": "mp4-media", "kind": "video", "usage": "content", "storageMode": "managed", "mimeType": "video/mp4"}]
        mp4["primaryMediaId"] = "mp4-media"
        encoded = base64.b64encode((Path(__file__).parent / "fixtures/zhipu-local-video-smoke.mp4").read_bytes()).decode()
        setup.evaluate("""async ({entry,encoded})=>{
          const {saveMediaBlob}=await import(chrome.runtime.getURL('media-store.js'));
          await saveMediaBlob('mp4-media',new Blob([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],{type:'video/mp4'}),{checkCapacity:false});
          const {entries}=await chrome.storage.local.get('entries'); await chrome.storage.local.set({entries:[...entries,entry]});
        }""", {"entry": mp4, "encoded": encoded})
        for theme in ("light", "dark"):
            page.close()
            setup.evaluate("async theme=>{const {uiPreferences}=await chrome.storage.local.get('uiPreferences');await chrome.storage.local.set({uiPreferences:{...uiPreferences,theme}})}", theme)
            setup.wait_for_load_state("networkidle")
            page = s.open_page("library.html", wait_until="networkidle")
            page.locator('.case-card[data-entry-id="playable-mp4"]').click()
            mp4_player = page.locator("video.detail-video")
            mp4_player.evaluate("async v=>{if(v.readyState<2)await new Promise(r=>v.addEventListener('loadeddata',r,{once:true}));window.mp4Player=v;window.mp4Url=v.src;v.muted=true;v.loop=true;}")
            before = mp4_player.bounding_box()
            frame = mp4_player.evaluate("async v=>{const frame=new Promise(r=>v.requestVideoFrameCallback((now,data)=>r({width:data.width,height:data.height})));await v.play();return frame;}")
            assert frame["width"] > 0 and frame["height"] > 0, frame
            page.evaluate("()=>window.releaseTaskQuery?.()")
            setup.evaluate("entry=>chrome.runtime.sendMessage({type:'ANALYSIS_TASK_UPDATED',task:{id:'mp4-offline',status:'running',phase:'analyzing',request:{kind:'entry_video',entryId:entry.id,assetId:'mp4-media'},attempts:[]}})", mp4)
            expect(page.locator(".video-analysis-task-status")).to_be_visible()
            assert mp4_player.evaluate("v=>v===window.mp4Player && v.src===window.mp4Url && !v.paused")
            after = mp4_player.bounding_box()
            assert abs(before["height"]-after["height"]) <= 1 and abs(before["width"]-after["width"]) <= 1, (before, after)
        print({"mp4DecodedFrame": frame, "themes": 2, "playAndProgressGeometry": "stable"})


if __name__ == "__main__":
    main()
