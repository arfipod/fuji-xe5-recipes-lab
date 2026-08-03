import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FUJI_OP,
  PTP_CONTAINER,
  PTP_OP,
  PTP_PURPOSE,
  PTP_RESPONSE,
  PtpPolicyError,
  PtpResponseError,
  PtpTransportError,
  WebUsbPtpTransport,
  inspectPtpInterfaces,
  packContainer,
  parseObjectInfo,
  sanitizeDeviceInfo,
  selectPtpInterface,
  unpackContainer,
} from '../src/camera/ptp.js';
import { concatBytes, encodePtpString, packU16, packU32, readU16, readU32 } from '../src/camera/binary.js';

function endpoint(endpointNumber, direction, type, packetSize) {
  return { endpointNumber, direction, type, packetSize };
}

function alternate({ setting = 0, subclass = 1, protocol = 1, endpoints = [] } = {}) {
  return {
    alternateSetting: setting,
    interfaceClass: 0x06,
    interfaceSubclass: subclass,
    interfaceProtocol: protocol,
    endpoints,
  };
}

function configuration(configurationValue, interfaces) {
  return { configurationValue, interfaces };
}

function ptpConfiguration(configurationValue = 1, options = {}) {
  return configuration(configurationValue, [{
    interfaceNumber: options.interfaceNumber ?? 2,
    alternates: [alternate({
      setting: options.setting ?? 0,
      subclass: options.subclass ?? 1,
      protocol: options.protocol ?? 1,
      endpoints: options.endpoints ?? [
        endpoint(1, 'in', 'bulk', 512),
        endpoint(2, 'out', 'bulk', 512),
        endpoint(3, 'in', 'interrupt', 64),
      ],
    })],
  }]);
}

class FakeUsbManager {
  constructor(device = null) {
    this.device = device;
    this.listeners = new Map();
  }
  async requestDevice() { return this.device; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name, listener) { if (this.listeners.get(name) === listener) this.listeners.delete(name); }
  disconnect(device = this.device) { this.listeners.get('disconnect')?.({ device }); }
}

class FakeUsbDevice {
  constructor(configurations = [ptpConfiguration()]) {
    this.vendorId = 0x04cb;
    this.productId = 0x0313;
    this.manufacturerName = 'FUJIFILM';
    this.productName = 'X-E5';
    this.serialNumber = 'SERIAL-MUST-NEVER-LEAK';
    this.configurations = configurations;
    this.configuration = null;
    this.opened = false;
    this.calls = [];
    this.incoming = [];
    this.outgoingResults = [];
    this.pendingInRejects = [];
    this.failAlternate = false;
    this.failClaim = false;
    this.hangIn = false;
  }
  async open() { this.calls.push(['open']); this.opened = true; }
  async selectConfiguration(value) {
    this.calls.push(['selectConfiguration', value]);
    this.configuration = this.configurations.find((item) => item.configurationValue === value) ?? null;
  }
  async claimInterface(number) {
    this.calls.push(['claimInterface', number]);
    if (this.failClaim) throw new Error('claim failed');
  }
  async selectAlternateInterface(number, setting) {
    this.calls.push(['selectAlternateInterface', number, setting]);
    if (this.failAlternate) throw new Error('alternate selection failed');
  }
  async releaseInterface(number) { this.calls.push(['releaseInterface', number]); }
  async close() {
    this.calls.push(['close']);
    this.opened = false;
    for (const reject of this.pendingInRejects.splice(0)) reject(new Error('device closed'));
  }
  async clearHalt(direction, number) { this.calls.push(['clearHalt', direction, number]); }
  async transferOut(number, bytes) {
    this.calls.push(['transferOut', number, new Uint8Array(bytes)]);
    if (this.outgoingResults.length) return this.outgoingResults.shift();
    return { status: 'ok', bytesWritten: bytes.byteLength };
  }
  transferIn(number, length) {
    this.calls.push(['transferIn', number, length]);
    if (this.hangIn) {
      return new Promise((_, reject) => { this.pendingInRejects.push(reject); });
    }
    if (!this.incoming.length) return Promise.reject(new Error('No scripted USB input.'));
    const item = this.incoming.shift();
    if (item instanceof Promise) return item;
    if (item?.status) return Promise.resolve(item);
    const bytes = item instanceof Uint8Array ? item : new Uint8Array(item);
    return Promise.resolve({ status: 'ok', data: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) });
  }
}

function response(transactionId, code = PTP_RESPONSE.OK, params = []) {
  return packContainer({ type: PTP_CONTAINER.RESPONSE, code, transactionId, params, data: new Uint8Array() });
}

function data(transactionId, opcode, bytes) {
  return packContainer({ type: PTP_CONTAINER.DATA, code: opcode, transactionId, params: [], data: bytes });
}

async function openTransport(device = new FakeUsbDevice()) {
  const usb = new FakeUsbManager(device);
  const transport = new WebUsbPtpTransport({ usb });
  await transport.openDevice(device);
  return { device, usb, transport };
}

function outContainers(device) {
  return device.calls
    .filter(([name]) => name === 'transferOut')
    .map(([, , bytes]) => unpackContainer(bytes));
}

test('prefers exact 06/01/01 PTP and reports complete sanitized endpoint diagnostics', async () => {
  const fallback = ptpConfiguration(1, { interfaceNumber: 1, subclass: 9, protocol: 9 });
  const exact = ptpConfiguration(2, {
    interfaceNumber: 7,
    setting: 1,
    endpoints: [
      endpoint(4, 'in', 'bulk', 1024),
      endpoint(5, 'out', 'bulk', 1024),
      endpoint(6, 'in', 'interrupt', 32),
    ],
  });
  const device = new FakeUsbDevice([fallback, exact]);
  device.configuration = fallback;
  device.opened = true;

  const candidates = inspectPtpInterfaces(device);
  assert.equal(candidates.length, 2);
  assert.equal(selectPtpInterface(candidates, 1).configurationValue, 2);

  const { transport } = await openTransport(device);
  const diagnostics = transport.getUsbDiagnostics();
  assert.equal(diagnostics.configurationValue, 2);
  assert.equal(diagnostics.interfaceNumber, 7);
  assert.equal(diagnostics.alternateSetting, 1);
  assert.deepEqual(
    [diagnostics.interfaceClass, diagnostics.interfaceSubclass, diagnostics.interfaceProtocol],
    [0x06, 0x01, 0x01],
  );
  assert.equal(diagnostics.endpoints.bulkIn.packetSize, 1024);
  assert.equal(diagnostics.endpoints.bulkOut.endpointNumber, 5);
  assert.equal(diagnostics.endpoints.interruptIn.endpointNumber, 6);
  assert.doesNotMatch(JSON.stringify(diagnostics), /SERIAL-MUST-NEVER-LEAK/);
});

test('fails closed when only a non-PTP Imaging-class alternate is available', async () => {
  const fallback = ptpConfiguration(1, { interfaceNumber: 1, subclass: 9, protocol: 9 });
  const device = new FakeUsbDevice([fallback]);
  device.configuration = fallback;
  device.opened = true;

  const candidates = inspectPtpInterfaces(device);
  assert.equal(candidates.length, 1);
  assert.equal(selectPtpInterface(candidates, 1), null);

  const transport = new WebUsbPtpTransport({ usb: new FakeUsbManager(device) });
  await assert.rejects(
    transport.openDevice(device),
    (error) => error.code === 'PTP_INTERFACE_NOT_FOUND' && /06\/01\/01/.test(error.message),
  );
  assert.equal(transport.interfaceClaimed, false);
});

test('releases and closes a claimed interface when alternate selection fails', async () => {
  const device = new FakeUsbDevice([ptpConfiguration(1, { setting: 1 })]);
  device.failAlternate = true;
  const transport = new WebUsbPtpTransport({ usb: new FakeUsbManager(device) });
  await assert.rejects(() => transport.openDevice(device), (error) => {
    assert.equal(error.code, 'USB_OPEN_OR_CLAIM_FAILED');
    return true;
  });
  assert.ok(device.calls.some(([name]) => name === 'releaseInterface'));
  assert.ok(device.calls.some(([name]) => name === 'close'));
  assert.equal(device.opened, false);
});

test('closes the USB device when claiming the interface fails', async () => {
  const device = new FakeUsbDevice();
  device.failClaim = true;
  const transport = new WebUsbPtpTransport({ usb: new FakeUsbManager(device) });
  await assert.rejects(() => transport.openDevice(device), (error) => {
    assert.equal(error.code, 'USB_OPEN_OR_CLAIM_FAILED');
    return true;
  });
  assert.ok(device.calls.some(([name]) => name === 'close'));
  assert.equal(device.opened, false);
});

test('physical read-only policy admits only an explicitly scoped D18C selector write', async () => {
  const { device, transport } = await openTransport();

  await assert.rejects(() => transport.setPropertyU16(0xd18c, 3), PtpPolicyError);
  await assert.rejects(() => transport.setPropertyU16(0xd192, 3, { purpose: PTP_PURPOSE.C_SLOT_SELECTOR }), PtpPolicyError);
  await assert.rejects(() => transport.dataCommand(PTP_OP.SEND_OBJECT, [], new Uint8Array([1])), PtpPolicyError);
  await assert.rejects(() => transport.dataCommand(FUJI_OP.SEND_OBJECT_2, [], new Uint8Array([1])), PtpPolicyError);
  await assert.rejects(() => transport.deleteObject(1), PtpPolicyError);
  assert.equal(outContainers(device).length, 0);

  device.incoming.push(response(1));
  const code = await transport.setPropertyU16(0xd18c, 3, { purpose: PTP_PURPOSE.C_SLOT_SELECTOR });
  assert.equal(code, PTP_RESPONSE.OK);
  const sent = outContainers(device);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].code, PTP_OP.SET_DEVICE_PROP_VALUE);
  assert.equal(sent[1].type, PTP_CONTAINER.DATA);
  assert.equal(readU16(sent[1].data), 3);

  device.incoming.push(response(2));
  const metadata = await transport.setPropertyU16WithMetadata(0xd18c, 4, { purpose: PTP_PURPOSE.C_SLOT_SELECTOR });
  assert.equal(metadata.transactionId, 2);
  assert.equal(metadata.responseCode, PTP_RESPONSE.OK);
  assert.equal(metadata.responseName, 'OK');
  assert.equal(metadata.operationName, 'SET_DEVICE_PROP_VALUE');
});

test('serializes concurrent reads and assigns strictly increasing transaction IDs', async () => {
  const { device, transport } = await openTransport();
  device.incoming.push(
    concatBytes(data(1, PTP_OP.GET_DEVICE_PROP_VALUE, packU16(7)), response(1)),
    concatBytes(data(2, PTP_OP.GET_OBJECT_INFO, new Uint8Array([1, 2, 3])), response(2)),
  );

  const propertyPromise = transport.command(PTP_OP.GET_DEVICE_PROP_VALUE, [0xd18c]);
  const objectInfoPromise = transport.command(PTP_OP.GET_OBJECT_INFO, [0]);
  const [property, objectInfo] = await Promise.all([propertyPromise, objectInfoPromise]);
  assert.equal(property.transactionId, 1);
  assert.equal(objectInfo.transactionId, 2);
  assert.equal(readU16(property.data), 7);
  assert.deepEqual([...objectInfo.data], [1, 2, 3]);
  assert.deepEqual(outContainers(device).map((item) => item.transactionId), [1, 2]);
});

test('requires a DATA phase for PTP read operations that return datasets', async () => {
  for (const [opcode, params] of [
    [PTP_OP.GET_DEVICE_INFO, []],
    [PTP_OP.GET_DEVICE_PROP_VALUE, [0xd18c]],
    [PTP_OP.GET_OBJECT_INFO, [0]],
    [PTP_OP.GET_OBJECT, [0]],
  ]) {
    const { device, transport } = await openTransport();
    device.incoming.push(response(1));
    await assert.rejects(() => transport.command(opcode, params), (error) => {
      assert.equal(error.code, 'PTP_DATA_PHASE_MISSING');
      assert.equal(error.transactionId, 1);
      return true;
    });
    assert.equal(device.opened, false);
    assert.ok(device.calls.some(([name]) => name === 'releaseInterface'));
  }
});

test('accepts an explicit zero-length DATA phase and preserves property transaction metadata', async () => {
  const { device, transport } = await openTransport();
  device.incoming.push(
    concatBytes(data(1, PTP_OP.GET_OBJECT, new Uint8Array()), response(1)),
    concatBytes(data(2, PTP_OP.GET_DEVICE_PROP_VALUE, packU16(7)), response(2)),
    concatBytes(data(3, PTP_OP.GET_DEVICE_PROP_VALUE, packU16(6)), response(3)),
  );

  const emptyObject = await transport.command(PTP_OP.GET_OBJECT, [0]);
  assert.equal(emptyObject.data.byteLength, 0);

  const property = await transport.getPropertyRawWithMetadata(0xd18c);
  assert.equal(readU16(property.bytes), 7);
  assert.equal(property.transactionId, 2);
  assert.equal(property.responseCode, PTP_RESPONSE.OK);
  assert.equal(property.responseName, 'OK');
  assert.equal(property.operationName, 'GET_DEVICE_PROP_VALUE');

  const legacyBytes = await transport.getPropertyRaw(0xd18c);
  assert.equal(readU16(legacyBytes), 6);
  assert.equal(device.opened, true);
});

test('preserves transaction metadata for a non-OK property response and the payload-free ledger', async () => {
  const { device, transport } = await openTransport();
  device.incoming.push(response(1, PTP_RESPONSE.ACCESS_DENIED));

  await assert.rejects(() => transport.getPropertyRawWithMetadata(0xd18d), (error) => {
    assert.equal(error.responseCode, PTP_RESPONSE.ACCESS_DENIED);
    assert.equal(error.responseName, 'ACCESS_DENIED');
    assert.equal(error.operationName, 'GET_DEVICE_PROP_VALUE');
    assert.equal(error.transactionId, 1);
    assert.equal(error.propertyCode, 0xd18d);
    return true;
  });

  assert.deepEqual(transport.getTransactionDiagnostics(), [{
    sequence: 1,
    sessionSequence: 0,
    transactionId: 1,
    operationName: 'GET_DEVICE_PROP_VALUE',
    commandLength: 16,
    parameterCount: 1,
    responseCode: PTP_RESPONSE.ACCESS_DENIED,
    responseName: 'ACCESS_DENIED',
    responseParams: [],
    dataPhaseReceived: false,
    status: 'PTP_RESPONSE',
    errorCode: null,
  }]);
});

test('rejects DATA opcode and transaction mismatches and tears down the tainted stream', async () => {
  for (const [label, scripted, expectedCode] of [
    ['opcode', data(1, PTP_OP.GET_OBJECT, new Uint8Array([1])), 'PTP_DATA_OPCODE_MISMATCH'],
    ['transaction', data(99, PTP_OP.GET_DEVICE_PROP_VALUE, new Uint8Array([1])), 'PTP_DATA_TRANSACTION_MISMATCH'],
  ]) {
    const { device, transport } = await openTransport();
    device.incoming.push(scripted);
    await assert.rejects(() => transport.command(PTP_OP.GET_DEVICE_PROP_VALUE, [0xd18c]), (error) => {
      assert.equal(error.code, expectedCode, label);
      return true;
    });
    assert.equal(device.opened, false);
    assert.ok(device.calls.some(([name]) => name === 'releaseInterface'));
  }
});

test('timeout, stall, and repeated zero-length reads taint and release the device', async () => {
  const cases = [
    {
      expected: 'USB_READ_TIMEOUT',
      prepare(device) { device.hangIn = true; },
    },
    {
      expected: 'USB_IN_STALL',
      prepare(device) { device.incoming.push({ status: 'stall', data: null }); },
      check(device) { assert.ok(device.calls.some(([name, direction]) => name === 'clearHalt' && direction === 'in')); },
    },
    {
      expected: 'USB_ZERO_LENGTH_READS',
      prepare(device) { device.incoming.push(new Uint8Array(), new Uint8Array(), new Uint8Array()); },
    },
  ];

  for (const item of cases) {
    const { device, transport } = await openTransport();
    item.prepare(device);
    await assert.rejects(() => transport.command(PTP_OP.GET_DEVICE_PROP_VALUE, [0xd18c], 10), (error) => {
      assert.equal(error.code, item.expected);
      assert.equal(error.operation, 'GET_DEVICE_PROP_VALUE');
      assert.equal(error.transactionId, 1);
      return true;
    });
    item.check?.(device);
    assert.equal(device.opened, false);
    assert.ok(device.calls.some(([name]) => name === 'releaseInterface'));
    assert.equal(transport.getTransactionDiagnostics()[0].transactionId, 1);
    assert.equal(transport.getTransactionDiagnostics()[0].operationName, 'GET_DEVICE_PROP_VALUE');
    assert.equal(transport.getTransactionDiagnostics()[0].status, 'TRANSPORT_ERROR');
  }
});

test('an OUT stall is cleared, never replayed, and tears down the stream', async () => {
  const { device, transport } = await openTransport();
  device.outgoingResults.push({ status: 'stall', bytesWritten: 0 });
  await assert.rejects(() => transport.command(PTP_OP.GET_DEVICE_PROP_VALUE, [0xd18c]), (error) => {
    assert.equal(error.code, 'USB_OUT_STALL');
    return true;
  });
  assert.equal(device.calls.filter(([name]) => name === 'transferOut').length, 1);
  assert.ok(device.calls.some(([name, direction]) => name === 'clearHalt' && direction === 'out'));
  assert.equal(device.opened, false);
});

test('disconnect during a pending read yields a typed disconnect and releases safely', async () => {
  const { device, usb, transport } = await openTransport();
  device.hangIn = true;
  const pending = transport.command(PTP_OP.GET_DEVICE_PROP_VALUE, [0xd18c], 1000);
  await new Promise((resolve) => setImmediate(resolve));
  usb.disconnect(device);
  await assert.rejects(() => pending, (error) => {
    assert.equal(error.code, 'USB_DISCONNECTED');
    return true;
  });
  assert.equal(device.opened, false);
});

test('OpenSession uses the standards-required TID 0 and one nonzero SessionID parameter', async () => {
  const { device, transport } = await openTransport();
  device.incoming.push(response(0), response(1));

  await transport.openSession();
  await transport.closeSession();

  const sent = device.calls.filter(([name]) => name === 'transferOut').map(([, , bytes]) => bytes);
  assert.equal(sent.length, 2);
  assert.equal(readU32(sent[0], 0), 16);
  assert.equal(readU16(sent[0], 6), PTP_OP.OPEN_SESSION);
  assert.equal(readU32(sent[0], 8), 0);
  assert.equal(readU32(sent[0], 12), 1);
  assert.equal(readU16(sent[1], 6), PTP_OP.CLOSE_SESSION);
  assert.equal(readU32(sent[1], 8), 1);
  assert.deepEqual(transport.getTransactionDiagnostics().map((item) => item.sessionSequence), [1, 1]);
});

test('a rejected OpenSession keeps symbolic response metadata at TID 0 and releases the interface', async () => {
  const { device, transport } = await openTransport();
  device.incoming.push(response(0, PTP_RESPONSE.PARAMETER_NOT_SUPPORTED));

  await assert.rejects(() => transport.openSession(), (error) => {
    assert.ok(error instanceof PtpResponseError);
    assert.equal(error.responseCode, PTP_RESPONSE.PARAMETER_NOT_SUPPORTED);
    assert.equal(error.responseName, 'PARAMETER_NOT_SUPPORTED');
    assert.equal(error.operationName, 'OPEN_SESSION');
    assert.equal(error.transactionId, 0);
    return true;
  });
  assert.equal(device.opened, false);
  assert.ok(device.calls.some(([name]) => name === 'releaseInterface'));
  assert.deepEqual(transport.getTransactionDiagnostics().map((item) => ({
    sequence: item.sequence,
    sessionSequence: item.sessionSequence,
    transactionId: item.transactionId,
    operationName: item.operationName,
    responseName: item.responseName,
  })), [{
    sequence: 1,
    sessionSequence: 1,
    transactionId: 0,
    operationName: 'OPEN_SESSION',
    responseName: 'PARAMETER_NOT_SUPPORTED',
  }]);
});

test('reopens the USB channel once for an unknown stale session without guessing its next transaction ID', async () => {
  const { device, transport } = await openTransport();
  device.incoming.push(
    response(0, PTP_RESPONSE.SESSION_ALREADY_OPEN),
    response(0, PTP_RESPONSE.OK),
    response(1, PTP_RESPONSE.OK),
  );
  await transport.openSession();
  await transport.closeSession();
  assert.equal(transport.sessionOpen, false);
  const sent = device.calls.filter(([name]) => name === 'transferOut').map(([, , bytes]) => bytes);
  assert.deepEqual(sent.map((bytes) => readU16(bytes, 6)), [PTP_OP.OPEN_SESSION, PTP_OP.OPEN_SESSION, PTP_OP.CLOSE_SESSION]);
  assert.deepEqual(sent.map((bytes) => readU32(bytes, 8)), [0, 0, 1]);
  assert.deepEqual(sent.slice(0, 2).map((bytes) => readU32(bytes, 12)), [1, 2]);
  assert.equal(device.calls.filter(([name]) => name === 'releaseInterface').length, 1);
  assert.equal(device.calls.filter(([name]) => name === 'claimInterface').length, 2);
  assert.deepEqual(transport.getTransactionDiagnostics().map((item) => item.sessionSequence), [1, 2, 2]);
});

test('fails closed when a stale session survives one USB channel reopen', async () => {
  const { device, transport } = await openTransport();
  device.incoming.push(
    response(0, PTP_RESPONSE.SESSION_ALREADY_OPEN),
    response(0, PTP_RESPONSE.SESSION_ALREADY_OPEN),
  );

  await assert.rejects(() => transport.openSession(), (error) => (
    error instanceof PtpResponseError
    && error.responseCode === PTP_RESPONSE.SESSION_ALREADY_OPEN
    && error.transactionId === 0
  ));
  assert.equal(device.opened, false);
  assert.deepEqual(outContainers(device).map((item) => item.code), [PTP_OP.OPEN_SESSION, PTP_OP.OPEN_SESSION]);
  assert.deepEqual(transport.getTransactionDiagnostics().map((item) => item.sessionSequence), [1, 2]);
});

test('each later session restarts at OpenSession TID 0 and then increases from 1', async () => {
  const { device, transport } = await openTransport();
  device.incoming.push(response(0), response(1), response(0), response(1));

  await transport.openSession();
  await transport.closeSession();
  await transport.openSession();
  await transport.closeSession();

  const ledger = transport.getTransactionDiagnostics();
  assert.deepEqual(ledger.map((item) => item.sequence), [1, 2, 3, 4]);
  assert.deepEqual(ledger.map((item) => item.sessionSequence), [1, 1, 2, 2]);
  assert.deepEqual(ledger.map((item) => item.transactionId), [0, 1, 0, 1]);
  assert.deepEqual(transport.getTransactionDiagnostics(2).map((item) => item.sequence), [3, 4]);
});

test('withFreshSession sequences a read-only object operation and closes cleanly', async () => {
  const { device, transport } = await openTransport();
  device.incoming.push(
    response(0),
    concatBytes(data(1, PTP_OP.GET_OBJECT_INFO, new Uint8Array([4, 5])), response(1)),
    response(2),
  );
  const bytes = await transport.withFreshSession((active) => active.getObjectInfo(0));
  assert.deepEqual([...bytes], [4, 5]);
  assert.equal(transport.sessionOpen, false);
  assert.equal(device.opened, true);
  assert.deepEqual(outContainers(device).map((item) => item.code), [PTP_OP.OPEN_SESSION, PTP_OP.GET_OBJECT_INFO, PTP_OP.CLOSE_SESSION]);
  assert.deepEqual(outContainers(device).map((item) => item.transactionId), [0, 1, 2]);
});

test('withFreshSession releases the interface after a high-level response failure', async () => {
  const { device, transport } = await openTransport();
  device.incoming.push(
    response(0),
    response(1, PTP_RESPONSE.ACCESS_DENIED),
    response(2),
  );
  await assert.rejects(
    () => transport.withFreshSession((active) => active.getObjectInfo(0)),
    (error) => error instanceof PtpResponseError && error.responseCode === PTP_RESPONSE.ACCESS_DENIED,
  );
  assert.equal(device.opened, false);
  assert.ok(device.calls.some(([name]) => name === 'releaseInterface'));
});

test('sanitizes DeviceInfo codes and never exposes the full serial', () => {
  const safe = sanitizeDeviceInfo({
    standardVersion: 100,
    vendorExtensionId: 6,
    vendorExtensionVersion: 1,
    vendorExtensionDescription: 'Fuji',
    functionalMode: 0,
    operations: [PTP_OP.GET_DEVICE_INFO, 0x9999],
    events: [0x4006],
    properties: [0xd18c, 0xd1a5],
    captureFormats: [0x5000],
    imageFormats: [0x3801],
    manufacturer: 'FUJIFILM',
    model: 'X-E5',
    deviceVersion: '1.00',
    serialNumber: 'TOP-SECRET-SERIAL',
  });
  assert.equal(safe.serialNumber, '[REDACTED]');
  assert.equal(safe.serialPresent, true);
  assert.equal(safe.operations[0].name, 'GET_DEVICE_INFO');
  assert.equal(safe.properties[0].name, 'FUJI_PRESET_SELECTOR');
  assert.doesNotMatch(JSON.stringify(safe), /TOP-SECRET-SERIAL/);
});

test('parses ObjectInfo declared format and exact compressed size', () => {
  const fixed = new Uint8Array(52);
  const view = new DataView(fixed.buffer);
  view.setUint32(0, 0xffffffff, true);
  view.setUint16(4, 0x5000, true);
  view.setUint32(8, 70524, true);
  const dataset = concatBytes(
    fixed,
    encodePtpString('FUP_FILE.dat'),
    new Uint8Array([0, 0, 0]),
  );
  const info = parseObjectInfo(dataset);
  assert.equal(info.objectFormat, 0x5000);
  assert.equal(info.objectCompressedSize, 70524);
  assert.equal(info.filename, 'FUP_FILE.dat');
  assert.equal(info.trailingBytes, 0);
});

test('invalid framing and contextual 0x200F responses remain symbolic and typed', () => {
  const malformed = concatBytes(packU32(99), new Uint8Array(8));
  assert.throws(() => unpackContainer(malformed), (error) => {
    assert.ok(error instanceof PtpTransportError);
    assert.equal(error.code, 'PTP_CONTAINER_LENGTH_MISMATCH');
    return true;
  });
  const denied = new PtpResponseError(PTP_RESPONSE.ACCESS_DENIED, 'GetObject(0)');
  assert.equal(denied.responseName, 'ACCESS_DENIED');
  assert.match(denied.guidance[0], /requested object/);
});
