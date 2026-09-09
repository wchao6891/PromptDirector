"""Reduced DOM based on a public ArtStation project; isolated fixtures, not live-site acceptance."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

from e2e_support import EXTENSION_DIR, extension_session
from page_capture_e2e import fixture_png

SITE = "https://fixture-artist.artstation.com"
PLAYER = "https://www.artstation.com"
CDN = "https://cdn.artstation.com"
WORK = f"{SITE}/projects/fixture"
FRAME = f"{PLAYER}/api/v2/animation/video_clips/fixture/embed.html?s=fixture"
VIDEO = f"{CDN}/p/video_sources/fixture.mp4"


def main():
    with tempfile.TemporaryDirectory(prefix="artstation-extension-") as temp:
        extension = Path(temp)
        for file in EXTENSION_DIR.iterdir():
            if file.name not in {"manifest.json", ".git", "node_modules", "dist"}:
                (extension / file.name).symlink_to(file, target_is_directory=file.is_dir())
        manifest = json.loads((EXTENSION_DIR / "manifest.json").read_text())
        # Only this disposable fixture install gets pre-granted test origins.
        manifest["host_permissions"] += [f"{origin}/*" for origin in (SITE, PLAYER, CDN)]
        (extension / "manifest.json").write_text(json.dumps(manifest))
        with extension_session("artstation-capture-", extension_dir=extension) as run:
            video_bytes = (Path(__file__).parent / "fixtures/zhipu-local-video-smoke.mp4").read_bytes()
            images = "".join(f'<img class="project-assets-image" alt="Artwork {i}" src="{CDN}/list-image-{i}.png" style="width:280px;height:280px">' for i in range(1, 4))
            document = f'''<!doctype html><html><head><title>Mixed artwork fixture</title><link rel="canonical" href="{WORK}"></head>
              <body class="project"><h1>Mixed artwork fixture</h1><div class="project-description"><p>This is a personal artwork with alternate versions and a process film.</p></div>
              {images}<div class="asset-responsive video-clip"><iframe title="Process film" src="{FRAME}" style="width:360px;height:400px"></iframe></div></body></html>'''

            def route(request):
                url = request.request.url
                if url == WORK:
                    request.fulfill(status=200, content_type="text/html", body=document)
                elif url == FRAME:
                    request.fulfill(status=200, content_type="text/html", body=f'<video controls preload="auto" src="{VIDEO}"></video>')
                elif url == VIDEO:
                    request.fulfill(status=200, content_type="video/mp4", body=video_bytes)
                elif url.startswith(CDN):
                    request.fulfill(status=200, content_type="image/png", body=fixture_png(url))
                else:
                    request.abort()

            for origin in (SITE, PLAYER, CDN):
                run.context.route(f"{origin}/**", route)
            collector = run.open_page("collector.html")
            run.seed_storage(collector, {"schemaVersion": 24, "entries": []})
            source = run.context.new_page()
            source.goto(WORK, wait_until="networkidle")
            source.frame_locator("iframe").locator("video").evaluate("v => {if(v.readyState < 2) throw new Error('Fixture video not loaded');}")
            source.bring_to_front()
            batch = collector.evaluate('''async () => {
              const response = await chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'});
              if (!response.ok) throw new Error(response.message);
              return response.batch;
            }''')
            candidate = next((c for c in batch["candidates"] if len(c["media"]) == 4), None)
            assert candidate is not None, batch
            assert [m["kind"] for m in candidate["media"]] == ["image", "image", "image", "video"], candidate
            assert candidate["media"][-1]["url"] == VIDEO, candidate
            assert candidate["media"][-1]["sourceKind"] == "video-element", candidate
            assert collector.evaluate("async () => (await chrome.storage.local.get('entries')).entries") == []
            batch["selections"] = [{"candidateId": candidate["id"], "includeText": True,
                                    "selectedMediaIds": [m["id"] for m in candidate["media"]], "mediaDecision": "confirmed"}]
            saved = collector.evaluate("async batch => chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch})", batch)
            assert saved.get("ok"), saved
            entries = collector.evaluate("async () => (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
            assert len(entries) == 1, entries
            assets = [a for a in entries[0]["mediaAssets"] if a.get("usage") != "poster"]
            assert [a["kind"] for a in assets] == ["image", "image", "image", "video"], assets
            assert all(a["storageMode"] == "managed" for a in assets), assets
            assert not any("prompt" in path or path in {"content:reference", "content:tutorial"} for path in entries[0]["classification"]["pathIds"]), entries[0]
            video = assets[-1]
            assert video["originalWorkUrl"] == WORK, video
            collector.reload()
            readback = collector.evaluate("async id => {const {getMediaBlob}=await import('./media-store.js'); const blob=await getMediaBlob(id); return {size:blob.size,type:blob.type};}", video["id"])
            assert readback == {"size": len(video_bytes), "type": "video/mp4"}, readback
            print("ArtStation fixture: 3 images + 1 cross-origin player video captured in order, local video bytes retained after reload.")


if __name__ == "__main__":
    main()
