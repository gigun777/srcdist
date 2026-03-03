/**
 * Minimal contract helpers for table feature pipes.
 * This module is intentionally DOM-free and can be reused by tests/debug.
 */

export function createFeatureMeta(featureId) {
  return {
    featureId: String(featureId || 'table.feature.unknown'),
    runId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ts: new Date().toISOString()
  };
}

export function createDebugTrace(meta, inputs) {
  return {
    featureId: meta.featureId,
    runId: meta.runId,
    timingMs: 0,
    inputs,
    steps: [],
    outputs: null,
    errors: []
  };
}

function cloneJson(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

export function finishDebugTrace(trace, outputs, startedAt) {
  trace.outputs = {
    result: cloneJson(outputs?.result || null),
    patches: cloneJson(Array.isArray(outputs?.patches) ? outputs.patches : []),
    effects: cloneJson(Array.isArray(outputs?.effects) ? outputs.effects : []),
    nextStateHints: cloneJson(outputs?.nextStateHints || {})
  };
  trace.timingMs = Date.now() - startedAt;
  return trace;
}
