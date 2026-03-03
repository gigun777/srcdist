# table.sort.toggle

Purpose:
- Toggle table sorting for a selected column with deterministic state transitions.

Event in:
- `sort.toggle` with payload:
  - `columnKey: string` (required)
  - `currentSort?: { columnKey: string, dir: 'asc'|'desc' } | null`

Behavior:
- Same column: `asc -> desc -> null`
- New column: `null/other -> asc`

Outputs:
- patch: `{ op: 'setSort', value: nextSort | null }`
- effect: `{ type: 'rerender.request', reason: 'sort.toggle' }`
