/**
 * ui/backup/xlsx_screens.js
 *
 * Purpose:
 * - Provide SWS stack screens for Excel import/export parameters.
 * - Clicking Excel buttons opens parameter screens (stack), not immediate execution.
 *
 * Dependencies:
 * - SettingsWindow v2 (global window.SettingsWindow)
 * - SDO API: sdo.exportXlsx, sdo.importXlsx
 * - file picker helper: pickFile({accept})
 */

function requireSws() {
  const SW = window.SettingsWindow;
  if (!SW || typeof SW.push !== 'function' || typeof SW.pop !== 'function') {
    throw new Error('SettingsWindow is not available (SWS not initialized)');
  }
  return SW;
}

function safeToast(msg, type = 'info') {
  try { window.UI?.toast?.show?.(msg, { type }); } catch (_) {}
}

function normalizeInt(v) {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  const i = Math.floor(n);
  return i > 0 ? i : undefined;
}

function hr() {
  const d = document.createElement('div');
  d.style.height = '1px';
  d.style.background = 'rgba(0,0,0,0.08)';
  d.style.margin = '12px 0';
  return d;
}

function hint(ui, text) {
  const d = ui.el('div', 'sws-muted', text);
  d.style.marginTop = '6px';
  d.style.fontSize = '12px';
  return d;
}

function label(ui, text) {
  const d = ui.el('div', 'sws-control-label', text);
  d.style.marginTop = '10px';
  return d;
}

function plainButton(text, onClick) {
  const b = document.createElement('button');
  b.className = 'btn';
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

export function openXlsxExportScreen({ sdoInst, getActiveJournalId, getActiveJournalTitle } = {}) {
  const SW = requireSws();

  const journalId = getActiveJournalId?.();
  if (!journalId) return safeToast('Не обрано журнал (activeJournalId пустий)', 'warning');
  if (typeof sdoInst?.exportXlsx !== 'function') return safeToast('exportXlsx недоступний у цій збірці', 'error');

  let filename = `journal_${getActiveJournalTitle?.() || journalId}`;
  let subrowsMode = 'subrow_per_row';

  SW.push({
    title: 'Експорт Excel',
    subtitle: 'Поточний журнал → XLSX',
    saveLabel: 'Експорт',
    canSave: () => true,
    onSave: async () => {
      try {
        await sdoInst.exportXlsx({
          journalIds: [String(journalId)],
          filename: String(filename || '').trim() || `journal_${journalId}`,
          subrowsMode,
        });
        safeToast('Експорт XLSX виконано', 'success');
        SW.pop();
      } catch (e) {
        safeToast('Експорт XLSX помилка: ' + (e?.message || e), 'error');
      }
    },
    content: (ctx) => {
      const ui = ctx.ui;
      const wrap = ui.el('div', '');

      wrap.appendChild(ui.card({
        title: 'Параметри',
        description: 'Налаштування експорту Excel для поточного журналу.'
      }));

      wrap.appendChild(label(ui, 'Назва файлу (без .xlsx)'));
      wrap.appendChild(ui.input({
        value: filename,
        placeholder: 'journal_...',
        onChange: (v) => { filename = v; }
      }));

      wrap.appendChild(label(ui, 'Режим підстрок'));
      wrap.appendChild(ui.select({
        value: subrowsMode,
        options: [
          { value: 'subrow_per_row', label: 'Кожна підстрока як окремий рядок (legacy)' },
          { value: 'row_with_subrows', label: 'Одна строка + підстроки через \\n (new)' },
        ],
        onChange: (v) => { subrowsMode = v; }
      }));

      wrap.appendChild(hint(ui, 'Порада: якщо файл потрібен “як раніше” — обирай legacy.'));
      return wrap;
    }
  });
}

export function openXlsxImportScreen({ sdoInst, getActiveJournalId, getActiveJournalTitle, forceTableRerender, pickFile } = {}) {
  const SW = requireSws();

  const journalId = getActiveJournalId?.();
  if (!journalId) return safeToast('Не обрано журнал (activeJournalId пустий)', 'warning');
  if (typeof sdoInst?.importXlsx !== 'function') return safeToast('importXlsx недоступний у цій збірці', 'error');

  let file = null;
  let mode = 'merge';
  let subrowsMode = 'auto';
  let headerRow = '1';
  let fromRow = '';
  let toRow = '';
  let createMissingJournals = true;

  const computeCanSave = () => !!file;

  SW.push({
    title: 'Імпорт Excel',
    subtitle: `В ${getActiveJournalTitle?.() || journalId}`,
    saveLabel: 'Імпорт',
    canSave: () => computeCanSave(),
    onSave: async () => {
      if (!file) return safeToast('Оберіть .xlsx файл', 'warning');

      try {
        await sdoInst.importXlsx(file, {
          mode,
          subrowsMode,
          targetJournalId: String(journalId),
          createMissingJournals,
          headerRow: normalizeInt(headerRow),
          fromRow: normalizeInt(fromRow),
          toRow: normalizeInt(toRow),
        });
        try { await forceTableRerender?.(); } catch (_) {}
        safeToast('Імпорт XLSX виконано', 'success');
        SW.pop();
      } catch (e) {
        safeToast('Імпорт XLSX помилка: ' + (e?.message || e), 'error');
      }
    },
    content: (ctx) => {
      const ui = ctx.ui;
      const wrap = ui.el('div', '');

      const syncSave = () => {
        try { ctx.setSaveEnabled(!!computeCanSave()); } catch (_) {}
      };

      wrap.appendChild(ui.card({
        title: 'Файл',
        description: 'Обери Excel файл для імпорту.'
      }));

      const row = ui.el('div', '');
      row.style.display = 'flex';
      row.style.gap = '8px';
      row.style.alignItems = 'center';

      const fileLabel = ui.el('div', '');
      fileLabel.style.opacity = '0.85';
      fileLabel.style.flex = '1';
      fileLabel.textContent = file ? file.name : 'Файл не обрано';

      const pickBtn = plainButton('Обрати файл', async () => {
        const f = await pickFile?.({ accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        if (f) {
          file = f;
          fileLabel.textContent = f.name;
          syncSave();
        }
      });

      row.appendChild(pickBtn);
      row.appendChild(fileLabel);
      wrap.appendChild(row);

      wrap.appendChild(hr());

      wrap.appendChild(label(ui, 'Режим імпорту'));
      wrap.appendChild(ui.select({
        value: mode,
        options: [
          { value: 'merge', label: 'Merge (додати/оновити)' },
          { value: 'replace', label: 'Replace (замінити поточний журнал)' },
        ],
        onChange: (v) => { mode = v; }
      }));

      wrap.appendChild(label(ui, 'Режим підстрок'));
      wrap.appendChild(ui.select({
        value: subrowsMode,
        options: [
          { value: 'auto', label: 'Auto (по __SDO_META__ або legacy)' },
          { value: 'subrow_per_row', label: 'Legacy: кожен Excel рядок як строка/підстрока' },
          { value: 'row_with_subrows', label: 'New: підстроки як \\n у клітинках' },
        ],
        onChange: (v) => { subrowsMode = v; }
      }));

      wrap.appendChild(hr());

      wrap.appendChild(ui.card({
        title: 'Діапазон рядків',
        description: 'Опційно: header/from/to. Якщо пусто — імпорт усіх рядків.'
      }));

      wrap.appendChild(label(ui, 'Header row'));
      wrap.appendChild(ui.input({ value: headerRow, placeholder: '1', onChange: (v) => { headerRow = v; } }));

      wrap.appendChild(label(ui, 'From row'));
      wrap.appendChild(ui.input({ value: fromRow, placeholder: 'напр. 4', onChange: (v) => { fromRow = v; } }));

      wrap.appendChild(label(ui, 'To row'));
      wrap.appendChild(ui.input({ value: toRow, placeholder: 'напр. 232', onChange: (v) => { toRow = v; } }));

      wrap.appendChild(hr());

      // createMissingJournals toggle (kept for compatibility with importXlsx options)
      const tgl = ui.toggle({ value: createMissingJournals, onChange: (v) => { createMissingJournals = !!v; } });
      wrap.appendChild(ui.controlRow({
        label: 'createMissingJournals',
        help: 'Дозволити створення відсутніх журналів (опція імпорту)',
        controlEl: tgl
      }));

      wrap.appendChild(hint(ui, 'У цьому екрані імпорт йде в поточний журнал (targetJournalId).'));

      syncSave();
      return wrap;
    }
  });
}
