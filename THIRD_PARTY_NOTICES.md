# Third-Party Notices and Research References

Fuji X-E5 Recipes Lab is an independent MIT-licensed implementation. It does not vendor Fujifilm applications, Fujifilm SDK binaries, XApp data, or source code from the projects below.

The implementation uses publicly documented interoperability facts: PTP operation and property identifiers, value encodings observed on cameras, reported binary layout offsets, and transfer sequences. Public research is not evidence that a behavior has been verified on the owner's physical X-E5. The following projects were important research references.

## PTP and USB still-image specifications

- ISO 15740 current-edition metadata: https://www.iso.org/standard/63602.html
- USB-IF Still Image Capture Device Definition 1.0: https://www.usb.org/document-library/still-image-capture-device-definition-10-and-errata-16-mar-2007
- Relevant facts: `OpenSession` uses transaction ID 0 and exactly one nonzero SessionID parameter; subsequent transaction IDs increase within that session; the USB bulk container serializes the transaction ID but not a separate SessionID header field.

## libmtp

- Source: https://android.googlesource.com/platform/external/libmtp/+/master/src/ptp.c
- License: LGPL-2.1-or-later
- Relevant independent implementation evidence: explicit SessionID/transaction-ID reset for `OpenSession` and per-session transaction sequencing.
- No libmtp source code is copied or vendored in this project.

## FilmKit

- Repository: https://github.com/eggricesoy/filmkit
- License: MIT
- Relevant work: WebUSB PTP framing, C1-C7 property mapping, value encodings, write/read-back flow, and the D185 conversion profile.

## FujiSync and fujifilm-ptp-recipes

- Repositories:
  - https://github.com/ILFforever/FujiSync
  - https://github.com/ILFforever/fujifilm-ptp-recipes
- License: MIT
- Relevant work: Android USB Host implementation, timing experiments, D-Range Priority mapping, camera compatibility reports, and robust read/write diagnostics.

## grawji and rawji

- Repositories:
  - https://github.com/p5k369/grawji
  - https://github.com/pinpox/rawji
- Licenses: GPL-3.0-or-later
- Relevant public research: reported X-E5 USB identity and RAW-conversion support, reported X-E5 FS1-FS3 full-backup offsets and checksum behavior, and the backup transfer workflow.
- No GPL source code is copied or vendored in this MIT project.

## Helios Fujifilm research

- Repository path: https://github.com/KyleOndy/dotfiles/tree/main/nix/pkgs/helios
- Relevant work: whole-camera backup transport, official-tool capture methodology, a reported 1076-byte restore ObjectInfo dataset, and checksum and per-slot mapping research on the X-T5.
- X-T5 offsets and checksum rules are not X-E5 facts and must never be applied to an X-E5 backup.

## libfuji and fp

- Repositories:
  - https://github.com/petabyt/libfuji
  - https://github.com/petabyt/fp
- Relevant work: Fujifilm PTP constants, RAW upload and processing flow, backup object transport, and FP and D185 format research.

## Fujisan, Filmcase, fujinx, and Latent

- Repositories:
  - https://github.com/rachelkd/fujisan
  - https://github.com/gosku/Filmcase
  - https://github.com/calder/fujinx
  - https://github.com/formray/latent
- Relevant work: independent protocol implementations, tests, documentation, model behavior, and safety patterns.

## Trademarks and content

Fujifilm, X-E5, Provia, Velvia, Astia, ACROS, Eterna, Classic Chrome, Reala Ace, and other camera or simulation names are trademarks of their respective owners. Fuji X Weekly recipes remain the work of their respective authors. This tool stores only user-supplied or explicitly imported source text and canonical settings.
