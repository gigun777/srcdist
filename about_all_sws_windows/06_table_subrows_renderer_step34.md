# Таблиця / підстроки / рендер (step34)

## Ядро таблиці
- `modules/table_engine.js` — операції над dataset (addRow, update, etc.)
- `modules/table_store.js` — persistence (IndexedDB storage через tableStore API)
- `modules/table_renderer.js` — DOM renderer + interactions (click-to-edit, context buttons, transfer button)
- `modules/table_subrows_bridge.js` — обчислення видимих рядків, мапінг parent/subrow

## Відображення і редагування
- Renderer будує DOM рядків
- Клік по комірці запускає edit flow (contenteditable/input overlay)
- Після confirm редагування:
  - `tableStore.updateRecord(...)`
  - синхронізація cache (якщо є)
  - rerender (важливо для підстрок і delete)

## Чому в step45 “не редагувалось”
Найчастіші причини:
- overlay (transfer/old modal) накриває таблицю (pointer-events)
- події keydown/keyup перехоплюються глобальними handlers (SWS) не там, де треба
- дубльований init модулів

## Міграційний принцип
- Table renderer не повинен залежати від DOM інжекції інших модалок.
- Всі модалки/оверлеї повинні:
  - мати `display:none` + `pointer-events:none` коли закриті
  - відкриватись/закриватись централізовано
