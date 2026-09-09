Набор рабочих инструментов для админки Strapi: постоянные extensions, UI/UX-кастомы, парсеры, Postman и централизованный контекст проекта.

## Структура

| Папка | Назначение |
|---|---|
| [`extension/`](./extension) | Единый Tampermonkey loader и manifest постоянных расширений Strapi |
| [`features/`](./features) | Функции: горячие клавиши, barcode, Parser Launcher, Vimium helper |
| [`ui-ux/`](./ui-ux) | UI/UX-кастомы Strapi |
| [`parsers/`](./parsers) | Массовые проверки данных и вспомогательные browser parsers |
| [`postman/`](./postman) | Postman collection с общими variables и API paths |
| [`promts/`](./promts) | Централизованное хранилище Project Instructions и полного project context |

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
  "version": "2.2.1",
  "enabled": true
}
```

При изменении extension обязательно увеличивать его `version` в manifest. Изменение пути также меняет сигнатуру кеша и заставляет loader скачать файл заново. `enabled: false` оставляет файл в репозитории, но исключает его из загрузки.

## Features

- `barcode-extractor.js` — `Ctrl+B`, копирует barcode из карточки товара и показывает toast.
- `ctrl-enter-publisher.js` — `Ctrl+Enter`, публикует текущую запись.
- `parser-launcher.js` — `Alt+P`, открывает список парсеров из `parsers/manifest.json`.
- `vimium-open-row.js` — делает строки таблиц доступными для Vimium.

## UI/UX

- `sidebar.js` — единый sidebar-модуль: скрытие/показ по `Alt+S`, поиск, быстрый доступ, группы Collection Types/Single Types, active state, минималистичные иконки, future-safe fallback для новых коллекций и очистка глобальной левой навигации.
- `record-list-scrollbars.js` — визуально скрывает scrollbar в списке записей Content Manager, сохраняя прокрутку.
- `list-view.js` — доработки list view Content Manager.
- `entry-relocate.js` — переносит действия Entry в строку с Draft / Published и освобождает ширину формы.

## Версионирование

- patch (`1.3.1`) — небольшой фикс, доработка или оптимизация существующего поведения;
- minor (`1.4`) — заметное новое поведение;
- major (`2.0`) — крупная переработка.

Версия extension независима от версии loader.

## Parsers

Парсеры запускаются через `Alt+P`. Проверочные парсеры проходят API постранично, выводят прогресс в Console и автоматически скачивают CSV. Вспомогательные parsers могут иметь другой output, если это указано в meta header.

- `sort-volume.js` — неправильный порядок volume.
- `volume-checker.js` — разные единицы измерения volume.
- `missing-shades.js` — активные предложения с `color_variant1C`, но без `shade`.
- `shade-and-volume.js` — все предложения, у которых одновременно заполнены `shade` и `volume`.
- `orphan-attributes.js` — предложения без `product`.
- `products-without-attributes.js` — активные товары без предложений.
- `products-without-brand.js` — активные товары без `brand`.
- `products-without-categories.js` — активные товары без `categories`.
- `products-with-wrong-prices.js` — активные товары, у которых хотя бы одно предложение имеет `price = 0`, пустой `price` или дробный `price`.
- `products-with-missing-content.js` — активные товары без одного или нескольких критичных контентных полей: `name1`, `name2`, `detail_picture`, `detail_text`.
- `products-with-wrong-variants.js` — активные товары с несколькими предложениями, у которых нет единого типа выбора по `shade` или `volume`: отсутствующие relations, смешанный тип или одновременные `shade + volume`.
- `dom-stealer.js` — копирует текущий DOM страницы в Clipboard для диагностики UI.
- `manifest.json` — список парсеров для Parser Launcher.

Для нового регулярного парсера достаточно добавить `.js` в `parsers/` и зарегистрировать его в `parsers/manifest.json`.

## Postman

Основной файл:

`postman/admin-api.json`

Коллекция намеренно не содержит большого набора готовых запросов. Повторяющиеся значения вынесены в collection variables.

Пример:

```text
{{baseUrl}}{{products}}
{{baseUrl}}{{attributes}}
{{baseUrl}}{{brands}}
{{baseUrl}}{{categories}}
```

Основные variables:

- URL: `baseUrl`, `contentManagerUrl`, `bffUrl`;
- API paths: `products`, `attributes`, `promotions`, `brands`, `categories` и другие endpoints;
- пагинация: `page`, `pageSize`, `sort`;
- локали: `locale`, `altLocale`;
- идентификаторы: `documentId`, `productDocumentId`, `attributeDocumentId`, `brandDocumentId`, `categoryDocumentId`;
- рабочие значения: `barcode`, `productKey`, `brandName`, `categoryCode`, `slug`;
- секреты: `jwtToken`, `bearerToken`, `categoryDebugToken`.

Секреты в GitHub не хранятся и заполняются только локально в Postman.

## Promts / project context

`promts/` — живое централизованное хранилище контекста, а не архив.

- `promts/project-context.md` — полный рабочий контекст: архитектура, endpoints, ограничения, принятые решения, структура repo, исторические кейсы и рабочие паттерны.
- `promts/project-instructions.md` — правила совместной работы: формат ответов, приоритеты, подход к Strapi/API/GitHub/парсерам/ТЗ.

После существенных изменений архитектуры, workflow или накопления нового важного контекста эти файлы нужно синхронизировать. При изменении структуры/назначения репозитория одновременно обновляется README.

GitHub-версии файлов в `promts/` считаются централизованным source of truth; пользователь периодически копирует их в Project ChatGPT, чтобы контекст проекта оставался свежим.

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
│   ├── list-view.js
│   └── record-list-scrollbars.js
├── parsers/
│   ├── manifest.json
│   ├── dom-stealer.js
│   ├── missing-shades.js
│   ├── shade-and-volume.js
│   ├── orphan-attributes.js
│   ├── products-with-missing-content.js
│   ├── products-with-wrong-variants.js
│   ├── products-without-attributes.js
│   ├── products-without-brand.js
│   ├── products-without-categories.js
│   ├── products-with-wrong-prices.js
│   ├── sort-volume.js
│   └── volume-checker.js
├── postman/
│   └── admin-api.json
├── promts/
│   ├── project-context.md
│   └── project-instructions.md
└── README.md
```
