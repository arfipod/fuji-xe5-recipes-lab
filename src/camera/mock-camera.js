// @ts-check

import { neutralRecipeValues } from '../core/schema.js';
import { sha256Hex } from './binary.js';
import {
  X_E5_FS_LAYOUT,
  decodeFsSlots,
  patchFsSlot,
} from './x-e5-codecs.js';

/**
 * In-memory camera used for UI development and automated demonstrations.
 * It follows the same public method shape as Xe5CameraClient without touching
 * USB hardware.
 */
export class MockXe5CameraClient {
  /** @param {{ logger?: (message: string, detail?: any) => void }} [options] */
  constructor(options = {}) {
    this.logger = options.logger ?? (() => {});
    this.connected = false;
    this.cSlots = createMockCSlots();
    this.backup = createMockBackup();
  }

  static isSupported() { return true; }

  async connect() {
    this.connected = true;
    this.logger('Mock X-E5 connected');
    return this.getConnectionInfo();
  }

  async disconnect() {
    this.connected = false;
  }

  getConnectionInfo() {
    return {
      connected: this.connected,
      model: 'X-E5 (Mock)',
      firmware: 'LAB-0.1',
      vendorId: 0x04cb,
      productId: 0x0313,
      connectedAt: this.connected ? new Date().toISOString() : null,
      supportsPresetProperties: true,
      mock: true,
    };
  }

  async readAllSlots() {
    this.assertConnected();
    return {
      cSlots: structuredClone(this.cSlots),
      fsSlots: decodeFsSlots(this.backup),
      backupError: null,
    };
  }

  /** @param {number} index */
  async readCSlot(index) {
    this.assertConnected();
    const slot = this.cSlots[index - 1];
    if (!slot) throw new Error(`Mock slot C${index} does not exist.`);
    return structuredClone(slot);
  }

  /** @param {number} index @param {string} name @param {Record<string, any>} values */
  async writeCSlot(index, name, values) {
    this.assertConnected();
    const before = await this.readCSlot(index);
    const after = {
      ...before,
      name: name || `C${index}`,
      values: structuredClone(values),
      readAt: new Date().toISOString(),
    };
    this.cSlots[index - 1] = after;
    this.logger(`Mock C${index} written`, values);
    return {
      before,
      after: structuredClone(after),
      responseLog: [],
      warnings: [],
      verification: { ok: true, checked: 18, mismatches: [] },
      requiresPowerCycleVerification: true,
    };
  }

  async readFullBackup() {
    this.assertConnected();
    return {
      bytes: new Uint8Array(this.backup),
      model: 'X-E5',
      size: this.backup.byteLength,
      sha256: await sha256Hex(this.backup),
      createdAt: new Date().toISOString(),
    };
  }

  /** @param {number} index @param {Record<string, any>} values */
  async prepareFsWrite(index, values) {
    const before = await this.readFullBackup();
    const patched = patchFsSlot(before.bytes, index - 1, values);
    return {
      before,
      target: { bytes: patched.blob, sha256: await sha256Hex(patched.blob) },
      changes: patched.changes,
      warnings: patched.warnings,
    };
  }

  /** @param {Uint8Array} bytes */
  async restoreFullBackup(bytes) {
    this.assertConnected();
    this.backup = new Uint8Array(bytes);
    this.connected = false;
    this.logger('Mock full backup restored');
    return {
      accepted: true,
      requiresPowerCycle: true,
      note: 'Mock camera disconnected to emulate a required power cycle.',
    };
  }

  /** @param {number} index @param {Record<string, any>} expected */
  async verifyFsSlotAfterReconnect(index, expected) {
    this.connected = true;
    const backup = await this.readFullBackup();
    const slot = decodeFsSlots(backup.bytes)[index - 1];
    const mismatches = [];
    for (const [key, value] of Object.entries(expected)) {
      if (slot.values[key] !== value && value !== null && slot.values[key] !== null) mismatches.push({ key, expected: value, actual: slot.values[key] });
    }
    return { backup, slot, verification: { ok: mismatches.length === 0, checked: Object.keys(expected).length, mismatches } };
  }

  /** @param {ArrayBuffer} _raf @param {Record<string, any>} values @param {{ exposureEv?: number }} [options] */
  async renderRafPreview(_raf, values, options = {}) {
    this.assertConnected();
    const label = `${values.filmSimulation ?? 'Unknown'} · DR ${values.dynamicRange ?? '—'} · EV ${options.exposureEv ?? 0}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#d8b08c"/><stop offset="1" stop-color="#41556b"/></linearGradient></defs><rect width="1400" height="900" fill="url(#g)"/><circle cx="1030" cy="300" r="170" fill="#f4d8b0" opacity=".72"/><path d="M0 720 C300 560 520 780 820 610 C1040 485 1210 565 1400 470 V900 H0Z" fill="#273b38" opacity=".78"/><text x="70" y="95" font-family="system-ui" font-size="38" fill="white">Mock camera-processor preview</text><text x="70" y="150" font-family="system-ui" font-size="25" fill="white" opacity=".88">${escapeXml(label)}</text></svg>`;
    return new Blob([svg], { type: 'image/svg+xml' });
  }

  assertConnected() {
    if (!this.connected) throw new Error('The mock X-E5 is not connected.');
  }
}

function createMockCSlots() {
  const names = ['Vintage Eterna', 'Superia 100', 'Fujicolor NPH', 'PRO Neg. Std', 'Portra 160', 'Portra 400', 'Lab Slot'];
  const films = ['Eterna', 'ClassicNeg', 'NostalgicNeg', 'ProNegStd', 'ClassicChrome', 'ClassicChrome', 'Provia'];
  return names.map((name, index) => {
    const values = neutralRecipeValues();
    values.filmSimulation = films[index];
    values.dynamicRange = index % 2 ? 'DR400' : 'DR200';
    values.grainStrength = index % 3 === 0 ? 'Weak' : 'Off';
    values.grainSize = 'Small';
    values.colorChrome = index % 2 ? 'Strong' : 'Off';
    values.whiteBalanceMode = index === 3 ? 'Auto' : 'Daylight';
    values.wbShiftR = index === 3 ? 5 : 0;
    values.wbShiftB = index === 3 ? -3 : 0;
    values.highlight = index === 3 ? 2 : 0;
    values.shadow = index === 3 ? 3 : 0;
    values.color = index === 3 ? 4 : 0;
    values.sharpness = index === 3 ? 0 : -1;
    values.highIsoNr = -3;
    return {
      id: `C${index + 1}`,
      type: 'C',
      index: index + 1,
      name,
      values,
      rawProperties: null,
      readAt: new Date().toISOString(),
    };
  });
}

function createMockBackup() {
  let blob = new Uint8Array(X_E5_FS_LAYOUT.blobSize);
  const magic = new TextEncoder().encode('FUJIFILMX-BACKUP0100');
  blob.set(magic.slice(0, 0x14), 0);
  blob.set(new TextEncoder().encode('X-E5\0'), 0x14);
  new DataView(blob.buffer).setUint16(X_E5_FS_LAYOUT.checksumOffset, 0x1000, true);

  const recipes = [
    { filmSimulation: 'NostalgicNeg', dynamicRange: 'DR200', dRangePriority: 'Off', grainStrength: 'Weak', grainSize: 'Large', colorChrome: 'Strong', colorChromeBlue: 'Weak', smoothSkin: 'Off', whiteBalanceMode: 'Temperature', whiteBalanceKelvin: 5900, wbShiftR: -1, wbShiftB: -6, highlight: 2, shadow: -2, color: -2, sharpness: -4, highIsoNr: -4, clarity: -4, monoWarmCool: null, monoMagentaGreen: null },
    { filmSimulation: 'ClassicChrome', dynamicRange: 'DR400', dRangePriority: 'Off', grainStrength: 'Strong', grainSize: 'Small', colorChrome: 'Strong', colorChromeBlue: 'Weak', smoothSkin: 'Off', whiteBalanceMode: 'Daylight', whiteBalanceKelvin: null, wbShiftR: 2, wbShiftB: -5, highlight: 1, shadow: 1, color: 2, sharpness: 1, highIsoNr: -4, clarity: 0, monoWarmCool: null, monoMagentaGreen: null },
    { filmSimulation: 'Provia', dynamicRange: 'DR100', dRangePriority: 'Off', grainStrength: 'Off', grainSize: 'Small', colorChrome: 'Off', colorChromeBlue: 'Off', smoothSkin: 'Off', whiteBalanceMode: 'Auto', whiteBalanceKelvin: null, wbShiftR: 0, wbShiftB: 0, highlight: 0, shadow: 0, color: 0, sharpness: 0, highIsoNr: 0, clarity: 0, monoWarmCool: null, monoMagentaGreen: null },
  ];
  recipes.forEach((recipe, slot) => { blob = patchFsSlot(blob, slot, recipe).blob; });
  for (const flag of X_E5_FS_LAYOUT.recipeEnabledBySlot) {
    if (flag) blob[flag.offset] = 1;
  }
  return blob;
}

/** @param {string} value */
function escapeXml(value) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}
