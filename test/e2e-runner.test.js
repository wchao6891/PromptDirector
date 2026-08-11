import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

test("E2E runner executes independent business scripts and reports after all complete", async () => {
  const [packageJson, runner] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("./run_e2e.py", import.meta.url), "utf8")
  ]);
  const scripts = [
    "capture_and_cross_page_e2e.py",
    "library_core_e2e.py",
    "curated_video_workflow_e2e.py",
    "library_import_ui_e2e.py",
    "import_job_lifecycle_e2e.py",
    "projects_and_categories_e2e.py",
    "text_and_image_analysis_e2e.py",
  "composer_generation_e2e.py",
  "composer_video_generation_e2e.py",
    "sharing_and_data_safety_e2e.py",
    "region_and_smart_picker_e2e.py",
    "smart_visual_picker_e2e.py",
    "page_capture_e2e.py",
    "ai_provider_registry_e2e.py",
    "video_detail_layout_e2e.py",
    "creative_skills_e2e.py"
  ];
  assert.equal(JSON.parse(packageJson).scripts["test:e2e"], "python3 test/run_e2e.py");
  scripts.forEach((script) => assert.match(runner, new RegExp(`"${script.replaceAll(".", "\\.")}"`)));
  assert.match(runner, /check=False/);
  assert.match(runner, /results\.append\(result\)/);
  assert.match(runner, /if failed:/);
  await assert.rejects(access(new URL("./extension_e2e.py", import.meta.url)));
});
