from __future__ import annotations

import json
import re
import tempfile
import zipfile
from pathlib import Path

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session, wait_for_download


def main() -> None:
    first = base_entry("skill-source-a", "本地标题甲", "低饱和庭院，主体偏左，前景遮挡形成纵深。", "content:prompt:image")
    second = base_entry("skill-source-b", "本地标题乙", "柔和逆光勾勒人物轮廓，背景保持克制。", "content:prompt:image", 1)
    with tempfile.TemporaryDirectory(prefix="prompt-director-skill-fixture-") as fixture_dir, extension_session("prompt-director-skills-") as session:
        fixture_root = Path(fixture_dir)
        external_zip = fixture_root / "external-method.zip"
        with zipfile.ZipFile(external_zip, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("external-method/SKILL.md", """---
name: external-method
description: External composition method with a required helper and a deliberately long explanation that must stay compact in the Skill library even when imported metadata contains far more prose than a user should have to scan on a card. This sentence continues so the visual regression test can prove that one verbose package never stretches the entire row of saved Skills.
---

# External method

Run `scripts/helper.py` before applying the composition guidance.
""")
            archive.writestr("external-method/references/guide.md", "# Guidance\n\nPreserve the subject hierarchy.\n")
            archive.writestr("external-method/scripts/helper.py", "print('helper')\n")

        setup = session.open_page("collector.html")
        session.seed_storage(setup, {
            "schemaVersion": 24,
            "entries": [first, second],
            "organizerState": {
                "version": 6,
                "collections": [{
                    "id": "collection:skill-sources",
                    "name": "风格来源",
                    "order": 0,
                    "entryIds": [first["id"], second["id"]],
                }],
            },
            "aiSettings": {
                "activeProvider": "deepseek",
                "apiKey": "skill-e2e-key",
                "consent": True,
                "analysisModel": "deepseek-v4-flash",
            },
            "uiPreferences": {"locale": "zh-CN", "theme": "light", "motion": "none"},
        })

        requests: list[dict] = []

        def mock_deepseek(route) -> None:
            payload = route.request.post_data_json
            requests.append(payload)
            result = "# 视觉组织方法\n\n围绕用户目标安排主体、纵深、低饱和色彩与柔和逆光。"
            route.fulfill(
                status=200,
                content_type="text/event-stream",
                body=(
                    f'data: {json.dumps({"model": "deepseek-v4-flash", "choices": [{"delta": {"content": result}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 30, "completion_tokens": 15, "total_tokens": 45}}, ensure_ascii=False)}\n\n'
                    "data: [DONE]\n\n"
                ),
            )

        session.context.route("https://api.deepseek.com/**", mock_deepseek)
        skills = session.open_page("skills.html")
        skills.locator("#skill-create").click()
        expect(skills.locator(".skill-case")).to_have_count(2)
        expect(skills.locator("#skill-project-actions")).to_have_count(0)
        skills.locator("#skill-case-search").fill("标题甲")
        expect(skills.locator(".skill-case")).to_have_count(1)
        skills.locator("#skill-visible-select").click()
        expect(skills.locator("#skill-selected-count")).to_have_text("1")
        skills.locator("#skill-case-search").fill("")
        expect(skills.locator(".skill-case")).to_have_count(2)
        expect(skills.locator('.skill-case[data-selected="true"]')).to_have_count(1)
        skills.locator("#skill-visible-select").click()
        expect(skills.locator("#skill-selected-count")).to_have_text("2")
        skills.locator("#skill-goal").fill("只提炼我喜欢的构图、色彩和人物光线")
        skills.locator("#skill-generate").click()
        preflight = skills.locator("#promptdirector-app-dialog")
        expect(preflight).to_be_visible()
        expect(preflight).to_contain_text("案例与证据：2 项")
        expect(preflight).to_contain_text("预计请求：1 次")
        preflight.get_by_role("button", name="开始提炼").click()
        expect(skills.locator("#skill-draft-step")).to_be_visible()
        expect(skills.locator("#skill-markdown")).to_have_value(re.compile("视觉组织方法"))
        assert len(requests) == 1
        sent = json.dumps(requests[0], ensure_ascii=False)
        assert "本地标题甲" not in sent
        assert "本地标题乙" not in sent
        assert "fixture.invalid" not in sent
        assert "只提炼我喜欢的构图、色彩和人物光线" in sent

        skills.locator("#skill-call-name").fill("国风视觉")
        skills.locator("#skill-description").fill("按目标组织构图、色彩和人物光线")
        skills.locator("#skill-save").click()
        expect(skills.locator("#skill-detail")).to_be_visible()
        expect(skills.locator("#skill-detail-feedback")).to_contain_text("Skill 已保存")
        expect(skills.locator("#skill-detail-version")).to_have_text("v1")
        expect(skills.locator("#skill-detail-markdown")).to_contain_text("视觉组织方法")
        expect(skills.locator("#skill-export")).to_have_count(1)
        expect(skills.locator("#skill-search")).to_be_hidden()
        expect(skills.locator("#skill-import")).to_be_hidden()
        expect(skills.locator("#skill-create")).to_be_hidden()
        skills.locator("#skill-detail-more > summary").click()
        skills.locator("#skill-export").click()
        exported_skill, _ = wait_for_download(skills)
        assert zipfile.is_zipfile(exported_skill)
        expect(skills.locator("#skill-detail-feedback")).to_contain_text("Skill 已导出")
        skills.screenshot(path="/tmp/promptdirector-skills-desktop-light.png")

        skills.locator("#skill-detail-edit").click()
        expect(skills.locator("#skill-version-label")).to_have_text("当前 v1")
        original_markdown = skills.locator("#skill-markdown").input_value()
        skills.locator("#skill-markdown").fill(f"{original_markdown}\n\n## 新增判断\n\n先确认主体层级。")
        skills.locator("#skill-save").click()
        expect(skills.locator("#skill-version-label")).to_have_text("当前 v2")
        skills.locator(".skill-version-item").nth(1).locator("button").click()
        restore_dialog = skills.locator("#promptdirector-app-dialog")
        expect(restore_dialog).to_be_visible()
        restore_dialog.get_by_role("button", name="恢复为新版本", exact=True).click()
        expect(skills.locator("#skill-version-label")).to_have_text("当前 v3")
        expect(skills.locator("#skill-markdown")).to_have_value(original_markdown)
        skills.locator("#skill-context-back").click()
        expect(skills.locator("#skill-detail")).to_be_visible()

        page_count = len(session.context.pages)
        skills.locator("#skill-test").click()
        expect(skills).to_have_url(re.compile(r"composer\.html"))
        assert len(session.context.pages) == page_count
        composer = skills
        expect(composer.locator(".composer-skill-chip")).to_contain_text("/国风视觉")

        composer.locator("#composer-new").click()
        composer.locator("#composer-instruction").fill("/国")
        expect(composer.locator("#composer-skill-menu")).to_be_visible()
        composer.locator("#composer-skill-menu button").first.click()
        expect(composer.locator(".composer-skill-chip")).to_contain_text("/国风视觉")
        expect(composer.locator("#composer-instruction")).to_have_value("")
        composer_url = composer.url
        composer_session_match = re.search(r"[?&]session=([^&]+)", composer_url)
        assert composer_session_match, composer_url
        composer_session_id = composer_session_match.group(1)

        composer.go_back(wait_until="domcontentloaded")
        skills = composer
        expect(skills.locator("#skill-detail")).to_be_visible()
        expect(skills.locator("#skill-workspace")).to_be_hidden()
        expect(skills.locator("#skill-detail-markdown")).to_contain_text("视觉组织方法")
        assert "view=detail" in skills.url
        skills.go_back()
        expect(skills.locator("#skill-library")).to_be_visible()
        skills.go_forward()
        expect(skills.locator("#skill-detail")).to_be_visible()
        expect(skills.locator("#skill-test")).not_to_have_class(re.compile("button-secondary"))
        detail_radii = skills.evaluate("""() => ({
          primary: getComputedStyle(document.querySelector('#skill-test')).borderRadius,
          secondary: getComputedStyle(document.querySelector('#skill-detail-edit')).borderRadius
        })""")
        assert detail_radii == {"primary": "4px", "secondary": "4px"}, detail_radii
        skills.locator("#skill-detail-edit").click()
        expect(skills.locator("#skill-source-sidebar")).to_be_hidden()
        assert "view=editor" in skills.url
        skills.locator("#skill-context-back").click()
        expect(skills.locator("#skill-detail")).to_be_visible()
        skills.evaluate(
            """async () => {
              const stored = await chrome.storage.local.get('creativeSkills');
              const skill = stored.creativeSkills.items[0];
              const {createAppliedSkillSnapshot} = await import(chrome.runtime.getURL('creative-skills.js'));
              await chrome.storage.local.set({
                creativeExperimentSettings: {enabled: true, autoAnalyze: false},
                creativeRuns: [{
                  id: 'skill-evidence-run', version: 4, sessionId: 'evidence-session', promptVersionId: 'evidence-prompt',
                  title: '已验证的角色层级', targetType: 'image', promptText: '保持主体层级的角色画面',
                  appliedSkills: [createAppliedSkillSnapshot(skill)], referenceSnapshots: [], retrievedSources: [], briefSnapshot: [],
                  createdAt: '2026-08-08T10:00:00.000Z', updatedAt: '2026-08-08T10:01:00.000Z', events: [],
                  outputs: [{
                    visual: {id: 'skill-evidence-visual', kind: 'image', storageMode: 'managed', mimeType: 'image/webp', width: 1, height: 1, byteSize: 1, capturedAt: '2026-08-08T10:00:00.000Z'},
                    capturedAt: '2026-08-08T10:00:00.000Z', signals: [{type: 'captured', at: '2026-08-08T10:00:00.000Z'}],
                    judgment: {keep: '保留主体层级', improve: '收敛背景细节', updatedAt: '2026-08-08T10:01:00.000Z'}
                  }]
                }]
              });
            }"""
        )
        skills.reload(wait_until="domcontentloaded")
        expect(skills.locator("#skill-detail")).to_be_visible()
        skills.locator("#skill-detail-more > summary").click()
        skills.locator("#skill-detail-refine").click()
        expect(skills.locator("#skill-source-sidebar")).to_be_visible()
        expect(skills.locator("#skill-draft-step")).to_be_visible()
        expect(skills.locator("#skill-run-evidence-step")).to_be_visible()
        expect(skills.locator("#skill-run-evidence-list")).to_contain_text("保留主体层级")
        evidence_checkbox = skills.locator("#skill-run-evidence-list input")
        expect(evidence_checkbox).not_to_be_checked()
        evidence_checkbox.check()
        expect(skills.locator("#skill-run-evidence-count")).to_have_text("1")
        assert "view=refine" in skills.url
        skills.locator("#skill-context-back").click()
        expect(skills.locator("#skill-detail")).to_be_visible()

        skills.locator("#skill-context-back").click()
        expect(skills.locator("#skill-library")).to_be_visible()
        skills.locator("#skill-import").click()
        skills.locator("#skill-zip-file").set_input_files(str(external_zip))
        dependency_dialog = skills.locator("#promptdirector-app-dialog")
        expect(dependency_dialog).to_be_visible()
        dependency_warning = dependency_dialog.text_content()
        dependency_dialog.get_by_role("button", name="仍要导入", exact=True).click()
        expect(skills.locator("#skill-feedback")).to_contain_text("已导入 /external-method")
        assert "scripts" in dependency_warning
        expect(skills.locator(".skill-card")).to_have_count(2)
        card_layout = skills.evaluate("""() => {
          const cards = [...document.querySelectorAll('.skill-card')];
          const verbose = cards.find((card) => card.textContent.includes('external-method'));
          return {
            alignItems: getComputedStyle(document.querySelector('.skill-grid')).alignItems,
            lineClamp: getComputedStyle(verbose.querySelector('p')).webkitLineClamp,
            verboseHeight: verbose.getBoundingClientRect().height
          };
        }""")
        assert card_layout["alignItems"] == "start", card_layout
        assert card_layout["lineClamp"] == "3", card_layout
        assert card_layout["verboseHeight"] < 220, card_layout
        skills.locator(".skill-card", has_text="external-method").click()
        expect(skills.locator("#skill-export")).to_have_count(1)
        skills.locator("#skill-context-back").click()

        skills.goto(composer_url, wait_until="domcontentloaded")
        composer = skills
        composer.locator("#composer-instruction").fill("/external")
        expect(composer.locator("#composer-skill-menu")).to_be_visible()
        composer.locator("#composer-skill-menu button").first.click()
        expect(composer.locator(".composer-skill-chip")).to_have_count(2)
        expect(composer.locator(".composer-skill-chip").nth(1)).to_contain_text("/external-method")
        composer.locator(".composer-skill-chip").nth(1).locator("button").nth(0).click()
        expect(composer.locator(".composer-skill-chip").nth(0)).to_contain_text("/external-method")

        composer.goto(f"chrome-extension://{session.extension_id}/skills.html", wait_until="domcontentloaded")
        skills = composer
        skills.evaluate("""async () => chrome.storage.local.set({
          uiPreferences: { locale: 'en', theme: 'dark', motion: 'none' }
        })""")
        skills.set_viewport_size({"width": 390, "height": 844})
        skills.reload(wait_until="domcontentloaded")
        expect(skills.locator("h1").first).to_have_text("Creative Skill Center")
        expect(skills.locator("html")).to_have_attribute("data-theme", "dark")
        skills.wait_for_function("""() => {
          const channels = getComputedStyle(document.body).backgroundColor.match(/[0-9]+/g)?.map(Number) || [];
          return channels.length >= 3 && Math.max(...channels.slice(0, 3)) < 60;
        }""")
        layout = skills.evaluate("""() => ({
          viewport: innerWidth,
          page: document.documentElement.scrollWidth,
          theme: document.documentElement.dataset.theme,
          rootStyle: document.documentElement.getAttribute('style'),
          bodyStyle: document.body.getAttribute('style'),
          uiPage: getComputedStyle(document.documentElement).getPropertyValue('--ui-page').trim(),
          uiText: getComputedStyle(document.documentElement).getPropertyValue('--ui-text').trim(),
          paper: getComputedStyle(document.documentElement).getPropertyValue('--paper').trim(),
          ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(),
          background: getComputedStyle(document.body).backgroundColor,
          cardBackground: getComputedStyle(document.querySelector('.skill-card')).backgroundColor,
          cardColor: getComputedStyle(document.querySelector('.skill-card')).color
        })""")
        assert layout["page"] <= layout["viewport"], layout
        assert max(rgb_channels(layout["background"])) < 60, layout
        assert max(rgb_channels(layout["cardBackground"])) < 80, layout
        assert min(rgb_channels(layout["cardColor"])) > 180, layout
        skills.screenshot(path="/tmp/promptdirector-skills-mobile-dark-en.png")

        skills.locator(".skill-card", has_text="external-method").click()
        skills.locator("#skill-detail-edit").click()
        skills.locator("#skill-delete").click()
        delete_dialog = skills.locator("#promptdirector-app-dialog")
        expect(delete_dialog).to_be_visible()
        delete_dialog.locator("button[type='submit']").click()
        expect(skills.locator(".skill-card")).to_have_count(1)
        skills.goto(composer_url, wait_until="domcontentloaded")
        composer = skills
        expect(composer.locator(".composer-skill-chip").nth(0)).to_contain_text("/external-method")

        composer.evaluate("""async () => chrome.storage.local.set({
          uiPreferences: { locale: 'zh-CN', theme: 'dark', motion: 'none' }
        })""")
        source_return = session.open_page(f"skills.html?source=composer&session={composer_session_id}")
        expect(source_return.locator("#skill-context-back")).to_have_attribute("aria-label", "返回创作台")
        source_return.locator("#skill-create").click()
        assert "source=composer" in source_return.url
        source_return.go_back()
        expect(source_return.locator("#skill-context-back")).to_have_attribute("aria-label", "返回创作台")
        source_return.locator("#skill-context-back").click()
        expect(source_return).to_have_url(re.compile(rf"composer\.html\?session={re.escape(composer_session_id)}$"))

        print({
            "created": True,
            "anonymous_request": True,
            "versions": 3,
            "detail_export_in_more": True,
            "external_package_import": True,
            "slash_call": True,
            "multi_skill_order": True,
            "mobile_dark_english": True,
            "delete_preserves_session_snapshot": True,
        })

def rgb_channels(value: str) -> tuple[int, int, int]:
    match = re.match(r"rgba?\((\d+),\s*(\d+),\s*(\d+)", value)
    if not match:
        raise AssertionError(f"unsupported computed color: {value}")
    return tuple(int(channel) for channel in match.groups())


if __name__ == "__main__":
    main()
