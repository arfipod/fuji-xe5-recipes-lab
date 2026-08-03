// @ts-check

import {
  FIELD_DEFINITIONS,
  FILM_SIMULATIONS,
  WHITE_BALANCE_LABELS,
} from '../core/catalog.js';
import {
  discreteScale,
  escapeHtml,
  numberControl,
  selectControl,
  statusBadge,
  valueText,
  wbGrid,
} from './components.js';

const NAV_ITEMS = Object.freeze([
  { id: 'camera', label: 'Camera', code: 'C / FS' },
  { id: 'import', label: 'Import/Edit', code: 'Parse' },
  { id: 'library', label: 'Library', code: 'Local' },
  { id: 'backups', label: 'Backups', code: 'Latest' },
  { id: 'preview', label: 'RAF Preview', code: 'D185' },
  { id: 'system', label: 'System', code: 'PTP' },
]);

const VIEW_COPY = Object.freeze({
  camera: {
    title: 'Camera slots',
    description: 'Read the X-E5, choose a destination, and keep a recoverable state before every later change.',
  },
  import: {
    title: 'Import/Edit',
    description: 'Turn source text into canonical X-E5 values, then review Current, Imported, and Final state together.',
  },
  library: {
    title: 'Library',
    description: 'Keep canonical recipes and their source provenance in this browser only.',
  },
  backups: {
    title: 'Backups',
    description: 'Review local slot snapshots and full X-E5 backup records before any later recovery operation.',
  },
  preview: {
    title: 'RAF Preview',
    description: 'Prepare a camera-processor preview in Mock mode. Physical-camera conversion is disabled during read-only validation.',
  },
  system: {
    title: 'System',
    description: 'Inspect USB, PTP, scan, backup, and local safety state without exposing the camera serial number.',
  },
});

const GROUP_ORDER = Object.freeze(['Base', 'Effects', 'White Balance', 'Tone', 'Monochrome']);
const SENSITIVE_KEY = /serial|cameraKey|deviceId/i;
const BINARY_KEY = /^(?:bytes|blob|backupBytes|data)$/i;

const PTP_OPERATION_NAMES = new Map([
  [0x1001, 'GetDeviceInfo'],
  [0x1002, 'OpenSession'],
  [0x1003, 'CloseSession'],
  [0x1004, 'GetStorageIDs'],
  [0x1005, 'GetStorageInfo'],
  [0x1006, 'GetNumObjects'],
  [0x1007, 'GetObjectHandles'],
  [0x1008, 'GetObjectInfo'],
  [0x1009, 'GetObject'],
  [0x100a, 'GetThumb'],
  [0x100b, 'DeleteObject'],
  [0x100c, 'SendObjectInfo'],
  [0x100d, 'SendObject'],
  [0x100f, 'FormatStore'],
  [0x1014, 'GetDevicePropDesc'],
  [0x1015, 'GetDevicePropValue'],
  [0x1016, 'SetDevicePropValue'],
  [0x101b, 'GetPartialObject'],
]);

const PTP_EVENT_NAMES = new Map([
  [0x4001, 'CancelTransaction'],
  [0x4002, 'ObjectAdded'],
  [0x4003, 'ObjectRemoved'],
  [0x4004, 'StoreAdded'],
  [0x4005, 'StoreRemoved'],
  [0x4006, 'DevicePropChanged'],
  [0x4007, 'ObjectInfoChanged'],
  [0x4008, 'DeviceInfoChanged'],
  [0x4009, 'RequestObjectTransfer'],
  [0x400b, 'DeviceReset'],
  [0x400d, 'CaptureComplete'],
]);

const X_E5_PROPERTY_NAMES = new Map([
  [0xd16e, 'USB Mode'],
  [0xd183, 'RAW Conversion Start'],
  [0xd185, 'RAW Conversion Profile'],
  [0xd18c, 'Recipe Selector'],
  [0xd18d, 'Recipe Name'],
  [0xd18e, 'Image Size'],
  [0xd18f, 'Image Quality'],
  [0xd190, 'Dynamic Range'],
  [0xd191, 'D-Range Priority'],
  [0xd192, 'Film Simulation'],
  [0xd193, 'Monochromatic Warm/Cool'],
  [0xd194, 'Monochromatic Magenta/Green'],
  [0xd195, 'Grain'],
  [0xd196, 'Color Chrome Effect'],
  [0xd197, 'Color Chrome FX Blue'],
  [0xd198, 'Smooth Skin Effect'],
  [0xd199, 'White Balance'],
  [0xd19a, 'WB Shift Red'],
  [0xd19b, 'WB Shift Blue'],
  [0xd19c, 'Color Temperature'],
  [0xd19d, 'Highlight'],
  [0xd19e, 'Shadow'],
  [0xd19f, 'Color'],
  [0xd1a0, 'Sharpness'],
  [0xd1a1, 'High ISO NR'],
  [0xd1a2, 'Clarity'],
  [0xd1a3, 'Long Exposure NR'],
  [0xd1a4, 'Color Space'],
  [0xd1a5, 'Body-specific passthrough'],
]);

/**
 * Pure application renderer. Camera and storage effects remain in app.js.
 *
 * @param {Record<string, any>} state
 * @returns {string}
 */
export function renderApp(state) {
  const tab = NAV_ITEMS.some((item) => item.id === state.tab) ? state.tab : 'camera';
  const copy = VIEW_COPY[tab];

  return `<a class="skip-link" href="#main-content">Skip to main content</a>
    <div class="app-frame">
      <aside class="app-rail" aria-label="Application navigation">
        <div class="brand-lockup" aria-label="Fuji X-E5 Recipes Lab">
          <span class="brand-model">X-E5</span>
          <span class="brand-name">Recipe Lab</span>
        </div>
        <nav class="main-nav" aria-label="Primary">
          ${NAV_ITEMS.map((item) => renderNavItem(item, tab)).join('')}
        </nav>
        <div class="rail-footer"><span>LOCAL / USB PTP</span><small>No cloud account required</small></div>
      </aside>
      <div class="app-workspace">
        <header class="workspace-header">
          <div class="workspace-title">
            <h1>${copy.title}</h1>
            <p>${copy.description}</p>
          </div>
          ${renderConnectionReadout(state)}
        </header>
        <main class="workspace-content" id="main-content" tabindex="-1">
          ${renderView(tab, state)}
        </main>
      </div>
    </div>
    ${renderBusy(state)}
    ${renderToast(state)}
    ${renderModal(state)}`;
}

/** @param {{ id: string, label: string, code: string }} item @param {string} activeTab */
function renderNavItem(item, activeTab) {
  const active = item.id === activeTab;
  return `<button type="button" class="nav-button ${active ? 'is-active' : ''}" data-action="tab" data-tab="${item.id}" ${active ? 'aria-current="page"' : ''}>
    <span>${item.label}</span><small>${item.code}</small>
  </button>`;
}

/** @param {string} tab @param {Record<string, any>} state */
function renderView(tab, state) {
  switch (tab) {
    case 'import': return renderImportView(state);
    case 'library': return renderLibraryView(state);
    case 'backups': return renderBackupsView(state);
    case 'preview': return renderPreviewView(state);
    case 'system': return renderSystemView(state);
    default: return renderCameraView(state);
  }
}

/** @param {Record<string, any>} state */
function renderConnectionReadout(state) {
  const connection = state.connection;
  const connected = Boolean(connection?.connected);
  const model = connected ? connection.model || 'Fujifilm X-E5' : 'No camera';
  const detail = connected
    ? `${isUsbMode(state) ? 'USB · read-only' : 'Mock camera'}${connection.firmware ? ` · ${connection.firmware}` : ''}`
    : 'Mock mode available';
  return `<div class="connection-readout ${connected ? 'is-connected' : ''}" role="status" aria-live="polite">
    <span class="connection-indicator" aria-hidden="true"></span>
    <span class="connection-copy"><strong>${escapeHtml(model)}</strong><small>${escapeHtml(detail)}</small></span>
  </div>`;
}

/** @param {Record<string, any>} state */
function renderCameraView(state) {
  const connected = Boolean(state.connection?.connected);
  const usb = isUsbMode(state);
  const slots = visibleSlots(state);
  const cSlots = slots.filter((slot) => slot.type === 'C' || /^C\d+$/.test(String(slot.id)));
  const fsSlots = slots.filter((slot) => slot.type === 'FS' || /^FS\d+$/.test(String(slot.id)));
  const selectorAdvertised = state.connection?.supportsCSlotScan === true
    && state.discovery?.supportsPresetProperties === true
    && state.discovery?.recipeSelectorAdvertised === true;
  const scanComplete = cSlots.length >= 7
    && state.scanReport?.complete === true
    && state.scanReport?.allReadsSuccessful === true
    && state.scanReport?.restoration?.confirmed === true
    && state.scanReport?.sessionClosed === true
    && state.scanReport?.interfaceReleased === true
    && state.scanReport?.transactionSummary?.metadataComplete === true
    && state.scanReport?.transactionSummary?.strictlyIncreasing === true;
  const backupCapability = state.connection?.supportsFullBackupRead === true;
  const backupComplete = state.validationStage === 'backup-complete'
    && state.backupReport?.decodeGate?.passed === true
    && state.backupReport?.sessionClosed === true
    && state.backupReport?.interfaceReleased === true;
  const busy = Boolean(state.busy);
  const revisionSuffix = String(state.sourceRevision ?? '').split('.').at(-1) || 'dev';

  return `<section class="camera-dock" aria-labelledby="camera-connection-title">
      <div class="panel-heading panel-heading-inverse">
        <div>
          <h2 id="camera-connection-title">${usb ? 'X-E5 read-only validation' : 'Connect an X-E5'}</h2>
          <p>${usb
            ? 'The C1-C7 and FS1-FS3 read actions now run directly from their buttons. The C scan temporarily selects banks through 0xD18C and restores the original selector; recipe writes, restores, object sends, deletion, and RAW conversion remain disabled.'
            : 'Use the mock camera to inspect the complete workflow. USB mode needs Chromium, localhost, and USB RAW CONV./BACKUP RESTORE on the camera.'}</p>
        </div>
        <span class="panel-code" title="${escapeHtml(state.sourceRevision || 'Development source')}">USB / PTP · SOURCE R${escapeHtml(revisionSuffix)}</span>
      </div>
      <div class="dock-actions">
        <button type="button" class="button button-on-dark" data-action="connect-mock" ${disabledAttr(busy || connected)}>Mock X-E5</button>
        <button type="button" class="button button-on-dark button-on-dark-primary" data-action="connect-usb" title="Discovery only; physical writes remain locked" ${disabledAttr(busy || connected)}>Connect USB</button>
        ${connected && usb ? `<button type="button" class="button button-on-dark" data-action="scan-c-slots" ${disabledAttr(busy || !selectorAdvertised)} title="Direct read: temporarily select C1-C7 through 0xD18C, then restore the original selector">Read C1-C7 directly</button>` : ''}
        ${connected && usb ? `<button type="button" class="button button-on-dark" data-action="read-full-backup" ${disabledAttr(busy || !scanComplete || !backupCapability)} title="Direct local read after a safe C1-C7 scan; backup bytes can contain the camera serial">Read FS1-FS3 directly</button>` : ''}
        <button type="button" class="button button-on-dark" data-action="refresh-slots" ${disabledAttr(busy || !connected || usb)}>Refresh</button>
        <button type="button" class="button button-on-dark" data-action="disconnect" ${disabledAttr(busy || !connected)}>Disconnect</button>
      </div>
      ${state.pendingPowerCycle ? renderPersistenceBanner(state.pendingPowerCycle) : ''}
    </section>

    ${usb ? renderReadOnlyNotice(state, selectorAdvertised, scanComplete, backupComplete) : ''}
    ${state.discovery ? renderDiscoverySummary(state.discovery, state) : ''}
    ${state.scanReport ? renderScanSummary(state.scanReport, state) : ''}
    ${state.backupReport ? renderBackupSummary(state.backupReport, state) : ''}

    <div class="section-heading">
      <div><h2>C1-C7 and FS1-FS3</h2><p>C7 and FS3 are reserved as the first hardware-validation targets.</p></div>
      <button type="button" class="button button-secondary" data-action="backup-all" ${disabledAttr(busy || !connected || usb || !slots.length)}>Back up camera state</button>
    </div>
    ${slots.length
      ? `<div class="slot-sections">
          ${renderSlotBank('C1-C7 custom slots', 'PTP 0xD18C-0xD1A5', cSlots, state)}
          ${renderSlotBank('FS1-FS3 full-backup slots', 'X-E5 BACKUP', fsSlots, state)}
        </div>`
      : `<div class="empty-state"><strong>No recipe slots loaded</strong><span>${usb
        ? 'Connect the X-E5, verify that property 0xD18C is advertised, then use the direct C1-C7 read button.'
        : 'Connect Mock X-E5 to render all ten recipe positions.'}</span></div>`}
    ${renderSwapPanel(cSlots, state)}`;
}

/** @param {Record<string, any>} state @param {boolean} selectorAdvertised @param {boolean} scanComplete @param {boolean} backupComplete */
function renderReadOnlyNotice(state, selectorAdvertised, scanComplete, backupComplete) {
  const connected = Boolean(state.connection?.connected);
  return `<div class="${selectorAdvertised || backupComplete ? 'success-box' : 'warning-box'}" role="note">
    <strong>Physical-camera safety lock: read-only</strong>
    <p>${backupComplete
      ? 'The direct C1-C7 and FS1-FS3 reads completed. Exact model, format, length, transaction, selector-restoration, session-close, and interface-release guards passed. Backup bytes remain only in local IndexedDB and can contain the camera serial.'
      : !connected
      ? 'Connecting opens Chromium’s USB device picker. No physical-camera action occurs until the user selects the X-E5.'
      : !selectorAdvertised
        ? 'The X-E5 has not advertised recipe selector property 0xD18C. C-slot actions stay unavailable.'
        : scanComplete
          ? 'Every advertised C-slot property read succeeded, and selector/session cleanup passed. “Read FS1-FS3 directly” downloads the handle-zero settings object without another confirmation; it can contain the camera serial and stays only in local IndexedDB.'
          : '“Read C1-C7 directly” immediately selects each bank through property 0xD18C, reads 0xD18D-0xD1A5, verifies each selector read-back, and restores the exact original selector. No recipe property is written. The FS backup stays locked until the scan passes every cleanup and transaction check.'}</p>
  </div>`;
}

/** @param {any} pending */
function renderPersistenceBanner(pending) {
  return `<div class="persistence-banner" role="status">
    <div><strong>Persistence check pending for ${escapeHtml(pending.slotId || 'camera state')}</strong><span>Reconnect after the requested power cycle, then compare a fresh read.</span></div>
    <button type="button" class="button button-primary" data-action="verify-power-cycle">Verify after reconnect</button>
  </div>`;
}

/** @param {string} title @param {string} code @param {any[]} slots @param {Record<string, any>} state */
function renderSlotBank(title, code, slots, state) {
  return `<section class="slot-bank" aria-label="${escapeHtml(title)}">
    <div class="slot-bank-heading"><h3>${escapeHtml(title)}</h3><span>${escapeHtml(code)}</span></div>
    ${slots.length
      ? `<div class="slot-grid ${slots.some((slot) => slot.type === 'FS' || /^FS/.test(String(slot.id))) ? 'slot-grid-fs' : ''}">${slots.map((slot) => renderSlotCard(slot, state)).join('')}</div>`
      : `<div class="empty-state"><strong>Not read yet</strong><span>No values are being inferred for this bank.</span></div>`}
  </section>`;
}

/** @param {any} slot @param {Record<string, any>} state */
function renderSlotCard(slot, state) {
  const selected = state.destinationSlotId === slot.id;
  const laboratory = slot.id === 'C7' || slot.id === 'FS3';
  const isFs = slot.type === 'FS' || /^FS/.test(String(slot.id));
  const usb = isUsbMode(state);
  const values = slot.values ?? {};
  const fsRecipeStatus = isFs ? String(slot.fsRecipeStatus ?? 'UNKNOWN_FROM_BACKUP') : null;
  const cInitializationStatus = !isFs ? String(slot.initializationStatus ?? 'UNKNOWN_FROM_PTP') : null;
  const cActivationPending = usb && !isFs && (cInitializationStatus === 'UNKNOWN_FROM_MENU' || cInitializationStatus === 'UNKNOWN_FROM_PTP');
  const cInactive = usb && !isFs && cInitializationStatus === 'CREATE_NEW';
  const fsActivationPending = usb && isFs && fsRecipeStatus === 'UNKNOWN_FROM_BACKUP';
  const fsInactive = usb && isFs && fsRecipeStatus === 'OFF';
  const fsNonFilmValue = (key) => fsInactive
    ? 'Inactive — FS Recipe Off'
    : fsActivationPending ? 'Activation not available from this backup field' : valueText(key, values[key]);
  const cValue = (key) => cInactive
    ? 'Inactive — CREATE NEW'
    : cActivationPending ? 'Bank activation not encoded by the PTP field' : valueText(key, values[key]);
  const rawDiagnostics = renderRawPropertyDiagnostics(slot, state);
  const readStatus = slot.readStatus || slot.status || (slot.readAt ? 'Read' : null);
  return `<article class="slot-card ${selected ? 'is-selected' : ''} ${laboratory ? 'is-lab' : ''}">
    <div class="slot-card-head">
      <span class="slot-id">${escapeHtml(slot.id)}</span>
      <span class="slot-type">${isFs ? fsInactive ? 'Film assignment only' : 'Full settings' : cInactive ? 'CREATE NEW' : 'Custom'}</span>
      ${laboratory ? '<span class="lab-badge">Lab target</span>' : ''}
    </div>
    <h3 class="slot-name">${escapeHtml(slot.name ?? 'Name unavailable')}</h3>
    <dl class="slot-summary">
      <div><dt>Film</dt><dd>${escapeHtml(isFs ? valueText('filmSimulation', values.filmSimulation) : cValue('filmSimulation'))}</dd></div>
      <div><dt>Dynamic range</dt><dd>${escapeHtml(isFs ? fsNonFilmValue('dynamicRange') : cValue('dynamicRange'))}</dd></div>
      <div><dt>White balance</dt><dd>${escapeHtml(isFs ? fsNonFilmValue('whiteBalanceMode') : cValue('whiteBalanceMode'))}</dd></div>
      <div><dt>Read status</dt><dd>${escapeHtml(readStatus || 'Decoded')}</dd></div>
    </dl>
    ${usb && isFs ? `<p class="slot-activation-note"><strong>FS RECIPE: ${escapeHtml(fsRecipeStatus === 'UNKNOWN_FROM_BACKUP' ? 'Not physically mapped for this position' : fsRecipeStatus === 'ON' ? 'On' : 'Off')}</strong><span>${escapeHtml(slot.activationUncertainty || 'The guarded backup value is physically mapped; compare it with the camera menu before completing validation.')}</span></p>` : ''}
    ${usb && !isFs ? `<p class="slot-activation-note"><strong>Bank state: ${escapeHtml(cActivationPending ? 'Not encoded by the read property' : slot.menuStateLabel || cInitializationStatus)}</strong><span>${escapeHtml(slot.activationUncertainty || 'Raw and decoded values remain visible, but the empty name payload does not distinguish a saved bank from CREATE NEW.')}</span></p>` : ''}
    <div class="slot-actions">
      <button type="button" class="button button-small ${selected ? 'button-inverse' : 'button-secondary'}" data-action="select-destination" data-slot="${escapeHtml(slot.id)}" ${disabledAttr(fsActivationPending || fsInactive || cActivationPending || cInactive)}>${selected ? 'Selected' : 'Use in editor'}</button>
      <button type="button" class="button button-small button-ghost" data-action="edit-slot" data-slot="${escapeHtml(slot.id)}" ${disabledAttr(fsActivationPending || fsInactive || cActivationPending || cInactive)}>Edit copy</button>
      <button type="button" class="button button-small button-ghost" data-action="backup-slot" data-slot="${escapeHtml(slot.id)}" ${disabledAttr(usb)} title="${usb ? 'Use the direct guarded C-slot scan or FS backup read during physical validation.' : 'Save a local Mock snapshot.'}">Back up</button>
    </div>
    ${rawDiagnostics}
  </article>`;
}

/** @param {any} slot @param {Record<string, any>} state */
function renderRawPropertyDiagnostics(slot, state) {
  const properties = normalizeRawProperties(slot.rawProperties ?? slot.propertyDiagnostics ?? slot.properties);
  if (!properties.length) return '';
  const isFs = slot.type === 'FS' || /^FS/.test(String(slot.id));
  return `<details class="slot-diagnostics">
    <summary>${isFs ? 'Raw backup field' : 'Raw PTP property'} diagnostics (${properties.length})</summary>
    <div class="comparison-table">
      <div class="comparison-row comparison-header">
        <div>Property</div><div>Raw value</div><div>Canonical</div><div>Read evidence</div>
      </div>
      ${properties.map((property) => renderRawProperty(property, state)).join('')}
    </div>
  </details>`;
}

/** @param {any} property @param {Record<string, any>} state */
function renderRawProperty(property, state) {
  const code = property.code ?? property.propertyCode;
  const location = Number.isInteger(property.offset) ? `Offset ${formatHexCode(property.offset)}` : formatHexCode(code);
  const label = property.label || property.name || X_E5_PROPERTY_NAMES.get(numberFromCode(code)) || 'Body-specific property';
  const bytes = property.bytes ?? property.payload;
  const width = property.payloadWidth ?? property.width ?? byteLength(bytes);
  const rawHex = property.rawHex || property.payloadHex || bytesToHex(bytes);
  const rawValue = property.rawValue ?? property.value ?? property.passthroughValue;
  const canonicalKey = property.canonicalKey ?? property.key;
  const canonicalValue = property.canonicalValue ?? (canonicalKey ? property.decodedValue : null);
  const decoded = Array.isArray(property.decoded)
    ? property.decoded.filter((item) => item && typeof item.field === 'string')
    : [];
  const canonicalItems = decoded.length
    ? decoded.map((item) => `${item.field}: ${valueText(item.field, item.canonicalValue)}`)
    : canonicalKey ? [`${canonicalKey}: ${valueText(canonicalKey, canonicalValue)}`] : [];
  const canonicalStatuses = [...new Set(decoded.map((item) => item.status).filter(Boolean))];
  const status = property.readStatus || property.status || (property.error ? 'Error' : 'Read');
  const wireEvidence = property.operationName
    ? [
      property.operationName,
      Number.isInteger(property.transactionId) ? `TID ${property.transactionId}` : null,
      property.responseName
        ? `${property.responseName}${Number.isInteger(property.responseCode) ? ` (${formatHexCode(property.responseCode)})` : ''}`
        : null,
    ].filter(Boolean).join(' · ')
    : null;
  const notes = [
    wireEvidence,
    property.evidenceLevel ? `Evidence: ${property.evidenceLevel}` : null,
    property.activationStatus ? `Activation: ${property.activationStatus}` : null,
    property.researchSource,
    property.normalization,
    property.uncertainty,
    property.note,
    property.error,
  ]
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map((value) => redactKnown(String(value), state));
  return `<div class="comparison-row">
    <div class="parameter-cell"><strong>${escapeHtml(location)}</strong><small>${escapeHtml(label)}</small></div>
    <div class="value-cell"><span>${escapeHtml(displayRawValue(rawValue, width))}</span><small>${escapeHtml(rawHex || 'No payload')} · ${escapeHtml(width === null ? 'width unknown' : `${width} byte${width === 1 ? '' : 's'}`)}</small></div>
    <div class="imported-cell"><span>${canonicalItems.length ? canonicalItems.map(escapeHtml).join(' · ') : 'Passthrough'}</span><small>${canonicalItems.length ? `Known project mapping${canonicalStatuses.length ? ` · ${canonicalStatuses.map(escapeHtml).join(', ')}` : ''}` : 'No project mapping; raw value preserved'}</small></div>
    <div class="final-cell"><strong>${escapeHtml(status)}</strong>${notes.length ? `<small>${notes.map(escapeHtml).join(' · ')}</small>` : '<small>No normalization reported</small>'}</div>
  </div>`;
}

/** @param {any[]} cSlots @param {Record<string, any>} state */
function renderSwapPanel(cSlots, state) {
  if (!cSlots.length) return '';
  const usb = isUsbMode(state);
  return `<section class="panel compact-panel">
    <div class="panel-heading">
      <div><h2>Swap two C slots</h2><p>${usb ? 'Disabled for the complete read-only hardware-validation stage.' : 'Mock mode backs up both slots before the two simulated writes.'}</p></div>
      <span class="panel-code">TWO-SLOT OPERATION</span>
    </div>
    <div class="inline-form swap-form">
      ${slotSelect('swap-a', state.swapA || 'C1', cSlots, usb, 'First C slot')}
      <span class="swap-mark" aria-hidden="true">↔</span>
      ${slotSelect('swap-b', state.swapB || 'C2', cSlots, usb, 'Second C slot')}
      <button type="button" class="button button-primary" data-action="review-swap" ${disabledAttr(usb || cSlots.length < 2)}>Review swap</button>
    </div>
  </section>`;
}

/** @param {string} action @param {string} selected @param {any[]} slots @param {boolean} disabled @param {string} label */
function slotSelect(action, selected, slots, disabled, label) {
  return `<label><span class="field-label">${escapeHtml(label)}</span><select data-action="${action}" ${disabledAttr(disabled)}>${slots.map((slot) => `<option value="${escapeHtml(slot.id)}" ${slot.id === selected ? 'selected' : ''}>${escapeHtml(slot.id)} · ${escapeHtml(slot.name || 'Unnamed')}</option>`).join('')}</select></label>`;
}

/** @param {Record<string, any>} state */
function renderImportView(state) {
  const recipe = state.parsedRecipe;
  const resolved = state.resolved;
  const destination = currentDestination(state);
  const slots = visibleSlots(state);
  const usb = isUsbMode(state);
  return `<div class="import-layout">
      <section class="panel source-panel">
        <div class="panel-heading"><div><h2>Recipe source</h2><p>Paste text, enter a Fuji X Weekly URL, or choose a screenshot for browser OCR.</p></div><span class="panel-code">INPUT</span></div>
        <label class="field-label" for="source-url">Source URL</label>
        <div class="inline-form">
          <input id="source-url" type="url" inputmode="url" data-action="source-url" value="${escapeHtml(state.sourceUrl || '')}" placeholder="https://fujixweekly.com/…">
          <button type="button" class="button button-secondary" data-action="import-url">Import URL</button>
        </div>
        <label class="field-label" for="source-text">Recipe text</label>
        <textarea id="source-text" data-action="source-text" spellcheck="false" placeholder="Paste the complete recipe source here…">${escapeHtml(state.sourceText || '')}</textarea>
        <div class="button-row">
          <button type="button" class="button button-primary" data-action="parse-text">Parse recipe</button>
          <button type="button" class="button button-ghost" data-action="sample-one">Load Astia sample</button>
          <button type="button" class="button button-ghost" data-action="sample-two">Load PRO Neg. sample</button>
        </div>
        <label class="file-button">Choose OCR screenshot<input type="file" accept="image/*" data-action="ocr-file"></label>
        <p class="helper-text">The original source remains attached to the canonical recipe. Missing values are never filled silently.</p>
      </section>
      ${renderParserSummary(recipe, state)}
    </div>
    ${recipe && resolved ? `<div class="section-heading editor-heading">
      <div><h2>Current · Imported · Final</h2><p>Every final value identifies whether it came from the source, the selected slot, an X-E5 neutral, or a manual edit.</p></div>
      <div class="destination-controls">
        <label>Destination<select data-action="destination" ${disabledAttr(!slots.length)}>${slots.length ? slots.map((slot) => `<option value="${escapeHtml(slot.id)}" ${slot.id === state.destinationSlotId ? 'selected' : ''}>${escapeHtml(slot.id)} · ${escapeHtml(slot.name || 'Unnamed')}</option>`).join('') : '<option>No slots loaded</option>'}</select></label>
        <label>Recipe name<input data-action="recipe-name" value="${escapeHtml(state.recipeName || recipe.name || '')}" maxlength="25"></label>
        <label>When source is missing<select data-action="missing-policy"><option value="current" ${state.missingPolicy !== 'neutral' ? 'selected' : ''}>Preserve current slot</option><option value="neutral" ${state.missingPolicy === 'neutral' ? 'selected' : ''}>Use X-E5 neutral</option></select></label>
      </div>
    </div>
    ${renderComparisonEditor(state, destination)}
    ${renderShootingReminders(state)}
    ${renderEditorWarnings(state)}
    <div class="sticky-actions">
      <div><strong>${escapeHtml(state.destinationSlotId || 'No destination')}</strong><span>${usb ? 'Physical-camera writes are disabled; review remains local.' : destination ? `Current slot: ${escapeHtml(destination.name || destination.id)}` : 'Connect Mock X-E5 to compare current values.'}</span></div>
      <div class="button-row">
        <button type="button" class="button button-secondary" data-action="save-library">Save to library</button>
        <button type="button" class="button button-inverse" data-action="review-write" ${disabledAttr(!destination || usb)}>Review camera write</button>
      </div>
    </div>` : `<div class="section-heading"><div><h2>Comparison editor</h2><p>Parse a source recipe to open the canonical field review.</p></div></div><div class="empty-state"><strong>No parsed recipe</strong><span>The source text is unchanged until you choose Parse recipe.</span></div>`}`;
}

/** @param {any} recipe @param {Record<string, any>} state */
function renderParserSummary(recipe, state) {
  if (!recipe) return `<aside class="panel parser-summary"><div class="panel-heading"><div><h2>Parse summary</h2><p>Canonical evidence appears here.</p></div><span class="panel-code">EVIDENCE</span></div><div class="summary-empty"><strong>Nothing parsed yet</strong><span>Paste a recipe or load a sample.</span></div></aside>`;
  const fields = FIELD_DEFINITIONS.map((field) => recipe.fields?.[field.key]).filter(Boolean);
  const detected = fields.filter((field) => ['exact', 'alias', 'inferred'].includes(field.status)).length;
  const missing = fields.filter((field) => field.status === 'missing').length;
  const invalid = fields.filter((field) => field.status === 'invalid').length;
  return `<aside class="panel parser-summary">
    <div class="panel-heading"><div><h2>Parse summary</h2><p>${escapeHtml(recipe.name || 'Unnamed recipe')}</p></div><span class="panel-code">EVIDENCE</span></div>
    <dl class="summary-list">
      <div><dt>Target generation</dt><dd>${escapeHtml(humanize(recipe.targetGeneration || 'unknown'))}</dd></div>
      <div><dt>Generation confidence</dt><dd>${escapeHtml(formatPercent(recipe.generationConfidence))}</dd></div>
      <div><dt>Detected fields</dt><dd>${detected}</dd></div>
      <div><dt>Missing fields</dt><dd>${missing}</dd></div>
      <div><dt>Invalid fields</dt><dd>${invalid}</dd></div>
    </dl>
    ${listBox('Generation evidence', recipe.generationReasons, 'warning-box', state)}
    ${listBox('Parser warnings', recipe.warnings, 'warning-box', state)}
  </aside>`;
}

/** @param {Record<string, any>} state @param {any} destination */
function renderComparisonEditor(state, destination) {
  return `<div class="comparison-editor">${GROUP_ORDER.map((group) => {
    const fields = FIELD_DEFINITIONS.filter((field) => field.group === group && field.type !== 'external' && field.type !== 'wb-shift');
    const shift = group === 'White Balance' ? renderWhiteBalanceGridRow(state, destination) : '';
    return `<section class="editor-group"><div class="editor-group-title"><h3>${escapeHtml(group)}</h3></div><div class="comparison-table"><div class="comparison-row comparison-header"><div>Parameter</div><div>Current</div><div>Imported</div><div>Final</div></div>${fields.map((field) => renderFieldRow(field, state, destination)).join('')}${shift}</div></section>`;
  }).join('')}</div>`;
}

/** @param {any} field @param {Record<string, any>} state @param {any} destination */
function renderFieldRow(field, state, destination) {
  const parsedValue = state.parsedRecipe?.values?.[field.key];
  const meta = state.parsedRecipe?.fields?.[field.key] ?? { status: 'missing', confidence: 0 };
  const finalValue = state.resolved?.values?.[field.key];
  const provenance = state.resolved?.provenance?.[field.key] ?? {};
  const disabled = provenance.status === 'not-applicable';
  return `<div class="comparison-row ${disabled ? 'is-disabled' : ''}">
    <div class="parameter-cell"><strong>${escapeHtml(field.label)}</strong><small>${escapeHtml(provenance.explanation || (field.writable ? 'Stored in the recipe slot.' : 'Shooting reminder only.'))}</small></div>
    <div class="value-cell">${escapeHtml(valueText(field.key, destination?.values?.[field.key]))}</div>
    <div class="imported-cell"><span>${escapeHtml(valueText(field.key, parsedValue))}</span>${statusBadge(meta.status || 'missing')}<small>${escapeHtml(meta.sourceText || meta.sourceLabel || 'Not present in source')}</small></div>
    <div class="final-cell">${renderFinalControl(field, finalValue, disabled)}${renderSourceChoice(field, provenance.choice, meta, destination, disabled)}</div>
  </div>`;
}

/** @param {any} field @param {any} value @param {boolean} disabled */
function renderFinalControl(field, value, disabled) {
  if (field.type === 'film') {
    return selectControl({ key: field.key, value, options: FILM_SIMULATIONS.map((item) => item.id), labels: Object.fromEntries(FILM_SIMULATIONS.map((item) => [item.id, item.label])), disabled });
  }
  if (field.type === 'choice') return selectControl({ key: field.key, value, options: field.options ?? [], disabled });
  if (field.type === 'white-balance') return selectControl({ key: field.key, value, options: field.options ?? [], labels: WHITE_BALANCE_LABELS, disabled });
  if (field.type === 'kelvin') return numberControl({ key: field.key, value: numberOrNull(value), min: field.min, max: field.max, step: field.step, suffix: 'K', disabled });
  if (field.type === 'scale') return discreteScale({ key: field.key, value, options: field.options ?? [], disabled });
  return `<span class="external-value">${escapeHtml(valueText(field.key, value))}</span>`;
}

/** @param {any} field @param {string} choice @param {any} meta @param {any} destination @param {boolean} disabled */
function renderSourceChoice(field, choice, meta, destination, disabled) {
  const importedAvailable = meta?.status && !['missing', 'invalid', 'not-applicable'].includes(meta.status);
  const currentAvailable = destination?.values?.[field.key] !== null && destination?.values?.[field.key] !== undefined;
  return `<label class="source-choice">Source
    <select data-action="field-choice" data-key="${escapeHtml(field.key)}" ${disabledAttr(disabled)}>
      <option value="imported" ${choice === 'imported' ? 'selected' : ''} ${disabledAttr(!importedAvailable)}>Imported</option>
      <option value="current" ${choice === 'current' ? 'selected' : ''} ${disabledAttr(!currentAvailable)}>Current slot</option>
      <option value="neutral" ${choice === 'neutral' ? 'selected' : ''}>X-E5 neutral</option>
      <option value="manual" ${choice === 'manual' ? 'selected' : ''}>Manual edit</option>
    </select>
  </label>`;
}

/** @param {Record<string, any>} state @param {any} destination */
function renderWhiteBalanceGridRow(state, destination) {
  const red = state.resolved?.values?.wbShiftR;
  const blue = state.resolved?.values?.wbShiftB;
  const redMeta = state.parsedRecipe?.fields?.wbShiftR ?? { status: 'missing' };
  const blueMeta = state.parsedRecipe?.fields?.wbShiftB ?? { status: 'missing' };
  const disabled = state.resolved?.provenance?.wbShiftR?.status === 'not-applicable' || state.resolved?.provenance?.wbShiftB?.status === 'not-applicable';
  return `<div class="comparison-row comparison-row-grid ${disabled ? 'is-disabled' : ''}">
    <div class="parameter-cell"><strong>WB Shift Grid</strong><small>Fujifilm R/B coordinates from -9 to +9.</small></div>
    <div class="value-cell">R ${signedText(destination?.values?.wbShiftR)} · B ${signedText(destination?.values?.wbShiftB)}</div>
    <div class="imported-cell"><span>R ${signedText(state.parsedRecipe?.values?.wbShiftR)} · B ${signedText(state.parsedRecipe?.values?.wbShiftB)}</span><span>${statusBadge(redMeta.status || 'missing')} ${statusBadge(blueMeta.status || 'missing')}</span><small>${escapeHtml(redMeta.sourceText || blueMeta.sourceText || 'Not present in source')}</small></div>
    <div class="final-cell wb-final-cell">${wbGrid({ red: numericOrZero(red), blue: numericOrZero(blue), disabled })}</div>
  </div>`;
}

/** @param {Record<string, any>} state */
function renderShootingReminders(state) {
  const values = state.resolved?.values ?? {};
  return `<section class="editor-group reminder-group">
    <div class="editor-group-title"><h3>Shooting Reminder</h3></div>
    <div class="reminder-cards">
      <article><span>ISO</span><strong>${escapeHtml(isoReminder(values))}</strong><p>Retained in canonical JSON; the initial recipe writer does not change Auto ISO.</p></article>
      <article><span>EXPOSURE COMPENSATION</span><strong>${escapeHtml(exposureReminder(values))}</strong><p>Set this manually on the physical exposure-compensation dial.</p></article>
    </div>
  </section>`;
}

/** @param {Record<string, any>} state */
function renderEditorWarnings(state) {
  const warnings = [...(state.parsedRecipe?.warnings ?? []), ...(state.resolved?.warnings ?? [])];
  return listBox('Review notes', [...new Set(warnings)], 'warning-box', state);
}

/** @param {Record<string, any>} state */
function renderLibraryView(state) {
  const recipes = Array.isArray(state.library) ? state.library : [];
  return `<div class="section-heading">
      <div><h2>Local recipe library</h2><p>Canonical values, source text, and provenance stay in IndexedDB on this browser.</p></div>
      <div class="button-row">
        <button type="button" class="button button-secondary" data-action="export-json" ${disabledAttr(!recipes.length)}>Export JSON</button>
        <label class="file-button file-button-inline">Import JSON<input type="file" accept="application/json,.json" data-action="import-json"></label>
      </div>
    </div>
    ${recipes.length ? `<section class="library-list" aria-label="Saved recipes">${recipes.map((recipe) => renderLibraryRow(recipe)).join('')}</section>` : '<div class="empty-state"><strong>The library is empty</strong><span>Parse a recipe, resolve its values, and choose Save to library.</span></div>'}`;
}

/** @param {any} recipe */
function renderLibraryRow(recipe) {
  const film = valueText('filmSimulation', recipe.values?.filmSimulation);
  const wb = valueText('whiteBalanceMode', recipe.values?.whiteBalanceMode);
  const tags = Array.isArray(recipe.tags) ? recipe.tags : [];
  return `<article class="library-row ${recipe.favorite ? 'is-favorite' : ''}">
    <button type="button" class="favorite-button" data-action="toggle-favorite" data-id="${escapeHtml(recipe.id)}" aria-label="${recipe.favorite ? 'Remove from favorites' : 'Add to favorites'}" aria-pressed="${recipe.favorite ? 'true' : 'false'}">${recipe.favorite ? '★' : '☆'}</button>
    <div class="library-identity"><small>${escapeHtml(humanize(recipe.source?.kind || 'local'))}</small><h3>${escapeHtml(recipe.name || 'Unnamed recipe')}</h3></div>
    <div class="library-profile"><strong>${escapeHtml(film)}</strong><span>${escapeHtml(wb)}</span></div>
    <div class="tag-row">${tags.length ? tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('') : '<span>No tags</span>'}</div>
    <div class="button-row library-actions">
      <button type="button" class="button button-small button-primary" data-action="load-library" data-id="${escapeHtml(recipe.id)}">Open</button>
      <button type="button" class="button button-small button-secondary" data-action="duplicate-library" data-id="${escapeHtml(recipe.id)}">Variant</button>
      <button type="button" class="button button-small button-ghost" data-action="delete-library" data-id="${escapeHtml(recipe.id)}">Delete</button>
    </div>
  </article>`;
}

/** @param {Record<string, any>} state */
function renderBackupsView(state) {
  const slotBackups = Array.isArray(state.slotBackups) ? state.slotBackups : [];
  const fullBackups = Array.isArray(state.fullBackups) ? state.fullBackups : [];
  const usb = isUsbMode(state);
  return `<div class="section-heading">
      <div><h2>Local recovery records</h2><p>Backups are local evidence. A physical-camera restore is not available during read-only validation.</p></div>
      ${state.connection?.connected && usb ? '<button type="button" class="button button-secondary" data-action="read-full-backup" disabled>Full backup follows a successful C1-C7 scan</button>' : ''}
    </div>
    <div class="warning-box" role="note"><strong>Full backups can contain the camera serial number</strong><p>The application must keep backup bytes local. This view shows model, exact size, and SHA-256 only; it never renders backup bytes or a camera identity key.</p></div>
    <div class="backup-columns">
      <section class="panel">
        <div class="panel-heading"><div><h2>C-slot snapshots</h2><p>One latest local snapshot per custom slot.</p></div><span class="panel-code">${slotBackups.length}</span></div>
        ${slotBackups.length ? `<div class="backup-list">${slotBackups.map((backup) => renderSlotBackup(backup, usb)).join('')}</div>` : '<div class="empty-state"><strong>No C-slot snapshots</strong><span>A read alone does not invent a backup record.</span></div>'}
      </section>
      <section class="panel">
        <div class="panel-heading"><div><h2>Full X-E5 backups</h2><p>Exact-length local settings objects with SHA-256 evidence.</p></div><span class="panel-code">${fullBackups.length}</span></div>
        ${fullBackups.length ? `<div class="backup-list">${fullBackups.map((backup) => renderFullBackup(backup, usb)).join('')}</div>` : '<div class="empty-state"><strong>No full backup stored</strong><span>The physical backup stage remains unavailable until C1-C7 reading succeeds.</span></div>'}
      </section>
    </div>
    ${state.backupReport ? renderBackupSummary(state.backupReport, state) : ''}`;
}

/** @param {any} backup @param {boolean} usb */
function renderSlotBackup(backup, usb) {
  return `<article><div><strong>${escapeHtml(backup.slotId || backup.snapshot?.id || 'C slot')}</strong><span>${escapeHtml(backup.snapshot?.name || 'Unnamed snapshot')}</span><small>${escapeHtml(formatDate(backup.createdAt))} · ${escapeHtml(backup.model || 'X-E5')}</small></div><button type="button" class="button button-small button-secondary" data-action="review-restore-slot" data-slot="${escapeHtml(backup.slotId || backup.snapshot?.id || '')}" ${disabledAttr(usb)}>Review restore</button></article>`;
}

/** @param {any} backup @param {boolean} usb */
function renderFullBackup(backup, usb) {
  const safeMockKey = !usb && !SENSITIVE_KEY.test(String(backup.cameraKey || '')) ? backup.cameraKey : null;
  return `<article><div><strong>${escapeHtml(backup.model || 'X-E5')} · ${escapeHtml(formatByteCount(backup.size))}</strong><span>SHA-256 ${escapeHtml(shortHash(backup.sha256))}</span><small>${escapeHtml(formatDate(backup.createdAt))}${backup.firmware ? ` · firmware ${escapeHtml(backup.firmware)}` : ''}</small></div><button type="button" class="button button-small button-secondary" data-action="review-restore-full" ${safeMockKey ? `data-key="${escapeHtml(safeMockKey)}"` : ''} ${disabledAttr(usb || !safeMockKey)}>Review restore</button></article>`;
}

/** @param {Record<string, any>} state */
function renderPreviewView(state) {
  const usb = isUsbMode(state);
  const canRender = !usb && state.connection?.connected && state.previewFile && state.resolved;
  return `<div class="preview-layout">
    <section class="panel">
      <div class="panel-heading"><div><h2>RAF input</h2><p>Mock mode returns a generated preview while exercising the same UI flow.</p></div><span class="panel-code">PREVIEW</span></div>
      ${usb ? '<div class="warning-box"><strong>Physical RAW conversion is disabled</strong><p>No RAF will be sent, no conversion will be triggered, and no camera object will be deleted during read-only validation.</p></div>' : ''}
      <label class="file-button">Choose RAF file<input type="file" accept=".raf,image/x-fuji-raf" data-action="preview-file" ${disabledAttr(usb)}></label>
      <p class="helper-text">${escapeHtml(state.previewFileName || 'No RAF selected')}</p>
      <label>Exposure adjustment<select data-action="preview-exposure" ${disabledAttr(usb)}>${makeNumberRange(-2, 2, 1 / 3).map((value) => `<option value="${value}" ${numberEquivalent(value, Number(state.previewExposure || 0)) ? 'selected' : ''}>${value > 0 ? '+' : ''}${Number(value.toFixed(2))} EV</option>`).join('')}</select></label>
      <div class="summary-list">
        <div><dt>Recipe</dt><dd>${escapeHtml(state.recipeName || state.parsedRecipe?.name || 'Not resolved')}</dd></div>
        <div><dt>Film simulation</dt><dd>${escapeHtml(valueText('filmSimulation', state.resolved?.values?.filmSimulation))}</dd></div>
        <div><dt>Transport</dt><dd>${usb ? 'Disabled' : state.connection?.connected ? 'Mock camera' : 'Not connected'}</dd></div>
      </div>
      <button type="button" class="button button-primary" data-action="render-preview" ${disabledAttr(!canRender)}>Render preview</button>
    </section>
    <div class="preview-canvas" aria-live="polite">${state.previewUrl ? `<img src="${escapeHtml(state.previewUrl)}" alt="Camera-processed RAF preview">` : '<div><strong>No preview rendered</strong><span>Choose a RAF file and resolve a recipe first.</span></div>'}</div>
  </div>`;
}

/** @param {Record<string, any>} state */
function renderSystemView(state) {
  const usb = isUsbMode(state);
  const logs = Array.isArray(state.logs) ? state.logs : [];
  return `<div class="advanced-layout">
    <section class="panel">
      <div class="panel-heading"><div><h2>Safety state</h2><p>The physical X-E5 remains locked to discovery and read-only operations.</p></div><span class="panel-code">LOCAL</span></div>
      <label class="check-row"><input type="checkbox" data-action="advanced-mode" ${state.advancedMode ? 'checked' : ''}><span><strong>Advanced diagnostics</strong><br><small>Keep raw properties, capability codes, backup hashes, and transport evidence visible.</small></span></label>
      <label class="check-row"><input type="checkbox" data-action="write-ack" ${state.writeAcknowledged ? 'checked' : ''} ${disabledAttr(usb)}><span><strong>Write-risk acknowledgement</strong><br><small>${usb ? 'Unavailable during physical read-only validation.' : 'Applies to simulated Mock write reviews only in this stage.'}</small></span></label>
      <dl class="summary-list">
        <div><dt>Camera transport</dt><dd>${state.connection?.connected ? usb ? 'USB / read-only' : 'Mock' : 'Disconnected'}</dd></div>
        <div><dt>Camera mutations</dt><dd>${usb ? 'Disabled' : 'Mock only'}</dd></div>
        <div><dt>Storage</dt><dd>Browser-local</dd></div>
        <div><dt>Serial handling</dt><dd>Memory only · redacted</dd></div>
      </dl>
    </section>
    <section class="panel log-panel">
      <div class="log-head"><div><h2>Diagnostic log</h2><p>Transport messages are rendered with serial-bearing keys removed.</p></div><button type="button" class="button button-small button-secondary" data-action="clear-log" ${disabledAttr(!logs.length)}>Clear log</button></div>
      <pre>${escapeHtml(formatLogs(logs, state) || 'No diagnostic messages yet.')}</pre>
    </section>
  </div>
  ${state.discovery ? renderDiscoverySummary(state.discovery, state, true) : ''}
  ${state.scanReport ? renderScanSummary(state.scanReport, state, true) : ''}
  ${state.backupReport ? renderBackupSummary(state.backupReport, state, true) : ''}`;
}

/** @param {any} discovery @param {Record<string, any>} state @param {boolean} [expanded] */
function renderDiscoverySummary(discovery, state, expanded = false) {
  const entries = diagnosticEntries(discovery, { excluded: new Set(['slots', 'fsSlots', 'rawProperties', 'propertyDiagnostics']) });
  return `<section class="panel" aria-labelledby="discovery-title">
    <div class="panel-heading"><div><h2 id="discovery-title">USB and PTP discovery</h2><p>Identifiers, claimed interface, endpoints, packet sizes, DeviceInfo, and advertised capabilities. The serial number is intentionally omitted.</p></div><span class="panel-code">READ-ONLY</span></div>
    ${entries.length ? renderDiagnosticEntries(entries, state, expanded) : '<div class="empty-state"><strong>Discovery record is empty</strong><span>No capability value has been inferred.</span></div>'}
  </section>`;
}

/** @param {any} report @param {Record<string, any>} state @param {boolean} [expanded] */
function renderScanSummary(report, state, expanded = false) {
  const entries = diagnosticEntries(report, { excluded: new Set(['slots', 'cSlots', 'rawProperties', 'propertyDiagnostics']) });
  const slots = Array.isArray(report.slots) ? report.slots : Array.isArray(report.cSlots) ? report.cSlots : [];
  const failed = reportFailed(report);
  return `<section class="panel">
    <div class="panel-heading"><div><h2>C1-C7 scan report</h2><p>The scan temporarily changes only selector 0xD18C. Original selector state, per-slot property reads, restoration, and transport anomalies are recorded without recipe-default fallback.</p></div><span class="panel-code">${failed ? 'REVIEW' : '0xD18C TEMPORARY'}</span></div>
    ${entries.length ? renderDiagnosticEntries(entries, state, expanded) : ''}
    ${slots.length ? `<p class="helper-text">${slots.length} slot record${slots.length === 1 ? '' : 's'} captured. Expand each slot card for raw-property evidence.</p>` : ''}
  </section>`;
}

/** @param {any} report @param {Record<string, any>} state @param {boolean} [expanded] */
function renderBackupSummary(report, state, expanded = false) {
  const model = report.model || report.normalizedModel || 'Not reported';
  const size = report.size ?? report.length ?? report.byteLength;
  const hash = report.sha256 || report.hash;
  const fsSlots = Array.isArray(report.fsSlots) ? report.fsSlots : [];
  const expected = report.expectedSize ?? 70524;
  const safe = report.decodeGate?.passed === true
    && report.decodeGate?.deviceInfoModelIsXe5 === true
    && report.decodeGate?.backupModelIsXe5 === true
    && report.decodeGate?.objectFormatMatches === true
    && report.decodeGate?.declaredSizeMatchesActual === true
    && report.decodeGate?.exactExpectedSize === true
    && normalizeModelText(model) === 'XE5'
    && Number(size) === Number(expected)
    && Number(report.declaredSize) === Number(size)
    && Number(report.objectFormat) === 0x5000
    && report.sessionClosed === true
    && report.interfaceReleased === true;
  const extra = diagnosticEntries(report, { excluded: new Set(['bytes', 'blob', 'data', 'fsSlots', 'slots', 'sha256', 'hash', 'model', 'normalizedModel', 'size', 'length', 'byteLength', 'expectedSize']) });
  return `<section class="panel">
    <div class="panel-heading"><div><h2>Read-only full-backup report</h2><p>Backup bytes remain local and are never rendered. FS1-FS3 decoding is accepted only after exact X-E5 model and length guards.</p></div><span class="panel-code">HANDLE 0</span></div>
    <dl class="summary-list">
      <div><dt>Model</dt><dd>${escapeHtml(model)}</dd></div>
      <div><dt>Exact length</dt><dd>${escapeHtml(size === null || size === undefined ? 'Not reported' : `${size} bytes`)}</dd></div>
      <div><dt>Expected length</dt><dd>${escapeHtml(`${expected} bytes`)}</dd></div>
      <div><dt>SHA-256</dt><dd>${escapeHtml(hash || 'Not calculated')}</dd></div>
      <div><dt>FS decode guard</dt><dd>${safe ? 'Passed' : 'Not passed'}</dd></div>
    </dl>
    <div class="warning-box"><strong>Local sensitive file</strong><p>The downloaded backup can contain the camera serial number. Do not upload, export into the repository, or include it in screenshots.</p></div>
    ${extra.length ? renderDiagnosticEntries(extra, state, expanded) : ''}
    ${fsSlots.length ? `<div class="slot-bank"><div class="slot-bank-heading"><h3>FS1-FS3 decoded values</h3><span>${safe ? 'GUARDS PASSED' : 'DECODE BLOCKED'}</span></div>${safe ? `<div class="slot-grid slot-grid-fs">${fsSlots.map((slot) => renderSlotCard(slot, state)).join('')}</div>` : '<div class="empty-state"><strong>FS decode withheld</strong><span>DeviceInfo, embedded model, object format, exact declared/actual length, session close, and interface release must all pass.</span></div>'}</div>` : ''}
  </section>`;
}

/** @param {Array<{ label: string, key: string, value: any }>} entries @param {Record<string, any>} state @param {boolean} expanded */
function renderDiagnosticEntries(entries, state, expanded) {
  const body = `<dl class="summary-list">${entries.map((entry) => `<div><dt>${escapeHtml(entry.label)}</dt><dd>${renderDiagnosticValue(entry.value, entry.key, state)}</dd></div>`).join('')}</dl>`;
  return entries.length > 14 && !expanded ? `<details><summary>Show ${entries.length} discovered values</summary>${body}</details>` : body;
}

/** @param {any} value @param {string} key @param {Record<string, any>} state */
function renderDiagnosticValue(value, key, state) {
  const list = arrayValues(value);
  if (list) {
    if (!list.length) return '<span>None advertised</span>';
    return `<ul class="compact-list">${list.map((item) => `<li>${formatCapabilityItem(item, key, state)}</li>`).join('')}</ul>`;
  }
  if (typeof value === 'number') {
    if (shouldFormatAsCode(key)) return `<code>${escapeHtml(formatHexCode(value))}</code>`;
    return escapeHtml(value);
  }
  if (value && typeof value === 'object') return `<code>${escapeHtml(safeJson(value, state))}</code>`;
  return escapeHtml(redactKnown(value === null || value === undefined || value === '' ? 'Not reported' : String(value), state));
}

/** @param {any} item @param {string} key @param {Record<string, any>} state */
function formatCapabilityItem(item, key, state) {
  if (typeof item === 'number') {
    const name = capabilityName(item, key);
    return `<code>${escapeHtml(name ? `${name} · ${formatHexCode(item)}` : formatHexCode(item))}</code>`;
  }
  if (typeof item === 'string') {
    const numeric = numberFromCode(item);
    const name = Number.isFinite(numeric) ? capabilityName(numeric, key) : '';
    return `<code>${escapeHtml(name ? `${name} · ${formatHexCode(numeric)}` : redactKnown(item, state))}</code>`;
  }
  if (item && typeof item === 'object') {
    const code = item.code ?? item.value ?? item.endpointNumber;
    const numeric = numberFromCode(code);
    const name = item.symbol || item.name || item.label || (Number.isFinite(numeric) ? capabilityName(numeric, key) : '');
    const suffix = Number.isFinite(numeric) ? formatHexCode(numeric) : '';
    const detail = [name, suffix, item.type, item.direction, item.packetSize ? `${item.packetSize} byte packets` : null].filter(Boolean).join(' · ');
    return `<code>${escapeHtml(redactKnown(detail || safeJson(item, state), state))}</code>`;
  }
  return escapeHtml(redactKnown(String(item ?? 'Not reported'), state));
}

/** @param {Record<string, any>} state */
function renderBusy(state) {
  if (!state.busy) return '';
  return `<div class="busy-banner" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span>${escapeHtml(redactKnown(state.busy, state))}</span></div>`;
}

/** @param {Record<string, any>} state */
function renderToast(state) {
  if (!state.toast) return '';
  const type = ['success', 'error'].includes(state.toast.type) ? state.toast.type : 'info';
  return `<div class="toast toast-${type}" role="status" aria-live="polite"><span>${escapeHtml(redactKnown(state.toast.message || '', state))}</span><button type="button" data-action="dismiss-toast" aria-label="Dismiss notification">×</button></div>`;
}

/** @param {Record<string, any>} state */
function renderModal(state) {
  const modal = state.modal;
  if (!modal) return '';
  const title = modal.title || (modal.type === 'write-review' ? `Review write to ${modal.destination || ''}` : 'Review operation');
  const mutation = modal.type === 'write-review' || modal.type === 'restore-review';
  const requiresAcknowledgement = mutation;
  const usb = isUsbMode(state);
  const confirmationAction = modal.type === 'restore-review' ? 'confirm-restore' : 'confirm-write';
  const confirmationLabel = modal.type === 'restore-review' ? 'Confirm restore' : 'Confirm write';
  const acknowledgementText = modal.acknowledgementLabel || 'I reviewed the exact operation and understand that a response code alone does not prove persistence.';
  const confirmationDisabled = usb || !state.writeAcknowledged || !modal.acknowledged;
  return `<div class="modal-backdrop" role="presentation">
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-heading"><span>${escapeHtml(humanize(modal.type || 'message'))}</span><h2 id="modal-title">${escapeHtml(redactKnown(title, state))}</h2></div>
      ${modal.description ? `<p>${escapeHtml(redactKnown(modal.description, state))}</p>` : ''}
      ${modal.message ? `<p>${escapeHtml(redactKnown(modal.message, state))}</p>` : ''}
      ${renderModalDiff(modal.diff || modal.mismatches)}
      ${listBox('Warnings', modal.warnings, 'warning-box', state)}
      ${requiresAcknowledgement ? `<button type="button" class="check-row" data-action="modal-ack" aria-pressed="${modal.acknowledged ? 'true' : 'false'}"><span aria-hidden="true">${modal.acknowledged ? '☑' : '☐'}</span><span>${escapeHtml(acknowledgementText)}</span></button>` : ''}
      ${usb && mutation ? '<div class="error-box"><strong>Blocked by read-only validation</strong><p>This physical-camera operation cannot be confirmed in the current stage.</p></div>' : ''}
      <div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Close</button>${requiresAcknowledgement ? `<button type="button" class="button button-danger" data-action="${confirmationAction}" ${disabledAttr(confirmationDisabled)}>${confirmationLabel}</button>` : ''}</div>
    </section>
  </div>`;
}

/** @param {any[]} diff */
function renderModalDiff(diff) {
  if (!Array.isArray(diff) || !diff.length) return '';
  return `<div class="modal-diff">${diff.map((item) => {
    const key = item.key || item.label || 'value';
    const before = item.current ?? item.actual ?? null;
    const after = item.next ?? item.expected ?? null;
    return `<div><span>${escapeHtml(item.label || humanize(key))}</span><del>${escapeHtml(valueText(key, before))}</del><strong aria-hidden="true">→</strong><ins>${escapeHtml(valueText(key, after))}</ins><small>${item.writable === false ? 'Reminder only' : item.changed === false ? 'Unchanged' : 'Changed'}</small></div>`;
  }).join('')}</div>`;
}

/** @param {string} title @param {any} values @param {string} className @param {Record<string, any>} state */
function listBox(title, values, className, state) {
  if (!Array.isArray(values) || !values.length) return '';
  return `<div class="${className}"><strong>${escapeHtml(title)}</strong><ul>${values.map((value) => `<li>${escapeHtml(redactKnown(value, state))}</li>`).join('')}</ul></div>`;
}

/** @param {Record<string, any>} state */
function visibleSlots(state) {
  if (Array.isArray(state.slots) && state.slots.length) return state.slots;
  const scanned = Array.isArray(state.scanReport?.slots) ? state.scanReport.slots : Array.isArray(state.scanReport?.cSlots) ? state.scanReport.cSlots : [];
  const fs = Array.isArray(state.backupReport?.fsSlots) ? state.backupReport.fsSlots : [];
  return [...scanned, ...fs];
}

/** @param {Record<string, any>} state */
function currentDestination(state) {
  return visibleSlots(state).find((slot) => slot.id === state.destinationSlotId) ?? null;
}

/** @param {Record<string, any>} state */
function isUsbMode(state) {
  return state.mode === 'usb' || (state.connection?.connected && state.connection?.mock === false);
}

/** @param {any} report */
function reportFailed(report) {
  if (!report) return false;
  if (report.ok === false || report.success === false) return true;
  return /fail|error|abort/i.test(String(report.status || ''));
}

/** @param {any} input */
function normalizeRawProperties(input) {
  if (!input) return [];
  if (input instanceof Map) return [...input.values()];
  if (Array.isArray(input)) return input;
  if (typeof input === 'object') return Object.entries(input).map(([key, value]) => value && typeof value === 'object' ? { code: value.code ?? key, ...value } : { code: key, value });
  return [];
}

/** @param {any} input @param {{ excluded?: Set<string> }} [options] */
function diagnosticEntries(input, options = {}) {
  const entries = [];
  const excluded = options.excluded ?? new Set();
  walkDiagnostic(input, '', entries, excluded, 0);
  return entries;
}

/** @param {any} input @param {string} path @param {Array<{ label: string, key: string, value: any }>} entries @param {Set<string>} excluded @param {number} depth */
function walkDiagnostic(input, path, entries, excluded, depth) {
  if (!input || typeof input !== 'object' || depth > 5) return;
  const source = input instanceof Map ? Object.fromEntries(input) : input;
  for (const [key, value] of Object.entries(source)) {
    if (excluded.has(key) || SENSITIVE_KEY.test(key) || BINARY_KEY.test(key)) continue;
    const nextPath = path ? `${path} / ${humanize(key)}` : humanize(key);
    if (value && typeof value === 'object' && !arrayValues(value) && !isCapabilityObject(value) && depth < 5) {
      walkDiagnostic(value, nextPath, entries, excluded, depth + 1);
    } else {
      entries.push({ label: nextPath, key, value });
    }
  }
}

/** @param {any} value */
function isCapabilityObject(value) {
  return value && typeof value === 'object' && ('code' in value || 'endpointNumber' in value || 'symbol' in value);
}

/** @param {any} value */
function arrayValues(value) {
  if (Array.isArray(value)) return value;
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) return Array.from(value);
  return null;
}

/** @param {number} code @param {string} key */
function capabilityName(code, key) {
  if (/operation/i.test(key)) return PTP_OPERATION_NAMES.get(code) || (code >= 0x9000 ? 'Fujifilm vendor operation' : 'PTP operation');
  if (/event/i.test(key)) return PTP_EVENT_NAMES.get(code) || (code >= 0xc000 ? 'Fujifilm vendor event' : 'PTP event');
  if (/propert/i.test(key)) return X_E5_PROPERTY_NAMES.get(code) || (code >= 0xd000 ? 'Fujifilm vendor property' : 'PTP property');
  return '';
}

/** @param {string} key */
function shouldFormatAsCode(key) {
  return /vendorId|productId|class|subclass|protocol|endpoint|operation|event|propert|code/i.test(key);
}

/** @param {any} value */
function numberFromCode(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return Number.NaN;
  if (/^0x[0-9a-f]+$/i.test(value.trim())) return Number.parseInt(value.trim().slice(2), 16);
  if (/^\d+$/.test(value.trim())) return Number(value);
  return Number.NaN;
}

/** @param {any} value */
function formatHexCode(value) {
  const numeric = numberFromCode(value);
  if (!Number.isFinite(numeric)) return String(value ?? 'Unknown');
  const width = numeric <= 0xff ? 2 : numeric <= 0xffff ? 4 : 8;
  return `0x${Math.trunc(numeric).toString(16).toUpperCase().padStart(width, '0')}`;
}

/** @param {any} bytes */
function byteLength(bytes) {
  if (!bytes) return null;
  if (typeof bytes.byteLength === 'number') return bytes.byteLength;
  if (Array.isArray(bytes)) return bytes.length;
  return null;
}

/** @param {any} input */
function bytesToHex(input) {
  if (!input) return '';
  let bytes;
  if (input instanceof Uint8Array) bytes = input;
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else if (ArrayBuffer.isView(input)) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  else if (Array.isArray(input)) bytes = Uint8Array.from(input);
  else return '';
  return [...bytes].map((value) => value.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

/** @param {any} value @param {number|null} [payloadWidth] */
function displayRawValue(value, payloadWidth = null) {
  if (value === null || value === undefined) return 'Not decoded';
  if (value === '') return 'Empty string';
  if (typeof value === 'number') {
    if (value < 0 && Number.isInteger(value)) {
      const width = Number.isInteger(payloadWidth) && payloadWidth > 0 && payloadWidth <= 6 ? payloadWidth : 2;
      const modulus = 2 ** (width * 8);
      const unsigned = ((value % modulus) + modulus) % modulus;
      return `${value} (0x${unsigned.toString(16).toUpperCase().padStart(width * 2, '0')})`;
    }
    return `${value} (${formatHexCode(value)})`;
  }
  if (typeof value === 'object') return safeJson(value, {});
  return String(value);
}

/** @param {string} text @param {Record<string, any>} state */
function redactKnown(text, state) {
  let output = String(text ?? '');
  const serial = state?.connection?.serialNumber;
  if (typeof serial === 'string' && serial && !/^REDACTED/i.test(serial)) output = output.split(serial).join('[redacted]');
  return output;
}

/** @param {any} value @param {Record<string, any>} state */
function safeJson(value, state) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (key, item) => {
      if (SENSITIVE_KEY.test(key)) return '[redacted]';
      if (BINARY_KEY.test(key) || item instanceof ArrayBuffer || ArrayBuffer.isView(item)) return '[binary omitted]';
      if (item && typeof item === 'object') {
        if (seen.has(item)) return '[circular]';
        seen.add(item);
      }
      return typeof item === 'string' ? redactKnown(item, state) : item;
    });
  } catch {
    return '[unavailable]';
  }
}

/** @param {any[]} logs @param {Record<string, any>} state */
function formatLogs(logs, state) {
  return logs.map((entry) => {
    const time = entry?.time ? `[${entry.time}] ` : '';
    const message = redactKnown(entry?.message || String(entry ?? ''), state);
    const detail = entry?.detail === null || entry?.detail === undefined ? '' : ` ${safeJson(entry.detail, state)}`;
    return `${time}${message}${detail}`;
  }).join('\n');
}

/** @param {any} values */
function isoReminder(values) {
  if (String(values.isoMode).toLowerCase() === 'auto') {
    if (values.isoMin && values.isoMax) return `Auto ISO ${values.isoMin}-${values.isoMax}`;
    if (values.isoMax) return `Auto ISO up to ${values.isoMax}`;
    return 'Auto ISO';
  }
  if (values.isoFixed) return `ISO ${values.isoFixed}`;
  if (values.isoMode) return String(values.isoMode);
  return 'Not provided';
}

/** @param {any} values */
function exposureReminder(values) {
  if (values.exposureMinEv !== null && values.exposureMinEv !== undefined && values.exposureMaxEv !== null && values.exposureMaxEv !== undefined) return `${signedText(values.exposureMinEv)} to ${signedText(values.exposureMaxEv)} EV`;
  if (values.exposureTypical !== null && values.exposureTypical !== undefined) return `${signedText(values.exposureTypical)} EV typical`;
  return 'Not provided';
}

/** @param {any} value */
function signedText(value) {
  if (value === null || value === undefined || value === '') return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric > 0 ? `+${numeric}` : String(numeric);
}

/** @param {any} value */
function numericOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

/** @param {any} value */
function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/** @param {any} value */
function formatPercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric * 100)}%` : 'Not reported';
}

/** @param {any} value */
function humanize(value) {
  return String(value ?? '')
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase());
}

/** @param {any} value */
function formatDate(value) {
  if (!value) return 'Date not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** @param {any} value */
function formatByteCount(value) {
  const size = Number(value);
  return Number.isFinite(size) ? `${size.toLocaleString('en-GB')} bytes` : 'size unknown';
}

/** @param {any} value */
function shortHash(value) {
  const hash = String(value || 'not calculated');
  return hash.length > 28 ? `${hash.slice(0, 14)}…${hash.slice(-10)}` : hash;
}

/** @param {any} model */
function normalizeModelText(model) {
  return String(model || '').toUpperCase().replace(/FUJIFILM/g, '').replace(/[^A-Z0-9]/g, '');
}

/** @param {number} min @param {number} max @param {number} step */
function makeNumberRange(min, max, step) {
  const output = [];
  for (let value = min; value <= max + Number.EPSILON; value += step) output.push(Number(value.toFixed(6)));
  return output;
}

/** @param {number} first @param {number} second */
function numberEquivalent(first, second) {
  return Math.abs(first - second) < 0.0001;
}

/** @param {boolean} disabled */
function disabledAttr(disabled) {
  return disabled ? 'disabled' : '';
}
