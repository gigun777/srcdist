// Backup ZIP v2 - Export core (dry-run capable)
// This module MUST NOT depend on UI. It only reads state via sdo/api.

function isoSafeNow() {
  // Use ISO but filesystem-safe token
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function buildJournalPathIndex(journalMeta) {
  // Best-effort: keep whatever path/index model exists.
  // In current app, journal meta may include .path/.index/.levelIndex etc.
  if (!journalMeta || typeof journalMeta !== 'object') return '';
  if (typeof journalMeta.path === 'string' && journalMeta.path.trim()) return journalMeta.path.trim();
  if (typeof journalMeta.index === 'string' && journalMeta.index.trim()) return journalMeta.index.trim();
  if (typeof journalMeta.levelIndex === 'string' && journalMeta.levelIndex.trim()) return journalMeta.levelIndex.trim();
  return '';
}

export function buildExportPlanV2({ sdo, mode = 'full', nowIso } = {}) {
  if (!sdo || !sdo.api || typeof sdo.api.getState !== 'function') {
    throw new Error('buildExportPlanV2: sdo.api.getState() is required');
  }
  const createdAt = nowIso || new Date().toISOString();
  const tsToken = createdAt.replace(/[:.]/g, '-');

  const st = sdo.api.getState();
  const journals = Array.isArray(st?.journals) ? st.journals : [];

  const journalFiles = journals.map((j) => {
    const jid = String(j?.id || 'unknown');
    const path = buildJournalPathIndex(j);
    const safeId = jid.replace(/[^a-zA-Z0-9_-]/g, '_');
    const name = `journals/journal_${safeId}_${tsToken}.json`;
    return {
      file: name,
      journalId: jid,
      templateId: j?.templateId || null,
      templateName: j?.templateName || j?.template || null,
      path,
      createdAt
    };
  });

  const manifest = {
    format: 'sdo-backup-zip',
    version: 2,
    mode,
    createdAt,
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
      templates: [
        'templates/journal_templates.json',
        'templates/transfer_templates.json',
        'templates/column_types.json'
      ],
      settings: [
        'settings/global_settings.json'
      ],
      navigation: [
        'spaces/navigation.json'
      ],
      journals: journalFiles.map((x) => x.file)
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

  const archiveName = `backup_all_${tsToken}.zip`;

  return {
    ok: true,
    createdAt,
    archiveName,
    journalsCount: journalFiles.length,
    journalFiles,
    manifest
  };
}

export function makeDefaultArchiveNameV2() {
  return `backup_all_${isoSafeNow()}.zip`;
}
