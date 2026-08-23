# PromptDirector UX visual QA

## Evidence

- Source visual truth:
  - External attachment `截屏2026-08-23 下午4.05.33.png`
  - External attachment `截屏2026-08-23 下午4.05.43.png`
- Rendered implementation:
  - `<local-temp>/promptdirector-curated-list-1905.png`
  - `<local-temp>/promptdirector-skills-list-1911.png`
  - `<local-temp>/promptdirector-curated-list-390.png`
  - `<local-temp>/promptdirector-skills-list-390.png`
- Desktop viewport and pixels:
  - Curated source and implementation: `1905 x 810` CSS px and image px.
  - Skill source and implementation: `1911 x 810` CSS px and image px.
- Narrow viewport and pixels: both implementations `390 x 844` CSS px and image px.
- Density normalization: device scale factor `1`; no resampling required.
- State: dark theme, Chinese locale, top-level curated pack wall and top-level Skill list.

## Full-view comparison

The exact-size desktop comparison confirms that both top-level pages now use the same 1500 px outer frame, 64 px top bar, centered search track, and right-aligned return action. At the supplied desktop widths, the curated and Skill left anchors are respectively `202.5 px` and `205.5 px`, which is the expected difference from their 6 px viewport-width difference. The Skill list no longer shifts its identity to the browser edge while its content remains centered.

The existing page content was retained: curated keeps its pack wall, and the Skill page keeps its heading, actions, and card grid. The test fixture uses solid-color media responses, so fixture image content is excluded from asset-fidelity judgment; production media rendering code and source assets were not changed.

## Focused region comparison

The focused check covered the two top bars and main-content left edges because those were the reported jump points. Measured implementation anchors:

- Curated at 1905 px: brand `202.5`, search `592.5–1312.5`, return `1594.5–1702.5`, main `202.5–1702.5`.
- Skill at 1911 px: brand `205.5`, search `595.5–1315.5`, return `1597.5–1705.5`, main `205.5–1705.5`.

No additional image crop or card-detail comparison was needed because this change does not alter those components.

## Required fidelity surfaces

- Fonts and typography: existing families, weights, sizes, line heights, truncation, and hierarchy are unchanged.
- Spacing and layout rhythm: the two top-level pages now share the same frame, header height, search width, content edge, and responsive gutters. Existing card gaps and radii are unchanged.
- Colors and visual tokens: existing dark/light tokens are unchanged; the shared frame adds layout tokens only.
- Image quality and asset fidelity: no product image, logo, icon, crop, or media renderer was replaced. Existing brand and UI icon assets are reused.
- Copy and content: visible labels and page content are unchanged. Only accessible return labels were added to the clickable brand shortcuts.

## Findings

- No remaining P0, P1, or P2 visual mismatch in the approved scope.
- P3: curated uses a three-row narrow header so search and tools never compete for width. This is an intentional responsive reflow, not a desktop redesign.

## Comparison history

1. Initial 390 px resize check reported a 411 px document width in the Skill list.
2. The search and header grid items were given explicit zero minimum widths so their intrinsic text width cannot force horizontal expansion.
3. Post-fix Chrome checks passed both live resize from 1911 px to 390 px and a fresh 390 px load: document width `390`, no overflowing elements, brand and return on row one, search on row two.
4. Curated Chrome checks passed at 1905 px and 390 px: document width equals viewport, brand and return stay on row one, search and tools reflow below without nested scrolling.

## Interactions and console

- Existing right-side return paths passed their navigation regression coverage.
- The added brand shortcuts are native links to `library.html` and retain visible keyboard focus.
- Both extension sessions completed without page errors.

final result: passed

---

## Case selection toolbar QA

### Evidence

- Source visual truth: external attachment `截屏2026-08-23 下午5.49.55.png` (`1653 x 251` px), dark Chinese zero-selection state before this change.
- Approved interaction target: the user-confirmed stable top-row plan in this task; the source screenshot is the problem evidence rather than a visual clone target.
- Rendered desktop implementation at device scale factor `1`:
  - `/private/var/folders/mc/sjmh6ky52v76h0h_ymmjhysm0000gn/T/promptdirector-selection-toolbar-empty.png` (`1658 x 900` CSS px and image px).
  - `/private/var/folders/mc/sjmh6ky52v76h0h_ymmjhysm0000gn/T/promptdirector-selection-toolbar-active.png` (`1658 x 900` CSS px and image px).
- Focused desktop crops: `promptdirector-selection-toolbar-empty-top.png` and `promptdirector-selection-toolbar-active-top.png` (`1653 x 251` px), kept as local QA artifacts rather than public source paths.
- Rendered narrow implementation at device scale factor `1`:
  - `/private/var/folders/mc/sjmh6ky52v76h0h_ymmjhysm0000gn/T/promptdirector-selection-toolbar-mobile-empty.png` (`390 x 844` CSS px and image px).
  - `/private/var/folders/mc/sjmh6ky52v76h0h_ymmjhysm0000gn/T/promptdirector-selection-toolbar-mobile-active.png` (`390 x 844` CSS px and image px).
- Density normalization: source and implementation are both 1x; the focused desktop crops normalize the original screenshot height and width without resampling.

### Full-view and focused comparison

The original zero-selection bar exposed the complete batch-edit form in a bordered container. The implementation keeps the existing gallery row height and shows only the selected count, select-current action, and cancel action. After a selection exists, the same row swaps to clear, labels, project, share, more, and cancel without adding a row or moving the gallery.

The focused comparison confirms that the batch bar no longer looks like a second page header: the outer box, inline tag field, inline project field, duplicate confirmation buttons, destructive action, and analysis action are absent from the zero-selection state. The selected state uses existing PromptDirector button, icon, menu, focus, and accent tokens. The fixture uses intentionally minimal black media blobs, so card imagery is excluded from fidelity judgment; production media rendering was not changed.

### Required fidelity surfaces

- Fonts and typography: existing PromptDirector UI family, 12 px action scale, weights, line height, and Chinese copy hierarchy are retained. Mobile icon-only actions keep accessible names.
- Spacing and layout rhythm: entering selection mode preserves the first card at the same vertical coordinate; the automated measurement was `114 px` before and after. Desktop actions stay on one 34 px row. The 390 px toolbar floats at the bottom without changing document width.
- Colors and visual tokens: existing dark/light surfaces, restrained borders, lime primary action, danger action, and focus ring are reused. No new palette or gradient was introduced.
- Image and icon fidelity: existing local UI sprite icons are reused. Selection circles were normalized to 24 px with one restrained edge and the existing lime checked state; no replacement image assets were required.
- Copy and content: zero-selection copy is reduced to `已选 0`, `全选当前（数量）`, and `取消`. Selected-only actions are grouped under `加标签`, `加入项目`, `分享`, and `更多` while all prior capabilities remain available.

### Findings

- No remaining P0, P1, or P2 mismatch in the approved scope.
- P3: the desktop test fixture contains only two black placeholder cards. This affects fixture imagery only, not the selection toolbar or production asset pipeline.

### Comparison history

1. The first implementation still moved the gallery from `114 px` to `116 px` when selection mode opened.
2. The selection row was reduced from 36 px to the existing 34 px gallery-row height.
3. The post-fix browser measurement is `114 px` before and after, satisfying the at-most-1-pixel acceptance threshold.
4. Desktop and mobile active-state captures showed every persistent action inside its container. Button `scrollWidth` is no larger than `clientWidth`, and the 390 px page reports no horizontal overflow.

### Interactions and console

- Verified 0, 1, and 2 selected cases; combine is unavailable for one case and available for two.
- Verified label, project, and more menus open; `Escape` closes a menu and restores focus to its trigger.
- Verified project target selection enables the join action; share, analyze, trash, and combination retain their existing state rules.
- Related isolated Chromium tests passed for library navigation, project combination, and a 6500-case library.
- No page errors were reported by the isolated extension runs.
- The user-installed Chrome page could not be opened by the browser-control security policy, so installed-Chrome acceptance remains a separate manual gate.

final result: passed

---

## Collector, page capture, and stable filter QA

### Evidence

- Source visual truth:
  - `截屏2026-08-23 下午3.07.02.png` (`539 x 248`) for the original horizontal capture entrance.
  - `截屏2026-08-23 下午3.07.15.png` (`527 x 763`) for the original dense page-capture state.
  - `截屏2026-08-23 下午3.10.45.png` for the original dynamic project-filter row.
- Rendered implementation at device scale factor `1`:
  - `<local-temp>/promptdirector-collector-entry-390.png` (`390 x 844`).
  - `<local-temp>/promptdirector-capture-permission-390.png` (`390 x 844`).
  - `<local-temp>/promptdirector-page-capture-390.png` (`390 x 1072`, full page).
  - `<local-temp>/promptdirector-step2-library-mobile.png` (`390 x 888`, full page).
- State: dark theme, Chinese locale, empty collector, first-use permission dialog, real injected page-capture fixture, and active project filter.

### Full-view comparison

The capture entrance keeps the existing brand, library entry, color system, icons, and secondary screenshot path. Only the three common actions changed from a compressed horizontal row into three full-width 58 px rows. Their labels no longer compete for width, and all three remain above the secondary screenshot action.

The first-use dialog now fits within `263.3 px` of an `844 px` viewport. It retains one authorization action, one cancel action, and one optional clipboard checkbox. There are no per-feature authorization controls.

The page-capture state retains candidate inspection, region correction, batch capture, metadata, media review, text-only save, and full save. Correction controls and full article previews are collapsed by default. Compared with the source screenshot, the always-visible policy paragraph, five correction buttons, and full nested article reader no longer occupy the initial decision surface.

### Focused interaction and layout checks

- The three primary capture entrances measured at least `58 px` high and had strictly increasing vertical positions at `390 px`.
- First-use authorization showed exactly two footer actions and did not overflow the viewport.
- The candidate list, media-review list, and article preview all computed to `overflow-y: visible`; the collector page owns vertical scrolling.
- A real page-capture run saved six media items, preserved article ordering, supported region include/exclude/undo, and completed list-mode capture.
- Selecting a project left the first content-filter section at the exact same vertical coordinate. The clear-filter control changed enabled state in the fixed project heading; no status row was inserted.
- The `390 px` library drawer remained within the viewport (`0–310 px`) and created no horizontal overflow.
- The project heading now contains only `+ 新建` and project ordering. The ambiguous boxed clear icon was removed; clicking the selected project again clears that project filter without inserting or shifting any row.
- A real image import produced local palette `#E84838`; no automatic AI job was created.

### Findings

- No P0, P1, or P2 visual or interaction issue remains in this scope.
- P3: page-capture metadata remains visible below candidates because project, type, and tags affect the saved case. It is one shared save form, not a second scrolling page.
- Installed user-Chrome acceptance remains separate from the isolated extension E2E evidence above.

final result: passed
