import { canGoBackJournal, canGoBackSpace } from '../core/navigation_core.js';
import { createSpace, addSpace, deleteSpaceSubtree } from '../core/spaces_tree_core.js';
import { createJournal, addJournal, deleteJournalSubtree } from '../core/journal_tree_core.js';
import { computeTreeNumbering } from '../core/numbering_core.js';
function ensureArray(x){ return Array.isArray(x)?x:(x==null?[]:[x]); }

import { h } from './ui_primitives.js';
import { createModalManager } from './ui_modal.js';
import './theme.js';
import './ui_manager.js';
import './ui_backup.js';
import { openBackupManager } from './backup/backup_manager.js';
import './ui_toast.js';
import { openDebugCenter } from './ui_debug_center.js';
import './settings/settings_registry.js';
import './settings/settings_state.js';
import './settings/features_table_settings.js';
import './settings/features_uxui_settings.js';
import './settings/settings_init.js';
// Legacy settings shell modal removed (SWS v2 is the only settings UI)

// Welcome seed cleanup must be accessible from QuickNav handlers (module scope).
async function cleanupWelcomeSeedAfterFirstUserSpace(sdo, createdSpaceId) {
  try {
    if (!sdo) return;
    const storage = sdo.api && sdo.api.storage ? sdo.api.storage : null;
    const tableStore = sdo.api && sdo.api.tableStore ? sdo.api.tableStore : null;
    if (!storage) return;

    const WELCOME_SPACE_KEY = 'welcome:spaceId';
    const WELCOME_JOURNAL_KEY = 'welcome:journalId';
    const WELCOME_REMOVED_KEY = 'welcome:removed';
    const WELCOME_TEMPLATE_ID = 'welcome8';

    const removed = await storage.get(WELCOME_REMOVED_KEY);
    if (removed) return;

    const welcomeSpaceId = await storage.get(WELCOME_SPACE_KEY);
    const welcomeJournalId = await storage.get(WELCOME_JOURNAL_KEY);
    if (!welcomeSpaceId || welcomeSpaceId === createdSpaceId) return;

    const st = sdo.getState();
    const hasWelcome = Array.isArray(st.spaces) && st.spaces.some((s) => s && s.id === welcomeSpaceId);
    if (!hasWelcome) {
      await storage.set(WELCOME_REMOVED_KEY, true);
      return;
    }

    const removedJournalIds = [];
    await sdo.commit((next) => {
      const res = deleteSpaceSubtree(next.spaces, welcomeSpaceId);
      next.spaces = res.nodes;
      const removedSpaceIds = res.removedIds;
      next.journals = next.journals.filter((j) => {
        const keep = j && !removedSpaceIds.has(j.spaceId);
        if (!keep && j?.id) removedJournalIds.push(j.id);
        return keep;
      });
      if (removedSpaceIds.has(next.activeSpaceId)) {
        next.activeSpaceId = next.spaces[0]?.id ?? null;
        const roots = next.journals.filter((j) => j && j.spaceId === next.activeSpaceId && (!j.parentId || j.parentId === next.activeSpaceId));
        next.activeJournalId = roots[0]?.id ?? null;
      }
      if (next.activeJournalId && !next.journals.some((j) => j.id === next.activeJournalId)) {
        next.activeJournalId = null;
      }
    }, ['spaces_nodes_v2', 'journals_nodes_v2', 'nav_last_loc_v2']);

    // Clean table datasets for removed journals (single source of truth: tableStore)
    try {
      if (tableStore) {
        const ids = new Set([...(removedJournalIds || [])]);
        if (welcomeJournalId) ids.add(welcomeJournalId);
        for (const jid of ids) {
          try {
            if (tableStore.clearJournal) {
              await tableStore.clearJournal(jid);
            } else if (tableStore.removeDataset) {
              await tableStore.removeDataset(jid);
            } else {
              await tableStore.importTableData({ format: 'sdo-table-data', formatVersion: 1, datasets: [{ journalId: jid, records: [] }] }, { mode: 'replace' });
            }
          } catch (_) {}
        }
      }
    } catch (_) {}

    // Remove welcome template if exists
    try {
      const tKey = 'journal_templates_v1';
      const templates = await storage.get(tKey);
      if (templates && typeof templates === 'object') {
        const next = { ...templates };
        if (next[WELCOME_TEMPLATE_ID]) {
          delete next[WELCOME_TEMPLATE_ID];
          await storage.set(tKey, next);
        }
      }
    } catch (_) {}

    await storage.set(WELCOME_REMOVED_KEY, true);
    try { await storage.del(WELCOME_SPACE_KEY); } catch (_) {}
    try { await storage.del(WELCOME_JOURNAL_KEY); } catch (_) {}
  } catch (_) {}
}

async function cleanupWelcomeSeedAfterFirstUserJournal(sdo, { parentId = null } = {}) {
  try {
    const storage = sdo?.api?.storage;
    if (!storage) return;

    const removed = await storage.get('welcome:removed');
    if (removed) return;

    const welcomeSpaceId = await storage.get('welcome:spaceId');
    const welcomeJournalId = await storage.get('welcome:journalId');
    if (!welcomeSpaceId || !welcomeJournalId) return;

    // If the first user action is creating a journal INSIDE the welcome space,
    // we must NOT delete the space (otherwise the newly created journal is lost).
    // In this case we only delete the welcome journal + its dataset + welcome template.
    if (parentId && String(parentId) === String(welcomeSpaceId)) {
      // Remove welcome journal node
      await sdo.commit((next) => {
        const res = deleteJournalSubtree(next.journals, welcomeJournalId);
        next.journals = res.nodes;
        if (res.removedIds?.has?.(next.activeJournalId)) next.activeJournalId = null;
      }, ['journals_nodes_v2', 'nav_last_loc_v2']);

      // Clear welcome journal dataset (replace with empty)
      if (sdo?.api?.tableStore?.importTableData) {
        await sdo.api.tableStore.importTableData({
          format: 'sdo-table-data',
          formatVersion: 1,
          exportedAt: new Date().toISOString(),
          datasets: [{ journalId: welcomeJournalId, records: [] }]
        }, { mode: 'replace' });
      }

      // Remove welcome template if present
      try { await storage.del('welcome:templateId'); } catch (_) {}
      try { await storage.del('welcome:templateTitle'); } catch (_) {}

      await storage.set('welcome:removed', true);
      await storage.del('welcome:spaceId');
      await storage.del('welcome:journalId');
      return;
    }

    // Otherwise (first action is creating a space or journal elsewhere) we can safely remove whole welcome subtree.
    await cleanupWelcomeSeedAfterFirstUserSpace(sdo, null);
  } catch (e) {
    console.warn('cleanupWelcomeSeedAfterFirstUserJournal failed', e);
  }
}


function findById(items, id) {
  return items.find((item) => item.id === id) ?? null;
}

function openQuickNavRoot({ sdo }) {
  const SW = window.SettingsWindow;
  const QN = window.SWSQuickNav;
  if (!SW || !QN) {
    console.warn('QuickNav: SettingsWindow or SWSQuickNav not loaded');
  }

  const buildJTreeSnapshot = (st) => {
    const nodes = {};
    const topIds = [];
    const list = Array.isArray(st.journals)
      ? st.journals.filter((j) => j && j.spaceId === st.activeSpaceId)
      : [];

    // Index journals by id and keep original ordering hints
    const meta = {};
    for (const j of list) {
      meta[j.id] = { idx: typeof j.index === 'number' ? j.index : 1e9, title: String(j.title || j.name || '') };
      nodes[j.id] = {
        id: j.id,
        title: j.title || j.name || j.id,
        key: j.key || j.id,
        parentId: j.parentId || null,
        children: [],
      };
    }

    // Build children arrays + topIds
    for (const j of list) {
      const pid = j.parentId || st.activeSpaceId;
      if (nodes[pid]) nodes[pid].children.push(j.id);
      else topIds.push(j.id);
    }

    const sortIds = (ids) => {
      ids.sort((a, b) => {
        const A = meta[a] || { idx: 1e9, title: '' };
        const B = meta[b] || { idx: 1e9, title: '' };
        if (A.idx !== B.idx) return A.idx - B.idx;
        return A.title.localeCompare(B.title);
      });
    };

    sortIds(topIds);
    for (const id of Object.keys(nodes)) {
      sortIds(nodes[id].children);
    }

    return { nodes, topIds };
  };

  const buildSpaceSnapshot = (spaces) => {
    const nodes = {};
    const rootIds = [];
    const list = Array.isArray(spaces) ? spaces.filter(Boolean) : [];

    // Keep ordering stable: numbering must not renumber existing nodes when a new
    // space is created. Use createdAt (ascending) as the primary ordering key.
    const meta = {};

    for (const sp of list) {
      nodes[sp.id] = {
        id: sp.id,
        title: sp.title || sp.name || sp.id,
        parentId: sp.parentId || null,
        children: [],
      };
      meta[sp.id] = {
        createdAt: sp.createdAt || null,
        title: String(sp.title || sp.name || sp.id || ''),
      };
    }

    for (const sp of list) {
      const pid = sp.parentId || null;
      if (pid && nodes[pid]) nodes[pid].children.push(sp.id);
      else rootIds.push(sp.id);
    }

    const sortIds = (ids) => {
      ids.sort((a, b) => {
        const A = meta[a] || { createdAt: null, title: '' };
        const B = meta[b] || { createdAt: null, title: '' };
        const ca = A.createdAt ? Date.parse(A.createdAt) : NaN;
        const cb = B.createdAt ? Date.parse(B.createdAt) : NaN;
        const ha = Number.isFinite(ca);
        const hb = Number.isFinite(cb);
        if (ha && hb && ca !== cb) return ca - cb; // older first
        if (ha && !hb) return -1;
        if (!ha && hb) return 1;
        return String(A.title).localeCompare(String(B.title));
      });
    };

    sortIds(rootIds);
    for (const id of Object.keys(nodes)) sortIds(nodes[id].children);

    return { nodes, rootIds };
  };

  // SWS-based modal screen for adding a journal (index + template picker).
  // Opens on top of QuickNav, focuses index, Enter=add, Esc=back.
  const openAddJournalModal = async (parentId, { noNavigate = false } = {}) => {
    const templates = await (sdo.journalTemplates?.listTemplateEntities?.() ?? Promise.resolve([]));
    if (!templates || templates.length === 0) {
      if (window.UI?.toast?.show) window.UI.toast.show('Оберіть шаблон: список шаблонів порожній', { type: 'warning' });
      return;
    }

    let selectedTpl = null;
    let search = '';

    const body = document.createElement('div');
    body.className = 'sws-body';

    const card = document.createElement('div');
    card.className = 'sws-card';

    const rowIdx = document.createElement('div');
    rowIdx.className = 'sws-row';
    const idxLabel = document.createElement('div');
    idxLabel.className = 'sws-label';
    idxLabel.textContent = 'Індекс журналу';
    const idxInput = document.createElement('input');
    idxInput.className = 'sws-input';
    idxInput.type = 'number';
    idxInput.inputMode = 'numeric';
    idxInput.placeholder = '1';
    rowIdx.append(idxLabel, idxInput);

    const rowSearch = document.createElement('div');
    rowSearch.className = 'sws-row';
    const tplLabel = document.createElement('div');
    tplLabel.className = 'sws-label';
    tplLabel.textContent = 'Шаблон журналу';
    const tplSearch = document.createElement('input');
    tplSearch.className = 'sws-input';
    tplSearch.placeholder = 'Пошук шаблонів…';
    rowSearch.append(tplLabel, tplSearch);

    const warn = document.createElement('div');
    warn.className = 'sws-hint';
    warn.style.color = 'var(--sws-danger, #b00020)';
    warn.style.display = 'none';

    const list = document.createElement('div');
    list.className = 'sws-list';
    list.style.maxHeight = '240px';
    list.style.overflow = 'auto';

    const addBtn = document.createElement('button');
    addBtn.className = 'sws-btn sws-primary';
    addBtn.textContent = 'Додати';
    addBtn.style.width = '100%';
    addBtn.style.marginTop = '12px';

    function renderList() {
      list.innerHTML = '';
      const q = (search || '').trim().toLowerCase();
      const filtered = !q ? templates : templates.filter((t) => (`${t.title} ${t.id}`).toLowerCase().includes(q));
      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'sws-empty';
        empty.textContent = 'Нічого не знайдено';
        list.appendChild(empty);
        return;
      }
      for (const tpl of filtered) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sws-item';
        btn.textContent = tpl.title;
        if (selectedTpl && selectedTpl.id === tpl.id) btn.classList.add('sws-active');
        btn.onclick = async () => {
          selectedTpl = tpl;
          warn.style.display = 'none';
          renderList();
        };
        list.appendChild(btn);
      }
    }

    tplSearch.addEventListener('input', () => {
      search = tplSearch.value;
      renderList();
    });

    async function doAdd() {
      if (!selectedTpl) {
        warn.textContent = 'Оберіть шаблон журналу';
        warn.style.display = 'block';
        tplSearch.focus();
        return;
      }
      const idxNum = Number.parseInt(idxInput.value, 10);
      const index = Number.isFinite(idxNum) && idxNum > 0 ? idxNum : null;

      const __newJournalId = crypto.randomUUID();

    await sdo.commit((next) => {
      const node = {
        id: __newJournalId,
          spaceId: next.activeSpaceId,
          parentId,
          templateId: selectedTpl.id,
          title: selectedTpl.title || 'Новий журнал',
          childCount: 0,
        };
        if (index != null) node.index = index;
        next.journals = [...(next.journals || []), node];
        if(!noNavigate) next.activeJournalId = node.id;
      }, ['journals_nodes_v2', 'nav_last_loc_v2']);

    await cleanupWelcomeSeedAfterFirstUserJournal(sdo, { parentId });

    try { SW.pop(); } catch (_) {}
    }

    addBtn.onclick = doAdd;

    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        try { SW.pop(); } catch (_) {}
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        doAdd();
      }
    };

    idxInput.addEventListener('keydown', onKey);
    tplSearch.addEventListener('keydown', onKey);

    card.append(rowIdx, rowSearch, list, warn, addBtn);
    body.append(card);

    renderList();
    setTimeout(() => idxInput.focus(), 0);

    SW.push({
      title: 'Додати журнал',
      subtitle: 'Вкажіть індекс та шаблон',
      saveLabel: 'Додати',
      content: () => body,
      onSave: doAdd,
    });
  };

  const open = async () => {
    const adapter = window.UI?.swsAdapter || window.SWSAdapter || null;
    if (adapter && typeof adapter.open === 'function') {
      const legacyContent = document.createElement('div');
      legacyContent.textContent = 'QuickNav доступний лише через SWS у цій версії.';
      const adapterResult = adapter.open({
        screenId: 'quicknav.root',
        swsOpen: () => {
          if (!SW || !QN) throw new Error('QuickNav SWS dependencies are unavailable');
          return openSwsRoot();
        },
        legacy: { title: 'QuickNav', contentNode: legacyContent, closeOnOverlay: true }
      });
      if (adapterResult?.ok) return;
    }

    if (!(await openSwsRoot())) {
      console.warn('QuickNav: unable to open (missing SWS dependencies and adapter fallback)');
    }
  };

  const openSwsRoot = async () => {
    if (!SW || !QN) return false;
    SW.openCustomRoot(() => {
      QN.openQuickNavScreen({
        getData: async () => {
          const st = sdo.getState();
          const spaces = Array.isArray(st.spaces) ? st.spaces : [];

          // Compute tree numbering for spaces (same principle as Transfer tree numbering).
          const sSnap = buildSpaceSnapshot(spaces);
          const sNums = computeTreeNumbering(sSnap.rootIds, (id) => sSnap.nodes[id]?.children || []);

          // Map spaces to the shape expected by QuickNav, with numbering prefix.
          const mappedSpaces = spaces.map((sp) => {
            const rawTitle = sp.title || sp.name || sp.id;
            const num = sNums.get(sp.id) || '';
            const titled = num ? `${num} ${rawTitle}` : rawTitle;
            return {
              id: sp.id,
              name: titled,
              title: titled,
              parentId: sp.parentId || null,
              kind: 'space',
            };
          });

          // Journals tree snapshot for the active space, with numbering prefix.
          const jtree0 = buildJTreeSnapshot(st);
          const jNums = computeTreeNumbering(jtree0.topIds, (id) => jtree0.nodes[id]?.children || []);
          const jtree = {
            nodes: Object.fromEntries(Object.entries(jtree0.nodes).map(([id, n]) => {
              const rawTitle = n.title || String(id);
              const num = jNums.get(id) || '';
              return [id, { ...n, title: num ? `${num} ${rawTitle}` : rawTitle }];
            })),
            topIds: jtree0.topIds,
          };
          return {
            spaces: mappedSpaces,
            activeSpaceId: st.activeSpaceId || (mappedSpaces[0]?.id ?? null),
            jtree,
            activeJournalId: st.activeJournalId || null,
          };
        },
        // Event-driven sync for QuickNav (no polling): re-render when SDO state changes.
        subscribe: (handler) => {
          try {
            return sdo.on('state:changed', () => {
              try { handler(); } catch (_) {}
            });
          } catch (e) {
            return null;
          }
        },
        onGoSpace: async (spaceId) => {
          const stNow = sdo.getState();
          sdo.commit((next) => {
            next.activeSpaceId = spaceId;
            // When switching space, pick first root journal in that space (if any)
            const roots = (Array.isArray(stNow.journals) ? stNow.journals : [])
              .filter((j) => j && j.spaceId === spaceId && (!j.parentId || j.parentId === spaceId));
            next.activeJournalId = roots[0]?.id ?? null;
          });
        },
        onGoJournalPath: async (pathIds) => {
          const targetId = Array.isArray(pathIds) ? pathIds[pathIds.length - 1] : null;
          if (!targetId) return;
          sdo.commit((next) => {
            next.activeJournalId = targetId;
          });
          // Close QuickNav after choosing
          try { SW.close(); } catch (e) {}
        },
        allowAdd: true,
        allowDelete: true,
        onAddSpace: async (arg) => {
          const parentSpaceId = (arg && typeof arg === "object") ? (arg.parentSpaceId ?? null) : (arg ?? null);
          const noNavigate = (arg && typeof arg === "object") ? !!arg.noNavigate : false;
          const title = window.prompt('Назва підпростору:', 'Новий простір');
          if (!title) return;
          let createdSpaceId = null;
          await sdo.commit((next) => {
            const node = createSpace(title, parentSpaceId || null);
            createdSpaceId = node.id;
            next.spaces = addSpace(next.spaces, node);
            if(!noNavigate){
              next.activeSpaceId = node.id;
              next.activeJournalId = null;
            }
          }, ['spaces_nodes_v2', 'nav_last_loc_v2']);
      await cleanupWelcomeSeedAfterFirstUserSpace(sdo, createdSpaceId);
        },
        onDeleteSpace: async (spaceId) => {
          await sdo.commit((next) => {
            const res = deleteSpaceSubtree(next.spaces, spaceId);
            next.spaces = res.nodes;
            next.journals = next.journals.filter((j) => j && !res.removedIds.has(j.spaceId));
            if (res.removedIds.has(next.activeSpaceId)) {
              next.activeSpaceId = next.spaces[0]?.id ?? null;
              const roots = next.journals.filter((j) => j && j.spaceId === next.activeSpaceId && (!j.parentId || j.parentId === next.activeSpaceId));
              next.activeJournalId = roots[0]?.id ?? null;
            }
            if (next.activeJournalId && !next.journals.some((j) => j.id === next.activeJournalId)) {
              next.activeJournalId = null;
            }
          }, ['spaces_nodes_v2', 'journals_nodes_v2', 'nav_last_loc_v2']);
        },
        onAddJournalChild: async (pathIds) => {
          const parentId = Array.isArray(pathIds) && pathIds.length ? pathIds[pathIds.length - 1] : (sdo.getState().activeSpaceId || null);
          await openAddJournalModal(parentId, { noNavigate: true });
        },
        // Add journal at an explicit level (parentId = spaceId for root journals, or journalId for subjournals).
        onAddJournalCurrentLevel: async (arg) => {
          const parentId = (arg && typeof arg === 'object') ? (arg.parentId ?? null) : null;
          await openAddJournalModal(parentId, { noNavigate: true });
        },
        onDeleteJournal: async (journalId) => {
          await sdo.commit((next) => {
            const res = deleteJournalSubtree(next.journals, journalId);
            next.journals = res.nodes;
            if (res.removedIds.has(next.activeJournalId)) next.activeJournalId = null;
          }, ['journals_nodes_v2', 'nav_last_loc_v2']);
        },
      });
    });
  };

  open();
}


export function createModuleManagerUI({ sdo, mount, api }) {
  if (!mount) return null;

  // Step 0: global boot marker for Debug Center (lets user confirm app started).
  try {
    window.__SDO_BOOT_OK__ = {
      at: new Date().toISOString(),
      src: 'src/ui/ui_core.js#createModuleManagerUI',
      note: 'Step0 boot marker',
    };
  } catch (_) {}

  function setStatus(message) {
    if (window.UI?.toast?.show) {
      window.UI.toast.show(message, { type: 'info' });
    }
  }
  const navigationHost = h('div', { class: 'sdo-navigation' });
  const toolbar = h('div', { class: 'sdo-toolbar' });
  const tableToolbarHost = h('div', { class: 'sdo-table-toolbar-host' });
  const panelsHost = h('div', { class: 'sdo-panels' });
  const settingsHost = h('div', { class: 'sdo-settings' });
  settingsHost.style.display = 'none';
  const modalLayer = h('div', { class: 'sdo-modal-layer' });
  const modal = createModalManager(modalLayer);

  function ensureGlobalUIBridge() {
    const UI = (window.UI = window.UI || {});
    UI.settings = UI.settings || {};

    if (!UI.modal || typeof UI.modal.open !== 'function' || typeof UI.modal.close !== 'function') {
      let modalSeq = 0;
      const modalStack = [];

      function closeModalRecord(record) {
        if (!record) return;
        record.cleanup?.();
        record.overlay.remove();
        const idx = modalStack.findIndex((item) => item.id === record.id);
        if (idx >= 0) modalStack.splice(idx, 1);
        try { record.onClose?.(); } catch (_) {}
      }

      function getTopRecord() {
        return modalStack[modalStack.length - 1] || null;
      }

      UI.modal = {
        open(options = {}) {
          modalSeq += 1;
          const modalId = String(modalSeq);

          const overlay = document.createElement('div');
          overlay.className = 'sdo-ui-modal-overlay ui-modal';
          overlay.dataset.modalId = modalId;
          // Ensure the modal is ALWAYS above any other UI layers (incl. SWS v2).
          overlay.style.position = 'fixed';
          overlay.style.inset = '0';
          overlay.style.zIndex = String(999000 + modalSeq);

          const windowNode = document.createElement('div');
          windowNode.className = 'sdo-ui-modal-window';

          const wrapper = h('div', { class: 'ui-modal-content' });
          if (options.title) {
            wrapper.append(h('h3', { class: 'ui-modal-title' }, [options.title]));
          }
          if (options.contentNode) wrapper.append(options.contentNode);
          else if (options.html) {
            const htmlHost = h('div', { class: 'ui-modal-html' });
            htmlHost.innerHTML = options.html;
            wrapper.append(htmlHost);
          }

          windowNode.append(wrapper);
          overlay.append(windowNode);
          document.body.appendChild(overlay);

          const onKeydown = (event) => {
            if (event.key !== 'Escape') return;
            if (options.escClose === false) return;
            const top = getTopRecord();
            if (top?.id !== modalId) return;
            event.preventDefault();
            this.close(modalId);
          };

          const onOverlayMouseDown = (event) => {
            if (options.closeOnOverlay === false) return;
            if (event.target !== overlay) return;
            const top = getTopRecord();
            if (top?.id !== modalId) return;
            this.close(modalId);
          };

          document.addEventListener('keydown', onKeydown);
          overlay.addEventListener('mousedown', onOverlayMouseDown);

          const record = {
            id: modalId,
            overlay,
            onClose: typeof options.onClose === 'function' ? options.onClose : null,
            cleanup() {
              document.removeEventListener('keydown', onKeydown);
              overlay.removeEventListener('mousedown', onOverlayMouseDown);
            }
          };

          modalStack.push(record);
          return modalId;
        },
        close(modalId) {
          if (modalId) {
            const target = modalStack.find((item) => item.id === String(modalId));
            closeModalRecord(target);
            return;
          }
          closeModalRecord(getTopRecord());
        },
        alert(text, opts = {}) {
          const node = h('div', { class: 'ui-modal-content' }, [h('p', {}, [String(text || '')])]);
          return this.open({ title: opts.title || 'Увага', contentNode: node, onClose: opts.onClose });
        },
        confirm(text, opts = {}) {
          return new Promise((resolve) => {
            let settled = false;
            const finalize = async (value) => {
              if (settled) return;
              settled = true;
              resolve(value);
            };

            const content = h('div', { class: 'ui-modal-content' }, [
              h('p', {}, [String(text || opts.title || 'Підтвердити дію?')])
            ]);
            const actions = h('div', { class: 'ui-modal-footer' }, [
              h('button', {
                class: 'btn',
                onClick: () => {
                  UI.modal.close(modalId);
                  finalize(false);
                }
              }, [opts.cancelText || 'Скасувати']),
              h('button', {
                class: 'btn btn-primary',
                onClick: () => {
                  UI.modal.close(modalId);
                  finalize(true);
                }
              }, [opts.okText || 'Підтвердити'])
            ]);
            content.append(actions);

            const modalId = UI.modal.open({
              title: opts.title || 'Підтвердження',
              contentNode: content,
              closeOnOverlay: false,
              onClose: () => finalize(false)
            });
          });
        }
      };
    }

    if (!UI.toast || typeof UI.toast.show !== 'function') {
      UI.toast = {
        async show(message) {
          console.info('[UI.toast]', message);
        }
      };
    }
  }

  ensureGlobalUIBridge();

  const addModuleButton = h('button', {
    class: 'sdo-add-module',
    onClick: async () => {
      const url = window.prompt('Module ESM URL:');
      if (!url) return;
      try {
        await sdo.loadModuleFromUrl(url);
        setStatus(`Module loaded: ${url}`);
      } catch (error) {
        setStatus(`Load failed: ${error.message}`);
      }
    }
  }, ['+ Додати модуль']);

  const templatesButton = h('button', {
    class: 'sdo-add-module',
    onClick: () => openTemplatesManager()
  }, ['Шаблони']);

  const settingsButton = h('button', {
    class: 'sdo-icon-btn sdo-settings-gear',
    onClick: () => openSettingsModal()
  }, ['⚙']);

  const themeButton = h('button', {
    class: 'sdo-icon-btn sdo-theme-toggle',
    title: 'День/Ніч',
    onClick: () => { try { (globalThis.UI?.theme?.toggleTheme || globalThis.UI?.theme?.toggleTheme)?.call(globalThis.UI?.theme); } catch (_) {} }
  }, ['◐']);

  const backupButton = h('button', {
    class: 'sdo-icon-btn sdo-backup-btn',
    title: 'Backup',
    onClick: () => openBackupModal()
  }, ['⛁']);

  const debugButton = h('button', {
    class: 'sdo-icon-btn sdo-debug-btn',
    title: 'Debug Center',
    onClick: () => {
      try { openDebugCenter({ sdo }); } catch (e) { console.error(e); }
    }
  }, ['🧪']);

// -----------------------------
  // Backup / Import / Export modal
  // -----------------------------
  // NOTE: implemented as a separate module (single SWS window)
  function openBackupModal() {
    return openBackupManager({ sdo: (sdo || window.sdo) });
  }


  function closeModal() { modal.close(); }

  function openPicker({ title, kind, items, currentId, getId, onSelect, onAddCurrentLevel, getLabel, getLeftNeighbor, getRightNeighbor }) {
    const idOf = typeof getId === 'function' ? getId : (x) => x?.id;
    let selectedId = currentId ?? (items && items[0] ? idOf(items[0]) : null);

    const header = h('div', { class: 'sdo-picker-header' });
    const titleEl = h('div', { class: 'sdo-picker-title' });

    const navRow = h('div', { class: 'sdo-picker-navrow' });
    const leftBtn = h('button', { class: 'sdo-picker-navbtn' }, ['←']);
    const rightBtn = h('button', { class: 'sdo-picker-navbtn' }, ['→']);
    navRow.append(leftBtn, rightBtn);

    const list = h('div', { class: 'sdo-picker-list' });

    function getSelectedItem() {
      return (items || []).find((it) => idOf(it) === selectedId) || (items && items[0]) || null;
    }

    function renderHeader() {
      const cur = getSelectedItem();
      const label = cur ? getLabel(cur) : '';
      if (kind) titleEl.textContent = `${kind}: ${label}`;
      else titleEl.textContent = title || '';
      const hasCustom = (typeof getLeftNeighbor === 'function') || (typeof getRightNeighbor === 'function');
      if (hasCustom) {
        const left = typeof getLeftNeighbor === 'function' ? getLeftNeighbor(cur) : null;
        const right = typeof getRightNeighbor === 'function' ? getRightNeighbor(cur) : null;
        leftBtn.disabled = !left;
        rightBtn.disabled = !right;
      } else {
        leftBtn.disabled = !items || items.length < 2;
        rightBtn.disabled = !items || items.length < 2;
      }
    }

    async function selectByOffset(delta) {
      if (!items || items.length === 0) return;
      const idx = Math.max(0, items.findIndex((it) => idOf(it) === selectedId));
      const nextIdx = (idx + delta + items.length) % items.length;
      const next = items[nextIdx];
      if (!next) return;
      selectedId = idOf(next);
      await onSelect(next);
      renderAll(); // keep picker open
    }

    leftBtn.onclick = async () => {
      const cur = getSelectedItem();
      if (typeof getLeftNeighbor === 'function') {
        const left = getLeftNeighbor(cur);
        if (!left) return;
        await onSelect(left);
        closeModal();
        return;
      }
      await selectByOffset(-1);
    };
    rightBtn.onclick = async () => {
      const cur = getSelectedItem();
      if (typeof getRightNeighbor === 'function') {
        const right = getRightNeighbor(cur);
        if (!right) return;
        await onSelect(right);
        closeModal();
        return;
      }
      await selectByOffset(1);
    };

    async function renderList() {
      list.innerHTML = '';
      for (const item of items || []) {
        const row = h('button', {
          class: `sdo-picker-row ${idOf(item) === selectedId ? 'is-selected' : ''}`,
          onClick: async () => {
            await onSelect(item);
            closeModal();
          }
        }, [getLabel(item)]);
        list.append(row);
      }
    }

    async function renderAll() {
      renderHeader();
      renderList();
    }

    const modalChildren = [
      header,
      list
    ];
    header.append(titleEl);
    header.append(navRow);

    if (typeof onAddCurrentLevel === 'function') {
      modalChildren.push(h('button', {
        class: 'sdo-picker-add',
        onClick: async () => {
          closeModal();
          await onAddCurrentLevel();
        }
      }, ['+ Додати на цей рівень']));
    }

    modalChildren.push(h('button', { class: 'sdo-picker-close', onClick: closeModal }, ['Закрити']));
    modal.open(h('div', { class: 'sdo-picker-modal' }, modalChildren), { closeOnOverlay: true });
    renderAll();
  }

  // Tree picker for selecting current Space/Journal at any level.
  // Arrows always enabled:
  //   ← goes to parent (if none: shows notice)
  //   → goes to first child (if none: shows notice)
  // Picker stays open on arrow navigation, closes only when selecting an item from the list or pressing Close.
  function openTreePicker({ kind, getCurrent, getSiblings, getParent, getFirstChild, getId, getLabel, onSelect, onAddCurrentLevel, noticeNoParent, noticeNoChildren }) {
    const idOf = typeof getId === 'function' ? getId : (x) => x?.id;

    // Persistent overlay appended to <body> so it doesn't disappear on app re-renders/state commits
    const overlay = document.createElement('div');
    overlay.className = 'sdo-picker-overlay';
    const host = document.createElement('div');
    host.className = 'sdo-picker-modal';
    overlay.appendChild(host);

    const closePicker = async () => {
      try { overlay.remove(); } catch (_) {}
      try { document.body.classList.remove('sdo-modal-open'); } catch (_) {}
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closePicker();
    });

    document.body.appendChild(overlay);
    document.body.classList.add('sdo-modal-open');

    const header = h('div', { class: 'sdo-picker-header' });
    const titleEl = h('div', { class: 'sdo-picker-title' });
    const navRow = h('div', { class: 'sdo-picker-navrow' });
    const leftBtn = h('button', { class: 'sdo-picker-navbtn' }, ['←']);
    const rightBtn = h('button', { class: 'sdo-picker-navbtn' }, ['→']);
    navRow.append(leftBtn, rightBtn);

    const noticeEl = h('div', { class: 'sdo-picker-notice', style: 'display:none;' });
    const list = h('div', { class: 'sdo-picker-list' });

    let current = (typeof getCurrent === 'function' ? getCurrent() : null) || null;
    let selectedId = current ? idOf(current) : null;

    function showNotice(msg) {
      if (!msg) return;
      noticeEl.textContent = msg;
      noticeEl.style.display = '';
      clearTimeout(showNotice._t);
      showNotice._t = setTimeout(() => {
        noticeEl.style.display = 'none';
        noticeEl.textContent = '';
      }, 1600);
    }

    async function render() {
      current = (typeof getCurrent === 'function' ? getCurrent() : current) || current || null;
      selectedId = current ? idOf(current) : selectedId;

      const label = current ? getLabel(current) : '';
      titleEl.textContent = `${kind}: ${label}`;

      // Always active by requirement
      leftBtn.disabled = false;
      rightBtn.disabled = false;

      const siblings = ensureArray(typeof getSiblings === 'function' ? getSiblings(current) : []);
      list.innerHTML = '';
      if (siblings.length === 0) {
        list.append(h('div', { class: 'sdo-picker-empty' }, ['— Немає елементів на цьому рівні —']));
      } else {
        for (const item of siblings) {
          const row = h('button', {
            class: `sdo-picker-row ${idOf(item) === selectedId ? 'is-selected' : ''}`,
            onClick: async () => {
              await onSelect(item);
              closePicker(); // closes on selecting space/journal
            }
          }, [getLabel(item)]);
          list.append(row);
        }
      }
    }

    async function goParent() {
      const p = typeof getParent === 'function' ? getParent(current) : null;
      if (!p) {
        showNotice(noticeNoParent || `Цей ${kind.toLowerCase()} не має батьківського рівня`);
        return;
      }
      await onSelect(p);
      requestAnimationFrame(() => { if (!document.body.contains(overlay)) document.body.appendChild(overlay); });
      render();
    }

    async function goFirstChild() {
      const ch = typeof getFirstChild === 'function' ? getFirstChild(current) : null;
      if (!ch) {
        showNotice(noticeNoChildren || `Цей ${kind.toLowerCase()} не має дочірніх`);
        return;
      }
      await onSelect(ch);
      requestAnimationFrame(() => { if (!document.body.contains(overlay)) document.body.appendChild(overlay); });
      render();
    }

    leftBtn.onclick = (e) => { try{e?.stopPropagation?.(); e?.preventDefault?.();}catch(_){} goParent(); };
    rightBtn.onclick = (e) => { try{e?.stopPropagation?.(); e?.preventDefault?.();}catch(_){} goFirstChild(); };

    header.append(titleEl, navRow, noticeEl);
    const footer = h('div', { class: 'sdo-picker-footer' });
    if (typeof onAddCurrentLevel === 'function') {
      footer.append(h('button', {
        class: 'sdo-picker-add',
        onClick: async () => {
          try { await onAddCurrentLevel(current); } catch (e) { console.error(e); }
          render();
        }
      }, ['+ Додати на цей рівень']));
    }
    footer.append(h('button', { class: 'sdo-picker-close', onClick: closePicker }, ['Закрити']));

    host.append(header, list, footer);
    render();
  }


  // Picker for selecting a CHILD of the current parent, with left/right switching the PARENT
  // and auto-selecting the first child of the neighboring parent.
  
function openChildPicker({ kind, parents, currentParentId, getParentId, getParentLabel, getChildren, getChildId, getChildLabel, onSelectChild }) {
    const pid = typeof getParentId === 'function' ? getParentId : (x) => x?.id;
    const cid = typeof getChildId === 'function' ? getChildId : (x) => x?.id;

    // Persistent overlay appended to <body> so it doesn't disappear on app re-renders/state commits
    const overlay = document.createElement('div');
    overlay.className = 'sdo-picker-overlay';
    const host = document.createElement('div');
    host.className = 'sdo-picker-modal';
    overlay.appendChild(host);

    const closePicker = async () => {
      try { overlay.remove(); } catch (_) {}
      try { document.body.classList.remove('sdo-modal-open'); } catch (_) {}
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closePicker();
    });

    document.body.appendChild(overlay);
    document.body.classList.add('sdo-modal-open');

    let parentIdx = Math.max(0, (parents || []).findIndex((p) => pid(p) === currentParentId));
    if (!Number.isFinite(parentIdx) || parentIdx < 0) parentIdx = 0;

    let children = ensureArray(getChildren?.((parents || [])[parentIdx]));
    let selectedChildId = children?.[0] ? cid(children[0]) : null;

    const header = h('div', { class: 'sdo-picker-header' });
    const titleEl = h('div', { class: 'sdo-picker-title' });
    const navRow = h('div', { class: 'sdo-picker-navrow' });
    const leftBtn = h('button', { class: 'sdo-picker-navbtn' }, ['←']);
    const rightBtn = h('button', { class: 'sdo-picker-navbtn' }, ['→']);
    navRow.append(leftBtn, rightBtn);

    const list = h('div', { class: 'sdo-picker-list' });

    function renderHeader() {
      const parent = parents?.[parentIdx] || null;
      const label = parent ? getParentLabel(parent) : '';
      titleEl.textContent = `${kind}: ${label}`;
      leftBtn.disabled = !parents || parents.length < 2;
      rightBtn.disabled = !parents || parents.length < 2;
    }

    async function renderList() {
      list.innerHTML = '';
      if (!children || children.length === 0) {
        list.append(h('div', { class: 'sdo-picker-empty' }, ['— Немає елементів на цьому рівні —']));
        return;
      }
      for (const ch of children) {
        list.append(h('button', {
          class: `sdo-picker-row ${cid(ch) === selectedChildId ? 'is-selected' : ''}`,
          onClick: async () => {
            selectedChildId = cid(ch);
            await onSelectChild(ch);
            closePicker();
          }
        }, [getChildLabel(ch)]));
      }
    }

    async function switchParent(delta) {
      if (!parents || parents.length === 0) return;
      parentIdx = (parentIdx + delta + parents.length) % parents.length;
      const parent = parents[parentIdx];
      children = ensureArray(getChildren?.(parent));
      const first = children?.[0] || null;
      selectedChildId = first ? cid(first) : null;

      // Switch selection immediately but KEEP picker open
      if (first) {
        await onSelectChild(first);
        // Ensure picker overlay stays mounted even if app rerender replaces DOM
        requestAnimationFrame(()=>{
          if(!document.body.contains(overlay)) document.body.appendChild(overlay);
        });
      }
      renderAll();
    }

    leftBtn.onclick = (e) => { try{e?.stopPropagation?.(); e?.preventDefault?.();}catch(_){} switchParent(-1); };
    rightBtn.onclick = (e) => { try{e?.stopPropagation?.(); e?.preventDefault?.();}catch(_){} switchParent(1); };

    async function renderAll() {
      renderHeader();
      renderList();
    }

    header.append(titleEl, navRow);
    const footer = h('div', { class: 'sdo-picker-footer' });
    if (typeof onAddCurrentLevel === 'function') {
      footer.append(h('button', {
        class: 'sdo-picker-add',
        onClick: async () => {
          try { await onAddCurrentLevel(current); } catch (e) { console.error(e); }
          render();
        }
      }, ['+ Додати на цей рівень']));
    }
    footer.append(h('button', { class: 'sdo-picker-close', onClick: closePicker }, ['Закрити']));

    host.append(header, list, footer);
    renderAll();
  }

async function openTemplatesManager() {
    let selectedId = null;
    let deleteArmed = false;

    const title = h('div', { class: 'sdo-picker-title' }, ['Шаблони журналів']);
    const listHost = h('div', { class: 'sdo-picker-list' });
    const detailsHost = h('div', { class: 'sdo-template-details' }, ['Оберіть шаблон']);
    const actions = h('div', { class: 'sdo-template-actions' });

    async function refresh() {
      const templates = await sdo.journalTemplates.listTemplateEntities();
      if (!selectedId && templates[0]) selectedId = templates[0].id;
      if (selectedId && !templates.some((t) => t.id === selectedId)) selectedId = templates[0]?.id ?? null;

      listHost.innerHTML = '';
      for (const tpl of templates) {
        listHost.append(h('button', {
          class: `sdo-picker-row ${tpl.id === selectedId ? 'is-selected' : ''}`,
          onClick: () => {
            selectedId = tpl.id;
            deleteArmed = false;
            refresh();
          }
        }, [`${tpl.title} (${tpl.columns.length})`]));
      }

      const selected = templates.find((x) => x.id === selectedId) ?? null;
      if (!selected) {
        detailsHost.innerHTML = 'Немає шаблонів';
      } else {
        detailsHost.innerHTML = '';
        detailsHost.append(h('div', { class: 'sdo-template-title' }, [`ID: ${selected.id}`]));
        for (const col of selected.columns) {
          detailsHost.append(h('div', { class: 'sdo-template-col' }, [`• ${col.label} (${col.key})`]));
        }
      }

      actions.innerHTML = '';
      actions.append(
        h('button', {
          class: 'sdo-picker-add',
          onClick: async () => {
            const id = window.prompt('ID шаблону (без пробілів):', 'new-template');
            if (!id) return;
            const titleValue = window.prompt('Назва шаблону:', id) ?? id;
            const colsRaw = window.prompt('Назви колонок через кому:', '1,2,3');
            if (!colsRaw) return;
            const labels = colsRaw.split(',').map((x) => x.trim()).filter(Boolean);
            await sdo.journalTemplates.addTemplate({
              id,
              title: titleValue,
              columns: labels.map((label, idx) => ({ key: `c${idx + 1}`, label }))
            });
            selectedId = id;
            deleteArmed = false;
            await refresh();
          }
        }, ['Додати шаблон']),
        h('button', {
          class: 'sdo-picker-close',
          onClick: async () => {
            if (!selectedId) return;
            if (!deleteArmed) {
              deleteArmed = true;
              await refresh();
              return;
            }
            await sdo.journalTemplates.deleteTemplate(selectedId);
            selectedId = null;
            deleteArmed = false;
            await refresh();
          }
        }, [deleteArmed ? 'Так, видалити' : 'Видалити шаблон']),
        h('button', {
          class: 'sdo-picker-close',
          onClick: () => {
            deleteArmed = false;
            closeModal();
          }
        }, [deleteArmed ? 'Ні' : 'Закрити'])
      );
    }

    const modalEl = h('div', { class: 'sdo-picker-modal' }, [title, listHost, detailsHost, actions]);
    modal.open(modalEl, { closeOnOverlay: true });
    await refresh();
  }

  async function openSettingsModal() {
    const SW = window.SettingsWindow;
    if (!SW || typeof SW.openRoot !== 'function') {
      const msg = 'SettingsWindow v2 не підключено: перевірте index.html (sws_modal.js/css/html).';
      if (window.UI?.toast?.error) window.UI.toast.error(msg);
      else window.alert(msg);
      return;
    }

    // Ensure initialized once
    try { SW.init?.(); } catch (_) {}

    const uiToast = window.UI?.toast;

    const slugify = (s) => String(s || '').toLowerCase()
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_\u0400-\u04FF]+/g, '')
      .replace(/^_+|_+$/g, '');

    // NOTE: must be synchronous. TransferCore expects a plain object with get/set/del.
    // If this becomes async, callers MUST await it, otherwise TransferCore will
    // receive a Promise and crash with "storage.get is not a function".
    const kvStorage = (base) => {
      if (!base || typeof base.get !== 'function' || typeof base.set !== 'function' || typeof base.del !== 'function') {
        throw new Error('UI.storage must be provided (IndexedDB storage adapter).');
      }
      return base;
    };


    // Build list of "sheets" for transfer templates settings. In template-oriented transfer this list must
    // represent JOURNAL TEMPLATES (not concrete journals).
    async function buildSheets() {
      const sheets = [];
      let entities = [];
      try {
        entities = await sdo.journalTemplates.listTemplateEntities();
      } catch (_) {
        entities = [];
      }
      for (const ent of (Array.isArray(entities) ? entities : [])) {
        const tplId = ent.id;
        if (!tplId) continue;
        let tpl = null;
        try { tpl = await sdo.journalTemplates.getTemplate(tplId); } catch (_) { tpl = null; }
        let columns = [];
        if (tpl && Array.isArray(tpl.columns) && tpl.columns.length) {
          columns = tpl.columns.map(c => ({ id: c.key, name: c.label ?? c.key }));
        } else {
          // If template structure is unavailable, keep a safe placeholder column.
          columns = [{ id: 'c1', name: 'Колонка 1' }];
        }
        const name = ent.title || ent.name || tpl?.title || tplId;
        sheets.push({ key: tplId, name, columns });
      }
      if (!sheets.length) {
        sheets.push({ key: 'default', name: 'Default', columns: [{ id: 'c1', name: 'Колонка 1' }] });
      }
      return sheets;
    }

    function openAddJournalTemplateScreen() {
      let title = '';
      let count = 5;
      let colNames = Array(count).fill('').map((_,i)=>`Колонка ${i+1}`);

      const computeCanSave = () => title.trim().length > 0 && count > 0 && colNames.every(n => String(n||'').trim().length>0);

      SW.push({
        title: 'Додати шаблон журналу',
        subtitle: 'Назва шаблону, кількість колонок та їх назви',
        saveLabel: 'Створити',
        canSave: () => computeCanSave(),
        onSave: async () => {
          const baseId = 'custom_' + (slugify(title) || 'template');
          let id = baseId;
          let n = 2;
          const existing = await sdo.journalTemplates.listTemplateEntities();
          const ids = new Set(existing.map(t => t.id));
          while (ids.has(id)) { id = baseId + '_' + (n++); }
          const columns = Array.from({length: count}).map((_,i)=>({ key: `c${i+1}`, label: colNames[i].trim() }));
          await sdo.journalTemplates.addTemplate({ id, title: title.trim(), columns });
          if (uiToast?.success) uiToast.success(`Шаблон створено: ${title.trim()}`);
          else if (uiToast?.show) uiToast.show(`Шаблон створено: ${title.trim()}`);
          else window.alert(`Шаблон створено: ${title.trim()}`);
          SW.pop();
        },
        content: (ctx) => {
          const ui = ctx.ui;
          const wrap = ui.el('div','');

          const syncSave = async () => {
            try { ctx.setSaveEnabled(!!computeCanSave()); } catch (_) {}
          };

          const titleInput = ui.input({
            value: title,
            placeholder: 'Напр.: Вхідні документи',
            onChange: (v) => { title = v; syncSave(); }
          });
          wrap.appendChild(ui.controlRow({ label: 'Назва шаблону', help: '', controlEl: titleInput }));

          const countInput = ui.input({
            value: String(count),
            type: 'number',
            placeholder: '5',
            onChange: (v) => {
              const next = Math.max(1, Math.min(50, parseInt(v||'0',10) || 1));
              if (next === count) return;
              count = next;
              const nextArr = Array(count).fill('');
              for (let i=0;i<Math.min(colNames.length,count);i++) nextArr[i]=colNames[i];
              for (let i=0;i<count;i++) if (!nextArr[i]) nextArr[i]=`Колонка ${i+1}`;
              colNames = nextArr;
              renderCols();
              syncSave();
            }
          });
          countInput.min = '1';
          countInput.max = '50';
          wrap.appendChild(ui.controlRow({ label: 'Кількість колонок', help: '1–50', controlEl: countInput }));

          const colsCardBody = ui.el('div','');
          const colsCard = ui.card({ title: 'Назви колонок', description: '', children: [colsCardBody] });
          wrap.appendChild(colsCard);

          function renderCols(){
            colsCardBody.innerHTML='';
            for (let i=0;i<count;i++){
              const inp = ui.input({
                value: colNames[i] || '',
                placeholder: `Колонка ${i+1}`,
                onChange: (v)=>{ colNames[i]=v; syncSave(); }
              });
              colsCardBody.appendChild(ui.controlRow({ label: `${i+1}.`, help: '', controlEl: inp }));
            }
          }
          renderCols();

          // Initialize save state on first render
          syncSave();

          return wrap;
        }
      });
    }

    async function openJournalTemplatesListScreen(){
      let templates = await sdo.journalTemplates.listTemplateEntities();
      let deleteArmedId = null;

      const makeTplLabel = (t) => t?.title || t?.name || t?.id || 'Без назви';

      SW.push({
        title: 'Шаблони журналів',
        subtitle: 'Перелік шаблонів журналів та видалення',
        content: (ctx) => {
          const ui = ctx.ui;
          const wrap = ui.el('div','');
          const list = ui.el('div','sws-list');
          wrap.appendChild(list);

          const render = async () => {
            list.innerHTML = '';
            (templates || []).forEach((t) => {
              const row = ui.el('div','sws-item');
              const left = ui.el('div','sws-item-left');
              left.appendChild(ui.el('div','sws-item-label', makeTplLabel(t)));
              left.appendChild(ui.el('div','sws-item-desc', `${t?.columns?.length||0} колонок • ${t?.id||''}`.trim()));

              const actions = ui.el('div','sws-item-actions');
              const delBtn = ui.el('button', `sws-mini-btn sws-mini-danger ${deleteArmedId===t.id?'is-armed':''}`, deleteArmedId===t.id ? 'Підтв' : '🗑');
              delBtn.title = deleteArmedId===t.id ? 'Підтвердити видалення' : 'Видалити шаблон';
              delBtn.onclick = async (ev) => {
                ev.stopPropagation();
                if (!t?.id) return;
                if (deleteArmedId !== t.id) {
                  deleteArmedId = t.id;
                  render();
                  return;
                }
                if (!window.confirm(`Видалити шаблон журналу “${makeTplLabel(t)}”?`)) {
                  deleteArmedId = null;
                  render();
                  return;
                }
                await sdo.journalTemplates.deleteTemplate(t.id);
                templates = await sdo.journalTemplates.listTemplateEntities();
                deleteArmedId = null;
                uiToast?.success?.('Шаблон видалено') ?? uiToast?.show?.('Шаблон видалено');
                render();
              };

              actions.appendChild(delBtn);
              row.appendChild(left);
              row.appendChild(actions);
              row.appendChild(ui.el('div','sws-chevron','›'));

              row.onclick = async () => {
                deleteArmedId = null;
                const tpl = await sdo.journalTemplates.getTemplate(t.id);
                SW.push({
                  title: makeTplLabel(t),
                  subtitle: `ID: ${t.id}`,
                  content: (ctx2) => {
                    const ui2 = ctx2.ui;
                    const w = ui2.el('div','');
                    const colsBody = ui2.el('div','');
                    (tpl?.columns||[]).forEach(c => colsBody.appendChild(ui2.el('div','sws-muted', `• ${c.label} (${c.key})`)));
                    w.appendChild(ui2.card({ title: 'Колонки', description: '', children: [colsBody] }));
                    return w;
                  }
                });
              };

              list.appendChild(row);
            });
          };

          render();
          return wrap;
        }
      });
    }

    const { createTransferCore } = await import('../core/transfer_core.js');
    const transferCore = createTransferCore({ storage: kvStorage(window.UI?.storage) });

    
    async function openTransferTemplatesScreen(){
      const sheets = await buildSheets();
      let templates = await transferCore.loadTemplates();
      let deleteArmedId = null;

      const makeTplLabel = (t) => t?.name || t?.title || t?.id || 'Без назви';

      const refresh = async (ctx) => {
        templates = await transferCore.loadTemplates();
        if (ctx && typeof ctx.render === 'function') ctx.render();
      };

      SW.push({
        title: 'Перенесення',
        subtitle: 'Шаблони перенесення',
        content: (ctx) => {
          const ui = ctx.ui;
          const wrap = ui.el('div','');
          const list = ui.el('div','sws-list');
          wrap.appendChild(list);

          const render = async () => {
            list.innerHTML = '';

            templates.forEach((t, i) => {
              const row = ui.el('div','sws-item');
              const left = ui.el('div','sws-item-left');
              left.appendChild(ui.el('div','sws-item-label', makeTplLabel(t)));
              left.appendChild(ui.el('div','sws-item-desc', `${t?.routes?.length||0} маршрут(ів)`));

              const actions = ui.el('div','sws-item-actions');

              const delBtn = ui.el('button', `sws-mini-btn sws-mini-danger ${deleteArmedId===t.id?'is-armed':''}`, deleteArmedId===t.id ? 'Підтв' : '🗑');
              delBtn.title = deleteArmedId===t.id ? 'Підтвердити видалення' : 'Видалити шаблон';
              delBtn.onclick = async (ev) => {
                ev.stopPropagation();
                if (deleteArmedId !== t.id) {
                  deleteArmedId = t.id;
                  render();
                  return;
                }
                if (!window.confirm(`Видалити шаблон перенесення “${makeTplLabel(t)}”?`)) {
                  deleteArmedId = null;
                  render();
                  return;
                }
                templates.splice(i, 1);
                await transferCore.saveTemplates(templates);
                deleteArmedId = null;
                uiToast?.success?.('Шаблон видалено') ?? uiToast?.show?.('Шаблон видалено');
                await refresh({ render });
              };

              const che = ui.el('div','sws-chevron','›');

              actions.appendChild(delBtn);
              row.appendChild(left);
              row.appendChild(actions);
              row.appendChild(che);

              row.onclick = async () => {
                deleteArmedId = null;
                templates = await transferCore.loadTemplates();
                const tpl = templates[i];
                if (!tpl) return;
                openTransferTemplateEditor({ sheets, templates, idx: i });
              };

              list.appendChild(row);
            });

            const addBtn = ui.el('button','sws-btn-primary','+ Додати шаблон');
            addBtn.onclick = async () => {
              templates = await transferCore.loadTemplates();
              const next = { id: crypto.randomUUID(), name: 'Новий шаблон', fromSheetKey: sheets[0]?.key, toSheetKey: sheets[0]?.key, routes: [] };
              templates.push(next);
              await transferCore.saveTemplates(templates);
              uiToast?.success?.('Шаблон додано') ?? uiToast?.show?.('Шаблон додано');
              await refresh({ render });
            };
            list.appendChild(addBtn);
          };

          render();
          return wrap;
        }
      });
    }

    
    async function openTransferTemplateEditor({ sheets, templates, idx }){
      const t = templates[idx];
      let name = t.name || 'Шаблон';
      let fromSheetKey = t.fromSheetKey || sheets[0]?.key;
      let toSheetKey = t.toSheetKey || sheets[0]?.key;

      const sheetOptions = sheets.map(s=>({ value: s.key, label: s.name }));

      SW.push({
        title: name,
        subtitle: 'Маршрути перенесення',
        saveLabel: 'Зберегти',
        canSave: ()=> true,
        onSave: async ()=>{
          t.name = name;
          t.fromSheetKey = fromSheetKey;
          t.toSheetKey = toSheetKey;
          await transferCore.saveTemplates(templates);
          uiToast?.success?.('Шаблон збережено') ?? uiToast?.show?.('Шаблон збережено');
        },
        content: (ctx)=>{
          const ui=ctx.ui;
          const wrap=ui.el('div','');

          const nameInp = ui.input({ value: name, placeholder: 'Назва шаблону', onChange:(v)=>{ name=v; } });
          wrap.appendChild(ui.controlRow({ label:'Назва', help:'', controlEl:nameInp }));

          const fromSel = ui.select({ value: fromSheetKey, options: sheetOptions, onChange:(v)=>{ fromSheetKey=v; } });
          wrap.appendChild(ui.controlRow({ label:'З листа', help:'', controlEl: fromSel }));

          const toSel = ui.select({ value: toSheetKey, options: sheetOptions, onChange:(v)=>{ toSheetKey=v; } });
          wrap.appendChild(ui.controlRow({ label:'У лист', help:'', controlEl: toSel }));

          const routesCardBody = ui.el('div','');
          const routesCard = ui.card({ title:'Маршрути', description:'Кожен маршрут пише в одну цільову колонку', children:[routesCardBody] });
          wrap.appendChild(routesCard);

          const renderRoutes = ()=>{
            routesCardBody.innerHTML='';
            const routes = Array.isArray(t.routes)?t.routes: (t.routes=[]);
            const toSheet = sheets.find(s=>s.key===toSheetKey) || sheets[0];

            const moveRoute = (fromIdx, toIdx) => {
              if (toIdx < 0) toIdx = 0;
              if (toIdx >= routes.length) toIdx = routes.length - 1;
              if (fromIdx === toIdx) return;
              const [it] = routes.splice(fromIdx, 1);
              routes.splice(toIdx, 0, it);
            };

            for(let i=0;i<routes.length;i++){
              const rr=routes[i];
              const tgt = Number.isFinite(+rr.targetCol)?(+rr.targetCol):0;
              const tgtName = toSheet?.columns?.[tgt]?.name || `Колонка ${tgt+1}`;

              const row = ui.el('div','sws-item');
              const left = ui.el('div','sws-item-left');

              const labelRow = ui.el('div','sws-route-row');
              const orderBtn = ui.el('button','sws-mini-btn sws-mini-order', String(i+1));
              orderBtn.title = 'Змінити номер (перемістити)';
              orderBtn.onclick = (ev)=>{
                ev.stopPropagation();
                const raw = window.prompt('Новий номер (1…'+routes.length+'):', String(i+1));
                if (!raw) return;
                const n = Math.max(1, Math.min(routes.length, parseInt(raw,10)|| (i+1)));
                moveRoute(i, n-1);
                renderRoutes();
              };

              const label = ui.el('div','sws-item-label', `→ ${tgtName}`);
              labelRow.appendChild(orderBtn);
              labelRow.appendChild(label);
              left.appendChild(labelRow);

              left.appendChild(ui.el('div','sws-item-desc', `${(rr.sources||[]).length} джерел, op=${rr.op||'concat'}`));

              const actions = ui.el('div','sws-item-actions');

              const upBtn = ui.el('button','sws-mini-btn', '▲');
              upBtn.title = 'Вгору';
              upBtn.disabled = i===0;
              upBtn.onclick = (ev)=>{ ev.stopPropagation(); moveRoute(i, i-1); renderRoutes(); };

              const downBtn = ui.el('button','sws-mini-btn', '▼');
              downBtn.title = 'Вниз';
              downBtn.disabled = i===routes.length-1;
              downBtn.onclick = (ev)=>{ ev.stopPropagation(); moveRoute(i, i+1); renderRoutes(); };

              const delBtn = ui.el('button','sws-mini-btn sws-mini-danger','🗑');
              delBtn.title = 'Видалити маршрут';
              delBtn.onclick = (ev)=>{
                ev.stopPropagation();
                if (!window.confirm('Видалити маршрут #'+(i+1)+'?')) return;
                routes.splice(i,1);
                renderRoutes();
              };

              const che = ui.el('div','sws-chevron','›');

              actions.appendChild(upBtn);
              actions.appendChild(downBtn);
              actions.appendChild(delBtn);

              row.appendChild(left);
              row.appendChild(actions);
              row.appendChild(che);

              row.onclick=()=> openTransferRouteEditor({ sheets, templates, tplIdx: idx, routeIdx: i });
              routesCardBody.appendChild(row);
            }

            const addBtn = ui.el('button','sws-btn-primary','+ Додати маршрут');
            addBtn.onclick=()=>{ routes.push({ sources: [], op:'concat', delimiter:' ', targetCol: 0 }); renderRoutes(); };
            routesCardBody.appendChild(addBtn);
          };

          renderRoutes();

          return wrap;
        }
      });
    }

    function openTransferRouteEditor({ sheets, templates, tplIdx, routeIdx }){
      const tpl = templates[tplIdx];
      const rr = tpl.routes[routeIdx];
      const fromSheet = sheets.find(s=>s.key===tpl.fromSheetKey) || sheets[0];
      const toSheet = sheets.find(s=>s.key===tpl.toSheetKey) || sheets[0];

      let op = rr.op || 'concat';
      let delimiter = rr.delimiter ?? ' ';
      let targetCol = Number.isFinite(+rr.targetCol)?(+rr.targetCol):0;
      let sources = Array.isArray(rr.sources)?rr.sources.slice():[];

      const opOptions = [
        { value:'concat', label:'concat (з розділювачем)' },
        { value:'seq', label:'seq (без розділювача)' },
        { value:'newline', label:'newline (з нової строки)' },
        { value:'sum', label:'sum (сума чисел)' }
      ];

      const tgtOptions = (toSheet?.columns||[]).map((c,i)=>({ value:String(i), label:`${i+1}. ${c.name}` }));

      SW.push({
        title: 'Маршрут',
        subtitle: `З ${fromSheet?.name||''} → ${toSheet?.name||''}`,
        saveLabel: 'Зберегти',
        canSave: ()=> true,
        onSave: async ()=>{
          rr.op = op;
          rr.delimiter = delimiter;
          rr.targetCol = targetCol;
          rr.sources = sources.slice();
          await transferCore.saveTemplates(templates);
          uiToast?.success?.('Маршрут збережено') ?? uiToast?.show?.('Маршрут збережено');
        },
        content: (ctx)=>{
          const ui=ctx.ui;
          const wrap=ui.el('div','');

          const tgtSel = ui.select({ value:String(targetCol), options:tgtOptions, onChange:(v)=>{ targetCol=parseInt(v,10)||0; } });
          wrap.appendChild(ui.controlRow({ label:'Цільова колонка', help:'', controlEl:tgtSel }));

          const srcCardBody = ui.el('div','');
          const srcCard = ui.card({ title:'Джерела (колонки)', description:'Вибери одну або декілька колонок-джерел', children:[srcCardBody] });
          wrap.appendChild(srcCard);

          const renderSources = async ()=>{
            srcCardBody.innerHTML='';
            (fromSheet?.columns||[]).forEach((c,i)=>{
              const on = sources.includes(i);
              const tgl = ui.toggle({ value:on, onChange:(v)=>{
                if(v){ if(!sources.includes(i)) sources.push(i); }
                else { sources = sources.filter(x=>x!==i); }
              }});
              srcCardBody.appendChild(ui.controlRow({ label:`${i+1}. ${c.name}`, help:'', controlEl: tgl }));
            });
          };
          renderSources();

          const opSel = ui.select({ value: op, options: opOptions, onChange:(v)=>{ op=v; delRow.style.display = (op==='concat') ? '' : 'none'; } });
          wrap.appendChild(ui.controlRow({ label:'Операція', help:'', controlEl: opSel }));

          const delInp = ui.input({ value: delimiter, placeholder:'пробіл', onChange:(v)=>{ delimiter=v; } });
          const delRow = ui.controlRow({ label:'Розділювач', help:'Тільки для concat', controlEl: delInp });
          delRow.style.display = (op==='concat') ? '' : 'none';
          wrap.appendChild(delRow);

          const delBtn = ui.el('button','sws-btn-danger','🗑 Видалити маршрут');
          delBtn.onclick = async ()=>{
            if (!window.confirm('Видалити цей маршрут?')) return;
            tpl.routes.splice(routeIdx,1);
            await transferCore.saveTemplates(templates);
            uiToast?.success?.('Маршрут видалено') ?? uiToast?.show?.('Маршрут видалено');
            SW.pop();
          };
          wrap.appendChild(delBtn);

          return wrap;
        }
      });
    }

    function openJournalsMenu(){
      function openJournalColumnsScreen(){
        let templates = [];
        let selectedTplId = null;
        let tpl = null;

        const typeOptions = [
          { value: 'any', label: 'Будь-які' },
          { value: 'text', label: 'Текст' },
          { value: 'date', label: 'Лише дата' },
          { value: 'number', label: 'Лише числа' },
          { value: 'boolean', label: 'Лише boolean' },
        ];

        const ensureLoaded = async ()=>{
          templates = await sdo.journalTemplates.listTemplateEntities();
          if (!selectedTplId) selectedTplId = templates[0]?.id ?? null;
          if (selectedTplId && !templates.some(t=>t.id===selectedTplId)) selectedTplId = templates[0]?.id ?? null;
          tpl = selectedTplId ? await sdo.journalTemplates.getTemplate(selectedTplId) : null;
        };

        SW.push({
          title: 'Колонки',
          subtitle: 'Тип даних для кожної колонки (пер шаблон)',
          content: (ctx)=>{
            const ui = ctx.ui;
            const wrap = ui.el('div','');
            const top = ui.el('div','');
            const body = ui.el('div','');
            wrap.appendChild(top);
            wrap.appendChild(body);

            const render = async ()=>{
              await ensureLoaded();
              // Overlay draft changes if they exist for this template.
              try{
                const patch = ctx.draft?.journalTemplates?.[selectedTplId];
                if(tpl && patch && patch.columns) tpl = { ...tpl, columns: patch.columns };
              }catch(_){ }
              top.innerHTML='';
              body.innerHTML='';

              const tplOptions = (templates||[]).map(t=>({ value: t.id, label: t.title || t.id }));
              const sel = ui.select({
                value: selectedTplId || '',
                options: tplOptions,
                onChange: async (v)=>{
                  selectedTplId = v;
                  tpl = await sdo.journalTemplates.getTemplate(selectedTplId);
                  await render();
                }
              });
              top.appendChild(ui.controlRow({ label:'Шаблон журналу', help:'', controlEl: sel }));

              if (!tpl) {
                body.appendChild(ui.el('div','sws-muted','Немає шаблонів. Створіть шаблон журналу.'));
                return;
              }

              const colsBody = ui.el('div','');
              const card = ui.card({ title:'Колонки', description:'Оберіть, які дані дозволені у кожній колонці', children:[colsBody] });
              body.appendChild(card);

              (tpl.columns||[]).forEach((c, idx)=>{
                const currentType = (c.dataType==='date'||c.dataType==='number'||c.dataType==='boolean'||c.dataType==='text') ? c.dataType : 'any';
                const selType = ui.select({
                  value: currentType,
                  options: typeOptions,
                  onChange: async (v)=>{
                    // Draft-only: persist via the global Save button so it works from any stack.
                    const nextCols = (tpl.columns||[]).map((cc)=>({ ...cc }));
                    nextCols[idx].dataType = v;
                    ctx.draft.journalTemplates = ctx.draft.journalTemplates || {};
                    ctx.draft.journalTemplates[tpl.id] = ctx.draft.journalTemplates[tpl.id] || {};
                    ctx.draft.journalTemplates[tpl.id].columns = nextCols;
                    ctx.setGlobalDirty(true);
                    tpl = { ...tpl, columns: nextCols };
                    await render();
                  }
                });
                colsBody.appendChild(ui.controlRow({ label: `${idx+1}. ${c.label}`, help: c.key, controlEl: selType }));
              });

              // Register global saver once for journal template drafts.
              ctx.registerGlobalSaver('journalTemplates:saveAll', async ()=>{
                const patches = ctx.draft?.journalTemplates;
                if(!patches || Object.keys(patches).length===0) return;
                try{
                  for(const [tplId, patch] of Object.entries(patches)){
                    await sdo.journalTemplates.updateTemplate(tplId, patch);
                  }
                  ctx.draft.journalTemplates = {};
                  ctx.setGlobalDirty(false);
                  uiToast?.success?.('Збережено') ?? uiToast?.show?.('Збережено');
                }catch(e){
                  console.error(e);
                  uiToast?.error?.('Помилка збереження') ?? uiToast?.show?.('Помилка збереження');
                }
              });
            };

            render();
            return wrap;
          }
        });
      }

      SW.pushList({
        title: 'Журнали',
        subtitle: '',
        items: [
          { label: 'Шаблони журналів', description: 'Перегляд та видалення', onOpen: ()=>openJournalTemplatesListScreen() },
          { label: 'Додати шаблон журналу', description: '', onOpen: ()=>openAddJournalTemplateScreen() },
          { label: 'Колонки', description: 'Тип даних для колонок', onOpen: ()=> openJournalColumnsScreen() },
          { label: 'Поля “+Додати”', description: 'Скоро', onOpen: ()=> SW.push({ title:'Поля “+Додати”', subtitle:'', content: (ctx)=>ctx.ui.card({title:'Поля', description:'В розробці'}) }) },
        ]
      });
    }

    SW.openRoot({
      title: 'Налаштування',
      subtitle: '',
      items: [
        { label: 'Журнали', description: 'Шаблони, колонки, поля', onOpen: ()=>openJournalsMenu() },
        { label: 'UX|UI', description: '', onOpen: ()=> SW.push({ title:'UX|UI', subtitle:'', content: (ctx)=>ctx.ui.card({title:'UX|UI', description:'В розробці'}) }) },
        { label: 'Перенесення', description: 'Шаблони перенесення', onOpen: ()=> openTransferTemplatesScreen() },
      ]
    });
  }


  function evaluateGuard(fn, fallback = true) {
    if (typeof fn !== 'function') return fallback;
    return Boolean(fn({ api, sdo }));
  }

  async function ensureRootSpace() {
    const state = sdo.getState();
    if (state.spaces.length > 0) return;

    // Welcome seed: one demo space + one demo journal with 8 columns and 20 rows.
    const storage = sdo.api && sdo.api.storage ? sdo.api.storage : null;
    const tableStore = sdo.api && sdo.api.tableStore ? sdo.api.tableStore : null;

    const nowIso = () => new Date().toISOString();

    // Prepare template in storage (source of truth for table structure).
    // We keep it in templates storage because UI relies on templates container.
    const WELCOME_TEMPLATE_ID = 'welcome8';
    const WELCOME_SPACE_KEY = 'welcome:spaceId';
    const WELCOME_JOURNAL_KEY = 'welcome:journalId';
    const WELCOME_REMOVED_KEY = 'welcome:removed';

    try {
      if (storage && !(await storage.get(WELCOME_REMOVED_KEY))) {
        const idx = (await storage.get('templates:index')) ?? [];
        if (!idx.includes(WELCOME_TEMPLATE_ID)) {
          const tpl = {
            id: WELCOME_TEMPLATE_ID,
            title: 'welcome',
            columns: [
              { key: 'c1', label: '1' },
              { key: 'c2', label: '2' },
              { key: 'c3', label: '3' },
              { key: 'c4', label: '4' },
              { key: 'c5', label: '5' },
              { key: 'c6', label: '6' },
              { key: 'c7', label: '7' },
              { key: 'c8', label: '8' }
            ],
            createdAt: nowIso(),
            updatedAt: nowIso()
          };
          await storage.set('templates:index', [...idx, tpl.id]);
          await storage.set(`templates:tpl:${tpl.id}`, tpl);
        }
      }
    } catch (e) {
      // Non-fatal: template may already exist or storage may be unavailable.
    }

    let spaceId = null;
    let journalId = null;

    await sdo.commit((next) => {
      const node = createSpace('Простір 1', null);
      spaceId = node.id;
      next.spaces = addSpace(next.spaces, node);
      next.activeSpaceId = node.id;

      const j = createJournal({
        spaceId: node.id,
        parentId: null,
        templateId: WELCOME_TEMPLATE_ID,
        title: 'Вітальний журнал',
        index: '1'
      });
      journalId = j.id;
      next.journals = addJournal(next.journals, j);
      next.activeJournalId = j.id;
    }, ['spaces_nodes_v2', 'journals_nodes_v2', 'nav_last_loc_v2']);

    // Persist welcome ids for one-time cleanup.
    try {
      if (storage) {
        await storage.set(WELCOME_SPACE_KEY, spaceId);
        await storage.set(WELCOME_JOURNAL_KEY, journalId);
      }
    } catch (e) {}

    // Seed 20 rows into the welcome journal (tableStore is the single source of truth for data).
    try {
      if (tableStore && journalId) {
        // Avoid duplicating rows if something re-calls ensureRootSpace unexpectedly.
        const ds = await tableStore.getDataset(journalId);
        const existing = Array.isArray(ds?.records) ? ds.records.length : 0;
        if (existing === 0) {
          for (let i = 1; i <= 20; i++) {
            await tableStore.addRecord(journalId, {
              cells: {
                c1: `Рядок ${i}`,
                c2: '',
                c3: '',
                c4: '',
                c5: '',
                c6: '',
                c7: '',
                c8: ''
              }
            });
          }
        }
      }
    } catch (e) {
      // Non-fatal: if tableStore not ready yet, user can still proceed.
    }
  }


  
  async function cleanupWelcomeSeedAfterFirstUserSpace(createdSpaceId) {
    const storage = sdo.api && sdo.api.storage ? sdo.api.storage : null;
    const tableStore = sdo.api && sdo.api.tableStore ? sdo.api.tableStore : null;
    if (!storage) return;

    const WELCOME_SPACE_KEY = 'welcome:spaceId';
    const WELCOME_JOURNAL_KEY = 'welcome:journalId';
    const WELCOME_REMOVED_KEY = 'welcome:removed';
    const WELCOME_TEMPLATE_ID = 'welcome8';

    try {
      const removed = await storage.get(WELCOME_REMOVED_KEY);
      if (removed) return;

      const welcomeSpaceId = await storage.get(WELCOME_SPACE_KEY);
      const welcomeJournalId = await storage.get(WELCOME_JOURNAL_KEY);
      if (!welcomeSpaceId || welcomeSpaceId === createdSpaceId) return;

      const st = sdo.getState();
      const hasWelcome = st.spaces.some((s) => s && s.id === welcomeSpaceId);
      if (!hasWelcome) {
        await storage.set(WELCOME_REMOVED_KEY, true);
        return;
      }

      // Remove welcome space subtree and its journals.
      const removedJournalIds = [];
      await sdo.commit((next) => {
        const res = deleteSpaceSubtree(next.spaces, welcomeSpaceId);
        next.spaces = res.nodes;
        const toRemove = new Set();
        for (const j of next.journals) {
          if (j && res.removedIds.has(j.spaceId)) toRemove.add(j.id);
        }
        next.journals = next.journals.filter((j) => j && !toRemove.has(j.id));
        removedJournalIds.push(...Array.from(toRemove));

        if (next.activeSpaceId && res.removedIds.has(next.activeSpaceId)) {
          next.activeSpaceId = next.spaces[0]?.id ?? null;
          next.activeJournalId = null;
        }
        if (next.activeJournalId && toRemove.has(next.activeJournalId)) {
          next.activeJournalId = null;
        }
      }, ['spaces_nodes_v2', 'journals_nodes_v2', 'nav_last_loc_v2']);

      // Purge datasets of removed journals.
      if (tableStore && removedJournalIds.length) {
        const KEYS = {
          index: 'tableStore:index',
          rev: 'tableStore:rev',
          meta: (journalId) => `tableStore:meta:${journalId}`,
          order: (journalId) => `tableStore:order:${journalId}`,
          record: (journalId, recordId) => `tableStore:record:${journalId}:${recordId}`,
          chlog: (journalId) => `tableStore:chlog:${journalId}`
        };

        const index = (await storage.get(KEYS.index)) ?? [];
        const nextIndex = index.filter((id) => !removedJournalIds.includes(id));
        if (nextIndex.length !== index.length) await storage.set(KEYS.index, nextIndex);

        for (const jid of removedJournalIds) {
          try {
            const ds = await tableStore.getDataset(jid);
            const order = Array.isArray(ds?.records) ? ds.records.map((r) => r.id).filter(Boolean) : [];
            for (const rid of order) {
              await storage.del(KEYS.record(jid, rid));
            }
          } catch (e) {}
          await storage.del(KEYS.meta(jid));
          await storage.del(KEYS.order(jid));
          await storage.del(KEYS.chlog(jid));
        }
      }

      // Remove welcome template (optional but requested: "витираються").
      try {
        const idx = (await storage.get('templates:index')) ?? [];
        if (idx.includes(WELCOME_TEMPLATE_ID)) {
          await storage.set('templates:index', idx.filter((id) => id !== WELCOME_TEMPLATE_ID));
          await storage.del(`templates:tpl:${WELCOME_TEMPLATE_ID}`);
        }
      } catch (e) {}

      await storage.set(WELCOME_REMOVED_KEY, true);
      await storage.del(WELCOME_SPACE_KEY);
      await storage.del(WELCOME_JOURNAL_KEY);
    } catch (e) {
      // If cleanup fails, don't block user creation flow.
    }
  }


  function getJournalLabel(journal) {
    return formatJournalLabel(journal, sdo.getState());
  }

  function getSiblingIndex(nodes, nodeId, parentId) {
    const siblings = nodes.filter((n) => (n.parentId ?? null) === (parentId ?? null));
    const idx = siblings.findIndex((n) => n.id === nodeId);
    return idx >= 0 ? idx + 1 : 1;
  }

  function formatSpaceLabel(space, state) {
    if (!space) return '';
    const parts = [];
    let cur = space;
    while (cur) {
      const i = getSiblingIndex(state.spaces, cur.id, cur.parentId);
      parts.push(String(i));
      cur = cur.parentId ? findById(state.spaces, cur.parentId) : null;
    }
    const prefix = parts.reverse().join('.') + '.';
    return `${prefix} ${space.title}`;
  }

  function formatJournalLabel(journal, state) {
    if (!journal) return '';
    const parts = [];
    let cur = journal;
    // Root journals have parentId === spaceId.
    while (cur) {
      const parentId = cur.parentId;
      const siblings = state.journals.filter((j) => j.spaceId === cur.spaceId && j.parentId === parentId);
      const idx = siblings.findIndex((j) => j.id === cur.id);
      parts.push(String((idx >= 0 ? idx : 0) + 1));
      if (!parentId || parentId === cur.spaceId) break;
      cur = findById(state.journals, parentId);
    }
    const prefix = parts.reverse().join('.') + '.';
    return `${prefix} ${journal.title}`;
  }

  async function createJournalWithTemplate({ state, parentId, titlePrompt }) {
    const templates = await sdo.journalTemplates.listTemplateEntities();
    if (templates.length === 0) {
      setStatus('Немає доступних шаблонів');
      return;
    }

    // Template picker with search + SELECT (default shows all templates; filtering starts after 1+ chars)
    let query = '';
    let selectedTpl = null;

    const input = h('input', {
      class: 'sdo-picker-search',
      placeholder: 'Пошук шаблону…',
      value: '',
      onInput: () => {
        query = (input.value || '').trim().toLowerCase();
        rebuildSelect();
      }
    });

    const select = h('select', {
      class: 'sdo-picker-select',
      onChange: () => {
        const id = select.value;
        selectedTpl = templates.find(t => t.id === id) || null;
        warn.style.display = 'none';
      }
    });

    const warn = h('div', { class: 'sdo-picker-warn' }, ['Оберіть шаблон журналу']);
    warn.style.display = 'none';

    function rebuildSelect() {
      const q = query;
      const filtered = (!q || q.length < 1)
        ? templates
        : templates.filter((t) => (` `).toLowerCase().includes(q));

      const prev = select.value;
      select.innerHTML = '';

      const opt0 = document.createElement('option');
      opt0.value = '';
      opt0.textContent = '— Оберіть шаблон журналу —';
      select.appendChild(opt0);

      for (const tpl of filtered) {
        const opt = document.createElement('option');
        opt.value = tpl.id;
        opt.textContent = tpl.title;
        select.appendChild(opt);
      }

      if (prev && Array.from(select.options).some(o => o.value === prev)) {
        select.value = prev;
      } else {
        select.value = '';
      }
      selectedTpl = templates.find(t => t.id === select.value) || null;
      warn.style.display = 'none';
    }

    const addBtn = h('button', {
      class: 'sdo-picker-row sdo-picker-primary',
      onClick: async () => {
        if (!selectedTpl) {
          warn.style.display = 'block';
          select.focus();
          return;
        }
        closeModal();
        const title = window.prompt('Назва журналу:', titlePrompt);
        if (!title) return;
        await sdo.commit((next) => {
          const node = {
            id: crypto.randomUUID(),
            spaceId: state.activeSpaceId,
            parentId,
            templateId: selectedTpl.id,
            title,
            childCount: 0
          };
          next.journals = [...next.journals, node];
          next.activeJournalId = node.id;
        }, ['journals_nodes_v2', 'nav_last_loc_v2']);
      }
    }, ['Додати']);

    const modalEl = h('div', { class: 'sdo-picker-modal' }, [
      h('div', { class: 'sdo-picker-title' }, ['Оберіть шаблон журналу']),
      input,
      select,
      warn,
      addBtn,
      h('button', { class: 'sdo-picker-close', onClick: closeModal }, ['Закрити'])
    ]);

    modal.open(modalEl, { closeOnOverlay: true });
    rebuildSelect();
  }

  async function renderNavigation() {
    await ensureRootSpace();
    const state = sdo.getState();
    const activeSpace = findById(state.spaces, state.activeSpaceId);
    const activeJournal = findById(state.journals, state.activeJournalId);

    const spaceSiblings = state.spaces.filter((x) => x.parentId === (activeSpace?.parentId ?? null));
    const spaceChildren = state.spaces.filter((x) => x.parentId === activeSpace?.id);

    const journalSiblings = activeJournal
      ? state.journals.filter((j) => j.spaceId === state.activeSpaceId && j.parentId === activeJournal.parentId)
      : state.journals.filter((j) => j.spaceId === state.activeSpaceId && j.parentId === state.activeSpaceId);
    const journalChildren = activeJournal
      ? state.journals.filter((j) => j.spaceId === state.activeSpaceId && j.parentId === activeJournal.id)
      : [];

    const spaceBackBtn = h('button', {
      class: 'sdo-nav-btn sdo-nav-back',
      disabled: canGoBackSpace(activeSpace) ? null : 'disabled',
      onClick: async () => {
        if (!activeSpace?.parentId) return;
        await sdo.commit((next) => {
          next.activeSpaceId = activeSpace.parentId;
          next.activeJournalId = null;
        }, ['nav_last_loc_v2']);
      }
    }, ['←']);

    const spaceCurrentBtn = h('button', {
      class: 'sdo-nav-btn sdo-nav-main is-active',
      onClick: () => openTreePicker({
        kind: 'Простір',
        getCurrent: () => findById(sdo.getState().spaces, sdo.getState().activeSpaceId) || (ensureArray(sdo.getState().spaces).find(s=>s.parentId==null) || null),
        getSiblings: (cur) => {
          const st = sdo.getState();
          const pid = cur?.parentId ?? null;
          return st.spaces.filter(x => (x.parentId ?? null) === pid);
        },
        getParent: (cur) => {
          const st = sdo.getState();
          if (!cur?.parentId) return null;
          return findById(st.spaces, cur.parentId) || null;
        },
        getFirstChild: (cur) => {
          const st = sdo.getState();
          if (!cur?.id) return null;
          return st.spaces.find(x => x.parentId === cur.id) || null;
        },
        getId: (item) => item.id,
        getLabel: (item) => formatSpaceLabel(item, sdo.getState()),
        noticeNoChildren: 'Цей простір не має дочірніх просторів',
        onSelect: async (item) => {
          await sdo.commit((next) => {
            next.activeSpaceId = item.id;
            next.activeJournalId = null;
          }, ['nav_last_loc_v2']);
        },
        onAddCurrentLevel: async (cur) => {
          const title = prompt('Назва простору', 'Новий простір');
          if (!title) return;
          const parentId = cur?.parentId ?? null;
          await sdo.commit((next) => {
            const node = createSpace(title, parentId);
            next.spaces = addSpace(next.spaces || [], node);
            next.activeSpaceId = node.id;
            next.activeJournalId = null;
          }, ['nav_add_space_level']);
        }
      })
    }, [activeSpace ? formatSpaceLabel(activeSpace, state) : 'Простір']);

    const spaceChildrenBtn = h('button', {
      class: 'sdo-nav-btn sdo-nav-main is-adjacent',
      disabled: spaceChildren.length > 0 ? null : 'disabled',
      onClick: () => openTreePicker({
        kind: 'Простір',
        getCurrent: () => {
          const st = sdo.getState();
          const active = findById(st.spaces, st.activeSpaceId);
          const kids = st.spaces.filter(x => x.parentId === active?.id);
          return kids[0] || null;
        },
        getSiblings: (cur) => {
          const st = sdo.getState();
          const pid = cur?.parentId ?? null;
          return st.spaces.filter(x => (x.parentId ?? null) === pid);
        },
        getParent: (cur) => {
          const st = sdo.getState();
          if (!cur?.parentId) return null;
          return findById(st.spaces, cur.parentId) || null;
        },
        getFirstChild: (cur) => {
          const st = sdo.getState();
          if (!cur?.id) return null;
          return st.spaces.find(x => x.parentId === cur.id) || null;
        },
        getId: (item) => item.id,
        getLabel: (item) => formatSpaceLabel(item, sdo.getState()),
        noticeNoChildren: 'Цей простір не має дочірніх просторів',
        onSelect: async (item) => {
          await sdo.commit((next) => {
            next.activeSpaceId = item.id;
            next.activeJournalId = null;
          }, ['nav_last_loc_v2']);
        }
      })
    }, [spaceChildren[0] ? formatSpaceLabel(spaceChildren[0], state) : '—']);

    const spacePlusBtn = h('button', {
      class: 'sdo-nav-btn sdo-nav-plus',
      onClick: async () => {
        const title = window.prompt('Назва підпростору:', 'Новий підпростір');
        if (!title) return;
        // IMPORTANT: always read the latest state on click (handlers can be stale between rerenders)
        const stateNow = sdo.getState();
        const activeNow = findById(stateNow.spaces, stateNow.activeSpaceId);
        if (!activeNow?.id) return;
        const newId = crypto.randomUUID();
        // Create NEXT LEVEL (child of current active) and navigate into it
        await sdo.commit((next) => {
          next.spaces = [...next.spaces, { id: newId, title, parentId: activeNow.id, childCount: 0 }];
          next.activeSpaceId = newId;
          next.activeJournalId = null;
        }, ['spaces_nodes_v2', 'nav_last_loc_v2']);
      }
    }, ['+']);

    const journalBackBtn = h('button', {
      class: 'sdo-nav-btn sdo-nav-back',
      disabled: canGoBackJournal(activeJournal, state.activeSpaceId) ? null : 'disabled',
      onClick: async () => {
        if (!activeJournal || activeJournal.parentId === state.activeSpaceId) return;
        await sdo.commit((next) => {
          next.activeJournalId = activeJournal.parentId;
        }, ['nav_last_loc_v2']);
      }
    }, ['←']);

    const journalCurrentBtn = h('button', {
      class: 'sdo-nav-btn sdo-nav-main is-active',
      onClick: () => openTreePicker({
        kind: 'Журнал',
        getCurrent: () => {
          const st = sdo.getState();
          const cur = findById(st.journals, st.activeJournalId);
          if (cur) return cur;
          // fallback: first root journal in active space
          return st.journals.find(j => j.spaceId === st.activeSpaceId && j.parentId === st.activeSpaceId) || null;
        },
        getSiblings: (cur) => {
          const st = sdo.getState();
          const pid = cur?.parentId ?? st.activeSpaceId;
          return st.journals.filter(j => j.spaceId === st.activeSpaceId && (j.parentId ?? st.activeSpaceId) === pid);
        },
        getParent: (cur) => {
          const st = sdo.getState();
          if (!cur) return null;
          if (!cur.parentId || cur.parentId === st.activeSpaceId) return null;
          return st.journals.find(j => j.id === cur.parentId) || null;
        },
        getFirstChild: (cur) => {
          const st = sdo.getState();
          if (!cur?.id) return null;
          return st.journals.find(j => j.spaceId === st.activeSpaceId && j.parentId === cur.id) || null;
        },
        getId: (item) => item.id,
        getLabel: (item) => getJournalLabel(item),
        noticeNoChildren: 'Цей журнал не має дочірніх журналів',
        onSelect: async (item) => {
          if (window.__SDO_IMPORT_BUSY__) {
            window.UI?.toast?.show?.('Імпорт виконується… зачекай, будь ласка', { type: 'warning' });
            return;
          }
          await sdo.commit((next) => {
            next.activeJournalId = item.id;
          }, ['nav_last_loc_v2']);
        }
      })
    }, [activeJournal ? getJournalLabel(activeJournal) : 'Додай журнал']);

    const journalChildrenBtn = h('button', {
      class: 'sdo-nav-btn sdo-nav-main is-adjacent',
      disabled: journalChildren.length > 0 ? null : 'disabled',
      onClick: () => openTreePicker({
        kind: 'Журнал',
        getCurrent: () => {
          const st = sdo.getState();
          const act = findById(st.journals, st.activeJournalId);
          const kids = st.journals.filter(j => j.spaceId === st.activeSpaceId && j.parentId === act?.id);
          return kids[0] || null;
        },
        getSiblings: (cur) => {
          const st = sdo.getState();
          const pid = cur?.parentId ?? st.activeSpaceId;
          return st.journals.filter(j => j.spaceId === st.activeSpaceId && (j.parentId ?? st.activeSpaceId) === pid);
        },
        getParent: (cur) => {
          const st = sdo.getState();
          if (!cur) return null;
          if (!cur.parentId || cur.parentId === st.activeSpaceId) return null;
          return st.journals.find(j => j.id === cur.parentId) || null;
        },
        getFirstChild: (cur) => {
          const st = sdo.getState();
          if (!cur?.id) return null;
          return st.journals.find(j => j.spaceId === st.activeSpaceId && j.parentId === cur.id) || null;
        },
        getId: (item) => item.id,
        getLabel: (item) => getJournalLabel(item),
        noticeNoChildren: 'Цей журнал не має дочірніх журналів',
        onSelect: async (item) => {
          if (window.__SDO_IMPORT_BUSY__) {
            window.UI?.toast?.show?.('Імпорт виконується… зачекай, будь ласка', { type: 'warning' });
            return;
          }
          await sdo.commit((next) => {
            next.activeJournalId = item.id;
          }, ['nav_last_loc_v2']);
        }
      })
    }, [journalChildren[0] ? getJournalLabel(journalChildren[0]) : '—']);

    const journalPlusBtn = h('button', {
      class: 'sdo-nav-btn sdo-nav-plus',
      onClick: async () => {
        // IMPORTANT: always read latest state on click (handlers can be stale between rerenders)
        const stNow = sdo.getState();
        if (!stNow.activeSpaceId) return;
        const actJ = findById(stNow.journals, stNow.activeJournalId);
        const parentId = actJ ? actJ.id : stNow.activeSpaceId;
        await createJournalWithTemplate({ state: stNow, parentId, titlePrompt: actJ ? 'Піджурнал' : 'Вхідні поточні' });
      }
    }, ['+']);

    const spaceRow = h('div', { class: 'sdo-nav-row sdo-nav-row-space' }, [spaceBackBtn, spaceCurrentBtn, spaceChildrenBtn, spacePlusBtn]);
    const journalRow = h('div', { class: 'sdo-nav-row sdo-nav-row-journal' }, [journalBackBtn, journalCurrentBtn, journalChildrenBtn, journalPlusBtn]);

    // Keep navigationHost for compatibility, but the QuickNav button is rendered
    // inside the table-controls block (next to Search) to avoid wrapping issues.
    navigationHost.innerHTML = '';
  }

  function renderButtons() {
    const left = h('div', { class: 'sdo-toolbar-left' });
    const rightBlock = h('div', { class: 'sdo-block sdo-block-settings' }, [themeButton, backupButton, debugButton, settingsButton]);
    const right = h('div', { class: 'sdo-toolbar-right' }, [rightBlock]);

    // Expose a stable hook so table renderer can place QuickNav button near search.
    window.__SDO_OPEN_QUICKNAV__ = () => {
      if (window.__SDO_IMPORT_BUSY__) {
        window.UI?.toast?.show?.('Імпорт виконується… зачекай, будь ласка', { type: 'warning' });
        return;
      }
      try { openQuickNavRoot({ sdo }); } catch (e) { console.error(e); }
    };

    // One-line header: keep only table controls on the left.
    const tableBlock = h('div', { class: 'sdo-block sdo-block-table' }, [tableToolbarHost]);
    left.append(tableBlock);

    toolbar.innerHTML = '';
    toolbar.append(left, right);
  }

  let panelCleanup = null;
  function renderPanel() {
    panelCleanup?.();
    panelCleanup = null;
    panelsHost.innerHTML = '';

    const mainPanel = sdo.ui.listPanels({ location: 'main' })[0] ?? null;
    const settingsPanel = sdo.ui.listPanels({ location: 'settings' })[0] ?? null;
    const panel = mainPanel ?? settingsPanel;
    if (!panel) return;

    const wrapper = h('div', { class: 'sdo-panel' }, [h('h3', {}, [panel.title])]);
    panelsHost.append(wrapper);
    const maybeCleanup = panel.render(wrapper, { api, sdo });
    if (typeof maybeCleanup === 'function') panelCleanup = maybeCleanup;
  }

  async function renderSettings() {
    settingsHost.innerHTML = '';
    const tabs = sdo.settings.listTabs();
    for (const tab of tabs) {
      const tabEl = h('div', { class: 'sdo-settings-tab' }, [h('h4', {}, [tab.title])]);
      for (const def of tab.items) {
        for (const field of def.fields) {
          if (typeof field.when === 'function' && !field.when({ api, sdo })) continue;
          const row = h('label', { class: 'sdo-settings-row' }, [field.label]);
          const value = await field.read({ api, sdo });
          const input = h('input', { value: value ?? '', type: field.type === 'number' ? 'number' : 'text' });
          input.addEventListener('change', () => field.write({ api, sdo }, input.value));
          row.append(input);
          tabEl.append(row);
        }
      }
      settingsHost.append(tabEl);
    }
  }

  async function refresh() {
    await renderNavigation();
    renderButtons();
    renderPanel();
    await renderSettings();
  }

  const unsubscribeRegistry = sdo.ui.subscribe(refresh);
  const unsubscribeState = sdo.on('state:changed', refresh);
  refresh();

  const children = [toolbar, panelsHost, settingsHost, modalLayer].filter(Boolean);
  const root = h('div', { class: 'sdo-core-shell' }, children);
  mount.innerHTML = '';
  mount.append(root);

  return {
    destroy() {
      unsubscribeRegistry();
      unsubscribeState();
      panelCleanup?.();
      root.remove();
    }
  };
}
