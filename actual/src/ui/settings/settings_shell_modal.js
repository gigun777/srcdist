/**
 * Compatibility shim for the legacy settings shell modal entrypoint.
 *
 * Patch-7 keeps `@sdo/core/ui/settings/shell` export stable, while the
 * implementation route now goes through SWS adapter / `UI.settings.openModal`.
 */

function resolveRuntime(globalObj = globalThis) {
  const UI = globalObj?.UI ?? null;
  const adapter = UI?.swsAdapter ?? globalObj?.SWSAdapter ?? null;
  return { UI, adapter };
}

/**
 * Opens settings via the newest available channel.
 * Falls back from SWS adapter -> UI.settings.openModal -> UI.modal.open.
 */
export function openSettingsShellModal(options = {}) {
  const { UI, adapter } = resolveRuntime();

  if (adapter && typeof adapter.open === 'function') {
    return adapter.open('settings', options);
  }

  if (UI?.settings && typeof UI.settings.openModal === 'function') {
    return UI.settings.openModal(options);
  }

  if (UI?.modal && typeof UI.modal.open === 'function') {
    return UI.modal.open({
      title: options?.title ?? 'Settings',
      contentNode: options?.contentNode ?? null,
      closeOnOverlay: true,
      escClose: true
    });
  }

  throw new Error('settings_shell_modal: no available settings modal channel');
}

/**
 * Legacy factory alias retained for backward compatibility.
 */
export function createSettingsShellModal() {
  return { open: openSettingsShellModal };
}

export default {
  openSettingsShellModal,
  createSettingsShellModal
};
