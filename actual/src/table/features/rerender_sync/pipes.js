const RERENDER_SYNC_EVENT = 'rerender.sync';

export function createRerenderSyncIn(input = {}) {
  const event = input.event || {};
  const payload = event.payload || {};

  if (event.type !== RERENDER_SYNC_EVENT) {
    throw new Error(`rerender_sync: event.type must be ${RERENDER_SYNC_EVENT}`);
  }

  const changedIds = Array.isArray(payload.changedIds) ? payload.changedIds.map(String) : [];

  return {
    meta: input.meta || null,
    ctx: input.ctx || {},
    deps: input.deps || {},
    state: input.state || {},
    event: {
      type: RERENDER_SYNC_EVENT,
      source: event.source || 'unknown',
      payload: {
        reason: String(payload.reason || 'unknown'),
        changedIds,
        anchorId: payload.anchorId ? String(payload.anchorId) : null
      }
    }
  };
}

export function createRerenderSyncOut(base = {}) {
  return {
    result: base.result || { ok: true, code: 'RERENDER_SYNC_OK', message: '' },
    patches: base.patches || [],
    effects: base.effects || [],
    nextStateHints: base.nextStateHints || {},
    debug: base.debug || null
  };
}
