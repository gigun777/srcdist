// src/table/core/event_log.js
// Lightweight event log (debug-only) for table pipeline.
//
// Stores events in: window.__tableFeatureDebug.__eventLog (ring buffer).
// Goal: allow user to see who initiated an event (featureId) and whether it happened.

const MAX_EVENTS = 200;

function getWindowSafe() {
  try {
    return (typeof window !== 'undefined') ? window : globalThis;
  } catch {
    return globalThis;
  }
}

function ensureBus() {
  const w = getWindowSafe();
  w.__tableFeatureDebug = w.__tableFeatureDebug || Object.create(null);
  if (!Array.isArray(w.__tableFeatureDebug.__eventLog)) {
    w.__tableFeatureDebug.__eventLog = [];
    w.__tableFeatureDebug.__eventSeq = 0;
  }
  return w.__tableFeatureDebug;
}

/**
 * Push a debug event.
 * @param {{type:string, phase?:string, initiator?:string|null, reason?:string|null, journalId?:string|null, ok?:boolean|null, ms?:number|null, details?:any}} e
 */
export function pushTableEvent(e) {
  try {
    const bus = ensureBus();
    const seq = (bus.__eventSeq = (Number(bus.__eventSeq) || 0) + 1);
    const entry = {
      seq,
      at: new Date().toISOString(),
      type: String(e?.type || 'event'),
      phase: e?.phase ? String(e.phase) : null,
      initiator: e?.initiator ? String(e.initiator) : null,
      reason: e?.reason ? String(e.reason) : null,
      journalId: e?.journalId ? String(e.journalId) : null,
      ok: (typeof e?.ok === 'boolean') ? e.ok : null,
      ms: (typeof e?.ms === 'number') ? Math.round(e.ms * 1000) / 1000 : null,
      details: (e && 'details' in e) ? e.details : null,
    };
    bus.__eventLog.push(entry);
    if (bus.__eventLog.length > MAX_EVENTS) {
      bus.__eventLog.splice(0, bus.__eventLog.length - MAX_EVENTS);
    }
  } catch {
    // debug-only, never break app
  }
}

export function getTableEventLog() {
  const w = getWindowSafe();
  const bus = w.__tableFeatureDebug;
  return Array.isArray(bus?.__eventLog) ? bus.__eventLog : [];
}

export function clearTableEventLog() {
  try {
    const bus = ensureBus();
    bus.__eventLog = [];
    bus.__eventSeq = 0;
  } catch {
    // ignore
  }
}
