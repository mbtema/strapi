Набор рабочих инструментов для админки Strapi: постоянные extensions, UI/UX-кастомы, browser tools, универсальный RU → KK переводчик и backup/sync snapshot Project Instructions и Project Context.

## Структура

| Папка | Назначение |
|---|---|
| [`extension/`](./extension) | Единый Tampermonkey loader |
| [`manifests/`](./manifests) | Централизованные реестры extensions и tools |
| [`features/`](./features) | Функции: горячие клавиши, barcode и Tools Launcher |
| [`ui-ux/`](./ui-ux) | UI/UX-кастомы Strapi |
| [`tools/`](./tools) | Browser tools по назначению: `audits/`, `sync/`, `diagnostics/` |
| [`migrator/`](./migrator) | Отдельные скрипты переноса контента Bitrix → Strapi; сейчас доступен первый этап формирования конфига |
| [`helpdesk/`](./helpdesk) | n8n workflows Telegram-бота MonAmie Helpdesk |
| [`translator/`](./translator) | RU → KK переводчик: полная версия, compressed-версия и extractor для накопленного translation context |
| [`project/`](./project) | Sync/staging copies для Project Instructions и источника `context.md` |

## Extension loader

В Tampermonkey устанавливается только:

`extension/loader.js`

Userscript metadata (`==UserScript==`, `@name`, `@version`, `@match` и т.д.) нужна только этому loader. Дочерние extensions и tools загружаются через manifests и не содержат собственные metadata-блоки.

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
- `tools-launcher.js` — `Alt+P`, открывает browser tools из `manifests/tools.json` колонками `audits`, `sync`, `diagnostics`; `group` обязан совпадать с первой папкой в `file`, валидируются path / semver / group и дубли файлов; блокирует повторный параллельный запуск async tool и для GET-запросов автоматически повторяет временные network / `429` / `5xx` ошибки.

## UI/UX

- `sidebar.js` — единый sidebar-модуль: `Alt+S`, поиск, быстрый доступ, группировка Content Manager (`Каталог`, `Справочник`, `Фильтры`, `Главная страница MOBILE`, `Главная страница WEB`, `Другое`), active state и очистка глобальной левой навигации; новые нераспознанные collection types по умолчанию попадают в `Другое`; группы по умолчанию раскрыты, их свернутое/раскрытое состояние сохраняется в `localStorage` и восстанавливается после reload, раскрытие/сворачивание анимировано; состояние всего sidebar скрыт/показан сохраняется на время текущей вкладки браузера.
- `record-list.js` — единый модуль для списков записей Content Manager: скрывает scrollbar/overflow decoration, скрывает колонку `to be released in`, компактно показывает `Available in` как RU/KK, добавляет рядом с checkbox ссылку открытия записи для Vimium и поддерживает обычный click, Ctrl/Meta-click и middle-click в новую вкладку через реальный `documentId`; при ошибке lookup используется безопасный `row.click()` fallback.
- `entry-relocate.js` — переносит действия Entry в строку с Draft / Published и освобождает ширину формы.
- `product-attributes-navigator.js` — навигация по торговым предложениям в карточке товара: загрузка всех relation `attributes`, поиск, пагинация и прямые ссылки; режим «Управление связями» раскрывает штатный Strapi relation list.
- `product-sections.js` — разделяет карточку Product на вкладки `Контент`, `Фильтры`, `Системное` и показывает смысловые группы `Парфюмерия`, `Макияж`, `Уход за кожей`, `Уход за волосами`, `Другое`; в `Уход за кожей` входят `usage_time`, `age_group`, `product_segment`, `ingredients`, в `Уход за волосами` — `hair_types`, `is_hypoallergenic`, а `Другое` автоматически собирает остальные поля из `FILTER_FIELDS`. Нативные React-поля не перемещает в DOM; визуальный порядок групп задаётся через CSS `order`, а штатный порядок полей хранится в Strapi `layouts.edit` и при необходимости синхронизируется через `layout-sync.js`.

## Версионирование extensions

- patch (`1.3.1`) — небольшой фикс, доработка или оптимизация существующего поведения;
- minor (`1.4`) — заметное новое поведение;
- major (`2.0`) — крупная переработка.

Версия extension независима от версии loader. Единственный источник версии для extension — его запись в `manifests/features.json` или `manifests/ui-ux.json`; отдельные metadata-блоки и `@version` внутри этих файлов не используются.

## Tools

Browser tools запускаются через `Alt+P`. `audits/` содержит массовые проверки данных, `sync/` — инструменты синхронизации/изменения данных, `diagnostics/` — диагностические утилиты. Data-audit tools проверяют текущее состояние CMS только через Content Manager API, включая draft/modified записи; Public API `/api/...` для этих проверок не используется. Массовые tools проходят данные постранично, показывают progress/counters и при необходимости автоматически скачивают CSV. Для девяти длительных tools реализована одинаковая плавающая панель прогресса внутри CMS с мягкой остановкой; массовые независимые задания адаптируют параллельность, последовательные UI/DOM-операции сохраняют исходный порядок. Кнопка Stop не отменяет уже начатые операции записи, а дожидается завершения текущей группы с её проверкой. При запуске через Tools Launcher временные ошибки чтения автоматически повторяются; постоянные `4xx` не ретраятся. Регистрация tool и его версия (`file`, semver `version`, `group`) хранятся только в `manifests/tools.json`; metadata-блоки внутри tool-файлов не используются.

- `audits/attributes-wrong-prices.js` — attributes активных товаров в текущем состоянии CMS с пустой, нечисловой, нулевой, отрицательной или дробной ценой; CSV включает `documentId` предложения.
- `audits/products-missing-content.js` — проверяет критичные контентные поля активных товаров с учётом `categories.active`: товары только в отключённых категориях пропускаются, а товары без categories или со смешанными active/inactive categories всегда попадают в отчёт как edge cases.
- `audits/products-wrong-variants.js` — проверяет варианты `shade`/`volume` у attributes активных товаров и формирует компактный отчёт `documentId` + `errorType`.
- `audits/catalog-tree-products.js` — от открытой категории обходит всё поддерево вниз по `categories`, собирает relation `product` на каждом уровне и скачивает CSV с одной колонкой `documentId`; товары не фильтруются по active/draft/published.
- `sync/products-category-mirror-sync.js` — зеркально синхронизирует Products внутри настроенных групп из 2+ categories: для каждой группы строит union Products, одним `actions/publish` добавляет Product все недостающие categories этой группы, обрабатывает группы последовательно с live re-check/verify, использует throughput-aware adaptive concurrency без auto-retry POST и скачивает CSV только при ошибках/расхождениях.
- `sync/products-category-forward-sync.js` — односторонне синхронизирует Products по настроенным группам `source → target`: добавляет в target только отсутствующие там Products из source, обратно из target в source ничего не добавляет, выполняет общий dry-run, live re-check/verify по группам, использует тот же throughput-aware adaptive concurrency без auto-retry POST и скачивает CSV только при ошибках/расхождениях.
- `diagnostics/dom-stealer.js` — копирует текущий DOM страницы в Clipboard для диагностики UI.
- `diagnostics/network-recorder.js` — Start/Stop recorder для same-origin Strapi `fetch`/XHR: собирает `/api/...`, `/content-manager/...`, `/upload`, request/response context и на Stop копирует JSON dump в Clipboard.
- `diagnostics/style-stealer.js` — снимает design snapshot текущей страницы Strapi: UI-релевантные computed styles, matched CSS rules, `::before` / `::after`, design tokens и отдельные дедуплицированные профили `native` / `modified` / `custom`; `data-tm-created="<extension-id>"` отмечает созданный extension UI, `data-tm-modified="<extension-id>"` — нативный узел внутри custom-контейнера; показывает progress, копирует JSON в Clipboard или скачивает `style-stealer.json`.
- `sync/layout-sync.js` — service dry-run для Product: читает фактический порядок и строки полей из UI после `product-sections`, во вкладке `Фильтры` учитывает порядок смысловых групп, сохраняет текущий `size` каждого поля, показывает diff и только после подтверждения записывает `layouts.edit` через штатный Content Manager configuration API с последующим GET verify.
- `manifests/tools.json` — runtime-источник `file`, semver `version` и `group` для Tools Launcher; `file` хранит путь относительно `tools/`, а `group` обязан совпадать с первой папкой пути (`audits`, `sync`, `diagnostics`).

Для нового tool добавь файл в подходящую подпапку `tools/` (`audits/`, `sync/` или `diagnostics/`) и зарегистрируй его в `manifests/tools.json` через `file`, `version` и `group`. `version` и `group` внутри tool-файла не дублируются.

Рабочие группы: `audits`, `sync`, `diagnostics`.

## Migrator

`migrator/config.js` — самостоятельный read-only Console-скрипт для Strapi Admin (DevTools → Console), не зарегистрирован в Tools Launcher. Читает все товары локали `ru` с `newFrom1C=true`; включает в конфиг товары, у которых отсутствует хотя бы одно из полей `name1`, `name2`, `preview_picture`, `detail_picture`, `categories`, `detail_text`. Для кандидатов читает связанные `attributes[].barcode` и скачивает `migration-config.csv` со строго тремя колонками: `documentId;name;barcodes`. Несколько barcode разделяются `|`; значения сохраняются строками. Показывает прогресс, не изменяет CMS. Второй этап — `migrator/matcher.js`: Console-скрипт Bitrix Admin, принимает `migration-config.csv`, ищет строгое (с учётом регистра) совпадение `NAME === name` и проверяет хотя бы один общий barcode из торговых предложений. Скачивает `migration-matched.csv` с `documentId;name;barcodes;bitrixId;bitrixCardUrl;matchedBarcode` только для подтверждённых пар, а остальные случаи выводит в `migration-unmatched.csv`. Выполняет поиск последовательно, сохраняет checkpoint в localStorage для продолжения, не меняет товары (но изменяет пользовательский поисковый фильтр Bitrix). Третий этап — `migrator/importer.mjs`: самостоятельный Node.js-импортёр всего `migration-matched.csv`. Запускается из любой папки PowerShell, читает CSV и хранит результаты на рабочем столе Windows; JWT и Cookie вставляются один раз в локальную копию `const AUTH`, в GitHub лежат только поля для заполнения. По умолчанию read-only dry-run для **всех** строк CSV: `node --use-system-ca "$env:USERPROFILE\Desktop\importer.mjs"`, результат `migration-import-plan.csv`. Реальная массовая запись **всех** строк за один запуск: `node --use-system-ca "$env:USERPROFILE\Desktop\importer.mjs" --apply`. Товары обрабатываются строго по одному в порядке CSV, без партий и параллельных товаров, пауза 1500 мс между товарами (необязательная настройка `--pause-ms=...`, минимум 500 мс). Входной CSV не менять во время выполнения и при возобновлении. Одиночный пилот `--apply --confirm=<BitrixID>` работает только при одной строке CSV. Локальный `migration-import-journal-<hash>.jsonl` фиксирует статус и шаг перед каждым Upload/PUT/Publish и позволяет продолжать обработку тем же CSV после остановки: `done`, `skipped_already`, `partial`, `error`, `review` пропускаются по умолчанию, `--retry-errors` повторяет только ошибки без записи, `--retry-partial` перепроверяет частичные карточки; `review` требует проверки вручную и автоматически не повторяется. После записи формируется `migration-import-report.csv` (одна строка на товар, включая ещё не обработанные). Проверенная схема товара: заполнять только отсутствующий контент, сохранять существующие категории, синхронизировать active, отдельно проверять каждое Save; если шесть обязательных полей полны — ставить `newFrom1C=false`, затем Publish ru и проверка опубликованной версии. При неполном контенте `newFrom1C=true`, но успешно сохранённые изменения также публикуются. Галерея не обязательна. Для файлов сохраняется `migration-media-checkpoint.json` с ID загруженных изображений. `migrator/launcher.ps1` запускает только read-only dry-run одной локальной командой, ничего не загружает из GitHub.

## Helpdesk

`helpdesk/workflow.json` — основной n8n workflow Telegram-бота MonAmie Helpdesk: регистрация сотрудника, создание обращения одним сообщением, загрузка медиа и создание карточки в Notion. После нажатия `Создать обращение` сотрудник отправляет текст или медиа с подписью; текст обязателен, медиа опционально, отдельной кнопки отправки нет.

`helpdesk/notifications.json` — отдельный outbound workflow Notion → n8n → Telegram для уведомлений по статусам `В работе`, `Решено` и `Не по адресу`. Он принимает webhook от Notion, собирает текст уведомления из `Обращение`, `Статус`, `Ответ` и `Telegram chat ID`, затем отправляет сообщение через тот же Telegram credential. Webhook настроен на Header Auth; секрет хранится только в n8n credential и Notion custom header, не в repo.

Raw URL для импорта:

`https://raw.githubusercontent.com/mbtema/strapi/main/helpdesk/workflow.json`

`https://raw.githubusercontent.com/mbtema/strapi/main/helpdesk/notifications.json`

После обновления workflow в n8n экспорт заменяется в соответствующем файле, чтобы raw URL оставался постоянным.

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
│   └── tools.json
├── features/
│   ├── barcode-extractor.js
│   ├── ctrl-enter-publisher.js
│   └── tools-launcher.js
├── ui-ux/
│   ├── sidebar.js
│   ├── entry-relocate.js
│   ├── product-attributes-navigator.js
│   ├── product-sections.js
│   └── record-list.js
├── tools/
│   ├── audits/
│   │   ├── attributes-wrong-prices.js
│   │   ├── products-missing-content.js
│   │   └── products-wrong-variants.js
│   ├── sync/
│   │   ├── layout-sync.js
│   │   ├── products-category-forward-sync.js
│   │   └── products-category-mirror-sync.js
│   └── diagnostics/
│       ├── dom-stealer.js
│       ├── network-recorder.js
│       └── style-stealer.js
├── migrator/
│   ├── config.js
│   ├── matcher.js
│   ├── importer.mjs
│   └── launcher.ps1
├── helpdesk/
│   ├── workflow.json
│   └── notifications.json
├── translator/
│   ├── full.md
│   ├── compressed.md
│   └── extractor.md
├── project/
│   ├── context.md
│   └── instruction.md
└── README.md
```
