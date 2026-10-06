"""Opt-in phase-timing baseline on an isolated synthetic library, never a daily Chrome profile.

Enables the built-in developer timing (perf-trace.js) for the test browser session, opens the library,
then edits one case's labels from another extension page so the library receives the same storage
change broadcast an Agent or second window would cause. Prints the background and library summaries.

--backup-mib adds recovery data to one backup key, matching the size the background reads with every
full state read in a real library (13.8 MiB in the 2026-10-06 snapshot). --library-json seeds the
metadata of an authorised backup copy instead of synthetic cases (media files are not loaded, so cards
show placeholders); with --count above its size, cases are repeated under new ids to reach that scale.
Real-site capture and MCP round trips are not covered here.
"""
import argparse
import json
from pathlib import Path
from e2e_support import extension_session

parser = argparse.ArgumentParser()
parser.add_argument("--count", type=int, default=10000)
parser.add_argument("--edits", type=int, default=20)
parser.add_argument("--backup-mib", type=float, default=0)
parser.add_argument("--library-json", type=Path)
parser.add_argument("--agent-queries", type=int, default=10)
parser.add_argument("--detail-opens", type=int, default=0, help="open case details right after the library is ready")
args = parser.parse_args()

SEED_REAL = """async ({library, count, backupBytes}) => {
  const base = library.entries;
  const entries = count > base.length
    ? Array.from({length: count}, (_, i) => i < base.length ? base[i] : {...base[i % base.length], id: `${base[i % base.length].id}~${Math.floor(i / base.length)}`})
    : base;
  await chrome.storage.local.set({schemaVersion: library.schemaVersion, entries, facetCatalog: library.facetCatalog,
    taxonomy: library.taxonomy, organizerState: library.organizerState, compoundCases: library.compoundCases ?? [],
    classificationRules: library.classificationRules ?? [], settings: library.settings ?? {},
    trashState: {version: 1, items: []}});
  if (backupBytes) await chrome.storage.local.set({migrationBackup: {text: '恢复'.repeat(Math.ceil(backupBytes / 6))}});
  await chrome.storage.session.set({promptDirectorTiming: true});
  return {count: entries.length, realCases: base.length, entriesBytes: new Blob([JSON.stringify(entries)]).size};
}"""

SEED = """async ({count, backupBytes}) => {
  const [{SCHEMA_VERSION}, {createDefaultFacetCatalog}, {createDefaultOrganizerState}] = await Promise.all([
    import('./taxonomy.js'), import('./facets.js'), import('./organizer.js')]);
  const tags = Array.from({length: 400}, (_, i) => ({id: `perf-tag-${i}`, name: `风格${i}`, facetId: 'style',
    parentId: 'style.render', order: i, aliases: [], patterns: [], status: 'active', kind: 'detail', origin: 'manual'}));
  const entries = Array.from({length: count}, (_, i) => ({schemaVersion: SCHEMA_VERSION, id: `case-${i}`,
    title: `基线案例${i}`, text: '镜头、光线、构图与人物动作的完整参考内容。'.repeat(30), textRevision: 1,
    savedAt: new Date(Date.UTC(2026, 8, 1, 0, 0, i)).toISOString(),
    classification: {pathIds: ['content:image-case'], status: 'confirmed', source: 'manual'},
    mediaAssets: [{id: `media-${i}`, kind: 'image', usage: 'content', storageMode: 'managed', mimeType: 'image/png',
      width: 1280, height: 720, byteSize: 400000}], primaryMediaId: `media-${i}`,
    mediaPrompts: [{assetId: `media-${i}`, text: '保留的完整原词。'.repeat(30), source: 'manual'}],
    facetAssignments: [{facetId: 'style', nodeId: `perf-tag-${i % 400}`, source: 'manual', status: 'confirmed'}],
    customLabels: ['参考'], timeNotes: []}));
  const facetCatalog = createDefaultFacetCatalog(); facetCatalog.nodes.push(...tags);
  const organizerState = createDefaultOrganizerState();
  await chrome.storage.local.set({schemaVersion: SCHEMA_VERSION, entries, facetCatalog, organizerState,
    compoundCases: [], trashState: {version: 1, items: []}});
  if (backupBytes) await chrome.storage.local.set({migrationBackup: {text: '恢复'.repeat(Math.ceil(backupBytes / 6))}});
  await chrome.storage.session.set({promptDirectorTiming: true});
  return {count, entriesBytes: new Blob([JSON.stringify(entries)]).size};
}"""

with extension_session("pd-timing-baseline-", viewport={"width": 1440, "height": 900}) as run:
    setup = run.open_page("collector.html")
    backup_bytes = int(args.backup_mib * 1024 * 1024)
    if args.library_json:
        library = json.loads(args.library_json.read_text())
        fixture = setup.evaluate(SEED_REAL, {"library": library, "count": args.count, "backupBytes": backup_bytes})
    else:
        fixture = setup.evaluate(SEED, {"count": args.count, "backupBytes": backup_bytes})
    worker = run.context.service_workers[0]
    worker.evaluate("promptDirectorTiming.reset()")
    page = run.context.new_page()
    page.goto(f"chrome-extension://{run.extension_id}/library.html", wait_until="domcontentloaded")
    page.wait_for_selector('body[data-library-state="ready"]', timeout=120000)
    page.wait_for_function("() => promptDirectorTiming.enabled()")
    detail_opens = []
    for index in range(args.detail_opens):
        # Click as a user would right after opening; time until the case and its similar cases show.
        opened = page.evaluate("""async index => {
          const card = document.querySelectorAll('#case-list > .case-card')[index];
          const id = card.dataset.entryId, started = performance.now();
          card.click();
          const until = test => new Promise(resolve => { const check = () => test() ? resolve(performance.now() - started) : requestAnimationFrame(check); check(); });
          const detail = await until(() => document.querySelector('#detail-drawer')?.dataset.entryId === id && document.querySelector('.detail-primary'));
          const similar = await Promise.race([until(() => document.querySelector('.detail-discovery')), new Promise(r => setTimeout(() => r(null), 5000))]);
          return {detailMs: Math.round(detail), similarMs: similar && Math.round(similar)};
        }""", index)
        detail_opens.append(opened)
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
    REFRESH_COUNT = "() => promptDirectorTiming.summary().filter(item => ['library/refresh', 'library/refreshIncremental'].includes(item.phase)).reduce((sum, item) => sum + item.count, 0)"
    refreshes = lambda: page.evaluate(REFRESH_COUNT)
    entry_ids = page.evaluate("async () => (await chrome.storage.local.get('entries')).entries.slice(0, 50).map(entry => entry.id)")
    for index in range(args.edits):
        before = refreshes()
        response = setup.evaluate("""async ({entryId, label}) => chrome.runtime.sendMessage({
          type: 'UPDATE_ENTRY_CUSTOM_LABELS', entryId, customLabels: ['参考', label]})""",
            {"entryId": entry_ids[index % len(entry_ids)], "label": f"基线{index}"})
        assert response.get("ok"), response
        page.wait_for_function(f"before => ({REFRESH_COUNT})() > before", arg=before, timeout=60000)
    for index in range(args.agent_queries):
        # Same read-only queries an Agent sends; the probe exists only while developer timing is on.
        worker.evaluate("""async () => {
          await promptDirectorAgentProbe('search', {query: '光', limit: 24});
          await promptDirectorAgentProbe('search', {query: '', countOnly: true, limit: 1});
          await promptDirectorAgentProbe('describe_case_query', {});
        }""")
    print(json.dumps({
        "fixture": fixture,
        "backupMiB": args.backup_mib,
        "edits": args.edits,
        "detailOpens": detail_opens,
        "background": worker.evaluate("promptDirectorTiming.summary()"),
        "library": page.evaluate("promptDirectorTiming.summary()"),
    }, ensure_ascii=False, indent=1), flush=True)
