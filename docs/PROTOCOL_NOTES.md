# X-E5 Protocol Notes

## Scope and evidence levels

This document records protocol facts, public interoperability research, automated-fixture behavior, and eventually observations from the owner's physical camera. These evidence classes must never be conflated.

- **PTP standard**: behavior defined by the PTP/USB still-image transport specifications.
- **Public research**: behavior reported by the independent projects listed in `THIRD_PARTY_NOTICES.md`.
- **Fixture only**: behavior exercised by this repository's mocks or automated tests.
- **Physical X-E5 observation**: a result captured from the owner's camera, with firmware and host context, following `docs/HARDWARE_VALIDATION.md`.

As of 2026-08-02, the mandatory read-only run is complete on the owner's X-E5 firmware 1.10. The policy-locked CLI physically completed DeviceInfo research and a transient backup read; WebUSB source revision 9 completed the authoritative C1-C7 scan, guarded IndexedDB backup read, and C/FS physical-menu reviews. Exact physical observations below supersede earlier failed, wrong-USB-personality, and provisional slot-context records; those earlier records remain for diagnostic history. Do not turn a read observation into a write mapping merely because a mock or codec test accepts it.

### Physical X-E5 observation — correct RAW/backup USB personality

After the owner selected `USB RAW CONV./BACKUP RESTORE` with a communication-capable USB power setting and reconnected, DeviceInfo changed from the five-property generic personality to a 367-byte RAW/backup dataset. Physical observations were:

```text
USB identity:       04CB:0313
Configuration:      1
Interface:          0/0, class/subclass/protocol 06/01/01
Bulk IN:            0x81, 512-byte packets
Bulk OUT:           0x01, 512-byte packets
Interrupt IN:       0x82, 24-byte packets
Model/version:      X-E5 / 1.10
USBMode 0xD16E:     6 (USB RAW CONVERSION/BACKUP RESTORE)
Recipe properties:  0xD18C and every code 0xD18D-0xD1A5 advertised
```

The 24-byte interrupt packet and presence of `0xD16E`, `0xD18C`, and the recipe range distinguish this personality from the earlier generic 32-byte-event personality. No hidden vendor initialization was required.

The complete correct-personality DeviceInfo advertised 20 operations: standard `0x1001`–`0x100D` except `0x100E`/`0x100F`, property operations `0x1014`–`0x1017`, Fujifilm `0x900C`, `0x900D`, and `0x901D`, followed by standard `0x100C` and `0x100D` in the camera-provided order. It advertised no event codes. Capture formats were `0x3801`, `0x3812`, `0x3800`, `0xB103`, and `0x380D`; image formats added backup format `0x5000` and RAF format `0xF802` to that set. Advertising a destructive or upload operation is capability evidence only; this project did not call any such operation.

`GetDevicePropDesc` was then attempted read-only for each of the 62 advertised properties in a single bounded session. Only unknown vendor property `0xD041` returned a descriptor: `UINT16`, `GET_SET`, enumeration form, 14-byte dataset. The remaining 61 properties—including `0xD18C` and all of `0xD18D`–`0xD1A5`—returned `GENERAL_ERROR (0x2002)` with a data phase and no usable descriptor dataset. The session continued with monotonically increasing TIDs and closed cleanly. Consequently, descriptor advertisement does not establish a recipe property's type, access, enum, or string-length limit on this body.

### Physical X-E5 observation — C1-C7 scan and menu comparison

WebUSB source revision 8 used monotonically increasing TIDs 0 through 195. It read the original selector as C1, explicitly wrote and read back `0xD18C` for C1 through C7 (`01 00` through `07 00`), read all 25 properties for each slot, restored exact selector bytes `01 00`, read the restoration back, closed the session, and released the interface. All 196 transactions completed without response or transport error. No name or recipe field was written.

An earlier 193-transaction CLI scan skipped the same-value C1 selector write. Its C1 property bytes came from a different live/direct context and its provisional decoding is not mapping evidence. The explicit same-value C1 selector write proved necessary to load the saved-bank property context deterministically, so the maintained CLI and browser now select every slot even when its number equals the current selector.

The owner confirmed C1 as `CUSTOM 1`; C2-C7 were `CREATE NEW`. An empty `0xD18D` string does not distinguish these states, so initialization must not be inferred from the name payload or latent property defaults.

Except for the three-byte empty PTP string from `0xD18D`, every C1 property payload was two bytes. Exact firmware-1.10 C1 raw/menu mappings physically confirmed in this run are:

```text
0xD18E  7       Image Size L 3:2
0xD18F  2       Image Quality F
0xD190  100     DR100
0xD191  0       D Range Priority Off
0xD192  1       Provia / Standard
0xD195  5       Grain Strong / Large
0xD196  2       Color Chrome Weak
0xD197  3       Color Chrome FX Blue Strong
0xD198  1       Smooth Skin Off
0xD199  0x8007  White Balance Temperature
0xD19A  -4      WB shift R -4 (FC FF)
0xD19B  1       WB shift B +1 (01 00)
0xD19C  7500    7500 K
0xD19D  -20     Highlight -2 (EC FF)
0xD19E  -20     Shadow -2 (EC FF)
0xD19F  -30     Color -3 (E2 FF)
0xD1A0  -40     Sharpness -4 (D8 FF)
0xD1A1  0x8000  High ISO NR -4
0xD1A2  -40     Clarity -4 (D8 FF)
0xD1A3  1       Long Exposure NR On
0xD1A4  1       sRGB
```

`0xD193` and `0xD194` were both zero and are not applicable to Provia. `0xD1A5` returned `07 00` and remains passthrough. RAW Recording, JPEG/HEIF selection, Lens Modulation Optimizer, and Mount Adapter Setting were visible in the menu but are not assigned to guessed properties.

C2-C7 each showed `CREATE NEW` in the camera menu and returned the same latent payload set: empty `0xD18D`; then raw values `7, 2, 100, 0, 1, 0, 0, 6, 1, 1, 1, 2, 0, 0, 10000, 0, 0, 0, 0, 0x2000, 0, 1, 1, 7` for `0xD18E` through `0xD1A5`. These bytes are retained with widths and transport status, but they are initialization evidence—not six current recipes. The application requires an explicit physical-menu classification and suppresses canonical current values for every `CREATE NEW` bank.

These observations disprove the previously borrowed X-S10/X-T5-style interpretations for DR, grain, the three effect properties, white balance, tone/color/sharpness, High ISO NR, clarity, and WB shifts. The maintained reader maps only exact observed X-E5 saved-C1 pairs and leaves all other values passthrough. A read mapping is not a write mapping.

### Physical X-E5 observation — owner-created C7 after the mandatory stop

**Evidence class: Owner menu action followed by a physical X-E5 read.** After the owner reviewed the mandatory read-only report, they separately authorized later C7/FS1 research. The owner created C7 through the physical firmware-1.10 menus, disabled Auto Update Custom Setting, entered the Classic Chrome target below, and supplied photographs of all four `EDIT/CHECK` pages. No programmatic recipe/name write was used.

```text
Classic Chrome; Grain Strong/Small; Color Chrome Strong; Blue Off;
Smooth Skin Off; 5200 K with R +1/B -6; DR400; D-Range Priority Off;
Highlight 0; Shadow -2; Color +2; Sharpness -2; High ISO NR -4;
Clarity -2
```

A later policy-locked CLI scan explicitly selected and read every C bank. Its first completed scan lost only the local output-reduction step after USB cleanup; the camera transaction sequence itself completed. A repeat scan completed its report, observed the original selector as C7 (`07 00`), restored exact C7 bytes after scanning, closed the PTP session, and released the interface. It read these exact C7 payloads:

| Property | Bytes | Width | Owner-menu match |
| --- | --- | ---: | --- |
| `0xD18D` | `01 00 00` | 3 | Empty PTP string; visible menu label is `CUSTOM 7` |
| `0xD18E` | `07 00` | 2 | L 3:2 |
| `0xD18F` | `02 00` | 2 | F |
| `0xD190` | `90 01` | 2 | DR400 |
| `0xD191` | `00 00` | 2 | D-Range Priority Off |
| `0xD192` | `0B 00` | 2 | Classic Chrome |
| `0xD193` | `00 00` | 2 | Not applicable |
| `0xD194` | `00 00` | 2 | Not applicable |
| `0xD195` | `03 00` | 2 | Grain Strong / Small |
| `0xD196` | `03 00` | 2 | Color Chrome Strong |
| `0xD197` | `01 00` | 2 | Color Chrome FX Blue Off |
| `0xD198` | `01 00` | 2 | Smooth Skin Off |
| `0xD199` | `07 80` | 2 | White Balance Temperature |
| `0xD19A` | `01 00` | 2 | R +1 |
| `0xD19B` | `FA FF` | 2 | B -6 |
| `0xD19C` | `50 14` | 2 | 5200 K |
| `0xD19D` | `00 00` | 2 | Highlight 0 |
| `0xD19E` | `EC FF` | 2 | Shadow -2 |
| `0xD19F` | `14 00` | 2 | Color +2 |
| `0xD1A0` | `EC FF` | 2 | Sharpness -2 |
| `0xD1A1` | `00 80` | 2 | High ISO NR -4 |
| `0xD1A2` | `EC FF` | 2 | Clarity -2 |
| `0xD1A3` | `01 00` | 2 | Long Exposure NR On |
| `0xD1A4` | `01 00` | 2 | sRGB |
| `0xD1A5` | `07 00` | 2 | Unknown/body-specific passthrough |

These are new exact read mappings for the owner's X-E5 firmware 1.10 and are covered by focused codec tests. They are not programmatic write evidence. The most important negative result is that `0xD18D` stayed empty after C7 became a saved `CUSTOM 7` bank, so it currently proves neither the visible label nor initialization state. Auto ISO and exposure compensation were not mapped to this range and remain outside this physical property observation.

### Physical X-E5 observation — enabled FS1 volatile characterization

**Evidence class: Owner menu actions followed by guarded physical X-E5 reads.** On 2026-08-02/03 the owner enabled FS1 and configured the same Classic Chrome target used for C7. `scripts/ptp_usb_lab.py --after-complete-c-scan fs1-diff-lab` retained each before/after pair only in memory, released USB for every owner menu action, and emitted only hashes and at most 512 changed offsets. Every read required embedded model `XE5`, object format `0x5000`, and exact length 70,524. Every session closed and every interface release succeeded. No binary backup was emitted or persisted.

The first multi-field transition physically corroborated the published FS1 starts for film, Kelvin, WB mode, NR, clarity, DR, shadow, Color Chrome, grain strength/size, and WB shifts. The owner-menu target was then completed with isolated Color and Sharpness changes. The final active FS1 reads:

```text
FS RECIPE On; Classic Chrome; DR400; Grain Strong/Small;
Color Chrome Strong; Blue Off; Smooth Skin Off; 5200 K, R +1/B -6;
Highlight 0; Shadow -2; Color +2; Sharpness -2; High ISO NR -4;
Clarity -2. D-Range Priority was Off in the menu but has no mapped offset.
```

Exact final raw evidence is recorded in `AGENTS.md` and the maintained codec tests. Particularly important controlled observations were:

```text
FS RECIPE On→Off:  offset 34500, 01→00; recipe fields unchanged
FS RECIPE Off→On:  offset 34500, 00→01; recipe fields unchanged
Color target:       offset 34752, 07→05; final menu/canonical +2
Sharpness target:   offset 34758, 04→06; final menu/canonical -2
```

The flag is therefore a bidirectionally verified physical FS1 mapping: `00=Off`, `01=On`. At this stage FS2 and FS3 offsets were not inferred as adjacent bytes. The later FS3 experiment below independently maps FS3 at `34502`; FS2 remains unknown.

For the isolated transitions, checksum field `0x120` changed by the same signed byte delta: -1/+1 for the flag, -2 for Color, and +2 for Sharpness. Offset `63268`, and once `63269`, changed as separate unknown derived/integrity data; earlier multi-field comparisons also changed offsets 264 and 284. These observations do not establish a complete checksum algorithm and do not authorize patching or restore. Final characterization backup SHA-256 was `33e024eb465e250405b2586460fb3c01b6e3ee12063e581c36c20da2fc529a2e`; its bytes were discarded.

### Physical X-E5 observation — post-power-cycle persistence read

**Evidence class: Owner menu actions followed by physical X-E5 read-only verification.** After the owner power-cycled and reconnected the X-E5, a fresh discovery session returned X-E5 firmware 1.10, advertised `0xD18C`, and closed cleanly. A subsequent C1-C7 scan selected each bank only through `0xD18C`, read every property `0xD18D`-`0xD1A5`, and observed the exact previously recorded C7 target bytes. It restored the original C1 selector through exact `01 00` read-back, closed, and released the interface without anomaly.

A new volatile full-backup read then used only `GetObjectInfo(0)` and `GetObject(0)`. It passed normalized model `XE5`, object format `0x5000`, declared/actual/expected length 70,524, and decoded FS1 as `ON` with the complete target, including Color +2 raw `05` and Sharpness -2 raw `06`. SHA-256 was `959e3f4042a4218f276ba43023317e39705ab97c85de81736049dbe840a2d2e1`; the binary was never emitted or persisted and became unreachable at process exit. The session closed and interface release succeeded.

This establishes that the owner-menu-created C7 and FS1 states survived the physical power cycle. The whole-backup hash differs from the earlier characterization hash, but no inference is made from that difference because all known FS1 fields remained exact and unrelated backup state can change. This run contains no host-side recipe write, object send, backup patch, checksum replacement, or restore evidence.

### Physical X-E5 observation — owner-configured FS2 target

**Evidence class: Owner menu action followed by guarded physical X-E5 read-only backup and owner menu confirmation.** The owner enabled FS2 Recipe and configured Classic Chrome, DR200, Highlight +2, Shadow +2, Color -2, Sharpness -1, High ISO NR -2, and Temperature WB 3200 K with R +8/B -8. A later volatile handle-zero read passed exact `XE5`, format `0x5000`, and 70,524-byte guards; SHA-256 was `f683d1be5fd9e4198b91aa99eadfb20f97076ad4b22064b4d5a6934a69136200`. The binary was discarded, and session close/interface release succeeded.

The requested fields read at the published FS2 positions as film `0F`, Kelvin `80 0C`, WB mode `0A`, NR `02`, DR `03`, Color `07`, Sharpness `05`, Highlight `08`, Shadow `08`, WB R `01`, and WB B `11`. The owner separately reconfirmed that the physical menu displayed DR200 and Color -2. Because FS1 had physically associated raw DR `03` with DR400 and a different Color mapping, these FS2 results are intentionally slot-scoped rather than merged into shared enum tables. The maintained JavaScript and CLI decoders now override only these exact FS2 pairs and retain public or passthrough evidence for other values.

No before-backup was retained across the FS2 menu action, so this run cannot isolate the FS2 Recipe flag or checksum/integrity changes. The owner-menu `On` status is valid menu evidence, but the backup activation remains `UNKNOWN_FROM_BACKUP`. At this point FS2 and FS3 flag offsets were unknown; the later isolated experiment below maps FS3 only. No object upload, backup patch, checksum replacement, or restore occurred.

### Physical X-E5 observation — owner-configured neutral ACROS FS3

**Evidence class: Owner menu actions followed by guarded physical X-E5 read-only backup comparisons.** The owner configured plain ACROS, WC0/MG0, DR Auto, Grain Strong/Large, Chrome/Blue Off, Auto WB R0/B0, Highlight +4, Shadow +2, Sharpness -4, High ISO NR -4, and Clarity +5 in FS3. Auto ISO and exposure compensation were excluded because they are separate shooting settings.

The volatile before/after target comparison changed 19 bounded offsets. Requested-field raw observations were film `16`, WB mode `00`, NR `00`, clarity `0B`, mono WC/MG `12`/`12`, DR `00`, sharpness `08`, highlight `0C`, shadow `08`, Chrome/Blue `00`/`00`, grain strength/size `00`/`01`, and WB R/B `01`/`11`. The owner explicitly confirmed that the last pair displayed neutral R0/B0. Because FS2 physically associated `01`/`11` with R+8/B-8, these raw meanings are slot-scoped and must not be generalized.

Two isolated menu toggles then established the activation byte bidirectionally:

```text
FS3 Recipe On→Off: offset 34502, 01→00; checksum 0x120 -1
FS3 Recipe Off→On: offset 34502, 00→01; checksum 0x120 +1
```

No recipe-value field changed in either isolated comparison. Offset `34508` changed during the broad target setup but not during the toggles and remains unknown. Both backups in every pair remained volatile; every session closed and interface released. The final live read decoded FS3 `ON` and the complete target, with SHA-256 `5331bb49d1982a66214395a29aafbdf1002cae2dc73e4f39e7b8d237062f3c76`.

The maintained parser and editor represent plain ACROS plus ACROS+Ye/+R/+G and all requested fields. Physical apply remains blocked because read correlation and activation bytes do not establish safe backup serialization, checksum/integrity generation, restore ObjectInfo, object-send behavior, or persistence.

One interrupted diagnostic left a stale PTP session, and the GVFS gphoto monitor had restarted on the later host session. The monitor was stopped and runtime-masked again; a camera power cycle restored clean access. No speculative close or transaction-ID guess was sent.

### Physical X-E5 observation — transient full-backup read

After the completed C scan, a fresh session performed only:

```text
TID 0  OpenSession       -> OK
TID 1  GetDeviceInfo     -> OK
TID 2  GetObjectInfo(0)  -> OK, format 0x5000, declared size 70524
TID 3  GetObject(0)      -> OK, actual size 70524
TID 4  CloseSession      -> OK
```

The embedded backup model normalized to `XE5`. SHA-256 was computed locally as `08675a7f946e23fab236c89d554d894f4ef2fbadea2bf42127c85266753c3eba`. The binary remained only in volatile process memory and was discarded without being printed or stored.

The published FS film offsets matched the physical menu: FS1 Provia/Standard, FS2 Nostalgic Negative, and FS3 PRO Neg. Std. All three physical `FS RECIPE` switches were Off. Therefore only each film assignment was active; all other decoded FS-array fields were latent and could not be presented as current recipe values. No enable-flag offset was known at this mandatory-stop stage; the later post-stop characterization above maps FS1 only.

### Physical X-E5 observation — guarded WebUSB full-backup replay

After the source-revision-9 C scan and recorded menu classification, the owner separately acknowledged the serial-content warning. The browser reclaimed only the already-authorized device and performed:

```text
TID 0  OpenSession       -> OK
TID 1  GetObjectInfo(0)  -> OK, format 0x5000, declared size 70524
TID 2  GetObject(0)      -> OK, actual size 70524
TID 3  CloseSession      -> OK
```

The previously captured in-session DeviceInfo model and embedded backup model both normalized to `XE5`; object format, declared/actual size, and exact expected size guards all passed. SHA-256 was computed locally as `97423cd54d97587d9c52ce1d0e673cbe6466ba8930f2de13deea6b961cdf73ea`. The binary was stored only in the application's local IndexedDB, omitted from the loopback validation report, never rendered, and never uploaded. Session close and interface release succeeded with no anomaly.

The final in-app menu review recorded FS1 Provia/Standard, FS2 Nostalgic Negative, and FS3 PRO Neg. Std with `FS RECIPE` Off for all three. The application therefore exposes only the three film assignments as active values. It retains every other decoded field slice as `LATENT_FS_RECIPE_OFF`, leaves D-Range Priority unavailable because no offset is known, and preserves the out-of-domain Color byte as passthrough instead of inventing a value.

### Physical X-E5 observation — passive Linux enumeration

Evidence captured without opening a PTP session or sending a camera command:

- `lsusb` identified `04CB:0313` as `FUJIFILM X-E5`.
- `lsusb -t` showed interface 0 as USB Imaging class at 480 Mbit/s with `usbfs` active.
- The device node granted the current unprivileged user read/write access through an explicit ACL; no udev change or `sudo` action was required.
- `gvfsd-gphoto2` had the device node open, and a running image editor retained a redacted gphoto-backed camera reference. This must be released before Chromium can claim the interface.
- Host versions recorded for the run were Google Chrome `150.0.7871.186`, Node.js `20.19.2`, and npm `9.2.0`.

No USB manufacturer/product string exposed through WebUSB, configuration descriptor, endpoint descriptor, DeviceInfo field, firmware value, or recipe property is promoted to physical evidence by this passive enumeration.

### Physical X-E5 observation — sessionless WebUSB/PTP discovery

Evidence captured through the application without opening a PTP session or reading/writing a device property:

```text
USB identity:             04CB:0313
USB manufacturer string: not exposed
USB product string:      FUJIFILM X-E5
Configuration:           1
Interface/alternate:     0/0
Interface class tuple:   06/01/01 (Still Image / PTP)
Bulk IN:                  endpoint 1, 512-byte packets
Bulk OUT:                 endpoint 1, 512-byte packets
Interrupt IN:             endpoint 2, 32-byte packets
DeviceInfo model:         X-E5
DeviceInfo manufacturer:  FUJIFILM
DeviceInfo version:       1.10
```

The sessionless DeviceInfo dataset reported standard version `100`, vendor extension ID `6`, vendor extension version `100`, and vendor extension description `fujifilm.co.jp: 1.0; `. It advertised:

```text
Operations: 0x1001-0x100D, 0x100F, 0x1014-0x1016, 0x101B,
            0x900C, 0x900D, 0x901D, 0x9801-0x9803, 0x9805
Events:     0x4002-0x4006, 0x4008-0x4009
Properties: 0x5001, 0xD041, 0xD303, 0xD406, 0xD407
Capture formats: none
Image formats:   0x3801, 0x3808, 0x3812
```

The full serial was retained only in volatile camera-client memory and is intentionally absent here. Crucially, this **sessionless** DeviceInfo did not advertise recipe selector `0xD18C`, so the application kept C-slot actions disabled. Public implementation behavior suggests Fujifilm may expose a different capability list after `OpenSession`. The first bounded physical confirmation attempt stopped before the in-session `GetDeviceInfo`: Source R4 received `0x2006 PARAMETER_NOT_SUPPORTED` for its transaction-ID-2 `OpenSession` request. That result is tracked as an implementation-framing failure pending a standards-compliant retry; the C-slot gate remains closed.

### Physical X-E5 observation — Source R4 session-opening failure

**Evidence class: Physical X-E5 observation (transport failure).** On 2026-08-02, with X-E5 firmware/device version `1.10` and Chrome `150.0.7871.186` on Linux, source revision `2026-08-02.readonly-hardware.4` produced this redacted, payload-free transaction ledger:

```text
TID 1  GetDeviceInfo  → 0x2001 OK; DeviceInfo data received
TID 2  OpenSession(1) → 0x2006 PARAMETER_NOT_SUPPORTED; no data
```

Source R4 sent `OpenSession` through its generic transaction counter as transaction ID 2 with one session-ID parameter. That framing is an implementation issue pending correction and a fresh standards-compliant physical retest. The response does **not** establish that the X-E5 rejects a correctly framed PTP session. The application released the claimed USB interface after the failure. It read or wrote no device property, selected no C slot, requested or transferred no object, and changed no camera data.

### Physical X-E5 observation — Source R5 stale session

**Evidence class: Physical X-E5 observation (transport/session state).** Source revision `2026-08-02.readonly-hardware.5` retried with standards-compliant framing. Both commands were 16-byte `OpenSession` containers with one nonzero SessionID parameter and transaction ID 0:

```text
Session attempt 1, TID 0  OpenSession → 0x201E SESSION_ALREADY_OPEN
USB communications channel released, closed, reopened, and reclaimed once
Session attempt 2, TID 0  OpenSession → 0x201E SESSION_ALREADY_OPEN
Final cleanup: interface released and device closed
```

The application did not guess the unknown session's next transaction ID and did not send `CloseSession` into it. A post-failure host check found no process holding the X-E5 device node. This evidence establishes that stale session state survived one safe USB-channel reopen on this run; it does not identify which earlier host interaction created that state. No DeviceInfo dataset, device property, selector, or object was accessed, and no camera data changed. The next permitted recovery is an owner-announced physical camera power cycle and USB reconnect, followed by the same read-only discovery sequence.

### Physical X-E5 observation — Source R5 bounded discovery succeeds

**Evidence class: Physical X-E5 observation (read-only DeviceInfo).** After runtime-masking the user-level `gvfs-gphoto2-volume-monitor.service`, confirming that neither it nor `gvfsd-gphoto2` owned the device, and power-cycling/reconnecting the camera, source revision `2026-08-02.readonly-hardware.5` completed this payload-free ledger:

```text
Session 1, TID 0  OpenSession(1) → 0x2001 OK; command length 16, one parameter
Session 1, TID 1  GetDeviceInfo  → 0x2001 OK; data received
Session 1, TID 2  CloseSession   → 0x2001 OK; command length 12, no parameters
```

The camera identified itself as `FUJIFILM X-E5`, normalized model `XE5`, with device version `1.10`. The in-session DeviceInfo dataset was identical to the earlier sessionless capability dataset:

```text
Operations: 0x1001-0x100D, 0x100F, 0x1014-0x1016, 0x101B,
            0x900C, 0x900D, 0x901D, 0x9801-0x9803, 0x9805
Events:     0x4002-0x4006, 0x4008-0x4009
Properties: 0x5001, 0xD041, 0xD303, 0xD406, 0xD407
Capture formats: none
Image formats:   0x3801, 0x3808, 0x3812
```

Property `0xD18C` was not advertised. Per the explicit capability gate, the application did not probe that property, did not start a C-slot scan, did not change a selector, and did not access an object. The full serial remained only in volatile client memory and was omitted at every report boundary. The standards-compliant three-command session completed with no transaction anomaly.

The successful run after suppressing the auto-respawning GVFS monitor and power-cycling is strong evidence that host-side gphoto session interference caused the preceding stale-session responses. It is an inference from the changed host conditions, not a property of the X-E5 protocol. The runtime mask is reversible with `systemctl --user unmask --runtime gvfs-gphoto2-volume-monitor.service` after hardware validation.

Source R6 additionally releases and closes the USB channel immediately after bounded discovery when `0xD18C` is absent, while retaining only redacted DeviceInfo and USB descriptors for review. This cleanup behavior is fixture-verified pending a physical WebUSB R6 replay.

### Physical X-E5 observation — policy-locked Linux CLI

**Evidence class: Physical X-E5 observation (read-only transport and descriptors).** A dependency-free Python/libusb diagnostic repeated the bounded session outside the browser. It never requested the USB serial string and redacted the DeviceInfo serial during parsing. Both discovery runs completed with `OpenSession(0) → GetDeviceInfo(1) → CloseSession(2)`, all responses were `0x2001 OK`, and an immediate host check found no interface owner after process cleanup. USB descriptors and the 259-byte DeviceInfo dataset matched the WebUSB observation exactly.

In a separate bounded session, the CLI requested `GetDevicePropDesc` only for the five property codes advertised by that same session. TIDs were monotonic from 0 through 7, `CloseSession(7)` returned `OK`, and the interface was released:

```text
0x5001 BatteryLevel:               UINT8,  get-only, current 10, range form
0xD303 unknown vendor property:    UINT8,  get-only, value withheld
0xD406 MTP SessionInitiatorInfo:   STRING, get-set,  value withheld
0xD407 MTP PerceivedDeviceType:    UINT32, get-only, current 1
0xD041 unknown vendor property:    UINT16, get-set,  value withheld, enum form
```

Values that could be identifiers or body-specific state were deliberately withheld; dataset widths and type/access metadata were retained. No C-slot property, selector, or object was accessed.

The installed `gphoto2 2.5.28` with `libgphoto2 2.5.31` detected the body only as a generic `USB PTP Class Camera`. `--list-config` exposed the same five properties and no `0xD18C`. No `--get-config` identifier read and no `--set-config` command was run. After `--list-config` exited and no host process owned the interface, the next standards-compliant `OpenSession(0)` received `0x201E SESSION_ALREADY_OPEN`; a physical power cycle was required. This is direct evidence that this gphoto/libgphoto combination can leave stale camera session state on the X-E5 even after its process exits.

Public libfuji source reads Fujifilm `USBMode` property `0xD16E` and maps value 6 to RAW conversion/backup restore. A narrowly locked physical `GetDevicePropValue(0xD16E)` produced no data and returned `0x200A DEVICE_PROP_NOT_SUPPORTED` at TID 2. Cleanup used the next transaction ID, and a subsequent fresh bounded discovery succeeded and closed, confirming usable session/interface state. This does not prove which camera menu mode was active; it establishes only that firmware 1.10 did not serve `0xD16E` in the observed USB personality.

### Public-source comparison — recipe capability gate

**Evidence class: Public research.** The reviewed open implementations do not supply a safe hidden recipe-capability handshake:

- [FilmKit's session implementation](https://github.com/eggricesoy/filmkit/blob/master/src/ptp/session.ts) returns an empty scan when the same-session DeviceInfo omits `0xD18C`.
- [FujiSync](https://github.com/ILFforever/FujiSync) defines `supportsFujiRecipeSlots` as `0xD18C` membership in DeviceInfo and refuses to scan when that gate is false.
- [The community protocol notes](https://github.com/ILFforever/fujifilm-ptp-recipes/blob/main/docs/protocol.md) also require `0xD18C`; their tested-body record contains X-H2 and X-T5 evidence, not X-E5 evidence.
- [Filmcase](https://github.com/gosku/Filmcase) writes the selector without that capability gate, but documents physical testing only on an X-S10 and calls X-E5 compatibility likely rather than verified.
- [libfuji](https://github.com/petabyt/libfuji/blob/master/lib/fuji_usb.c) confirms that a RAW/backup-mode settings download uses standard `GetObjectInfo(0)` followed by `GetObject(0)`. It does not initialize recipe properties.

Consequently, an X-S10/X-T5 assumption is not enough to bypass the X-E5 selector-advertisement gate.

## PTP framing

Every USB PTP container starts with:

```text
u32 little-endian total length
u16 little-endian container type
u16 little-endian operation or response code
u32 little-endian transaction ID
payload
```

Container types:

```text
1 Command
2 Data
3 Response
4 Event
```

Standard operations used by the initial read-only path are:

```text
0x1001 GetDeviceInfo
0x1002 OpenSession
0x1003 CloseSession
0x1008 GetObjectInfo
0x1009 GetObject
0x1015 GetDevicePropValue
```

`SetDevicePropValue` (`0x1016`), `SendObjectInfo` (`0x100C`), `SendObject` (`0x100D`), and `DeleteObject` (`0x100B`) are write or mutation operations and are prohibited during initial validation.

The PTP standard defines `OpenSession` as the transaction-ID-zero exception. Its USB command container is exactly 16 bytes: a 12-byte command header plus one nonzero 32-bit SessionID parameter. After a successful `OpenSession` at TID 0, operations in that session use TIDs 1, 2, and so on without reuse. A later session starts again at `OpenSession` TID 0. `GetDeviceInfo` is legal inside or outside a session; outside a session its TID is also 0. The maintained discovery path now uses the auditable sequence `OpenSession(0) → GetDeviceInfo(1) → CloseSession(2)`.

An unknown stale session is not adopted and its next TID is not guessed. The transport releases/closes and reopens the USB communications channel once, then retries `OpenSession` at TID 0 with a fresh nonzero SessionID. A second `SESSION_ALREADY_OPEN` fails closed and requires owner-directed physical recovery; the implementation does not send a USB class Device Reset.

The diagnostic ledger has a transport-lifetime sequence number and a separate session-attempt sequence because wire transaction IDs legitimately restart. It verifies TID monotonicity inside each session rather than incorrectly requiring global wire-ID monotonicity across sessions. The transport must also validate container length, type, response code, and transaction ID; tolerate USB packet fragmentation without assuming one transfer equals one PTP container; and report short packets, stalls, timeouts, disconnects, and transaction mismatches distinctly.

Expected response codes should be named symbolically in diagnostics. Relevant standard names include:

```text
0x2001 OK
0x2002 GeneralError
0x2003 SessionNotOpen
0x2004 InvalidTransactionID
0x2005 OperationNotSupported
0x2007 IncompleteTransfer
0x2009 InvalidObjectHandle
0x200A DevicePropNotSupported
0x200F AccessDenied
0x2019 DeviceBusy
0x201C InvalidDevicePropValue
```

Public Fujifilm implementations report that `0x200F` can be overloaded in vendor workflows. Diagnostics must therefore retain the operation, phase, parameters, and raw response while displaying a cautious symbolic label such as `AccessDenied (possibly vendor-overloaded)`. It must not be treated as success or retried indefinitely.

## USB and DeviceInfo discovery

The initial physical session must record, without exposing a full serial number:

- vendor ID and product ID;
- manufacturer and product strings when exposed;
- configuration value;
- claimed interface number and its class, subclass, and protocol;
- Bulk IN, Bulk OUT, and optional interrupt/event endpoints;
- endpoint packet sizes;
- the complete DeviceInfo capability lists;
- model and firmware/device version;
- a redacted serial in the report, while retaining the full value only in volatile memory if the transport needs it.

The Fujifilm vendor ID `0x04CB` is public registration information. The product ID, interface, endpoints, and all DeviceInfo values must be observed from the connected camera rather than assumed.

## C1-C7 recipe properties

Public research reports the following property surface:

```text
0xD18C  selected preset slot, reported values 1-7
0xD18D  slot name, reported as a PTP string
0xD18E  image size, passthrough
0xD18F  image quality, passthrough
0xD190  dynamic range
0xD191  D-Range Priority
0xD192  film simulation
0xD193  monochrome warm/cool, reported as value ×10
0xD194  monochrome magenta/green, reported as value ×10
0xD195  combined grain strength/size
0xD196  Color Chrome Effect
0xD197  Color Chrome FX Blue
0xD198  Smooth Skin Effect
0xD199  white-balance mode
0xD19A  WB shift R, reported as signed i16
0xD19B  WB shift B, reported as signed i16
0xD19C  color temperature in Kelvin
0xD19D  highlight, reported as signed value ×10
0xD19E  shadow, reported as signed value ×10
0xD19F  color, reported as signed value ×10
0xD1A0  sharpness, reported as signed value ×10
0xD1A1  High ISO NR, reported as a nonlinear enum
0xD1A2  clarity, reported as signed value ×10
0xD1A3  long-exposure NR, passthrough
0xD1A4  color space, passthrough
0xD1A5  unknown, passthrough
```

The physical scan must first confirm that DeviceInfo advertises `0xD18C`; otherwise C-slot actions remain disabled. For every read, retain the exact payload bytes and width. Do not assume every property is `uint16`, and do not synthesize an unavailable camera value from a recipe default.

### Read-only scan order

1. Open one PTP session and read the current `0xD18C` selector.
2. For C1 through C7, explicitly write only `0xD18C`, including a same-value write for the original slot, then require exact read-back before reading its properties. Physical revision-8 evidence showed that merely observing the selector value did not deterministically load the saved-bank property context.
3. Use exact selector read-back as the settle condition. Add a bounded retry only for an explicit busy response; do not add an unconditional fixed delay.
4. Read `0xD18D` through `0xD1A5`, recording raw bytes, widths, status, decoded values, normalizations, and uncertainty.
5. Restore the original selector in a `finally`-style cleanup path.
6. Close the PTP session and release the interface even after an error.

Changing `0xD18C` is the sole camera property change permitted by the read-only slot scan, and only because the camera exposes one selected slot at a time. The original selection must be preserved and restored.

### Future write-order research — not authorized

Public implementations suggest the following order for a future, explicitly approved C7 experiment:

- select the slot and wait for it to settle;
- write film simulation before dependent fields;
- write D-Range Priority before Dynamic Range;
- avoid writing Dynamic Range while D-Range Priority is active;
- write WB mode, then Kelvin when applicable, then R/B shifts;
- avoid Color writes for color-locked simulations;
- write the slot name last;
- immediately read back and later verify after a power cycle.

These are research assumptions, not physically verified X-E5 behavior.

### Publicly reported value encodings

The tables in this subsection are retained only as other-body/public research for future controlled comparison. They are **not X-E5 read or write mappings**: the physical firmware-1.10 C1 observations above contradict them. The physical writer remains locked and must not use these tables.

Reported grain write values:

```text
1 Off
2 Weak / Small
3 Strong / Small
4 Weak / Large
5 Strong / Large
```

Some cameras reportedly read back an Off state as `6` or `7`. The decoder may describe those as possible Off variants with an uncertainty note, but the initial implementation must preserve their raw values and must not write them.

Reported strength values:

```text
1 Off
2 Weak
3 Strong
```

Reported High ISO NR mapping:

```text
-4 0x8000
-3 0x7000
-2 0x4000
-1 0x3000
 0 0x2000
+1 0x1000
+2 0x0000
+3 0x6000
+4 0x5000
```

Reported D-Range Priority mapping:

```text
Off    0x0000
Weak   0x0001
Strong 0x0002
Auto   0x8000
```

The C-slot representation of `DR Auto` on the owner's X-E5 is unknown. Physical evidence establishes only that saved C1 raw `100` displayed DR100. The project preserves unobserved raw values instead of guessing a read or write meaning.

## X-E5 FS backup layout

Public research reports these guards:

```text
normalized model: XE5
blob size:        70524 bytes
FS slots:         3
checksum field:   u16 little-endian at 0x120
```

Publicly reported X-E5 array starts:

```text
film simulation       1991, slot step 3
WB Kelvin             34704, slot step 2
WB mode               34716
High ISO NR           34722
clarity               34728
mono warm/cool        34731
mono magenta/green    34737
dynamic range         34743
color                 34752
sharpness             34758
highlight             34764
shadow                34770
Color Chrome          34776
Color Chrome Blue     34779
grain strength        34782
grain size            34785
Smooth Skin           34788
WB shift R            34864
WB shift B            34870
```

Physical firmware-1.10 evidence now establishes FS1 Recipe enable at byte offset `34500` and FS3 Recipe enable at `34502`, both with `00=Off` and `01=On`. It does not establish the FS2 enable offset; the missing middle byte must not be guessed.

Public research further reports a checksum update based on the byte-sum delta of patched values. Many FS1 field offsets are now physically corroborated for the exact final target, and isolated changes moved checksum `0x120` by the same delta, but the complete checksum/integrity behavior is still not verified because other derived offsets also changed. These fields may be used only for guarded read-only decoding when the normalized model is X-E5 and the exact reported blob size matches. No patch, checksum change, or restore is authorized. X-T5 offsets and checksum rules must never be applied to an X-E5 blob.

## Full backup object transfer

Public research reports this read sequence for object handle zero:

```text
GetObjectInfo(handle 0)
GetObject(handle 0)
```

The physical read must verify that the received byte length exactly matches ObjectInfo and then compute SHA-256 locally. It must warn that the blob can contain the camera serial. The blob stays in a user-selected file or IndexedDB and is never included in a report or committed.

Public research describes a future restore using `SendObjectInfo` and `SendObject`, including a reported 1076-byte ObjectInfo dataset. That sequence is documented only as research context. `SendObjectInfo`, `SendObject`, backup patching, and restore are explicitly prohibited during initial validation.

## RAW conversion preview

Public research reports a distinct vendor protocol:

```text
Fuji SendObjectInfo 0x900C
Fuji SendObject2    0x900D
Get/Set D185 profile 0xD185
Start conversion     0xD183
GetObjectHandles → GetObject → DeleteObject
```

D185 is a conversion profile and must not be confused with a whole-camera settings backup or C-slot properties. RAW upload, conversion trigger, object deletion, and all related physical-camera operations are prohibited during initial validation.

## Physical X-E5 observations

On 2026-08-02, Chrome `150.0.7871.186` and the policy-locked Linux CLI physically confirmed USB identity `04CB:0313`, configuration 1, PTP interface `0/0` with class tuple `06/01/01`, and Bulk IN/OUT endpoint 1 at 512 bytes. The earlier generic USB personality used Interrupt IN endpoint 2 at 32 bytes and omitted `0xD16E`/`0xD18C`; the correct RAW/backup personality used a 24-byte interrupt endpoint and advertised both properties plus `0xD18D`–`0xD1A5`. The latter completed the read-only C scan and handle-zero backup read documented above. No host-side recipe/name property, object, restore, conversion, or firmware write occurred. After the mandatory stop, the owner did initialize/configure C7 through the physical menus, providing the later read-mapping evidence above.

Add further observations only after completing the relevant checklist in `docs/HARDWARE_VALIDATION.md`. Each observation must include camera firmware, host/Chromium context, exact operation, raw non-sensitive evidence, and whether the camera menu agreed. Never include a full serial number or backup bytes.

## Open hardware questions

- Which camera-side USB power/communication state caused the earlier generic personality, and can the application diagnose it more directly than the endpoint/property signature?
- Which raw C-slot value represents DR Auto, if exposed?
- Which properties, if any, are sequence-sensitive even for reads?
- Does `0xD18D` have any effective slot-name semantics on firmware 1.10? Both initialized C1 and initialized C7 returned an empty PTP string despite visible `CUSTOM 1`/`CUSTOM 7` labels.
- Where, if anywhere, is a visible custom-bank name represented, and what is its verified payload contract and length limit? The failed descriptor and empty initialized-bank reads keep the proposed name experiment blocked.
- Where is the FS2 Recipe enable flag encoded? FS1 `34500` and FS3 `34502` were established independently; the missing middle offset must not be inferred.
- Do any non-film FS offsets decode active menu values when FS RECIPE is On?
- How does the camera use or overload response `0x200F` in each relevant read-only operation?
- Can the browser reproduce the new owner-created C7 read mappings with the same clean restoration/release behavior as the CLI?
- Does the X-E5 expose the reported D185 profile shape? This question is outside the initial read-only validation scope.
