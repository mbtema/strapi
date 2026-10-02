# Product filter enrichment workflow

> Staging knowledge supplement. Merge into active Project `context.md` when syncing Project knowledge.

## CANONICAL — reusable workflow

Подтверждено production-задачей по `shade_groups` 2026-10-02. Использовать как стартовый шаблон для следующего product filter field, но не переносить shade-specific классификацию на другое поле без проверки его семантики.

```text
определить target field + relation type + controlled dictionary
→ определить source: product / attribute / category / другой context
→ собрать полный dataset через Content Manager API
→ классифицировать assigned / [] / review
→ агрегировать значения на Product
→ dry-run по текущему CMS state
→ PILOT
→ additive partial write только target field
→ verify
→ Publish
→ verify
→ controlled batches + result CSV
```

Правила:
- mutable CMS state читать через Content Manager; все страницы/relations проходить полностью;
- relation сравнивать по `documentId`; Content Manager numeric `id` получать динамически, не переносить numeric id из Public API;
- `review` одной source-row/attribute не блокирует уверенные значения других rows того же Product;
- Product target = union уверенно определённых values с dedupe;
- `[]` означает filter не нужен, `review` — unresolved;
- write additive: existing relations сохранять, добавлять только missing; `disconnect` не использовать без отдельного требования;
- Product с уже существующим modified/draft до миграции skip, чтобы Publish не выпустил чужие изменения;
- partial PUT отправляет только target relation;
- Save → verify → Publish → verify;
- первый write — PILOT, затем low concurrency/batches/pauses; ошибка останавливает run и сохраняет partial result;
- повторный запуск idempotent/additive;
- actual Network выше сохранённого примера.

## HISTORICAL — shade_groups

Scope: makeup, locale `ru`, dataset — одна строка на attribute.

Dataset field `shade_group`:

```text
["<documentId>", ...] → assigned
[]                    → filter не нужен
review                → unresolved
```

Классификация:
- informative `shadeName`;
- затем `shadeHex`;
- `color_variant1C` / `color_info` только secondary hints;
- затем product context (`categories + name1/name2`);
- numeric/code-only shade names неинформативны;
- accessories/tools без реального color variant не получают group;
- nude → только nude;
- clear — только при явной transparent/clear семантике;
- реальный multicolor может иметь несколько groups;
- недостаточно данных → `review`, не ближайший цвет.

Dictionary:

```text
beige  jytixpmm71n6hdd91ozk4o4z
blue   ce6yf8iipnkyd89k4kjg8tpm
green  ei8yu1xprq61n73uweasgzlq
red    wc5z0w59revcl84tgl7ajdc3
white  jjsc61sfwx2a1hihwalfdc0h
black  zzraxam9gvpj9p466fxwes9h
gray   awk9m345xpqqa502svspt4ja
brown  uzdw37u3hdj53givw7a5nvaw
purple tluqn5urp9gcschiimntblrd
pink   mezq5e6iet5z7el449k5uspj
nude   qlo0bqsvkki8tismtrkp18x6
clear  fxcumlg004bc498p7j1uaogp
```

Duplicate white `fiheua513fnwk51hhnlgwvbj` не использовать.

Confirmed relation read:

```text
GET /content-manager/relations/api::product.product/<productDocumentId>/shade_groups?locale=ru&pageSize=<N>&page=<N>
```

Confirmed additive relation payload:

```json
{"shade_groups":{"connect":[{"id":"<cm-id>","documentId":"<group-documentId>","locale":"ru","isTemporary":true}],"disconnect":[]}}
```

Write/publish:

```text
PUT  /content-manager/collection-types/api::product.product/<documentId>?locale=ru
POST /content-manager/collection-types/api::product.product/<documentId>/actions/publish?locale=ru
```

Production browser script successfully used partial PUT only for `shade_groups`, Publish body `{}`, relation verify after Save and after Publish.

HISTORICAL snapshot 2026-10-02:

```text
dataset rows: 10739
products: 2584

attribute assigned: 10219
attribute []: 433
attribute review: 87

products with known groups: 2168
not applicable: 352
review-only: 64
any remaining review: 72
  partial review with known groups: 8
  review-only: 64

V4 run:
already correct: 2016
already correct + review pending: 8
updated + published: 144
not applicable skipped: 352
review-only skipped: 64
errors / existing drafts / unexpected extras: 0
new relations added: 270
```

Counts above are historical evidence, not live state. При следующем запуске всегда пересчитывать их из актуального dataset/CMS.
