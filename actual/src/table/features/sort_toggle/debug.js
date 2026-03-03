import { runSortToggle } from './feature.js';

export function createSortToggleDebugTools() {
  let lastRun = null;

  return {
    getLastRun: () => lastRun,
    simulate: (payload = {}) => {
      lastRun = runSortToggle({
        event: {
          type: 'sort.toggle',
          source: 'debug.simulate',
          payload: {
            columnKey: payload.columnKey || 'col-debug-1',
            currentSort: payload.currentSort ?? null
          }
        }
      });
      return lastRun;
    }
  };
}
