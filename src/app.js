// @ts-check

import {
  FIELD_DEFINITIONS,
  FIELD_STATUS,
  NEUTRAL_RECIPE_VALUES,
} from './core/catalog.js';
import { exportLabJson, importLabJson, downloadText } from './core/json.js';
import { buildValidationSnapshot } from './core/diagnostics.js';
import { parseRecipeText } from './core/parser.js';
import { diffRecipeValues, resolveRecipeValues } from './core/recipe-resolution.js';
import {
  cloneRecipe,
  createEmptyRecipe,
  createFieldMeta,
} from './core/schema.js';
import { MockXe5CameraClient } from './camera/mock-camera.js';
import { Xe5CameraClient, serializeSlotSnapshot } from './camera/x-e5-client.js?v=20260802.10';
import { LabStore } from './storage/db.js';
import { renderApp } from './ui/render.js';

const SAMPLE_ASTIA = `Astia
Dynamic Range: DR200
Highlight: -1
Shadow: -2
Color: +1
Noise Reduction: -3
Sharpening: +1
Grain Effect: Weak
White Balance: Auto
ISO: Auto up to ISO 12800
Exposure Compensation: +1/3 (typically)`;

const SAMPLE_PRO_NEG = `PRO Neg. Std
Dynamic Range: DR400
Highlight: +2
Shadow: +3
Color: +4
Noise Reduction: -3
Sharpening: 0
Grain Effect: Strong
White Balance: Auto, +5 Red & -3 Blue
ISO: Auto up to ISO 6400
Exposure Compensation: +1/3 (typically)`;

const root = document.querySelector('#app');
if (!root) throw new Error('Application root not found.');

const SOURCE_REVISION = '2026-08-02.readonly-hardware.10';
const store = new LabStore();
const state = {
  sourceRevision: SOURCE_REVISION,
  tab: 'camera',
  mode: 'mock',
  camera: null,
  connection: null,
  discovery: null,
  scanReport: null,
  backupReport: null,
  lastTransportError: null,
  validationStage: 'disconnected',
  readOnly: true,
  writesEnabled: false,
  slots: [],
  destinationSlotId: 'C7',
  sourceText: SAMPLE_ASTIA,
  sourceUrl: '',
  parsedRecipe: null,
  resolved: null,
  missingPolicy: 'current',
  fieldChoices: {},
  manualValues: {},
  recipeName: '',
  library: [],
  slotBackups: [],
  fullBackups: [],
  logs: [],
  busy: null,
  toast: null,
  modal: null,
  pendingWrite: null,
  pendingRestore: null,
  pendingPowerCycle: null,
  previewFile: null,
  previewFileName: null,
  previewUrl: null,
  previewExposure: 0,
  advancedMode: false,
  writeAcknowledged: false,
  swapA: 'C1',
  swapB: 'C2',
};

await initialize();

async function initialize() {
  state.library = await store.listRecipes();
  state.slotBackups = await store.listSlotBackups();
  state.fullBackups = await store.listFullBackups();
  state.writeAcknowledged = await store.getSetting('writeAcknowledged', false);
  state.advancedMode = await store.getSetting('advancedMode', false);
  render();
}

root.addEventListener('click', async (event) => {
  const target = /** @type {HTMLElement|null} */ (event.target instanceof HTMLElement ? event.target.closest('[data-action]') : null);
  if (!target) return;
  const action = target.dataset.action;
  try {
    switch (action) {
      case 'tab': state.tab = target.dataset.tab; render(); break;
      case 'connect-mock': await connectCamera('mock'); break;
      case 'connect-usb': await connectCamera('usb'); break;
      case 'disconnect': await disconnectCamera(); break;
      case 'refresh-slots': await refreshSlots(); break;
      case 'scan-c-slots': await scanCSlots(); break;
      case 'read-full-backup': await readFullBackup(); break;
      case 'select-destination': selectDestination(target.dataset.slot); break;
      case 'edit-slot': editSlot(target.dataset.slot); break;
      case 'backup-slot': await backupSlot(target.dataset.slot); break;
      case 'backup-all': await backupAll(); break;
      case 'parse-text': parseCurrentText(); break;
      case 'sample-one': state.sourceText = SAMPLE_ASTIA; parseCurrentText(); break;
      case 'sample-two': state.sourceText = SAMPLE_PRO_NEG; parseCurrentText(); break;
      case 'import-url': await importUrl(); break;
      case 'set-final': setFinalFromElement(target); break;
      case 'set-wb': setWbFromElement(target); break;
      case 'save-library': await saveToLibrary(); break;
      case 'review-write': await reviewWrite(); break;
      case 'modal-ack': state.modal.acknowledged = !state.modal.acknowledged; render(); break;
      case 'close-modal': closeModal(); break;
      case 'confirm-write': await confirmWrite(); break;
      case 'dismiss-toast': state.toast = null; render(); break;
      case 'load-library': loadLibraryRecipe(target.dataset.id); break;
      case 'duplicate-library': await duplicateLibraryRecipe(target.dataset.id); break;
      case 'toggle-favorite': await toggleFavorite(target.dataset.id); break;
      case 'delete-library': await deleteLibraryRecipe(target.dataset.id); break;
      case 'export-json': exportJson(); break;
      case 'review-restore-slot': await reviewSlotRestore(target.dataset.slot); break;
      case 'review-restore-full': await reviewFullRestore(target.dataset.key); break;
      case 'confirm-restore': await confirmRestore(); break;
      case 'render-preview': await renderPreview(); break;
      case 'clear-log': state.logs = []; render(); break;
      case 'review-swap': await reviewSwap(); break;
      case 'verify-power-cycle': await verifyPendingPowerCycle(); break;
      default: break;
    }
  } catch (error) {
    handleError(error);
  }
});

root.addEventListener('change', async (event) => {
  const target = /** @type {HTMLInputElement|HTMLSelectElement|null} */ (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement ? event.target : null);
  if (!target) return;
  const action = target.dataset.action;
  try {
    switch (action) {
      case 'destination': selectDestination(target.value); break;
      case 'missing-policy': state.missingPolicy = target.value; recomputeResolution(); render(); break;
      case 'field-choice': state.fieldChoices[target.dataset.key] = target.value; recomputeResolution(); render(); break;
      case 'set-final': setFinalFromElement(target); break;
      case 'ocr-file': await runOcr(target.files?.[0] ?? null); target.value = ''; break;
      case 'import-json': await importJsonFile(target.files?.[0] ?? null); target.value = ''; break;
      case 'preview-file': setPreviewFile(target.files?.[0] ?? null); break;
      case 'preview-exposure': state.previewExposure = Number(target.value); render(); break;
      case 'write-ack': state.writeAcknowledged = target.checked; await store.setSetting('writeAcknowledged', state.writeAcknowledged); render(); break;
      case 'advanced-mode': state.advancedMode = target.checked; await store.setSetting('advancedMode', state.advancedMode); render(); break;
      case 'swap-a': state.swapA = target.value; render(); break;
      case 'swap-b': state.swapB = target.value; render(); break;
      default: break;
    }
  } catch (error) {
    handleError(error);
  }
});

root.addEventListener('input', (event) => {
  const target = /** @type {HTMLInputElement|HTMLTextAreaElement|null} */ (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null);
  if (!target) return;
  switch (target.dataset.action) {
    case 'source-text': state.sourceText = target.value; break;
    case 'source-url': state.sourceUrl = target.value; break;
    case 'recipe-name': state.recipeName = target.value; break;
    default: break;
  }
});

async function connectCamera(mode) {
  await withBusy(`Connecting ${mode === 'mock' ? 'mock camera' : 'USB X-E5'}…`, async () => {
    if (state.camera) await state.camera.disconnect().catch(() => {});
    state.mode = mode;
    state.writesEnabled = mode === 'mock';
    state.readOnly = mode !== 'mock';
    state.discovery = null;
    state.scanReport = null;
    state.backupReport = null;
    state.lastTransportError = null;
    state.slots = [];
    state.camera = mode === 'mock'
      ? new MockXe5CameraClient({ logger: log })
      : new Xe5CameraClient({ logger: log });
    try {
      state.connection = await state.camera.connect();
    } catch (error) {
      state.connection = state.camera.getConnectionInfo?.() ?? null;
      state.discovery = state.camera.getDiscoveryReport?.() ?? null;
      state.validationStage = 'discovery-failed';
      state.lastTransportError = transportErrorEvidence(error);
      await publishValidationSnapshot();
      throw error;
    }
    state.discovery = state.camera.getDiscoveryReport?.() ?? null;
    if (mode === 'mock') {
      state.validationStage = 'mock';
      await refreshSlots({ keepBusy: true });
      toast(`${state.connection.model} connected.`, 'success');
    } else {
      state.validationStage = 'discovered';
      await publishValidationSnapshot();
      toast('X-E5 discovered. No slot selector or object operation has run.', 'success');
    }
  });
}

async function disconnectCamera() {
  if (state.camera) await state.camera.disconnect();
  state.camera = null;
  state.connection = null;
  state.discovery = null;
  state.scanReport = null;
  state.backupReport = null;
  state.lastTransportError = null;
  state.validationStage = 'disconnected';
  state.writesEnabled = false;
  state.readOnly = true;
  state.slots = [];
  render();
}

async function refreshSlots(options = {}) {
  assertCamera();
  if (state.mode !== 'mock') throw new Error('Use the direct guarded C1-C7 property scan, which temporarily selects each bank through 0xD18C and restores the original selector, for a physical X-E5.');
  const task = async () => {
    const result = await state.camera.readAllSlots();
    state.slots = [...result.cSlots, ...result.fsSlots];
    state.connection = state.camera.getConnectionInfo();
    if (!state.slots.some((slot) => slot.id === state.destinationSlotId)) state.destinationSlotId = state.slots.find((slot) => slot.id === 'C7')?.id ?? state.slots[0]?.id ?? null;
    recomputeResolution();
    render();
  };
  if (options.keepBusy) await task();
  else await withBusy('Reading C1-C7 and FS1-FS3…', task);
}

async function scanCSlots() {
  assertCamera();
  if (state.mode !== 'usb') throw new Error('The guarded C1-C7 scan is for the physical USB connection.');
  if (!['discovered', 'c-scan-complete', 'backup-complete'].includes(state.validationStage)) {
    throw new Error('Complete read-only USB discovery before scanning C1-C7.');
  }
  if (
    state.connection?.supportsCSlotScan !== true
    || state.discovery?.supportsPresetProperties !== true
    || state.discovery?.recipeSelectorAdvertised !== true
  ) {
    throw new Error('C-slot scanning remains unavailable until DeviceInfo explicitly advertises selector 0xD18C and every required PTP operation.');
  }
  await withBusy('Temporarily selecting C1-C7 through 0xD18C, reading recipe properties, and restoring the original selector…', async () => {
    state.backupReport = null;
    const report = await state.camera.scanCSlots();
    state.scanReport = report;
    state.slots = [...report.slots];
    state.connection = state.camera.getConnectionInfo();
    const safe = report.complete === true
      && report.allReadsSuccessful === true
      && report.restoration?.confirmed === true
      && report.sessionClosed === true
      && report.interfaceReleased === true
      && report.transactionSummary?.metadataComplete === true
      && report.transactionSummary?.strictlyIncreasing === true;
    state.validationStage = safe ? 'c-scan-complete' : state.connection?.connected ? 'discovered' : 'disconnected-error';
    await publishValidationSnapshot();
    if (!safe) throw new Error('The C-slot scan did not complete every advertised property read, confirm selector restoration, and close the PTP session cleanly. Backup reading remains disabled.');
    toast('C1-C7 recipe properties were read directly; the original custom slot was restored.', 'success');
  });
}

async function readFullBackup() {
  assertCamera();
  if (state.mode !== 'usb') throw new Error('Use the normal Mock refresh for synthetic FS slots.');
  if (!['c-scan-complete', 'backup-complete'].includes(state.validationStage) || !isSafeCScanReport(state.scanReport)) {
    throw new Error('A complete guarded C1-C7 scan is required before reading the full backup.');
  }
  if (state.connection?.supportsFullBackupRead !== true) throw new Error('DeviceInfo does not advertise the operations required for the guarded full-backup read.');
  await withBusy('Reading the X-E5 settings backup in a fresh PTP session…', async () => {
    const backup = await state.camera.readFullBackup();
    if (!backup.decodeGate?.passed || !backup.sessionClosed || !backup.interfaceReleased) {
      throw new Error('The full-backup model/length decode gate or transport cleanup did not pass. FS data will not be accepted.');
    }
    await saveFullBackup(backup);
    await reloadBackups();
    state.connection = state.camera.getConnectionInfo();
    state.slots = [...state.slots.filter((slot) => slot.type === 'C'), ...(backup.fsSlots ?? [])];
    state.backupReport = {
      model: backup.model,
      normalizedModel: backup.normalizedModel,
      size: backup.size,
      declaredSize: backup.declaredSize,
      expectedSize: backup.expectedSize,
      objectFormat: backup.objectFormat,
      sha256: backup.sha256,
      fsSlots: backup.fsSlots ?? [],
      decodeGate: backup.decodeGate ?? null,
      sessionClosed: backup.sessionClosed,
      interfaceReleased: backup.interfaceReleased,
      interfaceReclaimedForRead: backup.interfaceReclaimedForRead === true,
      transactions: backup.transactions ?? [],
      transactionSummary: backup.transactionSummary ?? null,
      anomalies: backup.anomalies ?? [],
    };
    state.validationStage = 'backup-complete';
    await publishValidationSnapshot();
    toast('FS1-FS3 backup data was read directly, validated, and stored only in local IndexedDB.', 'success');
  });
}

function selectDestination(slotId) {
  if (!slotId) return;
  state.destinationSlotId = slotId;
  recomputeResolution();
  render();
}

function editSlot(slotId) {
  const slot = state.slots.find((item) => item.id === slotId);
  if (!slot) return;
  state.destinationSlotId = slotId;
  state.parsedRecipe = recipeFromSlot(slot);
  state.sourceText = state.parsedRecipe.source.rawText;
  state.recipeName = slot.name;
  state.fieldChoices = {};
  state.manualValues = {};
  state.tab = 'import';
  recomputeResolution();
  render();
}

function parseCurrentText(source = {}) {
  const recipe = parseRecipeText(state.sourceText, source);
  state.parsedRecipe = recipe;
  state.recipeName = recipe.name || '';
  state.fieldChoices = {};
  state.manualValues = {};
  recomputeResolution();
  state.tab = 'import';
  render();
}

function recomputeResolution() {
  if (!state.parsedRecipe) {
    state.resolved = null;
    return;
  }
  const current = state.slots.find((slot) => slot.id === state.destinationSlotId)?.values ?? null;
  state.resolved = resolveRecipeValues(state.parsedRecipe, current, {
    defaultMissing: state.missingPolicy,
    choices: state.fieldChoices,
    manualValues: state.manualValues,
  });
}

function setFinalFromElement(element) {
  const key = element.dataset.key;
  if (!key) return;
  const field = FIELD_DEFINITIONS.find((item) => item.key === key);
  let value = 'value' in element ? element.value : element.dataset.value;
  if (field?.type === 'scale' || field?.type === 'kelvin') value = Number(value);
  state.fieldChoices[key] = 'manual';
  state.manualValues[key] = value;
  recomputeResolution();
  render();
}

function setWbFromElement(element) {
  state.fieldChoices.wbShiftR = 'manual';
  state.fieldChoices.wbShiftB = 'manual';
  state.manualValues.wbShiftR = Number(element.dataset.red);
  state.manualValues.wbShiftB = Number(element.dataset.blue);
  recomputeResolution();
  render();
}

async function importUrl() {
  if (!state.sourceUrl) throw new Error('Enter a Fuji X Weekly URL first.');
  await withBusy('Fetching Fuji X Weekly article…', async () => {
    const response = await fetch(`/api/import-url?url=${encodeURIComponent(state.sourceUrl)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? `URL import failed with HTTP ${response.status}.`);
    state.sourceText = payload.text;
    state.parsedRecipe = parseRecipeText(payload.text, { kind: 'url', url: payload.url, title: payload.title });
    state.recipeName = state.parsedRecipe.name || payload.title || '';
    state.fieldChoices = {};
    state.manualValues = {};
    recomputeResolution();
    state.tab = 'import';
    render();
  });
}

async function runOcr(file) {
  if (!file) return;
  const TextDetectorClass = globalThis.TextDetector;
  if (!TextDetectorClass) {
    state.modal = {
      type: 'message',
      title: 'Browser OCR is unavailable',
      message: 'This Chromium build does not expose the experimental TextDetector API. OCR remains an optional provider in the architecture; paste the text manually for now.',
    };
    render();
    return;
  }
  await withBusy('Reading recipe screenshot…', async () => {
    const bitmap = await createImageBitmap(file);
    const detector = new TextDetectorClass();
    const blocks = await detector.detect(bitmap);
    bitmap.close();
    const text = blocks
      .sort((a, b) => (a.boundingBox?.y ?? 0) - (b.boundingBox?.y ?? 0) || (a.boundingBox?.x ?? 0) - (b.boundingBox?.x ?? 0))
      .map((block) => block.rawValue)
      .join('\n');
    state.sourceText = text;
    state.parsedRecipe = parseRecipeText(text, { kind: 'ocr', capturedImageName: file.name });
    state.recipeName = state.parsedRecipe.name || file.name.replace(/\.[^.]+$/, '');
    state.fieldChoices = {};
    state.manualValues = {};
    recomputeResolution();
    state.tab = 'import';
    render();
  });
}

async function saveToLibrary() {
  if (!state.parsedRecipe || !state.resolved) throw new Error('Parse a recipe before saving it.');
  const recipe = cloneRecipe(state.parsedRecipe);
  recipe.name = state.recipeName.trim() || recipe.name || `Recipe ${new Date().toLocaleDateString('en-GB')}`;
  recipe.values = structuredClone(state.resolved.values);
  recipe.updatedAt = new Date().toISOString();
  for (const field of FIELD_DEFINITIONS) {
    const provenance = state.resolved.provenance[field.key];
    if (provenance?.status === FIELD_STATUS.CURRENT || provenance?.status === FIELD_STATUS.NEUTRAL || provenance?.status === FIELD_STATUS.USER) {
      recipe.fields[field.key] = createFieldMeta(provenance.status, 1, recipe.fields[field.key]?.sourceText ?? null, recipe.fields[field.key]?.sourceLabel ?? null, { notes: [provenance.explanation] });
    }
  }
  await store.saveRecipe(recipe);
  state.library = await store.listRecipes();
  toast(`Saved “${recipe.name}” to the local library.`, 'success');
  render();
}

function loadLibraryRecipe(id) {
  const recipe = state.library.find((item) => item.id === id);
  if (!recipe) return;
  state.parsedRecipe = cloneRecipe(recipe);
  state.parsedRecipe.source.kind = 'library';
  state.sourceText = recipe.source.rawText ?? '';
  state.recipeName = recipe.name;
  state.fieldChoices = {};
  state.manualValues = {};
  state.tab = 'import';
  recomputeResolution();
  render();
}

async function duplicateLibraryRecipe(id) {
  const recipe = state.library.find((item) => item.id === id);
  if (!recipe) return;
  const duplicate = cloneRecipe(recipe);
  duplicate.parentRecipeId = recipe.id;
  duplicate.id = crypto.randomUUID();
  duplicate.name = `${recipe.name} — Variant`;
  duplicate.createdAt = new Date().toISOString();
  duplicate.updatedAt = duplicate.createdAt;
  duplicate.favorite = false;
  await store.saveRecipe(duplicate);
  state.library = await store.listRecipes();
  toast('Variant created.', 'success');
  render();
}

async function toggleFavorite(id) {
  const recipe = state.library.find((item) => item.id === id);
  if (!recipe) return;
  recipe.favorite = !recipe.favorite;
  recipe.updatedAt = new Date().toISOString();
  await store.saveRecipe(recipe);
  state.library = await store.listRecipes();
  render();
}

async function deleteLibraryRecipe(id) {
  await store.deleteRecipe(id);
  state.library = await store.listRecipes();
  render();
}

async function backupSlot(slotId) {
  assertCamera();
  if (state.mode !== 'mock') throw new Error('Physical-camera backups use the direct guarded C-slot scan and FS backup read actions.');
  const slot = state.slots.find((item) => item.id === slotId);
  if (!slot) throw new Error(`Slot ${slotId} is not loaded.`);
  await withBusy(`Backing up ${slotId}…`, async () => {
    if (slot.type === 'C') {
      const fresh = await state.camera.readCSlot(slot.index);
      await saveSlotBackup(fresh);
    } else {
      const backup = await state.camera.readFullBackup();
      await saveFullBackup(backup);
    }
    await reloadBackups();
    toast(`${slotId} backup saved.`, 'success');
  });
}

async function backupAll() {
  assertCamera();
  if (state.mode !== 'mock') throw new Error('Physical-camera backups must follow the staged read-only validation actions.');
  await withBusy('Creating slot and full camera backups…', async () => {
    const result = await state.camera.readAllSlots();
    for (const slot of result.cSlots) await saveSlotBackup(slot);
    const backup = await state.camera.readFullBackup();
    await saveFullBackup(backup);
    await reloadBackups();
    toast('Latest C-slot and full X-E5 backups saved.', 'success');
  });
}

async function reviewWrite() {
  assertCamera();
  assertWritesEnabled('camera writes');
  if (!state.resolved || !state.parsedRecipe) throw new Error('Parse and resolve a recipe before writing.');
  const destination = state.slots.find((slot) => slot.id === state.destinationSlotId);
  if (!destination) throw new Error('Choose a loaded destination slot.');
  await withBusy(`Preparing safe write to ${destination.id}…`, async () => {
    const diff = diffRecipeValues(destination.values, state.resolved.values);
    const warnings = [...state.parsedRecipe.warnings, ...state.resolved.warnings];
    if (destination.type === 'C') {
      const fresh = await state.camera.readCSlot(destination.index);
      await saveSlotBackup(fresh);
      state.pendingWrite = {
        kind: 'C',
        destination,
        name: state.recipeName.trim() || state.parsedRecipe.name || destination.name,
        values: structuredClone(state.resolved.values),
        diff,
      };
    } else {
      const prepared = await state.camera.prepareFsWrite(destination.index, state.resolved.values);
      await saveFullBackup(prepared.before);
      warnings.push(...prepared.warnings);
      state.pendingWrite = {
        kind: 'FS',
        destination,
        values: structuredClone(state.resolved.values),
        diff,
        targetBytes: prepared.target.bytes,
        changes: prepared.changes,
      };
    }
    await reloadBackups();
    state.modal = {
      type: 'write-review',
      destination: destination.id,
      description: destination.type === 'FS'
        ? 'FS positions are written by restoring a model-specific full X-E5 settings backup.'
        : 'C slots are written as individual PTP properties and immediately read back.',
      diff,
      warnings,
      acknowledged: false,
    };
    render();
  });
}

async function confirmWrite() {
  assertWritesEnabled('camera writes');
  if (!state.pendingWrite) return;
  if (!state.writeAcknowledged || !state.modal?.acknowledged) throw new Error('Both write acknowledgements are required.');
  const pending = state.pendingWrite;
  closeModal(false);
  if (pending.kind === 'swap') {
    await withBusy(`Swapping ${pending.a.id} and ${pending.b.id}…`, async () => {
      await confirmSwap(pending);
      state.pendingWrite = null;
      render();
    });
    return;
  }
  await withBusy(`Writing ${pending.destination.id}…`, async () => {
    if (pending.kind === 'C') {
      const result = await state.camera.writeCSlot(pending.destination.index, pending.name, pending.values);
      state.pendingPowerCycle = { kind: 'C', slotId: pending.destination.id, expected: pending.values, expectedName: pending.name };
      await refreshSlots({ keepBusy: true });
      state.modal = {
        type: 'result',
        title: result.verification.ok ? `${pending.destination.id} written and read back` : `${pending.destination.id} needs review`,
        message: result.verification.ok
          ? 'The immediate PTP read-back matched. Power-cycle once and run the persistence check before treating this path as hardware-validated.'
          : 'The camera accepted the operation, but one or more fields did not match the immediate read-back.',
        warnings: result.warnings,
        mismatches: result.verification.mismatches,
      };
    } else {
      const result = await state.camera.restoreFullBackup(pending.targetBytes);
      state.connection = state.camera.getConnectionInfo();
      state.slots = [];
      state.pendingPowerCycle = { kind: 'FS', slotId: pending.destination.id, expected: pending.values };
      state.modal = {
        type: 'result',
        title: `${pending.destination.id} backup accepted`,
        message: `${result.note} Reconnect afterwards and use the persistence verification action.`,
        warnings: [],
        mismatches: [],
      };
    }
    state.pendingWrite = null;
    render();
  });
}

async function reviewSwap() {
  assertCamera();
  assertWritesEnabled('slot swapping');
  if (state.swapA === state.swapB) throw new Error('Choose two different C slots.');
  const a = state.slots.find((slot) => slot.id === state.swapA && slot.type === 'C');
  const b = state.slots.find((slot) => slot.id === state.swapB && slot.type === 'C');
  if (!a || !b) throw new Error('Both swap slots must be loaded C slots.');
  await withBusy('Preparing two-slot swap…', async () => {
    const freshA = await state.camera.readCSlot(a.index);
    const freshB = await state.camera.readCSlot(b.index);
    await saveSlotBackup(freshA);
    await saveSlotBackup(freshB);
    await reloadBackups();
    const diff = [
      { key: 'slot', label: a.id, current: a.name, next: b.name, changed: true, writable: true },
      { key: 'slot', label: b.id, current: b.name, next: a.name, changed: true, writable: true },
    ];
    state.pendingWrite = { kind: 'swap', a: freshA, b: freshB, diff };
    state.modal = {
      type: 'write-review',
      destination: `${a.id} ↔ ${b.id}`,
      description: 'Both slots were backed up. The application will write the second recipe into the first slot, then the first recipe into the second, verifying each operation.',
      diff,
      warnings: ['A swap is a two-write operation. If the second write fails, restore both automatic backups from the Backups tab.'],
      acknowledged: false,
    };
    render();
  });
}

async function confirmSwap(pending) {
  const first = await state.camera.writeCSlot(pending.a.index, pending.b.name, pending.b.values);
  if (!first.verification.ok) throw new Error(`The first half of the swap (${pending.a.id}) failed read-back verification.`);
  const second = await state.camera.writeCSlot(pending.b.index, pending.a.name, pending.a.values);
  if (!second.verification.ok) throw new Error(`The second half of the swap (${pending.b.id}) failed read-back verification.`);
  await refreshSlots({ keepBusy: true });
  state.modal = {
    type: 'result',
    title: `${pending.a.id} and ${pending.b.id} swapped`,
    message: 'Both immediate read-backs matched. Power-cycle and refresh once before considering the operation persistent.',
    warnings: [...first.warnings, ...second.warnings],
    mismatches: [],
  };
}

async function reviewSlotRestore(slotId) {
  assertCamera();
  assertWritesEnabled('slot restore');
  const backup = await store.getSlotBackup(slotId);
  if (!backup) throw new Error(`No backup exists for ${slotId}.`);
  const current = state.slots.find((slot) => slot.id === slotId) ?? await state.camera.readCSlot(Number(slotId.slice(1)));
  state.pendingRestore = { kind: 'C', backup, current };
  state.modal = {
    type: 'restore-review',
    title: `Restore ${slotId}`,
    message: `Restore the latest automatic snapshot “${backup.snapshot.name}”.`,
    diff: diffRecipeValues(current.values, backup.snapshot.values),
    acknowledged: false,
  };
  render();
}

async function reviewFullRestore(cameraKey) {
  assertCamera();
  assertWritesEnabled('full-backup restore');
  const backup = await store.getFullBackup(cameraKey);
  if (!backup) throw new Error('Full backup not found.');
  state.pendingRestore = { kind: 'full', backup };
  state.modal = {
    type: 'restore-review',
    title: 'Restore full X-E5 settings backup',
    message: `Model ${backup.model}; ${backup.size} bytes; SHA-256 ${backup.sha256}. The camera will require a power cycle.`,
    acknowledged: false,
  };
  render();
}

async function confirmRestore() {
  assertWritesEnabled('restore');
  if (!state.pendingRestore) return;
  if (!state.writeAcknowledged || !state.modal?.acknowledged) throw new Error('Both restore acknowledgements are required.');
  const pending = state.pendingRestore;
  closeModal(false);
  await withBusy('Restoring backup…', async () => {
    if (pending.kind === 'C') {
      const index = Number(pending.backup.slotId.slice(1));
      const result = await state.camera.writeCSlot(index, pending.backup.snapshot.name, pending.backup.snapshot.values);
      await refreshSlots({ keepBusy: true });
      state.modal = {
        type: 'result',
        title: result.verification.ok ? `${pending.backup.slotId} restored` : 'Restore needs review',
        message: 'The slot backup was written and read back.',
        warnings: result.warnings,
        mismatches: result.verification.mismatches,
      };
    } else {
      const bytes = pending.backup.bytes instanceof Uint8Array ? pending.backup.bytes : new Uint8Array(pending.backup.bytes);
      const result = await state.camera.restoreFullBackup(bytes);
      state.connection = state.camera.getConnectionInfo();
      state.slots = [];
      state.modal = { type: 'result', title: 'Full backup accepted', message: result.note, warnings: [], mismatches: [] };
    }
    state.pendingRestore = null;
    render();
  });
}

async function verifyPendingPowerCycle() {
  assertWritesEnabled('write persistence verification');
  if (!state.pendingPowerCycle) throw new Error('No power-cycle verification is pending.');
  assertCamera();
  await withBusy('Verifying persistent camera state…', async () => {
    const pending = state.pendingPowerCycle;
    if (pending.kind === 'FS') {
      const result = await state.camera.verifyFsSlotAfterReconnect(Number(pending.slotId.slice(2)), pending.expected);
      state.modal = { type: 'result', title: result.verification.ok ? `${pending.slotId} persisted` : `${pending.slotId} mismatch`, message: 'Persistent FS state was read from a fresh full backup.', warnings: [], mismatches: result.verification.mismatches };
    } else {
      const slot = await state.camera.readCSlot(Number(pending.slotId.slice(1)));
      const mismatches = diffRecipeValues(slot.values, pending.expected).filter((item) => item.writable && item.changed).map((item) => ({ key: item.key, expected: item.next, actual: item.current }));
      if (pending.expectedName && slot.name !== pending.expectedName) mismatches.push({ key: 'name', expected: pending.expectedName, actual: slot.name });
      state.modal = { type: 'result', title: mismatches.length ? `${pending.slotId} persistence mismatch` : `${pending.slotId} persisted`, message: 'The slot was re-read after reconnecting.', warnings: [], mismatches };
    }
    state.pendingPowerCycle = null;
    await refreshSlots({ keepBusy: true });
    render();
  });
}

async function renderPreview() {
  assertCamera();
  assertWritesEnabled('RAF upload and camera conversion');
  if (!state.previewFile || !state.resolved) throw new Error('Choose a RAF file and resolve a recipe first.');
  await withBusy('Rendering RAF through the camera processor…', async () => {
    const blob = await state.camera.renderRafPreview(await state.previewFile.arrayBuffer(), state.resolved.values, { exposureEv: state.previewExposure });
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = URL.createObjectURL(blob);
    state.tab = 'preview';
    render();
  });
}

function setPreviewFile(file) {
  state.previewFile = file;
  state.previewFileName = file?.name ?? null;
  render();
}

function exportJson() {
  const json = exportLabJson({ recipes: state.library, slotBackups: state.slotBackups, fullBackups: [] });
  downloadText(`fuji-xe5-recipes-lab-${new Date().toISOString().slice(0, 10)}.json`, json);
}

async function importJsonFile(file) {
  if (!file) return;
  const result = importLabJson(await file.text());
  if (!result.ok) throw new Error(result.errors.join('\n'));
  for (const recipe of result.value.recipes ?? []) await store.saveRecipe(recipe);
  for (const backup of result.value.slotBackups ?? []) await store.saveSlotBackup(backup);
  state.library = await store.listRecipes();
  await reloadBackups();
  toast('JSON import completed.', 'success');
  render();
}

async function saveSlotBackup(slot) {
  const backup = {
    slotId: slot.id,
    createdAt: new Date().toISOString(),
    model: state.connection?.model ?? 'X-E5',
    firmware: state.connection?.firmware ?? null,
    snapshot: serializeSlotSnapshot(slot),
  };
  await store.saveSlotBackup(backup);
  return backup;
}

async function saveFullBackup(backup) {
  const cameraKey = cameraStorageKey();
  const record = {
    cameraKey,
    model: backup.model,
    firmware: state.connection?.firmware ?? null,
    createdAt: backup.createdAt,
    size: backup.size,
    sha256: backup.sha256,
    bytes: backup.bytes.buffer.slice(backup.bytes.byteOffset, backup.bytes.byteOffset + backup.bytes.byteLength),
  };
  await store.saveFullBackup(record);
  return record;
}

async function reloadBackups() {
  state.slotBackups = await store.listSlotBackups();
  state.fullBackups = await store.listFullBackups();
}

function cameraStorageKey() {
  const vendorId = Number(state.connection?.vendorId ?? 0).toString(16).padStart(4, '0');
  const productId = Number(state.connection?.productId ?? 0).toString(16).padStart(4, '0');
  return `X-E5:${vendorId}:${productId}`;
}

function recipeFromSlot(slot) {
  const recipe = createEmptyRecipe();
  recipe.name = slot.name;
  recipe.source = {
    kind: 'camera',
    rawText: `Camera slot ${slot.id}: ${slot.name}`,
    url: null,
    title: slot.name,
    capturedImageName: null,
  };
  recipe.targetGeneration = 'x-trans-v';
  recipe.generationConfidence = 1;
  recipe.generationReasons = ['Read directly from the connected X-E5.'];
  for (const field of FIELD_DEFINITIONS) {
    const value = slot.values[field.key] ?? null;
    const evidence = slotFieldEvidence(slot, field.key);
    const status = value !== null
      ? FIELD_STATUS.CURRENT
      : evidence?.status === 'not-applicable' ? FIELD_STATUS.NOT_APPLICABLE : FIELD_STATUS.MISSING;
    recipe.values[field.key] = value;
    recipe.fields[field.key] = createFieldMeta(
      status,
      value !== null || status === FIELD_STATUS.NOT_APPLICABLE ? 1 : 0,
      null,
      `Camera ${slot.id}`,
      {
        notes: value === null && status !== FIELD_STATUS.NOT_APPLICABLE
          ? [`Camera read did not establish this value${evidence?.readStatus ? ` (${evidence.readStatus})` : ''}; no default was inferred.`]
          : [],
      },
    );
  }
  return recipe;
}

/** @param {any} slot @param {string} fieldKey */
function slotFieldEvidence(slot, fieldKey) {
  const properties = slot.rawProperties instanceof Map
    ? [...slot.rawProperties.values()]
    : Array.isArray(slot.rawProperties) ? slot.rawProperties : [];
  for (const property of properties) {
    const decoded = Array.isArray(property?.decoded) ? property.decoded : [];
    const match = decoded.find((item) => item?.field === fieldKey);
    if (match) return { ...match, readStatus: property.readStatus ?? property.status ?? null };
  }
  return null;
}

function setFinalNameInputInDom() {
  const input = document.querySelector('[data-action="recipe-name"]');
  if (input instanceof HTMLInputElement && input.value !== state.recipeName) input.value = state.recipeName;
}

function closeModal(renderNow = true) {
  state.modal = null;
  if (renderNow) render();
}

function render() {
  root.innerHTML = renderApp(state);
  setFinalNameInputInDom();
}

/** @param {string} message @param {'info'|'success'|'error'} [type] */
function toast(message, type = 'info') {
  state.toast = { message, type };
}

/** @param {string} message @param {any} [detail] */
function log(message, detail = null) {
  state.logs.push({ time: new Date().toISOString().slice(11, 19), message, detail: sanitizeDiagnosticDetail(detail) });
  if (state.logs.length > 200) state.logs.splice(0, state.logs.length - 200);
}

/** @param {any} value @param {number} [depth] */
function sanitizeDiagnosticDetail(value, depth = 0) {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth > 5) return '[TRUNCATED]';
  if (value instanceof Uint8Array) return `[${value.byteLength} payload bytes retained in memory]`;
  if (value instanceof ArrayBuffer) return `[${value.byteLength} payload bytes retained in memory]`;
  if (value instanceof Error) return { name: value.name, message: value.message, code: value.code ?? null };
  if (Array.isArray(value)) return value.map((item) => sanitizeDiagnosticDetail(item, depth + 1));
  if (typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (/serial/i.test(key)) output[key] = '[REDACTED]';
      else if (item instanceof Uint8Array || item instanceof ArrayBuffer) output[key] = `[${item.byteLength} payload bytes retained in memory]`;
      else output[key] = sanitizeDiagnosticDetail(item, depth + 1);
    }
    return output;
  }
  return String(value);
}

async function publishValidationSnapshot() {
  if (state.mode !== 'usb') return;
  try {
    const response = await fetch('/api/validation-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildValidationSnapshot(state)),
    });
    if (!response.ok) log('Local validation snapshot rejected', { httpStatus: response.status });
  } catch (error) {
    log('Local validation snapshot unavailable', error);
  }
}

/** @param {unknown} error */
function transportErrorEvidence(error) {
  if (!(error instanceof Error)) return { name: 'Error', message: String(error ?? 'Unknown error.') };
  return {
    name: error.name,
    code: error.code ?? null,
    message: error.message,
    operation: error.operation ?? null,
    transactionId: error.transactionId ?? null,
    responseCode: error.responseCode ?? null,
    responseName: error.responseName ?? null,
    guidance: error.guidance ?? null,
  };
}

/** @param {string} label @param {() => Promise<any>} task */
async function withBusy(label, task) {
  state.busy = label;
  render();
  try {
    return await task();
  } finally {
    state.busy = null;
    render();
  }
}

function assertCamera() {
  if (!state.camera || !state.connection?.connected) throw new Error('Connect the mock camera or your X-E5 first.');
}

/** @param {any} report */
function isSafeCScanReport(report) {
  return report?.complete === true
    && report?.allReadsSuccessful === true
    && report?.restoration?.confirmed === true
    && report?.sessionClosed === true
    && report?.interfaceReleased === true
    && report?.transactionSummary?.metadataComplete === true
    && report?.transactionSummary?.strictlyIncreasing === true
    && Array.isArray(report?.slots)
    && report.slots.length === 7;
}

/** @param {string} operation */
function assertWritesEnabled(operation) {
  if (!state.writesEnabled || state.mode !== 'mock') {
    throw new Error(`The requested ${operation} operation is disabled for the physical X-E5 during read-only validation.`);
  }
}

/** @param {unknown} error */
function handleError(error) {
  if (state.mode === 'usb' && state.camera?.getConnectionInfo) {
    try { state.connection = state.camera.getConnectionInfo(); } catch { /* Preserve the original operation error. */ }
  }
  const message = error instanceof Error ? error.message : String(error);
  log('Error', { name: error instanceof Error ? error.name : 'Error', message, code: error && typeof error === 'object' && 'code' in error ? error.code : null });
  state.busy = null;
  state.modal = { type: 'message', title: 'Operation failed', message };
  render();
}
