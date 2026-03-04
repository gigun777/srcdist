(function(){
  // SWS Quick Navigation Panel v3
  // Goals:
  // - One unified tree model for spaces + journals
  // - 3 view modes: PATH (default on open), ALL_EXPANDED, ALL_COLLAPSED
  // - Single tap: toggle branch + set focus
  // - Double tap: navigate + close
  // - Add creates sibling on focused level (space/journal) with focus on new node (NO auto navigate)
  // - Event-driven refresh via opts.subscribe (no polling)

  const INDENT_STEP = 14;
  const DOUBLE_TAP_MS = 320;

  const norm = (v)=>String(v||'').toLowerCase().trim();

  function rand1to9(){ return Math.floor(Math.random()*9)+1; }
  async function confirmDeleteNumber(title){
    const n = rand1to9();
    const v = prompt(`${title}\n\nПідтвердження видалення.\nВведіть число: ${n}`);
    if(v===null) return false;
    return String(v).trim() === String(n);
  }

  function mkMiniBtn(ui, {text, title, variant}){
    const b = ui.el('button', `sws-qnav-mini ${variant||''}`.trim(), text);
    b.type = 'button';
    if(title) b.title = title;
    return b;
  }

  function mkCaret(ui, {hasKids, expanded, title}){
    const b = mkMiniBtn(ui, {text: hasKids ? (expanded ? '▾' : '▸') : ' ', title: title||''});
    b.classList.add('sws-qnav-caret');
    if(!hasKids){ b.style.opacity='0'; b.style.pointerEvents='none'; }
    return b;
  }

  function safeCloseSWS(){
    try{ window.SettingsWindow?.close?.(); }catch(_){ }
    try{ window.SettingsWindow?.pop?.(); }catch(_){ }
  }

  function uidFor(type, id){ return (type==='space' ? 'S:' : 'J:') + String(id||''); }
  function parseUid(uid){
    const s = String(uid||'');
    if(s.startsWith('S:')) return {type:'space', id:s.slice(2)};
    if(s.startsWith('J:')) return {type:'journal', id:s.slice(2)};
    return {type:'unknown', id:s};
  }

  function nodeTitle(n){
    if(!n) return '';
    if(n.type==='space') return String(n.name || n.title || n.id || '');
    return String(n.title || n.key || n.name || n.id || '');
  }

  function isConnectedRoot(el){ return !!(el && el.isConnected); }

  /**
   * opts:
   *  - ui
   *  - getData(): Promise<{spaces, activeSpaceId, jtree, activeJournalId}>
   *  - subscribe(handler): () => void   // called when underlying state changed
   *  - showSpaces, showJournals, allowAdd, allowDelete
   *  - onGoSpace(spaceId)
   *  - onAddSpace({parentSpaceId, noNavigate})
   *  - onDeleteSpace(spaceId)
   *  - onGoJournalPath(pathIds)
   *  - onAddJournalChild(pathIds)        // kept for backward compatibility (adds child)
   *  - onAddJournalCurrentLevel({parentId, noNavigate}) OR ({activeJournalId, activeSpaceId, noNavigate})
   *  - onDeleteJournal(journalId)
   */
  async function createPanel(opts){
    const {
      ui,
      title = 'Швидка навігація',
      showSpaces = true,
      showJournals = true,
      allowAdd = true,
      allowDelete = true,
      getData,
      subscribe,
      onGoSpace,
      onAddSpace,
      onDeleteSpace,
      onGoJournalPath,
      onAddJournalChild,
      onAddJournalCurrentLevel,
      onDeleteJournal,
    } = opts || {};

    if(!ui) throw new Error('SWSQuickNav.createPanel(): opts.ui is required');

    // --- live snapshots from storage
    let _spaces = [];
    let _activeSpaceId = null;
    let _jtree = null;
    let _activeJournalId = null;

    async function refreshData(){
      if(typeof getData !== 'function') return;
      const d = await getData();
      if(!d || typeof d !== 'object') return;
      if(Array.isArray(d.spaces)) _spaces = d.spaces;
      if(typeof d.activeSpaceId === 'string' || d.activeSpaceId===null) _activeSpaceId = d.activeSpaceId;
      if(d.jtree && typeof d.jtree === 'object') _jtree = d.jtree;
      if(typeof d.activeJournalId === 'string' || d.activeJournalId===null) _activeJournalId = d.activeJournalId;
    }

    await refreshData();

    // --- unified tree snapshot
    let byUid = {};          // uid -> node
    let roots = [];          // root uids (spaces)

    function buildSnapshot(){
      byUid = {};
      roots = [];

      const spaces = Array.isArray(_spaces) ? _spaces.filter(Boolean) : [];
      const jnodes = (_jtree && _jtree.nodes) ? _jtree.nodes : {};

      // Spaces
      const spaceById = {};
      for(const sp of spaces){
        const sid = String(sp.id||'');
        if(!sid) continue;
        spaceById[sid] = sp;
        const uid = uidFor('space', sid);
        byUid[uid] = {
          uid,
          type: 'space',
          id: sid,
          parentUid: sp.parentId ? uidFor('space', sp.parentId) : null,
          name: sp.name || sp.title || sid,
          title: sp.title || sp.name || sid,
          children: [],
        };
      }

      // Space hierarchy
      for(const uid of Object.keys(byUid)){
        const n = byUid[uid];
        if(n.type !== 'space') continue;
        if(n.parentUid && byUid[n.parentUid] && byUid[n.parentUid].type==='space'){
          byUid[n.parentUid].children.push(uid);
        }else{
          roots.push(uid);
        }
      }

      // Journals
      const journalIds = Object.keys(jnodes||{});
      for(const jid of journalIds){
        const j = jnodes[jid];
        if(!j) continue;
        const uid = uidFor('journal', j.id || jid);
        // Determine parent: journal.parentId may point to a journal id OR a space id
        let parentUid = null;
        const pid = j.parentId || null;
        if(pid){
          if(jnodes[pid]) parentUid = uidFor('journal', pid);
          else parentUid = uidFor('space', pid);
        }else{
          // root journal: attach to space
          const sid = j.spaceId || _activeSpaceId || null;
          parentUid = sid ? uidFor('space', sid) : null;
        }

        byUid[uid] = {
          uid,
          type: 'journal',
          id: String(j.id || jid),
          parentUid,
          spaceId: j.spaceId || null,
          key: j.key,
          title: j.title,
          name: j.name,
          children: [],
        };
      }

      // Journal children
      for(const uid of Object.keys(byUid)){
        const n = byUid[uid];
        if(n.type !== 'journal') continue;
        const j = jnodes[n.id];
        const kids = (j && Array.isArray(j.children)) ? j.children : [];
        for(const cid of kids){
          const cuid = uidFor('journal', cid);
          if(byUid[cuid] && byUid[cuid].type==='journal') n.children.push(cuid);
        }
      }

      // Attach root journals to their space if missing linkage
      // (safety for data where parentUid is computed but space node may not exist)
      for(const uid of Object.keys(byUid)){
        const n = byUid[uid];
        if(n.type !== 'journal') continue;
        if(n.parentUid && byUid[n.parentUid]){
          byUid[n.parentUid].children.push(uid);
        }
      }

      // Sort children: spaces by name, journals by title
      function sortChildren(uid){
        const n = byUid[uid];
        if(!n || !Array.isArray(n.children)) return;
        n.children = Array.from(new Set(n.children));
        n.children.sort((a,b)=>nodeTitle(byUid[a]).localeCompare(nodeTitle(byUid[b])));
        for(const c of n.children) sortChildren(c);
      }
      roots = Array.from(new Set(roots)).filter(u=>byUid[u] && byUid[u].type==='space');
      roots.sort((a,b)=>nodeTitle(byUid[a]).localeCompare(nodeTitle(byUid[b])));
      for(const r of roots) sortChildren(r);
    }

    buildSnapshot();

    // --- internal state
    const MODES = { PATH:'PATH', ALL_EXPANDED:'ALL_EXPANDED', ALL_COLLAPSED:'ALL_COLLAPSED' };
    const state = {
      viewMode: MODES.PATH,
      expanded: new Set(),
      focusedUid: null,
      activeUid: null,
    };

    function computeActiveUid(){
      if(_activeJournalId) return uidFor('journal', _activeJournalId);
      if(_activeSpaceId) return uidFor('space', _activeSpaceId);
      // fallback: first root space
      return roots[0] || null;
    }

    function ancestors(uid){
      const out = [];
      let cur = uid;
      const guard = new Set();
      while(cur && byUid[cur] && !guard.has(cur)){
        guard.add(cur);
        const p = byUid[cur].parentUid || null;
        if(p) out.push(p);
        cur = p;
      }
      return out;
    }

    function applyPathModeOnce(){
      state.activeUid = computeActiveUid();
      state.expanded.clear();
      for(const a of ancestors(state.activeUid)) state.expanded.add(a);
      state.focusedUid = state.activeUid;
      state.viewMode = MODES.PATH;
      updateToggleUI();
    }

    function applyAllExpanded(){
      state.expanded.clear();
      for(const uid of Object.keys(byUid)){
        const n = byUid[uid];
        if(n && n.children && n.children.length) state.expanded.add(uid);
      }
      state.viewMode = MODES.ALL_EXPANDED;
      updateToggleUI();
    }

    function applyAllCollapsed(){
      state.expanded.clear();
      state.viewMode = MODES.ALL_COLLAPSED;
      updateToggleUI();
    }

    function ensureFocusVisible(){
      if(!state.focusedUid || !byUid[state.focusedUid]) return;
      for(const a of ancestors(state.focusedUid)) state.expanded.add(a);
    }

    function keepStateAfterSnapshotRebuild(prevByUid){
      // keep expanded nodes that still exist
      const nextExpanded = new Set();
      for(const uid of state.expanded){ if(byUid[uid]) nextExpanded.add(uid); }
      state.expanded = nextExpanded;
      // keep focus if exists; else fallback to active
      if(state.focusedUid && !byUid[state.focusedUid]) state.focusedUid = null;
      state.activeUid = computeActiveUid();
      if(!state.focusedUid) state.focusedUid = state.activeUid;
      ensureFocusVisible();
    }

    // --- root container
    const root = ui.el('div', 'sws-qnav');

    // Header
    const head = ui.el('div', 'sws-qnav-head');
    head.appendChild(ui.el('div','sws-muted', title));
    const toggle = mkMiniBtn(ui, {text: '⦿', title:'Перемикає: 1) шлях до поточного журналу 2) все розгорнуто 3) все згорнуто'});
    toggle.classList.add('sws-qnav-toggle');
    head.appendChild(toggle);
    root.appendChild(head);

    // Search
    const srow = ui.el('div','sws-qnav-search');
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'sws-input';
    search.placeholder = 'Пошук (простір/журнал)…';
    search.style.flex = '1';
    search.style.minWidth = '0';
    const clear = mkMiniBtn(ui, {text:'✕', title:'Очистити пошук'});
    clear.onclick = (e)=>{ e.preventDefault(); e.stopPropagation(); search.value=''; renderTree(); search.focus(); };
    srow.appendChild(search);
    srow.appendChild(clear);
    root.appendChild(srow);

    // Actions row: left add space, right add journal (both on focused level)
    const arow = ui.el('div','sws-qnav-actions');
    arow.style.display = 'flex';
    arow.style.gap = '8px';
    arow.style.flexWrap = 'wrap';
    arow.style.margin = '8px 0';

    const addSpaceBtn = ui.el('button','sws-btn', '＋ Простір');
    addSpaceBtn.type = 'button';
    addSpaceBtn.style.flex = '1';
    addSpaceBtn.style.minWidth = '160px';
    if(!showSpaces || !allowAdd || !onAddSpace) addSpaceBtn.style.display='none';

    const addJournalBtn = ui.el('button','sws-btn', '＋ Журнал');
    addJournalBtn.type = 'button';
    addJournalBtn.style.flex = '1';
    addJournalBtn.style.minWidth = '160px';
    if(!showJournals || !allowAdd || (!onAddJournalCurrentLevel && !onAddJournalChild)) addJournalBtn.style.display='none';

    arow.appendChild(addSpaceBtn);
    arow.appendChild(addJournalBtn);
    root.appendChild(arow);

    // Tree
    const tree = ui.el('div','sws-qnav-tree');
    root.appendChild(tree);

    // Toggle UI
    async function updateToggleUI(){
      if(state.viewMode === MODES.PATH){
        toggle.textContent = '⦿';
        toggle.title = 'Стан 1/3: шлях до поточного журналу (за замовчуванням)';
      }else if(state.viewMode === MODES.ALL_EXPANDED){
        toggle.textContent = '▾';
        toggle.title = 'Стан 2/3: все розгорнуто';
      }else{
        toggle.textContent = '▸';
        toggle.title = 'Стан 3/3: все згорнуто';
      }
    }

    toggle.onclick = async (e)=>{
      e.preventDefault(); e.stopPropagation();
      if(state.viewMode === MODES.PATH){
        applyAllExpanded();
      }else if(state.viewMode === MODES.ALL_EXPANDED){
        applyAllCollapsed();
      }else{
        // back to PATH (re-apply now)
        await refreshData();
        buildSnapshot();
        applyPathModeOnce();
      }
      renderTree();
    };

    // --- Tap handling
    const lastTap = { uid:null, t:0 };

    async function onDoubleTapNavigate(uid){
      const p = parseUid(uid);
      if(p.type==='space'){
        if(onGoSpace) await onGoSpace(p.id);
        safeCloseSWS();
        return;
      }
      if(p.type==='journal'){
        if(onGoJournalPath){
          const path = buildJournalPath(p.id);
          await onGoJournalPath(path);
        }
        safeCloseSWS();
        return;
      }
    }

    function onSingleTapToggleAndFocus(uid){
      const n = byUid[uid];
      if(!n) return;
      if(n.children && n.children.length){
        if(state.expanded.has(uid)) state.expanded.delete(uid);
        else state.expanded.add(uid);
      }
      state.focusedUid = uid;
      ensureFocusVisible();
      renderTree();
    }

    async function handleTap(uid){
      const now = Date.now();
      if(lastTap.uid === uid && (now - lastTap.t) <= DOUBLE_TAP_MS){
        lastTap.uid = null; lastTap.t = 0;
        onDoubleTapNavigate(uid);
        return;
      }
      lastTap.uid = uid; lastTap.t = now;
      // delay single tap slightly to avoid fighting with double tap
      setTimeout(()=>{
        if(lastTap.uid === uid && (Date.now() - lastTap.t) >= DOUBLE_TAP_MS){
          // single tap confirmed
          lastTap.uid = null; lastTap.t = 0;
          onSingleTapToggleAndFocus(uid);
        }
      }, DOUBLE_TAP_MS + 10);
    }

    // --- Add buttons (siblings at focused level)
    addSpaceBtn.onclick = async (e)=>{
      e.preventDefault(); e.stopPropagation();
      if(!onAddSpace) return;
      // Sibling at focused space level: parentSpaceId = focusedSpace.parentId (or null)
      let parentSpaceId = null;
      if(state.focusedUid){
        const f = byUid[state.focusedUid];
        if(f && f.type==='space'){
          const puid = f.parentUid;
          parentSpaceId = puid ? parseUid(puid).id : null;
        }else{
          // if focus is journal, add space at active space level
          parentSpaceId = null;
        }
      }

      const prevSpaceIds = new Set((Array.isArray(_spaces)?_spaces:[]).map(s=>s && s.id).filter(Boolean));
      await onAddSpace({ parentSpaceId, noNavigate: true });

      await refreshData();
      const prevByUid = byUid;
      buildSnapshot();
      keepStateAfterSnapshotRebuild(prevByUid);

      // infer new space uid
      const curSpaces = Array.isArray(_spaces)?_spaces:[];
      const cand = curSpaces.filter(s=>s && s.id && !prevSpaceIds.has(s.id) && ((s.parentId||null)===(parentSpaceId||null)));
      if(cand.length){
        cand.sort((a,b)=>String(a.name||a.title||'').localeCompare(String(b.name||b.title||'')));
        const newId = cand[cand.length-1].id;
        const newUid = uidFor('space', newId);
        if(byUid[newUid]){
          state.focusedUid = newUid;
          state.expanded.add(byUid[newUid].parentUid || '');
          ensureFocusVisible();
        }
      }

      renderTree();
    };

    addJournalBtn.onclick = async (e)=>{
      e.preventDefault(); e.stopPropagation();

      // Compute parent target for sibling journal:
      // - if focus journal => parent is its parentUid (space or journal)
      // - if focus space => parent is that space id (root journal in space)
      // - else => active journal's parent or active space
      let parentId = _activeSpaceId || null;
      if(state.focusedUid && byUid[state.focusedUid]){
        const f = byUid[state.focusedUid];
        if(f.type==='journal'){
          const puid = f.parentUid;
          parentId = puid ? parseUid(puid).id : (_activeSpaceId || null);
        }else if(f.type==='space'){
          parentId = f.id;
        }
      }else if(_activeJournalId && _jtree?.nodes?.[_activeJournalId]){
        parentId = _jtree.nodes[_activeJournalId].parentId || (_activeSpaceId||null);
      }

      const prevJournalIds = new Set(Object.keys((_jtree && _jtree.nodes) ? _jtree.nodes : {}));

      if(typeof onAddJournalCurrentLevel === 'function'){
        // Prefer a direct parentId contract if supported
        await onAddJournalCurrentLevel({ parentId, activeJournalId: _activeJournalId, activeSpaceId: _activeSpaceId, noNavigate: true });
      }else if(typeof onAddJournalChild === 'function'){
        // Backward compatible: treat as "add child" using path to focused journal
        // If we only have child API, we cannot create sibling without parentId, so we add under parentId.
        // Build a path to parentId if it is a journal, else empty path implies root at space.
        if(_jtree && _jtree.nodes && _jtree.nodes[parentId]){
          const ppath = buildJournalPath(parentId);
          await onAddJournalChild(ppath);
        }else{
          // add root journal in space by creating a fake path of active root? fallback: use active journal path
          const apath = _activeJournalId ? buildJournalPath(_activeJournalId) : [];
          await onAddJournalChild(apath);
        }
      }

      await refreshData();
      const prevByUid = byUid;
      buildSnapshot();
      keepStateAfterSnapshotRebuild(prevByUid);

      // infer new journal
      const nowNodes = (_jtree && _jtree.nodes) ? _jtree.nodes : {};
      const newIds = Object.keys(nowNodes).filter(id=>!prevJournalIds.has(id));
      if(newIds.length){
        // pick one that has parentId === parentId (or is a child if fallback)
        let newId = null;
        for(const id of newIds){
          if((nowNodes[id]?.parentId||null) === (parentId||null)) { newId = id; break; }
        }
        if(!newId) newId = newIds[0];
        const newUid = uidFor('journal', newId);
        if(byUid[newUid]){
          state.focusedUid = newUid;
          ensureFocusVisible();
        }
      }

      renderTree();
    };

    // --- Search support
    function computeVisibleForSearch(q){
      const visible = new Set();
      if(!q) return {visible:null};

      // match nodes by title
      for(const uid of Object.keys(byUid)){
        const n = byUid[uid];
        const t = norm(nodeTitle(n));
        if(t.includes(q)){
          visible.add(uid);
          for(const a of ancestors(uid)) visible.add(a);
        }
      }
      return {visible};
    }

    // --- Render
    function renderNode(uid, depth){
      const n = byUid[uid];
      if(!n) return [];
      const rows = [];

      const kids = (n.children || []).filter(c=>byUid[c]);
      const hasKids = kids.length > 0;
      const expanded = state.expanded.has(uid);

      const row = ui.el('div','sws-qnav-row');
      if(uid === state.activeUid) row.classList.add('sws-qnav-active');
      if(uid === state.focusedUid) row.classList.add('sws-qnav-focused');

      const caret = mkCaret(ui, {hasKids, expanded, title: hasKids ? 'Згорнути/розгорнути' : ''});
      const label = nodeTitle(n);
      const icon = n.type==='space' ? '📁' : '📄';
      const b = ui.el('button','sws-qnav-btn', `${icon} ${label}`);
      b.style.marginLeft = (depth*INDENT_STEP)+'px';
      b.type='button';

      // Single vs double tap
      b.onclick = (e)=>{ e.preventDefault(); e.stopPropagation(); handleTap(uid); };

      caret.onclick = (e)=>{ e.preventDefault(); e.stopPropagation(); handleTap(uid); };

      // Add / delete inline buttons
      const addBtn = mkMiniBtn(ui, {text:'＋', title: n.type==='space' ? 'Додати підпростір / журнал' : 'Додати піджурнал'});
      const delBtn = mkMiniBtn(ui, {text:'🗑', title: 'Видалити', variant:'danger'});

      if(!allowAdd) addBtn.style.display='none';
      if(!allowDelete) delBtn.style.display='none';

      // Inline add: keep legacy behaviour (child) because it's explicit on the node.
      addBtn.onclick = async (e)=>{
        e.preventDefault(); e.stopPropagation();
        if(n.type==='space'){
          if(!onAddSpace) return;
          const prevSpaceIds = new Set((Array.isArray(_spaces)?_spaces:[]).map(s=>s && s.id).filter(Boolean));
          await onAddSpace({ parentSpaceId: n.id, noNavigate: true });
          await refreshData();
          const prevByUid = byUid;
          buildSnapshot();
          keepStateAfterSnapshotRebuild(prevByUid);
          // infer newest child space
          const cand = (Array.isArray(_spaces)?_spaces:[]).filter(s=>s && s.id && !prevSpaceIds.has(s.id) && ((s.parentId||null)===(n.id||null)));
          if(cand.length){
            cand.sort((a,b)=>String(a.name||a.title||'').localeCompare(String(b.name||b.title||'')));
            const newUid = uidFor('space', cand[cand.length-1].id);
            if(byUid[newUid]){ state.focusedUid = newUid; ensureFocusVisible(); }
          }
          // also expand current node
          state.expanded.add(uid);
          renderTree();
          return;
        }

        // journal child
        if(!onAddJournalChild && !onAddJournalCurrentLevel) return;
        const prevJournalIds = new Set(Object.keys((_jtree && _jtree.nodes) ? _jtree.nodes : {}));
        if(onAddJournalChild){
          const path = buildJournalPath(n.id);
          await onAddJournalChild(path);
        }else{
          await onAddJournalCurrentLevel({ parentId: n.id, activeJournalId: _activeJournalId, activeSpaceId: _activeSpaceId, noNavigate: true });
        }
        await refreshData();
        const prevByUid = byUid;
        buildSnapshot();
        keepStateAfterSnapshotRebuild(prevByUid);
        const nowNodes = (_jtree && _jtree.nodes) ? _jtree.nodes : {};
        const newIds = Object.keys(nowNodes).filter(id=>!prevJournalIds.has(id));
        if(newIds.length){
          let newId = null;
          for(const id of newIds){ if((nowNodes[id]?.parentId||null) === (n.id||null)) { newId = id; break; } }
          if(!newId) newId = newIds[0];
          const newUid = uidFor('journal', newId);
          if(byUid[newUid]){ state.focusedUid = newUid; ensureFocusVisible(); }
        }
        state.expanded.add(uid);
        renderTree();
      };

      // Inline delete
      delBtn.onclick = async (e)=>{
        e.preventDefault(); e.stopPropagation();
        if(n.type==='space'){
          if(!onDeleteSpace) return;
          const ok = await confirmDeleteNumber(`Видалити простір "${nodeTitle(n)}"?\n\nУвага: будуть видалені також усі підпростори.`);
          if(!ok) return;
          await onDeleteSpace(n.id);
          await refreshData();
          const prevByUid = byUid;
          buildSnapshot();
          keepStateAfterSnapshotRebuild(prevByUid);
          renderTree();
          return;
        }
        // journal
        if(!onDeleteJournal) return;
        const canDelete = !String(n.id).startsWith('root:');
        if(!canDelete) return;
        const ok = await confirmDeleteNumber(`Видалити журнал "${nodeTitle(n)}"?\n\nУвага: будуть видалені також усі його піджурнали.`);
        if(!ok) return;
        await onDeleteJournal(n.id);
        await refreshData();
        const prevByUid = byUid;
        buildSnapshot();
        keepStateAfterSnapshotRebuild(prevByUid);
        renderTree();
      };

      // Disable delete for protected root journals
      if(n.type==='journal' && String(n.id).startsWith('root:')){
        delBtn.style.opacity = '0.35';
        delBtn.style.pointerEvents = 'none';
        delBtn.title = 'Кореневий журнал видаляти не можна';
      }

      row.appendChild(caret);
      row.appendChild(b);
      row.appendChild(addBtn);
      row.appendChild(delBtn);
      rows.push(row);

      if(hasKids && expanded){
        for(const c of kids){
          rows.push(...renderNode(c, depth+1));
        }
      }

      return rows;
    }

    function renderTree(){
      tree.innerHTML='';
      const q = norm(search.value||'');
      const { visible } = computeVisibleForSearch(q);

      // if searching, auto-expand ancestors of matches (do not destroy user's expanded)
      if(visible){
        for(const uid of visible){
          for(const a of ancestors(uid)) state.expanded.add(a);
        }
      }

      // update active class
      state.activeUid = computeActiveUid();

      const list = [];
      for(const r of roots){
        list.push(...renderNode(r, 0));
      }

      // apply visibility filter
      if(visible){
        for(const row of list){
          // row text includes label; we need uid mapping; easiest: re-render with visible check by uid
        }
        // Re-render with filtering by uid
        tree.innerHTML='';
        const renderFiltered = (uid, depth)=>{
          if(!byUid[uid]) return;
          // show node if in visible set OR it has visible descendant already ensured by ancestors add
          if(!visible.has(uid) && !Array.from(ancestors(uid)).some(a=>visible.has(a))) {
            // if not visible nor ancestor in chain, skip
          }
        };
        // simpler: in search mode, render only nodes that are in visible set.
        const renderNodeFiltered = (uid, depth)=>{
          const n = byUid[uid];
          if(!n) return [];
          const show = visible.has(uid);
          // show ancestors too (they are in visible already)
          if(!show) return [];
          const kids = (n.children||[]).filter(c=>byUid[c] && visible.has(c));
          const hasKids = kids.length>0;
          const expanded = hasKids ? true : false; // force show matched subtree

          const row = ui.el('div','sws-qnav-row');
          if(uid === state.activeUid) row.classList.add('sws-qnav-active');
          if(uid === state.focusedUid) row.classList.add('sws-qnav-focused');

          const caret = mkCaret(ui, {hasKids, expanded, title: hasKids ? 'Згорнути/розгорнути' : ''});
          const label = nodeTitle(n);
          const icon = n.type==='space' ? '📁' : '📄';
          const b = ui.el('button','sws-qnav-btn', `${icon} ${label}`);
          b.style.marginLeft = (depth*INDENT_STEP)+'px';
          b.type='button';
          b.onclick = (e)=>{ e.preventDefault(); e.stopPropagation(); handleTap(uid); };
          caret.onclick = (e)=>{ e.preventDefault(); e.stopPropagation(); handleTap(uid); };

          const addBtn = mkMiniBtn(ui, {text:'＋', title: n.type==='space' ? 'Додати підпростір / журнал' : 'Додати піджурнал'});
          const delBtn = mkMiniBtn(ui, {text:'🗑', title: 'Видалити', variant:'danger'});
          if(!allowAdd) addBtn.style.display='none';
          if(!allowDelete) delBtn.style.display='none';
          // reuse same handlers by delegating to normal render: simplest call onSingleTap? keep minimal: do nothing special
          addBtn.onclick = ()=>{};
          delBtn.onclick = ()=>{};
          if(n.type==='journal' && String(n.id).startsWith('root:')){
            delBtn.style.opacity='0.35'; delBtn.style.pointerEvents='none';
          }

          row.appendChild(caret); row.appendChild(b); row.appendChild(addBtn); row.appendChild(delBtn);
          const out = [row];
          if(hasKids){
            for(const c of kids){ out.push(...renderNodeFiltered(c, depth+1)); }
          }
          return out;
        };

        for(const r of roots){
          for(const line of renderNodeFiltered(r, 0)) tree.appendChild(line);
        }
        return;
      }

      for(const line of list) tree.appendChild(line);
    }

    function buildJournalPath(journalId){
      const jnodes = (_jtree && _jtree.nodes) ? _jtree.nodes : {};
      const out = [];
      let cur = journalId;
      const guard = new Set();
      while(cur && jnodes[cur] && !guard.has(cur)){
        guard.add(cur);
        out.push(cur);
        const pid = jnodes[cur].parentId || null;
        if(!pid) break;
        if(jnodes[pid]) cur = pid;
        else break; // reached space
      }
      out.reverse();
      return out;
    }

    // Initial PATH on open
    applyPathModeOnce();
    renderTree();

    // --- Event-driven refresh
    let unsub = null;
    const doRefreshFromEvent = async ()=>{
      if(!isConnectedRoot(root)) return;
      await refreshData();
      const prevByUid = byUid;
      buildSnapshot();
      keepStateAfterSnapshotRebuild(prevByUid);
      renderTree();
    };

    if(typeof subscribe === 'function'){
      try{ unsub = subscribe(doRefreshFromEvent) || null; }catch(_){ unsub = null; }
    }

    // Best-effort cleanup when modal is closed
    const cleanupTimer = setInterval(()=>{
      if(!isConnectedRoot(root)){
        clearInterval(cleanupTimer);
        try{ unsub && unsub(); }catch(_){ }
      }
    }, 1000);

    // public API
    return {
      root,
      refresh: doRefreshFromEvent,
      destroy: ()=>{
        clearInterval(cleanupTimer);
        try{ unsub && unsub(); }catch(_){ }
      }
    };
  }

  function openQuickNavScreen({
    title='Швидка навігація',
    subtitle='Дерево просторів і журналів',
    getData,
    subscribe,
    showSpaces=true,
    showJournals=true,
    allowAdd=true,
    allowDelete=true,
    onGoSpace,
    onAddSpace,
    onDeleteSpace,
    onGoJournalPath,
    onAddJournalChild,
    onAddJournalCurrentLevel,
    onDeleteJournal,
  }={}){
    if(!window.SettingsWindow) throw new Error('SettingsWindow is not available');
    window.SettingsWindow.push({
      title,
      subtitle,
      ctx: { model: {} },
      content: (ctx)=>{
        const wrap = ctx.ui.el('div','');
        const placeholder = ctx.ui.el('div','sws-muted','Завантаження…');
        wrap.appendChild(placeholder);
        (async ()=>{
          try{
            const panel = await createPanel({
              ui: ctx.ui,
              title: 'Швидка навігація',
              getData,
              subscribe,
              showSpaces,
              showJournals,
              allowAdd,
              allowDelete,
              onGoSpace,
              onAddSpace,
              onDeleteSpace,
              onGoJournalPath,
              onAddJournalChild,
              onAddJournalCurrentLevel,
              onDeleteJournal,
            });
            wrap.replaceChild(panel.root, placeholder);
          }catch(e){
            placeholder.textContent = 'Помилка завантаження навігації: ' + (e?.message || e);
          }
        })();
        return wrap;
      },
      onSave: null,
      saveLabel: 'OK',
      canSave: ()=>false,
    });
  }

  window.SWSQuickNav = { createPanel, openQuickNavScreen };
})();
