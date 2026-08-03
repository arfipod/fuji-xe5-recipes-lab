# Local Baseline Report

## Published `HEAD` before reconstruction

Recorded on 2026-08-02 with Node.js `20.19.2` and npm `9.2.0`. The committed revision was reproduced in an isolated temporary directory so working-tree repairs could not affect the result.

```text
npm ci:         completed with an EBADENGINE warning (README/package required Node >=22)
npm run verify: failed — Z_BUF_ERROR, unexpected end of file
npm start:      failed — Z_BUF_ERROR, unexpected end of file
```

The failure occurred while concatenating and inflating the committed gzip/base64 fragments. Consequently, the published application could not start and none of the README's browser, mock-camera, view, or physical-camera claims could be validated from that revision.

### README mismatches in the published revision

- It described a checksum-verified application bundle, but the committed fragments produced a truncated gzip stream before the checksum could be evaluated.
- It said modular development source had been exercised with 24 module checks and 20 tests, but no `src/` tree or those tests were published.
- It described C1-C7, full-backup, automatic write/restore, slot-swap, persistence, and physical RAF workflows as implemented. Their implementation could not be inspected as maintainable source or validated because the only runtime artifact did not reconstruct.
- It required Node.js 22 even though the available host has Node.js 20.19.2. The reconstructed source uses no Node 22-only feature and now declares Node.js 20 or newer.
- It allowed camera serials to remain local “unless explicitly exported”; the staged requirements instead prohibit the full serial at every log, report, persistence, export, screenshot, and commit boundary.

## Reconstructed maintainable-source baseline

The runtime is now native source code: `index.html`, `src/` ES modules, and `src/styles.css`. There is no runtime bundle or build step, and the server exposes only the index, source assets, and narrowly scoped loopback APIs.

```text
npm ci:         pass, no warnings, 0 vulnerabilities
npm run verify: pass — 35 JavaScript modules, 11 test files / 81 tests, design and source checks
npm start:      pass — http://127.0.0.1:4173, no server warning
npm run baseline:browser: pass — Chrome 150.0.7871.186
```

Pre-device Chromium validation confirmed:

- all Camera, Import/Edit, Library, Backups, RAF Preview, and System views render;
- Mock X-E5 connects and exposes ten mock slots;
- desktop and 390-pixel layouts have no document-level horizontal overflow;
- the footer is exactly `Made with 💙 by arrf`;
- page-console errors and failed page requests are empty before a device connection.

The maintained headless-browser baseline reported no application console errors, failed requests, or Chrome warnings. It never clicks the physical USB connect action.

Physical-camera results are deliberately excluded from this baseline. They are recorded with evidence labels in `PROTOCOL_NOTES.md` and the staged validation report.
