# Interface Design

## Product posture

Fuji X-E5 Recipes Lab is a local technical workbench for one experienced camera owner. It should feel like a precise camera control surface: direct, calm, recoverable, and dense enough to compare evidence without hiding details. It is not a marketing page or a generic dashboard.

## Core proof sequence

The interface should make this sequence visible and reviewable:

1. connected camera identity and firmware;
2. current raw and decoded values for every slot;
3. parser provenance and confidence;
4. Current, Imported, and Final comparison;
5. backup confirmation and exact proposed changes;
6. immediate read-back result;
7. power-cycle persistence result for a first write validation.

Mock and fixture results must be visually identified as such. They must never look like evidence from a physical camera.

## Visual system

- Use a matte black frame, white work field, and neutral grey structure.
- Preserve the black, grey, and white X-E5 visual language across desktop and mobile.
- Do not use gradients, glow, glassmorphism, decorative shadows, blurred shapes, or ornamental animation.
- Keep geometry restrained: compact controls, small radii, clear dividers, and no nested stacks of rounded cards.
- Use a legible system sans-serif for interface text and a system monospace for property codes, raw values, hashes, and logs.
- Keep body text at least 16 px and paragraphs between roughly 45 and 75 characters per line.
- The only incidental color should come from browser-rendered external imagery or the heart emoji in the required footer.

## Layout and navigation

Camera, Import/Edit, Library, Backups, RAF Preview, and System are stable top-level views. Desktop layouts may use persistent navigation and multi-column comparisons. Narrow layouts should stack the same information without hiding safety state, raw evidence, or the primary action context.

Current, Imported, and Final values should remain easy to compare. Diagnostics should use compact tables with stable columns for property, canonical value, raw payload, width, status, and uncertainty. Long logs and advanced protocol data should be available on demand without flooding the default workflow.

## Controls and state

- Use camera terminology and bounded controls for known enums and ranges.
- Keep non-applicable fields visible but disabled with an explanation.
- Distinguish missing, inferred, normalized, uncertain, passthrough, mock, and physically verified values.
- Separate read actions from future mutation actions.
- Run guarded C1-C7 and FS1-FS3 reads directly from clearly labelled buttons; keep their selector behavior and sensitive-backup warning visible inline instead of adding read-review modals.
- Mutation controls remain locked until the relevant hardware gate and explicit confirmation are complete.
- Show an exact before/after diff before any future write; a success response alone must never become a success state.

## Accessibility and motion

- Provide a keyboard skip link, semantic landmarks, and `aria-current` for active navigation.
- Maintain clear visible focus states and sufficient monochrome contrast.
- Do not depend on color alone for status.
- Respect `prefers-reduced-motion`; transitions should be brief and functional when present.
- Touch targets and stacked mobile layouts must remain usable without sacrificing diagnostic content.

## Voice and required mark

All UI and documentation are in English. Copy is precise, technical, and calm. Avoid hype, vague calls to action, celebratory success language, and anthropomorphic status messages.

Every application view preserves the footer text exactly:

```text
Made with 💙 by arrf
```
