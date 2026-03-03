import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const filePath = path.resolve('src/ui/ui_core.js');

test('quicknav add-journal modal renders template list immediately', () => {
  const source = fs.readFileSync(filePath, 'utf8');
  assert.match(source, /renderList\(\);\n\s*setTimeout\(\(\) => idxInput\.focus\(\), 0\);\n\s*\n\s*SW\.push\(\{/);
  assert.doesNotMatch(source, /onMount:\s*\(\)\s*=>\s*\{/);
});
