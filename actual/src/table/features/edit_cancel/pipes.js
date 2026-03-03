const EDIT_CANCEL_EVENT = 'edit.cancel';

export function createEditCancelIn(input = {}) {
  const event = input.event || {};
  const payload = event.payload || {};

  if (event.type !== EDIT_CANCEL_EVENT) {
    throw new Error(`edit_cancel: event.type must be ${EDIT_CANCEL_EVENT}`);
  }
  if (!payload.rowId || !payload.colId) {
    throw new Error('edit_cancel: payload.rowId and payload.colId are required');
  }

  return {
    meta: input.meta || null,
    ctx: input.ctx || {},
    deps: input.deps || {},
    state: input.state || {},
    event: {
      type: EDIT_CANCEL_EVENT,
      source: event.source || 'unknown',
      payload: {
        rowId: String(payload.rowId),
        colId: String(payload.colId),
        draftValue: payload.draftValue ?? null,
        key: payload.key || 'Escape'
      }
    }
  };
}

export function createEditCancelOut(base = {}) {
  return {
    result: base.result || { ok: true, code: 'EDIT_CANCELLED', message: '' },
    patches: base.patches || [],
    effects: base.effects || [],
    nextStateHints: base.nextStateHints || {},
    debug: base.debug || null
  };
}
