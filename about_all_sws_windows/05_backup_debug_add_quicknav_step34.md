# Backup / Debug / +Додати / QuickNav (step34)

## Backup
Є 2 “шари” бекапу:
1) UX/UI backup (`ui/ui_backup.js`) — збереження налаштувань UX/UI секцій.
2) ZIP v2 backup (backup_v2/* + debug center tests) — експорт/імпорт даних/manifest/datasets.

У step34 основні кнопки UI для ZIP v2 здебільшого живуть у Settings/Debug flows.

## Debug Center
`ui/ui_debug_center.js` відкривається через SWS (Debug screen).
Містить:
- Boot marker
- Runtime loaded dist assets (Refresh)
- Module health report
- Backup v2 tests: export dry-run, import dry-run, pipeline, wipe, apply, confirm simulate

## +Додати
У step34 “+додати” історично був UI.modal; в нових кроках ми вже почали переводити на SWS.
Ключові правила для SWS add screen:
- focus на першому input при open
- Enter → next input
- Enter на останньому → submit + close
У step45 це конфліктувало з SWS “Enter triggers onSave”, тому правильне місце реалізації правила — в `onSave` самого screen spec.

## QuickNav
`ui/sws_v2/sws_quicknav.js`
- окремий “панельний” UI (всередині SWS або поруч) для навігації по дереву
- використовує subscribe для refresh
- підтримує double-tap navigate+close
- add sibling на рівні focused node
