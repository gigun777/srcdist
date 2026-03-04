import { createFeatureMeta, createDebugTrace, finishDebugTrace } from '../../core/table_feature_contract.js';
import { createEditCommitIn, createEditCommitOut } from './pipes.js';

export function runEditCommit(input) {
  const startedAt = Date.now();
  const inData = createEditCommitIn(input);
  const meta = inData.meta || createFeatureMeta('table.edit.commit');
  const debug = createDebugTrace(meta, inData);

  const { rowId, colId, newValue } = inData.event.payload;
  debug.steps.push({ at: new Date().toISOString(), step: 'validateInput' });

  const patches = [{ op: 'setCell', rowId, colId, value: newValue }];
  debug.steps.push({ at: new Date().toISOString(), step: 'createStorePatch', patchesCount: patches.length });

  const effects = [
    { type: 'rerender.request', reason: 'edit.commit', changedIds: [rowId] }
  ];
  debug.steps.push({ at: new Date().toISOString(), step: 'requestRerender' });

  const out = createEditCommitOut({
    result: { ok: true, code: 'EDIT_COMMIT_OK', message: '' },
    patches,
    effects,
    nextStateHints: { activeCell: { rowId, colId }, anchorId: rowId },
    debug
  });

  finishDebugTrace(debug, out, startedAt);
  return out;
}
