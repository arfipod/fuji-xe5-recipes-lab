# Changelog

## Unreleased — maintainable read-only hardware validation

- Replaced the C-slot scan, C menu review, sensitive-backup acknowledgement, and FS menu review dialogs with two direct guarded read actions; retained all capability, selector-restoration, model/format/size, local-storage, cleanup, serial-redaction, and physical-write locks.
- Replaced the corrupt opaque application bundle with maintainable source modules, tests, documentation, static HTML, and CSS.
- Added six responsive English views while preserving the monochrome X-E5 control-surface design and exact project footer.
- Split physical USB discovery, C1-C7 scanning, and full-backup reading into explicit read-only stages.
- Added raw PTP payload widths, passthrough diagnostics, capability gates, serial redaction, and local-only backup handling.
- Added payload-free PTP transaction ledgers with symbolic operation/response names, monotonic-ID checks, and selector read-back evidence.
- Corrected `OpenSession` to use the standards-required transaction ID 0, with per-session monotonic IDs and a separate transport-lifetime diagnostic cursor.
- Recorded the redacted physical Source R4 `OpenSession` framing failure and confirmed post-failure interface release; no property or object access occurred.
- Recorded the standards-compliant physical Source R5 stale-session response across one bounded USB-channel reopen; cleanup succeeded and no camera data was accessed.
- Recorded the successful physical Source R5 bounded discovery after the GVFS gphoto monitor was runtime-masked and the camera was power-cycled; the in-session X-E5 DeviceInfo still omitted `0xD18C`, so no property or object access followed.
- Added a serial-redacting, policy-locked Linux libusb/PTP CLI and focused parser/transaction tests for repeatable hardware research without browser permission prompts.
- Distinguished the generic five-property USB personality from the correct RAW/backup personality, which physically advertises `0xD16E`, `0xD18C`, and the complete `0xD18D`–`0xD1A5` recipe range.
- Physically completed a 193-transaction C1-C7 scan with exact selector read-back, original-C1 restoration, clean session close, and interface release.
- Superseded the provisional skipped-C1 context with an authoritative 196-transaction WebUSB scan that explicitly selected C1-C7, including a same-value C1 write, before reading each bank.
- Recorded C1 as a saved custom bank and C2-C7 as `CREATE NEW`; uninitialized-bank payloads remain raw latent evidence and are no longer presented as current recipes.
- Fixed menu-review confirmation readiness so completing the notes field last immediately enables the local record action without requiring another field change.
- Completed the guarded WebUSB handle-zero backup read with exact X-E5/format/70,524-byte checks, local IndexedDB storage, SHA-256, clean close/release, and zero anomalies.
- Recorded the physical FS1-FS3 menu comparison with FS RECIPE Off for all three, exposing only the film assignments and reaching the mandatory read-only stop.
- Added firmware-1.10 X-E5 mappings only where raw C1 values were compared with the owner's menus; all unobserved values remain passthrough evidence.
- Recorded the separately approved, owner-created C7 Classic Chrome characterization after the mandatory stop, including all exact `0xD18D`-`0xD1A5` payloads, menu comparisons, selector restoration, and the finding that initialized C7 still returns an empty `0xD18D` string.
- Added exact firmware-1.10 C7 read mappings and a focused full-target codec test without promoting the observations to programmatic write evidence.
- Added a guarded FS1 before/after laboratory mode that keeps both 70,524-byte backups only in volatile memory and reports bounded changed offsets and hashes.
- Physically established FS1 Recipe activation byte `34500` bidirectionally (`00=Off`, `01=On`) without assuming adjacent FS2/FS3 offsets, and taught the guarded decoder/UI to expose only that verified flag.
- Completed the enabled FS1 Classic Chrome target and physically correlated its final raw fields, including Color +2 at offset `34752` raw `05` and Sharpness -2 at offset `34758` raw `06`.
- Verified after a physical power cycle that the owner-menu-created C7 and enabled FS1 targets persisted: C7 matched all 25 PTP property payloads, FS1 matched every guarded backup field, and both read-only sessions closed and released cleanly.
- Recorded the owner-configured FS2 test target and added exact slot-scoped physical mappings for DR200 raw `03` and Color -2 raw `07`, without guessing the still-unknown FS2 Recipe enable offset or promoting read evidence to a backup-write contract.
- Added a generalized volatile FS-slot comparison mode, captured the owner-configured neutral ACROS FS3 target, established FS3 Recipe offset `34502` bidirectionally, and added slot-scoped neutral-WB decoding plus parser/UI tests while keeping physical FS restore disabled.
- Recorded that checksum `0x120` follows isolated flag/Color/Sharpness byte deltas while other derived offsets remain unknown, so backup patch/restore stays prohibited.
- Restored `AGENTS.md` as the comprehensive evidence-labeled research and safety handoff for future agents.
- Physically completed a transient `GetObjectInfo(0)`/`GetObject(0)` backup read with exact X-E5 model and 70,524-byte guards, local SHA-256, no binary output, and clean release.
- Confirmed FS1 Provia, FS2 Nostalgic Negative, and FS3 PRO Neg. Std from the physical menu, and made the UI treat non-film FS fields as latent when the physical `FS RECIPE` switch is Off.
- Made advertised-property descriptor research continue after symbolic PTP failures; the physical X-E5 returned a descriptor only for `0xD041` and `GENERAL_ERROR` for all 61 others, including the entire recipe range.
- Recorded that `gphoto2 --summary` attempted `SetDevicePropValue(0xD207)` and that gphoto could leave a stale PTP session; it is not used for the remaining staged validation.
- Compared FilmKit, FujiSync, community protocol notes, Filmcase, and libfuji source, while keeping public mappings distinct from firmware-1.10 physical X-E5 observations.
- Release the idle WebUSB interface after discovery when the mandatory `0xD18C` advertisement gate remains closed, retaining only redacted diagnostics for review.
- Release the USB interface after the C scan, reclaim it only inside the separately acknowledged backup read, and release it again before menu review.
- Added explicit C1-C7 and FS1-FS3 physical-menu review records before the mandatory read-only stop.
- Disabled portable full-backup JSON import during read-only validation rather than accepting unvalidated sensitive bytes.
- Locked physical camera writes, restores, object sends/deletes, and RAW conversion until a separately approved validation stage.

## 0.1.0 — X-E5 instrument-panel UI

- Rebuilt the application interface around a matte black, neutral grey, and white X-E5-inspired visual system.
- Replaced generic dashboard patterns with a compact operational hierarchy.
- Added responsive desktop and narrow-screen layouts.
- Preserved the Camera, Editor, Library, Backups, RAF Preview, and System workflows.
- Published the local Node runtime and checksum-verified self-contained application bundle.
- Added integrity verification and GitHub Actions CI.
- Retained explicit safety gates around experimental physical-camera writes.
