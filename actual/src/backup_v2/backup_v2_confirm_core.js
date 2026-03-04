// Backup ZIP v2 - Confirm UX core (C2.4)
// Provides helpers to resolve import warnings via confirm dialogs (or injected confirmFn).
// No direct UI dependencies beyond a confirmFn callback.

function defaultConfirmFn(msg){
  try{ return window.confirm(msg); }catch(_){ return false; }
}

export function mergeSimulatedIssues(baseReport, override){
  const out = JSON.parse(JSON.stringify(baseReport || {}));
  if(!override || typeof override !== 'object') return out;
  if(Array.isArray(override.warnings)) out.warnings = (out.warnings||[]).concat(override.warnings);
  if(override.summary && typeof override.summary === 'object'){
    out.summary = out.summary || {};
    Object.assign(out.summary, override.summary);
  }
  if(override.debug && typeof override.debug === 'object'){
    out.debug = out.debug || {};
    Object.assign(out.debug, override.debug);
  }
  return out;
}

export function buildPlaceholderTemplate(templateId, columnsCount){
  const n = Math.max(1, Number(columnsCount||1));
  const cols = [];
  for(let i=0;i<n;i++){
    cols.push({ key: `c${i+1}`, title: `Колонка ${i+1}`, type: 'text' });
  }
  return {
    id: String(templateId),
    title: `AUTO: ${String(templateId)}`,
    createdAt: new Date().toISOString(),
    columns: cols,
    __autoPlaceholder: true
  };
}

export async function resolveImportConfirmsV2(report, { confirmFn } = {}){
  const cf = typeof confirmFn === 'function' ? confirmFn : defaultConfirmFn;

  const decisions = {
    createTemplates: new Map(), // templateId -> columnsCount
    skipJournalFiles: new Set(),
    pathConflicts: new Map(), // path -> 'merge'|'replace'
    proceeded: true
  };

  const warnings = Array.isArray(report?.warnings) ? report.warnings : [];
  for(const w of warnings){
    const code = w?.code;
    if(code === 'missing_template'){
      const tplId = String(w.templateId || '');
      const cols = Number(w.fileColumns || w.columns || w.fileColumnsCount || 0) || null;
      const msg = `У ZIP відсутній шаблон журналу: ${tplId}.\nСтворити placeholder-шаблон і продовжити?\n(OK=створити, Cancel=пропустити відповідний журнал)`;
      const ok = cf(msg);
      if(ok){
        decisions.createTemplates.set(tplId, cols || 1);
      }else{
        if(w.journalFile) decisions.skipJournalFiles.add(String(w.journalFile));
      }
    }

    if(code === 'columns_mismatch'){
      const tplId = String(w.templateId || '');
      const jf = String(w.journalFile || '');
      const msg = `Невідповідність колонок для шаблону ${tplId}.\nУ файлі: ${w.fileColumns}, у шаблоні: ${w.templateColumns}.\nПродовжити імпорт цього журналу?\n(OK=продовжити, Cancel=пропустити цей журнал)`;
      const ok = cf(msg);
      if(!ok){
        if(jf) decisions.skipJournalFiles.add(jf);
      }
    }

    if(code === 'path_conflict'){
      const path = String(w.path || '');
      const msg = `Конфлікт шляху: ${path}.\nOK = MERGE (залишити існуюче, додати дані обережно)\nCancel = REPLACE (перезаписати шлях)`;
      const ok = cf(msg);
      decisions.pathConflicts.set(path, ok ? 'merge' : 'replace');
    }
  }

  // Attach decisions into report
  report.decisions = {
    createTemplates: Array.from(decisions.createTemplates.entries()).map(([templateId, columnsCount])=>({ templateId, columnsCount })),
    skipJournalFiles: Array.from(decisions.skipJournalFiles),
    pathConflicts: Array.from(decisions.pathConflicts.entries()).map(([path, action])=>({ path, action }))
  };
  return decisions;
}
