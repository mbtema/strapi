# context.md

> Knowledge layer проекта. Здесь хранятся устойчивые факты, подтверждённые data/API contracts, архитектурные решения, CANONICAL workflows, доменная память, полезная история и эксперименты.
>
> Использовать вместе с Project Instructions: Instructions — единственный operational layer, задают поведение/приоритеты/форматы и имеют приоритет при конфликте; `context.md` дополняет их конкретными contracts, workflows, архитектурой и доменной памятью.
>
> Для текущего code/version/manifest/Issue/API payload/Network/UI всегда проверять live source; mutable technical state выше snapshot context, но не заменяет operational rules из Instructions.

**Последняя консолидация:** 2026-10-13  
**Repo:** `mbtema/strapi`  
**Strapi backend:** `http://10.10.3.80:1337`  
**Локали:** `ru`, `kk`

## Статусы знаний

- **CANONICAL** — подтверждённый текущий путь/решение; при повторении задачи это стартовая точка.
- **HISTORICAL** — завершённая история и полезные выводы; не считать описанием текущего состояния.
- **EXPERIMENT** — PoC/тест; не переносить в production автоматически.
- **SUPERSEDED** — старый подход; хранится только чтобы не возвращаться к нему без причины.


## CANONICAL DESIGN — DIOR Product RU → KK (согласовано 2026-11-12)

- **CANONICAL PATCH — CM Published пустой ответ (2026-11-13, подтверждено Live Console):** `GET /content-manager/collection-types/api::attribute.attribute/tak3t3zwz2ksnjn0ds3q7w8r?locale=kk&status=published` возвращает **HTTP 200 с пустым `data`** (в Console `dataKeys: []`, `documentId/locale: undefined`), а GET Draft HTTP 200 с заполненным `data`. В v7 при непустом `data` без `documentId` был STOP «Неожиданный ответ Published KK target». Исправлено в том же pipeline: HTTP 200 `data:{}`, `data:[]`, `data:null`, HTTP 404 или `publishedAt:null` → **неопубликован KK target**, `unpublished_kk_target` и skip Product без PUT/POST, продолжить batch; **непустые данные странной формы** продолжают давать STOP. Мок-проверены все варианты + fail-closed, но полный batch после патча ещё не запущен. Последний Result v7: остановка на Product `a2keleoggv9beehmj4c5v7hm`, Attribute `tak3t3zwz2ksnjn0ds3q7w8r`, без новых записей; `unresolved` не возник, предыдущий STOP другого Product был успешно read-only reconciled. Продолжать из исходного backup и сохранённых checkpoints в том же браузере, кнопка «Продолжить синхронизацию».
- **CANONICAL UPDATE — Publish KK требует Published всех связанных KK targets (2026-11-13):** в едином `locale/product/dior-products-kk-audit.js` **v7** проверять перед Save KK и повторно непосредственно перед Publish KK ВСЕ root relations RU Draft, включая уже существующие в KK Draft, через реальные `GET /content-manager/collection-types/<targetUid>/<documentId>?locale=kk&status=published` (`null`/404/`publishedAt:null` = не опубликована; неожиданный ответ/HTTP error = STOP). Если в target есть KK Draft, но нет KK Published, **НЕ публиковать справочник автоматически**, пропустить конкретный Product с `unpublished_kk_target` (field, uid, documentId), сохранить skip в `localStorage` scoped к `backup.startedAt`, продолжить остальные Product и не включать skipped в verified checkpoint. Если Published target пропала после подтверждённого Save, снять только verified-stage после сохранения deferred checkpoint, без Publish; повторного PUT не делать. При новом полном backup skip переоценивается. Старое правило `KK Draft target достаточно для Publish Product` **SUPERSEDED** только применительно к публикации: для Draft связи по-прежнему достаточно KK Draft, для видимости в KK Published нужна KK Published. **HISTORICAL LIVE v6:** загруженный `dior-products-kk-result.json` 2026-11-13: автоматический пилот Product `qdxfu9ag5apyl11he899vj82` Save+Publish проверен, следующий Product `a290m7j6oj38ft3sutt0m7t4` Save KK проверен и Publish KK HTTP 200, но его KK Published лишился видимой `attributes` relation к `e96thtaaf7tas5l56x183yz8`: KK Draft связь есть, опубликованная версия KK Attribute на момент запуска отсутствовала (подтверждено пользователем); RU и KK текст/media не повреждены. Сохранён `unresolved` publish-kk + stage save-kk. **Recovery такого STOP не писать автоматически:** новая кнопка «Проверить Publish KK → продолжить» — только GET, сверка RU с backup и verified-stage, KK Draft с backup RU+локализованными KK полями, KK Published с KK Draft за исключением строго отсутствующих Published KK targets, отсутствие прочих изменений/extra. Если только этот ожидаемый класс отличий — записать `unpublished_kk_target`, очистить journal и stage, продолжить batch через ранее подтверждённый автоматический пилот, **никаких повторных POST/PUT** остановленного Product; иное расхождение → STOP без очистки. **EXPERIMENT MOCK v7, не live:** реальное сходство v6 STOP с unpublished Attribute → 0 повторных записей для stop Product, deferred в localStorage, batch обработал следующий Product PUT+POST, result downloaded, unresolved cleared; намеренная порча KK Published поля → 0 write, unresolved preserved, STOP. Первый выбранный пилот, если не готов из-за Published target, пропускается и автоматически выбирается новый кандидат без успешного write. **Дополнительный MOCK v7:** выбранный первым пилот с неопубликованным KK Attribute скипнут **до любого PUT**, автоматически выбран второй Product, выполнены ровно его PUT+POST, `unpublished_kk_target` сохранён, 1 confirm, batch завершён и Result JSON скачан. **НЕ ПРОВЕРЕНО В LIVE:** точная форма ответа CM GET Published для неопубликованных типов справочников и v7 resume; не называть batch completed до live-result.

- **CANONICAL UPDATE — один пилот → все товары DIOR (2026-11-13):** в `locale/product/dior-products-kk-audit.js` **v6** после обязательного read-only backup пользователь ОДИН раз вручную подтверждает «Запустить пилот → все товары»; **после полного Save/Publish/GET verify ровно одного успешного пилота сразу автоматически** обрабатываются **все eligible ready Product** с тем же строгим per-product preflight и postflight, без второго confirm, без искусственного лимита партии и без повторных пилотов для новых operationTypes. Ранее согласованное правило Q24 про `untested_operation` **SUPERSEDED** новым явным решением; схема операций осталась проверяемой по каждому товару. Любой `source_changed`, `target_changed`, `missing_kk_target` → skip конкретной записи; 4 block missing KK target остаются заблокированными, записи не создаются. Неожиданный/неподтверждённый PUT/POST, повреждение RU, ошибка GET/verify → STOP всего pipeline, unresolved journal и снимки, никакого авто-retry/recovery; ручной Stop также сохраняется. Checkpoint после каждого confirmed Product, проверка checkpoint заново перед resume, stage между Save/Publish без повторного PUT. Во время batch панель показывает обработано/всего, verified/skipped. Отдельный JSON после пилота **не скачивать**, один полный `result.json` после batch или STOP; исходный `backup.json` остаётся отдельным и обязательным. Если уже есть validated automatedPilot в checkpoint от live v5, повторный пилот не нужен: пользователь нажимает «Продолжить синхронизацию» после загрузки исходного backup, затем тот же auto-batch. **EXPERIMENT MOCK v6, не live:** успех с 1 confirm: пилот PUT/POST, далее автоматический PUT/POST с другим operationType, 0 unresolved; ошибка второго PUT: STOP до второго POST, сохранён unresolved, 1 download result. Не считать новый полный batch проверенным в live, пока он реально не выполнен.


- **Единый инструмент:** `locale/product/dior-products-kk-audit.js` в Console RU-карточки Brand DIOR; не создавать отдельные batch/pilot/audit копии. Основной pipeline: read-only scan → полный dry-run и обязательный JSON backup → ручной запуск автоматически выбранного пилота → последовательные записи и Publish → полный GET verify → полный итоговый JSON. Интерфейс минимальный; код и доработки только в repo.
- **RU Draft — source of truth:** все root relations Product зеркалировать точно по `documentId` (missing `connect`, extra `disconnect`); `category` — legacy, RU пусто, KK очищать; `categories` — рабочая relation. Общие scalar/boolean, `false`, media и вложения KK должны соответствовать RU. Для локализуемых по схеме text/string содержимое KK сохранять: любое непустое KK при непустом RU допустимо, различие не ошибка; RU заполнено + KK пусто — `translation_review`, не копировать RU текст, не блокировать прочие изменения.
- **Unique key (CANONICAL UPDATE 2026-11-13):** Product `key` = `unique:true` и НЕ локализован (`pluginOptions.i18n.localized` отсутствует); **RU.key и KK.key внутри одного `documentId` должны совпадать**, `+ '0'` запрещён. Strapi 5 синхронизирует общий nonlocalized атрибут; уникальность — среди **разных Product**. Обязательная адресная GET-проверка `filters[key][$eq]` с положительным контролем и поиском **посторонних** `documentId` среди RU/KK Draft/Published до Save/Publish; конфликт другого Product — STOP. Поле `key` может быть read-only в KK Admin (подтверждено HTML пользовательского пилота). Для 34 старых DIOR записей с несовпадением RU/KK планируется привести KK к RU под теми же проверками; никаких альтернативных ключей/автоподбора. Другие unique — отдельный контракт. Системные `id`, `documentId`, created/updated/published timestamps, author fields не копировать и не включать в payload; сохранить диагностически.
- **Dependencies:** если нет KK Draft у любой связанной target записи, заблокировать только этот Product и сохранить target `documentId` в отчёте; не создавать KK справочники. KK Draft у справочника достаточно, публикация справочника не требуется. Все root relations read по всем страницам; компоненты/Dynamic Zone, media, field localization и root relation target localization проверять по фактическим schemas.
- **Pre-write export:** один полный JSON со схемами и RU/KK Draft/Published, всеми бизнес-полями, media, components и relations каждого Product. После автоматического скачивания пользователь вручную подтверждает наличие backup кнопкой запуска пилота. Второй JSON итоговый: все снимки и состояния после каждого Save/Publish, планы, фактические операции, ошибки и checkpoint. Не дробить на несколько CSV/JSON.
- **Save/Publish:** preflight непосредственно перед каждой записью сверяет актуальный RU со снимком, строит полный безопасный payload KK с сохранением локализуемых KK полей, затем PUT Save KK → GET verify обеих локалей → Publish RU Draft (даже если расходится с RU Published) → GET verify → Publish KK Draft (сохраняя KK перевод) → GET verify RU/KK Draft/Published. Если Save не нужен, не делать; если Published отстаёт, публиковать только устаревшие версии. Без потери RU бизнес-полей/media/relations; смена служебных timestamps/component IDs допустима.
- **Пилот:** автоматически выбрать доступный Product с максимальным числом операций и наибольшим разнообразием при равном числе; показать план, запустить только после ручного подтверждения. После успешного пилота — отдельное подтверждение на массовую обработку. Если у следующего Product есть тип операции, не подтверждённый пилотом, `untested_operation` и skip. Новые пилоты выбираются из этих skip по наибольшей сложности. Только последовательные writes, никакого auto-retry PUT/POST.
- **Safety:** при изменении RU после backup skip Product (`source_changed`), остальным не мешает. Заранее известные отсутствующие зависимости — skip; неожиданный ответ/failed postflight/unknown write — STOP всего pipeline, checkpoint/unresolved без auto-retry. Успешные записи повторно не отправлять; resume после повторного preflight. При подтверждённой порче RU предусмотрена **одна** попытка восстановления из backup (сохранять повреждённый снимок и проверять восстановление), затем неизменно STOP; сам recovery сначала отдельно проверить в безопасном live пилоте, пока не подтверждён — автоматически не запускать.
- **HISTORICAL dry-run 2026-11-12:** загруженный `dior-products-kk-backup.json` v3 (11:45–11:58 UTC): полный GET scan 583/583 Product, 48 249 GET/0 retries/0 writes, 579 `pending`, 4 `blocked`, 0 missing KK Product. 1526 изменений **только среди 579 eligible**; всего 743 missing и 221 extra root relation entries, 816 relation field diffs. Единственное уникальное поле Product — `key`; все 583 RU key 16 символов, для всех 583 планируется `RU.key + '0'`; 549 KK изначально повторяют RU key, 34 KK отличаются (часть — локализованные slug). Внутри 583 DIOR нет коллизий предложенных ключей с уже существующими RU/KK DIOR ключами и между собой; **глобальная** проверка всех Product Strapi ещё не выполнена — строго блокировать write до неё. 70 `translation_review` (`preview_text` 65, `detail_text` 4, `shareUrl` 1) не блокируют; общие boolean и media совпадают RU/KK; все 583 RU Draft и Published идентичны по business/relations. KK Draft и Published расходятся у 68 товаров (преимущественно `attributes`); 583 KK Published существуют. Блокировки 4 товаров вызваны только двумя KK-отсутствующими справочниками `product_form`: `v9d9vo61id2gol0467qb3mdk`, `aumj2f61mchkzluhdc9ldfwe`. Кандидат пилота `xvjsqik1lalllxwlyzqz7gh6`: 9 изменений (1 unique key + 8 connects по `skin_types`, `product_effects`, `product_form`, `usage_time`), **без disconnect**; после него `relation:category:disconnect` и `relation:categories:disconnect` останутся непроверенными и требуют отдельного пилота. Backup ≈61 MB полный, не заменяет global key uniqueness/live PUT validation.
- **EXPERIMENT — Pipeline DIOR v4 (2026-11-12, тестовый Strapi mock, не live):** в том же `locale/product/dior-products-kk-audit.js` после загрузки сохранённого v3/v4 `dry-run` backup (без нового 48k GET scan) доступен управляемый пилот; в открытой вкладке backup можно повторно использовать из `window`. Перед записью GET актуальных RU/KK Draft/Published и root relations, проверка schemas, dependencies, `key=RU.key+'0'` через адресный CM list filter `filters[key][$eq]` с положительным контролем существующего RU key и проверкой RU/KK Draft/Published. PUT KK полный payload: общие поля/boolean/media из RU, локализуемые KK из KK, подтверждённые numeric ID connect/disconnect; при nonempty component/DZ STOP (для 583 DIOR relatedProductsSlider пуст). POST Publish RU только если Published устарела; затем POST Publish KK, после каждой записи GET снимок четырёх версий с проверкой контента и relations. PUT/POST без retry, `localStorage` unresolved до verified postflight, stage checkpoint после verified шага, сохранённый per-Product checkpoint; при остановке между Save/Publish повторный запуск сверяет stage GET и продолжает **без повторного PUT**. Pilot подтверждать вручную после проверки backup, batch отдельно; в batch только типы операций подтверждённые пилотами, остальные `untested_operation`. Один полный backup JSON + отдельный полный result JSON со snapshots и write-журналом. **Mock tests PASS:** success (PUT KK + POST KK, RU Publish skipped если актуальна); conflict global key STOP до записи; simulated corruption RU after KK Save STOP и unresolved; остановка после verified PUT и import backup → Resume делает только POST, без повторного PUT. `recoveryVerified=false`, `autoRecoveryEnabled=false`: самовосстановление RU НЕ выполнять до отдельного безопасного live-пилота; UI явно предупреждает. **НЕ ПРОВЕРЕНО В LIVE:** CM Product list key-filter форма/ответ, PUT existing KK с connect/disconnect, Publish после него, обработка existing KK Published, recovery. Наличие кода/успех mock не означает live-готовность batch. Для активации реального пилота нужен сохранённый backup и ручное подтверждение; при любом непроверенном результате — STOP.
- **HISTORICAL LIVE PILOT 2026-11-13:** Result JSON v4, `documentId=xvjsqik1lalllxwlyzqz7gh6`: PUT KK 200, 8/8 relation connects успешны, RU Draft/Published business+relations неизменны, KK переводные поля, boolean и media сохранены. **STOP** на ошибочном ожидании `key=RU+'0'`: Strapi оставила общий `key=0102a663aff5aa27` обеим локалям, PUT реально частично прошёл; `unresolved` Save KK записан, Publish скриптом НЕ выполнялся. Пользователь затем вручную опубликовал обе локали без ошибки; приложенный HTML KK Admin показывает поле `key` disabled/read-only и статус Published, но HTML не заменяет независимую GET-сверку Draft/Published и relations. **Новый код v5:** исправить `key=RU`, оставить проверку ключа против других documentId; при импортe старого backup v3/v4/5 пересчитывать планы из оригинальных четырёх snapshots, сохраняя missing-target blockers; добавлена кнопка `Проверить остановленный пилот` (ручная read-only GET-сверка всех бизнес-полей, relations и обеих Published против неизменённого prewrite backup). Только при полном совпадении очищается `unresolved`, Product отмечается `manualRecovered` с пустыми verifiedTypes; ручная Publish НЕ подтверждает pipeline POST и batch НЕ разрешается без нового успешного автопилота. Синтетический mock проверки read-only reconciliation: 7/7 условий true, 0 writes. Новый кандидат после исключения ручного пилота по перепланированному исходному backup: `kk5j6l3cokeu7i04rnfcj3d3` (6 изменений, включая `relation:category:disconnect`, и 5 типов операций). **В live не проверена** новая ветка v5; до нового пилота никакого batch. Исторический контракт `key+0` ниже в v4 EXPERIMENT теперь SUPERSEDED, не применять.
- **Проверенный старый контракт:** Product `POST /content-manager/collection-types/api::product.product/<documentId>/actions/publish?locale=ru|kk` с полным payload и одиночный RU/KK цикл были проверены на одной записи 2026-11-10; это **не** подтверждает массовую синхронизацию существующих KK, `disconnect`, media/components или автоворстановление. Для нового pipeline READ live проверяется отдельно до разрешения writes.

---

## CANONICAL — DIOR Category RU → KK (2026-11-11)

- **Один инструмент:** `locale/category/category-kk-sync.js` в Console RU-карточки Brand DIOR (`qw7sja6ffpbufvzub5maxyrl`); читает все `DIOR.categories` с пагинацией, схемы Category/компонентов, RU Draft/Published и KK Draft/Published, шесть root relations по `documentId`, и наличие KK у связанных Category/Product/Brand. RU Draft — источник данных, RU Published — контроль сохранности.
- **Порядок:** автоматический read-only scan → CSV/JSON → создание/восстановление отсутствующего или отличающегося KK Draft из RU (полный payload, пока без relations) → отдельно подтверждённый пилот **одного `Category.product.connect`** → только при успешном postflight последовательное additive добавление остальных недостающих root relations. Не отправлять `disconnect` и не публиковать. При невозможности сопоставить target KK (особенно Product) — review, не создавать Product и не заменять target RU. При любых сомнениях после PUT — STOP, `localStorage` unresolved, никогда не повторять автоматически.
- **Проверки после каждой записи:** бизнес-поля RU Draft/Published, media, nested components/Dynamic Zone, все RU relation `documentId` и метаданные RU Published должны сохраниться; KK-контент должен соответствовать RU Draft, KK relations — ожидаемому exact set без дублей. Пересоздание внутренних component ID и статус RU `modified` допустимы при сохранении значений.
- **HISTORICAL:** 2026-11-11 выполнены три live-пилота и массовый первый проход 52 KK Draft (HTTP 200, verified 52/52, 0 ошибок); всего 55 KK Draft. Исходный live-аудит второго прохода: 55 Category, 999 RU relation entries, 0 KK, 0 ошибок, все 55 KK business поля совпадали с RU. **Live-пилот сохранения `Category.product.connect` подтверждён:** Category `glthalnzhocshm96nnknjy3n` («Уход за кожей»), один PUT `?locale=kk`, HTTP 200, `verified=true`, KK product 0→1 (`d193mis75alho0qayytnpqui`); RU Draft/Published business values, все relations и Published metadata не изменились, KK content соответствует RU Draft. Осталось 998 missing relations: 845 `product`, 153 остальных; все 55 Category в состоянии pending, missing KK targets 0. Текущий инструмент поддерживает последовательный Apply после пилота, с повторным GET и STOP на первом расхождении. Другие relation-поля на live PUT ещё не подтверждены.
- Старые файлы `category-kk-dry-run.js`, `category-kk-batch.js`, `category-kk-relations-audit.js` удалены из repo после консолидации; их сохранённые CSV/JSON — только исторические результаты, не operational scripts.

- **HISTORICAL, второй проход завершён 2026-11-11:** финальные `dior-category-sync (2).json` и CSV: `phase=completed`, 55/55 Category `synced`, 0 pending/review/blocked/errors. Итоговые RU/KK relation entries — **999/999** (`parent=49`, `categories=49`, `product=846`, `brand=55`, `products=0`, `top_brands=0`), уникальные `documentId` совпадают по каждому полю; 366 разных targets. Всего **56 PUT** (`pilot=1`, `apply=55`), каждый HTTP 200, `verified=true`; 562 прямых `connect` (458 product, 49 parent, 55 brand), связанные обратные стороны Strapi также отражены в итоговых relations. Все 56 postflight подтверждают сохранность RU Draft/Published business fields и relations, Published metadata, полное совпадение KK content с RU Draft, отсутствие KK Published. Сверка CSV и JSON — 55/55 без расхождений. Внутренние component ID/`updatedAt` RU Draft могут изменяться. **Отдельного независимого финального GET-аудита после batch не проводили**; для него заново запустить этот же инструмент только в read-only scan и получить 55 `synced`, 0 PUT. Следующая отдельная задача — Publish KK с проверкой уникального `bitrix_id`, не включать её в синхронизацию Draft.

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

Сами сервисы остаются в своих папках; manifests — только регистрация/версии.

Loader использует cached extensions для быстрого старта, затем сверяет registry с GitHub. При изменении manifest signature скачиваются изменившиеся extensions, а новая cached версия применяется после reload. `checkUpdates()` вручную проверяет loader/extensions. Обновление самого userscript loader происходит через Tampermonkey.

## CANONICAL — Tools Launcher

Tools Launcher получает registry из `extension/manifests/tools.json`, а код tools — из `extension/tools/`. `file` в manifest хранит относительный путь внутри `extension/tools/`, включая подпапку назначения.

Физическая структура tools:
- `extension/tools/audits/` — массовые проверки и отчёты;
- `extension/tools/sync/` — синхронизации и управляемые write-инструменты;
- `extension/tools/diagnostics/` — диагностические utilities.

Manifest tool содержит:

```text
file
semver version
group
```

`group` не является отдельной смысловой классификацией: он обязан совпадать с первой папкой `file`. Допустимые группы: `audits`, `sync`, `diagnostics`; Tools Launcher валидирует это соответствие и строит UI-колонки по этим же группам.

Tool-файлы не содержат собственные metadata-блоки. Runtime-регистрация и версия (`file`, `version`, `group`) задаются только в `extension/manifests/tools.json`. Userscript metadata используется только в `extension/extension.js`, потому что только loader устанавливается напрямую в Tampermonkey.

Managed regular tools получают global run-lock. Для GET временные network errors / `429` / `5xx` могут повторяться; постоянные `4xx` не ретраятся.


## CANONICAL — Network Recorder

`extension/tools/diagnostics/network-recorder.js` — отдельный diagnostics tool для быстрого Network-контекста Strapi; `extension/tools/diagnostics/dom-stealer.js` остаётся только DOM snapshot utility.

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

## CANONICAL — source для массовых data-audit tools

Массовые audit tools из `extension/tools/audits/` проверяют фактическое текущее состояние CMS только через Content Manager API. Public REST `/api/...` не используется как source для таких проверок, потому что published view не отражает draft/modified current state; Public API проверяется отдельно через Postman/client/API diagnostics.

Базовый read pattern:
- list/detail: `/content-manager/collection-types/api::...`;
- relations: `/content-manager/relations/api::.../<documentId>/<field>`;
- `Authorization: Bearer <jwtToken>` + `credentials: include`;
- для текущих catalog audits используется `locale=ru`;
- все страницы читаются полностью, relation checks идут через native Content Manager relation endpoint;
- при несовпадении ожидаемого Content Manager response tool должен остановиться с явной ошибкой, а не формировать потенциально ложный CSV.

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

Source contract не меняется ради производительности: неподтверждённый server-side filter по `product.active` не использовать. Оптимизация выполняется внутри подтверждённого Content Manager пути:
- первую страницу attributes читать отдельно, остальные известные страницы — параллельно;
- сначала выполнить локальный `price` precheck по list rows; relation к Product читать только для attributes, у которых уже найден `missing/invalid/zero/negative/fractional`;
- если list row не содержит самого `price`, только для такой записи сделать Attribute detail GET и затем включить/исключить её из invalid candidates;
- отсутствие `barcode` само по себе больше не вызывает detail GET: barcode дочитывается только для уже invalid + active offer, если его всё ещё нет в source row/detail;
- оставшиеся GET выполнять throughput-aware adaptive waves: старт 10, шаг 5, min 5, max 60;
- ступень оценивать после 50 успешных tasks; новая ступень должна улучшить best throughput минимум на 3%;
- после двух подряд неулучшающих ступеней откатываться к best concurrency и фиксировать его;
- network error / `429` / `5xx` для GET безопасно ретраить до 3 попыток и одновременно снижать concurrency с повторным benchmark;
- постоянные `4xx` и response-contract ошибки не ретраить, run останавливать без partial CSV;
- relation `attribute.product` читать только первую запись, потому что downstream-контракт использует только первый связанный Product;
- `product.active` detail кэшировать по Product `documentId`;
- порядок итоговых CSV строк сохранять по исходному порядку attributes, несмотря на параллельное чтение.

Output:

```text
documentId
barcode
price
errorType
```

CSV: `attributes-wrong-prices.csv`, без timestamp. Отдельная сортировка не нужна — строки остаются в порядке добавления по мере обработки. При 0 проблем CSV не создаётся, достаточно сообщения в Console. При API/response ошибке запуск останавливается и частичный CSV не формируется.

Progress разделён по фазам: list loading → price precheck → invalid candidates relation check. Итоговый CSV contract не меняется. Дополнительно сохраняется `window.attributesWrongPricesReadReport` с totalAttributes, priceDetailFallbacks, invalidCandidates, activeInvalidOffers, requests/retries/final/best concurrency и benchmark waves.

## CANONICAL — products missing content

Назначение: найти все Product с незаполненными критичными полями, независимо от `product.active`, статуса публикации (draft/modified/published) и активности категорий.

Parser: `extension/tools/audits/products-missing-content.js`. Source — Content Manager API, локаль `ru`. Проверяется фактическое текущее состояние каждой записи в CMS; Public REST не используется.

Логика:
- загрузить все страницы Product; никакие записи по `active` или status не исключать;
- для каждого Product прочитать detail и native Content Manager relations `brand`, `categories`;
- проверить наличие `name1`, `name2`, `detail_picture`, `preview_picture`, `brand`, `categories`, `detail_text`;
- если отсутствует хотя бы одно из семи полей — включить Product в report ровно один раз;
- статус связанных Category и наличие/отсутствие иных полей не влияют на выборку.

Контент считается отсутствующим, если:
- `name1` / `name2` пустые или содержат только пробелы;
- `detail_picture` / `preview_picture` не содержат media;
- `brand` / `categories` не содержат ни одной связанной записи;
- `detail_text` после удаления HTML tags и `&nbsp;` / `&#160;` не содержит текста.

Output:

```text
documentId
missingFields
```

CSV: `products-missing-content.csv` (без timestamp). `missingFields` содержит через запятую все отсутствующие поля записи. Сортировка по `documentId`. При успешном запуске CSV создаётся и при нулевом числе проблем (только заголовки).

Content Manager pagination/response должны соответствовать ожидаемому контракту; при ошибке чтения, отсутствии требуемого field в detail или несовпадении данных аудит прерывается без частичного CSV. Проверка read-only.

Пустая связь — не ошибка: для `brand` или `categories` валиден ответ с `results: []` и `pagination.total: 0` (на первой странице `pageCount` может быть 0 или 1). Такой Product должен попасть в CSV с отсутствующим relation field, а аудит — продолжиться. Но пустая страница при `total > 0`, неожиданное изменение пагинации или malformed response — ошибка чтения; неполный CSV не формировать. Исправление учтено в tool v2.0.1. **Не переносить правило “любая пустая страница = ошибка” на пустые relations.**

Изменение условий реализовано 2026-10-30; полный verified production-прогон с реальным CMS API после изменения пока не подтверждён.

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

## CANONICAL — Product Save/Publish по Strapi Admin Network

Наблюдение из `network-recorder.json` (2026-10-30, одна карточка Product, локаль `ru`): штатные Save и Publish выполняются по следующим путям:

```text
PUT  /content-manager/collection-types/api::product.product/<productDocumentId>?locale=ru
POST /content-manager/collection-types/api::product.product/<productDocumentId>/actions/publish?locale=ru
```

При Save UI отправил **полный payload карточки**, в том числе `newFrom1C: true` и `active: false`; HTTP 200 вернул `data.status: "modified"` и `data.publishedAt: null`. Затем Publish UI снова отправил **полный payload**, включая те же boolean; HTTP 200 вернул `data.status: "published"` и ненулевой `data.publishedAt`. Это подтверждает штатную последовательность **Save → Publish**, но не доказывает, что **один** `POST actions/publish` с `{"newFrom1C":true}` или `{"active":false}` безопасно изменяет scalar field и публикует его без отдельного PUT. Такие минимальные payload были лишь предложены в одноразовых Console-скриптах, production-результат не подтверждён. Перед массовым использованием провести пилот с GET verify и при необходимости вернуться к подтверждённой последовательности.

Не путать с отдельно подтверждённым для category sync минимальным `actions/publish` с `categories.connect` — его успех нельзя автоматически обобщать на scalar fields. При массовой записи не отправлять сохранённый ранее полный объект Product без проверки: это создаёт риск перезаписать актуальные fields/relations. URL и контракт всегда повторно сверять по live Network при изменении версии Strapi.

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

## CANONICAL — одноразовые массовые Product write из CSV / relation-аудита

Это reusable **порядок работы**, а не runtime tool в repo: одноразовые Console-скрипты и конкретные CSV/brand IDs не сохранять в `extension/tools/` или README без отдельного требования.

- Источник задач: файл аудита `products-missing-content.csv` (`documentId;missingFields`) либо точная проверка relation `brand` по заданному набору `documentId` через Content Manager. Для CSV поддерживать UTF-8 BOM, `;` и quoted cells, валидировать заголовки/ID и убирать или блокировать дубли **до write**. Для relation-аудита читать все страницы Product `ru`, затем связанные `brand` и сравнивать **relation documentId**, не название; не фильтровать исходный список по `active` или status, если задача этого не требует.
- Сначала полный read-only dry-run, количество кандидатов и уже соответствующих целевому состоянию, затем явный confirm. Делать небольшой пилот (исторически 5 Product), проверить реальные результаты Save/Publish, только затем отдельное confirm на весь оставшийся объём.
- Перед каждым write повторно читать текущий Product / целевую relation и сверять критерий. Для `active=false` достаточно skip только если `active === false` **и** status уже `published`; статус `draft/modified` может требовать Publish даже при совпадающем boolean. Scope локали задавать явно (`ru`), другие поля и relations не менять.
- Write проводить небольшим контролируемым concurrency/batches с progress, counters, Stop. При больших объёмах хранить checkpoint по устойчивой сигнатуре input и фиксировать отдельно `updated`, `already`, `skipped/changed`, `error`, `review`, `pending`; после перезапуска пропускать только подтверждённые completed записи. По итогам автоматически отдавать CSV-отчёт, а не только Console.
- После Save/Publish проверять результат новым GET Content Manager (целевой boolean и статус), при необходимости отдельно published view. `POST actions/publish` не ретраить вслепую при timeout/network/429/5xx: запрос мог успеть примениться; сначала GET verify, неоднозначное состояние → `review`. Временные GET допускают bounded retry. Если пилот не подтвердился — не начинать массовые write.
- Публикация прежде draft Product может сделать его доступным клиенту даже при `active=false` (зависит от downstream-фильтров). Это осознанный эффект команды Publish, не просто сохранение boolean. Не обещать, что опубликованные товары останутся скрыты без проверки клиентского API.

HISTORICAL: в чате 2026-10-30 были собраны два одноразовых Console workflow — по CSV включить `newFrom1C=true` с Save/Publish и по выбранным relation `brand` сделать `active=false` с Save/Publish. Код не коммитился и не проходил подтверждённый массовый production-run. Сохранять только переносимые правила выше, не конкретные brand `documentId` и не исходные CSV.

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

## CANONICAL — пример пользовательской редакции ТЗ (2026-10-30)

Основание: пользователь самостоятельно отредактировал ТЗ «Доработка функционала подборок для мобильного приложения». Это подтверждённый **образец стиля и подачи**, а не новый технический контракт для `category`; правила оформления задаёт раздел «ТЗ, переписка и отчёты» в Instructions.

Характерные отличия итоговой редакции:
- Вводная разделена на три коротких смысловых абзаца: существующее использование коллекции → новое намерение → зачем нужен отдельный признак. Не нужно искусственно объединять всё в один абзац.
- Вместо «Что изменить» выбран заголовок **«Что нужно»**; далее нумерованные практические действия и вложенные пункты для условий `selection` / `custom` / `active`.
- Убраны необязательные `Strapi` и `(category)` из вводной и первого пункта. Название «Разделы» достаточно, а технические имена полей остаются, где описывается логика.
- Существенно уточнён scope миграции данных: «со значением по умолчанию false для всех уже имеющихся записей» — это требование не терять при сокращении формулировки.
- Пункты и итоговая оговорка лаконичны, без заключительных точек. Отдельных критериев приёмки, дополнительных сценариев и пояснений после ТЗ нет.
- Отсутствует выдуманное правило о приоритете `selection` над `custom`: пользователь оставил только три явно описанные комбинации и требование не менять логику `custom`.

Фрагмент вводной части, сохранивший авторский ритм:

> Коллекция «Разделы» используется для основного и кастомизированного каталогов, которые различаются через булево custom
>
> Сейчас планируется создавать в этой же коллекции отдельные подборки товаров, не относящиеся ни к одному из каталогов
>
> Для разделения записей по назначению и их независимой обработки необходимо добавить отдельный признак подборки

После **«Что нужно»** перечисляются требуемые изменения, а в конце — одно условие совместимости: «Добавление нового поля не должно изменять существующую логику custom, работу каталогов и связи разделов с товарами».

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

`extension/ui-ux/product-sections.js` отвечает только за вкладки `Контент / Фильтры / Системное`, show/hide полей и смысловые заголовки групп. Нативные React fields не перемещать между DOM-контейнерами: это конфликтует с внутренним SPA/focus Strapi. Для временного визуального порядка групп допустим CSS `order` на существующих top-level rows (без reparent): после этого `layout-sync.js` переносит тот же порядок в штатный `layouts.edit`.

Штатный порядок карточки хранится в Content Manager configuration:

```text
GET/PUT /content-manager/content-types/api::product.product/configuration
```

Source of truth для физического порядка — `layouts.edit`. Service `extension/tools/sync/layout-sync.js` используется после layout-изменений: читает текущий UI; для вкладки `Фильтры` учитывает `data-tm-product-filter-group-order`, выставленный `product-sections`, поэтому смысловые группы сохраняются в заданном порядке; делает dry-run/diff, сохраняет существующий `size` каждого поля, после подтверждения меняет только `layouts.edit` через штатный configuration API и делает GET verify. `settings`, `layouts.list` и смысл metadata не менять. После успешной синхронизации `product-sections` не должен повторно переставлять поля в DOM.

## Style-stealer UI origin semantics

**Статус:** CANONICAL.

Для design snapshot страницы `extension/tools/diagnostics/style-stealer.js` делит UI на три происхождения:

- `native` — нативный Strapi без наших маркеров;
- `modified` — нативный DOM-узел, изменённый extension; обычные `data-tm-*` / `tm-*` на самом элементе означают modified;
- `custom` — UI, созданный extension; root помечается `data-tm-created="<extension-id>"`, его собственные потомки считаются custom.

Если нативный Strapi-узел перемещён внутрь custom-контейнера, ставить на сам узел `data-tm-modified="<extension-id>"`: этот marker создаёт native/modified boundary и не даёт считать перемещённый React element custom. Нативные React elements перемещать, не копировать.

## Tool health semantics

Полезные смысловые проверки каталога:
- active products без attributes / brand / categories — ad hoc checks, при необходимости выполнять через Postman/internal API вместо отдельных runtime tools;
- duplicate technical fields `key`, `code_1c`, `bitrix_id`, `xml_id`, `code`; null/empty не считать duplicate value;
- wrong prices у offers active products: отдельный CANONICAL workflow выше; `missing`, `invalid`, `zero`, `negative`, `fractional`, output `documentId`, `barcode`, `price`, `errorType`;
- missing content: отдельный CANONICAL workflow выше; все Product `ru` независимо от `active`/status проверяются по `name1`, `name2`, `detail_picture`, `preview_picture`, `brand`, `categories`, `detail_text`;
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

# 10A. CANONICAL — MonAmie Helpdesk notifications

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

# 11. Security and repository decisions

- Реальные tokens/cookies не хранить в repo, документации или shared snippets.
- Strapi Admin JWT используется как локальный credential для admin requests.
- Public status `mbtema/strapi` — сознательное решение для прямой загрузки loader/Tools Launcher из GitHub. Сам по себе public repo не является дефектом; пересматривать это решение только при реальной утечке credentials/secrets или новом требовании.
- Live code-review backlog живёт в GitHub Issues; context хранит только устойчивые решения/workflows/history, а не список открытых тикетов.

---

# 12. SUPERSEDED / historical architecture

- Folder-local manifests вида `extension/manifest.json`, `features/manifest.json`, `ui-ux/manifest.json`, `parsers/manifest.json` были заменены централизованным `manifests/` 2026-09-23; 2026-11-06 registry перенесён в `extension/manifests/`. Не использовать старые paths как default.
- В 2026-09-23 папки `migrator/` и `postman/` были удалены при упрощении repo. Исторические workflows выше сохранены как knowledge, но наличие текущей реализации всегда проверять в live repo.

## CANONICAL — зеркальная синхронизация категорий Products

Назначение: поддерживать одинаковый набор Product relations внутри явно настроенных зеркальных групп Category в разных ветках каталога. Группа содержит 2+ Category и задаётся вручную внутри browser tool `extension/tools/sync/products-category-mirror-sync.js` через `MIRROR_SYNC_GROUPS`; рабочая locale только `ru`.

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

HISTORICAL live benchmark 2026-10-19 для первой mirror group из двух Category: 308 Products были опубликованы без ошибок, verify дал C1=317/C2=317/missing=0 за 37.7 сек. Throughput вырос до ~9.23 req/s на concurrency 20, а ступени 25–40 не дали улучшения и увеличили latency; это подтвердило throughput-aware rollback вместо роста только по отсутствию ошибок.

Current configured groups не дублировать в context: source of truth — live `MIRROR_SYNC_GROUPS` в `extension/tools/sync/products-category-mirror-sync.js`.

Пересечение Category между разными mirror groups сейчас не запрещается и специально не объединяется. Если реальный каталог выявит пересекающиеся группы, сначала отдельно определить бизнес-семантику такого сценария, затем менять workflow.

## CANONICAL — односторонняя синхронизация категорий Products

Назначение: поддерживать одностороннее включение Products из настроенной source Category в соответствующую target Category. Runtime tool: `extension/tools/sync/products-category-forward-sync.js`; рабочая locale только `ru`.

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

Current configured forward-sync groups не дублировать в context: source of truth — live `FORWARD_SYNC_GROUPS` в `extension/tools/sync/products-category-forward-sync.js`.

---

# 13. CANONICAL — Products Bitrix → Strapi (реальные прогоны 2026-11-05–06)

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

## HISTORICAL — первый массовый Products Importer, 2026-11-05–06

По предоставленному полному `products-import-report.csv` на **12 973** строки: **12 671 `done` с `published=true`**, **301 `category_not_found`**, **1 `review`**, **0 `error`**, **0 `partial`**. Это подтверждает массовый реальный Save/Verify/Publish/Verify, но не доказывает корректность каждого поля без выборочной проверки. В отчёте `changes=0` не учитывает отдельный PUT `newFrom1C`; не трактовать это как отсутствие работы. У 12 671 `done` итоговый флаг `newFrom1C=false`.

Все 301 `category_not_found` связаны с отсутствовавшими в CMS Category с `bitrix_id`: `1491` — 226 товаров; `1262` — 51; `1260` — 15; `2580` — 5; `2574` — 2; `2586` — 2. Пользователь подтвердил отсутствие таких записей и **создал недостающие категории**. Импортёр правильно не менял эти 301 Product; успешный повторный `--apply` именно по ним **не подтверждён отдельным итоговым CSV**.

Один `review`: Bitrix ID `246477`, Strapi `documentId=m8a6oxfr30okrmyohu2c4pnb` (Cosrx Acne Pimple Master Patch), фаза `PUT_NEWFROM1C`, ошибка `ECONNABORTED`. Пользователь **вручную проверил**, что изменения фактически сохранились и Product опубликован. `review` сигнализирует о неопределённом результате HTTP, а не о гарантированном провале. При повторном запуске по тому же CSV эти `review` пропускаются, пока результат не проверен вручную. Прежний полный CSV и его hash-журнал важно сохранять при восстановлении запуска.

## HISTORICAL — Matcher v5 после нормализации, 2026-11-06

Новый реальный `products-matched.csv` по `v5-media-flag`: **599 товаров**, 22 колонки, уникальные `documentId`, структурно корректные флаги, штрихкоды, Media URL и JSON галерей. Исходный `newFrom1C`: **404 `true`**, **190 `null`**, **5 `false`**. Это новый снимок после массовой нормализации, **не** показатель того, что первый импорт обработал только 599 товаров.

Предварительный аудит CSV (прогноз, **не результат write**): **308** товаров без реальных изменений (`CHECK_ONLY`), **315** с обязательными полями, пустыми в обеих CMS; **279** потенциальных исправлений `newFrom1C`, **96** добавлений категории, **19** синхронизаций `active`, **3** галереи (всего 24 изображения), по **1** случаю заполнения `detail_text` и двух основных Media. Группы пересекаются. Постоянные `CHECK_ONLY` ожидаемы: Matcher передаёт `newFrom1C=true/null` даже когда пополнять карточку нечем. `newFrom1C=false` с отсутствующим обязательным полем, если других различий с Bitrix нет, **не попадает в matched** — ограничение текущего правила отбора, при необходимости нужен отдельный аудит. На момент фиксации **реальный `--apply` по новым 599 товарам не подтверждён**.

## EXPERIMENT — возможное ускорение Config (не реализовано)

В `migrator/products/config.js` чтение всех страниц списка (по 100 записей) собирает **только `documentId`**. Затем для каждого Product выполняются минимум **1 GET detail + 2 GET relations** (`attributes`, `categories`), а при отсутствии нужных полей в relations — дополнительные GET Attribute/Category с Promise-кешем. При 22 550 товарах это минимум **67 650 GET на Product/relations плюс GET списка**, всего **четыре параллельных worker**. Поэтому сканирование всех страниц завершается задолго до всего Config; `Проверено N/22550` показывает реальный прогресс. Будущую оптимизацию начинать с live Network: какие поля уже есть в list и relations, можно ли убрать detail GET без потери точности. Не менять CSV-контракт и не ускорять сервер вслепую.

## Проверено / ещё не проверено

**Live failure + исправление, 2026-11-05:** даже после исправления GET URL последующий запуск Matcher остановился на `total=26454, rows=500` для имени `Подарок Elemis Dynamic Resurfacing Facial Wash Крем для умывания`; POST `setFilter` имел `data[fields][NAME]`, но фактическая HTML-таблица содержала весь каталог. Пользователь предоставил Network Payload и частичный HTML неотфильтрованного Grid с реальными `main-grid-row-body[data-id]`, колонками NAME/ID, оригинальными media links. Не считать `setFilter` достаточным подтверждением. Старый поиск per-name SUPERSEDED и заменён на CANONICAL design / EXPERIMENT implementation полного каталожного индекса (commit c780607). Подтверждены только мок-тесты строгого сравнения пробелов/регистра, проверка повторного ID и разметка первых реальных строк; реальный полный проход и карточки ещё не тестировались. Важно: в загруженном HTML встречается `sessid`, не копировать его в код или context.

**Live Network, 2026-11-05:** пользователь вручную выполнил поиск Bitrix Admin по NAME «Пропеллер»; `main.ui.filter` POST `setFilter` с `data[fields][NAME]` и `apply_filter=Y`, затем POST Grid `iblock_element_admin.php` вернул `total=17` и 17 товаров. Подтверждённый Grid URL содержит `IBLOCK_ID=1&type=catalog&lang=ru&find_el_y=Y&clear_filter=Y&internal=true&grid_id=<динамический>&apply_filter=Y&clear_nav=Y&grid_action=showpage&bxajaxid=<динамический>`, а старый Matcher вместо `find_el_y/clear_filter` добавлял `find_section_section=-1`. Параметры Matcher скорректированы по Network; это **проверка положительного поиска**, для нулевого результата и полного запуска ещё нужен live-тест. Не сохранять `sessid` и значения session-specific ID как константы.

2026-11-05 на стадии разработки проверены синтаксис, соответствие 12+10=22 полей, CSV quoting/newline parser и mock-сценарии Matcher/Importer. Впоследствии получены **реальные результаты**, описанные выше: массовый Importer (12 671 done с подтверждённой публикацией) и завершённый Matcher v5 (599 кандидатов). Эти результаты заменяют прежнюю пометку «новый Importer не проверен». Однако реальный повторный `--apply` именно для CSV v5 и окончательная обработка старых `category_not_found` не подтверждены; HTTP-сбой одной карточки потребовал ручной проверки.

Проверенный порядок повторной нормализации: свежий `products-config.csv` → Matcher текущей версии в авторизованной Bitrix Admin → проверить summary и новый `products-matched.csv` → Products Importer dry-run → `--apply` → проверить `products-import-report.csv`, `category_not_found`, `review` и итоговый `newFrom1C`. Старый v4 CSV имеет **тот же 22-колоночный формат**, но устаревшее состояние; для новой волны нужен свежий Config/Matcher. Journal Importer привязан к **байтам конкретного CSV (hash)**: одинаковый CSV возобновляет checkpoint, пересозданный CSV даёт другой журнал. Не смешивать файлы Products и Attributes и не пересохранять CSV через Excel. `starter.ps1` сразу запускает весь `--apply`, не использовать его для диагностического пилота. JWT, Bitrix Cookie, sessid, HTML с секретами не сохранять в GitHub/knowledge.

## HISTORICAL — production-наблюдения 2026-10-30 и 2026-11-02

- В исследованном **фрагменте** первого production-отчёта (45 `partial`, у всех `changes=0`): 25 товаров Hermes/Terre dHermes — отсутствуют `name1|name2|preview_picture|detail_picture|detail_text`; 17 товаров разных брендов — отсутствует `categories`; 3 товара — отсутствует `name2`. Все 45 сохраняли `newFrom1C=true`, Publish не выполнялся. Это **не** статистика всего запуска; причины в источнике Bitrix и в парсере не подтверждены.
- Пользователь 2026-10-30 дождался двух CSV от оптимизированного matcher (`matched` и `unmatched`); полная статистика этого сопоставления в чате не зафиксирована.
- 2026-11-02 во время нового production-импорта консоль показывала **3541/5281 обработанных**, `успешно/частично 3541`, `ошибки чтения 0`, `ручная проверка 0`; последние строки `done`, Verify Publish и `newFrom1C=false`. **Финальный итог 5281 товаров не подтверждён**: при продолжении работы сначала получить полный report/journal.
- Практический Windows-сбой: QuickEdit/«Выбрать Windows PowerShell» при клике мышью ставит консольный Node.js процесс на паузу. `Esc` снимает выделение и выполнение продолжается; не закрывать окно и не нажимать `Ctrl+C` без необходимости.
- Изначально файлы товарного pipeline назывались `migration-*`, позднее инструменты разделены на `migrator/products/` и `migrator/attributes/`, а товарные файлы переименованы в `products-*`. При восстановлении старого прогона **не считать новый importer автоматически совместимым со старыми checkpoint**: имена журналов/Media checkpoint тоже изменились; сохранить старые исходный CSV, journal, media checkpoint и локальный importer, не пересохранять CSV через Excel. Даже с тем же содержимым CSV новая версия ищет файлы под другими именами. Переименование/перенос checkpoint — только после проверки соответствия конкретному прогону.

## Следующий шаг при продолжении этой работы

Ориентироваться на реальные результаты и ограничения раздела 13: первый массовый Products Importer подтвердил 12 671 `done`, обновлённый Matcher v5 выдал 599 кандидатов. При продолжении запросить свежий `products-import-report.csv` для волны на 599 строк и отдельное подтверждение повторной обработки 301 `category_not_found`; не объявлять их выполненными без отчёта. При проблемах Media сверять `fileId/real_url` именно с сырым Network Response карточки Bitrix; при оптимизации Config сначала проверить ответы Content Manager list/relations. Для восстановления старого запуска сохранить **тот же исходный CSV и его journal**, а также использовавшуюся версию Importer. Исторический итог прежней миграции на 5 281 товаре (2026-11-02) по-прежнему не подтверждён.


---

## CANONICAL — Attributes Config: shade/volume в существующем pipeline (2026-11-06)

Решение: новый независимый `migrator/shades-volumes/` не нужен. Для Attribute (`api::attribute.attribute`) расширяем существующие `migrator/attributes/config.js` → `matcher.js` → `importer.mjs`. Product для этого pipeline **не читаем**: торговые предложения Strapi и Bitrix сопоставляются по собственным идентификаторам/штрихкодам. `migrator/shades-volumes/config.js` удалён; дальнейшие разработки идут в `migrator/attributes/`.

**Config output** `attributes-config.csv` (10 колонок):

```text
documentId;barcode;active;hasDetailPicture;shade;shadeDocumentId;volume;volumeDocumentId;shadeHex;volumeValue
```

2026-11-09: добавлены поля для сравнения фактических значений. `shadeHex` — все `shade.hexes[].hex` в исходном порядке, через `|` если несколько; `volumeValue` — `volume.value` (например `315`, не `315МЛ`). Предыдущие восемь колонок сохранены для диагностики и сопоставления. Пример shade: `hexes:[{id:83,hex:"#693734"}]` → `shadeHex="#693734"`; volume: `value:315` → `volumeValue="315"`. Отсутствующий relation = пустые поля; заполненный relation при пустом `hexes` либо `value:null` сохраняет `documentId`, но `shadeHex`/`volumeValue` оставляет пустым. Все Attribute ru, включая inactive/draft/пустой barcode; Product не читаем.

**Data source:** сначала Content Manager list Attributes + минимальный populate `detail_picture.id`, `shade.name`, `volume.name`; если relation представлен неполно — native `/content-manager/relations/api::attribute.attribute/<documentId>/<shade|volume>?locale=ru&page=1&pageSize=10`. У существующей связи `documentId` сохранять независимо от наличия `name`; если `name` отсутствует, пробовать target detail, затем сохранять ID + пустой name и счётчики `missingRelationNames`.

Для HEX/value Config **один раз постранично** читает справочники через `/content-manager/collection-types/api::shade.shade?page=N&pageSize=100&sort=id:ASC&locale=ru&populate[hexes][fields][0]=hex` и аналогичный `api::volume.volume` c `fields[0]=value`, затем делает join по target `documentId`. Отдельный GET target detail — только для нужных target IDs, если list API не вернул поле. Не выгружает `offers` и не делает GET target на каждый Attribute. Незаполненные HEX/value учитываются в `window.attributesConfigReport.shadeHexVolumeValue.missingValues` и `missingValueSamples`. При 404 на чтении target detail сохраняем `documentId` relation и пустое HEX/value, отмечаем `shadeHexVolumeValue.inaccessibleTargets` и `inaccessibleSamples`; 403/500 и ошибки формата не маскируем. Не придумывать HEX по имени/ID и не преобразовывать числовой volume в label. Некорректные `documentId`, pagination или формат необходимого поля → abort без CSV; missing/null значения допустимы и учитываются.

Только GET, ограниченная параллельность, прогресс, `window.attributesConfigStop=true`, UTF-8 BOM CSV (quote, separator `;`) после полного завершения; barcode сохраняет ведущие нули. Сначала был подтверждён CSV на 37 409 Attributes (10 845 со shade и 18 863 с volume); позднее после добавления HEX/value пользователь повторно выгрузил полный 10-колоночный Config на 37 409 Attributes — см. HISTORICAL о реальном цикле 2026-11-09. Мок-тесты с множественными HEX, числовым volume, null/пустым и точечным detail fallback пройдены.


**Matcher обновлён 2026-11-09:** `migrator/attributes/matcher.js` принимает только Config с 10 колонками. Bitrix grid `IBLOCK_ID=2` (GET, строго последовательные страницы по ID ASC) подтверждён скриншотом и Console: `PROPERTY_202` = Объём, `PROPERTY_271` = Текст-подсказка. В ячейке объёма отображается `50 [62915]`: 50 — числовое значение, а 62915 — Bitrix справочник `IBLOCK_ID=12`. Подтверждённая ссылка `/bitrix/admin/iblock_element_edit.php?IBLOCK_ID=12&type=infoblock&ID=62915&lang=ru...`; парсим **весь** текст ячейки по строгому шаблону `число [ID]` и проверяем, что ID в скобках равен ID в `a[href]`, а `IBLOCK_ID=12`. Подтверждённый bugfix 2026-11-09: нельзя удалять тег `a` и парсить остаток, иначе `100 [62913]` превращается в `100 []`, Matcher останавливается на Bitrix ID 9795. Исправлено в `matcher.js`, 10 mock-тестов (в том числе пустое поле и некорректный ID). Остальные нужные колонки `PROPERTY_19` barcode, `ACTIVE`, `DETAIL_PICTURE`, `ID`. Не открывать карточки, сверять только однозначный точный barcode, checkpoint нового формата `v5-volume-shade-hint`.

**Volume contract:** Bitrix = источник истины, включая **пустое значение**. Сравниваем нормализованные числовые `bitrixVolumeValue` с `volumeValue` из Config, игнорируя name: `50` и Strapi `50МЛ` с `value=50` → ничего не менять. Bitrix 50 и Strapi без relation → кандидат на добавление; Bitrix 50 и Strapi value 100 → кандидат на замену; Bitrix пусто и Strapi с relation → кандидат на удаление; оба пусты → ничего. **SUPERSEDED 2026-11-09:** первоначально предполагалось требовать единственный Volume с числовыми `name/value`, но подтверждённое позднее правило Importer разрешает точные дубли и выбирает target с минимальным `id` (`v2.1-volume-first-duplicate`); ноль совпадений по-прежнему требует ручной проверки и не создаёт справочник. Для remove — отключение текущего relation, только когда это действительно подтверждено в свежей записи.

**Shade contract:** в Bitrix `PROPERTY_271` «Текст-подсказка» — определяющий признак оттенка; `PREVIEW_PICTURE` **не признак**, поскольку всем предложениям генерируется уменьшенное изображение, лишь для некоторых контент-менеджеры вручную ставили свотч. Если подсказка заполнена и в Strapi `shadeDocumentId` пуст — вывести в отдельный `attributes-shade-review.csv`; если shade уже есть — считать обработанным независимо от HEX/name. Если подсказки нет — существующую Strapi shade не удалять. Shade никогда не отправлять на автоматическую запись через Importer. Независимые изменения volume/active/detail_picture не блокируются Shade: одна запись может попасть в оба файла.

**Matcher output (2026-11-09):** `attributes-matched.csv` (11 колонок): `documentId;barcode;active;hasDetailPicture;bitrixId;bitrixActive;pictureUrl;volumeDocumentId;volumeValue;bitrixVolumeValue;bitrixVolumeStatus`. Дополнительный статус `known|empty|manual` различает числовой Bitrix Volume, **достоверно пустое** поле и нестандартную/неподтверждённую форму; `manual` **никогда не означает удалить Volume**, даже если `bitrixVolumeValue` пуст. При `manual` запись попадает в matched только если отдельно меняются active/Media, чтобы их можно было обработать независимо (Importer позднее обязан учитывать статус). `attributes-shade-review.csv` (5 колонок): `documentId;barcode;bitrixId;bitrixShadeHint;bitrixCardUrl`; ручной backlog, если непустой. **Новый** `attributes-volume-review.csv` (8 колонок): `documentId;barcode;bitrixId;bitrixVolumeRaw;bitrixVolumeRefId;strapiVolumeDocumentId;strapiVolumeValue;bitrixCardUrl`; для безопасной ручной проверки нестандартных значений. `attributes-unmatched.csv` — неуникальные/отсутствующие barcode и прочие диагностические исключения. При ошибке grid, неоднозначных ID/ссылках, нарушении полноты/пагинации — STOP без CSV. Мок-тесты прошли на добавление/замену/удаление volume, совпадающем value, shade review, одновременном попадании в два CSV и парсинге значения 50/ID 62915. Позднее пользователь выполнил полный Matcher по новому Config: 530 кандидатов после сверки (snapshot до ручной нормализации Volume); см. HISTORICAL ниже.

**Подтверждённый баг/решение 2026-11-09:** новый Matcher на странице 2 встретил Bitrix ID `14641` с `PROPERTY_202="2х5 [107307]"` и остановил весь экспорт, потому что ожидал число `100 [62913]`. Составные обозначения не приводить к числу 10 и не считать пустой relation. При одной валидной ссылке на `IBLOCK_ID=12` и совпадающем ID допускаем произвольный *текст* значения: числовые values идут на автоматическое сравнение, остальные — `volumeStatus=manual` и отдельный CSV. Некорректный ID ссылки по-прежнему останавливает экспорт. Если в ячейке непустой текст, но нет ссылки — также `manual`, не `empty`, без удаления Volume. Bump checkpoint до `v6-volume-review`, build-marker `v5.2-volume-review`, проведены mock-тесты разбора (`100 [62913]`, `2х5 [107307]`, `2x5`, `0,5`, empty, неверные ID) и отбора кандидатов, включая автоматические active/Media при ручном Volume. Полного реального Bitrix экспорта этой версии ещё нет.

**Checkpoint/Quota bugfix 2026-11-09:** реальный Matcher с `v5.2-volume-review` прошёл 40 000 / 49 051 Bitrix предложений (страница 80/99), затем `localStorage.setItem` выбросил `QuotaExceededError` при записи большого JSON checkpoint (seenIds всех Bitrix IDs + hits по barcode). Исправлено в `migrator/attributes/matcher.js`, build-marker `v5.3-indexeddb-checkpoint`: checkpoint **с прежним ключом** `tm:attributes-matcher:v6-volume-review:<inputHash>` теперь хранится в `IndexedDB` базе `tm-attributes-matcher`, object store `checkpoints`. Чтение сначала IndexedDB, при отсутствии — старый localStorage checkpoint. После проверки `total/pageSize/pageCount/firstSignature/seenIds/hits` мигрировать старый JSON в IndexedDB и **только после успешной записи** удалить старую запись localStorage. Страницу отмечать сохранённой только после IndexedDB transaction `oncomplete`; после успешного полного экспорта удалить checkpoint из IndexedDB. Запуск с **тем же точным Config CSV** и неизменённой первой страницей Bitrix возобновляет с последней успешно записанной страницы (вероятно около 80), а не с начала. Без ключа/другой CSV — обычный запуск с начала. Мок-тесты на write/read/update/delete большого checkpoint (~5 МБ, 39 500 seen IDs / 30 000 hits) пройдены; затем пользователь завершил реальный Matcher с IndexedDB checkpoint и получил CSV на 530 кандидатов. **Не очищать хранилище браузера перед возобновлением.**

**Актуальное уточнение Volume duplicates (2026-11-09, после ручной проверки группы 25):** пользователь подтвердил, что в Strapi существуют две записи с `name=25` и `value=25`. Требование изменено: **не блокировать Importer при нескольких точных совпадениях**. В `migrator/attributes/importer.mjs` версия `v2.1-volume-first-duplicate`: поиск по числовым `name/value` остался прежним, но при `targets.length>1` выбирается **первая по id:ASC** (явная сортировка, минимальный числовой `id`), выполняется GET карточки target и подтверждение `documentId,name,value`; в `connect` передаётся актуальный numeric `id` этой карточки. Результат успешного Publish проверяется через live relation. В журнале/отчёте фиксируются `volumeCandidateCount`, `volumeSelectedDocumentId`, `volumeSelectedId`, отдельный `attributes-import-volume-duplicates.csv` собирает назначенные при дублях отношения для поздней ручной нормализации; статус `done`, а не `review`. **Только ноль совпадений** означает `review` и пропуск Volume. Если уже назначенный relation имеет тот же `value`, всё равно ничего не менять. `manual` Bitrix не трогать, `empty` удалять, Shade не менять. Mock-тесты: 2 дубля в обратном порядке ID → выбран минимальный ID, одно совпадение, ноль совпадений, сохранение уже равного volume, manual Bitrix и отдельный CSV — PASS. Реальный новый запуск этой версии ещё не подтверждён. Ранее описанное ниже ограничение «только единственная пара / дубли → review» является SUPERSEDED этим правилом; прочие части CANONICAL остаются актуальными. На этом этапе пользователь вручную разобрал первые группы Bitrix 7.7 (37), 3.5 (31), 13.3 (24), 7.5 (21), 25 (20). Позднее он сообщил о завершении **всех ранее выведенных групп**, но новый Config/Matcher после этих правок ещё не представлен; прежние CSV — исторический snapshot.

**CANONICAL — Attributes Importer Volume (2026-11-09).** `migrator/attributes/importer.mjs` адаптирован к **11 колонкам** Matcher: `documentId;barcode;active;hasDetailPicture;bitrixId;bitrixActive;pictureUrl;volumeDocumentId;volumeValue;bitrixVolumeValue;bitrixVolumeStatus`. Перед каждым изменением читает live ru Attribute по `documentId` и проверяет точный barcode; целевую to-one relation читает GET `/content-manager/relations/api::attribute.attribute/<attributeDocumentId>/volume?locale=ru&pageSize=5&page=1`. Ответ подтверждён в Network: `results:[{id:107,documentId:"gb0g9ac7orakwgzakemhjajp",name:"0,01ГР",...}]`, `pagination:{page:1,pageCount:1,total:1}`. В detail API самого Attribute `volume:{count:1}`, там нет target ID — нельзя использовать как идентификатор relation. Каталог Volume один раз загружается через native list `/content-manager/collection-types/api::volume.volume?page=N&pageSize=100&sort=id:ASC&locale=ru&fields[0]=name&fields[1]=value`; выбор target по совпадению **числовой** `value` и **числовой** `name` с Bitrix значением (без МЛ/ГР; десятичная запятая эквивалентна точке). При нескольких точных совпадениях актуальное правило `v2.1` выбирает минимальный `id` (см. уточнение выше). Для уникального найденного target перед подключением дополнительно выполняется подтверждённый GET `/content-manager/collection-types/api::volume.volume/<targetDocumentId>?locale=ru` (в Network есть такой GET со значением `id=107`) и сверяются `documentId,name,value`; именно `id` из detail используется для `connect` (в Strapi версии одного `documentId` могут иметь разные числовые ID). Для `disconnect` всегда брать `id` именно из актуального GET relation Attribute. Результат target detail кэшируется по `documentId`. **SUPERSEDED для дублей:** при нескольких точных совпадениях Importer `v2.1` выбирает первый target по `id:ASC` и записывает его в `attributes-import-volume-duplicates.csv`. Только отсутствие нужной пары → никакой записи Volume, `status=review`, `attributes-import-volume-review.csv`; не создавать справочник. Совпадающий live `value` уже назначенной relation — ничего не менять независимо от name. `known` и разные значения → добавить/заменить, `empty` → удалить существующую relation, `manual` → **никакой** записи Volume, прочие поля могут обновляться.

**Live Network подтверждение:** пользователь записал 14 запросов при ручной замене Volume в Strapi Admin; **PUT нет**, изменение прошло через `POST /content-manager/collection-types/api::attribute.attribute/dym46rzax3vx12n6nvltael8/actions/publish?locale=ru` (HTTP 200). Request body содержит полные текущие скалярные поля, `detail_picture` и relation-поля `product, shade, volume, color_variant1C, filtry`. У `volume` фактический payload:
```json
{"connect":[{"id":107,"documentId":"gb0g9ac7orakwgzakemhjajp","isTemporary":true}],"disconnect":[{"id":275,"documentId":"zlef4h3lolewzynrobe4mb26"}]}
```
Подтверждён успешный **replace**; добавление/удаление использует ту же пару массивов с одним из них пустым, без предположения о других эндпоинтах. Importer передаёт full-body c live scalar fields из подтверждённого payload и пустыми `connect/disconnect` по остальным relations, как UI; без `PUT volume`. Если нужны active/Media — отдельно старый подтверждённый PUT только этих полей, затем Verify, Publish с Volume delta, Verify опубликованной ru-версии и relation ID. Volume-only → сразу Publish с full-body. Media Bitrix — только публичный URL, без Cookie, сохранён старый upload. Конкурентные изменения выявляются повторным snapshot live Attribute + native relation перед Save и Publish; статус `modified` или draft не считается блокировкой. Неизвестный исход записи → весь batch STOP и journal review, **не** продолжать тысячи следующих записей. Auth/сетевая блокировка Strapi или публичного Bitrix Media → STOP.

**Input/тесты:** реальный `attributes-matched.csv` из пользователя содержит 5 463 кандидата (1 640 known и 3 823 empty), все строки проходят проверку контракта и требуют хотя бы одного изменения. Мок-сценарии пройдены: add, replace, remove, совпадающий вручную нормализованный volume, отсутствующий target, дубли target, manual с независимой active, ручная проверка target вместе с active; сравнение request body и проверки после Publish. **На момент первой реализации** authenticated production pilot ещё не проводился; затем пользователь подтвердил массовый запуск `v2-volume-publish` (см. HISTORICAL ниже). Новая логика дублей `v2.1-volume-first-duplicate` имеет mock-проверки, но её отдельный production-прогон не подтверждён. Запуск пользователем через PowerShell без dry-run: `node --use-system-ca "$env:USERPROFILE\\Desktop\\importer.mjs" --apply --only=DOCUMENT_ID`; затем `--apply --limit=20`, затем `--apply` с неизменённым CSV. На Desktop: `attributes-import-report.csv`, `attributes-import-volume-review.csv`, `attributes-import-journal-<hash>.jsonl`, контрольные точки после каждой строки. Сначала подтвердить один реальный add/replace/remove в Strapi перед массовой обработкой **3 823 потенциальных удалений**.

---

## HISTORICAL — Attributes: массовый импорт, ручная нормализация Volume и следующий запуск (2026-11-09—12)

Этот раздел фиксирует **завершённую историю и проверенные решения**, не текущие счётчики CMS. Основные контракты и endpoints остаются в CANONICAL выше, актуальные параметры — в live `migrator/attributes/` и README. Не смешивать исторические `attributes-config.csv`, `attributes-matched.csv` и journal из разных прогонов.

1. **Подтверждённый массовый Importer до исправлений в Bitrix.** Пользователь запустил Importer на CSV с **5 463** кандидатами: **4 956** успешно обработаны, **506** отправлены на ручную проверку Volume, **1** уже соответствовал целевому состоянию, ошибок импорта не было. Эти числа — результат данного запуска, **не** итог следующего цикла и **не** тест версии с выбором первого дубликата (`v2.1`).
2. **Повторный снимок после импорта, но до ручной нормализации Bitrix:** новый Config выгрузил **37 409 Attributes**; Matcher получил **530 кандидатов**, включая **509 расхождений Volume** и **24 изменения active** (категории пересекаются), **0 Media** и **0 удалений Volume** в этом конкретном snapshot. Отдельные файлы `attributes-shade-review.csv` и `attributes-volume-review.csv` не равны списку кандидатов импорта: Shade только для ручной работы, нестандартные/составные значения Volume — отдельная ручная проверка. Не использовать этот snapshot для новой массовой записи.
3. **Ручная нормализация в Bitrix.** Пользователь последовательно разобрал числовые группы `7.7`, `3.5`, `13.3`, `1.1`, `7.5`, `25`, `1.2`, `3.9`, `4.7`, `6.8`, `4.3`, `2.2`, `4.4`, `3.8`, а затем **сообщил, что нормализовал все оставшиеся группы Volume**. Для оттеночных товаров `7.7` (37 offers) и `3.5` (31 offer) ошибочный Volume был **удалён в Bitrix**; для других групп факт разбора/исправления известен, но не следует автоматически считать, что везде было удаление. **После этих правок нового полного Matcher/CSV пока нет**, так что фактический остаток Volume, Shade и нестандартных значений не подтверждён.
4. **Практический кейс дублей:** у значения `25` в Strapi действительно существовали две записи с `name=25`, `value=25`. Решение пользователя — не блокировать миграцию, назначить первую запись по `id:ASC` и позже при необходимости нормализовать словарь вручную. Реализовано в Importer `v2.1-volume-first-duplicate` с отдельным `attributes-import-volume-duplicates.csv`; описано выше. **Реальный массовый запуск именно v2.1 не подтверждён**, несмотря на успешно выполненные mock-тесты.
5. **Группировка ручной проверки по Product.** CSV Attributes Config (10 колонок) и Matcher (11 колонок) специально **не содержат parent Product ID/name**. Для вложенной группировки `Volume → Product → barcode` нужна отдельная подтверждённая выгрузка relation Attribute→Product или проверенный join с Products; **нельзя** приписывать один Product по общему префиксу/похожести barcode. Если дополнительной связи нет, выдавать только `Volume → barcode` без вымышленных товарных групп.
6. **Следующее действие после слов пользователя о завершении нормализации:** начать новый цикл **с чистого полного Config из Strapi Admin (GET) → Matcher в Bitrix Admin по новому Config → анализ свежих counters и review-файлов → Importer по новому matched**. Подтверждать, что старые ошибки исчезли, **только по новому Matcher**. Для v2.1 провести проверку одной фактической записи и отчёта дублей до нового большого write. На момент сохранения этого раздела запрос на перезапуск уже был, но **новый `attributes-config.csv`/Matcher и production-результат после ручных правок пользователь ещё не прислал**.

