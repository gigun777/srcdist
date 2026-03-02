# “Три строки” (контекст рядка) в step34

## Де реалізовано
`src/modules/table_renderer.js`

## Поточна реалізація (step34)
- Кнопка контексту `☰` в рядку відкриває **legacy UI.modal**:
  - кнопка “Додати підстроку”
  - кнопка “Видалення…”
  - footer “Закрити”
- Логіка дій:
  - addSubrow → engine.addSubrow(...) → saveDataset(...) → rerender
  - delete → окрема UI для вибору (row / subrow) → saveDataset(...) → rerender

## Чому це проблемне для міграції
- Це єдиний великий “не-SWS” шматок в таблиці.
- Змішування UI.modal + SWS дає:
  - нестабільний Esc
  - різні стилі кнопок
  - різні правила Enter

## Як має бути після міграції
- Контекст рядка стає SWS screen:
  - без Primary кнопки (або Primary “OK”, залежно від UX)
  - actions описуються в screen spec
- Клавіатура:
  - Esc = back
  - Enter у полях = перехід/submit (за правилами screen)
