import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const filePath = path.resolve('src/ui/ui_transfer_bridge.js');

test('transfer execute path no longer falls back to TransferUI legacy modal', () => {
  const source = fs.readFileSync(filePath, 'utf8');
  assert.doesNotMatch(source, /TransferUI\.openTransfer\(/);
  assert.match(source, /Transfer SWS недоступний/);
});
