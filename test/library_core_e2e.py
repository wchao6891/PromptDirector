from __future__ import annotations

import json
import re

from playwright.sync_api import expect

from e2e_support import base_entry, extension_session


def main() -> None:
    entries = [
        base_entry("library-image-one", "青绿色庭院", "低饱和庭院，柔和逆光。", "content:prompt:image", 1),
        base_entry("library-image-two", "红色海报", "高对比红色海报。", "content:prompt:image", 2),
        base_entry("library-video-one", "推镜视频", "镜头缓慢推进，主体由静止转为行走。", "content:prompt:video", 3),
    ]
    entries[0]["metadataLabels"] = ["即梦灵感", "作者：creator", "点赞：3154", "使用：29"]
    with extension_session("prompt-director-library-") as session:
        setup = session.open_page("collector.html")
        setup.evaluate(
            """async (entries) => {
              const {applyFixedAnalysisTags, createFixedFacetCatalog} = await import(chrome.runtime.getURL('tag-taxonomy.js'));
              let state = {facetCatalog: createFixedFacetCatalog(), entries};
              for (const entryId of ['library-image-one', 'library-image-two']) {
                state = applyFixedAnalysisTags(state, entryId, Array.from({length: 7}, (_, index) => ({
                  g: 'style.render', t: `渲染${index}`
                })), {source: 'deepseek_text'}).state;
              }
              state = applyFixedAnalysisTags(state, 'library-video-one', [
                {g: 'style.render', t: '单次渲染词'}
              ], {source: 'deepseek_text'}).state;
              await chrome.storage.local.clear();
              await chrome.storage.local.set({schemaVersion: 24, entries: state.entries, facetCatalog: state.facetCatalog});
            }""",
            entries,
        )
        library = session.open_page("library.html", wait_until="networkidle")
        library.locator("#search-input").fill("library-")
        expect(library.locator(".case-card")).to_have_count(3)
        expect(library.locator("#filter-sidebar")).to_contain_text("内容类型")
        expect(library.locator("#filter-sidebar")).to_contain_text("属性筛选")

        style_filter = library.locator("#facet-filters > .facet-filter", has_text="视觉风格")
        expect(style_filter).to_have_count(1)
        style_filter.locator(":scope > summary").click()
        render_group = style_filter.locator(".facet-group", has_text="渲染方式")
        expect(render_group.locator(".facet-children .filter-option")).to_have_count(6)
        expect(render_group.get_by_role("button", name=re.compile(r"^渲染6\s"))).to_have_count(0)
        expect(render_group.get_by_role("button", name=re.compile(r"^单次渲染词\s"))).to_have_count(0)
        style_filter.get_by_role("button", name=re.compile(r"^渲染方式 3$")).click()
        expect(library.locator(".case-card")).to_have_count(3)
        style_filter.get_by_role("button", name=re.compile(r"^渲染方式 3$")).click()
        expect(library.locator(".case-card")).to_have_count(3)
        library.locator("#search-input").fill("单次渲染词")
        expect(library.locator(".case-card")).to_have_count(1)
        expect(library.locator(".case-card")).to_contain_text("推镜视频")
        library.locator("#search-input").fill("tag:单次渲染词")
        expect(library.locator(".case-card")).to_have_count(1)
        expect(library.locator(".case-card")).to_contain_text("推镜视频")
        library.locator("#search-input").fill("青绿色")
        expect(library.locator(".case-card")).to_have_count(1)
        expect(library.locator(".case-card")).to_contain_text("青绿色庭院")
        expect(library.locator(".case-card")).not_to_contain_text("点赞：3154")
        library.locator(".case-card").click()
        expect(library.locator("#detail-drawer")).to_have_class("detail-drawer open")
        expect(library.locator("#detail-content")).to_contain_text("低饱和庭院")
        expect(library.locator(".metadata-row")).to_have_count(4)
        expect(library.locator(".metadata-list")).to_contain_text("来源")
        expect(library.locator(".metadata-list")).to_contain_text("即梦灵感")
        expect(library.locator(".metadata-list")).to_contain_text("点赞")
        expect(library.locator(".metadata-list")).to_contain_text("3154")
        expect(library.locator(".metadata-section .attribute-pill")).to_have_count(0)
        expect(library.locator(".attribute-section .attribute-pill")).to_have_count(7)
        expect(library.locator(".attribute-section")).to_contain_text("渲染6")
        library.locator(".detail-analysis-menu > summary").click()
        library.get_by_role("button", name="分析检索标签").click()
        expect(library.locator("#feedback")).to_contain_text("文字标签尚未分配 AI 服务")
        library.wait_for_timeout(8_200)
        expect(library.locator("#feedback")).to_be_hidden()
        library.locator("#detail-close").click()
        library.locator("#search-input").fill("3154")
        expect(library.locator(".case-card")).to_have_count(1)
        library.locator("#search-input").fill("")

        library.locator("#open-settings").click()
        library.locator('[data-settings-tab="tasks"]').click()
        before_preview = library.evaluate("async () => chrome.storage.local.get(['entries', 'facetCatalog', 'batchJob', 'analysisRebuildStaging'])")
        library.locator(".advanced-reanalysis > summary").click()
        library.locator("#preview-analysis-reanalyze").click()
        expect(library.locator("#analysis-batch-summary")).to_contain_text("3 次请求")
        expect(library.locator("#analysis-batch-summary")).to_contain_text("全部成功前只暂存")
        after_preview = library.evaluate("async () => chrome.storage.local.get(['entries', 'facetCatalog', 'batchJob', 'analysisRebuildStaging'])")
        assert json.dumps(after_preview, sort_keys=True, ensure_ascii=False) == json.dumps(before_preview, sort_keys=True, ensure_ascii=False)

        library.evaluate(
            """async () => {
              const {facetCatalog} = await chrome.storage.local.get('facetCatalog');
              await chrome.storage.local.set({
                batchJob: {
                version: 2, kind: 'text_tags', mode: 'rebuild', id: 'e2e-recoverable', status: 'completed',
                createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z',
                analysisModel: 'test-only', outputLocale: 'zh-CN', promptVersion: 1,
                profileFingerprint: '', catalogRevision: facetCatalog.revision, resultCatalogRevision: facetCatalog.revision,
                totalCharacters: 2, fixedTaxonomyCharacters: 1,
                items: [{
                  entryId: 'library-image-one', textRevision: 1, fingerprint: '', status: 'succeeded',
                  attempts: 1, claimId: '', error: '', statusCode: 0
                }, {
                  entryId: 'library-image-two', textRevision: 1, fingerprint: '', status: 'failed',
                  attempts: 2, claimId: '', error: 'AI 返回了未知分类路径，本次没有写入', statusCode: 422
                }],
                usage: {promptTokens: 10, completionTokens: 2, totalTokens: 12, cacheHitTokens: 0}
              },
              analysisRebuildStaging: {
                version: 1, jobId: 'e2e-recoverable',
                results: {'library-image-one': {tags: [{g: 'style.render', t: '赛璐珞'}], textRevision: 1}}
              }
              });
            }"""
        )
        library.reload(wait_until="networkidle")
        library.locator("#open-settings").click()
        library.locator('[data-settings-tab="tasks"]').click()
        expect(library.locator("#batch-status-badge")).to_contain_text("重建待完成")
        expect(library.locator("#analysis-batch-summary")).to_contain_text("1 条成功结果已安全暂存")
        expect(library.locator("#analysis-batch-summary")).to_contain_text("AI 返回了未知分类路径")
        expect(library.locator("#retry-analysis-failures")).to_have_text("继续完成重建（1 条）")
        expect(library.locator("#apply-staged-analysis-rebuild")).to_have_text("应用完整成功结果（1 条失败不写入）")
        expect(library.locator("#start-analysis-batch")).to_be_hidden()
        expect(library.locator("#preview-analysis-batch")).to_be_hidden()

        library.locator("#apply-staged-analysis-rebuild").click()
        expect(library.locator("#batch-status-badge")).to_contain_text("成功结果已应用")
        expect(library.locator("#analysis-batch-summary")).to_contain_text("完整成功结果已经生效，1 条失败案例未写入，可单独重试")
        expect(library.locator("#apply-staged-analysis-rebuild")).to_be_hidden()
        expect(library.locator("#retry-analysis-failures")).to_be_hidden()
        partial_state = library.evaluate(
            """async () => chrome.storage.local.get([
              'entries', 'facetCatalog', 'batchJob', 'analysisRebuildStaging', 'analysisBatchUndo'
            ])"""
        )
        partial_entries = {entry["id"]: entry for entry in partial_state["entries"]}
        assert partial_state["batchJob"]["partialApplied"] is True
        assert "analysisRebuildStaging" not in partial_state
        assert partial_state["analysisBatchUndo"]["jobId"] == "e2e-recoverable"
        assert partial_entries["library-image-one"]["analysisPending"] is False
        assert any(
            assignment.get("source") == "deepseek_text"
            for assignment in partial_entries["library-image-one"]["facetAssignments"]
        )
        for pending_id in ["library-image-two", "library-video-one"]:
            assert partial_entries[pending_id]["analysisPending"] is True
            assert not any(
                assignment.get("source") == "deepseek_text"
                for assignment in partial_entries[pending_id].get("facetAssignments", [])
            )

        library.locator("#preview-analysis-batch").click()
        expect(library.locator("#analysis-batch-summary")).to_contain_text("2 次请求")
        expect(library.locator("#analysis-batch-summary")).to_contain_text("未分析 2 条")

        library.evaluate(
            """async () => {
              const {facetCatalog} = await chrome.storage.local.get('facetCatalog');
              await chrome.storage.local.set({
                batchJob: {
                version: 2, kind: 'text_tags', mode: 'rebuild', id: 'e2e-rebuild', status: 'paused',
                createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z',
                analysisModel: 'test-only', outputLocale: 'zh-CN', promptVersion: 1,
                profileFingerprint: '', catalogRevision: facetCatalog.revision, resultCatalogRevision: null,
                totalCharacters: 1, fixedTaxonomyCharacters: 1,
                items: [{
                  entryId: 'library-image-one', textRevision: 1, fingerprint: '', status: 'pending',
                  attempts: 0, claimId: '', error: '', statusCode: 0
                }],
                usage: {promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0}
              },
              analysisRebuildStaging: {version: 1, jobId: 'e2e-rebuild', results: {}}
              });
            }"""
        )
        library.reload(wait_until="networkidle")
        library.locator("#open-settings").click()
        library.locator('[data-settings-tab="tasks"]').click()
        expect(library.locator("#cancel-analysis-batch")).to_be_visible()
        before_cancel = library.evaluate("async () => chrome.storage.local.get(['entries', 'facetCatalog'])")
        library.locator("#cancel-analysis-batch").click()
        expect(library.locator("#batch-status-badge")).to_contain_text("上次已取消")
        after_cancel = library.evaluate("async () => chrome.storage.local.get(['entries', 'facetCatalog', 'analysisRebuildStaging'])")
        assert "analysisRebuildStaging" not in after_cancel
        assert json.dumps({"entries": after_cancel["entries"], "facetCatalog": after_cancel["facetCatalog"]}, sort_keys=True, ensure_ascii=False) == json.dumps(before_cancel, sort_keys=True, ensure_ascii=False)
        library.locator("#settings-close").click()

        library.set_viewport_size({"width": 390, "height": 844})
        library.wait_for_timeout(200)
        assert library.locator("body").evaluate("element => element.scrollWidth <= element.clientWidth")
        expect(library.locator("#package-menu")).to_have_count(0)
        library.locator("#open-settings").click()
        library.locator('[data-settings-tab="tasks"]').click()
        expect(library.locator("#settings-tasks-panel")).to_be_visible()
        expect(library.locator("#manager-dialog")).not_to_be_visible()
        task_layout = library.evaluate(
            """() => {
              const dialog = document.querySelector('#settings-dialog').getBoundingClientRect();
              const panel = document.querySelector('#settings-tasks-panel');
              return {
                dialogLeft: dialog.left,
                dialogRight: dialog.right,
                viewportWidth: innerWidth,
                panelScrollWidth: panel.scrollWidth,
                panelClientWidth: panel.clientWidth
              };
            }"""
        )
        assert task_layout["dialogLeft"] >= 0 and task_layout["dialogRight"] <= task_layout["viewportWidth"], task_layout
        assert task_layout["panelScrollWidth"] <= task_layout["panelClientWidth"], task_layout
        library.locator("#settings-close").click()
        print({"library_cards": 3, "fixed_tag_navigation": True, "error_feedback_auto_clears": True, "rebuild_preview_is_read_only": True, "partial_rebuild_applies_successes": True, "incremental_preview_only_includes_pending": True, "rebuild_recovery_is_explicit": True, "rebuild_cancel_is_clean": True, "mobile_overflow": False})


if __name__ == "__main__":
    main()
