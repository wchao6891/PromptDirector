from __future__ import annotations

import re
import os

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, expect

from e2e_support import extension_session


CATALOG_URL = "https://wchao6891.github.io/PromptDirector-Curated/catalog.json"


def main() -> None:
    with extension_session("prompt-director-curated-live-", viewport={"width": 1440, "height": 1000}) as session:
        curated = session.open_page("curated.html", wait_until="networkidle")
        page_errors = []
        console_errors = []
        curated.on("pageerror", lambda error: page_errors.append(str(error)))
        curated.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        catalog = curated.evaluate(
            "async (url) => (await fetch(url, {cache: 'no-store', credentials: 'omit'})).json()",
            CATALOG_URL,
        )
        assert len(catalog["themes"]) == 1, catalog
        item = catalog["themes"][0]
        assert item["id"] == "featured:vol-1", item
        assert item["caseCount"] == 20, item
        assert item["rightsStatus"] == "verified_original", item
        assert item["rightsReviewUrl"].endswith("/reviews/featured-cases-vol-1.json"), item
        card = curated.locator(f'.pack-card[data-pack-id="{item["id"]}"]')
        expect(card).to_be_visible(timeout=30_000)
        card.click()
        expect(curated.locator(".case-card").first).to_be_visible(timeout=30_000)
        expect(curated.locator(".case-video-badge")).to_have_count(0)
        curated.locator(".case-card").first.click()
        expect(curated.locator(".case-detail-figure img")).to_have_count(1)
        save = curated.locator(".case-save-action")
        expect(save).to_have_text("保存到案例库")
        curated.evaluate(
            """async () => {
              await chrome.storage.local.set({__curatedLiveLabels: []});
              const button = document.querySelector('.case-save-action');
              new MutationObserver(async () => {
                const stored = await chrome.storage.local.get('__curatedLiveLabels');
                const labels = stored.__curatedLiveLabels || [];
                const label = button.textContent.trim();
                if (labels.at(-1) !== label) await chrome.storage.local.set({__curatedLiveLabels: [...labels, label]});
              }).observe(button, {subtree: true, childList: true, characterData: true});
            }"""
        )
        save.click()
        try:
            expect(curated).to_have_url(
                re.compile(r"/library\.html(?:\?.*)?$"),
                timeout=int(os.environ.get("CURATED_SAVE_TIMEOUT_MS", "360000")),
            )
        except (AssertionError, PlaywrightTimeoutError):
            diagnostics = curated.evaluate(
                """async () => ({
                  button: document.querySelector('.case-save-action')?.textContent.trim(),
                  toast: document.querySelector('#curated-toast')?.textContent.trim(),
                  labels: (await chrome.storage.local.get('__curatedLiveLabels')).__curatedLiveLabels || [],
                  state: await chrome.runtime.sendMessage({type: 'GET_STATE'})
                })"""
            )
            print({"save_timeout": diagnostics, "page_errors": page_errors, "console_errors": console_errors})
            raise
        expect(curated.locator("#detail-drawer")).to_have_class(re.compile(r"\bopen\b"))
        expect(curated.locator(".detail-image")).to_have_count(1)
        local_state = curated.evaluate("async () => chrome.runtime.sendMessage({type: 'GET_STATE'})")
        assert len(local_state["entries"]) == 1, local_state
        labels = curated.evaluate("async () => (await chrome.storage.local.get('__curatedLiveLabels')).__curatedLiveLabels || []")
        assert not page_errors, page_errors
        assert not console_errors, console_errors

        curated.evaluate(
            "(packId) => location.assign(`${chrome.runtime.getURL('curated.html')}?pack=${encodeURIComponent(packId)}`)",
            item["id"],
        )
        expect(curated.locator("#detail-dialog")).to_be_visible(timeout=30_000)
        curated.locator(".download-action").click()
        expect(curated.locator("#pack-save-dialog")).to_be_visible()
        curated.locator(".pack-save-confirm").click()
        expect(curated).to_have_url(re.compile(r"/library\.html(?:\?.*)?$"), timeout=360_000)
        expect(curated.locator(f'.project-filter[aria-label^="{item["title"]} "]')).to_have_attribute("aria-pressed", "true")
        package_state = curated.evaluate("async () => chrome.runtime.sendMessage({type: 'GET_STATE'})")
        project = next(collection for collection in package_state["organizerState"]["collections"] if collection["id"] == f'curated-project:{item["packageId"]}')
        assert len(package_state["entries"]) == item["caseCount"], package_state
        assert len(project["entryIds"]) == item["caseCount"], project

        print({
            "package": item["id"],
            "case_count": item["caseCount"],
            "rights_status": item["rightsStatus"],
            "online_video": False,
            "opened_saved_case": True,
            "progress": labels,
            "saved_entries": len(local_state["entries"]),
            "saved_package_entries": len(package_state["entries"]),
            "project_entries": len(project["entryIds"]),
        })


if __name__ == "__main__":
    main()
