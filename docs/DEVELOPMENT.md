# Development

Requires Node.js 22.13 or later. Run commands from the repository root.

```sh
npm ci
npm run verify:source
npm run package
```

Load `extension/` in Chrome or Edge for source development, or extract the generated `dist/*-FIXED-ID-DEV.zip` and load that directory for packaged testing. Keep the existing fixed extension identity when switching source locations; do not uninstall the extension or delete browser data.

## Repository layout

- `extension/`: loadable extension source, bundled dependencies, assets and translations.
- `test/`: automated tests and synthetic fixtures.
- `tools/`: build and verification commands.
- `docs/`: product and contribution documentation.
- `store/`: listing text, privacy policy and distribution materials.

Published ZIPs keep a top-level `manifest.json`. Source organization does not change the installation layout or the existing local upgrade path.

## Checks and packaging

`npm run verify` runs source checks, historical data compatibility, packaged Chromium journeys and an upgrade rehearsal using a previous release. `npm run check:compat` checks the supported data formats. `npm run package:release` builds the Store upload variant. These commands do not publish a release or upload to the Store.

See [data compatibility](DATA_COMPATIBILITY.md), [capture support](CAPTURE_SUPPORT.md) and [known limitations](KNOWN_LIMITATIONS.md) for product behavior.
