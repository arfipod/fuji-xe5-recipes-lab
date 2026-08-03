import test from 'node:test';
import assert from 'node:assert/strict';

import { MockXe5CameraClient } from '../src/camera/mock-camera.js';
import { parseRecipeText } from '../src/core/parser.js';
import { resolveRecipeValues } from '../src/core/recipe-resolution.js';
import { renderApp } from '../src/ui/render.js';

const SOURCE = `Astia
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

test('pure UI renderer exposes camera slots and Current/Imported/Final review', async () => {
  const camera = new MockXe5CameraClient();
  const connection = await camera.connect();
  const slots = await camera.readAllSlots();
  const parsedRecipe = parseRecipeText(SOURCE);
  const current = slots.cSlots[6];
  const resolved = resolveRecipeValues(parsedRecipe, current.values, { defaultMissing: 'current' });

  const base = {
    tab: 'camera',
    connection,
    mode: 'mock',
    slots: [...slots.cSlots, ...slots.fsSlots],
    destinationSlotId: 'C7',
    sourceText: SOURCE,
    sourceUrl: '',
    parsedRecipe,
    resolved,
    recipeName: 'Astia Lab',
    missingPolicy: 'current',
    fieldChoices: {},
    library: [],
    slotBackups: [],
    fullBackups: [],
    pendingPowerCycle: null,
    busy: null,
    toast: null,
    modal: null,
    logs: [],
    advancedMode: false,
    writeAcknowledged: false,
    swapA: 'C1',
    swapB: 'C2',
  };

  const cameraHtml = renderApp(base);
  assert.match(cameraHtml, /class="skip-link"/);
  assert.match(cameraHtml, /aria-current="page"/);
  assert.match(cameraHtml, /C1-C7 and FS1-FS3/);
  assert.match(cameraHtml, />Connect USB</);
  assert.match(cameraHtml, />Refresh</);
  assert.match(cameraHtml, />Disconnect</);
  assert.match(cameraHtml, />Back up camera state</);
  assert.match(cameraHtml, /C7/);
  assert.match(cameraHtml, /FS3/);
  assert.match(cameraHtml, /Raw backup field diagnostics/);
  assert.match(cameraHtml, /Evidence: PUBLIC_RESEARCH/);
  assert.doesNotMatch(cameraHtml, /class="eyebrow"/);
  assert.doesNotMatch(cameraHtml, />undefined</);

  const importHtml = renderApp({ ...base, tab: 'import' });
  assert.match(importHtml, /Current · Imported · Final/);
  assert.match(importHtml, /WB Shift Grid/);
  assert.match(importHtml, /Auto ISO up to 12800/);
  assert.match(importHtml, /Set this manually on the physical exposure-compensation dial/);

  for (const [tab, heading] of [
    ['camera', 'Camera slots'],
    ['import', 'Import/Edit'],
    ['library', 'Library'],
    ['backups', 'Backups'],
    ['preview', 'RAF Preview'],
    ['system', 'System'],
  ]) {
    const html = renderApp({ ...base, tab });
    assert.match(html, new RegExp(`<h1>${heading.replace('/', '\\/')}</h1>`));
    assert.doesNotMatch(html, />undefined</);
    assert.match(html, new RegExp(`data-tab="${tab}" aria-current="page"`));
  }

  const diagnosticHtml = renderApp({
    ...base,
    slots: [{
      ...current,
      rawProperties: new Map([
        [0xd195, {
          code: 0xd195,
          label: 'Grain Effect',
          rawValue: 6,
          rawHex: '06 00',
          payloadWidth: 2,
          readStatus: 'OK',
          operationName: 'GET_DEVICE_PROP_VALUE',
          transactionId: 42,
          responseCode: 0x2001,
          responseName: 'OK',
          decoded: [
            { field: 'grainStrength', canonicalValue: 'Off', status: 'decoded' },
            { field: 'grainSize', canonicalValue: 'Small', status: 'decoded' },
          ],
        }],
        [0xd19a, {
          code: 0xd19a,
          label: 'WB Shift Red',
          rawValue: -3,
          rawHex: 'FD FF',
          payloadWidth: 2,
          readStatus: 'OK',
          decoded: [{ field: 'wbShiftR', canonicalValue: -3, status: 'decoded' }],
        }],
        [0xd18d, {
          code: 0xd18d,
          label: 'Slot Name',
          rawValue: '',
          rawHex: '01 00 00',
          payloadWidth: 3,
          readStatus: 'OK',
          decoded: [{ field: 'name', canonicalValue: '', status: 'decoded' }],
        }],
      ]),
    }],
  });
  assert.match(diagnosticHtml, /grainStrength: Off/);
  assert.match(diagnosticHtml, /grainSize: Small/);
  assert.match(diagnosticHtml, /-3 \(0xFFFD\)/);
  assert.doesNotMatch(diagnosticHtml, /0x0-3/);
  assert.match(diagnosticHtml, /Empty string/);
  assert.match(diagnosticHtml, /GET_DEVICE_PROP_VALUE · TID 42 · OK \(0x2001\)/);

  const usbState = {
    ...base,
    mode: 'usb',
    connection: {
      ...connection,
      mock: false,
      supportsCSlotScan: true,
      supportsPresetProperties: true,
      supportsFullBackupRead: true,
    },
    slots: [],
    discovery: {
      supportsPresetProperties: true,
      recipeSelectorAdvertised: true,
      deviceInfo: {
        operations: [0x100a, 0x100f, 0x101b],
        events: [0x4008, 0x4009, 0x400b],
      },
    },
    scanReport: null,
  };
  const usbHtml = renderApp(usbState);
  assert.match(usbHtml, /data-action="scan-c-slots"/);
  assert.match(usbHtml, />Read C1-C7 directly</);
  assert.match(usbHtml, /data-action="read-full-backup" disabled/);
  assert.match(usbHtml, /temporarily selects banks through 0xD18C/);
  assert.match(usbHtml, /backup bytes can contain the camera serial/);
  assert.doesNotMatch(usbHtml, /data-action="(?:review-c-scan|confirm-c-scan|review-c-scan-menu|confirm-c-scan-menu|review-fs-menu|confirm-fs-menu|confirm-full-backup-read)"/);
  assert.match(usbHtml, /GetThumb · 0x100A/);
  assert.match(usbHtml, /FormatStore · 0x100F/);
  assert.match(usbHtml, /GetPartialObject · 0x101B/);
  assert.match(usbHtml, /DeviceInfoChanged · 0x4008/);
  assert.match(usbHtml, /RequestObjectTransfer · 0x4009/);
  assert.match(usbHtml, /DeviceReset · 0x400B/);

  const missingCapabilityHtml = renderApp({
    ...usbState,
    connection: { ...usbState.connection, supportsCSlotScan: undefined, supportsPresetProperties: undefined },
    discovery: { ...usbState.discovery, supportsPresetProperties: undefined, recipeSelectorAdvertised: undefined },
  });
  assert.match(missingCapabilityHtml, /data-action="scan-c-slots" disabled/);

  const unavailableReadHtml = renderApp({
    ...usbState,
    slots: slots.cSlots,
    scanReport: {
      complete: true,
      allReadsSuccessful: false,
      restoration: { confirmed: true },
      sessionClosed: true,
      ok: false,
      status: 'COMPLETE_WITH_UNAVAILABLE_PROPERTIES',
      slots: slots.cSlots,
    },
  });
  assert.match(unavailableReadHtml, /data-action="read-full-backup" disabled/);

  const successfulScan = {
    complete: true,
    allReadsSuccessful: true,
    restoration: { confirmed: true },
    sessionClosed: true,
    interfaceReleased: true,
    transactionSummary: { metadataComplete: true, strictlyIncreasing: true },
    ok: true,
    status: 'COMPLETE',
    slots: slots.cSlots,
  };
  const directReadHtml = renderApp({
    ...usbState,
    slots: slots.cSlots,
    scanReport: successfulScan,
  });
  assert.match(directReadHtml, />Read FS1-FS3 directly</);
  assert.doesNotMatch(directReadHtml, /data-action="read-full-backup"[^>]*disabled/);
  assert.match(directReadHtml, /without another confirmation/);
  assert.doesNotMatch(directReadHtml, /data-action="(?:review-c-scan|confirm-c-scan|review-c-scan-menu|confirm-c-scan-menu|review-fs-menu|confirm-fs-menu|confirm-full-backup-read)"/);

  const reviewedCSlotsHtml = renderApp({
    ...usbState,
    slots: [
      { ...slots.cSlots[0], initializationStatus: 'SAVED', menuStateLabel: 'Saved custom bank', valuesActive: true },
      {
        ...slots.cSlots[1],
        initializationStatus: 'CREATE_NEW',
        menuStateLabel: 'CREATE NEW',
        valuesActive: false,
        values: Object.fromEntries(Object.keys(slots.cSlots[1].values).map((key) => [key, null])),
        readStatus: 'UNINITIALIZED_RAW_ONLY',
        activationUncertainty: 'Latent initialization evidence only.',
      },
    ],
  });
  assert.match(reviewedCSlotsHtml, /Bank state: Saved custom bank/);
  assert.match(reviewedCSlotsHtml, /Bank state: CREATE NEW/);
  assert.match(reviewedCSlotsHtml, /Inactive — CREATE NEW/);
  assert.match(reviewedCSlotsHtml, /UNINITIALIZED_RAW_ONLY/);

  const backupReport = {
    model: 'X-E5',
    normalizedModel: 'XE5',
    size: 70524,
    declaredSize: 70524,
    expectedSize: 70524,
    objectFormat: 0x5000,
    sha256: 'a'.repeat(64),
    fsSlots: slots.fsSlots,
    decodeGate: {
      deviceInfoModelIsXe5: true,
      backupModelIsXe5: true,
      objectFormatMatches: true,
      declaredSizeMatchesActual: true,
      exactExpectedSize: true,
      passed: false,
    },
    sessionClosed: true,
    interfaceReleased: true,
  };
  const blockedFsHtml = renderApp({ ...usbState, backupReport });
  assert.match(blockedFsHtml, /DECODE BLOCKED/);
  const guardedFsHtml = renderApp({
    ...usbState,
    backupReport: { ...backupReport, decodeGate: { ...backupReport.decodeGate, passed: true } },
  });
  assert.match(guardedFsHtml, /GUARDS PASSED/);

  const directCompleteHtml = renderApp({
    ...usbState,
    connection: { ...usbState.connection, connected: false },
    validationStage: 'backup-complete',
    backupReport: { ...backupReport, decodeGate: { ...backupReport.decodeGate, passed: true } },
  });
  assert.match(directCompleteHtml, /direct C1-C7 and FS1-FS3 reads completed/);
  assert.match(directCompleteHtml, /Backup bytes remain only in local IndexedDB/);
  assert.doesNotMatch(directCompleteHtml, /data-action="(?:review-c-scan|confirm-c-scan|review-c-scan-menu|confirm-c-scan-menu|review-fs-menu|confirm-fs-menu|confirm-full-backup-read)"/);

  const inactiveFsHtml = renderApp({
    ...usbState,
    slots: [{
      id: 'FS1',
      type: 'FS',
      name: 'FS1',
      fsRecipeStatus: 'OFF',
      activationUncertainty: 'Only the film assignment is active.',
      values: { filmSimulation: 'Provia', dynamicRange: null, whiteBalanceMode: null },
    }],
  });
  assert.match(inactiveFsHtml, /Film assignment only/);
  assert.match(inactiveFsHtml, /Inactive — FS Recipe Off/);
  assert.match(inactiveFsHtml, /data-action="edit-slot"[^>]*disabled/);

});
