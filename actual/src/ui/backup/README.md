# Backup Manager (SWS v2)

## Навіщо
`Backup Manager` — це окремий модуль UI, який відкриває вікно **Backup / Import / Export** через **єдину** систему модалок **SWS (SettingsWindow v2)**.

Це зроблено, щоб:
- прибрати «плаваючі» помилки від розсинхрону `src`/`dist`;
- не мати випадкових глобальних змінних (типу `steps is not defined`);
- тримати backup-функціонал ізольованим від `ui_core`.

## Файли
- `backup_manager.js` — головний модуль, експортує `openBackupManager({ sdo })`.
- `zip_tools.js` — мінімальний ZIP (STORE-only) pack/unpack.
- `file_io.js` — `pickFile()` і `downloadBlob()`.
- `xlsx_actions.js` — імпорт/експорт Excel для поточного журналу.
- `zip_v2_actions.js` — ZIP **v2** (manifest + templates + navigation + per-journal datasets) імпорт/експорт.

## API
### `openBackupManager({ sdo })`
**Вхід:**
- `sdo` — інстанс SEDO (зазвичай `window.sdo`).

**Вихід:**
- результат `UI.swsAdapter.open(...)` якщо доступний, інакше `null`.

## Інтеграція
`ui_core.js` викликає `openBackupManager({ sdo })` при натисканні на кнопку Backup.

## Важливо
Runtime у браузері використовує `dist/`. Тому в `dist/ui/backup/` є синхронна копія цих файлів.

## Підтримувані операції
### JSON (поточний журнал)
- Експорт: `sdo.api.tableStore.exportTableData({ journalIds:[id] })`
- Імпорт: `sdo.api.tableStore.importTableData(bundle, { mode })` + `forceTableRerender()`

### Excel (поточний журнал)
- Експорт: `sdo.exportXlsx({ journalIds:[id], filename })`
- Імпорт: `sdo.importXlsx(file, { mode:'merge', targetJournalId:id })` + `forceTableRerender()`

### ZIP v2 (вся система)
- Експорт: `sdo.exportBackup({ scope:'all' })` + `tableStore.getDataset(journalId)` → ZIP(v2)
- Імпорт: читаємо `manifest.json` → збираємо `sdo-backup` bundle → `sdo.importBackup(...,{mode})` + `tableStore.importTableData(...,{mode})`
