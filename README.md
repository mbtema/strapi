Набор рабочих инструментов для админки Strapi: постоянные extensions, UI/UX-кастомы, парсеры, универсальный RU → KK переводчик и backup/sync snapshot Project Instructions и Project Context.

## Структура

| Папка | Назначение |
|---|---|
| [`extension/`](./extension) | Единый Tampermonkey loader |
| [`manifests/`](./manifests) | Централизованные реестры extensions и parsers |
| [`features/`](./features) | Функции: горячие клавиши, barcode и Parser Launcher |
| [`ui-ux/`](./ui-ux) | UI/UX-кастомы Strapi |
| [`parsers/`](./parsers) | Массовые проверки данных и вспомогательные browser parsers |
| [`translator/`](./translator) | RU → KK переводчик: полная версия, compressed-версия и extractor для накопленного translation context |
| [`project/`](./project) | Sync/staging copies для Project Instructions и источника `context.md` |

## Extension loader

В Tampermonkey устанавливается только:

`extension/loader.js`

Userscript metadata (`==UserScript==`, `@name`, `@version`, `@match` и т.д.) нужна только этому loader. Дочерние extensions и parsers загружаются через manifests и не содержат собственные metadata-блоки.

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
- `parser-launcher.js` — `Alt+P`, открывает список парсеров из `manifests/parsers.json` вертикальными колонками по группам, строго валидирует `file` / semver `version` / `group` и дубли файлов; блокирует повторный параллельный запуск async parser и для GET-запросов автоматически повторяет временные network / `429` / `5xx` ошибки.

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

## Parsers

Парсеры запускаются через `Alt+P`. Массовые data-audit parsers проверяют текущее состояние CMS только через Content Manager API, включая draft/modified записи; Public API `/api/...` для этих проверок не используется. Парсеры проходят данные постранично, показывают progress/counters и автоматически скачивают CSV. При запуске через Parser Launcher временные ошибки чтения автоматически повторяются; постоянные `4xx` не ретраятся. Регистрация parser'а и его версия (`file`, semver `version`, `group`) хранятся только в `manifests/parsers.json`; metadata-блоки внутри parser-файлов не используются.

- `attributes-wrong-prices.js` — attributes активных товаров в текущем состоянии CMS с пустой, нечисловой, нулевой, отрицательной или дробной ценой; CSV включает `documentId` предложения.
- `products-missing-content.js` — проверяет критичные контентные поля активных товаров с учётом `categories.active`: товары только в отключённых категориях пропускаются, а товары без categories или со смешанными active/inactive categories всегда попадают в отчёт как edge cases.
- `products-wrong-variants.js` — проверяет варианты `shade`/`volume` у attributes активных товаров и формирует компактный отчёт `documentId` + `errorType`.
- `dom-stealer.js` — копирует текущий DOM страницы в Clipboard для диагностики UI.
- `network-recorder.js` — Start/Stop recorder для same-origin Strapi `fetch`/XHR: собирает `/api/...`, `/content-manager/...`, `/upload`, request/response context и на Stop копирует JSON dump в Clipboard.
- `style-stealer.js` — снимает design snapshot текущей страницы Strapi: UI-релевантные computed styles, matched CSS rules, `::before` / `::after`, design tokens и отдельные дедуплицированные профили `native` / `modified` / `custom`; `data-tm-created="<extension-id>"` отмечает созданный extension UI, `data-tm-modified="<extension-id>"` — нативный узел внутри custom-контейнера; показывает progress, копирует JSON в Clipboard или скачивает `style-stealer.json`.
- `layout-sync.js` — service dry-run для Product: читает фактический порядок и строки полей из UI после `product-sections`, во вкладке `Фильтры` учитывает порядок смысловых групп, сохраняет текущий `size` каждого поля, показывает diff и только после подтверждения записывает `layouts.edit` через штатный Content Manager configuration API с последующим GET verify.
- `manifests/parsers.json` — runtime-источник `file`, semver `version` и `group` для Parser Launcher; `group` задаётся только здесь.

Для нового parser добавь файл в `parsers/` и зарегистрируй его в `manifests/parsers.json` через `file`, `version` и `group`. `version` и `group` внутри parser-файла не дублируются.

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
│   └── parser-launcher.js
├── ui-ux/
│   ├── sidebar.js
│   ├── entry-relocate.js
│   ├── product-attributes-navigator.js
│   ├── product-sections.js
│   └── record-list.js
├── parsers/
│   ├── dom-stealer.js
│   ├── network-recorder.js
│   ├── style-stealer.js
│   ├── layout-sync.js
│   ├── products-missing-content.js
│   ├── products-wrong-variants.js
│   └── attributes-wrong-prices.js
├── translator/
│   ├── full.md
│   ├── compressed.md
│   └── extractor.md
├── project/
│   ├── context.md
│   └── instruction.md
└── README.md
```
