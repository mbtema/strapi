# Project context

Подтверждённые архитектурные решения, рабочие API-контракты и долговременные знания проекта `mbtema/strapi`. Актуальные файлы, версии, состояние CMS и pending всегда проверять по live источникам. Подробные истории прежних пилотов и удалённых скриптов доступны через Git History.

Локали: `ru`, `kk`.

## Статусы знаний

- **CANONICAL** — рабочий проверенный контракт, предпочтительный путь.
- **EXPERIMENT** — исследование, не доказательство готовности к production.
- **HISTORICAL** — завершённый факт, не описание текущего состояния.

---

# 1. Stable project model

Strapi — CMS для мобильного приложения MonAmie и связанных e-commerce/content процессов. Рабочая экосистема: Strapi Content Manager/Public REST/Internal API, Flutter/mobile, Bitrix, BFF, DevTools/browser JS, Tampermonkey, GitHub, Node.js/PowerShell, Notion, n8n/Make, CSV.

Базовая диагностическая модель:

```text
Strapi data → API response → Flutter/mobile
```

Если Strapi data и API response корректны, следующая зона проверки — клиент. Не менять CMS только для компенсации клиентского бага.

Основной идентификатор Strapi — `documentId`. `barcode` — важный SKU/cross-system ключ, особенно Bitrix ↔ Strapi, но внутри Strapi приоритет у `documentId`.

Рабочая source-of-truth локаль для текущих CMS operations/audits — `ru`. `kk` поддерживается отдельно через зеркалирование/локализационный процесс; если задача явно не про `kk`, audit/edit/check начинать с `ru`.

Частые поля/relations:

```text
id, documentId, barcode, active, isInStock, locale
product/products, attributes/offers, brand, category, categories
volume, shade, price
detail_picture, preview_picture
name, name_web, title, slug, shareUrl
bitrix_id, xml_id, code_1c
```

У product одновременно существуют relations `category` и `categories`. Для catalog healthcheck и фактического каталога рабочим relation подтверждён `categories`; полную семантическую разницу при новой задаче сверять с актуальным API/client.

Ограничения рабочей Strapi Admin среды:
- нет свободного изменения collection schemas;
- нет свободного управления Public API roles/permissions;
- `/api/auth/local` исторически мог возвращать `400`;
- практические обходные пути: текущая admin-session, Network, internal API, browser scripts.

Рабочая Strapi-среда фактически single-user: существующий `modified`/draft сам по себе не свидетельствует о чужих изменениях. Operational behavior для Save/Publish задаётся Instructions.

---

---

# 2. Architectural decisions

## CANONICAL — repo как набор независимых сервисов

Ментальная модель repo: отдельный folder/script — маленький функциональный сервис. Ошибка в одном extension/tool обычно влияет только на него и его output. Не считать локальную проблему архитектурной без фактической общей зависимости.

Общая инфраструктура extensions:
- единый Tampermonkey loader;
- централизованные registries в `extension/manifests/`;
- shared cache/update mechanism.

Весь Strapi Admin runtime хранится в `extension/`: `extension.js`, `manifests/`, `features/`, `ui-ux/`, `tools/`. Пути manifest entries (`path` и `file`) относительны к `extension/` и `extension/tools/` соответственно. `migrator/` остаётся в корне как отдельные pipelines `products/` и `attributes/` для Bitrix ↔ Strapi.

Registry разделён по зонам ответственности, а не объединён в один огромный файл:
- `extension/manifests/extensions.json` — root registry extension manifests;
- `extension/manifests/features.json` — registry feature extensions;
- `extension/manifests/ui-ux.json` — registry UI/UX extensions;
- `extension/manifests/tools.json` — registry browser tools.

Сами сервисы остаются в своих папках. Версии в manifests нужны для постоянно загружаемых features/ui-ux; tools регистрируются без версии.

Loader использует cached extensions для быстрого старта, затем сверяет registry с GitHub. Контракт loader (`extension/extension.js`):
- Manifest entry: `id`, `path`, `version` (semver), `enabled`. ID — относительный путь без первой папки runtime и расширения .js: `ui-ux/collection/attribute.js` → `collection/attribute`, `ui-ux/relation/attribute.js` → `relation/attribute`, `ui-ux/designSystem.js` → `designSystem`. ID и path уникальны во всех активных manifests; одноимённые файлы в разных подпапках допустимы. Сегменты ID/path — латиница, цифры, дефис; вложенность разделяется `/`; регистр ID должен совпадать с path.
- Registry и код читаются из одного commit snapshot main; signature включает `id,path,version,blobSha`. Loader проверяет Git blob SHA, сохраняет согласованный кеш schemaVersion 2; при ошибке сохраняет предыдущий кеш. Порядок запуска — порядок manifests и entries, designSystem первым в UI/UX manifest.
- Автоматическое обновление кеша применяется при следующем reload. `forceUpdate()` в Console принудительно скачивает и проверяет snapshot, сообщает о необходимости обновления userscript и перезагружает страницу при успехе. При смене контракта loader сначала обновить сам userscript через Tampermonkey. `checkUpdates()` больше не является действующим entrypoint.
- Диагностика загруженного snapshot: `document.documentElement.getAttribute('data-tm-extensions-commit')` и Console table с id/version/blobSha. При несовпадении сначала проверить loader/cache, не исправлять рабочий код на основании старого кеша.

## CANONICAL — структура UI/UX и дизайн-система

`extension/ui-ux/` разделён по назначению:
- `designSystem.js` в корне — общая визуальная основа всех UI/UX extensions, не отдельное улучшение.
- `collection/attribute.js`, `collection/product.js` — карточки конкретных collection types: вкладки, show/hide, смысловые группы полей.
- `relation/attribute.js`, `relation/shade.js` — оформление и UX relations к целевым сущностям. Имя файла соответствует target; фактический scope проверять в коде (`relation/attribute.js` пока реализован для Product.attributes; `relation/shade.js` не привязан к исходной коллекции или имени поля).
- `common/sidebar.js`, `common/recordList.js`, `common/entryLayout.js` — общая навигация, списки, компоновка карточек. `entryLayout.js` сохраняет нативное оформление, отвечает за расположение штатных элементов.

Источник визуальных стандартов — https://design-system.strapi.io/ и исходники https://github.com/strapi/design-system (themes, typography, компоненты). `designSystem.js` — слой совместимости с нативным Strapi, не самостоятельный дизайн: сверять палитру, размеры, типографику и состояния с официальными компонентами. Light/Dark палитры сверены с официальными light-colors/dark-colors; локальные HEX/RGB для оформления не дублировать в extensions. Цветовые данные сущностей (например HEX Shade) — не палитра интерфейса.

Контракт: глобальные CSS variables `--tm-ds-*`, тема `data-tm-ds-theme` на documentElement, локальные custom UI roots `data-tm-ds`, классы `tm-ds-*` (text/meta/link, input/button/icon-button, tablist/tab, heading/sigma, badge/status/page, nav-link, color-swatch). Новые повторяемые компоненты и общие стили добавлять в designSystem; в extensions оставлять DOM-селекторы, размеры конкретной компоновки, visibility, обработчики, данные и API. Нативные элементы сохраняют React handlers/state и стандартное оформление там, где не требуется изменение. Не применять blanket-стили ко всем потомкам нативных элементов: Strapi может задавать fill на внутренних SVG shapes; собственные контурные иконки должны иметь scoped fill:none/stroke:currentColor непосредственно на SVG-фигурах. Sidebar активное состояние — без отдельной боковой полосы, нейтральный фон и primary-текст по токенам.

Общий компонент цвета: `window.__tmStrapiDesignSystem.setColorSwatch(element, colors, before=false)` возвращает boolean, валидирует HEX, назначает общий CSS-класс и CSS-переменные размера/цвета; `before=true` — pseudo-element для нативной кнопки, обычный режим — свой элемент. Несколько HEX отображаются сегментами исходного порядка, пустые/невалидные — без образца. Повторный вызов идемпотентен, пустой массив очищает стили компонента. Размер задаётся в designSystem. Не показывать HEX текстом без отдельного требования.

Проверка UI после изменений: обновить extensions через `forceUpdate()`, проверить Light/Dark, hard reload и SPA, вкладки, sidebar, переходы из списков, relation и штатные Save/Publish. Статический синтаксис, сравнение палитр и mock-тесты не заменяют визуальную проверку CMS.

## CANONICAL — Tools Launcher

Tools Launcher получает registry из `extension/manifests/tools.json`, а код tools — из `extension/tools/`. `file` в manifest хранит относительный путь внутри `extension/tools/`, включая подпапку назначения.

Физическая структура tools:
- `extension/tools/extractor/` — выгрузки и извлечение данных;
- `extension/tools/pusher/` — контролируемые массовые записи;
- `extension/tools/syncer/` — синхронизации и управляемые write-инструменты;
- `extension/tools/config/` — GET-only конфигурация/отбор кандидатов для отдельных workflows;
- `extension/tools/catalog/` — синхронизация групп каталога;
- `extension/tools/service/` — сервисные инструменты получения предметного контекста CMS (DOM, Network, стили) для анализа.

Manifest tool содержит:

```text
file
group
```

`schemaVersion: 1` сохраняется как версия формата registry. Для tool отсутствует отдельная `version`: Tools Launcher всегда читает свежий `tools.json` и JS-инструмент через `fetch` с `cache: 'no-store'` и cache-busting параметром. Версия `tools-launcher` как extension в `features.json` остаётся обязательной для обновления кеша Tampermonkey-loader.

`group` не является отдельной смысловой классификацией: он обязан совпадать с первой папкой `file`. Допустимые группы: `extractor`, `pusher`, `catalog`, `config`, `syncer`, `service`; Tools Launcher валидирует это соответствие и строит UI-колонки по этим же группам.

Группы `audits` больше нет: новые проверки проектировать отдельно без возвращения удалённых реализаций по умолчанию.

Tool-файлы не содержат собственные metadata-блоки. Runtime-регистрация (`file`, `group`) задаётся в `extension/manifests/tools.json` без версии отдельного инструмента. Userscript metadata используется только в `extension/extension.js`, потому что только loader устанавливается напрямую в Tampermonkey.

Managed regular tools получают global run-lock. Для GET временные network errors / `429` / `5xx` могут повторяться; постоянные `4xx` не ретраятся.

## CANONICAL — Config → Syncer: categoryRelations RU → KK (2026-11-26)

- Новый образец для переработки локализации: `extension/tools/config/categoryRelations.js` → `extension/tools/syncer/categoryRelations.js`. Config только читает CMS и отбирает кандидатов; Syncer работает с одной карточкой или списком documentId из CSV/Google Sheets, пересчитывает план по live данным. Не переносить прежние универсальные normalizer в новый runtime.
- Config: все RU Category Draft через list endpoint, `locale=ru&status=draft&sort=id:ASC`, pageSize=100, строгая пагинация, detail count и уникальные documentId; сравнение RU/KK Draft relations. `category-relations-config.csv` (documentId) — только расхождения, `category-relations-config-blocked.csv` (documentId,reason) — нет KK Category или RU products не пусто. Config не является аудитом публикации или контента; совпавшие Draft не входят в CSV. UI с прогрессом и Stop, отчёт `window.categoryRelationsConfigReport`.
- Scope relations: parent (inversedBy categories), categories (mappedBy parent), product (mappedBy Product.categories), products (mappedBy Product.category, legacy), brand (inversedBy Brand.categories), top_brands (mappedBy Brand.category). Проверять схему через Content Manager. RU products должен быть пуст; лишние KK products удаляются. Цель — RU Draft → KK Draft существующей Category, без создания локалей. Missing KK target пропускается, остальные связи синхронизируются; connect/disconnect по documentId, numeric ID из соответствующей версии relation/target.
- Актуальный write в Syncer: один `POST /content-manager/collection-types/api::category.category/<documentId>/actions/publish?locale=kk` с текущими KK полями и relation delta (connect: id, documentId, locale, isTemporary; disconnect: актуальные строки KK relation). Отдельные записи/публикации Product, Brand, child Category не выполняются. Проверять четыре версии корневой записи, RU relations и поля затронутых targets до/после; не ретраить write. Старый вариант PUT child parent + Publish superseded. Нет изменений и KK уже опубликована без modified → без write.
- Published relations могут не включать target без KK Published: сохранить Draft link, проверить отсутствие опубликованной версии target, отразить в `unpublishedRelations`. Missing Draft → skip/partial; если опубликованный target исчез из Published relation, это ошибка. Текущие исключения integrity: Category.key, Product.InStock/inStock; изменения фиксируются, не считать потерю key безопасной для других workflows.
- Bulk: локальный CSV или Google Sheets CSV, список уникальных documentId; одно подтверждение, последовательная обработка, пауза 350 мс, Stop между категориями; fatal/pending останавливает новые записи. `category-relations-results.csv` (documentId;status;added;removed;skipped;published;comment); детали `window.categoryRelationsBatchReport` / `window.categoryRelationsReport`, в single также `category-relations-missing-kk.csv`. Итоговый CSV содержит число unpublishedRelations, а их documentId остаются в подробном report.
- HISTORICAL: предоставленный пользователем CSV от 2026-11-26 подтверждает обработку категорий новым workflow; зафиксирована аномалия Category.key (RU Draft key стал null, KK Published получил прежний RU key). Это диагностическое свидетельство, не подтверждение безопасности переноса/создания локали. Текущее состояние CMS перепроверять.

Группа `diagnostics` переименована в `service` 2026-11-23 без изменения функций инструментов: `service/dom.js` копирует DOM, `service/network.js` записывает Network fetch/XHR, `service/styles.js` формирует design snapshot. Сервисные tools служат для передачи предметного контекста CMS. Существующие fallback-имена JSON (`network-recorder.json`, `style-stealer.json`) и структура выходных данных сохранены.

## CANONICAL — pusher отключения Product по карточке Brand (2026-11-23, mock)

- Источник: полный paginated `GET /content-manager/relations/api::brand.brand/{brandDocumentId}/products?locale=ru&status=draft&page=N&pageSize=100`; строгие total, pageCount, documentId и отсутствие дублей. Все полученные Product включаются независимо от собственного active/published; не выполнять per-Product GET relation brand.
- После dry-run-count и подтверждения — один контрольный Product, затем партии до 4 одновременно: `PUT /content-manager/collection-types/api::product.product/{id}?locale=ru` body `{active:false}` → GET Draft verify `active=false` → `POST .../{id}/actions/publish?locale=ru` body `{}` → GET Published verify `active=false` и `publishedAt`. PUT/POST никогда не повторять автоматически; при ошибке pilot/batch остановить выдачу новых Product и сохранить review, не считать неопределённый HTTP результат успехом. При Stop завершать начатую партию.
- Выход `brand-products-deactivate.csv`: `documentId;brandDocumentId;stage;result;error`, отдельно `window.brandProductsDeactivateReport` и флаг `window.brandProductsDeactivateStop`. Проверка mocked run: 2 Product успешно, 101 Product только read/cancel (2 GET), ошибка verify пилота не вызывает Publish/следующие PUT. **Нет подтверждённого live Save/Publish нового pusher**, не называть production-verified до первого реального пилота.
- Отдельный extractor дерева категорий переименован в `extension/tools/extractor/categoryTreeProducts.js` (прежний singular path удалён). Контракт CSV остался `catalog-tree-products.csv`, одна колонка `documentId`, уникальные товары всего поддерева.


## CANONICAL — Network Recorder

`extension/tools/service/network.js` — сервисный инструмент для быстрого Network-контекста Strapi; `extension/tools/service/dom.js` остаётся только DOM snapshot utility.

Workflow:
- первый запуск через Tools Launcher → Start;
- выполнить нужное действие в Strapi;
- повторный запуск → Stop;
- recorder собирает same-origin `fetch` и XHR для `/api/...`, `/content-manager/...`, `/upload`;
- для каждого request сохраняет порядок/время старта, method, URL, status, duration, request body и response body;
- JSON/text сохраняется структурированно; FormData files — только `name/type/size`; binary body не читается;
- body ограничен 200 KB, session — 200 requests;
- на Stop новые requests не принимаются, уже начатые ожидаются до 5 секунд;
- итоговый JSON копируется в Clipboard, fallback — `network-recorder.json`;
- hard reload сбрасывает session; SPA-навигация внутри вкладки запись не сбрасывает.

Подтверждено в реальном Strapi: Content Manager GET/PUT/POST requests, request payload и JSON response корректно попадают в dump.

## CANONICAL — ссылки на записи в Content Manager list view

Прямой URL карточки collection type использует `documentId`:

```text
/admin/content-manager/collection-types/<uid>/<documentId>?plugins[i18n][locale]=ru
```

В DOM строки list view может быть доступен только числовой `id`, поэтому `href="#"` нельзя использовать как ссылку на запись: Vimium распознаёт её, но Ctrl/Meta-click и middle-click открывают текущий list view вместо карточки.

Рабочая стратегия:
- для текущей страницы списка одним GET через Content Manager получить записи и построить map `id → documentId`;
- ссылка строки получает реальный `href` с `documentId`, поэтому Vimium, Ctrl/Meta-click и middle-click работают нативно;
- обычный click может вызывать штатный `row.click()`, сохраняя поведение React/Strapi;
- lookup кэшировать по текущему UID + query страницы, чтобы React re-render/MutationObserver не создавал повторные GET;
- при временной ошибке GET сделать один retry;
- если lookup повторно не сработал, обычный click/Vimium деградируют до `row.click()`, а middle-click не должен открывать заведомо неправильный URL.

Для UI штатный checkbox не копировать: его можно переместить в общий flex-контейнер рядом с собственной ссылкой, сохраняя React handlers/state/disabled/loading.

---

---

# 3. API and data contracts

Public REST поддерживает рабочие query primitives:

```text
filters
fields
populate
pagination
sort
locale
```

Используются nested relations, components, Dynamic Zones и локализованные relations.

Пример минимального product query pattern:

```text
/api/products
?pagination[pageSize]=...
&pagination[page]=...
&fields[0]=documentId
&populate[attributes][fields][0]=documentId
```

Internal Content Manager namespace:

```text
/content-manager/collection-types/api::...
```

Admin JWT доступен в LocalStorage как `jwtToken`.

## CANONICAL — attributes without product check

Назначение проверки: найти все `attribute` в рабочей локали `ru`, у которых отсутствует relation `product`. Это ad hoc healthcheck; отдельный runtime parser для него не поддерживается, проверку можно быстро выполнять через Postman/internal Content Manager API.

Подтверждённый через Strapi Admin Network server-side filter:

```text
GET /content-manager/collection-types/api::attribute.attribute
?page=<N>
&pageSize=<N>
&sort=barcode:ASC
&filters[$and][0][product][name][$null]=true
&locale=ru
```

Практический workflow:
- использовать list endpoint с server-side filter, а не relation request для каждого attribute;
- пройти все result pages;
- для анализа достаточно `documentId` и `barcode`;
- если server-side filter перестал работать, сначала заново подтвердить internal request через Network, а не добавлять массовый relation-scan fallback.

Частые Public API paths:

```text
/api/products
/api/attributes
/api/categories
/api/brands
/api/promotions
/api/volumes
/api/shades
/api/home-page
```

## CANONICAL — Product attributes relation endpoint

Подтверждённый native relation endpoint:

```text
GET /content-manager/relations/api::product.product/<productDocumentId>/attributes?locale=ru&pageSize=<N>&page=<N>
```

Response содержит pagination и `results[]`; среди используемых полей подтверждены `id`, `documentId`, `name_web`, `publishedAt`, `updatedAt`, `locale`, `status`.

Практический navigator — `extension/ui-ux/relation/attribute.js` (scope: Product.attributes):
- Читает все relation pages, может переиспользовать соответствующий нативный GET, проверяет полноту/pagination/дубли, search по `barcode`, `name_web`, `documentId`, локальная пагинация и direct links в карточки Attribute. Native relation list сохраняется для управления связями (remove/reorder и несохранённый React form state); custom navigator показывает сохранённое API state.
- Детали читаются батчами по `documentId` и locale: `GET /content-manager/collection-types/api::attribute.attribute?page=1&pageSize=N&locale=ru&filters[documentId][$in][0]=...&populate[volume][fields][0]=name&populate[shade][fields][0]=name`. Проверять соответствие ожидаемых documentId, locale и pagination. Отображать barcode (fallback name_web/documentId), имена volume/shade и статус.
- Для цвета использовать target `item.shade.documentId`, не имя и не числовой ID. Собирать уникальные Shade IDs и читать `GET /content-manager/collection-types/api::shade.shade?page=1&pageSize=N&sort=id:ASC&locale=ru&filters[documentId][$in][0]=...&populate[hexes][fields][0]=hex`. Ответ `results[].hexes[].hex`; кэш по target documentId внутри загрузки locale. Недостающие/неполные targets — fallback detail GET (см. следующий раздел) с ограниченной параллельностью. При ошибке HEX оставить уже загруженные имена/статус, не подставлять цвет. Отменять чтение при смене записи. Цветовой образец через общий ColorSwatch перед именем shade. Не выгружать весь справочник для показа одной карточки. Пакетный list/populate и detail endpoints известны из миграционного workflow; конкретная комбинация filters для Shade navigator проверена в mock, не выдавать за новый live Network capture.

## CANONICAL — цвет выбранной relation Shade

`extension/ui-ux/relation/shade.js`: улучшение любой нативной выбранной relation к `api::shade.shade` независимо от исходной collection/field. Нативный dropdown поиска не менять и не загружать HEX для его результатов. Цвет показывать только после назначения связи; несколько HEX — сегменты общего ColorSwatch, без текста HEX. Пустые/невалидные HEX — обычное имя без образца.

Live Network подтверждён для ru Attribute:
```text
GET /content-manager/relations/api::attribute.attribute/shade?locale=ru&id=<attributeDocumentId>&pageSize=10&_q=<query>&page=1
GET /content-manager/collection-types/api::shade.shade/<shadeDocumentId>?locale=ru
```
Search response: `results[]` с `id,documentId,name,publishedAt,updatedAt,status`, `pagination`, но без HEX. Detail response: `data:{documentId,id,name,locale:null,hexes:[{id,hex:"#986168"}],...}` и meta. Shade может быть нелокализованным, но locale передаётся из контекста. У одинаковых имён Shade разные documentId; join по label недопустим.

DOM выбранной relation: `ol > li[aria-describedby]` с нативной кнопкой/ссылкой; её имя не содержит надёжного target ID. Реализация читает committed React fiber `memoizedProps.relation.model/documentId/params.locale` родительского RelationModalRenderer, проверяет точный model и documentId; если контракт React изменится — безопасно оставить нативный вид и диагностировать в DevTools. Это зависимость от внутренних React данных, не публичный API. Нативную кнопку не копировать/не заменять; ColorSwatch использует ::before. GET только для выбранных targets, dedup/cache по documentId+locale, TTL и ограниченная очередь параллельных запросов; при stale/SPA смене не рисовать цвет другой записи. Cleanup удаляет собственные маркеры/стили, observer и отменяет запросы. Первоначальный вариант с цветами пользователь проверил в CMS; последующий переход на общий ColorSwatch требует повторной визуальной проверки.

## CANONICAL — partial update attribute

Рабочий pattern:

```text
PUT /content-manager/collection-types/api::attribute.attribute/<documentId>?locale=ru
```

Body может быть partial, например:

```json
{"name_web":"<new value>"}
```

После write, если изменение должно быть опубликовано, одного успешного admin response недостаточно: нужна публикация и итоговая проверка опубликованного состояния подходящим API.

## CANONICAL — Product Save/Publish по Strapi Admin Network

Наблюдение из `network-recorder.json` (2026-10-30, одна карточка Product, локаль `ru`): штатные Save и Publish выполняются по следующим путям:

```text
PUT  /content-manager/collection-types/api::product.product/<productDocumentId>?locale=ru
POST /content-manager/collection-types/api::product.product/<productDocumentId>/actions/publish?locale=ru
```

При Save UI отправил **полный payload карточки**, в том числе `newFrom1C: true` и `active: false`; HTTP 200 вернул `data.status: "modified"` и `data.publishedAt: null`. Затем Publish UI снова отправил **полный payload**, включая те же boolean; HTTP 200 вернул `data.status: "published"` и ненулевой `data.publishedAt`. Это подтверждает штатную последовательность **Save → Publish**, но не доказывает, что **один** `POST actions/publish` с `{"newFrom1C":true}` или `{"active":false}` безопасно изменяет scalar field и публикует его без отдельного PUT. Такие минимальные payload были лишь предложены в одноразовых Console-скриптах, production-результат не подтверждён. Перед массовым использованием провести пилот с GET verify и при необходимости вернуться к подтверждённой последовательности.

Не путать с отдельно подтверждённым для category sync минимальным `actions/publish` с `categories.connect` — его успех нельзя автоматически обобщать на scalar fields. При массовой записи не отправлять сохранённый ранее полный объект Product без проверки: это создаёт риск перезаписать актуальные fields/relations. URL и контракт всегда повторно сверять по live Network при изменении версии Strapi.

---

# 4. CANONICAL workflows

## Fragrance concentration classification

**Статус:** CANONICAL  
**Подтверждено:** production-аудитом 2026-09-21.

Задача: определить и заполнить single relation `fragrance_concentration` у active products.

Рабочая последовательность:

```text
выгрузка всех active products
→ классификация
→ REVIEW/SKIP для неоднозначных случаев
→ dry-run и counters
→ controlled batch write
→ Save/Publish
→ повторная Public API проверка
```

Основной источник классификации — `name1 + name2` из Content Manager. `name` используется как точный identifier/1C и при необходимости для внешней проверки; `detail_text` — supporting source.

Подтверждённые правила:
- если состав набора содержит несколько разных концентраций → relation не ставить, `SKIP`;
- generic marketing text не переопределяет явное controlled значение;
- `Extrait` при `name2 = Духи` → `scent`;
- solid perfume / stick / roll-on без подходящего controlled value → `SKIP`;
- care-категория сама по себе не означает skip;
- явные `Perfume Hair Mist`, `Body Mist`, `Hair & Body Mist` классифицируются;
- функциональные care-mists без парфюмерной концентрации остаются без relation.

Подтверждённый dictionary:

| key | id | documentId |
|---|---:|---|
| body-mist | 13 | `o5uklspqv5k0vkghhv756ags` |
| cologne | 5 | `c2v89b89xmedz5vflmk7tg8b` |
| edp | 3 | `y5e4mc0nbx19hptxnxcf3laa` |
| edt | 1 | `rq00sekjvuvzltyshq961vhd` |
| hair-perfume | 11 | `e6bixcx64d8446l62lm2tvmo` |
| parfum | 7 | `kzx3adlugfakw9lpuye60bnh` |
| scent | 9 | `bg9gg4frh9gvqzalza9ax0z5` |

Production result 2026-09-21:

```text
active products total: 13441
relation assigned: 2259
MATCH: 2259
POSSIBLE_WRONG: 0
MISSING: 0
REVIEW: 0
SKIP: 8
NOT_APPLICABLE: 11174
```


## CANONICAL — product filter enrichment workflow

Подтверждено на production `shade_groups` 2026-10-02.

```text
определить target field / relation / dictionary / source
→ полный dataset через Content Manager
→ field-specific classification
→ union на Product
→ dry-run → PILOT
→ additive partial write только target field
→ verify → Publish → verify
→ batches + result CSV
```

Правила: все pages/relations читать полностью; relation сравнивать по `documentId`, numeric CM `id` получать динамически; terminal states задаются семантикой конкретного field, не переносятся автоматически между workflows; `review` одного источника/свойства не блокирует уверенные значения других; existing relations сохранять и добавлять только missing; `disconnect` без отдельного требования не использовать; modified/draft сам по себе не blocker в текущей single-user среде; write не должен дублировать остальные поля карточки; rerun idempotent; фактический Network выше сохранённого примера.

HISTORICAL `shade_groups`: makeup/`ru`, attribute-level dataset. Классификация: informative `shadeName` → `shadeHex` → secondary `color_variant1C/color_info` → product context. Nude только nude; clear только explicit transparent; multicolor может иметь несколько groups; недостаточно данных → `review`.

Production V4: 10739 rows / 2584 products; 10219 assigned rows, 433 `[]`, 87 review; 2168 products with known groups, 352 not applicable, 64 review-only, 8 partial-review. V4 добавил 270 relations для 144 products; 0 errors/drafts/unexpected extras. Эти counts исторические, при новом run пересчитывать.

## CANONICAL — `product_features` semantics

`product_features` — multi-relation для товарных характеристик макияжа. Подтверждённый controlled dictionary:

```text
waterproof
curling
lengthening
contact_lens_wearers
volumizing
hypoallergenic
```

Финальная классификация каждого Product допускает только три состояния:

```text
assigned
not_applicable
review
```

`[]` допустим только как временный unresolved во время анализа и не является финальным статусом для `product_features`.

Категория помогает оценивать применимость, но не является whitelist: значение можно назначать товару из другой makeup-категории, если свойство явно подтверждено. Не использовать механический keyword mapping: `volume` как объём упаковки ≠ `volumizing`; «стойкий» ≠ `waterproof`; «для чувствительных глаз»/«офтальмологически протестировано» ≠ автоматически `hypoallergenic`. При недостатке локального Product-контекста использовать web-проверку, предпочтительно официальный источник бренда/товара, и не усиливать claim сверх источника.

Один Product может получить несколько значений. Наличие спорного свойства не блокирует уверенные значения других. Write идёт через общий filter-enrichment workflow: additive connect только missing relations, только target field, затем publish и verify; `disconnect` без отдельного требования не использовать.

## Normalize `attributes.name_web`

**Статус:** CANONICAL  
**Подтверждено:** полный production run 2026-09-11.

Правило:

```text
нет shade и volume → barcode
только volume       → barcode + " - " + volume.name
только shade        → barcode + " - " + shade.name
есть shade + volume → barcode
```

`active` и product relation не являются условиями этого normalizer.

Рабочий write:

```text
PUT /content-manager/collection-types/api::attribute.attribute/<documentId>?locale=ru
{"name_web":"<new value>"}
```

После write проверять итоговые значения. `name_web` используется как читаемый label offer/attribute в relations и navigator.

## Bitrix hidden category «Товары для каспи»

**Статус:** CANONICAL для повторного извлечения списка из Bitrix.

Bitrix Admin:

```text
IBLOCK_ID=1
SECTION_ID=2347
find_section_section=2347
```

URL pattern:

```text
/bitrix/admin/iblock_element_admin.php?IBLOCK_ID=1&type=catalog&lang=ru&find_section_section=2347&SECTION_ID=2347&apply_filter=Y
```

Mapping key — `bitrix_id`.

Критично: pagination — `PAGEN_1`; рабочий scraper должен явно проходить все `PAGEN_1=1..N`. Первый вариант, который не проходил все страницы, дал неполный список.

`bitrix_id=0` исключать.

Public API не показывает draft/unpublished, поэтому missing records при необходимости дополнительно проверять через Content Manager.


## Daily report in Notion

**Статус:** CANONICAL.

Путь:

```text
MonAmie → Менеджер интернет-магазина → Отчет
```

Properties:

```text
Дата
Задача
Менеджер
Переработки
```

Одна submission на дату/менеджера. Несколько задач — отдельные короткие строки в `Задача`; при API-записи использовался `<br>`. `Переработки` пусто без явных данных.

## CANONICAL — сводный отчет по задачам

Источник — Google Sheet `Отчет по функционалу МП`.

Рабочая схема:

```text
manager draft sheets → анализ и дедупликация → нормализация формулировок → Отчет задачи
```

Финальный лист — `Отчет задачи`. Draft-листы используются как источники и не являются итоговым отчетом.

Колонки финального листа:

```text
№
Задача
Статус
Срок исполнения
Комментарий
```

Подтверждённые значения статуса:

```text
выполнены
поставлены, в работе
поставлены, не приняты в работу
перспективные (не поставлены)
```

При консолидации близкие пункты дедуплицировать; существующую задачу лучше дополнить новым фактом, чем создавать дубль. Технические детали оставлять только если без них теряется смысл. Основной фокус финального отчета — незавершённые задачи.

---

# 5. Product/UI domain knowledge

## Product sections field map

Подтверждённая логическая группировка Product card:

`Фильтры`:

```text
is_hypoallergenic
effect
fragrance_group
fragrance_concentration
skin_types
hair_types
product_effects
product_form
spf_value
usage_time
ingredients
product_segment
age_group
shade_groups
release_form
finish
coverage
product_features
```

Смысловые группы внутри вкладки `Фильтры` идут в порядке:

```text
Парфюмерия:
fragrance_group
fragrance_concentration

Макияж:
shade_groups
release_form
finish
coverage
product_features

Уход за кожей:
usage_time
age_group
product_segment
ingredients

Уход за волосами:
hair_types
is_hypoallergenic

Другое:
все остальные FILTER_FIELDS, которые не назначены в группы выше
```

`Другое` всегда последняя группа. Такой fallback должен быть динамическим: новое filter-поле, пока его явно не разнесли, автоматически попадает в `Другое`.

`Системное`:

```text
relatedProductsSlider
seo_description
seo_name
key
code_1c
bitrix_id
xml_id
code
sort
shareUrl
```

Остальное — `Контент`. Основной identifier поля — реальный API `name`; label/hint только fallback. UI logic должна работать с существующими React fields, не создавать их копии.

## CANONICAL — makeup filter dictionaries

`release_form` controlled values, подтверждённые в enrichment 2026-10-05:

| key | label |
|---|---|
| `baked` | Запеченая |
| `gel` | Гелевая |
| `cream` | Кремовая |
| `stick` | Стик |
| `cushion` | Кушон |
| `loose` | Рассыпчатая |
| `liquid` | Жидкая |
| `pearls` | В шариках |
| `marker` | Маркер |
| `pressed` | Прессованная |
| `pencil` | Карандаш |

Для `release_form` source semantics — Product context; attribute-level данные не являются обязательным источником классификации.

`finish` controlled values:

| key | label |
|---|---|
| `matte` | Матовый |
| `glossy` | Глянцевый |
| `metallic` | Металлический |
| `satin` | Сатиновый |
| `radiant` | Сияющий |
| `velvet` | Бархатистый |
| `glitter` | Глиттер |
| `shimmer` | Шиммер |

Для неоднозначных `finish` допустима внешняя проверка конкретного товара; назначение выполняется через общий безопасный filter-enrichment workflow.

### CANONICAL — Product / Attribute card layout + sections

`extension/ui-ux/collection/product.js` — вкладки Контент / Фильтры / Системное и смысловые заголовки групп; `extension/ui-ux/collection/attribute.js` — Контент / AR / Маркетинг / Системное. Обе используют общий Tabs из designSystem; стабильные DOM markers `data-tm-product-sections="true"`, `data-tm-attribute-sections="true"`, `data-tm-<prefix>-section-tab`, `data-tm-<prefix>-section-hidden` — контракт с layout tool; имена файлов/manifest IDs не должны менять эти маркеры без согласованной миграции. Фактический mapping полей смотреть в live source.

Нативные React fields не перемещать между DOM-контейнерами: это конфликтует с внутренним SPA/focus Strapi. Для временного визуального порядка групп Product допустим CSS `order` на существующих top-level rows (без reparent). Затем `extension/tools/service/layout.js` переносит текущий порядок в штатный `layouts.edit`.

Штатный порядок карточки хранится в Content Manager configuration:
```text
GET/PUT /content-manager/content-types/<uid>/configuration
uid = api::product.product | api::attribute.attribute
```

Source of truth для физического порядка — `layouts.edit`. Layout tool запускать из обычной карточки Product/Attribute (не create/configurations) после ручной настройки нативного layout и визуальных разделов. Читает все вкладки через стабильные markers; для Product.Фильтры учитывает `data-tm-product-filter-group-order`. Сопоставляет все поля, сохраняет исходный size, проверяет полноту/уникальность и сумму size каждой строки ≤12, показывает dry-run/diff. После подтверждения повторно GET configuration и проверяет отсутствие изменений, PUT штатного payload (только изменение смысла `layouts.edit`, сохранение settings, layouts.list и metadata с необходимой sanitization), GET verify. После успешной синхронизации перезагрузить карточку; не переставлять React fields в DOM. Синхронизация расширена на обе коллекции, но новый PUT подтверждать фактическим запуском/Network, не считать статический review доказательством записи.

## Styles service UI origin semantics

**Статус:** CANONICAL.

Для design snapshot страницы `extension/tools/service/styles.js` делит UI на три происхождения:

- `native` — нативный Strapi без наших маркеров;
- `modified` — нативный DOM-узел, изменённый extension; обычные `data-tm-*` / `tm-*` на самом элементе означают modified;
- `custom` — UI, созданный extension; root помечается `data-tm-created="<extension-id>"`, его собственные потомки считаются custom.

Если нативный Strapi-узел перемещён внутрь custom-контейнера, ставить на сам узел `data-tm-modified="<extension-id>"`: этот marker создаёт native/modified boundary и не даёт считать перемещённый React element custom. Нативные React elements перемещать, не копировать.

---

# 6. Localization and translation

Для `ru/kk` различать:
- localization самого field;
- localization relation field;
- localization target entity.

## CANONICAL — translator prompts

`promts/translator/full.md` — полный source of truth для production RU → KK translation rules. Он хранит подробные правила, глоссарий, приоритеты и самопроверку без искусственного ограничения длины.

`promts/translator/compressed.md` — поведенчески эквивалентная версия тех же правил для ChatGPT Project Instructions с лимитом 8000 символов. Сжатие должно убирать объяснения и примеры, а не переводческие правила или их приоритет.

`promts/translator/extractor.md` — отдельный audit prompt: анализирует review-таблицы/историю, агрегирует evidence и предлагает только подтверждённые ADD/STRENGTHEN изменения перед merge. Самостоятельно production-терминологию не меняет.

Translator сам определяет тип входа `EMPTY`, `PLAIN_TEXT`, `HTML`, `IMAGE`.

Устойчивые принципы:
- пустой/whitespace-only input не требует пояснений;
- если русского переводимого текста нет, вход сохраняется;
- бренды, product/collection/technology names, латиница, SKU, URL, единицы и технические конструкции защищаются;
- в HTML переводится только разрешённый текст; structure/tags/attributes/CSS/classes/links сохраняются;
- конкретные ингредиенты/ноты нельзя подменять похожими и нельзя примирять противоречащие исходные данные внешним знанием;
- для парфюмерии закреплено: `туалетная вода → иіссу`, `духи → әтір`, `парфюм → парфюм` как тип/концентрация, `парфюмированная вода → парфюмделген су`, `парфюмерная вода → парфюмерлік су`;
- уровни пирамиды: `верхние → жоғарғы`, `сердечные/средние → жүрек`, `базовые/нижние → базалық`; плоский список нот нельзя самостоятельно превращать в пирамиду;
- повторно подтверждённые review-правила включают `свежесть → балғындық`, perfume `пряный/пикантный характер → татымды`, perfume `кожа → былғары`, `имбирь → зімбір`, `мята → жалбыз`; кедр не подменяется другим хвойным деревом; `парфюмер-создатель → хош иістерін жасаушы парфюмер`; `точечное нанесение → терінің қалаған жеріне дәл жағу`.


---

# 7. Mobile CMS / deeplink / media

Home — Single Type + Dynamic Zone. Частые components:

```text
home.main-banners
home.highlights-slider
home.product-slider
home.product-grid
```

Частые fields:

```text
title
deeplink
mode
maxItems
products
```

Deeplink pattern: `monamie://...`; корректный syntax не гарантирует, что mobile route зарегистрирован.


Media formats, встречавшиеся в API: `thumbnail`, `small`, `medium`; preview 750×750 использовал `medium`.


---

# 8. CANONICAL — Helpdesk

Helpdesk uses two independent n8n workflows:

- `helpdesk/workflow.json` — inbound Telegram → n8n → Notion: registration, issue draft, media upload and Notion page creation.
- `helpdesk/notifications.json` — outbound Notion → n8n → Telegram: requester notifications after selected status changes.

Outbound contract:
- Notion database automation sends webhook only for status transitions to `В работе`, `Решено` or `Не по адресу`.
- Webhook content must include `Обращение`, `Статус`, `Ответ`, `Telegram chat ID`.
- `Новое` and `Архив` do not notify the requester.
- `Ответственный` is internal and is never exposed to the requester.
- `Ответ` is optional. For `Решено` and `Не по адресу`, when non-empty it is appended in the same Telegram message after a blank line; when empty, only the status line is sent.
- `В работе` sends `Принято в работу 🛠️` and the request title as the next paragraph.
- No history/state-machine/deduplication layer is added at this stage; the workflow reacts to the three target status events only.
- Webhook uses Header Auth. The secret belongs in the n8n credential and matching Notion custom header; never commit it to repo.
- Webhook responds immediately and Telegram send retries up to three times.
- Current Notion date properties are named `Дата создания` and `Дата выполнения`.
- Production flow was verified end-to-end on 2026-10-16: Notion automation `statusNotifications` → n8n production webhook `/webhook/helpdesk-status-notification` → Telegram.
- The Notion automation uses one status trigger with values `В работе`, `Решено`, `Не по адресу` and sends only `Обращение`, `Статус`, `Ответ`, `Telegram chat ID`.
- Verified Telegram format: first paragraph is the status (`Принято в работу 🛠️`, `Решено ✅`, `Не по адресу ↪️`), second paragraph is `Обращение`, and for `Решено` / `Не по адресу` an optional third paragraph is `Ответ`. Messages follow the main bot style: no trailing periods, blank lines between semantic blocks.
- Inbound submit recovery: after `state=submittingIssue` is set, submit is non-cancellable so a second Telegram execution cannot clear the request while the first execution is creating the Notion page. Late media updates are still accepted, size-checked and deduplicated; all other inputs get `Обращение уже создаётся`. `createNotionFileUpload` and `downloadTelegramFile` retry up to three times and then continue into the common upload validation instead of leaving the profile stuck. If any pre-page media step fails, or if `createNotionIssueNoMedia` / `createNotionIssueWithMedia` fails before a page is confirmed, state returns to `awaitingIssueDescription`; description and saved media are preserved and the bot offers `Попробовать снова` / `Отменить`. `createNotionIssue*` is not auto-retried to avoid duplicate pages on ambiguous POST failures. If the Notion page was created but `attachNotionMedia` fails after retries, the request is finalized to `ready`, saved media rows are cleared, and the user is told that the request was created without attachments.
- Notion media upload safety confirmed 2026-10-21: `uploadNotionFile` (`POST .../file_uploads/{id}/send`) must not use n8n `Retry On Fail`, because a successful send changes the upload from `pending` to `uploaded` and retrying the same `upload_id` returns HTTP 400. `createNotionFileUpload` / `downloadTelegramFile` may retry safely and use `continueRegularOutput`; `uploadNotionFile` does not retry and also uses `continueRegularOutput`. `aggregateUploadedFiles → routeUploadedFiles` requires every item to have `id` and `status=uploaded` before page creation. MIME is normalized by common image/video extensions before upload, with Telegram MIME as fallback.
- Attachment size guard confirmed 2026-10-21: before `checkMediaNotSaved`, `checkMediaSize` reads Telegram `file_size` for the largest photo variant, video or document. Files over `20 * 1024 * 1024` bytes are not saved to `telegramIssueMedia`; `sendMediaTooLarge` tells the requester that one attachment is limited to 20 MB and asks to resend a smaller file. The guard is used both while collecting the request and for late media during `submittingIssue`.
- Inbound one-message flow confirmed 2026-10-21: for a registered requester the normal path is `Создать обращение → askIssueDescription → one user message → automatic submit → success notification`. `routeIssueContent` accepts `text`, `media`, `cancel`, legacy/retry `submitIssue`, or invalid input. Plain text is written to `draftDescription` and submitted immediately. Photo/video/document captions are valid request text; albums wait for the batch and submit once. `routeSubmitMedia` requires text from `draftDescription` or at least one media caption; media without any description is cleared and the requester is asked to resend with text. `Описание` in Notion is assembled from `draftDescription` plus media captions, while `Подписи к медиа` remains a service field. Intermediate `Описание сохранено` / `Вложение добавлено` messages and the normal final submit button were removed. The Notion database schema and outbound `notifications.json` workflow are unchanged.

---

# 9. Security and repository decisions

- Реальные tokens/cookies не хранить в repo, документации или shared snippets.
- Strapi Admin JWT используется как локальный credential для admin requests.
- Public status `mbtema/strapi` — сознательное решение для прямой загрузки loader/Tools Launcher из GitHub. Сам по себе public repo не является дефектом; пересматривать это решение только при реальной утечке credentials/secrets или новом требовании.
- Live code-review backlog живёт в GitHub Issues; context хранит только устойчивые решения/workflows/history, а не список открытых тикетов.

---

# 10. CANONICAL — Category groups

## CANONICAL — зеркальная синхронизация категорий Products

Назначение: поддерживать одинаковый набор Product relations внутри явно настроенных зеркальных групп Category в разных ветках каталога. Группа содержит 2+ Category и задаётся вручную внутри browser tool `extension/tools/catalog/groupMirror.js` через `MIRROR_SYNC_GROUPS` как `{ name: 'Название', categories: ['documentIdA', 'documentIdB'] }`; `name` восстановлен из подписей исторической версии перед удалением комментариев, порядок и состав групп не менялись; рабочая locale только `ru`.

Бизнес-правило для одной mirror group:
- собрать union Products всех Category группы;
- каждая Category группы должна в итоге содержать весь union;
- если Product отсутствует сразу в нескольких Category этой группы, добавить все missing Category одним `actions/publish`;
- остальные `Product.categories`, не входящие в текущую группу, не менять;
- только additive `connect`, без `disconnect` и без пересборки полного relation списка;
- если Product действительно не должен входить в зеркальную группу, Content Manager удаляет его из всех Category этой группы;
- Product публикуется tool'ом независимо от исходного draft/modified/published состояния.

Группы изолированы друг от друга и обрабатываются строго последовательно. Изменения одной группы не объединяются с другой и не формируют transitive graph. Если один Product встречается в нескольких mirror groups, каждая группа обрабатывает его отдельно только в своём scope.

Подтверждённый write contract:

```text
POST /content-manager/collection-types/api::product.product/<productDocumentId>/actions/publish?locale=ru
```

Минимальный body для одного или нескольких missing Category текущей группы:

```json
{
  "categories": {
    "connect": [
      {
        "id": "<numeric category id resolved at runtime>",
        "documentId": "<targetCategoryDocumentId>",
        "locale": "ru"
      }
    ],
    "disconnect": []
  }
}
```

`categories.connect` может содержать несколько missing Category одной группы. Отдельный Save не нужен: UI/Network test подтвердил, что relation можно добавить и сразу опубликовать одним `actions/publish`. `isTemporary` для минимального payload не требуется. Numeric Category `id` не хардкодить — получать через Content Manager detail по configured `documentId`.

Read:
```text
GET /content-manager/collection-types/api::category.category/<categoryDocumentId>?locale=ru
GET /content-manager/relations/api::category.category/<categoryDocumentId>/product?locale=ru&page=<N>&pageSize=<N>
```

CANONICAL run:
1. Проверить все configured Category всех групп и fail-fast до write, если хотя бы один `documentId` не читается.
2. Прочитать все страницы relation `product` всех Category каждой группы.
3. Общий dry-run по всем группам; показать counts, union, missing relations и количество Products к publish. Если изменений 0 — закончить без confirm/write.
4. Одно подтверждение на весь run.
5. Обрабатывать группы строго последовательно. Перед write каждой группы снова сделать live-read и пересчитать union/diff.
6. Для каждого Product с missing Category выполнить один минимальный `actions/publish`, содержащий все missing Category только текущей группы.
7. Write ошибки одного Product не останавливают run; failed фиксировать и продолжать.
8. После всех writes текущей группы заново прочитать все её Category и verify, что их Product documentId sets равны union. Verify mismatch не останавливает следующие группы.
9. После всех групп вывести summary; при failed/read/verify проблемах автоматически скачать CSV `group,productDocumentId,targetCategories,error,verifyStatus`.

Concurrency:
- adaptive worker waves;
- стартовать с умеренного значения и повышать ступенями;
- оценивать не только отсутствие ошибок, но и фактический throughput ступени;
- новая ступень считается лучше предыдущего best только при приросте throughput минимум на 3%;
- если две следующие ступени подряд не улучшают best throughput, откатиться к best concurrency и зафиксировать его для дальнейших groups;
- переносить найденный concurrency между группами;
- на `429`, `5xx` или network error снижать concurrency и заново разрешать benchmark от нового безопасного уровня;
- `POST actions/publish` автоматически не ретраить;
- постоянные `4xx` не ретраить;
- сохранять benchmark по waves: group, concurrency, avg latency, throughput, stage throughput, best concurrency/throughput, tuning action, success/failed.


Current configured groups не дублировать в context: source of truth — live `MIRROR_SYNC_GROUPS` в `extension/tools/catalog/groupMirror.js`.

Пересечение Category между разными mirror groups сейчас не запрещается и специально не объединяется. Если реальный каталог выявит пересекающиеся группы, сначала отдельно определить бизнес-семантику такого сценария, затем менять workflow.

## CANONICAL — односторонняя синхронизация категорий Products

Назначение: поддерживать одностороннее включение Products из настроенной source Category в соответствующую target Category. Runtime tool: `extension/tools/catalog/groupForward.js`; рабочая locale только `ru`.

Группы задаются вручную через `FORWARD_SYNC_GROUPS` по контракту:

```js
{
  name: 'Название группы',
  source: '<documentId Category-источника>',
  target: '<documentId Category-получателя>'
}
```

Текущий бизнес-контракт — строго `1 source → 1 target`:
- `source` — Category-источник;
- `target` — Category-получатель;
- все Products из `source.product` должны присутствовать в `target.product`;
- Products, которые есть только в `target`, никогда не добавлять обратно в `source`;
- source relation не менять;
- только additive `categories.connect`, без `disconnect` и без полной пересборки `Product.categories`;
- Product публикуется через `actions/publish` независимо от исходного draft/modified/published состояния.

Read/write contract тот же, что у mirror-sync tool:
```text
GET /content-manager/collection-types/api::category.category/<categoryDocumentId>?locale=ru
GET /content-manager/relations/api::category.category/<categoryDocumentId>/product?locale=ru&page=<N>&pageSize=<N>
POST /content-manager/collection-types/api::product.product/<productDocumentId>/actions/publish?locale=ru
```

Для write в `categories.connect` передаётся только target Category текущей forward-sync group с numeric `id`, полученным runtime по её `documentId`; `disconnect: []`.

CANONICAL run:
1. Валидировать `FORWARD_SYNC_GROUPS` и проверить все configured source/target Category; если хотя бы одна не читается, остановиться до любых write.
2. Общий dry-run по всем группам: прочитать все страницы `source.product` и `target.product`, посчитать `source - target` и количество Products к publish.
3. Если изменений 0 — закончить без confirm/write.
4. Одно подтверждение на весь run.
5. Обрабатывать группы строго последовательно. Перед write каждой группы сделать live re-check source/target и заново посчитать `source - target`.
6. Для каждого отсутствующего Product выполнить один `actions/publish`, добавляя только target Category.
7. Write ошибка одного Product не останавливает run; failed фиксировать и продолжать.
8. После writes группы снова прочитать source/target и verify, что `source - target = 0`. Verify/read error не останавливает следующие группы.
9. Финальный summary всегда; при failed/read/verify проблемах автоматически скачать CSV `group,productDocumentId,sourceCategory,targetCategory,error,verifyStatus`.
10. Report сохраняется в `window.productsCategoryForwardSyncReport`.

Concurrency полностью наследует подтверждённый throughput-aware adaptive механизм mirror-sync parser: старт 10, шаг 5, min 5, max 40, оценка ступени после 20 успешных requests, новая ступень должна улучшить best throughput минимум на 3%, после двух подряд неулучшающих ступеней rollback/lock на best concurrency; найденный уровень переносится между groups. На `429`/`5xx`/network error concurrency снижается и benchmark перезапускается. `POST actions/publish` автоматически не ретраить.

Current configured forward-sync groups не дублировать в context: source of truth — live `FORWARD_SYNC_GROUPS` в `extension/tools/catalog/groupForward.js`.

---

---

# 11. CANONICAL — Products Bitrix → Strapi

Согласованный трёхэтапный pipeline: `migrator/products/config.js` (Strapi Admin Console) → `matcher.js` (Bitrix Admin Console) → `importer.mjs` (Node.js 20+). `migrator/attributes/` — независимый pipeline с той же архитектурой, его файлы в ходе работ 2026-11-05 не изменялись. Основные операции **проверены на реальных данных**: Matcher v4 подготовил 12 973 кандидата, Products Importer подтвердил Save/Verify/Publish/Verify у 12 671 товара; Matcher v5 после нормализации выдал новый CSV на 599 товаров. При этом повторный `--apply` по этим 599 товарам и окончательный результат повторной обработки 301 ранее пропущенного товара **отдельными отчётами не подтверждены**. Нельзя смешивать результаты разных CSV/запусков. Инструкции запуска и текущие параметры — README и live-код; этот раздел хранит контракты, проверки и исключения.

## Согласованный контракт

1. Config читает все Products locale ru через Content Manager независимо от active, newFrom1C и наличия контента. Файл products-config.csv содержит 12 полей в порядке: documentId;name;name1;name2;detail_picture;preview_picture;pictures;active;newFrom1C;attributes;categories;detail_text. Media/detail_text — булево наличие, attributes — список всех barcode через |, categories — bitrix_id связанных Category с custom=false через |; custom=true исключены. Реальный snapshot от 2026-11-04 содержал 22 550 товаров, это не live-счётчик.
2. Matcher строго проверяет NAME === name (регистр, ведущие/внутренние/концевые пробелы не нормализуются), одного точного кандидата и хотя бы одного общего цифрового barcode (валидация 8–18 цифр). Текущий Matcher v5-media-flag выполняет один полный GET-обход Bitrix IBLOCK_ID=1 по страницам с `by=id&order=asc` (проверенный путь из attributes/matcher.js), валидирует total/размер каждой страницы/возрастающие уникальные ID, составляет индекс **оригинального NAME**, затем проверяет строгое `NAME === name` и общий ШК, GET карточек до 3 одновременно. Точность не зависит от `main.ui.filter`. После подтверждения читает Bitrix PROP[216]/PROP[217], DETAIL_TEXT, ACTIVE, IBLOCK_SECTION. Оригинальные URL PREVIEW_PICTURE/DETAIL_PICTURE (/upload/iblock/, не resize_cache) извлекает **только для пустых Media Strapi**; при заполненных полях Strapi URL не проверяется. PROP[28] gallery читается **только при пустой галерее Strapi**; тогда проверяются все существующие изображения Bitrix и формируется упорядоченный массив URL. Если в Bitrix не хватает хотя бы одного требуемого оригинала — MEDIA_URL_INCOMPLETE для всего товара. Matcher не изменяет товары Bitrix и **не устанавливает фильтр NAME** через main.ui.filter. Первый GET списка использует `clear_filter=Y`, поэтому сохранённый фильтр интерфейса может быть сброшен; поиск товаров делается по собственному индексу NAME.
3. Итоговый products-matched.csv — те же 12 полей Config + 10 полей Bitrix в порядке: bitrixId;matchedBarcode;bitrixActive;bitrixSectionId;bitrixName1;bitrixName2;bitrixDetailText;bitrixPreviewPictureUrl;bitrixDetailPictureUrl;bitrixPicturesJson. Последнее — JSON array с order/fileId/url внутри одной CSV-ячейки. В matched попадают товары с изменениями контента, галереи, active, категории **либо с newFrom1C=true/null**, даже если других различий нет. Matcher не рассчитывает полноту обязательного контента и целевое значение newFrom1C. Если строгого совпадения или SECTION_ID нет, либо у **нужного для переноса** изображения/элемента галереи не удалось подтвердить оригинальный URL, товар целиком идёт в products-unmatched.csv; Media диагностируется как MEDIA_URL_INCOMPLETE, раздел как BITRIX_SECTION_MISSING. Если в Bitrix самого изображения нет — это не URL-ошибка. Checkpoint по SHA-256 входного CSV хранится в IndexedDB (version v5-media-flag), результаты старых версий v3-content и v4-catalog-index не переносятся, поскольку предыдущий поисковый контракт мог ошибочно выдавать NAME_NOT_FOUND. При каждом запуске сначала заново читается весь каталог Bitrix, а потом используются сохранённые результаты сравнения; Stop и техническая ошибка не создают частичных CSV.
4. Importer читает исключительно новый products-matched.csv, не открывает Bitrix Admin и не требует Cookie Bitrix или cheerio. Для Media использует публичный URL Bitrix из CSV, проверку URL/MIME/размера и Strapi /upload. До любого изменения Product проверяет текущие Content Manager detail и relation categories locale ru; берёт bitrixSectionId из CSV, ищет Strapi Category с bitrix_id и custom=false, только добавляет отсутствующую relation через connect, существующие сохраняет, disconnect пуст. Если категория не найдена — весь товар пропускается до любых Upload/PUT/Publish, фиксируется CATEGORY_NOT_FOUND в products-import-report.csv и отдельном products-category-not-found.csv, на следующем запуске может быть перепроверен после ручного исправления. active всегда синхронизируется, заполненный контент Strapi не перезаписывается. После Save/Verify — Publish ru/Verify. Массовый импорт последовательный без обязательной паузы (default 0ms, опционально --pause-ms=N), append-only JSONL journal, Media checkpoint, неясные outcomes требуют ручной проверки; без --apply только dry-run.
5. newFrom1C — индикатор фактической полноты: пять обязательных полей name1, name2, preview_picture, detail_picture, detail_text и наличие Category после импорта. Matcher не вычисляет итоговое значение флага: true/null всегда передаёт Importer после точного NAME+barcode; false проходит только при иных различиях, так что false при незаполненном обязательном поле без различий Bitrix остаётся вне matched и требует отдельного аудита. Importer вычисляет флаг из **актуального Strapi после Save**, независимо от его первоначального true/false/null. Если обязательное поле пустое и в Bitrix, и в Strapi, импортируем остальное и сохраняем/ставим true. Если обязательные поля заполнены — false; пустая pictures в обеих CMS допустима и не мешает false. Если в Bitrix есть галерея, а в Strapi она пуста, импортируем все подтверждённые изображения; если в Strapi галерея уже не пуста, её состав и размер не сравниваем. Чтобы повторно актуализировать существующий detail_text или pictures, контент-менеджер очищает поле в Strapi до следующей волны. Степень совпадения текста/медиа не сравнивается посимвольно, проверяется только заполненность.
6. Bitrix SECTION_ID берётся из карточки Bitrix, а не из категорий Config. Если его нет среди categories в products-config.csv, товар всё равно остаётся matched для попытки Importer создать relation. Только Importer проверяет существование категории Strapi. Если SECTION_ID вообще не определён, продукт исключается Matcher.

## CANONICAL — подтверждённые поля карточки Bitrix (2026-11-05–06)

Проверенный пользователем образец: `IBLOCK_ID=1`, Product ID `531678` (Bioderma Sensibio DS+ Gel Moussant). Диагностический экспорт живой карточки и скриншоты подтвердили соответствие исходных полей: `input[name="NAME"] → name`; `PROP[216] → name1`; `PROP[217] → name2`; `textarea[name="DETAIL_TEXT"] → detail_text` (**оригинальный HTML, не очищать**); `select[name^="IBLOCK_SECTION"] option:checked → bitrixSectionId` (образец `2256`); колонка «Штрих код» в таблице торговых предложений (образец `3701129807729`, предложение `531703`); `PREVIEW_PICTURE → preview_picture`; `DETAIL_PICTURE → detail_picture`; `PROP[28] → pictures` (в образце семь изображений, порядок сохраняется). Пользователь подтвердил назначение всех этих полей по интерфейсу.

**ACTIVE — важная ловушка DOM:** на карточке одновременно есть `<input type="hidden" name="ACTIVE" value="N">` и `<input type="checkbox" name="ACTIVE" value="Y" checked>`. Широкий селектор `input[name="ACTIVE"]` из первого диагностического скрипта ошибочно дал `false`; правильное значение образца — **`true`**. Matcher уже использует `input[type="checkbox"][name="ACTIVE"]` и читает его правильно. Менять Matcher ради этого не нужно.

У образца найдено девять оригинальных URL `https://www.monamie.kz/upload/iblock/...`: две основные Media и семь элементов галереи; соответствия `fileId → real_url` находятся в JS-структурах HTML, а не в ссылках `a[href]` строк Media. Matcher ищет `fileId/real_url` и запасные ссылки, но **побайтовая проверка его парсера на сыром HTML ответа fetch именно этой карточки не проводилась**. Живой DOM после исполнения скриптов и `DOMParser` сырого HTML — не одно и то же: при сбое проверять именно Network Response.

Matcher работает через авторизованную вкладку Bitrix: `fetch(..., { credentials: 'include' })` → GET `/bitrix/admin/iblock_element_admin.php` (список, индекс каталога, ID ASC) → GET `/bitrix/admin/iblock_element_edit.php?IBLOCK_ID=1&type=catalog&lang=ru&ID=<id>&find_section_section=-1&WF=Y` (полная карточка для точного кандидата). `DOMParser` читает HTML ответа без визуального открытия карточки и без исполнения её JavaScript. Bitrix Cookie и sessid не переносить в код, контекст или отчёты. При нескольких `PROP[216]`/`PROP[217]` текущий парсер возвращает пустую строку; в проверенной карточке найдено ровно по одному полю. Это потенциальный диагностический случай, не подтверждённый production-баг.

## CANONICAL — Importer при устаревшем Config/Matcher CSV

`products-matched.csv` является **списком кандидатов и источником Bitrix**, а не безусловным списком операций PUT. Importer заново читает текущие Product и categories в Strapi, выбирает `KEEP` для уже заполненных `name1`, `name2`, `detail_text`, `preview_picture`, `detail_picture` и `pictures`, даже когда Config раньше показывал их пустыми. Для пустых значений при наличии Bitrix-источника выбирает `FILL`/`UPLOAD_AND_LINK`. Прямо перед PUT повторно проверяет snapshot и связи; если запись изменилась в ходе обработки, отменяет PUT, чтобы не затереть чужие правки. Целевой `newFrom1C` вычисляет по реальному Strapi **после Save**. При отсутствии Category Strapi с нужным `bitrix_id` блокирует любые изменения этого Product, статус `category_not_found`. При неопределённом исходе записи ставит `review`; автоматически не повторять до ручной проверки.

---

## CANONICAL — Актуальные ограничения Products pipeline

- `migrator/products/config.js` → `matcher.js` → `importer.mjs`. Config читает все RU Product, Matcher сопоставляет Bitrix по точному NAME и общему barcode; Importer повторно сверяет живой Product и Category, сначала dry-run, реальная запись — только с `--apply`.
- `products-matched.csv` — список кандидатов, а не обязательных PUT. Заполненный Strapi content сохранять; изменять только подтверждённые пробелы, active, недостающие Category и `newFrom1C` по свежему состоянию. Отсутствующая Category по `bitrix_id` → `category_not_found` без частичного write; неоднозначный PUT/POST → review и STOP без слепого retry.
- `products-config-issues.csv` означает пропущенные дефектные relations (в том числе Category без `bitrix_id`); при наличии issues основной Config CSV может иметь неполные relations — проверить до Matcher.
- Config использует IndexedDB checkpoint по составу RU Product, Matcher — по отпечатку исходного CSV, Importer — journal и media checkpoint. Для восстановления использовать тот же CSV/совместимый journal, не считать старые миграционные checkpoint совместимыми автоматически. В Bitrix `ACTIVE` читается из checkbox, а не одноимённого hidden input; media mapping `fileId/real_url` при сбоях проверять в сыром HTML/Network Response.

---

# 12. CANONICAL — Attributes Bitrix → Strapi

Действующий pipeline торговых предложений: `migrator/attributes/config.js` → `matcher.js` → `importer.mjs`. Сопоставление идёт по Attribute и barcode; Product для этого pipeline не читается.

**Config output** `attributes-config.csv` (10 колонок):

```text
documentId;barcode;active;hasDetailPicture;shade;shadeDocumentId;volume;volumeDocumentId;shadeHex;volumeValue
```

Значения для сравнения: `shadeHex` — все `shade.hexes[].hex` в исходном порядке, через `|` если несколько; `volumeValue` — `volume.value` (например `315`, не `315МЛ`). Предыдущие восемь колонок сохранены для диагностики и сопоставления. Пример shade: `hexes:[{id:83,hex:"#693734"}]` → `shadeHex="#693734"`; volume: `value:315` → `volumeValue="315"`. Отсутствующий relation = пустые поля; заполненный relation при пустом `hexes` либо `value:null` сохраняет `documentId`, но `shadeHex`/`volumeValue` оставляет пустым. Все Attribute ru, включая inactive/draft/пустой barcode; Product не читаем.

**Data source:** сначала Content Manager list Attributes + минимальный populate `detail_picture.id`, `shade.name`, `volume.name`; если relation представлен неполно — native `/content-manager/relations/api::attribute.attribute/<documentId>/<shade|volume>?locale=ru&page=1&pageSize=10`. У существующей связи `documentId` сохранять независимо от наличия `name`; если `name` отсутствует, пробовать target detail, затем сохранять ID + пустой name и счётчики `missingRelationNames`.

Для HEX/value Config **один раз постранично** читает справочники через `/content-manager/collection-types/api::shade.shade?page=N&pageSize=100&sort=id:ASC&locale=ru&populate[hexes][fields][0]=hex` и аналогичный `api::volume.volume` c `fields[0]=value`, затем делает join по target `documentId`. Отдельный GET target detail — только для нужных target IDs, если list API не вернул поле. Не выгружает `offers` и не делает GET target на каждый Attribute. Незаполненные HEX/value учитываются в `window.attributesConfigReport.shadeHexVolumeValue.missingValues` и `missingValueSamples`. При 404 на чтении target detail сохраняем `documentId` relation и пустое HEX/value, отмечаем `shadeHexVolumeValue.inaccessibleTargets` и `inaccessibleSamples`; 403/500 и ошибки формата не маскируем. Не придумывать HEX по имени/ID и не преобразовывать числовой volume в label. Некорректные `documentId`, pagination или формат необходимого поля → abort без CSV; missing/null значения допустимы и учитываются.

Только GET, ограниченная параллельность, прогресс, `window.attributesConfigStop=true`, UTF-8 BOM CSV (quote, separator `;`) после полного завершения; barcode сохраняет ведущие нули. При успешном проходе отдаётся полный CSV; null/пустые значения и fallback проверяются отдельно.


**Matcher обновлён 2026-11-09:** `migrator/attributes/matcher.js` принимает только Config с 10 колонками. Bitrix grid `IBLOCK_ID=2` (GET, строго последовательные страницы по ID ASC) подтверждён скриншотом и Console: `PROPERTY_202` = Объём, `PROPERTY_271` = Текст-подсказка. В ячейке объёма отображается `50 [62915]`: 50 — числовое значение, а 62915 — Bitrix справочник `IBLOCK_ID=12`. Подтверждённая ссылка `/bitrix/admin/iblock_element_edit.php?IBLOCK_ID=12&type=infoblock&ID=62915&lang=ru...`; парсим **весь** текст ячейки по строгому шаблону `число [ID]` и проверяем, что ID в скобках равен ID в `a[href]`, а `IBLOCK_ID=12`. Подтверждённый bugfix 2026-11-09: нельзя удалять тег `a` и парсить остаток, иначе `100 [62913]` превращается в `100 []`, Matcher останавливается на Bitrix ID 9795. Исправлено в `matcher.js`, 10 mock-тестов (в том числе пустое поле и некорректный ID). Остальные нужные колонки `PROPERTY_19` barcode, `ACTIVE`, `DETAIL_PICTURE`, `ID`. Не открывать карточки, сверять только однозначный точный barcode, checkpoint текущего формата в IndexedDB.

**Volume contract:** Bitrix = источник истины, включая **пустое значение**. Сравниваем нормализованные числовые `bitrixVolumeValue` с `volumeValue` из Config, игнорируя name: `50` и Strapi `50МЛ` с `value=50` → ничего не менять. Bitrix 50 и Strapi без relation → кандидат на добавление; Bitrix 50 и Strapi value 100 → кандидат на замену; Bitrix пусто и Strapi с relation → кандидат на удаление; оба пусты → ничего. Importer разрешает точные дубли target Volume и выбирает минимальный `id`; ноль совпадений означает review, а не создание справочника. Для remove — отключение текущего relation, только когда это действительно подтверждено в свежей записи.

**Shade contract:** в Bitrix `PROPERTY_271` «Текст-подсказка» — определяющий признак оттенка; `PREVIEW_PICTURE` **не признак**, поскольку всем предложениям генерируется уменьшенное изображение, лишь для некоторых контент-менеджеры вручную ставили свотч. Если подсказка заполнена и в Strapi `shadeDocumentId` пуст — вывести в отдельный `attributes-shade-review.csv`; если shade уже есть — считать обработанным независимо от HEX/name. Если подсказки нет — существующую Strapi shade не удалять. Shade никогда не отправлять на автоматическую запись через Importer. Независимые изменения volume/active/detail_picture не блокируются Shade: одна запись может попасть в оба файла.

**Matcher output:** `attributes-matched.csv` (11 колонок): `documentId;barcode;active;hasDetailPicture;bitrixId;bitrixActive;pictureUrl;volumeDocumentId;volumeValue;bitrixVolumeValue;bitrixVolumeStatus`. Дополнительный статус `known|empty|manual` различает числовой Bitrix Volume, **достоверно пустое** поле и нестандартную/неподтверждённую форму; `manual` **никогда не означает удалить Volume**, даже если `bitrixVolumeValue` пуст. При `manual` запись попадает в matched только если отдельно меняются active/Media, чтобы их можно было обработать независимо (Importer позднее обязан учитывать статус). `attributes-shade-review.csv` (5 колонок): `documentId;barcode;bitrixId;bitrixShadeHint;bitrixCardUrl`; ручной backlog, если непустой. **Новый** `attributes-volume-review.csv` (8 колонок): `documentId;barcode;bitrixId;bitrixVolumeRaw;bitrixVolumeRefId;strapiVolumeDocumentId;strapiVolumeValue;bitrixCardUrl`; для безопасной ручной проверки нестандартных значений. `attributes-unmatched.csv` — неуникальные/отсутствующие barcode и прочие диагностические исключения. При ошибке grid, неоднозначных ID/ссылках, нарушении полноты/пагинации — STOP без CSV. Мок-тесты прошли на добавление/замену/удаление volume, совпадающем value, shade review, одновременном попадании в два CSV и парсинге значения 50/ID 62915. При завершении Matcher выдаёт полный CSV кандидатов; результаты прошлого запуска не считать текущим количеством.


**CANONICAL — Attributes Importer Volume.** `migrator/attributes/importer.mjs` адаптирован к **11 колонкам** Matcher: `documentId;barcode;active;hasDetailPicture;bitrixId;bitrixActive;pictureUrl;volumeDocumentId;volumeValue;bitrixVolumeValue;bitrixVolumeStatus`. Перед каждым изменением читает live ru Attribute по `documentId` и проверяет точный barcode; целевую to-one relation читает GET `/content-manager/relations/api::attribute.attribute/<attributeDocumentId>/volume?locale=ru&pageSize=5&page=1`. Ответ подтверждён в Network: `results:[{id:107,documentId:"gb0g9ac7orakwgzakemhjajp",name:"0,01ГР",...}]`, `pagination:{page:1,pageCount:1,total:1}`. В detail API самого Attribute `volume:{count:1}`, там нет target ID — нельзя использовать как идентификатор relation. Каталог Volume один раз загружается через native list `/content-manager/collection-types/api::volume.volume?page=N&pageSize=100&sort=id:ASC&locale=ru&fields[0]=name&fields[1]=value`; выбор target по совпадению **числовой** `value` и **числовой** `name` с Bitrix значением (без МЛ/ГР; десятичная запятая эквивалентна точке). При нескольких точных совпадениях актуальное правило `v2.1` выбирает минимальный `id` (см. уточнение выше). Для уникального найденного target перед подключением дополнительно выполняется подтверждённый GET `/content-manager/collection-types/api::volume.volume/<targetDocumentId>?locale=ru` (в Network есть такой GET со значением `id=107`) и сверяются `documentId,name,value`; именно `id` из detail используется для `connect` (в Strapi версии одного `documentId` могут иметь разные числовые ID). Для `disconnect` всегда брать `id` именно из актуального GET relation Attribute. Результат target detail кэшируется по `documentId`. **SUPERSEDED для дублей:** при нескольких точных совпадениях Importer `v2.1` выбирает первый target по `id:ASC` и записывает его в `attributes-import-volume-duplicates.csv`. Только отсутствие нужной пары → никакой записи Volume, `status=review`, `attributes-import-volume-review.csv`; не создавать справочник. Совпадающий live `value` уже назначенной relation — ничего не менять независимо от name. `known` и разные значения → добавить/заменить, `empty` → удалить существующую relation, `manual` → **никакой** записи Volume, прочие поля могут обновляться.

**Live Network подтверждение:** пользователь записал 14 запросов при ручной замене Volume в Strapi Admin; **PUT нет**, изменение прошло через `POST /content-manager/collection-types/api::attribute.attribute/dym46rzax3vx12n6nvltael8/actions/publish?locale=ru` (HTTP 200). Request body содержит полные текущие скалярные поля, `detail_picture` и relation-поля `product, shade, volume, color_variant1C, filtry`. У `volume` фактический payload:
```json
{"connect":[{"id":107,"documentId":"gb0g9ac7orakwgzakemhjajp","isTemporary":true}],"disconnect":[{"id":275,"documentId":"zlef4h3lolewzynrobe4mb26"}]}
```
Подтверждён успешный **replace**; добавление/удаление использует ту же пару массивов с одним из них пустым, без предположения о других эндпоинтах. Importer передаёт full-body c live scalar fields из подтверждённого payload и пустыми `connect/disconnect` по остальным relations, как UI; без `PUT volume`. Если нужны active/Media — отдельно старый подтверждённый PUT только этих полей, затем Verify, Publish с Volume delta, Verify опубликованной ru-версии и relation ID. Volume-only → сразу Publish с full-body. Media Bitrix — только публичный URL, без Cookie, сохранён старый upload. Конкурентные изменения выявляются повторным snapshot live Attribute + native relation перед Save и Publish; статус `modified` или draft не считается блокировкой. Неизвестный исход записи → весь batch STOP и journal review, **не** продолжать тысячи следующих записей. Auth/сетевая блокировка Strapi или публичного Bitrix Media → STOP.

---

# 13. RU → KK: полезные знания из удалённого locale

Статус старой реализации: **SUPERSEDED** (2026-11-26). Папка `locale/` удалена; исходники доступны в [Git History до удаления](https://github.com/mbtema/strapi/tree/06d60bceefcec4bf40707af361d2c0fcd07fa594/locale). Новый workflow разрабатывать отдельно по образцу Config → Syncer из раздела 2. Прежние алгоритмы не являются требованиями или подтверждёнными production-контрактами новой реализации.

## CANONICAL — принципы диагностики локализации

- Один documentId объединяет версии документа; numeric id может различаться у RU/KK и Draft/Published. Читать и проверять все четыре версии через `GET /content-manager/collection-types/<uid>/<documentId>?locale=<ru|kk>&status=<draft|published>`; проверять возвращённые documentId, locale, status/publishedAt. 404/пустая версия, locale fallback и ошибка доступа — разные состояния. Ответ RU на запрос KK не доказывает наличие KK.
- Схема: `GET /content-manager/content-types`, `GET /content-manager/components`; учитывать локализацию поля, target entity, required/unique, owner/inverse (mappedBy/inversedBy), media/components/Dynamic Zone. Отсутствующее в ответе поле не равно null; нельзя отправлять его как null или гарантировать сохранность без права чтения.
- Detail часто возвращает relation count, а не target IDs; читать `GET /content-manager/relations/<uid>/<documentId>/<field>?locale=<locale>&status=<status>&page=N&pageSize=100` полностью, сверять count/pagination/уникальность. Сравнивать по documentId; numeric ID разрешать из актуальной версии. Nonlocalized target не требует KK; для локализованного различать отсутствующий Draft, существующий Draft без Published и Published.
- Media сравнивать по числовым ID, компоненты — по смысловому содержимому, не техническим ID разных локалей. Существующие переводы и KK media не перезаписывать автоматически. Правила копирования полей, заполнения пустых локализованных значений, изменения inverse links и публикации зависимостей согласовывать по коллекции; не наследовать исключения одного workflow глобально.
- Перед write читать актуальное состояние, проверять ожидаемую семантику после write по GET, включая RU Draft/Published, KK Draft/Published и затронутые targets. Не повторять неопределённый PUT/POST. Сохранять before, expected, pending, стадию и диагностику; при неоднозначном исходе остановить новые writes. История и journal не заменяют DB backup.

## HISTORICAL / EXPERIMENT — Category

- `locale/category/normalizer.js`: массовый seed KK content/media/components → additive missing relations → Publish. Исторически защищал key/code/slug; `SHARED_SEED_GUARD=['code']` блокировал создание KK при непустом shared RU.code после случая потери RU Draft.code («Заколки»). Зафиксирован риск изменения shared RU данных при записи KK, также актуальный для проверки key. Не переносить старый список разрешённых полей как универсальный.
- Прежние content rules: сохранялись KK name/description/локализованные значения и существующие media; filters_app и title брались из RU, структуры repeatable components/DZ сравнивались по длине, типу, смысловому key. Это политика старого скрипта, а не утверждённый новый mapping.
- Старые relations: parent, brand, product — writable в алгоритме; categories, products, top_brands — inverse; только missing connect до 20, extra/unsupported links блокировали. Прежняя последовательность публикации RU и KK заменена новым Category relations workflow, не применять к новой локализации.
- Recovery IndexedDB `tm-category-normalizer-production-v1`: pending before/expected; прежний скрипт допускал только однократный guarded RU Draft PUT при точно установленной потере непустых top-level scalar/media в пустое значение, неизменных RU Published, RU relations, KK Published и остальных данных. Nested/relations drift не восстанавливался автоматически. Поздняя KK публикация могла снять pending read-only при точном совпадении. Recovery был проверен синтетически, не во всех live случаях.
- Исторически 2026-11-18 pending «Заколки» снят, следующий links PUT Category y3m74pjmlm7xbrvvt0h3vdkd дал RU drift; текущее состояние неизвестно. Не очищать старый journal до проверки; если нужен recovery, брать точную старую версию из Git History, не запускать массовый normalizer заново.

## EXPERIMENT — Product

- `locale/product/normalizer.js`: browser prototype для всех RU Product, KK seed → additive owner-side relations → KK Publish. Live create/write не подтверждён; mock tests не являются production validation. Исключались key, InStock/inStock; уникальный KK.key не копировался из RU. Для новой KK localized scalar (кроме name, boolean/media) оставлялся null; существующие KK переводы и media сохранялись, несовпадение shared fields и структуры компонентов блокировало write. Эти field rules требуют нового согласования.
- Legacy Product.category (inverse) непустой → пропуск, Product.categories — рабочая catalog relation; inverse links и extra KK links не пересобирались. Publish прототипа требовал опубликованных KK dependencies и точного совпадения Published relations с KK Draft, включая attributes. Это отличается от допустимых unpublished targets в текущем categoryRelations; не переносить автоматически. Product/Attribute/Category/Brand dependencies не публиковать без согласованного scope.
- IndexedDB `tm-product-normalizer-production-v1`; legacy quarantine Product fajndt11d4br9jmuy32n9xq9. Не считать незавершённый pending актуальным без live проверки.
- `locale/product/localizer.mjs` (Node.js) — отдельный legacy recovery, имел audit/default, --apply, --only, --probe, --recover-pending; кандидат create использовал Public REST PUT /api/products/<documentId>?locale=kk&status=draft с {data:localizedFields} и отдельным API token, без доказательства безопасного массового создания. Защищал key и RU версии, хранил `product-kk-backups/` и `product-kk-apply-progress.jsonl`. Recovery различал exact expected (complete), unchanged original (save), draft expected/published unchanged (publish), RU drift, изменение KK key и partial/external change (STOP). Старые Node backups/journal несовместимы с browser IndexedDB; не удалять локальные backups, извлекать точный исторический скрипт только для согласованного recovery.

## EXPERIMENT — Attribute

- `locale/attribute/preflight.js` и `locale/attribute/dry-run.js` — GET-only инструменты конкретной RU карточки Attribute. Не было apply-реализации. Полезный read contract: схема полей/relations + четыре версии + все страницы relations; проверка локализованности target и Draft/Published dependencies; JSON отчёты с omittedFields, relation counts, blockers/warnings.
- В старой диагностике `shade` (api::shade.shade) и `volume` (api::volume.volume) считались shared nonlocalized dictionaries; не требовать от них KK локали, подтвердить live schema при разработке. Остальные targets проверять отдельно; locale fallback не равен KK. После seed повторно читать links — Strapi может сам скопировать shared relation, не делать дублирующий connect.
- Dry-run только предлагал `PUT /content-manager/collection-types/api::attribute.attribute/<documentId>?locale=kk` (seed с locale:kk, затем connect missing) и `POST .../actions/publish?locale=kk` (поля + relation deltas). Ни один из этих KK writes не подтверждён live для Attribute. Старые blockers (нет RU Published, RU Draft≠Published, уже есть KK, непрочитанные поля, непроверяемый count, unsupported components/targets) — консервативная политика эксперимента, не переносить без согласования. Media candidate payload использовал numeric ID; не копировать permission-limited поля как null.
