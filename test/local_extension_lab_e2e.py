from __future__ import annotations

import json
import os
from pathlib import Path

from e2e_support import EXTENSION_DIR, extension_session


def main() -> None:
    evidence_dir = Path(os.environ["PROMPTDIRECTOR_LAB_EVIDENCE_DIR"]).resolve()
    expected_id = os.environ["PROMPTDIRECTOR_E2E_EXPECTED_EXTENSION_ID"].strip()
    expected_version = os.environ["PROMPTDIRECTOR_E2E_EXPECTED_VERSION"].strip()
    assert EXTENSION_DIR == Path(os.environ["PROMPTDIRECTOR_E2E_EXTENSION_DIR"]).resolve()
    assert (EXTENSION_DIR / "manifest.json").exists(), EXTENSION_DIR

    evidence_dir.mkdir(parents=True, exist_ok=True)
    with extension_session("promptdirector-local-lab-", extension_dir=EXTENSION_DIR) as run:
        collector = run.open_page("collector.html")
        facts = collector.evaluate(
            """() => ({
              extensionId: chrome.runtime.id,
              manifest: chrome.runtime.getManifest(),
              location: location.href,
              userAgent: navigator.userAgent
            })"""
        )
        assert run.extension_id == expected_id, facts
        assert facts["extensionId"] == expected_id, facts
        assert facts["manifest"]["version"] == expected_version, facts
        assert facts["manifest"].get("key"), "本地实验室必须加载固定身份插件包"
        collector.screenshot(path=evidence_dir / "collector.png")

        library = run.open_page("library.html")
        library.locator("body").wait_for(state="visible")
        library.screenshot(path=evidence_dir / "library.png")

        composer = run.open_page("composer.html")
        composer.locator("body").wait_for(state="visible")
        composer.screenshot(path=evidence_dir / "composer.png")

        report = {
            "schema": "promptdirector-local-extension-preflight",
            "version": 1,
            "extensionDirectory": str(EXTENSION_DIR),
            "extensionId": facts["extensionId"],
            "manifestVersion": facts["manifest"]["version"],
            "userAgent": facts["userAgent"],
            "serviceWorker": f"chrome-extension://{run.extension_id}/background.js",
            "pages": [collector.url, library.url, composer.url],
            "screenshots": ["collector.png", "library.png", "composer.png"],
            "pageErrors": run.page_errors,
        }
        (evidence_dir / "preflight.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
