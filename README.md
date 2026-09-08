Набор рабочих инструментов для админки Strapi: features, UI/UX-кастомы, парсеры и Postman.

## Структура

| Папка | Назначение |
|---|---|
| [`extension/`](./extension) | Единый Tampermonkey loader и manifest всех постоянных расширений Strapi |
| [`features/`](./features) | Функциональные возможности: горячие клавиши, barcode, Parser Launcher, Vimium helper |
| [`ui-ux/`](./ui-ux) | UI/UX-кастомы Strapi |
| [`parsers/`](./parsers) | Одноразовые массовые проверки данных с CSV-выгрузкой |
| [`postman/`](./postman) | Postman collection с общими переменными и API paths |

## Extension loader

В Tampermonkey устанавливается только:

`extension/loader.js`

Loader при открытии Strapi:

1. мгновенно запускает последнюю сохранённую копию extensions из кеша;
2. в фоне загружает `extension/manifest.json` с GitHub;
3. при изменении версий или путей скачивает только изменившиеся файлы и сохраняет новый кеш;
4. обновлённые extensions применяются после следующей перезагрузки Strapi.

Старые отдельные Tampermonkey-скрипты после установки loader нужно отключить или удалить, иначе один функционал будет запускаться дважды.

### Manifest

`extension/manifest.json` определяет, какие extensions включены:

```json
{
  "id": "sidebar",
  "path": "ui-ux/sidebar.js",
  "version": "2.0.0",
  "enabled": true
}
```

При изменении файла обязательно увеличивать его `version` в manifest. Изменение пути также меняет сигнатуру кеша и заставляет loader скачать файл заново. `enabled: false` оставляет файл в репозитории, но исключает его из загрузки.

## Features

- `barcode-extractor.js` — `Ctrl+B`, копирует barcode из карточки товара и показывает toast.
- `ctrl-enter-publisher.js` — `Ctrl+Enter`, публикует текущую запись.
- `parser-launcher.js` — `Alt+P`, открывает список парсеров из `parsers/manifest.json`.
- `vimium-open-row.js` — добавляет строки таблиц, доступные для Vimium.

## UI/UX

- `sidebar.js` — единый sidebar-модуль: скрытие/показ по `Alt+S`, поиск, быстрый доступ, группировка Collection Types и Single Types, active state и очистка глобальной левой навигации.
- `record-list-scrollbars.js` — визуально скрывает scrollbar в списке записей Content Manager, сохраняя прокрутку.
- `entry-relocate.js` — переносит действия Entry в строку с Draft / Published и освобождает ширину формы.

## Версионирование

- `1.3` — новое заметное изменение / функционал.
- `1.3.1` — небольшой фикс, доработка или оптимизация существующего функционала.
- `1.4` — следующее заметное нововведение.
- `2.0` — крупная новая версия.

## Parsers

Парсеры запускаются через `Alt+P`, проходят API постранично, выводят прогресс в Console и автоматически скачивают CSV.

- `price-checker.js` — дробные значения `price`.
- `sort-volume.js` — неправильный порядок volume.
- `volume-checker.js` — разные единицы измерения volume.
- `missing-shades.js` — активные предложения с `color_variant1C`, но без `shade`.
- `zero-prices.js` — предложения с `price = 0`, связанные с активными товарами.
- `orphan-attributes.js` — предложения без `product`.
- `products-without-attributes.js` — активные товары без предложений.
- `missing-brand.js` — активные товары без `brand`.
- `missing-categories.js` — активные товары без `categories`.
- `products-without-price.js` — активные товары с предложениями, но без цены `> 0`.
- `manifest.json` — список парсеров для Parser Launcher.

Для нового парсера достаточно добавить `.js` в `parsers/` и зарегистрировать его в `parsers/manifest.json`.

## Postman

Основной файл:

`postman/admin-api.json`

Коллекция намеренно не содержит готовых запросов. Повторяющиеся значения вынесены в collection variables.

Пример:

```text
{{baseUrl}}{{products}}
{{baseUrl}}{{attributes}}
{{baseUrl}}{{brands}}
{{baseUrl}}{{categories}}
```

Основные переменные:

- URL: `baseUrl`, `contentManagerUrl`, `bffUrl`
- API paths: `products`, `attributes`, `promotions`, `brands`, `categories` и другие endpoints
- пагинация: `page`, `pageSize`, `sort`
- локали: `locale`, `altLocale`
- идентификаторы: `documentId`, `productDocumentId`, `attributeDocumentId`, `brandDocumentId`, `categoryDocumentId`
- рабочие значения: `barcode`, `productKey`, `brandName`, `categoryCode`, `slug`
- секреты: `jwtToken`, `bearerToken`, `categoryDebugToken`

Секреты в GitHub не хранятся и заполняются только локально в Postman.

## Дерево

```text
.
├── extension/
│   ├── loader.js
│   └── manifest.json
├── features/
│   ├── barcode-extractor.js
│   ├── ctrl-enter-publisher.js
│   ├── parser-launcher.js
│   └── vimium-open-row.js
├── ui-ux/
│   ├── sidebar.js
│   ├── entry-relocate.js
│   └── record-list-scrollbars.js
├── parsers/
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
├── postman/
│   └── admin-api.json
└── README.md
```
