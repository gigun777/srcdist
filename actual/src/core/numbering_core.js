// @sdo/core/numbering_core
// Tree numbering utility: produces human-readable numbers like 1, 1.1, 2.3.1

/**
 * Compute numbering map for a tree.
 *
 * @param {string[]} rootIds
 * @param {(id:string)=>string[]} getChildren
 * @returns {Map<string,string>} id -> numbering (e.g. "1.2.3")
 */
export function computeTreeNumbering(rootIds, getChildren) {
  const map = new Map();
  const roots = Array.isArray(rootIds) ? rootIds : [];
  const safeChildren = (id) => {
    try {
      const c = getChildren?.(id);
      return Array.isArray(c) ? c : [];
    } catch {
      return [];
    }
  };

  const dfs = (id, prefix) => {
    const children = safeChildren(id);
    for (let i = 0; i < children.length; i++) {
      const cid = children[i];
      const num = prefix + '.' + String(i + 1);
      map.set(cid, num);
      dfs(cid, num);
    }
  };

  for (let i = 0; i < roots.length; i++) {
    const rid = roots[i];
    const num = String(i + 1);
    map.set(rid, num);
    dfs(rid, num);
  }

  return map;
}
