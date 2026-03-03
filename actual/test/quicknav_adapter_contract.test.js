import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const filePath = path.resolve('src/ui/ui_core.js');

test('quicknav root is wired through SWS adapter contract', () => {
  const source = fs.readFileSync(filePath, 'utf8');
  assert.match(source, /screenId:\s*'quicknav\.root'/);
  assert.match(source, /adapter\.open\(\{/);
  assert.match(source, /const\s+openSwsRoot\s*=\s*async\s*\(\)\s*=>/);
  assert.match(source, /return\s+openSwsRoot\(\)/);
});
