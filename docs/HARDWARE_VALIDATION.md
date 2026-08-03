# Hardware Validation Runbook

## Current evidence status

The mandatory read-only run completed on the owner's Fujifilm X-E5 firmware 1.10 on 2026-08-02. WebUSB source revision 9 completed the authoritative C1-C7 scan with an explicit selector write for every bank, exact read-back, restoration, session close, and interface release. A separately acknowledged fresh WebUSB session then completed the guarded handle-zero backup read, exact X-E5/format/length checks, local IndexedDB storage, FS1-FS3 decode, interface release, and physical-menu review. The final evidence is recorded in `docs/VALIDATION_REPORT_2026-08-02.md`. Mock-camera behavior, unit tests, public research, and observations from other Fujifilm bodies remain distinct from physical validation.

Current non-sensitive Stage 2 record:

```text
USB identity: 04CB:0313 FUJIFILM X-E5
USB interface: 0, Imaging class, 480 Mbit/s
Initial interface owner/driver: usbfs via gvfsd-gphoto2
Discovery interface owner: Chromium after gvfsd-gphoto2 was released
Current-user device access: read/write through explicit ACL
Chromium: Google Chrome 150.0.7871.186
Node.js: 20.19.2
npm: 9.2.0
udev change required: no
Physical WebUSB interface: configuration 1, interface 0/0, class 06/01/01
Physical endpoints in RAW/backup personality: Bulk IN 1/512, Bulk OUT 1/512, Interrupt IN 2/24
Physical DeviceInfo: FUJIFILM X-E5, device version 1.10
RAW/backup properties: 0xD16E, 0xD18C, and all codes 0xD18D-0xD1A5 advertised
USB mode 0xD16E: 6, USB RAW CONVERSION/BACKUP RESTORE
C scan: WebUSB revision 8, 196 transactions (TID 0-195), C1-C7 complete, selector restored to C1, session closed, interface released
Backup read: OpenSession, GetDeviceInfo, GetObjectInfo(0), GetObject(0), CloseSession
Backup guards: model XE5, format 0x5000, declared/actual/expected length 70524
Backup storage: volatile memory only; SHA-256 reported without backup bytes
FS menu comparison: FS1 Provia, FS2 Nostalgic Neg., FS3 PRO Neg. Std; FS RECIPE Off for all three
Physical writes beyond temporary 0xD18C selection: none
```

The later WebUSB source-revision-9 backup replay used `OpenSession`, `GetObjectInfo(0)`, `GetObject(0)`, and `CloseSession` at TIDs 0-3. It verified format `0x5000`, exact declared/actual/expected length 70,524, embedded model `X-E5`, local SHA-256 `97423cd54d97587d9c52ce1d0e673cbe6466ba8930f2de13deea6b961cdf73ea`, clean close/release, and zero anomalies. The bytes were stored only in local IndexedDB and excluded from the report. The owner then recorded FS RECIPE Off for FS1-FS3, reaching the mandatory stop.

Post-stop status: after reviewing the report, the owner separately approved manual physical-menu characterization of C7 and FS1. The owner initialized C7 and entered the requested Classic Chrome recipe directly on the camera; no programmatic recipe/name property was written. A subsequent read-only C scan captured exact C7 raw/menu mappings, restored the original C7 selector, closed, and released successfully. Those mappings are recorded in `AGENTS.md` and `docs/PROTOCOL_NOTES.md`. The phrase “Physical writes beyond temporary 0xD18C selection: none” in the initial record refers to host/PTP operations during the mandatory run; it does not deny the later owner menu action.

The guarded FS1 before/after characterization completed. Bidirectional isolated menu toggles physically established FS1 Recipe enable byte offset `34500` with `00=Off` and `01=On`. Later independent bidirectional toggles established FS3 at `34502` with the same two-state values; FS2 remains unmapped. Additional isolated reads established final FS1 Color +2 as raw `05` at offset `34752` and Sharpness -2 as raw `06` at `34758`. The enabled Classic Chrome FS1 and neutral ACROS FS3 targets match the values recorded in `AGENTS.md`, except D-Range Priority remains menu-only because no backup offset is known. Every backup remained volatile and was discarded.

For isolated flag, Color, and Sharpness changes, checksum `0x120` followed the signed byte delta. Unknown derived bytes near offset `63268` also changed in some comparisons, so no complete checksum rule is claimed and no backup patch/restore is authorized. An interrupted diagnostic plus a restarted GVFS monitor caused one stale session; the monitor was runtime-masked again and a physical power cycle restored clean access.

Earlier Source R4/R5 observations came from the camera's generic USB personality, identified by a 32-byte interrupt endpoint and a five-property DeviceInfo list. They remain useful diagnostic history in `docs/PROTOCOL_NOTES.md`, but they do not describe the subsequently observed RAW/backup personality. Correct USB power/communication configuration and reconnecting exposed the 24-byte interrupt endpoint plus `0xD16E`, `0xD18C`, and the recipe range without a hidden initialization command.

Do not repeat gphoto connection commands during the staged run. On this host, `gphoto2 --summary` attempted a `SetDevicePropValue(0xD207)` operation which the camera rejected, and a gphoto session could leave `SESSION_ALREADY_OPEN` after the process exited. The policy-locked CLI is the safer diagnostic path because its operation allowlist excludes this mutation.

The full serial and the serial-bearing gphoto URI observed in a host process listing are intentionally omitted.

Use these evidence labels in notes and reports:

- **STANDARD** — defined by USB or PTP specifications.
- **PUBLIC RESEARCH** — reported by an independent implementation or published investigation.
- **FIXTURE ONLY** — demonstrated only by this repository's mock or automated tests.
- **PHYSICAL X-E5** — observed on the owner's camera during this runbook, with firmware and host context recorded.

Never upgrade an observation to **PHYSICAL X-E5** without capturing the non-sensitive raw evidence and comparing the decoded result with the camera menu where applicable.

The local application publishes only a redacted, binary-free validation snapshot to the same loopback server at `/api/validation-report`. This in-memory snapshot exists solely so the staged run can be inspected without transcribing the UI; restarting the server clears it. Full-backup bytes and serial-bearing keys are prohibited at both the browser and server boundaries.

## Non-negotiable safety rules

The initial run ends after the read-only C1-C7 scan and read-only backup/FS1-FS3 decoding.

During that run:

- Do not write C1-C6 or FS1-FS3.
- Do not change a recipe value or slot name.
- Do not patch a backup or calculate a replacement checksum.
- Do not call `SendObjectInfo`, `SendObject`, or `DeleteObject`.
- Do not restore a backup.
- Do not upload a RAF, trigger RAW conversion, or invoke firmware operations.
- Do not apply X-T5 offsets or checksum behavior to X-E5 data.
- Do not guess a missing property value or backup offset.
- Do not treat `PTP OK` as proof that a future mutation persisted.
- Do not run Chromium or the application with `sudo`.
- Do not upload, commit, attach to an issue, or include in screenshots any binary camera backup.
- Never print, persist in diagnostics, export, commit, or report the full camera serial number. Keep it only in volatile memory when required; reports use a redacted form.

The sole camera-property mutation permitted during the read-only C-slot scan is temporary selection through `0xD18C`, because public research indicates that the camera exposes one C slot at a time. Preserve the original value and restore it in cleanup. Warn the owner immediately before this step because it changes the active selector, even though it does not edit a recipe.

Always tell the owner immediately before any step requiring:

- connecting or disconnecting the USB cable;
- pressing a browser control or using Chromium's USB picker;
- changing or inspecting a camera menu setting;
- unplugging and reconnecting the camera;
- power-cycling the camera;
- running a `sudo` command;
- any camera write, including the temporary `0xD18C` selector change.

## Validation record

Create a local text report containing only non-sensitive information:

```text
Camera model shown in menu: Fujifilm X-E5
Camera firmware:
Connection mode: USB RAW CONV./BACKUP RESTORE
Host distribution and version:
Kernel:
Chromium executable and version:
Node.js version:
USB cable description:
Auto Update Custom Setting: unknown / On / Off
Validation date and local timezone:
Operator:
Repository revision or dirty-tree description:
```

Do not put a serial number, USB bus/device path from a private report, backup bytes, or an unredacted browser screenshot in a committed document.

## Stage 1 — local baseline

Complete this stage before connecting the camera and before changing implementation files.

Run from the repository root:

```sh
npm ci
npm run verify
npm start
```

Record exact command output and exit status. `npm start` is expected to remain running; use a second unprivileged terminal for read-only checks. Confirm:

- the server starts without warnings;
- `http://127.0.0.1:4173` loads in Chromium;
- no browser-console errors occur before a device connection;
- Mock X-E5 mode still works;
- Camera, Import/Edit, Library, Backups, RAF Preview, and System views render at desktop and narrow/mobile widths;
- the footer reads exactly `Made with 💙 by arrf`;
- controls that can mutate a real camera are absent or disabled during the read-only stage.

Compare actual scripts, source layout, server behavior, browser support, and visible features with `README.md`. Record every mismatch; do not silently rewrite a claim to fit a failing implementation.

Gate: do not continue if the baseline fails in a way that could hide transport errors. Mock success does not pass a hardware gate.

## Stage 2 — Linux USB diagnostics

Complete the host diagnostics before changing WebUSB code. This stage requires the owner to connect the charged camera in the configured USB RAW conversion/backup mode. Tell the owner before the cable or camera must be touched.

### USB identity and topology

With the camera connected, collect unprivileged output from:

```sh
lsusb
lsusb -t
```

Identify the Fujifilm row by vendor ID `04cb`, then record the product ID exactly as observed. Do not assume a product ID from public research.

Use the observed bus and device numbers only in local commands, for example:

```sh
ls -l /dev/bus/usb/BBB/DDD
getfacl /dev/bus/usb/BBB/DDD
```

Record whether the current user has read and write access through the device ACL. Do not put a reusable device path or unrelated ACL entries in a public report.

Inspect interface-to-driver bindings with `lsusb -t` and read-only sysfs inspection. Record the active kernel driver for the PTP interface; do not assume `usbfs`, `usb-storage`, or any other driver. If a driver is bound, record its exact interface and name before considering whether detachment is safe.

### Competing processes

Check for programs that commonly claim a still-image/PTP device:

```sh
ps -ef | rg -i 'gvfs|gphoto|shotwell|digikam|raw studio|xraw|fujifilm'
lsof /dev/bus/usb/BBB/DDD
fuser -v /dev/bus/usb/BBB/DDD
```

Also inspect the desktop for an automatically opened file/photo importer. Record whether gvfs, gphoto2, Shotwell, digiKam, X RAW Studio, or another process owns the device. Do not terminate a process without first telling the owner what will be stopped. A command that merely lists a process is not proof that it has claimed this specific USB node; correlate process output with `lsof`/`fuser` or interface-claim errors.

### Tool versions

Record the executable actually used and its version. Depending on the distribution, Chromium may be named differently:

```sh
chromium --version
chromium-browser --version
google-chrome --version
node --version
```

Do not use `sudo` for Chromium, Node.js, or the local server.

### Minimal udev access rule

Only recommend a rule if the observed device permissions block the current user. The minimal rule is:

```udev
SUBSYSTEM=="usb", ATTR{idVendor}=="04cb", TAG+="uaccess"
```

Do not recommend or use `MODE="0666"`. Installing a rule, reloading udev, or triggering devices can require `sudo`; stop and tell the owner before any such command. A new rule can also require unplugging/replugging the USB cable, so announce that action in advance. Re-check the device ACL after reconnection instead of assuming the rule worked.

Gate: do not proceed until the current user can access the device and no competing process is claiming the PTP interface.

## Stage 3 — WebUSB discovery

Start this stage with the application and Chromium running as the normal user. Keep mutation controls disabled.

### Manual browser action

Immediately before discovery, tell the owner exactly:

1. Press the application's **Connect** button.
2. Select the **Fujifilm X-E5** in Chromium's USB picker and confirm the selection.

The application cannot make this permission choice for the owner. Do not automate or bypass the picker.

### USB descriptor capture

After permission is granted, collect focused, redacted diagnostics for:

- USB vendor ID;
- USB product ID;
- manufacturer and product strings when exposed;
- chosen configuration value;
- claimed interface number;
- interface class, subclass, and protocol;
- Bulk IN endpoint number, direction, transfer type, and packet size;
- Bulk OUT endpoint number, direction, transfer type, and packet size;
- interrupt/event endpoint and packet size when present.

The interface selection logic must derive endpoints from descriptors. It must not assume interface or endpoint numbers copied from another model.

### DeviceInfo capture

Issue read-only `GetDeviceInfo` and decode the complete dataset. Record:

- standard version and vendor extension information;
- supported PTP operations;
- supported event codes;
- advertised device-property codes;
- capture and image format codes when present;
- manufacturer;
- model;
- firmware/device version;
- serial number only in volatile memory.

Display response and operation names symbolically while retaining their hexadecimal codes. Redact the serial at its first diagnostic boundary; do not log the original and redact later.

Confirm that the normalized model is X-E5. Confirm that the advertised properties contain Fujifilm selector `0xD18C` before enabling any C-slot scan action. Use one bounded standards-compliant session for discovery: `OpenSession` at TID 0, `GetDeviceInfo` at TID 1, and `CloseSession` at TID 2. This reads no property and changes no camera setting. If the in-session dataset omits `0xD18C`, stop the C-slot path and report the raw non-sensitive identity values without probing the property directly.

### Transport fault behavior

Exercise fault handling only through safe conditions, not by intentionally corrupting camera state. Confirm from implementation and naturally occurring failures that it:

- times out with an operation and phase in the message;
- recognizes a disconnected device;
- reports a stalled endpoint and attempts only a bounded, safe recovery;
- distinguishes an incomplete/short data container;
- rejects a transaction-ID mismatch;
- displays `0x200F` as `AccessDenied` with a vendor-overload caveat and operation context;
- closes an open session when possible and always releases the claimed USB interface on failure.

Do not create a disconnect or cable-pull test without telling the owner first.

Gate: do not begin a slot scan until descriptor discovery, DeviceInfo parsing, model normalization, interface cleanup, and `0xD18C` advertisement are all demonstrated on the physical camera.

## Stage 4 — read-only C1-C7 scan

This stage temporarily changes only the selected-slot property `0xD18C`. Tell the owner immediately before starting that the camera's selected custom slot will move through C1-C7 and then be restored. Do not proceed if the original selector cannot first be read and retained.

### Session and transaction requirements

- Open the PTP session correctly and handle a stale session without silently reusing it.
- Use the standards-required TID 0 for `OpenSession`, then strictly increasing nonzero TIDs for every subsequent operation in that session. Restart this sequence for each fresh session and keep a separate diagnostic session ordinal.
- Record the original `0xD18C` raw bytes and decoded selector.
- Explicitly select each of C1 through C7, including a same-value write for the original selector; revision-8 physical evidence showed that this is required to load the saved-bank property context deterministically.
- Require exact selector read-back as the settle condition. Retry only for a bounded explicit busy response rather than hiding behavior behind a fixed delay.
- For each slot, read the name and every available property from `0xD18D` through `0xD1A5`.
- Preserve exact raw payload bytes and payload widths.
- Decode only mappings known to this project; present unknown or body-specific values as passthrough data.
- Never substitute a recipe default for a missing, unsupported, failed, or short camera read.
- Restore the original selector even after a partial failure.
- Close the PTP session cleanly and release the interface.

If restoring the original selector fails, report that prominently and ask the owner to check the selected slot in the camera menu. Do not perform another camera operation until the state is understood.

### Per-property report format

Use one row for every property attempted in every slot:

```text
Slot | Property | Canonical value | Raw value | Width | Read status | Normalization or uncertainty
C1   | 0xD18D   | ...             | ...       | ...   | OK          | ...
```

Raw values may be formatted as hexadecimal in the report, but names and strings must be sanitized and the camera serial must never appear. Status values should distinguish at least `OK`, `UNSUPPORTED`, `TIMEOUT`, `DEVICE_BUSY`, `SHORT_PAYLOAD`, `TRANSACTION_MISMATCH`, `DISCONNECTED`, and `PASSTHROUGH`.

### Physical menu comparison

After collecting all slots, tell the owner before asking them to open camera menus. Show the decoded values one slot at a time and pause for the owner to confirm the values visible for C1-C7. Record:

- exact matches;
- raw-value matches that required a documented normalization;
- fields unavailable in the camera menu;
- decode uncertainty;
- missing or extra properties;
- any field that differs from the menu.
- whether each bank is a saved custom bank or displays `CREATE NEW`; preserve but suppress latent property bytes for uninitialized banks.

Do not change a mapping solely to make one unexpected value look familiar. Preserve the raw observation, add a focused fixture, and distinguish a decoder defect from body- or firmware-specific behavior.

Gate: do not download a full backup until all seven slots have been read, the original selector has been restored, and transport cleanup succeeds. Menu mismatches must be understood or explicitly documented as unresolved.

## Stage 5 — read-only full backup and FS1-FS3 decode

Begin only after Stage 4 passes. Warn the owner before download that a settings backup can contain the full camera serial number and must remain local and private.

Because Stage 4 releases the claimed interface, the separately acknowledged backup action must reclaim the same already-authorized WebUSB device before opening its fresh session. Record that reclaim in the report. If reclaim fails or the device identity/model no longer matches, stop; do not silently choose another device or bypass the browser permission model.

### Download

Use only the standard read operations reported by project research:

```text
GetObjectInfo(handle 0)
GetObject(handle 0)
```

Do not call `SendObjectInfo`, `SendObject`, or any restore operation. Requirements:

- use a clean PTP session;
- retain ObjectInfo metadata only after sanitizing strings;
- compare the exact received byte count with `ObjectCompressedSize` from ObjectInfo;
- require the model to normalize to X-E5;
- compute SHA-256 locally and display the hash and byte count;
- store the blob only in IndexedDB or a file explicitly selected by the owner;
- never send it over the network, include it in logs/screenshots, or place it in the repository;
- release the interface on every exit path.

The publicly reported expected X-E5 backup length is 70,524 bytes. Treat that number as **PUBLIC RESEARCH** until observed. A length mismatch blocks FS decoding; it does not authorize truncation, padding, alternate offsets, or a guessed layout.

### Guarded FS decode

Decode FS1-FS3 only when all of these are true:

- DeviceInfo and backup metadata normalize to X-E5;
- ObjectInfo length equals the actual received length;
- the exact length matches the project's X-E5 expected size;
- every required read stays within the blob bounds;
- the decoder performs no mutation and preserves raw bytes and widths;
- only project-known mappings are decoded.

Report unknown values as passthrough. Do not apply X-T5 offsets, checksum logic, or inferred recipe defaults. A decoder may inspect the publicly reported checksum field but must not modify it or claim the checksum algorithm is physically verified.

Use the same per-field reporting shape as the C-slot scan for FS1-FS3: canonical value, raw value, payload width, read status, normalization, uncertainty, and research-source label.

### Physical menu comparison

Tell the owner before asking them to inspect FS1-FS3 in camera menus. Compare one slot at a time and record exact matches, normalized matches, menu-invisible fields, uncertain mappings, and mismatches. Do not expose backup bytes or a serial while sharing the comparison.

The application must record non-empty comparison notes (or the explicit statement `No mismatches`) and a separate owner acknowledgement. A successful download alone is not the mandatory stop.

Close the PTP session and release the interface after the download and decode. Do not keep the camera claimed while reviewing values.

## Mandatory stop and validation report

Stop after the read-only C1-C7 scan and the read-only full-backup/FS decode. Do not test C7 writes, FS writes, restore, RAW conversion, or any other mutation.

Give the owner a concise report containing:

1. local baseline and physical-validation outcome;
2. all detected USB descriptors and PTP capabilities, with the serial redacted;
3. C1-C7 decoded values, raw values, widths, statuses, and uncertainty;
4. FS1-FS3 decoded values with the same evidence, if all guards passed;
5. mismatches between physical camera menus and application output;
6. browser-console errors and transport anomalies;
7. files changed;
8. tests and manual checks run, with results;
9. remaining risks and every unverified public-research assumption;
10. the exact proposed C7 write plan below.

The report must not contain the full serial, a binary backup, a data URL representing a backup, or a screenshot that exposes either.

## Proposed later C7 write validation — do not execute

This plan remains locked until the owner explicitly approves it after reviewing the mandatory-stop report.

1. Read and back up C7 in canonical JSON and raw-property form.
2. Keep C1-C6 untouched.
3. Propose changing only the C7 slot name first.
4. Sanitize the proposed name and enforce the verified camera length limit; do not guess a limit.
5. Show the exact before/after value, encoded payload, operation code, property code, and expected response.
6. Require explicit confirmation for that exact operation.
7. Write only the C7 name.
8. Read the name back immediately.
9. Compare raw payload and canonical value with the proposal.
10. Ask the owner to verify the name in the camera menu.
11. Tell the owner before asking them to power-cycle the camera.
12. Reconnect through the manual Chromium picker and verify persistence.
13. With separate explicit confirmation, restore the original C7 name.
14. Repeat menu, read-back, and power-cycle persistence checks.
15. Only after the name experiment fully succeeds, propose one reversible C7 recipe-parameter change as a new, separately approved operation.

A PTP `OK` response alone is not success. Immediate read-back, physical menu agreement, and power-cycle persistence are mandatory. Any unrelated property change, selector restoration failure, response anomaly, or persistence mismatch stops the experiment before another write.

The later experiment must never write C1-C6, FS1-FS3, a full backup, any object, or any RAW-conversion data.
