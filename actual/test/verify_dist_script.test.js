import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { verifyDist, requiredOutputs } from '../scripts/verify-dist.mjs';

async function ensureFile(root, rel, contents = '') {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, contents, 'utf8');
}

async function createFixtureRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'sdo-verify-dist-'));
}

async function makeValidFixture(root) {
  for (const rel of requiredOutputs) {
    await ensureFile(root, rel, '// ok');
  }
  const meta = {
    schemaVersion: 1,
    stage: 'D1',
    mode: 'copy-safe',
    createdAt: new Date().toISOString(),
    gitHash: 'abc1234',
    outputsCount: requiredOutputs.length,
    outputs: [...requiredOutputs].sort()
  };
  await ensureFile(root, 'dist/build_meta.json', JSON.stringify(meta, null, 2));
}

test('verifyDist returns no errors for valid fixture', async () => {
  const root = await createFixtureRoot();
  await makeValidFixture(root);
  const errors = await verifyDist(root);
  assert.deepEqual(errors, []);
});

test('verifyDist catches metadata contract issues', async () => {
  const root = await createFixtureRoot();
  await makeValidFixture(root);

  const badMeta = {
    schemaVersion: 2,
    stage: '',
    mode: '',
    createdAt: 'not-a-date',
    gitHash: '',
    outputsCount: 999,
    outputs: [requiredOutputs[0], requiredOutputs[0]]
  };
  await ensureFile(root, 'dist/build_meta.json', JSON.stringify(badMeta, null, 2));

  const errors = await verifyDist(root);
  assert.equal(errors.some((e) => e.includes('unsupported schemaVersion')), true);
  assert.equal(errors.includes('build_meta.json: stage must be a non-empty string'), true);
  assert.equal(errors.includes('build_meta.json: gitHash must be a non-empty string'), true);
  assert.equal(errors.includes('build_meta.json: mode must be a non-empty string'), true);
  assert.equal(errors.includes('build_meta.json: createdAt must be a valid ISO date string'), true);
  assert.equal(errors.some((e) => e.includes('outputsCount mismatch')), true);
  assert.equal(errors.some((e) => e.includes('duplicate output entry')), true);
});


test('verifyDist requires required outputs to be listed in build metadata', async () => {
  const root = await createFixtureRoot();
  await makeValidFixture(root);

  const metaPath = path.join(root, 'dist/build_meta.json');
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
  meta.outputs = meta.outputs.filter((rel) => rel !== requiredOutputs[0]);
  meta.outputsCount = meta.outputs.length;
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  const errors = await verifyDist(root);
  assert.equal(errors.some((e) => e.includes('missing required output entry')), true);
});


test('verifyDist rejects non-dist and traversal entries in metadata outputs', async () => {
  const root = await createFixtureRoot();
  await makeValidFixture(root);

  const metaPath = path.join(root, 'dist/build_meta.json');
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
  meta.outputs = [...meta.outputs, 'src/not-allowed.js', 'dist/../escape.js'];
  meta.outputsCount = meta.outputs.length;
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  const errors = await verifyDist(root);
  assert.equal(errors.some((e) => e.includes('non-dist output entry')), true);
  assert.equal(errors.some((e) => e.includes('invalid relative traversal entry')), true);
});


test('verifyDist validates supported mode and git hash format', async () => {
  const root = await createFixtureRoot();
  await makeValidFixture(root);

  const metaPath = path.join(root, 'dist/build_meta.json');
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
  meta.mode = 'experimental';
  meta.gitHash = 'not-a-hash';
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  const errors = await verifyDist(root);
  assert.equal(errors.some((e) => e.includes('unsupported mode experimental')), true);
  assert.equal(errors.some((e) => e.includes('gitHash has invalid format')), true);
});


test('verifyDist rejects future createdAt timestamps', async () => {
  const root = await createFixtureRoot();
  await makeValidFixture(root);

  const metaPath = path.join(root, 'dist/build_meta.json');
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
  meta.createdAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  const errors = await verifyDist(root);
  assert.equal(errors.some((e) => e.includes('createdAt is in the future')), true);
});


test('verifyDist requires outputsCount to be a non-negative integer', async () => {
  const root = await createFixtureRoot();
  await makeValidFixture(root);

  const metaPath = path.join(root, 'dist/build_meta.json');
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
  meta.outputsCount = -1;
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  const errors = await verifyDist(root);
  assert.equal(errors.some((e) => e.includes('outputsCount must be a non-negative integer')), true);
});

test('verifyDist requires outputs to be lexicographically sorted', async () => {
  const root = await createFixtureRoot();
  await makeValidFixture(root);

  const metaPath = path.join(root, 'dist/build_meta.json');
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
  meta.outputs = [...meta.outputs].reverse();
  meta.outputsCount = meta.outputs.length;
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  const errors = await verifyDist(root);
  assert.equal(errors.includes('build_meta.json: outputs must be sorted lexicographically'), true);
});
