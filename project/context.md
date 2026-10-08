# context.md

> Knowledge layer проекта. Здесь хранятся устойчивые факты, подтверждённые data/API contracts, архитектурные решения, CANONICAL workflows, доменная память, полезная история и эксперименты.
>
> Этот файл не задаёт стиль работы и operational rules — они живут в Project Instructions.
>
> Для текущего code/version/manifest/Issue/API payload/Network/UI всегда проверять live source; изменяемое техническое состояние выше этого snapshot.

**Последняя консолидация:** 2026-10-08  
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

Parser-файлы не содержат собственные metadata-блоки. Runtime-регистрация и версия (`file`, `version`, `group`) задаются только в `manifests/parsers.json`. Userscript metadata используется только в `extension/loader.js`, потому что только loader устанавливается напрямую в Tampermonkey.

Managed regular parsers получают global run-lock. Для GET временные network errors / `429` / `5xx` могут повторяться; постоянные `4xx` не ретраятся.


## CANONICAL — Network Recorder

`network-recorder.js` — отдельный service parser для быстрого Network-контекста Strapi; `dom-stealer.js` остаётся только DOM snapshot utility.

Workflow:
- первый запуск через Parser Launcher → Start;
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

## CANONICAL — source для массовых data-audit parsers

Массовые audit parsers проверяют фактическое текущее состояние CMS только через Content Manager API. Public REST `/api/...` не используется как source для таких проверок, потому что published view не отражает draft/modified current state; Public API проверяется отдельно через Postman/client/API diagnostics.

Базовый read pattern:
- list/detail: `/content-manager/collection-types/api::...`;
- relations: `/content-manager/relations/api::.../<documentId>/<field>`;
- `Authorization: Bearer <jwtToken>` + `credentials: include`;
- для текущих catalog audits используется `locale=ru`;
- все страницы читаются полностью, relation checks идут через native Content Manager relation endpoint;
- при несовпадении ожидаемого Content Manager response parser должен остановиться с явной ошибкой, а не формировать потенциально ложный CSV.

Практическая трактовка ошибок:

```text
400 → body/query/relations/locale
403 → token/cookies/Authorization/permissions/session
404 → endpoint/UID/documentId/locale/namespace
```

Для internal API фактический Network request важнее сохранённого исторического endpoint/payload.

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

## CANONICAL — attributes wrong prices

Назначение проверки: найти offers/attributes, связанные с активными товарами, у которых цена не является корректным положительным целым числом.

Parser: `attributes-wrong-prices.js`. Source — Content Manager API, локаль `ru`.

Scope:
- пройти все `attribute`;
- для каждого прочитать relation `product`;
- если relation отсутствует или связанный `product.active !== true` → skip;
- дополнительных фильтров по состоянию самого attribute (`active`, stock, published/draft и т.п.) нет;
- причина: relation с активным product означает, что offer относится к активной карточке товара и его цена должна быть валидной.

Проверяемые типы ошибок `price`:
- `missing` — значение отсутствует или пустое;
- `invalid` — значение не приводится к конечному числу;
- `zero` — цена равна 0;
- `negative` — цена меньше 0;
- `fractional` — цена не целая.

Рабочий алгоритм:

```text
все attributes из Content Manager
→ relation product
→ product.active=true
→ проверка price
```

Не использовать неподтверждённый server-side filter по `product.active`; если потребуется оптимизация source query, сначала подтвердить фактический internal request через Network.

Output:

```text
documentId
barcode
price
errorType
```

CSV: `attributes-wrong-prices.csv`, без timestamp. Отдельная сортировка не нужна — строки остаются в порядке добавления по мере обработки. При 0 проблем CSV не создаётся, достаточно сообщения в Console. При API/response ошибке запуск останавливается и частичный CSV не формируется.

Progress сохраняется: checked/total, offers активных товаров, найденные invalid rows. Рабочая concurrency — 10.

## CANONICAL — products missing content

Назначение проверки: контролировать однородность критичного контента только у товаров, которые реально могут быть доступны клиенту.

Parser: `products-missing-content.js`. Source — Content Manager API, локаль `ru`.

Логика:
- первый слой: `product.active=true`; inactive products сразу skip;
- второй слой: состояние связанных `categories`;
- список categories загружается постранично через Content Manager и превращается в map `documentId → active`;
- relations товара к `categories` читаются через native relation endpoint;
- если все связанные categories имеют `active=false` → product skip;
- если все связанные categories `active=true` → проверяются `name1`, `name2`, `detail_picture`, `detail_text`;
- если categories отсутствуют → product всегда идёт в отчёт с `categoryState=no_categories`;
- если одновременно есть active и inactive categories → product всегда идёт в отчёт с `categoryState=mixed_active`, независимо от заполненности контента;
- hardcoded исключений по category documentId нет.

Контент считается отсутствующим, если:
- `name1` / `name2` пустые;
- `detail_picture` отсутствует;
- `detail_text` после удаления HTML tags и `&nbsp;` / `&#160;` не содержит текста.

Output intentionally compact:

```text
documentId
categoryState
missingFields
```

CSV: `products-missing-content.csv`, без timestamp. Edge cases и missing content объединяются в одной строке товара; `missingFields` показывает конкретно отсутствующие content fields.

`brand`, `attributes` и сам факт наличия `categories` не добавляются в эту content-проверку как обычные missing-fields: для них используются отдельные healthchecks.

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

## HISTORICAL — backfill `attribute.active` 2026-10-05

После добавления boolean `active` у `attribute` legacy-данные оказались частично инициализированы. Перед миграцией Content Manager audit по всем `ru` attributes дал:

```text
total: 36622
active=true: 26905
active=false: 0
active=null: 9717
```

Подтверждённая для этой миграции семантика: синхронизация из Bitrix явно записала `true` для активных offers, а оставшаяся legacy-группа сохранилась как `null` и должна была стать `false`.

Рабочий workflow:

```text
все attributes через Content Manager
→ выбрать только active === null
→ PUT /content-manager/collection-types/api::attribute.attribute/<documentId>?locale=ru
   {"active":false}
→ POST .../<documentId>/actions/publish?locale=ru
→ verify
```

В write payload передавался только `active`; никакие другие поля/relations не отправлялись. Уже обработанные records при rerun не попадали в выборку, поэтому операция идемпотентна. После production run пользователь подтвердил, что итоговые количества сошлись. Counts выше — HISTORICAL snapshot, при новом аудите получать заново.

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

### HISTORICAL — незавершённый анализ `product_features` 2026-10-05

Scope был зафиксирован как 2584 active Products категории «Макияж». Последний достоверный промежуточный snapshot до ужесточения правила по `[]`:

```text
products with confirmed values: 751
confirmed relations: 1039
partial_review: 113
review-only: 79
not_applicable: 62
legacy unresolved []: 1692

volumizing: 492
waterproof: 258
lengthening: 114
curling: 78
contact_lens_wearers: 65
hypoallergenic: 32
```

Эти цифры не являются финальным coverage: 1692 `[]` после этого были объявлены недопустимым финальным состоянием и должны быть переклассифицированы в `assigned` / `not_applicable` / `review`. Массовое присвоение на этом этапе не запускалось. Упоминались `product-features-analysis-v3.csv` и черновой `product-features-mass-assign.js`, но этот JS не считать production-verified без повторной проверки against current Network/API.

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

### HISTORICAL — category relation migration 2026-10-05

Разовая миграция подтвердила практический паттерн: когда source category уже содержит нужный набор products, список можно получить через relation самой category и использовать как input для additive assignment в target category, не делая полный scan всех Products. Existing category relations сохраняются; после write — publish/verify. Конкретные category IDs были одноразовыми и не являются reusable current state.

### CANONICAL — Product card layout + sections

`ui-ux/product-sections.js` отвечает только за вкладки `Контент / Фильтры / Системное`, show/hide полей и смысловые заголовки групп. Нативные React fields не перемещать между DOM-контейнерами: это конфликтует с внутренним SPA/focus Strapi. Для временного визуального порядка групп допустим CSS `order` на существующих top-level rows (без reparent): после этого `layout-sync.js` переносит тот же порядок в штатный `layouts.edit`.

Штатный порядок карточки хранится в Content Manager configuration:

```text
GET/PUT /content-manager/content-types/api::product.product/configuration
```

Source of truth для физического порядка — `layouts.edit`. Service `parsers/layout-sync.js` используется после layout-изменений: читает текущий UI; для вкладки `Фильтры` учитывает `data-tm-product-filter-group-order`, выставленный `product-sections`, поэтому смысловые группы сохраняются в заданном порядке; делает dry-run/diff, сохраняет существующий `size` каждого поля, после подтверждения меняет только `layouts.edit` через штатный configuration API и делает GET verify. `settings`, `layouts.list` и смысл metadata не менять. После успешной синхронизации `product-sections` не должен повторно переставлять поля в DOM.

## Style-stealer UI origin semantics

**Статус:** CANONICAL.

Для design snapshot страницы `parsers/style-stealer.js` делит UI на три происхождения:

- `native` — нативный Strapi без наших маркеров;
- `modified` — нативный DOM-узел, изменённый extension; обычные `data-tm-*` / `tm-*` на самом элементе означают modified;
- `custom` — UI, созданный extension; root помечается `data-tm-created="<extension-id>"`, его собственные потомки считаются custom.

Если нативный Strapi-узел перемещён внутрь custom-контейнера, ставить на сам узел `data-tm-modified="<extension-id>"`: этот marker создаёт native/modified boundary и не даёт считать перемещённый React element custom. Нативные React elements перемещать, не копировать.

## Parser health semantics

Полезные смысловые проверки каталога:
- active products без attributes / brand / categories — ad hoc checks, при необходимости выполнять через Postman/internal API вместо отдельных runtime parsers;
- duplicate technical fields `key`, `code_1c`, `bitrix_id`, `xml_id`, `code`; null/empty не считать duplicate value;
- wrong prices у offers active products: отдельный CANONICAL workflow выше; `missing`, `invalid`, `zero`, `negative`, `fractional`, output `documentId`, `barcode`, `price`, `errorType`;
- missing content: отдельный CANONICAL workflow выше; active product проверяется по `name1`, `name2`, `detail_picture`, `detail_text` с дополнительным слоем `categories.active`, без hardcoded category IDs;
- wrong variants: несколько offers нельзя последовательно выбирать одним типом `shade` или `volume`;
- attributes without product — ad hoc/Postman check; все `attribute` в `ru` без relation `product`, server-side Content Manager filter, без дополнительных условий;
- attributes without detail picture — offer активного product, `isInStock=true`, `detail_picture=null`;
- missing shades — published offer с `color_variant1C`, без `shade`, связан с active product;
- shade-and-volume — published offer с одновременно заполненными shade и volume;
- barcode audit — published offers без barcode и с duplicate barcode, с product context.

Проверка products without categories — healthcheck, а не разрешение автоматически назначать categories из Bitrix. Отдельный runtime parser для неё не поддерживается; автоназначение categories по Bitrix не является безопасным default из-за бизнес-логики и исключений.

---

# 6. Localization and translation

Для `ru/kk` различать:
- localization самого field;
- localization relation field;
- localization target entity.

## CANONICAL — translator prompts

`translator/full.md` — полный source of truth для production RU → KK translation rules. Он хранит подробные правила, глоссарий, приоритеты и самопроверку без искусственного ограничения длины.

`translator/compressed.md` — поведенчески эквивалентная версия тех же правил для ChatGPT Project Instructions с лимитом 8000 символов. Сжатие должно убирать объяснения и примеры, а не переводческие правила или их приоритет.

`translator/extractor.md` — отдельный audit prompt: анализирует review-таблицы/историю, агрегирует evidence и предлагает только подтверждённые ADD/STRENGTHEN изменения перед merge. Самостоятельно production-терминологию не меняет.

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

Дополнительный HISTORICAL diagnostic 2026-10-05 для сверки `attribute.active`: из Strapi экспортировались `barcode + active`, затем планировался exact match в Bitrix offers. Первый DOM scraper ошибочно выбрал внешнюю layout-таблицу, потому что её `innerText` содержал текст вложенного grid; ручной поиск того же barcode в Bitrix при этом находил offer. При повторении такой сверки не идентифицировать grid по общему `innerText`: использовать отдельные header cells реальной таблицы либо фактический AJAX request из Network. Session/filter IDs и payload не хранить как постоянный contract — заново подтверждать через Network.

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
