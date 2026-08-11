from __future__ import annotations

from e2e_support import extension_session


PAGES = ["library.html", "composer.html", "skills.html", "curated.html", "collector.html"]


def main() -> None:
    with extension_session("prompt-director-ui-foundation-", viewport={"width": 1440, "height": 900}) as session:
        first_page = session.open_page("collector.html", wait_until="networkidle")
        new_user = first_page.evaluate(
            """() => ({
              theme: document.documentElement.dataset.theme,
              resolvedTheme: document.documentElement.dataset.resolvedTheme,
              background: getComputedStyle(document.body).backgroundColor,
              accent: getComputedStyle(document.documentElement).getPropertyValue('--ui-accent').trim()
            })"""
        )
        assert new_user == {
            "theme": "dark",
            "resolvedTheme": "dark",
            "background": "rgb(19, 20, 22)",
            "accent": "#d1fe17",
        }, new_user

        page_metrics = {}
        for path in PAGES:
            page = first_page if path == "collector.html" else session.open_page(path, wait_until="networkidle")
            page_metrics[path] = page.evaluate(
                """() => {
                  const button = document.body.appendChild(document.createElement('button'));
                  const input = document.body.appendChild(document.createElement('input'));
                  const buttonStyle = button ? getComputedStyle(button) : null;
                  const inputStyle = input ? getComputedStyle(input) : null;
                  const result = {
                    theme: document.documentElement.dataset.theme,
                    button: buttonStyle ? {
                      minHeight: buttonStyle.minHeight,
                      radius: buttonStyle.borderRadius,
                      fontSize: buttonStyle.fontSize
                    } : null,
                    input: inputStyle ? {
                      minHeight: inputStyle.minHeight,
                      radius: inputStyle.borderRadius,
                      fontSize: inputStyle.fontSize
                    } : null
                  };
                  button.remove();
                  input.remove();
                  return result;
                }"""
            )
            assert page_metrics[path]["theme"] == "dark", (path, page_metrics[path])
            assert page_metrics[path]["button"] == {
                "minHeight": "36px",
                "radius": "4px",
                "fontSize": "12px",
            }, (path, page_metrics[path])
            if page_metrics[path]["input"]:
                assert page_metrics[path]["input"] == {
                    "minHeight": "36px",
                    "radius": "6px",
                    "fontSize": "13px",
                }, (path, page_metrics[path])

        library = next(page for page in session.context.pages if page.url.endswith("library.html"))
        icon_metrics = library.locator("#open-settings .ui-icon").evaluate(
            """icon => {
              const box = icon.getBBox();
              const use = icon.querySelector('use');
              return {
                width: box.width,
                height: box.height,
                href: use.getAttribute('href'),
                buttonRadius: getComputedStyle(icon.closest('button')).borderRadius,
                stroke: getComputedStyle(icon).stroke
              };
            }"""
        )
        assert icon_metrics["width"] > 0 and icon_metrics["height"] > 0, icon_metrics
        assert icon_metrics["href"] == "assets/ui-icons.svg#icon-settings", icon_metrics
        assert icon_metrics["buttonRadius"] == "4px", icon_metrics
        assert icon_metrics["stroke"] == "rgb(255, 255, 255)", icon_metrics
        wall_metrics = library.evaluate(
            """() => {
              const style = getComputedStyle(document.documentElement);
              return {
                gap: style.getPropertyValue('--visual-wall-gap').trim(),
                radius: style.getPropertyValue('--visual-card-radius').trim()
              };
            }"""
        )
        assert wall_metrics == {"gap": "2px", "radius": "2px"}, wall_metrics

        first_page.evaluate(
            """async () => {
              await chrome.storage.local.set({uiPreferences: {locale: 'system', theme: 'light', motion: 'none'}});
              localStorage.setItem('promptDirectorTheme', 'light');
              localStorage.setItem('promptDirectorMotion', 'none');
            }"""
        )
        light_page = session.open_page("library.html", wait_until="networkidle")
        migrated = light_page.evaluate(
            """() => ({
              theme: document.documentElement.dataset.theme,
              motion: document.documentElement.dataset.motion,
              storedTheme: localStorage.getItem('promptDirectorTheme'),
              storedMotion: localStorage.getItem('promptDirectorMotion'),
              selectedMotion: document.querySelector('#ui-motion').value
            })"""
        )
        assert migrated == {
            "theme": "light",
            "motion": "reduced",
            "storedTheme": "light",
            "storedMotion": "reduced",
            "selectedMotion": "reduced",
        }, migrated

        light_page.evaluate(
            """async () => {
              await chrome.storage.local.set({uiPreferences: {locale: 'system', theme: 'system', motion: 'system'}});
              localStorage.setItem('promptDirectorTheme', 'system');
              localStorage.setItem('promptDirectorMotion', 'system');
            }"""
        )
        system_page = session.open_page("collector.html", wait_until="networkidle")
        assert system_page.evaluate("document.documentElement.dataset.theme") == "system"

        print({
            "new_user": new_user,
            "pages": page_metrics,
            "icon": icon_metrics,
            "wall": wall_metrics,
            "migrated": migrated,
        })


if __name__ == "__main__":
    main()
