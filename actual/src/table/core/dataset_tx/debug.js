// src/table/core/dataset_tx/debug.js

export function makeDebug(runId, base) {
  const t0 = performance?.now?.() ?? Date.now();
  const dbg = {
    featureId: 'table.dataset.tx',
    runId,
    steps: [],
    inputsLite: base || null,
    outputsLite: null,
    errors: [],
    timingMs: 0,
  };
  dbg.push = (at, details) => {
    dbg.steps.push(details ? { at, ...details } : { at });
  };
  dbg.done = (outputsLite) => {
    const t1 = performance?.now?.() ?? Date.now();
    dbg.timingMs = Math.round((t1 - t0) * 1000) / 1000;
    dbg.outputsLite = outputsLite || null;
    return dbg;
  };
  dbg.err = (e) => {
    dbg.errors.push(String(e?.message || e));
  };
  return dbg;
}
