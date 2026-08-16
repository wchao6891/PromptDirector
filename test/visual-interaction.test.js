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
  assert.match(foundation, /--selection-indicator:\s*color-mix\(in srgb, var\(--ui-text\) 40%, transparent\)/);
  assert.match(foundation, /--focus-ring:\s*var\(--ui-focus\)/);
  assert.match(rule(source, '.project-filter[aria-pressed="true"]'), /color:\s*var\(--accent-ink\)/);
  assert.match(rule(source, '.project-filter[aria-pressed="true"]'), /background:\s*var\(--accent-soft\)/);
  assert.match(rule(source, '.project-filter[aria-pressed="true"]'), /box-shadow:\s*inset 2px 0 var\(--accent\)/);
  assert.match(rule(source, '.filter-option[aria-pressed="true"]'), /background:\s*var\(--selection\)/);
  assert.match(rule(source, '.facet-option-row[aria-pressed="true"] .facet-option-check'), /background:\s*var\(--accent\)/);
  assert.match(rule(source, ".case-card.selected-for-share"), /box-shadow:\s*inset 0 0 0 1px var\(--selection-indicator\)/);
  assert.match(rule(source, ".detail-visual-thumb"), /border:\s*1px solid transparent/);
  assert.match(rule(source, '.manager-tabs button[aria-selected="true"]::after'), /height:\s*1px/);
  assert.match(rule(source, '.analysis-kind-tabs button[aria-selected="true"]'), /background:\s*var\(--selection\)/);
  assert.match(rule(source, ".share-package-import"), /background:\s*var\(--raised\)/);
  assert.match(rule(source, ".share-package-import"), /border:\s*1px solid var\(--line\)/);
  assert.match(rule(source, ".share-package-import"), /box-shadow:\s*none/);
  assert.doesNotMatch(source, /0 0 0 (?:2px|3px) color-mix\(in srgb, var\(--accent\)/);
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
  assert.match(rule(skills, '.skill-case[data-selected="true"] .skill-case-state'), /background:\s*var\(--accent\)/);
  assert.doesNotMatch(skills, /box-shadow:\s*0 0 0 (?:2px|3px) color-mix\(in srgb, var\(--accent\)/);
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
