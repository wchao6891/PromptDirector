from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import extension_session


TOP_LEVEL_TABS = ("general", "ai", "tasks", "general")
AI_TABS = ("text", "vision", "composer", "text")
MAX_ANCHOR_SHIFT_PX = 1


def settle(page) -> None:
    page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")


def settings_metrics(page) -> dict:
    return page.evaluate(
        """() => {
          const dialog = document.querySelector('#settings-dialog');
          const header = dialog.querySelector('.data-safety-header');
          const tabs = dialog.querySelector('.settings-tabs');
          const activePanel = dialog.querySelector('[data-settings-panel]:not([hidden])');
          const rect = node => {
            const value = node.getBoundingClientRect();
            return {top: value.top, left: value.left, right: value.right, bottom: value.bottom, height: value.height};
          };
          return {
            dialog: rect(dialog),
            header: rect(header),
            tabs: rect(tabs),
            close: rect(dialog.querySelector('#settings-close')),
            windowScrollY: window.scrollY,
            dialogScrollTop: dialog.scrollTop,
            dialogClientHeight: dialog.clientHeight,
            dialogScrollHeight: dialog.scrollHeight,
            panelScrollTop: activePanel.scrollTop,
            panelClientWidth: activePanel.clientWidth,
            panelScrollWidth: activePanel.scrollWidth,
          };
        }"""
    )


def assert_anchor_stable(baseline: dict, current: dict, label: str, viewport: dict) -> None:
    for surface in ("dialog", "header", "tabs"):
        for dimension in ("top", "height"):
            shift = abs(current[surface][dimension] - baseline[surface][dimension])
            assert shift <= MAX_ANCHOR_SHIFT_PX, (
                f"{viewport} {label} changed {surface}.{dimension} by {shift:.2f}px: "
                f"baseline={baseline[surface]} current={current[surface]}"
            )
    assert current["windowScrollY"] == baseline["windowScrollY"], (label, current)
    assert current["dialogScrollTop"] == 0, (label, current)
    assert current["dialogScrollHeight"] <= current["dialogClientHeight"] + MAX_ANCHOR_SHIFT_PX, (label, current)
    assert current["panelScrollWidth"] <= current["panelClientWidth"] + MAX_ANCHOR_SHIFT_PX, (label, current)
    for surface in ("close", "tabs"):
        rect = current[surface]
        assert rect["top"] >= 0 and rect["bottom"] <= viewport["height"], (label, surface, rect)
        assert rect["left"] >= 0 and rect["right"] <= viewport["width"], (label, surface, rect)


def exercise_settings(page, viewport: dict) -> None:
    page.set_viewport_size(viewport)
    page.locator("#open-settings").dispatch_event("click")
    expect(page.locator("#settings-dialog")).to_be_visible()
    settle(page)
    baseline = settings_metrics(page)

    for tab in TOP_LEVEL_TABS:
        page.locator(f'[data-settings-tab="{tab}"]').click()
        expect(page.locator(f'[data-settings-panel="{tab}"]')).to_be_visible()
        settle(page)
        assert_anchor_stable(baseline, settings_metrics(page), f"settings:{tab}", viewport)

    page.locator('[data-settings-tab="tasks"]').click()
    local_index = page.locator(".local-index-card")
    expect(local_index).to_contain_text("资料索引自动补全")
    expect(local_index).to_contain_text("会在本机自动补齐内容类型和图片色卡，不调用 AI")
    expect(local_index.locator("progress")).to_have_count(0)
    expect(local_index.locator("#apply-reanalyze")).to_be_hidden()
    page.locator("#preview-reanalyze").click()
    expect(page.locator("#reanalyze-preview")).to_contain_text("资料索引已完整")
    expect(local_index.locator("#apply-reanalyze")).to_be_hidden()

    page.locator('[data-settings-tab="ai"]').click()
    advanced_summary = page.locator(".ai-advanced-settings > summary")
    advanced_summary.scroll_into_view_if_needed()
    settle(page)
    summary_top_before = advanced_summary.evaluate("node => node.getBoundingClientRect().top")
    if page.locator(".ai-advanced-settings").get_attribute("open") is None:
        advanced_summary.click()
        settle(page)
    summary_top_after = advanced_summary.evaluate("node => node.getBoundingClientRect().top")
    assert abs(summary_top_after - summary_top_before) <= MAX_ANCHOR_SHIFT_PX, (
        viewport, "advanced-summary", summary_top_before, summary_top_after
    )
    for tab in AI_TABS:
        page.locator(f'[data-analysis-kind="{tab}"]').click()
        expect(page.locator(f'[data-analysis-kind-panel="{tab}"]')).to_be_visible()
        settle(page)
        assert_anchor_stable(baseline, settings_metrics(page), f"ai:{tab}", viewport)

    analysis_tabs = page.locator(".analysis-kind-tabs")
    active_panel = page.locator('[data-settings-panel="ai"]')
    analysis_tabs.evaluate("node => node.scrollIntoView({block: 'center'})")
    settle(page)
    internal_anchor = {
        "top": analysis_tabs.evaluate("node => node.getBoundingClientRect().top"),
        "scrollTop": active_panel.evaluate("panel => panel.scrollTop"),
    }
    assert internal_anchor["scrollTop"] > 0, (viewport, internal_anchor)
    for tab in ("vision", "composer", "text"):
        page.locator(f'[data-analysis-kind="{tab}"]').click()
        settle(page)
        current = {
            "top": analysis_tabs.evaluate("node => node.getBoundingClientRect().top"),
            "scrollTop": active_panel.evaluate("panel => panel.scrollTop"),
        }
        assert abs(current["top"] - internal_anchor["top"]) <= MAX_ANCHOR_SHIFT_PX, (
            viewport, f"advanced-tab:{tab}", internal_anchor, current
        )
        assert current["scrollTop"] > 0, (viewport, tab, current)

    scrolled_to = active_panel.evaluate(
        "panel => { panel.scrollTop = Math.min(120, panel.scrollHeight - panel.clientHeight); return panel.scrollTop; }"
    )
    assert scrolled_to > 0, "AI settings panel must own vertical scrolling before reset is tested"
    page.locator('[data-settings-tab="tasks"]').click()
    page.locator('[data-settings-tab="ai"]').click()
    settle(page)
    assert active_panel.evaluate("panel => panel.scrollTop") == 0

    expect(page.locator("#settings-close")).to_be_visible()
    page.locator("#settings-close").click()
    expect(page.locator("#settings-dialog")).not_to_be_visible()


def main() -> None:
    with extension_session("prompt-settings-visual-anchor-", viewport={"width": 1280, "height": 900}) as session:
        page = session.open_page("library.html", wait_until="networkidle")
        exercise_settings(page, {"width": 1280, "height": 900})
        exercise_settings(page, {"width": 390, "height": 844})
        print({"settings_visual_anchor": "stable", "viewports": ["1280x900", "390x844"]})


if __name__ == "__main__":
    main()
