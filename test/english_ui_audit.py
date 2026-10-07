"""English interface audit: leftover Chinese and labels that overflow or wrap. Isolated synthetic fixture.

All fixture content is English, so any visible Chinese is interface text that was not translated.
A label counts as a problem when its text runs outside its own box without an ellipsis, or when a
short button / menu label wraps onto a second line. Pages and states are opened the way a user does;
nothing is written outside the isolated profile.

Opt-in tool (not part of run_e2e). Prints a report; exits non-zero when anything is found.
  python3 test/english_ui_audit.py [--widths 1280,390] [--json report.json]
"""
from __future__ import annotations

import argparse
import json
import sys
import re
import tempfile
from playwright.sync_api import expect
from pathlib import Path

from e2e_support import base_entry, extension_session

WIDTHS = [1440, 1100, 390]

COLLECT = r"""(state) => {
  // Chinese characters and full-width punctuation such as “：” or “（”.
  const CJK = /[㐀-鿿\u3000-\u303f\uff00-\uff0a\uff0c-\uffef]/; // ＋ (U+FF0B) is used as an icon glyph
  const shown = el => el && el.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true });
  const path = el => {
    const parts = [];
    for (let node = el; node && node !== document.body && parts.length < 4; node = node.parentElement) {
      parts.unshift(node.id ? `#${node.id}` : node.tagName.toLowerCase() + (typeof node.className === 'string' && node.className.trim() ? '.' + node.className.trim().split(/\s+/)[0] : ''));
      if (node.id) break;
    }
    return parts.join(' > ');
  };
  // Catalog content is published data, not interface text.
  const CONTENT = '.pack-card, .ui-skill-card, .pack-meta, .curated-detail-content, .case-card .case-title';
  const found = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    const text = node.textContent.replace(/\s+/g, ' ').trim();
    if (text && CJK.test(text) && shown(node.parentElement) && !node.parentElement.closest(CONTENT)) found.push({ kind: 'chinese', text: text.slice(0, 120), at: path(node.parentElement) });
  }
  for (const el of document.querySelectorAll('[placeholder],[title],[aria-label]')) {
    if (!shown(el) || el.closest(CONTENT)) continue;
    for (const name of ['placeholder', 'title', 'aria-label']) {
      const value = el.getAttribute(name);
      if (value && CJK.test(value)) found.push({ kind: 'chinese', text: `${name}: ${value.slice(0, 100)}`, at: path(el) });
    }
  }
  const labels = 'button, a, summary, label, [role=tab], [role=menuitem], th, [role=columnheader], h1, h2, h3, h4, legend';
  const lineTops = rects => new Set(rects.map(rect => Math.round(rect.top / 4)));
  for (const el of document.querySelectorAll(labels)) {
    if (!shown(el) || el.closest(CONTENT)) continue;
    const box = el.getBoundingClientRect();
    if (box.width <= 2 || box.height <= 2) continue; // visually hidden text for screen readers
    const style = getComputedStyle(el);
    const texts = [];
    const textWalker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node; (node = textWalker.nextNode());) {
      if (!node.textContent.trim() || node.parentElement.closest('input, textarea, select') || !shown(node.parentElement)) continue;
      const holder = node.parentElement.getBoundingClientRect();
      if (holder.width <= 2 || holder.height <= 2) continue; // screen-reader-only text
      // Text cut with an ellipsis is a deliberate truncation, not an overflow.
      let truncated = false;
      for (let item = node.parentElement; item && !truncated; item = item === el ? null : item.parentElement) truncated = getComputedStyle(item).textOverflow === 'ellipsis' && getComputedStyle(item).overflowX === 'hidden';
      if (truncated) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      texts.push({ node, rects: [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0) });
    }
    if (!texts.length) continue;
    const text = el.textContent.replace(/\s+/g, ' ').trim();
    const spills = texts.some(item => item.rects.some(rect => rect.right > box.right + 1 || rect.left < box.left - 1));
    const hidden = style.overflowX === 'hidden' && el.scrollWidth > el.clientWidth + 1 && style.textOverflow !== 'ellipsis'
      && !texts.some(item => getComputedStyle(item.node.parentElement).textOverflow === 'ellipsis');
    if (spills || hidden) found.push({ kind: 'overflow', text: text.slice(0, 80), at: path(el), width: Math.round(box.width), needs: Math.round(el.scrollWidth) });
    const control = ['BUTTON', 'SUMMARY', 'A'].includes(el.tagName) || ['tab', 'menuitem'].includes(el.getAttribute('role'));
    // One phrase broken over two lines; separate lines made of separate elements are layout, not wrapping.
    const broken = texts.find(item => item.node.textContent.trim().length <= 40 && lineTops(item.rects).size > 1);
    if (control && broken && getComputedStyle(broken.node.parentElement).whiteSpace !== 'pre-wrap') found.push({ kind: 'wrapped', text: broken.node.textContent.trim().slice(0, 80), at: path(el), width: Math.round(box.width) });
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) found.push({ kind: 'overflow', text: `page scrolls sideways (${document.documentElement.scrollWidth}px)`, at: 'html' });
  return found.map(item => ({ ...item, state }));
}"""

SEED_MEDIA = """async () => {
  const {saveMediaBlob} = await import('./media-store.js');
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 400;
  const context = canvas.getContext('2d');
  for (const [id, color] of [['img-a', '#396b81'], ['img-b', '#b07043'], ['img-c', '#5d7b3a']]) {
    context.fillStyle = color; context.fillRect(0, 0, 640, 400);
    await saveMediaBlob(id, await new Promise(resolve => canvas.toBlob(resolve, 'image/png')));
  }
  const video = await (await fetch(chrome.runtime.getURL('../test/fixtures/review-frames.webm')).catch(() => null))?.blob?.();
  return Boolean(video);
}"""


def entries():
    items = []
    for index in range(14):
        entry = base_entry(f"case-{index}", f"Rain chase study {index}", "A long tracking shot through neon rain, handheld, shallow depth of field." if index % 3 else "",
                           "content:image-case" if index % 2 else "content:image-prompt", index)
        entry["customLabels"] = ["Reference", "Night"] if index % 2 else []
        if index < 3:
            entry["mediaAssets"] = [{"id": ["img-a", "img-b", "img-c"][index], "kind": "image", "storageMode": "managed", "mimeType": "image/png",
                                     "width": 640, "height": 400, "sourceTitle": "frame.png"}]
            entry["primaryMediaId"] = entry["mediaAssets"][0]["id"]
        items.append(entry)
    multi = base_entry("case-multi", "Two frames side by side", "Prompt for the pair", "content:image-prompt", 20)
    multi["mediaAssets"] = [{"id": "img-a", "kind": "image", "storageMode": "managed", "mimeType": "image/png", "width": 640, "height": 400, "sourceTitle": "a.png"},
                            {"id": "img-b", "kind": "image", "storageMode": "managed", "mimeType": "image/png", "width": 640, "height": 400, "sourceTitle": "b.png"}]
    multi["primaryMediaId"] = "img-a"
    items.append(multi)
    return items


def open_each_menu(page, state, report):
    """Open every rendered disclosure menu once, including ones revealed only on hover, and audit it."""
    count = page.evaluate("() => document.querySelectorAll('details > summary').length")
    for index in range(count):
        label = page.evaluate("""index => {
          const summary = document.querySelectorAll('details > summary')[index];
          // Hover-only menus are hidden until pointed at; the row holding them is what must be on screen.
          if (!summary || !summary.parentElement.parentElement?.checkVisibility() || summary.parentElement.open) return null;
          summary.parentElement.open = true;
          return (summary.getAttribute('aria-label') || summary.textContent || '').trim().slice(0, 40);
        }""", index)
        if label is None:
            continue
        page.wait_for_timeout(200)
        print(f"  visiting {state} / menu {label}", file=sys.stderr)
        # Menus close when the window is resized, so each width reopens this one first.
        report(f"{state} / menu {label}", lambda index=index: page.evaluate(
            "index => { const s = document.querySelectorAll('details > summary')[index]; if (s) s.parentElement.open = true; }", index))
        page.evaluate("index => { const summary = document.querySelectorAll('details > summary')[index]; if (summary) summary.parentElement.open = false; }", index)


def audit_dynamic_states(run, library, audit, findings):
    """Open real dynamic UI paths. Cancel destructive/paid actions at their dialogs."""
    run.context.set_default_timeout(5000)
    def dialog(page, action, state):
        action()
        panel = page.locator('#promptdirector-app-dialog')
        expect(panel).to_be_visible()
        print(f'  visiting {state}: {panel.inner_text()}', file=sys.stderr, flush=True)
        audit(page, state)
        panel.get_by_role('button', name='Cancel', exact=True).click()
        expect(panel).not_to_be_visible()

    def group(name, work):
        try:
            work()
        except Exception as error:
            findings.append({'kind':'workflow', 'text':str(error)[:450], 'at':name, 'width':WIDTHS[0], 'state':name})
            print(f'  workflow blocked {name}: {error}', file=sys.stderr, flush=True)
        finally:
            library.keyboard.press('Escape')
            if library.locator('#share-cancel').is_visible():
                library.locator('#share-cancel').click()
            library.goto(library.url.split('?')[0], wait_until='networkidle')
            expect(library.locator('body')).to_have_attribute('data-library-state','ready')

    def batch():
        library.locator('#select-cases').click()
        library.locator('.case-card[data-entry-id="case-0"]').click()
        library.locator('.case-card[data-entry-id="case-1"]').click()
        dialog(library,lambda:library.locator('#selection-trash').click(),'batch trash confirmation')
        library.locator('#selection-more-menu > summary').click()
        dialog(library,lambda:library.locator('#selection-combine').click(),'batch combine dialog')
    group('batch',batch)

    def projects():
        row=library.locator('.project-row').filter(has=library.locator('.project-menu')).first
        for label,state in [('Rename','project rename'),('Delete project only','project delete only'),('Delete project and cases','project delete with cases'),('Move to…','project move')]:
            def click(label=label):
                row.locator('details > summary').evaluate('node=>node.click()')
                row.get_by_role('button',name=label,exact=True).click()
            dialog(library,click,state)
    group('projects',projects)

    def trash():
        response=library.evaluate("()=>chrome.runtime.sendMessage({type:'DELETE_ENTRY',entryId:'case-13'})")
        assert response.get('ok'),response
        library.locator('#open-trash').click()
        expect(library.locator('.trash-item')).to_have_count(1)
        dialog(library,lambda:library.locator('.trash-item-actions .quiet-danger').click(),'trash permanent item')
        dialog(library,lambda:library.locator('#trash-empty').click(),'trash empty confirmation')
    group('trash',trash)

    def detail():
        library.locator('.case-card[data-entry-id="case-multi"]').click()
        expect(library.locator('#detail-drawer')).to_have_attribute('aria-hidden','false')
        editor=library.locator('.entry-editor-inline')
        editor.locator('summary').click()
        audit(library,'detail edit case')
        # Media deletion is exposed in the same actual media action menu as normal use.
        buttons=library.locator('.media-remove-action')
        expect(buttons).not_to_have_count(0)
        dialog(library,lambda:buttons.first.evaluate('node=>node.click()'),'detail remove media')
    group('detail',detail)

    def settings():
        library.locator('#open-settings').evaluate('node=>node.click()')
        library.locator('[data-settings-tab="layout"]').click()
        dialog(library,lambda:library.locator('#layout-create').click(),'settings new layout')
        library.locator('#layout-reset').click()
        audit(library,'settings layout reset')
        library.locator('[data-settings-tab="shortcuts"]').click()
        library.locator('#shortcut-reset').click()
        audit(library,'settings shortcuts reset')
        library.locator('[data-settings-tab="rules"]').click()
        library.locator('[data-analysis-kind="composer"]').click()
        library.locator('#composer-agent-instruction').fill('Custom agent instructions for audit')
        library.locator('#save-composer-agent').click()
        expect(library.locator('#composer-agent-save-state')).to_have_text('Saved')
        dialog(library,lambda:library.locator('#restore-composer-agent').click(),'settings restore agent rules')
        library.locator('#composer-task-method').fill('Custom task instructions for audit')
        library.locator('#composer-settings-form [type=submit]').click()
        expect(library.locator('#composer-task-save-state')).to_have_text('Saved')
        dialog(library,lambda:library.locator('#restore-composer-task').click(),'settings restore task rules')
    group('settings',settings)

    def skills():
        created=library.evaluate(r"""()=>chrome.runtime.sendMessage({type:'CREATE_CREATIVE_SKILL',skill:{callName:'audit-method',description:'English audit material',skillMarkdown:'# Audit method\n\nOriginal material stays unchanged.'}})""")
        assert created.get('ok'),created
        page=run.open_page('skills.html',wait_until='networkidle')
        try:
            page.locator('.skill-card').first.click()
            expect(page.locator('#skill-detail')).to_be_visible()
            audit(page,'skill detail')
            page.locator('#skill-detail-edit').click()
            audit(page,'skill edit')
            dialog(page,lambda:page.locator('#skill-delete').click(),'skill delete confirmation')
        finally:page.close()
    group('skills',skills)

    def composer():
        saved=library.evaluate("""()=>chrome.runtime.sendMessage({type:'UPSERT_COMPOSER_SESSION',session:{id:'english-audit-session',title:'Audit conversation',messages:[{id:'audit-user',role:'user',content:'Original audit conversation text'}]}})""")
        assert saved.get('ok'),saved
        page=run.open_page('composer.html',wait_until='networkidle')
        try:
            expect(page.locator('.composer-session-menu')).not_to_have_count(0)
            page.locator('.composer-session-menu > summary').first.focus()
            page.locator('.composer-session-menu > summary').first.click()
            dialog(page,lambda:page.locator('.composer-session-delete').first.click(),'composer delete conversation')
            page.locator('#composer-reference-open').click()
            audit(page,'composer reference selection')
            page.keyboard.press('Escape')
        finally:page.close()
    group('composer',composer)

    def capture():
        from generic_capture_template_details_e2e import PAGE
        origin='https://wchao6891.github.io'
        run.context.route(origin+'/**',lambda route:route.fulfill(body=PAGE,content_type='text/html'))
        source=run.context.new_page();source.goto(origin+'/dynamic-audit')
        page=run.open_page('collector.html',wait_until='networkidle')
        try:
            page.evaluate("()=>chrome.storage.local.set({capturePermissionOnboarding:{version:1,acknowledgedAt:'2026-10-07T00:00:00Z',clipboardIncluded:true}})")
            source.bring_to_front();page.locator('#start-selection').evaluate('node=>node.click()')
            expect(source.locator('#promptdirector-content-picker')).to_be_attached()
            source.locator('.wanted .card p').first.click()
            expect(page.locator('.page-capture-item')).to_have_count(1)
            audit(page,'capture manual preview')
            source.locator('[data-promptdirector-capture-template]').evaluate("node=>node.removeAttribute('data-promptdirector-capture-template')")
            page.locator('#page-capture-mode').select_option('list')
            page.locator('#page-capture-target-count').fill('3')
            source.bring_to_front();page.locator('#page-capture-list-run').evaluate('node=>node.click()')
            expect(page.locator('#page-capture-help')).to_contain_text('Your selection is no longer available')
            audit(page,'capture expired selection')
        finally:source.close();page.close()
    group('capture',capture)


def main():
    global WIDTHS
    parser = argparse.ArgumentParser()
    parser.add_argument("--widths", default="1440,1100,390")
    parser.add_argument("--json", type=Path)
    parser.add_argument("--dynamic-only", action="store_true")
    parser.add_argument("--evidence-dir", type=Path)
    args = parser.parse_args()
    WIDTHS = [int(value) for value in args.widths.split(",")]
    out = args.evidence_dir or Path(tempfile.mkdtemp(prefix="pd-english-audit-evidence-"))
    out.mkdir(parents=True, exist_ok=True)
    findings = []
    with extension_session("pd-english-audit-", viewport={"width": WIDTHS[0], "height": 900}) as run:
        setup = run.open_page("collector.html")
        run.seed_storage(setup, {"entries": entries(), "settings": {"libraryTitle": "Visual Inspiration Library"},
                                 "uiPreferences": {"locale": "en", "theme": "dark", "motion": "reduced"}})
        setup.evaluate(SEED_MEDIA)
        for name, parent in [("Neon noir", None), ("Chase scenes with a deliberately long project name", None)]:
            setup.evaluate("message => chrome.runtime.sendMessage(message)", {"type": "CREATE_COLLECTION", "name": name, "parentId": parent})

        def audit(page, state, reopen=None):
            for width in WIDTHS:
                page.set_viewport_size({"width": width, "height": 900})
                page.wait_for_timeout(250)
                if reopen:
                    reopen()
                    page.wait_for_timeout(150)
                found = page.evaluate(COLLECT, state)
                if args.dynamic_only:
                    page.screenshot(path=str(out / f"{re.sub(r'[^a-zA-Z0-9]+', '-', state)}-{width}.png"))
                findings.extend({**item, "width": width} for item in found)
            page.set_viewport_size({"width": WIDTHS[0], "height": 900})
            page.wait_for_timeout(150)

        library = run.open_page("library.html")
        library.wait_for_selector('body[data-library-state="ready"]')
        library.wait_for_timeout(800)
        if args.dynamic_only:
            audit_dynamic_states(run, library, audit, findings)
            print(f"Screenshots: {out}")
            write_report(findings, args.json)
            return
        audit(library, "library")
        open_each_menu(library, "library", lambda state, reopen: audit(library, state, reopen))
        # Sidebar project actions, management mode and its menus.
        for selector, state in [("#select-cases", "library manage")]:
            library.locator(selector).click()
            library.locator("#case-list .case-card").first.click()
            library.wait_for_timeout(300)
            audit(library, state)
            open_each_menu(library, state, lambda s, reopen: audit(library, s, reopen))
            library.keyboard.press("Escape")
            library.reload(); library.wait_for_selector('body[data-library-state="ready"]')
        # Dialogs and views opened from the toolbar and sidebar.
        def click_and_audit(selector, state, close="Escape"):
            target = library.locator(selector)
            if not target.count():
                print(f"  missing {selector}", file=sys.stderr)
                return
            target.first.evaluate("node => node.click()")
            library.wait_for_timeout(500)
            audit(library, state)
            open_each_menu(library, state, lambda s, reopen: audit(library, s, reopen))
            if close:
                library.keyboard.press(close)
                library.wait_for_timeout(200)
        click_and_audit('[data-gallery-view="list"]', "library list", close=None)
        click_and_audit('[data-gallery-view="waterfall"]', "library waterfall", close=None)
        click_and_audit("#open-trash", "recycle bin")
        click_and_audit("#add-quick-note", "add quick note")
        click_and_audit("#add-video-reference", "add video link")
        click_and_audit("#empty-import, #import-choose-files", "import dialog")
        library.reload(); library.wait_for_selector('body[data-library-state="ready"]')
        # Detail views: single image, multiple images, text only.
        for entry_id in ["case-0", "case-multi", "case-5"]:
            library.evaluate("id => { location.search = '?case=' + encodeURIComponent(id); }", entry_id)
            library.wait_for_selector("#detail-drawer:not([hidden])", timeout=15000)
            library.wait_for_timeout(700)
            audit(library, f"detail {entry_id}")
            open_each_menu(library, f"detail {entry_id}", lambda s, reopen: audit(library, s, reopen))
            if entry_id == "case-0":
                # Review mode, its note and tag panels, and the sidebar detail layout.
                for selector, state in [("#detail-review-toggle", "review"), ("[data-review-feedback]", "review note"),
                                        (".tag-editor .prompt-icon-action", "tag editor")]:
                    target = library.locator(selector).filter(visible=True)
                    if target.count():
                        target.first.click(); library.wait_for_timeout(500); audit(library, state)
                    else:
                        print(f"  missing {selector}", file=sys.stderr)
                library.keyboard.press("Escape")
                library.locator("#detail-mode-toggle").evaluate("node => node.click()"); library.wait_for_timeout(500)
                audit(library, "detail sidebar mode")
                library.locator("#detail-mode-toggle").evaluate("node => node.click()"); library.wait_for_timeout(300)
        # Settings: every tab.
        library.goto(library.url.split("?")[0]); library.wait_for_selector('body[data-library-state="ready"]')
        library.wait_for_timeout(500); library.evaluate("() => document.querySelector('#open-settings').click()"); library.wait_for_timeout(400)
        for tab in library.locator("[data-settings-tab]").all():
            name = tab.get_attribute("data-settings-tab")
            tab.evaluate("tab => tab.click()"); library.wait_for_timeout(300)
            audit(library, f"settings {name}")
        library.keyboard.press("Escape")

        for path, state in [("composer.html", "composer"), ("skills.html", "skills"), ("skills.html?view=create", "skills create"),
                            ("curated.html", "curated"), ("curated-skills.html", "curated skills"), ("collector.html", "collector")]:
            page = run.open_page(path)
            page.wait_for_timeout(1500)
            audit(page, state)
            if path == "composer.html" and page.locator("#composer-reference-open").count():
                page.locator("#composer-reference-open").click(); page.wait_for_timeout(600)
                audit(page, "composer references")
                page.keyboard.press("Escape")
            open_each_menu(page, state, lambda s, reopen, page=page: audit(page, s, reopen))
            page.close()

    write_report(findings, args.json)


def write_report(findings, json_path):
    unique = {}
    for item in findings:
        key = (item["kind"], item["text"], item["at"])
        entry = unique.setdefault(key, {**item, "widths": set(), "states": set()})
        entry["widths"].add(item["width"]); entry["states"].add(item["state"])
    rows = sorted(unique.values(), key=lambda item: (item["kind"], item["at"], item["text"]))
    for item in rows:
        print(f"[{item['kind']}] {item['text']!r}  at {item['at']}  widths={sorted(item['widths'])}  states={sorted(item['states'])[:3]}")
    print({kind: sum(1 for item in rows if item["kind"] == kind) for kind in ("chinese", "overflow", "wrapped", "workflow")})
    if json_path:
        json_path.write_text(json.dumps([{**item, "widths": sorted(item["widths"]), "states": sorted(item["states"])} for item in rows], ensure_ascii=False, indent=2))
    sys.exit(1 if rows else 0)


if __name__ == "__main__":
    main()
