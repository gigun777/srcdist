# table.edit.commit

## Purpose
Handles table cell commit flow: click/input/Enter -> store patch + rerender request.

## Pipes
### Input
- `event.type` must be `edit.commit`
- `event.payload`: `rowId`, `colId`, `oldValue`, `newValue`, `key`

### Output
- `patches`: store mutations (`setCell`)
- `effects`: side effects (`rerender.request`)
- `nextStateHints`: activeCell + anchor
- `debug`: execution trace (`steps`, `inputs`, `outputs`, `timingMs`)

## Controls API
See `api.js` for controls/events/commands contract.

## Debug
Use `createEditCommitDebugTools().simulate(...)` to run controlled debug probe.
