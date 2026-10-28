# Общий runtime скриптов

Готовые файлы `tools/audits/*.js` и `tools/sync/*.js` самодостаточны: скопировать JS целиком в Console Strapi Admin, без загрузки модулей в браузере.

Исходники для мигрированных инструментов находятся в `tools/src/`. Маркеры `/* @runtime progress */` и `/* @runtime adaptive */` заменяются на файлы из `tools/runtime/` при сборке.

Сборка: `node tools/build.js`

Проверка: `node tools/build.js --check`

Первый мигрированный инструмент: `tools/audits/products-attributes-locale-audit.js`. Остальные не изменены.

Мягкий Stop прекращает новые волны, но не прерывает начатые запросы. После каждых 500 успешных заданий benchmark проверяет производительность повторно. Ошибки отдельных проверок считаются отдельно; у записи Save → Publish → Verify должен быть единый task при будущей миграции sync.
