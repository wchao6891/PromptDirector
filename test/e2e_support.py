from __future__ import annotations

import os
import tempfile
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from playwright.sync_api import BrowserContext, Page, Playwright, sync_playwright


EXTENSION_DIR = Path(__file__).resolve().parents[1]


@dataclass
class ExtensionTestSession:
    context: BrowserContext
    extension_id: str
    profile_dir: Path
    page_errors: list[str]

    def open_page(self, path: str, *, wait_until: str = "domcontentloaded") -> Page:
        page = self.context.new_page()
        record_page_errors(page, self.page_errors)
        page.goto(f"chrome-extension://{self.extension_id}/{path}", wait_until=wait_until)
        return page

    def seed_storage(self, page: Page, payload: dict) -> None:
        page.evaluate(
            """async (payload) => {
              await chrome.storage.local.clear();
              await chrome.storage.local.set(payload);
            }""",
            payload,
        )


@contextmanager
def extension_session(
    profile_prefix: str,
    *,
    viewport: dict | None = None,
    accept_downloads: bool = True,
) -> Iterator[ExtensionTestSession]:
    with tempfile.TemporaryDirectory(prefix=profile_prefix) as profile:
        with sync_playwright() as playwright:
            context = launch_context(
                playwright,
                profile,
                viewport=viewport or {"width": 1280, "height": 900},
                accept_downloads=accept_downloads,
            )
            page_errors: list[str] = []
            context.on("page", lambda page: record_page_errors(page, page_errors))
            try:
                worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
                yield ExtensionTestSession(context, worker.url.split("/")[2], Path(profile), page_errors)
                assert not page_errors, f"扩展页面出现运行时错误：{page_errors}"
            finally:
                context.close()


def launch_context(
    playwright: Playwright,
    profile_dir: str,
    *,
    viewport: dict,
    accept_downloads: bool,
) -> BrowserContext:
    return playwright.chromium.launch_persistent_context(
        profile_dir,
        headless=True,
        channel=os.environ.get("PROMPTDIRECTOR_E2E_CHANNEL", "chromium"),
        accept_downloads=accept_downloads,
        viewport=viewport,
        permissions=["clipboard-read", "clipboard-write"],
        args=[
            f"--disable-extensions-except={EXTENSION_DIR}",
            f"--load-extension={EXTENSION_DIR}",
        ],
    )


def record_page_errors(page: Page, errors: list[str]) -> None:
    def record(error: Exception) -> None:
        message = str(error)
        csp_probe = (
            message.startswith("Evaluating a string as JavaScript violates the following Content Security Policy directive")
            and "'unsafe-eval' is not an allowed source" in message
            and "script-src 'self'" in message
        )
        if not csp_probe:
            errors.append(f"{page.url}: {message}")

    page.on("pageerror", record)


def wait_for_download(page: Page, after_id: int = 0, timeout_seconds: float = 12) -> tuple[Path, int]:
    deadline = time.monotonic() + timeout_seconds
    records: list[dict] = []
    while time.monotonic() < deadline:
        records = page.evaluate("async () => chrome.downloads.search({orderBy: ['-startTime'], limit: 10})")
        for record in records:
            path = Path(record.get("filename", ""))
            if record.get("id", 0) > after_id and record.get("state") == "complete" and path.exists():
                return path, record["id"]
        page.wait_for_timeout(100)
    raise AssertionError(f"没有生成新的下载；下载记录：{records}")


def base_entry(entry_id: str, title: str, text: str, content_id: str, saved_minute: int = 0) -> dict:
    return {
        "schemaVersion": 24,
        "id": entry_id,
        "title": title,
        "text": text,
        "url": f"https://fixture.invalid/{entry_id}",
        "savedAt": f"2026-08-02T08:{saved_minute:02d}:00.000Z",
        "classification": {"pathIds": [content_id], "status": "confirmed", "source": "manual"},
        "facetAssignments": [],
        "analysisCandidates": [],
        "analysisBreakdown": [],
        "rejectedCandidateKeys": [],
        "negativeTerms": [],
        "customLabels": [],
        "mediaAssets": [],
        "timeNotes": [],
    }
