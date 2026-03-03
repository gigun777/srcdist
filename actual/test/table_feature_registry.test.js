import test from 'node:test';
import assert from 'node:assert/strict';
import { listTableFeatureApis, getTableFeatureApi, validateTableFeatureApi } from '../src/table/core/table_feature_registry.js';

test('table feature registry exposes all table feature APIs', () => {
  const apis = listTableFeatureApis();
  const ids = apis.map((api) => api.featureId).sort();
  assert.deepEqual(ids, ['table.edit.cancel', 'table.edit.commit', 'table.rerender.sync']);
});

test('table feature registry can resolve API by feature id', () => {
  const commitApi = getTableFeatureApi('table.edit.commit');
  assert.equal(commitApi?.featureId, 'table.edit.commit');

  const missing = getTableFeatureApi('table.unknown');
  assert.equal(missing, null);
});

test('table feature registry validates minimal API contract shape', () => {
  const apis = listTableFeatureApis();
  for (const api of apis) {
    assert.equal(validateTableFeatureApi(api), true);
  }

  assert.equal(validateTableFeatureApi(null), false);
  assert.equal(validateTableFeatureApi({ featureId: 'x' }), false);
});
