# Налаштування (Settings) в step34 — багато стеків

## Модулі
- `ui/settings/settings_registry.js` — реєстр вкладок/фіч, маршрутизація
- `ui/settings/settings_state.js` — state налаштувань (читання/запис, дефолти)
- `ui/settings/settings_init.js` — ініціалізація SettingsWindow root menu
- `ui/settings/features_table_settings.js` — “Таблиці” (колонки, підстроки, перенесення тощо)
- `ui/settings/features_uxui_settings.js` — UX/UI (theme, scale, gestures...)

## Патерн (як працює стек)
- В Settings відкривається root screen (menu).
- Кожен пункт menu робить `SettingsWindow.push(...)` з новим screen.
- Всередині screen можуть бути підменю → ще push.
Отже, Settings — це “екосистема стеків”.

## Що критично зберегти
- Єдине джерело стану налаштувань: `UI.getSettings()` + `UI.setSettings()` або state module
- Однакова поведінка кнопок:
  - десь Primary “Зберегти”
  - десь Primary немає, бо зміни застосовуються одразу
- Esc/back має бути стабільний для всіх вкладок і підвкладок.

## Міграційне правило
Settings — перший кандидат на централізований screen spec:
- кожен екран має `id`, щоб SWS міг:
  - трекати “який screen зараз”
  - трекати dirty/draft
  - робити restore focus після rerender
