import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('dependency-free PTP CLI parser redacts the serial before output', () => {
  const output = execFileSync('python3', ['scripts/ptp_usb_lab.py', 'self-test'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  const result = JSON.parse(output);
  assert.equal(result.status, 'PASS');
  assert.equal(result.serialBoundary, 'REDACTED');
  assert.equal(result.datasetParser, 'PASS');
  assert.equal(result.strictPtpStrings, 'PASS');
  assert.equal(result.transactionSequence, 'PASS');
  assert.equal(result.usbModeDecoder, 'PASS');
  assert.equal(result.selectorWritePolicy, 'PASS');
  assert.equal(result.objectInfoParser, 'PASS');
  assert.equal(result.descriptorResponseContinuation, 'PASS');
  assert.equal(result.backupModelSizeFsDecoder, 'PASS');
  assert.equal(result.backupHandlePolicy, 'PASS');
  assert.doesNotMatch(output, /SELF-TEST-SECRET-SERIAL/);
});
