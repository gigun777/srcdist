# Перенесення (Transfer): як влаштовано в step34

## Модулі
1) `ui/transfer_modals.js`
- Візуальний шар: модалки, чекбокси, селекти, списки.
- Експортує/реєструє `window.TransferUI` (або `UI.transfer`), з методами відкриття модалок.

2) `ui/ui_transfer_bridge.js`
- “Bridge” між UI та ядром:
  - використовує `createTransferCore` (DOM-free)
  - читає/пише через `ctx.storage` і `ctx.api.tableStore`
  - викликає TransferUI (візуал)
- Важлива залежність: `ui_bootstrap_esm.js` має **side-effect import** `./transfer_modals.js` ПЕРЕД bridge,
  інакше `window.TransferUI` буде undefined.

3) `core/transfer_core.js`
- Чиста логіка перенесення (без DOM)
- Розрахунки кандидатів, застосування правил, перевірки.

## Де викликається TransferUI
- Таблиця (кнопка перенесення в рядку) — в `modules/table_renderer.js`
  - викликає `UI.transfer.openRowModal(...)`
- Налаштування перенесень — через Settings/SWS (screen у settings/features_table_settings.js або bridge)

## Типові точки відмови (з step45)
- Якщо `transfer_modals.js` ініціалізується до того, як DOM готовий (або очікує статичний HTML) → падіння.
- Якщо overlay модалки лишається visible/pointer-events=auto → блокує кліки по таблиці.
- Якщо одночасно використовуються UI.modal і SWS — можливі конфлікти focus/esc/enter.

## Правило для міграції
Transfer має стати **SWS screen spec**:
- “Transfer Templates” (settings)
- “Transfer Execute” (row transfer)
SWS визначає кнопки:
- Primary: “Зберегти” у templates
- Primary: “Перенести” у execute
- або без кнопки, якщо все робиться в UI контенті
