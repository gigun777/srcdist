// src/table/core/dataset_tx/feature.js
// Dataset transaction helper.
//
// Goal: make table mutations observable & debuggable:
// - validates deps
// - load -> mutate -> save pipeline
// - records a lightweight event log
// - stores "last tx" debug object for Debug Center

import { createIn, createOut } from './pipes.js';
import { makeDebug } from './debug.js';
import { pushTableEvent } from '../event_log.js';

function storeLastTxSnapshot(snapshot, debugObj) {
  try {
    const w = (typeof window !== 'undefined') ? window : globalThis;
    w.__tableFeatureDebug = w.__tableFeatureDebug || Object.create(null);
    w.__tableFeatureDebug.datasetTx = snapshot;
    w.__tableFeatureDebug.datasetTxDebug = debugObj;
  } catch {
    // debug-only, ignore
  }
}

export async function runDatasetTx(input) {
  const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const _in = createIn(input || {});

  const journalId = _in.ctx.journalId;
  const initiator = _in.initiator;
  const reason = _in.reason;
  const dbg = makeDebug(runId, { journalId, initiator, reason });
  dbg.push('validate:start');

  const deps = _in.deps || {};
  const runtime = deps.runtime;
  const store = deps.store;
  const loadDataset = deps.loadDataset;
  const saveDataset = deps.saveDataset;
  const mutate = _in.mutate;

  if (!journalId) {
    dbg.push('validate:fail', { reason: 'missing journalId' });
    const done = dbg.done({ ok: false, reason: 'missing journalId' });
    storeLastTxSnapshot({ featureId: 'table.dataset.tx', runId, at: new Date().toISOString(), initiator, reason, journalId: null, ok: false, meta: null }, done);
    return createOut({ ok: false, nextDataset: null, meta: null, debug: done });
  }
  if (!runtime || !store || typeof loadDataset !== 'function' || typeof saveDataset !== 'function') {
    dbg.push('validate:fail', { reason: 'missing deps runtime/store/loadDataset/saveDataset' });
    const done = dbg.done({ ok: false, reason: 'missing deps' });
    storeLastTxSnapshot({ featureId: 'table.dataset.tx', runId, at: new Date().toISOString(), initiator, reason, journalId, ok: false, meta: null }, done);
    return createOut({ ok: false, nextDataset: null, meta: null, debug: done });
  }
  if (typeof mutate !== 'function') {
    dbg.push('validate:fail', { reason: 'missing mutate' });
    const done = dbg.done({ ok: false, reason: 'missing mutate' });
    storeLastTxSnapshot({ featureId: 'table.dataset.tx', runId, at: new Date().toISOString(), initiator, reason, journalId, ok: false, meta: null }, done);
    return createOut({ ok: false, nextDataset: null, meta: null, debug: done });
  }

  pushTableEvent({ type: 'datasetTx', phase: 'start', initiator, reason, journalId, ok: null, details: { runId } });

  try {
    dbg.push('loadDataset');
    const ds = await loadDataset(runtime, store, journalId);

    dbg.push('mutate');
    const m = await mutate(ds);
    const ok = (m && typeof m.ok === 'boolean') ? m.ok : !!m;
    const nextDataset = m?.nextDataset || m?.dataset || null;
    const meta = m?.meta || null;

    if (!ok || !nextDataset) {
      dbg.push('mutate:fail', { ok: !!ok });
      const done = dbg.done({ ok: false, reason: 'mutate failed', meta });
      pushTableEvent({ type: 'datasetTx', phase: 'done', initiator, reason, journalId, ok: false, ms: done.timingMs, details: { runId, meta } });
      storeLastTxSnapshot({ featureId: 'table.dataset.tx', runId, at: new Date().toISOString(), initiator, reason, journalId, ok: false, meta }, done);
      return createOut({ ok: false, nextDataset: ds, meta, debug: done });
    }

    dbg.push('saveDataset');
    await saveDataset(runtime, store, journalId, nextDataset);

    const done = dbg.done({ ok: true, meta });
    pushTableEvent({ type: 'datasetTx', phase: 'done', initiator, reason, journalId, ok: true, ms: done.timingMs, details: { runId, meta } });
    storeLastTxSnapshot({ featureId: 'table.dataset.tx', runId, at: new Date().toISOString(), initiator, reason, journalId, ok: true, meta }, done);

    return createOut({ ok: true, nextDataset, meta, debug: done });
  } catch (e) {
    dbg.err(e);
    dbg.push('error', { message: String(e?.message || e) });
    const done = dbg.done({ ok: false, error: String(e?.message || e) });
    pushTableEvent({ type: 'datasetTx', phase: 'done', initiator, reason, journalId, ok: false, ms: done.timingMs, details: { runId, error: String(e?.message || e) } });
    storeLastTxSnapshot({ featureId: 'table.dataset.tx', runId, at: new Date().toISOString(), initiator, reason, journalId, ok: false, meta: null }, done);
    return createOut({ ok: false, nextDataset: null, meta: null, debug: done });
  }
}
