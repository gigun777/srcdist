# table.rerender.sync

## Purpose
Synchronize table rerender requests so DOM updates are driven by one feature contract.

## Pipes
### Input
- `event.type` must be `rerender.sync`
- `event.payload`: `reason`, `changedIds[]`, `anchorId`

### Output
- `patches`: empty (render-only feature)
- `effects`: `renderer.apply` + `scroll.anchor`
- `nextStateHints`: anchorId
- `debug`: execution trace

## Controls API
See `api.js` for controls/events/commands contract.

## Debug
Use `createRerenderSyncDebugTools().simulate(...)` for controlled rerender probe.
