// @ts-check

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  decodeCSlotProperties,
  describeCSlotProperty,
  PTP_PROP,
} from '../src/camera/x-e5-codecs.js';

/** @param {string} value */
function hexToBytes(value) {
  const compact = String(value ?? '').replaceAll(' ', '');
  if (compact.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(compact)) {
    throw new Error('A physical property contains malformed hexadecimal evidence.');
  }
  return Uint8Array.from(compact.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
}

/**
 * Decode a serial-free physical CLI capture through the maintained X-E5 codec.
 * Raw bytes remain physical evidence. Canonical values are emitted only for
 * exact raw/menu pairs observed on the owner's X-E5 firmware 1.10; every other
 * value remains passthrough.
 *
 * @param {any} capture
 */
export function decodeScanCapture(capture) {
  if (capture?.stage !== 'CLI_C1_C7_SCAN' || capture?.normalizedModel !== 'XE5') {
    throw new Error('Input is not a normalized X-E5 C1-C7 CLI capture.');
  }
  if (!capture.completed || !Array.isArray(capture.slots) || capture.slots.length !== 7) {
    throw new Error('The physical C1-C7 capture did not complete all safety gates.');
  }

  const slots = capture.slots.map((slot) => {
    const properties = new Map();
    for (const item of slot.properties ?? []) {
      if (item?.readStatus !== 'OK') continue;
      const code = Number(item.property?.code);
      const bytes = hexToBytes(item.rawHex);
      properties.set(code, { code, bytes, value: item.rawValue ?? null });
    }
    const canonical = decodeCSlotProperties(properties);
    const name = properties.has(PTP_PROP.PRESET_NAME)
      ? describeCSlotProperty(
        PTP_PROP.PRESET_NAME,
        properties.get(PTP_PROP.PRESET_NAME).bytes,
        canonical,
      ).rawValue
      : null;
    const propertyEvidence = (slot.properties ?? []).map((item) => {
      if (item?.readStatus !== 'OK') {
        return {
          ...item,
          rawEvidenceLevel: 'PHYSICAL_X_E5',
          canonicalEvidenceLevel: 'NOT_DECODED',
        };
      }
      const code = Number(item.property.code);
      const described = describeCSlotProperty(code, hexToBytes(item.rawHex), canonical);
      const hasDecodedValue = described.decoded.some((entry) => entry.status === 'decoded');
      return {
        property: item.property,
        readStatus: item.readStatus,
        rawEvidenceLevel: 'PHYSICAL_X_E5',
        canonicalEvidenceLevel: hasDecodedValue
          ? 'PHYSICAL_X_E5_FW_1_10_EXACT_MENU_OBSERVATION'
          : 'NOT_DECODED_PASSTHROUGH',
        ...described,
      };
    });
    return {
      id: slot.id,
      slot: slot.slot,
      name,
      initializationStatus: 'UNKNOWN_FROM_PTP',
      initializationUncertainty: 'An empty 0xD18D name does not distinguish an initialized custom slot from CREATE NEW. Camera-menu evidence must be reported separately.',
      selector: slot.selector,
      canonical,
      properties: propertyEvidence,
    };
  });

  return {
    stage: 'DECODED_PHYSICAL_XE5_C1_C7',
    model: capture.model,
    firmware: capture.firmware,
    originalSlot: capture.originalSlot,
    originalSelectorRawHex: capture.originalSelectorRawHex,
    rawEvidenceLevel: 'PHYSICAL_X_E5',
    canonicalEvidenceLevel: 'PHYSICAL_X_E5_FW_1_10_EXACT_OBSERVATIONS_ONLY',
    slots,
    cleanup: capture.cleanup,
    completed: true,
  };
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error('Usage: node scripts/decode-ptp-scan.mjs <serial-free-scan.json>');
  const capture = JSON.parse(await readFile(inputPath, 'utf8'));
  process.stdout.write(`${JSON.stringify(decodeScanCapture(capture), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
