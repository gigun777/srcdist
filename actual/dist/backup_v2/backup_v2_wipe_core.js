// Backup v2 - Wipe core (C2.2)
// Implements a strict, previewable wipe for mode=replace.
// This is intentionally independent from apply/import logic.

import { NAV_KEYS } from '../storage/db_nav.js';

function nowIso() {
  return new Date().toISOString();
}

async function listKeys(storage, prefix) {
  if (!storage?.list) return [];
  const entries = await storage.list(prefix);
  return Array.isArray(entries) ? entries.map(e => e.key).filter(Boolean) : [];
}

function sampleKeys(keys, max = 20) {
  if (!Array.isArray(keys)) return [];
  if (keys.length <= max) return keys;
  return [...keys.slice(0, max), `... (+${keys.length - max} more)`];
}

export async function buildWipePlanV2({ storage } = {}) {
  const plan = {
    ok: true,
    createdAt: nowIso(),
    mode: 'replace',
    groups: [],
    totals: { keys: 0 }
  };

  try {
    if (!storage) throw new Error('storage missing');

    // Navigation
    const navKeys = [NAV_KEYS.spaces, NAV_KEYS.journals, NAV_KEYS.lastLoc, NAV_KEYS.history, NAV_KEYS.revision, NAV_KEYS.revisionLog];
    const navExisting = [];
    for (const k of navKeys) {
      try {
        const v = await storage.get(k);
        if (v !== null && v !== undefined) navExisting.push(k);
      } catch (_) {
        // ignore
      }
    }
    plan.groups.push({
      id: 'navigation',
      title: 'Navigation (spaces/journals/history)',
      kind: 'explicit_keys',
      keys: navExisting,
      keysSample: sampleKeys(navExisting),
      count: navExisting.length
    });

    // Templates
    const tplKeys = await listKeys(storage, 'templates:');
    plan.groups.push({
      id: 'journal_templates',
      title: 'Journal templates',
      kind: 'prefix',
      prefix: 'templates:',
      keys: tplKeys,
      keysSample: sampleKeys(tplKeys),
      count: tplKeys.length
    });

    // Transfer templates
    const transferKey = 'transfer:templates:v1';
    const transferExists = (await storage.get(transferKey)) != null;
    plan.groups.push({
      id: 'transfer_templates',
      title: 'Transfer templates',
      kind: 'explicit_keys',
      keys: transferExists ? [transferKey] : [],
      keysSample: transferExists ? [transferKey] : [],
      count: transferExists ? 1 : 0
    });

    // TableStore datasets (single source of truth)
    const tsKeys = await listKeys(storage, 'tableStore:');
    plan.groups.push({
      id: 'table_store',
      title: 'TableStore datasets/index',
      kind: 'prefix',
      prefix: 'tableStore:',
      keys: tsKeys,
      keysSample: sampleKeys(tsKeys),
      count: tsKeys.length
    });

    // Core settings
    const coreSettingsKey = NAV_KEYS.coreSettings;
    const coreSettingsExists = (await storage.get(coreSettingsKey)) != null;
    plan.groups.push({
      id: 'core_settings',
      title: 'Core settings',
      kind: 'explicit_keys',
      keys: coreSettingsExists ? [coreSettingsKey] : [],
      keysSample: coreSettingsExists ? [coreSettingsKey] : [],
      count: coreSettingsExists ? 1 : 0
    });

    // Module/UI settings (@sdo/*)
    const sdoKeys = await listKeys(storage, '@sdo/');
    plan.groups.push({
      id: 'module_settings',
      title: 'Module/UI settings (@sdo/*)',
      kind: 'prefix',
      prefix: '@sdo/',
      keys: sdoKeys,
      keysSample: sampleKeys(sdoKeys),
      count: sdoKeys.length
    });

    // Welcome seed markers
    const welcomeKeys = await listKeys(storage, 'welcome:');
    plan.groups.push({
      id: 'welcome_seed',
      title: 'Welcome seed markers',
      kind: 'prefix',
      prefix: 'welcome:',
      keys: welcomeKeys,
      keysSample: sampleKeys(welcomeKeys),
      count: welcomeKeys.length
    });

    // Totals
    plan.totals.keys = plan.groups.reduce((acc, g) => acc + (g.count || 0), 0);
    return plan;
  } catch (err) {
    return {
      ok: false,
      createdAt: nowIso(),
      mode: 'replace',
      error: err?.message || String(err),
      groups: [],
      totals: { keys: 0 }
    };
  }
}

export async function executeWipeReplaceV2({ storage } = {}, { dryRun = false } = {}) {
  const startedAt = nowIso();
  const plan = await buildWipePlanV2({ storage });
  if (!plan?.ok) {
    return { ok: false, startedAt, finishedAt: nowIso(), error: plan?.error || 'wipe plan failed', plan };
  }

  const deleted = [];
  const errors = [];

  if (!dryRun) {
    for (const g of plan.groups) {
      for (const key of (g.keys || [])) {
        try {
          await storage.del(key);
          deleted.push(key);
        } catch (e) {
          errors.push({ key, error: e?.message || String(e) });
        }
      }
    }
  }

  // post-check counts
  const post = {
    navigation: {
      spaces: (await storage.get(NAV_KEYS.spaces)) ?? null,
      journals: (await storage.get(NAV_KEYS.journals)) ?? null
    },
    templatesCount: (await listKeys(storage, 'templates:')).length,
    tableStoreKeysCount: (await listKeys(storage, 'tableStore:')).length,
    transferTemplatesExists: (await storage.get('transfer:templates:v1')) != null,
    coreSettingsExists: (await storage.get(NAV_KEYS.coreSettings)) != null,
    sdoSettingsKeysCount: (await listKeys(storage, '@sdo/')).length,
    welcomeKeysCount: (await listKeys(storage, 'welcome:')).length
  };

  return {
    ok: errors.length === 0,
    dryRun,
    startedAt,
    finishedAt: nowIso(),
    planSummary: {
      totalKeysPlanned: plan?.totals?.keys || 0,
      groups: (plan.groups || []).map(g => ({ id: g.id, count: g.count }))
    },
    deletedCount: deleted.length,
    deletedSample: sampleKeys(deleted, 30),
    errors,
    post
  };
}
