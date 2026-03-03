import test from 'node:test';
import assert from 'node:assert/strict';
import { runEditCommit } from '../src/table/features/edit_commit/feature.js';
import { createEditCommitIn } from '../src/table/features/edit_commit/pipes.js';
import { editCommitApi } from '../src/table/features/edit_commit/api.js';
import { createEditCommitDebugTools } from '../src/table/features/edit_commit/debug.js';

test('edit_commit pipes validate required event/payload', () => {
  assert.throws(() => createEditCommitIn({ event: { type: 'x', payload: {} } }), /event.type/);
  assert.throws(() => createEditCommitIn({ event: { type: 'edit.commit', payload: {} } }), /rowId/);
});

test('edit_commit run returns patch/effects/debug trace', () => {
  const out = runEditCommit({
    event: {
      type: 'edit.commit',
      source: 'test',
      payload: { rowId: 'r1', colId: 'c1', oldValue: 'a', newValue: 'b', key: 'Enter' }
    }
  });

  assert.equal(out.result.ok, true);
  assert.deepEqual(out.patches[0], { op: 'setCell', rowId: 'r1', colId: 'c1', value: 'b' });
  assert.equal(out.effects[0].type, 'rerender.request');
  assert.equal(out.debug.featureId, 'table.edit.commit');
  assert.ok(Array.isArray(out.debug.steps));
});

test('edit_commit api contract is stable', () => {
  assert.equal(editCommitApi.featureId, 'table.edit.commit');
  assert.ok(editCommitApi.eventsIn.includes('edit.commit'));
  assert.ok(editCommitApi.commandsOut.includes('setCell'));
});

test('edit_commit debug tools simulate and store lastRun', () => {
  const dbg = createEditCommitDebugTools();
  const run = dbg.simulate({ rowId: 'r2', colId: 'c2', newValue: 'v2' });
  assert.equal(run.result.ok, true);
  assert.deepEqual(dbg.getLastRun(), run);
});


test('edit_commit debug output is JSON serializable', () => {
  const dbg = createEditCommitDebugTools();
  const run = dbg.simulate({ rowId: 'rj', colId: 'cj', newValue: 'v' });
  const json = JSON.stringify(run);
  assert.ok(typeof json === 'string');
  assert.doesNotMatch(json, /\[Circular\]/);
});
