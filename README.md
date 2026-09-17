Набор рабочих инструментов для админки Strapi и миграции контента: постоянные extensions, UI/UX-кастомы, парсеры, Bitrix-утилиты, Postman и backup/sync snapshot Project Instructions и Project Context.

## Структура

| Папка | Назначение |
|---|---|
| [`extension/`](./extension) | Единый Tampermonkey loader и manifest постоянных расширений Strapi |
| [`features/`](./features) | Функции: горячие клавиши, barcode, Parser Launcher, Vimium helper |
| [`ui-ux/`](./ui-ux) | UI/UX-кастомы Strapi |
| [`parsers/`](./parsers) | Массовые проверки данных и вспомогательные browser parsers |
| [`migrator/`](./migrator) | Утилиты для аудита и миграции данных из Bitrix |
| [`postman/`](./postman) | Postman collection с общими variables и API paths |
| [`promts/`](./promts) | Backup/sync snapshot Project Instructions и Project Context; не является рабочим source of truth проекта |

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

`extension/manifest.json` определяет, какие extensions включены. При изменении extension обязательно увеличивать его `version` в manifest. Изменение пути также меняет сигнатуру кеша и заставляет loader скачать файл заново. `enabled: false` оставляет файл в репозитории, но исключает его из загрузки.

Loader строго валидирует включённые entries manifest: `id`, `path`, semver `version`, соответствие имени файла и отсутствие дублей. При некорректном manifest новый кеш не записывается, а при наличии старого loader продолжает использовать его.

## Features

- `barcode-extractor.js` — `Alt+B`, копирует barcode из поля `input[name="barcode"]` в карточке товара и показывает toast.
- `ctrl-enter-publisher.js` — `Alt+Enter`, публикует текущую запись.
- `parser-launcher.js` — `Alt+P`, открывает список парсеров из `parsers/manifest.json`, включая отдельную группу `Drafts` для тестовых проверок; повторный параллельный запуск уже работающего async parser блокируется до его завершения.
- `vimium-open-row.js` — делает строки таблиц доступными для Vimium; собственная ссылка помечается через `data-tm-*` и восстанавливается после React re-render.

## UI/UX

- `sidebar.js` — единый sidebar-модуль: `Alt+S`, поиск, быстрый доступ, группы Collection Types/Single Types, active state и очистка глобальной левой навигации; последнее состояние скрыт/показан сохраняется на время текущей вкладки браузера и переживает обычный reload.
- `record-list-scrollbars.js` — визуально скрывает scrollbar/overflow decoration в списках Content Manager, сохраняя прокрутку.
- `list-view.js` — доработки list view Content Manager.
- `entry-relocate.js` — переносит действия Entry в строку с Draft / Published и освобождает ширину формы.
- `product-attributes-navigator.js` — навигация по торговым предложениям в карточке товара: загрузка всех relation `attributes`, поиск, пагинация и прямые ссылки; режим «Управление связями» раскрывает штатный Strapi relation list.
- `product-sections.js` — разделяет карточку Product на вкладки `Контент`, `Фильтры`, `Системное`, распределяя существующие Strapi-поля по API name без их копирования.

## Версионирование extensions

- patch (`1.3.1`) — небольшой фикс, доработка или оптимизация существующего поведения;
- minor (`1.4`) — заметное новое поведение;
- major (`2.0`) — крупная переработка.

Версия extension независима от версии loader. При каждом изменении extension версия в его `@version` и `extension/manifest.json` должна оставаться синхронной.

## Parsers

Парсеры запускаются через `Alt+P`. Регулярные проверочные парсеры проходят API постранично, показывают progress/counters и автоматически скачивают CSV. Вспомогательные parsers могут иметь другой output, если это указано в meta header.

- `sort-volume.js` — неправильный порядок volume.
- `volume-checker.js` — разные единицы измерения volume.
- `missing-shades.js` — активные предложения с `color_variant1C`, но без `shade`.
- `shade-and-volume.js` — предложения, у которых одновременно заполнены `shade` и `volume`.
- `attributes-without-product.js` — предложения без `product`.
- `attributes-without-detail-picture.js` — предложения активных товаров без `detail_picture`.
- `products-without-attributes.js` — активные товары без предложений.
- `products-without-brand.js` — активные товары без `brand`.
- `products-without-categories.js` — активные товары без `categories`.
- `products-with-duplicate-fields.js` — дубли технических идентификаторов `key`, `code_1c`, `bitrix_id`, `xml_id`, `code`.
- `products-with-wrong-prices.js` — активные товары с нулевой/пустой/некорректной ценой предложения.
- `products-with-missing-content.js` — активные товары без критичных контентных полей.
- `products-with-wrong-variants.js` — товары с неконсистентным выбором вариантов по `shade`/`volume`.
- `attributes-with-barcode-issues.js` — draft-аудит опубликованных предложений без `barcode` и с повторяющимися `barcode`; без фильтра по `active`/`isInStock`.
- `dom-stealer.js` — копирует текущий DOM страницы в Clipboard для диагностики UI.
- `manifest.json` — единый список парсеров и их групп для Parser Launcher.

Для нового регулярного parser достаточно добавить `.js` в `parsers/` и зарегистрировать его в `parsers/manifest.json`. Группа задаётся там же через `group`; дублировать список файлов внутри `parser-launcher.js` не нужно.

Рабочие группы: `products`, `offers`, `attributes`, `drafts`, `service`.

## Bitrix / Migrator

- `migrator/detail-picture-audit.js` — browser-аудит Bitrix по barcode с формированием mapping CSV.
- `migrator/detail-picture-migrator.js` — локальный Node.js migrator: находит Strapi attribute, скачивает изображение, загружает его в Strapi, привязывает `detail_picture`, публикует `ru` и проверяет результат.
- Migrator сохраняет checkpoint и не повторяет неопределённый `POST /upload`, чтобы не создавать duplicate media.
- Bitrix browser-утилиты запускаются только на домене Bitrix Admin, где доступна авторизованная сессия.

## Postman

Основной файл:

`postman/admin-api.json`

Коллекция хранит общие URL, API paths, pagination/locale/id variables. Секреты (`jwtToken`, `bearerToken`, `categoryDebugToken`) в GitHub не заполняются и задаются только локально.

## Promts / Project context

`promts/` не участвует в runtime и не является рабочим source of truth ChatGPT Project.

- `promts/project-context.md` — snapshot knowledge layer: архитектура, endpoints, ограничения, принятые решения, структура repo, исторические кейсы и рабочие workflows.
- `promts/project-instructions.md` — snapshot operational layer: приоритеты, формат ответов и правила работы.

Рабочие версии находятся непосредственно в ChatGPT Project. При появлении подтверждённой устойчивой информации сначала обновляется соответствующий слой Project, затем синхронизируется его копия в `promts/`.

README обновляется, когда меняются структура, назначение, установка, использование или перечень основных инструментов репозитория.

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
│   ├── product-attributes-navigator.js
│   ├── product-sections.js
│   └── record-list-scrollbars.js
├── parsers/
│   ├── manifest.json
│   ├── attributes-with-barcode-issues.js
│   ├── attributes-without-detail-picture.js
│   ├── attributes-without-product.js
│   ├── dom-stealer.js
│   ├── missing-shades.js
│   ├── shade-and-volume.js
│   ├── products-with-duplicate-fields.js
│   ├── products-with-missing-content.js
│   ├── products-with-wrong-variants.js
│   ├── products-without-attributes.js
│   ├── products-without-brand.js
│   ├── products-without-categories.js
│   ├── products-with-wrong-prices.js
│   ├── sort-volume.js
│   └── volume-checker.js
├── migrator/
│   ├── detail-picture-audit.js
│   └── detail-picture-migrator.js
├── postman/
│   └── admin-api.json
├── promts/
│   ├── project-context.md
│   └── project-instructions.md
└── README.md
```
