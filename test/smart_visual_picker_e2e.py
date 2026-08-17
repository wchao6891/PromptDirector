from __future__ import annotations

import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright


EXTENSION_DIR = Path(__file__).resolve().parents[1]


def open_picker(page) -> None:
    page.evaluate(
        """() => {
          window.__smartPickerResult = undefined;
          import(chrome.runtime.getURL('capture-region.js'))
            .then(({selectPageVisuals}) => selectPageVisuals({minimumSize: 64, maximumSelections: 12}))
            .then((result) => { window.__smartPickerResult = result; });
        }"""
    )
    page.wait_for_function(
        """() => document.getElementById('__prompt_case_visual_picker__')
          || window.__smartPickerResult !== undefined"""
    )
    state = page.evaluate(
        """() => ({
          hasPicker: Boolean(document.getElementById('__prompt_case_visual_picker__')),
          result: window.__smartPickerResult
        })"""
    )
    assert state["hasPicker"], {
        "problem": "当前画面没有识别到足够大的图片",
        "result": state["result"],
    }


def cancel_picker(page) -> None:
    page.locator(".prompt-case-visual-picker-cancel").evaluate("button => button.click()")
    page.locator("#__prompt_case_visual_picker__").wait_for(state="detached")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="prompt-smart-picker-e2e-") as profile_dir:
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                profile_dir,
                headless=True,
                channel="chromium",
                viewport={"width": 1200, "height": 800},
                args=[
                    f"--disable-extensions-except={EXTENSION_DIR}",
                    f"--load-extension={EXTENSION_DIR}",
                ],
            )
            try:
                service_worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
                extension_id = service_worker.url.split("/")[2]
                page = context.new_page()
                page.goto(f"chrome-extension://{extension_id}/library.html")
                page.locator("#settings-dialog").evaluate(
                    "dialog => { if (dialog.open) dialog.close(); }"
                )
                page.add_style_tag(path=str(EXTENSION_DIR / "capture-region.css"))

                page.evaluate(
                    """() => {
                      document.querySelectorAll('img, video, canvas').forEach((element) => {
                        element.style.display = 'none';
                      });
                      const video = document.createElement('video');
                      video.id = 'x-video-frame';
                      video.controls = true;
                      window.__videoPageClicks = 0;
                      window.__videoLayoutMutations = 0;
                      video.addEventListener('click', () => { window.__videoPageClicks += 1; });
                      document.addEventListener('pointerdown', () => {
                        window.__videoLayoutMutations += 1;
                        video.style.outline = `${window.__videoLayoutMutations % 2}px solid transparent`;
                      }, {capture: true});
                      document.addEventListener('mousemove', () => {
                        window.__videoLayoutMutations += 1;
                        video.classList.toggle('controls-visible', window.__videoLayoutMutations % 2 === 0);
                        video.style.outlineWidth = `${window.__videoLayoutMutations % 2}px`;
                      }, {capture: true});
                      Object.assign(video.style, {
                        position: 'fixed',
                        zIndex: '100',
                        left: '180px',
                        top: '120px',
                        width: '640px',
                        height: '360px',
                        display: 'block',
                        background: '#222'
                      });
                      document.documentElement.append(video);
                    }"""
                )
                open_picker(page)
                video_rects = page.locator(".prompt-case-visual-candidate").evaluate_all(
                    """elements => elements.map((element) => {
                      const rect = element.getBoundingClientRect();
                      return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
                    })"""
                )
                initial_video_candidate = page.locator(".prompt-case-visual-candidate").evaluate(
                    "element => { element.__identityMarker = 'stable-video-candidate'; return element.__identityMarker; }"
                )
                page.locator(".prompt-case-visual-candidate").hover(position={"x": 320, "y": 180})
                for _ in range(20):
                    page.mouse.move(500, 300)
                    page.mouse.move(501, 301)
                    page.wait_for_timeout(100)
                hover_stability = page.evaluate(
                    """() => ({
                      candidateCount: document.querySelectorAll('.prompt-case-visual-candidate').length,
                      identityMarker: document.querySelector('.prompt-case-visual-candidate')?.__identityMarker || '',
                      selectedCount: document.querySelectorAll('.prompt-case-visual-candidate.is-selected').length
                    })"""
                )
                page.locator(".prompt-case-visual-candidate").click(position={"x": 320, "y": 180})
                video_selection_state = page.evaluate(
                    """() => ({
                      selectedCount: document.querySelectorAll('.prompt-case-visual-candidate.is-selected').length,
                      pageClicks: window.__videoPageClicks,
                      layoutMutations: window.__videoLayoutMutations,
                      videoPaused: document.querySelector('#x-video-frame').paused
                    })"""
                )
                page.locator(".prompt-case-visual-picker-add").evaluate("button => button.click()")
                page.wait_for_timeout(200)
                video_finish_state = page.evaluate(
                    """() => ({
                      hasPicker: Boolean(document.querySelector('#__prompt_case_visual_picker__')),
                      selectedCount: document.querySelectorAll('.prompt-case-visual-candidate.is-selected').length,
                      addDisabled: document.querySelector('.prompt-case-visual-picker-add')?.disabled ?? null,
                      result: window.__smartPickerResult
                    })"""
                )
                assert not video_finish_state["hasPicker"], {
                    "problem": "已选视频点击加入素材后选图会话没有结束",
                    **video_finish_state,
                }
                page.wait_for_function("() => window.__smartPickerResult !== undefined")
                video_picker_result = page.evaluate("() => window.__smartPickerResult")
                page.locator("#x-video-frame").evaluate("element => element.remove()")

                page.evaluate(
                    """() => {
                      const artworkUrl = chrome.runtime.getURL('assets/icons/icon-source.svg');
                      const layout = document.createElement('section');
                      layout.id = 'jimeng-detail-layout';
                      Object.assign(layout.style, {
                        position: 'fixed',
                        zIndex: '100',
                        left: '105px',
                        top: '160px',
                        width: '620px',
                        height: '470px',
                        display: 'flex',
                        backgroundImage: `url("${artworkUrl}")`,
                        backgroundRepeat: 'no-repeat',
                        backgroundSize: '260px 470px'
                      });
                      const artwork = document.createElement('img');
                      artwork.id = 'jimeng-artwork';
                      artwork.src = artworkUrl;
                      Object.assign(artwork.style, {
                        display: 'block',
                        flex: '0 0 260px',
                        width: '260px',
                        height: '470px',
                        objectFit: 'cover'
                      });
                      const details = document.createElement('div');
                      details.innerHTML = '<h2>图片提示词</h2><p>古早 DV 摄影，美人，超纤细身材。</p><button>做同款</button><button>用作参考图</button>';
                      Object.assign(details.style, {flex: '1', padding: '30px'});
                      layout.append(artwork, details);
                      document.documentElement.append(layout);
                    }"""
                )
                page.locator("#jimeng-artwork").wait_for(state="visible")
                page.wait_for_function("() => document.querySelector('#jimeng-artwork').complete")
                open_picker(page)
                jimeng_rects = page.locator(".prompt-case-visual-candidate").evaluate_all(
                    """elements => elements.map((element) => {
                      const rect = element.getBoundingClientRect();
                      return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
                    })"""
                )
                cancel_picker(page)
                page.locator("#jimeng-detail-layout").evaluate("element => element.remove()")

                page.evaluate(
                    """() => {
                      document.querySelectorAll('img, video, canvas').forEach((element) => {
                        element.style.display = 'none';
                      });

                      const thumbnail = document.createElement('canvas');
                      thumbnail.id = 'x-underlying-thumbnail';
                      thumbnail.width = 300;
                      thumbnail.height = 200;
                      Object.assign(thumbnail.style, {
                        position: 'fixed',
                        zIndex: '100',
                        left: '360px',
                        top: '220px',
                        width: '300px',
                        height: '200px',
                        display: 'block'
                      });
                      document.documentElement.append(thumbnail);

                      const dialog = document.createElement('div');
                      dialog.id = 'x-lightbox';
                      dialog.setAttribute('role', 'dialog');
                      dialog.setAttribute('aria-modal', 'true');
                      Object.assign(dialog.style, {
                        position: 'fixed',
                        zIndex: '20000',
                        inset: '0',
                        background: 'rgba(0, 0, 0, .94)'
                      });
                      const imageSource = 'https://pbs.twimg.com/media/promptdirector-x-photo?format=jpg&name=4096x4096';
                      const imageStage = document.createElement('div');
                      imageStage.setAttribute('aria-label', 'Image');
                      Object.assign(imageStage.style, {
                        position: 'absolute',
                        left: '280px',
                        top: '80px',
                        width: '640px',
                        height: '640px',
                        overflow: 'hidden'
                      });
                      const enlarged = document.createElement('div');
                      enlarged.id = 'x-enlarged-image';
                      Object.assign(enlarged.style, {
                        position: 'absolute',
                        inset: '0',
                        backgroundImage: `url("${imageSource}")`,
                        backgroundSize: 'cover'
                      });
                      const semanticImage = document.createElement('img');
                      semanticImage.alt = 'Image';
                      semanticImage.src = imageSource;
                      Object.assign(semanticImage.style, {
                        position: 'absolute',
                        inset: '0',
                        width: '100%',
                        height: '100%',
                        opacity: '0'
                      });
                      imageStage.append(enlarged, semanticImage);
                      dialog.append(imageStage);
                      const transparentInteractionLayer = document.createElement('button');
                      transparentInteractionLayer.setAttribute('aria-label', 'Open image controls');
                      Object.assign(transparentInteractionLayer.style, {
                        position: 'absolute',
                        zIndex: '2',
                        left: '280px',
                        top: '80px',
                        width: '640px',
                        height: '640px',
                        border: '0',
                        background: 'transparent'
                      });
                      dialog.append(transparentInteractionLayer);
                      document.documentElement.append(dialog);
                    }"""
                )

                open_picker(page)
                modal_candidates = page.locator(".prompt-case-visual-candidate")
                modal_count = modal_candidates.count()
                modal_rects = modal_candidates.evaluate_all(
                    """elements => elements.map((element) => {
                      const rect = element.getBoundingClientRect();
                      return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
                    })"""
                )
                cancel_picker(page)

                page.evaluate(
                    """() => {
                      document.querySelector('#x-lightbox')?.remove();
                      document.querySelector('#x-underlying-thumbnail')?.remove();
                      const backdrop = document.createElement('canvas');
                      backdrop.id = 'reddit-lightbox-backdrop';
                      backdrop.width = 1600;
                      backdrop.height = 900;
                      Object.assign(backdrop.style, {
                        position: 'fixed',
                        zIndex: '20000',
                        left: '-200px',
                        top: '-50px',
                        width: '1600px',
                        height: '900px',
                        display: 'block'
                      });
                      const focused = document.createElement('canvas');
                      focused.id = 'reddit-focused-image';
                      focused.width = 520;
                      focused.height = 760;
                      Object.assign(focused.style, {
                        position: 'fixed',
                        zIndex: '20001',
                        left: '340px',
                        top: '20px',
                        width: '520px',
                        height: '760px',
                        display: 'block'
                      });
                      document.documentElement.append(backdrop, focused);
                    }"""
                )

                open_picker(page)
                reddit_candidates = page.locator(".prompt-case-visual-candidate")
                reddit_count = reddit_candidates.count()
                reddit_rects = reddit_candidates.evaluate_all(
                    """elements => elements.map((element) => {
                      const rect = element.getBoundingClientRect();
                      return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
                    })"""
                )
                cancel_picker(page)

                page.evaluate(
                    """() => {
                      document.querySelector('#reddit-lightbox-backdrop')?.remove();
                      document.querySelector('#reddit-focused-image')?.remove();
                      const fullscreen = document.createElement('canvas');
                      fullscreen.id = 'reddit-fullscreen-image';
                      fullscreen.width = innerWidth;
                      fullscreen.height = innerHeight;
                      Object.assign(fullscreen.style, {
                        position: 'fixed',
                        zIndex: '20000',
                        inset: '0',
                        width: '100vw',
                        height: '100vh',
                        display: 'block'
                      });
                      document.documentElement.append(fullscreen);
                    }"""
                )

                open_picker(page)
                page.locator(".prompt-case-visual-candidate").click(position={"x": 900, "y": 500})
                selected_candidate_state = page.locator(".prompt-case-visual-candidate.is-selected").evaluate(
                    """candidate => {
                      const style = getComputedStyle(candidate);
                      return {
                        borderWidth: style.borderWidth,
                        borderColor: style.borderColor,
                        transitionDuration: style.transitionDuration
                      };
                    }"""
                )
                toolbar_state = page.locator(".prompt-case-visual-picker-add").evaluate(
                    """button => {
                      const rect = button.getBoundingClientRect();
                      const topmost = document.elementFromPoint(
                        rect.left + rect.width / 2,
                        rect.top + rect.height / 2
                      );
                      return {
                        topmostClass: topmost?.className || '',
                        buttonIsTopmost: topmost === button || button.contains(topmost),
                        toolbarWidth: button.closest('.prompt-case-visual-picker-toolbar')?.getBoundingClientRect().width || 0,
                        viewportWidth: innerWidth
                      };
                    }"""
                )
                page.screenshot(path="/tmp/promptdirector-smart-picker-modal-regression.png")
                page.set_viewport_size({"width": 390, "height": 844})
                page.wait_for_timeout(100)
                narrow_toolbar_state = page.locator(".prompt-case-visual-picker-toolbar").evaluate(
                    """toolbar => {
                      const toolbarRect = toolbar.getBoundingClientRect();
                      const parts = [...toolbar.children].map((element) => {
                        const rect = element.getBoundingClientRect();
                        return {left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom};
                      });
                      const overlaps = parts.some((left, leftIndex) => parts.some((right, rightIndex) =>
                        rightIndex > leftIndex
                        && left.right > right.left
                        && left.left < right.right
                        && left.bottom > right.top
                        && left.top < right.bottom
                      ));
                      return {
                        left: toolbarRect.left,
                        right: toolbarRect.right,
                        scrollWidth: toolbar.scrollWidth,
                        clientWidth: toolbar.clientWidth,
                        overlaps
                      };
                    }"""
                )
                page.screenshot(path="/tmp/promptdirector-smart-picker-narrow-regression.png")
                cancel_picker(page)

                assert modal_count == 1, {
                    "problem": "放大图与被遮挡的底层缩略图同时被识别",
                    "candidateRects": modal_rects,
                }
                assert video_rects == [{"x": 180, "y": 120, "width": 640, "height": 360}], {
                    "problem": "暂停的视频画面没有被智能选图识别",
                    "candidateRects": video_rects,
                }
                assert initial_video_candidate == "stable-video-candidate"
                assert hover_stability == {
                    "candidateCount": 1,
                    "identityMarker": "stable-video-candidate",
                    "selectedCount": 0,
                }, hover_stability
                assert video_selection_state["layoutMutations"] >= 20, video_selection_state
                assert video_selection_state["selectedCount"] == 1, {
                    "problem": "视频播放控件触发布局变化后选框闪烁或丢失选中态",
                    **video_selection_state,
                }
                assert video_selection_state["pageClicks"] == 0, {
                    "problem": "选图点击穿透到了底层视频",
                    **video_selection_state,
                }
                assert video_selection_state["videoPaused"], video_selection_state
                assert video_picker_result["selections"] == [{
                    "rect": {"x": 180, "y": 120, "width": 640, "height": 360},
                    "viewportWidth": 1200,
                    "viewportHeight": 800,
                }], video_picker_result
                assert jimeng_rects == [{"x": 105, "y": 160, "width": 260, "height": 470}], {
                    "problem": "即梦详情页的外层图文布局被当成作品图片框选",
                    "candidateRects": jimeng_rects,
                }
                assert modal_rects == [{"x": 280, "y": 80, "width": 640, "height": 640}], modal_rects
                assert reddit_count == 1, {
                    "problem": "Reddit 放大页的背景图与前景图被同时识别",
                    "candidateRects": reddit_rects,
                }
                assert reddit_rects == [{"x": 340, "y": 20, "width": 520, "height": 760}], reddit_rects
                assert toolbar_state["buttonIsTopmost"], {
                    "problem": "全屏素材候选层覆盖了加入素材按钮",
                    **toolbar_state,
                }
                assert toolbar_state["toolbarWidth"] <= toolbar_state["viewportWidth"] - 24, toolbar_state
                assert selected_candidate_state["borderWidth"] == "1px", selected_candidate_state
                assert selected_candidate_state["borderColor"] != "rgb(85, 205, 139)", selected_candidate_state
                assert "0.14s" in selected_candidate_state["transitionDuration"], selected_candidate_state
                assert narrow_toolbar_state["left"] >= 8, narrow_toolbar_state
                assert narrow_toolbar_state["right"] <= 382, narrow_toolbar_state
                assert narrow_toolbar_state["scrollWidth"] <= narrow_toolbar_state["clientWidth"], narrow_toolbar_state
                assert not narrow_toolbar_state["overlaps"], narrow_toolbar_state
                print("smart-visual-picker-e2e=passed")
            finally:
                context.close()


if __name__ == "__main__":
    main()
