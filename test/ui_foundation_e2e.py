from __future__ import annotations

from playwright.sync_api import expect

from e2e_support import extension_session


PAGES = ["library.html", "composer.html", "skills.html", "curated.html", "curated-skills.html", "collector.html"]


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

        library.evaluate(
            """async () => chrome.storage.local.set({
              organizerState: {version: 5, collections: [
                {id: 'collection:combobox-one', name: '优质精选', order: 0, entryIds: [], visibility: 'library'},
                {id: 'collection:combobox-two', name: 'AIArtWorks · MJ 精选', order: 1, entryIds: [], visibility: 'library'},
                ...Array.from({length: 8}, (_, index) => ({
                  id: `collection:combobox-${index + 3}`,
                  name: index === 7 ? '用于验证完整换行显示的特别长项目名称' : `导演项目 ${index + 3}`,
                  order: index + 2,
                  entryIds: [],
                  visibility: 'library'
                }))
              ]}
            })"""
        )
        library.reload(wait_until="networkidle")
        library.set_viewport_size({"width": 560, "height": 800})
        library.locator("#add-menu > summary").click()
        add_note_alignment = library.locator("#add-quick-note").evaluate(
            """node => {
              const button = node.getBoundingClientRect();
              const title = node.querySelector('strong').getBoundingClientRect();
              const style = getComputedStyle(node);
              return {justifyContent: style.justifyContent, textAlign: style.textAlign, buttonLeft: button.left, titleLeft: title.left, paddingLeft: parseFloat(style.paddingLeft)};
            }"""
        )
        assert add_note_alignment["justifyContent"] in {"start", "flex-start"}, add_note_alignment
        assert add_note_alignment["textAlign"] == "left", add_note_alignment
        assert abs(add_note_alignment["titleLeft"] - add_note_alignment["buttonLeft"] - add_note_alignment["paddingLeft"]) <= 1, add_note_alignment
        library.locator("#add-quick-note").click()
        project_input = library.locator("#promptdirector-app-dialog-projectName")
        expect(project_input).to_have_attribute("role", "combobox")
        expect(project_input).to_have_attribute("aria-autocomplete", "list")
        project_input.click()
        dialog = library.locator("#promptdirector-app-dialog")
        expect(dialog.locator(".project-combobox-option")).to_have_count(10)
        menu_style = dialog.locator(".project-combobox-listbox").evaluate(
            "node => ({background: getComputedStyle(node).backgroundColor, border: getComputedStyle(node).borderColor})"
        )
        assert menu_style["background"] not in {"rgb(255, 255, 255)", "rgba(0, 0, 0, 0)"}, menu_style
        quick_note_menu = dialog.locator(".project-combobox-listbox").evaluate(
            """node => {
              const menu = node.getBoundingClientRect();
              const option = node.querySelector('.project-combobox-option');
              const footer = node.closest('form').querySelector('footer').getBoundingClientRect();
              const hit = document.elementFromPoint(menu.left + 12, menu.top + 12);
              return {placement: node.dataset.placement, position: getComputedStyle(node).position, top: menu.top, bottom: menu.bottom, left: menu.left, right: menu.right, viewportWidth: innerWidth, viewportHeight: innerHeight, footerTop: footer.top, optionJustify: getComputedStyle(option).justifyContent, optionTextAlign: getComputedStyle(option).textAlign, hitIsOption: Boolean(hit?.closest?.('.project-combobox-option'))};
            }"""
        )
        assert quick_note_menu["placement"] == "top", quick_note_menu
        assert quick_note_menu["position"] == "fixed", quick_note_menu
        assert quick_note_menu["top"] >= 11 and quick_note_menu["bottom"] <= quick_note_menu["footerTop"] + 1, quick_note_menu
        assert quick_note_menu["left"] >= 11 and quick_note_menu["right"] <= quick_note_menu["viewportWidth"] - 11, quick_note_menu
        assert quick_note_menu["optionJustify"] in {"start", "flex-start"} and quick_note_menu["optionTextAlign"] == "left", quick_note_menu
        assert quick_note_menu["hitIsOption"] is True, quick_note_menu
        project_input.press("ArrowDown")
        project_input.press("Enter")
        expect(project_input).to_have_value("优质精选")
        project_input.fill("新建导演项目")
        expect(project_input).to_have_value("新建导演项目")
        project_input.fill("优")
        expect(project_input).to_have_attribute("aria-expanded", "true")
        project_input.press("Escape")
        expect(project_input).to_have_attribute("aria-expanded", "false")
        dialog.get_by_role("button", name="取消", exact=True).click()

        library.locator("#add-menu > summary").click()
        library.locator("#add-video-reference").click()
        video_dialog = library.locator("#promptdirector-app-dialog")
        video_project = video_dialog.locator("#promptdirector-app-dialog-projectName")
        video_project.click()
        video_menu = video_dialog.locator(".project-combobox-listbox").evaluate(
            """node => {
              const menu = node.getBoundingClientRect();
              const footer = node.closest('form').querySelector('footer').getBoundingClientRect();
              return {top: menu.top, bottom: menu.bottom, left: menu.left, right: menu.right, viewportWidth: innerWidth, footerTop: footer.top};
            }"""
        )
        assert video_menu["top"] >= 11 and video_menu["bottom"] <= video_menu["footerTop"] + 1, video_menu
        assert video_menu["left"] >= 11 and video_menu["right"] <= video_menu["viewportWidth"] - 11, video_menu
        video_dialog.get_by_role("button", name="取消", exact=True).click()

        library.set_viewport_size({"width": 390, "height": 844})
        library.locator("#add-menu > summary").click()
        library.locator("#add-quick-note").click()
        mobile_dialog = library.locator("#promptdirector-app-dialog")
        mobile_dialog.locator("#promptdirector-app-dialog-projectName").click()
        mobile_menu = mobile_dialog.locator(".project-combobox-listbox").evaluate(
            """node => {
              const menu = node.getBoundingClientRect();
              const footer = node.closest('form').querySelector('footer').getBoundingClientRect();
              return {top: menu.top, bottom: menu.bottom, left: menu.left, right: menu.right, viewportWidth: innerWidth, viewportHeight: innerHeight, footerTop: footer.top, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth};
            }"""
        )
        assert mobile_menu["top"] >= 11 and mobile_menu["bottom"] <= min(mobile_menu["footerTop"], mobile_menu["viewportHeight"] - 11) + 1, mobile_menu
        assert mobile_menu["left"] >= 11 and mobile_menu["right"] <= mobile_menu["viewportWidth"] - 11, mobile_menu
        assert mobile_menu["overflow"] is False, mobile_menu
        mobile_dialog.get_by_role("button", name="取消", exact=True).click()
        library.set_viewport_size({"width": 1440, "height": 900})

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

        light_tokens = light_page.evaluate(
            """() => {
              const style = getComputedStyle(document.documentElement);
              const primary = getComputedStyle(document.querySelector('#start-compose'));
              const secondary = getComputedStyle(document.querySelector('#add-menu > summary'));
              return {
                browser: style.getPropertyValue('--ui-browser').trim(),
                page: style.getPropertyValue('--ui-page').trim(),
                surface: style.getPropertyValue('--ui-surface').trim(),
                raised: style.getPropertyValue('--ui-raised').trim(),
                hover: style.getPropertyValue('--ui-hover').trim(),
                text: style.getPropertyValue('--ui-text').trim(),
                muted: style.getPropertyValue('--ui-muted').trim(),
                accent: style.getPropertyValue('--ui-accent').trim(),
                emphasis: style.getPropertyValue('--ui-accent-emphasis').trim(),
                bodyBackground: getComputedStyle(document.body).backgroundColor,
                primaryBackground: primary.backgroundColor,
                primaryBorder: primary.borderColor,
                secondaryBackground: secondary.backgroundColor
              };
            }"""
        )
        expected_light_tokens = {
            "browser": "#e2e6e3",
            "page": "#edf0ed",
            "surface": "#f8f9f8",
            "raised": "#e5e9e6",
            "hover": "#dce2de",
            "text": "#121714",
            "muted": "#5b645e",
            "accent": "#d1fe17",
            "emphasis": "#d1fe17",
            "bodyBackground": "rgb(237, 240, 237)",
            "primaryBackground": "rgb(209, 254, 23)",
            "secondaryBackground": "rgb(229, 233, 230)",
        }
        for key, expected in expected_light_tokens.items():
            assert light_tokens[key] == expected, (key, light_tokens)
        assert light_tokens["primaryBorder"] == "rgba(0, 0, 0, 0)", light_tokens
        assert light_tokens["secondaryBackground"] != light_tokens["primaryBackground"], light_tokens

        for path in PAGES:
            page = light_page if path == "library.html" else session.open_page(path, wait_until="networkidle")
            light_surface = page.evaluate(
                """() => ({
                  theme: document.documentElement.dataset.theme,
                  bodyBackground: getComputedStyle(document.body).backgroundColor,
                  browserBackground: getComputedStyle(document.documentElement).backgroundColor,
                  horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
                })"""
            )
            assert light_surface["theme"] == "light", (path, light_surface)
            assert light_surface["bodyBackground"] == "rgb(237, 240, 237)", (path, light_surface)
            assert light_surface["browserBackground"] == "rgb(226, 230, 227)", (path, light_surface)
            assert light_surface["horizontalOverflow"] is False, (path, light_surface)

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
            "project_combobox": menu_style,
            "migrated": migrated,
            "light_tokens": light_tokens,
        })


if __name__ == "__main__":
    main()
