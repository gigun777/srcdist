# Dataset Tx

`runDatasetTx(...)` centralizes the dataset mutation pipeline:

1) `loadDataset(runtime, store, journalId)`
2) `mutate(dataset) -> { ok, nextDataset, meta }`
3) `saveDataset(runtime, store, journalId, nextDataset)`
4) cache sync happens inside `saveDataset`
5) writes debug events to `window.__tableFeatureDebug.__eventLog`

It does **not** rerender automatically; caller decides.
