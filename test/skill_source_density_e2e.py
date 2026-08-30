from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


def dense_entries() -> list[dict]:
    entries: list[dict] = []
    for index in range(1, 61):
        title = f"真实密度案例 {index:02d} · 带有较长名称用于检查标题和内容按钮是否发生遮挡"
        item = base_entry(f"dense-skill-{index:02d}", title, f"案例文字 {index}：主体、空间、色彩与动作节奏。", "content:prompt:image", index % 60)
        assets: list[dict] = []
        if index % 12 == 0:
            title = f"复合案例 {index:02d} · 图片、视频、文档和文字组合"
            item["title"] = title
            assets = [
                media_asset(item["id"], "image", 0, "image/png"),
                media_asset(item["id"], "video", 1, "video/mp4"),
                media_asset(item["id"], "document", 2, "application/pdf"),
            ]
        elif index % 10 == 0:
            assets = [media_asset(item["id"], "document", 0, "application/pdf")]
        elif index % 9 == 0:
            assets = [media_asset(item["id"], "video", 0, "video/mp4")]
        elif index % 15 != 0:
            assets = [media_asset(item["id"], "image", 0, "image/png")]
        item["mediaAssets"] = assets
        item["primaryMediaId"] = assets[0]["id"] if assets else ""
        entries.append(item)
    return entries


def media_asset(entry_id: str, kind: str, index: int, mime_type: str) -> dict:
    return {
        "id": f"{entry_id}:{kind}:{index}",
        "kind": kind,
        "usage": "content",
        "storageMode": "managed",
        "mimeType": mime_type,
        "capturedAt": "2026-08-12T08:00:00.000Z",
        "reviewStatus": "verified",
    }


def main() -> None:
    entries = dense_entries()
    with extension_session("prompt-director-skill-density-", viewport={"width": 1840, "height": 733}) as session:
        setup = session.open_page("collector.html")
        session.seed_storage(setup, {
            "schemaVersion": 24,
            "entries": entries,
            "organizerState": {
                "version": 6,
                "collections": [{
                    "id": "collection:dense-skill",
                    "name": "真实案例测试项目",
                    "order": 0,
                    "entryIds": [item["id"] for item in entries[12:48]],
                }],
            },
            "uiPreferences": {"locale": "zh-CN", "theme": "dark", "motion": "none"},
        })
        setup.evaluate(
            """async (entries) => {
              const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              for (const [index, entry] of entries.entries()) {
                const image = entry.mediaAssets.find((asset) => asset.kind === 'image');
                if (!image) continue;
                const canvas = document.createElement('canvas');
                canvas.width = 480;
                canvas.height = 360;
                const context = canvas.getContext('2d');
                context.fillStyle = `hsl(${(index * 37) % 360} 32% 24%)`;
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.fillStyle = 'rgba(255,255,255,.92)';
                context.font = '700 26px sans-serif';
                context.fillText(`CASE ${String(index + 1).padStart(2, '0')}`, 28, 58);
                context.font = '18px sans-serif';
                context.fillText('IMAGE TEXT MUST STAY VISIBLE', 28, 318);
                const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
                await saveMediaBlob(image.id, blob, {checkCapacity: false});
              }
            }""",
            entries,
        )

        skills = session.open_page("skills.html")
        skills.locator("#skill-create").click()
        wait_for_theme(skills, "dark")
        skills.wait_for_function("""() => [...document.querySelectorAll('.skill-case-visual img')].some((image) => image.complete && image.naturalWidth > 0)""")
        expect(skills.locator(".skill-case")).to_have_count(24)
        expect(skills.locator("#skill-case-load-more")).to_be_visible()
        expect(skills.locator("#skill-case-grid")).not_to_contain_text("0/1")
        expect(skills.locator("#skill-project-picker")).not_to_have_attribute("open", "")

        desktop = layout_metrics(skills)
        assert desktop["columns"] == 4, desktop
        assert desktop["minCardWidth"] >= 240, desktop
        assert desktop["pageWidth"] <= desktop["viewportWidth"], desktop
        assert desktop["gridScrollWidth"] <= desktop["gridClientWidth"] + 1, desktop
        assert desktop["titleClearance"] >= 4, desktop
        skills.screenshot(path="/tmp/promptdirector-skills-density-1840-dark.png")

        skills.locator(".skill-case-toggle").first.click()
        expect(skills.locator(".skill-case-state:not([hidden])")).to_have_count(1)
        expect(skills.locator("#skill-selection-summary")).to_contain_text("图片 1")
        first_content = skills.locator(".skill-case-detail").first
        first_content.click()
        skills.locator("#skill-source-clear").click()
        skills.locator("#skill-source-cancel").click()
        expect(skills.locator("#skill-selected-count")).to_have_text("1")

        compound = skills.locator(".skill-case", has_text="复合案例 12")
        compound.locator(".skill-case-detail").click()
        skills.locator("#skill-source-select-all").click()
        skills.locator("#skill-source-apply").click()
        expect(skills.locator("#skill-selection-summary")).to_contain_text("图片 2")
        expect(skills.locator("#skill-selection-summary")).to_contain_text("视频 1")
        expect(skills.locator("#skill-selection-summary")).to_contain_text("文档 1")
        expect(skills.locator("#skill-selection-summary")).to_contain_text("案例文字 2")

        skills.locator("#skill-case-load-more").click()
        expect(skills.locator(".skill-case")).to_have_count(48)
        skills.locator("#skill-case-search").fill("真实密度案例 58")
        expect(skills.locator(".skill-case")).to_have_count(1)
        expect(skills.locator("#skill-selected-count")).to_have_text("2")
        skills.locator("#skill-case-search").fill("")
        expect(skills.locator(".skill-case")).to_have_count(24)
        expect(skills.locator("#skill-selected-count")).to_have_text("2")

        skills.set_viewport_size({"width": 1440, "height": 900})
        skills.evaluate("async () => chrome.storage.local.set({uiPreferences: {locale: 'zh-CN', theme: 'light', motion: 'none'}})")
        skills.reload(wait_until="domcontentloaded")
        expect(skills.locator("#skill-source-step")).to_be_visible()
        wait_for_theme(skills, "light")
        skills.wait_for_function("""() => [...document.querySelectorAll('.skill-case-visual img')].some((image) => image.complete && image.naturalWidth > 0)""")
        light = layout_metrics(skills)
        assert light["columns"] == 4, light
        assert light["minCardWidth"] >= 240, light
        assert light["pageWidth"] <= light["viewportWidth"], light
        assert light["headingColor"] == light["bodyColor"], light
        assert light["brandColor"] == light["bodyColor"], light
        skills.screenshot(path="/tmp/promptdirector-skills-density-1440-light.png")

        skills.set_viewport_size({"width": 1200, "height": 900})
        narrow = layout_metrics(skills)
        assert narrow["columns"] == 3, narrow
        assert narrow["minCardWidth"] >= 240, narrow
        assert narrow["pageWidth"] <= narrow["viewportWidth"], narrow

        skills.set_viewport_size({"width": 390, "height": 844})
        skills.evaluate("async () => chrome.storage.local.set({uiPreferences: {locale: 'en', theme: 'dark', motion: 'none'}})")
        skills.reload(wait_until="domcontentloaded")
        expect(skills.locator("#skill-source-step")).to_be_visible()
        wait_for_theme(skills, "dark")
        skills.wait_for_function("""() => [...document.querySelectorAll('.skill-case-visual img')].some((image) => image.complete && image.naturalWidth > 0)""")
        mobile = layout_metrics(skills)
        assert mobile["columns"] == 2, mobile
        assert mobile["pageWidth"] <= mobile["viewportWidth"], mobile
        assert mobile["sectionHeadingColor"] == mobile["headingColor"], mobile
        skills.screenshot(path="/tmp/promptdirector-skills-density-390-dark-en.png", full_page=False)

        print({"dense_cases": 60, "desktop_columns": 4, "mobile_columns": 2, "staged_inspector": True})


def layout_metrics(page) -> dict:
    return page.evaluate(
        """() => {
          const grid = document.querySelector('#skill-case-grid');
          const cards = [...document.querySelectorAll('.skill-case')];
          const first = cards[0];
          const title = first.querySelector('.skill-case-copy strong').getBoundingClientRect();
          const detail = first.querySelector('.skill-case-detail')?.getBoundingClientRect();
          return {
            columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
            minCardWidth: Math.min(...cards.map((card) => card.getBoundingClientRect().width)),
            viewportWidth: innerWidth,
            pageWidth: document.documentElement.scrollWidth,
            gridClientWidth: grid.clientWidth,
            gridScrollWidth: grid.scrollWidth,
            titleClearance: detail ? detail.left - title.right : 99,
            bodyColor: getComputedStyle(document.body).color,
            headingColor: getComputedStyle(document.querySelector('.skill-workspace-header h1')).color,
            brandColor: getComputedStyle(document.querySelector('.skills-brand strong')).color,
            sectionHeadingColor: getComputedStyle(document.querySelector('.skill-section-heading strong')).color
          };
        }"""
    )


def wait_for_theme(page, theme: str) -> None:
    page.wait_for_function(
        """(theme) => {
          if (document.documentElement.dataset.theme !== theme) return false;
          if (document.body.style.color !== 'var(--ui-text)') return false;
          const channels = getComputedStyle(document.body).backgroundColor.match(/[0-9]+/g)?.map(Number) || [];
          if (channels.length < 3) return false;
          return theme === 'dark' ? Math.max(...channels.slice(0, 3)) < 60 : Math.min(...channels.slice(0, 3)) > 200;
        }""",
        arg=theme,
    )


if __name__ == "__main__":
    main()
