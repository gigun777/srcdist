/**
 * backup/xlsx_actions.js
 *
 * Purpose:
 * - XLSX import/export actions for the Backup Manager.
 * - Keep UI wiring minimal; rely on SDO public API.
 *
 * Contracts (as in the working reference v2):
 * - export: sdo.exportXlsx({ journalIds:[id], filename })
 * - import:  sdo.importXlsx(file, { mode:'merge', targetJournalId:id })
 */

export async function exportCurrentJournalXlsx({ sdoInst, getActiveJournalId, getActiveJournalTitle } = {}) {
  const id = getActiveJournalId?.();
  if (!id) {
    window.UI?.toast?.show?.('Не обрано журнал (activeJournalId пустий)', { type: 'warning' });
    return;
  }

  if (typeof sdoInst?.exportXlsx !== 'function') {
    window.UI?.toast?.show?.('exportXlsx недоступний у цій збірці', { type: 'error' });
    return;
  }

  await sdoInst.exportXlsx({ journalIds: [id], filename: `journal_${getActiveJournalTitle?.() || id}` });
  window.UI?.toast?.show?.('Експорт XLSX виконано', { type: 'success' });
}

export async function importCurrentJournalXlsx({ sdoInst, getActiveJournalId, forceTableRerender, pickFile } = {}) {
  const id = getActiveJournalId?.();
  if (!id) {
    window.UI?.toast?.show?.('Не обрано журнал (activeJournalId пустий)', { type: 'warning' });
    return;
  }
  if (typeof sdoInst?.importXlsx !== 'function') {
    window.UI?.toast?.show?.('importXlsx недоступний у цій збірці', { type: 'error' });
    return;
  }

  const file = await pickFile?.({ accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  if (!file) return;

  let res;
  try {
    // Import into current journal regardless of sheet names.
    res = await sdoInst.importXlsx(file, { mode: 'merge', targetJournalId: id });
  } catch (e) {
    window.UI?.toast?.show?.('XLSX імпорт помилка: ' + (e?.message || e), { type: 'error' });
    return;
  }

  try { await forceTableRerender?.(); } catch (_) {}

  const cnt = (res?.sheets || []).reduce((a, x) => a + (x?.imported || 0), 0);
  window.UI?.toast?.show?.('Імпорт XLSX виконано' + (cnt ? (', рядків: ' + cnt) : ''), { type: 'success' });
}
