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
