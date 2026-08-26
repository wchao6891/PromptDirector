from __future__ import annotations

import os
import tempfile
from pathlib import Path

from playwright.sync_api import Playwright, sync_playwright

from e2e_support import launch_context, record_page_errors


PREVIOUS_EXTENSION_DIR = Path(os.environ["PROMPTDIRECTOR_PREVIOUS_EXTENSION_DIR"]).resolve()
CURRENT_EXTENSION_DIR = Path(os.environ["PROMPTDIRECTOR_CURRENT_EXTENSION_DIR"]).resolve()
PREVIOUS_RELEASE_TAG = os.environ["PROMPTDIRECTOR_PREVIOUS_RELEASE_TAG"]


def open_extension(playwright: Playwright, profile: str, extension_dir: Path):
    context = launch_context(
        playwright,
        profile,
        viewport={"width": 1280, "height": 900},
        accept_downloads=True,
        extension_dir=extension_dir,
    )
    worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
    return context, worker.url.split("/")[2]


def seed_previous_release(playwright: Playwright, profile: str) -> tuple[str, str]:
    context, extension_id = open_extension(playwright, profile, PREVIOUS_EXTENSION_DIR)
    errors: list[str] = []
    try:
        page = context.new_page()
        record_page_errors(page, errors)
        page.goto(f"chrome-extension://{extension_id}/collector.html")
        result = page.evaluate(
            """async () => {
              const taxonomy = await import(chrome.runtime.getURL('taxonomy.js'));
              const facets = await import(chrome.runtime.getURL('facets.js'));
              const organizer = await import(chrome.runtime.getURL('organizer.js'));
              const active = {
                id: 'upgrade:active', schemaVersion: taxonomy.SCHEMA_VERSION,
                title: '升级保留的案例', text: '用户正文必须跨版本保留',
                savedAt: '2026-08-26T00:00:00.000Z',
                classification: {pathIds: [taxonomy.CONTENT_IDS.promptImage], status: 'confirmed', source: 'manual'},
                facetAssignments: [], analysisCandidates: [], analysisBreakdown: [],
                customLabels: ['用户标签'], mediaAssets: []
              };
              const trashed = {
                ...structuredClone(active), id: 'upgrade:trashed', title: '回收站案例',
                customLabels: ['回收站标签']
              };
              await chrome.storage.local.clear();
              await chrome.storage.local.set({
                schemaVersion: taxonomy.SCHEMA_VERSION,
                taxonomy: taxonomy.createDefaultTaxonomy(),
                facetCatalog: facets.createDefaultFacetCatalog(),
                classificationRules: [],
                organizerState: {version: organizer.ORGANIZER_VERSION, collections: [{
                  id: 'upgrade:project', name: '升级项目', parentId: null, order: 0,
                  entryIds: [active.id]
                }]},
                compoundCases: [],
                trashState: {version: 1, items: [{
                  id: 'trash:entry:upgrade', kind: 'entry', targetId: trashed.id,
                  deletedAt: '2026-08-26T00:10:00.000Z', snapshot: trashed,
                  relationships: {collections: []}
                }]},
                entries: [active],
                composerSessions: [{
                  id: 'upgrade:composer', title: '升级保留的创作会话', targetType: 'image',
                  referenceSnapshots: [],
                  messages: [{
                    id: 'upgrade:message', role: 'user', type: 'request',
                    content: '保留这条创作要求', createdAt: '2026-08-26T00:20:00.000Z'
                  }],
                  promptVersions: [],
                  createdAt: '2026-08-26T00:20:00.000Z', updatedAt: '2026-08-26T00:20:00.000Z'
                }]
              });
              const state = await chrome.runtime.sendMessage({type: 'GET_STATE'});
              return {
                version: chrome.runtime.getManifest().version,
                activeIds: state.entries.map((entry) => entry.id),
                trashIds: state.trashState.items.map((item) => item.targetId),
                sessionIds: state.composerSessionSummaries.map((session) => session.id)
              };
            }"""
        )
        assert result["activeIds"] == ["upgrade:active"], result
        assert result["trashIds"] == ["upgrade:trashed"], result
        assert result["sessionIds"] == ["upgrade:composer"], result
        assert not errors, errors
        return result["version"], extension_id
    finally:
        context.close()


def verify_current_package(playwright: Playwright, profile: str, previous_version: str, expected_id: str) -> None:
    context, extension_id = open_extension(playwright, profile, CURRENT_EXTENSION_DIR)
    errors: list[str] = []
    try:
        assert extension_id == expected_id, (extension_id, expected_id)
        page = context.new_page()
        record_page_errors(page, errors)
        page.goto(f"chrome-extension://{extension_id}/library.html", wait_until="networkidle")
        result = page.evaluate(
            """async () => {
              const state = await chrome.runtime.sendMessage({type: 'GET_STATE'});
              return {
                version: chrome.runtime.getManifest().version,
                schemaVersion: state.schemaVersion,
                active: state.entries.map((entry) => ({
                  id: entry.id, title: entry.title, text: entry.text, customLabels: entry.customLabels
                })),
                trash: state.trashState.items.map((item) => ({
                  targetId: item.targetId, title: item.snapshot?.title,
                  customLabels: item.snapshot?.customLabels
                })),
                projects: state.organizerState.collections.map((project) => ({
                  id: project.id, name: project.name, entryIds: project.entryIds
                })),
                sessions: state.composerSessionSummaries
              };
            }"""
        )
        assert version_tuple(result["version"]) >= version_tuple(previous_version), result
        assert result["active"] == [{
            "id": "upgrade:active", "title": "升级保留的案例",
            "text": "用户正文必须跨版本保留", "customLabels": ["用户标签"]
        }], result
        assert result["trash"] == [{
            "targetId": "upgrade:trashed", "title": "回收站案例",
            "customLabels": ["回收站标签"]
        }], result
        assert result["projects"] == [{
            "id": "upgrade:project", "name": "升级项目", "entryIds": ["upgrade:active"]
        }], result
        assert [session["id"] for session in result["sessions"]] == ["upgrade:composer"], result
        assert not errors, errors
    finally:
        context.close()


def version_tuple(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in value.split("."))


def main() -> None:
    assert PREVIOUS_EXTENSION_DIR.joinpath("manifest.json").exists(), PREVIOUS_EXTENSION_DIR
    assert CURRENT_EXTENSION_DIR.joinpath("manifest.json").exists(), CURRENT_EXTENSION_DIR
    with tempfile.TemporaryDirectory(prefix="promptdirector-release-profile-") as profile:
        with sync_playwright() as playwright:
            previous_version, extension_id = seed_previous_release(playwright, profile)
            verify_current_package(playwright, profile, previous_version, extension_id)
    print(f"升级资料保持通过：{PREVIOUS_RELEASE_TAG} → 当前最终包")


if __name__ == "__main__":
    main()
