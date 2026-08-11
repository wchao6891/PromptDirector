from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


ENTRY_COUNT = 103
INITIAL_BATCH_SIZE = 24


def make_entries() -> list[dict]:
    entries = []
    for index in range(ENTRY_COUNT):
        entry = base_entry(
            f"gallery-case-{index:03d}",
            f"Gallery case {index:03d}",
            "gallery density regression",
            "content:image-case",
            index % 60,
        )
        asset_id = f"gallery-asset-{index:03d}"
        entry["mediaAssets"] = [{
            "id": asset_id,
            "kind": "image",
            "usage": "content",
            "storageMode": "managed",
            "mimeType": "image/webp",
            "byteSize": 1,
            "width": 1280,
            "height": 720,
            "capturedAt": "2026-08-01T10:00:00.000Z",
        }]
        entry["primaryMediaId"] = asset_id
        entries.append(entry)
    return entries


def main() -> None:
    with extension_session(
        "prompt-director-gallery-recovery-",
        viewport={"width": 1920, "height": 1080},
    ) as session:
        setup = session.open_page("collector.html")
        session.seed_storage(setup, {"schemaVersion": 24, "entries": make_entries()})

        library = session.open_page("library.html")
        library.locator("body[data-library-state='ready']").wait_for(timeout=10_000)
        expect(library.locator(".case-card").first).to_be_visible()
        library.wait_for_timeout(700)

        metrics = library.evaluate(
            """() => {
              const cards = [...document.querySelectorAll('.case-card')];
              const first = cards[0]?.getBoundingClientRect();
              return {
                cardCount: cards.length,
                firstCardWidth: first?.width ?? 0,
                loadMoreText: document.querySelector('#load-more')?.textContent ?? ''
              };
            }"""
        )
        assert metrics["firstCardWidth"] >= 270, metrics
        assert metrics["cardCount"] > INITIAL_BATCH_SIZE, metrics
        print(f"library_gallery_recovery_e2e=passed metrics={metrics}")


if __name__ == "__main__":
    main()
