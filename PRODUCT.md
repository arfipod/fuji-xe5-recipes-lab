# Product context

## Platform

Fuji X-E5 Recipes Lab is a web application served locally on the user's computer. A later Android client may reuse the data model, but the current surface is a responsive desktop web application.

## User

The primary user is a technically experienced Fujifilm X-E5 owner. They understand camera settings, expect precise terminology, and value recoverability over automation that hides risk.

## Purpose

Fuji X-E5 Recipes Lab turns Fuji X Weekly-style text, URLs, and screenshots into canonical X-E5 recipes. It shows the current camera slot, imported values, and final values side by side; preserves missing-field provenance; creates backups; and, only after staged physical validation and explicit approval, writes through reviewable USB workflows.

## Primary jobs

1. Read C1-C7 and FS1-FS3 from the camera.
2. Paste or import a recipe and see exactly what was detected.
3. Resolve every missing value from the current slot, an X-E5 neutral value, or a manual edit.
4. Choose a destination slot and inspect the full diff.
5. Back up, write, read back, and verify persistence after the relevant write path has been physically validated and approved.
6. Restore the last recoverable state when a restore path has separately been validated and approved.

## Surface mode

Operate. This is a technical workbench, not a marketing page. Density, stable navigation, predictable controls, legible state, and quiet motion take priority over visual spectacle.

## Positioning

A transparent X-E5-only control surface. It does not pretend that inferred values came from the source, does not report a write as successful before read-back and power-cycle verification, and does not mix C-slot PTP, FS backup, and RAW-preview protocols.

## Evidence and trust

- Physical C1-C7 and FS1-FS3 reads run directly from their respective buttons; visible inline warnings and protocol gates replace redundant read-review dialogs.
- Original recipe source text is retained.
- Every field records exact, alias, inferred, missing, current, neutral, edited, or not-applicable provenance.
- A backup is created before any future write review.
- A PTP success code is never treated as sufficient verification.
- Model and backup-size guards protect full-backup operations.
- C7 and FS3 are the recommended laboratory targets for future, separately approved write validation.
- Mock behavior and automated fixtures are never presented as physical-camera evidence.

## Voice

Precise, calm, technical, and direct. Use camera terminology. Explain risk without alarmism. Avoid hype, vague claims, celebratory copy, and anthropomorphic language.

## Constraints

- English-only UI and documentation.
- Local-first data storage.
- No hidden camera write.
- No decorative animation.
- No unverified protocol guesses.
- ISO and exposure compensation remain visible reminders until their X-E5 write paths are verified.
- Camera serial numbers and binary backups are never logged, published, or committed.

## Anti-references

- Generic AI SaaS dashboards.
- Beige editorial surfaces.
- Purple gradients, cyan glow, glassmorphism, and blurred orbs.
- Rounded cards nested inside rounded cards.
- Large marketing headlines, eyebrow copy, and vague calls to action.
- Status-chip soup and decorative motion.
