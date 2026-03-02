// Backup ZIP v2 - Import Pipeline (C2.1)
// Dry-run only: builds a stage-by-stage report of what would happen during import.
// No UI dependencies.

import { readZipEntry } from './backup_v2_zip_store.js';
import { dryRunImportZipV2 } from './backup_v2_import_core.js';

const dec = new TextDecoder();

function stage(name) {
  return { name, ok: false, startedAt: new Date().toISOString(), finishedAt: null, info: null, error: null };
}

function finish(st, ok, info, error) {
  st.ok = !!ok;
  st.finishedAt = new Date().toISOString();
  if (info !== undefined) st.info = info;
  if (error) st.error = String(error?.message || error);
  return st;
}

function safeJsonParse(u8, label, warnings) {
  if (!u8) {
    warnings.push({ code: 'missing_file', message: `ZIP: missing file ${label}`, path: label });
    return null;
  }
  try {
    return JSON.parse(dec.decode(u8));
  } catch (e) {
    warnings.push({ code: 'json_parse_failed', message: `ZIP: JSON parse failed for ${label}`, path: label });
    return null;
  }
}

function normalizeManifest(manifest) {
  const f = manifest?.files || {};
  return {
    navPath: f.navigation || f.nav || 'spaces/navigation.json',
    jtPath: f.journalTemplates || 'templates/journal_templates.json',
    ttPath: f.transferTemplates || 'templates/transfer_templates.json',
    ctPath: f.columnTypes || 'templates/column_types.json',
    gsPath: f.globalSettings || 'settings/global_settings.json',
    journalPaths: Array.isArray(f.journals) ? f.journals : [],
  };
}

function buildWipePreview() {
  // Preview only. Exact keys are implementation detail and will be finalized in C2.2.
  return {
    scope: 'replace',
    clears: [
      'navigation/spaces/journals',
      'journal_templates',
      'transfer_templates',
      'tableStore datasets',
      'settings (core + table settings)',
    ],
    note: 'Це preview для C2.2 — список буде деталізований до конкретних storage keys.'
  };
}

export async function runImportPipelineDryRunV2(input, { mode = 'replace', inspectLimit = 200 } = {}) {
  const report = {
    ok: false,
    mode,
    createdAt: new Date().toISOString(),
    stages: [],
    warnings: [],
    summary: {
      filesInZip: 0,
      journalsInZip: 0,
      templatesInZip: 0,
      transferTemplatesInZip: 0,
      rowsTotal: 0,
      missingTemplates: 0,
      columnsMismatch: 0,
      pathConflicts: 0,
    },
    wipePreview: mode === 'replace' ? buildWipePreview() : null,
    debug: {},
  };

  const st0 = stage('0. read input');
  report.stages.push(st0);
  let ab;
  try {
    if (input instanceof ArrayBuffer) ab = input;
    else if (input && typeof input.arrayBuffer === 'function') ab = await input.arrayBuffer();
    else throw new Error('Expected File/Blob or ArrayBuffer');
    finish(st0, true, { bytes: ab.byteLength });
  } catch (e) {
    finish(st0, false, null, e);
    return report;
  }

  const st1 = stage('1. validate manifest + referenced files');
  report.stages.push(st1);
  let base;
  try {
    base = await dryRunImportZipV2(ab);
    report.summary.filesInZip = base.filesInZipCount || (base.filesInZip ? base.filesInZip.length : 0);
    for (const w of (base.warnings || [])) report.warnings.push({ code: 'manifest_check', message: String(w) });
    if (Array.isArray(base.missingFiles) && base.missingFiles.length) {
      for (const p of base.missingFiles) report.warnings.push({ code: 'missing_file', message: `ZIP: missing expected file ${p}`, path: p });
    }
    finish(st1, !!base.ok, {
      manifestFound: !!base.manifestFound,
      missingFiles: base.missingFiles || [],
      filesInZipCount: report.summary.filesInZip,
    });
  } catch (e) {
    finish(st1, false, null, e);
    return report;
  }

  const manifest = base?.manifest || null;
  report.debug.manifest = manifest;
  if (!base?.manifestFound || !manifest) {
    report.ok = false;
    return report;
  }
  if (manifest?.format !== 'sdo-backup-zip' || manifest?.version !== 2) {
    report.warnings.push({ code: 'unsupported_manifest', message: 'Unsupported manifest format/version' });
  }

  const st2 = stage('2. read core json files (templates/settings/navigation)');
  report.stages.push(st2);
  const paths = normalizeManifest(manifest);
  try {
    const jtU8 = await readZipEntry(ab, paths.jtPath);
    const ttU8 = await readZipEntry(ab, paths.ttPath);
    const navU8 = await readZipEntry(ab, paths.navPath);
    const gsU8 = await readZipEntry(ab, paths.gsPath);

    const jtJson = safeJsonParse(jtU8, paths.jtPath, report.warnings);
    const ttJson = safeJsonParse(ttU8, paths.ttPath, report.warnings);
    const navJson = safeJsonParse(navU8, paths.navPath, report.warnings);
    const gsJson = safeJsonParse(gsU8, paths.gsPath, report.warnings);

    const templates = Array.isArray(jtJson?.templates) ? jtJson.templates : [];
    const transferTemplates = Array.isArray(ttJson?.templates) ? ttJson.templates : [];
    report.summary.templatesInZip = templates.length;
    report.summary.transferTemplatesInZip = transferTemplates.length;

    report.debug.coreFiles = {
      journalTemplates: { path: paths.jtPath, ok: !!jtJson, count: templates.length },
      transferTemplates: { path: paths.ttPath, ok: !!ttJson, count: transferTemplates.length },
      navigation: { path: paths.navPath, ok: !!navJson },
      settings: { path: paths.gsPath, ok: !!gsJson },
    };

    finish(st2, true, report.debug.coreFiles);
  } catch (e) {
    finish(st2, false, null, e);
    return report;
  }

  const st3 = stage('3. inspect journals (templates/columns/path)');
  report.stages.push(st3);

  try {
    const jtU8 = await readZipEntry(ab, paths.jtPath);
    const jtJson = safeJsonParse(jtU8, paths.jtPath, report.warnings) || { templates: [] };
    const templates = Array.isArray(jtJson?.templates) ? jtJson.templates : [];
    const templatesById = new Map();
    for (const t of templates) {
      const id = t?.id;
      if (id) templatesById.set(String(id), t);
    }

    const journalPaths = paths.journalPaths;
    report.summary.journalsInZip = journalPaths.length;

    const seenPaths = new Map();
    let rowsTotal = 0;
    let missingTemplates = 0;
    let columnsMismatch = 0;
    let pathConflicts = 0;
    const sample = [];

    for (const p of journalPaths.slice(0, inspectLimit)) {
      const u8 = await readZipEntry(ab, p);
      const jdoc = safeJsonParse(u8, p, report.warnings);
      if (!jdoc) continue;

      const meta = jdoc?.meta || jdoc?.data?.meta || {};
      const ds = jdoc?.data?.dataset || null;
      const tplId = meta?.templateId ? String(meta.templateId) : (ds?.templateId ? String(ds.templateId) : null);
      const tpl = tplId ? templatesById.get(tplId) : null;
      const colsInFile = Number(meta?.columnsCount || 0) || null;
      const tplCols = tpl && Array.isArray(tpl.columns) ? tpl.columns.length : null;

      if (tplId && !tpl) {
        missingTemplates++;
        report.warnings.push({ code: 'missing_template', message: `Missing journal template in ZIP: ${tplId}`, templateId: tplId, journalFile: p, fileColumns: colsInFile });
      }
      if (tplCols != null && colsInFile != null && colsInFile > 0 && tplCols !== colsInFile) {
        columnsMismatch++;
        report.warnings.push({
          code: 'columns_mismatch',
          message: `Columns mismatch for template ${tplId}: file=${colsInFile}, template=${tplCols}`,
          templateId: tplId,
          journalFile: p,
          fileColumns: colsInFile,
          templateColumns: tplCols
        });
      }

      const rows = Number(meta?.rowsCount || 0) || (Array.isArray(ds?.records) ? ds.records.length : 0);
      rowsTotal += rows;

      const path = (typeof meta?.path === 'string' ? meta.path : null) || null;
      if (path) {
        const prev = seenPaths.get(path);
        if (prev) {
          pathConflicts++;
          report.warnings.push({ code: 'path_conflict', message: `Path conflict: ${path}`, path, journalFile: p, otherJournalFile: prev });
        } else {
          seenPaths.set(path, p);
        }
      }

      if (sample.length < 10) sample.push({ file: p, templateId: tplId, path, rows, columns: colsInFile });
    }

    report.summary.rowsTotal = rowsTotal;
    report.summary.missingTemplates = missingTemplates;
    report.summary.columnsMismatch = columnsMismatch;
    report.summary.pathConflicts = pathConflicts;

    finish(st3, true, {
      journalsCount: report.summary.journalsInZip,
      inspected: Math.min(report.summary.journalsInZip, inspectLimit),
      sample,
      missingTemplates,
      columnsMismatch,
      pathConflicts,
      rowsTotal,
    });
  } catch (e) {
    finish(st3, false, null, e);
    return report;
  }

  report.ok = report.stages.every((s) => s.ok) && !report.warnings.some((w) => w.code === 'missing_file' || w.code === 'json_parse_failed');
  return report;
}
