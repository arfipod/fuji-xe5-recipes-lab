# Proposed C7 name validation — NOT AUTHORIZED

This document is a plan only. It does not authorize or implement a camera write. Every `SetDevicePropValue` operation below is **NOT AUTHORIZED** until the read-only mandatory-stop report is complete and the owner separately approves the exact populated before/after operation.

The experiment is limited to C7. It must not write C1-C6, FS1-FS3, a full backup, an object, a RAF, or any recipe property from `0xD18E` through `0xD1A5`.

**Current status: BLOCKED BY PHYSICAL EVIDENCE.** After the mandatory stop, the owner initialized C7 directly in the camera menus. The physical menu now displays `CUSTOM 7`, but a fresh read-only scan still returns the empty PTP string `01 00 00` from `0xD18D`. The working hypothesis that `0xD18D` exposes the visible X-E5 slot name is therefore unconfirmed. Do not execute this plan, treat `0xD18D` as name-only, or claim that writing/restoring its empty payload changes the menu label until a separately reviewed characterization establishes its firmware-1.10 semantics.

## Evidence status

- **PTP standard:** `OpenSession` (`0x1002`), `CloseSession` (`0x1003`), `GetDevicePropDesc` (`0x1014`), `GetDevicePropValue` (`0x1015`), `SetDevicePropValue` (`0x1016`), monotonically increasing transaction IDs, response containers, and the PTP string representation.
- **Public research:** Fujifilm property `0xD18C` selects C1-C7 and other implementations describe `0xD18D` as the selected slot name. That description is not an X-E5 firmware-1.10 fact.
- **Physical X-E5 firmware 1.10:** in-session DeviceInfo advertised `0xD18C`, `0xD18D`, and every property through `0xD1A5`. The initial read-only scan observed a two-byte little-endian selector, C7 selector payload `07 00`, and an empty three-byte PTP string (`01 00 00`) from `0xD18D` for every slot. Selector changes needed no fixed delay beyond exact bounded read-back, and the original `01 00` C1 selector was restored. The menu nevertheless showed C1 as `CUSTOM 1` and C7 as `CREATE NEW`, so `0xD18D` alone did not expose either visible label or initialization state.
- **Owner-created C7 and physical read:** after the report, the owner created C7 through the camera menu and entered the target recipe. A later read-only scan found exact matching recipe values and restored the original C7 selector, but `0xD18D` remained `01 00 00` while the menu displayed `CUSTOM 7`. This strengthens the negative evidence against using `0xD18D` as a visible-name or initialization-state field without further proof.
- **Physical X-E5 descriptor result:** `GetDevicePropDesc(0xD18D)` returned `GENERAL_ERROR (0x2002)`, as did `0xD18C` and every recipe property through `0xD1A5`. It therefore established no type, access flag, enum, or name limit.
- **Physical X-E5 pending:** whether `0xD18D` has any effective firmware-1.10 semantics, the accepted payload contract if it does, any true visible-name field, write/read-back behavior, collateral behavior, menu agreement, and power-cycle persistence.

No public-research or fixture result may be promoted to physical X-E5 evidence.

## Blocking prerequisites

Do not request approval for the experiment until all of these are true:

1. A fresh physical X-E5 connection normalizes exactly to `X-E5` and its in-session `DeviceInfo` still advertises `0xD18C` and `0xD18D`.
2. The read-only C1-C7 scan and guarded full-backup/FS1-FS3 read have reached the mandatory stop and the owner has reviewed their report.
3. A fresh C7 snapshot exists locally in canonical JSON and raw-property form for every property from `0xD18D` through `0xD1A5`. It records raw payload bytes, width, decoded value, status, normalization, uncertainty, and the initialized target confirmed in the physical menu. The snapshot contains neither a camera serial nor binary full-backup data.
4. The original selected-slot value and exact raw `0xD18C` payload are known and can be restored.
5. Another separately reviewed fact establishes what `0xD18D` means on this firmware, whether it is safely writable, whether it affects the visible label, and its accepted payload limit. The physical descriptor path cannot supply this evidence because `GetDevicePropDesc(0xD18D)` returned `GENERAL_ERROR`; the initialized-C7 read still returned an empty string. Therefore this plan remains blocked pending a separately reviewed characterization method. Do not infer any missing fact from another Fujifilm body, public research, the current UI `maxlength`, the generic PTP count-byte ceiling, or a successful mock write.
6. The worksheet below contains no placeholder and the owner has explicitly approved its exact candidate text, encoded bytes, property, operation, and target slot.

## Candidate-name rule

The proposed new name must be a deliberately short ASCII string within the physically verified X-E5 limit. Before presenting it for approval:

- remove leading and trailing ASCII whitespace and collapse internal whitespace runs to one space;
- reject NUL, control characters, line breaks, non-ASCII characters, and an empty result;
- never truncate silently; if it exceeds the verified limit, reject it and ask for a shorter name;
- show both the owner's input and the sanitized result;
- encode the approved result as a standard PTP string: one count byte including the terminating code unit, little-endian 16-bit character code units, then `00 00`;
- show the complete encoded payload and byte width before approval.

This conservative ASCII policy is an application safety choice, not evidence of the complete X-E5 character set.

## Exact approval worksheet

Populate this only from physical reads. A placeholder blocks all writes.

```text
Camera model:                  X-E5
Firmware/device version:       1.10
Original selected slot:        C7 at the latest completed scan
Original selector payload:     07 00, width 2 at the latest completed scan
C7 selector payload:           07 00, width 2
Observed 0xD18D value:         empty PTP string; does not match visible CUSTOM 7
Observed 0xD18D payload:       01 00 00, width 3
Owner's candidate input:       <text>
Sanitized candidate:           <ASCII text>
Verified X-E5 name limit:      <characters/code units, with physical evidence>
Candidate PTP-string payload:  <complete hex and width>
Mutation operation:            SetDevicePropValue (0x1016)
Mutation property:             0xD18D, meaning not yet established on X-E5
Expected response:             OK (0x2001), subject to read-back and persistence proof
```

## Operation sequence

Each session uses monotonically increasing transaction IDs and symbolic response names. Any timeout, disconnect, stall, short container, transaction mismatch, `DeviceBusy`, unexpected `0x200F`, selector-restoration failure, or collateral property change stops the experiment. An uncertain write outcome must be resolved by reconnecting and reading; never retry a mutation blindly.

The only proposed mutation calls are `SetDevicePropValue(0xD18C, …)` for temporary C7 selection/restoration and `SetDevicePropValue(0xD18D, …)` for the candidate/original name. **Every one of those calls is NOT AUTHORIZED.** All evidence reads use `GetDevicePropValue(0xD18C)` or `GetDevicePropValue(0xD18D…0xD1A5)`; every sequence ends with `CloseSession` and USB-interface release.

### A. Fresh C7 backup and preflight

1. Open a PTP session.
2. Read `0xD18C` and preserve its exact payload and decoded original selector.
3. If C7 is not selected, the proposed `SetDevicePropValue(0xD18C, physically_verified_C7_payload)` is a **NOT AUTHORIZED WRITE** until the owner explicitly acknowledges this selector change.
4. Wait only for the physically established selector-settle condition.
5. Read `0xD18D` through `0xD1A5`; save the canonical and raw C7 snapshot locally and verify that it agrees with the previously reviewed C7 state.
6. In cleanup, if the selector changed, the proposed `SetDevicePropValue(0xD18C, exact_original_selector_payload)` is a **NOT AUTHORIZED WRITE** until approved as part of this operation. Verify the restored selector by reading `0xD18C`.
7. Close the session and release the USB interface on success or failure.

Do not continue if C7 changed before the experiment, any property is unresolved, or selector restoration is not proven.

### B. Change only the C7 name

1. Open a fresh session and read and preserve `0xD18C`. If C7 is not selected, the required `SetDevicePropValue(0xD18C, physically_verified_C7_payload)` remains a **NOT AUTHORIZED WRITE**.
2. Re-read `0xD18D` and require an exact raw and canonical match with the fresh backup.
3. Display the fully populated worksheet and ask for explicit confirmation of this single mutation.
4. The proposed `SetDevicePropValue(0xD18D, approved_candidate_ptp_string)` is a **NOT AUTHORIZED WRITE** until that confirmation is received.
5. Immediately read `0xD18D`. Require the decoded name, complete raw payload, and payload width to match the approved candidate exactly. `OK (0x2001)` alone is not success.
6. Re-read `0xD18E` through `0xD1A5` and require byte-for-byte agreement with the backup so that no recipe parameter changed.
7. If the selector changed, the cleanup `SetDevicePropValue(0xD18C, exact_original_selector_payload)` remains a **NOT AUTHORIZED WRITE**. Read `0xD18C` to verify restoration, then close the session and release the interface.
8. Ask the owner to confirm the new name in the physical C7 menu. Stop on any mismatch.

### C. First persistence check

1. Release the interface and tell the owner before requesting a camera power cycle.
2. After the owner power-cycles the camera, tell them before requesting the manual Chromium USB-picker reconnection.
3. Reconnect, revalidate the X-E5 identity and capabilities, open a session, and preserve `0xD18C`. If C7 selection is required, `SetDevicePropValue(0xD18C, physically_verified_C7_payload)` remains a **NOT AUTHORIZED WRITE**.
4. Read `0xD18D` through `0xD1A5`. Require the candidate name to persist in both canonical and raw form and every recipe property to remain unchanged.
5. If the selector changed, `SetDevicePropValue(0xD18C, exact_session_start_selector_payload)` remains a **NOT AUTHORIZED WRITE**. Read it back, close the session, release the interface, and ask the owner to confirm the physical menu again.

### D. Restore the original C7 name

This is a second mutation and requires a new explicit confirmation. Approval of the candidate write does not authorize the restoration write.

1. Open a fresh session and preserve the current selector. If C7 is not selected, `SetDevicePropValue(0xD18C, physically_verified_C7_payload)` remains a **NOT AUTHORIZED WRITE**. Verify the current C7 snapshot.
2. Show the exact before/after operation. The after payload must be the byte-for-byte original, well-formed `0xD18D` payload captured in section A; do not reconstruct, normalize, or truncate it.
3. The proposed `SetDevicePropValue(0xD18D, exact_original_name_payload)` is a **NOT AUTHORIZED WRITE** until the owner separately approves it.
4. Immediately read `0xD18D` and require raw and canonical equality with the original snapshot. Re-read `0xD18E` through `0xD1A5` and require that they remain unchanged.
5. If the selector changed, `SetDevicePropValue(0xD18C, exact_session_start_selector_payload)` remains a **NOT AUTHORIZED WRITE**. Read it back, close the session, release the interface, and ask the owner to confirm the restored name in the physical menu.

### E. Second persistence check and stop

Tell the owner before the second power cycle and before the next manual USB-picker connection. After reconnecting, repeat the C7 verification from section C and require the original raw and canonical name to persist, with all recipe properties unchanged. Any required C7 selection and restoration through `SetDevicePropValue(0xD18C, …)` remain **NOT AUTHORIZED WRITES**. Verify restoration, close the session, and release the interface.

Stop here. Only after both name persistence checks succeed may the application propose one reversible C7 recipe parameter as a new, separately reviewed experiment. This plan neither selects nor authorizes that parameter or any further write.

## Operations that remain prohibited

The experiment must not call `SendObjectInfo`, `SendObject`, `DeleteObject`, a backup restore, a RAW upload or conversion trigger, a firmware operation, an FS write, a C1-C6 write, or an automatic apply-all-slots action. It must not log or export a full camera serial or any binary full-backup data.
