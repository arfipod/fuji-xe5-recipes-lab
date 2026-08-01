# Fuji X-E5 Recipes Lab

A local-first web laboratory for parsing, reviewing, backing up, editing, and experimentally writing Fujifilm film-simulation recipes to a **Fujifilm X-E5** over USB-C.

The application is intentionally X-E5-specific. Its first goal is not to be a generic camera manager: it is to make the workflow below transparent and recoverable.

```text
Paste a Fuji X Weekly-style recipe
            ↓
Inspect canonical values and parser confidence
            ↓
Compare Current · Imported · Final
            ↓
Choose C1-C7 or FS1-FS3
            ↓
Create an automatic backup
            ↓
Review the exact diff
            ↓
Write, read back, and verify
```

## Project status

**Research prototype — real camera writes require hardware validation.**

The parser, canonical editor, mock camera, JSON library, C-slot codec, X-E5 FS backup codec, backup safety flow, and experimental RAF-preview transport are implemented. The real USB path is deliberately guarded and has not yet been validated end-to-end on the owner's physical X-E5.

Use **C7** and **FS3** as the first laboratory targets. Always keep a known-good full camera backup.

## Implemented

- Parse legacy and modern Fuji X Weekly-style text, including input with missing line breaks.
- Recognize aliases such as `Noise Reduction`, `Sharpening`, and standalone film-simulation names.
- Parse white-balance modes, Kelvin values, R/B shifts, grain strength/size, D-Range Priority, ISO reminders, and fractional exposure compensation.
- Retain original source text, source URL/image name, per-field confidence, aliases, warnings, and generation inference.
- Show **Current · Imported · Final** values together.
- Resolve missing fields explicitly from either:
  - the current camera slot; or
  - an X-E5 neutral value.
- Edit every accepted value through simple discrete controls and a two-dimensional WB-shift grid.
- Read and edit C1-C7 through Fujifilm PTP properties `0xD18C-0xD1A5`.
- Read and patch FS1-FS3 through the verified X-E5 full-backup layout.
- Create one latest automatic backup per C slot and one latest full backup per camera identity.
- Compare before writing or restoring.
- Perform immediate read-back verification.
- Track a required first power-cycle persistence check.
- Swap two C slots safely with backup and verification.
- Keep a local recipe library with favorites and parent/variant relationships.
- Import and export one portable JSON format intended to remain usable by a later Android application.
- Experimental Fuji X Weekly URL import, restricted to `https://fujixweekly.com`.
- Experimental browser OCR through `TextDetector` when the Chromium build exposes it.
- Experimental RAF preview using the camera's own RAW-conversion processor.
- Fully functional mock X-E5 for UI exploration without hardware.

## Not implemented or not yet validated

- The real USB write paths have not yet completed the physical X-E5 validation plan.
- Auto ISO is parsed and retained, but the first writer treats it as a shooting reminder. It is not part of the C-slot PTP recipe block.
- Exposure compensation is a manual reminder for the physical camera dial.
- Applying a composed C1-C7 collection in one operation is planned after single-slot persistence is verified.
- FS writes require a full-backup restore and a camera power cycle.
- URL extraction can find several recipes in one article; automatic multi-variant selection still needs stronger article segmentation.
- Browser OCR availability varies. A portable OCR provider is planned.
- Library folders, tags, and reference images exist in the data model but do not yet have complete editing UI.

## Requirements

- Debian/Linux or another desktop OS with a Chromium-based browser.
- Node.js 22 or newer.
- A USB-C data cable.
- For real camera access, the X-E5 must be set to:

```text
SET UP → NETWORK/USB SETTING → CONNECTION MODE
→ USB RAW CONV./BACKUP RESTORE
```

WebUSB requires `localhost` or HTTPS and a user click to open the browser device picker.

## Run locally

```bash
npm install
npm start
```

Open:

```text
http://127.0.0.1:4173
```

No runtime npm packages are required. The local server exists to provide a secure WebUSB context and the restricted experimental URL importer.

### Linux USB permissions

If Chromium cannot claim the camera, first close photo importers, X RAW Studio, gphoto processes, or any other application using the PTP interface. If access is still denied, a local udev rule may be required:

```udev
SUBSYSTEM=="usb", ATTR{idVendor}=="04cb", TAG+="uaccess"
```

Reload rules and reconnect the camera:

```bash
sudo udevadm control --reload-rules
sudo udevadm trigger
```

Do not use a world-writable USB rule unless you understand the security trade-off.

## First real-camera validation

1. Create a full backup with official software as an additional recovery point.
2. Start the application and connect the X-E5.
3. Read C1-C7 and FS1-FS3 without writing.
4. Select C7.
5. Change one obvious, reversible value.
6. Confirm the automatic backup and diff.
7. Write and verify the immediate read-back.
8. Power-cycle the camera.
9. Reconnect and run the persistence verification.
10. Repeat separately with FS3 only after C7 succeeds.

See [Hardware Validation](docs/HARDWARE_VALIDATION.md) for the detailed checklist.

## Tests

```bash
npm run verify
```

This runs syntax checks and the Node test suite for parsing, codecs, PTP framing, JSON portability, mock-camera workflows, and pure UI rendering.

## Architecture

```text
src/core/
  Canonical recipe schema, parser, normalization, resolution, JSON

src/camera/
  PTP/WebUSB transport, X-E5 C-slot codec, X-E5 FS backup codec,
  RAW-preview profile patching, real and mock camera clients

src/storage/
  IndexedDB persistence with an in-memory fallback

src/ui/
  Pure HTML render functions and reusable controls

server.mjs
  Static local server and restricted Fuji X Weekly URL importer
```

More detail is available in [Architecture](docs/ARCHITECTURE.md), [Protocol Notes](docs/PROTOCOL_NOTES.md), and [JSON Format](docs/JSON_FORMAT.md).

## Safety principles

- Model and backup-size checks before any full restore.
- No write without an automatic recovery snapshot.
- No write without a visible before/after comparison.
- No success claim based only on a PTP `OK` response.
- Immediate read-back verification after every property write flow.
- First-use persistence verification after a power cycle.
- Unknown or unverified fields are preserved or omitted rather than guessed.
- Full-backup bytes and camera serials remain local unless explicitly exported.

## License and acknowledgements

The application is MIT licensed. It contains no vendored Fujifilm software or SDK. The protocol implementation is based on public interoperability research from the open-source Fujifilm community. See [Third-Party Notices](THIRD_PARTY_NOTICES.md).

This project is not affiliated with or endorsed by Fujifilm Holdings Corporation or Fuji X Weekly.
