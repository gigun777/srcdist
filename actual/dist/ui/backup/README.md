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
