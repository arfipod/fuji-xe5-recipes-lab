// @ts-check

/** @param {number} value */
export function packU16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value & 0xffff, true);
  return bytes;
}

/** @param {number} value */
export function packI16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setInt16(0, value, true);
  return bytes;
}

/** @param {number} value */
export function packU32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

/** @param {number} value */
export function packI32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, true);
  return bytes;
}

/** @param {Uint8Array} bytes @param {number} [offset] */
export function readU16(bytes, offset = 0) {
  if (bytes.byteLength < offset + 2) return null;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

/** @param {Uint8Array} bytes @param {number} [offset] */
export function readI16(bytes, offset = 0) {
  if (bytes.byteLength < offset + 2) return null;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt16(offset, true);
}

/** @param {Uint8Array} bytes @param {number} [offset] */
export function readU32(bytes, offset = 0) {
  if (bytes.byteLength < offset + 4) return null;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

/** @param {Uint8Array} bytes @param {number} [offset] */
export function readI32(bytes, offset = 0) {
  if (bytes.byteLength < offset + 4) return null;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset, true);
}

/** @param {...(Uint8Array|ArrayBuffer)} inputs */
export function concatBytes(...inputs) {
  const arrays = inputs.map((input) => input instanceof Uint8Array ? input : new Uint8Array(input));
  const output = new Uint8Array(arrays.reduce((total, array) => total + array.byteLength, 0));
  let offset = 0;
  for (const array of arrays) {
    output.set(array, offset);
    offset += array.byteLength;
  }
  return output;
}

/** @param {string} value */
export function encodePtpString(value) {
  const safe = [...String(value)].slice(0, 254);
  if (!safe.length) return new Uint8Array([0]);
  const output = new Uint8Array(1 + (safe.length + 1) * 2);
  output[0] = safe.length + 1;
  const view = new DataView(output.buffer);
  safe.forEach((character, index) => view.setUint16(1 + index * 2, character.codePointAt(0) ?? 0, true));
  view.setUint16(1 + safe.length * 2, 0, true);
  return output;
}

/**
 * @param {Uint8Array} bytes
 * @param {number} [offset]
 * @param {{ requireExact?: boolean }} [options]
 */
export function decodePtpString(bytes, offset = 0, options = {}) {
  if (!Number.isInteger(offset) || offset < 0 || offset >= bytes.byteLength) {
    throw new Error('PTP string is missing its length byte.');
  }
  const count = bytes[offset];
  if (count === 0) {
    const cursor = offset + 1;
    if (options.requireExact && cursor !== bytes.byteLength) throw new Error('PTP string has trailing payload bytes.');
    return { value: '', offset: cursor };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let value = '';
  let cursor = offset + 1;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 2 > bytes.byteLength) throw new Error('PTP string exceeds payload length.');
    const code = view.getUint16(cursor, true);
    cursor += 2;
    if (index === count - 1) {
      if (code !== 0) throw new Error('PTP string is missing its final NUL terminator.');
    } else {
      if (code === 0) throw new Error('PTP string contains an embedded NUL code unit.');
      value += String.fromCharCode(code);
    }
  }
  if (options.requireExact && cursor !== bytes.byteLength) throw new Error('PTP string has trailing payload bytes.');
  return { value, offset: cursor };
}

/** @param {Uint8Array} bytes @param {number} [limit] */
export function bytesToHex(bytes, limit = bytes.byteLength) {
  const shown = bytes.slice(0, limit);
  const hex = [...shown].map((value) => value.toString(16).padStart(2, '0')).join(' ');
  return bytes.byteLength > limit ? `${hex} … (+${bytes.byteLength - limit} bytes)` : hex;
}

/** @param {Uint8Array} bytes */
export function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

/** @param {string} value */
export function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** @param {Uint8Array} bytes */
export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
