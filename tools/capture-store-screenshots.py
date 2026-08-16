from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import expect


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "test"))

from e2e_support import ai_configuration_fixture, base_entry, extension_session  # noqa: E402


OUTPUT_DIR = PROJECT_ROOT / "store" / "screenshots"
VIEWPORT = {"width": 1280, "height": 800}
DEMO_CASES = [
    ("电影感逆光人像", "用轮廓光分离人物与背景，保留克制的暗部层次。", [225, 63, 28]),
    ("低饱和庭院构图", "以门框建立前景，让主体停留在画面三分线附近。", [145, 30, 32]),
    ("冷调城市夜景", "用青蓝环境光统一空间，仅保留少量暖色视觉锚点。", [205, 42, 22]),
    ("高速动作镜头", "通过斜向动势、近景遮挡和速度差强化冲击。", [18, 67, 28]),
    ("产品静物光线", "用大面积柔光塑造材质，再以窄边光勾勒轮廓。", [48, 54, 36]),
    ("雾中山谷层次", "以前中后景的明度差建立空气透视和空间深度。", [168, 28, 38]),
    ("手绘角色表情", "先锁定眉眼和嘴角关系，再控制局部夸张程度。", [332, 43, 30]),
    ("留白海报版式", "让标题、主体和负空间形成清晰的阅读顺序。", [72, 70, 34]),
]


def demo_entries() -> list[dict]:
    values: list[dict] = []
    for index, (title, prompt, _color) in enumerate(DEMO_CASES):
        entry = base_entry(
            f"store-demo-{index + 1}",
            f"演示 · {title}",
            prompt,
            "content:prompt:image",
            index,
        )
        asset_id = f"store-demo-image-{index + 1}"
        entry["mediaAssets"] = [{
            "id": asset_id,
            "kind": "image",
            "usage": "content",
            "storageMode": "managed",
            "mimeType": "image/png",
            "width": 960,
            "height": 720,
            "capturedAt": "2026-08-16T08:00:00.000Z",
            "reviewStatus": "verified",
        }]
        entry["primaryMediaId"] = asset_id
        entry["customLabels"] = ["商店演示素材"]
        values.append(entry)
    return values


def main() -> None:
    entries = demo_entries()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with extension_session("prompt-director-store-assets-", viewport=VIEWPORT) as session:
        setup = session.open_page("collector.html", wait_until="networkidle")
        session.seed_storage(setup, {
            "schemaVersion": 24,
            "entries": entries,
            "dataSafetyOnboardingSeen": True,
            "organizerState": {
                "version": 6,
                "collections": [{
                    "id": "collection:store-demo",
                    "name": "视觉方向研究",
                    "order": 0,
                    "entryIds": [entry["id"] for entry in entries],
                }],
            },
            "uiPreferences": {"locale": "zh-CN", "theme": "dark", "motion": "none"},
            **ai_configuration_fixture(
                providers={
                    "deepseek": {
                        "endpoint": "https://api.deepseek.com/chat/completions",
                        "protocol": "chat_completions",
                        "apiKey": "store-screenshot-fixture-not-sent",
                        "consent": True,
                        "models": {"skillExtraction": "deepseek-v4-flash"},
                    }
                },
                assignments={
                    "skillExtraction": {"providerId": "deepseek", "model": "deepseek-v4-flash"}
                },
            ),
        })
        setup.evaluate(
            """async ({entries, colors}) => {
              const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
              for (const [index, entry] of entries.entries()) {
                const [hue, saturation, lightness] = colors[index];
                const canvas = document.createElement('canvas');
                canvas.width = 960;
                canvas.height = 720;
                const context = canvas.getContext('2d');
                const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
                gradient.addColorStop(0, `hsl(${hue} ${saturation}% ${Math.max(10, lightness - 14)}%)`);
                gradient.addColorStop(1, `hsl(${(hue + 54) % 360} ${Math.max(18, saturation - 18)}% ${Math.min(68, lightness + 18)}%)`);
                context.fillStyle = gradient;
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.globalAlpha = .82;
                context.fillStyle = index % 2 ? '#d1fe17' : '#f4f5f0';
                context.beginPath();
                context.arc(260 + (index % 3) * 190, 250 + (index % 2) * 120, 155, 0, Math.PI * 2);
                context.fill();
                context.globalAlpha = .74;
                context.fillStyle = '#0f1113';
                context.fillRect(510 - (index % 2) * 140, 120, 245, 455);
                context.globalAlpha = 1;
                context.fillStyle = '#f4f5f0';
                context.font = '700 34px sans-serif';
                context.fillText(`STUDY ${String(index + 1).padStart(2, '0')}`, 42, 650);
                const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
                await saveMediaBlob(entry.primaryMediaId, blob, {checkCapacity: false});
              }
            }""",
            {"entries": entries, "colors": [item[2] for item in DEMO_CASES]},
        )
        setup.wait_for_function(
            """async (count) => {
              const state = await chrome.runtime.sendMessage({type: 'GET_STATE'});
              return state?.entries?.length === count;
            }""",
            arg=len(entries),
        )

        library = session.open_page("library.html", wait_until="networkidle")
        expect(library.locator("#case-list .case-card")).to_have_count(len(entries))
        library.wait_for_function(
            """() => [...document.querySelectorAll('#case-list img')]
              .filter((image) => image.complete && image.naturalWidth > 0).length >= 6"""
        )
        library.screenshot(path=str(OUTPUT_DIR / "01-library-1280x800.png"), full_page=False)

        skills = session.open_page("skills.html", wait_until="networkidle")
        skills.locator("#skill-create").click()
        expect(skills.locator(".skill-case")).to_have_count(len(entries))
        skills.wait_for_function(
            """() => [...document.querySelectorAll('.skill-case-visual img')]
              .filter((image) => image.complete && image.naturalWidth > 0).length >= 6"""
        )
        skills.locator(".skill-case-toggle").nth(0).click()
        skills.locator(".skill-case-toggle").nth(2).click()
        skills.locator("#skill-goal").fill("提炼画面的主体层级、光线组织与色彩节奏")
        skills.screenshot(path=str(OUTPUT_DIR / "02-skills-1280x800.png"), full_page=False)

        composer = session.open_page("composer.html", wait_until="networkidle")
        expect(composer.locator("#composer-instruction")).to_be_visible()
        composer.screenshot(path=str(OUTPUT_DIR / "03-composer-1280x800.png"), full_page=False)

    print({"screenshots": [str(path) for path in sorted(OUTPUT_DIR.glob("0*-1280x800.png"))]})


if __name__ == "__main__":
    main()
