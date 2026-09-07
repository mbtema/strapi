Набор рабочих инструментов для админки Strapi: Tampermonkey-скрипты, console-парсеры и Postman-коллекция для быстрых API-проверок.

## Навигация

| Раздел | Назначение |
|---|---|
| [`strapi-improve-scripts/`](./strapi-improve-scripts) | Userscripts для Tampermonkey, которые упрощают ежедневную работу в админке Strapi |
| [`console-parsers/`](./console-parsers) | Парсеры для массовых проверок данных через Strapi API |
| [`postman-collection/`](./postman-collection) | Чистая Postman-коллекция с общими переменными для Strapi, Content Manager API и BFF |

## Strapi improve scripts

- `barcode-extractor.js` — копирует barcode из карточки товара по `Ctrl+B` и показывает уведомление об успехе или ошибке.
- `ctrl-enter-publisher.js` — публикует текущую запись по `Ctrl+Enter`.
- `entry-relocate.js` — переносит действия Entry в верхнюю строку рядом с Draft / Published и освобождает полезную ширину формы.
- `parser-launcher.js` — открывает по `Alt+P` меню доступных console-парсеров и запускает выбранный файл напрямую из GitHub.
- `sidebar-sorter.js` — позволяет перетаскивать коллекции в sidebar Content Manager, сохраняет пользовательский порядок в `localStorage`; `Alt+Shift+S` сбрасывает сортировку.
- `toggle-sidebar.js` — скрывает sidebar Strapi по умолчанию и переключает его по `Alt+S`.
- `vimium-open-row.js` — добавляет доступные для Vimium ссылки в строки таблиц Strapi.

Tampermonkey-скрипты используют `@updateURL` / `@downloadURL`, поэтому новые версии можно получать напрямую из репозитория.

### Версионирование

- `1.3` → новое заметное изменение или новый функционал.
- `1.3.1` → небольшой фикс, доработка или оптимизация уже существующего функционала.
- `1.4` → следующее заметное нововведение.
- `2.0` → крупная новая версия.

## Console parsers

Парсеры запускаются через `parser-launcher.js`, проходят данные постранично, выводят прогресс в Console и автоматически скачивают CSV-результат.

- `price-checker.js` — ищет торговые предложения с дробным значением `price`.
- `sort-volume.js` — ищет товары с неправильным порядком volume и отдельно отмечает нечитаемые значения.
- `volume-checker.js` — ищет товары, у которых связанные volume используют разные единицы измерения.
- `missing-shades.js` — ищет активные торговые предложения, у которых заполнен `color_variant1C`, но отсутствует `shade`.
- `zero-prices.js` — ищет торговые предложения со значением `price = 0`, привязанные к активным товарам.
- `orphan-attributes.js` — ищет торговые предложения без связанного `product`.
- `products-without-attributes.js` — ищет активные товары без торговых предложений.
- `missing-brand.js` — ищет активные товары без `brand`.
- `missing-categories.js` — ищет активные товары без relations в `categories`.
- `products-without-price.js` — ищет активные товары, у которых есть торговые предложения, но ни у одного нет цены `> 0`.
- `manifest.json` — список парсеров, отображаемых в Parser Launcher.

Для добавления нового парсера достаточно положить `.js` в `console-parsers/` и добавить его в `manifest.json`.

## Postman collection

Основной файл:

`postman-collection/admin-api.json`

Коллекция намеренно не содержит готовых запросов. Новые endpoints добавляются только по мере реальной необходимости, а повторяющиеся значения хранятся в collection variables.

Пути известных Strapi API endpoints также вынесены в переменные. Например:

```text
{{baseUrl}}{{products}}
{{baseUrl}}{{attributes}}
{{baseUrl}}{{brands}}
{{baseUrl}}{{categories}}
```

Где `products = /api/products`, `attributes = /api/attributes` и т.д. Для endpoints с дефисами используются camelCase-переменные, например `giftCertificates = /api/gift-certificates`.

Основные переменные:

- URL: `baseUrl`, `contentManagerUrl`, `bffUrl`
- API paths: `products`, `attributes`, `promotions`, `brands`, `categories` и остальные известные endpoints из рабочей коллекции
- пагинация и сортировка: `page`, `pageSize`, `sort`
- локали и состояние: `locale`, `altLocale`, `active`
- идентификаторы: `documentId`, `productDocumentId`, `attributeDocumentId`, `brandDocumentId`, `categoryDocumentId`
- рабочие значения: `barcode`, `productKey`, `brandName`, `categoryCode`, `slug`
- секреты: `jwtToken`, `bearerToken`, `categoryDebugToken`

Секретные значения не хранятся в репозитории и заполняются только локально в Postman.

## Структура репозитория

```text
.
├── console-parsers/
│   ├── manifest.json
│   ├── missing-brand.js
│   ├── missing-categories.js
│   ├── missing-shades.js
│   ├── orphan-attributes.js
│   ├── price-checker.js
│   ├── products-without-attributes.js
│   ├── products-without-price.js
│   ├── sort-volume.js
│   ├── volume-checker.js
│   └── zero-prices.js
├── postman-collection/
│   └── admin-api.json
├── strapi-improve-scripts/
│   ├── barcode-extractor.js
│   ├── ctrl-enter-publisher.js
│   ├── entry-relocate.js
│   ├── parser-launcher.js
│   ├── sidebar-sorter.js
│   ├── toggle-sidebar.js
│   └── vimium-open-row.js
└── README.md
```
