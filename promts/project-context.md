# project-context.md

> Knowledge layer проекта. Этот файл хранит устойчивые факты, архитектуру, подтверждённые endpoints/workflows, актуальные snapshots и полезную историю.
>
> **Operational rules здесь не дублируются**: стиль ответа, порядок code review, правила GitHub/API/parsers/ТЗ и ограничения массовых write-операций живут в Project Instructions.
>
> Рабочий context — этот файл, загруженный непосредственно в ChatGPT Project. `promts/project-context.md` в GitHub — только backup/sync snapshot и не используется как рабочий источник в обычных задачах.
>
> Для изменяемого состояния актуальные GitHub code/API/Network/UI данные выше snapshot из этого файла.

**Последняя сборка:** 2026-09-11  
**Repo:** `mbtema/strapi`  
**Strapi backend:** `http://10.10.3.80:1337`  
**Локали:** `ru`, `kk`

---

# 1. Проект и рабочая среда

Strapi используется как CMS для мобильного приложения MonAmie и связанных e-commerce/content процессов.

Основные системы и инструменты:

- Strapi Content Manager и Public REST API;
- internal Content Manager API;
- Flutter/mobile client;
- Bitrix как legacy/source system части товарных данных;
- BFF;
- Postman;
- DevTools / browser JavaScript;
- Tampermonkey;
- GitHub;
- Node.js + PowerShell/Terminal для migrations;
- Notion;
- n8n/Make;
- CSV/таблицы.

Главная диагностическая модель:

```text
Strapi data → API response → Flutter/mobile
```

Если данные в Strapi и API корректны, следующая зона проверки — клиент, а не CMS.

Ограничения Strapi Admin:

- нет свободного изменения collection schemas;
- нет свободного управления Public API roles/permissions;
- `/api/auth/local` может возвращать `400`;
- поэтому рабочие обходные пути часто строятся через текущую admin-session, Network, internal API, Postman и browser scripts.

---

# 2. Данные и ключевые сущности

Основной рабочий идентификатор Strapi — `documentId`.

Частые сущности/поля:

```text
id
documentId
barcode
active
isInStock
locale
products
attributes / offers
brand
category
categories
volume
shade
price
detail_picture
preview_picture
name
name_web
title
slug
shareUrl
bitrix_id
xml_id
code_1c
```

`barcode` используется как важный SKU/cross-system ключ, особенно в Bitrix ↔ Strapi, но внутри Strapi приоритет остаётся у `documentId`.

У product одновременно существуют relations `category` и `categories`. Для текущего catalog healthcheck и фактического отображения товара в каталоге рабочим relation является `categories`. Полную семантическую разницу `category`/`categories` нужно разбирать отдельно по актуальному API/client; не считать её закрытой только по старым предположениям.

---

# 3. Public API / Internal API / DevTools

Public API поддерживает рабочие query-параметры:

```text
filters
fields
populate
pagination
sort
locale
```

Используются nested relations, components, Dynamic Zones и локализованные relations.

Исторический пример минимального product query:

```text
http://10.10.3.80:1337/api/products?pagination[pageSize]=1&pagination[page]=1&fields[0]=documentId&populate[attributes][fields][0]=documentId&populate[attributes][populate][volume][fields][0]=name
```

Internal Content Manager namespace:

```text
/content-manager/collection-types/api::...
```

Admin JWT доступен в LocalStorage как `jwtToken`.

Типовая трактовка ошибок:

```text
400 → body/query/relations/locale
403 → token/cookies/Authorization/permissions/session
404 → endpoint/UID/documentId/locale/namespace
```

Для internal API фактический Network request всегда важнее исторического примера endpoint/payload.

DevTools:

- Network — подтверждение endpoint/method/query/body;
- Application / LocalStorage / Cookies — session/debug;
- Console — browser scripts и DOM/UI diagnostics.

Для сложного DOM используется `parsers/dom-stealer.js`, который копирует `document.documentElement.outerHTML` в Clipboard.

---

# 4. Postman

Основной файл:

```text
postman/admin-api.json
```

Базовые URL:

```text
baseUrl = http://10.10.3.80:1337
contentManagerUrl = http://10.10.3.80:1337/content-manager
bffUrl = https://bff2.monamie.kz
```

Основные path variables включают:

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

Общие variables: `page`, `pageSize`, `sort`, `locale`, `altLocale`, `active`, `documentId`, `productDocumentId`, `attributeDocumentId`, `barcode`.

Secret variables (`jwtToken`, `bearerToken`, `categoryDebugToken`) в GitHub не заполняются.

---

# 5. GitHub repo и loader

Текущая структура main:

```text
extension/
  loader.js
  manifest.json

features/
  barcode-extractor.js
  ctrl-enter-publisher.js
  parser-launcher.js
  vimium-open-row.js

ui-ux/
  sidebar.js
  entry-relocate.js
  list-view.js
  product-attributes-navigator.js
  record-list-scrollbars.js

parsers/
  manifest.json
  attributes-without-detail-picture.js
  attributes-without-product.js
  dom-stealer.js
  missing-shades.js
  shade-and-volume.js
  products-with-duplicate-bitrix-id.js
  products-with-missing-content.js
  products-with-wrong-prices.js
  products-with-wrong-variants.js
  products-without-attributes.js
  products-without-brand.js
  products-without-categories.js
  sort-volume.js
  volume-checker.js

migrator/
  detail-picture-audit.js
  detail-picture-migrator.js

postman/
  admin-api.json

promts/
  project-context.md
  project-instructions.md
```

`promts/` — только backup/sync snapshot Project Context/Instructions; в runtime и обычной работе не участвует.

Tampermonkey содержит один основной loader:

```text
extension/loader.js
version 1.1.1
```

Loader:

- стартует кешированные extensions;
- читает `extension/manifest.json`;
- обновляет изменившиеся extensions;
- сохраняет cache `tm-strapi-extensions-cache-v1`;
- при недоступном GitHub может продолжить работу из cache.

Manifest разрешает постоянные extensions из `features/*.js` и `ui-ux/*.js`.

Актуальный extensions manifest на 2026-09-11:

| id | version |
|---|---:|
| sidebar | 2.2.3 |
| record-list-scrollbars | 1.0.4 |
| list-view | 1.3.0 |
| entry-relocate | 1.4.5 |
| product-attributes-navigator | 1.0.2 |
| barcode-extractor | 1.4.1 |
| ctrl-enter-publisher | 1.1.1 |
| parser-launcher | 1.4.8 |
| vimium-open-row | 1.1.2 |

---

# 6. Текущие Strapi Admin extensions

## Sidebar

`ui-ux/sidebar.js` — единый sidebar-модуль.

Текущее поведение:

- sidebar видим по умолчанию;
- `Alt+S` плавно сворачивает/разворачивает sidebar;
- width 320px;
- поиск по Collection Types / Single Types;
- quick links `Товары` и `Предложения`;
- группы: `Каталог`, `Справочник`, `Фильтры`, `Прочее`;
- неизвестные Collection Types fallback в `Фильтры`;
- Single Types fallback в `Прочее`;
- Settings gear визуально скрыт, профиль сохранён;
- активная collection выделяется.

## Record list scrollbars

`record-list-scrollbars.js` `1.0.4` скрывает визуальные scrollbar/overflow decorations, сохраняя прокрутку. После фикса `1.0.4` корректно работает на разных collection list pages и SPA-переходах.

## Entry relocate

`entry-relocate.js` переносит штатные Entry actions к status area и освобождает ширину формы. Используются реальные Strapi buttons, чтобы сохранять React handlers/state.

## List view

`list-view.js`:

- скрывает `To be released in`;
- компактно оформляет `Available in`;
- показывает RU/KK как locale pills.

## Barcode extractor

`Ctrl+B` копирует barcode из карточки товара и показывает Strapi-style success/error toast.

## Ctrl+Enter publisher

`Ctrl+Enter` нажимает штатный Publish, если он доступен.

## Vimium open row

Добавляет минимальную row-link для keyboard/Vimium navigation по таблицам.

## Parser Launcher

`Alt+P` открывает parsers из `parsers/manifest.json`.

---

# 7. Product attributes navigator

Файл:

```text
ui-ux/product-attributes-navigator.js
version 1.0.2
```

Scope:

```text
/admin/content-manager/collection-types/api::product.product/<productDocumentId>
input[type="relation"][name="attributes"]
```

Подтверждённый native relation endpoint:

```text
GET /content-manager/relations/api::product.product/<productDocumentId>/attributes?locale=ru&pageSize=5&page=2
```

Response:

```text
pagination:
  page
  pageSize
  pageCount
  total

results[]:
  id
  documentId
  name_web
  publishedAt
  updatedAt
  locale
  status
```

Native Strapi relation-list:

- загружает по 5 записей через `Load More`;
- использует virtualized viewport высотой 270 px;
- клик по relation обычно открывает preview, а не прямую карточку.

Custom navigator:

- получает все relation pages автоматически (`API_PAGE_SIZE=100`);
- ищет по всему набору по `name_web` и `documentId`;
- UI pagination — 10 записей на страницу;
- показывает `Показано X–Y из N`;
- direct `<a>` ведёт в `api::attribute.attribute/<documentId>`;
- Ctrl/Cmd-click и middle click работают как обычные ссылки;
- placeholder поиска — `Поиск`;
- показывает status;
- штатный relation-list по умолчанию скрыт.

`Управление связями`:

- раскрывает штатный Strapi relation-list **выше custom navigator**;
- автоматически нажимает `Load More`, пока не загрузит весь список;
- увеличивает native viewport с 270 до 540 px;
- remove/reorder остаются штатными React-механизмами Strapi, чтобы не обходить form state.

Custom navigator читает сохранённые relations через API; несохранённые reorder/remove сначала живут в form state Strapi.

---

# 8. Parser health layer

Текущий `parsers/manifest.json` содержит 14 parsers.

Product health:

```text
products-without-attributes
products-without-brand
products-without-categories
products-with-duplicate-bitrix-id
products-with-wrong-prices
products-with-wrong-variants
products-with-missing-content
```

Offer/attribute health:

```text
attributes-without-product
attributes-without-detail-picture
missing-shades
shade-and-volume
sort-volume
volume-checker
```

Service:

```text
dom-stealer
```

Ключевая логика:

- `products-without-attributes` — active products без offers;
- `products-without-brand` — active products без brand;
- `products-without-categories` — active products без `categories`;
- `products-with-duplicate-bitrix-id` — `bitrix_id`, у которого больше одного уникального `documentId`;
- `products-with-wrong-prices` — active product с offer price=0/empty/non-numeric/fractional;
- `products-with-missing-content` — нет `name1`, `name2`, `detail_picture` или `detail_text`;
- `products-with-wrong-variants` — >1 offers нельзя последовательно выбирать одним типом `shade` или `volume`;
- `attributes-without-product` — offer без product;
- `attributes-without-detail-picture` — product active, offer isInStock, detail_picture null;
- `missing-shades` — active offer с `color_variant1C`, но без shade;
- `shade-and-volume` — одновременно заполнены shade и volume;
- `sort-volume` — неверный порядок volume;
- `volume-checker` — неоднородные единицы volume.

`products-without-categories` используется как контрольный список. Автоматическое назначение categories из Bitrix не считается безопасным default: распределение содержит бизнес-логику и исключения.

---

# 9. Нормализация `attributes.name_web` — 2026-09-11

Полностью обработано:

```text
total: 36660
barcodeOnly: 7510
volume: 18253
shade: 10763
shadeAndVolume: 134
alreadyCorrect before run: 3
willChange before run: 36657
final success: 36660
final failed: 0
```

Правило:

```text
нет shade и volume → barcode
только volume       → barcode + " - " + volume.name
только shade        → barcode + " - " + shade.name
есть shade + volume → barcode
```

`name_web` перезаписывался независимо от старого значения; `active` и наличие product relation не были условиями.

Отдельно подтверждено 134 attributes с одновременно заполненными `shade` и `volume`.

Рабочий partial update:

```text
PUT /content-manager/collection-types/api::attribute.attribute/<documentId>?locale=ru
```

Body:

```json
{"name_web":"<new value>"}
```

Strapi принял минимальный partial body без отправки всей записи.

После массового прогона кратковременно наблюдались `504` на Strapi/nginx, включая `/admin/init` и `/api/attributes`; сервис восстановился самостоятельно. Причинность не доказана, но write-массовки такого размера далее должны выполняться осторожно.

`name_web` теперь является основным читаемым display label предложений в relations/navigator.

Отдельного постоянного `normalize-attribute-name-web.js` в repo пока нет; это был разовый write-workflow.

---

# 10. Bitrix → Strapi: detail_picture migration

Bitrix — source system для части legacy product/offer данных.

Подтверждённый browser audit workflow:

```text
CSV из Strapi
→ barcode
→ Bitrix admin filter
→ parent product
→ конкретный offer
→ DETAIL_PICTURE URL
→ mapping CSV
```

Для barcode в Bitrix filter подтверждено поле:

```text
PROPERTY_19
```

Реальные offer rows:

```css
input[name="SUB_ID[]"]
```

Matching offer выполняется по точному barcode.

Repo:

```text
migrator/detail-picture-audit.js        1.0.0
migrator/detail-picture-migrator.js     1.0.1
```

Архитектура:

```text
Bitrix browser audit
→ mapping CSV
→ local Node migrator
→ image download
→ Strapi upload
→ partial PUT detail_picture
→ publish ru
→ verify
```

Проверенный upload:

```text
POST http://10.10.3.80:1337/upload
Authorization: Bearer <jwtToken>
multipart: files + fileInfo
```

Проверенный update:

```text
PUT /content-manager/collection-types/api::attribute.attribute/<documentId>?locale=ru
```

Для `detail_picture` работает partial body с одним relation field.

Publish:

```text
POST /content-manager/collection-types/api::attribute.attribute/<documentId>/actions/publish?locale=ru
body: {}
```

Audit 2026-09-09:

```text
total mapping: 3231
ok: 3151
no_detail_picture: 59
product_not_found: 11
offer_not_found: 10
```

Production migration 2026-09-10:

```text
success: 3139
already_filled: 7
manual duplicate-barcode cases: 5
```

Системных ошибок pipeline не выявлено.

Migrator использует documentId-first, barcode как дополнительную проверку, checkpoint `*.migration-state.json` и result CSV. `upload_uncertain` не ретраится автоматически, чтобы не создавать duplicate media.

На Windows миграция запускается через Node/PowerShell; `STRAPI_JWT` хранится в env, не в repo. Для `monamie.kz` подтверждён запуск Node с `--use-system-ca` из-за ранее встречавшегося `SELF_SIGNED_CERT_IN_CHAIN`.

---

# 11. Mobile CMS / deeplink / media

Главная — Single Type + Dynamic Zone.

Частые components:

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

Исторический кейс: Strapi/API отдавал несколько `products`, а mobile показывал один — это client-side проблема, если API response корректен.

Deeplink использует схему:

```text
monamie://...
```

Синтаксически корректная строка не гарантирует рабочий route. Исторический пример:

```text
monamie://brands/christian-dior
```

Для Media Library известны `thumbnail`, `small`, `medium`; для preview 750×750 используется `medium`.

---

# 12. Локализация и переводы

Для `ru/kk` различать:

- локализацию самого field;
- локализацию relation field;
- локализацию target entity.

Исторический кейс `products.name`:

- `name` не должен различаться между ru/kk;
- приоритетом считалось ru;
- auto-translated kk name мешал relation search;
- статус фактического внедрения нужно проверять отдельно.

Plain text translator используется для небольших текстов.

HTML translator — для descriptions/articles/custom pages/HTML из Bitrix:

- переводится только текст;
- tags/CSS/classes/links/structure сохраняются;
- английский без необходимости не переводится;
- казахский должен быть естественным, без буквальной кальки.

---

# 13. Исторические CMS/product задачи

Эти пункты — доменная память, не автоматический список открытых задач.

`volumes`:

- был запрос дать Content Manager удаление records;
- `xml_id` и `code_1c` сделать необязательными.

Brands:

- выполнялась проверка `showDiscountOnProductCard !== true`.

Promotions:

- были ТЗ по `slug/shareUrl`;
- warehouses/stocks;
- синхронизации локалей.

Gift certificates — исторические UX-требования включали:

- plastic certificate временно через WebView;
- убрать лишние delivery/store тексты;
- electronic certificate: SMS/Push + ЛК «Мои сертификаты»;
- выбор даты/времени отправки;
- произвольный номинал;
- после добавления вести к оплате;
- сохранять несколько сертификатов и показывать их перед оплатой.

Vimium использовался для keyboard navigation; для копирования barcode практическим решением стал `barcode-extractor.js` (`Ctrl+B`).

---

# 14. Товарный контент / AR assortment

Частые понятия:

```text
SKU
barcode
shade
offer / attribute
brand
category
label
```

Для ассортиментных подборок предпочтительны:

- постоянный ассортимент;
- исключение сезонных/временных/лимитированных;
- исключение низкооборачиваемых;
- приоритет бестселлерам;
- приоритет востребованным/коммерчески значимым shades.

AR product list:

- отдельный файл на brand;
- columns: название товара + barcode конкретного shade/SKU;
- каждый barcode отдельной строкой;
- лишние internal fields/prices/categories не нужны;
- оцифровка может идти отдельно по каждому barcode/shade.

---

# 15. Notion и ежедневные отчёты

Рабочая база daily report:

```text
MonAmie
→ Менеджер интернет-магазина
→ Отчет
```

Properties:

```text
Дата
Задача
Менеджер
Переработки
```

Отчёт в `Задача` — короткое человеческое описание сделанной работы, понятное нетехническому читателю и показывающее практический результат.

Workspace используется с одним основным администратором; внешние пользователи обычно guests.

---

# 16. Security decisions

Strapi Admin JWT технически доступен в LocalStorage и используется как локальный credential для собственных admin requests.

Реальные tokens/cookies не хранить в repo, документации или shared snippets.

`mbtema/strapi` **сознательно остаётся public**: loader/Parser Launcher используют прямую загрузку из GitHub без дополнительной авторизации.

Это принятое решение: в последующих repo reviews не поднимать публичность как отдельную проблему и не предлагать приватизацию, если пользователь сам не вернулся к вопросу или не обнаружена реальная утечка credentials/secrets.

---

# 17. Project ↔ `promts/` workflow

Рабочие источники:

```text
Project Instructions
+
project-context.md внутри ChatGPT Project
```

GitHub:

```text
promts/project-instructions.md
promts/project-context.md
```

— только backup/sync snapshot.

Правильная схема:

```text
работа в Project
→ накопилось устойчивое правило или новый контекст
→ обновить Project Instructions / Project Context
→ сохранить свежую копию в GitHub promts/
→ при необходимости перенести snapshot обратно в Project
```

Во время обычной работы, code review, API diagnostics или изменения scripts `promts/*` не открывать для получения инструкций/контекста.

Распределение:

```text
постоянное правило поведения/приоритет/формат → Project Instructions
архитектура/endpoint/response/workflow/history → project-context.md
текущий code/version/manifest                  → реальные GitHub files
```

Если меняется структура repo, README и context snapshot должны быть актуализированы.

Приоритет:

```text
поведение:
current user instruction → Project Instructions

project knowledge:
project-context.md в Project → historical context

current technical state:
GitHub code / API / Network / UI → project-context snapshot
```
