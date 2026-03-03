import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const filePath = path.resolve('src/ui/settings/features_backup_settings.js');

test('backup settings import result modal is routed through adapter contract', () => {
  const source = fs.readFileSync(filePath, 'utf8');
  assert.match(source, /screenId:\s*'backup\.import'/);
  assert.match(source, /adapter\.open\(\{/);
  assert.match(source, /const\s+legacy\s*=\s*\{/);
  assert.match(source, /openViaAdapterOrLegacy\(content\)/);
});
