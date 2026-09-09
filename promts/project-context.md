# project-context.md

> Расширенный технический и рабочий контекст проекта.
>
> Этот файл дополняет Project Instructions, но не заменяет их. Project Instructions определяют operational rules; здесь хранится knowledge layer: архитектура, рабочие паттерны, endpoints, repo state, известные решения и предметный контекст.
>
> Приоритет всегда такой: текущая инструкция пользователя → Project Instructions → актуальные GitHub/API/Network/UI данные → этот файл → исторические примеры.
>
> GitHub-версия `promts/project-context.md` считается source of truth. Snapshot ниже нужно обновлять после существенных изменений workflow, repo или архитектуры.

**Последняя сборка контекста:** 2026-09-09  
**Основной репозиторий:** `mbtema/strapi`  
**Strapi backend:** `http://10.10.3.80:1337`  
**Локали:** `ru/kk`

---

# 1. Рабочая модель проекта

Strapi используется как CMS для мобильного приложения MonAmie и связанных e-commerce/content процессов.

Основной рабочий стек:

- Strapi Content Manager;
- Public REST API Strapi;
- internal Content Manager API;
- Flutter/mobile client;
- Bitrix как legacy/source system части товарных данных;
- DevTools / Network / Console;
- browser JavaScript;
- Node.js для локальных migration scripts;
- PowerShell на Windows как shell/launcher;
- Postman;
- Tampermonkey;
- GitHub;
- Notion;
- CSV/Excel;
- n8n/Make при реально повторяемых межсистемных workflow.

Главный принцип: сокращать путь от вопроса до рабочего результата. Типичная задача — не строить новую систему, а быстро найти источник проблемы, проверить данные, получить точный endpoint, автоматизировать массовую проверку/миграцию или оформить понятное ТЗ.

Главная диагностическая цепочка:

```text
Strapi data → API response → Flutter/mobile rendering/logic
```

Если Strapi и API корректны, не менять CMS без причины — следующий уровень проверки клиент.

---

# 2. Данные и основные сущности

Частые сущности и поля:

```text
documentId
id
barcode
active
isInStock
locale
products
attributes / offers
brand
categories
shade
volume
price
detail_picture
preview_picture
xml_id
code_1c
bitrix_id
slug
shareUrl
```

Основной идентификатор в Strapi — `documentId`.

При сравнении массивов по умолчанию сравнивать по `documentId`:

- количество;
- совпадения;
- отсутствующие;
- лишние;
- дубликаты.

Большой JSON не пересказывать словами. Для просмотра/сравнения — таблица; для извлечения — `.map()`, `.filter()`, `.find()` или короткий parser.

Массовый результат должен быть сразу пригоден: CSV/таблица/список без ручной чистки.

---

# 3. Strapi окружение и ограничения

Backend:

```text
http://10.10.3.80:1337
```

Admin:

```text
http://10.10.3.80:1337/admin/
```

Практические ограничения пользователя:

- нет свободного изменения collection schema;
- нет свободного управления Public API roles/permissions;
- `/api/auth/local` может возвращать `400`;
- не использовать «попросить permissions/backend» как первый workaround.

Приоритет практических путей:

```text
Public API query
→ DevTools/Network
→ Postman/Console
→ internal Content Manager API
→ browser/Node automation
→ n8n/Make
→ backend change
```

---

# 4. Public REST API Strapi

Основные query-параметры:

```text
filters
fields
populate
pagination
sort
locale
```

Рабочее правило:

- диагностика неизвестной структуры → `populate=*` допустим;
- рабочий запрос → минимальный точный `populate`;
- relations ограничивать нужными `fields`;
- полный URL предпочтительнее фрагмента query.

Учитывать отдельно:

- Dynamic Zones;
- nested relations;
- локализацию поля;
- локализацию relation field;
- локализацию target entity.

Исторический рабочий пример:

```text
http://10.10.3.80:1337/api/products?pagination[pageSize]=1&pagination[page]=1&fields[0]=documentId&populate[attributes][fields][0]=documentId&populate[attributes][populate][volume][fields][0]=name
```

Для актуальной задачи всегда проверять реальный response, а не полагаться на старый snapshot.

---

# 5. Internal Content Manager API / DevTools / Postman

Если Public API не позволяет выполнить действие, использовать реальный request Strapi Admin:

```text
/content-manager/collection-types/api::...
```

Стандартный workflow:

```text
действие в Strapi UI
→ DevTools Network
→ endpoint + method + payload
→ повторить через Postman/Console/Node
```

Internal endpoint/method/payload не угадывать.

Admin JWT доступен в LocalStorage как `jwtToken`; для custom fetch обычно используется:

```text
Authorization: Bearer <jwtToken>
```

Быстрая трактовка:

- `400` → body/query/структура/locale;
- `403` → token/cookies/Authorization/permission;
- `404` → endpoint/UID/documentId/locale.

Основной Postman-файл:

```text
postman/admin-api.json
```

Секретные variables (`jwtToken`, `bearerToken`, `categoryDebugToken`) в GitHub не хранить.

---

# 6. Репозиторий `mbtema/strapi`

Текущая структура:

```text
.
├── README.md
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
│   ├── attributes-without-detail-picture.js
│   ├── attributes-without-product.js
│   ├── dom-stealer.js
│   ├── missing-shades.js
│   ├── shade-and-volume.js
│   ├── products-with-missing-content.js
│   ├── products-with-wrong-variants.js
│   ├── products-without-attributes.js
│   ├── products-without-brand.js
│   ├── products-without-categories.js
│   ├── products-with-wrong-prices.js
│   ├── sort-volume.js
│   └── volume-checker.js
├── bitrix/
│   └── detail-picture-audit.js
├── postman/
│   └── admin-api.json
└── promts/
    ├── project-context.md
    └── project-instructions.md
```

Назначение:

- `extension/` — loader/manifest;
- `features/` — постоянные функции/хоткеи;
- `ui-ux/` — постоянные UI/UX-кастомы;
- `parsers/` — регулярные проверки Strapi;
- `bitrix/` — browser tools для Bitrix audit/migration preparation;
- `postman/` — API collection/variables;
- `promts/` — Project Instructions + полный context.

Перед изменением кода читать актуальный GitHub. Snapshot в этом файле вторичен.

---

# 7. Loader и extensions

В Tampermonkey должен оставаться один основной script:

```text
extension/loader.js
```

Loader version:

```text
1.1.1
```

Cache key:

```text
tm-strapi-extensions-cache-v1
```

Loader:

1. запускает кешированные extensions сразу;
2. в фоне читает `extension/manifest.json`;
3. сравнивает `id/path/version`;
4. скачивает только изменившиеся extensions;
5. сохраняет cache;
6. обновлённый extension обычно применяется после reload Strapi.

Loader не менять ради обычного extension fix.

Изменил extension → bump его `version` в `extension/manifest.json`.

Актуальный manifest snapshot 2026-09-09:

| id | path | version |
|---|---|---:|
| sidebar | `ui-ux/sidebar.js` | 2.2.1 |
| record-list-scrollbars | `ui-ux/record-list-scrollbars.js` | 1.0.3 |
| list-view | `ui-ux/list-view.js` | 1.3.0 |
| entry-relocate | `ui-ux/entry-relocate.js` | 1.4.5 |
| barcode-extractor | `features/barcode-extractor.js` | 1.4.1 |
| ctrl-enter-publisher | `features/ctrl-enter-publisher.js` | 1.1.1 |
| parser-launcher | `features/parser-launcher.js` | 1.4.7 |
| vimium-open-row | `features/vimium-open-row.js` | 1.1.1 |

Основные hotkeys:

```text
Ctrl+B      barcode extractor
Ctrl+Enter  publish
Alt+P       Parser Launcher
Alt+S       sidebar
```

---

# 8. Strapi Admin UI / code review

Strapi Admin — React SPA. DOM пересоздаётся без full reload.

Правила:

- idempotent `init()/apply()`;
- hard reload + SPA navigation должны работать;
- не использовать `sc-*` как критические selectors;
- приоритет: `aria-*`, `role`, стабильные `data-*`, `data-tm-*`, semantic DOM;
- DOM refs проверять через `document.contains()`;
- штатные React nodes предпочитать перемещать, а не clone;
- сохранять handlers/state/disabled/loading;
- MutationObserver ограничивать через `requestAnimationFrame`, debounce/throttle и early returns;
- баг сначала локализовать в Console, потом менять код;
- при сбое давать конкретный `console.warn()`.

Sidebar хранится централизованно в `ui-ux/sidebar.js`; отдельные sidebar scripts не плодить.

`entry-relocate.js` работает DOM-first и не должен строить критическую логику на геометрии.

---

# 9. Парсеры и health checks

Стандарт регулярного parser:

```text
meta header
→ все API pages
→ validation
→ progress/counters
→ automatic CSV
```

Если output не CSV — явно указать это в meta header.

Актуальный Parser Launcher manifest:

- `sort-volume.js` — порядок volume;
- `volume-checker.js` — единицы volume;
- `missing-shades.js` — active offers с `color_variant1C`, но без `shade`;
- `shade-and-volume.js` — offers с одновременно `shade + volume`;
- `attributes-without-product.js` — offers без `product`;
- `attributes-without-detail-picture.js` — offers активных товаров, `isInStock=true`, `detail_picture=null`;
- `products-without-attributes.js` — active products без offers;
- `products-without-brand.js` — active products без brand;
- `products-without-categories.js` — active products без categories;
- `products-with-wrong-prices.js` — active products с нулевой/пустой/дробной ценой хотя бы у одного offer;
- `products-with-missing-content.js` — active products без `name1`, `name2`, `detail_picture` или `detail_text`;
- `products-with-wrong-variants.js` — active products с несколькими offers и некорректным типом выбора;
- `dom-stealer.js` — DOM → Clipboard.

Текущий product health layer:

```text
products-without-attributes
products-without-brand
products-without-categories
products-with-wrong-prices
products-with-wrong-variants
products-with-missing-content
```

Текущий offer/attribute layer:

```text
attributes-without-product
attributes-without-detail-picture
missing-shades
shade-and-volume
sort-volume
volume-checker
```

`products-with-wrong-variants.js`:
- проверяет только active products с >1 offers;
- `color_variant1C` игнорируется;
- допустим единый тип shade-only или volume-only;
- duplicate shade/volume values сами по себе не ошибка;
- ошибки: `no_variant_relations`, `missing_variant_relation`, `shade_and_volume`, `mixed_variant_type`.

---

# 10. Bitrix: точечное извлечение данных

Bitrix — legacy/source system части товарного контента.

Практически доказано, что точечные выгрузки можно делать самостоятельно через:

```text
Bitrix Admin
→ DevTools Network / DOM
→ browser JS
→ CSV
```

Для нового поля сначала выяснить, где оно реально находится:

- HTML страницы;
- filter property;
- отдельный Network request;
- offer row;
- product edit page.

После этого писать короткий browser parser.

Для barcode в списке товаров Bitrix используется:

```text
PROPERTY_19
```

Offer rows в product edit page можно определять по:

```text
input[name="SUB_ID[]"]
```

У строки offer доступны:

- Bitrix offer ID;
- barcode;
- `DETAIL_PICTURE` path `/upload/iblock/...`;
- другие поля, если они присутствуют в DOM/Network.

Bitrix product edit:

```text
/bitrix/admin/iblock_element_edit.php?IBLOCK_ID=1&type=catalog&lang=ru&ID=<PRODUCT_ID>&find_section_section=-1&WF=Y
```

Offer edit pattern:

```text
/bitrix/admin/iblock_subelement_edit.php?IBLOCK_ID=2&type=catalog&PRODUCT_ID=<PRODUCT_ID>&ID=<OFFER_ID>&lang=ru&WF=Y
```

---

# 11. `bitrix/detail-picture-audit.js`

Назначение: перед массовой миграцией определить, у каких проблемных Strapi offers реально есть `DETAIL_PICTURE` в Bitrix.

Вход:

CSV от `attributes-without-detail-picture.js`, где есть как минимум `barcode`; также используются `documentId`/`productDocumentId`, если они присутствуют.

Аудит:

```text
CSV
→ barcode
→ Bitrix setFilter
→ parent product
→ конкретный offer по точному barcode
→ DETAIL_PICTURE URL
→ mapping CSV
```

Важно:

- выполняется прямо в Bitrix Admin browser context;
- использует текущую авторизованную Bitrix session/cookies;
- самих изображений не скачивает;
- Strapi не изменяет;
- группирует source rows по `productDocumentId`, чтобы один parent product не открывать многократно;
- сохраняет checkpoint в LocalStorage;
- повторный запуск с тем же CSV продолжает незавершённый аудит;
- предусмотрена остановка через `stopBitrixDetailPictureAudit()`.

Основные statuses:

```text
ok
no_detail_picture
product_not_found
offer_not_found
duplicate_barcode_in_source
missing_barcode
error
```

Параллельно массово менять один и тот же Bitrix filter опасно: filter state живёт в admin session и concurrent `setFilter` может дать race. Поэтому текущий audit намеренно последовательный/осторожный.

---

# 12. Bitrix → Strapi: миграция `detail_picture`

Связующий ключ для текущей миграции — точный `barcode`.

Рабочая архитектура разделена на два этапа:

```text
Этап 1 — Bitrix browser audit
barcode → parent product → offer → imageUrl → status
             ↓ CSV
Этап 2 — local Node migrator
imageUrl → download → Strapi upload → relation → publish ru → verify
```

Почему разделено:

- Bitrix browser script удобно использует существующую admin session;
- Strapi browser → monamie image download упирался в CORS;
- Node не ограничен browser CORS и подходит для файловой migration;
- audit и write разделены, поэтому ошибки source matching не смешиваются с production write.

## Proven Strapi write chain

Для конкретного barcode:

1. найти Strapi attribute по Public API;
2. убедиться, что найден ровно один record;
3. убедиться, что `detail_picture` ещё пуст;
4. скачать Bitrix image;
5. `POST /upload` с multipart `files` + `fileInfo`;
6. получить полный media object;
7. partial internal PUT только поля:

```json
{"detail_picture": <media object>}
```

на:

```text
PUT /content-manager/collection-types/api::attribute.attribute/<documentId>?locale=ru
```

8. publish:

```text
POST /content-manager/collection-types/api::attribute.attribute/<documentId>/actions/publish?locale=ru
body: {}
```

9. verify через Public API.

Критически важно: partial PUT с одним `detail_picture` реально протестирован и не требует отправлять обратно все остальные offer fields.

## End-to-end proof

Сначала успешно мигрирован отдельный SKU.

Затем batch первых 10:

```text
SUCCESS: 7
ALREADY FILLED: 0
NO BITRIX PICTURE: 3
FAILED: 0
```

Все 7 source images попали в правильные Strapi attributes и были опубликованы; 3 были корректно пропущены, потому что `DETAIL_PICTURE` отсутствовал уже в Bitrix.

Для этой migration-задачи `ru` — главный рабочий источник. Пишем и публикуем `locale=ru`; `kk` не является блокирующим условием.

---

# 13. Node.js / PowerShell в migration workflow

Node.js — локальная среда выполнения JavaScript, не фреймворк.

На Windows:

```text
PowerShell
→ запускает node.exe
→ Node выполняет migration .js
```

PowerShell сам migration logic не выполняет. Он используется как shell:

```powershell
$env:STRAPI_JWT = '...'
node --use-system-ca .\script.js
```

`STRAPI_JWT` хранится в env текущей PowerShell session и читается Node через:

```js
process.env.STRAPI_JWT
```

Токен не должен быть захардкожен в GitHub.

Для `monamie.kz` Node default TLS выдавал `SELF_SIGNED_CERT_IN_CHAIN`; рабочий запуск:

```text
node --use-system-ca ...
```

На macOS принцип тот же; вместо PowerShell обычно Terminal + zsh/bash. Сам Node script в основном OS-independent.

## Safeguards для массовой migration

Перед full run:

- source audit отдельно;
- migrate только `status=ok`;
- exact barcode match;
- ровно один Strapi attribute;
- skip, если `detail_picture` уже заполнен;
- sequential или low concurrency;
- retry/logging;
- verify после publish;
- итоговый CSV/JSON;
- resumability.

Реальный остаточный риск: upload может пройти, а PUT/publish упасть — тогда в Media Library может остаться orphan media. Для массового migrator нужен log/resume, чтобы не плодить дубли на слепых rerun.

---

# 14. Локализация и переводы `ru/kk`

Локализация field, relation field и target entity — разные уровни.

Для каждого кейса выяснять отдельно:

1. локализовано ли поле;
2. локализована ли relation;
3. локализована ли связанная entity;
4. должен ли relation синхронизироваться;
5. какая locale source-of-truth.

Для текущей image migration приоритет — корректно заполнить и опубликовать `ru`.

## RU → KK translation

Plain text:
- сохранять смысл;
- ничего не добавлять;
- естественный казахский;
- избегать буквальной кальки;
- английский без необходимости не переводить.

HTML:
- переводить только text nodes;
- не менять tags;
- не менять CSS/classes;
- не менять links;
- не менять структуру.

Теоретически полностью автоматический pipeline:

```text
Bitrix ru
→ Node
→ LLM API
→ kk
→ Strapi locale=kk
→ publish
```

Если перевод выполняется в обычном ChatGPT-чате — это полуавтоматический режим; для unattended Node pipeline нужен отдельный LLM API.

---

# 15. Mobile / CMS / UI

Главная: Strapi Single Type + Dynamic Zone.

Частые components:

```text
home.main-banners
home.highlights-slider
home.product-slider
home.product-grid
```

Частые поля:

```text
title
deeplink
mode
maxItems
products
```

Deeplink `monamie://...` считается рабочим только если route реально зарегистрирован в mobile client.

Если API отдаёт корректный массив relations, а Flutter показывает один — сначала client.

Для UI использовать точные понятия:

```text
container
aspect ratio
adaptive
media
preview
clipping/cropping
dimensions
padding/margin
```

Для preview 750×750 в Strapi Media Library использовать `medium`, если формат доступен.

---

# 16. ТЗ, переписка и отчёты

Рабочая форма ТЗ:

```text
Короткое название

Что сейчас происходит.
В чём проблема.
Что нужно изменить.
```

Добавлять collection/component/field/API/UI только если нужно для понимания.

Без запроса не добавлять:

- Acceptance Criteria;
- DoD;
- Expected result отдельным блоком;
- Business value;
- очевидные test cases;
- канцелярит.

Переписка: лаконичная, деловая, человеческая.

Большие наборы задач — компактная таблица без лишних колонок.

Notion relations/rollups/formulas использовать только если уменьшают ручную работу.

---

# 17. Товарный контент

Частые сущности:

```text
SKU
barcode
shade
offer
brand
category
label
```

При отборе ассортимента:

- постоянные позиции;
- исключать сезонные/временные/лимитированные;
- исключать низкооборачиваемые;
- приоритет bestsellers;
- приоритет коммерчески значимых shades.

AR/оцифровка может выполняться отдельно по каждому barcode/shade.

Известный AR export format:
- отдельный файл на brand;
- product name;
- barcode каждого shade/SKU отдельной строкой;
- без лишних internal codes/prices/categories.

---

# 18. Исторические доменные кейсы

Исторические задачи полезны как контекст, но их статус всегда перепроверять.

Из известных:

- `volumes`: запрос на delete permissions и необязательные `xml_id`/`code_1c`;
- products `name`: обсуждалось отключение локализации и приоритет `ru`;
- brands: массовая проверка `showDiscountOnProductCard !== true`;
- promotions: `slug/shareUrl`, warehouses/stocks, locale sync;
- gift certificates: WebView для plastic, правила electronic delivery, custom nominal, schedule send, cart/payment flow;
- product home sliders: если API отдаёт несколько products, а client один — client-side issue;
- preview media: если API имеет `medium`, а client выбирает `small`, это client-side issue.

Не считать историческую задачу автоматически открытой или внедрённой.

---

# 19. Security / credentials

Admin JWT можно увидеть в DevTools LocalStorage. В рабочих scripts он используется как локальный credential для собственных admin requests.

Правила:

- не хранить реальные tokens в GitHub;
- не вшивать token в permanent scripts;
- передавать локально через Postman variable/env;
- не считать старый token гарантированно действующим.

Репозиторий может содержать code/examples, но не secrets.

---

# 20. Когда обновлять этот context

Обновлять после:

- изменения структуры repo;
- нового постоянного extension;
- изменения parser architecture;
- нового важного cross-system workflow;
- подтверждённых internal endpoints;
- существенного изменения Bitrix/Strapi migration;
- новых правил локализации/translation;
- крупных устойчивых решений.

Не обязательно обновлять после каждого patch, если snapshot не становится вводящим в заблуждение.

Если меняется структура/назначение repo — одновременно актуализировать README.

`promts/project-instructions.md` менять только когда меняются operational rules, а не ради добавления каждого нового технического факта.

---

# 21. Что считать source of truth

```text
текущая инструкция пользователя
→ Project Instructions
→ актуальный GitHub / API / Network / UI
→ project-context.md
→ история чатов / старые snapshots
```

Для текущей версии extension/parser всегда читать GitHub заново.

Для текущего API shape всегда смотреть реальный response/Network.

Для Bitrix internal behavior всегда опираться на реально снятый Network/DOM, а не угадывать endpoint/property.
