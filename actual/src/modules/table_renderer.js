import { createTableEngine } from './table_engine.js';
import { formatCell as defaultFormatCell, parseInput as defaultParseInput } from './table_formatter.js';
import { runDatasetTx } from "../table/core/dataset_tx/feature.js";
import { pushTableEvent } from "../table/core/event_log.js";

function cellKey(rowId, colKey) {
  return `${rowId}:${colKey}`;
}

export function getRenderableCells(row, columns, cellSpanMap) {
  const cells = [];
  for (const column of columns) {
    const key = cellKey(row.rowId, column.columnKey);
    const span = cellSpanMap.get(key);
    if (span?.coveredBy) continue;
    cells.push({
      colKey: column.columnKey,
      span: span ?? { rowSpan: 1, colSpan: 1 }
    });
  }
  return cells;
}

function normalizeDataset(input = {}) {
  return {
    records: Array.isArray(input.records) ? input.records : [],
    merges: Array.isArray(input.merges) ? input.merges : []
  };
}

function updateDatasetWithPatch(dataset, patch) {
  const kind = patch?.type || null;

  // Current renderer fallback uses a compact cell-patch shape:
  //   { type:'cell', rowId, colKey, value }
  if (kind === 'cell') {
    const rid = patch.rowId ?? patch.recordId;
    const colKey = patch.colKey;
    if (!rid || !colKey) return dataset;
    return {
      ...dataset,
      records: (dataset.records ?? []).map((record) => {
        if (String(record.id) !== String(rid)) return record;
        return {
          ...record,
          cells: { ...(record.cells ?? {}), [colKey]: patch.value }
        };
      })
    };
  }

  // Legacy patch shape (kept for compatibility):
  //   { recordId, cellsPatch, fmtPatch }
  const recordId = patch?.recordId;
  if (!recordId) return dataset;

  return {
    ...dataset,
    records: (dataset.records ?? []).map((record) => {
      if (String(record.id) !== String(recordId)) return record;
      return {
        ...record,
        cells: { ...(record.cells ?? {}), ...(patch.cellsPatch ?? {}) },
        fmt: { ...(record.fmt ?? {}), ...(patch.fmtPatch ?? {}) }
      };
    })
  };
}

function applyColumnSettings(settings, nextColumns) {
  return {
    ...settings,
    columns: {
      ...(settings.columns ?? {}),
      ...nextColumns
    }
  };
}

function buildHeaderTitle(runtime) {
  const state = runtime?.sdo?.getState?.() ?? {};
  const journal = (state.journals ?? []).find((j) => j.id === state.activeJournalId);
  return journal ? `Таблиця: ${journal.title}` : 'Таблиця';
}

function parseSubrowId(subrowId) {
  const m = typeof subrowId === 'string' ? subrowId.match(/^(.*)::sub::(\d+)$/) : null;
  if (!m) return null;
  return { ownerId: m[1], index: Number(m[2]) };
}

function isSubrowsEnabled(settings, colKey) {
  // Enabled by default for all columns unless explicitly set to false.
  return settings?.subrows?.columnsSubrowsEnabled?.[colKey] !== false;
}

function createSubrowsUiAdapter({ engine, dataset }) {
  async function askCellAction() {
    if (!window.UI?.modal?.open) {
      const add = window.confirm('Додати нову підстроку для цієї клітинки? Натисніть Скасувати для редагування існуючої.');
      return add ? 'addSubrow' : 'editExisting';
    }

    return new Promise((resolve) => {
      const box = document.createElement('div');
      box.innerHTML = '<p style="margin:0 0 12px;">Оберіть дію для підстрок у цій клітинці.</p>';
      const controls = document.createElement('div');
      controls.style.display = 'flex';
      controls.style.gap = '8px';
      controls.style.justifyContent = 'flex-end';
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Редагувати існуючу';
      const addBtn = document.createElement('button');
      addBtn.textContent = 'Додати підстроку';
      controls.append(editBtn, addBtn);
      box.append(controls);

      const modalId = window.UI.modal.open({ title: 'Підстроки', contentNode: box, closeOnOverlay: true });
      const close = (action) => {
        window.UI.modal.close(modalId);
        resolve(action);
      };
      editBtn.addEventListener('click', () => close('editExisting'));
      addBtn.addEventListener('click', () => close('addSubrow'));
    });
  }

  async function pickSubrow(opts) {
    const ids = (opts?.items ?? []).map((i) => i.id);
    if (ids.length === 0) return null;

    const labelOf = (id) => {
      try {
        return engine?.getSubrowLabel ? engine.getSubrowLabel(id, dataset) : id;
      } catch {
        return id;
      }
    };

    if (!window.UI?.modal?.open) {
      const choices = ids.map((id) => `${id} (${labelOf(id)})`).join('\n');
      const chosen = window.prompt(`Оберіть підстроку:\n${choices}`, ids[0]);
      return ids.includes(chosen) ? chosen : null;
    }

    return new Promise((resolve) => {
      const box = document.createElement('div');
      const hint = document.createElement('p');
      hint.textContent = 'Оберіть підстроку для редагування:';
      hint.style.margin = '0 0 12px';
      box.append(hint);

      const list = document.createElement('div');
      list.style.display = 'grid';
      list.style.gap = '8px';
      ids.forEach((id) => {
        const btn = document.createElement('button');
        btn.textContent = labelOf(id);
        btn.addEventListener('click', () => {
          window.UI.modal.close(modalId);
          resolve(id);
        });
        list.append(btn);
      });
      box.append(list);
      const modalId = window.UI.modal.open({ title: 'Підстроки', contentNode: box, closeOnOverlay: true });
    });
  }

  return {
    askCellAction,
    pickSubrow,
    toast(msg) {
      if (window.UI?.toast?.show) window.UI.toast.show(msg);
    }
  };
}

export function createTableRendererModule(opts = {}) {
  const {
    // legacy/fallback single-dataset key (used only when tableStore module is not present)
    datasetKey = '@sdo/module-table-renderer:dataset',
    settingsKey = '@sdo/module-table-renderer:settings'
  } = opts;
  const initialSettings = {
    columns: { order: null, visibility: {}, widths: {} },
    sort: null,
    filter: { global: '' },
    expandedRowIds: [],
    selectedRowIds: [],
    subrows: { columnsSubrowsEnabled: {} }
  };

  let engine = null;
  let currentSchemaId = null;
  let selectionMode = false;

  function schemaFromTemplate(template) {
    const cols = Array.isArray(template?.columns) ? template.columns : [];
    const fieldType = (dt) => {
      if (dt === 'date') return 'date';
      if (dt === 'number') return 'number';
      if (dt === 'boolean') return 'bool';
      if (dt === 'text') return 'text';
      if (dt === 'any') return 'text';
      return 'text';
    };
    return {
      id: template?.id ? `tpl:${template.id}` : 'tpl:__none__',
      fields: cols.map((c) => ({ key: c.key, label: c.label, type: fieldType(c?.dataType) }))
    };
  }

  function getCellComparable(raw, fieldType) {
    if (raw == null) return null;
    if (fieldType === 'number') {
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    if (fieldType === 'date') {
      const d = raw instanceof Date ? raw : new Date(String(raw));
      const t = d.getTime();
      return Number.isFinite(t) ? t : null;
    }
    if (fieldType === 'boolean' || fieldType === 'bool') {
      if (typeof raw === 'boolean') return raw ? 1 : 0;
      const s = String(raw).trim().toLowerCase();
      if (s === '1' || s === 'true' || s === '+' || s === 'так' || s === 'yes') return 1;
      if (s === '0' || s === 'false' || s === '-' || s === 'ні' || s === 'no') return 0;
      return null;
    }
    return String(raw);
  }

  function applySortToRows(rows, sort, schema, dataset) {
    if (!sort?.colKey || !sort?.dir) return rows;
    const colKey = sort.colKey;
    const dir = sort.dir;
    const field = (schema?.fields || []).find((f) => f.key === colKey) || { type: 'text' };
    const recById = new Map((dataset?.records || []).map((r) => [r.id, r]));

    const groups = [];
    let i = 0;
    while (i < rows.length) {
      const owner = rows[i];
      const grp = [owner];
      i += 1;
      while (i < rows.length) {
        const r = rows[i];
        if (r?.parentId === owner?.rowId) {
          grp.push(r);
          i += 1;
        } else {
          break;
        }
      }
      groups.push(grp);
    }

    const cmp = async (aGrp, bGrp) => {
      const aOwner = aGrp[0];
      const bOwner = bGrp[0];
      const aRec = recById.get(aOwner.rowId) || aOwner.record;
      const bRec = recById.get(bOwner.rowId) || bOwner.record;
      const aVal = getCellComparable(aRec?.cells?.[colKey], field.type);
      const bVal = getCellComparable(bRec?.cells?.[colKey], field.type);
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      let res = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') res = aVal - bVal;
      else res = String(aVal).localeCompare(String(bVal), 'uk', { sensitivity: 'base' });
      return dir === 'asc' ? res : -res;
    };

    groups.sort(cmp);
    return groups.flat();
  }

  async function resolveSchema(runtime) {
    const state = runtime?.api?.getState ? runtime.api.getState() : (runtime?.sdo?.api?.getState ? runtime.sdo.api.getState() : null);
    const journalId = state?.activeJournalId;
    // Auto-select: if no active journal but there are journals in the active space, pick the first root journal.
    if (!journalId && state?.activeSpaceId && Array.isArray(state?.journals) && state.journals.length) {
      const candidate = state.journals.find((j) => j.spaceId === state.activeSpaceId && j.parentId === state.activeSpaceId);
      if (candidate && typeof runtime?.sdo?.commit === 'function') {
        await runtime.sdo.commit((next) => { next.activeJournalId = candidate.id; }, ['nav_last_loc_v2']);
        // refresh state snapshot after commit
        const st2 = runtime?.api?.getState ? runtime.api.getState() : (runtime?.sdo?.api?.getState ? runtime.sdo.api.getState() : null);
        const j2 = (st2?.journals ?? []).find((j) => j.id === st2?.activeJournalId);
        // continue resolving with the updated journal/state
        return await (async () => {
          const journal = j2;
          let templateId = journal?.templateId;
          const jt = runtime?.api?.journalTemplates || runtime?.sdo?.api?.journalTemplates || runtime?.sdo?.journalTemplates;
          if (!jt?.getTemplate) return { schema: { id: 'tpl:__none__', fields: [] }, journal, state: st2 };

          if (journal && !templateId) {
            const list = typeof jt.listTemplateEntities === 'function' ? await jt.listTemplateEntities() : [];
            const defaultTplId = (list.find((t) => t.id === 'test')?.id) || (list[0]?.id) || null;
            if (defaultTplId) {
              templateId = defaultTplId;
              await runtime.sdo.commit((next) => {
                next.journals = (next.journals ?? []).map((j) => (j.id === journal.id ? { ...j, templateId: defaultTplId } : j));
              }, ['journals_nodes_v2']);
            }
          }

          if (!templateId) return { schema: { id: 'tpl:__none__', fields: [] }, journal, state: st2 };
          const template = await jt.getTemplate(templateId);
          return { schema: schemaFromTemplate(template), journal, state: st2 };
        })();
      }
    }

    const journal = (state?.journals ?? []).find((j) => j.id === journalId);
    let templateId = journal?.templateId;

    const jt = runtime?.api?.journalTemplates || runtime?.sdo?.api?.journalTemplates || runtime?.sdo?.journalTemplates;
    if (!jt?.getTemplate) return { schema: { id: 'tpl:__none__', fields: [] }, journal, state };

    // Auto-heal: if journal exists but has no templateId, assign default (prefer "test")
    if (journal && !templateId) {
      const list = typeof jt.listTemplateEntities === 'function' ? await jt.listTemplateEntities() : [];
      const defaultTplId = (list.find((t) => t.id === 'test')?.id) || (list[0]?.id) || null;
      if (defaultTplId) {
        templateId = defaultTplId;
        // Persist into navigation state (best-effort)
        if (typeof runtime?.sdo?.commit === 'function') {
          await runtime.sdo.commit((next) => {
            next.journals = (next.journals ?? []).map((j) => (j.id === journal.id ? { ...j, templateId: defaultTplId } : j));
          }, ['journals_nodes_v2']);
        }
      }
    }

    if (!templateId) return { schema: { id: 'tpl:__none__', fields: [] }, journal, state };

    const template = await jt.getTemplate(templateId);
    return { schema: schemaFromTemplate(template), journal, state };
  }


  function tplSettingsKey(templateId) {
    return templateId ? `${settingsKey}:tpl:${templateId}` : null;
  }

  async function loadSettings(storage, templateId) {
    const globalSettings = { ...((await storage.get(settingsKey)) ?? {}) };
    const merged = { ...initialSettings, ...globalSettings };

    // Subrows enable/disable must be template-scoped (not global across all journals).
    // We store template-specific overrides under `${settingsKey}:tpl:<templateId>`.
    const tKey = tplSettingsKey(templateId);
    if (tKey) {
      const tplPart = (await storage.get(tKey)) ?? null;
      const tplMap = tplPart?.subrows?.columnsSubrowsEnabled ?? null;

      if (tplMap && typeof tplMap === 'object') {
        merged.subrows = { ...(merged.subrows ?? {}), columnsSubrowsEnabled: { ...(tplMap ?? {}) } };
      } else {
        // Migration: if template-scoped settings don't exist yet, seed them from the current global map.
        const legacyMap = merged.subrows?.columnsSubrowsEnabled;
        if (legacyMap && typeof legacyMap === 'object') {
          await storage.set(tKey, { subrows: { columnsSubrowsEnabled: { ...legacyMap } } });
        } else {
          await storage.set(tKey, { subrows: { columnsSubrowsEnabled: {} } });
        }
      }
    }
    return merged;
  }

  async function saveSettings(storage, templateId, settings) {
    // Persist non-template-scoped settings globally.
    // IMPORTANT: do not persist subrows.columnsSubrowsEnabled globally, otherwise it leaks across templates.
    const nextGlobal = { ...settings };
    if (nextGlobal?.subrows && typeof nextGlobal.subrows === 'object') {
      nextGlobal.subrows = { ...nextGlobal.subrows };
      delete nextGlobal.subrows.columnsSubrowsEnabled;
    }
    await storage.set(settingsKey, nextGlobal);

    // Persist template-scoped subrows map.
    const tKey = tplSettingsKey(templateId);
    if (tKey) {
      const map = settings?.subrows?.columnsSubrowsEnabled ?? {};
      await storage.set(tKey, { subrows: { columnsSubrowsEnabled: { ...map } } });
    }
  }

  async function loadDataset(runtime, storage, journalId) {
    const store = runtime?.api?.tableStore || runtime?.sdo?.api?.tableStore;
    if (journalId) {
      runtime.__datasetCache = runtime.__datasetCache || {};
      const cached = runtime.__datasetCache[journalId];
      if (cached && Array.isArray(cached.records)) return cached;

      // Prefer partial-load APIs if available.
      if (store?.getDatasetHeader && store?.getRecordsByRange) {
        const header = await store.getDatasetHeader(journalId);
        const INITIAL = Number(runtime?.config?.initialRowsLimit ?? 100);
        const first = await store.getRecordsByRange(journalId, 0, INITIAL);
        const ds = normalizeDataset({ records: first.records ?? [], merges: [] });
        ds.__lazy = {
          journalId,
          total: Number(header?.total ?? 0),
          cursor: Math.min(INITIAL, Number(header?.total ?? 0)),
          chunk: Number(runtime?.config?.lazyChunkSize ?? 200),
          fullLoaded: Math.min(INITIAL, Number(header?.total ?? 0)) >= Number(header?.total ?? 0)
        };
        runtime.__datasetCache[journalId] = ds;
        return ds;
      }

      // Fallback: full load
      if (store?.getDataset) {
        const full = await store.getDataset(journalId);
        const ds = normalizeDataset({ records: full.records ?? [], merges: full.merges ?? [] });
        runtime.__datasetCache[journalId] = ds;
        return ds;
      }
    }
    // IndexedDB-версія: єдине джерело правди для рядків — tableStore (per-journal).
    // Fallback datasetKey створював "2 джерела" і ламав ZIP/JSON backup/restore.
    console.warn('[table_renderer] tableStore/journalId missing: fallback dataset storage is disabled');
    return normalizeDataset({ records: [], merges: [] });
  }

  async function saveDataset(runtime, storage, journalId, dataset) {
    const store = runtime?.api?.tableStore || runtime?.sdo?.api?.tableStore;
    if (store?.upsertRecords && journalId) {
      // If dataset was loaded partially, ensure we have all rows before persisting with replace.
      if (dataset && dataset.__lazy && !dataset.__lazy.fullLoaded && store?.getRecordsByRange) {
        const total = Number(dataset.__lazy.total ?? 0);
        const chunk = Number(dataset.__lazy.chunk ?? 200);
        while (Number(dataset.__lazy.cursor ?? 0) < total) {
          const start = Number(dataset.__lazy.cursor ?? 0);
          const part = await store.getRecordsByRange(journalId, start, chunk);
          for (const r of (part.records ?? [])) dataset.records.push(r);
          dataset.__lazy.cursor = Math.min(total, start + chunk);
          // Give UI a chance to breathe on huge journals
          if (dataset.__lazy.cursor < total) await new Promise((r) => setTimeout(r, 0));
        }
        dataset.__lazy.fullLoaded = true;
      }
      // Replace records for now (renderer owns ordering)
      await store.upsertRecords(journalId, dataset.records ?? [], 'replace');
      return;
    }
    console.error('[table_renderer] tableStore/journalId missing: refusing to persist dataset to fallback key');
  }

  async function runDatasetTxWithRuntime(runtime, journalId, { initiator, reason }, mutate) {
    return runDatasetTx({
      ctx: { journalId },
      initiator,
      reason,
      deps: {
        runtime,
        store: runtime?.storage,
        loadDataset: (rt, st, jid) => loadDataset(rt, st, jid),
        saveDataset: (rt, st, jid, ds) => saveDataset(rt, st, jid, ds),
      },
      mutate,
    });
  }

  function rerender(mount, runtime, renderFn) {
    mount.innerHTML = '';
    const cleanup = renderFn();
    if (typeof cleanup === 'function') return cleanup;
    return () => {};
    return () => {
          cleanupTableToolbar();};
  }

  function createModal() {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,.35)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';

    const modal = document.createElement('div');
    modal.style.background = '#fff';
    modal.style.padding = '12px';
    modal.style.borderRadius = '8px';
    modal.style.minWidth = '360px';

    overlay.append(modal);
    return { overlay, modal };
  }

  function columnSettingsUI(host, schema, settings, onChange) {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.gap = '8px';
    wrap.style.flexWrap = 'wrap';

    const schemaKeys = (schema && Array.isArray(schema.fields)) ? schema.fields.map((f) => f.key) : [];
    const ordered = (settings.columns && Array.isArray(settings.columns.order) && settings.columns.order.length)
      ? settings.columns.order
      : schemaKeys;

    for (const key of ordered) {
      const col = document.createElement('div');
      col.style.border = '1px solid #ddd';
      col.style.padding = '4px';

      const label = document.createElement('span');
      label.textContent = key;
      label.style.marginRight = '6px';

      const visible = document.createElement('input');
      visible.type = 'checkbox';
      visible.checked = settings.columns?.visibility?.[key] !== false;
      visible.addEventListener('change', () => {
        onChange(applyColumnSettings(settings, {
          visibility: { ...(settings.columns?.visibility ?? {}), [key]: visible.checked }
        }));
      });

      const subrows = document.createElement('input');
      subrows.type = 'checkbox';
      subrows.title = 'Підстроки';
      subrows.checked = settings.subrows?.columnsSubrowsEnabled?.[key] !== false;
      subrows.addEventListener('change', () => {
        onChange({
          ...settings,
          subrows: {
            ...(settings.subrows ?? { columnsSubrowsEnabled: {} }),
            columnsSubrowsEnabled: {
              ...((settings.subrows ?? {}).columnsSubrowsEnabled ?? {}),
              [key]: subrows.checked
            }
          }
        });
      });

      const widthInput = document.createElement('input');
      widthInput.type = 'number';
      widthInput.min = '40';
      widthInput.style.width = '72px';
      widthInput.value = settings.columns?.widths?.[key] ?? '';
      widthInput.addEventListener('change', () => {
        onChange(applyColumnSettings(settings, {
          widths: { ...(settings.columns?.widths ?? {}), [key]: Number(widthInput.value) || null }
        }));
      });

      const left = document.createElement('button');
      left.textContent = '←';
      left.addEventListener('click', () => {
        const idx = ordered.indexOf(key);
        if (idx <= 0) return;
        const nextOrder = [...ordered];
        [nextOrder[idx - 1], nextOrder[idx]] = [nextOrder[idx], nextOrder[idx - 1]];
        onChange(applyColumnSettings(settings, { order: nextOrder }));
      });

      const right = document.createElement('button');
      right.textContent = '→';
      right.addEventListener('click', () => {
        const idx = ordered.indexOf(key);
        if (idx < 0 || idx >= ordered.length - 1) return;
        const nextOrder = [...ordered];
        [nextOrder[idx], nextOrder[idx + 1]] = [nextOrder[idx + 1], nextOrder[idx]];
        onChange(applyColumnSettings(settings, { order: nextOrder }));
      });

      col.append(label, visible, subrows, widthInput, left, right);
      wrap.append(col);
    }

    host.append(wrap);
  }

  async function renderPanelFactory(mount, runtime) {
    function cleanupTableToolbar(){
      const host = document.querySelector('.sdo-table-toolbar-host');
      if (host) host.innerHTML = '';
    }

    let cleanup = () => {};

    const doRender = () => {
      cleanup();
      cleanup = rerender(mount, runtime, () => {
        const container = document.createElement('div');
        const title = document.createElement('h4');
        title.textContent = buildHeaderTitle(runtime);

        const controls = document.createElement('div');
        controls.style.display = 'flex';
        controls.style.gap = '8px';

        const addBtn = document.createElement('button');
        addBtn.textContent = '+ Додати';

        // Quick navigation button lives in the same block as Search to prevent it
        // from wrapping into a lonely separate line.
        const quickNavBtn = document.createElement('button');
        quickNavBtn.className = 'sdo-nav-btn sdo-nav-quick';
        quickNavBtn.title = 'Спрощена навігація';
        quickNavBtn.textContent = '☰';
        quickNavBtn.addEventListener('click', () => {
          try { window.__SDO_OPEN_QUICKNAV__?.(); } catch (e) { console.error(e); }
        });

        const selectBtn = document.createElement('button');
        selectBtn.textContent = selectionMode ? 'Вибір: ON' : 'Вибір';

        const search = document.createElement('input');
        search.placeholder = 'Пошук';

        // Table must never cause horizontal scroll for the whole page.
        // Horizontal scroll is allowed ONLY inside the table module.
        const tableScroll = document.createElement('div');
        tableScroll.className = 'sdo-table-scroll';
        // current journal id for dataset operations (must be declared before scroll helpers)
        let currentJournalId = null;
        let currentTemplateId = null;
        runtime.__scrollTopByJournal = runtime.__scrollTopByJournal || {};
        const __restoreScrollTop = () => {
          const st = runtime.__scrollTopByJournal[currentJournalId];
          if (typeof st === 'number' && Number.isFinite(st)) tableScroll.scrollTop = st;
        };

        const table = document.createElement('table');
        table.className = 'sdo-table';
        // Fill the panel width by default; horizontal scroll stays inside tableScroll.
        // Column widths are controlled via <colgroup> so header/body always align.
        table.style.width = 'max-content';
        table.style.minWidth = '100%';
        table.style.borderCollapse = 'separate';
        table.style.borderSpacing = '0';
        tableScroll.append(table);
        __restoreScrollTop();
        tableScroll.addEventListener('scroll', async () => {
          runtime.__scrollTopByJournal[currentJournalId] = tableScroll.scrollTop;
          const ds = (runtime.__datasetCache && currentJournalId) ? runtime.__datasetCache[currentJournalId] : null;
          if (!ds?.__lazy || ds.__lazy.fullLoaded) return;
          const nearBottom = (tableScroll.scrollTop + tableScroll.clientHeight) >= (tableScroll.scrollHeight - 200);
          if (!nearBottom) return;
          if (runtime.__lazyLoadInFlight) return;
          runtime.__lazyLoadInFlight = true;
          try {
            const changed = await __ensureMoreRows();
            if (changed) rerender(mount, runtime, renderFn);
          } finally {
            runtime.__lazyLoadInFlight = false;
          }
        });

        container.className = 'sdo-table-panel';
        controls.className = 'sdo-table-controls';

        container.append(title, tableScroll);

        // Mount table controls into global header host (top bar)
        const headerHost = document.querySelector('.sdo-table-toolbar-host');
        if (headerHost) {
          headerHost.innerHTML = '';
          controls.classList.add('sdo-table-controls-inline');
          headerHost.append(controls);
        }
        controls.append(quickNavBtn, addBtn, selectBtn, search);
        mount.append(container);

        const listeners = [];

        // current journal id for dataset operations (declared выше)

        const refreshTable = async () => {
          const resolved = await resolveSchema(runtime);
          const schema = resolved.schema;
          currentJournalId = resolved.state?.activeJournalId ?? null;
          
          if (!currentJournalId) {
            // No active journal selected yet (e.g., first app start). Do not try to load dataset.
            table.innerHTML = '';
            const msg = document.createElement('div');
            msg.style.padding = '8px';
            msg.style.color = '#666';
            msg.textContent = 'Оберіть або створіть журнал, щоб переглянути таблицю.';
            table.append(msg);
            return;
          }
currentTemplateId = resolved.journal?.templateId ?? null;

          const settings = await loadSettings(runtime.storage, currentTemplateId);
          const dataset = await loadDataset(runtime, runtime.storage, currentJournalId);
          const __recordById = new Map((dataset.records ?? []).map((r) => [String(r.id), r]));
          // Lazy-load more rows on scroll for big journals.
          async function __ensureMoreRows() {
            const store = runtime?.api?.tableStore || runtime?.sdo?.api?.tableStore;
            if (!dataset?.__lazy || dataset.__lazy.fullLoaded || !store?.getRecordsByRange) return false;
            const total = Number(dataset.__lazy.total ?? 0);
            const chunk = Number(dataset.__lazy.chunk ?? 200);
            const start = Number(dataset.__lazy.cursor ?? 0);
            if (start >= total) { dataset.__lazy.fullLoaded = true; return false; }
            const part = await store.getRecordsByRange(currentJournalId, start, chunk);
            for (const r of (part.records ?? [])) dataset.records.push(r);
            dataset.__lazy.cursor = Math.min(total, start + chunk);
            if (dataset.__lazy.cursor >= total) dataset.__lazy.fullLoaded = true;
            return true;
          }

          if (!schema || !Array.isArray(schema.fields) || schema.fields.length === 0) {
            table.innerHTML = '';
            const msg = document.createElement('div');
            msg.style.padding = '8px';
            msg.style.color = '#666';
            msg.textContent = 'Немає колонок: журнал не має шаблону або шаблон не знайдено. Створіть журнал з шаблоном (наприклад, test).';
            table.append(msg);
            return;
          }

          // rebuild engine if schema changed
          if (!engine || currentSchemaId !== schema.id) {
            currentSchemaId = schema.id;
          }
          engine = createTableEngine({ schema, settings });
          engine.setDataset(dataset);
          const view = engine.compute();

          const sortedRows = applySortToRows(view.rows, settings?.sort, schema, dataset);

          table.innerHTML = '';

          // One table:
          // - <thead> has 2 sticky rows (titles + column numbers)
          // - plus 2 fixed-width action columns on the far right (Transfer / Delete), like v1
          // - <colgroup> defines widths so header/body never drift.
          const colgroup = document.createElement('colgroup');
          const actionsColW = 44;
          const availableW = Math.max(320, tableScroll.getBoundingClientRect().width || 0);
          const nCols = view.columns.length;
          const baseW = Math.max(90, Math.floor((availableW - actionsColW * 2) / Math.max(1, nCols)));

          const thead = document.createElement('thead');
          const titleTr = document.createElement('tr');
          titleTr.className = 'sdo-hdr-title';
          const idxTr = document.createElement('tr');
          idxTr.className = 'sdo-hdr-idx';

          let colIdx = 0;
          for (const col of view.columns) {
            colIdx += 1;

            const w = col.width ? col.width : baseW;
            const colEl = document.createElement('col');
            colEl.style.width = `${w}px`;
            colEl.style.minWidth = `${w}px`;
            colgroup.append(colEl);

            const thTitle = document.createElement('th');
            // Column title + per-column subrows toggle
            const hdrWrap = document.createElement('div');
            hdrWrap.className = 'sdo-hdr-wrap';
            hdrWrap.style.display = 'flex';
            hdrWrap.style.alignItems = 'center';
            hdrWrap.style.justifyContent = 'center';
            hdrWrap.style.gap = '6px';

            const hdrLabel = document.createElement('span');
            const sortDir = (settings?.sort?.colKey === col.columnKey) ? settings?.sort?.dir : null;
            hdrLabel.textContent = (col.field?.label ?? col.columnKey) + (sortDir === 'asc' ? ' ▲' : sortDir === 'desc' ? ' ▼' : '');

            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'sdo-hdr-subtoggle';
            toggle.style.width = '22px';
            toggle.style.height = '22px';
            toggle.style.borderRadius = '10px';
            toggle.style.border = '1px solid var(--border,#ddd)';
            toggle.style.background = 'var(--panel,#fff)';
            toggle.style.cursor = 'pointer';
            toggle.style.padding = '0';
            toggle.style.lineHeight = '1';
            toggle.style.fontSize = '12px';

            const isEnabled = settings?.subrows?.columnsSubrowsEnabled?.[col.columnKey] !== false;
            toggle.textContent = isEnabled ? '↳' : '×';
            toggle.title = isEnabled ? 'Підстроки: увімкнено (натисніть, щоб вимкнути)' : 'Підстроки: вимкнено (натисніть, щоб увімкнути)';
            toggle.dataset.colKey = col.columnKey;
            toggle.addEventListener('click', async (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              const colKey = toggle.dataset.colKey;
              const cur = settings?.subrows?.columnsSubrowsEnabled?.[colKey];
              const nextSettings = { ...settings, subrows: { ...(settings.subrows ?? {}), columnsSubrowsEnabled: { ...((settings.subrows ?? {}).columnsSubrowsEnabled ?? {}) } } };
              const enabledNow = cur !== false;
              nextSettings.subrows.columnsSubrowsEnabled[colKey] = enabledNow ? false : true;
              await saveSettings(runtime.storage, currentTemplateId, nextSettings);
              engine.recompute?.(); await requestTableRerender({ reason: 'refresh', journalId: currentJournalId });
            });

            hdrWrap.append(hdrLabel, toggle);
            thTitle.append(hdrWrap);

            thTitle.dataset.colKey = col.columnKey;
            thTitle.addEventListener('click', async (ev) => {
              try {
                const r = thTitle.getBoundingClientRect();
                const edgePx = 6;
                if ((r.right - ev.clientX) <= edgePx) return;
              } catch (_) {}
              const colKey = thTitle.dataset.colKey;
              const cur = settings?.sort;
              let next = null;
              if (!cur || cur.colKey !== colKey) next = { colKey, dir: 'asc' };
              else if (cur.dir === 'asc') next = { colKey, dir: 'desc' };
              else next = null;
              const nextSettings = { ...settings, sort: next };
              await saveSettings(runtime.storage, currentTemplateId, nextSettings);
              engine.recompute?.(); await requestTableRerender({ reason: 'refresh', journalId: currentJournalId });
            });
            titleTr.append(thTitle);

            const thIdx = document.createElement('th');
            thIdx.className = 'sdo-col-idx';
            thIdx.textContent = String(colIdx);
            idxTr.append(thIdx);
          }

          const colTransfer = document.createElement('col');
          colTransfer.style.width = `${actionsColW}px`;
          colTransfer.style.minWidth = `${actionsColW}px`;
          const colDelete = document.createElement('col');
          colDelete.style.width = `${actionsColW}px`;
          colDelete.style.minWidth = `${actionsColW}px`;
          colgroup.append(colTransfer, colDelete);

          const thTransfer = document.createElement('th');
          thTransfer.className = 'sdo-col-actions';
          thTransfer.rowSpan = 2;
          thTransfer.title = 'Перенести';
          thTransfer.textContent = '⇄';

          const thDelete = document.createElement('th');
          thDelete.className = 'sdo-col-actions';
          thDelete.rowSpan = 2;
          thDelete.title = 'Видалити';
          thDelete.textContent = '🗑';

          titleTr.append(thTransfer, thDelete);

          thead.append(titleTr, idxTr);
          table.append(colgroup);
          table.append(thead);

          // Measure the 1st header row height and set CSS var so the 2nd row can sticky under it.
          // (Needed because row height can change with theme/font/2-line labels.)
          const syncHeaderHeights = () => {
            const h = titleTr.getBoundingClientRect().height;
            table.style.setProperty('--sdo-thead-row1-h', `${Math.ceil(h)}px`);
          };
          requestAnimationFrame(syncHeaderHeights);
          window.addEventListener('resize', syncHeaderHeights);

          const tbody = document.createElement('tbody');
          table.append(tbody);

          // Column resize (drag near right edge of a cell/header).
          // Uses <colgroup> widths and persists into template settings (columns.widths).
          const colKeyToIndex = {};
          view.columns.forEach((c, i) => { colKeyToIndex[c.columnKey] = i; });
          const resizeState = { active: false, justEnded: false, colIndex: -1, startX: 0, startW: 0 };
          const markResizeEnded = () => {
            resizeState.justEnded = true;
            setTimeout(() => { resizeState.justEnded = false; }, 0);
          };

          const getColElByIndex = (i) => {
            const cols = colgroup.children;
            return (i >= 0 && i < cols.length) ? cols[i] : null;
          };

          const startResize = (ev, colIndex) => {
            const colEl = getColElByIndex(colIndex);
            if (!colEl) return;
            resizeState.active = true;
            resizeState.colIndex = colIndex;
            resizeState.startX = ev.clientX;
            // Parse current width from colgroup
            const cur = parseInt(colEl.style.width || '0', 10) || colEl.getBoundingClientRect().width || 90;
            resizeState.startW = cur;
            try { ev.target.setPointerCapture?.(ev.pointerId); } catch(_) {}
            ev.preventDefault();
            ev.stopPropagation();
          };

          const moveResize = (ev) => {
            if (!resizeState.active) return;
            const dx = ev.clientX - resizeState.startX;
            const nextW = Math.max(60, Math.round(resizeState.startW + dx));
            const colEl = getColElByIndex(resizeState.colIndex);
            if (!colEl) return;
            colEl.style.width = `${nextW}px`;
            colEl.style.minWidth = `${nextW}px`;
          };

          const endResize = async () => {
            if (!resizeState.active) return;
            const colIndex = resizeState.colIndex;
            resizeState.active = false;
            resizeState.colIndex = -1;
            markResizeEnded();

            const colEl = getColElByIndex(colIndex);
            if (!colEl) return;
            const finalW = parseInt(colEl.style.width || '0', 10) || Math.round(colEl.getBoundingClientRect().width || 90);
            const colKey = view.columns[colIndex]?.columnKey;
            if (!colKey) return;

            try {
              const nextSettings = {
                ...settings,
                columns: {
                  ...(settings.columns || {}),
                  widths: {
                    ...((settings.columns && settings.columns.widths) ? settings.columns.widths : {}),
                    [colKey]: finalW
                  }
                }
              };
              await saveSettings(runtime.storage, currentTemplateId, nextSettings);
            } catch (e) {
              console.error('Failed to persist column width', e);
            }
          };

          // Cursor hint (only when near right edge).
          const edgePx = 6;
          const setCursorByEdge = async (ev) => {
            const el = ev.target?.closest?.('td,th');
            if (!el) return;
            const idx = el.cellIndex;
            if (idx == null || idx < 0 || idx >= view.columns.length) {
              el.style.cursor = '';
              return;
            }
            const r = el.getBoundingClientRect();
            const near = (r.right - ev.clientX) <= edgePx;
            el.style.cursor = near ? 'col-resize' : '';
          };

          // Use pointer events to support mouse/touch.
          table.addEventListener('pointermove', (ev) => {
            if (resizeState.active) return;
            setCursorByEdge(ev);
          });
          table.addEventListener('pointerdown', (ev) => {
            // Only left mouse button or touch/pen
            if (ev.pointerType === 'mouse' && ev.button !== 0) return;
            const el = ev.target?.closest?.('td,th');
            if (!el) return;
            const idx = el.cellIndex;
            if (idx == null || idx < 0 || idx >= view.columns.length) return;
            const r = el.getBoundingClientRect();
            if ((r.right - ev.clientX) > edgePx) return;
            startResize(ev, idx);
          });
          table.addEventListener('pointermove', (ev) => moveResize(ev));
          table.addEventListener('pointerup', async () => { await endResize(); });
          table.addEventListener('pointercancel', async () => { await endResize(); });

          
                    // VIRTUAL_SCROLL_V21: true windowed rendering (constant DOM) with guards (empty dataset/new journal/schema warmup)
          const allRows = Array.isArray(sortedRows) ? [...sortedRows].reverse() : [];
          const VIRTUAL_ROW_EST_PX = 34;
          const VIRTUAL_WINDOW = 90;      // number of rows in DOM at once
          const VIRTUAL_OVERSCAN = 25;    // extra rows above/below
          let __rowHeight = VIRTUAL_ROW_EST_PX;
          let __renderInProgress = false;
          let __onScrollQueued = false;
          let __lastRange = null;

          const mkSpacerRow = (heightPx) => {
            const trSp = document.createElement('tr');
            trSp.className = 'sdo-row-spacer';
            const tdSp = document.createElement('td');
            tdSp.colSpan = (view.columns.length + 2);
            tdSp.style.padding = '0';
            tdSp.style.border = '0';
            tdSp.style.height = Math.max(0, heightPx) + 'px';
            trSp.append(tdSp);
            return trSp;
          };

          const computeRange = () => {
            // Guards: during schema warmup tableScroll may be missing
            if (!tableScroll) return { start: 0, end: Math.min(allRows.length, VIRTUAL_WINDOW) };
            const scrollTop = tableScroll.scrollTop || 0;
            const viewportH = tableScroll.clientHeight || 0;
            const approxFirst = Math.floor(scrollTop / __rowHeight);
            const approxCount = Math.ceil((viewportH || (__rowHeight * VIRTUAL_WINDOW)) / __rowHeight);
            let start = Math.max(0, approxFirst - VIRTUAL_OVERSCAN);
            let end = Math.min(allRows.length, start + Math.max(VIRTUAL_WINDOW, approxCount + (2 * VIRTUAL_OVERSCAN)));
            // If near end, shift window up to keep it full
            start = Math.max(0, Math.min(start, Math.max(0, end - VIRTUAL_WINDOW)));
            return { start, end };
          };

          const renderWindow = async () => {
            if (__renderInProgress) return;
            __renderInProgress = true;
            try {
              const { start, end } = computeRange();
              const key = start + ':' + end + ':' + allRows.length;
              if (__lastRange === key) return;
              __lastRange = key;

              tbody.innerHTML = '';
              const topPad = start * __rowHeight;
              const bottomPad = Math.max(0, (allRows.length - end) * __rowHeight);
              if (topPad > 0) tbody.append(mkSpacerRow(topPad));

              for (let __i = start; __i < end; __i += 1) {
                const row = allRows[__i];


            const tr = document.createElement('tr');
// Cell-level subrows: subrows are rendered as additional "lines" inside enabled columns.
const rowSubrowIds = engine.listSubrows ? engine.listSubrows(row.rowId, dataset) : [];
const hasAnySubrowsCol = view.columns.some((c) => isSubrowsEnabled(settings, c.columnKey));
const rowLineCount = hasAnySubrowsCol ? (1 + rowSubrowIds.length) : 1;

            const renderableCells = getRenderableCells(row, view.columns, view.cellSpanMap);
            for (const cell of renderableCells) {
              const td = document.createElement('td');
              const span = cell.span;
              if (span.rowSpan) td.rowSpan = span.rowSpan;
              if (span.colSpan) td.colSpan = span.colSpan;

              const formatted = defaultFormatCell(row.record.cells?.[cell.colKey], row.record.fmt?.[cell.colKey] ?? {}, schema.fields.find((f) => f.key === cell.colKey) ?? {}, { locale: 'uk-UA', dateFormat: 'DD.MM.YYYY' });
              const firstColKey = view.columns[0]?.columnKey;
              const isFirstCol = cell.colKey === firstColKey;

// Cell content: for enabled columns we render stacked lines (base + subrows).
// For disabled columns we render a single block (no inner separators), but the cell still stretches
// to the row height automatically because the tallest cell defines the <tr> height.
td.innerHTML = '';
const stack = document.createElement('div');
const colAllowsSubrows = isSubrowsEnabled(settings, cell.colKey);

if (!colAllowsSubrows || rowLineCount <= 1) {
  stack.className = 'sdo-cell-stack sdo-cell-stack--single';
  const line = document.createElement('div');
  line.className = 'sdo-cell-line sdo-cell-line--single';
  line.dataset.rowId = row.rowId;

  // Base value
  const field = schema.fields.find((f) => f.key === cell.colKey) ?? {};
  const rec = __recordById.get(String(row.rowId));
  const fmt = rec?.fmt?.[cell.colKey] ?? {};
  const val = rec?.cells?.[cell.colKey];
  const f2 = defaultFormatCell(val, fmt, field, { locale: 'uk-UA', dateFormat: 'DD.MM.YYYY' });
  line.textContent = f2.text ?? '';
  if (f2.align) line.style.textAlign = f2.align;
  if (f2.style) Object.assign(line.style, f2.style);

  stack.append(line);
  td.append(stack);
} else {
  stack.className = 'sdo-cell-stack';
  for (let li = 0; li < rowLineCount; li += 1) {
    const line = document.createElement('div');
    line.className = 'sdo-cell-line';
    let targetRowId = null;

    if (li === 0) {
      targetRowId = row.rowId;
    } else if (colAllowsSubrows) {
      targetRowId = rowSubrowIds[li - 1] ?? null;
    }

    if (targetRowId) {
      line.dataset.rowId = targetRowId;
      const p = parseSubrowId(targetRowId);
      const field = schema.fields.find((f) => f.key === cell.colKey) ?? {};
      let fmt = {};
      let val;
      if (p && p.ownerId === row.rowId) {
        const sub = Array.isArray(row.record.subrows) ? row.record.subrows[p.index] : null;
        val = sub?.cells?.[cell.colKey];
      } else {
        const rec = __recordById.get(String(targetRowId));
        fmt = rec?.fmt?.[cell.colKey] ?? {};
        val = rec?.cells?.[cell.colKey];
      }
      const f2 = defaultFormatCell(val, fmt, field, { locale: 'uk-UA', dateFormat: 'DD.MM.YYYY' });
      line.textContent = f2.text ?? '';
      if (f2.align) line.style.textAlign = f2.align;
      if (f2.style) Object.assign(line.style, f2.style);
    } else {
      // Padding line (keeps height aligned across enabled columns)
      line.innerHTML = '&nbsp;';
      line.classList.add('sdo-cell-line--pad');
    }

    stack.append(line);
  }
  td.append(stack);
}

// Indentation only for the first (tree) column.
if (isFirstCol) {
  td.style.paddingLeft = `${row.depth * 16 + 8}px`;
}
if (rowLineCount > 1) td.classList.add('sdo-cell-has-subrows');

              // Actions are rendered as their own fixed-width columns at the far right (see below).

              if (formatted.align) td.style.textAlign = formatted.align;
              if (formatted.style) Object.assign(td.style, formatted.style);

              if (cell.colKey === view.columns[0]?.columnKey && row.hasChildren) {
                const expander = document.createElement('button');
                expander.textContent = row.isExpanded ? '▾' : '▸';
                expander.style.marginRight = '4px';
                expander.addEventListener('click', async (ev) => {
                  ev.stopPropagation();
                  engine.toggleExpand(row.rowId);
                  const next = { ...settings, expandedRowIds: [...engine.compute().rows.filter((r) => r.isExpanded).map((r) => r.rowId)] };
                  await saveSettings(runtime.storage, currentTemplateId, next);
                  engine.recompute?.(); await requestRefresh();
                });
                td.prepend(expander);
              }

              td.addEventListener('click', async (ev) => {
  const spanInfo = view.cellSpanMap.get(cellKey(row.rowId, cell.colKey));
  if (spanInfo?.coveredBy) return;

  // Ignore click if it was a column resize gesture
  if (typeof resizeState !== 'undefined' && (resizeState.active || resizeState.justEnded)) return;

  // Determine which "line" was clicked (base row or a specific subrow line).
  const lineEl = ev.target?.closest?.('.sdo-cell-line');
  const targetRowId = lineEl?.dataset?.rowId;
  const colAllowsSubrows = isSubrowsEnabled(settings, cell.colKey);

  // If user clicked on a padding line (no target), ignore.
  if (!targetRowId) return;

  // If subrows are disabled for this column, force edits to the base row.
  const editRowId = colAllowsSubrows ? targetRowId : row.rowId;

  const currentDataset = await loadDataset(runtime, runtime.storage, currentJournalId);
  const pEdit = parseSubrowId(editRowId);
  const baseRec = (currentDataset.records ?? []).find((r) => r.id === row.rowId) ?? row.record;

  let currentValue = '';
  if (pEdit && pEdit.ownerId === row.rowId) {
    const sub = Array.isArray(baseRec.subrows) ? baseRec.subrows[pEdit.index] : null;
    currentValue = sub?.cells?.[cell.colKey] ?? '';
  } else {
    const editRecord = (currentDataset.records ?? []).find((r) => r.id === editRowId) ?? row.record;
    currentValue = editRecord.cells?.[cell.colKey] ?? '';
  }

  // Inline edit (single input) — on save we patch the target record.
  engine.beginEdit(editRowId, cell.colKey);
  const field = schema.fields.find((f) => f.key === cell.colKey) ?? {};
  const inputModel = formatted.editor ?? { type: 'text', props: {} };
  const input = document.createElement('input');
  input.type = (inputModel.type === 'checkbox') ? 'checkbox' : 'text';
  if (inputModel.type === 'number') { input.inputMode = 'decimal'; input.placeholder = 'Число'; }
  if (inputModel.type === 'date') { input.inputMode = 'numeric'; input.placeholder = 'YYYY-MM-DD або DD.MM.YYYY'; }
  if (input.type === 'checkbox') {
    const low = String(currentValue ?? '').trim().toLowerCase();
    input.checked = (currentValue === true) || (currentValue === 1) || (low === '1' || low === 'true' || low === '+' || low === 'так' || low === 'yes' || low === 'y');
    input.value = '1';
  } else {
    input.value = currentValue;
  }

  td.innerHTML = '';
  td.append(input);
  input.focus();

  const save = async () => {
    // __FAST_EDIT_V1__
    const raw = input.value;
    const parsed = engine.parseCellValue(cell.colKey, raw);

    // If we are editing a subrow line, the actual data lives inside the OWNER record's subrows[]
    // (subrows are not stored as separate records). We'll persist via tableStore.updateRecord,
    // which is patched to understand "ownerId::sub::N" ids.
    const pSub = parseSubrowId(editRowId);

    // Apply to UI immediately (no full refresh)
    try {
      // Update engine/model (kept for validation/transfer consistency)
      engine.applyEdit(editRowId, cell.colKey, parsed.v);
      // Persist only the changed record (tableStore is source of truth)
      const store = runtime?.api?.tableStore || runtime?.sdo?.api?.tableStore;

      const __baseEvent = {
        type: 'editCell',
        initiator: 'ui.editCell',
        reason: 'editCell',
        journalId: currentJournalId,
        details: { rowId: editRowId, colKey: cell.colKey, isSubrow: !!pSub }
      };
      pushTableEvent({ ...__baseEvent, phase: 'start', ok: null });
      let __persistOk = false;
      try {
        if (store?.updateRecord) {
          await store.updateRecord(currentJournalId, editRowId, { cells: { [cell.colKey]: parsed.v } });
        } else {
          // Fallback to full-dataset save path (instrumented via datasetTx)
          const patch = { type: 'cell', rowId: editRowId, colKey: cell.colKey, value: parsed.v };
          const tx = await runDatasetTxWithRuntime(runtime, currentJournalId, { initiator: 'ui.editCell.fallback', reason: 'editCell' }, async (ds) => {
            const nextDataset = updateDatasetWithPatch(ds, patch);
            return { ok: true, nextDataset, meta: { rowId: editRowId, colKey: cell.colKey } };
          });
          if (!tx.ok) throw new Error('editCell fallback tx failed');
          try {
            runtime.__datasetCache = runtime.__datasetCache || {};
            runtime.__datasetCache[currentJournalId] = tx.nextDataset;
          } catch {}
        }
        __persistOk = true;
      } finally {
        pushTableEvent({ ...__baseEvent, phase: 'done', ok: __persistOk });
      }

      // Update DOM:
      // - for base rows: simple text update is fine
      // - for subrow lines: do a lightweight refresh so stacked lines remain correct
      if (pSub) {
        // Force rerender after subrow edit as well
        // Update cache (subrow lives inside owner record.subrows[index])
        try {
          const dsCached = runtime.__datasetCache && runtime.__datasetCache[currentJournalId];
          if (dsCached && Array.isArray(dsCached.records)) {
            const ownerRec = dsCached.records.find(r => (r && (r.id || r._id)) === pSub.ownerId);
            if (ownerRec) {
              ownerRec.subrows = ownerRec.subrows || [];
              ownerRec.subrows[pSub.index] = ownerRec.subrows[pSub.index] || { cells: {} };
              ownerRec.subrows[pSub.index].cells = ownerRec.subrows[pSub.index].cells || {};
              ownerRec.subrows[pSub.index].cells[cell.colKey] = parsed.v;
            }
          }
        } catch {}
        engine.recompute?.(); await requestTableRerender({ reason: 'editSubrow', journalId: currentJournalId, rowId: pSub.ownerId, subIndex: pSub.index, colKey: cell.colKey });
      } else {
        // Force full rerender after any edit (requested UX)
        // Update cache if present so rerender reflects the new value
        try {
          const dsCached = runtime.__datasetCache && runtime.__datasetCache[currentJournalId];
          if (dsCached && Array.isArray(dsCached.records)) {
            const rec = dsCached.records.find(r => (r && (r.id || r._id)) === editRowId);
            if (rec) {
              rec.cells = rec.cells || {};
              rec.cells[cell.colKey] = parsed.v;
            }
          }
        } catch {}
        engine.recompute?.(); await requestTableRerender({ reason: 'editCell', journalId: currentJournalId, rowId: editRowId, colKey: cell.colKey });
      }
    } finally {
      // teardown editor
      td.classList.remove('editing');
      if (input.parentNode) input.parentNode.removeChild(input);
    }
  };

  input.addEventListener('keydown', async (e2) => {
    if (e2.key === 'Enter') await save();
    if (e2.key === 'Escape') {
      engine.cancelEdit();
      engine.recompute?.(); await requestRefresh();
    }
  });
  input.addEventListener('blur', save, { once: true });
});

              tr.append(td);
            }
// Fixed action columns at far right (Transfer / Context)
{
  const tdTransfer = document.createElement('td');
  tdTransfer.className = 'sdo-col-actions';
  const transferBtn = document.createElement('button');
  transferBtn.className = 'sdo-row-transfer';
  transferBtn.textContent = '⇄';
  transferBtn.title = 'Копіювати/перенести';
  transferBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    (async () => {
      const UI = globalThis.UI;
      const state = (runtime?.api?.getState?.() ?? runtime?.sdo?.api?.getState?.() ?? runtime?.sdo?.getState?.() ?? {});
      const sourceJournalId = state?.activeJournalId;
      const recordIds = [row.rowId];
      if (!sourceJournalId) {
        UI?.toast?.error?.('Не визначено активний журнал для перенесення') ?? console.error('Transfer: no activeJournalId');
        return;
      }
      if (!UI?.transfer?.openRowModal) {
        UI?.toast?.error?.('Модуль перенесення не ініціалізовано') ?? console.error('TransferUI not initialized');
        return;
      }
      await UI.transfer.openRowModal({ sourceJournalId, recordIds });
    })().catch((e) => {
      (globalThis.UI?.toast?.error?.('Помилка перенесення') ?? console.error('Transfer openRowModal failed', e));
    });
  });
  tdTransfer.append(transferBtn);
  tr.append(tdTransfer);

  const tdCtx = document.createElement('td');
  tdCtx.className = 'sdo-col-actions';
  const ctxBtn = document.createElement('button');
  ctxBtn.className = 'sdo-row-context';
  ctxBtn.textContent = '☰';
  ctxBtn.title = 'Контекст';

  ctxBtn.addEventListener('click', async (ev) => {
    ev.stopPropagation();

    const content = document.createElement('div');
    content.className = 'ui-modal-content';

    const btnAddSub = document.createElement('button');
    btnAddSub.className = 'btn btn-primary';
    btnAddSub.textContent = 'Додати підстроку';

    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn';
    btnDelete.textContent = 'Видалення…';

    const footer = document.createElement('div');
    footer.className = 'ui-modal-footer';
    const btnClose = document.createElement('button');
    btnClose.className = 'btn';
    btnClose.textContent = 'Закрити';

    footer.append(btnClose);

    content.append(btnAddSub);
    content.append(document.createElement('hr'));
    content.append(btnDelete);
    content.append(footer);

    const modalId = UI.modal.open({ title: 'Дії', contentNode: content, closeOnOverlay: true });

    btnClose.addEventListener('click', () => UI.modal.close(modalId));

    btnAddSub.addEventListener('click', async () => {
      UI.modal.close(modalId);

      const tx = await runDatasetTxWithRuntime(runtime, currentJournalId, { initiator: 'ui.rowContext.addSubrow', reason: 'addSubrow' }, async (ds) => {
        engine.setDataset(ds);

        // Create a subrow with empty cells only for columns where subrows are enabled.
        const initCells = {};
        for (const c of view.columns) {
          const k = c.columnKey;
          const enabled = settings?.subrows?.columnsSubrowsEnabled?.[k] !== false;
          if (enabled) initCells[k] = '';
        }

        const { dataset: nextDataset } = engine.addSubrow(row.rowId, { cells: initCells }, ds);
        return { ok: true, nextDataset, meta: { ownerRowId: row.rowId } };
      });

      if (!tx.ok) {
        window.UI?.toast?.show?.('Не вдалося додати підстроку');
        return;
      }

      // Sync cache so rerender reflects added subrow immediately
      try { runtime.__datasetCache = runtime.__datasetCache || {}; runtime.__datasetCache[currentJournalId] = tx.nextDataset; } catch {}
      engine.recompute?.(); await requestTableRerender({ reason: 'addSubrow', journalId: currentJournalId, rowId: row.rowId });
    });

    btnDelete.addEventListener('click', async () => {
      UI.modal.close(modalId);

      const node = document.createElement('div');
      node.className = 'ui-modal-content';

      const p = document.createElement('p');
      p.textContent = 'Видалити всю строку чи підстрочку?';
      node.append(p);

      const rowBtn = document.createElement('button');
      rowBtn.className = 'btn btn-danger';
      rowBtn.textContent = 'Всю строку';

      const subWrap = document.createElement('div');
      subWrap.style.display = 'flex';
      subWrap.style.gap = '8px';
      subWrap.style.alignItems = 'center';

      const subBtn = document.createElement('button');
      subBtn.className = 'btn btn-danger';
      subBtn.textContent = 'Підстрочку';

      const subInput = document.createElement('input');
      subInput.type = 'number';
      subInput.min = '1';
      subInput.placeholder = '№';
      subInput.style.width = '80px';

      subWrap.append(subBtn);
      subWrap.append(subInput);

      const actions = document.createElement('div');
      actions.className = 'ui-modal-footer';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn';
      cancelBtn.textContent = 'Скасувати';

      actions.append(cancelBtn);

      node.append(rowBtn);
      node.append(document.createElement('hr'));
      node.append(subWrap);
      node.append(actions);

      const modalId2 = UI.modal.open({ title: 'Видалення', contentNode: node, closeOnOverlay: true });

      cancelBtn.addEventListener('click', () => UI.modal.close(modalId2));

      rowBtn.addEventListener('click', async () => {
        // NOTE:
        // UI.modal.confirm may fail to resolve correctly when another modal is currently open
        // (stacked modals / focus-trap). We close the current modal first, then confirm.
        UI.modal.close(modalId2);

        let ok = true;
        if (UI?.modal?.confirm) {
          ok = await UI.modal.confirm('Видалити всю строку?', { title: 'Підтвердження' });
        } else {
          ok = window.confirm('Видалити всю строку?');
        }
        if (!ok) return;

        // IMPORTANT:
        // - "row.rowId" can be either owner row id or a subrow id (ownerId::sub::N)
        // - When deleting a whole row, we must delete owner record + ALL its subrow records
        //   (tableStore.deleteRecord removes only one id and would leave orphaned subrows).
        const parsed = parseSubrowId(row.rowId);
        const ownerId = parsed ? parsed.ownerId : row.rowId;

        // IMPORTANT: delete must update the SAME data source as refreshTable() reads.
        // refreshTable() uses loadDataset(), which may fall back to single-key storage when
        // active journal id is not set yet. So we always persist via saveDataset().
        const removeRowCascade = (ds, rootId) => {
          const records = Array.isArray(ds?.records) ? ds.records : [];
          const byId = new Map(records.map((r) => [String(r.id), r]));
          const toDelete = new Set();

          const walk = (id) => {
            const sid = String(id);
            if (toDelete.has(sid)) return;
            toDelete.add(sid);
            const rec = byId.get(sid);
            const kids = Array.isArray(rec?.childrenIds) ? rec.childrenIds : [];
            for (const k of kids) walk(k);
          };

          walk(rootId);

          const nextRecords = records
            .filter((r) => !toDelete.has(String(r.id)))
            .map((r) => {
              if (!Array.isArray(r.childrenIds) || r.childrenIds.length === 0) return r;
              const nextKids = r.childrenIds.filter((k) => !toDelete.has(String(k)));
              return nextKids.length === r.childrenIds.length ? r : { ...r, childrenIds: nextKids };
            });

          const nextMerges = Array.isArray(ds?.merges) ? ds.merges.filter((m) => !toDelete.has(String(m.rowId))) : ds?.merges;
          return { ...ds, records: nextRecords, merges: nextMerges };
        };

        const tx = await runDatasetTxWithRuntime(runtime, currentJournalId, { initiator: 'ui.rowContext.deleteRow', reason: 'deleteRow' }, async (ds) => {
          const nextDataset2 = removeRowCascade(ds, ownerId);
          return { ok: true, nextDataset: nextDataset2, meta: { ownerId } };
        });
        if (!tx.ok) {
          window.UI?.toast?.show?.('Не вдалося видалити строку');
          return;
        }
        runtime.__datasetCache = runtime.__datasetCache || Object.create(null);
               runtime.__datasetCache[currentJournalId] = tx.nextDataset;
               await requestTableRerender({ reason: 'deleteRow', journalId: currentJournalId, rowId: ownerId });
      });

      subBtn.addEventListener('click', async () => {
        const n = Number(subInput.value);
        if (!Number.isFinite(n) || n < 1) {
          subInput.focus();
          subInput.style.outline = '2px solid #d33';
          return;
        }

        const parsed = parseSubrowId(row.rowId);
        const ownerId = parsed ? parsed.ownerId : row.rowId;
        // datasetTx will load dataset; keep engine in sync inside mutate


        // UX model: if subrows exist, parent row is considered "Підстрочка №1".
        // Therefore deleting №1 should delete the whole parent row.
        if (n === 1) {
          UI.modal.close(modalId2);
          const removeRowCascade = (ds, rootId) => {
            const records = Array.isArray(ds?.records) ? ds.records : [];
            const byId = new Map(records.map((r) => [String(r.id), r]));
            const toDelete = new Set();
            const walk = (id) => {
              const sid = String(id);
              if (toDelete.has(sid)) return;
              toDelete.add(sid);
              const rec = byId.get(sid);
              const kids = Array.isArray(rec?.childrenIds) ? rec.childrenIds : [];
              for (const k of kids) walk(k);
            };
            walk(rootId);
            const nextRecords = records
              .filter((r) => !toDelete.has(String(r.id)))
              .map((r) => {
                if (!Array.isArray(r.childrenIds) || r.childrenIds.length === 0) return r;
                const nextKids = r.childrenIds.filter((k) => !toDelete.has(String(k)));
                return nextKids.length === r.childrenIds.length ? r : { ...r, childrenIds: nextKids };
              });
            const nextMerges = Array.isArray(ds?.merges) ? ds.merges.filter((m) => !toDelete.has(String(m.rowId))) : ds?.merges;
            return { ...ds, records: nextRecords, merges: nextMerges };
          };
          const tx = await runDatasetTxWithRuntime(runtime, currentJournalId, { initiator: 'ui.rowContext.deleteRow.subIndex1', reason: 'deleteRow' }, async (ds) => {
            const nextDataset3 = removeRowCascade(ds, ownerId);
            return { ok: true, nextDataset: nextDataset3, meta: { ownerId } };
          });
          if (!tx.ok) {
            window.UI?.toast?.show?.('Не вдалося видалити строку');
            return;
          }
          runtime.__datasetCache = runtime.__datasetCache || Object.create(null);
                 runtime.__datasetCache[currentJournalId] = tx.nextDataset;
          engine.recompute?.(); await requestRefresh();
          return;
        }

        // Always build subrow id from OWNER id (ctx-menu can be opened on subrow rows).
        const subrowId = `${ownerId}::sub::${n - 2}`;
        const tx = await runDatasetTxWithRuntime(runtime, currentJournalId, { initiator: 'ui.rowContext.deleteSubrow', reason: 'deleteSubrow' }, async (ds) => {
          engine.setDataset(ds);
          const { dataset: nextDataset2, removed } = engine.removeSubrow(subrowId, ds);
          if (!removed) return { ok: false, nextDataset: ds, meta: { removed: false, subrowId } };
          return { ok: true, nextDataset: nextDataset2, meta: { removed: true, subrowId, subIndex: (n - 2) } };
        });
        if (!tx.ok) {
          subInput.style.outline = '2px solid #d33';
          return;
        }
        UI.modal.close(modalId2);
        runtime.__datasetCache = runtime.__datasetCache || Object.create(null);
               runtime.__datasetCache[currentJournalId] = tx.nextDataset;
               await requestTableRerender({ reason: 'deleteSubrow', journalId: currentJournalId, rowId: ownerId, subIndex: (n-2) });
      });
    });
  });

  tdCtx.append(ctxBtn);
  tr.append(tdCtx);

            if (selectionMode) {
              tr.style.cursor = 'pointer';
              tr.addEventListener('click', async () => {
                engine.toggleSelect(row.rowId);
                const next = { ...settings, selectedRowIds: [...engine.compute().selection] };
                await saveSettings(runtime.storage, currentTemplateId, next);
                engine.recompute?.(); await requestRefresh();
              });
            }

            tbody.append(tr);
          }
        

              
              }

              if (bottomPad > 0) tbody.append(mkSpacerRow(bottomPad));

              // Measure real row height once (best-effort) to improve scrolling accuracy
              if (__rowHeight === VIRTUAL_ROW_EST_PX) {
                const firstRealRow = tbody.querySelector('tr:not(.sdo-row-spacer):not(.sdo-row-more)');
                if (firstRealRow) {
                  const h = firstRealRow.getBoundingClientRect().height;
                  if (h && h > 10) __rowHeight = h;
                }
              }
            } finally {
              __renderInProgress = false;
            }
          };

          const onVirtualScroll = () => {
            if (__onScrollQueued) return;
            __onScrollQueued = true;
            requestAnimationFrame(async () => {
              __onScrollQueued = false;
              await renderWindow();
            });
          };

          if (tableScroll) {
            tableScroll.addEventListener('scroll', onVirtualScroll);
            listeners.push(() => tableScroll.removeEventListener('scroll', onVirtualScroll));
          }

          await renderWindow();

        };

        let __refreshPending = null;
        const requestRefresh = async () => {
          if (__refreshPending) return __refreshPending;
          __refreshPending = (async () => {
            try { await refreshTable(); } finally { __refreshPending = null; }
          })();
          return __refreshPending;
        };


// Centralized rerender helper (to be expanded later: scroll-to-changed-row, no manual scroll)
const requestTableRerender = async (info = {}) => {
  try {
    runtime.__lastRerenderInfo = {
      ...(runtime.__lastRerenderInfo || {}),
      ...info,
      at: new Date().toISOString()
    };
  } catch {}
  // requestRefresh triggers refreshTable() which rebuilds UI for the active journal
  return requestRefresh();
};



        async function openAddRowFlow() {
          if (!engine) {
            engine.recompute?.(); await requestRefresh();
            return;
          }

          // Resolve schema (includes column data types from the active journal template)
          const resolvedNow = await resolveSchema(runtime);
          const schemaNow = resolvedNow?.schema ?? { fields: [] };

          // Prefer SWS modal (SettingsWindow) for "+Додати" flow
          if (window.SettingsWindow?.openCustomRoot && window.SettingsWindow?.push) {
            const sws = window.SettingsWindow;

            const formNode = document.createElement('form');
            formNode.className = 'sdo-form sdo-form--add-row';
            formNode.style.maxHeight = '70vh';
            formNode.style.overflow = 'auto';

            const inputs = {};
            const inputOrder = [];
            const errorEls = {};

            const typeHint = (t) => {
              if (t === 'date') return 'Очікується дата (YYYY-MM-DD або DD.MM.YYYY)';
              if (t === 'number') return 'Очікується число';
              if (t === 'bool') return 'Очікується boolean (так/ні, 1/0, +/-, true/false)';
              return 'Текст';
            };

            for (const field of (schemaNow.fields ?? [])) {
              const row = document.createElement('div');
              row.className = 'sdo-form__row';

              const label = document.createElement('label');
              label.textContent = field.label ?? field.key;

              const hint = document.createElement('div');
              hint.className = 'sdo-form__hint';
              hint.textContent = typeHint(field.type);

              const input = document.createElement('input');
              input.className = 'sws-input';
              input.style.width = '100%';
              input.style.boxSizing = 'border-box';

              const t = field.type ?? 'text';
              if (t === 'number') input.type = 'text';
              else if (t === 'date') input.type = 'text';
              else if (t === 'bool') input.type = 'checkbox';
              else input.type = 'text';

              if (input.type === 'checkbox') {
                input.checked = false;
                input.value = '1';
              } else {
                input.placeholder = '';
                input.value = '';
              }

              const err = document.createElement('div');
              err.className = 'sdo-form__error';
              err.style.display = 'none';

              inputs[field.key] = input;
              errorEls[field.key] = err;

              row.appendChild(label);
              row.appendChild(hint);
              row.appendChild(input);
              row.appendChild(err);
              formNode.appendChild(row);

              inputOrder.push(input);

              if (input.type !== 'checkbox') {
                input.addEventListener('input', () => {
                  err.style.display = 'none';
                  input.style.outline = '';
                });
              }
            }

            const validateValues = (values) => {
              const errors = {};
              for (const field of (schemaNow.fields ?? [])) {
                const key = field.key;
                const input = inputs[key];
                const raw = (input?.type === 'checkbox') ? (input.checked ? '1' : '0') : (values[key] ?? '');
                const parsed = defaultParseInput(raw, field);
                const hasText = raw != null && String(raw).trim() !== '';
                if (hasText && parsed.v == null && (field.type === 'number' || field.type === 'date' || field.type === 'bool')) {
                  errors[key] = `Невірний формат: ${typeHint(field.type)}`;
                }
              }
              return errors;
            };

            let __submitInProgress = false;
            const submitAddRow = async () => {
              if (__submitInProgress) return;
              __submitInProgress = true;
              let __submitOk = false;
              try {
                const values = {};
                for (const field of (schemaNow.fields ?? [])) {
                  const input = inputs[field.key];
                  values[field.key] = (input?.type === 'checkbox') ? (input.checked ? '1' : '0') : (input?.value ?? '');
                }

                const errors = validateValues(values);
                for (const k of Object.keys(errorEls)) {
                  errorEls[k].style.display = 'none';
                  if (inputs[k] && inputs[k].type !== 'checkbox') inputs[k].style.outline = '';
                }
                const keys = Object.keys(errors);
                if (keys.length) {
                  try { window.UI?.toast?.show?.('Перевірте поля: невірний формат даних'); } catch {}
                  for (const k of keys) {
                    errorEls[k].textContent = errors[k];
                    errorEls[k].style.display = 'block';
                    if (inputs[k] && inputs[k].type !== 'checkbox') inputs[k].style.outline = '2px solid #d33';
                  }
                  try { inputs[keys[0]]?.focus?.(); } catch {}
                  return;
                }

                const typed = {};
                for (const field of (schemaNow.fields ?? [])) {
                  const raw = values[field.key];
                  const parsed = defaultParseInput(raw, field);
                  typed[field.key] = parsed.v;
                }
                const tx = await runDatasetTxWithRuntime(runtime, currentJournalId, { initiator: 'ui.addRow', reason: 'addRow' }, async (ds) => {
                  const addResult = engine.addRow(typed, ds);
                  if (!addResult?.ok) return { ok: false, nextDataset: ds, meta: { error: 'addRow failed' } };
                  return { ok: true, nextDataset: addResult.dataset, meta: { rowId: addResult?.rowId || addResult?.id || null } };
                });
                if (!tx.ok) {
                  window.UI?.toast?.show?.('Не вдалося додати запис');
                  return;
                }

                try {
                  runtime.__datasetCache = runtime.__datasetCache || {};
                  runtime.__datasetCache[currentJournalId] = tx.nextDataset;
                } catch {}

                engine.recompute?.();
                await requestTableRerender({ reason: 'addRow', journalId: currentJournalId, rowId: tx?.meta?.rowId ?? null });
                __submitOk = true;

                try { sws.close(); } catch {}
                return __submitOk;
              } finally {
                __submitInProgress = false;
              }
            };

            // NOTE: SWS captures Enter on window (capture) and calls screen.onSave.
            // Therefore input-level keydown won't see Enter reliably.
            // We implement the required Enter navigation inside onSave.
            const focusNext = (idx) => {
              const next = inputOrder[idx + 1];
              if (next && next.focus) next.focus();
              else submitAddRow();
            };
            formNode.addEventListener('submit', async (e) => {
              e.preventDefault();
              await submitAddRow();
            });

            sws.openCustomRoot(() => {
              sws.push({
                title: 'Додати запис',
                subtitle: '',
                saveLabel: 'Додати',
                // Enter behavior:
                // - If focus is not on any input: focus first input
                // - If focus on input: Enter -> next input; on last -> submit
                // - If user clicks Save button: submit immediately
                onSave: async () => {
                  const ae = document.activeElement;
                  if (ae && ae.classList && ae.classList.contains('sws-save')) {
                    await submitAddRow();
                    return;
                  }
                  const idx = inputOrder.indexOf(ae);
                  if (idx < 0) {
                    try { inputOrder[0]?.focus?.(); } catch {}
                    return;
                  }
                  focusNext(idx);
                },
                content: () => formNode,
              });
            });

            // Focus first input explicitly
            // Focus first input after SWS mounts content (double RAF to beat initial focus on save button)
            try { requestAnimationFrame(() => requestAnimationFrame(() => { try { inputOrder[0]?.focus?.(); } catch {} })); } catch {
              setTimeout(() => { try { inputOrder[0]?.focus?.(); } catch {} }, 0);
            }
            return;
          }


          // Fallback: if SWS is not available, use UI.modal
          if (window.UI?.modal?.open) {
            let modalId = null;
            formNode.addEventListener('submit', async (e) => {
              e.preventDefault();
              const ok = await submitAddRow();
              if (ok && modalId) {
                try { window.UI.modal.close(modalId); } catch {}
              }
            });
            modalId = window.UI.modal.open({
              title: 'Додати запис',
              contentNode: formNode,
              closeOnOverlay: true,
              escClose: true
            });
            // Focus first input
            // Focus first input after SWS mounts content (double RAF to beat initial focus on save button)
            try { requestAnimationFrame(() => requestAnimationFrame(() => { try { inputOrder[0]?.focus?.(); } catch {} })); } catch {
              setTimeout(() => { try { inputOrder[0]?.focus?.(); } catch {} }, 0);
            }
            return;
          }


          // Absolute fallback (no modal available)
          const first = (schemaNow.fields ?? [])[0];
          const v = window.prompt(`Введіть ${first?.label ?? 'значення'}`, '');
          if (v === null) return;
          const parsed = defaultParseInput(v, first ?? {});
          if (String(v).trim() !== '' && parsed.v == null && (first?.type === 'number' || first?.type === 'date' || first?.type === 'bool')) {
            try { window.UI?.toast?.show?.('Невірний формат даних'); } catch {}
            return;
          }
          const tx = await runDatasetTxWithRuntime(runtime, currentJournalId, { initiator: 'ui.addRow.prompt', reason: 'addRow' }, async (ds) => {
            const addResult = engine.addRow({ [first?.key ?? 'title']: parsed.v }, ds);
            if (!addResult?.ok) return { ok: false, nextDataset: ds, meta: { error: 'addRow failed' } };
            return { ok: true, nextDataset: addResult.dataset, meta: { rowId: addResult?.rowId || addResult?.id || null } };
          });
          if (!tx.ok) {
            window.UI?.toast?.show?.('Не вдалося додати запис');
            return;
          }
          try {
            runtime.__datasetCache = runtime.__datasetCache || {};
            runtime.__datasetCache[currentJournalId] = tx.nextDataset;
          } catch {}
          engine.recompute?.(); await requestRefresh();
        }

        async function openAddSubrowFlow(ownerRowId, { insertAfterId } = {}) {
          if (!engine) {
            engine.recompute?.(); await requestRefresh();
            return;
          }

          const model = engine.getAddFormModel();

          if (window.UI?.modal?.open) {
            const schema = model.map((f) => ({
              id: f.key,
              label: f.label,
              type: f.type || 'text',
              required: !!f.required,
              placeholder: f.placeholder || '',
              options: f.options || null
            }));

            let modalId;
            const onSubmit = async (values) => {
              const tx = await runDatasetTxWithRuntime(runtime, currentJournalId, { initiator: 'ui.addSubrow', reason: 'addSubrow' }, async (ds) => {
                const res = engine.addSubrow(ownerRowId, { insertAfterId, cells: values }, ds);
                return { ok: true, nextDataset: res.dataset, meta: { ownerRowId, insertAfterId: insertAfterId ?? null } };
              });
              if (!tx.ok) {
                window.UI?.toast?.show?.('Не вдалося додати підстроку');
                return;
              }
              try {
                runtime.__datasetCache = runtime.__datasetCache || {};
                runtime.__datasetCache[currentJournalId] = tx.nextDataset;
              } catch {}
              window.UI.modal.close(modalId);
              engine.recompute?.(); await requestRefresh();
            };
            const onCancel = () => window.UI.modal.close(modalId);

            let formNode;
            if (window.UI?.form?.create) {
              formNode = window.UI.form.create({ schema, onSubmit, onCancel });
            } else {
              formNode = document.createElement('form');
              formNode.className = 'sdo-form sdo-form--add-subrow';
              formNode.style.maxHeight = '70vh';
              formNode.style.overflow = 'auto';
              const inputs = {};
              for (const field of schema) {
                const row = document.createElement('div');
                row.className = 'sdo-form__row';
                const label = document.createElement('label');
                label.textContent = field.label;
                const input = document.createElement('input');
                input.type = 'text';
                input.placeholder = field.placeholder || '';
                input.required = !!field.required;
                inputs[field.id] = input;
                row.appendChild(label);
                row.appendChild(input);
                formNode.appendChild(row);
              }
              const actions = document.createElement('div');
              actions.className = 'sdo-form__actions';
              const btnCancel = document.createElement('button');
              btnCancel.type = 'button';
              btnCancel.textContent = 'Скасувати';
              const btnOk = document.createElement('button');
              btnOk.type = 'submit';
              btnOk.textContent = 'Додати';
              actions.append(btnCancel, btnOk);
              formNode.appendChild(actions);
              btnCancel.addEventListener('click', (e) => { e.preventDefault(); onCancel(); });
              formNode.addEventListener('submit', async (e) => {
                e.preventDefault();
                const values = {};
                for (const k of Object.keys(inputs)) values[k] = inputs[k].value ?? '';
                await onSubmit(values);
              });
            }

            modalId = window.UI.modal.open({
              title: 'Додати підстроку',
              contentNode: formNode,
              closeOnOverlay: true,
              escClose: true
            });
            return;
          }

          // Safe fallback: add an empty subrow without prompts.
          const tx = await runDatasetTxWithRuntime(runtime, currentJournalId, { initiator: 'ui.addSubrow.fallback', reason: 'addSubrow' }, async (ds) => {
            const res = engine.addSubrow(ownerRowId, { insertAfterId, cells: {} }, ds);
            return { ok: true, nextDataset: res.dataset, meta: { ownerRowId, insertAfterId: insertAfterId ?? null } };
          });
          if (!tx.ok) {
            window.UI?.toast?.show?.('Не вдалося додати підстроку');
            return;
          }
          try {
            runtime.__datasetCache = runtime.__datasetCache || {};
            runtime.__datasetCache[currentJournalId] = tx.nextDataset;
          } catch {}
          engine.recompute?.(); await requestRefresh();
        }

        addBtn.addEventListener('click', async () => {
          await openAddRowFlow();
        });


        selectBtn.addEventListener('click', async () => {
          selectionMode = !selectionMode;
          engine.recompute?.(); await requestRefresh();
        });

        search.addEventListener('change', async () => {
          const settings = await loadSettings(runtime.storage, currentTemplateId);
          const next = { ...settings, filter: { ...(settings.filter ?? {}), global: search.value ?? '' } };
          await saveSettings(runtime.storage, currentTemplateId, next);
          engine.recompute?.(); await requestRefresh();
        });

        refreshTable();

        return () => {
          cleanupTableToolbar();
          for (const it of listeners) {
            try {
              if (Array.isArray(it)) {
                const [el, type, fn] = it;
                el?.removeEventListener?.(type, fn);
              } else if (typeof it === 'function') {
                it();
              }
            } catch (e) {}
          }
        };
      });
    };

    doRender();
    const off = runtime.sdo.on('state:changed', doRender);
    return () => {
          cleanupTableToolbar();
      off?.();
      cleanup?.();
    };
  }

  return {
    id: '@sdo/module-table-renderer',
    version: '1.0.0',
    async init(ctx) {
      ctx.registerCommands([
        {
          id: '@sdo/module-table-renderer.refresh',
          title: 'Refresh table renderer',
          run: async () => true
        },
        {
          id: '@sdo/module-table-renderer.toggle-selection-mode',
          title: 'Toggle table selection mode',
          run: async () => { selectionMode = !selectionMode; }
        },
        {
  id: 'table.transferRow',
  title: 'Transfer row',
  run: async (runtime, args = {}) => {
    const sourceJournalId = args.sourceJournalId ?? runtime?.api?.getState?.()?.activeJournalId;
    const rowId = args.rowId;
    if (!sourceJournalId || !rowId) return false;

    const tr = globalThis.UI?.transfer;
    if (!tr?.openRowModal) {
      globalThis.UI?.toast?.warning?.('Transfer UI не готовий');
      return false;
    }

    // Include subrows automatically (engine-native).
    let recordIds = [rowId];
    try {
      const resolved = await resolveSchema(runtime);
      const tplId = resolved.journal?.templateId ?? null;
      const settings = await loadSettings(runtime.storage, tplId);
      const schema = resolved.schema;
      const dataset = await loadDataset(runtime, runtime.storage, sourceJournalId);
      const eng = createTableEngine({ schema, settings });
      eng.setDataset(dataset);
      if (typeof eng.getTransferCandidates === 'function') {
        const cand = eng.getTransferCandidates(rowId);
        if (Array.isArray(cand) && cand.length) recordIds = cand;
      }
    } catch (e) {
      // fallback to single row
    }

    await tr.openRowModal({ sourceJournalId, recordIds });
    return true;
  }
}
      ]);

      ctx.ui.registerButton({
        id: '@sdo/module-table-renderer:add-row',
        label: '+ Додати',
        location: 'toolbar',
        order: 30,
        onClick: () => ctx.commands.run('@sdo/module-table-renderer.refresh')
      });

      ctx.ui.registerButton({
        id: '@sdo/module-table-renderer:selection',
        label: 'Вибір',
        location: 'toolbar',
        order: 31,
        onClick: () => ctx.commands.run('@sdo/module-table-renderer.toggle-selection-mode')
      });

      ctx.ui.registerPanel({
        id: '@sdo/module-table-renderer:panel',
        title: 'Table',
        location: 'main',
        order: 5,
        render: (mount, runtime) => {
          if (typeof document === 'undefined') return () => {};
          if (!runtime?.storage) runtime.storage = ctx.storage;
          if (!runtime?.sdo) runtime.sdo = runtime?.api?.sdo;
          return renderPanelFactory(mount, runtime);
        }
      });
    }
  };
}