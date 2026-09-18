# project-context.md

> Knowledge layer проекта: устойчивые факты, архитектура, подтверждённые endpoints/workflows, snapshots и полезная история.
>
> Operational rules не дублируются: стиль ответа, code review, правила GitHub/API/parsers/ТЗ и массовых write живут в Project Instructions.
>
> Рабочий context — этот файл, загруженный непосредственно в ChatGPT Project. `project/project-context.md` в GitHub — только backup/sync snapshot.
>
> Для изменяемого состояния актуальные GitHub code/manifest, API, Network и UI выше snapshot из этого файла.

**Последняя сборка:** 2026-09-18  
**Repo:** `mbtema/strapi`  
**Strapi backend:** `http://10.10.3.80:1337`  
**Локали:** `ru`, `kk`

---

# 1. Проект и рабочая среда

Strapi — CMS для мобильного приложения MonAmie и связанных e-commerce/content процессов. Основные системы: Strapi Content Manager/Public REST/Internal API, Flutter/mobile, Bitrix, BFF, Postman, DevTools/browser JS, Tampermonkey, GitHub, Node.js/PowerShell, Notion, n8n/Make, CSV.

Диагностическая модель:

```text
Strapi data → API response → Flutter/mobile
```

Если Strapi и API корректны, следующая зона проверки — клиент.

Ограничения Strapi Admin:
- нет свободного изменения collection schemas;
- нет свободного управления Public API roles/permissions;
- `/api/auth/local` может возвращать `400`;
- практические обходные пути: текущая admin-session, Network, internal API, Postman, browser scripts.

Основной идентификатор Strapi — `documentId`. `barcode` — важный SKU/cross-system ключ, особенно Bitrix ↔ Strapi, но внутри Strapi приоритет у `documentId`.

Частые поля/relations:

```text
id, documentId, barcode, active, isInStock, locale
products, attributes/offers, brand, category, categories
volume, shade, price
detail_picture, preview_picture
name, name_web, title, slug, shareUrl
bitrix_id, xml_id, code_1c
```

У product одновременно существуют relations `category` и `categories`. Для текущего catalog healthcheck и фактического каталога рабочим relation является `categories`. Полную семантическую разницу нужно проверять по актуальному API/client.

---

# 2. API, DevTools и Postman

Public API поддерживает:

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

Для internal API фактический Network request всегда важнее исторического endpoint/payload.

DevTools:
- Network — endpoint/method/query/body;
- Application / LocalStorage / Cookies — session/debug;
- Console — browser scripts и DOM/UI diagnostics;
- `parsers/dom-stealer.js` копирует `document.documentElement.outerHTML` в Clipboard.

Postman: `postman/admin-api.json`.

Базовые variables:

```text
baseUrl = http://10.10.3.80:1337
contentManagerUrl = http://10.10.3.80:1337/content-manager
bffUrl = https://bff2.monamie.kz
```

Частые paths: `/api/products`, `/api/attributes`, `/api/categories`, `/api/brands`, `/api/promotions`, `/api/volumes`, `/api/shades`, `/api/home-page`.

Secret variables (`jwtToken`, `bearerToken`, `categoryDebugToken`) в GitHub не заполняются.

---

# 3. GitHub repo, loader и extensions

Ключевая структура main:

```text
extension/
  loader.js
  manifest.json
features/
  manifest.json
  barcode-extractor.js
  ctrl-enter-publisher.js
  parser-launcher.js
  vimium-open-row.js
ui-ux/
  manifest.json
  sidebar.js
  entry-relocate.js
  list-view.js
  product-attributes-navigator.js
  product-sections.js
  record-list-scrollbars.js
parsers/
  manifest.json
  ...
migrator/
  detail-picture-audit.js
  detail-picture-migrator.js
postman/
  admin-api.json
project/
  project-context.md
  project-instructions.md
```

`project/` — backup/sync snapshot Project Context/Instructions; в runtime и обычной работе не участвует.

Tampermonkey использует один loader: `extension/loader.js` `1.3.2`.

Loader:
- стартует cached extensions;
- читает корневой `extension/manifest.json`;
- все manifests используют `schemaVersion: 1`; это версия формата manifest, не версия extension;
- по нему загружает manifests рабочих папок (`ui-ux/manifest.json`, `features/manifest.json`);
- объединяет их в единый registry и валидирует глобальные дубли `id/path`;
- обновляет только изменившиеся extensions;
- cache: `tm-strapi-extensions-cache-v1`;
- если root/child manifest недоступен или некорректен, новый cache не записывается и при наличии старого loader продолжает работу из него;
- `checkUpdates()` в Console принудительно сравнивает установленный loader и cached extensions с GitHub, скачивает изменившиеся extensions в cache и сообщает о необходимости reload; новая версия самого userscript применяется через Tampermonkey.

Актуальные manifests 2026-09-18:

| id | version |
|---|---:|
| sidebar | 2.2.5 |
| record-list-scrollbars | 1.0.5 |
| list-view | 1.3.1 |
| entry-relocate | 1.4.6 |
| product-attributes-navigator | 1.0.4 |
| product-sections | 1.1.1 |
| barcode-extractor | 1.4.3 |
| ctrl-enter-publisher | 1.2.1 |
| parser-launcher | 1.6.3 |
| vimium-open-row | 1.1.3 |

Текущее поведение:
- `sidebar.js`: `Alt+S`, width 320, поиск CT/ST, quick links Товары/Предложения, группы Каталог/Справочник/Фильтры/Прочее, unknown CT → Фильтры, Single Types → Прочее, Settings gear hidden, active collection highlighted; hidden/visible state хранится в `sessionStorage` для текущей вкладки и переживает обычный reload.
- `record-list-scrollbars.js`: скрывает scrollbar/overflow decoration, сохраняя прокрутку.
- `entry-relocate.js`: переносит реальные React Entry actions к status area.
- `list-view.js`: скрывает `To be released in`, компактный `Available in`, RU/KK pills.
- `barcode-extractor.js`: `Alt+B` копирует barcode из реального `input[name="barcode"]`; вне подходящей карточки hotkey не перехватывается.
- `ctrl-enter-publisher.js`: `Alt+Enter` нажимает штатный Publish, только если кнопка найдена и доступна.
- `vimium-open-row.js`: keyboard/Vimium navigation.
- `parser-launcher.js`: `Alt+P`; строго валидирует `parsers/manifest.json`, блокирует повторный managed run одного parser и для GET повторяет временные network / `429` / `5xx` ошибки.

## Product attributes navigator

`ui-ux/product-attributes-navigator.js` `1.0.4`.

Scope:

```text
/admin/content-manager/collection-types/api::product.product/<productDocumentId>
input[type="relation"][name="attributes"]
```

Подтверждённый native endpoint:

```text
GET /content-manager/relations/api::product.product/<productDocumentId>/attributes?locale=ru&pageSize=5&page=2
```

Response содержит pagination и `results[]` с `id`, `documentId`, `name_web`, `publishedAt`, `updatedAt`, `locale`, `status`.

Custom navigator:
- fetch all pages (`API_PAGE_SIZE=100`);
- search по `name_web` и `documentId`;
- UI page 10;
- direct links на attribute card;
- status;
- native relation-list hidden by default.

`Управление связями` раскрывает native list выше custom navigator, auto-click `Load More`, увеличивает viewport 270→540. Remove/reorder остаются native React form state. Custom navigator показывает сохранённые API relations, поэтому unsaved reorder/remove видны только после save.

## Product sections

`ui-ux/product-sections.js` `1.1.1` делит Product card на `Контент`, `Фильтры`, `Системное`. Основное определение поля — реальный API `name` в DOM; hint/label используется только как ограниченный fallback.

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

Остальное остаётся в `Контенте`. Скрипт скрывает/показывает существующие React-поля, не создаёт их копии.

---

# 4. Parser health layer

`parsers/manifest.json` содержит 15 parsers и является runtime-источником регистрации: `file`, semver `version`, `group`.

Product health:

```text
products-without-attributes
products-without-brand
products-without-categories
products-with-duplicate-fields
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

Draft/audit:

```text
attributes-with-barcode-issues
```

Service: `dom-stealer`.

Ключевая логика:
- without-attributes/brand/categories — соответствующие проверки active products;
- `products-with-duplicate-fields` `1.1.0` проверяет только `key`, `code_1c`, `bitrix_id`, `xml_id`, `code`; null/empty игнорируются; отдельная группа/CSV row на каждый конфликтующий field;
- `products-with-wrong-prices` `1.2.1`: сначала через Public API собирает `documentId` предложений active products, затем через authenticated Content Manager читает актуальные `barcode`/`price` и формирует CSV `barcode;price;errorType`; проверяются missing/zero/non-numeric/fractional значения;
- missing-content — active product без `name1`, `name2`, `detail_picture` или `detail_text`; товары в categories `kns3po2mz8hq9kezm3szbvjg` и `a4zy2gvb479ku9nd6py5uxzh` исключаются из этой проверки как служебные;
- wrong-variants — >1 offers нельзя последовательно выбирать одним типом `shade` или `volume`;
- attributes-without-product — published scope через Public API; drafts не входят;
- attributes-without-detail-picture — product active, offer isInStock, `detail_picture` null;
- missing-shades — published attribute с `color_variant1C`, без `shade`, связанный с active product; `active` самого attribute сейчас отдельным filter не является;
- shade-and-volume — published scope через Public API; одновременно заполнены shade и volume;
- sort-volume — неверный порядок volume;
- volume-checker — неоднородные единицы volume;
- `attributes-with-barcode-issues` — published offers без barcode и с повторяющимися barcode; без filter по `active`/`isInStock`, с product context в CSV.

Последний прогон `products-with-duplicate-fields`: 21810 товаров Public API, 0 duplicate groups по всем пяти fields. В Content Manager в тот момент было 21849 entries; разница вероятно draft/unpublished. Parser оставлен как проверка опубликованного каталога через `/api/products`.

`products-without-categories` — контрольный список. Автоматическое назначение categories из Bitrix не считается безопасным default из-за бизнес-логики и исключений.

Parser Launcher:
- manifest должен иметь `schemaVersion: 1`;
- записи валидируются по `file` / semver `version` / `group` и duplicate file;
- managed regular parsers получают global run-lock и ограниченный retry для GET при network errors, `429` и `5xx`; постоянные `4xx` не ретраятся.

Актуальные технические дефекты parsers/Launcher не дублируются в этом snapshot: live backlog хранится в GitHub Issues.
---

# 5. Нормализация `attributes.name_web` — 2026-09-11

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

`active` и product relation не были условиями. Подтверждено 134 attributes с одновременно заполненными shade+volume.

Рабочий partial update:

```text
PUT /content-manager/collection-types/api::attribute.attribute/<documentId>?locale=ru
{"name_web":"<new value>"}
```

После массового прогона кратковременно были 504 Strapi/nginx; causality не доказана. `name_web` теперь основной читаемый label предложений в relations/navigator. Постоянного normalizer script в repo нет.

---

# 6. Bitrix → Strapi

Bitrix — source system части legacy product/offer данных.

## Detail picture migration

Текущий browser audit работает напрямую по торговым предложениям Bitrix `IBLOCK_ID=2`, а не через поиск родительского товара в `IBLOCK_ID=1`.

Browser audit:

```text
CSV Strapi (barcode + productDocumentId)
→ все страницы offers Bitrix IBLOCK_ID=2
→ exact barcode match
→ DETAIL_PICTURE из строки списка
→ карточка конкретного offer только если изображение нельзя получить из списка
→ checkpoint + mapping CSV
```

Bitrix barcode column — `PROPERTY_19`. Matching — exact barcode.

Repo:

```text
migrator/detail-picture-audit.js      2.0.0
migrator/detail-picture-migrator.js   1.0.1
```

Pipeline:

```text
Bitrix browser audit offers → mapping CSV → local Node migrator
→ image download → Strapi upload → partial PUT detail_picture
→ publish ru → verify
```

Upload:

```text
POST http://10.10.3.80:1337/upload
Authorization: Bearer <jwtToken>
multipart: files + fileInfo
```

Update:

```text
PUT /content-manager/collection-types/api::attribute.attribute/<documentId>?locale=ru
```

Publish:

```text
POST /content-manager/collection-types/api::attribute.attribute/<documentId>/actions/publish?locale=ru
body: {}
```

Исторический production run 2026-09-09/10 был выполнен предыдущей версией audit pipeline: audit total 3231; ok 3151; no_detail_picture 59; product_not_found 11; offer_not_found 10. Production: success 3139; already_filled 7; manual duplicate-barcode 5. Системных pipeline errors не выявлено. Эти числа — история выполненной миграции, а не описание текущего `2.0.0` browser audit.

Migrator: documentId-first, barcode extra check, checkpoint `*.migration-state.json`, result CSV; `upload_uncertain` не auto-retry, чтобы не дублировать media. Windows: Node/PowerShell, `STRAPI_JWT` в env; для monamie.kz подтверждён `--use-system-ca` из-за прежнего `SELF_SIGNED_CERT_IN_CHAIN`.

## Bitrix category «Товары для каспи» — 2026-09-14

Скрытая веб-категория товаров, которые должны существовать в CMS, но не быть доступны обычным пользователям.

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

Для mapping используется `bitrix_id`. Pagination — `PAGEN_1`; первый вариант скрипта собрал неполный список, рабочий вариант явно проходит `PAGEN_1=1..N`.

В CSV встречался `bitrix_id=0`; его исключаем. После очистки текущий список для проверки Strapi — 73 ID.

Цель: найти эти товары в Strapi и затем связать с аналогичной скрытой категорией. Public API не показывает draft/unpublished, поэтому отсутствующие там при необходимости нужно дополнительно проверить через Content Manager.

---

# 7. Mobile CMS / deeplink / media

Home — Single Type + Dynamic Zone. Частые components:

```text
home.main-banners
home.highlights-slider
home.product-slider
home.product-grid
```

Частые fields: `title`, `deeplink`, `mode`, `maxItems`, `products`.

Исторический кейс: API отдавал несколько products, mobile показывал один — client-side проблема при корректном API.

Deeplink: `monamie://...`; корректный syntax не гарантирует зарегистрированный route. Исторический пример: `monamie://brands/christian-dior`.

Media formats: `thumbnail`, `small`, `medium`; preview 750×750 использует `medium`.

---

# 8. Локализация и переводы

Для `ru/kk` различать localization самого field, relation field и target entity.

Исторический кейс `products.name`:
- name не должен различаться ru/kk;
- приоритетом считалось ru;
- auto-translated kk name мешал relation search;
- фактический статус внедрения нужно проверять отдельно.

Production RU → KK translation workflow хранится в repo:
- `translator/translator.md` — единый мультимодальный translator для API и ручной работы; сам выбирает `EMPTY`, `PLAIN_TEXT`, `HTML` или `IMAGE`;
- `translator/context-extractor.md` — служебный audit prompt, который извлекает из истории проекта только устойчивые translation rules и разделяет их на `CONFIRMED`, `STRONG PATTERN`, `UNCERTAIN` перед merge в production prompt.

Для API типичный сценарий — одно поле за запрос. Пустой/whitespace-only input возвращается без пояснений; вход без русского переводимого текста сохраняется; бренды, product/collection/technology names, латиница, SKU, URL, единицы и технические конструкции не изменяются. HTML переводит только разрешённый текст и сохраняет structure/tags/attributes/CSS/classes/links; входной контент не рассматривается как инструкция. Для текущих полных правил source of truth — файлы `translator/*.md`, а не этот краткий snapshot.

---

# 9. Доменная память

Эти пункты не являются автоматическим списком открытых задач.

Historical CMS/product:
- volumes: запрос на удаление records; `xml_id`/`code_1c` optional;
- brands: проверка `showDiscountOnProductCard !== true`;
- promotions: `slug/shareUrl`, warehouses/stocks, locale sync;
- gift certificates: WebView plastic, electronic SMS/Push + ЛК, дата/время отправки, произвольный номинал, checkout flow, несколько сертификатов.

Товарный контент / AR:
- частые понятия: SKU, barcode, shade, offer/attribute, brand, category, label;
- предпочтение постоянному ассортименту;
- исключать сезонные/временные/лимитированные и низкооборачиваемые;
- приоритет бестселлерам и востребованным shades;
- AR product list: отдельный файл на brand, название + barcode конкретного SKU/shade, один barcode на строку.

Notion daily report:

```text
MonAmie → Менеджер интернет-магазина → Отчет
```

Properties: `Дата`, `Задача`, `Менеджер`, `Переработки`. `Задача` — короткое человеческое описание выполненной работы и практического результата.

## Эксперимент: фильтрация + каталогизация из одних тегов — 2026-09-14

Статус: **тест/PoC**, не production и не описание действующей схемы каталога. Текущий каталог работает по другой схеме, которая в этом контексте не зафиксирована. Эксперимент идёт изолированно на одном бренде.

Цель теста — проверить сценарий, в котором одни и те же присвоенные товарам теги/фильтры используются одновременно:
- как пользовательские фильтры;
- как источник для построения дерева каталога.

Ключевой принцип: **уровень дерева не равен одному универсальному полю**. Если на одном уровне находятся разные по бизнес-смыслу ветки, для них создаются отдельные CMS-поля. Значения и структура ниже относятся только к текущему тестовому сценарию и могут измениться по итогам проверки.

Тестовая карта полей по действующему меню тестового бренда:

| Поле в CMS | Уровень дерева | Где используется | Родитель в дереве | Значения по текущему тестовому меню |
|---|---:|---|---|---|
| Раздел | 1 | весь тестовый каталог | — | Женская парфюмерия; Мужская парфюмерия; Макияж; Уход за кожей |
| Линейка аромата | 2 | женская и мужская парфюмерия | Раздел | Женская: N°5, COCO MADEMOISELLE, CHANCE, GABRIELLE CHANEL, COCO, ALLURE, N°19, CRISTALLE. Мужская: BLEU DE CHANEL, ALLURE HOMME, ALLURE HOMME SPORT, EGOISTE |
| Зона нанесения | 2 | макияж | Раздел = Макияж | Лицо; Глаза; Губы; Ногти |
| Категории ухода | 2 | уход за кожей | Раздел = Уход за кожей | По категориям |
| Гаммы ухода | 2 | уход за кожей | Раздел = Уход за кожей | По гаммам |
| Категория макияжа | 3 | макияж | Зона нанесения | Лицо: Тональные средства, Румяна, Пудры, Хайлайтеры, Корректоры, Кисти и аксессуары. Глаза: Туши для ресниц, Тени для век, Подводка для глаз, Брови. Губы: Помады для губ, Жидкая помада для губ, Блеск для губ, Бальзамы и уход за губами, Карандаши для губ. Ногти: Лак для ногтей, Маникюр |
| Категория ухода | 3 | уход за кожей | Категории ухода = По категориям | Снятие макияжа и очищение; Лосьоны и тоники; Сыворотки; Кремы; Специальный уход для кожи вокруг глаз и губ; Защита; Гоммажи и маски; Дымки; Уход за телом |
| Гамма ухода | 3 | уход за кожей | Гаммы ухода = По гаммам | SUBLIMAGE; HYDRA BEAUTY; N°1 DE CHANEL; LE LIFT & LE LIFT PRO; Средства для снятия макияжа; LA CRÈME MAIN |

Тестовые цепочки дерева:

```text
Женская парфюмерия
→ Линейка аромата

Мужская парфюмерия
→ Линейка аромата

Макияж
→ Зона нанесения
→ Категория макияжа

Уход за кожей
→ Категории ухода
→ Категория ухода

Уход за кожей
→ Гаммы ухода
→ Гамма ухода
```

Важно: `Категории ухода` и `Гаммы ухода` в рамках этого PoC считаются отдельными полями второго уровня, а не служебными узлами, потому что дерево в тестовом сценарии строится именно из тегов, присвоенных товарам. Не переносить эту модель на production-каталог без отдельного подтверждения.

---

# 10. Security decisions

Strapi Admin JWT доступен в LocalStorage и используется как локальный credential для admin requests.

Реальные tokens/cookies не хранить в repo, документации или shared snippets.

`mbtema/strapi` сознательно остаётся public: loader/Parser Launcher используют прямую загрузку из GitHub. В repo reviews не поднимать публичность как отдельную проблему, если пользователь сам не вернулся к вопросу или нет реальной утечки credentials/secrets.

Актуальный code-review backlog хранится в GitHub Issues. Snapshot context не должен зеркалить список открытых issues: здесь сохраняются только устойчивые решения, workflows и полезная история.

---

# 11. Project ↔ `project/` workflow

Рабочие источники находятся непосредственно в ChatGPT Project:

```text
Project Instructions
+
project-context.md
```

GitHub-копии:

```text
project/project-instructions.md
project/project-context.md
```

— backup/sync snapshot для редактирования, дополнения, сравнения и переноса обратно в Project; в обычной работе source of truth ими не являются.

Распределение:

```text
правило поведения/приоритет/формат → Project Instructions
архитектура/endpoint/response/workflow/history → project-context.md
current code/version/manifest → реальные GitHub files
```

При появлении подтверждённой устойчивой информации сначала обновляется соответствующий слой Project, затем синхронизируется копия в `project/`.

README отражает сам repo: структуру, назначение, установку, использование и основные инструменты; обновляется при repo-facing изменениях, а не при любой внутренней project history.

Приоритет:

```text
поведение:
current user instruction → Project Instructions

project knowledge:
project-context.md в Project

current technical state:
GitHub code / API / Network / UI → snapshot context
```
