const SORT_TOGGLE_EVENT = 'sort.toggle';
const VALID_DIRS = new Set(['asc', 'desc', null]);

function nextDirFromCurrent(currentDir) {
  if (currentDir === 'asc') return 'desc';
  if (currentDir === 'desc') return null;
  return 'asc';
}

export function createSortToggleIn(input = {}) {
  const event = input.event || {};
  const payload = event.payload || {};

  if (event.type !== SORT_TOGGLE_EVENT) {
    throw new Error(`sort_toggle: event.type must be ${SORT_TOGGLE_EVENT}`);
  }
  if (!payload.columnKey) {
    throw new Error('sort_toggle: payload.columnKey is required');
  }

  const currentSort = payload.currentSort || null;
  const currentColumn = currentSort?.columnKey ? String(currentSort.columnKey) : null;
  const currentDir = currentSort?.dir ?? null;

  if (!VALID_DIRS.has(currentDir)) {
    throw new Error('sort_toggle: currentSort.dir must be asc|desc|null');
  }

  const columnKey = String(payload.columnKey);
  const isSameColumn = currentColumn === columnKey;
  const nextDir = isSameColumn ? nextDirFromCurrent(currentDir) : 'asc';

  return {
    meta: input.meta || null,
    ctx: input.ctx || {},
    deps: input.deps || {},
    state: input.state || {},
    event: {
      type: SORT_TOGGLE_EVENT,
      source: event.source || 'unknown',
      payload: {
        columnKey,
        currentSort,
        nextSort: nextDir ? { columnKey, dir: nextDir } : null
      }
    }
  };
}

export function createSortToggleOut(base = {}) {
  return {
    result: base.result || { ok: true, code: 'SORT_TOGGLE_OK', message: '' },
    patches: base.patches || [],
    effects: base.effects || [],
    nextStateHints: base.nextStateHints || {},
    debug: base.debug || null
  };
}
