import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const filePath = path.resolve('src/ui/ui_transfer_bridge.js');

test('transfer execute flow is wired through SWS adapter contract', () => {
  const source = fs.readFileSync(filePath, 'utf8');
  assert.match(source, /adapter\.open\(\{/);
  assert.match(source, /screenId:\s*'transfer\.execute'/);
  assert.match(source, /swsOpen:\s*\(\)\s*=>/);
  assert.match(source, /openTransferSws\(\)/);
});
