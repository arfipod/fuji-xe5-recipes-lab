# Product Specification

## Product goal

The primary long-term job is to load a published recipe into the X-E5 or modify a recipe already stored on the camera. A local library is useful, but it is secondary to a fast, understandable, recoverable camera workflow. The initial physical-camera milestone is strictly read-only.

## Target

- Camera: Fujifilm X-E5 only.
- Initial platform: local web application on Linux/Debian.
- Later platform: Android using the same portable JSON concepts.
- User: one owner, local personal use.

## Primary workflow

1. Connect the X-E5 or use Mock mode.
2. Read current values from C1-C7 and, after the guarded backup download succeeds, FS1-FS3.
3. Paste recipe text, enter a Fuji X Weekly URL, or choose an OCR screenshot.
4. Inspect canonical fields, confidence, aliases, missing fields, and source generation.
5. Select a destination such as C4.
6. Compare Current, Imported, and Final values.
7. For every missing field, choose Current Slot or X-E5 Neutral.
8. Optionally edit any accepted final value.
9. Save the recipe to the local library if desired.
10. After the relevant write path has been validated and explicitly approved, review the exact camera diff and automatic backup.
11. Write and immediately read back.
12. Complete power-cycle persistence verification before calling the write successful.

## Input examples

```text
Astia
Dynamic Range: DR200
Highlight: -1
Shadow: -2
Color: +1
Noise Reduction: -3
Sharpening: +1
Grain Effect: Weak
White Balance: Auto
ISO: Auto up to ISO 12800
Exposure Compensation: +1/3 (typically)
```

```text
PRO Neg. Std
Dynamic Range: DR400
Highlight: +2
Shadow: +3
Color: +4
Noise Reduction: -3
Sharpening: 0
Grain Effect: Strong
White Balance: Auto, +5 Red & -3 Blue
ISO: Auto up to ISO 6400
Exposure Compensation: +1/3 (typically)
```

The parser must also accept concatenated Markdown or HTML-derived input where field labels have no line separator.

## Canonical review requirements

Each field stores:

- canonical value;
- original source substring;
- original source label;
- exact, alias, inferred, missing, invalid, or passthrough status;
- confidence;
- notes;
- whether it is writable to the chosen slot type after validation and approval.

The source text must always remain attached to the recipe. A camera read must never fill an unobserved value from a recipe default.

## Editing interaction

- Simple interface rather than a byte-oriented protocol UI.
- Discrete visual scales for tone, color, sharpness, noise reduction, clarity, and monochrome axes.
- Two-dimensional R/B white-balance grid.
- Film simulation, dynamic range, D-Range Priority, effects, grain, and white-balance mode as bounded selectors.
- Non-applicable fields remain visible and disabled with an explanation.
- Current, Imported, and Final columns remain visible together.

## Slot management

- Read all current values with raw observation metadata.
- Open an existing slot without modifying it during initial validation.
- Choose a future destination explicitly.
- Auto-name a future slot from the recipe when possible.
- Back up a slot before a future replacement.
- Keep one latest automatic backup per slot.
- Keep one latest full backup per camera identity.
- Compare before any future restore.
- Never expose C-slot actions unless the camera advertises property `0xD18C`.

Swap, bulk-apply, full-backup restore, and all other multi-slot mutations remain unavailable until separately designed, validated, and approved.

## Shooting reminders

- Parse Auto and fixed ISO, including maximum ISO.
- Parse exposure-compensation ranges and fractions.
- Display both prominently.
- Explain that exposure compensation must be set manually.
- Do not claim that the initial PTP recipe writer stores Auto ISO.

## Library

- Local-only by default.
- Canonical recipe values plus source and provenance.
- Favorites and parent/variant relationships.
- Data model for folders, tags, and an optional reference image.
- JSON import and export for transfer to a later Android application.
- No camera serial or binary backup in source control or diagnostic exports.

## Modes

### Simple mode

Connect, paste, review missing fields, choose a slot, and compare. Write controls stay locked until the relevant hardware-validation gate is complete and the user explicitly approves the operation.

### Advanced mode

Adds symbolic protocol responses, raw property codes and bytes, payload widths, backup hash and size, detailed warnings, and focused diagnostic logs. Serial numbers remain redacted.

## Success criteria for the research phase

- All pure tests pass.
- Mock mode demonstrates the complete non-hardware UX without being presented as camera evidence.
- The application never hides a missing, inferred, normalized, uncertain, or passthrough value.
- The C1-C7 and FS1-FS3 physical read procedures are documented and completed before the mandatory stop.
- The later C7 experiment is documented but not executed without explicit approval.
- No real-camera write is described as validated before immediate read-back, menu comparison, and power-cycle persistence checks succeed.
