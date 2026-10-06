"""Cases edited from another page update the open library in place. Isolated synthetic fixture.

The incremental result must equal a fresh page load for the same stored library, unchanged cards keep
their DOM nodes (no flicker), and search sees the new text without re-reading the whole library.
"""
import random
from e2e_support import extension_session

COUNT = 240

SEED = """async (count) => {
  const [{SCHEMA_VERSION}, {createDefaultFacetCatalog}, {createDefaultOrganizerState}] = await Promise.all([
    import('./taxonomy.js'), import('./facets.js'), import('./organizer.js')]);
  const entries = Array.from({length: count}, (_, i) => ({schemaVersion: SCHEMA_VERSION, id: `case-${i}`,
    title: `增量案例${i}`, text: `第${i}条参考内容`, textRevision: 1,
    savedAt: new Date(Date.UTC(2026, 8, 1, 0, 0, i)).toISOString(),
    classification: {pathIds: ['content:image-case'], status: 'confirmed', source: 'manual'},
    mediaAssets: [], customLabels: ['参考'], timeNotes: []}));
  await chrome.storage.local.set({schemaVersion: SCHEMA_VERSION, entries, facetCatalog: createDefaultFacetCatalog(),
    organizerState: createDefaultOrganizerState(), compoundCases: [], trashState: {version: 1, items: []}});
}"""

SNAPSHOT = """() => ({
  cards: [...document.querySelectorAll('#case-list .case-card')].map(card => `${card.dataset.entryId}|${card.textContent.replace(/\\s+/g, ' ').trim()}`),
  count: document.querySelector('#result-count')?.textContent
})"""


def search(page, query):
    page.locator("#search-input").fill(query)
    page.wait_for_timeout(300)
    result = page.evaluate("() => [...document.querySelectorAll('#case-list .case-card')].map(card => card.dataset.entryId)")
    page.locator("#search-input").fill("")
    page.wait_for_timeout(300)
    return result


def main():
    rng = random.Random(20261006)
    with extension_session("pd-incremental-refresh-", viewport={"width": 1440, "height": 900}) as run:
        editor = run.open_page("collector.html")
        editor.evaluate(SEED, COUNT)
        library = run.open_page("library.html")
        library.wait_for_selector('body[data-library-state="ready"]')
        library.wait_for_function("() => document.querySelectorAll('#case-list .case-card').length >= 24")
        library.evaluate("""() => { window.pdFullReads = 0;
          const get = chrome.storage.local.get.bind(chrome.storage.local);
          chrome.storage.local.get = keys => { if ([keys].flat().includes('entries')) window.pdFullReads++; return get(keys); }; }""")
        library.wait_for_timeout(1500)  # let the opening refresh settle before marking card nodes
        library.evaluate("() => document.querySelectorAll('#case-list .case-card').forEach(card => { card.pdOriginal = true; })")
        edited = set()
        for step in range(12):
            index = rng.randrange(0, 24)
            entry_id = f"case-{COUNT - 1 - index}"
            kind = rng.choice(["labels", "title"])
            message = ({"type": "UPDATE_ENTRY_CUSTOM_LABELS", "entryId": entry_id, "addLabels": [f"新标签{step}"], "removeLabels": []}
                if kind == "labels" else {"type": "UPDATE_ENTRY_TITLE", "entryId": entry_id, "title": f"改名案例{step}"})
            assert editor.evaluate("message => chrome.runtime.sendMessage(message)", message)["ok"], message
            edited.add(entry_id)
            if kind == "title":
                library.wait_for_function("title => document.querySelector('#case-list').textContent.includes(title)", arg=f"改名案例{step}")
            else:
                library.wait_for_timeout(250)
        library.wait_for_timeout(400)
        incremental = library.evaluate(SNAPSHOT)
        kept = library.evaluate("""edited => [...document.querySelectorAll('#case-list .case-card')]
          .filter(card => !edited.includes(card.dataset.entryId)).every(card => card.pdOriginal === true)""", sorted(edited))
        full_reads = library.evaluate("window.pdFullReads")
        incremental_search = [search(library, "改名案例"), search(library, "新标签3")]

        fresh = run.open_page("library.html")
        fresh.wait_for_selector('body[data-library-state="ready"]')
        fresh.wait_for_function("() => document.querySelectorAll('#case-list .case-card').length >= 24")
        expected = fresh.evaluate(SNAPSHOT)
        expected_search = [search(fresh, "改名案例"), search(fresh, "新标签3")]

        assert incremental == expected, {"incremental": incremental, "fresh": expected}
        assert incremental_search == expected_search, (incremental_search, expected_search)
        assert kept, "unchanged cards must keep their nodes and loaded previews"
        assert full_reads == 0, f"case-only changes must not re-read the whole library ({full_reads})"
        print({"edits": 12, "equal_to_fresh_load": True, "unchanged_cards_kept": True, "library_rereads": full_reads,
               "search_results": [len(item) for item in incremental_search]})


if __name__ == "__main__":
    main()
