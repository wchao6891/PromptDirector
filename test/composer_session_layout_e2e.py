from __future__ import annotations

from datetime import datetime, timedelta, timezone

from playwright.sync_api import expect

from e2e_support import extension_session


def session_value(index: int) -> dict:
    day_offsets = [0, 1, 3, 10]
    timestamp = (datetime.now(timezone.utc) - timedelta(days=day_offsets[index % len(day_offsets)], minutes=index)).isoformat()
    return {
        "id": f"layout-session-{index}",
        "title": f"布局对话 {index:02d}" + (" · 这是一个用于验证单行省略效果的特别长会话标题" if index == 0 else ""),
        "targetType": "image",
        "updatedAt": timestamp,
        "messages": [{
            "id": f"layout-message-{index}",
            "role": "user",
            "type": "request",
            "content": f"第 {index} 个布局测试对话",
            "createdAt": timestamp,
        }],
    }


def geometry(page) -> dict:
    return page.evaluate(
        """() => {
          const rect = selector => {
            const value = document.querySelector(selector).getBoundingClientRect();
            return {top: value.top, bottom: value.bottom, height: value.height};
          };
          const sessions = document.querySelector('.composer-session-list');
          return {
            viewport: window.innerHeight,
            shell: rect('.composer-shell'),
            nav: rect('.composer-nav'),
            navFooter: rect('.composer-nav-footer'),
            input: rect('.composer-input-area'),
            timeline: rect('.composer-chat-scroll'),
            sessions: {
              clientHeight: sessions.clientHeight,
              scrollHeight: sessions.scrollHeight,
              overflowY: getComputedStyle(sessions).overflowY,
            },
          };
        }"""
    )


def assert_stable(first: dict, last: dict) -> None:
    drift = {
        "shell": last["shell"]["bottom"] - first["shell"]["bottom"],
        "navFooter": last["navFooter"]["bottom"] - first["navFooter"]["bottom"],
        "input": last["input"]["bottom"] - first["input"]["bottom"],
    }
    assert max(abs(value) for value in drift.values()) <= 1, drift
    assert last["navFooter"]["bottom"] <= last["viewport"] + 1, last
    assert last["input"]["bottom"] <= last["viewport"] + 1, last
    assert last["sessions"]["scrollHeight"] > last["sessions"]["clientHeight"], last
    assert last["sessions"]["overflowY"] == "auto", last


def main() -> None:
    sessions = [session_value(index) for index in range(30)]
    with extension_session("prompt-director-session-layout-", viewport={"width": 1280, "height": 900}) as run:
        setup = run.open_page("collector.html")
        run.seed_storage(setup, {"schemaVersion": 24, "composerSessions": sessions})
        composer = run.open_page("composer.html?session=layout-session-0", wait_until="networkidle")

        expect(composer.locator(".composer-session-group-label")).to_have_text(["今天", "昨天", "近 7 天", "更早"])
        long_title = composer.locator('.composer-session-item[data-session-id="layout-session-0"] strong')
        assert long_title.evaluate("node => node.scrollWidth > node.clientWidth")
        menu = composer.locator('.composer-session-item[data-session-id="layout-session-1"] .composer-session-menu')
        menu.locator("xpath=..").hover()
        menu.locator("summary").click()
        expect(menu.get_by_role("menuitem", name="删除", exact=True)).to_be_visible()
        menu.get_by_role("menuitem", name="删除", exact=True).click()
        delete_dialog = composer.locator("#promptdirector-app-dialog")
        expect(delete_dialog).to_contain_text("删除这段对话？")
        delete_dialog.get_by_role("button", name="取消", exact=True).click()
        expect(delete_dialog).to_have_count(0)

        desktop_first = geometry(composer)
        for index in range(1, 30):
            composer.locator(".composer-session-item > button:first-child", has_text=f"布局对话 {index:02d}").click()
        desktop_last = geometry(composer)
        assert_stable(desktop_first, desktop_last)

        composer.set_viewport_size({"width": 390, "height": 844})
        composer.locator("#composer-nav-open").click()
        mobile_first = geometry(composer)
        for index in range(29):
            composer.locator("#composer-nav-open").click() if index else None
            composer.locator(".composer-session-item > button:first-child", has_text=f"布局对话 {index:02d}").click()
        composer.locator("#composer-nav-open").click()
        mobile_last = geometry(composer)
        assert_stable(mobile_first, mobile_last)

        print({
            "desktopDrift": {
                "navFooter": desktop_last["navFooter"]["bottom"] - desktop_first["navFooter"]["bottom"],
                "input": desktop_last["input"]["bottom"] - desktop_first["input"]["bottom"],
            },
            "mobileDrift": {
                "navFooter": mobile_last["navFooter"]["bottom"] - mobile_first["navFooter"]["bottom"],
                "input": mobile_last["input"]["bottom"] - mobile_first["input"]["bottom"],
            },
            "sessionScroll": mobile_last["sessions"],
        })


if __name__ == "__main__":
    main()
