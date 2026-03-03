const EDIT_COMMIT_EVENT = 'edit.commit';

export function createEditCommitIn(input = {}) {
  const event = input.event || {};
  const payload = event.payload || {};

  if (event.type !== EDIT_COMMIT_EVENT) {
    throw new Error(`edit_commit: event.type must be ${EDIT_COMMIT_EVENT}`);
  }
  if (!payload.rowId || !payload.colId) {
    throw new Error('edit_commit: payload.rowId and payload.colId are required');
  }

  return {
    meta: input.meta || null,
    ctx: input.ctx || {},
    deps: input.deps || {},
    state: input.state || {},
    event: {
      type: EDIT_COMMIT_EVENT,
      source: event.source || 'unknown',
      payload: {
        rowId: String(payload.rowId),
        colId: String(payload.colId),
        oldValue: payload.oldValue ?? null,
        newValue: payload.newValue ?? null,
        key: payload.key || 'Enter'
      }
    }
  };
}

export function createEditCommitOut(base = {}) {
  return {
    result: base.result || { ok: true, code: 'EDIT_COMMIT_OK', message: '' },
    patches: base.patches || [],
    effects: base.effects || [],
    nextStateHints: base.nextStateHints || {},
    debug: base.debug || null
  };
}
