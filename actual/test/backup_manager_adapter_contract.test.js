import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const filePath = path.resolve('src/ui/ui_core.js');

test('backup manager modal is wired through SWS adapter with dedicated screen id', () => {
  const source = fs.readFileSync(filePath, 'utf8');
  assert.match(source, /screenId:\s*'backup\.manager'/);
  assert.match(source, /const\s+legacyPayload\s*=\s*\{/);
  assert.match(source, /window\.UI\?\.modal\?\.open\?\.\(legacyPayload\)/);
  assert.match(source, /SW\.openCustomRoot\(\(\)\s*=>\s*SW\.push\(\{/);
});
