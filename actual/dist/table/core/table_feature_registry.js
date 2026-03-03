import { editCommitApi } from '../features/edit_commit/api.js';
import { editCancelApi } from '../features/edit_cancel/api.js';
import { rerenderSyncApi } from '../features/rerender_sync/api.js';

const TABLE_FEATURE_APIS = Object.freeze([
  editCommitApi,
  editCancelApi,
  rerenderSyncApi
]);

export function listTableFeatureApis() {
  return TABLE_FEATURE_APIS.slice();
}

export function getTableFeatureApi(featureId) {
  const id = String(featureId || '');
  return TABLE_FEATURE_APIS.find((api) => api.featureId === id) || null;
}

export function validateTableFeatureApi(api) {
  if (!api || typeof api !== 'object') return false;
  if (!api.featureId || typeof api.featureId !== 'string') return false;
  if (!Array.isArray(api.eventsIn)) return false;
  if (!Array.isArray(api.commandsOut)) return false;
  return true;
}
