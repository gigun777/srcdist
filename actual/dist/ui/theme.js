/**
 * Theme runtime API (ESM).
 *
 * Storage contract:
 * - Uses globalThis.UI.storage (StorageAdapter) exclusively.
 * - Key: 'ui.theme'
 */
const STORAGE_KEY = 'ui.theme';
const ROOT = document.documentElement;
const FALLBACK_THEME = 'light';

async function getStorage() {
  const UI = globalThis.UI;
  return UI && UI.storage ? UI.storage : null;
}

export async function initTheme(opts = {}) {
  const preferSystemTheme = opts.preferSystemTheme ?? true;
    const storage = await getStorage();

  let theme = null;
  if (storage) {
    theme = await storage.get(STORAGE_KEY);
  }

  if (!theme && preferSystemTheme) {
    const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (mq && mq.matches) theme = 'dark';
  }

  theme = (theme === 'dark' || theme === 'light') ? theme : FALLBACK_THEME;
  await applyTheme(theme);
  return theme;
}

export async function applyTheme(themeName) {
    const theme = (themeName === 'dark' || themeName === 'light') ? themeName : FALLBACK_THEME;
  ROOT.dataset.theme = theme;
    const storage = await getStorage();
  if (storage) await storage.set(STORAGE_KEY, theme);
  return theme;
}

export async function toggleTheme() {
    const next = (getTheme() === 'dark') ? 'light' : 'dark';
  return await applyTheme(next);
}

export function getTheme() {
  const t = ROOT.dataset.theme;
  return (t === 'dark' || t === 'light') ? t : FALLBACK_THEME;
}

// Legacy global hooks (if somebody calls them)
const UI = (globalThis.UI = globalThis.UI || {});
UI.theme = UI.theme || {};
UI.theme.initTheme = initTheme;
UI.theme.applyTheme = applyTheme;
UI.theme.toggleTheme = toggleTheme;
UI.theme.getTheme = getTheme;
