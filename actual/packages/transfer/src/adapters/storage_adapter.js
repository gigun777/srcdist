export function createTransferStorage({ storage, key = 'sdo.transfer.templates.v2' }) {
  if (!storage) throw new Error('storage adapter is required');
  if (typeof storage.get !== 'function' || typeof storage.set !== 'function' || typeof storage.del !== 'function') {
    throw new Error('storage must implement async get/set/del');
  }

  async function readAll() {
    const v = await storage.get(key);
    return Array.isArray(v) ? v : (v ? [v] : []);
  }

  async function writeAll(arr) {
    await storage.set(key, Array.isArray(arr) ? arr : []);
  }

  return {
    async list() {
      return await readAll();
    },
    async saveAll(templates) {
      await writeAll(templates);
    },
    async upsert(template) {
      const list = await readAll();
      const id = template?.id;
      const next = list.filter(t => t?.id && t.id !== id);
      next.push(template);
      await writeAll(next);
    },
    async remove(id) {
      const list = await readAll();
      await writeAll(list.filter(t => t?.id !== id));
    },
    async clear() {
      await storage.del(key);
    }
  };
}
