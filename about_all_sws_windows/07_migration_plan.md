# План міграції до централізованого SWS ядра (малими кроками)

## Проблема, яку вирішуємо
У нас зараз мікс:
- SWS (Settings/Debug/QuickNav/частково AddRow/Transfers)
- legacy UI.modal (Row context, частина підвікон)
- DOM injection (step45) → конфлікти з фокусом/overlay/click-to-edit

Ціль: **один керуючий центр** для модалок (SWS), який:
- тримає стек
- знає активний екран
- має опис action-кнопок для кожного screen
- має keyboard policy per screen (Enter/Esc/focus rules)
- веде “dirty/draft” централізовано

## Кроки (ітеративно)
### Крок M0 — Інвентаризація залежностей (на основі step34)
- Зафіксувати порядок імпортів в `ui_bootstrap_esm.js`
- Зафіксувати всі глобали: `UI`, `SettingsWindow`, `TransferUI`, `UI.transfer`
- Зафіксувати всі точки відкриття модалок

### Крок M1 — Ввести “Screen Spec” API поверх SWS
Додати новий модуль: `ui/sws_v2/sws_screens_core.js`
- `openScreen(spec, ctx)` — відкриває SWS, пушить root/child
- `spec.actions`:
  - `primary: { label, enabled, onPress } | null`
  - `back: { enabled, onPress }` (або default back)
- `spec.keyboardPolicy`:
  - `enter: "save" | "nextInput" | "none"`
  - `esc: "back" | "close" | "none"`
  - `focusFirstInputOnOpen: true/false`
  - `enterAdvancesInputs: true/false`
- `spec.stateKey` для збереження локального стану між push/pop

### Крок M2 — Перенесення Transfer на screen specs (2 екрани)
- Transfer Templates (settings)
- Transfer Execute (row transfer)
При цьому: прибрати DOM injection, повернути deterministic init.

### Крок M3 — Перенесення “Row Context” (три строки) на SWS screen
- замінити UI.modal на SWS
- дії addSubrow/delete оформити як підscreen-и
- rerender через централізований `requestTableRerender(info)`

### Крок M4 — Уніфікація AddRow screen (під Enter-policy)
- onSave реалізує “enter flow” (як ми вже з’ясували)
- focus manager в SWS core

### Крок M5 — ESC/ENTER стабільність
- Один capture-handler в SWS ядро
- Всі інші модулі не ставлять глобальні keydown

### Крок M6 — Прибрати дублювання src/dist (D4)
Після того, як UI стабільний:
- strict clean build
- verify-dist
- build_meta в Debug Center (D1)

## Критерії готовності кожного кроку
- Нема зникнення модалок/кнопок
- Нема блокування кліків по таблиці
- Runtime assets list стабільний і повний
- Module health ok
- Transfer + Backup + Row actions + Edit cells працюють
