// @ts-check

import {
  concatBytes,
  decodePtpString,
  packU16,
  packU32,
  readU16,
  readU32,
} from './binary.js';
import { FUJI_VENDOR_ID } from './x-e5-codecs.js';

export const PTP_CONTAINER = Object.freeze({ COMMAND: 1, DATA: 2, RESPONSE: 3, EVENT: 4 });
export const PTP_OP = Object.freeze({
  GET_DEVICE_INFO: 0x1001,
  OPEN_SESSION: 0x1002,
  CLOSE_SESSION: 0x1003,
  GET_OBJECT_HANDLES: 0x1007,
  GET_OBJECT_INFO: 0x1008,
  GET_OBJECT: 0x1009,
  DELETE_OBJECT: 0x100b,
  SEND_OBJECT_INFO: 0x100c,
  SEND_OBJECT: 0x100d,
  GET_DEVICE_PROP_DESC: 0x1014,
  GET_DEVICE_PROP_VALUE: 0x1015,
  SET_DEVICE_PROP_VALUE: 0x1016,
});
export const FUJI_OP = Object.freeze({ SEND_OBJECT_INFO: 0x900c, SEND_OBJECT_2: 0x900d });
export const PTP_RESPONSE = Object.freeze({
  OK: 0x2001,
  GENERAL_ERROR: 0x2002,
  SESSION_NOT_OPEN: 0x2003,
  INVALID_TRANSACTION_ID: 0x2004,
  OPERATION_NOT_SUPPORTED: 0x2005,
  PARAMETER_NOT_SUPPORTED: 0x2006,
  INCOMPLETE_TRANSFER: 0x2007,
  INVALID_STORAGE_ID: 0x2008,
  INVALID_OBJECT_HANDLE: 0x2009,
  DEVICE_PROP_NOT_SUPPORTED: 0x200a,
  INVALID_OBJECT_FORMAT_CODE: 0x200b,
  STORE_FULL: 0x200c,
  OBJECT_WRITE_PROTECTED: 0x200d,
  STORE_READ_ONLY: 0x200e,
  ACCESS_DENIED: 0x200f,
  NO_THUMBNAIL_PRESENT: 0x2010,
  SELF_TEST_FAILED: 0x2011,
  PARTIAL_DELETION: 0x2012,
  STORE_NOT_AVAILABLE: 0x2013,
  SPECIFICATION_BY_FORMAT_UNSUPPORTED: 0x2014,
  NO_VALID_OBJECT_INFO: 0x2015,
  INVALID_CODE_FORMAT: 0x2016,
  UNKNOWN_VENDOR_CODE: 0x2017,
  CAPTURE_ALREADY_TERMINATED: 0x2018,
  DEVICE_BUSY: 0x2019,
  INVALID_PARENT_OBJECT: 0x201a,
  INVALID_DEVICE_PROP_FORMAT: 0x201b,
  INVALID_DEVICE_PROP_VALUE: 0x201c,
  INVALID_PARAMETER: 0x201d,
  SESSION_ALREADY_OPEN: 0x201e,
  TRANSACTION_CANCELLED: 0x201f,
  SPECIFICATION_OF_DESTINATION_UNSUPPORTED: 0x2020,
});

export const PTP_EVENT = Object.freeze({
  CANCEL_TRANSACTION: 0x4001,
  OBJECT_ADDED: 0x4002,
  OBJECT_REMOVED: 0x4003,
  STORE_ADDED: 0x4004,
  STORE_REMOVED: 0x4005,
  DEVICE_PROP_CHANGED: 0x4006,
  OBJECT_INFO_CHANGED: 0x4007,
  DEVICE_INFO_CHANGED: 0x4008,
  REQUEST_OBJECT_TRANSFER: 0x4009,
  STORE_FULL: 0x400a,
  DEVICE_RESET: 0x400b,
  STORAGE_INFO_CHANGED: 0x400c,
  CAPTURE_COMPLETE: 0x400d,
  UNREPORTED_STATUS: 0x400e,
});

export const PTP_PURPOSE = Object.freeze({ C_SLOT_SELECTOR: 'c-slot-selector' });

const FUJI_PRESET_SELECTOR = 0xd18c;
const READ_ONLY_COMMANDS = new Set([
  PTP_OP.GET_DEVICE_INFO,
  PTP_OP.OPEN_SESSION,
  PTP_OP.CLOSE_SESSION,
  PTP_OP.GET_OBJECT_HANDLES,
  PTP_OP.GET_OBJECT_INFO,
  PTP_OP.GET_OBJECT,
  PTP_OP.GET_DEVICE_PROP_DESC,
  PTP_OP.GET_DEVICE_PROP_VALUE,
]);
const DATA_PHASE_REQUIRED_OPERATIONS = new Set([
  PTP_OP.GET_DEVICE_INFO,
  PTP_OP.GET_OBJECT_INFO,
  PTP_OP.GET_OBJECT,
  PTP_OP.GET_DEVICE_PROP_VALUE,
]);

/** Default policy for physical-camera validation. */
export const PHYSICAL_READ_ONLY_POLICY = Object.freeze({
  /** @param {{ opcode: number, params: number[], data: Uint8Array|null, purpose?: string }} request */
  authorize(request) {
    if (READ_ONLY_COMMANDS.has(request.opcode) && request.data === null) return;
    if (
      request.opcode === PTP_OP.SET_DEVICE_PROP_VALUE
      && request.params.length === 1
      && request.params[0] === FUJI_PRESET_SELECTOR
      && request.data?.byteLength === 2
      && readU16(request.data) >= 1
      && readU16(request.data) <= 7
      && request.purpose === PTP_PURPOSE.C_SLOT_SELECTOR
    ) return;
    throw new PtpPolicyError(request.opcode, request.params, request.purpose);
  },
});

const DEFAULT_TIMEOUT_MS = 5000;
const LARGE_TIMEOUT_MS = 60000;
const CHUNK_SIZE = 512 * 1024;
const MAX_CONTAINER_SIZE = 300 * 1024 * 1024;
const MAX_EMPTY_READS = 3;
const MAX_TRANSACTION_DIAGNOSTICS = 1024;

const OPERATION_NAMES = new Map([
  ...Object.entries(PTP_OP),
  ...Object.entries(FUJI_OP).map(([name, code]) => [`FUJI_${name}`, code]),
].map(([name, code]) => [code, name]));
const RESPONSE_NAMES = new Map(Object.entries(PTP_RESPONSE).map(([name, code]) => [code, name]));
const EVENT_NAMES = new Map(Object.entries(PTP_EVENT).map(([name, code]) => [code, name]));

export class PtpTransportError extends Error {
  /** @param {string} code @param {string} message @param {{ operation?: string, transactionId?: number, endpoint?: number, status?: string, cause?: unknown, taints?: boolean }} [detail] */
  constructor(code, message, detail = {}) {
    super(message, detail.cause === undefined ? undefined : { cause: detail.cause });
    this.name = 'PtpTransportError';
    this.code = code;
    this.operation = detail.operation ?? null;
    this.transactionId = detail.transactionId ?? null;
    this.endpoint = detail.endpoint ?? null;
    this.status = detail.status ?? null;
    this.taints = detail.taints ?? true;
  }
}

export class PtpPolicyError extends Error {
  /** @param {number} opcode @param {number[]} params @param {string|undefined} purpose */
  constructor(opcode, params, purpose) {
    super(`${operationName(opcode)} is denied by the physical read-only policy.`);
    this.name = 'PtpPolicyError';
    this.code = 'READ_ONLY_POLICY_DENIED';
    this.opcode = opcode;
    this.params = [...params];
    this.purpose = purpose ?? null;
  }
}

export class PtpDatasetError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'PtpDatasetError';
    this.code = 'INVALID_PTP_DATASET';
  }
}

export class PtpResponseError extends Error {
  /** @param {number} responseCode @param {string} operation @param {number|null} [transactionId] @param {string|null} [symbolicOperation] @param {number|null} [propertyCode] */
  constructor(responseCode, operation, transactionId = null, symbolicOperation = null, propertyCode = null) {
    super(`${operation} failed with ${responseName(responseCode)}.`);
    this.name = 'PtpResponseError';
    this.responseCode = responseCode;
    this.responseName = responseName(responseCode);
    this.operation = operation;
    this.operationName = symbolicOperation;
    this.transactionId = transactionId;
    this.propertyCode = propertyCode;
    this.guidance = responseGuidance(responseCode, operation);
  }
}

/**
 * Minimal PTP-over-WebUSB transport with buffered container reassembly.
 *
 * This class does not contain Fujifilm recipe semantics. It only provides
 * standard PTP transactions and a small number of object helpers.
 */
export class WebUsbPtpTransport {
  /**
   * @param {((message: string, detail?: any) => void)|{
   *   logger?: (message: string, detail?: any) => void,
   *   usb?: any,
   *   policy?: { authorize: (request: { opcode: number, params: number[], data: Uint8Array|null, purpose?: string }) => void },
   * }} [options]
   */
  constructor(options = () => {}) {
    const normalized = typeof options === 'function' ? { logger: options } : options;
    this.logger = normalized.logger ?? (() => {});
    this.usb = normalized.usb ?? (typeof navigator !== 'undefined' ? navigator.usb : null);
    this.policy = normalized.policy ?? PHYSICAL_READ_ONLY_POLICY;
    this.device = null;
    this.interfaceNumber = null;
    this.endpointIn = null;
    this.endpointOut = null;
    this.interfaceClaimed = false;
    this.usbDiagnostics = null;
    this.lastUsbDiagnostics = null;
    this.transactionId = 0;
    this.transactionSequence = 0;
    this.transactionDiagnostics = [];
    this.sessionId = 0;
    this.sessionSequence = 0;
    this.activeSessionSequence = 0;
    this.receiveBuffer = new Uint8Array();
    this.sessionOpen = false;
    this.tainted = false;
    this.disconnectError = null;
    this._transactionQueue = Promise.resolve();
    this._disconnectHandler = null;
  }

  static isSupported() {
    return typeof navigator !== 'undefined' && Boolean(navigator.usb);
  }

  /**
   * Request a Fujifilm USB device from a user gesture and open its PTP interface.
   */
  async requestAndConnect() {
    if (!this.usb) throw new PtpTransportError('WEBUSB_UNAVAILABLE', 'WebUSB is not available. Use a Chromium-based browser on localhost or HTTPS.', { taints: false });
    try {
      this.device = await this.usb.requestDevice({ filters: [{ vendorId: FUJI_VENDOR_ID }] });
      this.lastUsbDiagnostics = null;
    } catch (error) {
      throw new PtpTransportError('USB_DEVICE_REQUEST_FAILED', 'The USB device picker did not provide a Fujifilm device.', { cause: error, taints: false });
    }
    await this.openDevice(this.device);
    return this.device;
  }

  /** @param {USBDevice} device */
  async openDevice(device) {
    this.device = device;
    this.tainted = false;
    this.disconnectError = null;
    try {
      if (!device.opened) await device.open();
      const candidates = inspectPtpInterfaces(device);
      const match = selectPtpInterface(candidates, device.configuration?.configurationValue ?? null);
      if (!match) throw new PtpTransportError('PTP_INTERFACE_NOT_FOUND', 'The selected USB device does not expose an exact 06/01/01 PTP still-image interface with Bulk IN and Bulk OUT endpoints. Check the camera USB mode.');
      if (device.configuration?.configurationValue !== match.configurationValue) {
        await device.selectConfiguration(match.configurationValue);
      }
      this.interfaceNumber = match.interfaceNumber;
      await device.claimInterface(match.interfaceNumber);
      this.interfaceClaimed = true;
      if (match.alternateSetting !== 0) await device.selectAlternateInterface(match.interfaceNumber, match.alternateSetting);
      this.endpointIn = match.bulkIn.endpointNumber;
      this.endpointOut = match.bulkOut.endpointNumber;
      this.receiveBuffer = new Uint8Array();
      this.transactionId = 0;
      this.activeSessionSequence = 0;
      this.sessionOpen = false;
      this.usbDiagnostics = buildUsbDiagnostics(device, match);
      this.lastUsbDiagnostics = structuredClone(this.usbDiagnostics);
      this._installDisconnectHandler();
      this._safeLog('USB PTP interface claimed', this.usbDiagnostics);
    } catch (error) {
      const typed = error instanceof PtpTransportError
        ? error
        : new PtpTransportError('USB_OPEN_OR_CLAIM_FAILED', 'The Fujifilm USB PTP interface could not be opened and claimed.', { cause: error });
      await this.closeDevice({ forgetDevice: false, skipSessionClose: true });
      this.tainted = true;
      throw typed;
    }
  }

  getUsbDiagnostics() {
    return this.usbDiagnostics ? structuredClone(this.usbDiagnostics) : null;
  }

  getLastUsbDiagnostics() {
    return this.lastUsbDiagnostics ? structuredClone(this.lastUsbDiagnostics) : null;
  }

  /** Return the transport-lifetime cursor used to slice payload-free wire evidence. */
  getTransactionCursor() {
    return this.transactionSequence;
  }

  /** Return payload-free wire evidence recorded after the given ledger sequence. */
  getTransactionDiagnostics(sinceSequence = 0) {
    return this.transactionDiagnostics
      .filter((item) => item.sequence > sinceSequence)
      .map((item) => ({ ...item }));
  }

  async reopen() {
    if (!this.device) throw new Error('No USB device is selected.');
    const device = this.device;
    await this.closeDevice({ forgetDevice: false });
    await this.openDevice(device);
  }

  /** @param {{ forgetDevice?: boolean, skipSessionClose?: boolean }} [options] */
  async closeDevice(options = {}) {
    const device = this.device;
    if (!device) return;
    try {
      if (this.sessionOpen && !options.skipSessionClose && !this.tainted) await this.closeSession();
    } catch {
      // Best effort.
    }
    try {
      if (device.opened && this.interfaceClaimed && this.interfaceNumber !== null) await device.releaseInterface(this.interfaceNumber);
    } catch {
      // The OS may already have released it after disconnect.
    }
    try {
      if (device.opened) await device.close();
    } catch {
      // Best effort.
    }
    this.sessionOpen = false;
    this.transactionId = 0;
    this.activeSessionSequence = 0;
    this.receiveBuffer = new Uint8Array();
    this.interfaceNumber = null;
    this.endpointIn = null;
    this.endpointOut = null;
    this.interfaceClaimed = false;
    this.usbDiagnostics = null;
    this._removeDisconnectHandler();
    if (options.forgetDevice !== false) this.device = null;
  }

  async openSession() {
    if (this.sessionOpen) return;
    return this._enqueueTransaction(async () => {
      if (this.sessionOpen) return;
      let transportReopened = false;
      while (true) {
        const sessionId = this.nextSessionId();
        this.policy.authorize({ opcode: PTP_OP.OPEN_SESSION, params: [sessionId], data: null });
        const sessionSequence = this.beginSessionAttempt();
        const response = await this.#executeCommand(
          PTP_OP.OPEN_SESSION,
          [sessionId],
          DEFAULT_TIMEOUT_MS,
          0,
          sessionSequence,
        );
        if (response.code === PTP_RESPONSE.OK) {
          this.sessionOpen = true;
          return;
        }
        if (response.code === PTP_RESPONSE.SESSION_ALREADY_OPEN && !transportReopened) {
          this._safeLog('Reopening the USB transport after an unknown stale PTP session', {
            responseCode: formatPtpCode(response.code),
            responseName: responseName(response.code),
            transactionId: response.transactionId,
            sessionSequence,
          });
          const device = this.device;
          if (!device) break;
          await this.closeDevice({ forgetDevice: false, skipSessionClose: true });
          await this.openDevice(device);
          transportReopened = true;
          continue;
        }
        const error = new PtpResponseError(
          response.code,
          'OpenSession',
          response.transactionId,
          operationName(PTP_OP.OPEN_SESSION),
        );
        await this.releaseAfterFailure(error);
        throw error;
      }
      const error = new PtpTransportError('USB_NOT_CONNECTED', 'The USB device reference was lost while reopening a stale PTP session.');
      await this.releaseAfterFailure(error);
      throw error;
    });
  }

  async closeSession() {
    if (!this.sessionOpen) return;
    const response = await this.command(PTP_OP.CLOSE_SESSION);
    if (response.code !== PTP_RESPONSE.OK && response.code !== PTP_RESPONSE.SESSION_NOT_OPEN) {
      throw new PtpResponseError(
        response.code,
        'CloseSession',
        response.transactionId,
        operationName(PTP_OP.CLOSE_SESSION),
      );
    }
    this.sessionOpen = false;
    this.activeSessionSequence = 0;
  }

  async getDeviceInfo() {
    const transaction = await this.command(PTP_OP.GET_DEVICE_INFO);
    ensureOk(transaction, 'GetDeviceInfo', PTP_OP.GET_DEVICE_INFO);
    return parseDeviceInfo(transaction.data);
  }

  /** Run a task in a newly opened PTP session and always close it. */
  async withFreshSession(task) {
    let primaryError = null;
    let result;
    let closeMayBeRetried = true;
    try {
      if (this.sessionOpen) {
        try {
          await this.closeSession();
        } catch (error) {
          closeMayBeRetried = false;
          throw error;
        }
      }
      await this.openSession();
      result = await task(this);
    } catch (error) {
      primaryError = error;
    }
    let closeError = null;
    try {
      if (this.sessionOpen && closeMayBeRetried) await this.closeSession();
    } catch (error) {
      closeError = error;
    }
    if (primaryError || closeError) {
      await this.closeDevice({ forgetDevice: false, skipSessionClose: true });
      if (primaryError && closeError && typeof primaryError === 'object' && primaryError) primaryError.cleanupError = closeError;
      throw primaryError ?? closeError;
    }
    return result;
  }

  /** Release the claimed interface after a fatal high-level failure. */
  async releaseAfterFailure(error) {
    this.tainted = true;
    this._safeLog('USB PTP transport released after failure', {
      errorCode: error?.code ?? null,
      message: error instanceof Error ? error.message : String(error),
    });
    await this.closeDevice({ forgetDevice: false, skipSessionClose: true });
  }

  /** @param {number} propertyCode */
  async getPropertyRaw(propertyCode) {
    return (await this.getPropertyRawWithMetadata(propertyCode)).bytes;
  }

  /** @param {number} propertyCode */
  async getPropertyRawWithMetadata(propertyCode) {
    const transaction = await this.command(PTP_OP.GET_DEVICE_PROP_VALUE, [propertyCode]);
    if (transaction.code !== PTP_RESPONSE.OK) {
      throw new PtpResponseError(
        transaction.code,
        `GetDevicePropValue(0x${hex4(propertyCode)})`,
        transaction.transactionId,
        operationName(PTP_OP.GET_DEVICE_PROP_VALUE),
        propertyCode,
      );
    }
    return {
      bytes: transaction.data,
      transactionId: transaction.transactionId,
      responseCode: transaction.code,
      responseName: responseName(transaction.code),
      operationName: operationName(PTP_OP.GET_DEVICE_PROP_VALUE),
    };
  }

  /** @param {number} propertyCode @param {Uint8Array} bytes */
  async setPropertyRaw(propertyCode, bytes, options = {}) {
    return (await this.setPropertyRawWithMetadata(propertyCode, bytes, options)).responseCode;
  }

  /** @param {number} propertyCode @param {Uint8Array} bytes @param {{ purpose?: string }} [options] */
  async setPropertyRawWithMetadata(propertyCode, bytes, options = {}) {
    const transaction = await this.dataCommand(PTP_OP.SET_DEVICE_PROP_VALUE, [propertyCode], bytes, DEFAULT_TIMEOUT_MS, options);
    return {
      transactionId: transaction.transactionId,
      responseCode: transaction.code,
      responseName: responseName(transaction.code),
      operationName: operationName(PTP_OP.SET_DEVICE_PROP_VALUE),
    };
  }

  /** @param {number} propertyCode @param {number} value @param {{ purpose?: string }} [options] */
  async setPropertyU16(propertyCode, value, options = {}) {
    return this.setPropertyRaw(propertyCode, packU16(value), options);
  }

  /** @param {number} propertyCode @param {number} value @param {{ purpose?: string }} [options] */
  async setPropertyU16WithMetadata(propertyCode, value, options = {}) {
    return this.setPropertyRawWithMetadata(propertyCode, packU16(value), options);
  }

  /** @param {number} handle */
  async getObjectInfo(handle) {
    const transaction = await this.command(PTP_OP.GET_OBJECT_INFO, [handle]);
    ensureOk(transaction, `GetObjectInfo(${handle})`, PTP_OP.GET_OBJECT_INFO);
    return transaction.data;
  }

  /** @param {number} handle @param {number} [timeoutMs] */
  async getObject(handle, timeoutMs = LARGE_TIMEOUT_MS) {
    const transaction = await this.command(PTP_OP.GET_OBJECT, [handle], timeoutMs);
    ensureOk(transaction, `GetObject(${handle})`, PTP_OP.GET_OBJECT);
    return transaction.data;
  }

  /** @param {number} handle */
  async deleteObject(handle) {
    const transaction = await this.command(PTP_OP.DELETE_OBJECT, [handle]);
    ensureOk(transaction, `DeleteObject(${handle})`, PTP_OP.DELETE_OBJECT);
  }

  async getObjectHandles() {
    const transaction = await this.command(PTP_OP.GET_OBJECT_HANDLES, [0xffffffff, 0, 0]);
    ensureOk(transaction, 'GetObjectHandles', PTP_OP.GET_OBJECT_HANDLES);
    if (transaction.data.byteLength < 4) return [];
    const count = readU32(transaction.data, 0) ?? 0;
    const handles = [];
    for (let index = 0; index < count; index += 1) {
      const handle = readU32(transaction.data, 4 + index * 4);
      if (handle !== null) handles.push(handle);
    }
    return handles;
  }

  /**
   * @param {number} opcode
   * @param {number[]} [params]
   * @param {number} [timeoutMs]
   */
  async command(opcode, params = [], timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.policy.authorize({ opcode, params, data: null });
    return this._enqueueTransaction(async () => {
      const transactionId = this.nextTransactionId();
      return this.#executeCommand(opcode, params, timeoutMs, transactionId, this.activeSessionSequence);
    });
  }

  /** Execute an already-authorized command inside the transaction queue. */
  async #executeCommand(opcode, params, timeoutMs, transactionId, sessionSequence) {
    const operation = operationName(opcode);
    try {
      await this.#sendContainer({ type: PTP_CONTAINER.COMMAND, code: opcode, transactionId, params, data: new Uint8Array() }, timeoutMs);
      let container = await this.receiveContainer(timeoutMs);
      let data = new Uint8Array();
      let dataReceived = false;
      if (container.type === PTP_CONTAINER.DATA) {
        if (container.code !== opcode) throw protocolError('PTP_DATA_OPCODE_MISMATCH', `Expected DATA opcode ${formatPtpCode(opcode)}, got ${formatPtpCode(container.code)}.`, operation, transactionId);
        if (container.transactionId !== transactionId) throw protocolError('PTP_DATA_TRANSACTION_MISMATCH', `Expected DATA transaction ${transactionId}, got ${container.transactionId}.`, operation, transactionId);
        data = container.data;
        dataReceived = true;
        container = await this.receiveContainer(timeoutMs);
      }
      if (container.type !== PTP_CONTAINER.RESPONSE) throw protocolError('PTP_RESPONSE_TYPE_MISMATCH', `Expected PTP RESPONSE, got container type ${container.type}.`, operation, transactionId);
      if (container.transactionId !== transactionId) throw protocolError('PTP_RESPONSE_TRANSACTION_MISMATCH', `Expected RESPONSE transaction ${transactionId}, got ${container.transactionId}.`, operation, transactionId);
      if (container.code === PTP_RESPONSE.OK && DATA_PHASE_REQUIRED_OPERATIONS.has(opcode) && !dataReceived) {
        throw protocolError('PTP_DATA_PHASE_MISSING', `${operation} returned OK without its required DATA phase.`, operation, transactionId);
      }
      this._recordTransaction({
        sessionSequence,
        transactionId,
        operationName: operation,
        commandLength: 12 + params.length * 4,
        parameterCount: params.length,
        responseCode: container.code,
        responseName: responseName(container.code),
        responseParams: [...container.params],
        dataPhaseReceived: dataReceived,
        status: container.code === PTP_RESPONSE.OK ? 'OK' : 'PTP_RESPONSE',
        errorCode: null,
      });
      return { code: container.code, params: container.params, data, transactionId, sessionSequence };
    } catch (error) {
      this._recordTransaction({
        sessionSequence,
        transactionId,
        operationName: operation,
        commandLength: 12 + params.length * 4,
        parameterCount: params.length,
        responseCode: Number(error?.responseCode) || null,
        responseName: Number(error?.responseCode) ? responseName(Number(error.responseCode)) : null,
        responseParams: [],
        dataPhaseReceived: null,
        status: 'TRANSPORT_ERROR',
        errorCode: error?.code ?? null,
      });
      throw await this._handleTransactionFailure(error, operation, transactionId);
    }
  }

  /**
   * @param {number} opcode
   * @param {number[]} params
   * @param {Uint8Array} data
   * @param {number} [timeoutMs]
   */
  async dataCommand(opcode, params, data, timeoutMs = DEFAULT_TIMEOUT_MS, options = {}) {
    this.policy.authorize({ opcode, params, data, purpose: options.purpose });
    return this._enqueueTransaction(async () => {
      const transactionId = this.nextTransactionId();
      const sessionSequence = this.activeSessionSequence;
      const operation = operationName(opcode);
      try {
        await this.#sendContainer({ type: PTP_CONTAINER.COMMAND, code: opcode, transactionId, params, data: new Uint8Array() }, timeoutMs);
        await this.#sendContainer({ type: PTP_CONTAINER.DATA, code: opcode, transactionId, params: [], data }, timeoutMs);
        const container = await this.receiveContainer(timeoutMs);
        if (container.type !== PTP_CONTAINER.RESPONSE) throw protocolError('PTP_RESPONSE_TYPE_MISMATCH', `Expected PTP RESPONSE, got container type ${container.type}.`, operation, transactionId);
        if (container.transactionId !== transactionId) throw protocolError('PTP_RESPONSE_TRANSACTION_MISMATCH', `Expected RESPONSE transaction ${transactionId}, got ${container.transactionId}.`, operation, transactionId);
        this._recordTransaction({
          sessionSequence,
          transactionId,
          operationName: operation,
          commandLength: 12 + params.length * 4,
          parameterCount: params.length,
          responseCode: container.code,
          responseName: responseName(container.code),
          responseParams: [...container.params],
          dataPhaseReceived: true,
          status: container.code === PTP_RESPONSE.OK ? 'OK' : 'PTP_RESPONSE',
          errorCode: null,
        });
        return { code: container.code, params: container.params, transactionId };
      } catch (error) {
        this._recordTransaction({
          sessionSequence,
          transactionId,
          operationName: operation,
          commandLength: 12 + params.length * 4,
          parameterCount: params.length,
          responseCode: Number(error?.responseCode) || null,
          responseName: Number(error?.responseCode) ? responseName(Number(error.responseCode)) : null,
          responseParams: [],
          dataPhaseReceived: null,
          status: 'TRANSPORT_ERROR',
          errorCode: error?.code ?? null,
        });
        throw await this._handleTransactionFailure(error, operation, transactionId);
      }
    });
  }

  /** @param {{ type: number, code: number, transactionId: number, params: number[], data: Uint8Array }} container */
  async #sendContainer(container, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.assertConnected();
    const bytes = packContainer(container);
    for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_SIZE) {
      const chunk = bytes.slice(offset, Math.min(offset + CHUNK_SIZE, bytes.byteLength));
      let result;
      try {
        result = await raceWithTimeout(
          this.device.transferOut(this.endpointOut, chunk),
          timeoutMs,
          () => new PtpTransportError('USB_WRITE_TIMEOUT', `USB bulk OUT timed out after ${timeoutMs} ms.`, { endpoint: this.endpointOut }),
        );
      } catch (error) {
        if (error instanceof PtpTransportError) throw error;
        throw new PtpTransportError('USB_TRANSFER_OUT_FAILED', 'USB bulk OUT failed.', { endpoint: this.endpointOut, cause: error });
      }
      if (result.status === 'stall') await this._clearHalt('out', this.endpointOut);
      if (result.status !== 'ok' || result.bytesWritten !== chunk.byteLength) {
        throw new PtpTransportError(
          result.status === 'stall' ? 'USB_OUT_STALL' : 'USB_OUT_TRANSFER_FAILED',
          `USB bulk OUT failed with status ${result.status}.`,
          { endpoint: this.endpointOut, status: result.status },
        );
      }
    }
  }

  /** @param {number} [timeoutMs] */
  async receiveContainer(timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.assertConnected();
    const deadline = Date.now() + timeoutMs;
    let emptyReads = 0;
    while (this.receiveBuffer.byteLength < 12) {
      const received = await this.readUsbChunk(deadline);
      emptyReads = received === 0 ? emptyReads + 1 : 0;
      if (emptyReads >= MAX_EMPTY_READS) throw new PtpTransportError('USB_ZERO_LENGTH_READS', `USB bulk IN returned ${MAX_EMPTY_READS} consecutive empty packets.`, { endpoint: this.endpointIn });
    }
    const length = readU32(this.receiveBuffer, 0) ?? 0;
    if (length < 12 || length > MAX_CONTAINER_SIZE) throw new PtpTransportError('PTP_INVALID_CONTAINER_LENGTH', `Invalid PTP container length ${length}.`, { taints: true });
    while (this.receiveBuffer.byteLength < length) {
      const received = await this.readUsbChunk(deadline);
      emptyReads = received === 0 ? emptyReads + 1 : 0;
      if (emptyReads >= MAX_EMPTY_READS) throw new PtpTransportError('USB_ZERO_LENGTH_READS', `USB bulk IN returned ${MAX_EMPTY_READS} consecutive empty packets before the declared PTP container was complete.`, { endpoint: this.endpointIn });
    }
    const raw = this.receiveBuffer.slice(0, length);
    this.receiveBuffer = this.receiveBuffer.slice(length);
    return unpackContainer(raw);
  }

  /** @param {number} deadline */
  async readUsbChunk(deadline) {
    const timeoutMs = Math.max(0, deadline - Date.now());
    if (timeoutMs === 0) throw new PtpTransportError('USB_READ_TIMEOUT', 'USB bulk IN timed out before a complete PTP container arrived.', { endpoint: this.endpointIn });
    let result;
    try {
      result = await raceWithTimeout(
        this.device.transferIn(this.endpointIn, CHUNK_SIZE),
        timeoutMs,
        () => new PtpTransportError('USB_READ_TIMEOUT', `USB bulk IN timed out after ${timeoutMs} ms.`, { endpoint: this.endpointIn }),
      );
    } catch (error) {
      if (error instanceof PtpTransportError) throw error;
      throw new PtpTransportError('USB_TRANSFER_IN_FAILED', 'USB bulk IN failed.', { endpoint: this.endpointIn, cause: error });
    }
    if (result.status === 'stall') await this._clearHalt('in', this.endpointIn);
    if (result.status !== 'ok' || !result.data) {
      throw new PtpTransportError(
        result.status === 'stall' ? 'USB_IN_STALL' : 'USB_IN_TRANSFER_FAILED',
        `USB bulk IN failed with status ${result.status}.`,
        { endpoint: this.endpointIn, status: result.status },
      );
    }
    const incoming = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
    if (!incoming.byteLength) return 0;
    this.receiveBuffer = concatBytes(this.receiveBuffer, incoming);
    return incoming.byteLength;
  }

  nextTransactionId() {
    if (this.transactionId >= 0xffffffff) throw new PtpTransportError('PTP_TRANSACTION_ID_EXHAUSTED', 'The PTP transaction ID space is exhausted; create a new transport instance.');
    this.transactionId += 1;
    return this.transactionId;
  }

  beginSessionAttempt() {
    if (this.sessionSequence >= Number.MAX_SAFE_INTEGER) {
      throw new PtpTransportError('PTP_SESSION_SEQUENCE_EXHAUSTED', 'The local PTP session diagnostic sequence is exhausted; create a new transport instance.');
    }
    this.sessionSequence += 1;
    this.activeSessionSequence = this.sessionSequence;
    this.transactionId = 0;
    return this.activeSessionSequence;
  }

  nextSessionId() {
    if (this.sessionId >= 0xffffffff) throw new PtpTransportError('PTP_SESSION_ID_EXHAUSTED', 'The PTP session ID space is exhausted; create a new transport instance.');
    this.sessionId += 1;
    return this.sessionId;
  }

  assertConnected() {
    if (this.tainted) throw new PtpTransportError('USB_TRANSPORT_TAINTED', 'USB PTP transport is tainted and must be reopened.', { taints: false });
    if (!this.device?.opened || !this.interfaceClaimed || this.endpointIn === null || this.endpointOut === null) {
      throw new PtpTransportError('USB_NOT_CONNECTED', 'USB PTP transport is not connected.', { taints: false });
    }
  }

  async _handleTransactionFailure(error, operation, transactionId) {
    const typed = this.disconnectError ?? (error instanceof PtpTransportError
      ? error
      : new PtpTransportError('USB_TRANSACTION_FAILED', `${operation} failed at the USB transport layer.`, { operation, transactionId, cause: error }));
    if (!typed.operation) typed.operation = operation;
    if (typed.transactionId === null || typed.transactionId === undefined) typed.transactionId = transactionId;
    if (typed.taints) await this.releaseAfterFailure(typed);
    return typed;
  }

  _enqueueTransaction(task) {
    const result = this._transactionQueue.then(task, task);
    this._transactionQueue = result.catch(() => {});
    return result;
  }

  /** @param {{ sessionSequence: number, transactionId: number, operationName: string, commandLength: number, parameterCount: number, responseCode: number|null, responseName: string|null, responseParams: number[], dataPhaseReceived: boolean|null, status: string, errorCode: string|null }} evidence */
  _recordTransaction(evidence) {
    this.transactionSequence += 1;
    this.transactionDiagnostics.push({ sequence: this.transactionSequence, ...evidence });
    if (this.transactionDiagnostics.length > MAX_TRANSACTION_DIAGNOSTICS) {
      this.transactionDiagnostics.splice(0, this.transactionDiagnostics.length - MAX_TRANSACTION_DIAGNOSTICS);
    }
  }

  async _clearHalt(direction, endpoint) {
    try {
      await this.device?.clearHalt?.(direction, endpoint);
    } catch {
      // The following teardown is authoritative; halt clearing is best effort.
    }
  }

  _installDisconnectHandler() {
    this._removeDisconnectHandler();
    if (!this.usb?.addEventListener) return;
    this._disconnectHandler = (event) => {
      if (event.device !== this.device) return;
      const error = new PtpTransportError('USB_DISCONNECTED', 'The Fujifilm USB device disconnected.', { taints: true });
      this.disconnectError = error;
      this.tainted = true;
      this._safeLog('USB device disconnected', { errorCode: error.code });
      void this.closeDevice({ forgetDevice: false, skipSessionClose: true });
    };
    this.usb.addEventListener('disconnect', this._disconnectHandler);
  }

  _removeDisconnectHandler() {
    if (this._disconnectHandler && this.usb?.removeEventListener) this.usb.removeEventListener('disconnect', this._disconnectHandler);
    this._disconnectHandler = null;
  }

  _safeLog(message, detail) {
    try {
      this.logger(message, detail);
    } catch {
      // Diagnostics must never break transport cleanup.
    }
  }
}

/**
 * @param {{ type: number, code: number, transactionId: number, params: number[], data: Uint8Array }} container
 */
export function packContainer(container) {
  const payload = container.type === PTP_CONTAINER.DATA
    ? container.data
    : concatBytes(...container.params.slice(0, 5).map(packU32));
  return concatBytes(
    packU32(12 + payload.byteLength),
    packU16(container.type),
    packU16(container.code),
    packU32(container.transactionId),
    payload,
  );
}

/** @param {Uint8Array} raw */
export function unpackContainer(raw) {
  if (raw.byteLength < 12) throw new PtpTransportError('PTP_SHORT_HEADER', 'PTP container is shorter than its 12-byte header.');
  const length = readU32(raw, 0) ?? 0;
  if (length !== raw.byteLength) throw new PtpTransportError('PTP_CONTAINER_LENGTH_MISMATCH', `PTP container declares ${length} bytes but contains ${raw.byteLength}.`);
  const type = readU16(raw, 4) ?? 0;
  if (!Object.values(PTP_CONTAINER).includes(type)) throw new PtpTransportError('PTP_UNKNOWN_CONTAINER_TYPE', `Unknown PTP container type ${type}.`);
  const code = readU16(raw, 6) ?? 0;
  const transactionId = readU32(raw, 8) ?? 0;
  const payload = raw.slice(12, Math.min(length, raw.byteLength));
  const params = [];
  let data = new Uint8Array();
  if (type === PTP_CONTAINER.DATA) data = payload;
  else if (type === PTP_CONTAINER.RESPONSE) {
    if (payload.byteLength > 20 || payload.byteLength % 4 !== 0) {
      throw new PtpTransportError('PTP_INVALID_RESPONSE_PARAMETERS', `PTP RESPONSE contains an invalid ${payload.byteLength}-byte parameter payload.`);
    }
    for (let offset = 0; offset + 4 <= payload.byteLength && params.length < 5; offset += 4) {
      params.push(readU32(payload, offset) ?? 0);
    }
  }
  return { length, type, code, transactionId, params, data };
}

/** @param {Uint8Array} data */
export function parseDeviceInfo(data) {
  const reader = new PtpDatasetReader(data);
  const standardVersion = reader.u16();
  const vendorExtensionId = reader.u32();
  const vendorExtensionVersion = reader.u16();
  const vendorExtensionDescription = reader.string();
  const functionalMode = reader.u16();
  const operations = reader.u16Array();
  const events = reader.u16Array();
  const properties = reader.u16Array();
  const captureFormats = reader.u16Array();
  const imageFormats = reader.u16Array();
  const manufacturer = reader.string();
  const model = reader.string();
  const deviceVersion = reader.string();
  const serialNumber = reader.string();
  return {
    standardVersion,
    vendorExtensionId,
    vendorExtensionVersion,
    vendorExtensionDescription,
    functionalMode,
    operations,
    events,
    properties,
    captureFormats,
    imageFormats,
    manufacturer,
    model,
    deviceVersion,
    serialNumber,
  };
}

/** Return a report-safe DeviceInfo object. The full serial remains only in the private parsed dataset. */
export function sanitizeDeviceInfo(info) {
  return {
    standardVersion: info.standardVersion,
    vendorExtensionId: info.vendorExtensionId,
    vendorExtensionVersion: info.vendorExtensionVersion,
    vendorExtensionDescription: info.vendorExtensionDescription,
    functionalMode: info.functionalMode,
    operations: info.operations.map((code) => codeDescription(code, operationName)),
    events: info.events.map((code) => codeDescription(code, eventName)),
    properties: info.properties.map((code) => codeDescription(code, propertyName)),
    captureFormats: info.captureFormats.map((code) => codeDescription(code)),
    imageFormats: info.imageFormats.map((code) => codeDescription(code)),
    manufacturer: info.manufacturer,
    model: info.model,
    deviceVersion: info.deviceVersion,
    serialNumber: '[REDACTED]',
    serialPresent: Boolean(info.serialNumber),
  };
}

/** Parse the standard PTP ObjectInfo dataset returned by GetObjectInfo. */
export function parseObjectInfo(data) {
  const reader = new PtpDatasetReader(data);
  const result = {
    storageId: reader.u32(),
    objectFormat: reader.u16(),
    protectionStatus: reader.u16(),
    objectCompressedSize: reader.u32(),
    thumbFormat: reader.u16(),
    thumbCompressedSize: reader.u32(),
    thumbPixWidth: reader.u32(),
    thumbPixHeight: reader.u32(),
    imagePixWidth: reader.u32(),
    imagePixHeight: reader.u32(),
    imageBitDepth: reader.u32(),
    parentObject: reader.u32(),
    associationType: reader.u16(),
    associationDescription: reader.u32(),
    sequenceNumber: reader.u32(),
    filename: reader.string(),
    captureDate: reader.string(),
    modificationDate: reader.string(),
    keywords: reader.string(),
  };
  return { ...result, bytesConsumed: reader.offset, trailingBytes: data.byteLength - reader.offset };
}

class PtpDatasetReader {
  /** @param {Uint8Array} bytes */
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = 0;
  }
  u16() { this.ensure(2); const value = this.view.getUint16(this.offset, true); this.offset += 2; return value; }
  u32() { this.ensure(4); const value = this.view.getUint32(this.offset, true); this.offset += 4; return value; }
  string() {
    try {
      this.ensure(1);
      const decoded = decodePtpString(this.bytes, this.offset);
      this.offset = decoded.offset;
      return decoded.value;
    } catch (error) {
      throw new PtpDatasetError(error instanceof Error ? error.message : String(error));
    }
  }
  u16Array() {
    const count = this.u32();
    if (count > Math.floor((this.bytes.byteLength - this.offset) / 2)) throw new PtpDatasetError(`PTP array count ${count} exceeds the remaining dataset.`);
    const result = [];
    for (let index = 0; index < count; index += 1) result.push(this.u16());
    return result;
  }
  /** @param {number} length */
  ensure(length) { if (this.offset + length > this.bytes.byteLength) throw new PtpDatasetError('PTP dataset ended unexpectedly.'); }
}

/** Enumerate all usable still-image alternates without claiming them. */
export function inspectPtpInterfaces(device) {
  const configurations = device.configurations?.length
    ? device.configurations
    : (device.configuration ? [device.configuration] : []);
  const candidates = [];
  for (const configuration of configurations) {
    for (const usbInterface of configuration.interfaces ?? []) {
      for (const alternate of usbInterface.alternates ?? []) {
        if (alternate.interfaceClass !== 0x06) continue;
        const bulkIn = alternate.endpoints?.find((endpoint) => endpoint.type === 'bulk' && endpoint.direction === 'in');
        const bulkOut = alternate.endpoints?.find((endpoint) => endpoint.type === 'bulk' && endpoint.direction === 'out');
        if (!bulkIn || !bulkOut) continue;
        const interruptIn = alternate.endpoints?.find((endpoint) => endpoint.type === 'interrupt' && endpoint.direction === 'in') ?? null;
        candidates.push({
          configurationValue: configuration.configurationValue,
          interfaceNumber: usbInterface.interfaceNumber,
          alternateSetting: alternate.alternateSetting,
          interfaceClass: alternate.interfaceClass,
          interfaceSubclass: alternate.interfaceSubclass,
          interfaceProtocol: alternate.interfaceProtocol,
          exactPtp: alternate.interfaceSubclass === 0x01 && alternate.interfaceProtocol === 0x01,
          bulkIn: endpointDescription(bulkIn),
          bulkOut: endpointDescription(bulkOut),
          interruptIn: interruptIn ? endpointDescription(interruptIn) : null,
        });
      }
    }
  }
  return candidates;
}

export function selectPtpInterface(candidates, activeConfiguration = null) {
  return candidates.filter((candidate) => candidate.exactPtp).sort((left, right) => {
    const active = Number(right.configurationValue === activeConfiguration) - Number(left.configurationValue === activeConfiguration);
    if (active) return active;
    return left.configurationValue - right.configurationValue || left.interfaceNumber - right.interfaceNumber || left.alternateSetting - right.alternateSetting;
  })[0] ?? null;
}

/** @param {{ code: number, transactionId: number }} transaction @param {string} operation @param {number} opcode */
function ensureOk(transaction, operation, opcode) {
  if (transaction.code !== PTP_RESPONSE.OK) {
    throw new PtpResponseError(
      transaction.code,
      operation,
      transaction.transactionId,
      operationName(opcode),
    );
  }
}

/** @param {number} code */
export function responseName(code) {
  return RESPONSE_NAMES.get(code) ?? `PTP ${formatPtpCode(code)}`;
}

export function operationName(code) {
  return OPERATION_NAMES.get(code) ?? `PTP operation ${formatPtpCode(code)}`;
}

export function eventName(code) {
  return EVENT_NAMES.get(code) ?? `PTP event ${formatPtpCode(code)}`;
}

export function propertyName(code) {
  if (code === FUJI_PRESET_SELECTOR) return 'FUJI_PRESET_SELECTOR';
  if (code === 0xd18d) return 'FUJI_PRESET_NAME';
  if (code >= 0xd18e && code <= 0xd1a5) return `FUJI_PRESET_PROPERTY_${formatPtpCode(code).slice(2)}`;
  return `PTP property ${formatPtpCode(code)}`;
}

export function formatPtpCode(code) {
  return `0x${hex4(code)}`;
}

export function responseGuidance(code, operation = '') {
  if (code !== PTP_RESPONSE.ACCESS_DENIED) return [];
  if (/GetDevicePropValue/i.test(operation)) return ['The camera rejected this property read; the property may be inactive, unavailable, or body-specific.'];
  if (/SetDevicePropValue|Select C/i.test(operation)) return ['The camera rejected the selector change. Read the selector back before deciding whether it changed.'];
  if (/GetObject/i.test(operation)) return ['The camera did not expose the requested object in its current state or session sequence.'];
  if (/OpenSession/i.test(operation)) return ['The camera may have stale session state or be busy.'];
  return ['The camera rejected the PTP operation. This wire response is distinct from Linux USB access failure.'];
}

function endpointDescription(endpoint) {
  return {
    endpointNumber: endpoint.endpointNumber,
    direction: endpoint.direction,
    type: endpoint.type,
    packetSize: endpoint.packetSize ?? null,
  };
}

function buildUsbDiagnostics(device, match) {
  return {
    vendorId: device.vendorId,
    vendorIdHex: formatPtpCode(device.vendorId),
    productId: device.productId,
    productIdHex: formatPtpCode(device.productId),
    manufacturerName: device.manufacturerName ?? null,
    productName: device.productName ?? null,
    configurationValue: match.configurationValue,
    interfaceNumber: match.interfaceNumber,
    alternateSetting: match.alternateSetting,
    interfaceClass: match.interfaceClass,
    interfaceSubclass: match.interfaceSubclass,
    interfaceProtocol: match.interfaceProtocol,
    exactPtp: match.exactPtp,
    endpoints: {
      bulkIn: { ...match.bulkIn },
      bulkOut: { ...match.bulkOut },
      interruptIn: match.interruptIn ? { ...match.interruptIn } : null,
    },
  };
}

function codeDescription(code, formatter = null) {
  return { code, hex: formatPtpCode(code), name: formatter ? formatter(code) : null };
}

function protocolError(code, message, operation, transactionId) {
  return new PtpTransportError(code, message, { operation, transactionId, taints: true });
}

async function raceWithTimeout(promise, timeoutMs, createError) {
  let timerId;
  const timeout = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(createError()), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timerId);
  }
}

/** @param {number} value */
function hex4(value) {
  return value.toString(16).toUpperCase().padStart(4, '0');
}
