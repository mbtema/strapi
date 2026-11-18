Набор рабочих инструментов для админки Strapi: постоянные extensions, UI/UX-кастомы, browser tools, универсальный RU → KK переводчик и backup/sync snapshot Project Instructions и Project Context.

## Структура

| Папка | Назначение |
|---|---|
| [`extension/`](./extension) | Модули Strapi Admin: loader, manifests, features, UI/UX и browser tools |
| [`migrator/`](./migrator) | Независимые pipeline: `products/` — товары, `attributes/` — торговые предложения (включая shade/volume) |
| [`locale/`](./locale) | Независимые localizer по коллекциям (Product — Node.js, остальные инструменты — по назначению) |
| [`helpdesk/`](./helpdesk) | n8n workflows Telegram-бота MonAmie Helpdesk |
| [`translator/`](./translator) | RU → KK переводчик: полная версия, compressed-версия и extractor для накопленного translation context |
| [`project/`](./project) | Sync/staging copies для Project Instructions и источника `context.md` |

## Extension loader

В Tampermonkey устанавливается только:

`extension/extension.js`

Userscript metadata (`==UserScript==`, `@name`, `@version`, `@match` и т.д.) нужна только этому loader. Дочерние extensions и tools загружаются через manifests и не содержат собственные metadata-блоки.

Loader при открытии Strapi:

1. мгновенно запускает последнюю сохранённую копию extensions из кеша;
2. в фоне загружает корневой `extension/manifests/extensions.json`;
3. по нему загружает `extension/manifests/ui-ux.json` и `extension/manifests/features.json`;
4. объединяет и валидирует их как единый registry;
5. при изменении версий или путей скачивает только изменившиеся файлы и сохраняет новый кеш;
6. обновлённые extensions применяются после следующей перезагрузки Strapi.

Старые отдельные Tampermonkey-скрипты после установки loader нужно отключить или удалить, иначе один функционал будет запускаться дважды.

После переименования установочного файла используйте [`extension/extension.js`](./extension/extension.js), версия `1.3.7`. Старый `extension/loader.js` удалён: ранее установленный Tampermonkey-скрипт с прежним `@updateURL` не сможет обновиться автоматически. Один раз откройте новый URL и установите скрипт в Tampermonkey, затем отключите/удалите старую копию во избежание двойного запуска. После этого перезагрузите страницу Strapi, чтобы loader обновил кеш; ещё одна перезагрузка применит скачанные extensions.

Loader запускается в Strapi Admin на `http://10.10.3.80:1337/admin/*` и `https://strapi.monamie.kz:1337/admin/*` (в `@match` порт не указывается). После перехода на новый домен обновите установленный userscript через Tampermonkey или заново откройте [`extension/extension.js`](https://raw.githubusercontent.com/mbtema/strapi/main/extension/extension.js) для установки версии `1.3.7`; затем перезагрузите вкладку CMS. `@match` действует для пути `/admin/*` и его query-параметров.

Для ручной проверки обновлений в Console доступна команда `checkUpdates()`. Она проверяет установленную версию loader и все дочерние manifests, скачивает изменившиеся extensions в кеш и сообщает, нужна ли перезагрузка Strapi. Если в repo появилась новая версия самого loader, команда сообщает, что userscript нужно обновить через Tampermonkey.

### Manifest

`extension/manifests/` — единое место для runtime-реестров. `extension/manifests/extensions.json` содержит список extension manifests, сейчас `extension/manifests/features.json` и `extension/manifests/ui-ux.json`. Все manifests используют `schemaVersion: 1`; это версия формата конкретного manifest, а не версия скриптов.

Метаданные конкретных extensions (`id`, `path`, semver `version`, `enabled`) хранятся в `extension/manifests/features.json` и `extension/manifests/ui-ux.json`. При изменении extension увеличивается его `version` в соответствующем manifest. Изменение пути также меняет сигнатуру кеша и заставляет loader скачать файл заново. `enabled: false` оставляет файл в репозитории, но исключает его из загрузки.

Loader валидирует каждый дочерний manifest и итоговый объединённый registry: формат путей, соответствие имени файла `id`, semver и глобальные дубли `id/path`. Если root/child manifest недоступен или некорректен, новый кеш не записывается, а при наличии старого loader продолжает использовать его.

## Features

- `alt-enter-publisher.js` — `Alt+Enter`, публикует текущую запись.
- `tools-launcher.js` — `Alt+P`, открывает browser tools из `extension/manifests/tools.json` колонками `audits`, `sync`, `diagnostics`; `group` обязан совпадать с первой папкой в `file`, валидируются path / semver / group и дубли файлов; блокирует повторный параллельный запуск async tool и для GET-запросов автоматически повторяет временные network / `429` / `5xx` ошибки.

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

Версия extension независима от версии loader. Единственный источник версии для extension — его запись в `extension/manifests/features.json` или `extension/manifests/ui-ux.json`; отдельные metadata-блоки и `@version` внутри этих файлов не используются.

## Tools

Browser tools запускаются через `Alt+P`. `audits/` содержит массовые проверки данных, `sync/` — инструменты синхронизации/изменения данных, `diagnostics/` — диагностические утилиты. Data-audit tools проверяют текущее состояние CMS только через Content Manager API, включая draft/modified записи; Public API `/api/...` для этих проверок не используется. Массовые tools проходят данные постранично, показывают progress/counters и при необходимости автоматически скачивают CSV. Для девяти длительных tools реализована одинаковая плавающая панель прогресса внутри CMS с мягкой остановкой; массовые независимые задания адаптируют параллельность, последовательные UI/DOM-операции сохраняют исходный порядок. Кнопка Stop не отменяет уже начатые операции записи, а дожидается завершения текущей группы с её проверкой. При запуске через Tools Launcher временные ошибки чтения автоматически повторяются; постоянные `4xx` не ретраятся. Регистрация tool и его версия (`file`, semver `version`, `group`) хранятся только в `extension/manifests/tools.json`; metadata-блоки внутри tool-файлов не используются.

- `audits/attributes-wrong-prices.js` — attributes активных товаров в текущем состоянии CMS с пустой, нечисловой, нулевой, отрицательной или дробной ценой; CSV включает `documentId` предложения.
- `audits/products-missing-content.js` — проверяет критичные контентные поля активных товаров с учётом `categories.active`: товары только в отключённых категориях пропускаются, а товары без categories или со смешанными active/inactive categories всегда попадают в отчёт как edge cases.
- `audits/lux-normalizer.js` — одноразовый инструмент отключения Products двух заданных брендов в `ru`: проверяет все товары и relation `brand` через Content Manager, показывает dry-run, после подтверждения сохраняет `active=false`, публикует, проверяет published state и скачивает CSV. Запуск через `Alt+P`; остановка из Console: `window.brandDisableStop = true`.
- `audits/products-wrong-variants.js` — проверяет варианты `shade`/`volume` у attributes активных товаров и формирует компактный отчёт `documentId` + `errorType`.
- `audits/catalog-tree-products.js` — от открытой категории обходит всё поддерево вниз по `categories`, собирает relation `product` на каждом уровне и скачивает CSV с одной колонкой `documentId`; товары не фильтруются по active/draft/published.
- `sync/products-category-mirror-sync.js` — зеркально синхронизирует Products внутри настроенных групп из 2+ categories: для каждой группы строит union Products, одним `actions/publish` добавляет Product все недостающие categories этой группы, обрабатывает группы последовательно с live re-check/verify, использует throughput-aware adaptive concurrency без auto-retry POST и скачивает CSV только при ошибках/расхождениях.
- `sync/products-category-forward-sync.js` — односторонне синхронизирует Products по настроенным группам `source → target`: добавляет в target только отсутствующие там Products из source, обратно из target в source ничего не добавляет, выполняет общий dry-run, live re-check/verify по группам, использует тот же throughput-aware adaptive concurrency без auto-retry POST и скачивает CSV только при ошибках/расхождениях.
- `diagnostics/dom-stealer.js` — копирует текущий DOM страницы в Clipboard для диагностики UI.
- `diagnostics/network-recorder.js` — Start/Stop recorder для same-origin Strapi `fetch`/XHR: собирает `/api/...`, `/content-manager/...`, `/upload`, request/response context и на Stop копирует JSON dump в Clipboard.
- `diagnostics/style-stealer.js` — снимает design snapshot текущей страницы Strapi: UI-релевантные computed styles, matched CSS rules, `::before` / `::after`, design tokens и отдельные дедуплицированные профили `native` / `modified` / `custom`; `data-tm-created="<extension-id>"` отмечает созданный extension UI, `data-tm-modified="<extension-id>"` — нативный узел внутри custom-контейнера; показывает progress, копирует JSON в Clipboard или скачивает `style-stealer.json`.
- `sync/layout-sync.js` — service dry-run для Product: читает фактический порядок и строки полей из UI после `product-sections`, во вкладке `Фильтры` учитывает порядок смысловых групп, сохраняет текущий `size` каждого поля, показывает diff и только после подтверждения записывает `layouts.edit` через штатный Content Manager configuration API с последующим GET verify.
- `extension/manifests/tools.json` — runtime-источник `file`, semver `version` и `group` для Tools Launcher; `file` хранит путь относительно `extension/tools/`, а `group` обязан совпадать с первой папкой пути (`audits`, `sync`, `diagnostics`).

Для нового tool добавь файл в подходящую подпапку `extension/tools/` (`audits/`, `sync/` или `diagnostics/`) и зарегистрируй его в `extension/manifests/tools.json` через `file`, `version` и `group`. `version` и `group` внутри tool-файла не дублируются.

Рабочие группы: `audits`, `sync`, `diagnostics`.

## Locale

- [`categories-index.js`](./locale/chanel/categories-index.js) — первый этап pipeline CHANEL для Chrome Console на [странице бренда в RU](https://strapi.monamie.kz:1337/admin/content-manager/collection-types/api::brand.brand/yeag7mng9hfpk7pd4ggm7495?plugins%5Bi18n%5D%5Blocale%5D=ru). Только GET: проверяет бренд, читает все `categories` через paginated Content Manager relations API, сверяет количество, формирует `chanel-categories-ru.csv` и `chanel-categories-ru.json` (порядок, ID, название, ссылка). Без Save/Publish и изменений CMS. Запуск — открыть ссылку на JS в репозитории, скопировать содержимое в Console Strapi Admin. Список доступен также как `window.tmChanelCategoriesIndex`.
- [`category-first-audit.js`](./locale/chanel/category-first-audit.js) — второй этап CHANEL для Chrome Console на RU-странице бренда. GET-only аудит **первой категории** из relation `categories`: четыре снимка RU/KK Draft/Published (при отсутствии KK — `null`), все schema-поля и root relations, вложенные relations компонентов с предупреждениями о неполной проверке Published. Выводит таблицы сравнений в Console, скачивает `chanel-category-first-audit.json`, никакого Save/Publish. Разные `RU/KK.key` помечаются `unsafe_shared_key_review` из-за подтверждённых рисков Strapi i18n. До write-pipeline использовать этот JSON для проверки реальной схемы, данных и зависимостей.
- [`categories-audit-all.js`](./locale/chanel/categories-audit-all.js) — третий этап CHANEL: **GET-only** аудит всех 65 Category из live relation бренда (при изменении count остановится до получения нового index). Считывает полные RU/KK Draft и Published с полями, media, компонентами, root/nested relations по schema; сохраняет снимки в `chanel-categories-audit-all.json`, сводную таблицу в `chanel-categories-audit-all.csv`. В Console — прогресс по каждой Category и общий итог; ошибки отдельной Category фиксируются и не блокируют остальные (401/403 прерывает прогон). Политика аудита: numeric component IDs не считаются бизнес-различиями, существующие KK media, включая вложенные изображения в `dynamic`, сохраняются; `key` при RU/KK mismatch требует ручного review. Только чтение — вывод диагностический, без нормализации и Publish.
- [`normalization-contract.md`](./locale/chanel/normalization-contract.md) — согласованные правила будущей синхронизации CHANEL RU → KK, включая глубокую защиту существующих KK Media и **обязательную публикацию обеих локалей после нормализации** ради однородного клиентского контента. Предусмотрены snapshots, безопасный поэтапный write/publish и проверка Published RU/KK, также приведён full read-only аудит 65 категорий. Это спецификация, а не готовый write-инструмент.
- [`localizer.js`](./locale/category/localizer.js) — браузерный Category RU → KK Localizer для Strapi Admin → Content Manager (Console/Snippets). По умолчанию **dry-run: только GET**. Перед вставкой кода можно один раз задать `window.tmCategoryLocalizerOnlyOnce = 'DOCUMENT_ID'` (одна категория) или `window.tmCategoryLocalizerLimitOnce = 10` (первые десять). **Запись требует** `window.tmCategoryLocalizerApplyOnce = true` и ровно одного явного scope: `OnlyOnce`, `LimitOnce` (целое число > 0) **или** `window.tmCategoryLocalizerFullOnce = true` (все записи). Без scope полный apply запрещён; флаги очищаются после чтения. Apply получает только RU-список documentId, затем строго по одной Category читает, планирует и применяет изменения. Для relations использует `populate` группами с проверкой полноты по `count`, при неполноте — точный native GET; до 12 GET параллельно, PUT/POST не выполняются параллельно. Все root relations зеркалируются RU → KK по documentId; недоступные KK targets откладываются в `pendingLinks`, остальные доступные изменения сохраняются и публикуются. `brandZoneBanners[].products` сверяется точно в Draft, Published для этого поля проверяется **только по count**, не по составу. Существующие KK переводы и Media сохраняются. **Дополнительный live-инцидент 2026-11-18:** после подтверждённого KK Save Category «Солнечная линия» one-hop `Product` KK Publish создал Published без одной связи `attributes` (у KK Draft один Attribute, у Published ноль); RU и KK Draft/Media/остальные связи сохранились, категория не публиковалась. **Product auto-Publish временно приостановлен** для ещё не опубликованных продуктов: Category сохраняет verified KK Draft и откладывает свою публикацию при невыполненных Product dependencies; дефектные `tlsueik73oho5duwf0ylttsh` (Category) и `a6sxq2s8iiv9xkl9m8b0y6f1` (Product) не перезаписываются и не перепубликуются автоматически. Отчёт `skipped_dependency`, `partial/saved-waiting-dependencies`, `pausedProductAutoPublish`; при новых повреждениях действует глобальный HALT. **Не считать факт наличия Published продукта гарантией всех связей**, исходный Product журнал `pending-publish-kk` требует адресного разбирательства. Повторный Apply сначала только `LimitOnce=10`, затем сверить JSON. **Актуальный безопасный обход (2026-11-18):** поле `Category.key` исключено из RU→KK нормализации (не добавляется в Save/Seed payload), но остаётся во всех snapshot/postflight проверках и передаётся без преобразования в стандартном Publish payload из текущего KK Draft. **Категории с разными `RU Draft.key` и `KK Draft.key` пропускаются полностью до PUT/POST** (`status=skipped_key`), потому что Strapi может стереть RU key даже при отсутствии key в payload. Известная повреждённая Category `s4weogfjta7eknnbe7ptjt0f` внесена в карантин и пропускается **до** reconcile с сохранением IndexedDB. Другие Category продолжают обрабатываться; новые непредвиденные изменения RU/KK после записи всё ещё останавливают все операции. Итог `completed_with_key_skips` не равен `successful=true`; в JSON `skippedKey` и `ignoredFields`. Исторически 247/899 Category имели Draft-key mismatch (диагностический снимок 2026-11-17), но live нужно перечитать заново. Сначала повторять только `LimitOnce=10`, сверить JSON; `FullOnce` пока не запускать. При наличии нужной KK Draft однократно публикует ещё не опубликованные подключаемые Product/Attribute/Brand (без рекурсии). Перед **каждым** PUT/POST повторно читает и сверяет полные RU/KK Draft/Published (включая schema-поля, Media, компоненты и root relations), сохраняет snapshot и ожидаемые изменения в IndexedDB; после записи сравнивает бизнес-данные и связи с исходным снимком, разрешая только запланированную разницу. При изменении RU, несоответствии KK, неопределённом POST/PUT, проблеме JWT или IndexedDB — **остановка всех новых записей**, карантин незавершённой операции, без автоматического rollback или повтора записи. Итог CSV/JSON выгружается автоматически, журнал сохраняется в IndexedDB `tm-category-localizer-v1`. Для **экспорта backup после закрытия/сбоя вкладки без API-запросов и изменений CMS** задать `window.tmCategoryLocalizerExportBackupsOnce = true` и запустить тот же код. Для расследования повреждённой Category добавить **только** `window.tmCategoryLocalizerRecoveryPreviewOnce = 'DOCUMENT_ID'` и запустить тот же код: восстановительный preview читает сохранённый `pending-save` и `before/after` из IndexedDB, живую schema и все RU/KK Draft/Published, сравнивает business fields/relations и выдаёт `category-localizer-recovery-preview.json`. **Recovery Preview = GET-only, PUT/POST/Publish запрещены.** **Recovery Apply — только одна Category, не массовый запуск:** задать `window.tmCategoryLocalizerRecoveryApplyOnce = 'DOCUMENT_ID'` и `window.tmCategoryLocalizerRecoveryKeyConfirmOnce = 'ORIGINAL_16_CHAR_KEY'` без других флагов. Новое согласованное Category-правило: RU.key — источник, KK.key должен ему соответствовать и в Draft, и в Published. Проверка исходного `pending-save` и before/after из IndexedDB, всех 4 live версий/schema, уникальности ключа по RU/KK Draft+Published (положительный и отрицательный контроль), и полного снимка перед каждой записью. **Save через RU, а не KK:** в реальном аварийном batch KK Save уже планировал RU.key, но после него RU/KK Draft.key остались `null`; общие поля Strapi следует редактировать через default locale RU. Ровно один `PUT ?locale=ru` с `{locale:'ru',key:ORIGINAL}`, затем GET всех 4 версий: для продолжения оба Draft.key обязаны принять RU key, остальные данные обеих локалей/Published должны оставаться прежними. Только после подтверждения — **один POST Publish KK** (RU не публиковать); KK Published.key становится RU key, также публикуется ранее запланированный `KK.slug`; остальные KK переводы/Media/root и nested relations должны сохраниться. До/после каждого PUT/POST — IndexedDB checkpoint + строгая сверка, при сбое глобальная остановка и без автоматического rollback. Pending стадии можно только GET-подтвердить, **не повторять PUT/POST слепо**. Recovery был **проверен live 2026-11-18 и не восстановил ключ**: 33 GET / 1 RU PUT / 0 POST, оба Draft.key остались null, остальные business fields и relations не изменились. Не повторять RecoveryApply на этой Category. Вместо него обычный Apply теперь может **пропускать** несовместимые по key документы и продолжать другие; ограниченный batch разрешён только с новой версией и проверкой JSON. Исходный `category-localizer-recovery-preview.json` сохранить отдельно, поскольку IndexedDB не заменяет резервную копию БД; общие поля Strapi 5 могут синхронизироваться между локалями. Никакой автоматической публикации при восстановлении. `successful=true` означает завершённый проход без ошибок, блокировок и незавершённых связей. **Live incident 2026-11-17:** первый batch `LimitOnce=10` остановился на Category `lgagdyk0soxtjl896zp1o646` (Парфюмерия) после одного KK Save и RU Publish (67 GET / 1 PUT / 1 POST). Снимки подтвердили неизменность RU/KK текстов/Media/root fields и запланированный KK `top_brands` 2→1; исторический `key` в Draft `null`, в Published `72c6b18076a5df5c`. Strapi сохранил опубликованный key после RU Publish, прежний compare ошибочно счёл публикацию `unresolved`. **Исправлено:** RU вообще не публикуется нормализатором, KK может публиковаться при сохранённом исходном Published `key`; любое исчезновение/изменение значения, Media или links по-прежнему даёт глобальную остановку. `pending-publish-ru` проверяется GET + новым `publishedAt` и согласованностью всех бизнес-полей, без повторного POST; восстановление фиксируется в `journal.recoveries`. **Адресный recovery «Парфюмерии» успешно подтверждён live 2026-11-18 (47 GET, 0 PUT, 1 POST, RU+KK сохранены), но следующий batch остановился с реальной потерей `RU Draft.key` у «Подарочные сертификаты».** Инцидент `s4weogfjta7eknnbe7ptjt0f`: RU Draft.key `10ff20c63ebbec1e → null` после KK PUT; RU Published.key сохранился, все остальные business fields и relations RU/KK остались прежними; журнал `pending-save` с before/after. Текущий guard пропускает любую Category с несовпадающими Draft.key без записи; повреждённый документ отдельно помещён в карантин. **Ограниченный batch теперь возможен со skip-режимом**, однако ни восстановление key, ни полный проход не подтверждены live; после первых 10 обязательно сверить сохранность всех бизнес-данных. Независимый backup БД остаётся необходимым перед масштабным production. Исторический diagnostic JSON показывает 247 потенциальных key-mismatch Category. **Live seed-пилот 2026-11-17 подтверждён:** Category `mkd10pnuq8uucs6y41nae3z9`: создан KK Draft, добавлена 1 KK `brand`, опубликована KK, 66 GET / 2 PUT / 1 POST, 0 ошибок, полные RU поля и связи сохранились (snapshot до/после каждого этапа). Массовый полный apply запускать только после контролируемого batch-прохода и live-проверок частичного применения и публикации зависимости; перед массовыми изменениями желателен независимый snapshot БД (Strapi может иметь баги записи, script только обнаруживает их после запроса).
- [`localizer.mjs`](./locale/product/localizer.mjs) — Node.js 20+ нормализатор всех Product RU → KK. Синхронизирует root relations, boolean кроме `InStock`, media и `name`; сохраняет KK переводы и уникальный `KK.key`. Missing KK Product создаёт без переводов при наличии `STRAPI_API_TOKEN`, недостающие KK справочники пропускает в CSV, KK Draft справочников публикует при необходимости. Постоянный worker pool с ограничением запросов, checkpoint и индивидуальный backup перед изменениями. **Сохранять скрипт в папке `Product-Localizer` на рабочем столе:** все CSV, журнал и summary создаются рядом с `localizer.mjs`, backups — в соседней папке `product-kk-backups`. JWT автоматически извлекается из TXT-файлов на рабочем столе или рядом со скриптом (например, `jwttoken.txt` или `jwt.txt`), включая Desktop, перенаправленный в OneDrive. Поддерживаются UTF-8, UTF-16 с BOM, значение в кавычках и префикс `Bearer`. `STRAPI_JWT`, если задан, имеет приоритет. Ручного ввода нет; если JWT отсутствует или найдены разные токены, скрипт останавливается до запросов и изменений. Значение JWT не выводится. Режимы: `node localizer.mjs --dry-run --limit=10` (без записи), `node localizer.mjs --only=DOCUMENT_ID` (один товар), `node localizer.mjs --apply --only=DOCUMENT_ID` (пилот записи), `node localizer.mjs --apply` (весь каталог); `--new-run` архивирует результаты предыдущего прохода. Прогресс каждого товара: номер/общее, status, скорость, ETA. Relations читаются компактным `populate` (группами до 19 полей) с проверкой полноты по `detail.count`; для неполных, неверных или недоступных ответов автоматически используется точный native relations GET. Перед **записью** изменённых relations native GET повторно подтверждает documentId и numeric ID для connect/disconnect. `node localizer.mjs --probe=DOCUMENT_ID` — read-only диагностика конкретной записи (`product-kk-relation-probe.json`). **Live подтверждено 2026-11-16:** apply первых 100 Product (95 успешных/соответствующих, 5 ожидаемых блокировок) и независимый dry-run после записи (95 `already_ok`, 0 ошибок). Для первого массового production-прохода использовать `--apply --existing-only --workers=8 --requests=24`: только KK Product с существующим Draft **и Published** и опубликованными KK справочниками; создание отсутствующей KK и публикация KK справочников не разрешаются, все пропуски пишутся в CSV. При HTTP 401/403 — аварийная остановка с сохранением checkpoint; `Ctrl+C` мягко завершает текущие Product. **Скрипт скачивать в `Desktop/Product-Localizer` и сохранять полный checkpoint/backup до итоговой проверки; не закрывать PowerShell во время операции.** Восстановление без `--new-run`, с прежними флагами и обновлённым JWT. После массовой записи сделать независимый полный dry-run и отдельно разбирать заблокированные Product, создание KK и публикацию словарей.


### Длительный проход Product с изоляцией ошибок

`node localizer.mjs --apply --existing-only --continue-on-error --workers=8 --requests=24` продолжает прежний apply-checkpoint без `--new-run`. Уже учтённые записи (включая ошибки и блокировки) не запускаются повторно; существующий backup, даже пустой, запрещает новую запись соответствующего Product. Этот режим явно разрешает продолжать остальные Product при локальном несовпадении RU после Save/Publish: проблемная запись остаётся в `error_pending_backup`, исходный backup сохраняется, результат чтения после ошибки добавляется в `failure.after`. Это не исправляет проблемный Product и не подтверждает отсутствие системной причины расхождений; такие записи требуют отдельной сверки.

Сравнение связей версий использует `documentId` и `locale`, а не изменяемые numeric ID. Временные сетевые ошибки GET и HTTP 408/429/500/502/503/504 после обычных попыток переводят чтение в паузу 30 секунд с последующим повтором. PUT/POST автоматически не повторяются. При HTTP 401/403 Admin API процесс ждёт новый JWT в TXT, проверяя файл каждые 30 секунд; сам обновлять срок JWT он не умеет. Новый JWT позволяет продолжить GET; отклонённая запись остаётся для проверки backup. `Ctrl+C` прерывает ожидание. Ошибки сохранения backup/checkpoint остаются причиной остановки.

`completed` означает окончание обхода; новый `successful` означает окончание без ошибок и незавершённых backup (обычные блокировки считаются отдельно). При ошибках или оставшихся backup код завершения 2, при аварии 1. Не удалять прежние журналы и backup ради продолжения. Для ночного запуска компьютер должен оставаться включённым, без сна, с доступом к Strapi.



### Рабочая папка Product Localizer

Все файлы инструмента храните в `Desktop/Product-Localizer/`. Скрипт использует свою папку независимо от текущего каталога PowerShell. TXT с JWT можно оставить на Desktop: автоматический поиск продолжает работать.

Новые recovery-результаты: одна папка на запуск внутри `runs/`; для передачи диагностики архивируйте целиком нужную папку запуска, включая `evidence/`. Исходные apply-checkpoint и `product-kk-backups/` не удалять. Запуск восстановления: `node "ПОЛНЫЙ_ПУТЬ_DESKTOP/Product-Localizer/localizer.mjs" --recover-pending --dry-run`.

### Повторная обработка незавершённых Product

`node localizer.mjs --recover-pending --dry-run` читает только JSON из `product-kk-backups`, сверяет RU/KK Draft/Published и исходный план. Исходный `product-kk-apply-schema.sha256` обязателен и должен совпадать с текущей схемой. Сохраните также `product-kk-apply-progress.jsonl`: он содержит причины прежних ошибок. JWT читается из TXT обычным способом. Старые apply/audit отчёты и checkpoint не изменяются; каждый recovery создаёт отдельную папку `runs/<дата-время>-recovery-<audit|apply>-<pid>/` с `report.csv`, `progress.jsonl`, `summary.json`, `schema.sha256` и папкой `evidence` с исходным backup, актуальными версиями и диагностикой.

Решения: `complete` — результат уже достигнут; `save` — исходный KK Draft не изменился, можно заново построить сохранение по свежим native ID; `publish` — Draft уже соответствует прежней цели, нужен только Publish. Расхождение RU, неожиданные изменения Published/переводов/ключа, частичный результат и конфликт уникальности `key` блокируют запись. Numeric relation IDs и timestamps сами по себе не считаются изменением контента. Поля `InStock` по-прежнему исключены из нормализации. Recovery не переименовывает ключи, не делает rollback и не создаёт KK или справочники.

После read-only сверки пилот: `node localizer.mjs --recover-pending --apply --only=DOCUMENT_ID` для конкретного `would_update` из recovery CSV. Затем `node localizer.mjs --recover-pending --apply --continue-on-error --requests=8`. Каждый товар повторно проверяется перед записью; обработка recovery последовательная, `--workers` её не распараллеливает. PUT/POST выполняются максимум по одному на фазу за этот проход, без автоматического повтора HTTP 500. После подтверждения всех четырёх версий исходный backup переносится в `product-kk-recovered/<run>/`; при ошибке остаётся pending. Полный ответ HTTP (до 16 KB, без заголовков авторизации) сохраняется в evidence; в обычном apply — в `failure.http` backup.

Каждый следующий recovery заново сверяет оставшиеся pending, даже если их ID есть в прежнем apply-checkpoint. Нельзя сочетать с `--new-run` или `--probe`. Recovery использует тот же process lock, что обычный apply. Не удалять backup или checkpoint для повтора. Код 2 означает оставшиеся ошибки/блокировки/pending; 1 — аварийную остановку. В dry-run pending остаются намеренно; `successful` относится к выполнению сверки, а не к завершённому восстановлению.


## Migrator

Pipeline разделены по типу записей и не используют общие конфиги. `products/` содержит существующий pipeline для товаров; все его CSV, media checkpoint, journal и отчёты теперь используют префикс `products-` вместо `migration-`. При переходе не смешивать новые файлы со старыми checkpoint. `attributes/` предназначен для торговых предложений (`api::attribute.attribute`, Bitrix `IBLOCK_ID=2`). Новые данные shade/volume включены в Config существующего `attributes/`, отдельного pipeline нет.

### Attributes — `migrator/attributes/`

1. **Config** — [`config.js`](./migrator/attributes/config.js) запускается в Console Strapi Admin. Только GET: все Attribute локали `ru` (включая draft, неактивные и пустой barcode), без Product. Результат `attributes-config.csv` (10 колонок): `documentId;barcode;active;hasDetailPicture;shade;shadeDocumentId;volume;volumeDocumentId;shadeHex;volumeValue`. Предыдущие 8 полей сохранены; `shadeHex` читает `shade.hexes[].hex` (если цветов несколько — значения объединены через `|` в порядке массива), `volumeValue` читает числовое/текстовое `volume.value` без единиц измерения и без преобразования в name. Пустой relation даёт пустые поля; связанный shade с пустым `hexes` или volume с `value:null` сохраняет `documentId`, но соответствующий `shadeHex`/`volumeValue` пуст. Сначала читает все предложения с точным populate `detail_picture.id`, `shade.name`, `volume.name` и native fallback для relations. Дополнительно **постранично загружает справочники** `api::shade.shade` (`populate[hexes][fields][0]=hex`) и `api::volume.volume` (`fields[0]=value`) и сопоставляет по `documentId`, а отдельный GET target detail использует только если поле отсутствует в list API. Изображения, `active`, баркоды не меняет; GET с ограниченной параллельностью, прогресс/счётчики и без частичного CSV при ошибке. Счётчики `shadeHexVolumeValue.missingValues` и `missingValueSamples` показывают существующие связи без заполненного HEX/value. Если target detail отвечает 404, Config сохраняет ID связи и пустое HEX/value, отражая проблему в `shadeHexVolumeValue.inaccessibleTargets` и `inaccessibleSamples`; иные ошибки API не маскируются. Мягкая остановка: `window.attributesConfigStop = true`. **Текущий Matcher принимает этот 10-колоночный Config и выдаёт 11-колоночный matched для текущего Importer.**
2. **Matcher** — [`matcher.js`](./migrator/attributes/matcher.js) запускается в Console Bitrix Admin с 10-колоночным `attributes-config.csv`. Последовательно читает весь grid `IBLOCK_ID=2` по ID ASC, только GET, без открытия карточек; обязательные колонки `PROPERTY_19` (штрихкод), `ACTIVE`, `DETAIL_PICTURE`, `PROPERTY_202` (объём), `PROPERTY_271` (текст-подсказка) и ID. Сверяет предложения по точному уникальному barcode, сохраняет ранее проверенные механизмы active/Media и checkpoint `v6-volume-review`. **Volume** в Bitrix отображается как `100 [62913]`; число извлекается из текста ячейки, а ID проверяется по ссылке на справочник `IBLOCK_ID=12`. Числовое значение сравнивается с `volumeValue` Strapi: совпало — ничего не менять независимо от `name`; отличается — добавить/заменить; действительно пустое в Bitrix — удалить существующую relation. **Нестандартное значение** (`2х5 [107307]`, `2x5` и др.) не преобразуется в число и не считается пустым: идёт в `attributes-volume-review.csv` для ручной проверки, автоматическая запись Volume запрещена, но active/Media для того же предложения продолжают обрабатываться независимо. В `attributes-matched.csv` (11 колонок) добавлен явный `bitrixVolumeStatus=known|empty|manual`, чтобы Importer различал подтверждённый пустой Volume и неизвестный формат. **Shade**: только заполненное `PROPERTY_271` при отсутствии `shadeDocumentId` в Strapi → `attributes-shade-review.csv`; если Shade уже есть — не проверять и не менять. Одна запись может присутствовать и в matched, и в ручной очереди. Выгрузки: `attributes-matched.csv` (`documentId;barcode;active;hasDetailPicture;bitrixId;bitrixActive;pictureUrl;volumeDocumentId;volumeValue;bitrixVolumeValue;bitrixVolumeStatus`), `attributes-shade-review.csv`, `attributes-volume-review.csv` (`documentId;barcode;bitrixId;bitrixVolumeRaw;bitrixVolumeRefId;strapiVolumeDocumentId;strapiVolumeValue;bitrixCardUrl`) и `attributes-unmatched.csv` (если есть исключения barcode). При неоднозначных ID/ссылках, ошибках пагинации или сортировки — STOP без итоговых файлов; нестандартный **подтверждённый** Volume не останавливает обход. `window.bitrixAttributesMatchStop = true` — мягкая остановка и повторный запуск. Большой checkpoint `v6-volume-review` сохраняется **в IndexedDB**, без лимита `localStorage`; уже сохранённый старый checkpoint из `localStorage` автоматически проверяется и переносится в IndexedDB без потери успешно обработанных страниц. Запуск с тем же исходным CSV продолжит обход с последней сохранённой страницы. Версия в Console: `v5.3-indexeddb-checkpoint`. Новый `attributes-matched.csv` (11 колонок) поддерживается текущим Importer.
3. **Importer** — [`importer.mjs`](./migrator/attributes/importer.mjs) (Node.js 20+, без npm) читает **только 11-колоночный** `attributes-matched.csv`: `documentId;barcode;active;hasDetailPicture;bitrixId;bitrixActive;pictureUrl;volumeDocumentId;volumeValue;bitrixVolumeValue;bitrixVolumeStatus`. Перед записью сверяет live Attribute по `documentId` + точному `barcode` и его to-one relation Volume через подтверждённый Content Manager GET `/content-manager/relations/api::attribute.attribute/<documentId>/volume?locale=ru&pageSize=5&page=1`. Справочник `api::volume.volume` читает один раз постранично; выбранный target перед первым подключением дополнительно проверяет через подтверждённый GET его карточки (для корректного числового `id` версии документа); для **добавления или замены** нужна запись с числовым `value=bitrixVolumeValue` и `name`, равным самому числу (допускается десятичная запятая вместо точки, но не `МЛ`, `ГР` или иной суффикс). Если совпадений **несколько**, выбрать первую по `id:ASC` (минимальный `id` из списка), проверить карточку выбранного target и назначить relation; выбор фиксируется в `attributes-import-report.csv` и отдельном `attributes-import-volume-duplicates.csv` для последующей ручной нормализации. Если совпадений **нет** → пропуск Volume и `attributes-import-volume-review.csv`, без создания справочника; остальные `active`/Media могут обновляться независимо. Если текущий Volume имеет совпадающий **value**, его relation сохраняется даже при нормализованном `name`. `bitrixVolumeStatus=known` → добавить/заменить, `empty` → удалить текущую relation, `manual` → никогда не изменять Volume. Shade не изменяет.

**Network-подтверждение 2026-11-09:** реальная замена Volume прошла HTTP 200 через `POST /content-manager/collection-types/api::attribute.attribute/<documentId>/actions/publish?locale=ru` с полным телом Attribute и `volume: {connect:[{id,documentId,isTemporary:true}],disconnect:[{id,documentId}]}`. Для Volume Importer отправляет только подтверждённый Publish payload; PUT выполняется отдельно **только для active/detail_picture**, если требуется, и после него проверяется, что Volume не изменился. Другие relations передаются с пустыми `connect/disconnect`, как в записанном Network-запросе. Изображение загружается из публичного оригинала Bitrix, без Cookie. После любой операции — GET/verify сохранённой и опубликованной ru-версии и целевого Volume documentId. Если запись могла выполниться, но результат не подтверждён, **весь импорт останавливается**; журнал защищает от повторных неопределённых записей. Не считать статус `modified` или существующий draft признаком чужих изменений. Мягкая остановка `Ctrl+C` после текущей записи; последовательная обработка с паузой по умолчанию 150 мс. Версия Console: `v2.1-volume-first-duplicate`.

**Запуск на Windows:** скопируй свежий `importer.mjs` на Desktop как `importer.mjs` и `attributes-matched.csv` из Matcher; в локальном файле укажи `AUTH.jwtToken`, не коммить токен. PowerShell: `node --use-system-ca "$env:USERPROFILE\Desktop\importer.mjs" --apply --only=DOCUMENT_ID` — **реальный пилот одной записи, без dry-run**; затем `--apply --limit=20` — следующая пачка, `--apply` — весь оставшийся CSV. Параметры `--limit`, `--only`, `--pause-ms`, `--retry-errors`; без `--apply` доступен dry-run, но он не обязателен. `--probe-media --only=DOCUMENT_ID` проверяет публичное изображение без записи. На Desktop создаются `attributes-import-report.csv`, `attributes-import-volume-review.csv` (отсутствующий Volume), `attributes-import-volume-duplicates.csv` (выбранные при дублях relation) и `attributes-import-journal-<hash>.jsonl`. Файл с тем же хешем безопасно продолжает прежний журнал, обработанные и требующие ручной проверки записи повторно не записываются. **Перед тысячами операций обязательно проверить одну фактическую запись после пилота в Strapi**, особенно удаление Volume. Предыдущая версия `v2-volume-publish` уже прошла массовый запуск; для текущей `v2.1-volume-first-duplicate` реальный прогон новой логики выбора дубликатов пока не подтверждён. CSV не пересохранять через Excel, чтобы не испортить ведущие нули barcode.


### Products — `migrator/products/`

1. **Config** — [`config.js`](./migrator/products/config.js) запускается в Console Strapi Admin. Read-only экспорт всех Product `ru`, независимо от `newFrom1C` и `active`. Итог `products-config.csv` (12 колонок): `documentId;name;name1;name2;detail_picture;preview_picture;pictures;active;newFrom1C;attributes;categories;detail_text`. Флаги Media и `detail_text` показывают заполненность; `attributes` — штрихкоды через `|`, `categories` — `bitrix_id` только категорий `custom=false` через `|`. CSV не открывать/пересохранять в Excel, чтобы не повредить штрихкоды и названия.
2. **Matcher** — [`matcher.js`](./migrator/products/matcher.js) запускается в Console Bitrix Admin и читает исходный `products-config.csv`. Находит **одно строгое** совпадение названия (`NAME === name`, с учётом регистра и пробелов) и подтверждает хотя бы один общий штрихкод. Читает из карточки Bitrix `name1`, `name2`, `detail_text`, `ACTIVE`, `SECTION_ID`; оригинальные публичные URL `preview_picture`, `detail_picture` получает **только если соответствующее Media в Strapi пусто**, а `pictures` проверяет только при пустой галерее Strapi (тогда передаёт все доступные оригиналы в исходном порядке). Сравнивает **заполненность**, не текстовые значения; уже заполненные поля Strapi не перезаписываются. Matcher отбирает различия контента, галереи, категории и `active`, а также все записи с `newFrom1C=true/null` без расчёта целевого значения флага: **только Importer** после сохранения определяет `newFrom1C` по пяти обязательным полям и хотя бы одной категории. Итоговый `products-matched.csv` содержит 12 исходных колонок плюс 10 полей Bitrix: `bitrixId;matchedBarcode;bitrixActive;bitrixSectionId;bitrixName1;bitrixName2;bitrixDetailText;bitrixPreviewPictureUrl;bitrixDetailPictureUrl;bitrixPicturesJson`. Попадают товары с необходимыми изменениями либо с `newFrom1C=true/null` для итоговой проверки Importer. Диагностика — `products-unmatched.csv`; если у **необходимого для переноса** Media нет достоверного оригинального URL, либо нельзя определить `SECTION_ID`, товар целиком исключается. Заполненное Media Strapi не блокирует импорт при проблемном URL Bitrix. Сначала **одним проходом** обходит страницы каталога Bitrix (`IBLOCK_ID=1`, `GET`, `by=id&order=asc`) и составляет индекс по исходным названиям, как в `attributes/matcher.js`; проверяет total, количество строк, сортировку и уникальность ID. Это заменяет нестабильный `main.ui.filter`, который при отсутствующем товаре возвращал весь каталог. Из индекса берутся только строго равные `NAME` (без изменения регистра/пробелов); затем один точный кандидат подтверждается общим штрихкодом из карточки. Отсутствующие в Bitrix товары попадают в `products-unmatched.csv` со статусом `NAME_NOT_FOUND`. Одновременное чтение карточек ограничено тремя запросами. Checkpoint `v5-media-flag` хранится в IndexedDB по хешу CSV; **старые `v3-content` и `v4-catalog-index` не переиспользуются**, поэтому первый запуск обновлённого Matcher пересопоставляет товары заново. Сканирование Bitrix-каталога повторяется при каждом запуске, checkpoint сохраняет результаты проверки товаров, но не индекс каталога. **Частичных CSV нет** — файлы скачиваются только после полного успешного прогона.
3. **Importer** — [`importer.mjs`](./migrator/products/importer.mjs) — Node.js 20+ **без npm-зависимостей**. Читает только `products-matched.csv`, **не запрашивает Bitrix Admin и не требует Bitrix Cookie**; медиа скачивает по публичным URL оригиналов из CSV и загружает через Strapi `/upload`. Укажи `AUTH.strapiJwt` в локальной копии файла. Перед изменением проверяет текущее состояние товара и нужную категорию Strapi по `bitrix_id=bitrixSectionId`. Если категории нет, товар целиком пропускается до любых записей и включается в `products-category-not-found.csv`. Existing relations сохраняются, добавляются только недостающие; заполненные контентные поля не меняются. `active` приводится к Bitrix; `newFrom1C` выставляется по результату проверки пяти обязательных полей и категории (галерея может быть пустой в обеих CMS). После Save/Verify выполняется Publish ru/Verify; при неизвестном исходе записи требуется ручная проверка.

**Запуск Products Importer из PowerShell:** помести `importer.mjs` и `products-matched.csv` на рабочий стол; `node --use-system-ca "$env:USERPROFILE\Desktop\importer.mjs"` — dry-run всех кандидатов с `products-import-plan.csv`; добавь `--apply` только после пилотной проверки для записи в Strapi. Обработка последовательная без обязательной паузы (по умолчанию `--pause-ms=0`); при необходимости можно задать `--pause-ms=N` до 60000 мс. `--confirm=<BitrixID>` разрешён только для входного CSV с одной записью. Результаты: `products-import-report.csv`, при отсутствии категорий — `products-category-not-found.csv`, журнал `products-import-journal-<hash>.jsonl`, Media checkpoint `products-media-checkpoint.json`. Для повтора используй тот же CSV: завершённые записи пропускаются, `--retry-errors` позволяет повторить ошибки чтения, `--retry-partial` — неполные карточки; статусы `review` не повторяются без ручной проверки.



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
│   ├── extension.js
│   ├── manifests/
│   │   ├── extensions.json
│   │   ├── features.json
│   │   ├── ui-ux.json
│   │   └── tools.json
│   ├── features/
│   │   ├── alt-enter-publisher.js
│   │   └── tools-launcher.js
│   ├── ui-ux/
│   │   ├── entry-relocate.js
│   │   ├── product-attributes-navigator.js
│   │   ├── product-sections.js
│   │   ├── record-list.js
│   │   └── sidebar.js
│   └── tools/
│       ├── audits/
│       │   ├── attributes-wrong-prices.js
│       │   ├── catalog-tree-products.js
│       │   ├── lux-normalizer.js
│       │   ├── products-attributes-locale-audit.js
│       │   ├── products-missing-content.js
│       │   └── products-wrong-variants.js
│       ├── sync/
│       │   ├── layout-sync.js
│       │   ├── products-category-forward-sync.js
│       │   └── products-category-mirror-sync.js
│       └── diagnostics/
│           ├── dom-stealer.js
│           ├── network-recorder.js
│           └── style-stealer.js
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
├── locale/
│   ├── category/
│   │   └── localizer.js
│   ├── chanel/
│   │   ├── categories-index.js
│   │   ├── category-first-audit.js
│   │   ├── categories-audit-all.js
│   │   └── normalization-contract.md
│   └── product/
│       └── localizer.mjs
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
