# Mandatory read-only X-E5 validation report

Date: 2026-08-02  
Camera: owner's Fujifilm X-E5, firmware/device version 1.10  
Application: source revision `2026-08-02.readonly-hardware.9`  
Host: Linux, Google Chrome 150.0.7871.186, Node.js 20.19.2, npm 9.2.0

This report contains no camera serial and no binary backup bytes. It marks the mandatory stop. No recipe/name write, object send/delete, restore, RAW operation, firmware operation, or C7 experiment was performed.

## 1. Validation outcome

The read-only objective passed:

- maintainable native ES-module source replaced the incomplete opaque bundle;
- the local server, six views, Mock X-E5, responsive layouts, exact footer, and pre-device console baseline passed;
- WebUSB discovered the physical X-E5 in its RAW conversion/backup personality;
- DeviceInfo advertised selector `0xD18C` and every property `0xD18D`-`0xD1A5`;
- the authoritative C scan explicitly selected C1-C7, read back each selector, read all 25 properties per bank, restored C1, closed the session, and released the interface;
- C1 decoded values matched the owner's physical menus; C2-C7 were correctly classified as `CREATE NEW` rather than six recipes;
- a fresh PTP session downloaded handle 0 with only `GetObjectInfo(0)` and `GetObject(0)`, passed model/format/length guards, calculated SHA-256 locally, stored the bytes only in IndexedDB, closed, and released;
- FS1-FS3 film assignments matched the physical menus; `FS RECIPE` was Off for all three, so non-film fields remain latent evidence;
- the application reached `fs-menu-reviewed`, the mandatory read-only stop.

## 2. USB/PTP capabilities

### USB transport

| Field | Physical X-E5 observation |
| --- | --- |
| USB identity | `04CB:0313` |
| USB strings | product `FUJIFILM X-E5`; USB manufacturer string not exposed; DeviceInfo manufacturer `FUJIFILM` |
| Configuration | 1 |
| Interface / alternate | 0 / 0 |
| Class / subclass / protocol | `06/01/01` (still-image PTP) |
| Bulk IN | endpoint `0x81`, 512-byte packets |
| Bulk OUT | endpoint `0x01`, 512-byte packets |
| Interrupt IN | endpoint `0x82`, 24-byte packets |
| Model / normalized model | `X-E5` / `XE5` |
| Firmware/device version | 1.10 |
| Serial | observed only inside volatile transport memory; omitted before all report/log/storage boundaries |
| USB mode property | `0xD16E = 6`, USB RAW CONVERSION/BACKUP RESTORE |

Linux exposed no bound kernel driver for the PTP interface. The current user had read/write access through an ACL. The GVFS gphoto monitor initially claimed the camera and was runtime stopped/masked; no udev rule or `sudo` action was required. If access is later absent, the only recommended rule is `SUBSYSTEM=="usb", ATTR{idVendor}=="04cb", TAG+="uaccess"`.

### DeviceInfo

- Operations: `0x1001`-`0x100B`, `0x1014`-`0x1017`, Fujifilm `0x900C`, `0x900D`, `0x901D`, then `0x100C`, `0x100D` in the camera-advertised order.
- Event codes: none advertised.
- Properties (62): `0x5005`, `0x5015`, `0xD001`, `0xD007`, `0xD008`, `0xD00A`, `0xD00B`, `0xD00C`, `0xD017`, `0xD018`, `0xD01C`, `0xD023`, `0xD029`, `0xD02E`, `0xD030`, `0xD031`, `0xD032`, `0xD041`, `0xD104`, `0xD16E`, `0xD17B`, `0xD183`-`0xD187`, `0xD189`, `0xD18C`-`0xD1A5`, `0xD208`, `0xD20B`, `0xD212`, `0xD21C`, `0xD320`, `0xD321`, `0xD34D`, `0xD36A`, `0xD36B`.
- Capture formats: `0x3801`, `0x3812`, `0x3800`, `0xB103`, `0x380D`.
- Image formats: the capture formats plus settings-backup `0x5000` and RAF `0xF802`.
- `GetDevicePropDesc` physical research: only `0xD041` returned a descriptor; the other 61 advertised properties, including `0xD18C`-`0xD1A5`, returned symbolic `GENERAL_ERROR (0x2002)`. Therefore descriptors did not establish recipe access types, enums, or name limits.

Advertising upload, delete, property-write, RAW, or vendor operations did not authorize them. None was called except the narrowly scoped temporary `SetDevicePropValue(0xD18C)` selections.

## 3. C1-C7 values

The source-revision-9 scan used 196 transactions, TID 0 through 195. All response names were `OK`; transaction metadata was complete and strictly increasing. C1 was restored from observed C7 bytes `07 00` to original bytes `01 00`, verified by read-back at TID 194. `CloseSession` at TID 195 succeeded and the interface was released.

### C1 — saved custom bank

Except for `0xD18D`, every payload below is two bytes. `PASSTHROUGH` means the transport read succeeded but no project mapping is claimed.

| Property | Canonical value | Raw value / bytes | Width | Status / normalization |
| --- | --- | --- | --- | --- |
| `0xD18D` name | empty | `01 00 00` | 3 | OK; camera menu instead displays `CUSTOM 1` |
| `0xD18E` image size | L 3:2 | 7 / `07 00` | 2 | OK |
| `0xD18F` image quality | F | 2 / `02 00` | 2 | OK |
| `0xD190` dynamic range | DR100 | 100 / `64 00` | 2 | OK |
| `0xD191` D-Range Priority | Off | 0 / `00 00` | 2 | OK |
| `0xD192` film simulation | Provia / Standard | 1 / `01 00` | 2 | OK |
| `0xD193` mono warm/cool | not applicable | 0 / `00 00` | 2 | OK |
| `0xD194` mono magenta/green | not applicable | 0 / `00 00` | 2 | OK |
| `0xD195` grain | Strong / Large | 5 / `05 00` | 2 | OK |
| `0xD196` Color Chrome | Weak | 2 / `02 00` | 2 | OK |
| `0xD197` Color Chrome FX Blue | Strong | 3 / `03 00` | 2 | OK |
| `0xD198` Smooth Skin | Off | 1 / `01 00` | 2 | OK |
| `0xD199` white balance | Temperature | 32775 / `07 80` | 2 | OK |
| `0xD19A` WB shift R | -4 | -4 / `FC FF` | 2 | OK; signed identity |
| `0xD19B` WB shift B | +1 | 1 / `01 00` | 2 | OK; signed identity |
| `0xD19C` temperature | 7500 K | 7500 / `4C 1D` | 2 | OK |
| `0xD19D` highlight | -2 | -20 / `EC FF` | 2 | OK; signed value divided by 10 |
| `0xD19E` shadow | -2 | -20 / `EC FF` | 2 | OK; signed value divided by 10 |
| `0xD19F` color | -3 | -30 / `E2 FF` | 2 | OK; signed value divided by 10 |
| `0xD1A0` sharpness | -4 | -40 / `D8 FF` | 2 | OK; signed value divided by 10 |
| `0xD1A1` High ISO NR | -4 | 32768 / `00 80` | 2 | OK; observed nonlinear enum |
| `0xD1A2` clarity | -4 | -40 / `D8 FF` | 2 | OK; signed value divided by 10 |
| `0xD1A3` Long Exposure NR | On | 1 / `01 00` | 2 | OK |
| `0xD1A4` color space | sRGB | 1 / `01 00` | 2 | OK |
| `0xD1A5` body-specific | passthrough | `07 00` | 2 | PASSTHROUGH; meaning unknown |

RAW Recording, JPEG/HEIF selection, Lens Modulation Optimizer, and Mount Adapter Setting were visible in the camera but are not guessed from this property range.

### C2-C7 — `CREATE NEW`

The physical menu showed `CREATE NEW` for all six banks. Each returned the same 25 payloads: empty name `01 00 00`, then `07 00`, `02 00`, `64 00`, `00 00`, `01 00`, `00 00`, `00 00`, `06 00`, `01 00`, `01 00`, `01 00`, `02 00`, `00 00`, `00 00`, `10 27`, four `00 00` values through `0xD1A0`, `00 20`, `00 00`, `01 00`, `01 00`, and `07 00` for `0xD18E`-`0xD1A5`. The name width is 3; all other widths are 2.

These are classified `UNINITIALIZED_RAW_ONLY` with `LATENT_CREATE_NEW` activation status. Their canonical current values are all null. The raw payloads and any provisional decode remain available only as diagnostics and are not inferred as six recipes or filled from defaults.

## 4. Read-only backup and FS1-FS3

The WebUSB backup session used exactly four transactions:

```text
TID 0  OpenSession       -> OK
TID 1  GetObjectInfo(0)  -> OK, format 0x5000, declared size 70524
TID 2  GetObject(0)      -> OK, actual size 70524
TID 3  CloseSession      -> OK
```

Model `X-E5`, normalized model `XE5`, object format `0x5000`, declared/actual/expected length 70,524, session close, and interface release all passed. SHA-256 is `97423cd54d97587d9c52ce1d0e673cbe6466ba8930f2de13deea6b961cdf73ea`. The binary is stored only in local IndexedDB, can contain the serial, and is excluded from this report and the repository.

| Slot | Active value confirmed in menu | FS RECIPE | Latent decoded backup fields (not current settings) |
| --- | --- | --- | --- |
| FS1 | Provia / Standard | Off | Auto DR; grain Off/Large; Chrome/Blue/Smooth Skin Off; Auto WB, R -4/B +1; highlight/shadow/sharpness/NR/clarity 0. Color raw `00` is passthrough; D-Range Priority unavailable. |
| FS2 | Nostalgic Negative | Off | DR100; grain Off/Small; Chrome/Blue/Smooth Skin Off; Auto WB, R 0/B 0; highlight/shadow/sharpness/NR/clarity 0. Color raw `00` is passthrough; D-Range Priority unavailable. |
| FS3 | PRO Neg. Std | Off | Same latent values as FS2. Color raw `00` is passthrough; D-Range Priority unavailable. |

Only the film assignments are active. All non-film raw slices are marked `LATENT_FS_RECIPE_OFF`; no unavailable value is inferred.

## 5. Menu/application mismatches

- `0xD18D` returned an empty PTP string for C1 even though the menu displays `CUSTOM 1`; it also did not distinguish saved C1 from `CREATE NEW` C2-C7.
- At the mandatory stop, the backup had no project-verified FS RECIPE enable-flag offset, so the owner-supplied On/Off menu state was required. The post-stop addendum later maps FS1 only.
- FS Color raw byte `00` lies outside the currently known public layout domain and remains passthrough.
- `0xD1A5`, the C-slot name limit, and name-write behavior on an uninitialized bank remain unknown.
- Fields visible in the C1 menus but outside the verified `0xD18D`-`0xD1A5` mapping were not guessed.

The physically mapped C1 values and FS film assignments otherwise matched the supplied menu evidence.

## 6. Console and transport findings

- Pre-device browser baseline: no console errors, Chrome warnings, failed requests, or horizontal overflow.
- C scan: no response anomaly, timeout, disconnect, stall, short container, transaction mismatch, `DeviceBusy`, or overloaded `0x200F` response.
- Backup: four symbolic `OK` responses, no anomaly, clean close and release.
- Hardware-page console was not attached through DevTools during the owner's interactive WebUSB picker session; the application showed no error modal and the redacted transport error field is null.
- Earlier investigation found `gphoto2 --summary` attempted `SetDevicePropValue(0xD207)` and could leave `SESSION_ALREADY_OPEN`; gphoto was not used for the completed WebUSB stages.

## 7. Files changed

- Removed the incomplete tracked runtime fragments: `.bootstrap/part00`-`part03` and all tracked `bundle/index.html.gz.b64.part-*` files.
- Replaced them with editable runtime source: `index.html`, `src/app.js`, `src/main.js`, `src/styles.css`, and all modules under `src/camera/`, `src/core/`, `src/storage/`, and `src/ui/`.
- Added focused tests under `tests/` and diagnostic/verification scripts under `scripts/`, including `scripts/ptp_usb_lab.py`.
- Added or updated repository context and protocol documents: `README.md`, `PRODUCT.md`, `DESIGN.md`, `AGENTS.md`, `CHANGELOG.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, and all files under `docs/`.
- Updated `.gitignore`, `package.json`, `package-lock.json`, `server.mjs`, and `scripts/verify.mjs` for the source-only runtime and loopback validation endpoint.
- Preserved the unrelated user-owned `.impeccable/` tree. No commit or push was made.

## 8. Verification performed

- Original published revision in isolation: `npm ci` warned about its Node requirement; `npm run verify` and `npm start` failed with truncated-gzip `Z_BUF_ERROR`. No maintainable `src/` tree existed.
- Reconstructed source: `npm ci` passed without warnings or vulnerabilities.
- `npm run verify` passes syntax for 35 JavaScript modules, all 84 unit/integration tests, design-system and accessibility guards, source-presence checks, and source integrity verification.
- `npm start` serves `http://127.0.0.1:4173` without warning.
- `npm run baseline:browser` passes Chrome 150 desktop and 390-pixel layouts, all six views, ten Mock X-E5 slots, exact footer `Made with 💙 by arrf`, and empty console/request warning sets.
- Focused physical-path tests cover framing, response symbols, TID monotonicity, stale sessions, timeouts, disconnects, stalls, short data, transaction mismatches, overloaded `0x200F`, selector restoration, raw widths, serial redaction, exact backup guards, C-bank initialization state, FS activation state, and parser behavior for the proposed Classic Chrome recipe.

## 9. Remaining risks

- Exact C-slot write encodings are not established merely by successful reads; the physical writer remains disabled.
- At the mandatory stop C7 was `CREATE NEW`; the owner later initialized it through the menu. Even in initialized `CUSTOM 7`, `0xD18D` remains empty, so writing it cannot yet be treated as a visible-name-only operation.
- `GetDevicePropDesc(0xD18D)` returned `GENERAL_ERROR`, so the exact X-E5 name length and access contract remain unverified.
- The full-backup checksum/offset research is decode-only; no X-E5 backup patch or restore is authorized.
- The mandatory-stop implementation did not map FS RECIPE or D-Range Priority offsets. The post-stop addendum later maps the FS1 and FS3 Recipe flags independently; FS2 activation and D-Range Priority remain unknown.
- A file-picker export is not implemented; the sensitive backup is intentionally retained only in IndexedDB.
- Owner-menu-created C7 and FS1 persistence is now verified by the post-stop power-cycle reads. Host-side write acceptance, collateral behavior, read-back, and persistence remain completely untested.

## 10. Exact proposed C7 name plan — blocked and not authorized

The proposed candidate is ASCII `XE5 LAB` (7 characters). If and only if separate evidence establishes that `0xD18D` is a visible-name-only field on the X-E5 and that seven characters fit the physical limit, its PTP string would be 17 bytes:

```text
08 58 00 45 00 35 00 20 00 4C 00 41 00 42 00 00 00
```

The currently observed original C7 name payload is the empty three-byte string `01 00 00`; C7 selector bytes are `07 00`; the original selected-slot bytes are `01 00`. The physical menu nevertheless displays initialized `CUSTOM 7`. Therefore the prerequisite in step 4 is currently unmet and no name write may proceed from this plan.

1. Reconnect and revalidate exact model `X-E5`, firmware, DeviceInfo `0xD18C`/`0xD18D`, endpoints, and read-only policy.
2. Read and retain the original selector; explicitly select C7 only after warning and exact approval, read it back, then snapshot `0xD18D`-`0xD1A5` in canonical and raw form.
3. Restore and read back the original selector, close, release, and show the complete C7 backup. Keep C1-C6 untouched.
4. Establish through separately reviewed evidence that `0xD18D` is name-only on `CREATE NEW` and establish the exact name limit. Stop if either remains unknown.
5. Show the precise before/after operation: C7 `0xD18D`, `01 00 00` -> the 17-byte `XE5 LAB` payload above. Require explicit approval of that exact mutation.
6. In a fresh session, preserve the selector, select/read back C7 if required, verify the pre-write snapshot, then perform only `SetDevicePropValue(0xD18D, candidate)`.
7. Require immediate `0xD18D` raw/canonical read-back and re-read `0xD18E`-`0xD1A5` byte-for-byte. `OK` alone is failure to prove success.
8. Restore/read back the original selector, close, release, and ask the owner to verify the C7 name and unchanged recipe state in the menu.
9. Tell the owner before the first power cycle and USB-picker reconnection. Re-read C7 and require name persistence plus unchanged `0xD18E`-`0xD1A5` bytes.
10. Show a second exact operation, candidate -> original `01 00 00`, and require separate approval before restoring the original name.
11. Write only the exact original name payload, immediately read it back, and re-read every recipe property unchanged.
12. Restore/read back the selector, close, release, and ask the owner to verify the restored menu state.
13. Tell the owner before the second power cycle and reconnection. Require the original empty raw name and all recipe bytes to persist.
14. Stop on any timeout, disconnect, stall, short container, transaction mismatch, `DeviceBusy`, overloaded `0x200F`, uncertain mutation result, selector restore failure, name mismatch, collateral byte change, menu mismatch, or persistence failure; never retry an uncertain mutation blindly.
15. Only after both persistence checks succeed may one reversible C7 recipe parameter be proposed as a new, separately approved experiment.

This plan does not authorize C7, C1-C6, FS, object, backup, RAW, or firmware writes. `docs/PROPOSED_C7_WRITE_PLAN.md` remains the controlling detailed plan.

## Post-stop addendum — owner-approved characterization

This addendum does not alter the historical mandatory read-only result above. After reviewing that result, the owner separately approved later C7 and FS1 investigation and manually initialized C7 through the physical camera menus. No host-side recipe/name property, backup restore, object send/delete, RAW operation, or firmware operation was performed.

The owner applied the proposed Classic Chrome target to C7 and supplied physical-menu photographs. A later read-only CLI scan observed selector C7 (`07 00`), explicitly scanned all banks, restored C7, closed the session, and released USB. C7 now physically reads as DR400, Classic Chrome, Grain Strong/Small, Color Chrome Strong, Blue Off, Smooth Skin Off, Temperature WB 5200 K with R +1/B -6, Highlight 0, Shadow -2, Color +2, Sharpness -2, High ISO NR -4, Clarity -2, Long Exposure NR On, and sRGB. The exact property bytes and widths are recorded in `AGENTS.md` and `docs/PROTOCOL_NOTES.md` and covered by focused tests.

Two boundaries remain important:

- `0xD18D` still returned the empty three-byte PTP string `01 00 00` while the physical menu displayed `CUSTOM 7`; it does not currently identify initialization state or the visible label.
- The read establishes firmware-1.10 read mappings only. It does not establish safe programmatic write encodings, order, read-back behavior, or collateral behavior.

The owner also approved a volatile, read-only-before/after FS1 layout characterization, which completed on 2026-08-03. Bidirectional isolated menu toggles established FS1 Recipe byte `34500` as `00=Off` and `01=On` without changing any recipe-value field. Isolated target changes established Color +2 as offset `34752` raw `05` and Sharpness -2 as offset `34758` raw `06`. The final enabled FS1 otherwise matches the C7 target and has SHA-256 `33e024eb465e250405b2586460fb3c01b6e3ee12063e581c36c20da2fc529a2e`; the binary was discarded without output or persistence.

After a later owner-announced physical power cycle, both owner-menu-created targets persisted. A fresh read-only C1-C7 scan returned the exact recorded C7 bytes, restored the original C1 selector by exact `01 00` read-back, closed, and released cleanly. A fresh volatile handle-zero backup decoded FS1 as `ON` with the complete target, passed the X-E5/`0x5000`/70,524-byte guards, and produced SHA-256 `959e3f4042a4218f276ba43023317e39705ab97c85de81736049dbe840a2d2e1`. Its bytes were discarded. The changing whole-backup hash is not treated as a recipe change because every known FS1 field remained exact and unrelated camera state can change. This persistence evidence resulted from owner menu actions, not a host-side PTP write or backup restore.

The owner then configured and enabled an FS2 test target through the physical menu. A guarded volatile backup with SHA-256 `f683d1be5fd9e4198b91aa99eadfb20f97076ad4b22064b4d5a6934a69136200` physically correlated Classic Chrome, 3200 K R +8/B -8, Highlight +2, Shadow +2, Sharpness -1, and High ISO NR -2. The owner confirmed that FS2 displayed DR200 and Color -2; their raw bytes were `03` and `07`, respectively. Because those meanings conflict with provisional shared mappings and separately observed FS1 values, the decoder treats them only as exact FS2 physical observations. FS2 Recipe `On` remains owner-menu evidence because no before-backup was retained to isolate its enable offset. No backup bytes were output or stored, and no restore occurred.

The owner later configured and enabled a neutral plain-ACROS FS3 target. A guarded volatile comparison physically correlated WC0/MG0, DR Auto, Grain Strong/Large, Chrome/Blue Off, Auto WB R0/B0, Highlight +4, Shadow +2, Sharpness -4, NR -4, and Clarity +5. Bidirectional isolated toggles established FS3 Recipe offset `34502`, `00=Off` and `01=On`; each toggle changed only that byte plus checksum `0x120` by the same ±1 delta. The final read decoded FS3 `ON` with the complete target and SHA-256 `5331bb49d1982a66214395a29aafbdf1002cae2dc73e4f39e7b8d237062f3c76`. Raw WB bytes `01`/`11` mean neutral only in this physically observed FS3 state and are not generalized to FS2. The backups remained volatile and no restore occurred.

Checksum `0x120` followed the signed byte delta for the isolated FS1/FS3 flags, Color, and Sharpness transitions, but other unknown integrity bytes changed in some comparisons. This is not a complete checksum algorithm and does not authorize a backup patch or restore. FS2 Recipe enable and FS D-Range Priority offsets remain unknown.
