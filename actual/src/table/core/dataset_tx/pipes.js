// src/table/core/dataset_tx/pipes.js

export function createIn(input) {
  const ctx = input?.ctx || {};
  return {
    ctx: { journalId: ctx.journalId || null },
    initiator: input?.initiator ? String(input.initiator) : null,
    reason: input?.reason ? String(input.reason) : 'datasetTx',
    deps: input?.deps || {},
    mutate: input?.mutate,
  };
}

export function createOut(out) {
  return {
    ok: !!out?.ok,
    nextDataset: out?.nextDataset || null,
    meta: out?.meta || null,
    debug: out?.debug || null,
  };
}
