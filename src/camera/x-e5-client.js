// @ts-check

import {
  bytesToBase64,
  bytesToHex,
  readU16,
  sha256Hex,
} from './binary.js';
import {
  PRESET_PROP_RANGE,
  PTP_PROP,
  X_E5_FS_LAYOUT,
  assertXe5Backup,
  decodeCSlotProperties,
  decodeFsSlots,
  describeCSlotProperty,
  modelFromBackup,
  normalizeModel,
} from './x-e5-codecs.js';
import {
  PTP_OP,
  PTP_PURPOSE,
  PTP_RESPONSE,
  PtpResponseError,
  WebUsbPtpTransport,
  parseObjectInfo,
  responseName,
} from './ptp.js';

const BACKUP_HANDLE = 0;
const BACKUP_FORMAT = 0x5000;
const SELECTOR_CONFIRM_ATTEMPTS = 5;
const SELECTOR_POLL_DELAY_MS = 35;
const DEVICE_BUSY_READ_ATTEMPTS = 3;
const PROPERTY_CODES = Object.freeze(
  Array.from(
    { length: PRESET_PROP_RANGE.last - PTP_PROP.PRESET_NAME + 1 },
    (_, index) => PTP_PROP.PRESET_NAME + index,
  ),
);
const C_SCAN_OPERATIONS = Object.freeze([
  PTP_OP.OPEN_SESSION,
  PTP_OP.CLOSE_SESSION,
  PTP_OP.GET_DEVICE_PROP_VALUE,
  PTP_OP.SET_DEVICE_PROP_VALUE,
]);
const BACKUP_READ_OPERATIONS = Object.freeze([
  PTP_OP.OPEN_SESSION,
  PTP_OP.CLOSE_SESSION,
  PTP_OP.GET_OBJECT_INFO,
  PTP_OP.GET_OBJECT,
]);
const SUCCESSFUL_READ_STATUSES = new Set(['OK', 'PASSTHROUGH']);
const UNSUPPORTED_RESPONSES = new Set([
  PTP_RESPONSE.OPERATION_NOT_SUPPORTED,
  PTP_RESPONSE.PARAMETER_NOT_SUPPORTED,
  PTP_RESPONSE.DEVICE_PROP_NOT_SUPPORTED,
]);

/**
 * Read-only X-E5 camera service used by the staged physical validation.
 *
 * Discovery opens one bounded standards-compliant session and reads DeviceInfo
 * there before enabling any capability. The only property write reachable from
 * this class is a temporary 0xD18C selector change made by scanCSlots(), with
 * the transport's explicit selector-purpose authorization.
 */
export class Xe5CameraClient {
  /**
   * @param {{
   *   logger?: (message: string, detail?: any) => void,
   *   transport?: any,
   *   wait?: (milliseconds: number) => Promise<void>,
   * }} [options]
   */
  constructor(options = {}) {
    this.logger = options.logger ?? (() => {});
    this.transport = options.transport ?? new WebUsbPtpTransport({
      logger: (message, detail) => this._log(message, detail),
    });
    this.wait = options.wait ?? wait;
    this.deviceInfo = null;
    this.initialDeviceInfo = null;
    this.capabilityProbe = null;
    this.connectedAt = null;
    this.discoveryReport = null;
    this.discoveryTransactionStartSequence = 0;
    this.cScanValidated = false;
  }

  static isSupported() {
    return WebUsbPtpTransport.isSupported();
  }

  /**
   * Claim the USB PTP interface, open a bounded PTP session, read DeviceInfo,
   * and close the session. No property or object access and no selector change
   * occurs here.
   */
  async connect() {
    let observedInfo = null;
    this.discoveryTransactionStartSequence = transactionCursor(this.transport);
    this.capabilityProbe = {
      attempted: true,
      reason: 'DeviceInfo is read inside one bounded PTP session before any camera capability is enabled.',
      sessionClosed: false,
      selectorAdvertisedBefore: null,
      selectorAdvertisedAfter: null,
      propertyCountBefore: null,
      propertyCountAfter: null,
      interfaceReleaseRequired: false,
      interfaceReleased: false,
    };
    try {
      await this.transport.requestAndConnect();
      observedInfo = await this.transport.withFreshSession((active) => active.getDeviceInfo());
      this.capabilityProbe.sessionClosed = !this.transport.sessionOpen;
      this.capabilityProbe.selectorAdvertisedAfter = observedInfo.properties?.includes(PTP_PROP.PRESET_SLOT) ?? false;
      this.capabilityProbe.propertyCountAfter = observedInfo.properties?.length ?? 0;
      if (normalizeModel(observedInfo?.model) !== 'XE5') {
        throw new Error(`This laboratory is locked to the Fujifilm X-E5. The connected body reports “${sanitizeText(observedInfo?.model) || 'unknown'}”.`);
      }

      this.initialDeviceInfo = observedInfo;

      // The complete DeviceInfo dataset, including the serial, remains private
      // to this client instance. Every outward boundary uses an allow-list.
      this.deviceInfo = observedInfo;
      this.connectedAt = new Date().toISOString();
      this.cScanValidated = false;

      // A body that does not advertise the required selector cannot proceed to
      // the C-slot stage. Keep its redacted DeviceInfo for inspection, but do
      // not retain an otherwise idle USB claim after the bounded session.
      if (!this.capabilityProbe.selectorAdvertisedAfter) {
        this.capabilityProbe.interfaceReleaseRequired = true;
        await this.transport.closeDevice({ forgetDevice: false, skipSessionClose: true });
        this.capabilityProbe.interfaceReleased = this.transport.interfaceClaimed !== true
          && this.transport.device?.opened !== true;
        if (!this.capabilityProbe.interfaceReleased) {
          const error = new Error('The USB interface could not be confirmed released after the 0xD18C capability gate remained closed.');
          // @ts-ignore - stable diagnostic code for cleanup evidence.
          error.code = 'DISCOVERY_INTERFACE_RELEASE_FAILED';
          throw error;
        }
      }

      this.discoveryReport = this._buildDiscoveryReport();
      if (!this.discoveryReport.transactionSummary?.standardsCompliant) {
        const error = new Error('The read-only discovery session completed without standards-compliant PTP transaction evidence.');
        // @ts-ignore - stable diagnostic code for a failed protocol evidence gate.
        error.code = 'DISCOVERY_TRANSACTION_EVIDENCE_FAILED';
        throw error;
      }
      this._log('X-E5 read-only discovery complete', {
        model: observedInfo.model,
        firmware: observedInfo.deviceVersion,
        advertisedOperationCount: observedInfo.operations?.length ?? 0,
        advertisedEventCount: observedInfo.events?.length ?? 0,
        advertisedPropertyCount: observedInfo.properties?.length ?? 0,
        recipeSelectorAdvertised: this.discoveryReport.recipeSelectorAdvertised,
      });
      return this.getConnectionInfo();
    } catch (error) {
      if (this.capabilityProbe) this.capabilityProbe.sessionClosed = !this.transport.sessionOpen;
      const serial = observedInfo?.serialNumber ?? this.transport.device?.serialNumber ?? null;
      const failedDiscovery = this._buildFailedDiscoveryReport(observedInfo, error, serial);
      const release = await this._releaseTransportAfterFailure(error, serial);
      this._clearConnectionState({ keepDiscovery: false });
      failedDiscovery.interfaceReleaseAttempted = release.attempted;
      failedDiscovery.interfaceReleasedAfterFailure = release.confirmed;
      this.discoveryReport = sanitizeDiagnostic(failedDiscovery, serial);
      throw redactError(error, serial);
    }
  }

  async disconnect() {
    try {
      await this.transport.closeDevice();
    } finally {
      this._clearConnectionState({ keepDiscovery: false });
    }
  }

  getConnectionInfo() {
    const usb = sanitizeDiagnostic(
      this.transport.getUsbDiagnostics?.() ?? this.transport.getLastUsbDiagnostics?.() ?? {},
      this._serial(),
    );
    const scanCapability = this.deviceInfo ? this._capabilityCheck(C_SCAN_OPERATIONS) : { supported: false, missing: [...C_SCAN_OPERATIONS] };
    const selectorAdvertised = this.deviceInfo?.properties?.includes(PTP_PROP.PRESET_SLOT) ?? false;
    const serial = this._serial();
    return {
      connected: Boolean(this.deviceInfo),
      usbDeviceOpen: this.transport.device?.opened === true,
      interfaceClaimed: this.transport.interfaceClaimed === true,
      interfaceReleased: Boolean(this.deviceInfo)
        && this.transport.device?.opened !== true
        && this.transport.interfaceClaimed !== true,
      mock: false,
      model: this.deviceInfo ? redactSensitiveText(this.deviceInfo.model ?? '', serial) : null,
      normalizedModel: this.deviceInfo ? normalizeModel(this.deviceInfo.model) : null,
      manufacturer: this.deviceInfo ? redactSensitiveText(this.deviceInfo.manufacturer ?? '', serial) : null,
      firmware: this.deviceInfo ? redactSensitiveText(this.deviceInfo.deviceVersion ?? '', serial) : null,
      vendorId: usb.vendorId ?? this.transport.device?.vendorId ?? null,
      productId: usb.productId ?? this.transport.device?.productId ?? null,
      connectedAt: this.connectedAt,
      recipeSelectorAdvertised: selectorAdvertised,
      supportsPresetProperties: selectorAdvertised && scanCapability.supported,
      supportsCSlotScan: selectorAdvertised && scanCapability.supported,
      supportsFullBackupRead: this.deviceInfo ? this._capabilityCheck(BACKUP_READ_OPERATIONS).supported : false,
      discoveryOnly: Boolean(this.deviceInfo),
      readOnly: true,
    };
  }

  getDiscoveryReport() {
    return this.discoveryReport
      ? sanitizeDiagnostic(this.discoveryReport, this._serial())
      : null;
  }

  /** Redact the private serial before owner-entered comparison notes cross into a report. */
  sanitizeReportText(value) {
    return redactSensitiveText(String(value ?? ''), this._serial())
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
      .trim();
  }

  /**
   * Read C1-C7 in one PTP session. The camera's initially selected slot is
   * visited first and restored, then independently confirmed, in cleanup.
   */
  async scanCSlots() {
    this.assertConnected();
    this._assertCScanCapabilities();
    this.cScanValidated = false;
    const sensitiveSerial = this._serial();
    const transactionStartSequence = transactionCursor(this.transport);

    const report = {
      status: 'IN_PROGRESS',
      ok: false,
      complete: false,
      recipePropertiesReadOnly: true,
      temporarySelectorWrites: true,
      selectorProperty: PTP_PROP.PRESET_SLOT,
      selectorPurpose: PTP_PURPOSE.C_SLOT_SELECTOR,
      originalSelector: null,
      scanOrder: [],
      selectorTransitions: [],
      slots: [],
      restoration: {
        attempted: false,
        required: null,
        writeAttempted: false,
        confirmed: false,
        observedSelector: null,
        recoveryAttempted: false,
        recoveredOnFreshConnection: false,
        error: null,
      },
      sessionClosed: false,
      cleanupSessionClosed: false,
      sessionCapability: null,
      transactions: [],
      transactionSummary: null,
      interfaceReleased: false,
      interfaceReleaseAttempted: false,
      interfaceReleasedAfterFailure: false,
      anomalies: [],
    };

    let sessionOpened = false;
    let originalSelector = null;
    let primaryError = null;

    try {
      await this.transport.openSession();
      sessionOpened = true;
      const sessionInfo = await this.transport.getDeviceInfo();
      const sessionCapability = capabilityCheck(sessionInfo, C_SCAN_OPERATIONS);
      const selectorAdvertised = sessionInfo?.properties?.includes(PTP_PROP.PRESET_SLOT) ?? false;
      report.sessionCapability = {
        model: sanitizeText(redactSensitiveText(sessionInfo?.model ?? '', sensitiveSerial)),
        normalizedModel: normalizeModel(sessionInfo?.model),
        selectorAdvertised,
        cSlotReadCapability: sessionCapability,
        propertyCount: sessionInfo?.properties?.length ?? 0,
        confirmedBeforeSelectorAccess: selectorAdvertised && sessionCapability.supported,
      };
      if (normalizeModel(sessionInfo?.model) !== 'XE5' || !selectorAdvertised || !sessionCapability.supported) {
        const missing = sessionCapability.missing.map(formatCode).join(', ') || 'none';
        const error = new Error(`The fresh scan session did not confirm the X-E5 C-slot capability gate (0xD18C advertised=${selectorAdvertised}; missing operations=${missing}). No selector property was accessed.`);
        // @ts-ignore - diagnostic code on a normal Error.
        error.code = 'SESSION_CAPABILITY_GATE_FAILED';
        throw error;
      }
      this.deviceInfo = adoptSessionCapabilities(this.deviceInfo, sessionInfo);
      const originalObservation = await this._getPropertyRawObservation(PTP_PROP.PRESET_SLOT);
      const originalBytes = copyBytes(originalObservation.bytes);
      originalSelector = exactSelector(originalBytes);
      if (originalSelector === null) {
        const error = new Error(`Property 0xD18C must be an exact 2-byte selector in the range 1..7; received ${originalBytes.byteLength} byte${originalBytes.byteLength === 1 ? '' : 's'} (${bytesToHex(originalBytes) || 'empty'}).`);
        // @ts-ignore - diagnostic code on a normal Error.
        error.code = 'INVALID_ORIGINAL_SELECTOR';
        throw error;
      }
      report.originalSelector = {
        value: originalSelector,
        payloadWidth: originalBytes.byteLength,
        rawHex: bytesToHex(originalBytes),
        bytes: originalBytes,
        operationName: originalObservation.operationName,
        transactionId: originalObservation.transactionId,
        responseCode: originalObservation.responseCode,
        responseName: originalObservation.responseName,
      };
      report.scanOrder = [originalSelector, ...range(1, 7).filter((index) => index !== originalSelector)];

      let selected = originalSelector;
      for (const index of report.scanOrder) {
        // The physical X-E5 firmware 1.10 returns live/current settings when
        // D18D-D1A5 are read before an explicit selector write, even when the
        // reported D18C value already equals the intended slot. Selecting the
        // same value is therefore required to enter stored-slot context.
        try {
          const confirmation = await this._selectSlotAndConfirm(index, selected, 'scan');
          report.selectorTransitions.push(selectorTransitionEvidence(selected, index, confirmation));
        } catch (error) {
          if (error?.selectorConfirmation) {
            report.selectorTransitions.push(selectorTransitionEvidence(selected, index, error.selectorConfirmation));
          }
          throw error;
        }
        selected = index;
        const slot = await this._readSlotSnapshot(index);
        report.slots.push(slot);
        if (slot.fatalError) throw slot.fatalError;
      }
    } catch (error) {
      primaryError = error;
      report.anomalies.push(errorDiagnostic('C-slot scan', error, this._serial()));
    } finally {
      if (originalSelector !== null) {
        report.restoration.attempted = true;
        try {
          await this._restoreOriginalSelector(originalSelector, report.restoration);
        } catch (error) {
          const initialRestoreError = error;
          report.restoration.error = safeErrorMessage(initialRestoreError, this._serial());
          report.anomalies.push(errorDiagnostic('Restore original selector', initialRestoreError, this._serial()));
          if (
            typeof this.transport.reopen === 'function'
            && (isFatalTransportError(primaryError) || isFatalTransportError(initialRestoreError))
          ) {
            report.restoration.recoveryAttempted = true;
            try {
              await this.transport.reopen();
              await this.transport.openSession();
              report.restoration.observedSelector = null;
              report.restoration.error = null;
              await this._restoreOriginalSelector(originalSelector, report.restoration);
              report.restoration.recoveredOnFreshConnection = true;
            } catch (recoveryError) {
              report.restoration.error = safeErrorMessage(recoveryError, this._serial());
              report.anomalies.push(errorDiagnostic('Fresh-connection selector recovery', recoveryError, this._serial()));
            }
          }
        }
      }

      if (this.transport.sessionOpen) {
        try {
          await this.transport.closeSession();
          report.cleanupSessionClosed = true;
          report.sessionClosed = !isFatalTransportError(primaryError);
          if (!report.sessionClosed) {
            report.anomalies.push({
              phase: 'Close PTP session',
              status: 'NOT_CLEANLY_CLOSED',
              message: 'The transport failed during the scan, so a clean PTP CloseSession response could not be established.',
            });
          }
        } catch (error) {
          report.anomalies.push(errorDiagnostic('Close PTP session', error, this._serial()));
        }
      } else if (sessionOpened) {
        report.sessionClosed = false;
        report.cleanupSessionClosed = false;
      }
    }

    fillMissingSlotRecords(report, primaryError, this.deviceInfo?.properties ?? [], sensitiveSerial);
    report.slots.sort((left, right) => left.index - right.index);
    const allSlotScansCompleted = report.slots.every((slot) => slot.complete);
    report.allReadsSuccessful = report.slots.every((slot) => slot.allReadsSuccessful);
    const protocolComplete = !primaryError
      && report.slots.length === 7
      && allSlotScansCompleted
      && report.restoration.confirmed
      && !report.restoration.error
      && report.restoration.responseOk !== false
      && report.sessionClosed;

    if (protocolComplete) {
      report.interfaceReleaseAttempted = true;
      try {
        await this.transport.closeDevice({ forgetDevice: false, skipSessionClose: true });
        report.interfaceReleased = this.transport.interfaceClaimed !== true && this.transport.device?.opened !== true;
        if (!report.interfaceReleased) throw new Error('The USB PTP interface remained claimed after the C-slot scan cleanup.');
      } catch (error) {
        primaryError = error;
        report.anomalies.push(errorDiagnostic('Release USB interface after C-slot scan', error, this._serial()));
      }
    }

    report.transactions = this.transport.getTransactionDiagnostics?.(transactionStartSequence) ?? [];
    report.transactionSummary = summarizeTransactions(report.transactions);
    report.complete = protocolComplete
      && !primaryError
      && report.interfaceReleased
      && report.transactionSummary.metadataComplete
      && report.transactionSummary.strictlyIncreasing;
    report.stageGatePassed = report.complete && report.allReadsSuccessful;
    report.ok = report.stageGatePassed;
    report.status = report.complete
      ? report.allReadsSuccessful ? 'COMPLETE' : 'COMPLETE_WITH_UNAVAILABLE_PROPERTIES'
      : 'FAILED';
    this.cScanValidated = report.stageGatePassed;

    if (!report.stageGatePassed) {
      const failure = primaryError ?? new Error('The C-slot scan did not complete every advertised read, selector restoration, and session cleanup gate.');
      const release = await this._releaseTransportAfterFailure(failure, sensitiveSerial);
      report.interfaceReleaseAttempted = release.attempted;
      report.interfaceReleasedAfterFailure = release.confirmed;
      this._clearConnectionState({ keepDiscovery: true });
    } else {
      this._log('C1-C7 recipe-property reads complete after temporary 0xD18C selector changes', {
        slots: report.slots.length,
        allAdvertisedReadsSuccessful: report.allReadsSuccessful,
        laterStageGatePassed: report.stageGatePassed,
        originalSelector,
        restorationConfirmed: report.restoration.confirmed,
        sessionClosed: report.sessionClosed,
      });
    }

    return sanitizeDiagnostic(report, sensitiveSerial);
  }

  /**
   * Download object handle 0 in a fresh session after a successful C scan.
   * ObjectInfo format and declared size are validated before GetObject runs;
   * actual size and X-E5 model are validated before FS decoding.
   */
  async readFullBackup() {
    this.assertConnected();
    if (!this.cScanValidated) {
      throw new Error('A complete C1-C7 scan with confirmed selector restoration and session cleanup is required before reading the full backup.');
    }
    this._assertBackupCapabilities();
    const transactionStartSequence = transactionCursor(this.transport);

    let sessionOpened = false;
    let interfaceReclaimedForRead = false;
    let result;
    let primaryError = null;
    let closeError = null;
    try {
      if (this.transport.interfaceClaimed !== true || this.transport.device?.opened !== true) {
        if (typeof this.transport.reopen !== 'function') {
          throw new Error('The released WebUSB interface cannot be reclaimed for the guarded full-backup read.');
        }
        await this.transport.reopen();
        interfaceReclaimedForRead = true;
      }
      if (this.transport.sessionOpen) await this.transport.closeSession();
      await this.transport.openSession();
      sessionOpened = true;

      const objectInfoBytes = copyBytes(await this.transport.getObjectInfo(BACKUP_HANDLE));
      const objectInfo = sanitizeObjectInfo(parseObjectInfo(objectInfoBytes), this._serial());
      if (objectInfo.objectFormat !== BACKUP_FORMAT) {
        throw new Error(`GetObjectInfo(0) reported object format ${formatCode(objectInfo.objectFormat)}; expected ${formatCode(BACKUP_FORMAT)} for the X-E5 settings backup.`);
      }
      if (objectInfo.objectCompressedSize !== X_E5_FS_LAYOUT.blobSize) {
        throw new Error(`GetObjectInfo(0) declared ${objectInfo.objectCompressedSize} bytes; expected exactly ${X_E5_FS_LAYOUT.blobSize} bytes for an X-E5 backup.`);
      }

      const bytes = copyBytes(await this.transport.getObject(BACKUP_HANDLE));
      if (bytes.byteLength !== objectInfo.objectCompressedSize) {
        throw new Error(`GetObject(0) returned ${bytes.byteLength} bytes, but ObjectInfo declared ${objectInfo.objectCompressedSize} bytes.`);
      }
      if (bytes.byteLength !== X_E5_FS_LAYOUT.blobSize) {
        throw new Error(`GetObject(0) returned ${bytes.byteLength} bytes; expected exactly ${X_E5_FS_LAYOUT.blobSize} bytes.`);
      }
      const backupModel = modelFromBackup(bytes);
      if (normalizeModel(this.deviceInfo?.model) !== 'XE5' || normalizeModel(backupModel) !== 'XE5') {
        throw new Error(`Full-backup model validation failed: DeviceInfo=${sanitizeText(this.deviceInfo?.model) || 'unknown'}, backup=${sanitizeText(backupModel) || 'unknown'}.`);
      }

      assertXe5Backup(bytes);
      const fsSlots = decodeFsSlots(bytes);
      result = {
        bytes,
        model: backupModel,
        normalizedModel: normalizeModel(backupModel),
        size: bytes.byteLength,
        declaredSize: objectInfo.objectCompressedSize,
        expectedSize: X_E5_FS_LAYOUT.blobSize,
        objectFormat: objectInfo.objectFormat,
        objectInfo,
        sha256: await sha256Hex(bytes),
        fsSlots,
        decodeGate: {
          deviceInfoModelIsXe5: true,
          backupModelIsXe5: true,
          objectFormatMatches: true,
          declaredSizeMatchesActual: true,
          exactExpectedSize: true,
          passed: true,
        },
        sessionClosed: false,
        interfaceReleased: false,
        interfaceReclaimedForRead,
        transactions: [],
        transactionSummary: null,
        anomalies: [],
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      primaryError = error;
    } finally {
      if (sessionOpened) {
        try {
          await this.transport.closeSession();
        } catch (error) {
          closeError = error;
        }
      }
    }

    if (primaryError || closeError) {
      const failure = primaryError ?? closeError;
      const serial = this._serial();
      if (primaryError && closeError && typeof primaryError === 'object' && primaryError) {
        // @ts-ignore - attach cleanup context without replacing the primary failure.
        primaryError.cleanupError = safeErrorMessage(closeError, this._serial());
      }
      await this._releaseTransportAfterFailure(failure, serial);
      this._clearConnectionState({ keepDiscovery: true });
      throw redactError(failure, serial);
    }

    result.sessionClosed = true;
    const serial = this._serial();
    try {
      await this.transport.closeDevice();
      if (this.transport.interfaceClaimed || this.transport.device?.opened) {
        throw new Error('The USB PTP interface remained claimed after the full-backup read cleanup.');
      }
      result.interfaceReleased = true;
    } catch (error) {
      await this._releaseTransportAfterFailure(error, serial);
      this._clearConnectionState({ keepDiscovery: true });
      throw redactError(error, serial);
    }
    result.transactions = this.transport.getTransactionDiagnostics?.(transactionStartSequence) ?? [];
    result.transactionSummary = summarizeTransactions(result.transactions);
    if (!result.transactionSummary.metadataComplete || !result.transactionSummary.strictlyIncreasing) {
      const error = new Error('The full-backup read completed without complete, monotonically increasing PTP transaction evidence.');
      this._clearConnectionState({ keepDiscovery: true });
      throw error;
    }
    this._log('Read-only X-E5 full backup validated and USB interface released', {
      objectFormat: formatCode(result.objectFormat),
      declaredSize: result.declaredSize,
      actualSize: result.size,
      sha256: result.sha256,
      fsSlotCount: result.fsSlots.length,
      interfaceReleased: result.interfaceReleased,
    });
    this._clearConnectionState({ keepDiscovery: true });
    return result;
  }

  // The physical client intentionally keeps every non-selector mutation path
  // hard-disabled for the complete read-only validation stage.
  async writeCSlot() { throw readOnlyStageError('C-slot writes'); }
  async prepareFsWrite() { throw readOnlyStageError('FS backup patching'); }
  async restoreFullBackup() { throw readOnlyStageError('Full-backup restore'); }
  async verifyFsSlotAfterReconnect() { throw readOnlyStageError('Post-restore FS verification'); }
  async renderRafPreview() { throw readOnlyStageError('RAW upload and conversion'); }
  async readAllSlots() { throw stagedReadError('Use scanCSlots(), then readFullBackup(), in that order.'); }
  async readCSlot() { throw stagedReadError('Use scanCSlots() so the original 0xD18C selector is always restored.'); }
  async selectCSlot() { throw readOnlyStageError('Unscoped C-slot selector changes'); }
  async readSelectedCSlot() { throw stagedReadError('The selector is read only inside scanCSlots().'); }

  assertConnected() {
    if (!this.deviceInfo || normalizeModel(this.deviceInfo.model) !== 'XE5') {
      throw new Error('The X-E5 read-only discovery stage is not connected.');
    }
  }

  _assertCScanCapabilities() {
    const selectorAdvertised = this.deviceInfo?.properties?.includes(PTP_PROP.PRESET_SLOT) ?? false;
    const capability = this._capabilityCheck(C_SCAN_OPERATIONS);
    if (!selectorAdvertised || !capability.supported) {
      const missing = capability.missing.map(formatCode).join(', ');
      throw new Error(`C-slot scanning is unavailable: DeviceInfo must advertise property 0xD18C and operations ${C_SCAN_OPERATIONS.map(formatCode).join(', ')}.${missing ? ` Missing operations: ${missing}.` : ''}`);
    }
  }

  _assertBackupCapabilities() {
    const capability = this._capabilityCheck(BACKUP_READ_OPERATIONS);
    if (!capability.supported) {
      throw new Error(`Full-backup reading is unavailable. DeviceInfo is missing operations: ${capability.missing.map(formatCode).join(', ')}.`);
    }
  }

  /** @param {number[]} required */
  _capabilityCheck(required) {
    return capabilityCheck(this.deviceInfo, required);
  }

  _buildDiscoveryReport() {
    const deviceInfo = sanitizeDeviceInfo(this.deviceInfo);
    const usb = sanitizeDiagnostic(
      this.transport.getUsbDiagnostics?.() ?? this.transport.getLastUsbDiagnostics?.() ?? {},
      this._serial(),
    );
    const cScan = this._capabilityCheck(C_SCAN_OPERATIONS);
    const backupRead = this._capabilityCheck(BACKUP_READ_OPERATIONS);
    const recipeSelectorAdvertised = deviceInfo.properties.includes(PTP_PROP.PRESET_SLOT);
    const transactions = this.transport.getTransactionDiagnostics?.(this.discoveryTransactionStartSequence) ?? [];
    return sanitizeDiagnostic({
      stage: 'DISCOVERY_ONLY',
      readOnly: true,
      sessionOpened: this.capabilityProbe?.attempted === true,
      sessionCurrentlyOpen: this.transport.sessionOpen === true,
      sessionClosedAfterCapabilityProbe: this.capabilityProbe?.sessionClosed === true,
      usb,
      deviceInfo,
      initialDeviceInfo: sanitizeDeviceInfo(this.initialDeviceInfo),
      capabilityProbe: sanitizeDiagnostic(this.capabilityProbe, this._serial()),
      transactions,
      transactionSummary: summarizeTransactions(transactions),
      normalizedModel: normalizeModel(deviceInfo.model),
      recipeSelectorAdvertised,
      supportsPresetProperties: recipeSelectorAdvertised && cScan.supported,
      cSlotReadCapability: cScan,
      fullBackupReadCapability: backupRead,
    }, this._serial());
  }

  _buildFailedDiscoveryReport(observedInfo, error, serial) {
    const deviceInfo = observedInfo ? sanitizeDeviceInfo(observedInfo) : null;
    const transactions = this.transport.getTransactionDiagnostics?.(this.discoveryTransactionStartSequence) ?? [];
    const selectorAdvertised = deviceInfo?.properties.includes(PTP_PROP.PRESET_SLOT) ?? false;
    return sanitizeDiagnostic({
      stage: 'DISCOVERY_FAILED',
      readOnly: true,
      usb: sanitizeDiagnostic(
        this.transport.getUsbDiagnostics?.() ?? this.transport.getLastUsbDiagnostics?.() ?? {},
        serial,
      ),
      deviceInfo,
      initialDeviceInfo: this.initialDeviceInfo ? sanitizeDeviceInfo(this.initialDeviceInfo) : null,
      normalizedModel: deviceInfo ? normalizeModel(deviceInfo.model) : null,
      recipeSelectorAdvertised: selectorAdvertised,
      capabilityProbe: sanitizeDiagnostic(this.capabilityProbe, serial),
      failure: errorDiagnostic('Read-only discovery/capability probe', error, serial),
      transactions,
      transactionSummary: summarizeTransactions(transactions),
      interfaceReleaseAttempted: false,
      interfaceReleasedAfterFailure: false,
    }, serial);
  }

  /** Read one property while preserving the transport-level transaction evidence. */
  async _getPropertyRawObservation(propertyCode) {
    if (typeof this.transport.getPropertyRawWithMetadata === 'function') {
      const observation = await this.transport.getPropertyRawWithMetadata(propertyCode);
      if (!(observation?.bytes instanceof Uint8Array)) {
        const error = new Error(`GetDevicePropValue(${formatCode(propertyCode)}) returned no binary payload.`);
        // @ts-ignore - stable diagnostic code for a malformed transport adapter.
        error.code = 'PROPERTY_PAYLOAD_MISSING';
        throw error;
      }
      return {
        bytes: observation.bytes,
        transactionId: observation.transactionId ?? null,
        responseCode: observation.responseCode ?? PTP_RESPONSE.OK,
        responseName: observation.responseName ?? responseName(observation.responseCode ?? PTP_RESPONSE.OK),
        operationName: observation.operationName ?? 'GET_DEVICE_PROP_VALUE',
      };
    }
    const bytes = await this.transport.getPropertyRaw(propertyCode);
    return {
      bytes,
      transactionId: null,
      responseCode: PTP_RESPONSE.OK,
      responseName: responseName(PTP_RESPONSE.OK),
      operationName: 'GET_DEVICE_PROP_VALUE',
    };
  }

  /** @param {number} target @param {number|null} from @param {string} phase */
  async _selectSlotAndConfirm(target, from, phase) {
    this._log('Temporary C-slot selector change', {
      phase,
      property: '0xD18C',
      from,
      to: target,
      purpose: PTP_PURPOSE.C_SLOT_SELECTOR,
    });
    const writeObservation = typeof this.transport.setPropertyU16WithMetadata === 'function'
      ? await this.transport.setPropertyU16WithMetadata(
        PTP_PROP.PRESET_SLOT,
        target,
        { purpose: PTP_PURPOSE.C_SLOT_SELECTOR },
      )
      : {
        responseCode: await this.transport.setPropertyU16(
          PTP_PROP.PRESET_SLOT,
          target,
          { purpose: PTP_PURPOSE.C_SLOT_SELECTOR },
        ),
        responseName: null,
        transactionId: null,
        operationName: 'SET_DEVICE_PROP_VALUE',
      };
    const responseCode = writeObservation.responseCode;
    let lastObserved = null;
    let lastWidth = null;
    let lastError = null;
    let lastReadObservation = null;
    const readBackAttempts = [];
    for (let attempt = 1; attempt <= SELECTOR_CONFIRM_ATTEMPTS; attempt += 1) {
      try {
        const readObservation = await this._getPropertyRawObservation(PTP_PROP.PRESET_SLOT);
        lastReadObservation = readObservation;
        const bytes = copyBytes(readObservation.bytes);
        lastWidth = bytes.byteLength;
        lastObserved = exactSelector(bytes);
        readBackAttempts.push({
          attempt,
          operationName: readObservation.operationName,
          transactionId: readObservation.transactionId,
          responseCode: readObservation.responseCode,
          responseName: readObservation.responseName,
          observedValue: lastObserved,
          payloadWidth: bytes.byteLength,
          status: lastObserved === target ? 'CONFIRMED' : 'MISMATCH',
        });
        if (lastObserved === target) {
          const confirmation = {
            attempts: attempt,
            value: lastObserved,
            bytes,
            responseCode,
            responseName: writeObservation.responseName ?? responseName(responseCode),
            responseOk: responseCode === PTP_RESPONSE.OK,
            writeOperationName: writeObservation.operationName ?? 'SET_DEVICE_PROP_VALUE',
            writeTransactionId: writeObservation.transactionId ?? null,
            readOperationName: readObservation.operationName,
            readTransactionId: readObservation.transactionId,
            readResponseCode: readObservation.responseCode,
            readResponseName: readObservation.responseName,
            readBackAttempts,
          };
          if (responseCode !== PTP_RESPONSE.OK) {
            const error = new PtpResponseError(
              responseCode,
              `${phase === 'restore' ? 'Restore' : 'Select'} C${target} through 0xD18C`,
              writeObservation.transactionId ?? null,
              'SET_DEVICE_PROP_VALUE',
              PTP_PROP.PRESET_SLOT,
            );
            // @ts-ignore - retain bounded read-back evidence on the response error.
            error.selectorConfirmation = confirmation;
            throw error;
          }
          return confirmation;
        }
      } catch (error) {
        lastError = error;
        if (!readBackAttempts.some((item) => item.attempt === attempt)) {
          readBackAttempts.push({
            attempt,
            operationName: error?.operationName ?? error?.operation ?? 'GET_DEVICE_PROP_VALUE',
            transactionId: error?.transactionId ?? null,
            responseCode: Number(error?.responseCode) || null,
            responseName: error?.responseName ?? null,
            observedValue: null,
            payloadWidth: null,
            status: classifyReadError(error, this._serial(), PTP_PROP.PRESET_SLOT).observation.readStatus,
          });
        }
        if (isFatalTransportError(error)) {
          // @ts-ignore - retain partial, payload-free selector evidence before teardown.
          error.selectorConfirmation = {
            attempts: attempt,
            value: lastObserved,
            bytes: lastReadObservation?.bytes ?? null,
            responseCode,
            responseName: writeObservation.responseName ?? responseName(responseCode),
            responseOk: responseCode === PTP_RESPONSE.OK,
            writeOperationName: writeObservation.operationName ?? 'SET_DEVICE_PROP_VALUE',
            writeTransactionId: writeObservation.transactionId ?? null,
            readOperationName: error?.operationName ?? error?.operation ?? 'GET_DEVICE_PROP_VALUE',
            readTransactionId: error?.transactionId ?? null,
            readResponseCode: Number(error?.responseCode) || null,
            readResponseName: error?.responseName ?? null,
            readBackAttempts,
          };
          throw error;
        }
      }
      if (attempt < SELECTOR_CONFIRM_ATTEMPTS) await this.wait(SELECTOR_POLL_DELAY_MS);
    }
    const detail = lastError
      ? safeErrorMessage(lastError, this._serial())
      : `last selector=${lastObserved ?? 'invalid'}, width=${lastWidth ?? 'unknown'}`;
    if (responseCode !== PTP_RESPONSE.OK) {
      const error = new PtpResponseError(
        responseCode,
        `${phase === 'restore' ? 'Restore' : 'Select'} C${target} through 0xD18C; bounded read-back did not confirm the target (${detail})`,
        writeObservation.transactionId ?? null,
        'SET_DEVICE_PROP_VALUE',
        PTP_PROP.PRESET_SLOT,
      );
      // @ts-ignore - retain the last safe selector observation.
      error.selectorConfirmation = {
        attempts: SELECTOR_CONFIRM_ATTEMPTS,
        value: lastObserved,
        bytes: null,
        responseCode,
        responseName: writeObservation.responseName ?? responseName(responseCode),
        responseOk: false,
        writeOperationName: writeObservation.operationName ?? 'SET_DEVICE_PROP_VALUE',
        writeTransactionId: writeObservation.transactionId ?? null,
        readOperationName: lastReadObservation?.operationName ?? lastError?.operation ?? null,
        readTransactionId: lastReadObservation?.transactionId ?? lastError?.transactionId ?? null,
        readResponseCode: lastReadObservation?.responseCode ?? (Number(lastError?.responseCode) || null),
        readResponseName: lastReadObservation?.responseName ?? lastError?.responseName ?? null,
        readBackAttempts,
      };
      throw error;
    }
    const error = new Error(`C${target} was not confirmed through 0xD18C after ${SELECTOR_CONFIRM_ATTEMPTS} bounded reads (${detail}).`);
    // @ts-ignore - diagnostic code on a normal Error.
    error.code = 'SELECTOR_CONFIRMATION_FAILED';
    // @ts-ignore - retain bounded write/read evidence on confirmation failure.
    error.selectorConfirmation = {
      attempts: SELECTOR_CONFIRM_ATTEMPTS,
      value: lastObserved,
      bytes: lastReadObservation?.bytes ?? null,
      responseCode,
      responseName: writeObservation.responseName ?? responseName(responseCode),
      responseOk: true,
      writeOperationName: writeObservation.operationName ?? 'SET_DEVICE_PROP_VALUE',
      writeTransactionId: writeObservation.transactionId ?? null,
      readOperationName: lastReadObservation?.operationName ?? lastError?.operation ?? null,
      readTransactionId: lastReadObservation?.transactionId ?? lastError?.transactionId ?? null,
      readResponseCode: lastReadObservation?.responseCode ?? (Number(lastError?.responseCode) || null),
      readResponseName: lastReadObservation?.responseName ?? lastError?.responseName ?? null,
      readBackAttempts,
    };
    throw error;
  }

  /** @param {number} index */
  async _readSlotSnapshot(index) {
    const advertisedProperties = new Set(this.deviceInfo?.properties ?? []);
    const rawReads = new Map();
    let fatalError = null;

    for (const code of PROPERTY_CODES) {
      if (fatalError) {
        rawReads.set(code, notAttemptedObservation(code, fatalError, this._serial()));
        continue;
      }
      const observation = await this._readProperty(code);
      rawReads.set(code, observation);
      if (observation.fatalError) fatalError = observation.fatalError;
    }

    /** @type {import('./x-e5-codecs.js').RawPropertyMap} */
    const decodable = new Map();
    for (const [code, observation] of rawReads) {
      if (observation.bytes instanceof Uint8Array) {
        decodable.set(code, { code, bytes: observation.bytes, value: null });
      }
    }
    const values = decodeCSlotProperties(decodable);
    const diagnostics = new Map();
    let name = null;

    for (const code of PROPERTY_CODES) {
      const observation = rawReads.get(code);
      if (!(observation?.bytes instanceof Uint8Array)) {
        diagnostics.set(code, {
          ...stripInternalObservation(observation),
          advertised: advertisedProperties.has(code),
        });
        continue;
      }
      const description = describeCSlotProperty(code, observation.bytes, values);
      const readStatus = successfulPayloadStatus(description);
      const decoded = description.decoded.map((item) => ({ ...item }));
      const firstDecoded = decoded[0] ?? null;
      const diagnostic = {
        code,
        propertyCode: code,
        bytes: observation.bytes,
        value: description.rawValue,
        label: description.label,
        encoding: description.encoding,
        expectedWidth: description.expectedWidth,
        payloadWidth: description.payloadWidth,
        rawHex: description.rawHex,
        rawValue: description.rawValue,
        decoded,
        canonicalKey: decoded.length === 1 ? firstDecoded?.field ?? null : null,
        canonicalValue: decoded.length === 1 ? firstDecoded?.canonicalValue ?? null : null,
        normalization: description.normalization,
        uncertainty: description.uncertainty,
        readStatus,
        status: readStatus,
        attempts: observation.attempts,
        operationName: observation.operationName ?? null,
        transactionId: observation.transactionId ?? null,
        responseCode: observation.responseCode ?? null,
        responseName: observation.responseName ?? null,
        advertised: advertisedProperties.has(code),
      };
      if (code === PTP_PROP.PRESET_NAME && typeof diagnostic.rawValue === 'string') {
        const exactDecodedName = redactSensitiveText(diagnostic.rawValue, this._serial());
        const canonicalName = sanitizeText(exactDecodedName);
        diagnostic.rawValue = exactDecodedName;
        diagnostic.value = exactDecodedName;
        if (canonicalName !== exactDecodedName) {
          diagnostic.normalization = [diagnostic.normalization, 'The canonical display name trims/collapses whitespace and removes control characters; the decoded raw string and payload bytes remain separate evidence.'].filter(Boolean).join(' ');
        }
        if (diagnostic.decoded[0]) diagnostic.decoded[0].canonicalValue = canonicalName;
        diagnostic.canonicalValue = canonicalName;
        name = diagnostic.uncertainty ? null : canonicalName;
      }
      diagnostics.set(code, diagnostic);
    }

    const observations = [...diagnostics.values()];
    const allReadsSuccessful = observations.every((observation) => {
      if (SUCCESSFUL_READ_STATUSES.has(observation.readStatus)) return true;
      return observation.readStatus === 'UNSUPPORTED' && !observation.advertised;
    });
    const complete = !fatalError && observations.every((observation) => observation.readStatus !== 'NOT_ATTEMPTED');
    return {
      id: `C${index}`,
      type: 'C',
      index,
      name,
      values,
      rawProperties: diagnostics,
      propertyDiagnostics: [...diagnostics.values()],
      readStatus: complete
        ? allReadsSuccessful ? 'COMPLETE' : 'COMPLETE_WITH_UNAVAILABLE_PROPERTIES'
        : fatalError ? 'ABORTED' : 'PARTIAL',
      complete,
      allReadsSuccessful,
      fatalError,
      readAt: new Date().toISOString(),
    };
  }

  /** @param {number} code */
  async _readProperty(code) {
    let lastError = null;
    for (let attempt = 1; attempt <= DEVICE_BUSY_READ_ATTEMPTS; attempt += 1) {
      try {
        const observation = await this._getPropertyRawObservation(code);
        const bytes = copyBytes(observation.bytes);
        return {
          code,
          bytes,
          attempts: attempt,
          fatalError: null,
          operationName: observation.operationName,
          transactionId: observation.transactionId,
          responseCode: observation.responseCode,
          responseName: observation.responseName,
        };
      } catch (error) {
        lastError = error;
        if (!isDeviceBusy(error) || attempt === DEVICE_BUSY_READ_ATTEMPTS) break;
        await this.wait(SELECTOR_POLL_DELAY_MS);
      }
    }
    const classified = classifyReadError(lastError, this._serial(), code);
    return {
      code,
      bytes: null,
      attempts: isDeviceBusy(lastError) ? DEVICE_BUSY_READ_ATTEMPTS : 1,
      fatalError: classified.fatal ? lastError : null,
      ...classified.observation,
    };
  }

  /** @param {number} original @param {any} restoration */
  async _restoreOriginalSelector(original, restoration) {
    let observed = null;
    try {
      const observation = await this._getPropertyRawObservation(PTP_PROP.PRESET_SLOT);
      const bytes = copyBytes(observation.bytes);
      observed = exactSelector(bytes);
      restoration.observedSelector = observed;
      restoration.observedWidth = bytes.byteLength;
      restoration.observedRawHex = bytesToHex(bytes);
      restoration.observedBytes = bytes;
      restoration.preRestoreOperationName = observation.operationName;
      restoration.preRestoreTransactionId = observation.transactionId;
      restoration.preRestoreResponseCode = observation.responseCode;
      restoration.preRestoreResponseName = observation.responseName;
    } catch (error) {
      restoration.preRestoreReadError = safeErrorMessage(error, this._serial());
      restoration.preRestoreOperationName = error?.operationName ?? error?.operation ?? 'GET_DEVICE_PROP_VALUE';
      restoration.preRestoreTransactionId = error?.transactionId ?? null;
      restoration.preRestoreResponseCode = Number(error?.responseCode) || null;
      restoration.preRestoreResponseName = error?.responseName ?? null;
    }

    restoration.required = observed !== original;
    if (restoration.required) {
      restoration.writeAttempted = true;
      try {
        const confirmation = await this._selectSlotAndConfirm(original, observed, 'restore');
        restoration.confirmationAttempts = confirmation.attempts;
        restoration.observedSelector = confirmation.value;
        restoration.responseCode = confirmation.responseCode;
        restoration.responseName = confirmation.responseName;
        restoration.responseOk = confirmation.responseOk;
        restoration.writeOperationName = confirmation.writeOperationName;
        restoration.writeTransactionId = confirmation.writeTransactionId;
        restoration.readOperationName = confirmation.readOperationName;
        restoration.readTransactionId = confirmation.readTransactionId;
        restoration.readResponseCode = confirmation.readResponseCode;
        restoration.readResponseName = confirmation.readResponseName;
        restoration.readBackAttempts = confirmation.readBackAttempts?.map((item) => ({ ...item })) ?? [];
        restoration.confirmedPayloadWidth = confirmation.bytes?.byteLength ?? null;
        restoration.confirmedRawHex = confirmation.bytes ? bytesToHex(confirmation.bytes) : '';
        restoration.confirmedBytes = confirmation.bytes ?? null;
      } catch (error) {
        const confirmation = error?.selectorConfirmation;
        if (confirmation?.value === original) {
          restoration.confirmationAttempts = confirmation.attempts;
          restoration.observedSelector = confirmation.value;
          restoration.responseCode = confirmation.responseCode;
          restoration.responseName = confirmation.responseName;
          restoration.responseOk = false;
          restoration.writeOperationName = confirmation.writeOperationName ?? null;
          restoration.writeTransactionId = confirmation.writeTransactionId ?? null;
          restoration.readOperationName = confirmation.readOperationName ?? null;
          restoration.readTransactionId = confirmation.readTransactionId ?? null;
          restoration.readResponseCode = confirmation.readResponseCode ?? null;
          restoration.readResponseName = confirmation.readResponseName ?? null;
          restoration.readBackAttempts = confirmation.readBackAttempts?.map((item) => ({ ...item })) ?? [];
          restoration.confirmedPayloadWidth = confirmation.bytes?.byteLength ?? null;
          restoration.confirmedRawHex = confirmation.bytes ? bytesToHex(confirmation.bytes) : '';
          restoration.confirmedBytes = confirmation.bytes ?? null;
          restoration.confirmed = true;
        }
        throw error;
      }
    }
    restoration.confirmed = restoration.observedSelector === original;
    if (!restoration.confirmed) {
      throw new Error(`The original C${original} selector was not confirmed during cleanup.`);
    }
  }

  async _releaseTransportAfterFailure(error, serial = this._serial()) {
    const safe = new Error(safeErrorMessage(error, serial));
    try {
      if (typeof this.transport.releaseAfterFailure === 'function') {
        await this.transport.releaseAfterFailure(safe);
      } else {
        await this.transport.closeDevice({ forgetDevice: false, skipSessionClose: true });
      }
    } catch {
      // Best effort after the original failure; no sensitive detail is logged.
      return { attempted: true, confirmed: false };
    }
    return {
      attempted: true,
      confirmed: this.transport.interfaceClaimed !== true && this.transport.device?.opened !== true,
    };
  }

  /** @param {{ keepDiscovery: boolean }} options */
  _clearConnectionState(options) {
    this.deviceInfo = null;
    this.initialDeviceInfo = null;
    this.capabilityProbe = null;
    this.connectedAt = null;
    this.cScanValidated = false;
    if (!options.keepDiscovery) this.discoveryReport = null;
  }

  _serial() {
    return this.deviceInfo?.serialNumber ?? null;
  }

  /** @param {string} message @param {any} [detail] */
  _log(message, detail) {
    try {
      this.logger(
        redactSensitiveText(String(message), this._serial()),
        detail === undefined ? undefined : sanitizeDiagnostic(detail, this._serial()),
      );
    } catch {
      // Diagnostics must not interfere with safety cleanup.
    }
  }
}

/**
 * Convert a slot snapshot to a portable JSON-safe object.
 *
 * @param {any} slot
 */
export function serializeSlotSnapshot(slot) {
  const { rawProperties, propertyDiagnostics: _propertyDiagnostics, fatalError, ...snapshot } = slot;
  const properties = rawProperties instanceof Map
    ? [...rawProperties.values()]
    : Array.isArray(rawProperties) ? rawProperties : null;
  return {
    ...snapshot,
    fatalError: fatalError ? safeErrorMessage(fatalError, null) : null,
    rawProperties: properties
      ? properties.map((property) => {
        const { bytes, fatalError, ...rest } = property;
        return {
          ...rest,
          fatalError: fatalError ? safeErrorMessage(fatalError, null) : null,
          bytesBase64: bytes instanceof Uint8Array ? bytesToBase64(bytes) : null,
        };
      })
      : null,
  };
}

/** @param {any} info */
function sanitizeDeviceInfo(info) {
  return {
    standardVersion: info?.standardVersion ?? null,
    vendorExtensionId: info?.vendorExtensionId ?? null,
    vendorExtensionVersion: info?.vendorExtensionVersion ?? null,
    vendorExtensionDescription: info?.vendorExtensionDescription ?? '',
    functionalMode: info?.functionalMode ?? null,
    operations: [...(info?.operations ?? [])],
    events: [...(info?.events ?? [])],
    properties: [...(info?.properties ?? [])],
    captureFormats: [...(info?.captureFormats ?? [])],
    imageFormats: [...(info?.imageFormats ?? [])],
    manufacturer: info?.manufacturer ?? '',
    model: info?.model ?? '',
    deviceVersion: info?.deviceVersion ?? '',
  };
}

/** @param {Record<string, any>} info @param {string|null} serial */
function sanitizeObjectInfo(info, serial) {
  return {
    ...info,
    filename: sanitizeText(redactSensitiveText(info.filename, serial)),
    captureDate: sanitizeText(redactSensitiveText(info.captureDate, serial)),
    modificationDate: sanitizeText(redactSensitiveText(info.modificationDate, serial)),
    keywords: sanitizeText(redactSensitiveText(info.keywords, serial)),
  };
}

/** @param {any} report @param {unknown} error @param {number[]} advertised @param {string|null} serial */
function fillMissingSlotRecords(report, error, advertised, serial) {
  const existing = new Set(report.slots.map((slot) => slot.index));
  for (let index = 1; index <= 7; index += 1) {
    if (existing.has(index)) continue;
    const diagnostics = new Map(PROPERTY_CODES.map((code) => [code, notAttemptedObservation(code, error, serial, advertised.includes(code))]));
    report.slots.push({
      id: `C${index}`,
      type: 'C',
      index,
      name: null,
      values: decodeCSlotProperties(new Map()),
      rawProperties: diagnostics,
      propertyDiagnostics: [...diagnostics.values()],
      readStatus: 'NOT_ATTEMPTED',
      complete: false,
      allReadsSuccessful: false,
      fatalError: null,
      readAt: null,
    });
  }
}

/** @param {number} code @param {unknown} error @param {string|null} serial @param {boolean} [advertised] */
function notAttemptedObservation(code, error, serial, advertised = false) {
  const emptyDescription = describeCSlotProperty(code, new Uint8Array(), {});
  return {
    code,
    propertyCode: code,
    bytes: null,
    value: null,
    label: emptyDescription.label,
    encoding: emptyDescription.encoding,
    expectedWidth: emptyDescription.expectedWidth,
    payloadWidth: null,
    rawHex: '',
    rawValue: null,
    decoded: [],
    canonicalKey: null,
    canonicalValue: null,
    normalization: null,
    uncertainty: null,
    readStatus: 'NOT_ATTEMPTED',
    status: 'NOT_ATTEMPTED',
    attempts: 0,
    advertised,
    error: error ? `Not attempted after: ${safeErrorMessage(error, serial)}` : 'Not attempted.',
  };
}

/** @param {any} observation */
function stripInternalObservation(observation) {
  if (!observation) return observation;
  const { fatalError, ...safe } = observation;
  return safe;
}

/** @param {unknown} error @param {string|null} serial @param {number} [propertyCode] */
function classifyReadError(error, serial, propertyCode = 0) {
  const responseCode = Number(error?.responseCode);
  let readStatus = 'ERROR';
  let uncertainty = null;
  let fatal = false;

  if (UNSUPPORTED_RESPONSES.has(responseCode)) readStatus = 'UNSUPPORTED';
  else if (responseCode === PTP_RESPONSE.DEVICE_BUSY) readStatus = 'DEVICE_BUSY';
  else if (responseCode === PTP_RESPONSE.ACCESS_DENIED) {
    readStatus = 'ACCESS_DENIED';
    uncertainty = 'PTP 0x200F is named AccessDenied, but Fujifilm bodies may overload this response; it is not reclassified without physical X-E5 evidence.';
  } else if (responseCode === PTP_RESPONSE.INCOMPLETE_TRANSFER) readStatus = 'INCOMPLETE_TRANSFER';
  else {
    const code = String(error?.code ?? '').toUpperCase();
    if (code.includes('TIMEOUT')) readStatus = 'TIMEOUT';
    else if (code.includes('TRANSACTION')) readStatus = 'TRANSACTION_MISMATCH';
    else if (code.includes('DISCONNECT') || code.includes('NOT_CONNECTED')) readStatus = 'DISCONNECTED';
    else if (code.includes('STALL')) readStatus = 'STALLED_ENDPOINT';
    else if (code.includes('SHORT') || code.includes('INCOMPLETE') || code.includes('CONTAINER')) readStatus = 'SHORT_PACKET';
    else if (responseCode) readStatus = responseName(responseCode);
    else readStatus = 'TRANSPORT_ERROR';
    fatal = !responseCode || ['TIMEOUT', 'TRANSACTION_MISMATCH', 'DISCONNECTED', 'STALLED_ENDPOINT', 'SHORT_PACKET', 'TRANSPORT_ERROR'].includes(readStatus);
  }

  const effectivePropertyCode = Number(propertyCode || error?.propertyCode || 0);
  const emptyDescription = describeCSlotProperty(effectivePropertyCode, new Uint8Array(), {});
  return {
    fatal,
    observation: {
      propertyCode: effectivePropertyCode || undefined,
      value: null,
      label: emptyDescription.label,
      encoding: emptyDescription.encoding,
      expectedWidth: emptyDescription.expectedWidth,
      payloadWidth: null,
      rawHex: '',
      rawValue: null,
      decoded: [],
      canonicalKey: null,
      canonicalValue: null,
      normalization: null,
      uncertainty,
      readStatus,
      status: readStatus,
      operationName: error?.operationName ?? (effectivePropertyCode ? 'GET_DEVICE_PROP_VALUE' : error?.operation ?? null),
      transactionId: error?.transactionId ?? null,
      responseCode: responseCode || null,
      responseName: responseCode ? (error?.responseName ?? responseName(responseCode)) : null,
      error: safeErrorMessage(error, serial),
      advertised: false,
    },
  };
}

/** @param {any} description */
function successfulPayloadStatus(description) {
  if (description.payloadWidth === 0) return 'SHORT_PAYLOAD';
  if (description.encoding === 'passthrough' || description.decoded.some((item) => item.status === 'unknown-enum')) return 'PASSTHROUGH';
  if (description.expectedWidth !== null && description.payloadWidth < description.expectedWidth) return 'SHORT_PAYLOAD';
  if (description.expectedWidth !== null && description.payloadWidth > description.expectedWidth) return 'UNEXPECTED_WIDTH';
  if (description.encoding === 'ptp-string' && description.uncertainty) return 'SHORT_PAYLOAD';
  return 'OK';
}

/** @param {any} info @param {number[]} required */
function capabilityCheck(info, required) {
  const advertised = new Set(info?.operations ?? []);
  const missing = required.filter((code) => !advertised.has(code));
  return { supported: missing.length === 0, missing };
}

/** Summarize a payload-free transport ledger without inventing missing evidence. */
function summarizeTransactions(transactions) {
  const entries = Array.isArray(transactions) ? transactions : [];
  const sequences = entries.map((entry) => Number(entry?.sequence));
  const ids = entries.map((entry) => Number(entry?.transactionId));
  const sessionSequences = entries.map((entry) => Number(entry?.sessionSequence));
  const sequenceStrictlyIncreasing = sequences.every((sequence, index) => (
    Number.isInteger(sequence)
    && sequence > 0
    && (index === 0 || sequence > sequences[index - 1])
  ));
  const sessionSequencesNondecreasing = sessionSequences.every((sequence, index) => (
    Number.isInteger(sequence)
    && sequence >= 0
    && (index === 0 || sequence >= sessionSequences[index - 1])
  ));
  const openSessionTransactionIdsValid = entries.every((entry) => (
    entry?.operationName !== 'OPEN_SESSION' || Number(entry.transactionId) === 0
  ));
  const nonOpenTransactionIdsValid = entries.every((entry) => (
    entry?.operationName === 'OPEN_SESSION'
    || (Number.isInteger(Number(entry?.transactionId)) && Number(entry.transactionId) > 0)
  ));
  const perSessionStrictlyIncreasing = entries.every((entry, index) => {
    if (index === 0) return true;
    const previous = entries[index - 1];
    if (Number(entry?.sessionSequence) !== Number(previous?.sessionSequence)) return true;
    return Number(entry?.transactionId) > Number(previous?.transactionId);
  });
  const sessionStartsValid = entries.every((entry, index) => {
    const sessionSequence = Number(entry?.sessionSequence);
    if (sessionSequence === 0) return true;
    const previousSessionSequence = index === 0 ? null : Number(entries[index - 1]?.sessionSequence);
    if (previousSessionSequence === sessionSequence) return entry?.operationName !== 'OPEN_SESSION';
    return entry?.operationName === 'OPEN_SESSION' && Number(entry?.transactionId) === 0;
  });
  const metadataComplete = entries.length > 0 && entries.every((entry) => (
    Number.isInteger(Number(entry?.sequence))
    && Number(entry.sequence) > 0
    && Number.isInteger(Number(entry?.sessionSequence))
    && Number(entry.sessionSequence) >= 0
    && Number.isInteger(Number(entry?.transactionId))
    && Number(entry.transactionId) >= 0
    && typeof entry?.operationName === 'string'
    && entry.operationName.length > 0
    && typeof entry?.status === 'string'
    && entry.status.length > 0
    && (entry.responseCode === null || Number.isInteger(Number(entry.responseCode)))
  ));
  const standardsCompliant = metadataComplete
    && sequenceStrictlyIncreasing
    && sessionSequencesNondecreasing
    && openSessionTransactionIdsValid
    && nonOpenTransactionIdsValid
    && perSessionStrictlyIncreasing
    && sessionStartsValid;
  return {
    count: entries.length,
    firstSequence: sequences[0] ?? null,
    lastSequence: sequences.at(-1) ?? null,
    firstTransactionId: ids[0] ?? null,
    lastTransactionId: ids.at(-1) ?? null,
    metadataComplete,
    sequenceStrictlyIncreasing,
    sessionSequencesNondecreasing,
    openSessionTransactionIdsValid,
    perSessionStrictlyIncreasing,
    sessionStartsValid,
    standardsCompliant,
    strictlyIncreasing: standardsCompliant,
    responseAnomalyCount: entries.filter((entry) => entry.status !== 'OK').length,
  };
}

/** Return the unambiguous transport-lifetime ledger cursor. */
function transactionCursor(transport) {
  const cursor = typeof transport?.getTransactionCursor === 'function'
    ? transport.getTransactionCursor()
    : transport?.transactionSequence;
  return Number.isInteger(Number(cursor)) && Number(cursor) >= 0 ? Number(cursor) : 0;
}

/** Keep the original private serial while adopting freshly confirmed session capabilities. */
function adoptSessionCapabilities(current, sessionInfo) {
  const { serialNumber: _sessionSerial, ...sessionSafe } = sessionInfo ?? {};
  return {
    ...(current ?? {}),
    ...sessionSafe,
    serialNumber: current?.serialNumber ?? sessionInfo?.serialNumber ?? null,
  };
}

/** @param {number|null} from @param {number} to @param {any} confirmation */
function selectorTransitionEvidence(from, to, confirmation) {
  const bytes = confirmation?.bytes instanceof Uint8Array ? new Uint8Array(confirmation.bytes) : null;
  return {
    from,
    to,
    propertyCode: PTP_PROP.PRESET_SLOT,
    responseCode: confirmation?.responseCode ?? null,
    responseName: confirmation?.responseName ?? null,
    responseOk: confirmation?.responseOk === true,
    writeOperationName: confirmation?.writeOperationName ?? null,
    writeTransactionId: confirmation?.writeTransactionId ?? null,
    readOperationName: confirmation?.readOperationName ?? null,
    readTransactionId: confirmation?.readTransactionId ?? null,
    readResponseCode: confirmation?.readResponseCode ?? null,
    readResponseName: confirmation?.readResponseName ?? null,
    readBackAttempts: Array.isArray(confirmation?.readBackAttempts)
      ? confirmation.readBackAttempts.map((item) => ({ ...item }))
      : [],
    confirmationAttempts: confirmation?.attempts ?? null,
    confirmedValue: confirmation?.value ?? null,
    payloadWidth: bytes?.byteLength ?? null,
    rawHex: bytes ? bytesToHex(bytes) : '',
    bytes,
  };
}

/** @param {Uint8Array} bytes */
function exactSelector(bytes) {
  if (bytes.byteLength !== 2) return null;
  const value = readU16(bytes);
  return value !== null && value >= 1 && value <= 7 ? value : null;
}

/** @param {unknown} error */
function isDeviceBusy(error) {
  return Number(error?.responseCode) === PTP_RESPONSE.DEVICE_BUSY;
}

/** @param {unknown} error */
function isFatalTransportError(error) {
  if (!error) return false;
  if (Number(error?.responseCode)) return false;
  const code = String(error?.code ?? '').toUpperCase();
  return error?.name === 'PtpTransportError'
    || ['TIMEOUT', 'TRANSACTION', 'DISCONNECT', 'NOT_CONNECTED', 'STALL', 'SHORT', 'INCOMPLETE', 'CONTAINER', 'USB_'].some((token) => code.includes(token));
}

/** @param {string} operation @param {unknown} error @param {string|null} serial */
function errorDiagnostic(operation, error, serial) {
  const classification = classifyReadError(error, serial);
  return {
    phase: operation,
    status: classification.observation.readStatus,
    responseCode: Number(error?.responseCode) || null,
    responseName: Number(error?.responseCode) ? responseName(Number(error.responseCode)) : null,
    operationName: error?.operationName ?? error?.operation ?? null,
    transactionId: error?.transactionId ?? null,
    errorCode: error?.code ?? null,
    message: safeErrorMessage(error, serial),
    uncertainty: classification.observation.uncertainty,
  };
}

/** @param {unknown} error @param {string|null} serial */
function safeErrorMessage(error, serial) {
  return redactSensitiveText(error instanceof Error ? error.message : String(error ?? 'Unknown error.'), serial);
}

/** @param {unknown} error @param {string|null} serial */
function redactError(error, serial) {
  if (error instanceof Error) {
    try { error.message = safeErrorMessage(error, serial); } catch { /* Read-only Error implementation. */ }
    return error;
  }
  return new Error(safeErrorMessage(error, serial));
}

/** @param {any} value @param {string|null} serial */
function sanitizeDiagnostic(value, serial) {
  if (value instanceof Uint8Array) {
    return payloadContainsSerial(value, serial)
      ? { payloadWidth: value.byteLength, payloadRedacted: true }
      : new Uint8Array(value);
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeDiagnostic(item, serial));
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? redactSensitiveText(value, serial) : value;
  }
  if (value instanceof Error) return safeErrorMessage(value, serial);
  if (value instanceof Map) {
    return new Map([...value].map(([key, item]) => [key, sanitizeDiagnostic(item, serial)]));
  }
  const serialBearingPayload = value.bytes instanceof Uint8Array && payloadContainsSerial(value.bytes, serial);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/serial/i.test(key)) continue;
    if (serialBearingPayload && key === 'bytes') {
      output.bytes = null;
      continue;
    }
    if (serialBearingPayload && /^(?:rawHex|bytesBase64)$/i.test(key)) {
      output[key] = '[REDACTED SERIAL-BEARING PAYLOAD]';
      continue;
    }
    output[key] = sanitizeDiagnostic(item, serial);
  }
  if (serialBearingPayload) output.payloadRedacted = true;
  return output;
}

/** @param {string} value @param {string|null} serial */
function redactSensitiveText(value, serial) {
  let text = String(value);
  if (!serial) return text;
  text = text.split(String(serial)).join('[REDACTED]');
  for (const bytes of serialPayloadCandidates(serial)) {
    const hex = bytesToHex(bytes);
    if (hex) text = text.split(hex).join('[REDACTED SERIAL PAYLOAD]');
  }
  return text;
}

/** @param {Uint8Array} bytes @param {string|null} serial */
function payloadContainsSerial(bytes, serial) {
  if (!serial) return false;
  return serialPayloadCandidates(serial).some((candidate) => candidate.byteLength > 0 && containsBytes(bytes, candidate));
}

/** @param {string} serial */
function serialPayloadCandidates(serial) {
  const text = String(serial);
  const utf8 = new TextEncoder().encode(text);
  const utf16le = new Uint8Array(text.length * 2);
  const view = new DataView(utf16le.buffer);
  for (let index = 0; index < text.length; index += 1) view.setUint16(index * 2, text.charCodeAt(index), true);
  return [utf8, utf16le];
}

/** @param {Uint8Array} haystack @param {Uint8Array} needle */
function containsBytes(haystack, needle) {
  if (!needle.byteLength || needle.byteLength > haystack.byteLength) return false;
  outer: for (let start = 0; start <= haystack.byteLength - needle.byteLength; start += 1) {
    for (let offset = 0; offset < needle.byteLength; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}

/** @param {any} value */
function sanitizeText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** @param {Uint8Array|ArrayBuffer} bytes */
function copyBytes(bytes) {
  return bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes);
}

/** @param {number} first @param {number} last */
function range(first, last) {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

/** @param {number} value */
function formatCode(value) {
  return `0x${Number(value).toString(16).toUpperCase().padStart(4, '0')}`;
}

/** @param {string} operation */
function readOnlyStageError(operation) {
  const error = new Error(`${operation} are disabled during the mandatory read-only physical-camera validation stage.`);
  // @ts-ignore - diagnostic code on a normal Error.
  error.code = 'READ_ONLY_STAGE_LOCK';
  return error;
}

/** @param {string} guidance */
function stagedReadError(guidance) {
  const error = new Error(`Direct physical-camera access is disabled. ${guidance}`);
  // @ts-ignore - diagnostic code on a normal Error.
  error.code = 'STAGED_READ_REQUIRED';
  return error;
}

/** @param {number} milliseconds */
function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
