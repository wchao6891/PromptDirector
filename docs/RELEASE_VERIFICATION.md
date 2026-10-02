# Release verification

CI classifies the actual PR diff, keeps the two existing required checks, and fails the final gate when planned work fails, is cancelled, is missing, or tests different package bytes.

| Change | CI coverage |
|---|---|
| Public Markdown/license documentation | Public boundary check and CI policy tests; no browser or upgrade jobs |
| Known page-local HTML/CSS | Full source contracts plus the affected page and shared UI browser scenarios |
| Registered browser test only | Full source contracts plus that scenario |
| Source unit tests only | Full source contracts |
| Connector code only | Full source contracts, one package build and connector tests on Linux/macOS/Windows |
| Shared runtime, storage/media/capture logic, dependencies, versions, fixtures/helpers, CI/build tools or unknown files | Full source contracts, every registered browser scenario, both installed-profile upgrades and all connector platforms |

The conservative default is full coverage. A manual run of `Release safety` also always uses full coverage; it cannot force a reduced gate. No workflow-wide path filters leave required checks pending.

## One package, independent tests

The package job builds the fixed-ID public extension, store package and connector archive once. It checks ZIP integrity/channel identity and records each SHA-256 plus the Git source tree in `ci-package.json`. Four independent browser runners partition the authoritative `test/run_e2e.py` registry; each uses isolated profiles and the same downloaded package. Linux and Windows upgrade jobs use that same bundle in parallel. Four is configured in the workflow to reduce sequential waiting without running several large-media browsers in the same runner.

Each browser receipt includes its complete planned scenario list, every result, preflight identity and package metadata. The required `Chromium journeys and packaged upgrade` gate verifies that all shards are present exactly once and all selected scenarios passed. Full coverage retains the 344 MB X save/readback, recovery and actual worker-tool regressions. Source, upgrade and connector job failures also block the gate.

Only a full successful run uploads `promptdirector-tested-packages-<commit>` with `ci-validation.json`; partial checks never produce a full-release artifact. Download that exact artifact for publication and compare its recorded source tree with the merged commit. Publish the existing ZIP/checksum files after readback verification; do not rebuild them. The store ZIP remains a separate channel.

## Triggers and local checks

Protected PRs run the gate. Merging the same source does not start a second identical main-branch run; explicit full verification remains available through `workflow_dispatch`. The existing branch-protection check names are unchanged. Keep branch protection enabled for main.

Local development still supports `npm run test:local-extension` for a complete packaged lab and `python3 test/run_e2e.py --script <registered-script>` for focused checks. CI's `--scripts` and JSON receipts use the same registry and runner, including failed results. Fix and run affected checks before another commit; unchanged full evidence need not be repeated locally.

Policy regression checks: `python3 -m unittest discover -s test -p ci_release_test.py`. The full Node source suite also executes them. Scope examples and failure cases cover omitted/duplicate shards, replaced package digests/source trees, failed/cancelled/skipped required jobs, and partial evidence mislabeled as full.

The policy does not replace acceptance of live sites, paid providers, a user's daily installation or Store submission.
