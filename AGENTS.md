# Repository Instructions

These instructions apply to the entire repository. They are also the concise handoff record for the physical X-E5 research. The detailed evidence remains in `docs/PROTOCOL_NOTES.md`, the staged procedure in `docs/HARDWARE_VALIDATION.md`, and the mandatory read-only result in `docs/VALIDATION_REPORT_2026-08-02.md`.

## Read before editing

Before changing behavior, read `README.md`, `PRODUCT.md`, `DESIGN.md`, `CHANGELOG.md`, `package.json`, `server.mjs`, the build/bundle mechanism, relevant tests, and the protocol documents under `docs/`. Inspect the complete repository and check the working tree so unrelated user changes remain untouched.

The maintainable modular files under `src/` are the source of truth. Do not patch generated files in `bundle/` when an editable source representation exists. If generated output must change, update source first and use the documented build process. The current runtime intentionally uses native ES modules and has no opaque application bundle.

## Language and design

- Keep the application, documentation, diagnostics, test fixtures, and user-facing errors entirely in English.
- Preserve the black, grey, and white X-E5 visual system and responsive desktop/mobile behavior.
- Preserve the footer exactly as `Made with 💙 by arrf`.
- Do not remove accessibility or safety checks.

## Evidence classes

Never merge these evidence classes:

- **STANDARD** — behavior defined by PTP or the USB Still Image Capture Device specification.
- **PUBLIC RESEARCH** — behavior reported by an independent implementation or investigation listed in `THIRD_PARTY_NOTICES.md`.
- **FIXTURE ONLY** — behavior demonstrated only by this repository's mock or automated tests.
- **PHYSICAL X-E5** — non-sensitive behavior observed on the owner's X-E5 firmware 1.10 during the staged validation.
- **OWNER MENU ACTION** — a setting the owner changed directly through the physical camera menus. It is physical evidence of the resulting state, but not evidence that a PTP write works.

A successful read establishes only a read mapping. A mock result, another Fujifilm model, an advertised property, a descriptor, or `PTP OK` does not establish that the X-E5 accepts, applies, or persists the corresponding write.

## Current physical X-E5 evidence — 2026-08-02/03

### USB and PTP personality

The correct `USB RAW CONV./BACKUP RESTORE` personality was physically observed as:

```text
USB identity:             04CB:0313 FUJIFILM X-E5
Configuration:            1
Interface/alternate:      0/0
Class/subclass/protocol:  06/01/01
Bulk IN:                  0x81, 512-byte packets
Bulk OUT:                 0x01, 512-byte packets
Interrupt IN:             0x82, 24-byte packets
Model / firmware:         X-E5 / 1.10
USBMode 0xD16E:           6
Recipe selector:          0xD18C advertised
Recipe fields:            every code 0xD18D-0xD1A5 advertised
Backup object format:     0x5000
Exact backup length:      70,524 bytes
```

The earlier generic USB personality had a 32-byte interrupt endpoint, only five advertised properties, and no `0xD16E` or `0xD18C`. It must not be treated as the RAW/backup personality. Correct camera USB communication/power configuration plus reconnection exposed the complete personality; no hidden initialization command was needed.

The RAW/backup DeviceInfo advertised no events and 20 operations: standard `0x1001`-`0x100D` except `0x100E`/`0x100F`, property operations `0x1014`-`0x1017`, Fujifilm `0x900C`, `0x900D`, and `0x901D`, followed by `0x100C` and `0x100D` in the camera-provided order. Capability advertisement is not authorization to call a mutation operation.

`GetDevicePropDesc` succeeded only for unknown vendor property `0xD041`. It returned `GENERAL_ERROR (0x2002)` for the other 61 advertised properties, including `0xD18C` and every recipe property. Descriptors therefore establish no X-E5 recipe type, enum, access flag, or name limit.

### Host behavior

- Google Chrome was `150.0.7871.186`; Node.js was `20.19.2`; npm was `9.2.0`.
- The current user had read/write access through a device ACL; no udev change or `sudo` command was needed.
- `gvfsd-gphoto2` initially claimed the interface. The user-level monitor had to be runtime stopped/masked before reliable exclusive access.
- Installed `gphoto2 2.5.28` / `libgphoto2 2.5.31` detected only a generic PTP camera in the wrong personality. `--list-config` exposed five properties and no `0xD18C`.
- `gphoto2 --summary` attempted `SetDevicePropValue(0xD207)`, despite appearing to be a summary command, and gphoto could leave the camera returning `SESSION_ALREADY_OPEN` after the process exited. Do not use gphoto during staged validation.
- A physical power cycle cleared the stale PTP session. Reopening the USB channel alone did not.
- On 2026-08-03 the GVFS monitor had restarted after the earlier runtime suppression. An interrupted diagnostic plus the active monitor again produced `SESSION_ALREADY_OPEN`. Stopping and runtime-masking the monitor, then power-cycling the camera, restored clean access. Do not assume a previous runtime mask survived a later login/session boundary.

### Session framing and cleanup

- `OpenSession` uses transaction ID 0 and one nonzero SessionID parameter. Later operations increase monotonically within that session.
- The first browser failure, `PARAMETER_NOT_SUPPORTED`, came from an incorrect nonzero OpenSession TID and was an implementation error, not an X-E5 incompatibility.
- Unknown stale sessions are never adopted, their next TID is never guessed, and no speculative `CloseSession` is sent into them.
- Every completed or failed path must close a known session when possible, release the claimed interface, and close the USB device.
- The authoritative C scan used TIDs 0-195, returned only `OK`, restored the original selector by exact read-back, closed, and released without anomaly.

### Mandatory read-only C1-C7 result

The mandatory stop was completed. The initial menu state was C1 saved as `CUSTOM 1`, while C2-C7 displayed `CREATE NEW`. An empty `0xD18D` payload does not distinguish those states. The initial C1 raw/menu mappings are in `docs/VALIDATION_REPORT_2026-08-02.md` and focused tests.

The scan must explicitly select every bank with `0xD18C`, including a same-value selection for the original bank. Reading the original selector without that same-value operation returned a different live/direct context on firmware 1.10. Exact selector read-back is the settle condition; no unconditional delay was necessary.

### Owner-created C7 characterization after the mandatory stop

After reviewing the read-only report, the owner separately authorized later C7 and FS1 research. The owner created C7 directly in the physical camera menu and set this target:

```text
Film Simulation:       Classic Chrome
Grain Effect:          Strong / Small
Color Chrome Effect:   Strong
Color Chrome FX Blue:  Off
Smooth Skin Effect:    Off
White Balance:         5200 K, R +1, B -6
Dynamic Range:         DR400
D-Range Priority:      Off
Highlight:             0
Shadow:                -2
Color:                 +2
Sharpness:             -2
High ISO NR:           -4
Clarity:               -2
```

The owner supplied physical-menu photographs covering all four C7 pages. Auto Update Custom Setting was disabled. Auto ISO and exposure compensation are not part of the observed `0xD18D`-`0xD1A5` bank and remain shooting/manual settings rather than verified C-slot PTP fields.

A subsequent read-only CLI scan explicitly selected C1-C7, read the target, restored the original C7 selector `07 00`, closed the session, and released the interface. The exact C7 observations are:

| Property | Raw payload | Width | Physical menu result |
| --- | --- | ---: | --- |
| `0xD18D` | `01 00 00` | 3 | Empty PTP string; menu still displays `CUSTOM 7` |
| `0xD18E` | `07 00` | 2 | Image Size L 3:2 |
| `0xD18F` | `02 00` | 2 | Image Quality F |
| `0xD190` | `90 01` | 2 | DR400 |
| `0xD191` | `00 00` | 2 | D-Range Priority Off |
| `0xD192` | `0B 00` | 2 | Classic Chrome |
| `0xD193` | `00 00` | 2 | Monochrome warm/cool not applicable |
| `0xD194` | `00 00` | 2 | Monochrome magenta/green not applicable |
| `0xD195` | `03 00` | 2 | Grain Strong / Small |
| `0xD196` | `03 00` | 2 | Color Chrome Strong |
| `0xD197` | `01 00` | 2 | Color Chrome FX Blue Off |
| `0xD198` | `01 00` | 2 | Smooth Skin Off |
| `0xD199` | `07 80` | 2 | White Balance Temperature |
| `0xD19A` | `01 00` | 2 | WB shift R +1 |
| `0xD19B` | `FA FF` | 2 | WB shift B -6, signed i16 |
| `0xD19C` | `50 14` | 2 | 5200 K |
| `0xD19D` | `00 00` | 2 | Highlight 0 |
| `0xD19E` | `EC FF` | 2 | Shadow -2, signed value -20 divided by 10 |
| `0xD19F` | `14 00` | 2 | Color +2, signed value 20 divided by 10 |
| `0xD1A0` | `EC FF` | 2 | Sharpness -2, signed value -20 divided by 10 |
| `0xD1A1` | `00 80` | 2 | High ISO NR -4, observed nonlinear enum |
| `0xD1A2` | `EC FF` | 2 | Clarity -2, signed value -20 divided by 10 |
| `0xD1A3` | `01 00` | 2 | Long Exposure NR On |
| `0xD1A4` | `01 00` | 2 | sRGB |
| `0xD1A5` | `07 00` | 2 | Unknown/body-specific passthrough |

These values are exact firmware-1.10 **read mappings produced after an owner menu action**. They do not prove any `SetDevicePropValue` write encoding, ordering, acceptance, or collateral behavior. In particular, `0xD18D` remains an empty string even after C7 was initialized and the visible menu label became `CUSTOM 7`; it is not a reliable initialization or visible-name field on this body as currently observed.

After a later physical power cycle, a fresh read-only C1-C7 scan again returned the complete table above for C7. All 25 C7 reads returned `OK`; the scan restored the original C1 selector from exact `01 00` read-back, closed the session, and released the interface. This verifies persistence of the **owner-menu-created** C7 state across that power cycle. It is not evidence of a host-side PTP recipe write.

### Full backup and FS evidence

Two completed guarded reads used only `GetObjectInfo(0)` and `GetObject(0)` between session open/close, required normalized model `XE5`, object format `0x5000`, and exact length 70,524, and calculated SHA-256 locally. The backup bytes were never printed, uploaded, or committed. One transient read was discarded in memory; the browser replay retained bytes only in local IndexedDB after the owner's warning acknowledgment.

The initial physical menus showed FS1 Provia/Standard, FS2 Nostalgic Negative, and FS3 PRO Neg. Std, with `FS RECIPE` Off for all three. Only the film assignments were active; all other decoded FS values were latent.

Post-stop volatile before/after comparisons then characterized an owner-created, enabled FS1 target. Every backup passed exact model `XE5`, format `0x5000`, and 70,524-byte guards; both comparison blobs stayed only in process memory and were discarded. The final FS1 state is:

```text
FS RECIPE:             On
Film Simulation:       Classic Chrome
Grain Effect:          Strong / Small
Color Chrome Effect:   Strong
Color Chrome FX Blue:  Off
Smooth Skin Effect:    Off
White Balance:         5200 K, R +1, B -6
Dynamic Range:         DR400
D-Range Priority:      Off in the menu; no backup offset known
Highlight:             0
Shadow:                -2
Color:                 +2
Sharpness:             -2
High ISO NR:           -4
Clarity:               -2
```

Exact active FS1 backup observations are:

| Field | Offset | Width | Raw | Canonical |
| --- | ---: | ---: | --- | --- |
| Film Simulation | 1991 | 1 | `0F` | Classic Chrome |
| FS RECIPE | 34500 | 1 | `01` | On; `00` is Off |
| Color Temperature | 34704 | 2 | `50 14` | 5200 K |
| White Balance | 34716 | 1 | `0A` | Temperature |
| High ISO NR | 34722 | 1 | `00` | -4 |
| Clarity | 34728 | 1 | `04` | -2 |
| Dynamic Range | 34743 | 1 | `03` | DR400 |
| Color | 34752 | 1 | `05` | +2 |
| Sharpness | 34758 | 1 | `06` | -2 |
| Highlight | 34764 | 1 | `04` | 0 |
| Shadow | 34770 | 1 | `00` | -2 |
| Color Chrome | 34776 | 1 | `02` | Strong |
| Color Chrome FX Blue | 34779 | 1 | `00` | Off |
| Grain Strength | 34782 | 1 | `00` | Strong |
| Grain Size | 34785 | 1 | `00` | Small |
| Smooth Skin | 34788 | 1 | `00` | Off |
| WB Shift R | 34864 | 1 | `08` | +1 |
| WB Shift B | 34870 | 1 | `0F` | -6 |

Offset `34500` was verified bidirectionally: owner-menu On→Off produced `01→00`, and Off→On produced `00→01`, while every recipe-value field remained unchanged. Do not infer adjacent enable offsets. FS3 was later mapped independently at `34502`; FS2 remains unknown.

The isolated Color target transition changed offset `34752` from `07→05` and the isolated Sharpness transition changed `34758` from `04→06`. The final raw `05`/`06` values match menu Color +2/Sharpness -2. The intermediate Color state lacks a retained menu photograph and must not be promoted as a new raw mapping. Earlier raw `00` while the menu showed Color 0 appears to be a latent/sentinel state and remains passthrough rather than being normalized.

For isolated FS1 flag, Color, and Sharpness changes, checksum field `0x120` changed by the same signed byte delta: ±1 for the flag, -2 for Color, and +2 for Sharpness. This is evidence about those isolated transitions, not a complete X-E5 checksum algorithm. Offsets around `63268` also changed in some comparisons and remain unknown derived/integrity data. No backup patch, replacement checksum, or restore is authorized.

The maintained decoder now reads FS1 and FS3 activation directly only when their physically mapped raw byte is `00` or `01`. FS2 activation still requires physical-menu confirmation. The final FS1 characterization backup SHA-256 was `33e024eb465e250405b2586460fb3c01b6e3ee12063e581c36c20da2fc529a2e`; the corresponding binary was discarded without emission or persistence.

After the same later physical power cycle, a fresh guarded handle-zero backup read again decoded FS1 as enabled with every target value above, including Color +2 and Sharpness -2. It passed normalized model `XE5`, object format `0x5000`, and exact 70,524-byte gates; SHA-256 was `959e3f4042a4218f276ba43023317e39705ab97c85de81736049dbe840a2d2e1`. The different whole-backup hash is not interpreted as a recipe mismatch because the known FS1 bytes were unchanged and the complete backup can contain unrelated mutable camera state. The binary remained volatile and was discarded; the session closed and the interface released cleanly. This verifies persistence of the **owner-menu-created** FS1 state, not a PTP property write or backup restore.

### Owner-configured FS2 characterization

On 2026-08-03 the owner configured FS2 directly in the camera menu, enabled `FS RECIPE`, and confirmed these requested values: Classic Chrome, DR200, Highlight +2, Shadow +2, Color -2, Sharpness -1, High ISO NR -2, and Temperature WB 3200 K with R +8/B -8. Auto ISO and exposure compensation remain separate shooting settings and are not FS backup fields.

A subsequent guarded read used only `GetObjectInfo(0)` and `GetObject(0)`, passed the `XE5`/`0x5000`/70,524-byte gates, produced SHA-256 `f683d1be5fd9e4198b91aa99eadfb20f97076ad4b22064b4d5a6934a69136200`, closed, released, and discarded the backup without emission or persistence. Exact requested-field observations were:

| Field | Offset | Width | Raw | Owner-menu canonical value |
| --- | ---: | ---: | --- | --- |
| Film Simulation | 1994 | 1 | `0F` | Classic Chrome |
| Color Temperature | 34706 | 2 | `80 0C` | 3200 K |
| White Balance | 34717 | 1 | `0A` | Temperature |
| High ISO NR | 34723 | 1 | `02` | -2 |
| Dynamic Range | 34744 | 1 | `03` | DR200 |
| Color | 34753 | 1 | `07` | -2 |
| Sharpness | 34759 | 1 | `05` | -1 |
| Highlight | 34765 | 1 | `08` | +2 |
| Shadow | 34771 | 1 | `08` | +2 |
| WB Shift R | 34865 | 1 | `01` | +8 |
| WB Shift B | 34871 | 1 | `11` | -8 |

The raw `03`/`07` meanings conflict with the provisional shared-enum interpretation and with differently observed FS1 values. They are therefore decoded only as slot-scoped physical FS2 observations; never generalize them to another FS position. The owner confirmed FS2 Recipe `On`, but no before-backup was retained across this menu action, so the FS2 enable offset remains unknown and the backup alone still reports activation as `UNKNOWN_FROM_BACKUP`. Unspecified FS2 fields were left unchanged and are not promoted as part of this target. This is read evidence after an owner menu action, not proof of backup patching, checksum generation, restore, or host-side FS writes.

### Owner-configured FS3 ACROS characterization

The owner configured FS3 directly in the physical menu with plain ACROS, neutral Monochromatic Color WC0/MG0, DR Auto, Grain Strong/Large, Color Chrome Off, Color Chrome FX Blue Off, Auto WB R0/B0, Highlight +4, Shadow +2, Sharpness -4, High ISO NR -4, and Clarity +5. `AcrosY`, `AcrosR`, and `AcrosG` remain separate catalog choices and were not physically characterized in this run. Auto ISO up to 12800 and exposure compensation 0 to +2/3 are separate shooting reminders, not FS backup fields, and were deliberately excluded from the volatile comparison.

A generalized `fs-diff-lab --fs-slot 3` retained a 70,524-byte before-backup only in memory, released USB for the owner menu change, then read and discarded the after-backup. The transition changed 19 bounded offsets. A later isolated FS3 Recipe On→Off comparison changed only offset `34502` from `01→00` plus checksum `0x120` by -1; the reverse Off→On changed only `34502` from `00→01` plus checksum by +1. Thus firmware 1.10 physically establishes FS3 Recipe offset `34502`, `00=Off`, `01=On`, independently of FS1. Offset `34508`, which changed during the multi-field setup but not during either isolated toggle, remains unknown.

Exact active requested-field observations are:

| Field | Offset | Width | Raw | Canonical |
| --- | ---: | ---: | --- | --- |
| FS RECIPE | 34502 | 1 | `01` | On; `00` is Off |
| Film Simulation | 1997 | 1 | `16` | ACROS |
| White Balance | 34718 | 1 | `00` | Auto |
| High ISO NR | 34724 | 1 | `00` | -4 |
| Clarity | 34730 | 1 | `0B` | +5 |
| Monochromatic WC | 34733 | 1 | `12` | 0 |
| Monochromatic MG | 34739 | 1 | `12` | 0 |
| Dynamic Range | 34745 | 1 | `00` | Auto |
| Sharpness | 34760 | 1 | `08` | -4 |
| Highlight | 34766 | 1 | `0C` | +4 |
| Shadow | 34772 | 1 | `08` | +2 |
| Color Chrome | 34778 | 1 | `00` | Off |
| Color Chrome FX Blue | 34781 | 1 | `00` | Off |
| Grain Strength | 34784 | 1 | `00` | Strong |
| Grain Size | 34787 | 1 | `01` | Large |
| WB Shift R | 34866 | 1 | `01` | 0, slot-scoped FS3 observation |
| WB Shift B | 34872 | 1 | `11` | 0, slot-scoped FS3 observation |

The owner explicitly confirmed Auto WB R0/B0 and FS3 Recipe On in the physical menu. Raw shifts `01`/`11` had different observed meanings in FS2, so the neutral interpretation is scoped strictly to FS3. The final live guarded decoder read passed model `XE5`, format `0x5000`, and exact size 70,524, produced SHA-256 `5331bb49d1982a66214395a29aafbdf1002cae2dc73e4f39e7b8d237062f3c76`, decoded the complete target above, closed, released, and discarded the backup.

The web parser/editor can represent plain ACROS and all three ACROS filter variants, neutral WC/MG, and every requested recipe field. The physical WebUSB client remains read-only: knowing read offsets and two activation flags does not establish a safe backup encoder, full checksum/integrity algorithm, ObjectInfo restore dataset, `SendObjectInfo`/`SendObject` behavior, collateral effects, or persistence. Do not enable physical FS apply from this evidence.

## Public research boundaries

The important public sources and their safe conclusions are:

- ISO 15740 and the USB Still Image specification establish container/session framing, not Fujifilm recipe semantics.
- FilmKit reports WebUSB recipe and D185 behavior, but its available write assumptions are based on other-body research, including an X100VI capture; they are not X-E5 proof.
- FujiSync and `fujifilm-ptp-recipes` gate recipe support on DeviceInfo advertising `0xD18C`. Their public physical write table names X-H2 firmware 5.20 and X-T5 firmware 4.20, not X-E5.
- Filmcase physically tested an X-S10 and describes X-E5 compatibility as likely, not verified.
- `grawji`/`rawji` report the X-E5 70,524-byte backup layout and FS array offsets. Those offsets remain public-research evidence until each is physically correlated with the owner's menus.
- Helios reports X-T5 backup/checksum behavior and a 1,076-byte restore ObjectInfo dataset. Never apply X-T5 offsets or checksum logic to X-E5.
- libfuji confirms USB mode value 6 and handle-zero backup download behavior, plus separate RAW-conversion operations. It does not initialize X-E5 recipe properties or prove X-E5 recipe writes.

The reviewed public projects provide no safe hidden handshake that replaces the `0xD18C` advertisement gate. Reported future write order—film simulation first, D-Range Priority before DR, WB mode before Kelvin/shifts, slot name last—is an unverified research hypothesis for this body.

Public FS research reports these X-E5 guards and array starts:

```text
normalized model XE5; size 70524; checksum u16le at 0x120
film 1991 step 3; Kelvin 34704 step 2; WB mode 34716
High ISO NR 34722; clarity 34728; mono WC 34731; mono MG 34737
DR 34743; color 34752; sharpness 34758; highlight 34764
shadow 34770; Chrome 34776; Blue 34779; grain strength 34782
grain size 34785; Smooth Skin 34788; WB R 34864; WB B 34870
```

Do not patch those offsets, calculate a replacement checksum, or restore a backup merely because guarded read decoding or a volatile diff agrees with some of them.

## Physical-camera safety

Automated tests and Mock X-E5 behavior are never proof that a physical-camera path works. Clearly label public research, fixture behavior, owner menu actions, and observations from the physical X-E5.

The mandatory read-only report has been completed. Later operations still require the owner's explicit approval of a concrete target and exact before/after operation. A broad statement such as “do whatever you need” does not replace the exact-operation review required for an unverified write.

Unless a later exact operation has been separately reviewed and explicitly approved:

- no C1-C6 or C7 recipe/name writes;
- no FS1-FS3 writes;
- no full-backup patch or restore;
- no `SendObjectInfo`, `SendObject`, or `DeleteObject`;
- no object upload, RAW upload, or RAW-conversion trigger;
- no firmware operation;
- no guessed backup offset or property encoding;
- no X-T5 offset or checksum logic applied to X-E5 data;
- no automatic bulk or “apply all slots” action.

The only property mutation allowed in a read-only C1-C7 scan is selecting a slot through `0xD18C` when required to expose it for reading. Read and preserve the original selector, explicitly select every bank, verify each selection, restore the exact original payload in cleanup, and report any restore failure. Tell the owner immediately before this selector operation.

Require the normalized model to be X-E5 and confirm that DeviceInfo advertises `0xD18C` before enabling C-slot actions. Full-backup reads use only `GetObjectInfo(0)` and `GetObject(0)`. Decode FS1-FS3 only after exact model and size guards pass. Never infer an unavailable camera value from a recipe default.

Tell the owner before any physical browser click, USB connect/disconnect or replug, camera menu action, power cycle, `sudo` command, or camera write. Do not run Chromium or the application with `sudo`.

## Sensitive data and local artifacts

- Keep a full camera serial only in volatile memory if required by the active connection.
- Redact the serial before the first log, diagnostic event, screenshot, export, or report boundary.
- Never upload, publish, commit, or include a binary camera backup in a screenshot or report.
- Store a downloaded backup only in IndexedDB or a file explicitly selected by the user.
- Compute backup SHA-256 locally and report only the hash and non-sensitive metadata.
- Volatile before/after characterization must discard both full backups and report only bounded offset changes and hashes.

## Transport and codec expectations

- Use monotonically increasing PTP transaction IDs within a session and symbolic response-code names.
- Preserve raw property payload bytes and widths; do not assume every property is `uint16`.
- Decode only mappings known to this project and expose body-specific or unknown values as passthrough data.
- Handle timeouts, disconnects, endpoint stalls, short containers, transaction mismatches, `DeviceBusy`, and vendor-overloaded `0x200F` responses explicitly.
- Always close a known session when possible and release claimed interfaces on every success and failure path.
- Add focused diagnostics, not broad logs that may expose private data.
- Add or update focused tests for every parser, codec, or binary-layout change.

## Verification and hardware stages

The current source-revision-10 UI intentionally exposes two direct physical read actions after WebUSB discovery: `Read C1-C7 directly`, followed by `Read FS1-FS3 directly`. It has no C/FS menu-review or read-confirmation modal. The direct workflow does not weaken protocol gates: the C action still requires advertised `0xD18C`, exact selector read-back/restoration, a clean session close, and interface release; the FS action still requires a safe completed C scan, normalized X-E5 model, format `0x5000`, exact 70,524-byte length, local-only storage, clean close, and release. Inline copy must continue to warn that the backup can contain the serial. Physical writes and restores remain separately locked and reviewable.

Before making changes, run the existing verification commands and record any pre-existing failure. For a completed implementation change, run at minimum:

```sh
npm ci
npm run verify
npm start
```

Confirm the local baseline at `http://127.0.0.1:4173`, including all six views, Mock X-E5 mode, the exact footer, responsive layouts, and a clean browser console before device connection. Follow `docs/HARDWARE_VALIDATION.md` in order. Do not skip from mock verification to a write test.

Update `docs/PROTOCOL_NOTES.md` only with evidence that states its source class. Physical observations must record camera firmware and non-sensitive raw evidence, and must never include the full serial or backup bytes.

The original mandatory stop remains preserved in `docs/VALIDATION_REPORT_2026-08-02.md`. Later owner-approved characterization belongs in a clearly marked post-stop addendum and does not retroactively turn the original read-only run into a write run.

## Scope and Git hygiene

Keep changes small, justified, and testable. Do not rewrite unrelated functionality or remove existing guards. Do not use destructive Git operations or force push. Do not commit or push until the implementation has been tested locally and the owner has reviewed the result. Commit messages, when later authorized, must be clear and in English.
