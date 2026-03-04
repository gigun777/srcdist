// Backup ZIP v2 - Import Apply Core (C2.3)
// Applies ZIP v2 into runtime in strict order:
// templates -> settings -> navigation -> datasets
// No UI dependencies.

import { NAV_KEYS } from '../storage/db_nav.js';
import { readZipEntry } from './backup_v2_zip_store.js';
import { buildPlaceholderTemplate } from './backup_v2_confirm_core.js';

const dec = new TextDecoder();

function stage(name){
  return { name, ok:false, startedAt:new Date().toISOString(), finishedAt:null, info:null, error:null };
}
function finish(st, ok, info, error){
  st.ok = !!ok;
  st.finishedAt = new Date().toISOString();
  if(info !== undefined) st.info = info;
  if(error) st.error = String(error?.message || error);
  return st;
}

function safeJsonParse(u8, label){
  if(!u8) throw new Error(`ZIP: missing file ${label}`);
  try{ return JSON.parse(dec.decode(u8)); }
  catch(e){ throw new Error(`ZIP: JSON parse failed for ${label}`); }
}

function pickFirstString(v){
  if(typeof v === 'string') return v;
  if(Array.isArray(v)) return v.find(x=>typeof x==='string') || null;
  return null;
}

function normalizeManifest(manifest){
  const f = manifest?.files || {};
  const navPath = pickFirstString(f.navigation) || pickFirstString(f.nav) || 'spaces/navigation.json';
  const jtPath = pickFirstString(f.journalTemplates) || 'templates/journal_templates.json';
  const ttPath = pickFirstString(f.transferTemplates) || 'templates/transfer_templates.json';
  const ctPath = pickFirstString(f.columnTypes) || 'templates/column_types.json';
  const gsPath = pickFirstString(f.globalSettings) || 'settings/global_settings.json';
  const journalPaths = Array.isArray(f.journals) ? f.journals.filter(x=>typeof x==='string') : [];
  return { navPath, jtPath, ttPath, ctPath, gsPath, journalPaths };
}

async function applyJournalTemplates(storage, jtJson){
  const templates = Array.isArray(jtJson?.templates) ? jtJson.templates : [];
  const ids = templates.map(t=>String(t.id)).filter(Boolean);
  await storage.set('templates:index', ids);
  for(const t of templates){
    if(!t?.id) continue;
    await storage.set(`templates:tpl:${String(t.id)}`, t);
  }
  return { count: ids.length };
}

async function applyTransferTemplates(storage, ttJson){
  const templates = Array.isArray(ttJson?.templates) ? ttJson.templates : [];
  await storage.set('transfer:templates:v1', templates);
  return { count: templates.length };
}

async function applySettings(storage, gsJson){
  const coreSettings = gsJson?.coreSettings ?? {};
  const tableSettings = gsJson?.tableSettings ?? {};
  await storage.set(NAV_KEYS.coreSettings, coreSettings);

  // Table settings (global payload) - stored under the module key.
  // Per-journal overrides are stored inside journal files and will be applied in datasets stage.
  const TABLE_SETTINGS_KEY = '@sdo/module-table-renderer:settings';
  if(tableSettings && typeof tableSettings === 'object'){
    await storage.set(TABLE_SETTINGS_KEY, tableSettings);
  }
  return { coreSettingsKeys: Object.keys(coreSettings||{}).length, hasTableSettings: !!tableSettings };
}

async function applyNavigation(sdo, navJson){
  const payload = navJson?.navigation ?? navJson?.payload ?? null;
  if(!payload) throw new Error('navigation.json missing navigation payload');
  if(!sdo?.importNavigationState) throw new Error('sdo.importNavigationState is required');
  const rep = await sdo.importNavigationState(payload);
  return rep;
}

async function applyDatasetsAndPerJournalSettings(sdo, storage, journalPaths, ab){
  const tableStore = sdo?.api?.tableStore;
  if(!tableStore?.importTableData) throw new Error('sdo.api.tableStore.importTableData is required');

  const TABLE_SETTINGS_KEY = '@sdo/module-table-renderer:settings';
  const datasets = [];
  let perJournalSettingsApplied = 0;

  for(const p of journalPaths){
    const u8 = await readZipEntry(ab, p);
    const jdoc = safeJsonParse(u8, p);

    const meta = jdoc?.meta || {};
    const journalId = meta?.journalId || jdoc?.data?.dataset?.journalId;
    if(!journalId) continue;

    // Per-journal table renderer settings (optional)
    const per = jdoc?.settings?.tableRenderer ?? null;
    if(per && typeof per === 'object'){
      await storage.set(`${TABLE_SETTINGS_KEY}:${journalId}`, per);
      perJournalSettingsApplied++;
    }

    const ds = jdoc?.data?.dataset || null;
    const records = Array.isArray(ds?.records) ? ds.records : [];
    datasets.push({ journalId, schemaId: ds?.schemaId, records, meta: ds?.meta });
  }

  const bundle = { format: 'sdo-table-data', formatVersion: 1, exportedAt: new Date().toISOString(), datasets };
  const rep = await tableStore.importTableData(bundle, { mode: 'replace' });
  return { applied: rep?.applied === true, errors: rep?.errors || [], datasetsCount: datasets.length, perJournalSettingsApplied };
}

export async function applyImportZipV2(input, { sdo, storage, mode = 'replace', decisions = null } = {}){
  const report = {
    ok:false,
    mode,
    createdAt:new Date().toISOString(),
    stages:[],
    warnings:[],
    summary:{
      templates:0,
      transferTemplates:0,
      journals:0,
      journalsApplied:0,
      datasets:0,
      perJournalSettingsApplied:0
    }
  };

  if(!storage) throw new Error('applyImportZipV2: storage is required');
  if(!sdo) throw new Error('applyImportZipV2: sdo is required');

  // 0) read input
  const st0 = stage('0. read input');
  report.stages.push(st0);
  let ab;
  try{
    if(input instanceof ArrayBuffer) ab = input;
    else if(input && typeof input.arrayBuffer === 'function') ab = await input.arrayBuffer();
    else throw new Error('Expected File/Blob or ArrayBuffer');
    finish(st0, true, { bytes: ab.byteLength });
  }catch(e){
    finish(st0, false, null, e);
    return report;
  }

  // 1) read manifest
  const st1 = stage('1. read manifest');
  report.stages.push(st1);
  let manifest;
  try{
    let mu8 = await readZipEntry(ab, 'manifest.json');
    if(!mu8){
      const legacyU8 = await readZipEntry(ab, 'backup.json');
      if(legacyU8){
        throw new Error('Legacy backup v1 (backup.json) is not supported. Please use ZIP v2 export (manifest.json).');
      }
    }
    manifest = safeJsonParse(mu8, 'manifest.json');
    if(manifest?.format !== 'sdo-backup-zip' || manifest?.version !== 2){
      report.warnings.push({ code:'unsupported_manifest', message:'Unsupported manifest format/version' });
    }
    finish(st1, true, { createdAt: manifest?.createdAt || null });
  }catch(e){
    finish(st1, false, null, e);
    return report;
  }

  const paths = normalizeManifest(manifest);
  report.summary.journals = paths.journalPaths.length;

  const skipSet = new Set(Array.isArray(decisions?.skipJournalFiles) ? decisions.skipJournalFiles.map(String) : []);
  const journalPathsUsed = paths.journalPaths.filter(p=>!skipSet.has(String(p)));
  report.summary.journalsApplied = journalPathsUsed.length;

  // 2) templates
  const st2 = stage('2. apply templates');
  report.stages.push(st2);
  try{
    const jtJson = safeJsonParse(await readZipEntry(ab, paths.jtPath), paths.jtPath);
    const ttJson = safeJsonParse(await readZipEntry(ab, paths.ttPath), paths.ttPath);

    // C2.4: optional placeholder templates creation
    const createList = Array.isArray(decisions?.createTemplates) ? decisions.createTemplates : [];
    if(createList.length){
      const templates = Array.isArray(jtJson?.templates) ? jtJson.templates : (jtJson.templates = []);
      const existing = new Set(templates.map(t=>String(t?.id||'')).filter(Boolean));
      for(const it of createList){
        const tplId = String(it.templateId||'');
        if(!tplId || existing.has(tplId)) continue;
        templates.push(buildPlaceholderTemplate(tplId, it.columnsCount||1));
        existing.add(tplId);
        report.warnings.push({ code:'created_placeholder_template', message:`Created placeholder template: ${tplId}`, templateId: tplId });
      }
    }
    const r1 = await applyJournalTemplates(storage, jtJson);
    const r2 = await applyTransferTemplates(storage, ttJson);
    report.summary.templates = r1.count;
    report.summary.transferTemplates = r2.count;
    finish(st2, true, { journalTemplates: r1, transferTemplates: r2 });
  }catch(e){
    finish(st2, false, null, e);
    return report;
  }

  // 3) settings
  const st3 = stage('3. apply settings');
  report.stages.push(st3);
  try{
    const gsJson = safeJsonParse(await readZipEntry(ab, paths.gsPath), paths.gsPath);
    const r = await applySettings(storage, gsJson);
    finish(st3, true, r);
  }catch(e){
    finish(st3, false, null, e);
    return report;
  }

  // 4) navigation
  const st4 = stage('4. apply navigation');
  report.stages.push(st4);
  try{
    const navJson = safeJsonParse(await readZipEntry(ab, paths.navPath), paths.navPath);
    const r = await applyNavigation(sdo, navJson);
    finish(st4, true, r);
  }catch(e){
    finish(st4, false, null, e);
    return report;
  }

  // 5) datasets (+ per journal settings)
  const st5 = stage('5. apply datasets');
  report.stages.push(st5);
  try{
    const r = await applyDatasetsAndPerJournalSettings(sdo, storage, journalPathsUsed, ab);
    report.summary.datasets = r.datasetsCount;
    report.summary.perJournalSettingsApplied = r.perJournalSettingsApplied;
    if(r.errors?.length){
      report.warnings.push({ code:'tableStore_import_errors', message:'tableStore.importTableData returned errors', errors:r.errors });
    }
    finish(st5, r.applied, r);
  }catch(e){
    finish(st5, false, null, e);
    return report;
  }

  report.ok = report.stages.every(s=>s.ok) && !report.warnings.some(w=>w.code==='tableStore_import_errors');
  return report;
}
