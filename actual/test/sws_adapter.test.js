import test from 'node:test';
import assert from 'node:assert/strict';
import { createSwsAdapter } from '../src/ui/sws_v2/sws_adapter.js';

test('sws adapter uses SWS channel by default when available', () => {
  const calls = [];
  const adapter = createSwsAdapter({
    getSettingsWindow: () => ({ push: (payload) => calls.push(['sws', payload]) }),
    openLegacyModal: (payload) => calls.push(['legacy', payload])
  });

  const result = adapter.open({ screenId: 'settings.root', sws: { title: 'Settings' } });

  assert.equal(result.ok, true);
  assert.equal(result.channel, 'sws');
  assert.deepEqual(calls, [['sws', { title: 'Settings' }]]);
});

test('sws adapter falls back to legacy when route is legacy', () => {
  const calls = [];
  const adapter = createSwsAdapter({
    getSettingsWindow: () => ({ push: (payload) => calls.push(['sws', payload]) }),
    openLegacyModal: (payload) => calls.push(['legacy', payload])
  });

  adapter.setRoute('transfer.execute', 'legacy');
  const result = adapter.open({
    screenId: 'transfer.execute',
    sws: { title: 'Transfer' },
    legacy: { title: 'Transfer Legacy' }
  });

  assert.equal(result.ok, true);
  assert.equal(result.channel, 'legacy');
  assert.deepEqual(calls, [['legacy', { title: 'Transfer Legacy' }]]);
});

test('sws adapter returns structured error without channels', () => {
  const adapter = createSwsAdapter({
    getSettingsWindow: () => null,
    openLegacyModal: () => {}
  });

  const result = adapter.open({ screenId: 'debug.screen' });
  assert.equal(result.ok, false);
  assert.equal(result.channel, 'none');
  assert.match(result.error, /No available channel/);
});


test('sws adapter supports custom swsOpen flow for root screens', () => {
  const calls = [];
  const adapter = createSwsAdapter({
    getSettingsWindow: () => ({
      openCustomRoot: (fn) => { calls.push('openCustomRoot'); fn(); },
      push: (payload) => calls.push(['push', payload])
    }),
    openLegacyModal: (payload) => calls.push(['legacy', payload])
  });

  const result = adapter.open({
    screenId: 'debug.center',
    swsOpen: (sw) => {
      sw.openCustomRoot(() => sw.push({ title: 'Debug Center' }));
    },
    legacy: { title: 'Legacy Debug' }
  });

  assert.equal(result.ok, true);
  assert.equal(result.channel, 'sws');
  assert.equal(result.mode, 'custom-root');
  assert.deepEqual(calls, ['openCustomRoot', ['push', { title: 'Debug Center' }]]);
});


test('sws adapter can clear specific and all routes', () => {
  const adapter = createSwsAdapter({
    getSettingsWindow: () => ({ push: () => {} }),
    openLegacyModal: () => {}
  });

  adapter.setRoute('debug.center', 'legacy');
  adapter.setRoute('transfer.execute', 'legacy');

  assert.equal(adapter.getRoute('debug.center'), 'legacy');
  assert.equal(adapter.clearRoute('debug.center'), true);
  assert.equal(adapter.getRoute('debug.center'), 'sws');

  adapter.clearAllRoutes();
  assert.deepEqual(adapter.getRoutesSnapshot(), {});
  assert.equal(adapter.getRoute('transfer.execute'), 'sws');
});


test('sws adapter exports and imports routes as JSON object', () => {
  const adapter = createSwsAdapter({
    getSettingsWindow: () => ({ push: () => {} }),
    openLegacyModal: () => {}
  });

  adapter.setRoute('debug.center', 'legacy');
  adapter.setRoute('transfer.execute', 'sws');

  const snapshot = adapter.exportRoutes();
  assert.deepEqual(snapshot, { 'debug.center': 'legacy', 'transfer.execute': 'sws' });

  adapter.clearAllRoutes();
  const importedCount = adapter.importRoutes({ 'debug.center': 'sws', 'backup.import': 'legacy' });

  assert.equal(importedCount, 2);
  assert.equal(adapter.getRoute('debug.center'), 'sws');
  assert.equal(adapter.getRoute('backup.import'), 'legacy');
});

test('sws adapter importRoutes rejects non-object payloads', () => {
  const adapter = createSwsAdapter({
    getSettingsWindow: () => ({ push: () => {} }),
    openLegacyModal: () => {}
  });

  assert.throws(() => adapter.importRoutes([]), /importRoutes requires plain object/);
  assert.throws(() => adapter.importRoutes(null), /importRoutes requires plain object/);
});


test('sws adapter lists available route presets', () => {
  const adapter = createSwsAdapter({
    getSettingsWindow: () => ({ push: () => {} }),
    openLegacyModal: () => {}
  });

  const presets = adapter.listPresets().sort();
  assert.deepEqual(presets, ['modern_sws_core', 'safe_legacy_core']);
});

test('sws adapter can apply route preset and reject unknown preset', () => {
  const adapter = createSwsAdapter({
    getSettingsWindow: () => ({ push: () => {} }),
    openLegacyModal: () => {}
  });

  const applied = adapter.applyPreset('safe_legacy_core');
  assert.equal(applied.ok, true);
  assert.equal(adapter.getRoute('transfer.execute'), 'legacy');
  assert.equal(adapter.getRoute('backup.import'), 'legacy');

  assert.throws(() => adapter.applyPreset('not_exists'), /Unknown preset/);
});


test('sws adapter can preview preset routes without mutating adapter state', () => {
  const adapter = createSwsAdapter({
    getSettingsWindow: () => ({ push: () => {} }),
    openLegacyModal: () => {}
  });

  const before = adapter.getRoutesSnapshot();
  const preset = adapter.getPreset('modern_sws_core');

  assert.deepEqual(before, {});
  assert.deepEqual(preset, {
    'transfer.execute': 'sws',
    'backup.import': 'sws',
    'debug.center': 'sws'
  });
  assert.deepEqual(adapter.getRoutesSnapshot(), {});
});
