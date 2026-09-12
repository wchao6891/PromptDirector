from __future__ import annotations

import base64
from pathlib import Path
from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


def image_asset(asset_id: str) -> dict:
    return {
        "id": asset_id,
        "kind": "image",
        "usage": "content",
        "storageMode": "managed",
        "mimeType": "image/png",
        "width": 1,
        "height": 1,
        "capturedAt": "2026-09-02T00:00:00.000Z",
        "reviewStatus": "verified",
    }


def video_asset(asset_id: str) -> dict:
    return {
        "id": asset_id,
        "kind": "video",
        "usage": "content",
        "storageMode": "managed",
        "mimeType": "video/mp4",
        "sourceTitle": f"{asset_id}.mp4",
        "byteSize": 4,
        "playbackCapability": "external",
        "capturedAt": "2026-09-02T00:00:01.000Z",
        "reviewStatus": "verified",
    }


def detail_entry(entry_id: str, title: str, assets: list[dict]) -> dict:
    value = base_entry(entry_id, title, f"{title} prompt", "content:prompt:image")
    value["mediaAssets"] = assets
    value["primaryMediaId"] = assets[0]["id"]
    return value


def switch_case_without_stale_frame(page, selector: str, expected_id: str, stale_title: str) -> dict:
    return page.evaluate(
        """async ({selector, expectedId, staleTitle}) => {
          window.__detailIdbDelayMs = 180;
          document.querySelector(selector).click();
          await Promise.resolve();
          if (document.querySelector('#detail-content .detail-loading')?.textContent?.trim()) {
            throw new Error('案例切换时加载占位出现临时标题');
          }
          const immediate = {
            loadingId: document.querySelector('#detail-drawer').dataset.loadingEntryId || '',
            title: document.querySelector('#detail-content .detail-title')?.textContent?.trim() || '',
            oldImageVisible: Boolean(document.querySelector('#detail-content .detail-image'))
          };
          const staleFrames = [];
          await new Promise((resolve, reject) => {
            let frames = 0;
            const tick = () => {
              if (document.querySelector('#detail-content .detail-loading')?.textContent?.trim()) {
                return reject(new Error('案例切换期间加载占位闪出临时标题'));
              }
              const drawer = document.querySelector('#detail-drawer');
              const title = document.querySelector('#detail-content .detail-title')?.textContent?.trim() || '';
              const imageVisible = Boolean(document.querySelector('#detail-content .detail-image'));
              if (title === staleTitle && imageVisible) staleFrames.push(frames);
              if (drawer.dataset.entryId === expectedId) return resolve();
              if (++frames >= 90) return reject(new Error('详情切换超时'));
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
          window.__detailIdbDelayMs = 0;
          return {immediate, staleFrames};
        }""",
        {"selector": selector, "expectedId": expected_id, "staleTitle": stale_title},
    )


def main() -> None:
    entries = [
        detail_entry("detail-a", "详情案例 A", [image_asset("detail-image-a")]),
        detail_entry("detail-b", "详情案例 B", [image_asset("detail-image-b"), video_asset("detail-video-b")]),
    ]
    with extension_session("prompt-director-detail-rendering-", viewport={"width": 1280, "height": 900}) as session:
        setup = session.open_page("collector.html")
        session.seed_storage(setup, {
            "schemaVersion": 25,
            "entries": entries,
            "uiPreferences": {
                "locale": "zh-CN",
                "theme": "light",
                "motion": "reduced",
                "detailMode": "fullscreen",
                "detailSidebarWidth": 760,
            },
        })
        setup.evaluate(
            """async ({png, video}) => {
              const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              const bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0));
              for (const id of ['detail-image-a', 'detail-image-b']) {
                await saveMediaBlob(id, new Blob([bytes], {type: 'image/png'}), {checkCapacity: false});
              }
              await saveMediaBlob('detail-video-b', new Blob([Uint8Array.from(atob(video), c=>c.charCodeAt(0))], {type: 'video/mp4'}), {checkCapacity: false});
            }""",
            {"png": PNG_BASE64, "video": base64.b64encode((Path(__file__).parent / "fixtures/zhipu-local-video-smoke.mp4").read_bytes()).decode()},
        )
        session.context.add_init_script(
            """(() => {
              const descriptor = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess');
              if (!descriptor?.set || window.__detailIdbPatched) return;
              Object.defineProperty(IDBRequest.prototype, 'onsuccess', {
                configurable: descriptor.configurable,
                enumerable: descriptor.enumerable,
                get() { return descriptor.get.call(this); },
                set(callback) {
                  const wrapped = typeof callback !== 'function' ? callback : function(event) {
                    const delay = Number(window.__detailIdbDelayMs) || 0;
                    if (delay > 0) setTimeout(() => callback.call(this, event), delay);
                    else callback.call(this, event);
                  };
                  descriptor.set.call(this, wrapped);
                }
              });
              window.__detailIdbPatched = true;
            })();"""
        )

        library = session.open_page("library.html", wait_until="networkidle")
        library.locator('.case-card[data-entry-id="detail-a"]').click()
        expect(library.locator("#detail-drawer")).to_have_attribute("data-entry-id", "detail-a")
        library.locator("#detail-close").click()

        reopened = switch_case_without_stale_frame(
            library,
            '.case-card[data-entry-id="detail-b"]',
            "detail-b",
            "详情案例 A",
        )
        assert reopened["immediate"] == {"loadingId": "detail-b", "title": "", "oldImageVisible": False}, reopened
        assert reopened["staleFrames"] == [], reopened

        back_to_a = switch_case_without_stale_frame(
            library,
            '.case-card[data-entry-id="detail-a"]',
            "detail-a",
            "详情案例 B",
        )
        again_b = switch_case_without_stale_frame(
            library,
            '.case-card[data-entry-id="detail-b"]',
            "detail-b",
            "详情案例 A",
        )
        assert back_to_a["immediate"] == {"loadingId": "detail-a", "title": "", "oldImageVisible": False}, back_to_a
        assert again_b["immediate"] == {"loadingId": "detail-b", "title": "", "oldImageVisible": False}, again_b
        assert back_to_a["staleFrames"] == [] and again_b["staleFrames"] == [], {"back": back_to_a, "again": again_b}

        checker = library.locator(".detail-visual-item.has-alpha-channel").evaluate(
            "node => ({backgroundImage: getComputedStyle(node).backgroundImage, viewer: getComputedStyle(document.documentElement).getPropertyValue('--viewer-bg').trim(), browser: getComputedStyle(document.documentElement).getPropertyValue('--ui-browser').trim(), checker: getComputedStyle(document.documentElement).getPropertyValue('--viewer-checker-a').trim()})"
        )
        assert checker["backgroundImage"] != "none" and checker["viewer"] == checker["browser"], checker

        library.evaluate(
            """() => {
              document.documentElement.dataset.theme = 'dark';
              document.documentElement.dataset.resolvedTheme = 'dark';
            }"""
        )
        expect(library.locator("html")).to_have_attribute("data-theme", "dark")
        dark_checker = library.locator(".detail-visual-item.has-alpha-channel").evaluate(
            "node => ({backgroundImage: getComputedStyle(node).backgroundImage, viewer: getComputedStyle(document.documentElement).getPropertyValue('--viewer-bg').trim(), browser: getComputedStyle(document.documentElement).getPropertyValue('--ui-browser').trim(), checker: getComputedStyle(document.documentElement).getPropertyValue('--viewer-checker-a').trim()})"
        )
        assert dark_checker["backgroundImage"] != "none" and dark_checker["viewer"] == dark_checker["browser"], dark_checker
        assert dark_checker["checker"] != checker["checker"], {"light": checker, "dark": dark_checker}

        library.evaluate("window.__detailIdbDelayMs = 180")
        library.locator('.detail-visual-thumb[aria-label="查看第 2 项媒体"]').click()
        expect(library.locator(".detail-media-loading")).to_be_visible()
        expect(library.locator(".detail-visual-stage .detail-image")).to_have_count(0)
        expect(library.locator(".detail-visual-stage video")).to_be_visible(timeout=10_000)
        library.evaluate("window.__detailIdbDelayMs = 0")

        library.locator("#detail-mode-toggle").click()
        expect(library.locator("#detail-drawer")).to_have_class("detail-drawer open detail-sidebar-mode")
        saved_mode = library.evaluate("async () => (await chrome.storage.local.get('uiPreferences')).uiPreferences.detailMode")
        assert saved_mode == "sidebar", saved_mode
        sidebar_width = library.locator("#detail-drawer").evaluate("node => Math.round(node.getBoundingClientRect().width)")
        assert sidebar_width == 760, sidebar_width
        compact_sidebar = library.locator("#detail-drawer").evaluate(
            """node => ({
              primaryDisplay: getComputedStyle(node.querySelector('.detail-primary')).display,
              toolbarContained: [...node.querySelectorAll('.drawer-toolbar > .icon-button')].every(button => {
                const drawer = node.getBoundingClientRect();
                const bounds = button.getBoundingClientRect();
                return bounds.left >= drawer.left && bounds.right <= drawer.right;
              }),
            })"""
        )
        assert compact_sidebar == {"primaryDisplay": "block", "toolbarContained": True}, compact_sidebar
        library.locator("#detail-resizer").focus()
        library.locator("#detail-resizer").press("ArrowLeft")
        saved_width = library.evaluate("async () => (await chrome.storage.local.get('uiPreferences')).uiPreferences.detailSidebarWidth")
        assert saved_width == 776, saved_width

        library.set_viewport_size({"width": 700, "height": 900})
        expect(library.locator("#detail-drawer")).to_have_class("detail-drawer open detail-sidebar-mode")
        medium_layout = library.locator("#detail-drawer").evaluate(
            """node => ({
              width: Math.round(node.getBoundingClientRect().width),
              right: Math.round(node.getBoundingClientRect().right),
              clientWidth: document.documentElement.clientWidth,
              primaryDisplay: getComputedStyle(node.querySelector('.detail-primary')).display,
              pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            })"""
        )
        assert medium_layout["width"] == 520, medium_layout
        assert 0 <= medium_layout["clientWidth"] - medium_layout["right"] <= 20, medium_layout
        assert medium_layout["primaryDisplay"] == "block", medium_layout
        assert medium_layout["pageOverflow"] is False, medium_layout

        library.set_viewport_size({"width": 390, "height": 844})
        expect(library.locator("#detail-drawer")).not_to_have_class("detail-sidebar-mode")
        expect(library.locator("#detail-mode-toggle")).to_be_hidden()

        print({
            "stale_frames": len(reopened["staleFrames"]),
            "rapid_switch_stale_frames": len(back_to_a["staleFrames"]) + len(again_b["staleFrames"]),
            "media_invalidated_before_load": True,
            "sidebar_width": sidebar_width,
            "saved_sidebar_width": saved_width,
            "medium_sidebar": medium_layout,
            "light_checker": checker,
            "dark_checker": dark_checker,
            "saved_mode": saved_mode,
            "narrow_forces_fullscreen": True,
        })


if __name__ == "__main__":
    main()
