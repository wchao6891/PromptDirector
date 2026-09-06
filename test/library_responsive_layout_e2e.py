from __future__ import annotations

from e2e_support import base_entry, extension_session


def geometry(page) -> dict:
    return page.evaluate(
        """() => {
          const viewportWidth = document.documentElement.clientWidth;
          const gallery = document.querySelector('.gallery-shell').getBoundingClientRect();
          const list = document.querySelector('#case-list').getBoundingClientRect();
          const cards = [...document.querySelectorAll('#case-list > .case-card')]
            .map(card => card.getBoundingClientRect());
          return {
            viewportWidth,
            gallery: {left: gallery.left, right: gallery.right, width: gallery.width},
            list: {left: list.left, right: list.right, width: list.width},
            cards: cards.map(card => ({left: card.left, right: card.right, width: card.width})),
          };
        }"""
    )


def assert_readable_layout(value: dict) -> None:
    viewport_width = value["viewportWidth"]
    gallery = value["gallery"]
    case_list = value["list"]
    cards = value["cards"]
    minimum_gallery_width = viewport_width - (270 if viewport_width > 640 else 20)
    assert gallery["width"] >= minimum_gallery_width, value
    assert case_list["width"] >= gallery["width"] - 40, value
    assert cards, value
    assert all(card["width"] >= 140 for card in cards), value
    assert all(card["left"] >= gallery["left"] - 1 and card["right"] <= gallery["right"] + 1 for card in cards), value


def wait_for_readable_layout(page) -> None:
    page.wait_for_function(
        """() => {
          const gallery = document.querySelector('.gallery-shell')?.getBoundingClientRect();
          const cards = [...document.querySelectorAll('#case-list > .case-card')]
            .map(card => card.getBoundingClientRect());
          return Boolean(gallery && cards.length)
            && cards.every(card => card.left >= gallery.left - 1 && card.right <= gallery.right + 1);
        }""",
        timeout=2000,
    )


def main() -> None:
    entries = [
        base_entry(f"responsive-{index}", f"响应式案例 {index}", f"提示词 {index}", "content:prompt:text", index)
        for index in range(8)
    ]
    with extension_session("prompt-director-responsive-layout-", viewport={"width": 1100, "height": 850}) as session:
        setup = session.open_page("collector.html")
        session.seed_storage(setup, {
            "schemaVersion": 28,
            "entries": entries,
            "uiPreferences": {"locale": "zh-CN", "theme": "dark", "motion": "reduced"},
        })
        library = session.open_page("library.html", wait_until="networkidle")

        for width in [980, 920, 900, 860, 800, 740, 680, 641, 640, 560]:
            library.set_viewport_size({"width": width, "height": 850})
            wait_for_readable_layout(library)
            assert_readable_layout(geometry(library))

        assert library.locator(".workspace").evaluate("node => node.classList.contains('filters-collapsed')") is True
        for width in [641, 700, 820, 900]:
            library.set_viewport_size({"width": width, "height": 850})
            wait_for_readable_layout(library)
            assert_readable_layout(geometry(library))

        print({"responsive_widths": 14, "collapsed_and_expanded": True})


if __name__ == "__main__":
    main()
