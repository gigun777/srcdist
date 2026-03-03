import test from 'node:test';
import assert from 'node:assert/strict';
import { runRerenderSync } from '../src/table/features/rerender_sync/feature.js';
import { createRerenderSyncIn } from '../src/table/features/rerender_sync/pipes.js';
import { rerenderSyncApi } from '../src/table/features/rerender_sync/api.js';
import { createRerenderSyncDebugTools } from '../src/table/features/rerender_sync/debug.js';

test('rerender_sync pipes validate event type', () => {
  assert.throws(() => createRerenderSyncIn({ event: { type: 'x', payload: {} } }), /event.type/);
});

test('rerender_sync run returns renderer effects', () => {
  const out = runRerenderSync({
    event: {
      type: 'rerender.sync',
      source: 'test',
      payload: { reason: 'edit.commit', changedIds: ['r1'], anchorId: 'r1' }
    }
  });

  assert.equal(out.result.ok, true);
  assert.deepEqual(out.patches, []);
  assert.equal(out.effects[0].type, 'renderer.apply');
  assert.equal(out.effects[1].type, 'scroll.anchor');
  assert.equal(out.debug.featureId, 'table.rerender.sync');
});

test('rerender_sync api contract is stable', () => {
  assert.equal(rerenderSyncApi.featureId, 'table.rerender.sync');
  assert.ok(rerenderSyncApi.eventsIn.includes('rerender.sync'));
  assert.ok(rerenderSyncApi.commandsOut.includes('renderer.apply'));
});

test('rerender_sync debug tools simulate and store lastRun', () => {
  const dbg = createRerenderSyncDebugTools();
  const run = dbg.simulate({ changedIds: ['r2'], anchorId: 'r2' });
  assert.equal(run.result.ok, true);
  assert.deepEqual(dbg.getLastRun(), run);
});


test('rerender_sync debug output is JSON serializable', () => {
  const dbg = createRerenderSyncDebugTools();
  const run = dbg.simulate({ changedIds: ['rj'], anchorId: 'rj' });
  assert.doesNotThrow(() => JSON.stringify(run));
});
