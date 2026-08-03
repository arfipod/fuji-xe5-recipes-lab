# Architecture

## Design constraints

- Local web UI for fast iteration on Debian and other Linux systems.
- No cloud account or backend database.
- X-E5-specific protocol guards.
- Portable canonical JSON for a later Android port.
- Read-modify-write behavior that preserves unknown camera state, after write paths are validated and approved.
- Pure, testable parser and codec functions.
- Mock and fixture behavior is kept distinct from physical-camera evidence.

## Layers

### Canonical domain

`src/core/`

The canonical recipe is independent of its USB representation. Each value has provenance metadata so the application can distinguish a field parsed from source text from a neutral value or a current-slot fallback.

The domain also holds shooting reminders that are not written through the initial slot protocol.

### Camera transport

`src/camera/ptp.js`

A minimal PTP-over-WebUSB implementation provides:

- interface and endpoint discovery;
- 12-byte PTP container parsing and encoding;
- command, data, response, and event handling;
- incremental bulk-container reassembly;
- sessions, property reads, and object reads;
- a bounded, payload-free transaction ledger with symbolic operations/responses, a transport-lifetime cursor, and standards-compliant per-session transaction IDs (`OpenSession` 0, then 1, 2, ...);
- cleanup that releases claimed interfaces on both success and failure.

It contains no recipe semantics. Initial hardware work is read-only.

### C1-C7 codec

`src/camera/x-e5-codecs.js`

Public interoperability research reports this Fujifilm PTP property surface for C slots:

```text
0xD18C              selected slot
0xD18D              slot name
0xD18E-0xD1A5       slot properties
```

The reader preserves raw bytes and payload widths, maps only known values to canonical values, and exposes unknown values as passthrough data. The first physical stage may select slots only as required for reading, must restore the original selector, and must not write recipe properties. A future write planner remains locked until the staged C7 experiment is explicitly approved.

### FS1-FS3 codec

FS positions are not C8-C10. Public research reports that the X-E5 stores them as parallel arrays inside the full settings backup. The initial codec may decode only after the model normalizes to X-E5 and the exact expected backup size matches. Each decoded field retains its exact source slice, offset, width, raw value, status, uncertainty, and `PUBLIC_RESEARCH` label; unknown bytes remain passthrough values, and D-Range Priority remains unavailable because no X-E5 FS offset is known. Reported offsets and checksum behavior are research assumptions until confirmed against the owner's physical camera and menu.

No FS write, backup patch, checksum update, or restore is authorized during read-only validation.

### Full backup transport

Public research reports the full settings object as PTP object handle zero, read using standard `GetObjectInfo` and `GetObject`. The current physical path is download-only. After the guarded C1-C7 scan passes, the FS backup button performs the read directly without a separate review or confirmation modal. A persistent inline warning states that the object can contain the camera serial. The blob stays in IndexedDB, its SHA-256 is computed locally, and its serial number is never logged or exported in a report. After a successful download, the PTP session and claimed USB interface are closed before the in-memory result is returned to the controller.

The C1-C7 button likewise starts its guarded read directly. It is enabled only when DeviceInfo advertises `0xD18C` and every required operation. The scan explicitly selects and reads back every bank, restores the exact original selector, closes its session, and releases the interface. The direct backup action then reclaims only the already selected WebUSB device, opens a fresh PTP session, records the handle-zero read transactions, verifies the X-E5 model, object format, and exact size, and releases the interface again. The original 2026-08-02 staged validation and menu-comparison record remains historical evidence; it is no longer an interactive gate in the current read UI.

`SendObjectInfo`, `SendObject`, and all restore behavior are prohibited until a later, separate approval and validation plan.

### RAW preview

RAW conversion uses a protocol distinct from C-slot properties and full backups. Public research describes a vendor upload, a D185 conversion profile, a conversion trigger, and retrieval of a temporary output object. None of those camera operations are part of initial hardware validation, and no RAW upload, conversion trigger, or object deletion is currently authorized.

### Storage

`src/storage/db.js`

The local design uses IndexedDB object stores for:

- recipes;
- one slot backup per slot ID;
- one full backup per camera key;
- settings;
- optional reference images.

An in-memory fallback supports tests and restricted browser contexts. Binary backups must be ignored by Git and must never be uploaded.

### UI

`src/ui/`

Render functions remain separate from camera logic. The application controller owns actions, safety reviews, and state transitions. It keeps diagnostics focused, redacts serials, and does not enable C-slot actions unless the required selector property is advertised.

### Ephemeral validation snapshot

During physical validation, the browser sends the latest redacted stage result to `/api/validation-report` on the same loopback server. PTP payloads and guarded FS field slices are represented only as byte width and hexadecimal evidence. A context-specific boundary removes whole-backup bytes while retaining those small field slices. Serial-bearing keys and full-backup bytes are omitted before the request and rejected again by the server.

The server keeps only the latest snapshot in process memory, never logs its body, and never writes it to disk. Restarting the server clears the snapshot.

## Future Android split

A future Android application should preserve:

- canonical JSON schema;
- parser fixtures;
- field dependencies;
- C-slot and FS encoding fixtures;
- backup safety model;
- read-back and power-cycle verification semantics.

Only USB transport and platform storage should be platform-specific.
