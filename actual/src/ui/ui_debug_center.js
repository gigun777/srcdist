// Debug Center (SWS) - Stage 0
// Shows boot marker, health checks and runtime loaded dist assets.

import { buildExportPlanV2 } from '../backup_v2/backup_v2_export_core.js';
import { dryRunImportZipV2 } from '../backup_v2/backup_v2_import_core.js';
import { makeZipStore, listZipEntries, readZipEntry } from '../backup_v2/backup_v2_zip_store.js';
import { runImportPipelineDryRunV2 } from '../backup_v2/backup_v2_import_pipeline_core.js';
import { buildWipePlanV2, executeWipeReplaceV2 } from '../backup_v2/backup_v2_wipe_core.js';
import { applyImportZipV2 } from '../backup_v2/backup_v2_import_apply_core.js';
import { resolveImportConfirmsV2, mergeSimulatedIssues } from '../backup_v2/backup_v2_confirm_core.js';

export function openDebugCenter(){
  const SW = window.SettingsWindow;

  const buildScreen = ()=> ({
    title: 'Debug Center',
    subtitle: 'Boot marker, Health Report та завантажені dist ресурси',
    saveLabel: null,
    canSave: ()=>false,
    content: (ctx)=>{
      const ui = ctx.ui;
      const root = ui.el('div','');

      const section = (title)=>{
        const card = ui.el('div','sws-card');
        card.appendChild(ui.el('div','sws-card-title', title));
        return card;
      };

      // Boot marker
      const bootCard = section('Boot OK marker');
      const boot = window.__SDO_BOOT_OK__ || null;
      bootCard.appendChild(ui.el('div','', boot ? '✅ present' : '❌ missing'));
      if(boot){
        const pre = ui.el('pre','');
        pre.style.whiteSpace = 'pre-wrap';
        pre.textContent = JSON.stringify(boot, null, 2);
        bootCard.appendChild(pre);
      }

      // Module health report
      const healthCard = section('Module Health Report');
      const health = [];

      const getSdo = ()=> window.sdoInst || window.sdo || window.SDO || null;
      const sdo = getSdo();

      const push = (name, ok, details)=>{
        health.push({ name, ok: !!ok, details: details || '' });
      };

      // Core globals
      push('SettingsWindow available', !!window.SettingsWindow);
      push('UI.toast available', !!(window.UI?.toast?.show));
      push('UI.modal available', !!(window.UI?.modal?.open));
      push('SWS adapter available (Alternative A)', !!(window.UI?.swsAdapter));
      push('SWS adapter route API', typeof window.UI?.swsAdapter?.setRoute === 'function');
      push('SWS adapter open API', typeof window.UI?.swsAdapter?.open === 'function');
      push('SWS ui primitives (ctx.ui.el) available', !!(ctx?.ui?.el));

      // SDO / API
      push('SDO instance available (window.sdoInst|sdo)', !!sdo);
      push('SDO.api available', !!(sdo?.api));
      push('tableStore API available', !!(sdo?.api?.tableStore));
      push('tableStore.exportTableData()', typeof sdo?.api?.tableStore?.exportTableData === 'function');
      push('tableStore.importTableData()', typeof sdo?.api?.tableStore?.importTableData === 'function');

      // Storage iface (best-effort)
      const storage = sdo?.api?.storage || null;
      push('storage interface available (via sdo.api.storage)', !!storage);
      push('storage.get()', typeof storage?.get === 'function');
      push('storage.set()', typeof storage?.set === 'function');
      push('storage.del()', typeof storage?.del === 'function');
      push('storage.list()', typeof storage?.list === 'function');

      const renderHealth = ()=>{
        const wrap = ui.el('div','');

        const okCount = health.filter(x=>x.ok).length;
        wrap.appendChild(ui.el('div','', `✅ OK: ${okCount} / ${health.length}`));

        const ul = ui.el('ul','');
        ul.style.margin = '8px 0 0 18px';
        ul.style.padding = '0';
        health.forEach(h=>{
          const li = ui.el('li','');
          li.textContent = `${h.ok ? '✅' : '❌'} ${h.name}${h.details ? ' — ' + h.details : ''}`;
          ul.appendChild(li);
        });
        wrap.appendChild(ul);

        
    // Backup providers smoke-test (exportBackup must include table-datasets now)
    wrap.appendChild(ui.card({
      title: 'Backup providers smoke-test',
      description: 'Перевіряє, що exportBackup() повертає модуль table-datasets (дані таблиць).',
      children: []
    }));
    (function () {
      const row = ui.el('div', '');
      row.style.display = 'flex';
      row.style.gap = '10px';
      row.style.marginTop = '10px';

      const out = ui.el('pre', '');
      out.style.whiteSpace = 'pre-wrap';
      out.style.marginTop = '10px';

      const btn = document.createElement('button');
      btn.className = 'sws-save';
      btn.textContent = 'Run exportBackup check';
      btn.style.flex = '1 1 0';
      btn.style.height = '48px';
      btn.style.borderRadius = '12px';

      btn.onclick = async () => {
        btn.disabled = true;
        try {
          const sdo = window.sdoInst || window.sdo;
          if (!sdo?.exportBackup) throw new Error('sdo.exportBackup not available');
          const bundle = await sdo.exportBackup({ scope: 'all', includeUserData: true });
          const mods = bundle?.modules || {};
          const keys = Object.keys(mods);
          const has = !!mods['table-datasets'];
          const datasetsCount = Array.isArray(mods?.['table-datasets']?.data?.datasets) ? mods['table-datasets'].data.datasets.length : 0;
          out.textContent = JSON.stringify({ ok: true, hasTableDatasets: has, datasetsCount, moduleKeys: keys }, null, 2);
        } catch (e) {
          out.textContent = JSON.stringify({ ok: false, error: (e?.message || String(e)) }, null, 2);
        } finally {
          btn.disabled = false;
        }
      };

      row.appendChild(btn);
      wrap.appendChild(row);
      wrap.appendChild(out);
    })();
return wrap;
      };

      healthCard.appendChild(renderHealth());

      // Storage smoke test (real channel verification)
      const smokeCard = section('Storage channel smoke-test');
      const smokeStatus = ui.el('div','', 'Not run');
      smokeStatus.style.marginBottom = '6px';

      const runSmoke = async ()=>{
        const st = sdo?.api?.storage;
        if (!st || typeof st.get !== 'function' || typeof st.set !== 'function' || typeof st.del !== 'function') {
          smokeStatus.textContent = '❌ storage adapter недоступний (sdo.api.storage)';
          return;
        }
        const key = '__debug__/ping';
        const payload = { ok:true, at: new Date().toISOString() };
        try{
          await st.set(key, payload);
          const got = await st.get(key);
          const ok = !!got && got.ok === true;
          await st.del(key);
          smokeStatus.textContent = ok ? '✅ storage get/set/del OK' : '❌ storage get/set mismatch';
        }catch(err){
          smokeStatus.textContent = '❌ storage error: ' + (err?.message || String(err));
        }
      };

      const smokeBtn = ui.el('button','sws-btn', 'Run smoke-test');
      smokeBtn.onclick = ()=>{ runSmoke(); };
      smokeCard.appendChild(smokeStatus);
      smokeCard.appendChild(smokeBtn);

      // Backup v2 export dry-run (manifest + file plan)
      const backupCard = section('Backup v2: export dry-run');
      const backupInfo = ui.el('div','', 'Not run');
      backupInfo.style.marginBottom = '6px';
      const backupPre = ui.el('pre','');
      backupPre.style.whiteSpace = 'pre-wrap';
      backupPre.style.maxHeight = '260px';
      backupPre.style.overflow = 'auto';

      const runBackupDry = ()=>{
        const sdoLocal = getSdo();
        if (!sdoLocal) {
          backupInfo.textContent = '❌ SDO instance недоступний';
          backupPre.textContent = '';
          return;
        }
        try{
          const plan = buildExportPlanV2({ sdo: sdoLocal, mode: 'full' });
          backupInfo.textContent = `✅ ok — journals: ${plan.journalsCount}, archive: ${plan.archiveName}`;
          backupPre.textContent = JSON.stringify({
            createdAt: plan.createdAt,
            archiveName: plan.archiveName,
            journalsCount: plan.journalsCount,
            sampleJournalFiles: plan.journalFiles.slice(0, 3),
            manifest: plan.manifest
          }, null, 2);
        }catch(err){
          backupInfo.textContent = '❌ error: ' + (err?.message || String(err));
          backupPre.textContent = '';
        }
      };
      const backupBtn = ui.el('button','sws-btn', 'Run export dry-run');
      backupBtn.onclick = ()=>runBackupDry();
      backupCard.appendChild(backupInfo);
      backupCard.appendChild(backupBtn);
      backupCard.appendChild(backupPre);

      // Backup v2 import dry-run (validate manifest + referenced files)
      const importCard = section('Backup v2: import dry-run');
      const importInfo = ui.el('div','', 'Select ZIP then run');
      importInfo.style.marginBottom = '6px';
      const importPre = ui.el('pre','');
      importPre.style.whiteSpace = 'pre-wrap';
      importPre.style.maxHeight = '260px';
      importPre.style.overflow = 'auto';

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.zip,application/zip';
      fileInput.style.display = 'block';
      fileInput.style.margin = '6px 0';

      let pickedFile = null;
      fileInput.onchange = ()=>{
        pickedFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
        importInfo.textContent = pickedFile ? `Picked: ${pickedFile.name} (${pickedFile.size} bytes)` : 'Select ZIP then run';
        importPre.textContent = '';
      };

      const runImportDry = async ()=>{
        if (!pickedFile) {
          importInfo.textContent = '❌ ZIP file not selected';
          return;
        }
        try{
          const ab = await pickedFile.arrayBuffer();
          const rep = await dryRunImportZipV2(ab);
          importInfo.textContent = rep.ok
            ? `✅ ok — manifest found, files: ${rep.filesInZip.length}`
            : `❌ not ok — ${rep.warnings[0] || 'validation failed'}`;
          importPre.textContent = JSON.stringify({
            ok: rep.ok,
            manifestFound: rep.manifestFound,
            missingFiles: rep.missingFiles,
            warnings: rep.warnings,
            filesInZipCount: rep.filesInZip.length,
            manifest: rep.manifest,
          }, null, 2);
        }catch(err){
          importInfo.textContent = '❌ error: ' + (err?.message || String(err));
          importPre.textContent = '';
        }
      };

const runInspectZip = async ()=>{
  if (!pickedFile) {
    importInfo.textContent = '❌ ZIP file not selected';
    return;
  }
  try{
	    const ab = await pickedFile.arrayBuffer();
	    const entries = listZipEntries(ab);
	    const journalNames = entries
	      .map(e => (e && typeof e.name === 'string') ? e.name : null)
	      .filter(name => typeof name === 'string' && name.startsWith('journals/') && name.endsWith('.json'));
    const stats = [];
    for(const name of journalNames.slice(0, 50)){
      try{
        const raw = await readZipEntry(ab, name);
        const s = new TextDecoder().decode(raw);
        const obj = JSON.parse(s);
        // v2 journal file schema (current): top-level meta + data.dataset
        // fallback to older shapes if encountered
        const meta = obj?.meta || obj?.data?.meta || null;
        const records = obj?.data?.dataset?.records || obj?.records || null;
        const rows = (meta && typeof meta.rowsCount === 'number') ? meta.rowsCount : (Array.isArray(records) ? records.length : 0);
        const cols = (meta && typeof meta.columnsCount === 'number') ? meta.columnsCount : null;
        const template = (meta && (meta.templateName || meta.templateId)) ? (meta.templateName || meta.templateId) : (obj?.data?.templateName || obj?.data?.templateId || null);
        const path = (meta && typeof meta.path === 'string') ? meta.path : (obj?.data?.path || null);
        stats.push({ file: name, rows, cols, template, path });
      }catch(e){
        stats.push({ file: name, error: (e?.message || String(e)) });
      }
    }
    importInfo.textContent = `✅ inspect ok — journals: ${journalNames.length}`;
    importPre.textContent = JSON.stringify({ ok:true, journalsCount: journalNames.length, sample: stats.slice(0, 10) }, null, 2);
  }catch(err){
    importInfo.textContent = '❌ inspect error: ' + (err?.message || String(err));
    importPre.textContent = '';
  }
};


      const importBtn = ui.el('button','sws-btn', 'Run import dry-run');
      const inspectBtn = ui.el('button','sws-btn', 'Inspect ZIP journals');
      inspectBtn.style.marginLeft = '8px';
      importBtn.onclick = ()=>{ runImportDry(); };
      inspectBtn.onclick = ()=>{ runInspectZip(); };
      importCard.appendChild(importInfo);
      importCard.appendChild(fileInput);
      importCard.appendChild(importBtn);
      importCard.appendChild(inspectBtn);
      importCard.appendChild(importPre);

      // Backup v2: full import pipeline (dry-run only)
      const pipelineCard = section('Backup v2: import pipeline (dry-run only)');
      const pipeInfo = ui.el('div','', 'Select ZIP then run');
      pipeInfo.style.marginBottom = '6px';
      const pipePre = ui.el('pre','');
      pipePre.style.whiteSpace = 'pre-wrap';
      pipePre.style.maxHeight = '300px';
      pipePre.style.overflow = 'auto';

      const runPipeDry = async ()=>{
        if (!pickedFile) {
          pipeInfo.textContent = '❌ ZIP file not selected';
          return;
        }
        try{
          const rep = await runImportPipelineDryRunV2(pickedFile, { mode: 'replace' });
          try{ window.__SDO_LAST_PIPE_REPORT__ = rep; }catch(_){ }
          const okStages = Array.isArray(rep?.stages) ? rep.stages.filter(s=>s.ok).length : 0;
          const totalStages = Array.isArray(rep?.stages) ? rep.stages.length : 0;
          pipeInfo.textContent = rep?.ok
            ? `✅ pipeline ok — stages: ${okStages}/${totalStages}, warnings: ${(rep?.warnings||[]).length}`
            : `⚠️ pipeline not ok — stages: ${okStages}/${totalStages}, warnings: ${(rep?.warnings||[]).length}`;
          pipePre.textContent = JSON.stringify(rep, null, 2);
        }catch(err){
          pipeInfo.textContent = '❌ error: ' + (err?.message || String(err));
          pipePre.textContent = '';
        }
      };

      const pipeBtn = ui.el('button','sws-btn', 'Run full import pipeline (dry-run only)');
      pipeBtn.onclick = ()=>{ runPipeDry(); };
      pipelineCard.appendChild(pipeInfo);
      // re-use the same file input
      pipelineCard.appendChild(ui.el('div','', 'Використовує вибраний ZIP з секції вище (Import dry-run).'));
      pipelineCard.appendChild(pipeBtn);
      pipelineCard.appendChild(pipePre);


      // C2.4: Simulate mismatch + confirm UX
      const simCard = section('C2.4: Simulate mismatch + confirm UX');
      const simInfo = ui.el('div','', 'Встав JSON з warnings, натисни Run — побачиш confirm-діалоги і рішення.');
      simInfo.style.marginBottom = '6px';
      const simTa = ui.el('textarea','');
      simTa.style.width = '100%';
      simTa.style.minHeight = '120px';
      simTa.value = JSON.stringify({
        warnings: [
          { code:'missing_template', templateId:'T_MISSING', journalFile:'journals/j1.json', fileColumns:3 },
          { code:'columns_mismatch', templateId:'T1', journalFile:'journals/j2.json', fileColumns:5, templateColumns:4 },
          { code:'path_conflict', path:'s1.1/j1', journalFile:'journals/j1.json', otherJournalFile:'journals/jX.json' }
        ]
      }, null, 2);
      const simPre = ui.el('pre','');
      simPre.style.whiteSpace = 'pre-wrap';
      simPre.style.maxHeight = '220px';
      simPre.style.overflow = 'auto';
      const simBtn = ui.el('button','sws-btn', 'Run simulate mismatch (shows confirms)');
      simBtn.onclick = async ()=> {
        try{
          const override = JSON.parse(simTa.value || '{}');
          const baseRep = window.__SDO_LAST_PIPE_REPORT__ || { warnings: [], summary: {}, stages: [] };
          const merged = mergeSimulatedIssues(baseRep, override);
          await resolveImportConfirmsV2(merged, { confirmFn: window.confirm });
          simPre.textContent = JSON.stringify(merged, null, 2);
        }catch(err){
          simPre.textContent = '❌ error: ' + (err?.message || String(err));
        }
      };
      simCard.appendChild(simInfo);
      simCard.appendChild(simTa);
      simCard.appendChild(simBtn);
      simCard.appendChild(simPre);
      root.appendChild(simCard);

      // Backup v2: wipe replace (preview + execute)
      const wipeCard = section('Backup v2: wipe (replace)');
      const wipeInfo = ui.el('div','', 'Preview what will be cleared in replace mode.');
      wipeInfo.style.marginBottom = '6px';
      const wipePre = ui.el('pre','');
      wipePre.style.whiteSpace = 'pre-wrap';
      wipePre.style.maxHeight = '280px';
      wipePre.style.overflow = 'auto';

      const getSdo2 = ()=> window.sdoInst || window.sdo || window.SDO || null;

      const runWipePreview = async ()=>{
        try{
          const sdoInst = getSdo2();
          const storage = sdoInst?.api?.storage;
          if(!storage){ wipeInfo.textContent = '❌ storage not available'; return; }
          const plan = await buildWipePlanV2({ storage });
          wipeInfo.textContent = plan?.ok ? `✅ wipe preview — keys planned: ${plan?.totals?.keys||0}` : `❌ wipe preview failed`;
          wipePre.textContent = JSON.stringify(plan, null, 2);
        }catch(err){
          wipeInfo.textContent = '❌ error: ' + (err?.message || String(err));
          wipePre.textContent = '';
        }
      };

      const runWipeExecute = async ()=>{
        try{
          const sdoInst = getSdo2();
          const storage = sdoInst?.api?.storage;
          if(!storage){ wipeInfo.textContent = '❌ storage not available'; return; }
          const ok = confirm('WIPE (replace) видалить navigation/templates/tableStore/settings. Продовжити?');
          if(!ok){ wipeInfo.textContent = '⏸️ cancelled'; return; }
          const res = await executeWipeReplaceV2({ storage }, { dryRun: false });
          wipeInfo.textContent = res?.ok
            ? `✅ wipe executed — deleted: ${res.deletedCount}, errors: ${(res.errors||[]).length}`
            : `⚠️ wipe executed with errors — deleted: ${res.deletedCount}, errors: ${(res.errors||[]).length}`;
          wipePre.textContent = JSON.stringify(res, null, 2);
        }catch(err){
          wipeInfo.textContent = '❌ error: ' + (err?.message || String(err));
          wipePre.textContent = '';
        }
      };

      const wipePrevBtn = ui.el('button','sws-btn', 'Wipe preview');
      const wipeExecBtn = ui.el('button','sws-btn', 'Wipe execute (confirm)');
      wipeExecBtn.style.marginLeft = '8px';
      wipePrevBtn.onclick = ()=>{ runWipePreview(); };
      wipeExecBtn.onclick = ()=>{ runWipeExecute(); };

      wipeCard.appendChild(wipeInfo);
      wipeCard.appendChild(wipePrevBtn);
      wipeCard.appendChild(wipeExecBtn);
      wipeCard.appendChild(wipePre);


      // Backup v2: apply replace (strict order)
      const applyCard = section('Backup v2: apply (replace)');
      const applyInfo = ui.el('div','', 'Apply ZIP v2 into storage/runtime (templates → settings → navigation → datasets).');
      applyInfo.style.marginBottom = '6px';
      const applyPre = ui.el('pre','');
      applyPre.style.whiteSpace = 'pre-wrap';
      applyPre.style.maxHeight = '280px';
      applyPre.style.overflow = 'auto';

      const runApplyExecute = async ()=>{
        if (!pickedFile) { applyInfo.textContent = '❌ ZIP file not selected (use Import dry-run picker above)'; return; }
        try{
          const sdoInst = getSdo2();
          const storage = sdoInst?.api?.storage;
          if(!sdoInst || !storage){ applyInfo.textContent = '❌ sdo/storage not available'; return; }

          const ok = window.confirm('Apply import (replace)? Це застосує ZIP у порядку templates→settings→navigation→datasets. Рекомендується виконати Wipe перед Apply.');
          if(!ok){ applyInfo.textContent = 'Cancelled'; return; }


          // C2.4: resolve import issues via confirms (missing template / columns mismatch / path conflict)
          const pre = await runImportPipelineDryRunV2(pickedFile, { mode: 'replace' });
          const hasIssues = Array.isArray(pre.warnings) && pre.warnings.some(w=>['missing_template','columns_mismatch','path_conflict'].includes(w.code));
          let decisionsPayload = null;
          if(hasIssues){
            await resolveImportConfirmsV2(pre, { confirmFn: window.confirm });
            decisionsPayload = pre.decisions || null;
          }
          const rep = await applyImportZipV2(pickedFile, { sdo: sdoInst, storage, mode: 'replace', decisions: decisionsPayload });
          applyInfo.textContent = rep.ok
            ? `✅ apply ok — templates:${rep.summary.templates}, journals:${rep.summary.journals}, datasets:${rep.summary.datasets}`
            : `❌ apply failed — stage: ${rep.stages.find(s=>!s.ok)?.name || 'unknown'}`;
          applyPre.textContent = JSON.stringify(rep, null, 2);
        }catch(err){
          applyInfo.textContent = '❌ error: ' + (err?.message || String(err));
          applyPre.textContent = '';
        }
      };

      const applyExecBtn = ui.el('button','sws-btn', 'Apply execute (confirm)');
      applyExecBtn.onclick = ()=>{ runApplyExecute(); };

      applyCard.appendChild(applyInfo);
      applyCard.appendChild(applyExecBtn);
      applyCard.appendChild(applyPre);

      // ZIP store self-test
      const zipCard = section('ZIP store self-test');
      const zipInfo = ui.el('div','', 'Not run');
      zipInfo.style.marginBottom = '6px';
      const zipPre = ui.el('pre','');
      zipPre.style.whiteSpace = 'pre-wrap';
      zipPre.style.maxHeight = '220px';
      zipPre.style.overflow = 'auto';
      const zipBtn = ui.el('button','sws-btn', 'Run ZIP self-test');
      zipBtn.onclick = ()=>{
        try{
          const bytes = makeZipStore([
            { name: 'manifest.json', data: '{"hello":"world"}' },
            { name: 'journals/j1.json', data: '{"id":"j1"}' },
          ]);
          const entries = listZipEntries(bytes.buffer);
          const names = entries.map(e=>e.name);
          const ok = names.includes('manifest.json') && names.includes('journals/j1.json');
          zipInfo.textContent = ok ? `✅ ok — entries: ${names.length}` : '❌ not ok';
          zipPre.textContent = JSON.stringify({ ok, count: names.length, names }, null, 2);
        }catch(err){
          zipInfo.textContent = '❌ error: ' + (err?.message || String(err));
          zipPre.textContent = '';
        }
      };
      zipCard.appendChild(zipInfo);
      zipCard.appendChild(zipBtn);
      zipCard.appendChild(zipPre);

      // Alternative A adapter controls (manual migration ops)
      const adapterCard = section('Alternative A adapter controls');
      const adapterInfo = ui.el('div','', 'Set route per screen and inspect adapter health.');
      adapterInfo.style.marginBottom = '6px';
      const adapterOut = ui.el('pre','');
      adapterOut.style.whiteSpace = 'pre-wrap';
      adapterOut.style.maxHeight = '220px';
      adapterOut.style.overflow = 'auto';

      const routesJson = document.createElement('textarea');
      routesJson.placeholder = '{"debug.center":"sws"}';
      routesJson.style.width = '100%';
      routesJson.style.minHeight = '72px';
      routesJson.style.marginBottom = '8px';

      const idInput = document.createElement('input');
      idInput.type = 'text';
      idInput.value = 'debug.center';
      idInput.placeholder = 'screen id (e.g. debug.center)';
      idInput.style.width = '100%';
      idInput.style.marginBottom = '6px';

      const routeSelect = document.createElement('select');
      routeSelect.style.width = '100%';
      routeSelect.style.marginBottom = '8px';
      ['sws', 'legacy'].forEach((r)=>{
        const opt = document.createElement('option');
        opt.value = r;
        opt.textContent = r;
        routeSelect.appendChild(opt);
      });

      const adapterBtnRow = ui.el('div','');
      adapterBtnRow.style.display = 'flex';
      adapterBtnRow.style.gap = '8px';
      adapterBtnRow.style.flexWrap = 'wrap';

      const getAdapter = ()=> window.UI?.swsAdapter || window.SWSAdapter || null;

      const showState = (extra = {})=>{
        const ad = getAdapter();
        adapterOut.textContent = JSON.stringify({
          hasAdapter: !!ad,
          health: ad?.getHealth?.() || null,
          routes: ad?.getRoutesSnapshot?.() || null,
          ...extra
        }, null, 2);
      };

      const setRouteBtn = ui.el('button','sws-btn', 'Set route');
      setRouteBtn.onclick = ()=>{
        try{
          const ad = getAdapter();
          if(!ad || typeof ad.setRoute !== 'function') throw new Error('adapter.setRoute unavailable');
          const id = String(idInput.value || '').trim();
          if(!id) throw new Error('screen id is empty');
          ad.setRoute(id, routeSelect.value);
          showState({ action: 'setRoute', id, route: routeSelect.value, ok: true });
        }catch(err){
          showState({ action: 'setRoute', ok: false, error: err?.message || String(err) });
        }
      };

      const getRouteBtn = ui.el('button','sws-btn', 'Get route');
      getRouteBtn.onclick = ()=>{
        try{
          const ad = getAdapter();
          if(!ad || typeof ad.getRoute !== 'function') throw new Error('adapter.getRoute unavailable');
          const id = String(idInput.value || '').trim();
          if(!id) throw new Error('screen id is empty');
          const route = ad.getRoute(id);
          showState({ action: 'getRoute', id, route, ok: true });
        }catch(err){
          showState({ action: 'getRoute', ok: false, error: err?.message || String(err) });
        }
      };

      const healthBtn = ui.el('button','sws-btn', 'Health + routes');
      healthBtn.onclick = ()=>showState({ action: 'health' });

      const clearRouteBtn = ui.el('button','sws-btn', 'Clear route');
      clearRouteBtn.onclick = ()=>{
        try{
          const ad = getAdapter();
          if(!ad || typeof ad.clearRoute !== 'function') throw new Error('adapter.clearRoute unavailable');
          const id = String(idInput.value || '').trim();
          if(!id) throw new Error('screen id is empty');
          const removed = ad.clearRoute(id);
          showState({ action: 'clearRoute', id, removed, ok: true });
        }catch(err){
          showState({ action: 'clearRoute', ok: false, error: err?.message || String(err) });
        }
      };

      const clearAllBtn = ui.el('button','sws-btn', 'Clear all routes');
      clearAllBtn.onclick = ()=>{
        try{
          const ad = getAdapter();
          if(!ad || typeof ad.clearAllRoutes !== 'function') throw new Error('adapter.clearAllRoutes unavailable');
          ad.clearAllRoutes();
          showState({ action: 'clearAllRoutes', ok: true });
        }catch(err){
          showState({ action: 'clearAllRoutes', ok: false, error: err?.message || String(err) });
        }
      };

      const exportRoutesBtn = ui.el('button','sws-btn', 'Export routes JSON');
      exportRoutesBtn.onclick = ()=>{
        try{
          const ad = getAdapter();
          if(!ad || typeof ad.exportRoutes !== 'function') throw new Error('adapter.exportRoutes unavailable');
          routesJson.value = JSON.stringify(ad.exportRoutes(), null, 2);
          showState({ action: 'exportRoutes', ok: true });
        }catch(err){
          showState({ action: 'exportRoutes', ok: false, error: err?.message || String(err) });
        }
      };

      const importRoutesBtn = ui.el('button','sws-btn', 'Import routes JSON');
      importRoutesBtn.onclick = ()=>{
        try{
          const ad = getAdapter();
          if(!ad || typeof ad.importRoutes !== 'function') throw new Error('adapter.importRoutes unavailable');
          const parsed = JSON.parse(String(routesJson.value || '{}'));
          const count = ad.importRoutes(parsed, { replace: true });
          showState({ action: 'importRoutes', ok: true, imported: count });
        }catch(err){
          showState({ action: 'importRoutes', ok: false, error: err?.message || String(err) });
        }
      };

      adapterBtnRow.appendChild(setRouteBtn);
      adapterBtnRow.appendChild(getRouteBtn);
      adapterBtnRow.appendChild(clearRouteBtn);
      adapterBtnRow.appendChild(clearAllBtn);
      adapterBtnRow.appendChild(exportRoutesBtn);
      adapterBtnRow.appendChild(importRoutesBtn);
      adapterBtnRow.appendChild(healthBtn);

      adapterCard.appendChild(adapterInfo);
      adapterCard.appendChild(idInput);
      adapterCard.appendChild(routeSelect);
      adapterCard.appendChild(routesJson);
      adapterCard.appendChild(adapterBtnRow);
      adapterCard.appendChild(adapterOut);
      showState();

      // Runtime loaded dist assets
      const assetsCard = section('Runtime loaded dist assets');
      const listWrap = ui.el('div','');

      const readAssets = ()=>{
        try{
          const entries = (performance.getEntriesByType && performance.getEntriesByType('resource')) || [];
          const assets = entries
            .map(e => e.name)
            .filter(n => typeof n === 'string')
            .filter(n => n.includes('/dist/'))
            .filter(n => n.endsWith('.js') || n.endsWith('.css'));
          return Array.from(new Set(assets));
        }catch(_){
          return [];
        }
      };

      const renderAssets = ()=>{
        listWrap.innerHTML = '';
        const assets = readAssets();
        assetsCard.appendChild(ui.el('div','', `Count: ${assets.length}`));
        const ul = ui.el('ul','');
        ul.style.margin = '8px 0 0 18px';
        ul.style.padding = '0';
        assets.forEach(a=>{
          const li = ui.el('li','');
          li.textContent = a;
          ul.appendChild(li);
        });
        listWrap.appendChild(ul);
      };

      const btnRow = ui.el('div','');
      btnRow.style.display = 'flex';
      btnRow.style.gap = '8px';
      btnRow.style.marginTop = '8px';

      const refreshBtn = ui.el('button','sws-btn', 'Refresh');
      refreshBtn.onclick = ()=>renderAssets();
      btnRow.appendChild(refreshBtn);

      assetsCard.appendChild(btnRow);
      assetsCard.appendChild(listWrap);
      renderAssets();

      root.appendChild(bootCard);
      root.appendChild(healthCard);
      root.appendChild(smokeCard);
      root.appendChild(backupCard);
      root.appendChild(importCard);
      root.appendChild(pipelineCard);
      root.appendChild(wipeCard);
      root.appendChild(applyCard);
      root.appendChild(zipCard);
      root.appendChild(adapterCard);
      root.appendChild(assetsCard);
      return root;
    },
    onSave: ()=>{},
    onClose: ()=>{}
  });

  const adapter = window.UI?.swsAdapter || window.SWSAdapter || null;
  if (adapter && typeof adapter.open === 'function') {
    const res = adapter.open({
      screenId: 'debug.center',
      swsOpen: (sw) => {
        if (typeof sw.openCustomRoot !== 'function' || typeof sw.push !== 'function') {
          throw new Error('SettingsWindow custom root API is unavailable');
        }
        sw.openCustomRoot(() => sw.push(buildScreen()));
      }
    });
    if (res?.ok) return;
  }

  if(!SW || typeof SW.openCustomRoot !== 'function' || typeof SW.push !== 'function'){
    try{ window.UI?.toast?.show?.('Debug Center недоступний (SettingsWindow не ініціалізовано)', { type:'warning' }); }catch(_){ /* ignore */ }
    return;
  }

  SW.openCustomRoot(()=> SW.push(buildScreen()));
}
