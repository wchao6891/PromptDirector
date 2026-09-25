"""Settings tabs retain one visible frame while their contents scroll."""
from pathlib import Path
import tempfile
from playwright.sync_api import expect
from e2e_support import extension_session


def main():
    output = Path(tempfile.gettempdir()) / "pd-settings41-evidence"
    output.mkdir(exist_ok=True)
    with extension_session("pd-settings41-") as session:
        setup = session.open_page("collector.html")
        for width, height in [(1440, 900), (900, 600), (390, 844)]:
            for theme in ["light", "dark"]:
                for locale in ["zh-CN", "en"]:
                    session.seed_storage(setup, {"uiPreferences": {"theme": theme, "locale": locale, "motion": "reduced"}})
                    page = session.open_page("library.html", wait_until="networkidle")
                    page.set_viewport_size({"width": width, "height": height})
                    dialog = page.locator("#settings-dialog")
                    if not dialog.is_visible():
                        page.locator("#open-settings").click()
                    baseline = None
                    for tab in ["general", "ai", "rules", "tasks", "general"]:
                        page.locator(f'[data-settings-tab="{tab}"]').click()
                        expect(page.locator(f'[data-settings-tab="{tab}"]')).to_have_attribute("aria-selected", "true")
                        panel = page.locator(f"#settings-{tab}-panel")
                        expect(panel).to_be_visible()
                        page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
                        box = dialog.bounding_box()
                        if baseline is None:
                            baseline = box
                        assert all(abs(box[key] - baseline[key]) <= 1 for key in box), (tab, baseline, box)
                        assert box["x"] >= 0 and box["y"] >= 0, box
                        assert box["x"] + box["width"] <= width + 1 and box["y"] + box["height"] <= height + 1, (width, height, theme, locale, tab, box, page.evaluate("({width: innerWidth, height: innerHeight, mobile: matchMedia('(max-width: 700px)').matches})"))
                        overflow = panel.evaluate("el => ({width: el.clientWidth, scroll: el.scrollWidth, height: el.clientHeight, content: el.scrollHeight})")
                        assert overflow["scroll"] <= overflow["width"] + 1, (tab, overflow)
                        panel.evaluate("el => el.scrollTop = el.scrollHeight")
                        assert dialog.bounding_box() == box
                        panel.evaluate("el => el.scrollTop = 0")
                        if width in [1440, 390] and locale == "zh-CN" and tab in ["ai", "tasks"]:
                            page.mouse.move(width - 1, height - 1)
                            page.screenshot(path=str(output / f"{width}-{theme}-{tab}.png"))
                    page.close()
        print({"stable_settings_tabs": True, "viewports": 3, "themes": 2, "locales": 2, "screenshots": str(output)})


if __name__ == "__main__":
    main()
