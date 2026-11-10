# Strapi 5.13.0 — Product RU → KK: механизм и подтверждённые ограничения

## Текущий инструмент

[product-kk-sync.js](./product/product-kk-sync.js) — **один Console-скрипт для одной карточки Product, без фильтра по бренду**.

Workflow: GET схема и snapshot RU Draft/Published + relations + KK → проверить отсутствие KK → PUT создания KK с **каждым нелокализуемым полем RU**, включая scalar, media ID и пустые компоненты → сравнение RU с исходным снимком → Publish RU с полным payload → сравнение → Publish KK с полным payload → полная сверка. Все write по отдельным подтверждениям в одной панели, одна итоговая JSON-выгрузка, stop-on-diff, без автоматического rollback/retry и batch.

Для создания KK временно передаём значения обязательных локализуемых полей из RU, а если отдельное `name1` отсутствует — только для создания используется прежняя заглушка `" "`; публикация при некорректном required-поле блокируется. Непустые компоненты, dynamic zones, UID и неизвестные типы блокируются, пока не подтверждена правильная сериализация.

**Статус:** проверено создание KK в изолированных пилотах, но новый единый скрипт и публикация обеих локалей ещё **не проверены на живой CMS**. До этого никакого массового исполнения.

## Подтверждённая проблема

В Strapi 5.13.0 при `PUT /content-manager/collection-types/api::product.product/<documentId>?locale=kk` c неполным JSON `{"newFrom1C":true,"InStock":false,"name1":" "}` создался KK Draft, но RU Draft потерял значения `name`, `xml_id`, `code_1c`, `sort`, `active`. RU Published осталась целой. Причина — в i18n middleware синхронизация non-localized attributes после update/create/publish.

Upstream:
- [i18n bootstrap.ts v5.13.0](https://github.com/strapi/strapi/blob/v5.13.0/packages/plugins/i18n/server/src/bootstrap.ts)
- [i18n localizations.ts v5.13.0](https://github.com/strapi/strapi/blob/v5.13.0/packages/plugins/i18n/server/src/services/localizations.ts)
- [Issue #27182](https://github.com/strapi/strapi/issues/27182) / [PR #27184](https://github.com/strapi/strapi/pull/27184); fix объединён 2026-11-03, но не вошёл в релиз v5.61.0 от 2026-11-04.

Нелокализуемые поля нельзя пропускать даже если `required=false` или текущее значение `null/false/0`. При создании или обновлении KK они могут синхронизироваться в RU и обнулить значения, если не переданы явно. Relations локализуются по умолчанию и не копируются в KK.

## Подтверждённые пилоты (исторические скрипты удалены из рабочего дерева)

1. Product `loeqjcvawiaajxsyld5g3jqc`: повторный PUT со всеми **21 общими полями RU** + `name1:" "` → KK Draft `4812516`, HTTP 200, 0 различий RU-бизнес-полей, 0 различий 19 relation-полей RU. Published RU проверен отдельно; не изменился. RU Draft стал `modified`, обновился `updatedAt`.
2. Product `b8tzy63p6ij03w5z4yuutuwu`: PUT со всеми общими значениями, включая media `170312` в `preview_picture`, `detail_picture`, `pictures`, и заполненные фильтры → KK Draft `4812550`, HTTP 200. Все **45 бизнес-полей** RU Draft и Published, **19 связанных записей** и media сохранились. RU Published ID/`updatedAt`/`publishedAt` не изменились. RU Draft `published → modified`, но данных не потерял.
3. Одноразовый read-only аудит 705 товаров DIOR обнаружил 87 без KK на момент аудита. Он использовался только для выбора тестовых товаров, не входит в рабочий механизм.

Статус `modified` после создания KK считаем допустимым побочным эффектом **только при полном совпадении всех бизнес-полей RU и relations**. Исходный RU `modified` можно публиковать вместе с KK — это отдельно согласованное поведение, при котором предшествующие правки RU Draft станут публичными. Тестовые данные, ранее опубликованные пользователем в RU Product `b8tzy63p6ij03w5z4yuutuwu` до PUT KK, требуют последующей управляемой очистки.

## Важное про Publish

В [Strapi 5.13 Content Manager `collection-types.ts`](https://github.com/strapi/strapi/blob/v5.13.0/packages/core/content-manager/server/src/controllers/collection-types.ts) `publish(ctx)` **может сначала вызвать `updateDocument(ctx)`**, затем `documentManager.publish`. `getDocumentLocaleAndStatus(body,model)` берёт `locale` из **JSON body**, а не только query: [`validation/dimensions.ts`](https://github.com/strapi/strapi/blob/v5.13.0/packages/core/content-manager/server/src/controllers/validation/dimensions.ts). Поэтому при каждом Publish новый инструмент посылает и `?locale=...`, и `locale` в JSON вместе со всеми доступными общими полями из RU, а также локализованными значениями соответствующей локали. Relations в теле Publish не передаются; после операции все relation IDs проверяются. Публикуем **RU сначала, KK затем**, чтобы при исходном RU `modified` общие Published-поля были приведены к текущему RU Draft до публикации KK.

**Если любой POST вернул неопределённый статус либо проверка после записи не прошла — стоп, сохраняется единый JSON, повторная запись не выполняется.**
