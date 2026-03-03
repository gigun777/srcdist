# table.edit.cancel

## Purpose
Handles Escape cancel flow for active table cell editor (no store commit).

## Pipes
### Input
- `event.type` must be `edit.cancel`
- `event.payload`: `rowId`, `colId`, `draftValue`, `key`

### Output
- `patches`: empty (no commit on cancel)
- `effects`: `editor.close` + `focus.restore`
- `nextStateHints`: activeCell
- `debug`: execution trace

## Controls API
See `api.js` for controls/events/commands contract.

## Debug
Use `createEditCancelDebugTools().simulate(...)` for controlled probe.
