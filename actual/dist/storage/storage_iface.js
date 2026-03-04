export function assertStorage(storage) {
  const methods = ['get', 'set', 'del'];
  for (const method of methods) {
    if (typeof storage?.[method] !== 'function') {
      throw new Error(`Storage adapter must implement ${method}(...)`);
    }
  }
}

export function createMemoryStorage(seed = {}) {
  const db = new Map(Object.entries(seed));
  return {
    get(key) {
      return db.has(key) ? structuredClone(db.get(key)) : null;
    },
    set(key, value) {
      db.set(key, structuredClone(value));
    },
    del(key) {
      db.delete(key);
    },
    list(prefix = '') {
      return [...db.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([key, value]) => ({ key, value: structuredClone(value) }));
    }
  };
}



export function createIndexedDBStorage(namespace = 'sdo') {
  const dbName = `${namespace}__kv`;
  const storeName = 'kv';
  const hasIDB = typeof indexedDB !== 'undefined';

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
  }

  function txGet(db, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const st = tx.objectStore(storeName);
      const r = st.get(key);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => reject(r.error || new Error('IndexedDB get failed'));
    });
  }

  function txSet(db, key, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const st = tx.objectStore(storeName);
      const r = st.put(structuredClone(value), key);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error || new Error('IndexedDB set failed'));
    });
  }

  function txDel(db, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const st = tx.objectStore(storeName);
      const r = st.delete(key);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error || new Error('IndexedDB del failed'));
    });
  }

  function txList(db, prefix = '') {
    return new Promise((resolve, reject) => {
      const out = [];
      const tx = db.transaction(storeName, 'readonly');
      const st = tx.objectStore(storeName);
      const req = st.openCursor();
      req.onsuccess = async () => {
        const cur = req.result;
        if (!cur) return resolve(out);
        const k = String(cur.key);
        if (k.startsWith(prefix)) out.push({ key: k, value: structuredClone(cur.value) });
        cur.continue();
      };
      req.onerror = () => reject(req.error || new Error('IndexedDB list failed'));
    });
  }

  const adapter = {
  __db: null,
  async init() {
    if (!hasIDB) throw new Error('IndexedDB unavailable');
    if (adapter.__db) return;
    adapter.__db = await openDb();
  },
  async get(key) {
    if (!hasIDB) return null;
    if (!adapter.__db) await adapter.init();
    return await txGet(adapter.__db, key);
  },
  async set(key, value) {
    if (!hasIDB) throw new Error('IndexedDB unavailable');
    if (!adapter.__db) await adapter.init();
    await txSet(adapter.__db, key, value);
  },
  async del(key) {
    if (!hasIDB) return;
    if (!adapter.__db) await adapter.init();
    await txDel(adapter.__db, key);
  },
  async list(prefix = '') {
    if (!hasIDB) return [];
    if (!adapter.__db) await adapter.init();
    return await txList(adapter.__db, prefix);
  }
};

return adapter;
}
