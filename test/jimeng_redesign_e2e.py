"""Reduced public Jimeng redesign fixtures. Real injected readers, inner scrolling and storage; no live-site or permission-grant claim."""
import json
from e2e_support import extension_session
from page_capture_e2e import fixture_png

ORIGIN = "https://jimeng.jianying.com"
WORK_ID = "7490123456789012345"


def work(work_id, author):
    return {"commonAttr": {"id": work_id, "createTime": 1786000000},
            "author": {"name": author}, "text2imageParams": {"prompt": f"{author}的第一段提示词\n第二段提示词"},
            "modelInfo": {"modelName": "图片 4.7"},
            "image": {"largeImages": [{"imageUrl": f"https://p3-dreamina-sign.byteimg.com/{work_id}.png", "width": 1440, "height": 2560}]}}


def main():
    first, second = work(WORK_ID, "作者甲"), work("7490123456789012346", "作者乙")
    feed_html = f'''<!doctype html><html><meta charset="utf-8"><title>探索结构测试</title>
<div id="scroll" style="height:500px;overflow-y:auto"><section aria-label="Explore content" aria-busy="false"><div id="space" style="height:1300px"></div></section></div>
<script>
const feed=document.querySelector('section'), scroller=document.querySelector('#scroll');
const state={{feedItems:[{json.dumps(first)}]}};
feed.__reactFiber$fixture={{memoizedProps:{{pageState:state}},return:null}};
let requested=false;
scroller.addEventListener('scroll',()=>{{
 if(requested || scroller.scrollTop+scroller.clientHeight<scroller.scrollHeight-1)return;
 requested=true;feed.setAttribute('aria-busy','true');
 setTimeout(()=>{{state.feedItems.push({json.dumps(second)});document.querySelector('#space').style.height='1800px';feed.setAttribute('aria-busy','false');}},150);
}});
</script></html>'''
    detail_html = f'''<!doctype html><meta charset="utf-8"><title>直接详情测试</title>
<div data-detail-container-appearance><p>作者甲</p><p>图片提示词</p></div><img src="https://p3-dreamina-sign.byteimg.com/unrelated.png" style="width:500px;height:500px"><p>后台其他作品文字不应进入当前案例</p>
<script>window._ROUTER_DATA = {json.dumps({"loaderData": {"ai-tool/work-detail/(id$)/page": {"workDetail": {"ok": True, "value": first}}}})};</script>'''
    with extension_session("jimeng-redesign-") as run:
        run.context.route(f"{ORIGIN}/**", lambda route: route.fulfill(body=detail_html if "/work-detail/" in route.request.url else feed_html, content_type="text/html"))
        run.context.route("https://p3-dreamina-sign.byteimg.com/**", lambda route: route.fulfill(body=fixture_png(route.request.url), content_type="image/png", headers={"Access-Control-Allow-Origin": "*"}))
        setup = run.open_page("collector.html")
        run.seed_storage(setup, {"entries": []})
        functions = setup.evaluate("""async()=>({site:(await import('./page-capture-site-adapters.js')).collectPageCaptureSitePayload.toString(),
          scan:(await import('./page-capture.js')).collectPageCaptureSnapshot.toString(),
          adapters:(await import('./page-capture-adapter-registry.js')).PAGE_CAPTURE_ADAPTERS,
          limits:(await import('./resource-limits.js')).PAGE_CAPTURE_LIMITS,
          maxTextCharacters:(await import('./resource-limits.js')).PORTABLE_LIBRARY_LIMITS.maxLibraryJsonBytes})""")
        page = run.context.new_page()
        page.goto(f"{ORIGIN}/ai-tool/explore")
        opts = {"maxCandidates": functions["limits"]["maxCandidates"], "maxMedia": functions["limits"]["maxMediaPerCandidate"], "maxTextCharacters": functions["maxTextCharacters"]}
        def read():
            payload = page.evaluate("options => (" + functions["site"] + ")(options)", opts)
            return setup.evaluate("async p => (await import('./page-capture-site-adapters.js')).normalizePageCaptureSitePayload(p)", payload)
        site = read()
        assert len(site["candidates"]) == 1
        page.evaluate("options => (" + functions["scan"] + ")(options)", {"mode": "whole", "siteData": site, "adapters": functions["adapters"], "maxCandidates": 2, "maxMedia": opts["maxMedia"], "maxScrollSteps": functions["limits"]["maxScrollSteps"], "mediaTimeoutMs": functions["limits"]["navigationTimeoutMs"]})
        after = read()
        assert len(after["candidates"]) == 2, after
        assert page.locator("#scroll").evaluate("e=>e.scrollTop") == 0
        assert page.locator("section").get_attribute("aria-busy") == "false"
        page.goto(f"{ORIGIN}/ai-tool/work-detail/{WORK_ID}")
        detail = read()
        assert len(detail["candidates"]) == 1
        snapshot = page.evaluate("options => (" + functions["scan"] + ")(options)", {"mode": "loaded", "siteData": detail, "adapters": functions["adapters"], "maxCandidates": 100, "maxMedia": opts["maxMedia"]})
        assert len(snapshot["candidates"]) == 1, snapshot
        candidate = snapshot["candidates"][0]
        assert len(candidate["media"]) == 1, candidate
        assert "后台其他作品" not in candidate["contentText"], candidate
        assert candidate["media"][0]["url"] == first["image"]["largeImages"][0]["imageUrl"]
        assert candidate["media"][0]["width"] == 1440
        # Inline fixture bytes isolate persistence from native permission UI and network transport.
        import base64
        candidate["media"][0]["dataUrl"] = "data:image/png;base64," + base64.b64encode(fixture_png(candidate["media"][0]["url"])).decode()
        result = setup.evaluate("""async c=>chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch:{
          status:'ready',candidates:[c],selections:[{candidateId:c.id,includeText:true,selectedMediaIds:c.media.map(m=>m.id),mediaDecision:'confirmed'}]
        }})""", candidate)
        assert result["ok"], result
        entries = setup.evaluate("async()=> (await chrome.storage.local.get('entries')).entries")
        assert len(entries) == 1, entries
        entry = entries[0]
        assert entry["sourceFacts"]["itemId"] == WORK_ID
        assert entry["sourceFacts"]["author"] == "作者甲"
        assert len(entry["mediaAssets"]) == 1, entry
        assert "第二段提示词" in entry["text"], entry
        print({"delayed_batch_load_completed": True, "scroll_restored": True, "direct_original_image": True, "case_saved_and_read_back": True, "native_permissions_and_live_media_download": "not exercised"})


if __name__ == "__main__":
    main()
