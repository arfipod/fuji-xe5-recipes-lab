// @ts-check

const SENSITIVE_KEY = /serial|cameraKey|deviceId/i;
const FORBIDDEN_BINARY_KEY = /^(?:backupBytes|bytesBase64|blob)$/i;
const FULL_BACKUP_ROOT_BYTES_KEY = /^(?:bytes|data|payload|rawBytes|arrayBuffer)$/i;
const MAX_DEPTH = 12;

/**
 * Build a JSON-safe, redacted snapshot for the loopback-only validation
 * endpoint. PTP payload bytes are retained as width + hexadecimal evidence;
 * full-backup bytes are never part of the input selected by this function.
 *
 * @param {Record<string, any>} state
 */
export function buildValidationSnapshot(state) {
  return sanitizeValidationValue({
    generatedAt: new Date().toISOString(),
    sourceRevision: state.sourceRevision ?? null,
    validationStage: state.validationStage ?? 'unknown',
    readFlow: 'direct-guarded',
    transportError: state.lastTransportError ?? null,
    connection: state.connection ?? null,
    discovery: state.discovery ?? null,
    cSlotScan: state.scanReport ?? null,
    fullBackup: omitFullBackupRootBytes(state.backupReport),
  });
}

/**
 * Whole-backup bytes are prohibited at the fullBackup report root. Nested FS
 * field slices remain eligible for width + hex evidence after guarded decode.
 *
 * @param {any} report
 */
function omitFullBackupRootBytes(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return report ?? null;
  const safe = {};
  for (const [key, value] of Object.entries(report)) {
    if (FULL_BACKUP_ROOT_BYTES_KEY.test(key) || FORBIDDEN_BINARY_KEY.test(key)) continue;
    safe[key] = value;
  }
  return safe;
}

/** @param {any} value @param {number} [depth] @param {WeakSet<object>} [seen] */
export function sanitizeValidationValue(value, depth = 0, seen = new WeakSet()) {
  if (depth > MAX_DEPTH) return '[depth limit]';
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return payloadEvidence(value);
  if (value instanceof ArrayBuffer) return payloadEvidence(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) return payloadEvidence(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  if (value instanceof Error) return { name: value.name, code: value.code ?? null, message: value.message };
  if (Array.isArray(value)) return value.map((item) => sanitizeValidationValue(item, depth + 1, seen));
  if (value instanceof Map) return [...value.values()].map((item) => sanitizeValidationValue(item, depth + 1, seen));
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key) || FORBIDDEN_BINARY_KEY.test(key)) continue;
    output[key] = sanitizeValidationValue(item, depth + 1, seen);
  }
  seen.delete(value);
  return output;
}

/** @param {Uint8Array} bytes */
function payloadEvidence(bytes) {
  return {
    payloadWidth: bytes.byteLength,
    rawHex: [...bytes].map((value) => value.toString(16).toUpperCase().padStart(2, '0')).join(' '),
  };
}
