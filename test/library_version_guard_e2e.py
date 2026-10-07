"""Version safety for the stored library. Isolated synthetic fixture.

A library saved by a newer PromptDirector is never rewritten by this version: the library page explains
it and every stored value stays identical. An upgrade from an older version keeps a clean backup of the
library as it was before, without nesting older recovery copies, and loses no case.
"""
from e2e_support import base_entry, extension_session

SCHEMA = "async () => (await import('./taxonomy.js')).SCHEMA_VERSION"


def main():
    with extension_session("pd-version-guard-", viewport={"width": 1280, "height": 860}) as run:
        page = run.open_page("collector.html")
        schema = page.evaluate(SCHEMA)
        entries = [base_entry(f"case-{i}", f"Case {i}", f"prompt {i}", "content:image-prompt", i) for i in range(3)]

        # 1. Newer library: nothing is written, the page explains why.
        newer = {"schemaVersion": schema + 1, "entries": [{**entry, "schemaVersion": schema + 1, "futureField": {"kept": True}} for entry in entries],
                 "organizerState": {"version": 99, "collections": []}, "uiPreferences": {"locale": "en"}}
        page.evaluate("async payload => { await chrome.storage.local.clear(); await chrome.storage.local.set(payload); }", newer)
        before = page.evaluate("() => chrome.storage.local.get(null)")
        library = run.open_page("library.html")
        library.wait_for_function("() => /newer version of PromptDirector/.test(document.body.innerText)", timeout=20000)
        state = page.evaluate("() => chrome.runtime.sendMessage({type: 'GET_STATE'})")
        assert not state.get("ok"), state
        after = page.evaluate("() => chrome.storage.local.get(null)")
        # The connector's own pairing identity is extension runtime state, not library data.
        changed = sorted(key for key in set(before) | set(after) if key != "agentConnection" and before.get(key) != after.get(key))
        assert not changed, ("a newer library must stay byte-identical", changed, {key: after.get(key) for key in changed})
        library.close()

        # 2. Upgrade from an older version: clean backup, no case lost.
        older_entries = [{**entry, "schemaVersion": schema - 1} for entry in entries]
        nested = {"entries": [{"id": "ancient"}], "folderOwnershipBackup": {"state": {"entries": []}}}
        page.evaluate("async payload => { await chrome.storage.local.clear(); await chrome.storage.local.set(payload); }",
                      {"schemaVersion": schema - 1, "entries": older_entries, "migrationBackup": nested, "uiPreferences": {"locale": "en"}})
        page.evaluate("() => chrome.runtime.sendMessage({type: 'GET_STATE'})")
        stored = page.evaluate("async () => (await import('./library-storage.js')).getLibraryStorage().get(['schemaVersion', 'entries', 'migrationBackup', 'upgradeBackup'])")
        backup = stored["upgradeBackup"]
        assert stored["migrationBackup"] == nested, "the first-ever backup is never replaced"
        assert stored["schemaVersion"] == schema
        assert sorted(entry["id"] for entry in stored["entries"]) == sorted(entry["id"] for entry in entries)
        assert backup["fromSchemaVersion"] == schema - 1 and backup["toSchemaVersion"] == schema, backup
        assert backup["state"]["entries"] == older_entries, "the backup holds the library exactly as it was before the upgrade"
        assert "migrationBackup" not in backup["state"] and "upgradeBackup" not in backup["state"] and "folderOwnershipBackup" not in backup["state"]

        # 3. A repair within the same version keeps that backup instead of replacing it.
        page.evaluate("async () => { const {organizerState} = await chrome.storage.local.get('organizerState'); await chrome.storage.local.remove('organizerState'); }")
        page.evaluate("() => chrome.runtime.sendMessage({type: 'GET_STATE'})")
        kept = page.evaluate("() => chrome.storage.local.get('upgradeBackup')")["upgradeBackup"]
        assert kept["createdAt"] == backup["createdAt"], "a repair must not overwrite the pre-upgrade copy"
        assert not run.page_errors, run.page_errors
        print({"newerLibraryUntouched": True, "upgradeBackupFromTo": [backup["fromSchemaVersion"], backup["toSchemaVersion"]],
               "casesKept": len(stored["entries"]), "repairKeepsBackup": True})


if __name__ == "__main__":
    main()
