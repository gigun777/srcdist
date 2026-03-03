import { runRerenderSync } from './feature.js';

export function createRerenderSyncDebugTools() {
  let lastRun = null;

  return {
    getLastRun: () => lastRun,
    simulate: (payload = {}) => {
      lastRun = runRerenderSync({
        event: {
          type: 'rerender.sync',
          source: 'debug.simulate',
          payload: {
            reason: payload.reason || 'debug.probe',
            changedIds: payload.changedIds || ['row-debug-1'],
            anchorId: payload.anchorId || 'row-debug-1'
          }
        }
      });
      return lastRun;
    }
  };
}
