import { createFeatureMeta, createDebugTrace, finishDebugTrace } from '../../core/table_feature_contract.js';
import { createRerenderSyncIn, createRerenderSyncOut } from './pipes.js';

export function runRerenderSync(input) {
  const startedAt = Date.now();
  const inData = createRerenderSyncIn(input);
  const meta = inData.meta || createFeatureMeta('table.rerender.sync');
  const debug = createDebugTrace(meta, inData);

  const { changedIds, anchorId, reason } = inData.event.payload;
  debug.steps.push({ at: new Date().toISOString(), step: 'normalizePayload', changedCount: changedIds.length, reason });

  const effects = [
    { type: 'renderer.apply', changedIds },
    { type: 'scroll.anchor', anchorId }
  ];
  debug.steps.push({ at: new Date().toISOString(), step: 'emitEffects', effectsCount: effects.length });

  const out = createRerenderSyncOut({
    result: { ok: true, code: 'RERENDER_SYNC_OK', message: '' },
    patches: [],
    effects,
    nextStateHints: { anchorId },
    debug
  });

  finishDebugTrace(debug, out, startedAt);
  return out;
}
