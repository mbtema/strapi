# Strapi tools

Набор рабочих инструментов для админки Strapi: Tampermonkey-скрипты, console-парсеры и Postman-коллекция для быстрых API-проверок.

## Навигация

| Раздел | Назначение |
|---|---|
| [`strapi-improve-scripts/`](./strapi-improve-scripts) | Userscripts для Tampermonkey, которые упрощают ежедневную работу в админке Strapi |
| [`console-parsers/`](./console-parsers) | Парсеры для массовых проверок данных через Strapi API |
| [`postman-collection/`](./postman-collection) | Основная Postman-коллекция с рабочими API-запросами и диагностическими проверками |

## Strapi improve scripts

- `barcode-extractor.js` — копирует barcode из карточки товара по `Ctrl+B` и показывает уведомление об успехе или ошибке.
- `ctrl-enter-publisher.js` — публикует текущую запись по `Ctrl+Enter`.
- `entry-relocate.js` — переносит действия Entry в верхнюю строку рядом с Draft / Published и освобождает полезную ширину формы.
- `parser-launcher.js` — открывает по `Alt+P` меню доступных console-парсеров и запускает выбранный файл напрямую из GitHub.
- `toggle-sidebar.js` — скрывает sidebar Strapi по умолчанию и переключает его по `Alt+S`.
- `vimium-open-row.js` — добавляет доступные для Vimium ссылки в строки таблиц Strapi.

Tampermonkey-скрипты используют `@updateURL` / `@downloadURL`, поэтому новые версии можно получать напрямую из репозитория.

## Console parsers

Парсеры запускаются через `parser-launcher.js`, проходят данные постранично, выводят прогресс в Console и автоматически скачивают CSV-результат.

- `price-checker.js` — ищет торговые предложения с дробным значением `price`.
- `sort-volume.js` — ищет товары с неправильным порядком volume и отдельно отмечает нечитаемые значения.
- `volume-checker.js` — ищет товары, у которых связанные volume используют разные единицы измерения.
- `manifest.json` — список парсеров, отображаемых в Parser Launcher.

Для добавления нового парсера достаточно положить `.js` в `console-parsers/` и добавить его в `manifest.json`.

## Postman collection

Основной файл:

`postman-collection/monamie-strapi-postman-collection.json`

Коллекция используется для работы с публичным Strapi API, точечных проверок данных, фильтрации, отладки и диагностических запросов.

Секретные значения не должны храниться в репозитории. Токены и другие чувствительные переменные в коллекции оставляются пустыми и заполняются локально в Postman.

## Структура репозитория

```text
.
├── console-parsers/
│   ├── manifest.json
│   ├── price-checker.js
│   ├── sort-volume.js
│   └── volume-checker.js
├── postman-collection/
│   └── monamie-strapi-postman-collection.json
├── strapi-improve-scripts/
│   ├── barcode-extractor.js
│   ├── ctrl-enter-publisher.js
│   ├── entry-relocate.js
│   ├── parser-launcher.js
│   ├── toggle-sidebar.js
│   └── vimium-open-row.js
└── README.md
```
