# Portable JSON Format

## Envelope

```json
{
  "format": "fuji-xe5-recipes-lab",
  "formatVersion": 1,
  "exportedAt": "2026-08-01T00:00:00.000Z",
  "exportedBy": "Fuji X-E5 Recipes Lab",
  "recipes": [],
  "slotBackups": [],
  "fullBackups": []
}
```

Version 1 is designed to be readable by a future Android implementation without reproducing browser storage internals.

## Canonical recipe

A recipe contains:

- a stable ID and schema version;
- a display name and optional parent recipe ID;
- source generation and confidence;
- retained original source text, URL, or image name;
- one canonical `values` object;
- one metadata object per field;
- parser warnings;
- library metadata.

Example field metadata:

```json
{
  "status": "alias",
  "confidence": 0.95,
  "sourceText": "Noise Reduction: -3",
  "sourceLabel": "Noise Reduction",
  "alias": "Noise Reduction",
  "notes": []
}
```

## Canonical values

Writable recipe fields, after their transport paths are physically validated and explicitly approved, include:

```text
filmSimulation
dynamicRange
dRangePriority
grainStrength
grainSize
colorChrome
colorChromeBlue
smoothSkin
whiteBalanceMode
whiteBalanceKelvin
wbShiftR
wbShiftB
highlight
shadow
color
sharpness
highIsoNr
clarity
monoWarmCool
monoMagentaGreen
```

Shooting reminders include:

```text
isoMode
isoFixed
isoMin
isoMax
exposureMinEv
exposureMaxEv
exposureTypical
```

## Raw camera observations

A read result must not be reconstructed from recipe defaults. Each observed property should preserve:

- property code;
- raw payload bytes;
- payload width;
- canonical decoded value, when a project mapping is known;
- read status;
- normalization or uncertainty notes.

Unknown and body-specific values remain passthrough observations.

## Backups

C-slot backups retain canonical values and raw property bytes encoded as Base64. Full settings backups may be stored only in IndexedDB or a file selected by the user. They can contain the full camera serial number and other private metadata, so they must never be logged, included in reports, uploaded, or committed.

The current read-only application deliberately excludes full-backup bytes from portable JSON exports and rejects any portable envelope containing `fullBackups`. Full backups remain only in IndexedDB or a file explicitly selected by the user. Reports contain only non-sensitive model/length/hash/decode evidence, never a serial or backup bytes.

The active importer validates:

- envelope format and version;
- recipe schema version;
- required canonical keys;
- array shape for recipes and local slot snapshots;
- that no portable full backup is included during the read-only stage.

Any separately reviewed future full-backup importer must add strict Base64, normalized X-E5 model, exact length, hash, and restore-time guards before such an envelope is accepted. Those paths are intentionally not implemented in the current stage.

## Compatibility policy

Unknown envelope versions must be rejected rather than guessed. Future migrations should be explicit and tested with fixtures shared by Linux and Android. A fixture or mock is not a physical X-E5 observation.
