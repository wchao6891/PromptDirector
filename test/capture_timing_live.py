"""Opt-in live-site capture timing in an isolated browser, never a daily Chrome profile.

Opens each public URL in its own window, runs the normal page capture and save task, and prints the
built-in capture stage timing (perf-trace.js). Host access is granted only in a temporary manifest copy,
the same way the user grants optional site access in the product. Saved media live in the temporary
profile and are removed with it. Script errors raised by the visited sites themselves are reported by
the shared session check after the timing JSON has been printed.
"""
import argparse
import json
import tempfile
import time
from pathlib import Path
from e2e_support import EXTENSION_DIR, extension_session

parser = argparse.ArgumentParser()
parser.add_argument("urls", nargs="+")
parser.add_argument("--mode", default="loaded", choices=["loaded", "whole", "article", "media"])
parser.add_argument("--sequential", action="store_true", help="download one item at a time, for before/after comparison")
args = parser.parse_args()

with tempfile.TemporaryDirectory(prefix="pd-live-capture-code-") as tmp:
    ext = Path(tmp)
    for item in EXTENSION_DIR.iterdir():
        if item.name not in ("manifest.json", "capture-download-ahead.js") or (item.name == "capture-download-ahead.js" and not args.sequential):
            (ext / item.name).symlink_to(item, target_is_directory=item.is_dir())
    if args.sequential:
        # Comparison run: the same code with no downloads started ahead.
        source = (EXTENSION_DIR / "capture-download-ahead.js").read_text()
        (ext / "capture-download-ahead.js").write_text(source.replace("window = RESOURCE_POLICY.mediaDownloadConcurrency", "window = 0"))
    manifest = json.loads((EXTENSION_DIR / "manifest.json").read_text())
    manifest["host_permissions"] = [*manifest.get("host_permissions", []), "<all_urls>"]
    (ext / "manifest.json").write_text(json.dumps(manifest))
    with extension_session("pd-live-capture-", extension_dir=ext, viewport={"width": 1440, "height": 900}) as run:
        page = run.open_page("skills.html")  # no capture listeners, so the save task is not consumed by a capture page
        page.evaluate("""async () => {
          await chrome.storage.local.set({capturePermissionOnboarding: {version: 1, acknowledgedAt: '2026-10-06T00:00:00Z', clipboardIncluded: true}});
          await chrome.storage.session.set({promptDirectorTiming: true});
        }""")
        worker = run.context.service_workers[0]
        results = []
        for url in args.urls:
            started = time.monotonic()
            window = page.evaluate("async url => (await chrome.windows.create({url, focused: true})).id", url)
            page.wait_for_timeout(8000)
            batch = page.evaluate("async mode => chrome.runtime.sendMessage({type: 'START_PAGE_CAPTURE', mode})", args.mode)
            if not batch.get("ok"):
                results.append({"url": url, "error": batch.get("message")})
                continue
            candidates = batch["batch"].get("candidates", [])
            save = page.evaluate("""async batch => {
              // Same default choice as manual capture: every candidate with its text and default media.
              const {pageCaptureDefaultMediaIds} = await import('./page-capture.js');
              batch = {...batch, selections: batch.candidates.map(candidate => ({candidateId: candidate.id, includeText: true,
                mediaDecision: 'confirmed', selectedMediaIds: pageCaptureDefaultMediaIds(candidate)}))};
              const saveStarted = performance.now();
              const started = await chrome.runtime.sendMessage({type: 'START_CAPTURE_SAVE', input: {
                type: 'COMMIT_PAGE_CAPTURE', saveRequestId: crypto.randomUUID(), batch, draftItemIds: []}});
              if (!started?.ok) return started;
              const deadline = Date.now() + 180000;
              for (;;) {
                const {task} = await chrome.runtime.sendMessage({type: 'GET_CAPTURE_SAVE_TASK'});
                if (Date.now() > deadline) {
                  await chrome.runtime.sendMessage({type: 'CANCEL_CAPTURE_SAVE', id: task?.id});
                  return {ok: false, message: `timeout in ${task?.status}/${task?.progress?.phase}`};
                }
                if (task && !['queued', 'running', 'cancelling', 'committing'].includes(task.status)) {
                  await chrome.runtime.sendMessage(task.result?.ok ? {type: 'ACK_CAPTURE_SAVE', id: task.id} : {type: 'DISCARD_CAPTURE_SAVE', id: task.id});
                  return {...(task.result ?? {}), saveMs: Math.round(performance.now() - saveStarted)};
                }
                await new Promise(resolve => setTimeout(resolve, 250));
              }
            }""", batch["batch"])
            entries = page.evaluate("async () => (await chrome.storage.local.get('entries')).entries || []")
            media = [asset for entry in entries for asset in entry.get("mediaAssets", [])]
            results.append({"url": url, "candidates": len(candidates),
                "selectedMedia": sum(len(candidate.get("media", [])) for candidate in candidates),
                "saved": {"ok": save.get("ok"), "message": save.get("message"), "saveMs": save.get("saveMs"), "results": [
                    {"status": item.get("status"), "warnings": len(item.get("warnings") or [])} for item in save.get("results") or []]},
                "libraryMedia": len(media), "libraryMediaBytes": sum(asset.get("byteSize") or 0 for asset in media),
                "elapsedMs": round((time.monotonic() - started) * 1000)})
            page.evaluate("async id => chrome.windows.remove(id)", window)
        print(json.dumps({"mode": args.mode, "results": results,
            "timing": worker.evaluate("promptDirectorTiming.summary()")}, ensure_ascii=False, indent=1), flush=True)
