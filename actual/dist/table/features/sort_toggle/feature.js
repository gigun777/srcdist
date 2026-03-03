import { createFeatureMeta, createDebugTrace, finishDebugTrace } from '../../core/table_feature_contract.js';
import { createSortToggleIn, createSortToggleOut } from './pipes.js';

export function runSortToggle(input) {
  const startedAt = Date.now();
  const inData = createSortToggleIn(input);
  const meta = inData.meta || createFeatureMeta('table.sort.toggle');
  const debug = createDebugTrace(meta, inData);

  const nextSort = inData.event.payload.nextSort;
  debug.steps.push({ at: new Date().toISOString(), step: 'computeNextSort', nextSort });

  const patches = [{ op: 'setSort', value: nextSort }];
  debug.steps.push({ at: new Date().toISOString(), step: 'createSortPatch', patchesCount: patches.length });

  const effects = [{ type: 'rerender.request', reason: 'sort.toggle' }];
  debug.steps.push({ at: new Date().toISOString(), step: 'requestRerender' });

  const out = createSortToggleOut({
    result: { ok: true, code: 'SORT_TOGGLE_OK', message: '' },
    patches,
    effects,
    nextStateHints: { sort: nextSort },
    debug
  });

  finishDebugTrace(debug, out, startedAt);
  return out;
}
