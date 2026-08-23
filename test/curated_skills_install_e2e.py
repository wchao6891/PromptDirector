from __future__ import annotations

import hashlib
import io
import json
import zipfile

from playwright.sync_api import expect

from e2e_support import extension_session


CATALOG_URL = "https://wchao6891.github.io/PromptDirector-Curated/skills-catalog.json"
GOOD_URL = "https://github.com/wchao6891/PromptDirector-Curated/releases/download/skills/good-skill.zip"
ROLLBACK_URL = "https://github.com/wchao6891/PromptDirector-Curated/releases/download/skills/rollback-skill.zip"
UNSAFE_URL = "https://github.com/wchao6891/PromptDirector-Curated/releases/download/skills/unsafe-skill.zip"


def skill_archive(name: str, description: str, body: str, *, unsafe_script: bool = False) -> bytes:
    stream = io.BytesIO()
    skill_markdown = f"---\nname: {name}\ndescription: {description}\n---\n\n{body}\n"
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("SKILL.md", skill_markdown)
        archive.writestr("references/guide.md", "# Guide\n\nKeep the subject readable.\n")
        if unsafe_script:
            archive.writestr("scripts/run.sh", "echo should-never-run\n")
    return stream.getvalue()


def catalog_item(*, catalog_id: str, skill_id: str, title: str, download_url: str, archive: bytes, order: int, call_name: str | None = None) -> dict:
    return {
        "id": catalog_id,
        "skillId": skill_id,
        "version": "1.0.0",
        "title": title,
        "callName": call_name or skill_id,
        "authorId": "synthetic-author",
        "author": "合成测试作者",
        "license": "CC BY 4.0",
        "reviewStatus": "approved",
        "reviewedAt": "2026-08-23T00:00:00.000Z",
        "summary": f"{title} 的合成测试摘要。",
        "downloadUrl": download_url,
        "sha256": hashlib.sha256(archive).hexdigest(),
        "archiveBytes": len(archive),
        "order": order,
    }


def persisted_snapshot(page) -> dict:
    return page.evaluate(
        """async () => {
          const stored = await chrome.storage.local.get('creativeSkills');
          const skills = stored.creativeSkills?.items ?? [];
          const database = await new Promise((resolve, reject) => {
            const request = indexedDB.open('prompt-case-collector');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const keys = await new Promise((resolve, reject) => {
            const request = database.transaction('media', 'readonly').objectStore('media').getAllKeys();
            request.onsuccess = () => resolve(request.result.map(String).sort());
            request.onerror = () => reject(request.error);
          });
          const {getMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
          const files = [];
          for (const skill of skills) {
            for (const file of skill.packageFiles ?? []) {
              const blob = await getMediaBlob(file.assetId);
              files.push({
                skillId: skill.curatedOrigin?.skillId ?? '',
                path: file.path,
                assetId: file.assetId,
                size: blob?.size ?? -1,
                text: blob ? await blob.text() : ''
              });
            }
          }
          database.close();
          return {skills, keys, files};
        }"""
    )


def main() -> None:
    good_archive = skill_archive("good-skill", "A safe synthetic Skill.", "# 安全精选 Skill\n\n## 使用方法\n\nUse clear hierarchy.")
    rollback_archive = skill_archive("rollback-skill", "A rollback fixture.", "# Rollback method\n\nKeep local work intact.")
    unsafe_archive = skill_archive("unsafe-skill", "An unsafe fixture.", "# Unsafe method\n\nThis text itself is inert.", unsafe_script=True)
    items = [
        catalog_item(catalog_id="good-skill@1.0.0", skill_id="good-skill", title="安全精选 Skill", call_name="中式意境巨构", download_url=GOOD_URL, archive=good_archive, order=1),
        catalog_item(catalog_id="rollback-skill@1.0.0", skill_id="rollback-skill", title="回滚精选 Skill", download_url=ROLLBACK_URL, archive=rollback_archive, order=2),
        catalog_item(catalog_id="unsafe-skill@1.0.0", skill_id="unsafe-skill", title="不安全精选 Skill", download_url=UNSAFE_URL, archive=unsafe_archive, order=3),
    ]
    catalog = {
        "format": "prompt-director-curated-skills",
        "version": 1,
        "updatedAt": "2026-08-23T00:00:00.000Z",
        "skills": items,
    }
    requests: list[str] = []

    with extension_session("prompt-director-curated-skills-install-", viewport={"width": 1280, "height": 900}) as session:
        session.context.route("https://**", lambda route: route.abort("blockedbyclient"))

        def fulfill(url: str, content_type: str, body) -> None:
            def handler(route) -> None:
                requests.append(route.request.url)
                route.fulfill(status=200, content_type=content_type, body=body)
            session.context.route(url, handler)

        fulfill(CATALOG_URL, "application/json", json.dumps(catalog, ensure_ascii=False))
        fulfill(GOOD_URL, "application/zip", good_archive)
        fulfill(ROLLBACK_URL, "application/zip", rollback_archive)
        fulfill(UNSAFE_URL, "application/zip", unsafe_archive)

        setup = session.open_page("collector.html")
        session.seed_storage(setup, {
            "schemaVersion": 24,
            "creativeSkills": {"version": 1, "items": []},
            "uiPreferences": {"locale": "zh-CN", "theme": "light", "motion": "none"},
        })
        setup.close()

        page = session.open_page("curated-skills.html")
        expect(page.locator(".curated-skill-card")).to_have_count(3)
        assert requests == [CATALOG_URL], requests

        good_card = page.locator(".curated-skill-card").filter(has=page.get_by_role("heading", name="安全精选 Skill", exact=True))
        card_copy = good_card.text_content()
        assert "合成测试作者" not in card_copy, card_copy
        assert "CC BY 4.0" not in card_copy, card_copy
        assert "v1.0.0" not in card_copy, card_copy
        assert "/中式意境巨构" not in card_copy, card_copy
        save = good_card.get_by_role("button", name="保存到本地", exact=True)
        save.click()
        expect(page.locator("#skill-toast")).to_have_text("精选 Skill 已保存到本地")

        first = persisted_snapshot(page)
        assert len(first["skills"]) == 1, first
        saved_skill = first["skills"][0]
        assert saved_skill["callName"] == "中式意境巨构", saved_skill
        assert saved_skill["portableId"] == "good-skill", saved_skill
        assert saved_skill["curatedOrigin"]["skillId"] == "good-skill", saved_skill
        assert saved_skill["curatedOrigin"]["version"] == "1.0.0", saved_skill
        assert [file["path"] for file in saved_skill["packageFiles"]] == ["SKILL.md", "references/guide.md"], saved_skill
        assert len(first["keys"]) == 2, first
        assert first["keys"] == sorted(file["assetId"] for file in saved_skill["packageFiles"]), first
        saved_text = {file["path"]: file["text"] for file in first["files"]}
        assert "Use clear hierarchy." in saved_text["SKILL.md"], saved_text
        assert saved_text["references/guide.md"] == "# Guide\n\nKeep the subject readable.\n", saved_text

        good_card = page.locator(".curated-skill-card").filter(has=page.get_by_role("heading", name="安全精选 Skill", exact=True))
        good_card.get_by_role("button", name="查看说明", exact=True).click()
        expect(page.locator("#skill-detail-dialog")).to_be_visible()
        expect(page.locator(".curated-skill-markdown")).to_contain_text("使用方法")
        expect(page.locator(".curated-skill-markdown h1")).to_have_count(0)
        maintenance = page.locator(".curated-skill-maintenance")
        expect(maintenance).not_to_have_attribute("open", "")
        expect(maintenance.get_by_text("许可：CC BY 4.0", exact=True)).to_be_hidden()
        maintenance.locator("summary").click()
        expect(maintenance.get_by_text("许可：CC BY 4.0", exact=True)).to_be_visible()

        # Force a second click through the real handler so the idempotent transaction is exercised,
        # rather than only accepting the disabled UI as evidence.
        already_saved = page.locator("#skill-detail-dialog").get_by_role("button", name="已保存")
        expect(already_saved).to_be_disabled()
        already_saved.evaluate("button => { button.disabled = false; }")
        already_saved.click()
        expect(page.locator("#skill-toast")).to_have_text("这个版本已经在本地")
        second = persisted_snapshot(page)
        assert len(second["skills"]) == 1, second
        assert second["keys"] == first["keys"], {"first": first, "second": second}

        page.locator("#skill-detail-close").click()
        patched = page.evaluate(
            """() => {
              const original = chrome.runtime.sendMessage;
              window.__promptDirectorOriginalSendMessage = original;
              chrome.runtime.sendMessage = (...args) => args[0]?.type === 'CREATE_CREATIVE_SKILL'
                ? Promise.resolve({ok: false, message: '模拟元数据提交失败'})
                : original.apply(chrome.runtime, args);
              return chrome.runtime.sendMessage !== original;
            }"""
        )
        assert patched is True
        page.locator(".curated-skill-card", has_text="回滚精选 Skill").get_by_role("button", name="保存到本地", exact=True).click()
        expect(page.locator("#skill-toast")).to_have_text("模拟元数据提交失败")
        rolled_back = persisted_snapshot(page)
        assert len(rolled_back["skills"]) == 1, rolled_back
        assert rolled_back["keys"] == first["keys"], {"before": first, "after": rolled_back}

        page.evaluate("chrome.runtime.sendMessage = window.__promptDirectorOriginalSendMessage")
        unsafe_card = page.locator(".curated-skill-card", has_text="不安全精选 Skill")
        unsafe_card.get_by_role("button", name="保存到本地", exact=True).click()
        expect(page.locator("#skill-toast")).to_contain_text("包含不允许的文件")
        after_unsafe = persisted_snapshot(page)
        assert len(after_unsafe["skills"]) == 1, after_unsafe
        assert after_unsafe["keys"] == first["keys"], {"before": first, "after": after_unsafe}

        assert requests == [CATALOG_URL, GOOD_URL, ROLLBACK_URL, UNSAFE_URL], requests

        page.evaluate("""async () => chrome.storage.local.set({
          uiPreferences: {locale: 'en', theme: 'dark', motion: 'none'}
        })""")
        page.set_viewport_size({"width": 390, "height": 844})
        page.reload(wait_until="domcontentloaded")
        expect(page.locator("html")).to_have_attribute("data-theme", "dark")
        expect(page.locator(".curated-skill-card")).to_have_count(3)
        expect(page.locator("#skill-search")).to_have_attribute("placeholder", "Search by Skill or purpose")
        page.locator(".curated-skill-card").first.hover()
        mobile_visual = page.evaluate("""() => {
          const card = document.querySelector('.curated-skill-card');
          const title = card.querySelector('.ui-skill-card-title');
          const nav = document.querySelector('.curated-sections');
          return {
            pageWidth: document.documentElement.scrollWidth,
            viewportWidth: innerWidth,
            cardHeight: card.getBoundingClientRect().height,
            cardBackground: getComputedStyle(card).backgroundColor,
            titleSize: getComputedStyle(title).fontSize,
            navWidth: nav.getBoundingClientRect().width
          };
        }""")
        assert mobile_visual["pageWidth"] == mobile_visual["viewportWidth"] == 390, mobile_visual
        assert 152 <= mobile_visual["cardHeight"] < 220, mobile_visual
        assert mobile_visual["titleSize"] == "17px", mobile_visual
        assert mobile_visual["navWidth"] < 230, mobile_visual
        assert mobile_visual["cardBackground"] != "rgb(209, 254, 23)", mobile_visual
        print({
            "installedSkills": len(after_unsafe["skills"]),
            "storedPackageFiles": len(after_unsafe["keys"]),
            "sameVersionIdempotent": True,
            "metadataFailureRolledBack": True,
            "unsafePackageRejected": True,
            "mobileDarkVisualContract": mobile_visual,
            "externalNetworkRequests": 0,
        })


if __name__ == "__main__":
    main()
