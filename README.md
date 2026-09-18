Набор рабочих инструментов для админки Strapi и миграции контента: постоянные extensions, UI/UX-кастомы, парсеры, Bitrix-утилиты, Postman, универсальный RU → KK переводчик и backup/sync snapshot Project Instructions и Project Context.

## Структура

| Папка | Назначение |
|---|---|
| [`extension/`](./extension) | Единый Tampermonkey loader и корневой manifest реестра extensions |
| [`features/`](./features) | Функции: горячие клавиши, barcode, Parser Launcher, Vimium helper + свой `manifest.json` |
| [`ui-ux/`](./ui-ux) | UI/UX-кастомы Strapi + свой `manifest.json` |
| [`parsers/`](./parsers) | Массовые проверки данных и вспомогательные browser parsers |
| [`migrator/`](./migrator) | Утилиты для аудита и миграции данных из Bitrix |
| [`postman/`](./postman) | Postman collection с общими variables и API paths |
| [`translator/`](./translator) | Универсальный RU → KK переводчик и prompt для извлечения накопленного translation context |
| [`project/`](./project) | Backup/sync snapshot Project Instructions и Project Context; не является рабочим source of truth проекта |

## Extension loader

В Tampermonkey устанавливается только:

`extension/loader.js`

Loader при открытии Strapi:

1. мгновенно запускает последнюю сохранённую копию extensions из кеша;
2. в фоне загружает корневой `extension/manifest.json`;
3. по нему загружает manifests рабочих папок, сейчас `ui-ux/manifest.json` и `features/manifest.json`;
4. объединяет и валидирует их как единый registry;
5. при изменении версий или путей скачивает только изменившиеся файлы и сохраняет новый кеш;
6. обновлённые extensions применяются после следующей перезагрузки Strapi.

Старые отдельные Tampermonkey-скрипты после установки loader нужно отключить или удалить, иначе один функционал будет запускаться дважды.

Для ручной проверки обновлений в Console доступна команда `checkUpdates()`. Она проверяет установленную версию loader и все дочерние manifests, скачивает изменившиеся extensions в кеш и сообщает, нужна ли перезагрузка Strapi. Если в repo появилась новая версия самого loader, команда сообщает, что userscript нужно обновить через Tampermonkey.

### Manifest

`extension/manifest.json` — корневой registry: он содержит только список дочерних manifests.

Метаданные конкретных extensions (`id`, `path`, semver `version`, `enabled`) хранятся рядом с кодом в manifest соответствующей папки: `features/manifest.json` или `ui-ux/manifest.json`. При изменении extension увеличивается его `version` именно там. Изменение пути также меняет сигнатуру кеша и заставляет loader скачать файл заново. `enabled: false` оставляет файл в репозитории, но исключает его из загрузки.

Loader валидирует каждый дочерний manifest и итоговый объединённый registry: формат путей, соответствие имени файла `id`, semver и глобальные дубли `id/path`. Если root/child manifest недоступен или некорректен, новый кеш не записывается, а при наличии старого loader продолжает использовать его.

## Features

- `barcode-extractor.js` — `Alt+B`, копирует barcode из поля `input[name="barcode"]` в карточке товара и показывает toast.
- `ctrl-enter-publisher.js` — `Alt+Enter`, публикует текущую запись.
- `parser-launcher.js` — `Alt+P`, открывает список парсеров из `parsers/manifest.json`, строго валидирует `file` / semver `version` / `group` и дубли файлов, блокирует повторный параллельный запуск async parser и для GET-запросов автоматически повторяет временные network / `429` / `5xx` ошибки.
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

Версия extension независима от версии loader. Единственный источник версии для файла — `manifest.json` его папки (`features/manifest.json` или `ui-ux/manifest.json`); отдельные metadata-блоки и `@version` внутри этих файлов не используются.

## Parsers

Парсеры запускаются через `Alt+P`. Регулярные проверочные парсеры проходят API постранично, показывают progress/counters и автоматически скачивают CSV. При запуске через Parser Launcher временные ошибки чтения автоматически повторяются; постоянные `4xx` не ретраятся. Метаданные parser'а хранятся только в `parsers/manifest.json`; metadata-блоков внутри `.js` нет.

- `sort-volume.js` — неправильный порядок volume.
- `volume-checker.js` — разные единицы измерения volume.
- `missing-shades.js` — активные предложения с `color_variant1C`, но без `shade`.
- `shade-and-volume.js` — опубликованные предложения, у которых одновременно заполнены `shade` и `volume`.
- `attributes-without-product.js` — опубликованные предложения без `product`.
- `attributes-without-detail-picture.js` — предложения активных товаров без `detail_picture`.
- `products-without-attributes.js` — активные товары без предложений.
- `products-without-brand.js` — активные товары без `brand`.
- `products-without-categories.js` — активные товары без `categories`.
- `products-with-duplicate-fields.js` — дубли технических идентификаторов `key`, `code_1c`, `bitrix_id`, `xml_id`, `code`.
- `products-with-wrong-prices.js` — активные товары с нулевой/пустой/некорректной ценой предложения.
- `products-with-missing-content.js` — активные товары без критичных контентных полей; товары из категорий `kns3po2mz8hq9kezm3szbvjg` и `a4zy2gvb479ku9nd6py5uxzh` исключаются из отчёта и считаются неактивными для этой проверки.
- `products-with-wrong-variants.js` — товары с неконсистентным выбором вариантов по `shade`/`volume`.
- `attributes-with-barcode-issues.js` — draft-аудит опубликованных предложений без `barcode` и с повторяющимися `barcode`; без фильтра по `active`/`isInStock`.
- `dom-stealer.js` — копирует текущий DOM страницы в Clipboard для диагностики UI.
- `manifest.json` — единый источник `file`, semver `version` и `group` для Parser Launcher.

Для нового регулярного parser достаточно добавить `.js` в `parsers/` и зарегистрировать его в `parsers/manifest.json`, указав `file`, `version` и `group`; дублировать metadata внутри parser-файла не нужно.

Рабочие группы: `products`, `offers`, `attributes`, `drafts`, `service`.

## Bitrix / Migrator

- `migrator/detail-picture-audit.js` — browser-аудит DETAIL_PICTURE: напрямую сканирует торговые предложения `IBLOCK_ID=2`, сопоставляет точный barcode и открывает карточку конкретного offer только когда изображение нельзя получить из строки списка; сохраняет checkpoint и CSV.
- `migrator/detail-picture-migrator.js` — локальный Node.js migrator: находит Strapi attribute, скачивает изображение, загружает его в Strapi, привязывает `detail_picture`, публикует `ru` и проверяет результат.
- Migrator сохраняет checkpoint и не повторяет неопределённый `POST /upload`, чтобы не создавать duplicate media.
- Bitrix browser-утилиты запускаются только на домене Bitrix Admin, где доступна авторизованная сессия.

## Postman

Основной файл:

`postman/admin-api.json`

Коллекция хранит общие URL, API paths, pagination/locale/id variables. Секреты (`jwtToken`, `bearerToken`, `categoryDebugToken`) в GitHub не заполняются и задаются только локально.

## Translator

- `translator/translator.md` — единый мультимодальный RU → KK translator для API и ручной работы. Сам определяет режим `EMPTY`, `PLAIN_TEXT`, `HTML` или `IMAGE`; использует общий глоссарий и отдельные ограничения для каждого типа входа.
- `translator/context-extractor.md` — отдельный служебный prompt для анализа накопленного контекста рабочего translation-проекта и подготовки подтверждённых правил/терминов для последующего merge в основной translator prompt.

## Project

`project/` не участвует в runtime и не является рабочим source of truth ChatGPT Project.

- `project/project-context.md` — snapshot knowledge layer: архитектура, endpoints, ограничения, принятые решения, структура repo, исторические кейсы и рабочие workflows.
- `project/project-instructions.md` — snapshot operational layer: приоритеты, формат ответов и правила работы.

Рабочие версии находятся непосредственно в ChatGPT Project. При появлении подтверждённой устойчивой информации сначала обновляется соответствующий слой Project, затем синхронизируется его копия в `project/`.

README обновляется, когда меняются структура, назначение, установка, использование или перечень основных инструментов репозитория.

## Дерево

```text
.
├── extension/
│   ├── loader.js
│   └── manifest.json
├── features/
│   ├── manifest.json
│   ├── barcode-extractor.js
│   ├── ctrl-enter-publisher.js
│   ├── parser-launcher.js
│   └── vimium-open-row.js
├── ui-ux/
│   ├── manifest.json
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
├── translator/
│   ├── translator.md
│   └── context-extractor.md
├── project/
│   ├── project-context.md
│   └── project-instructions.md
└── README.md
```
