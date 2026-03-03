import { createFeatureMeta, createDebugTrace, finishDebugTrace } from '../../core/table_feature_contract.js';
import { createEditCancelIn, createEditCancelOut } from './pipes.js';

export function runEditCancel(input) {
  const startedAt = Date.now();
  const inData = createEditCancelIn(input);
  const meta = inData.meta || createFeatureMeta('table.edit.cancel');
  const debug = createDebugTrace(meta, inData);

  const { rowId, colId } = inData.event.payload;
  debug.steps.push({ at: new Date().toISOString(), step: 'validateInput' });

  const effects = [
    { type: 'editor.close', commit: false, rowId, colId },
    { type: 'focus.restore', rowId, colId }
  ];
  debug.steps.push({ at: new Date().toISOString(), step: 'cancelEditor' });

  const out = createEditCancelOut({
    result: { ok: true, code: 'EDIT_CANCELLED', message: '' },
    patches: [],
    effects,
    nextStateHints: { activeCell: { rowId, colId } },
    debug
  });

  finishDebugTrace(debug, out, startedAt);
  return out;
}
