/**
 * ESM bootstrap wrapper (Option 2).
 *
 * Goal:
 * - Provide a single, deterministic startup entrypoint without requiring the host to call globals.
 * - Internally, legacy UI modules may still attach to globalThis.UI via side-effects. This wrapper
 *   normalizes that into an explicit exported `bootstrap()` function.
 *
 * Usage:
 *   import { bootstrap } from "./dist/ui/ui_bootstrap_esm.js";
 *   await bootstrap({ storage: storage, settingsHost: document.getElementById("...") });
 */

import { initTheme, applyTheme, toggleTheme, getTheme } from "./theme.js";

// Transfer UI (visual modals) + bridge (UI -> TransferCore)
import "./transfer_modals.js";
import { attachTransferUI } from "./ui_transfer_bridge.js";

// Side-effect imports: attach UI engines to globalThis.UI (legacy IIFE modules in this repo).
import "./ui_manager.js";
import "./ui_modal.js";
import "./ui_form.js";
import "./ui_toast.js";
import "./ui_backup.js";
import { createSwsAdapter } from "./sws_v2/sws_adapter.js";

// Settings subsystem (also legacy IIFE modules).

/**
 * @typedef {{getItem:(k:string)=>string|null, setItem:(k:string,v:string)=>void}} StorageAdapter
 */

/**
 * @param {{storage?: StorageAdapter, settingsHost?: HTMLElement|null, preferSystemTheme?: boolean}} options
 */
export async function bootstrap(options = {}) {
  // Init SettingsWindow v2 (global) once
  try {
    if (window.SettingsWindow && !window.__sws_inited) {
      window.SettingsWindow.init({ theme: 'light' });
      window.__sws_inited = true;
    }
  } catch (e) { console.warn('SettingsWindow.init failed:', e); }

  const global = globalThis;

  // Ensure UI namespace exists for legacy modules
  const UI = (global.UI = global.UI || {});

  const storage = normalizeStorage(options.storage);
  // Expose storage adapter for legacy IIFE modules (ui_manager/settings/etc.)
  UI.storage = storage;

  // Lazy-attach Transfer UI bridge once SEDO api is available.
  // IMPORTANT: must be synchronous here; bootstrap() calls it immediately and may schedule polling.
  const tryAttachTransfer = () => {
    const api = global.sdo?.api || global.SDO?.api || global.__sdo_api || global.__sdo?.api;
    if (!api) return false;
    if (!api.tableStore) return false;
    try {
      attachTransferUI({ UI, api, storage: options.storage || UI.storage || global.storage });
      return true;
    } catch (e) {
      console.warn('TransferUI attach failed', e);
      return false;
    }
  };
  if (!tryAttachTransfer()) {
    let attempts = 0;
    const t = setInterval(() => {
      attempts++;
      if (tryAttachTransfer() || attempts > 50) clearInterval(t);
    }, 100);
  }


  // Strangler Adapter (Alternative A): one router for old/new modal channels.
  const swsAdapter = createSwsAdapter({
    getSettingsWindow: () => global.SettingsWindow || null,
    openLegacyModal: (legacyPayload) => {
      const modal = global.UI?.modal;
      if (!modal || typeof modal.open !== 'function') {
        throw new Error('Legacy modal channel is unavailable (UI.modal.open missing)');
      }
      return modal.open(legacyPayload);
    }
  });
  UI.swsAdapter = swsAdapter;
  global.SWSAdapter = swsAdapter;

  // 2) Theme init (ESM theme runtime)
  // Note: current theme.js persists to storage by design. We still initialize early here.
  await initTheme({ preferSystemTheme: options.preferSystemTheme ?? true });

  // 3) UI state manager init (apply scale/density/etc.)
  if (typeof UI.init === "function") {
    await UI.init();
  }

  // 4) Optional: mount UX|UI tab right away if host provided
  return {
    theme: { initTheme, applyTheme, toggleTheme, getTheme },
    settings: {
      getSettings: UI.getSettings ? UI.getSettings.bind(UI) : null,
      applySettings: UI.applySettings ? UI.applySettings.bind(UI) : null,
      on: UI.on ? UI.on.bind(UI) : null
    }};
}

function normalizeStorage(adapter) {
  if (!adapter) {
    throw new Error("UI bootstrap requires a storage adapter (IndexedDB).");
  }
  const has = (k) => typeof adapter?.[k] === "function";
  if (has("get") && has("set") && has("del")) return adapter;
  throw new Error("Invalid storage adapter: expected {get,set,del} async methods.");
}

