/**
 * backup/backup_manager.js
 *
 * Purpose:
 * - Provide the Backup / Import / Export window as a separate module.
 * - Open through the single SWS modal system (SettingsWindow v2) using UI.swsAdapter.
 *
 * Public API:
 *   openBackupManager({ sdo })
 *
 * Notes:
 * - Runtime uses /dist. This file has a matching copy under /dist/ui/backup/.
 * - Do NOT place stray statements (like `steps.push`) outside function scopes.
 */

import { createZipTools } from './zip_tools.js';
import { downloadBlob, pickFile } from './file_io.js';
import { exportAllZipV2, importAllZipV2 } from './zip_v2_actions.js';
import { openXlsxExportScreen, openXlsxImportScreen } from './xlsx_screens.js';

export function openBackupManager({ sdo } = {}) {
  const sdoInst = sdo || window.sdo;
  if (!sdoInst) {
    window.UI?.toast?.show?.('SDO instance not found (window.sdo)', { type: 'error' });
    return null;
  }

  const { enc, dec, zipStore, zipExtractStoreOnly, zipReadFile } = createZipTools();

  const getActiveJournalId = () => {
    try {
      return sdoInst.getState?.().activeJournalId || null;
    } catch {
      return null;
    }
  };

  const getActiveJournalTitle = () => {
    const st = sdoInst.getState?.() || {};
    const id = st.activeJournalId;
    const j = (st.journals || []).find((x) => x && x.id === id) || null;
    return j?.title || j?.name || (id ? String(id) : '—');
  };

  async function forceTableRerender() {
    if (typeof sdoInst?.commit !== 'function') return;
    await sdoInst.commit((next) => {
      next.activeSpaceId = next.activeSpaceId;
      next.activeJournalId = next.activeJournalId;
    }, []);
  }

  function openImportDebugModal({ title, steps, rawErrors, meta }) {
    const UI = window.UI;
    if (!UI?.modal?.open) return;

    const wrap = document.createElement('div');
    wrap.className = 'sdo-import-debug';
    wrap.style.maxWidth = '720px';
    wrap.style.fontSize = '14px';
    wrap.style.lineHeight = '1.35';

    const h3 = document.createElement('h3');
    h3.textContent = title || 'Import debug';
    h3.style.margin = '0 0 10px 0';

    const ul = document.createElement('ul');
    ul.style.margin = '0 0 10px 18px';
    ul.style.padding = '0';

    (steps || []).forEach((s) => {
      const li = document.createElement('li');
      li.textContent = `${s.ok ? '✅' : '❌'} ${s.stage}${s.msg ? `: ${s.msg}` : ''}`;
      ul.appendChild(li);
    });

    const details = document.createElement('details');
    details.style.marginTop = '8px';
    const summary = document.createElement('summary');
    summary.textContent = 'Деталі (errors/meta)';
    summary.style.cursor = 'pointer';

    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.wordBreak = 'break-word';
    pre.style.background = '#1111';
    pre.style.padding = '8px';
    pre.style.borderRadius = '8px';
    pre.textContent = JSON.stringify({ rawErrors, meta }, null, 2);

    details.appendChild(summary);
    details.appendChild(pre);

    wrap.appendChild(h3);
    wrap.appendChild(ul);
    wrap.appendChild(details);

    UI.modal.open({ title: 'JSON Import', contentNode: wrap, closeOnOverlay: true });
  }

  async function exportCurrentJournalJson() {
    const id = getActiveJournalId();
    if (!id) return window.UI?.toast?.show?.('Не обрано журнал (activeJournalId пустий)', { type: 'warning' });
    const bundle = await sdoInst.api.tableStore.exportTableData({ journalIds: [id], includeFormatting: true });
    const json = JSON.stringify(bundle, null, 2);
    const fname = `journal_${getActiveJournalTitle()}_${new Date().toISOString().replace(/[:\.]/g, '-')}.json`;
    downloadBlob(new Blob([json], { type: 'application/json' }), fname);
    window.UI?.toast?.show?.('Експорт JSON виконано', { type: 'success' });
  }

  async function importCurrentJournalJson() {
    const steps = [];
    try {
      const id = getActiveJournalId();
      if (!id) {
        steps.push({ stage: 'getActiveJournalId', ok: false, msg: 'activeJournalId пустий' });
        openImportDebugModal({ title: 'Імпорт JSON (таблиця)', steps });
        return window.UI?.toast?.show?.('Не обрано журнал (activeJournalId пустий)', { type: 'warning' });
      }
      steps.push({ stage: 'getActiveJournalId', ok: true, msg: id });

      const file = await pickFile({ accept: 'application/json,.json' });
      if (!file) {
        steps.push({ stage: 'pickFile', ok: false, msg: 'Файл не обрано' });
        openImportDebugModal({ title: 'Імпорт JSON (таблиця)', steps });
        return;
      }
      steps.push({ stage: 'pickFile', ok: true, msg: file.name });

      const text = await file.text();
      steps.push({ stage: 'readFile', ok: true, msg: `${text.length} bytes` });

      let parsed;
      try {
        parsed = JSON.parse(text);
        steps.push({ stage: 'JSON.parse', ok: true });
      } catch (_) {
        steps.push({ stage: 'JSON.parse', ok: false, msg: 'JSON пошкоджений' });
        openImportDebugModal({ title: 'Імпорт JSON (таблиця)', steps, meta: { file: file.name } });
        return window.UI?.toast?.show?.('JSON пошкоджений', { type: 'error' });
      }

      const ds0 = parsed?.datasets?.[0] || null;
      const normalized = (parsed?.format === 'sdo-table-data') ? parsed : null;
      let bundle = normalized;
      if (!bundle && ds0) {
        bundle = { format: 'sdo-table-data', formatVersion: 1, exportedAt: new Date().toISOString(), datasets: [ds0] };
      }

      if (!bundle || !Array.isArray(bundle.datasets) || bundle.datasets.length === 0) {
        steps.push({ stage: 'normalize', ok: false, msg: 'Невідомий формат JSON для таблиці' });
        openImportDebugModal({
          title: 'Імпорт JSON (таблиця)',
          steps,
          meta: { detectedFormat: parsed?.format, hasDatasets: Array.isArray(parsed?.datasets), file: file.name }
        });
        window.UI?.toast?.show?.('Невідомий формат JSON для таблиці', { type: 'error' });
        return;
      }
      steps.push({ stage: 'normalize', ok: true, msg: `datasets=${bundle.datasets.length}` });

      bundle.datasets = bundle.datasets.map((d) => ({ ...d, journalId: id }));
      steps.push({ stage: 'rewriteJournalId', ok: true });

      let mode = 'replace';
      if (typeof window.UI?.confirm === 'function') {
        const okReplace = await window.UI.confirm(
          'Імпорт JSON',
          'Режим: ОК = replace (повністю замінити), Скасувати = merge (додати/оновити).',
          { okText: 'Replace', cancelText: 'Merge' }
        );
        mode = okReplace ? 'replace' : 'merge';
      }
      steps.push({ stage: 'chooseMode', ok: true, msg: mode });

      const res = await sdoInst.api.tableStore.importTableData(bundle, { mode });
      if (!res?.applied) {
        steps.push({ stage: 'importTableData', ok: false, msg: (res?.errors || []).join(', ') || 'applied=false' });
        openImportDebugModal({ title: 'Імпорт JSON (таблиця)', steps, rawErrors: res?.errors, meta: { mode } });
        window.UI?.toast?.show?.('Імпорт не застосовано (помилки)', { type: 'error' });
        return;
      }

      await forceTableRerender();
      window.UI?.toast?.show?.('Імпорт JSON виконано', { type: 'success' });
    } catch (e) {
      const msg = (e && (e.message || e.toString)) ? (e.message || String(e)) : String(e);
      steps.push({ stage: 'exception', ok: false, msg });
      openImportDebugModal({ title: 'Імпорт JSON (таблиця)', steps, rawErrors: [msg] });
      window.UI?.toast?.show?.(`Імпорт JSON помилка: ${msg}`, { type: 'error' });
    }
  }

  function onOpenXlsxExport() {
    return openXlsxExportScreen({
      sdoInst,
      getActiveJournalId,
      getActiveJournalTitle,
    });
  }

  function onOpenXlsxImport() {
    return openXlsxImportScreen({
      sdoInst,
      getActiveJournalId,
      getActiveJournalTitle,
      forceTableRerender,
      pickFile,
    });
  }

  async function exportAllZip() {
    return exportAllZipV2({ sdoInst, zipTools: { enc, zipStore }, downloadBlob });
  }

  async function importAllZip() {
    return importAllZipV2({ sdoInst, zipTools: { dec, zipExtractStoreOnly, zipReadFile }, pickFile, forceTableRerender });
  }

  // ---- UI ----
  const body = document.createElement('div');
  body.className = 'ui-modal-content';

  const title = document.createElement('div');
  title.style.marginBottom = '8px';
  title.innerHTML = `<b>Backup / Import / Export</b><div style="opacity:.8;font-size:.9em">Поточний журнал: ${getActiveJournalTitle()}</div>`;

  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = '1fr 1fr';
  grid.style.gap = '8px';

  const mkBtn = (label, fn, primary=false) => {
    const b = document.createElement('button');
    b.className = primary ? 'btn btn-primary' : 'btn';
    b.textContent = label;
    b.onclick = async () => {
      b.disabled = true;
      try {
        await fn();
      } catch (e) {
        console.error('[Backup modal action failed]', label, e);
        const msg = (e && (e.message || e.toString)) ? (e.message || String(e)) : String(e);
        window.UI?.toast?.show?.(`${label}: помилка: ${msg}`, { type: 'error' });
        try { window.UI?.modal?.alert?.(`${label}:\n${msg}`, { title: 'Помилка' }); } catch (_) {}
      } finally {
        b.disabled = false;
      }
    };
    return b;
  };

  grid.append(
    mkBtn('Імпорт JSON (поточний)', importCurrentJournalJson, true),
    mkBtn('Експорт JSON (поточний)', exportCurrentJournalJson),
      mkBtn('Імпорт Excel (поточний)', onOpenXlsxImport, true),
      mkBtn('Експорт Excel (поточний)', onOpenXlsxExport)
  );

  const hr = document.createElement('div');
  hr.style.height = '1px';
  hr.style.background = 'rgba(0,0,0,0.08)';
  hr.style.margin = '12px 0';

  const zipRow = document.createElement('div');
  zipRow.style.display = 'grid';
  zipRow.style.gridTemplateColumns = '1fr 1fr';
  zipRow.style.gap = '8px';
  zipRow.append(
    mkBtn('Імпорт всього ZIP', importAllZip, true),
    mkBtn('Експорт всього ZIP', exportAllZip)
  );

  body.append(title, grid, hr, zipRow);

  const adapter = window.UI?.swsAdapter || window.SWSAdapter || null;
  const legacyPayload = {
    title: 'Backup',
    contentNode: body,
    closeOnOverlay: true,
  };

  // SWS v2 channel (single modal system)
  if (adapter && typeof adapter.open === 'function') {
    const adapterResult = adapter.open({
      screenId: 'backup.manager',
      swsOpen: () => {
        const SW = window.SettingsWindow;
        if (!SW || typeof SW.openCustomRoot !== 'function' || typeof SW.push !== 'function') {
          throw new Error('Backup SWS dependencies are unavailable');
        }
        SW.openCustomRoot(() => SW.push({
          title: 'Backup',
          subtitle: `Поточний журнал: ${getActiveJournalTitle()}`,
          content: body,
          saveLabel: 'OK',
          canSave: () => false,
        }));
      },
      legacy: legacyPayload,
    });
    if (adapterResult?.ok) return adapterResult;
  }

  // Legacy fallback (should not be needed if SWS is initialized)
  window.UI?.modal?.open?.(legacyPayload);
  return null;
}
