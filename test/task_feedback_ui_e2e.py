"""Offline rendering of real page DOM/CSS and the shared feedback module.

No extension is loaded, product controllers are removed, no model/library access.
Controller/receipt behavior is independently checked in task-feedback.test.js.
"""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import argparse
import json
import re
import tempfile
from playwright.sync_api import sync_playwright

SOURCE = Path(__file__).resolve().parents[1] / "extension"
TARGETS = {
    "library": ["organize-detail-status", "data-safety-feedback", "import-feedback", "import-job-feedback", "library-package-import-feedback", "analysis-batch-summary", "reanalyze-preview", "vision-batch-summary", "vision-batch-feedback", "update-feedback"],
    "skills": ["skill-generation-status", "skill-generation-feedback", "skill-save-status"],
    "composer": ["composer-feedback", "composer-reference-feedback"],
    "collector": ["feedback", "page-capture-help"],
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SOURCE), **kwargs)

    def do_GET(self):
        if self.path.startswith("/__feedback/"):
            name = self.path.split("/")[-1]
            html = (SOURCE / f"{name}.html").read_text()
            html = re.sub(r"<script\b[^>]*>[\s\S]*?</script>", "", html)
            html = html.replace("<head>", '<head><base href="/">')
            html = html.replace('data-library-state="loading"', 'data-library-state="ready"')
            data = html.encode()
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            super().do_GET()

    def log_message(self, *_args):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifacts", type=Path, default=Path(tempfile.mkdtemp(prefix="pd-feedback-")))
    out = parser.parse_args().artifacts
    out.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    errors = []
    variants = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1360, "height": 960}, device_scale_factor=1)
            page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(origin + "/") or route.request.url.startswith("data:") else route.abort())
            page.on("pageerror", lambda error: errors.append(str(error)))
            for surface, ids in TARGETS.items():
                for theme in ["dark", "light"]:
                    page.goto(f"{origin}/__feedback/{surface}")
                    page.evaluate("theme => document.documentElement.dataset.theme = theme", theme)
                    appearances = page.evaluate("""async ids => {
                      const {setTaskFeedbackState} = await import('/task-feedback.js');
                      return ids.map(id => {
                        const e = document.getElementById(id);
                        e.textContent = '正在整理服装造型 · 已完成106/159批';
                        setTaskFeedbackState(e, {pending: true});
                        const style = getComputedStyle(e);
                        return {id, color: style.color, size: style.fontSize, weight: style.fontWeight,
                          lineHeight: style.lineHeight, animation: getComputedStyle(e, '::before').animationName};
                      });
                    }""", ids)
                    reference = appearances[0]
                    for appearance in appearances:
                        for key in ["color", "size", "weight", "lineHeight", "animation"]:
                            assert appearance[key] == reference[key], (surface, theme, key, appearances)
                    assert reference["size"] == "12px", reference
                    variants.append({"surface": surface, "theme": theme, "appearance": appearances})
                    if surface == "library":
                        page.evaluate("""async () => {
                          const {setTaskProgress} = await import('/task-feedback.js');
                          document.querySelector('#manager-content-types').hidden = true;
                          document.querySelector('#manager-vocabulary').hidden = false;
                          for(const tab of document.querySelectorAll('[data-manager-tab]')) tab.setAttribute('aria-selected', String(tab.dataset.managerTab === 'vocabulary'));
                          document.querySelector('#vocabulary-facet').add(new Option('主体与角色', 'subject'));
                          document.querySelector('#organize-detail-tags').disabled = true;
                          const progress = document.querySelector('#organize-detail-progress');
                          setTaskProgress(progress, {completed:106,total:159,pending:true});
                          document.querySelector('#manager-dialog').showModal();
                        }""")
                        for width in [1360, 390]:
                            page.set_viewport_size({"width": width, "height": 960})
                            panel = page.locator("#manager-vocabulary").bounding_box()
                            bar = page.locator("#organize-detail-progress").bounding_box()
                            # Product controllers are absent; validate the affected modal,
                            # not uninitialized content behind its native backdrop.
                            assert page.locator('#manager-dialog').bounding_box()['width'] <= width
                            assert page.locator('#manager-vocabulary').evaluate('e => e.scrollWidth <= e.clientWidth')
                            page.screenshot(path=str(out / f"tags-{theme}-{width}.png"), clip={"x": panel["x"], "y": panel["y"], "width": panel["width"], "height": bar["y"] + bar["height"] + 16 - panel["y"]})
                        page.set_viewport_size({"width": 1360, "height": 960})
                        page.evaluate("""async () => {
                          const {setTaskFeedbackState, setTaskProgress} = await import('/task-feedback.js');
                          const status = document.querySelector('#organize-detail-status');
                          const progress = document.querySelector('#organize-detail-progress');
                          status.textContent = '正在保存整理结果…';
                          setTaskFeedbackState(status, {pending:true});
                          setTaskProgress(progress, {pending:true});
                        }""")
                        assert page.locator('#organize-detail-progress').get_attribute('value') is None
                        first_frame = page.locator('#organize-detail-progress').screenshot()
                        page.wait_for_timeout(250)
                        assert first_frame != page.locator('#organize-detail-progress').screenshot(), 'Unknown progress must visibly move'
                        if theme == 'dark':
                            panel = page.locator('#manager-vocabulary').bounding_box()
                            bar = page.locator('#organize-detail-progress').bounding_box()
                            page.screenshot(path=str(out / 'tags-saving.png'), clip={"x":panel['x'], "y":panel['y'], "width":panel['width'], "height":bar['y']+bar['height']+16-panel['y']})
                        page.emulate_media(reduced_motion="reduce")
                        assert page.locator('#organize-detail-status').evaluate("e => getComputedStyle(e, '::before').animationIterationCount") == '1'
                        page.wait_for_timeout(30)
                        static_frame = page.locator('#organize-detail-progress').screenshot()
                        page.wait_for_timeout(150)
                        assert static_frame == page.locator('#organize-detail-progress').screenshot(), 'Reduced motion must stop the waiting bar'
                        page.emulate_media(reduced_motion="no-preference")
                        assert page.locator('#organize-detail-progress').evaluate("e => getComputedStyle(e).height") == '4px'
                        page.evaluate("""async () => {
                          const {setTaskFeedbackState, setTaskProgress} = await import('/task-feedback.js');
                          const status = document.querySelector('#organize-detail-status');
                          status.textContent = '整理第23/159批（服装造型）失败：同一标签有不同名称，本次未修改标签';
                          setTaskFeedbackState(status, {error:true});
                          setTaskProgress(document.querySelector('#organize-detail-progress'), {completed:22,total:159,error:true});
                        }""")
                        assert page.locator('#organize-detail-status').evaluate("e => getComputedStyle(e, '::before').animationName") == 'none'
                        if theme == 'dark':
                            page.screenshot(path=str(out / 'tags-failed.png'), clip={"x":panel['x'], "y":panel['y'], "width":panel['width'], "height":bar['y']+bar['height']+16-panel['y']})
                        page.set_viewport_size({"width":390,"height":960})
                        page.locator('#organize-detail-status').evaluate("e => e.textContent = 'Organizing an unusually long group of character and costume descriptions · 106/159 batches completed'")
                        assert page.locator('#manager-vocabulary').evaluate('e => e.scrollWidth <= e.clientWidth')
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    assert not errors, errors
    result = {"pageThemeVariants": len(variants), "variants": variants, "pageErrors": errors,
              "checks": ["shared_typography_and_color", "known_counts", "saving_has_no_numeric_value", "waiting_bar_pixels_move", "reduced_motion_pixels_stable", "failed_state_stops_motion", "affected_modal_wide_and_narrow", "long_english_wraps"],
              "offlineDOMAndCSSOnly": True, "modelCalls": 0, "libraryWrites": 0, "extensionLoaded": False}
    (out / "visual-checks.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: value for key, value in result.items() if key != "variants"}))


if __name__ == "__main__":
    main()
