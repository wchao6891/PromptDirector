import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function sources() {
  const [curatedHtml, curatedSkillsHtml, skillsHtml, curatedCss, skillsCss, foundation, libraryCss] = await Promise.all([
    readFile(new URL("../curated.html", import.meta.url), "utf8"),
    readFile(new URL("../curated-skills.html", import.meta.url), "utf8"),
    readFile(new URL("../skills.html", import.meta.url), "utf8"),
    readFile(new URL("../curated.css", import.meta.url), "utf8"),
    readFile(new URL("../skills-page.css", import.meta.url), "utf8"),
    readFile(new URL("../ui-foundation.css", import.meta.url), "utf8"),
    readFile(new URL("../library.css", import.meta.url), "utf8")
  ]);
  return { curatedHtml, curatedSkillsHtml, skillsHtml, curatedCss, skillsCss, foundation, libraryCss };
}

test("discovery pages keep the visible back action and add a logo shortcut to the library", async () => {
  const { curatedHtml, curatedSkillsHtml, skillsHtml } = await sources();
  for (const html of [curatedHtml, curatedSkillsHtml]) {
    assert.match(html, /class="curated-brand-home product-brand" href="library\.html" aria-label="返回视觉创作灵感库"/);
    assert.match(html, /class="product-brand-name">PromptDirector<\/strong><span class="product-brand-tagline" data-i18n="视觉创作灵感库"/);
    assert.match(html, /id="return-library"/);
  }
  assert.match(skillsHtml, /class="skills-brand product-brand" href="library\.html" aria-label="返回视觉创作灵感库"/);
  assert.match(skillsHtml, /class="product-brand-name">PromptDirector<\/strong><span class="product-brand-tagline" data-i18n="视觉创作灵感库"/);
  assert.match(skillsHtml, /id="skill-context-back"/);
});

test("curated cases and the Skill list share one stable responsive frame", async () => {
  const { curatedCss, skillsCss, foundation } = await sources();
  assert.match(foundation, /--ui-browse-max-width:\s*1500px/);
  assert.match(foundation, /--ui-browse-gutter:\s*max\(12px,/);
  assert.match(curatedCss, /min-height:\s*64px;[^}]*padding:\s*10px var\(--ui-browse-gutter\)/);
  assert.match(skillsCss, /min-height:\s*64px;[^}]*padding:\s*10px var\(--ui-browse-gutter\)/);
  assert.match(skillsCss, /\.skills-topbar\s*\{[^}]*min-width:\s*0;/);
  assert.match(skillsCss, /\.skills-search\s*\{\s*min-width:\s*0;/);
  assert.match(curatedCss, /grid-template-areas:\s*"title search actions"/);
  assert.match(curatedCss, /grid-template-areas:\s*"title back" "search search" "tools tools"/);
  assert.match(skillsCss, /\.skills-search\s*\{\s*grid-column:\s*1 \/ -1;\s*grid-row:\s*2;/);
  assert.match(curatedCss, /\.curated-status-bar\s*\{\s*position:\s*static;/);
});

test("the shared product lockup stays fully visible on one line and keeps its mobile grid slot", async () => {
  const { foundation, libraryCss } = await sources();
  assert.match(foundation, /\.product-brand-name,\s*\.product-brand-tagline\s*\{[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;[^}]*white-space:\s*nowrap;/);
  assert.match(libraryCss, /grid-template-areas:\s*"toggle brand actions" "search search search";/);
});
