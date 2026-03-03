import test from 'node:test';
import assert from 'node:assert/strict';

import { createSortToggleIn } from '../src/table/features/sort_toggle/pipes.js';
import { runSortToggle } from '../src/table/features/sort_toggle/feature.js';
import { sortToggleApi } from '../src/table/features/sort_toggle/api.js';
import { createSortToggleDebugTools } from '../src/table/features/sort_toggle/debug.js';

test('sort_toggle pipes validate event and required payload', () => {
  assert.throws(() => createSortToggleIn({ event: { type: 'other', payload: {} } }), /event.type/);
  assert.throws(() => createSortToggleIn({ event: { type: 'sort.toggle', payload: {} } }), /columnKey/);
});

test('sort_toggle computes next sort cycle on same column', () => {
  const a = runSortToggle({ event: { type: 'sort.toggle', payload: { columnKey: 'a', currentSort: null } } });
  assert.deepEqual(a.patches[0].value, { columnKey: 'a', dir: 'asc' });

  const b = runSortToggle({ event: { type: 'sort.toggle', payload: { columnKey: 'a', currentSort: { columnKey: 'a', dir: 'asc' } } } });
  assert.deepEqual(b.patches[0].value, { columnKey: 'a', dir: 'desc' });

  const c = runSortToggle({ event: { type: 'sort.toggle', payload: { columnKey: 'a', currentSort: { columnKey: 'a', dir: 'desc' } } } });
  assert.equal(c.patches[0].value, null);
});

test('sort_toggle starts with asc for a different column', () => {
  const out = runSortToggle({
    event: {
      type: 'sort.toggle',
      payload: { columnKey: 'b', currentSort: { columnKey: 'a', dir: 'desc' } }
    }
  });
  assert.deepEqual(out.patches[0].value, { columnKey: 'b', dir: 'asc' });
});

test('sort_toggle api contract is stable', () => {
  assert.equal(sortToggleApi.featureId, 'table.sort.toggle');
  assert.deepEqual(sortToggleApi.eventsIn, ['sort.toggle']);
  assert.deepEqual(sortToggleApi.commandsOut, ['setSort', 'requestRerender']);
});

test('sort_toggle debug tools simulate and store lastRun', () => {
  const debug = createSortToggleDebugTools();
  const out = debug.simulate({ columnKey: 'x' });
  assert.equal(out.result.ok, true);
  assert.equal(debug.getLastRun(), out);
});
