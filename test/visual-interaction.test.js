import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? "";
}

test("the current project uses the product accent while other library selections stay restrained", async () => {
  const source = await readFile(new URL("../library.css", import.meta.url), "utf8");
  const foundation = await readFile(new URL("../ui-foundation.css", import.meta.url), "utf8");

  assert.match(foundation, /--selection:\s*color-mix\(in srgb, var\(--ui-text\) 6%, var\(--ui-surface\)\)/);
  assert.match(foundation, /--selection-indicator:\s*var\(--ui-accent-emphasis\)/);
  assert.match(foundation, /--focus-ring:\s*var\(--ui-focus\)/);
  assert.match(rule(source, '.project-filter[aria-pressed="true"]'), /color:\s*var\(--accent-ink\)/);
  assert.match(rule(source, '.project-filter[aria-pressed="true"]'), /background:\s*var\(--ui-project-active-surface\)/);
  assert.match(rule(source, '.project-filter[aria-pressed="true"]'), /box-shadow:\s*inset 2px 0 var\(--accent-emphasis\)/);
  assert.doesNotMatch(rule(source, ".project-filter"), /border(?:-color)?:\s*(?!transparent)/);
  assert.match(rule(source, '.content-filter-option[aria-pressed="true"]'), /background:\s*var\(--ui-content-active-surface\)/);
  assert.match(rule(source, '.filter-option[aria-pressed="true"]'), /background:\s*var\(--selection\)/);
  assert.match(rule(source, '.facet-option-row[aria-pressed="true"] .facet-option-check'), /background:\s*var\(--accent-emphasis\)/);
  assert.match(rule(source, ".case-card::after"), /inset:\s*0/);
  assert.match(rule(source, ".case-card:hover::after"), /border-color:\s*var\(--selection-edge\)/);
  assert.doesNotMatch(rule(source, ".case-card:hover"), /box-shadow/);
  assert.match(rule(source, ".case-card.selected-for-share::after"), /border-color:\s*var\(--selection-indicator\)/);
  assert.match(rule(source, ".case-card:focus-visible::after"), /border-width:\s*2px/);
  assert.match(rule(source, ".case-card:focus-visible::after"), /border-color:\s*var\(--focus-ring\)/);
  assert.match(rule(source, ".detail-visual-thumb"), /border:\s*1px solid transparent/);
  assert.match(rule(source, '.manager-tabs button[aria-selected="true"]::after'), /height:\s*1px/);
  assert.match(rule(source, '.analysis-kind-tabs button[aria-selected="true"]'), /background:\s*var\(--selection\)/);
  assert.match(rule(source, ".share-package-import"), /background:\s*var\(--raised\)/);
  assert.match(rule(source, ".share-package-import"), /border:\s*1px solid var\(--line\)/);
  assert.match(rule(source, ".share-package-import"), /box-shadow:\s*none/);
  assert.match(rule(source, "html"), /scrollbar-gutter:\s*stable/);
  assert.doesNotMatch(source, /0 0 0 (?:2px|3px) color-mix\(in srgb, var\(--accent\)/);
});

test("Skill cards keep emphasis in titles and mute paths, body copy, and idle borders", async () => {
  const skills = await readFile(new URL("../skills-page.css", import.meta.url), "utf8");

  assert.match(rule(skills, ".skill-card"), /border:\s*1px solid var\(--ui-card-border\)/);
  assert.match(rule(skills, ".skill-card"), /font-weight:\s*400/);
  assert.match(rule(skills, ".skill-card:hover:not(:disabled)"), /border-color:\s*var\(--ui-border\)/);
  assert.match(rule(skills, ".skill-card h2"), /font-weight:\s*750/);
  assert.match(rule(skills, ".skill-card code"), /color:\s*var\(--muted/);
  assert.match(rule(skills, ".skill-card code"), /font-weight:\s*600/);
  assert.match(rule(skills, ".skill-card p"), /font-weight:\s*450/);
  assert.match(rule(skills, ".skill-card footer"), /font-weight:\s*600/);
  assert.match(rule(skills, ".skill-detail-header code"), /color:\s*var\(--muted\)/);
});

test("composer and Skill selections avoid oversized green outer rings", async () => {
  const [composer, skills] = await Promise.all([
    readFile(new URL("../composer-page.css", import.meta.url), "utf8"),
    readFile(new URL("../skills-page.css", import.meta.url), "utf8")
  ]);

  assert.match(rule(composer, ".composer-input-box:focus-within"), /box-shadow:\s*inset 0 0 0 1px var\(--focus-ring\)/);
  assert.match(rule(composer, '.composer-case-option[data-selected="true"]'), /background:\s*var\(--selection\)/);
  assert.match(rule(composer, ".composer-project-card .composer-project-active"), /box-shadow:\s*inset 2px 0 var\(--selection-indicator\)/);
  assert.doesNotMatch(composer, /0 0 0 (?:2px|3px) color-mix\(in srgb, var\(--accent\)/);
  assert.match(rule(skills, '.skill-case[data-selected="true"]'), /border-color:\s*var\(--selection-indicator\)/);
  assert.match(rule(skills, '.skill-case[data-selected="true"] .skill-case-state'), /background:\s*var\(--accent-emphasis\)/);
  assert.doesNotMatch(skills, /box-shadow:\s*0 0 0 (?:2px|3px) color-mix\(in srgb, var\(--accent\)/);
});

test("composer session delete menu reuses the compact shared danger action", async () => {
  const [foundation, composer, runtime] = await Promise.all([
    readFile(new URL("../ui-foundation.css", import.meta.url), "utf8"),
    readFile(new URL("../composer-page.css", import.meta.url), "utf8"),
    readFile(new URL("../composer-page.js", import.meta.url), "utf8")
  ]);
  assert.match(runtime, /composer-session-delete quiet-danger/);
  assert.match(rule(composer, ".composer-session-menu-panel"), /min-width:\s*84px/);
  assert.match(rule(composer, ".composer-session-menu-panel .quiet-danger"), /min-height:\s*30px/);
  assert.match(rule(foundation, ".quiet-danger"), /color:\s*var\(--ui-danger\)/);
  assert.match(rule(foundation, ".quiet-danger"), /background:\s*transparent/);
  assert.match(rule(foundation, ".quiet-danger:hover:not(:disabled)"), /var\(--ui-danger\) 10%/);
  assert.match(rule(composer, ".composer-session-menu-panel button:disabled"), /color:\s*var\(--muted\)/);
});

test("collector highlights use the shared restrained interaction language", async () => {
  const source = await readFile(new URL("../collector.css", import.meta.url), "utf8");
  const targetBannerSource = source.slice(source.lastIndexOf("\n.target-banner {"));

  assert.match(rule(targetBannerSource, ".target-banner"), /box-shadow:\s*inset 2px 0 var\(--selection-indicator\)/);
  assert.match(rule(source, ".other-capture-methods.fallback-highlight"), /background:\s*var\(--selection\)/);
  assert.match(rule(source, ".other-capture-methods.fallback-highlight"), /box-shadow:\s*inset 2px 0 var\(--selection-indicator\)/);
  assert.match(rule(source, ".visual-card.primary"), /box-shadow:\s*inset 0 0 0 1px var\(--selection-edge\)/);
  assert.doesNotMatch(source, /box-shadow:\s*0 0 0 3px var\(--accent-soft\)/);
});

test("capture notifications use the shared neutral toast instead of legacy green text", async () => {
  const [foundation, collector, collectorHtml, libraryHtml] = await Promise.all([
    readFile(new URL("../ui-foundation.css", import.meta.url), "utf8"),
    readFile(new URL("../collector.css", import.meta.url), "utf8"),
    readFile(new URL("../collector.html", import.meta.url), "utf8"),
    readFile(new URL("../library.html", import.meta.url), "utf8")
  ]);
  const toast = rule(foundation, ".ui-feedback-toast");

  assert.match(collectorHtml, /id="feedback"[^>]*class="ui-feedback-toast"/);
  assert.match(libraryHtml, /id="feedback"[^>]*class="ui-feedback-toast"/);
  assert.match(toast, /position:\s*fixed/);
  assert.match(toast, /color:\s*var\(--ui-text\)/);
  assert.match(toast, /background:\s*var\(--ui-surface\)/);
  assert.match(toast, /border:\s*1px solid var\(--ui-border-strong\)/);
  assert.match(rule(foundation, ".ui-feedback-toast.error"), /color:\s*var\(--ui-danger\)/);
  assert.doesNotMatch(rule(collector, "#feedback"), /color:\s*var\(--accent\)/);
  assert.match(rule(collector, ".smart-selection"), /box-shadow:\s*inset 2px 0 var\(--selection-indicator\)/);
  assert.match(rule(collector, ".smart-selection small"), /color:\s*var\(--muted\)/);
});

test("smart visual picker uses a fine neutral edge with a small branded check", async () => {
  const source = await readFile(new URL("../capture-region.css", import.meta.url), "utf8");
  const candidate = rule(source, "#__prompt_case_visual_picker__ .prompt-case-visual-candidate");
  const hovered = rule(source, "#__prompt_case_visual_picker__ .prompt-case-visual-candidate:hover");
  const selected = rule(source, "#__prompt_case_visual_picker__ .prompt-case-visual-candidate.is-selected");
  const badge = rule(source, "#__prompt_case_visual_picker__ .prompt-case-visual-candidate > span");

  assert.match(candidate, /border:\s*1px solid/);
  assert.doesNotMatch(source, /#55cd8b/i);
  assert.match(hovered, /#d1fe17/);
  assert.match(selected, /#d1fe17/);
  assert.match(badge, /background:\s*#d1fe17/);
  assert.match(source, /transition:\s*border-color 140ms ease/);
});

test("smart visual picker shields video controls and defers dynamic remeasurement until the click completes", async () => {
  const source = await readFile(new URL("../capture-region.js", import.meta.url), "utf8");
  assert.match(source, /document\.addEventListener\(type, stopUnderlyingPageEvent, \{ capture: true, passive: false \}\)/);
  assert.match(source, /if \(activeCandidateInteraction\) \{[\s\S]*pendingCandidateRefresh = true/);
  assert.match(source, /button\.addEventListener\("pointerdown"/);
  assert.match(source, /releaseCandidateInteraction\(\)/);
  assert.match(source, /document\.removeEventListener\(type, stopUnderlyingPageEvent, true\)/);
});
