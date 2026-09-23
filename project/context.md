# context.md

> Knowledge layer проекта. Здесь хранятся устойчивые факты, подтверждённые data/API contracts, архитектурные решения, CANONICAL workflows, доменная память, полезная история и эксперименты.
>
> Этот файл не задаёт стиль работы и operational rules — они живут в Project Instructions.
>
> Для текущего code/version/manifest/Issue/API payload/Network/UI всегда проверять live source; изменяемое техническое состояние выше этого snapshot.

**Последняя консолидация:** 2026-09-23  
**Repo:** `mbtema/strapi`  
**Strapi backend:** `http://10.10.3.80:1337`  
**Локали:** `ru`, `kk`

## Статусы знаний

- **CANONICAL** — подтверждённый текущий путь/решение; при повторении задачи это стартовая точка.
- **HISTORICAL** — завершённая история и полезные выводы; не считать описанием текущего состояния.
- **EXPERIMENT** — PoC/тест; не переносить в production автоматически.
- **SUPERSEDED** — старый подход; хранится только чтобы не возвращаться к нему без причины.

---

# 1. Stable project model

Strapi — CMS для мобильного приложения MonAmie и связанных e-commerce/content процессов. Рабочая экосистема: Strapi Content Manager/Public REST/Internal API, Flutter/mobile, Bitrix, BFF, DevTools/browser JS, Tampermonkey, GitHub, Node.js/PowerShell, Notion, n8n/Make, CSV.

Базовая диагностическая модель:

```text
Strapi data → API response → Flutter/mobile
```

Если Strapi data и API response корректны, следующая зона проверки — клиент. Не менять CMS только для компенсации клиентского бага.

Основной идентификатор Strapi — `documentId`. `barcode` — важный SKU/cross-system ключ, особенно Bitrix ↔ Strapi, но внутри Strapi приоритет у `documentId`.

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

---

# 2. Architectural decisions

## CANONICAL — repo как набор независимых сервисов

Ментальная модель repo: отдельный folder/script — маленький функциональный сервис. Ошибка в одном extension/parser обычно влияет только на него и его output. Не считать локальную проблему архитектурной без фактической общей зависимости.

Общая инфраструктура extensions:
- единый Tampermonkey loader;
- централизованные registries в `manifests/`;
- shared cache/update mechanism.

Registry разделён по зонам ответственности, а не объединён в один огромный файл:
- `manifests/extensions.json` — root registry extension manifests;
- `manifests/features.json` — registry feature extensions;
- `manifests/ui-ux.json` — registry UI/UX extensions;
- `manifests/parsers.json` — registry parsers.

Сами сервисы остаются в своих папках; manifests — только регистрация/версии.

Loader использует cached extensions для быстрого старта, затем сверяет registry с GitHub. При изменении manifest signature скачиваются изменившиеся extensions, а новая cached версия применяется после reload. `checkUpdates()` вручную проверяет loader/extensions. Обновление самого userscript loader происходит через Tampermonkey.

## CANONICAL — Parser Launcher

Parser Launcher получает registry из `manifests/parsers.json`, а код parser — из `parsers/`.

Manifest parser содержит:

```text
file
semver version
group
```

Regular parser дополнительно содержит meta header с `name`, `version`, назначением и `output`; `@name` соответствует имени файла без `.js`, `@version` — manifest version. `service` parser может не иметь regular meta contract.

Managed regular parsers получают global run-lock. Для GET временные network errors / `429` / `5xx` могут повторяться; постоянные `4xx` не ретраятся.

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

Практическая трактовка ошибок:

```text
400 → body/query/relations/locale
403 → token/cookies/Authorization/permissions/session
404 → endpoint/UID/documentId/locale/namespace
```

Для internal API фактический Network request важнее сохранённого исторического endpoint/payload.

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

Практический navigator:
- забирает все relation pages;
- search по `name_web` и `documentId`;
- direct links на attribute card;
- native relation list остаётся источником несохранённого React form state для remove/reorder;
- custom navigator показывает сохранённое API state, поэтому unsaved изменения становятся видны там после Save.

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

Этот result — HISTORICAL evidence успешного workflow; при новом запуске объёмы получать заново.

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

HISTORICAL production result:

```text
total: 36660
barcodeOnly: 7510
volume: 18253
shade: 10763
shadeAndVolume: 134
final success: 36660
final failed: 0
```

Кратковременные `504` после массового run наблюдались, causality не доказана. Не делать из этого автоматический вывод о причине.

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

HISTORICAL: после очистки одного из прогонов было 73 ID; это не текущий count.

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

## Parser health semantics

Полезные смысловые проверки каталога:
- active products без attributes / brand / categories;
- duplicate technical fields `key`, `code_1c`, `bitrix_id`, `xml_id`, `code`; null/empty не считать duplicate value;
- wrong prices у offers active products: `missing`, non-numeric `invalid`, `zero`, `negative`, `fractional`; output включает уникальный `documentId` offer;
- missing content: active product без критичных content fields; служебные categories могут быть исключениями по текущей parser logic — exact IDs брать из live code;
- wrong variants: несколько offers нельзя последовательно выбирать одним типом `shade` или `volume`;
- attributes without product — published scope;
- attributes without detail picture — offer активного product, `isInStock=true`, `detail_picture=null`;
- missing shades — published offer с `color_variant1C`, без `shade`, связан с active product;
- shade-and-volume — published offer с одновременно заполненными shade и volume;
- barcode audit — published offers без barcode и с duplicate barcode, с product context.

`products-without-categories` — healthcheck, а не разрешение автоматически назначать categories из Bitrix. Автоназначение categories по Bitrix не является безопасным default из-за бизнес-логики и исключений.

---

# 6. Localization and translation

Для `ru/kk` различать:
- localization самого field;
- localization relation field;
- localization target entity.

Production RU → KK translation rules живут в `translator/full.md`; это специализированный source of truth для перевода.

Translator сам определяет тип входа `EMPTY`, `PLAIN_TEXT`, `HTML`, `IMAGE`.

Устойчивые принципы:
- пустой/whitespace-only input не требует пояснений;
- если русского переводимого текста нет, вход сохраняется;
- бренды, product/collection/technology names, латиница, SKU, URL, единицы и технические конструкции защищаются;
- в HTML переводится только разрешённый текст; structure/tags/attributes/CSS/classes/links сохраняются;
- накопленный translation context перед merge анализируется через `translator/extractor.md`.

HISTORICAL: `products.name` не должен был различаться между ru/kk; приоритетом считался ru, а auto-translated kk name мешал relation search. Фактическое текущее состояние этого поведения при новой задаче проверять отдельно.

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

HISTORICAL example: `monamie://brands/christian-dior`.

Media formats, встречавшиеся в API: `thumbnail`, `small`, `medium`; preview 750×750 использовал `medium`.

HISTORICAL diagnostic case: API отдавал несколько products, а mobile отображал один — при корректном API проблема была client-side. Это пример применения модели `Strapi → API → client`, не универсальное объяснение всех подобных багов.

---

# 8. Domain memory

Эти сведения не являются списком открытых задач.

Historical CMS/product topics:
- volumes: обсуждалось удаление records; `xml_id`/`code_1c` optional;
- brands: проверка `showDiscountOnProductCard !== true`;
- promotions: `slug/shareUrl`, warehouses/stocks, locale sync;
- gift certificates: WebView plastic; electronic SMS/Push + ЛК; дата/время отправки; произвольный номинал; checkout flow; несколько сертификатов.

Товарный контент / AR:
- частые понятия: SKU, barcode, shade, offer/attribute, brand, category, label;
- предпочтение постоянному ассортименту;
- сезонные/временные/лимитированные и низкооборачиваемые позиции обычно не приоритет;
- приоритет бестселлерам и востребованным shades;
- AR product list: отдельный файл на brand, название + barcode конкретного SKU/shade, один barcode на строку.

---

# 9. HISTORICAL — completed detail-picture migration

Это история выполненной миграции и подтверждённых технических приёмов. Не считать её текущим repo implementation.

Bitrix source:
- offers: `IBLOCK_ID=2`;
- barcode column: `PROPERTY_19`;
- matching: exact barcode.

Рабочая схема browser audit:

```text
CSV Strapi (barcode + productDocumentId)
→ все страницы offers Bitrix IBLOCK_ID=2
→ exact barcode match
→ DETAIL_PICTURE из строки списка
→ карточка конкретного offer только если image нельзя получить из списка
→ checkpoint + mapping CSV
```

Migration pipeline:

```text
Bitrix audit → mapping CSV
→ image download
→ Strapi upload
→ partial PUT detail_picture
→ publish ru
→ verify
```

Подтверждённые endpoint patterns:

```text
POST /upload
PUT /content-manager/collection-types/api::attribute.attribute/<documentId>?locale=ru
POST /content-manager/collection-types/api::attribute.attribute/<documentId>/actions/publish?locale=ru
```

Для upload использовались `Authorization: Bearer <jwtToken>` и multipart `files + fileInfo`.

Практический вывод: uncertain `POST /upload` нельзя blind auto-retry, потому что повтор может создать duplicate media.

HISTORICAL production 2026-09-09/10:

```text
audit total 3231
ok 3151
no_detail_picture 59
product_not_found 11
offer_not_found 10
production success 3139
already_filled 7
manual duplicate-barcode 5
```

Для Windows/Node в этом кейсе `STRAPI_JWT` передавался через env; для `monamie.kz` был подтверждён `--use-system-ca` из-за `SELF_SIGNED_CERT_IN_CHAIN`.

---

# 10. EXPERIMENT — filtering + catalog from the same tags

**Статус:** EXPERIMENT / PoC с 2026-09-14. Не production и не описание действующего каталога.

Цель: проверить, могут ли одни и те же tags/filters одновременно использоваться как:
- пользовательские фильтры;
- источник для построения дерева каталога.

Ключевой принцип PoC: **уровень дерева не равен одному универсальному полю**. Если на одном уровне находятся разные по бизнес-смыслу ветки, для них используются отдельные CMS fields.

Тестовая карта:

| Поле | Уровень | Контекст | Родитель | Примеры |
|---|---:|---|---|---|
| Раздел | 1 | весь тестовый каталог | — | Женская парфюмерия; Мужская парфюмерия; Макияж; Уход за кожей |
| Линейка аромата | 2 | парфюмерия | Раздел | N°5, COCO MADEMOISELLE, CHANCE, BLEU DE CHANEL, ALLURE HOMME... |
| Зона нанесения | 2 | макияж | Раздел = Макияж | Лицо; Глаза; Губы; Ногти |
| Категории ухода | 2 | уход | Раздел = Уход за кожей | По категориям |
| Гаммы ухода | 2 | уход | Раздел = Уход за кожей | По гаммам |
| Категория макияжа | 3 | макияж | Зона нанесения | Тональные, Румяна, Тушь, Тени, Помады... |
| Категория ухода | 3 | уход | Категории ухода = По категориям | Очищение, Лосьоны, Сыворотки, Кремы, Маски... |
| Гамма ухода | 3 | уход | Гаммы ухода = По гаммам | SUBLIMAGE, HYDRA BEAUTY, N°1 DE CHANEL, LE LIFT... |

Тестовые chains:

```text
Женская парфюмерия → Линейка аромата
Мужская парфюмерия → Линейка аромата
Макияж → Зона нанесения → Категория макияжа
Уход за кожей → Категории ухода → Категория ухода
Уход за кожей → Гаммы ухода → Гамма ухода
```

`Категории ухода` и `Гаммы ухода` в этом PoC считаются отдельными fields второго уровня, а не служебными nodes, потому что дерево тестово строится именно из tags, присвоенных products.

---

# 11. Security and repository decisions

- Реальные tokens/cookies не хранить в repo, документации или shared snippets.
- Strapi Admin JWT используется как локальный credential для admin requests.
- Public status `mbtema/strapi` — сознательное решение для прямой загрузки loader/Parser Launcher из GitHub. Сам по себе public repo не является дефектом; пересматривать это решение только при реальной утечке credentials/secrets или новом требовании.
- Live code-review backlog живёт в GitHub Issues; context хранит только устойчивые решения/workflows/history, а не список открытых тикетов.

---

# 12. SUPERSEDED / historical architecture

- Folder-local manifests вида `extension/manifest.json`, `features/manifest.json`, `ui-ux/manifest.json`, `parsers/manifest.json` были заменены централизованным `manifests/` 2026-09-23. Не использовать старые paths как default.
- В 2026-09-23 папки `migrator/` и `postman/` были удалены при упрощении repo. Исторические workflows выше сохранены как knowledge, но наличие текущей реализации всегда проверять в live repo.
