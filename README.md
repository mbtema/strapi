Набор рабочих инструментов для админки Strapi: постоянные extensions, UI/UX-кастомы, парсеры, универсальный RU → KK переводчик и backup/sync snapshot Project Instructions и Project Context.

## Структура

| Папка | Назначение |
|---|---|
| [`extension/`](./extension) | Единый Tampermonkey loader |
| [`manifests/`](./manifests) | Централизованные реестры extensions и parsers |
| [`features/`](./features) | Функции: горячие клавиши, barcode, Parser Launcher, Vimium helper |
| [`ui-ux/`](./ui-ux) | UI/UX-кастомы Strapi |
| [`parsers/`](./parsers) | Массовые проверки данных и вспомогательные browser parsers |
| [`translator/`](./translator) | RU → KK переводчик: полная версия, compressed-версия и extractor для накопленного translation context |
| [`project/`](./project) | Sync/staging copies для Project Instructions и источника `context.md` |

## Extension loader

В Tampermonkey устанавливается только:

`extension/loader.js`

Loader при открытии Strapi:

1. мгновенно запускает последнюю сохранённую копию extensions из кеша;
2. в фоне загружает корневой `manifests/extensions.json`;
3. по нему загружает `manifests/ui-ux.json` и `manifests/features.json`;
4. объединяет и валидирует их как единый registry;
5. при изменении версий или путей скачивает только изменившиеся файлы и сохраняет новый кеш;
6. обновлённые extensions применяются после следующей перезагрузки Strapi.

Старые отдельные Tampermonkey-скрипты после установки loader нужно отключить или удалить, иначе один функционал будет запускаться дважды.

Для ручной проверки обновлений в Console доступна команда `checkUpdates()`. Она проверяет установленную версию loader и все дочерние manifests, скачивает изменившиеся extensions в кеш и сообщает, нужна ли перезагрузка Strapi. Если в repo появилась новая версия самого loader, команда сообщает, что userscript нужно обновить через Tampermonkey.

### Manifest

`manifests/` — единое место для runtime-реестров. `manifests/extensions.json` содержит список extension manifests, сейчас `manifests/features.json` и `manifests/ui-ux.json`. Все manifests используют `schemaVersion: 1`; это версия формата конкретного manifest, а не версия скриптов.

Метаданные конкретных extensions (`id`, `path`, semver `version`, `enabled`) хранятся в `manifests/features.json` и `manifests/ui-ux.json`. При изменении extension увеличивается его `version` в соответствующем manifest. Изменение пути также меняет сигнатуру кеша и заставляет loader скачать файл заново. `enabled: false` оставляет файл в репозитории, но исключает его из загрузки.

Loader валидирует каждый дочерний manifest и итоговый объединённый registry: формат путей, соответствие имени файла `id`, semver и глобальные дубли `id/path`. Если root/child manifest недоступен или некорректен, новый кеш не записывается, а при наличии старого loader продолжает использовать его.

## Features

- `barcode-extractor.js` — `Alt+B`, копирует barcode из поля `input[name="barcode"]` в карточке товара и показывает toast.
- `ctrl-enter-publisher.js` — `Alt+Enter`, публикует текущую запись.
- `parser-launcher.js` — `Alt+P`, открывает список парсеров из `manifests/parsers.json`, строго валидирует `file` / semver `version` / `group` и дубли файлов; перед запуском regular parser сверяет его `@name` и `@version` с manifest; блокирует повторный параллельный запуск async parser и для GET-запросов автоматически повторяет временные network / `429` / `5xx` ошибки.
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

Версия extension независима от версии loader. Единственный источник версии для extension — его запись в `manifests/features.json` или `manifests/ui-ux.json`; отдельные metadata-блоки и `@version` внутри этих файлов не используются.

## Parsers

Парсеры запускаются через `Alt+P`. Регулярные проверочные парсеры проходят API постранично, показывают progress/counters и автоматически скачивают CSV. При запуске через Parser Launcher временные ошибки чтения автоматически повторяются; постоянные `4xx` не ретраятся. Регистрация parser'а (`file`, semver `version`, `group`) хранится в `manifests/parsers.json`; каждый regular parser также содержит meta header с `name`, `version`, назначением и форматом `output`.

- `sort-volume.js` — неправильный порядок volume.
- `volume-checker.js` — разные единицы измерения volume.
- `missing-shades.js` — активные предложения с `color_variant1C`, но без `shade`.
- `shade-and-volume.js` — опубликованные предложения, у которых одновременно заполнены `shade` и `volume`.
- `attributes-without-product.js` — опубликованные предложения без `product`.
- `attributes-without-detail-picture.js` — предложения активных товаров в наличии (`isInStock=true`) без `detail_picture`.
- `products-without-attributes.js` — активные товары без предложений.
- `products-without-brand.js` — активные товары без `brand`.
- `products-without-categories.js` — активные товары без `categories`.
- `products-with-duplicate-fields.js` — дубли технических идентификаторов `key`, `code_1c`, `bitrix_id`, `xml_id`, `code`.
- `products-with-wrong-prices.js` — предложения активных товаров с пустой, нечисловой, нулевой, отрицательной или дробной ценой; CSV включает `documentId` предложения.
- `products-with-missing-content.js` — активные товары без критичных контентных полей; товары из категорий `kns3po2mz8hq9kezm3szbvjg` и `a4zy2gvb479ku9nd6py5uxzh` исключаются из отчёта и считаются неактивными для этой проверки.
- `products-with-wrong-variants.js` — товары с неконсистентным выбором вариантов по `shade`/`volume`.
- `attributes-with-barcode-issues.js` — draft-аудит опубликованных предложений без `barcode` и с повторяющимися `barcode`; без фильтра по `active`/`isInStock`.
- `dom-stealer.js` — копирует текущий DOM страницы в Clipboard для диагностики UI.
- `manifests/parsers.json` — runtime-источник `file`, semver `version` и `group` для Parser Launcher; `group` задаётся только здесь.

Для нового regular parser добавь meta header (`name`, `version`, назначение, `output`), затем зарегистрируй файл в `manifests/parsers.json` с `file`, той же `version` и `group`. `group` внутри parser-файла не дублируется.

Рабочие группы: `products`, `offers`, `attributes`, `drafts`, `service`.

## Translator

- `translator/full.md` — полный source of truth для RU → KK перевода: без искусственной экономии символов, с подробными правилами, приоритетами, глоссарием и самопроверкой.
- `translator/compressed.md` — поведенчески эквивалентная сжатая версия для ChatGPT Project Instructions; должна оставаться не длиннее 8000 символов. Правила и приоритеты те же, сокращаются объяснения и примеры, а не логика.
- `translator/extractor.md` — служебный prompt для анализа review-таблиц и накопленного translation context перед merge подтверждённых правил.

При изменении translation logic сначала обновляется `full.md`, затем те же правила синхронизируются в `compressed.md` и проверяется лимит 8000 символов. `compressed.md` не должен иметь самостоятельную терминологию, расходящуюся с `full.md`.

## Project

`project/` не участвует в runtime.

- `project/instruction.md` — готовый текст для поля Project Instructions; operational rules, приоритеты и формат работы.
- `project/context.md` — готовый knowledge source для загрузки в ChatGPT Project: устойчивые факты, CANONICAL workflows, решения, доменная память, history/experiments.

Эти файлы используются как sync/staging copies: при плановой консолидации они обновляются и проверяются в repo, после чего пользователь вручную переносит `instruction.md` в Project Instructions и загружает `context.md` как источник. В обычной работе активными источниками остаются версии внутри ChatGPT Project.

Текущее code/version/manifest/Issue состояние берётся из live GitHub/API/Network/UI, а не из `context.md`.

README обновляется, когда меняются структура, назначение, установка, использование или перечень основных инструментов репозитория.

## Дерево

```text
.
├── extension/
│   └── loader.js
├── manifests/
│   ├── extensions.json
│   ├── features.json
│   ├── ui-ux.json
│   └── parsers.json
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
├── translator/
│   ├── full.md
│   ├── compressed.md
│   └── extractor.md
├── project/
│   ├── context.md
│   └── instruction.md
└── README.md
```
