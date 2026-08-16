from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path

from playwright.sync_api import expect

from e2e_support import EXTENSION_DIR, extension_session


PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c6360f8cfc000000301010018dd8db10000000049454e44ae426082"
)
HOME_URL = "https://jimeng.jianying.com/ai-tool/home"
WORK_ID = "7490123456789012345"
DETAIL_URL = f"https://jimeng.jianying.com/ai-tool/work-detail/{WORK_ID}"


def explore_item(work_id: str, author: str, prompt: str) -> dict:
    return {
        "extra": {"template_type": "image"},
        "common_attr": {"id": work_id, "title": "", "create_time": 1786000000},
        "author": {"name": author, "uid": f"author-{work_id[-4:]}"},
        "aigc_image_params": {"text2image_params": {"prompt": prompt}},
        "aigc_draft": {"content": json.dumps({"component_list": [{"abilities": {"generate": {"core_param": {"model": "jimeng_v47"}}}}]})},
        "statistic": {"favorite_num": 87, "usage_num": 12},
        "image": {"large_images": [{
            "image_url": f"https://p3-dreamina-sign.byteimg.com/{work_id}.webp",
            "width": 2048,
            "height": 3072,
        }]},
    }


def main() -> None:
    feed = {"data": {"item_list": [
        explore_item(WORK_ID, "AIGC大叔", "敦煌文化主题场景，全景，暗黑风。"),
        explore_item("7490123456789012346", "作者乙", "山海经异兽，电影光影。"),
    ]}}
    home_html = f"""<!doctype html><html><head><title>即梦AI - 一站式AI创作平台</title></head><body>
<nav>发现 技能 短片 活动</nav><main>上传参考图 输入文字 图片生成 二维码</main>
<script>window.__get_explore_result={json.dumps(feed, ensure_ascii=False)};</script>
</body></html>""".encode()
    detail_html = f"""<!doctype html><html><head><title>即梦AI - 一站式AI创作平台</title></head><body>
<main style=\"display:flex;gap:40px\">
<img id=\"artwork\" src=\"https://p3-dreamina-sign.byteimg.com/{WORK_ID}.webp\" style=\"display:block;width:450px;height:700px\">
<section><div>AIGC大叔</div><button>+ 关注</button><div>87</div><div>2026-05-30 | 内容由 AI 生成</div>
<div>图片提示词</div><p id=\"prompt\">敦煌文化主题场景，全景，暗黑风。</p><div>图片 4.7 | 9:16 | 更多</div>
<button>做同款</button><button>用作参考图</button></section></main>
</body></html>""".encode()

    with tempfile.TemporaryDirectory(prefix="prompt-director-jimeng-extension-") as extension_root:
        extension_dir = Path(extension_root) / "extension"
        shutil.copytree(
            EXTENSION_DIR,
            extension_dir,
            ignore=shutil.ignore_patterns("node_modules", ".scratch", "test", "docs", "plan", "dist", "tmp"),
        )
        manifest_file = extension_dir / "manifest.json"
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        manifest["host_permissions"] = list(dict.fromkeys([*manifest.get("host_permissions", []), "<all_urls>"]))
        manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        run_jimeng_flow(extension_dir, home_html, detail_html)


def run_jimeng_flow(extension_dir: Path, home_html: bytes, detail_html: bytes) -> None:
    with extension_session("prompt-director-jimeng-capture-", extension_dir=extension_dir) as run:
        def route_jimeng(route) -> None:
            if route.request.url == HOME_URL:
                route.fulfill(status=200, body=home_html, content_type="text/html; charset=utf-8")
            elif route.request.url == DETAIL_URL:
                route.fulfill(status=200, body=detail_html, content_type="text/html; charset=utf-8")
            else:
                route.fulfill(status=404, body=b"not found", content_type="text/plain")

        run.context.route("https://jimeng.jianying.com/**", route_jimeng)
        run.context.route("https://p3-dreamina-sign.byteimg.com/**", lambda route: route.fulfill(status=200, body=PNG, content_type="image/png"))
        collector = run.open_page("collector.html", wait_until="networkidle")
        run.seed_storage(collector, {"schemaVersion": 24, "entries": []})
        fixture = run.context.new_page()
        fixture.goto(HOME_URL, wait_until="networkidle")
        fixture.bring_to_front()
        active_before = collector.evaluate("() => chrome.tabs.query({active: true, currentWindow: true}).then(tabs => tabs[0]?.url)")
        assert active_before == HOME_URL, {"activeBefore": active_before}
        collector.evaluate("() => document.querySelector('#start-page-capture').click()")
        collector.wait_for_timeout(1200)
        capture_state = collector.evaluate("""() => ({
          hidden: document.querySelector('#page-capture').hidden,
          feedback: document.querySelector('#feedback').textContent,
          startHidden: document.querySelector('#start-state').hidden
        })""")
        assert not capture_state["hidden"], capture_state
        expect(collector.locator("#page-capture")).to_be_visible(timeout=8000)
        expect(collector.locator(".page-capture-item")).to_have_count(2)
        preview_text = collector.locator("#page-capture-list").inner_text()
        assert "AIGC大叔" in preview_text, preview_text
        assert "作者乙" in preview_text, preview_text
        assert "上传参考图" not in preview_text and "二维码" not in preview_text, preview_text
        first_candidate = collector.locator(".page-capture-item").first
        first_candidate.locator(".page-capture-confirm").click()
        expect(collector.locator("#page-capture-media-review")).to_be_visible()
        expect(collector.locator("#page-capture-media-review-list .page-capture-media-review-item")).to_have_count(1)
        expect(collector.locator("#page-capture-save")).to_have_text("保存案例 · 含 1 项媒体")

        collector.evaluate("() => document.querySelector('#page-capture-save').click()")
        expect(collector.locator("#page-capture")).to_be_hidden(timeout=8000)
        home_saved = collector.evaluate("() => chrome.storage.local.get('entries').then(({entries}) => entries)")
        assert len(home_saved) == 1, home_saved
        assert home_saved[0]["sourceFacts"]["author"] == "AIGC大叔", home_saved[0]
        assert home_saved[0]["sourceFacts"]["itemId"] == WORK_ID, home_saved[0]
        assert home_saved[0]["title"] != "即梦AI - 一站式AI创作平台", home_saved[0]
        assert len(home_saved[0].get("mediaAssets", [])) == 1, home_saved[0]

        collector.evaluate("() => chrome.storage.local.set({entries: [], captureDraft: {}})")
        fixture.goto(DETAIL_URL, wait_until="networkidle")
        fixture.evaluate("""() => {
          const range = document.createRange();
          range.selectNodeContents(document.querySelector('#prompt'));
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }""")
        fixture.bring_to_front()
        collector.evaluate("() => document.querySelector('#start-selection').click()")
        expect(collector.locator("#preview-state")).to_be_visible(timeout=8000)
        expect(collector.locator("#quick-preview")).to_contain_text("AIGC大叔")

        collector.evaluate("() => document.querySelector('#add-smart-visuals').click()")
        expect(collector.locator("#smart-selection")).to_be_visible(timeout=8000)
        expect(fixture.locator(".prompt-case-visual-candidate")).to_have_count(1, timeout=8000)
        fixture.locator(".prompt-case-visual-candidate").click()
        expect(collector.locator("#smart-selection-confirm")).to_be_enabled(timeout=5000)
        collector.evaluate("() => document.querySelector('#smart-selection-confirm').click()")
        expect(collector.locator("#smart-selection")).to_be_hidden(timeout=8000)
        expect(collector.locator("#preview-state")).to_be_visible(timeout=8000)
        expect(collector.locator("#visual-list .visual-card")).to_have_count(1)
        expect(collector.locator("#quick-preview")).to_contain_text("AIGC大叔")

        collector.evaluate("() => document.querySelector('#save-draft').click()")
        expect(collector.locator("#start-state")).to_be_visible(timeout=8000)
        detail_saved = collector.evaluate("() => chrome.storage.local.get('entries').then(({entries}) => entries)")
        assert len(detail_saved) == 1, detail_saved
        assert detail_saved[0]["sourceFacts"]["author"] == "AIGC大叔", detail_saved[0]
        assert detail_saved[0]["sourceFacts"]["model"] == "4.7", detail_saved[0]
        assert detail_saved[0]["sourceFacts"]["engagement"]["favorites"] == 87, detail_saved[0]
        assert detail_saved[0]["title"].startswith("AIGC大叔"), detail_saved[0]
        assert len(detail_saved[0].get("mediaAssets", [])) == 1, detail_saved[0]
        print({"homeCandidates": 2, "detailAuthor": "AIGC大叔", "detailFavorites": 87, "detailSmartImages": 1})


if __name__ == "__main__":
    main()
