import test from 'node:test';
import assert from 'node:assert/strict';
import { runEditCancel } from '../src/table/features/edit_cancel/feature.js';
import { createEditCancelIn } from '../src/table/features/edit_cancel/pipes.js';
import { editCancelApi } from '../src/table/features/edit_cancel/api.js';
import { createEditCancelDebugTools } from '../src/table/features/edit_cancel/debug.js';

test('edit_cancel pipes validate required event/payload', () => {
  assert.throws(() => createEditCancelIn({ event: { type: 'x', payload: {} } }), /event.type/);
  assert.throws(() => createEditCancelIn({ event: { type: 'edit.cancel', payload: {} } }), /rowId/);
});

test('edit_cancel run returns no patches and close effects', () => {
  const out = runEditCancel({
    event: {
      type: 'edit.cancel',
      source: 'test',
      payload: { rowId: 'r1', colId: 'c1', draftValue: 'temp', key: 'Escape' }
    }
  });

  assert.equal(out.result.ok, true);
  assert.deepEqual(out.patches, []);
  assert.equal(out.effects[0].type, 'editor.close');
  assert.equal(out.effects[1].type, 'focus.restore');
  assert.equal(out.debug.featureId, 'table.edit.cancel');
});

test('edit_cancel api contract is stable', () => {
  assert.equal(editCancelApi.featureId, 'table.edit.cancel');
  assert.ok(editCancelApi.eventsIn.includes('edit.cancel'));
  assert.ok(editCancelApi.commandsOut.includes('editor.close'));
});

test('edit_cancel debug tools simulate and store lastRun', () => {
  const dbg = createEditCancelDebugTools();
  const run = dbg.simulate({ rowId: 'r2', colId: 'c2' });
  assert.equal(run.result.ok, true);
  assert.deepEqual(dbg.getLastRun(), run);
});


test('edit_cancel debug output is JSON serializable', () => {
  const dbg = createEditCancelDebugTools();
  const run = dbg.simulate({ rowId: 'rj', colId: 'cj' });
  const json = JSON.stringify(run);
  assert.ok(typeof json === 'string');
  assert.doesNotMatch(json, /\[Circular\]/);
});
