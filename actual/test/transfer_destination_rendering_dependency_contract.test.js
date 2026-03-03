import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const filePath = path.resolve('src/ui/ui_transfer_bridge.js');

test('transfer destination candidates depend on template toSheetKey and journals/templateId mapping', () => {
  const source = fs.readFileSync(filePath, 'utf8');
  assert.match(source, /const\s+toKey\s*=\s*tpl\?\.toSheetKey/);
  assert.match(source, /for\(const\s+j\s+of\s+ensureArray\(stateNow\.journals\)\)/);
  assert.match(source, /const\s+tplId\s*=\s*j\?\.templateId\s*\?\?\s*j\?\.tplId\s*\?\?\s*null/);
  assert.match(source, /for\(const\s+s\s+of\s+ensureArray\(sheets\)\)/);
  assert.match(source, /if\(s\?\.tplId\s*&&\s*s\.tplId\s*===\s*toKey\)/);
});
