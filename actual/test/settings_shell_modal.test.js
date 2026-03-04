import test from 'node:test';
import assert from 'node:assert/strict';
import { openSettingsShellModal } from '../src/ui/settings/settings_shell_modal.js';

test('settings_shell_modal routes through adapter with structured payload', () => {
  const calls = [];
  const originalUI = globalThis.UI;
  const originalSWSAdapter = globalThis.SWSAdapter;

  globalThis.UI = {
    swsAdapter: {
      open: (payload) => {
        calls.push(payload);
        return { ok: true, channel: 'sws' };
      }
    }
  };

  try {
    const out = openSettingsShellModal({ title: 'Settings Test', contentNode: { x: 1 } });
    assert.equal(out.ok, true);
    assert.equal(out.channel, 'sws');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].screenId, 'settings.shell');
    assert.equal(calls[0].legacy.title, 'Settings Test');
  } finally {
    globalThis.UI = originalUI;
    globalThis.SWSAdapter = originalSWSAdapter;
  }
});
