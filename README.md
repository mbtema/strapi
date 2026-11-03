Набор рабочих инструментов для админки Strapi: постоянные extensions, UI/UX-кастомы, browser tools, универсальный RU → KK переводчик и backup/sync snapshot Project Instructions и Project Context.

## Структура

| Папка | Назначение |
|---|---|
| [`extension/`](./extension) | Единый Tampermonkey loader |
| [`manifests/`](./manifests) | Централизованные реестры extensions и tools |
| [`features/`](./features) | Функции: горячие клавиши, barcode и Tools Launcher |
| [`ui-ux/`](./ui-ux) | UI/UX-кастомы Strapi |
| [`tools/`](./tools) | Browser tools по назначению: `audits/`, `sync/`, `diagnostics/` |
| [`migrator/`](./migrator) | Независимые pipeline Bitrix → Strapi: `products/` — товары, `attributes/` — торговые предложения |
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

Pipeline разделены по типу записей и не используют общие конфиги. `products/` содержит существующий pipeline для товаров; все его CSV, media checkpoint, journal и отчёты теперь используют префикс `products-` вместо `migration-`. При переходе не смешивать новые файлы со старыми checkpoint. `attributes/` предназначен для торговых предложений (`api::attribute.attribute`, Bitrix `IBLOCK_ID=2`).

Первый этап Attributes — [`migrator/attributes/config.js`](./migrator/attributes/config.js): Console-скрипт Strapi Admin. Читает **все** записи `ru` через Content Manager list API, включая неактивные, draft и записи без barcode, и скачивает `attributes-config.csv` с колонками `documentId;barcode;active;hasDetailPicture` (`active`: true/false/null, `hasDetailPicture`: true/false). Запрашивает минимальный `populate` ID картинки; при отсутствии `active`/`detail_picture` в массовом API или неизвестном Media-формате останавливает экспорт без CSV, а не угадывает наличие файла. Использует JWT из `AUTH.jwtToken` (если заполнен) либо `localStorage.jwtToken`, выполняет только GET, показывает прогресс и не выгружает частичный результат при ошибке. Пустые barcode сохраняются, повторяющиеся barcode учитываются в статистике. Не открывать/пересохранять CSV через Excel: это может преобразовать штрихкоды и потерять ведущие нули. Второй этап — [`migrator/attributes/matcher.js`](./migrator/attributes/matcher.js): read-only Console-скрипт Bitrix Admin для `IBLOCK_ID=2`. Принимает **новый** `attributes-config.csv`, читает весь список предложений через `PAGEN_1` и обязательные видимые колонки `PROPERTY_19` (Штрихкод), `ACTIVE` (Активность). Точно сопоставляет barcode, сравнивает `active` и `hasDetailPicture`: если активность совпадает и Media в Strapi уже есть — пропускает предложение. В `attributes-matched.csv` (формат importer не меняется: `documentId;barcode;bitrixUrl`) выгружает **только кандидатов на синхронизацию** — несовпадающую активность и/или отсутствующий файл Strapi. Отсутствующие и неоднозначные barcode отдельно в `attributes-unmatched.csv`, исключённые синхронизированные записи считаются в сводке и туда не попадают. Если Media нет в Strapi, но нет и в Bitrix, importer может безопасно пропустить запись после проверки карточки. Показывает progress, хранит checkpoint в localStorage по хешу входного CSV, умеет мягко остановиться через `window.bitrixAttributesMatchStop = true` и продолжить после повторного запуска. Читает страницы Bitrix **последовательно** с подтверждёнными Network-параметрами `by=id&order=asc` на каждом GET, проверяет строго возрастающие ID внутри и между страницами (включая checkpoint); при повторном ID, нарушении порядка, неверной длине страницы или total перечитывает страницу до 3 раз и, если ошибка сохраняется, останавливается без CSV, оставляя checkpoint. Формат checkpoint `v3-id-asc`; старый checkpoint v2 намеренно не переиспользуется из-за смены порядка сортировки. Перед экспортом проверяет количество и уникальность всех прочитанных Bitrix ID, пропускает только скрытые служебные строки `main-grid-not-count[data-id=template_N][hidden]` и проверяет соответствие ячеек заголовкам; при неожиданной разметке/пагинации останавливается без итогового CSV. Использует текущую сессию Cookie браузера, вручную проставить заголовок Cookie в browser fetch нельзя. Barcode и пагинация проверены в Bitrix; чтение колонки `ACTIVE` в live grid ещё нужно проверить первым запуском. Неизвестное значение активности или отсутствие колонки приводит к STOP без итоговых CSV — при таком случае включить «Активность» в настройках таблицы или прислать HTML ячейки/Network. Checkpoint matcher теперь `v2`, старый `v1` не переиспользуется. Третий этап — [`migrator/attributes/importer.mjs`](./migrator/attributes/importer.mjs): самостоятельный Node.js 20+ importer (`npm install cheerio`) для `attributes-matched.csv` с точно тремя колонками `documentId;barcode;bitrixUrl`. Работа с рабочего стола Windows, локальные ключи `AUTH.jwtToken` и `AUTH.bitrixCookies` (в GitHub только placeholders). Строки без ссылки пропускаются; для строк с ссылкой валидируются хост/IBLOCK_ID=2/ID, заново сравнивается barcode из карточки Bitrix и текущего Strapi с исходным CSV (в том числе перед Save и после Publish). Дополнительно проверяет скрытый `ID` элемента на карточке Bitrix; селекторы `PROP[19][...]`, `ACTIVE` и `DETAIL_PICTURE`/`real_url` сверены с двумя HTML-снимками карточки `IBLOCK_ID=2, ID=833300` (2026-11-02) без PowerShell/HTTP-записи. По локали `ru` сравнивает `active`; импортирует `detail_picture` только если в Strapi он пустой и в Bitrix обнаружен оригинал. Если менять нечего, Save/Publish не выполняются. Если изменение есть: GET current → при необходимости GET изображения → POST `/upload` → partial PUT только изменённых полей → GET verify → POST `actions/publish` → published GET verify; чужие поля и существующая Media не перезаписываются. Default dry-run: `node --use-system-ca "$env:USERPROFILE\Desktop\importer.mjs"`, результат `attributes-import-plan.csv` с отдельным счётчиком запланированных изменений. Полный CSV-отчёт обновляется каждые 100 обработанных записей и в конце (журнал checkpoint при записи обновляется отдельно для каждой записи), чтобы не переписывать десятки тысяч строк после каждого предложения. Вывод в PowerShell — подробный построчный лог по аналогии с `products/importer.mjs`: для каждой записи показывает `[номер/всего]`, Bitrix ID, Strapi documentId, чтение, сравнение `active` и `detail_picture`, загрузку Media (если нужна), Save, проверку, Publish и финальный статус. Пропущенные из checkpoint записи также показываются с причиной, ошибки выводятся сразу. После **каждой** записи показывает счётчик обработанных относительно всего CSV, процент, сколько обработано за текущий запуск, среднюю скорость (зап/сек) и примерное оставшееся время (ETA). Прогресс-бар и полная сводка (обновлено/без изменений/загружено/нет пары/ошибки/ручная проверка, прошедшее время) выводятся при старте, каждые 100 вновь обработанных записей и в конце. При возобновлении доля выполнения учитывает checkpoint, но скорость и ETA рассчитываются только по текущему запуску. Журнал сохраняет подтверждённые ID загруженной Media для корректной статистики после возобновления. Реальный запуск: `node --use-system-ca "$env:USERPROFILE\Desktop\importer.mjs" --apply`, результат `attributes-import-report.csv`; пилот одной записи `--only=DOCUMENT_ID` (без угловых скобок), `--pause-ms=<число>` (по умолчанию 0 мс, допустимо 0–60000; обработка последовательная), `--retry-errors` только для ошибок до записи. Журнал `attributes-import-journal-<hash>.jsonl` на Desktop сохраняет checkpoint перед каждым POST/PUT; при неясном исходе write ставит статус `review` и не делает автоматических повторов. Записи обрабатываются последовательно. `migrator/attributes/starter.ps1` содержит прямую команду с `--apply`; файл `migrator/attributes/importer.mjs` из репозитория скачать на Desktop как **`importer.mjs`**, без переименования. В папке Desktop два одноимённых `importer.mjs` (из `products` и `attributes`) одновременно хранить нельзя; при смене pipeline проверь содержимое файла. **Перед массовым apply** получить новые config/matched CSV, сохранить старые отчёты и журналы отдельно, проверить актуальный CSV и dry-run по сокращённой выборке. Старый journal привязан к старому хешу CSV и не переносится автоматически. HTML-парсер проверен по присланным снимкам; Пилотный Node.js `--apply` одной записи с загрузкой Media и публикацией проверен пользователем; массовая обработка ещё не проверена. Формат GET draft/published для Strapi Attribute (включая `active` и заполненный/пустой `detail_picture`) проверен по результатам read-only диагностики. Перед массовым запуском проверить план импорта и checkpoint.

`migrator/products/config.js` — самостоятельный read-only Console-скрипт для Strapi Admin (DevTools → Console), не зарегистрирован в Tools Launcher. Читает все товары локали `ru` с `newFrom1C=true`; включает в конфиг товары, у которых отсутствует хотя бы одно из полей `name1`, `name2`, `preview_picture`, `detail_picture`, `categories`, `detail_text`. Для кандидатов читает связанные `attributes[].barcode` и скачивает `products-config.csv` со строго тремя колонками: `documentId;name;barcodes`. Несколько barcode разделяются `|`; значения сохраняются строками. Показывает прогресс, не изменяет CMS. Второй этап — `migrator/products/matcher.js`: Console-скрипт Bitrix Admin, принимает `products-config.csv`, ищет строгое (с учётом регистра) совпадение `NAME === name` и проверяет хотя бы один общий barcode из торговых предложений. Скачивает `products-matched.csv` с `documentId;name;barcodes;bitrixId;bitrixCardUrl;matchedBarcode` только для подтверждённых пар, а остальные случаи выводит в `products-unmatched.csv`. Ищет кандидатов последовательно через сессионный фильтр Bitrix, но проверяет карточки независимо и параллельно (не более 3 GET одновременно; максимум 4 ожидающих товара), без прежней паузы 150 мс. Точная проверка NAME (с учётом регистра), единственности совпадения и общего barcode не менялась. Сохраняет checkpoint в localStorage для продолжения, не меняет товары (но изменяет пользовательский поисковый фильтр Bitrix). Третий этап — `migrator/products/importer.mjs`: самостоятельный Node.js-импортёр всего `products-matched.csv`. Запускается из любой папки PowerShell, читает CSV и хранит результаты на рабочем столе Windows; JWT и Cookie вставляются один раз в локальную копию `const AUTH`, в GitHub лежат только поля для заполнения. По умолчанию read-only dry-run для **всех** строк CSV: `node --use-system-ca "$env:USERPROFILE\Desktop\importer.mjs"`, результат `products-import-plan.csv`. Реальная массовая запись **всех** строк за один запуск: `node --use-system-ca "$env:USERPROFILE\Desktop\importer.mjs" --apply`. Товары обрабатываются строго по одному в порядке CSV, без партий и параллельных товаров, пауза 1500 мс между товарами (необязательная настройка `--pause-ms=...`, минимум 500 мс). Входной CSV не менять во время выполнения и при возобновлении. Одиночный пилот `--apply --confirm=<BitrixID>` работает только при одной строке CSV. Локальный `products-import-journal-<hash>.jsonl` фиксирует статус и шаг перед каждым Upload/PUT/Publish и позволяет продолжать обработку тем же CSV после остановки: `done`, `skipped_already`, `partial`, `error`, `review` пропускаются по умолчанию, `--retry-errors` повторяет только ошибки без записи, `--retry-partial` перепроверяет частичные карточки; `review` требует проверки вручную и автоматически не повторяется. После записи формируется `products-import-report.csv` (одна строка на товар, включая ещё не обработанные). Проверенная схема товара: заполнять только отсутствующий контент, сохранять существующие категории, синхронизировать active, отдельно проверять каждое Save; если шесть обязательных полей полны — ставить `newFrom1C=false`, затем Publish ru и проверка опубликованной версии. При неполном контенте `newFrom1C=true`, но успешно сохранённые изменения также публикуются. Галерея не обязательна. Для файлов сохраняется `products-media-checkpoint.json` с ID загруженных изображений. `migrator/products/starter.ps1` содержит одну команду запуска `importer.mjs --apply` для реальной последовательной миграции всего CSV; обновлений из GitHub и дополнительной логики нет.

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
│   ├── products/
│   │   ├── config.js
│   │   ├── matcher.js
│   │   ├── importer.mjs
│   │   └── starter.ps1
│   └── attributes/
│       ├── config.js
│       ├── matcher.js
│       ├── importer.mjs
│       └── starter.ps1
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
