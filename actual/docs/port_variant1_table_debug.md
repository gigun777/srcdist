# Port: Variant1 table ideas → Variant2

Цей порт переносить 2 ключові ідеї з Variant1 у Variant2:

1) **Dataset transaction (datasetTx) helper**: load → mutate → save як єдиний пайплайн з валідацією deps, debug trace та подієвим логом.
2) **Table runtime event log**: кільцевий буфер подій з інформацією *хто ініціював*, *що сталося* і *ok/fail*.

## Що додано

### 1) Table event log (ring buffer)
- Файл: `src/table/core/event_log.js` (копія/адаптація з Variant1)
- API:
  - `pushTableEvent(e)`
  - `getTableEventLog()`
  - `clearTableEventLog()`

Дані зберігаються у `window.__tableFeatureDebug.__eventLog` (до 200 подій).

### 2) Dataset tx helper
- Директорія: `src/table/core/dataset_tx/*`
- Головний API: `runDatasetTx(input)`

Функція:
- робить валідацію `journalId`, `deps.runtime`, `deps.store`, `deps.loadDataset`, `deps.saveDataset` та `mutate`
- пише події в event log (`datasetTx:start/done`)
- зберігає "останній tx" для Debug Center:
  - `window.__tableFeatureDebug.datasetTx` (легкий snapshot)
  - `window.__tableFeatureDebug.datasetTxDebug` (повний debug trace зі step-ами)

### 3) Інтеграція у table_renderer
- Файл: `src/modules/table_renderer.js` (+ синхронно `dist/modules/table_renderer.js`)

Операції, що тепер проходять через datasetTx:
- add row (SWS + prompt fallback)
- add subrow (в SWS "Дії рядка" / modal / fallback)
- delete row (вся строка)
- delete subrow (за номером)
- editCell fallback (коли `tableStore.updateRecord` недоступний)

Операції editCell (updateRecord path) також пишуть події `editCell:start/done` в event log.

### 4) Debug Center
- Файл: `src/ui/ui_debug_center.js` (+ dist sync)
- Новий блок: **"Table runtime debug log"**
  - показує останній datasetTx snapshot + datasetTxDebug
  - показує хвіст event log (до 80 записів)
  - кнопки: Refresh / Clear

## Як перевірити вручну
1) Запустити сайт
2) Зробити дію в таблиці (додати рядок, додати підстроку, видалити, змінити комірку)
3) Відкрити Debug Center → "Table runtime debug log" і перевірити:
   - зʼявилась подія `datasetTx` або `editCell`
   - у `lastDatasetTxDebug.steps` видно пайплайн `validate → loadDataset → mutate → saveDataset`

## Сумісність
- Порт зроблений як **debug-first**: event log не ламає додаток навіть якщо щось піде не так (всі записи в try/catch).
- DatasetTx не змінює таблицю напряму: лише обгортає існуючі `loadDataset/saveDataset`.
