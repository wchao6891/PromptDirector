import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function sources() {
  const [casesHtml, skillsHtml, curatedSkillPage, skillsPage, skillsCenter, foundation, composerPage, composerStyle] = await Promise.all([
    readFile(new URL("../curated.html", import.meta.url), "utf8"),
    readFile(new URL("../curated-skills.html", import.meta.url), "utf8"),
    readFile(new URL("../curated-skill-page.js", import.meta.url), "utf8"),
    readFile(new URL("../skills-page.js", import.meta.url), "utf8"),
    readFile(new URL("../skills.html", import.meta.url), "utf8"),
    readFile(new URL("../ui-foundation.css", import.meta.url), "utf8"),
    readFile(new URL("../composer-page.js", import.meta.url), "utf8"),
    readFile(new URL("../composer-page.css", import.meta.url), "utf8")
  ]);
  return { casesHtml, skillsHtml, curatedSkillPage, skillsPage, skillsCenter, foundation, composerPage, composerStyle };
}

test("curated cases and curated Skills are independent sibling pages", async () => {
  const { casesHtml, skillsHtml, skillsCenter } = await sources();
  assert.match(casesHtml, /href="curated-skills\.html"[^>]*>精选 Skill</);
  assert.match(skillsHtml, /href="curated\.html"[^>]*>精选案例</);
  assert.match(skillsHtml, /aria-current="page"[^>]*>精选 Skill</);
  assert.match(skillsHtml, /id="return-library"/);
  assert.match(skillsHtml, /src="curated-skill-page\.js"/);
  assert.match(skillsCenter, /href="curated-skills\.html">精选 Skill</);
});

test("ordinary lossless export and curated submission are separate Skill detail actions", async () => {
  const { skillsCenter, skillsPage } = await sources();
  assert.match(skillsCenter, /id="skill-export"[^>]*data-i18n="导出 Skill"/);
  assert.match(skillsCenter, /id="skill-submit-curated"[^>]*data-i18n="投稿到精选 Skill"/);
  assert.match(skillsCenter, /id="skill-submission-dialog"/);
  assert.match(skillsCenter, /id="skill-submission-preview"/);
  assert.match(skillsCenter, /id="skill-submission-findings"/);
  assert.match(skillsPage, /exportStoredSkillPackage\(skill, \{ readFile: getMediaBlob \}\)/);
  assert.match(skillsPage, /buildCuratedSkillSnapshot/);
  assert.match(skillsPage, /buildCuratedSkillSubmissionArchive/);
  assert.match(skillsPage, /chrome\.tabs\.create\(\{ url: CURATED_SKILL_SUBMISSION_URL \}\)/);
  assert.match(skillsPage, /from "\.\/curated-config\.js"/);
  assert.doesNotMatch(skillsPage, /github\.rest|issues\.create|auto.?publish/i);
  for (const hiddenMaintenanceField of ["skill-submission-id", "skill-submission-version", "skill-submission-author-id", "skill-submission-license"]) {
    assert.doesNotMatch(skillsCenter, new RegExp(`id="${hiddenMaintenanceField}"`));
  }
  assert.match(skillsCenter, /id="skill-submission-author"/);
  assert.match(skillsCenter, /id="skill-submission-summary"/);
  assert.match(skillsCenter, /id="skill-submission-rights"[^>]*type="checkbox"/);
  assert.match(skillsCenter, /允许其他用户在保留署名的前提下保存、使用和修改/);
  assert.match(skillsPage, /chrome\.storage\.local\.(?:get|set)/);
});

test("curated Skill page verifies bytes and installs through the rollback transaction", async () => {
  const { curatedSkillPage } = await sources();
  assert.match(curatedSkillPage, /normalizeCuratedSkillCatalog/);
  assert.match(curatedSkillPage, /fetchCuratedPackage/);
  assert.match(curatedSkillPage, /verifyCuratedSkillPackageBlob/);
  assert.match(curatedSkillPage, /validateCuratedSkillPackage/);
  assert.match(curatedSkillPage, /installCuratedSkillTransaction/);
  assert.match(curatedSkillPage, /saveSkillPackageBlob/);
  assert.match(curatedSkillPage, /deleteMediaBlobs/);
  assert.match(curatedSkillPage, /type: "CREATE_CREATIVE_SKILL"/);
  assert.doesNotMatch(curatedSkillPage, /innerHTML|insertAdjacentHTML|eval\(|new Function/);
});

test("curated Skill page distinguishes load failure, an empty catalog, and no search results", async () => {
  const { curatedSkillPage } = await sources();
  assert.match(curatedSkillPage, /function catalogFailureReason/);
  assert.match(curatedSkillPage, /function clearSearch/);
  assert.match(curatedSkillPage, /精选 Skill 目录暂时为空/);
  assert.match(curatedSkillPage, /没有匹配的精选 Skill/);
  assert.match(curatedSkillPage, /清空搜索/);
  assert.match(curatedSkillPage, /暂时无法读取精选 Skill/);
  assert.doesNotMatch(curatedSkillPage, /showStatus\(error\.message/);
});

test("Skill discovery surfaces share one compact visual contract and keep maintenance facts secondary", async () => {
  const { casesHtml, skillsHtml, curatedSkillPage, foundation, composerPage, composerStyle } = await sources();
  assert.match(foundation, /\.ui-segmented\s*\{/);
  assert.match(foundation, /\.ui-segmented-item\s*\{/);
  assert.match(foundation, /\.ui-skill-card\s*\{/);
  assert.match(casesHtml, /curated-sections ui-segmented/);
  assert.match(skillsHtml, /curated-sections ui-segmented/);
  assert.match(skillsHtml, /placeholder="搜索 Skill 或用途"/);
  assert.match(curatedSkillPage, /ui-skill-card curated-skill-card/);
  assert.match(curatedSkillPage, /查看说明/);
  assert.match(curatedSkillPage, /保存到本地/);
  assert.match(curatedSkillPage, /版本与许可/);
  assert.match(curatedSkillPage, /curated-skill-maintenance/);
  assert.match(curatedSkillPage, /removeDuplicateTitleHeading/);
  assert.match(composerPage, /ui-skill-card composer-skill-card/);
  assert.match(composerStyle, /\.composer-skill-card/);
});
