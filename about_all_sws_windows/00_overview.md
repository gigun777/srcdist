# SWS + UI архітектура (аналіз step34 як еталон)

Цей пакет — “пам’ятка-опис” поточного стану системи (за step34) і план міграції до централізованого SWS ядра без втрати функціоналу.

## Цілі міграції
1. **Одне джерело правди для модалки SWS** (stack/state/keyboard/actions).
2. Кожен функціональний екран (Transfer / Settings / Debug / Backup / AddRow / QuickNav / RowContext) описується як **screen spec**:
   - `title/subtitle`
   - `render(ctx)` (контент/елементи)
   - `actions` (які кнопки показати: Back/Primary/None; label; enabled; handler)
   - `keyboardPolicy` (Enter/Esc/Tab/focus)
3. Всі модулі UI використовують **єдиний API відкриття/навігації** по стеку.
4. Поступово прибираємо дублювання UI.modal там, де воно викликає конфлікти, але не ламаємо робочі флоу.

## Джерело аналізу
- Еталон: `step34_C2_4_confirm_fix_journalPathsUsed.zip`
- Поточне: `step45_fix_transfer_modals_dom_inject.zip` (тут проявились конфлікти)
