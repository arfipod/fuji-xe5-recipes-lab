import test from 'node:test';
import assert from 'node:assert/strict';

import {
  concatBytes,
  encodePtpString,
  packU16,
} from '../src/camera/binary.js';
import {
  PTP_PROP,
  PRESET_PROP_RANGE,
  X_E5_FS_LAYOUT,
} from '../src/camera/x-e5-codecs.js';
import {
  PTP_OP,
  PTP_PURPOSE,
  PTP_RESPONSE,
  PtpResponseError,
} from '../src/camera/ptp.js';
import {
  Xe5CameraClient,
  serializeSlotSnapshot,
} from '../src/camera/x-e5-client.js';

const SECRET_SERIAL = 'SECRET-XE5-SERIAL-998877';
const SLOT_PROPERTY_CODES = Array.from(
  { length: PRESET_PROP_RANGE.last - PTP_PROP.PRESET_NAME + 1 },
  (_, index) => PTP_PROP.PRESET_NAME + index,
);
const ALL_READ_OPERATIONS = [
  PTP_OP.OPEN_SESSION,
  PTP_OP.CLOSE_SESSION,
  PTP_OP.GET_DEVICE_PROP_VALUE,
  PTP_OP.SET_DEVICE_PROP_VALUE,
  PTP_OP.GET_OBJECT_INFO,
  PTP_OP.GET_OBJECT,
];

class FakeReadOnlyTransport {
  constructor(options = {}) {
    this.calls = [];
    this.transactionId = 0;
    this.transactionSequence = 0;
    this.transactionDiagnostics = [];
    this.sessionSequence = 0;
    this.activeSessionSequence = 0;
    this.sessionOpen = false;
    this.selected = options.selected ?? 4;
    this.selectorBytes = options.selectorBytes ?? null;
    this.slotName = options.slotName ?? ((selected) => `SLOT ${selected}`);
    this.selectorResponses = options.selectorResponses ?? new Map();
    this.failReads = options.failReads ?? new Map();
    this.propertyPayloads = options.propertyPayloads ?? new Map();
    this.closeOnFatalRead = options.closeOnFatalRead ?? false;
    this.device = {
      opened: true,
      vendorId: 0x04cb,
      productId: 0x0313,
      serialNumber: SECRET_SERIAL,
    };
    this.deviceInfo = {
      standardVersion: 100,
      vendorExtensionId: 0x0000000e,
      vendorExtensionVersion: 100,
      vendorExtensionDescription: 'FUJIFILM extension',
      functionalMode: 0,
      operations: [...(options.operations ?? ALL_READ_OPERATIONS)],
      events: [0x4006],
      properties: [...(options.properties ?? [PTP_PROP.PRESET_SLOT, ...SLOT_PROPERTY_CODES])],
      captureFormats: [],
      imageFormats: [0x3801],
      manufacturer: 'FUJIFILM',
      model: options.model ?? 'FUJIFILM X-E5',
      deviceVersion: '1.00',
      serialNumber: SECRET_SERIAL,
    };
    this.sessionDeviceInfo = options.sessionDeviceInfo ?? null;
    this.backup = options.backup ?? makeBackup();
    this.objectInfo = options.objectInfo ?? makeObjectInfo(this.backup.byteLength);
    this.usbDiagnostics = {
      vendorId: 0x04cb,
      productId: 0x0313,
      manufacturerName: 'FUJIFILM',
      productName: 'X-E5',
      configurationValue: 1,
      interfaceNumber: 0,
      interfaceClass: 6,
      interfaceSubclass: 1,
      interfaceProtocol: 1,
      bulkIn: { endpointNumber: 1, direction: 'in', type: 'bulk', packetSize: 512 },
      bulkOut: { endpointNumber: 2, direction: 'out', type: 'bulk', packetSize: 512 },
      eventIn: { endpointNumber: 3, direction: 'in', type: 'interrupt', packetSize: 64 },
      serialNumber: SECRET_SERIAL,
      nested: { cameraSerial: SECRET_SERIAL, harmless: `redact ${SECRET_SERIAL}` },
    };
  }

  async requestAndConnect() {
    this.calls.push({ method: 'requestAndConnect' });
    return this.device;
  }

  async getDeviceInfo() {
    this.calls.push({ method: 'getDeviceInfo' });
    this.recordTransaction('GET_DEVICE_INFO', PTP_RESPONSE.OK, true);
    return structuredClone(this.sessionOpen && this.sessionDeviceInfo ? this.sessionDeviceInfo : this.deviceInfo);
  }

  getUsbDiagnostics() {
    return this.device.opened ? structuredClone(this.usbDiagnostics) : null;
  }

  getLastUsbDiagnostics() {
    return structuredClone(this.usbDiagnostics);
  }

  async openSession() {
    this.calls.push({ method: 'openSession' });
    if (!this.device.opened) throw disconnectedTransportError();
    this.sessionSequence += 1;
    this.activeSessionSequence = this.sessionSequence;
    this.transactionId = 0;
    this.recordTransaction('OPEN_SESSION', PTP_RESPONSE.OK, false, null, { transactionId: 0 });
    this.sessionOpen = true;
  }

  async closeSession() {
    this.calls.push({ method: 'closeSession' });
    this.recordTransaction('CLOSE_SESSION', PTP_RESPONSE.OK, false);
    this.sessionOpen = false;
    this.activeSessionSequence = 0;
  }

  async withFreshSession(task) {
    await this.openSession();
    try {
      return await task(this);
    } finally {
      await this.closeSession();
    }
  }

  async getPropertyRaw(code) {
    this.calls.push({ method: 'getPropertyRaw', code, selected: this.selected });
    if (!this.device.opened) throw disconnectedTransportError();
    const failure = this.failReads.get(`${this.selected}:${code}`) ?? this.failReads.get(`*:${code}`);
    if (failure) {
      const error = typeof failure === 'function' ? failure() : failure;
      if (this.closeOnFatalRead && error?.name === 'PtpTransportError') {
        this.sessionOpen = false;
        this.device.opened = false;
      }
      throw error;
    }
    const customPayload = this.propertyPayloads.get(`${this.selected}:${code}`) ?? this.propertyPayloads.get(`*:${code}`);
    if (customPayload) return new Uint8Array(customPayload);
    if (code === PTP_PROP.PRESET_SLOT) return this.selectorBytes ? new Uint8Array(this.selectorBytes) : packU16(this.selected);
    if (code === PTP_PROP.PRESET_NAME) {
      const name = typeof this.slotName === 'function' ? this.slotName(this.selected) : this.slotName;
      return encodePtpString(name);
    }
    if (code === PTP_PROP.UNKNOWN_D1A5) return new Uint8Array([this.selected, 0x23, 0x45, 0x67]);
    return packU16((code + this.selected) & 0xffff);
  }

  async getPropertyRawWithMetadata(code) {
    const transactionId = this.transactionId + 1;
    try {
      const bytes = await this.getPropertyRaw(code);
      this.recordTransaction('GET_DEVICE_PROP_VALUE', PTP_RESPONSE.OK, true);
      return {
        bytes,
        transactionId,
        responseCode: PTP_RESPONSE.OK,
        responseName: 'OK',
        operationName: 'GET_DEVICE_PROP_VALUE',
      };
    } catch (error) {
      const responseCode = Number(error?.responseCode) || null;
      this.recordTransaction('GET_DEVICE_PROP_VALUE', responseCode, null, error?.code ?? null);
      if (error && typeof error === 'object') {
        error.transactionId ??= transactionId;
        error.operationName ??= 'GET_DEVICE_PROP_VALUE';
        error.propertyCode ??= code;
      }
      throw error;
    }
  }

  async setPropertyU16(code, value, options) {
    this.calls.push({ method: 'setPropertyU16', code, value, options: { ...options } });
    if (!this.device.opened) throw disconnectedTransportError();
    if (code !== PTP_PROP.PRESET_SLOT || options?.purpose !== PTP_PURPOSE.C_SLOT_SELECTOR) {
      throw new Error('Fake transport rejected an unauthorized property write.');
    }
    this.selectorBytes = null;
    this.selected = value;
    return this.selectorResponses.get(value) ?? PTP_RESPONSE.OK;
  }

  async setPropertyU16WithMetadata(code, value, options) {
    const transactionId = this.transactionId + 1;
    const responseCode = await this.setPropertyU16(code, value, options);
    this.recordTransaction('SET_DEVICE_PROP_VALUE', responseCode, true);
    return {
      transactionId,
      responseCode,
      responseName: responseCode === PTP_RESPONSE.OK ? 'OK' : `PTP 0x${responseCode.toString(16).toUpperCase()}`,
      operationName: 'SET_DEVICE_PROP_VALUE',
    };
  }

  async getObjectInfo(handle) {
    this.calls.push({ method: 'getObjectInfo', handle });
    this.recordTransaction('GET_OBJECT_INFO', PTP_RESPONSE.OK, true);
    return new Uint8Array(this.objectInfo);
  }

  async getObject(handle) {
    this.calls.push({ method: 'getObject', handle });
    this.recordTransaction('GET_OBJECT', PTP_RESPONSE.OK, true);
    return new Uint8Array(this.backup);
  }

  async releaseAfterFailure(error) {
    this.calls.push({ method: 'releaseAfterFailure', message: error.message });
    this.sessionOpen = false;
    this.transactionId = 0;
    this.activeSessionSequence = 0;
    this.device.opened = false;
  }

  async closeDevice(options) {
    this.calls.push({ method: 'closeDevice', options });
    this.sessionOpen = false;
    this.transactionId = 0;
    this.activeSessionSequence = 0;
    this.device.opened = false;
  }

  async reopen() {
    this.calls.push({ method: 'reopen' });
    this.sessionOpen = false;
    this.transactionId = 0;
    this.activeSessionSequence = 0;
    this.device.opened = true;
  }

  getTransactionCursor() {
    return this.transactionSequence;
  }

  getTransactionDiagnostics(sinceSequence = 0) {
    return this.transactionDiagnostics
      .filter((item) => item.sequence > sinceSequence)
      .map((item) => ({ ...item }));
  }

  recordTransaction(operationName, responseCode, dataPhaseReceived, errorCode = null, options = {}) {
    const transactionId = options.transactionId ?? this.transactionId + 1;
    this.transactionId = transactionId;
    this.transactionSequence += 1;
    this.transactionDiagnostics.push({
      sequence: this.transactionSequence,
      sessionSequence: this.activeSessionSequence,
      transactionId,
      operationName,
      responseCode,
      responseName: responseCode === null ? null : responseCode === PTP_RESPONSE.OK ? 'OK' : `PTP 0x${responseCode.toString(16).toUpperCase()}`,
      responseParams: [],
      dataPhaseReceived,
      status: responseCode === PTP_RESPONSE.OK ? 'OK' : responseCode === null ? 'TRANSPORT_ERROR' : 'PTP_RESPONSE',
      errorCode,
    });
  }
}

test('connect performs bounded in-session discovery and omits the full serial at every client boundary', async () => {
  const logs = [];
  const transport = new FakeReadOnlyTransport();
  const client = makeClient(transport, (message, detail) => logs.push({ message, detail }));

  const connection = await client.connect();
  const discovery = client.getDiscoveryReport();

  assert.equal(connection.connected, true);
  assert.equal(connection.normalizedModel, 'XE5');
  assert.equal(connection.supportsCSlotScan, true);
  assert.equal(discovery.stage, 'DISCOVERY_ONLY');
  assert.equal(discovery.sessionOpened, true);
  assert.equal(discovery.sessionCurrentlyOpen, false);
  assert.equal(discovery.sessionClosedAfterCapabilityProbe, true);
  assert.equal(discovery.recipeSelectorAdvertised, true);
  assert.equal(discovery.transactionSummary.metadataComplete, true);
  assert.equal(discovery.transactionSummary.strictlyIncreasing, true);
  assert.equal(discovery.transactionSummary.standardsCompliant, true);
  assert.deepEqual(discovery.transactions.map((item) => item.transactionId), [0, 1, 2]);
  assert.deepEqual(transport.calls.map((call) => call.method), ['requestAndConnect', 'openSession', 'getDeviceInfo', 'closeSession']);
  assertNoSerialBoundary(connection);
  assertNoSerialBoundary(discovery);
  assertNoSerialBoundary(logs);
});

test('connect rejects a non-X-E5 body and releases the claimed interface without exposing its serial', async () => {
  const transport = new FakeReadOnlyTransport({ model: 'FUJIFILM X-T5' });
  const client = makeClient(transport);

  await assert.rejects(client.connect(), /locked to the Fujifilm X-E5/);
  assert.equal(transport.calls.some((call) => call.method === 'releaseAfterFailure'), true);
  assert.equal(client.getConnectionInfo().connected, false);
  assertNoSerialBoundary(transport.calls);
});

test('connect uses only the in-session DeviceInfo capability dataset', async () => {
  const initialProperties = [PTP_PROP.PRESET_NAME];
  const transport = new FakeReadOnlyTransport({ properties: initialProperties });
  transport.sessionDeviceInfo = {
    ...structuredClone(transport.deviceInfo),
    properties: [PTP_PROP.PRESET_SLOT, ...SLOT_PROPERTY_CODES],
  };
  const client = makeClient(transport);

  const connection = await client.connect();
  const discovery = client.getDiscoveryReport();

  assert.equal(connection.recipeSelectorAdvertised, true);
  assert.equal(connection.supportsCSlotScan, true);
  assert.equal(discovery.capabilityProbe.attempted, true);
  assert.equal(discovery.capabilityProbe.selectorAdvertisedBefore, null);
  assert.equal(discovery.capabilityProbe.selectorAdvertisedAfter, true);
  assert.equal(discovery.capabilityProbe.sessionClosed, true);
  assert.equal(discovery.sessionOpened, true);
  assert.equal(discovery.sessionCurrentlyOpen, false);
  assert.equal(discovery.sessionClosedAfterCapabilityProbe, true);
  assert.equal(discovery.initialDeviceInfo.properties.includes(PTP_PROP.PRESET_SLOT), true);
  assert.equal(discovery.deviceInfo.properties.includes(PTP_PROP.PRESET_SLOT), true);
  assert.deepEqual(
    transport.calls.map((call) => call.method),
    ['requestAndConnect', 'openSession', 'getDeviceInfo', 'closeSession'],
  );
  assertNoSerialBoundary(discovery);
});

test('a failed in-session DeviceInfo read retains redacted transaction evidence', async () => {
  const transport = new FakeReadOnlyTransport({ properties: [PTP_PROP.PRESET_NAME] });
  transport.getDeviceInfo = async function getDeviceInfoWithProbeFailure() {
    this.calls.push({ method: 'getDeviceInfo' });
    const transactionId = this.transactionId + 1;
    this.recordTransaction('GET_DEVICE_INFO', PTP_RESPONSE.ACCESS_DENIED, false);
    throw new PtpResponseError(
      PTP_RESPONSE.ACCESS_DENIED,
      'GetDeviceInfo',
      transactionId,
      'GET_DEVICE_INFO',
    );
  };
  const client = makeClient(transport);

  await assert.rejects(client.connect(), /ACCESS_DENIED/);
  const discovery = client.getDiscoveryReport();
  assert.equal(discovery.stage, 'DISCOVERY_FAILED');
  assert.equal(discovery.deviceInfo, null);
  assert.equal(discovery.recipeSelectorAdvertised, false);
  assert.equal(discovery.capabilityProbe.attempted, true);
  assert.equal(discovery.failure.transactionId > 0, true);
  assert.equal(discovery.transactionSummary.strictlyIncreasing, true);
  assert.equal(discovery.interfaceReleaseAttempted, true);
  assert.equal(discovery.interfaceReleasedAfterFailure, true);
  assert.equal(client.getConnectionInfo().connected, false);
  assertNoSerialBoundary(discovery);
});

test('C-slot capability gates require advertised 0xD18C and required read operations before a session opens', async () => {
  const transport = new FakeReadOnlyTransport({
    properties: SLOT_PROPERTY_CODES,
    operations: ALL_READ_OPERATIONS.filter((code) => code !== PTP_OP.SET_DEVICE_PROP_VALUE),
  });
  const client = makeClient(transport);
  const connection = await client.connect();
  const sessionProbeCount = transport.calls.filter((call) => call.method === 'openSession').length;

  assert.equal(connection.supportsCSlotScan, false);
  assert.equal(connection.interfaceReleased, true);
  const discovery = client.getDiscoveryReport();
  assert.equal(discovery.capabilityProbe.interfaceReleaseRequired, true);
  assert.equal(discovery.capabilityProbe.interfaceReleased, true);
  assert.equal(discovery.usb.vendorId, 0x04cb);
  assert.equal(discovery.usb.productId, 0x0313);
  assert.equal(transport.calls.filter((call) => call.method === 'closeDevice').length, 1);
  await assert.rejects(client.scanCSlots(), /must advertise property 0xD18C/);
  assert.equal(transport.calls.filter((call) => call.method === 'openSession').length, sessionProbeCount);
});

test('scanCSlots starts with the original slot, reports every raw width, and restores 0xD18C in one session', async () => {
  const transport = new FakeReadOnlyTransport({ selected: 4 });
  const client = makeClient(transport);
  await client.connect();

  const report = await client.scanCSlots();

  assert.equal(report.complete, true);
  assert.equal(report.stageGatePassed, true);
  assert.equal(report.ok, true);
  assert.equal(report.sessionClosed, true);
  assert.equal(report.interfaceReleased, true);
  assert.equal(report.interfaceReleaseAttempted, true);
  assert.equal(report.transactionSummary.metadataComplete, true);
  assert.equal(report.transactionSummary.strictlyIncreasing, true);
  assert.equal(report.transactionSummary.openSessionTransactionIdsValid, true);
  assert.equal(report.transactionSummary.perSessionStrictlyIncreasing, true);
  assert.equal(report.transactions[0].operationName, 'OPEN_SESSION');
  assert.equal(report.transactions[0].transactionId, 0);
  assert.equal(report.originalSelector.value, 4);
  assert.equal(report.originalSelector.operationName, 'GET_DEVICE_PROP_VALUE');
  assert.equal(Number.isInteger(report.originalSelector.transactionId), true);
  assert.equal(report.originalSelector.responseCode, PTP_RESPONSE.OK);
  assert.equal(report.sessionCapability.confirmedBeforeSelectorAccess, true);
  const scanOpen = transport.calls.findIndex((call) => call.method === 'openSession');
  assert.equal(transport.calls[scanOpen + 1].method, 'getDeviceInfo');
  assert.deepEqual(report.scanOrder, [4, 1, 2, 3, 5, 6, 7]);
  assert.equal(report.selectorTransitions.length, 7);
  assert.equal(report.selectorTransitions[0].from, 4);
  assert.equal(report.selectorTransitions[0].to, 4);
  assert.equal(report.selectorTransitions.every((item) => item.responseCode === PTP_RESPONSE.OK), true);
  assert.equal(report.selectorTransitions.every((item) => item.payloadWidth === 2), true);
  assert.equal(report.selectorTransitions.every((item) => Number.isInteger(item.writeTransactionId)), true);
  assert.equal(report.selectorTransitions.every((item) => Number.isInteger(item.readTransactionId)), true);
  assert.equal(report.selectorTransitions.every((item) => item.readBackAttempts.length >= 1), true);
  assert.equal(report.restoration.confirmed, true);
  assert.equal(report.restoration.writeAttempted, true);
  assert.equal(report.restoration.confirmedPayloadWidth, 2);
  assert.equal(report.restoration.confirmedRawHex, '04 00');
  assert.equal(Number.isInteger(report.restoration.preRestoreTransactionId), true);
  assert.equal(Number.isInteger(report.restoration.writeTransactionId), true);
  assert.equal(Number.isInteger(report.restoration.readTransactionId), true);
  assert.equal(transport.calls.filter((call) => call.method === 'openSession').length, 2);
  assert.equal(transport.calls.filter((call) => call.method === 'closeSession').length, 2);
  assert.equal(client.getConnectionInfo().connected, true);
  assert.equal(client.getConnectionInfo().interfaceClaimed, false);
  assert.equal(client.getConnectionInfo().interfaceReleased, true);
  assert.deepEqual(report.slots.map((slot) => slot.id), ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']);

  const writes = transport.calls.filter((call) => call.method === 'setPropertyU16');
  assert.deepEqual(writes.map((call) => call.value), [4, 1, 2, 3, 5, 6, 7, 4]);
  assert.equal(writes.every((call) => call.code === PTP_PROP.PRESET_SLOT), true);
  assert.equal(writes.every((call) => call.options.purpose === PTP_PURPOSE.C_SLOT_SELECTOR), true);

  for (const slot of report.slots) {
    assert.equal(slot.rawProperties.size, SLOT_PROPERTY_CODES.length);
    assert.equal(slot.rawProperties.get(PTP_PROP.PRESET_NAME).payloadWidth, encodePtpString(`SLOT ${slot.index}`).byteLength);
    assert.equal(slot.rawProperties.get(PTP_PROP.PRESET_NAME).operationName, 'GET_DEVICE_PROP_VALUE');
    assert.equal(Number.isInteger(slot.rawProperties.get(PTP_PROP.PRESET_NAME).transactionId), true);
    assert.equal(slot.rawProperties.get(PTP_PROP.PRESET_NAME).responseCode, PTP_RESPONSE.OK);
    const passthrough = slot.rawProperties.get(PTP_PROP.UNKNOWN_D1A5);
    assert.equal(passthrough.payloadWidth, 4);
    assert.equal(passthrough.readStatus, 'PASSTHROUGH');
    assert.deepEqual([...passthrough.bytes], [slot.index, 0x23, 0x45, 0x67]);
  }

  const serialized = serializeSlotSnapshot(report.slots[0]);
  assert.equal(Array.isArray(serialized.rawProperties), true);
  assert.equal(typeof serialized.rawProperties[0].bytesBase64, 'string');
  assert.equal(JSON.stringify(serialized).includes('rawProperties":{}'), false);
});

test('an unavailable slot-name property is reported without inventing a C-slot name or recipe default', async () => {
  const transport = new FakeReadOnlyTransport({
    properties: [PTP_PROP.PRESET_SLOT, ...SLOT_PROPERTY_CODES.filter((code) => code !== PTP_PROP.PRESET_NAME)],
    failReads: new Map([[
      `2:${PTP_PROP.PRESET_NAME}`,
      new PtpResponseError(PTP_RESPONSE.DEVICE_PROP_NOT_SUPPORTED, 'GetDevicePropValue(0xD18D)'),
    ]]),
  });
  const client = makeClient(transport);
  await client.connect();

  const report = await client.scanCSlots();
  const c2 = report.slots.find((slot) => slot.id === 'C2');

  assert.equal(report.complete, true);
  assert.equal(c2.name, null);
  assert.equal(c2.rawProperties.get(PTP_PROP.PRESET_NAME).readStatus, 'UNSUPPORTED');
  assert.equal(c2.rawProperties.get(PTP_PROP.PRESET_NAME).payloadWidth, null);
  assert.equal(c2.rawProperties.get(PTP_PROP.PRESET_NAME).operationName, 'GET_DEVICE_PROP_VALUE');
  assert.equal(Number.isInteger(c2.rawProperties.get(PTP_PROP.PRESET_NAME).transactionId), true);
  assert.equal(c2.rawProperties.get(PTP_PROP.PRESET_NAME).responseCode, PTP_RESPONSE.DEVICE_PROP_NOT_SUPPORTED);
  assert.equal(c2.rawProperties.get(PTP_PROP.PRESET_NAME).responseName, 'DEVICE_PROP_NOT_SUPPORTED');
  assert.equal(c2.values.filmSimulation, null);
});

test('a terminal Fujifilm 0x200F property response is preserved without aborting the staged scan', async () => {
  const transport = new FakeReadOnlyTransport({
    failReads: new Map([[
      `5:${PTP_PROP.D_RANGE_PRIORITY}`,
      new PtpResponseError(PTP_RESPONSE.ACCESS_DENIED, 'GetDevicePropValue(0xD19F)'),
    ]]),
  });
  const client = makeClient(transport);
  await client.connect();

  const report = await client.scanCSlots();
  const property = report.slots.find((slot) => slot.id === 'C5').rawProperties.get(PTP_PROP.D_RANGE_PRIORITY);

  assert.equal(report.complete, true);
  assert.equal(report.allReadsSuccessful, false);
  assert.equal(report.stageGatePassed, false);
  assert.equal(report.ok, false);
  assert.equal(report.status, 'COMPLETE_WITH_UNAVAILABLE_PROPERTIES');
  assert.equal(property.readStatus, 'ACCESS_DENIED');
  assert.equal(property.operationName, 'GET_DEVICE_PROP_VALUE');
  assert.equal(Number.isInteger(property.transactionId), true);
  assert.equal(property.responseCode, PTP_RESPONSE.ACCESS_DENIED);
  assert.equal(property.responseName, 'ACCESS_DENIED');
  assert.match(property.uncertainty, /may overload/);
  assert.equal(report.restoration.confirmed, true);
  assert.equal(report.sessionClosed, true);
  assert.equal(report.interfaceReleaseAttempted, true);
  assert.equal(report.interfaceReleasedAfterFailure, true);
  assert.equal(client.getConnectionInfo().connected, false);
  await assert.rejects(client.readFullBackup(), /not connected/);
  assert.equal(transport.calls.some((call) => call.method === 'getObjectInfo'), false);
  assert.equal(transport.calls.some((call) => call.method === 'getObject'), false);
});

test('a zero-byte passthrough payload is short data and cannot pass the later-stage gate', async () => {
  const transport = new FakeReadOnlyTransport({
    propertyPayloads: new Map([[`2:${PTP_PROP.UNKNOWN_D1A5}`, new Uint8Array()]]),
  });
  const client = makeClient(transport);
  await client.connect();

  const report = await client.scanCSlots();
  const property = report.slots.find((slot) => slot.id === 'C2').rawProperties.get(PTP_PROP.UNKNOWN_D1A5);

  assert.equal(property.payloadWidth, 0);
  assert.equal(property.readStatus, 'SHORT_PAYLOAD');
  assert.equal(report.stageGatePassed, false);
  assert.equal(report.interfaceReleasedAfterFailure, true);
  assert.equal(client.getConnectionInfo().connected, false);
});

test('a fresh scan session must re-advertise 0xD18C before any selector property access', async () => {
  const transport = new FakeReadOnlyTransport();
  const client = makeClient(transport);
  await client.connect();
  transport.sessionDeviceInfo = {
    ...structuredClone(transport.deviceInfo),
    properties: SLOT_PROPERTY_CODES,
  };

  const report = await client.scanCSlots();

  assert.equal(report.status, 'FAILED');
  assert.equal(report.sessionCapability.selectorAdvertised, false);
  assert.equal(report.sessionCapability.confirmedBeforeSelectorAccess, false);
  assert.equal(report.interfaceReleaseAttempted, true);
  assert.equal(report.interfaceReleasedAfterFailure, true);
  assert.equal(transport.calls.some((call) => call.method === 'getPropertyRaw'), false);
  assert.equal(transport.calls.some((call) => call.method === 'setPropertyU16'), false);
  assert.equal(client.getConnectionInfo().connected, false);
});

test('a non-OK selector response is read back, aborted, and restored before release', async () => {
  const transport = new FakeReadOnlyTransport({
    selected: 4,
    selectorResponses: new Map([[1, PTP_RESPONSE.ACCESS_DENIED]]),
  });
  const client = makeClient(transport);
  await client.connect();

  const report = await client.scanCSlots();
  const calls = transport.calls;
  const deniedWrite = calls.findIndex((call) => call.method === 'setPropertyU16' && call.value === 1);
  const firstReadAfterDenied = calls.slice(deniedWrite + 1).find((call) => call.method === 'getPropertyRaw');

  assert.equal(report.status, 'FAILED');
  assert.equal(firstReadAfterDenied.code, PTP_PROP.PRESET_SLOT);
  assert.equal(firstReadAfterDenied.selected, 1);
  assert.equal(report.restoration.confirmed, true);
  assert.equal(calls.filter((call) => call.method === 'setPropertyU16').at(-1).value, 4);
  assert.equal(report.interfaceReleasedAfterFailure, true);
  assert.equal(client.getConnectionInfo().connected, false);
  assert.match(report.anomalies[0].message, /ACCESS_DENIED/);
});

test('serial-bearing PTP string bytes are omitted at the scan-report boundary', async () => {
  const transport = new FakeReadOnlyTransport({ slotName: SECRET_SERIAL });
  const client = makeClient(transport);
  await client.connect();

  const report = await client.scanCSlots();
  const name = report.slots[0].rawProperties.get(PTP_PROP.PRESET_NAME);
  const serialPayloadHex = [...encodePtpString(SECRET_SERIAL)]
    .map((value) => value.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ');

  assert.equal(name.bytes, null);
  assert.equal(name.payloadRedacted, true);
  assert.match(name.rawHex, /REDACTED/);
  assert.equal(name.payloadWidth, encodePtpString(SECRET_SERIAL).byteLength);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(SECRET_SERIAL));
  assert.notEqual(name.rawHex, serialPayloadHex);
});

test('scanCSlots records a fatal transport status, restores the original selector, and releases after cleanup', async () => {
  const timeout = new Error(`bulk IN timed out for ${SECRET_SERIAL}`);
  timeout.name = 'PtpTransportError';
  timeout.code = 'USB_READ_TIMEOUT';
  const transport = new FakeReadOnlyTransport({
    selected: 4,
    closeOnFatalRead: true,
    failReads: new Map([[`3:${PTP_PROP.DYNAMIC_RANGE}`, timeout]]),
  });
  const client = makeClient(transport);
  await client.connect();

  const report = await client.scanCSlots();

  assert.equal(report.complete, false);
  assert.equal(report.status, 'FAILED');
  assert.equal(report.restoration.confirmed, true);
  assert.equal(report.restoration.recoveryAttempted, true);
  assert.equal(report.restoration.recoveredOnFreshConnection, true);
  assert.equal(report.interfaceReleasedAfterFailure, true);
  assert.equal(client.getConnectionInfo().connected, false);
  assert.equal(report.slots.find((slot) => slot.id === 'C3').rawProperties.get(PTP_PROP.DYNAMIC_RANGE).readStatus, 'TIMEOUT');
  assert.equal(report.slots.find((slot) => slot.id === 'C3').rawProperties.get(PTP_PROP.D_RANGE_PRIORITY).readStatus, 'NOT_ATTEMPTED');
  const writes = transport.calls.filter((call) => call.method === 'setPropertyU16');
  assert.equal(writes.at(-1).value, 4);
  assert.equal(transport.calls.some((call) => call.method === 'reopen'), true);
  assert.equal(transport.calls.some((call) => call.method === 'releaseAfterFailure'), true);
  assertNoSerialBoundary(report);
  assertNoSerialBoundary(transport.calls.filter((call) => call.method === 'releaseAfterFailure'));
});

test('scanCSlots requires an exact two-byte original selector and never invents slot data after rejection', async () => {
  const transport = new FakeReadOnlyTransport({ selectorBytes: new Uint8Array([4]) });
  const client = makeClient(transport);
  await client.connect();

  const report = await client.scanCSlots();

  assert.equal(report.complete, false);
  assert.equal(report.originalSelector, null);
  assert.equal(report.slots.every((slot) => slot.name === null), true);
  assert.equal(report.slots.every((slot) => slot.readStatus === 'NOT_ATTEMPTED'), true);
  assert.equal(transport.calls.some((call) => call.method === 'setPropertyU16'), false);
  assert.equal(transport.calls.some((call) => call.method === 'releaseAfterFailure'), true);
});

test('readFullBackup uses a fresh session and decodes FS only after ObjectInfo, length, format, and X-E5 guards pass', async () => {
  const transport = new FakeReadOnlyTransport();
  const client = makeClient(transport);
  await client.connect();
  await client.scanCSlots();

  const backup = await client.readFullBackup();

  assert.equal(backup.model, 'X-E5');
  assert.equal(backup.size, X_E5_FS_LAYOUT.blobSize);
  assert.equal(backup.declaredSize, X_E5_FS_LAYOUT.blobSize);
  assert.equal(backup.objectFormat, 0x5000);
  assert.equal(backup.decodeGate.passed, true);
  assert.equal(backup.fsSlots.length, 3);
  assert.match(backup.sha256, /^[a-f0-9]{64}$/);
  assert.equal(backup.sessionClosed, true);
  assert.equal(backup.interfaceReleased, true);
  assert.equal(backup.interfaceReclaimedForRead, true);
  assert.equal(backup.transactionSummary.metadataComplete, true);
  assert.equal(backup.transactionSummary.strictlyIncreasing, true);
  assert.deepEqual(
    backup.transactions.map((item) => item.operationName),
    ['OPEN_SESSION', 'GET_OBJECT_INFO', 'GET_OBJECT', 'CLOSE_SESSION'],
  );
  assert.deepEqual(backup.transactions.map((item) => item.transactionId), [0, 1, 2, 3]);
  assert.equal(backup.bytes.byteLength, X_E5_FS_LAYOUT.blobSize);
  assert.equal(client.getConnectionInfo().connected, false);
  assert.equal(transport.calls.filter((call) => call.method === 'openSession').length, 3);
  assert.equal(transport.calls.filter((call) => call.method === 'closeSession').length, 3);
  assert.equal(transport.calls.filter((call) => call.method === 'closeDevice').length, 2);
  assert.equal(transport.calls.filter((call) => call.method === 'reopen').length, 1);
  assert.deepEqual(
    transport.calls.filter((call) => ['getObjectInfo', 'getObject'].includes(call.method)).map((call) => [call.method, call.handle]),
    [['getObjectInfo', 0], ['getObject', 0]],
  );
  assertNoSerialBoundary(backup.objectInfo);
});

test('backup size mismatch blocks GetObject and FS decode, closes the session, and releases the interface', async () => {
  const transport = new FakeReadOnlyTransport({ objectInfo: makeObjectInfo(X_E5_FS_LAYOUT.blobSize - 1) });
  const client = makeClient(transport);
  await client.connect();
  await client.scanCSlots();

  await assert.rejects(client.readFullBackup(), /declared 70523 bytes/);
  assert.equal(transport.calls.some((call) => call.method === 'getObject'), false);
  assert.equal(transport.calls.filter((call) => call.method === 'closeSession').length, 3);
  assert.equal(transport.calls.some((call) => call.method === 'releaseAfterFailure'), true);
  assert.equal(client.getConnectionInfo().connected, false);
});

test('full-backup reading is unavailable before a successful C scan and physical mutation methods stay hard-disabled', async () => {
  const transport = new FakeReadOnlyTransport();
  const client = makeClient(transport);
  await client.connect();

  await assert.rejects(client.readFullBackup(), /complete C1-C7 scan/);
  for (const [method, args] of [
    ['writeCSlot', [7, 'NO', {}]],
    ['prepareFsWrite', [3, {}]],
    ['restoreFullBackup', [new Uint8Array()]],
    ['verifyFsSlotAfterReconnect', [3, {}]],
    ['renderRafPreview', [new ArrayBuffer(0), {}]],
    ['selectCSlot', [7]],
  ]) {
    await assert.rejects(client[method](...args), /disabled during the mandatory read-only/);
  }
  assert.equal(transport.calls.some((call) => call.method === 'setPropertyU16'), false);
  assert.equal(transport.calls.some((call) => call.method === 'getObjectInfo'), false);
  assert.equal(transport.calls.some((call) => call.method === 'getObject'), false);
});

function makeClient(transport, logger = () => {}) {
  return new Xe5CameraClient({ transport, logger, wait: async () => {} });
}

function makeBackup() {
  const bytes = new Uint8Array(X_E5_FS_LAYOUT.blobSize);
  bytes.set(new TextEncoder().encode('FUJIFILMX-BACKUP0100').slice(0, 0x14), 0);
  bytes.set(new TextEncoder().encode('X-E5\0'), 0x14);
  return bytes;
}

function makeObjectInfo(size, format = 0x5000) {
  const fixed = new Uint8Array(52);
  const view = new DataView(fixed.buffer);
  view.setUint16(4, format, true);
  view.setUint32(8, size, true);
  return concatBytes(
    fixed,
    encodePtpString(`${SECRET_SERIAL}-backup.dat`),
    encodePtpString('20260802T120000'),
    encodePtpString('20260802T120000'),
    encodePtpString('settings'),
  );
}

function assertNoSerialBoundary(value) {
  const json = JSON.stringify(value);
  assert.equal(json.includes(SECRET_SERIAL), false, `Sensitive serial crossed a boundary: ${json}`);
  assert.equal(/"[^"]*serial[^"]*"\s*:/i.test(json), false, `A serial-bearing key crossed a boundary: ${json}`);
}

function disconnectedTransportError() {
  const error = new Error('USB transport is not connected.');
  error.name = 'PtpTransportError';
  error.code = 'USB_NOT_CONNECTED';
  return error;
}
