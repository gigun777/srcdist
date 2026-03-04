const KEYS = {
  index: 'tableStore:index',
  rev: 'tableStore:rev',
  meta: (journalId) => `tableStore:meta:${journalId}`,
  metaPrefix: 'tableStore:meta:',
  order: (journalId) => `tableStore:order:${journalId}`,
  record: (journalId, recordId) => `tableStore:record:${journalId}:${recordId}`,
  recordPrefix: (journalId) => `tableStore:record:${journalId}:`,
  chlog: (journalId) => `tableStore:chlog:${journalId}`,
  // Logical dataset key used by delta payload contracts.
  dataset: (journalId) => String(journalId)
};

// Best-effort recovery for storages where meta/records exist but the index wasn't created (common after migrations).
async function rebuildIndexFromStorage(storage) {
  if (typeof storage?.list !== 'function') return null;
  const items = await storage.list(KEYS.metaPrefix);
  const ids = (items ?? [])
    .map((it) => it?.key)
    .filter((k) => typeof k === 'string' && k.startsWith(KEYS.metaPrefix))
    .map((k) => k.slice(KEYS.metaPrefix.length))
    .filter(Boolean);
  // write index directly (helper lives outside module closure)
  await storage.set(KEYS.index, ids);
  return ids;
}

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return structuredClone(value);
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}



async function yieldToUI() {
  // Allow the browser/UI thread to paint between large storage batches (best-effort).
  if (typeof requestAnimationFrame === 'function') {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function normalizeRecord(record = {}) {
  return {
    id: record.id ?? crypto.randomUUID(),
    cells: { ...(record.cells ?? {}) },
    // Cell-level subrows: array of { cells: {..} }
    subrows: Array.isArray(record.subrows)
      ? record.subrows.map((s) => ({ cells: { ...((s && s.cells) ? s.cells : {}) } }))
      : undefined,
    fmt: record.fmt ? clone(record.fmt) : undefined,
    rowFmt: record.rowFmt ? clone(record.rowFmt) : undefined,
    tags: Array.isArray(record.tags) ? [...record.tags] : undefined,
    createdAt: record.createdAt ?? nowIso(),
    updatedAt: record.updatedAt ?? nowIso()
  };
}

function normalizeDataset(journalId, input = {}) {
  return {
    journalId,
    schemaId: input.schemaId,
    records: ensureArray(input.records).map((record) => normalizeRecord(record)),
    meta: {
      createdAt: input.meta?.createdAt ?? nowIso(),
      updatedAt: input.meta?.updatedAt ?? nowIso(),
      revision: Number(input.meta?.revision ?? 0)
    }
  };
}

function stripFormatting(dataset) {
  return {
    ...dataset,
    records: dataset.records.map((record) => ({
      ...record,
      fmt: undefined,
      rowFmt: undefined
    }))
  };
}

async function validateBundle(bundle) {
  const errors = [];
  if (!bundle || bundle.format !== 'sdo-table-data' || bundle.formatVersion !== 1) {
    errors.push('Unsupported bundle format/version');
    return { valid: false, errors };
  }
  if (!Array.isArray(bundle.datasets)) errors.push('datasets must be an array');
  else {
    for (const dataset of bundle.datasets) {
      if (!dataset?.journalId) errors.push('dataset.journalId is required');
      if (!Array.isArray(dataset?.records)) errors.push(`dataset.records must be array for ${dataset?.journalId ?? '<unknown>'}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function createTableStoreModule() {
  async function getIndex(storage) {
    return ensureArray(await storage.get(KEYS.index));
  }

  async function setIndex(storage, index) {
    await storage.set(KEYS.index, index);
  }

  async function bumpGlobalRev(storage) {
    const next = Number((await storage.get(KEYS.rev)) ?? 0) + 1;
    await storage.set(KEYS.rev, next);
    return next;
  }

  async function appendChange(storage, journalId, entry) {
    const key = KEYS.chlog(journalId);
    const current = ensureArray(await storage.get(key));
    current.push(entry);
    await storage.set(key, current.slice(-200));
  }

    async function getDataset(storage, journalId) {
  const meta = await storage.get(KEYS.meta(journalId));
  if (!meta) return normalizeDataset(journalId, {});
  const order = ensureArray(await storage.get(KEYS.order(journalId)));
  const records = await Promise.all(order.map(async (rid) => {
    const rec = await storage.get(KEYS.record(journalId, rid));
    return rec ? normalizeRecord(rec) : null;
  }));
  return normalizeDataset(journalId, { meta, records: records.filter(Boolean) });
}


  async function getDatasetHeader(storage, journalId) {
    const meta = await storage.get(KEYS.meta(journalId));
    if (!meta) return { journalId, meta: null, order: [], total: 0 };
    const order = ensureArray(await storage.get(KEYS.order(journalId)));
    return { journalId, meta, order, total: order.length };
  }

  async function getRecordsByRange(storage, journalId, start, limit) {
    const order = ensureArray(await storage.get(KEYS.order(journalId)));
    const slice = order.slice(start, start + limit);
    const records = await Promise.all(slice.map(async (rid) => {
      const rec = await storage.get(KEYS.record(journalId, rid));
      return rec ? normalizeRecord(rec) : null;
    }));
    return { orderSlice: slice, records: records.filter(Boolean) };
  }


  async function saveDataset(storage, dataset, { trackDelete = false } = {}) {
    // Persist dataset in v2 layout (meta + order + record-level keys).
    const normalized = normalizeDataset(dataset.journalId, dataset);
    normalized.meta.updatedAt = nowIso();
    normalized.meta.revision += 1;

    const journalId = normalized.journalId;
    const nextOrder = normalized.records.map((r) => r.id);

    // Track removals (important for replace/delete)
    const prevOrder = ensureArray(await storage.get(KEYS.order(journalId)));
    const prevSet = new Set(prevOrder.map(String));
    const nextSet = new Set(nextOrder.map(String));
    const removed = [];
    for (const rid of prevSet) {
      if (!nextSet.has(rid)) removed.push(rid);
    }

    // Write v2 keys
    await storage.set(KEYS.meta(journalId), normalized.meta);
    await storage.set(KEYS.order(journalId), nextOrder);
const CHUNK = 200;
for (let i = 0; i < normalized.records.length; i += CHUNK) {
  const chunk = normalized.records.slice(i, i + CHUNK);
  await Promise.all(chunk.map((rec) => storage.set(KEYS.record(journalId, rec.id), rec)));
  if (i + CHUNK < normalized.records.length) await yieldToUI();
}
for (let i = 0; i < removed.length; i += CHUNK) {
  const chunk = removed.slice(i, i + CHUNK);
  await Promise.all(chunk.map((rid) => storage.del(KEYS.record(journalId, rid))));
  if (i + CHUNK < removed.length) await yieldToUI();
}

    // Update global index
    const index = await getIndex(storage);
    const nextIndex = index.filter((item) => item.journalId !== journalId);
    nextIndex.push({ journalId, revision: normalized.meta.revision, updatedAt: normalized.meta.updatedAt });
    await setIndex(storage, nextIndex);

    // Change log (best-effort; used for delta export)
    const rev = await bumpGlobalRev(storage);
    const set = {
      [KEYS.meta(journalId)]: normalized.meta,
      [KEYS.order(journalId)]: nextOrder
    };
    for (const rec of normalized.records) {
      set[KEYS.record(journalId, rec.id)] = rec;
    }
    const del = [];
    if (trackDelete) {
      for (const rid of removed) del.push(KEYS.record(journalId, rid));
    }
    await appendChange(storage, journalId, {
      baseRev: rev - 1,
      toRev: rev,
      set,
      del
    });

    return normalized;
  }

  async function clearDataset(storage, journalId) {
  // Remove v2 keys for journal
  const order = ensureArray(await storage.get(KEYS.order(journalId)));
  await storage.del(KEYS.meta(journalId));
  await storage.del(KEYS.order(journalId));
  for (const rid of order) {
    await storage.del(KEYS.record(journalId, rid));
  }

  const index = await getIndex(storage);
  const nextIndex = index.filter((item) => ((typeof item === 'string') ? item : item?.journalId) !== journalId)
                        .map((item) => (typeof item === 'string') ? item : item?.journalId)
                        .filter(Boolean);
  await setIndex(storage, nextIndex);

  const rev = await bumpGlobalRev(storage);
  await appendChange(storage, journalId, {
    baseRev: rev - 1,
    toRev: rev,
    set: {},
    del: [KEYS.meta(journalId), KEYS.order(journalId), ...order.map((rid) => KEYS.record(journalId, rid))]
  });
}
  async function upsertRecords(storage, journalId, records, mode = 'merge') {
    const current = await getDataset(storage, journalId);
    const incoming = ensureArray(records).map((record) => normalizeRecord(record));

    let nextRecords;
    if (mode === 'replace') {
      nextRecords = incoming;
    } else {
      const map = new Map(current.records.map((record) => [record.id, record]));
      for (const record of incoming) {
        map.set(record.id, {
          ...map.get(record.id),
          ...record,
          cells: { ...(map.get(record.id)?.cells ?? {}), ...(record.cells ?? {}) },
          // If incoming has subrows defined, take it; otherwise keep existing.
          subrows: record.subrows ?? map.get(record.id)?.subrows,
          fmt: record.fmt ?? map.get(record.id)?.fmt,
          rowFmt: record.rowFmt ?? map.get(record.id)?.rowFmt,
          updatedAt: nowIso(),
          createdAt: map.get(record.id)?.createdAt ?? record.createdAt ?? nowIso()
        });
      }
      nextRecords = [...map.values()];
    }

    return saveDataset(storage, { ...current, records: nextRecords });
  }

  async function exportTableData(storage, { journalIds, includeFormatting = true } = {}) {
    // Prefer the explicit index, but tolerate storages where index is missing/empty (after migrations).
    const index = await getIndex(storage);
    // Index may be legacy array of objects ({journalId}) or current array of strings (journalId).
    let ids = journalIds?.length
      ? journalIds
      : index
          .map((item) => (typeof item === 'string' ? item : item?.journalId))
          .filter(Boolean);

    // If index is empty but data exists, rebuild ids from stored meta keys.
    if ((!ids || ids.length === 0) && typeof storage?.list === 'function') {
      const rebuilt = await rebuildIndexFromStorage(storage);
      if (rebuilt?.length) ids = rebuilt;
    }
    const datasets = [];
    for (const id of ids) {
      const dataset = await getDataset(storage, id);
      datasets.push(includeFormatting ? dataset : stripFormatting(dataset));
    }
    return {
      format: 'sdo-table-data',
      formatVersion: 1,
      exportedAt: nowIso(),
      datasets
    };
  }

  async function importTableData(storage, bundle, { mode = 'merge' } = {}) {
    const validation = await validateBundle(bundle);
    if (!validation.valid) return { applied: false, errors: validation.errors, datasets: [] };

    const results = [];
    for (const incoming of bundle.datasets) {
      const journalId = incoming.journalId;
      const normalizedIncoming = normalizeDataset(journalId, incoming);
      if (mode === 'replace') {
        const saved = await saveDataset(storage, normalizedIncoming);
        results.push({ journalId, revision: saved.meta.revision, mode: 'replace' });
      } else {
        const current = await getDataset(storage, journalId);
        const map = new Map(current.records.map((record) => [record.id, record]));
        for (const record of normalizedIncoming.records) map.set(record.id, record);
        const saved = await saveDataset(storage, { ...current, schemaId: normalizedIncoming.schemaId ?? current.schemaId, records: [...map.values()] });
        results.push({ journalId, revision: saved.meta.revision, mode: 'merge' });
      }
    }

    return { applied: true, errors: [], datasets: results };
  }

  async function exportDelta(storage, { sinceRev = 0 } = {}) {
  const index = await getIndex(storage);
  const set = {};
  const toRev = Number(await storage.get(KEYS.rev) ?? 0);

  for (const item of index) {
    const journalId = (typeof item === 'string') ? item : item?.journalId;
    if (!journalId) continue;
    const log = ensureArray(await storage.get(KEYS.chlog(journalId)));
    if (log.some((entry) => Number(entry.toRev ?? entry.rev ?? 0) > sinceRev)) {
      const meta = await storage.get(KEYS.meta(journalId));
      const order = ensureArray(await storage.get(KEYS.order(journalId)));
      const records = {};
      for (const rid of order) {
        const rec = await storage.get(KEYS.record(journalId, rid));
        if (rec) records[rid] = rec;
      }
      set[journalId] = { meta, order, records };
    }
  }

  return { baseRev: sinceRev, toRev, set, del: [] };
}

async function applyDelta(storage, delta, { mode = 'merge' } = {}) {
  if (!delta || typeof delta !== 'object') return { applied: false, errors: ['Invalid delta'] };

  // apply sets
  for (const [journalId, payload] of Object.entries(delta.set ?? {})) {
    if (!journalId) continue;
    const incomingMeta = payload?.meta;
    const incomingOrder = ensureArray(payload?.order);
    const incomingRecords = payload?.records ?? {};

    if (mode === 'replace') {
      await storage.set(KEYS.meta(journalId), incomingMeta ?? normalizeDataset(journalId, {}).meta);
      await storage.set(KEYS.order(journalId), incomingOrder);
      for (const rid of incomingOrder) {
        if (incomingRecords[rid]) await storage.set(KEYS.record(journalId, rid), normalizeRecord(incomingRecords[rid]));
      }
    } else {
      // merge: upsert records, union order
      const currentOrder = ensureArray(await storage.get(KEYS.order(journalId)));
      const nextOrder = Array.from(new Set([...currentOrder, ...incomingOrder]));
      const meta = (await storage.get(KEYS.meta(journalId))) ?? normalizeDataset(journalId, {}).meta;
      const mergedMeta = { ...meta, ...(incomingMeta || {}) };
      await storage.set(KEYS.meta(journalId), mergedMeta);
      await storage.set(KEYS.order(journalId), nextOrder);
      for (const rid of incomingOrder) {
        if (incomingRecords[rid]) await storage.set(KEYS.record(journalId, rid), normalizeRecord(incomingRecords[rid]));
      }
    }

    const index = await getIndex(storage);
    const ids = index.map((it)=> (typeof it==='string'?it:it?.journalId)).filter(Boolean);
    if (!ids.includes(journalId)) await setIndex(storage, [...ids, journalId]);
  }

  // apply deletions
  for (const journalId of ensureArray(delta.del)) {
    if (typeof journalId === 'string' && journalId) {
      await clearDataset(storage, journalId);
    }
  }

  return { applied: true, errors: [] };
}

  return {
    id: '@sdo/module-table-store',
    version: '1.0.0',
    init(ctx) {
      const api = {
        getDataset: (journalId) => getDataset(ctx.storage, journalId),
        listDatasets: () => getIndex(ctx.storage),
        addRecord: async (journalId, recordPartial) => {
          const record = normalizeRecord(recordPartial ?? {});
          let meta = (await ctx.storage.get(KEYS.meta(journalId))) ?? normalizeDataset(journalId, {}).meta;
          if (!meta) meta = { createdAt: nowIso(), updatedAt: nowIso(), revision: 0 };
          const order = ensureArray(await ctx.storage.get(KEYS.order(journalId)));
          order.push(record.id);
          meta.updatedAt = nowIso();
          meta.revision = Number(meta.revision ?? 0) + 1;

          await ctx.storage.set(KEYS.meta(journalId), meta);
          await ctx.storage.set(KEYS.order(journalId), order);
          await ctx.storage.set(KEYS.record(journalId, record.id), record);

          const index = await getIndex(ctx.storage);
          if (!index.includes(journalId)) await setIndex(ctx.storage, [...index, journalId]);

          const rev = await bumpGlobalRev(ctx.storage);
          await appendChange(ctx.storage, journalId, { at: nowIso(), rev, type: 'addRecord', journalId, recordId: record.id });
          return record.id;
        },
        updateRecord: async (journalId, recordId, patch) => {
          // Subrows are stored inside the OWNER record as record.subrows[] and are addressed
          // by synthetic ids: "<ownerId>::sub::<index>".
          const m = typeof recordId === 'string' ? recordId.match(/^(.*)::sub::(\d+)$/) : null;
          if (m) {
            const ownerId = m[1];
            const subIndex = Number(m[2]);
            const ownerKey = KEYS.record(journalId, ownerId);
            const owner = await ctx.storage.get(ownerKey);
            if (!owner) return;
            const nextOwner = { ...owner };
            const nextSubrows = Array.isArray(owner.subrows) ? owner.subrows.slice() : [];
            const curSub = nextSubrows[subIndex] ?? { id: recordId, cells: {} };
            const nextSub = {
              ...curSub,
              ...patch,
              cells: { ...(curSub.cells ?? {}), ...(patch?.cells ?? {}) },
              fmt: patch?.fmt ? { ...(curSub.fmt ?? {}), ...patch.fmt } : curSub.fmt,
              rowFmt: patch?.rowFmt ? { ...(curSub.rowFmt ?? {}), ...patch.rowFmt } : curSub.rowFmt,
              updatedAt: nowIso()
            };
            nextSubrows[subIndex] = nextSub;
            nextOwner.subrows = nextSubrows;
            nextOwner.updatedAt = nowIso();

            await ctx.storage.set(ownerKey, normalizeRecord(nextOwner));

            let meta = (await ctx.storage.get(KEYS.meta(journalId))) ?? normalizeDataset(journalId, {}).meta;
            if (!meta) meta = { createdAt: nowIso(), updatedAt: nowIso(), revision: 0 };
            meta.updatedAt = nowIso();
            meta.revision = Number(meta.revision ?? 0) + 1;
            await ctx.storage.set(KEYS.meta(journalId), meta);

            const rev = await bumpGlobalRev(ctx.storage);
            await appendChange(ctx.storage, journalId, { at: nowIso(), rev, type: 'updateSubrow', journalId, recordId: ownerId, subrowId: recordId });
            return;
          }

          const key = KEYS.record(journalId, recordId);
          const current = await ctx.storage.get(key);
          if (!current) return;
          const next = {
            ...current,
            ...patch,
            cells: { ...(current.cells ?? {}), ...(patch?.cells ?? {}) },
            fmt: patch?.fmt ? { ...(current.fmt ?? {}), ...patch.fmt } : current.fmt,
            rowFmt: patch?.rowFmt ? { ...(current.rowFmt ?? {}), ...patch.rowFmt } : current.rowFmt,
            updatedAt: nowIso()
          };
          await ctx.storage.set(key, normalizeRecord(next));

          let meta = (await ctx.storage.get(KEYS.meta(journalId))) ?? normalizeDataset(journalId, {}).meta;
          if (!meta) meta = { createdAt: nowIso(), updatedAt: nowIso(), revision: 0 };
          meta.updatedAt = nowIso();
          meta.revision = Number(meta.revision ?? 0) + 1;
          await ctx.storage.set(KEYS.meta(journalId), meta);

          const rev = await bumpGlobalRev(ctx.storage);
          await appendChange(ctx.storage, journalId, { at: nowIso(), rev, type: 'updateRecord', journalId, recordId });
        },
        deleteRecord: async (journalId, recordId) => {
          const order = ensureArray(await ctx.storage.get(KEYS.order(journalId)));
          const nextOrder = order.filter((id) => id !== recordId);
          await ctx.storage.set(KEYS.order(journalId), nextOrder);
          await ctx.storage.del(KEYS.record(journalId, recordId));

          let meta = (await ctx.storage.get(KEYS.meta(journalId))) ?? normalizeDataset(journalId, {}).meta;
          if (!meta) meta = { createdAt: nowIso(), updatedAt: nowIso(), revision: 0 };
          meta.updatedAt = nowIso();
          meta.revision = Number(meta.revision ?? 0) + 1;
          await ctx.storage.set(KEYS.meta(journalId), meta);

          const rev = await bumpGlobalRev(ctx.storage);
          await appendChange(ctx.storage, journalId, { at: nowIso(), rev, type: 'deleteRecord', journalId, recordId });
        },
        clearDataset: (journalId) => clearDataset(ctx.storage, journalId),
        upsertRecords: async (journalId, records, mode = 'merge') => {
          const incoming = ensureArray(records).map((r) => normalizeRecord(r));
          let meta = (await ctx.storage.get(KEYS.meta(journalId))) ?? normalizeDataset(journalId, {}).meta;
          if (!meta) meta = { createdAt: nowIso(), updatedAt: nowIso(), revision: 0 };

          if (mode === 'replace') {
            const prevOrder = ensureArray(await ctx.storage.get(KEYS.order(journalId)));
            const nextOrder = incoming.map((r) => r.id);

await ctx.storage.set(KEYS.order(journalId), nextOrder);
const CHUNK = 200;
for (let i = 0; i < incoming.length; i += CHUNK) {
  const chunk = incoming.slice(i, i + CHUNK);
  await Promise.all(chunk.map((r) => ctx.storage.set(KEYS.record(journalId, r.id), r)));
  if (i + CHUNK < incoming.length) await yieldToUI();
}

// delete removed
const nextSet = new Set(nextOrder);
const removed = prevOrder.filter((rid) => !nextSet.has(rid));
for (let i = 0; i < removed.length; i += CHUNK) {
  const chunk = removed.slice(i, i + CHUNK);
  await Promise.all(chunk.map((rid) => ctx.storage.del(KEYS.record(journalId, rid))));
  if (i + CHUNK < removed.length) await yieldToUI();
}
          } else {
            // merge
            const order = ensureArray(await ctx.storage.get(KEYS.order(journalId)));
            const orderSet = new Set(order);
            for (const r of incoming) {
              const key = KEYS.record(journalId, r.id);
              const cur = await ctx.storage.get(key);
              if (cur) {
                const merged = normalizeRecord({
                  ...cur,
                  ...r,
                  cells: { ...(cur.cells ?? {}), ...(r.cells ?? {}) },
                  fmt: r.fmt ? { ...(cur.fmt ?? {}), ...r.fmt } : cur.fmt,
                  rowFmt: r.rowFmt ? { ...(cur.rowFmt ?? {}), ...r.rowFmt } : cur.rowFmt
                });
                await ctx.storage.set(key, merged);
              } else {
                await ctx.storage.set(key, r);
              }
              if (!orderSet.has(r.id)) { order.push(r.id); orderSet.add(r.id); }
            }
            await ctx.storage.set(KEYS.order(journalId), order);
          }

          meta.updatedAt = nowIso();
          meta.revision = Number(meta.revision ?? 0) + 1;
          await ctx.storage.set(KEYS.meta(journalId), meta);

          const index = await getIndex(ctx.storage);
          if (!index.includes(journalId)) await setIndex(ctx.storage, [...index, journalId]);

          const rev = await bumpGlobalRev(ctx.storage);
          await appendChange(ctx.storage, journalId, { at: nowIso(), rev, type: 'upsertRecords', journalId, mode, count: incoming.length });
          return { applied: incoming.length };
        },
        deleteRecords: async (journalId, ids = []) => {
          const remove = new Set((ids||[]).map((x)=>String(x)));
          const current = await getDataset(ctx.storage, journalId);
          await saveDataset(ctx.storage, { ...current, records: current.records.filter((record) => !remove.has(String(record.id))) });
        },
        exportTableData: (opts) => exportTableData(ctx.storage, opts),
        importTableData: (bundle, opts) => importTableData(ctx.storage, bundle, opts),
        exportDelta: (opts) => exportDelta(ctx.storage, opts),
        applyDelta: (delta, opts) => applyDelta(ctx.storage, delta, opts)
      };

      ctx.api.tableStore = api;

      ctx.registerCommands([
        {
          id: '@sdo/module-table-store.export',
          title: 'Export table data',
          run: async () => api.exportTableData({ includeFormatting: true })
        }
      ]);

      ctx.backup.registerProvider({
        id: 'tableStore',
        version: '1.0.0',
        // v2 layout stores user data across meta/order/record keys; backup uses exportTableData bundle.
        describe: async () => ({ settings: [KEYS.index, KEYS.rev], userData: [] }),
        export: async (opts = {}) => {
          const payload = {
            revision: Number(await ctx.storage.get(KEYS.rev) ?? 0),
            index: await getIndex(ctx.storage)
          };
          if (opts.includeUserData !== false) {
            payload.userData = await api.exportTableData({ includeFormatting: true });
          }
          return payload;
        },
        import: async (payload, opts = {}) => {
          if (opts.includeUserData !== false && payload.userData) {
            return api.importTableData(payload.userData, { mode: opts.mode ?? 'merge' });
          }
          return { applied: true, errors: [] };
        },
        exportDelta: async (sinceRev = 0) => api.exportDelta({ sinceRev }),
        applyDelta: async (patch, opts = {}) => api.applyDelta(patch, { mode: opts.mode ?? 'merge' })
      });
    }
  };
}

export { KEYS as tableStoreKeys };
