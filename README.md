# Fuji X-E5 Recipes Lab

A local-first web application for parsing, reviewing, backing up, editing, and experimentally writing Fujifilm film-simulation recipes to a **Fujifilm X-E5** over USB-C.

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
Back up, compare, write, read back, verify
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

**Research prototype — physical camera writes still require validation on the owner's X-E5.**

Implemented in the published application bundle:

- legacy and modern Fuji X Weekly-style text parsing;
- aliases such as `Noise Reduction`, `Sharpening`, and standalone film-simulation names;
- parser provenance, confidence, generation inference, warnings, and original source retention;
- Current · Imported · Final comparison;
- explicit current-slot or X-E5-neutral resolution for missing fields;
- discrete controls and a two-dimensional WB-shift grid;
- C1-C7 PTP workflow;
- X-E5 FS1-FS3 full-backup workflow;
- automatic backups, comparison, read-back verification, slot swapping, and persistence checks;
- local recipe library with portable JSON import/export;
- experimental Fuji X Weekly URL import and browser OCR;
- experimental RAF preview through the camera processor;
- mock X-E5 mode for reviewing the full interface without hardware.

Auto ISO is parsed and retained but remains a shooting reminder in the first writer. Exposure compensation is shown prominently as a manual camera adjustment.

## Run locally

Requirements:

- Node.js 22 or newer;
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

The application has no runtime npm dependencies. The Node server reconstructs the checksum-verified application bundle in memory, serves it locally, and provides the restricted experimental Fuji X Weekly URL importer.

For real camera access, set the X-E5 to:

```text
SET UP → NETWORK/USB SETTING → CONNECTION MODE
→ USB RAW CONV./BACKUP RESTORE
```

WebUSB requires `localhost` or HTTPS and an explicit user action in the browser device picker.

### Linux USB permissions

Close photo importers, X RAW Studio, gphoto processes, or any other program that may claim the PTP interface. A local udev rule may be required:

```udev
SUBSYSTEM=="usb", ATTR{idVendor}=="04cb", TAG+="uaccess"
```

Then reload the rules and reconnect the camera:

```bash
sudo udevadm control --reload-rules
sudo udevadm trigger
```

## First real-camera validation

1. Create a known-good full backup with official software.
2. Connect and perform read-only discovery.
3. Compare every decoded C1-C7 value with the camera menus.
4. Use C7 as the first write target.
5. Confirm the automatic backup and exact diff.
6. Write one reversible field and verify by immediate read-back.
7. Power-cycle, reconnect, and verify persistence.
8. Restore the original C7 backup and verify again.
9. Test FS3 only after the C7 workflow succeeds.

## Verification

```bash
npm run verify
```

The repository verifies:

- Node server syntax;
- the expected number and ordering of bundle parts;
- gzip/base64 reconstruction;
- application SHA-256;
- required interface markers.

The modular development source was also exercised before publication with 24 JavaScript module syntax checks and 20 automated tests, all passing.

## Safety principles

- Model and backup-size checks before full restore.
- No write without an automatic recovery snapshot.
- No write without a visible before/after comparison.
- No success claim based only on a PTP `OK` response.
- Immediate read-back verification after every write flow.
- First-use persistence verification after a power cycle.
- Unknown or unverified fields are preserved or omitted rather than guessed.
- Full-backup bytes and camera serials remain local unless explicitly exported.

## License and independence

MIT licensed. The application contains no Fujifilm SDK or vendored Fujifilm software.

This project is independent and is not affiliated with or endorsed by Fujifilm Holdings Corporation or Fuji X Weekly.
