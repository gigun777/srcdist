/**
 * backup/zip_v2_actions.js
 *
 * Purpose:
 * - ZIP v2 export/import actions for the Backup Manager.
 * - Implements the same UX model as the known-good reference v2:
 *   - export creates a ZIP with manifest.json + navigation/templates/settings + per-journal JSON files
 *   - import reads manifest.json and applies templates/settings/navigation + datasets (merge/replace)
 *
 * This module is UI-aware (uses UI.confirm/toast) but does NOT own modal rendering.
 */

import { computeTreeNumbering } from '../../core/numbering_core.js';
import { NAV_KEYS } from '../../storage/db_nav.js';

function safeTs(ts = new Date()) {
  return new Date(ts).toISOString().replace(/[:.]/g, '-');
}

function computeDatasetStats(dataset) {
  const records = Array.isArray(dataset?.records) ? dataset.records : [];
  const rowsCount = records.length;
  let rowsWithSubrows = 0;
  const dist = {};
  const colSet = new Set();

  for (const r of records) {
    const cells = (r && typeof r.cells === 'object' && r.cells) ? r.cells : {};
    for (const k of Object.keys(cells)) colSet.add(String(k));

    const sub = Array.isArray(r?.subrows) ? r.subrows : [];
    const n = sub.length;
    dist[String(n)] = (dist[String(n)] || 0) + 1;
    if (n > 0) rowsWithSubrows += 1;

    for (const s of sub) {
      const sc = (s && typeof s.cells === 'object' && s.cells) ? s.cells : {};
      for (const k of Object.keys(sc)) colSet.add(String(k));
    }
  }

  return {
    columnsCount: colSet.size,
    rowsCount,
    rowsWithSubrows,
    subrowsDistribution: dist
  };
}

function translitUaToLat(s) {
  const map = {
    'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ie','ж':'zh','з':'z','и':'y','і':'i','ї':'i','й':'i',
    'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ю':'iu','я':'ia',
    'ь':'','ʼ':'','’':'','`':'','"':'',"'":'',
  };
  return String(s ?? '').toLowerCase().split('').map((ch) => Object.prototype.hasOwnProperty.call(map, ch) ? map[ch] : ch).join('');
}

function slugUa(s) {
  const t = translitUaToLat(String(s ?? ''));
  return t.replace(/[^a-z0-9]+/g, '').trim();
}

function buildSpaceSnapshot(spaces) {
  const nodes = {};
  const rootIds = [];
  const list = Array.isArray(spaces) ? spaces.filter(Boolean) : [];
  const meta = {};

  for (const sp of list) {
    nodes[sp.id] = { id: sp.id, title: sp.title || sp.name || sp.id, parentId: sp.parentId || null, children: [] };
    meta[sp.id] = { createdAt: sp.createdAt || null, title: String(sp.title || sp.name || sp.id || '') };
  }
  for (const sp of list) {
    const pid = sp.parentId || null;
    if (pid && nodes[pid]) nodes[pid].children.push(sp.id);
    else rootIds.push(sp.id);
  }

  const sortIds = (ids) => ids.sort((a, b) => {
    const A = meta[a] || { createdAt: null, title: '' };
    const B = meta[b] || { createdAt: null, title: '' };
    const ca = A.createdAt ? Date.parse(A.createdAt) : NaN;
    const cb = B.createdAt ? Date.parse(B.createdAt) : NaN;
    const ha = Number.isFinite(ca);
    const hb = Number.isFinite(cb);
    if (ha && hb && ca !== cb) return ca - cb;
    if (ha && !hb) return -1;
    if (!ha && hb) return 1;
    return String(A.title).localeCompare(String(B.title));
  });

  sortIds(rootIds);
  for (const id of Object.keys(nodes)) sortIds(nodes[id].children);
  return { nodes, rootIds };
}

function buildJournalSnapshotForSpace(journals, spaceId) {
  const nodes = {};
  const topIds = [];
  const list = Array.isArray(journals) ? journals.filter((j) => j && j.spaceId === spaceId) : [];
  const meta = {};

  for (const j of list) {
    meta[j.id] = { idx: (typeof j.index === 'number') ? j.index : 1e9, title: String(j.title || j.name || '') };
    nodes[j.id] = { id: j.id, title: j.title || j.name || j.id, parentId: j.parentId || null, children: [] };
  }
  for (const j of list) {
    const pid = j.parentId || spaceId;
    if (nodes[pid]) nodes[pid].children.push(j.id);
    else topIds.push(j.id);
  }

  const sortIds = (ids) => ids.sort((a, b) => {
    const A = meta[a] || { idx: 1e9, title: '' };
    const B = meta[b] || { idx: 1e9, title: '' };
    if (A.idx !== B.idx) return A.idx - B.idx;
    return A.title.localeCompare(B.title);
  });
  sortIds(topIds);
  for (const id of Object.keys(nodes)) sortIds(nodes[id].children);
  return { nodes, topIds };
}

function normalizeManifestFiles(filesObj) {
  const f = filesObj || {};
  const pickFirst = (v, fallback) => {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.find((x) => typeof x === 'string') || fallback;
    return fallback;
  };
  return {
    navPath: pickFirst(f.navigation || f.nav, 'spaces/navigation.json'),
    jtPath: pickFirst(f.journalTemplates, 'templates/journal_templates.json'),
    ttPath: pickFirst(f.transferTemplates, 'templates/transfer_templates.json'),
    gsPath: pickFirst(f.globalSettings, 'settings/global_settings.json'),
    journalPaths: Array.isArray(f.journals) ? f.journals.filter((x) => typeof x === 'string') : []
  };
}

export async function exportAllZipV2({ sdoInst, zipTools, downloadBlob } = {}) {
  const { enc, zipStore } = zipTools || {};
  if (!sdoInst?.exportBackup) {
    window.UI?.toast?.show?.('exportBackup недоступний у цій збірці', { type: 'error' });
    return;
  }
  if (!enc || !zipStore) {
    window.UI?.toast?.show?.('ZIP tools not ready', { type: 'error' });
    return;
  }

  const createdAt = new Date().toISOString();
  const ts = safeTs(createdAt);

  const bundle = await sdoInst.exportBackup({ scope: 'all', includeUserData: true });
  const navPayload = bundle?.core?.navigation || null;

  const st0 = (sdoInst?.api?.getState && typeof sdoInst.api.getState === 'function')
    ? sdoInst.api.getState()
    : (typeof sdoInst?.getState === 'function' ? sdoInst.getState() : {});
  const spaces = Array.isArray(st0?.spaces) ? st0.spaces : [];
  const journals = Array.isArray(st0?.journals) ? st0.journals : [];

  const journalTemplates = bundle?.modules?.['journal-templates']?.data?.templates || [];
  const transferTemplates = bundle?.modules?.['transfer-templates']?.data?.templates || [];
  const tableSettings = bundle?.modules?.['table-settings']?.data?.settings || {};
  const coreSettings = bundle?.core?.settings?.coreSettings || {};
  const tableData = bundle?.modules?.['table-datasets']?.data || { format: 'sdo-table-data', formatVersion: 1, exportedAt: createdAt, datasets: [] };

  const tplById = new Map((journalTemplates || []).map((t) => [t?.id, t]));
  const datasetByJournalId = new Map((tableData?.datasets || []).map((d) => [d?.journalId, d]));
  const tableStore = sdoInst?.api?.tableStore || null;

  const sSnap = buildSpaceSnapshot(spaces);
  const spaceNums = computeTreeNumbering(sSnap.rootIds, (id) => sSnap.nodes[id]?.children || []);
  const journalNums = new Map();
  for (const sp of spaces) {
    if (!sp?.id) continue;
    const jSnap = buildJournalSnapshotForSpace(journals, sp.id);
    const jMap = computeTreeNumbering(jSnap.topIds, (id) => jSnap.nodes[id]?.children || []);
    for (const [jid, num] of jMap.entries()) journalNums.set(jid, num);
  }

  const spaceById = new Map(spaces.map((s) => [s.id, s]));
  const journalById = new Map(journals.map((j) => [j.id, j]));
  function findSpaceForJournal(journal) {
    if (!journal) return null;
    let pid = journal.parentId;
    while (pid && !spaceById.has(pid)) {
      const pj = journalById.get(pid);
      if (!pj) break;
      pid = pj.parentId;
    }
    return pid && spaceById.has(pid) ? spaceById.get(pid) : null;
  }

  const journalFiles = [];
  const TABLE_SETTINGS_KEY = '@sdo/module-table-renderer:settings';

  for (const j of journals) {
    if (!j?.id) continue;
    let ds = null;
    if (tableStore && typeof tableStore.getDataset === 'function') {
      try { ds = await tableStore.getDataset(j.id); } catch { ds = null; }
    }
    if (!ds) ds = datasetByJournalId.get(j.id) || { journalId: j.id, records: [], meta: {} };

    const st = computeDatasetStats(ds);
    const tpl = tplById.get(j.templateId) || null;
    const templateName = tpl?.title || tpl?.name || tpl?.id || j.templateId || null;
    const perJournalSettings = tableSettings?.[`${TABLE_SETTINGS_KEY}:${j.id}`] ?? null;

    const space = findSpaceForJournal(j);
    const sNum = (space && spaceNums.get(space.id)) ? spaceNums.get(space.id) : '0';
    const jNum = journalNums.get(j.id) || '0';
    const pathStr = `s${sNum}${slugUa(space?.title || space?.name || '')}/j${jNum}${slugUa(j.title || j.name || '')}`;

    const payload = {
      format: 'sdo-journal',
      version: 2,
      createdAt,
      meta: {
        journalId: j.id,
        spaceId: j.spaceId,
        parentId: j.parentId,
        title: j.title || j.name || null,
        index: j.index ?? null,
        path: pathStr,
        templateId: j.templateId || null,
        templateName,
        columnsCount: st.columnsCount,
        rowsCount: st.rowsCount,
        rowsWithSubrows: st.rowsWithSubrows,
        subrowsDistribution: st.subrowsDistribution,
        exportedAt: createdAt,
      },
      settings: {
        tableRenderer: perJournalSettings
      },
      data: {
        dataset: ds
      }
    };

    const name = `journals/journal_${String(j.id).replace(/[^a-zA-Z0-9_-]/g, '_')}_${ts}.json`;
    journalFiles.push({ name, dataU8: enc.encode(JSON.stringify(payload, null, 2)) });
  }

  const manifest = {
    format: 'sdo-backup-zip',
    version: 2,
    createdAt,
    app: bundle?.app || { name: '@sdo/core', version: 'unknown' },
    mode: 'full',
    contains: {
      journals: true,
      journalTemplates: true,
      transferTemplates: true,
      columnTypes: true,
      settings: true,
      navigation: true
    },
    files: {
      manifest: 'manifest.json',
      navigation: 'spaces/navigation.json',
      journalTemplates: 'templates/journal_templates.json',
      transferTemplates: 'templates/transfer_templates.json',
      columnTypes: 'templates/column_types.json',
      globalSettings: 'settings/global_settings.json',
      journals: journalFiles.map((f) => f.name)
    },
    order: [
      'journalTemplates',
      'transferTemplates',
      'columnTypes',
      'settings',
      'navigation',
      'journalsData'
    ]
  };

  const files = [];
  files.push({ name: 'manifest.json', dataU8: enc.encode(JSON.stringify(manifest, null, 2)) });
  files.push({
    name: 'spaces/navigation.json',
    dataU8: enc.encode(JSON.stringify({ format: 'sdo-navigation', version: 1, createdAt, navigation: navPayload }, null, 2))
  });
  files.push({
    name: 'templates/journal_templates.json',
    dataU8: enc.encode(JSON.stringify({ format: 'sdo-journal-templates', version: 1, createdAt, templates: journalTemplates }, null, 2))
  });
  files.push({
    name: 'templates/transfer_templates.json',
    dataU8: enc.encode(JSON.stringify({ format: 'sdo-transfer-templates', version: 1, createdAt, templates: transferTemplates }, null, 2))
  });
  files.push({
    name: 'templates/column_types.json',
    dataU8: enc.encode(JSON.stringify({ format: 'sdo-column-types', version: 1, createdAt, columnTypes: [] }, null, 2))
  });
  files.push({
    name: 'settings/global_settings.json',
    dataU8: enc.encode(JSON.stringify({ format: 'sdo-settings', version: 1, createdAt, coreSettings, tableSettings }, null, 2))
  });
  files.push(...journalFiles);

  const zipBlob = await zipStore(files);
  downloadBlob?.(zipBlob, `backup_all_${ts}.zip`);
  window.UI?.toast?.show?.('Експорт ZIP (v2) виконано', { type: 'success' });

  window.__backupV2Debug = {
    lastAction: 'exportAllZipV2',
    at: new Date().toISOString(),
    manifest,
    journalsCount: journalFiles.length
  };
}

export async function importAllZipV2({ sdoInst, zipTools, pickFile, forceTableRerender } = {}) {
  const { dec, zipExtractStoreOnly, zipReadFile } = zipTools || {};
  if (!dec || !zipExtractStoreOnly || !zipReadFile) {
    window.UI?.toast?.show?.('ZIP tools not ready', { type: 'error' });
    return;
  }
  const storage = sdoInst?.api?.storage || null;
  const tableStore = sdoInst?.api?.tableStore || null;
  if (!storage || typeof storage.set !== 'function') {
    window.UI?.toast?.show?.('ZIP імпорт: storage API недоступний (sdo.api.storage.set)', { type: 'error' });
    return;
  }
  if (!tableStore || typeof tableStore.importTableData !== 'function') {
    window.UI?.toast?.show?.('ZIP імпорт: tableStore API недоступний (sdo.api.tableStore.importTableData)', { type: 'error' });
    return;
  }

  const file = await pickFile?.({ accept: '.zip,application/zip' });
  if (!file) return;
  const zipU8 = await zipExtractStoreOnly(file);

  const manifestU8 = zipReadFile(zipU8, 'manifest.json');
  if (!manifestU8) {
    window.UI?.toast?.show?.('У ZIP відсутній manifest.json. Імпорт ZIP v2 неможливий.', { type: 'error' });
    return;
  }

  let manifest;
  try { manifest = JSON.parse(dec.decode(manifestU8)); } catch {
    window.UI?.toast?.show?.('manifest.json пошкоджений', { type: 'error' });
    return;
  }
  if (manifest?.format !== 'sdo-backup-zip' || manifest?.version !== 2) {
    window.UI?.toast?.show?.('Непідтримуваний формат manifest.json', { type: 'error' });
    return;
  }

  const modeOkReplace = await window.UI?.confirm?.(
    'Імпорт ZIP',
    'Режим: ОК = replace (очистити все і відновити), Скасувати = merge (об’єднати).',
    { okText: 'Replace', cancelText: 'Merge' }
  );
  const mode = modeOkReplace ? 'replace' : 'merge';

  if (mode === 'replace') {
    try {
      if (storage?.list && storage?.del) {
        const items = (await storage.list('')) || [];
        for (const it of items) {
          if (it?.key) await storage.del(it.key);
        }
      }
    } catch (e) {
      window.UI?.toast?.show?.('Не вдалося очистити сховище: ' + (e?.message || e), { type: 'error' });
      return;
    }
  }

  const paths = normalizeManifestFiles(manifest.files);
  const getJson = (path) => {
    const u8 = zipReadFile(zipU8, path);
    if (!u8) throw new Error(`ZIP: missing file ${path}`);
    return JSON.parse(dec.decode(u8));
  };

  let navJson, jtJson, ttJson, gsJson;
  try {
    navJson = getJson(paths.navPath);
    jtJson = getJson(paths.jtPath);
    ttJson = getJson(paths.ttPath);
    gsJson = getJson(paths.gsPath);
  } catch (e) {
    window.UI?.toast?.show?.('ZIP імпорт помилка: ' + (e?.message || e), { type: 'error' });
    return;
  }

  const journalTemplates = Array.isArray(jtJson?.templates) ? jtJson.templates : [];
  const transferTemplates = Array.isArray(ttJson?.templates) ? ttJson.templates : [];
  const coreSettings = gsJson?.coreSettings ?? {};
  const tableSettings = gsJson?.tableSettings ?? {};
  const navPayload = navJson?.navigation || navJson?.core?.navigation || navJson?.payload || navJson?.navigation;

  try {
    const ids = journalTemplates.map((t) => String(t?.id || '')).filter(Boolean);
    await storage.set('templates:index', ids);
    for (const t of journalTemplates) {
      if (!t?.id) continue;
      await storage.set(`templates:tpl:${String(t.id)}`, t);
    }
  } catch (e) {
    window.UI?.toast?.show?.('ZIP імпорт: помилка застосування journal templates: ' + (e?.message || e), { type: 'error' });
    return;
  }

  try {
    await storage.set('transfer:templates:v1', transferTemplates);
  } catch (e) {
    window.UI?.toast?.show?.('ZIP імпорт: помилка застосування transfer templates: ' + (e?.message || e), { type: 'error' });
    return;
  }

  try {
    await storage.set(NAV_KEYS.coreSettings, coreSettings);
    const TABLE_SETTINGS_KEY = '@sdo/module-table-renderer:settings';
    if (tableSettings && typeof tableSettings === 'object') {
      await storage.set(TABLE_SETTINGS_KEY, tableSettings);
    }
  } catch (e) {
    window.UI?.toast?.show?.('ZIP імпорт: помилка застосування settings: ' + (e?.message || e), { type: 'error' });
    return;
  }

  if (!navPayload) {
    window.UI?.toast?.show?.('ZIP імпорт: navigation payload відсутній у spaces/navigation.json', { type: 'error' });
    return;
  }
  if (typeof sdoInst?.importNavigationState !== 'function') {
    window.UI?.toast?.show?.('ZIP імпорт: sdo.importNavigationState недоступний', { type: 'error' });
    return;
  }
  try {
    await sdoInst.importNavigationState(navPayload);
  } catch (e) {
    window.UI?.toast?.show?.('ZIP імпорт: помилка застосування navigation: ' + (e?.message || e), { type: 'error' });
    return;
  }

  const datasets = [];
  const existingTemplates = new Set((jtJson?.templates || []).map((t) => t?.id).filter(Boolean));

  for (const p of paths.journalPaths) {
    let jdoc;
    try { jdoc = getJson(p); } catch {
      window.UI?.toast?.show?.('Помилка читання journal: ' + p, { type: 'error' });
      return;
    }

    const meta = jdoc?.meta || {};
    const ds = jdoc?.data?.dataset || null;
    if (!ds?.journalId) continue;

    try {
      const per = jdoc?.settings?.tableRenderer ?? null;
      if (per && typeof per === 'object') {
        const TABLE_SETTINGS_KEY = '@sdo/module-table-renderer:settings';
        await storage.set(`${TABLE_SETTINGS_KEY}:${ds.journalId}`, per);
      }
    } catch (_) {}

    const tplId = meta.templateId || null;
    if (tplId && !existingTemplates.has(tplId)) {
      const okCreate = await window.UI?.confirm?.('Імпорт ZIP', `Відсутній шаблон журналу "${tplId}". Створити?`, { okText: 'Створити', cancelText: 'Скасувати' });
      if (!okCreate) {
        window.UI?.toast?.show?.(`Імпорт скасовано: відсутній шаблон ${tplId}`, { type: 'error' });
        return;
      }
      (jtJson.templates = jtJson.templates || []).push({ id: tplId, title: meta.templateName || tplId, columns: [] });
      existingTemplates.add(tplId);
      backupBundle.modules['journal-templates'].data.templates = jtJson.templates;
    }

    const cols = Number(meta.columnsCount ?? 0);
    const tpl = (jtJson?.templates || []).find((t) => t?.id === tplId) || null;
    const tplCols = Array.isArray(tpl?.columns) ? tpl.columns.length : null;
    if (tplCols != null && cols && tplCols !== cols) {
      const okContinue = await window.UI?.confirm?.('Імпорт ZIP', `Різна кількість колонок для шаблону "${tplId}": у файлі ${cols}, у шаблоні ${tplCols}. Продовжити?`, { okText: 'Так', cancelText: 'Ні' });
      if (!okContinue) {
        window.UI?.toast?.show?.('Імпорт скасовано через розбіжність колонок', { type: 'error' });
        return;
      }
    }

    datasets.push(ds);
  }

  try {
    const rep = await tableStore.importTableData(
      { format: 'sdo-table-data', formatVersion: 1, exportedAt: new Date().toISOString(), datasets },
      { mode }
    );
    if (rep?.applied !== true) {
      window.UI?.toast?.show?.('ZIP імпорт: tableStore.importTableData не застосував зміни: ' + ((rep?.errors || []).join(', ') || 'applied=false'), { type: 'error' });
      return;
    }
  } catch (e) {
    window.UI?.toast?.show?.('ZIP імпорт: помилка застосування datasets: ' + (e?.message || e), { type: 'error' });
    return;
  }

  try { await forceTableRerender?.(); } catch (_) {}
  window.UI?.toast?.show?.(`Імпорт ZIP (v2) виконано (${mode})`, { type: 'success' });

  window.__backupV2Debug = {
    lastAction: 'importAllZipV2',
    at: new Date().toISOString(),
    mode,
    journalsInZip: paths.journalPaths.length,
    datasets: datasets.length
  };
}
