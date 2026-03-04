import { runEditCommit } from './feature.js';

export function createEditCommitDebugTools() {
  let lastRun = null;

  return {
    getLastRun: () => lastRun,
    simulate: (payload = {}) => {
      lastRun = runEditCommit({
        event: {
          type: 'edit.commit',
          source: 'debug.simulate',
          payload: {
            rowId: payload.rowId || 'row-debug-1',
            colId: payload.colId || 'col-debug-1',
            oldValue: payload.oldValue ?? '',
            newValue: payload.newValue ?? 'debug-value',
            key: 'Enter'
          }
        }
      });
      return lastRun;
    }
  };
}
