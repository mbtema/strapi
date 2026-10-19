# Context update — skin-care filters / usage_time

> Staging knowledge from the 2026-10 skin-care filter enrichment session. Merge useful parts into `project/context.md` before syncing to ChatGPT Project knowledge.

## CANONICAL — dataset для фильтров «Уход за кожей»

Для field-by-field enrichment товаров ветки «Уход за кожей» source dataset собирается ad hoc через DevTools/Content Manager, а не как постоянный repo parser, пока нет отдельного требования автоматизировать этот workflow.

Category contract:
- UID: `api::category.category`;
- root «Уход за кожей» на подтверждённом запуске: `documentId=w1fb41d16zof69abh4rnntky`;
- дочерние категории: relation `categories`;
- фактическая relation категории к товарам: `product`;
- relation `products` в этой модели помечена «НЕ ИСПОЛЬЗОВАТЬ!» и не является source.

Текущее состояние relation читать только через:

```text
GET /content-manager/relations/api::category.category/<categoryDocumentId>/<field>?locale=ru&page=<N>&pageSize=<N>
```

Picker request вида `/content-manager/relations/api::category.category/<field>?locale=ru&id=<documentId>...` возвращает кандидатов для выбора, а не сохранённое relation state.

Алгоритм dataset:
- BFS/DFS от root по `categories` до любой глубины;
- `product` читать на каждом посещённом category node, не только на листьях: Product может быть привязан на любом уровне дерева;
- все relation pages читать полностью;
- категории защищать `visited`, Products дедуплицировать по Product `documentId`;
- для Product сохранять все найденные пути внутри выбранного root;
- название category при необходимости подтверждать через category detail, а не оставлять fallback `documentId`.

Компактный source dataset для дальнейшей классификации фильтров:

```text
documentId
active
name
name1
name2
brand
skinCareCategoryPaths
detail_text
```

`documentId` — locator для последующего CMS write; остальные поля — Product context для классификации. Технические `id/bitrix_id/code_1c/xml_id`, relation documentIds/counts и пустые target-filter relations в анализ не тащить без конкретной необходимости.

HISTORICAL 2026-10-13: initial skin-care dataset дал 3336 уникальных Products (3108 active / 228 inactive), дублей по `documentId` не было. Поле `composition` проверялось как потенциальный source для ingredients, но было пустым у всех 3336 записей и было исключено из clean dataset. Это snapshot, при новой задаче состав проверять заново.

## CANONICAL — Product filter `usage_time`

`usage_time` — single relation: финальный `assigned` Product может иметь ровно одно controlled value.

Native relation endpoint:

```text
GET /content-manager/relations/api::product.product/<productDocumentId>/usage_time?locale=ru&pageSize=<N>&page=<N>
```

Для single relation ожидается 0 или 1 result; больше одного — unexpected state и повод остановить write/audit.

Controlled dictionary:

| code | RU title | documentId |
|---|---|---|
| `before_sun_exposure` | До загара | `q3du2t4cjatvsncr6ri8xxm3` |
| `after_sunbathing` | После загара | `aiyube3d447qlf3gu32aq5fr` |
| `day` | Дневной | `a24f857w0d42se97q21ilnsi` |
| `night` | Ночной | `z9pqz9ic5c4qh9123ytzz21i` |
| `before_shaving` | До бритья | `kf8ya71p8khu8w01b55ygxst` |
| `after_shaving` | После бритья | `poe4abde6t00mte2e3zgpgpb` |
| `universal` | Универсальный | `r6w2dy11wd6h6iyznsmey8v9` |

`ru/kk` localizations используют тот же target `documentId`. Numeric CM `id` не хранить/не хардкодить: перед write загружать актуальный target detail через Content Manager и брать текущий `id`.

Семантика классификации:
- `day` — явное дневное/утреннее применение;
- `night` — явное вечернее/ночное применение;
- если средство явно используется и утром, и вечером, single-value result → `universal`;
- `before_sun_exposure`, `after_sunbathing`, `before_shaving`, `after_shaving` назначать только когда это именно момент/способ применения товара, а не просто упоминание солнца, загара или бритья в marketing/effect text;
- специальный usage scenario имеет приоритет над общим `day/night/universal`;
- `universal` допустим для обычного самостоятельного средства ухода без специальной временной привязки, даже если в тексте нет буквальной фразы «в любое время»;
- наборы/комплекты без единого времени для всех компонентов → `review`;
- timing-sensitive товары с ретиноидами/кислотами/пилингами без явного времени → `review`;
- отсутствие текста о времени само по себе не должно массово отправлять обычные средства ухода в `review`.

Classification output:

```text
documentId
usage_time
status
reason
```

Для `assigned` поле `usage_time` содержит один `code`; multi-value через `|` недопустим. `review` не записывается в CMS.

Подтверждённый write в пустое `usage_time`:

```text
PUT /content-manager/collection-types/api::product.product/<productDocumentId>?locale=ru

usage_time.connect = [{ id, documentId, locale: "ru", isTemporary: true }]
usage_time.disconnect = []
```

После Save relation проверяется native relation GET, затем Product публикуется и relation проверяется повторно. Для batch workflow сохраняются dry-run → pilot → full, low concurrency, stop-on-write-error и result CSV.

Важно: точный Network payload замены уже существующего `usage_time` на другое значение в этом цикле не был подтверждён. Временный writer использовал гипотезу `connect new + disconnect current`, но не считать её CANONICAL до отдельного Network capture реального UI replacement. До подтверждения existing non-matching value не заменять автоматически.

## HISTORICAL — skin-care `usage_time` classification 2026-10-13

После исправления ошибочного предположения, что `usage_time` multi-relation, classification был пересобран в single-value формат:

```text
dataset: 3336 Products
assigned: 3191
review: 145

universal: 2854
night: 176
day: 71
before_sun_exposure: 78
after_sunbathing: 7
after_shaving: 5
before_shaving: 0
```

Предыдущий multi-value output (`day|night` и другие комбинации) — SUPERSEDED и не должен использоваться для write. В single-value конвертации `day|night → universal`, а специальные usage scenarios получили приоритет над общим временем. Counts — historical evidence, не current catalog state.
