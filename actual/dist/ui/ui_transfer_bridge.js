/**
 * Transfer UI bridge:
 * - Uses window.TransferUI modals (visuals + interactions)
 * - Delegates persistence and computations to TransferCore (DOM-free)
 * - Persists changes via ctx.storage and ctx.api.tableStore
 *
 * Assumptions:
 * - ui_bootstrap_esm.js side-effect imports ./transfer_modals.js first (defines window.TransferUI)
 * - ctx.api.tableStore exists (from table_store module)
 */
import { createTransferCore } from '../core/transfer_core.js';
import { computeTreeNumbering } from '../core/numbering_core.js';

function uniqPush(arr, v){ if(v==null) return; if(!arr.includes(v)) arr.push(v); }
function ensureArray(x){ return Array.isArray(x) ? x : []; }

// Read selected line indices (1 = base row, 2.. = subrows) from the transfer UI.
// The UI renders checkboxes with data-line-idx attributes.
// If nothing is selected, fallback to [1] to avoid a no-op transfer.
function computeSelectedLineIdxs(rootEl){
  try{
    const root = rootEl || document;
    const inputs = Array.from(root.querySelectorAll('input[type="checkbox"][data-line-idx]'));
    if(!inputs.length) return [1];
    const idxs = inputs
      .filter(i=>i.checked)
      .map(i=>parseInt(i.getAttribute('data-line-idx')||'',10))
      .filter(n=>Number.isFinite(n) && n > 0)
      .sort((a,b)=>a-b);
    return idxs.length ? idxs : [1];
  }catch(e){
    console.warn('computeSelectedLineIdxs failed, fallback to base row', e);
    return [1];
  }
}


function normalizeKVStorage(storage){
  const s = storage || globalThis?.UI?.storage;
  if (s && typeof s.get === 'function' && typeof s.set === 'function' && typeof s.del === 'function') return s;
  throw new Error('No compatible storage provided (need {get,set,del})');
}


function columnsFromDataset(dataset){
  const keys = [];
  for(const r of ensureArray(dataset?.records)){
    const cells = r?.cells ?? {};
    for(const k of Object.keys(cells)) uniqPush(keys, k);
  }
  return keys;
}

function rowArrayFromRecord(record, fromColKeys){
  const cells = record?.cells ?? {};
  return fromColKeys.map(k => cells?.[k]);
}

function rowArrayFromCells(cells, fromColKeys){
  const c = cells ?? {};
  return fromColKeys.map(k => (Object.prototype.hasOwnProperty.call(c, k) ? c[k] : undefined));
}


/**
 * @param {{storage:any, api:any, UI:any}} ctx
 */
export function attachTransferUI(ctx){
  const global = globalThis;
  const UI = ctx.UI || (global.UI = global.UI || {});
  const tableStore = ctx.api?.tableStore;
  const storage = normalizeKVStorage(ctx.storage);

  if(!tableStore || typeof tableStore.getDataset !== 'function'){
    // Don't throw: allow app to run even if tableStore not loaded yet.
    UI.transfer = UI.transfer || {
      openSettings: async ()=>UI.toast?.error?.('Transfer: tableStore API not ready') ?? console.error('Transfer: tableStore API not ready'),
      openRowModal: async ()=>UI.toast?.error?.('Transfer: tableStore API not ready') ?? console.error('Transfer: tableStore API not ready')
    };
    return UI.transfer;
  }

  const core = createTransferCore({ storage });

  function isFilled(v){
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') return v.trim() !== '';
    return true; // numbers (0), booleans, dates, objects count as data
  }

  async function loadTableSettingsForJournal(journalId){
    // Per-journal settings key (new), fallback to legacy global key.
    const baseKey = '@sdo/module-table-renderer:settings';
    const key = journalId ? `${baseKey}:${journalId}` : baseKey;
    try{
      const v = await storage.get(key);
      if (v) return v;
    }catch{}
    try{
      const v2 = await storage.get(baseKey);
      if (v2) return v2;
    }catch{}
    return { columns: { visibility: {} }, subrows: { columnsSubrowsEnabled: {} } };
  }

  function createEl(tag, attrs = {}, children = []){
    const el = document.createElement(tag);
    for(const [k,v] of Object.entries(attrs||{})){
      if(k === 'class') el.className = v;
      else if(k === 'style') el.style.cssText = v;
      else if(k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if(v !== undefined) el.setAttribute(k, String(v));
    }
    for(const ch of (Array.isArray(children)?children:[children])){
      if(ch == null) continue;
      if(typeof ch === 'string') el.appendChild(document.createTextNode(ch));
      else el.appendChild(ch);
    }
    return el;
  }

  async function openScenarioAndSubrowsPicker({ srcRecord }){
    const subrows = Array.isArray(srcRecord?.subrows) ? srcRecord.subrows : [];
    const hasSubrows = subrows.length > 0;

    const content = createEl('div', { style: 'display:flex;flex-direction:column;gap:12px;min-width:320px;' });

    // Scenario
    const scenWrap = createEl('div', { style:'display:flex;flex-direction:column;gap:6px;' }, [
      createEl('div', { style:'font-weight:600;' }, 'Сценарій копіювання'),
    ]);
    const r1 = createEl('label', { style:'display:flex;gap:8px;align-items:center;cursor:pointer;' }, [
      createEl('input', { type:'radio', name:'sdo_transfer_scen', value:'existing', checked:'checked' }),
      createEl('span', {}, 'Сценарій 1: копіювання в існуючу строку')
    ]);
    const r2 = createEl('label', { style:'display:flex;gap:8px;align-items:center;cursor:pointer;' }, [
      createEl('input', { type:'radio', name:'sdo_transfer_scen', value:'new' }),
      createEl('span', {}, 'Сценарій 2: копіювання в нову строку')
    ]);
    scenWrap.appendChild(r1);
    scenWrap.appendChild(r2);
    content.appendChild(scenWrap);

    // Subrows picker
    let subChecks = [];
    if(hasSubrows){
      const list = createEl('div', { style:'display:flex;flex-direction:column;gap:6px;border:1px solid rgba(0,0,0,.1);border-radius:8px;padding:10px;max-height:240px;overflow:auto;' });
      // include base row as line #1 when subrows exist
      const cbBase = createEl('input', { type:'checkbox', checked:'checked', 'data-idx': '1' });
      subChecks.push(cbBase);
      list.appendChild(createEl('label', { style:'display:flex;gap:10px;align-items:center;cursor:pointer;' }, [
        createEl('span', { style:'width:28px;opacity:.8;' }, '1'),
        cbBase,
        createEl('span', { style:'opacity:.75;' }, 'батьківська')
      ]));

      for(let i=0;i<subrows.length;i++){
        const lineIdx = i + 2; // 2..N+1
        const cb = createEl('input', { type:'checkbox', checked:'checked', 'data-idx': String(lineIdx) });
        subChecks.push(cb);
        list.appendChild(createEl('label', { style:'display:flex;gap:10px;align-items:center;cursor:pointer;' }, [
          createEl('span', { style:'width:28px;opacity:.8;' }, String(lineIdx)),
          cb
        ]));
      }
      const tools = createEl('div', { style:'display:flex;gap:8px;justify-content:flex-end;margin-top:6px;' }, [
        createEl('button', { type:'button', 'data-act':'all' }, 'Усі'),
        createEl('button', { type:'button', 'data-act':'none' }, 'Жодної'),
      ]);
      tools.addEventListener('click', (e)=>{
        const b = e.target.closest('button');
        if(!b) return;
        const act = b.getAttribute('data-act');
        if(act === 'all') subChecks.forEach(c=>c.checked=true);
        if(act === 'none') subChecks.forEach(c=>c.checked=false);
      });
      content.appendChild(createEl('div', { style:'font-weight:600;' }, 'Підстрочки для копіювання'));
      content.appendChild(list);
      content.appendChild(tools);
    }

    const footer = createEl('div', { style:'display:flex;justify-content:flex-end;gap:10px;margin-top:6px;' }, [
      createEl('button', { type:'button', 'data-act':'cancel' }, 'Скасувати'),
      createEl('button', { type:'button', 'data-act':'ok' }, 'Продовжити'),
    ]);
    content.appendChild(footer);

    return await new Promise((resolve)=>{
      let modalRec = null;
      const close = ()=>{ try{ modalRec?.close?.(); }catch{} };

      content.addEventListener('click', (e)=>{
        const b = e.target.closest('button');
        if(!b) return;
        const act = b.getAttribute('data-act');
        if(act === 'cancel'){ close(); resolve(null); }
        if(act === 'ok'){
          const scen = content.querySelector('input[name="sdo_transfer_scen"]:checked')?.value || 'existing';
          const selected = hasSubrows
            ? subChecks.filter(c=>c.checked).map(c=>Number(c.getAttribute('data-idx'))).filter(n=>Number.isFinite(n) && n>0)
            : [];
          close(); resolve({ scenario: scen, selectedLineIdxs: selected });
        }
      });

      if(UI.modal?.open){
        // NOTE: UI.modal.open expects an options object (see dist/ui/ui_core.js ensureGlobalUIBridge)
        modalRec = UI.modal.open({ title: 'Копіювання', contentNode: content });
      }else{
        // last-resort fallback
        resolve({ scenario: 'existing', selectedLineIdxs: hasSubrows ? [1, ...subrows.map((_,i)=>i+2)] : [] });
      }
    });
  }

  async function pickTargetRecordId({ journalId, labelColKey }){
    const ds = await tableStore.getDataset(journalId);
    const records = ensureArray(ds?.records);
    const wrap = createEl('div', { style:'display:flex;flex-direction:column;gap:10px;min-width:360px;max-width:560px;' });
    wrap.appendChild(createEl('div', { style:'font-weight:600;' }, 'Оберіть існуючу строку для копіювання'));

    const list = createEl('div', { style:'display:flex;flex-direction:column;gap:6px;border:1px solid rgba(0,0,0,.1);border-radius:8px;padding:10px;max-height:320px;overflow:auto;' });
    for(const r of records){
      const label = (r?.cells && labelColKey) ? (r.cells[labelColKey] ?? '') : '';
      const text = String(label || r.id || '').slice(0,80) || String(r.id);
      const btn = createEl('button', { type:'button', style:'text-align:left;padding:8px;border-radius:8px;border:1px solid rgba(0,0,0,.08);background:#fff;cursor:pointer;', 'data-id': r.id }, text);
      list.appendChild(btn);
    }
    wrap.appendChild(list);

    const footer = createEl('div', { style:'display:flex;justify-content:flex-end;gap:10px;' }, [
      createEl('button', { type:'button', 'data-act':'cancel' }, 'Скасувати')
    ]);
    wrap.appendChild(footer);

    return await new Promise((resolve)=>{
      let modalRec=null;
      const close=()=>{ try{ modalRec?.close?.(); }catch{} };
      wrap.addEventListener('click',(e)=>{
        const btn=e.target.closest('button');
        if(!btn) return;
        const act=btn.getAttribute('data-act');
        if(act==='cancel'){ close(); resolve(null); return; }
        const id=btn.getAttribute('data-id');
        if(id){ close(); resolve(id); }
      });
      // NOTE: UI.modal.open expects an options object
      modalRec = UI.modal?.open ? UI.modal.open({ title:'Вибір строки', contentNode: wrap }) : null;
      if(!modalRec){
        resolve(records?.[0]?.id ?? null);
      }
    });
  }

  // Full-view (table-like) picker: user selects a row by DOUBLE CLICK.
  // This is a lightweight approximation of "full journal view" until we embed the real renderer.
  async function pickTargetRecordIdFull({ journalId, colKeys, colLabels }){
    const ds = await tableStore.getDataset(journalId);
    const records = ensureArray(ds?.records);
    const wrap = createEl('div', { style:'display:flex;flex-direction:column;gap:10px;min-width:680px;max-width:960px;max-height:70vh;' });
    wrap.appendChild(createEl('div', { style:'font-weight:700;' }, 'Оберіть строку (подвійний клік)'));

    const table = createEl('div', { style:'border:1px solid rgba(0,0,0,.12);border-radius:10px;overflow:auto;flex:1;background:#fff;' });
    const grid = createEl('div', { style:`display:grid;grid-template-columns:${ensureArray(colKeys).map(()=> 'minmax(140px,1fr)').join(' ')};gap:0;border-collapse:collapse;` });

    // header
    for(let i=0;i<colKeys.length;i++){
      const th = createEl('div', { style:'position:sticky;top:0;background:rgba(0,0,0,.04);padding:8px 10px;font-weight:600;border-bottom:1px solid rgba(0,0,0,.12);' }, colLabels?.[i] ?? colKeys[i]);
      grid.appendChild(th);
    }
    // rows
    for(const r of records){
      for(let i=0;i<colKeys.length;i++){
        const k = colKeys[i];
        const v = r?.cells?.[k];
        const td = createEl('div', { style:'padding:8px 10px;border-bottom:1px solid rgba(0,0,0,.06);border-right:1px solid rgba(0,0,0,.04);white-space:pre-wrap;cursor:default;', 'data-id': r.id }, String(v ?? ''));
        // store record id for dblclick
        td.ondblclick = ()=>{}; // will be overridden by container handler
        grid.appendChild(td);
      }
    }
    table.appendChild(grid);
    wrap.appendChild(table);

    wrap.appendChild(createEl('div', { style:'display:flex;justify-content:flex-end;gap:10px;' }, [
      createEl('button', { type:'button', 'data-act':'cancel' }, 'Скасувати')
    ]));

    return await new Promise((resolve)=>{
      let modalRec=null;
      const close=()=>{ try{ modalRec?.close?.(); }catch{} };
      wrap.addEventListener('click',(e)=>{
        const btn=e.target.closest('button');
        if(!btn) return;
        const act=btn.getAttribute('data-act');
        if(act==='cancel'){ close(); resolve(null); }
      });
      wrap.addEventListener('dblclick',(e)=>{
        const cell = e.target.closest('[data-id]');
        const id = cell?.getAttribute?.('data-id');
        if(id){ close(); resolve(id); }
      });

      modalRec = UI.modal?.open ? UI.modal.open({ title:'Вибір строки', contentNode: wrap }) : null;
      if(!modalRec) resolve(records?.[0]?.id ?? null);
    });
  }

  async function buildSheets(){
    const state = ctx.api?.getState?.() ?? {};
    const journals = ensureArray(state.journals);
    const sheets = [];

    // Resolve journalTemplates API defensively (bootstrap timing differs between shells).
    const jt = ctx.api?.journalTemplates
      || globalThis.sdo?.api?.journalTemplates
      || globalThis.sdo?.journalTemplates
      || globalThis.SDO?.api?.journalTemplates
      || globalThis.__sdo_api?.journalTemplates
      || globalThis.UI?.sdo?.journalTemplates;

    // Determine default template id once (prefer "test").
    let defaultTplId = null;
    try{
      const list = await (jt?.listTemplateEntities?.() ?? Promise.resolve([]));
      const ids = ensureArray(list).map(t=>t?.id).filter(Boolean);
      defaultTplId = ids.includes('test') ? 'test' : (ids[0] ?? null);
    }catch{ defaultTplId = null; }

    // Auto-heal journals without templateId so transfers are stable even if a journal was created
    // by older code paths or has never been opened (and thus not auto-fixed by table_renderer).
    const healMissingTemplateId = async (journalId, tplId)=>{
      try{
        if(typeof ctx.api?.dispatch !== 'function') return;
        ctx.api.dispatch({
          async reduce(st){
            st.journals = ensureArray(st.journals).map(j=>{
              const id = j?.id ?? j?.key;
              if(id !== journalId) return j;
              if(j?.templateId) return j;
              return { ...j, templateId: tplId };
            });
          }
        });
      }catch{}
    };
    for(const j of journals){
      const key = j.id ?? j.key ?? j.journalId ?? '';
      if(!key) continue;

      // Prefer declared journal template columns (stable keys) over inferring from data.
      let tplId = j.templateId ?? j.tplId ?? null;
      if(!tplId && defaultTplId){
        tplId = defaultTplId;
        healMissingTemplateId(key, tplId);
      }
      let tpl = null;
      try{
        if (jt?.getTemplate) tpl = await jt.getTemplate(tplId);
        else if (typeof ctx.api?.getTemplate === 'function') tpl = await ctx.api.getTemplate(tplId);
      }catch{ tpl = null; }

      let columns = [];
      if (tpl?.columns?.length){
        columns = tpl.columns.map(c=>({ id: c.key, name: c.label ?? c.key }));
      } else {
        // Fallback: infer from data when template not available
        let ds;
        try{ ds = await tableStore.getDataset(key); } catch { ds = null; }
        const colKeys = columnsFromDataset(ds);
        columns = (colKeys.length ? colKeys : ['c1']).map((k)=>({ id:k, name:k }));
      }

      sheets.push({
        key,
        name: j.title ?? j.name ?? j.label ?? key,
        columns,
        tplId
      });
    }
    // ensure at least one
    if(sheets.length === 0){
      sheets.push({ key:'default', name:'Default', columns:[{id:'c1',name:'Колонка 1'}] });
    }
    return sheets;
  }

  // Build "sheets" definitions based on *journal templates* (not concrete journals).
  // This is used for Transfer Settings (template-oriented transfers).
  async function buildTemplateSheets(){
    const templates = await (ctx.api?.journalTemplates?.listTemplateEntities?.() ?? Promise.resolve([]));
    const sheets = [];
    for(const t of ensureArray(templates)){
      const tplId = t?.id;
      if(!tplId) continue;
      let full = null;
      try{
        if(ctx.api?.journalTemplates?.getTemplate) full = await ctx.api.journalTemplates.getTemplate(tplId);
      }catch{ full = null; }
      const colsSrc = ensureArray(full?.columns ?? t?.columns);
      const columns = colsSrc.length
        ? colsSrc.map(c => ({ id: c.key ?? c.id ?? c.name, name: c.label ?? c.title ?? c.key ?? c.id ?? c.name }))
            .filter(c => c.id)
        : [{ id:'c1', name:'Колонка 1' }];
      sheets.push({
        key: tplId,
        name: t?.title ?? t?.name ?? tplId,
        columns,
        tplId
      });
    }
    if(sheets.length === 0){
      sheets.push({ key:'default', name:'Default', columns:[{id:'c1',name:'Колонка 1'}], tplId:'default' });
    }
    return sheets;
  }

  function migrateJournalKeyToTemplateKey(key, stateNow){
    if(!key) return key;
    const j = ensureArray(stateNow?.journals).find(x => (x?.id ?? x?.key) === key);
    if(!j) return key;
    return j?.templateId ?? j?.tplId ?? key;
  }

  async function openSettings(){
    const TransferUI = global.TransferUI;
    if(!TransferUI?.openSettings){
      UI.toast?.error?.('TransferUI модалка не завантажена') ?? console.error('TransferUI modals not loaded');
      return;
    }
    // Settings must be template-oriented: use journalTemplates to build "sheets".
    const [sheets, templatesRaw] = await Promise.all([buildTemplateSheets(), core.loadTemplates()]);
    const stateNow = ctx.api?.getState?.() ?? {};
    // Migrate any legacy (journal-oriented) template links to journal-template IDs.
    const templates = ensureArray(templatesRaw).map(t => ({
      ...t,
      fromSheetKey: migrateJournalKeyToTemplateKey(t?.fromSheetKey, stateNow),
      toSheetKey: migrateJournalKeyToTemplateKey(t?.toSheetKey, stateNow)
    }));
    TransferUI.openSettings({
      title: 'Налаштування → Таблиці → Перенесення',
      sheets,
      templates,
      onSave: async (nextTemplates) => {
        await core.saveTemplates(nextTemplates);
        UI.toast?.success?.('Шаблони перенесення збережено') ?? console.log('Transfer templates saved');
      }
    });
  }

  async function openRowModal({ sourceJournalId, recordIds }){
    const SettingsWindow = global.SettingsWindow;
    const [sheets, templates] = await Promise.all([buildSheets(), core.loadTemplates()]);
    const stateNow = ctx.api?.getState?.() ?? {};
    const srcJournalMeta = ensureArray(stateNow.journals).find(j => (j?.id ?? j?.key) === sourceJournalId) || null;
    const sourceTemplateId = srcJournalMeta?.templateId ?? srcJournalMeta?.tplId ?? null;
    const fromSheetForTpl = ensureArray(sheets).find(s => s.key === sourceJournalId) || null;
    const sourceTemplateId2 = fromSheetForTpl?.tplId ?? null;
    const sourceKeys = new Set([sourceJournalId, sourceTemplateId, sourceTemplateId2].filter(Boolean));
    const srcDataset = await tableStore.getDataset(sourceJournalId);
    const srcRecord = ensureArray(srcDataset?.records).find(r => r?.id === recordIds?.[0]);
    if(!srcRecord){
      UI.toast?.warning?.('Запис не знайдено') ?? console.warn('Record not found');
      return;
    }
    
    // build from cols from source sheet definition
    const fromSheet = sheets.find(s => s.key === sourceJournalId) || sheets[0];
    const fromColKeys = ensureArray(fromSheet?.columns).map(c => c.id);
    const srcRow = rowArrayFromRecord(srcRecord, fromColKeys);

    // New Transfer Execute window (SettingsWindow v2 style)
    const openTransferSws = ()=>{
      // Filter templates by SOURCE JOURNAL TEMPLATE (preferred) or by SOURCE JOURNAL ID (legacy)
      const applicable = ensureArray(templates).filter(tpl => {
        const k = tpl?.fromSheetKey;
        return k && sourceKeys.has(k);
      });
      if(applicable.length === 0){
        UI.toast?.warning?.('Немає шаблонів перенесення для цього журналу');
        return;
      }

      // local transfer execution state (will be passed into SettingsWindow stack ctx)
      const transferState = {
        sourceJournalId,
        recordIds,
        templates: applicable,
        templateId: applicable[0]?.id || null,
        scenario: 'existing', // 'existing' | 'new'
        destSpaceId: null,
        destJournalId: null
      };

// Resolve destination journals by template.toSheetKey:
// - if it matches an existing journalId in sheets -> use it directly
// - otherwise treat it as a destination templateId and return journals using that template
const resolveDestCandidates = (tpl)=>{
  const toKey = tpl?.toSheetKey;
  if(!toKey) return [];

  // Index journal meta from state (spaceId, parentId, index)
  const metaById = {};
  for(const j of ensureArray(stateNow.journals)){
    const jid = j?.id ?? j?.key;
    if(!jid) continue;
    metaById[jid] = {
      id: jid,
      title: j?.title ?? j?.name ?? jid,
      spaceId: j?.spaceId ?? null,
      parentId: j?.parentId ?? null,
      templateId: j?.templateId ?? j?.tplId ?? null,
      index: (typeof j?.index === 'number' ? j.index : null),
    };
  }

  const uniq = new Map();
  const add = (jid, base={})=>{
    if(!jid) return;
    const m = metaById[jid] || {};
    const prev = uniq.get(jid) || {};
    uniq.set(jid, {
      id: jid,
      title: base.title ?? prev.title ?? m.title ?? jid,
      spaceId: base.spaceId ?? prev.spaceId ?? m.spaceId ?? null,
      parentId: base.parentId ?? prev.parentId ?? m.parentId ?? null,
      templateId: base.templateId ?? prev.templateId ?? m.templateId ?? null,
      index: (base.index ?? prev.index ?? m.index ?? null)
    });
  };

  // direct journal match by id
  for(const s of ensureArray(sheets)){
    if(s?.key === toKey){
      add(s.key, { title: s.name ?? s.key, templateId: s.tplId ?? null });
    }
  }

  // templateId match via state journals
  for(const j of ensureArray(stateNow.journals)){
    const jid = j?.id ?? j?.key;
    if(!jid) continue;
    const tplId = j?.templateId ?? j?.tplId ?? null;
    if(tplId && tplId === toKey){
      add(jid, {
        title: j?.title ?? j?.name ?? jid,
        spaceId: j?.spaceId ?? null,
        parentId: j?.parentId ?? null,
        templateId: tplId,
        index: (typeof j?.index === 'number' ? j.index : null)
      });
    }
  }

  // templateId match via sheets view (fallback)
  for(const s of ensureArray(sheets)){
    if(s?.tplId && s.tplId === toKey){
      add(s.key, { title: s.name ?? s.key, templateId: s.tplId });
    }
  }

  return Array.from(uniq.values());
};

const getTemplateById = (id)=> ensureArray(transferState.templates).find(t => t?.id === id) || null;

function computeVisibleSpacesFromCandidates(cands){
  const spaces = ensureArray(stateNow.spaces);
  const byId = {};
  for(const sp of spaces){
    const sid = sp?.id ?? sp?.key;
    if(!sid) continue;
    byId[sid] = {
      id: sid,
      title: sp?.title ?? sp?.name ?? sid,
      parentId: sp?.parentId ?? null,
      createdAt: sp?.createdAt ?? null
    };
  }

  const visible = new Set();
  const addAnc = (sid)=>{
    let cur = sid;
    let guard = 0;
    while(cur && byId[cur] && guard < 50){
      visible.add(cur);
      cur = byId[cur].parentId;
      guard++;
    }
  };
  for(const c of ensureArray(cands)){
    if(c?.spaceId) addAnc(c.spaceId);
  }

  const children = {};
  for(const id of visible){
    const pid = byId[id]?.parentId ?? null;
    if(pid && visible.has(pid)){
      (children[pid] ||= []).push(id);
    }
  }

  const rootIds = Array.from(visible).filter(id=>{
    const pid = byId[id]?.parentId ?? null;
    return !pid || !visible.has(pid);
  });

  const sortIds = (ids)=>{
    ids.sort((a,b)=>{
      const A = byId[a] || {};
      const B = byId[b] || {};
      const ca = A.createdAt ? Date.parse(A.createdAt) : NaN;
      const cb = B.createdAt ? Date.parse(B.createdAt) : NaN;
      const ha = Number.isFinite(ca);
      const hb = Number.isFinite(cb);
      if(ha && hb && ca !== cb) return ca - cb;
      if(ha && !hb) return -1;
      if(!ha && hb) return 1;
      return String(A.title||'').localeCompare(String(B.title||''));
    });
  };
  sortIds(rootIds);
  for(const pid of Object.keys(children)) sortIds(children[pid]);

  const numbering = computeTreeNumbering(rootIds, (id)=> children[id] || []);
  return { byId, children, rootIds, numbering, visible };
}

function buildJournalTreeForSpace(spaceId, candidateIds){
  const list = ensureArray(stateNow.journals).filter(j => (j?.spaceId ?? null) === spaceId);

  const nodes = {};
  const meta = {};
  for(const j of list){
    const id = j?.id ?? j?.key;
    if(!id) continue;
    nodes[id] = {
      id,
      title: j?.title ?? j?.name ?? id,
      parentId: j?.parentId ?? null,
      children: []
    };
    meta[id] = {
      idx: (typeof j?.index === 'number' ? j.index : 1e9),
      title: String(j?.title ?? j?.name ?? id)
    };
  }

  const topIds = [];
  for(const j of list){
    const id = j?.id ?? j?.key;
    if(!id || !nodes[id]) continue;
    const pid = j?.parentId ?? null;
    if(pid && nodes[pid]) nodes[pid].children.push(id);
    else topIds.push(id);
  }

  const sortIds = (ids)=>{
    ids.sort((a,b)=>{
      const A = meta[a] || { idx: 1e9, title: '' };
      const B = meta[b] || { idx: 1e9, title: '' };
      if(A.idx !== B.idx) return A.idx - B.idx;
      return A.title.localeCompare(B.title);
    });
  };
  sortIds(topIds);
  for(const id of Object.keys(nodes)) sortIds(nodes[id].children);

  const candSet = new Set(ensureArray(candidateIds).filter(Boolean));
  const visible = new Set();
  const addAnc = (jid)=>{
    let cur = jid;
    let guard = 0;
    while(cur && nodes[cur] && guard < 50){
      visible.add(cur);
      cur = nodes[cur].parentId;
      guard++;
    }
  };
  for(const id of candSet) addAnc(id);

  const children = {};
  for(const id of visible){
    const pid = nodes[id]?.parentId ?? null;
    if(pid && visible.has(pid)){
      (children[pid] ||= []).push(id);
    }
  }

  const rootIds = Array.from(visible).filter(id=>{
    const pid = nodes[id]?.parentId ?? null;
    return !pid || !visible.has(pid);
  });

  const numbering = computeTreeNumbering(
    rootIds.slice().sort((a,b)=>{
      const A = meta[a] || { idx:1e9, title:'' };
      const B = meta[b] || { idx:1e9, title:'' };
      if(A.idx !== B.idx) return A.idx - B.idx;
      return A.title.localeCompare(B.title);
    }),
    (id)=> (children[id] || []).slice().sort((a,b)=>{
      const A = meta[a] || { idx:1e9, title:'' };
      const B = meta[b] || { idx:1e9, title:'' };
      if(A.idx !== B.idx) return A.idx - B.idx;
      return A.title.localeCompare(B.title);
    })
  );

  return { nodes, meta, visible, children, rootIds, numbering };
}

const ensureDest = (ctxObj)=>{
  const tpl = getTemplateById(ctxObj?.templateId);
  const cands = resolveDestCandidates(tpl);

  // Space tree visibility comes from candidate journals only
  const spacesSnap = computeVisibleSpacesFromCandidates(cands);
  const candById = new Map(cands.map(c=>[c.id, c]));
  const impliedSpace = ctxObj?.destJournalId ? (candById.get(ctxObj.destJournalId)?.spaceId ?? null) : null;
  const firstCandSpace = cands.find(c=>c?.spaceId)?.spaceId ?? null;

  if(!ctxObj?.destSpaceId){
    ctxObj.destSpaceId = impliedSpace || firstCandSpace || spacesSnap.rootIds[0] || null;
  }
  if(ctxObj?.destSpaceId && spacesSnap.visible && spacesSnap.visible.size && !spacesSnap.visible.has(ctxObj.destSpaceId)){
    ctxObj.destSpaceId = impliedSpace || firstCandSpace || spacesSnap.rootIds[0] || null;
  }

  const candsInSpace = cands.filter(c => (c?.spaceId ?? null) === (ctxObj?.destSpaceId ?? null));

  if(candsInSpace.length === 0){
    // selected space is an ancestor path or empty; journal must be chosen by selecting a space that contains candidates
    ctxObj.destJournalId = null;
  } else {
    if(!ctxObj?.destJournalId){
      ctxObj.destJournalId = candsInSpace[0]?.id ?? null;
    }
    if(ctxObj?.destJournalId && !candsInSpace.some(j => j.id === ctxObj.destJournalId)){
      ctxObj.destJournalId = candsInSpace[0]?.id ?? null;
    }
  }

  return { tpl, cands, candsInSpace, spacesSnap };
};

// NOTE:
// SettingsWindow.openRoot() is a *menu* root (it always renders the default
// "Налаштування" hint card + list of items and ignores custom content).
// For row-transfer we need a custom root screen, so we must use
// openCustomRoot() + push(). Otherwise user sees an empty settings menu.
SettingsWindow.openCustomRoot(()=> SettingsWindow.push({
  title: 'Перенесення',
  subtitle: 'Оберіть сценарій та виконайте перенесення',
  saveLabel: 'Перенести',
  ctx: transferState,
  content: (ctx2)=>{
    const ui = ctx2.ui;
    const root = ui.el('div','');

    // Card 1: template + scenario
    const tplOptions = applicable.map(t=>({ value: t.id, label: t.title || t.id }));
    const tplSelect = ui.select({
      value: ctx2.templateId,
      options: tplOptions,
      onChange: (v)=>{ ctx2.templateId = v; ctx2.destSpaceId = null; ctx2.destJournalId = null; renderTree(); renderPreview(); }
    });
    const scenarioSelect = ui.select({
      value: ctx2.scenario,
      options: [
        { value:'existing', label:'У існуючу строку' },
        { value:'new', label:'У нову строку' }
      ],
      onChange: (v)=>{ ctx2.scenario = v; renderPreview(); }
    });
    const cardScenario = ui.card({
      title: 'Сценарій перенесення',
      description: 'Оберіть шаблон та сценарій',
      children: [
        ui.controlRow({ label:'Шаблон', controlEl: tplSelect }),
        ui.controlRow({ label:'Куди переносити', controlEl: scenarioSelect })
      ]
    });

    // Card 2: subrows picker
    const hasSubrows = ensureArray(srcRecord?.subrows).length > 0;
    const subrowsHost = ui.el('div','');
    let subrowsCard = null;
    if(hasSubrows){
      const wrap = ui.el('div','');
      const mkLine = (idx,label,checked)=>{
        const row = ui.el('label','');
        row.style.display='flex';
        row.style.alignItems='center';
        row.style.gap='10px';
        const cb = document.createElement('input');
        cb.type='checkbox';
        cb.checked=!!checked;
        cb.setAttribute('data-line-idx', String(idx));
        cb.onchange = ()=>{ renderPreview(); };
        const txt = ui.el('div','', label);
        row.appendChild(cb);
        row.appendChild(txt);
        return row;
      };
      // Line 1 (base)
      wrap.appendChild(mkLine(1,'1) Строка (батьківська)', true));
      const subs = ensureArray(srcRecord?.subrows);
      for(let i=0;i<subs.length;i++){
        wrap.appendChild(mkLine(i+2, `${i+2}) Підстрока ${i+1}`, true));
      }
      subrowsHost.appendChild(wrap);
      subrowsCard = ui.card({
        title: 'Вибір підстрок',
        description: 'Оберіть, які лінії переносити',
        children: [subrowsHost]
      });
    }

    // Card 3: preview
    const previewHost = ui.el('div','');
    const cardPreview = ui.card({
      title: 'Перенесення',
      description: 'Попередній перегляд значень у цільовому журналі',
      children: [previewHost]
    });

    // Card: destination picker (2 panes: Spaces + Journals) filtered by route destination template
    const treeHost = ui.el('div','');
    const cardTree = ui.card({
      title: 'Журнал призначення',
      description: 'Оберіть простір (ліворуч) та журнал (праворуч). Показуються лише простори/журнали, що відповідають шаблону призначення маршруту.',
      children: [treeHost]
    });

    function renderTree(){
      treeHost.innerHTML = '';

      const { tpl, cands, candsInSpace, spacesSnap } = ensureDest(ctx2);

      if(!tpl){
        treeHost.appendChild(ui.el('div','', 'Шаблон не обрано'));
        return;
      }
      if(!cands || cands.length === 0){
        treeHost.appendChild(ui.el('div','', 'Немає журналів, що відповідають шаблону призначення'));
        return;
      }
      if(!spacesSnap?.visible || spacesSnap.visible.size === 0){
        treeHost.appendChild(ui.el('div','', 'Немає просторів з журналами призначення'));
        return;
      }

      const split = ui.el('div','');
      split.style.display = 'grid';
      split.style.gridTemplateColumns = '1fr 1fr';
      split.style.gap = '12px';
      split.style.alignItems = 'start';

      // ---- Left pane: Spaces ----
      const paneSpaces = ui.el('div','');
      paneSpaces.style.display = 'flex';
      paneSpaces.style.flexDirection = 'column';
      paneSpaces.style.gap = '8px';

      const spHead = ui.el('div','sws-muted', 'Простори');
      const spSearch = document.createElement('input');
      spSearch.type = 'search';
      spSearch.placeholder = 'Пошук простору…';
      spSearch.className = 'sws-input';
      spSearch.style.width = '100%';

      const spList = ui.el('div','');
      spList.style.display = 'flex';
      spList.style.flexDirection = 'column';
      spList.style.gap = '6px';
      spList.style.border = '1px solid rgba(0,0,0,.12)';
      spList.style.borderRadius = '10px';
      spList.style.padding = '10px';
      spList.style.maxHeight = '320px';
      spList.style.overflow = 'auto';

      paneSpaces.appendChild(spHead);
      paneSpaces.appendChild(spSearch);
      paneSpaces.appendChild(spList);

      // ---- Right pane: Journals in selected space ----
      const paneJournals = ui.el('div','');
      paneJournals.style.display = 'flex';
      paneJournals.style.flexDirection = 'column';
      paneJournals.style.gap = '8px';

      const jHead = ui.el('div','sws-muted', 'Журнали');
      const jSearch = document.createElement('input');
      jSearch.type = 'search';
      jSearch.placeholder = 'Пошук журналу…';
      jSearch.className = 'sws-input';
      jSearch.style.width = '100%';

      const jList = ui.el('div','');
      jList.style.display = 'flex';
      jList.style.flexDirection = 'column';
      jList.style.gap = '6px';
      jList.style.border = '1px solid rgba(0,0,0,.12)';
      jList.style.borderRadius = '10px';
      jList.style.padding = '10px';
      jList.style.maxHeight = '320px';
      jList.style.overflow = 'auto';

      paneJournals.appendChild(jHead);
      paneJournals.appendChild(jSearch);
      paneJournals.appendChild(jList);

      split.appendChild(paneSpaces);
      split.appendChild(paneJournals);
      treeHost.appendChild(split);

      const norm = (v)=>String(v||'').toLowerCase().trim();

      function renderSpaces(){
        spList.innerHTML = '';
        const q = norm(spSearch.value);

        // Build search-visible set: show matches + ancestors
        const visible = new Set();
        const markAnc = (sid)=>{
          let cur = sid;
          let guard = 0;
          while(cur && spacesSnap.byId[cur] && guard < 50){
            visible.add(cur);
            cur = spacesSnap.byId[cur].parentId;
            guard++;
          }
        };
        if(q){
          for(const sid of spacesSnap.visible){
            const t = norm(spacesSnap.byId[sid]?.title);
            if(t.includes(q)) markAnc(sid);
          }
        } else {
          for(const sid of spacesSnap.visible) visible.add(sid);
        }

        const renderNode = (sid, depth)=>{
          if(!visible.has(sid)) return;
          const sp = spacesSnap.byId[sid];
          const num = spacesSnap.numbering?.get?.(sid) || '';
          const label = num ? `${num} ${sp?.title ?? sid}` : (sp?.title ?? sid);

          const btn = ui.el('button','sws-qnav-btn', label);
          btn.type = 'button';
          btn.style.textAlign = 'left';
          btn.style.marginLeft = (depth * 14) + 'px';
          if(sid === ctx2.destSpaceId) btn.classList.add('sws-qnav-active');
          btn.onclick = ()=>{
            ctx2.destSpaceId = sid;
            ctx2.destJournalId = null;
            ensureDest(ctx2);
            renderSpaces();
            renderJournals();
            renderPreview();
          };
          spList.appendChild(btn);

          const kids = (spacesSnap.children[sid] || []).filter(id=>visible.has(id));
          for(const cid of kids) renderNode(cid, depth+1);
        };

        for(const rid of spacesSnap.rootIds){
          renderNode(rid, 0);
        }

        if(!spList.childElementCount){
          spList.appendChild(ui.el('div','sws-muted','Нічого не знайдено'));
        }
      }

      function renderJournals(){
        jList.innerHTML = '';
        const sid = ctx2.destSpaceId;
        if(!sid){
          jList.appendChild(ui.el('div','sws-muted','Оберіть простір зліва'));
          return;
        }

        const ids = candsInSpace.map(c=>c.id);
        if(!ids.length){
          jList.appendChild(ui.el('div','sws-muted','У цьому просторі немає журналів, що відповідають шаблону призначення. Оберіть інший (під)простір.'));
          return;
        }

        const jtree = buildJournalTreeForSpace(sid, ids);
        const q = norm(jSearch.value);

        // Search-visible set: matches + ancestors
        const visible = new Set();
        const markAnc = (jid)=>{
          let cur = jid;
          let guard = 0;
          while(cur && jtree.nodes[cur] && guard < 50){
            visible.add(cur);
            cur = jtree.nodes[cur].parentId;
            guard++;
          }
        };
        if(q){
          for(const jid of jtree.visible){
            const t = norm(jtree.nodes[jid]?.title);
            if(t.includes(q)) markAnc(jid);
          }
        } else {
          for(const jid of jtree.visible) visible.add(jid);
        }

        const renderNode = (jid, depth)=>{
          if(!visible.has(jid)) return;
          const n = jtree.nodes[jid];
          const num = jtree.numbering?.get?.(jid) || '';
          const label = num ? `${num} ${n?.title ?? jid}` : (n?.title ?? jid);

          const btn = ui.el('button','sws-qnav-btn', label);
          btn.type = 'button';
          btn.style.textAlign = 'left';
          btn.style.marginLeft = (depth * 14) + 'px';
          if(jid === ctx2.destJournalId) btn.classList.add('sws-qnav-active');
          btn.onclick = ()=>{
            ctx2.destJournalId = jid;
            ensureDest(ctx2);
            renderJournals();
            renderPreview();
          };
          jList.appendChild(btn);

          const kids = (jtree.children[jid] || []).filter(id=>visible.has(id));
          for(const cid of kids) renderNode(cid, depth+1);
        };

        // roots (in visible set)
        const roots = (jtree.rootIds || []).filter(id=>visible.has(id));
        // stable sort by numbering if present
        roots.sort((a,b)=>String(jtree.numbering?.get?.(a) || '').localeCompare(String(jtree.numbering?.get?.(b) || '')));
        for(const rid of roots){
          renderNode(rid, 0);
        }

        if(!jList.childElementCount){
          jList.appendChild(ui.el('div','sws-muted','Нічого не знайдено'));
        }
      }

      spSearch.addEventListener('input', ()=>{ renderSpaces(); });
      jSearch.addEventListener('input', ()=>{ renderJournals(); });

      renderSpaces();
      renderJournals();
    }


    async function renderPreview(){
      previewHost.innerHTML = '';
      const template = getTemplateById(ctx2.templateId);
      if(!template){
        previewHost.appendChild(ui.el('div','', 'Шаблон не обрано'));
        return;
      }
      const toJournalId = ctx2.destJournalId;
      if(!toJournalId){
        previewHost.appendChild(ui.el('div','', 'Оберіть журнал призначення'));
        return;
      }
      const toSheet = sheets.find(s => s.key === toJournalId) || null;
      if(!toSheet){
        previewHost.appendChild(ui.el('div','', 'Цільовий журнал не знайдено'));
        return;
      }
      const toColKeys = ensureArray(toSheet?.columns).map(c => c.id);
      const targetRow = core.applyTemplateToRow(template, srcRow, { sourceColKeys: fromColKeys, targetColKeys: toColKeys });
      const table = ui.el('div','');
      table.style.display='grid';
      table.style.gridTemplateColumns='1fr 1fr';
      table.style.gap='8px 12px';
      table.style.alignItems='start';
      const head = ui.el('div','');
      head.style.gridColumn='1 / -1';
      head.style.marginBottom='6px';
      head.appendChild(ui.el('div','', `Цільовий журнал: ${toSheet?.name || toSheet?.key}`));
      table.appendChild(head);
      for(let i=0;i<toColKeys.length;i++){
        const col = toSheet?.columns?.[i];
        const label = col?.name || col?.id || `Колонка ${i+1}`;
        const v = targetRow?.[i] ?? '';
        table.appendChild(ui.el('div','', `${i+1}. ${label}`));
        const valEl = ui.el('div','', String(v ?? ''));
        valEl.style.whiteSpace='pre-wrap';
        table.appendChild(valEl);
      }
      previewHost.appendChild(table);
    }

    root.appendChild(cardScenario);
    if(subrowsCard) root.appendChild(subrowsCard);
    root.appendChild(cardTree);
    root.appendChild(cardPreview);
    setTimeout(()=>{ renderTree(); renderPreview(); }, 0);

    // Store selector getter on the *screen ctx* (ctx2), so onSave receives it.
    ctx2.__getSelectedLineIdxs = ()=> computeSelectedLineIdxs(root);
    return root;
  },
  onSave: async (ctx2)=>{

          const template = getTemplateById(ctx2.templateId);
          if(!template) return;
          const selectedLineIdxs = typeof ctx2.__getSelectedLineIdxs === 'function' ? ctx2.__getSelectedLineIdxs() : [1];
          const scenario = ctx2.scenario || 'existing';

          const toId = ctx2.destJournalId;
          if(!toId){
            UI.toast?.error?.('Не обрано журнал призначення') ?? console.error('No target journal');
            return;
          }

          const toSheet = sheets.find(s => s.key === toId) || sheets[0];
          const toColKeys = ensureArray(toSheet?.columns).map(c => c.id);

          // Validate destination subrows policy: block if ANY column has subrows disabled
          const dstSettings = await loadTableSettingsForJournal(toId);
          const disabled = [];
          const enabledMap = dstSettings?.subrows?.columnsSubrowsEnabled ?? {};
          for(let i=0;i<toColKeys.length;i++){
            const k = toColKeys[i];
            if(!k) continue;
            if(enabledMap[k] === false){
              const colName = toSheet?.columns?.[i]?.name ?? k;
              disabled.push(`${i+1}: ${colName}`);
            }
          }
          if(disabled.length){
            UI.toast?.error?.(`Копіювання неможливе: підстроки вимкнені у колонках ${disabled.join(', ')}`) ?? console.error('Subrows disabled in target columns', disabled);
            return;
          }

          const targetRowBase = core.applyTemplateToRow(template, srcRow, { sourceColKeys: fromColKeys, targetColKeys: toColKeys });
          const recordBase = core.buildRecordFromRow(toColKeys, targetRowBase);

          const includeBase = selectedLineIdxs.includes(1);
          const srcSubrows = ensureArray(srcRecord?.subrows);
          const mappedLines = [];
          if(includeBase){
            mappedLines.push({ cells: { ...(recordBase?.cells ?? {}) } });
          }
          for(const lineIdx of selectedLineIdxs){
            if(lineIdx <= 1) continue;
            const srcSub = srcSubrows[lineIdx-2];
            if(!srcSub) continue;
            const srcSubRow = rowArrayFromCells(srcSub?.cells ?? {}, fromColKeys);
            const tgtSubRow = core.applyTemplateToRow(template, srcSubRow, { sourceColKeys: fromColKeys, targetColKeys: toColKeys });
            const subRec = core.buildRecordFromRow(toColKeys, tgtSubRow);
            mappedLines.push({ cells: { ...(subRec?.cells ?? {}) } });
          }

          if(scenario === 'new'){
            const baseCells = includeBase ? (recordBase?.cells ?? {}) : {};
            const subLines = includeBase ? mappedLines.slice(1) : mappedLines.slice(0);
            const recordPartial = { ...recordBase, cells: baseCells, subrows: subLines.map(l=>({ cells: { ...(l?.cells ?? {}) } })) };
            await tableStore.addRecord(toId, recordPartial);
            UI.toast?.success?.('Копіювання виконано (створено нову строку у цільовому журналі)') ?? console.log('Transfer applied (new row)');
            SettingsWindow.close();
            return;
          }

          const labelKey = toColKeys.find(k=>k) ?? null;
          const colLabels = ensureArray(toSheet?.columns).map(c=>c?.name ?? c?.id ?? '');
          const targetRecordId = await pickTargetRecordIdFull({ journalId: toId, colKeys: toColKeys, colLabels });
          if(!targetRecordId) return;

          const dstDataset = await tableStore.getDataset(toId);
          const dstRecord = ensureArray(dstDataset?.records).find(r=>r?.id === targetRecordId);
          if(!dstRecord){
            UI.toast?.warning?.('Цільова строка не знайдена') ?? console.warn('Target record not found');
            return;
          }

          const existingSubrows = ensureArray(dstRecord?.subrows);
          let globalMaxLine = 0;
          for(const colKey of toColKeys){
            if(!colKey) continue;
            let maxForCol = 0;
            const baseVal = dstRecord?.cells?.[colKey];
            if(isFilled(baseVal)) maxForCol = 1;
            for(let i=0;i<existingSubrows.length;i++){
              const v = existingSubrows[i]?.cells?.[colKey];
              if(isFilled(v)) maxForCol = Math.max(maxForCol, i+2);
            }
            if(maxForCol > globalMaxLine) globalMaxLine = maxForCol;
          }

          const copyLines = mappedLines;
          const K = copyLines.length;
          const neededLastLine = globalMaxLine + K;
          const neededSubrowsLen = Math.max(0, neededLastLine - 1);
          const nextSubrows = existingSubrows.map(s=>({ cells: { ...(s?.cells ?? {}) } }));
          while(nextSubrows.length < neededSubrowsLen) nextSubrows.push({ cells: {} });
          const nextBaseCells = { ...(dstRecord?.cells ?? {}) };
          for(let i=0;i<K;i++){
            const dstLine = globalMaxLine + 1 + i;
            const patchCells = copyLines[i]?.cells ?? {};
            if(dstLine <= 1){
              for(const k of Object.keys(patchCells)) nextBaseCells[k] = patchCells[k];
            }else{
              const si = dstLine - 2;
              const cur = nextSubrows[si] || { cells:{} };
              nextSubrows[si] = { ...cur, cells: { ...(cur?.cells ?? {}), ...patchCells } };
            }
          }

          await tableStore.updateRecord(toId, targetRecordId, { cells: nextBaseCells, subrows: nextSubrows });
          UI.toast?.success?.('Копіювання виконано (оновлено існуючу строку у цільовому журналі)') ?? console.log('Transfer applied (existing row)');
          SettingsWindow.close();
  }
}));
      return;
    };

    const adapter = UI?.swsAdapter ?? global?.SWSAdapter ?? null;
    if(adapter && typeof adapter.open === 'function'){
      const adapterOpenResult = adapter.open({
        screenId: 'transfer.execute',
        swsOpen: ()=> {
          if(!SettingsWindow?.openRoot || !SettingsWindow?.openCustomRoot || !SettingsWindow?.push){
            throw new Error('SettingsWindow SWS API is unavailable for transfer.execute');
          }
          return openTransferSws();
        },
        legacy: {
          title: 'Копіювання',
          contentNode: null,
          closeOnOverlay: true
        }
      });
      if(adapterOpenResult?.ok) return;
    }

    if(SettingsWindow?.openRoot){
      openTransferSws();
      return;
    }

    // Fallback to legacy TransferUI modal
    const TransferUI = global.TransferUI;
    if(!TransferUI?.openTransfer){
      UI.toast?.error?.('TransferUI модалка не завантажена') ?? console.error('TransferUI modals not loaded');
      return;
    }

    // Step 0: pick scenario + subrows to copy (if any)
    const pick = await openScenarioAndSubrowsPicker({ srcRecord });
    if(!pick) return;
    const scenario = pick.scenario || 'existing';
    const selectedLineIdxs = ensureArray(pick.selectedLineIdxs).filter(n=>Number.isFinite(n) && n>0);
    TransferUI.openTransfer({
      sheets,
      templates,
      sourceSheetKey: sourceJournalId,
      sourceRow: srcRow,
      onApply: async ({ template, targetRow }) => {
        const toId = template?.toSheetKey;
        if(!toId){
          UI.toast?.error?.('Не вказано цільовий журнал') ?? console.error('No target journal');
          return;
        }

        const toSheet = sheets.find(s => s.key === toId) || sheets[0];
        const toColKeys = ensureArray(toSheet?.columns).map(c => c.id);

        // Validate destination subrows policy: block if ANY column has subrows disabled (as requested)
        const dstSettings = await loadTableSettingsForJournal(toId);
        const disabled = [];
        const enabledMap = dstSettings?.subrows?.columnsSubrowsEnabled ?? {};
        for(let i=0;i<toColKeys.length;i++){
          const k = toColKeys[i];
          if(!k) continue;
          if(enabledMap[k] === false){
            const colName = toSheet?.columns?.[i]?.name ?? k;
            disabled.push(`${i+1}: ${colName}`);
          }
        }
        if(disabled.length){
          UI.toast?.error?.(`Копіювання неможливе: підстроки вимкнені у колонках ${disabled.join(', ')}`) ?? console.error('Subrows disabled in target columns', disabled);
          return;
        }

        // Base row mapping from UI targetRow
        const recordBase = core.buildRecordFromRow(toColKeys, targetRow);

        // Build mapped lines (line #1 is base row, lines #2.. are subrows)
        const includeBase = selectedLineIdxs.includes(1);
        const srcSubrows = ensureArray(srcRecord?.subrows);

        const mappedLines = [];
        // line 1 (base)
        if(includeBase){
          mappedLines.push({ cells: { ...(recordBase?.cells ?? {}) } });
        }

        // lines 2..N+1 (subrows)
        for(const lineIdx of selectedLineIdxs){
          if(lineIdx <= 1) continue;
          const srcSub = srcSubrows[lineIdx-2]; // line2 -> subrows[0]
          if(!srcSub) continue;
          const srcSubRow = rowArrayFromCells(srcSub?.cells ?? {}, fromColKeys);
          const tgtSubRow = core.applyTemplateToRow(template, srcSubRow, { sourceColKeys: fromColKeys, targetColKeys: toColKeys });
          const subRec = core.buildRecordFromRow(toColKeys, tgtSubRow);
          mappedLines.push({ cells: { ...(subRec?.cells ?? {}) } });
        }
        if(scenario === 'new'){
          // Scenario 2: copy into a NEW row in destination
          const baseCells = includeBase ? (recordBase?.cells ?? {}) : {};
          const subLines = includeBase ? mappedLines.slice(1) : mappedLines.slice(0);
          const recordPartial = { ...recordBase, cells: baseCells, subrows: subLines.map(l=>({ cells: { ...(l?.cells ?? {}) } })) };
          await tableStore.addRecord(toId, recordPartial);
          UI.toast?.success?.('Копіювання виконано (створено нову строку у цільовому журналі)') ?? console.log('Transfer applied (new row)');
          return;
        }

        // Scenario 1: copy into an EXISTING row in destination (select target record)
        const labelKey = toColKeys.find(k=>k) ?? null;
        const targetRecordId = await pickTargetRecordId({ journalId: toId, labelColKey: labelKey });
        if(!targetRecordId) return;

        const dstDataset = await tableStore.getDataset(toId);
        const dstRecord = ensureArray(dstDataset?.records).find(r=>r?.id === targetRecordId);
        if(!dstRecord){
          UI.toast?.warning?.('Цільова строка не знайдена') ?? console.warn('Target record not found');
          return;
        }

        // Determine global max filled LINE index (1=base, 2..=subrows) across ALL columns
        const existingSubrows = ensureArray(dstRecord?.subrows);
        const totalLines = 1 + existingSubrows.length;

        let globalMaxLine = 0;
        for(const colKey of toColKeys){
          if(!colKey) continue;
          let maxForCol = 0;

          // base line (1)
          const baseVal = dstRecord?.cells?.[colKey];
          if(isFilled(baseVal)) maxForCol = 1;

          // subrows lines (2..)
          for(let i=0;i<existingSubrows.length;i++){
            const v = existingSubrows[i]?.cells?.[colKey];
            if(isFilled(v)) maxForCol = Math.max(maxForCol, i+2); // line index
          }

          if(maxForCol > globalMaxLine) globalMaxLine = maxForCol;
        }

        const copyLines = mappedLines; // each is {cells}
        const K = copyLines.length;

        const neededLastLine = globalMaxLine + K;
        const neededSubrowsLen = Math.max(0, neededLastLine - 1);

        // clone existing subrows
        const nextSubrows = existingSubrows.map(s=>({ cells: { ...(s?.cells ?? {}) } }));
        while(nextSubrows.length < neededSubrowsLen) nextSubrows.push({ cells: {} });

        // clone base cells (we patch only if a copied line writes into base)
        const nextBaseCells = { ...(dstRecord?.cells ?? {}) };

        // Apply copied lines starting at (globalMaxLine + 1)
        for(let i=0;i<K;i++){
          const dstLine = globalMaxLine + 1 + i; // 1-based line
          const patchCells = copyLines[i]?.cells ?? {};
          if(dstLine <= 1){
            // write into base
            for(const k of Object.keys(patchCells)) nextBaseCells[k] = patchCells[k];
          }else{
            const si = dstLine - 2; // subrows index
            const cur = nextSubrows[si] || { cells:{} };
            nextSubrows[si] = { ...cur, cells: { ...(cur?.cells ?? {}), ...patchCells } };
          }
        }

        await tableStore.updateRecord(toId, targetRecordId, {
          cells: nextBaseCells,
          subrows: nextSubrows
        });

        UI.toast?.success?.('Копіювання виконано (оновлено існуючу строку у цільовому журналі)') ?? console.log('Transfer applied (existing row)');
}
    });
  }

  UI.transfer = { openSettings, openRowModal };
  return UI.transfer;
}
