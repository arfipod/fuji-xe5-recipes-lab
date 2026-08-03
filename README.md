# Fuji X-E5 Recipes Lab

A local-first web application for parsing, reviewing, backing up, and editing Fujifilm film-simulation recipes, with a strictly staged WebUSB/PTP laboratory for the **Fujifilm X-E5**.

The product is deliberately X-E5-specific. Its primary workflow is:

```text
Read C1-C7 and FS1-FS3
        ↓
Paste a Fuji X Weekly-style recipe
        ↓
Review Current · Imported · Final
        ↓
Resolve missing values explicitly
        ↓
Choose the destination slot
        ↓
Back up and compare
        ↓
Propose a separately approved write, read-back, and persistence check
```

## Interface

The interface follows an X-E5 instrument-panel direction rather than a generic dashboard aesthetic:

- matte black navigation and control surfaces;
- neutral grey and white working areas;
- compact mechanical slot labels;
- clear data hierarchy and restrained borders;
- no decorative gradients, glass effects, glow, floating cards, or ornamental animation;
- desktop and narrow-screen layouts designed from the same operational hierarchy.

## Current status

**Mandatory read-only physical validation complete — C1-C7 scanning, guarded backup reading, and FS1-FS3 menu review passed; every physical write remains locked.**

The policy-locked Linux CLI and staged WebUSB path verified the owner's X-E5 as USB `04CB:0313`, interface `06/01/01`, firmware/device version `1.10`, in the correct USB RAW conversion/backup personality. DeviceInfo advertised USB-mode property `0xD16E`, recipe selector `0xD18C`, and the complete `0xD18D`–`0xD1A5` property range. WebUSB source revision 9 scanned C1-C7 in 196 monotonic transactions, explicitly selected and read back every bank, restored the original C1 selector, closed the session, and released the interface with no anomaly. Physical-menu evidence established that C1 is saved while C2-C7 are `CREATE NEW`; their readable bytes are retained only as latent initialization evidence. A fresh WebUSB session then used only `GetObjectInfo(0)` and `GetObject(0)` between session open/close, verified the X-E5 model, backup format `0x5000`, and exact 70,524-byte length, calculated SHA-256 locally, stored the sensitive bytes only in IndexedDB, and released the interface. Physical menu comparison confirmed FS1 Provia/Standard, FS2 Nostalgic Negative, and FS3 PRO Neg. Std. Since `FS RECIPE` is Off for all three positions, their non-film decoded fields remain latent backup evidence. The mandatory read-only report is in `docs/VALIDATION_REPORT_2026-08-02.md`; every write remains blocked pending separate approval after review.

After that mandatory stop and report review, the owner separately initialized C7 through the physical menus with a Classic Chrome target. A read-only rescan captured exact firmware-1.10 C7 property bytes and menu matches, restored the selector, and released the interface. This expands verified read decoding but does not prove a host-side write. The initialized bank still returns an empty `0xD18D` PTP string while the menu displays `CUSTOM 7`.

The owner also configured and enabled the same target in FS1. Volatile read-only before/after comparisons physically established FS1 Recipe offset `34500` (`00=Off`, `01=On`) in both directions and captured the complete active target, including Color +2 and Sharpness -2. Later independent toggles established the same two-state mapping for FS3 at offset `34502`; FS2 activation and FS D-Range Priority remain menu-only because their offsets are not verified. No backup bytes were emitted or persisted, no full checksum algorithm is claimed, and no host-side FS write or restore was performed. The current evidence handoff is in `AGENTS.md` and the detailed record is in `docs/PROTOCOL_NOTES.md`.

The owner later configured an enabled FS2 test target through the camera menu. A guarded read-only backup confirmed its requested fields and established slot-scoped firmware-1.10 observations for DR200 raw `03` and Color -2 raw `07`; these deliberately override the provisional shared-enum interpretation only for FS2. The FS2 Recipe enable offset remains unknown because no before-backup was retained across that menu action. This added read evidence does not establish any backup write, checksum, or restore path.

An owner-configured neutral plain-ACROS FS3 target was also captured through guarded volatile comparisons. The decoder now exposes its physically verified activation byte and slot-scoped neutral WB mapping. The web parser/editor accepts plain ACROS and ACROS+Ye/+R/+G plus the requested monochrome controls, but physical WebUSB apply remains disabled until the complete X-E5 backup checksum, integrity, restore dataset, and persistence behavior are safely established.

Implemented as maintainable ES modules under `src/`:

- legacy and modern Fuji X Weekly-style text parsing;
- aliases such as `Noise Reduction`, `Sharpening`, and standalone film-simulation names;
- parser provenance, confidence, generation inference, warnings, and original source retention;
- Current · Imported · Final comparison;
- explicit current-slot or X-E5-neutral resolution for missing fields;
- discrete controls and a two-dimensional WB-shift grid;
- focused WebUSB/PTP connection and capability diagnostics;
- direct read-only C1-C7 scanning from one button, with raw-payload evidence and mandatory selector restoration;
- direct X-E5 FS1-FS3 backup reading after the C-scan gate, with an inline serial-content warning and mandatory model, format, size, session, and interface checks;
- mock-only comparison, write, restore, slot-swap, and persistence workflows;
- local recipe library with portable JSON import/export;
- experimental Fuji X Weekly URL import and browser OCR;
- mock RAF-preview workflow; physical RAF upload/conversion remains disabled;
- mock X-E5 mode for reviewing the full interface without hardware.

Auto ISO is parsed and retained but remains a shooting reminder in the first writer. Exposure compensation is shown prominently as a manual camera adjustment.

## Run locally

Requirements:

- Node.js 20 or newer;
- a Chromium-based browser;
- a USB-C data cable for real-camera access.

```bash
npm ci
npm run verify
npm start
```

Open:

```text
http://127.0.0.1:4173
```

The application has no runtime npm dependencies and no opaque application bundle. The Node server serves `index.html` and the maintainable modules under `src/`, and provides the restricted experimental Fuji X Weekly URL importer.

With the server running and Chrome installed, the pre-device browser baseline can be repeated without opening the USB picker:

```bash
npm run baseline:browser
```

The original published-bundle failure and all README-to-runtime mismatches are preserved in [`docs/BASELINE_REPORT.md`](docs/BASELINE_REPORT.md).

For real camera access, set the X-E5 to:

```text
SET UP → NETWORK/USB SETTING → CONNECTION MODE
→ USB RAW CONV./BACKUP RESTORE
```

WebUSB requires `localhost` or HTTPS and an explicit user action in the browser device picker.

After connection, `Read C1-C7 directly` starts the guarded selector scan immediately; there is no separate review or confirmation dialog. Once that scan passes, `Read FS1-FS3 directly` immediately performs the guarded handle-zero backup read. The backup warning remains visible in the Camera view, bytes stay only in local IndexedDB, and all physical write and restore controls remain locked.

### Linux USB permissions

Close photo importers, X RAW Studio, gphoto processes, or any other program that may claim the PTP interface. Only if diagnostics show that the current user lacks access, the minimal local udev rule is:

```udev
SUBSYSTEM=="usb", ATTR{idVendor}=="04cb", TAG+="uaccess"
```

Installing or reloading a rule can require `sudo` and a USB reconnect. Do not run those actions without first warning the camera owner. This validation host already grants access through an explicit ACL, so no rule is currently needed.

If a rule is actually required, an administrator can reload it with:

```bash
sudo udevadm control --reload-rules
sudo udevadm trigger
```

## First real-camera validation

1. Create a known-good full backup with official software.
2. Connect and perform read-only discovery.
3. Compare every decoded C1-C7 value with the camera menus.
4. Download and hash the read-only full backup only after the C scan succeeds.
5. Compare FS1-FS3 with the camera menus.
6. Stop and review the complete read-only report.
7. Use C7 only in a later, separately approved name-write experiment with immediate read-back and power-cycle persistence checks.

The exact later experiment is documented, but not authorized or implemented, in [`docs/PROPOSED_C7_WRITE_PLAN.md`](docs/PROPOSED_C7_WRITE_PLAN.md).

## Verification

```bash
npm run verify
```

The repository verifies:

- syntax for the server, modules, scripts, and tests;
- parser, codec, PTP framing, mock-camera, JSON, RAW-preview, and UI tests;
- the monochrome design and accessibility guards;
- the required maintainable source/context files and six interface views;
- source-only runtime markers and the exact footer.

## Safety principles

- Model and backup-size checks before full restore.
- No write without an automatic recovery snapshot.
- No write without a visible before/after comparison.
- No success claim based only on a PTP `OK` response.
- Immediate read-back verification after every write flow.
- First-use persistence verification after a power cycle.
- Unknown or unverified fields are preserved or omitted rather than guessed.
- The full serial never crosses the volatile transport boundary; logs, reports, storage keys, and exports redact or omit it.
- Full-backup bytes stay in IndexedDB or a deliberately selected local file and are never part of generic recipe JSON export.

## License and independence

MIT licensed. The application contains no Fujifilm SDK or vendored Fujifilm software.

This project is independent and is not affiliated with or endorsed by Fujifilm Holdings Corporation or Fuji X Weekly.
