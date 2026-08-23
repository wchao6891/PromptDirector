from __future__ import annotations

import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path


TEST_DIR = Path(__file__).resolve().parent
SCRIPTS = [
    "capture_and_cross_page_e2e.py",
    "library_core_e2e.py",
    "library_navigation_e2e.py",
    "curated_workflow_e2e.py",
    "curated_skills_install_e2e.py",
    "curated_video_workflow_e2e.py",
    "library_import_ui_e2e.py",
    "import_job_lifecycle_e2e.py",
    "library_media_actions_e2e.py",
    "video_detail_layout_e2e.py",
    "media_reference_cards_e2e.py",
    "library_detail_actions_e2e.py",
    "library_discovery_e2e.py",
    "projects_and_categories_e2e.py",
    "text_and_image_analysis_e2e.py",
    "single_case_visual_batch_e2e.py",
    "composer_generation_e2e.py",
    "composer_reference_picker_e2e.py",
    "composer_video_generation_e2e.py",
    "creative_job_recovery_e2e.py",
    "composer_image_workspace_e2e.py",
    "composer_temp_references_e2e.py",
    "composer_session_layout_e2e.py",
    "sharing_and_data_safety_e2e.py",
    "manual_sync_e2e.py",
    "region_and_smart_picker_e2e.py",
    "smart_visual_picker_e2e.py",
    "page_capture_e2e.py",
    "jimeng_capture_e2e.py",
    "ai_provider_registry_e2e.py",
    "creative_skills_e2e.py",
    "skill_source_density_e2e.py",
    "manager_regression_e2e.py",
    "library_gallery_recovery_e2e.py",
    "library_132_e2e.py",
    "large_library_e2e.py",
    "library-thumbnail-rebind-e2e.py",
    "creative_feedback_e2e.py",
    "ui_foundation_e2e.py",
    "material_management_regressions_e2e.py",
    "ui_regressions_e2e.py",
    "settings_visual_anchor_e2e.py",
    "brand_i18n_e2e.py",
    "english_interaction_states_e2e.py",
]


@dataclass
class Result:
    script: str
    returncode: int
    duration: float
    output: str


def main() -> None:
    results: list[Result] = []
    for script in SCRIPTS:
        started = time.monotonic()
        completed = subprocess.run(
            [sys.executable, str(TEST_DIR / script)],
            cwd=TEST_DIR.parent,
            capture_output=True,
            text=True,
            check=False,
        )
        result = Result(script, completed.returncode, time.monotonic() - started, completed.stdout + completed.stderr)
        results.append(result)
        state = "PASS" if result.returncode == 0 else "FAIL"
        print(f"[{state}] {script} ({result.duration:.1f}s)", flush=True)
        if result.returncode:
            print(result.output.rstrip(), flush=True)

    print("\nE2E summary")
    for result in results:
        state = "通过" if result.returncode == 0 else "失败"
        print(f"- {state} {result.script}: {result.duration:.1f}s")
    failed = [result for result in results if result.returncode]
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
