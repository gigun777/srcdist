# SWS ядро (step34): `src/ui/sws_v2/sws_modal.js`

## Роль
SWS — це модальне “вікно-оболонка” зі стеком екранів. Воно:
- відкриває/закриває overlay
- тримає **stack screens[]**
- малює заголовок, підзаголовок, кнопку Back (ліворуч вгорі) і кнопку Primary/Save (праворуч внизу)
- забезпечує **глобальний draft/save реєстр** (globalDirty/globalDraft/globalSavers)
- має токени теми (CSS variables), режим (auto), тему (light/dark)

## Очікуваний DOM (в step34 це статичні елементи в HTML/CSS)
- `#swsOverlay`
- `#swsWindow`
- `#swsStack`

## Публічний API (фактичний, по коду)
- `SettingsWindow.openCustomRoot(builder)`
  - очищає стек і дає builder-у створити root screen через `push(...)`
- `SettingsWindow.push({ title, subtitle, content, onSave, saveLabel, canSave, ctx })`
  - рендерить screen і додає в стек
- `SettingsWindow.back()`
  - повернення на попередній screen; якщо root і `closeOnRootBack` → close
- `SettingsWindow.close()`
- `SettingsWindow.setTheme(theme)`
- `SettingsWindow.setTokens(tokens)`

## Контекст UI-примітивів
`renderScreen` формує `ctx.ui` (див. UI primitives модуль), який дає helper-и:
- `ctx.ui.el(tag, props, ...children)` і т.п.
Це дозволяє screen-ам рендерити DOM без прямого дублювання стилів/патернів.

## Кнопки та поведінка
- Кнопка “Save/Primary” працює через `onSave` screen-а або глобальні saver-и
- `saveLabel` дозволяє міняти текст (наприклад “Зберегти”, “Перенести”, або прибрати)

## Клавіатура (важливо для майбутньої централізації)
У step34 SWS вже ловить Enter/Esc на рівні overlay:
- Esc: back/close (залежить від stack)
- Enter: часто запускає onSave, якщо фокус не в textarea

Проблеми step45 показали: якщо модулі намагаються ловити Enter у контенті, це конфліктує з SWS “onSave on Enter”.
Тому **правильний шлях**: винести keyboard-policy в SWS і давати screen-у описувати правила (див. план міграції).
