import { runEditCancel } from './feature.js';

export function createEditCancelDebugTools() {
  let lastRun = null;

  return {
    getLastRun: () => lastRun,
    simulate: (payload = {}) => {
      lastRun = runEditCancel({
        event: {
          type: 'edit.cancel',
          source: 'debug.simulate',
          payload: {
            rowId: payload.rowId || 'row-debug-1',
            colId: payload.colId || 'col-debug-1',
            draftValue: payload.draftValue ?? 'draft',
            key: 'Escape'
          }
        }
      });
      return lastRun;
    }
  };
}
