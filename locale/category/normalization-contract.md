# Category RU → KK — production normalizer

**Рабочий скрипт:** [`normalizer.js`](./normalizer.js). Прежний CHANEL-пилот подтверждён в истории Git и `project/context.md`; его ограничение на бренд заменено на весь RU Content Manager Category. Независимый `localizer.js` — другой инструмент, нормализатор его не вызывает.

## Scope и запуск

- Запускать весь JS на **общем списке Category RU** в Strapi Admin: `/admin/content-manager/collection-types/api::category.category?page=1&pageSize=100&sort=id:ASC&plugins[i18n][locale]=ru&_q=`.
- Выполнение **всегда production**, без dry-run и одноразовых apply-флагов. Если записи актуальны, PUT/POST не отправляются.
- Источник — внутренний подтверждённый Content Manager API: `GET /content-manager/collection-types/api::category.category?locale=ru&status=draft&page=N&pageSize=100&sort=id:ASC`. Пройти **все страницы**, сверить `pagination.total` и `pageCount`, уникальность `documentId`, `locale=ru` и монотонный `id:ASC`. При неполном/изменившемся списке — глобальный стоп до любых записей. Число категорий **не фиксировать**.
- Scope: все доступные RU Category независимо от бренда; у Category связь `brand` может быть пустой или указывать на любой бренд. Источник полей и relations — RU Draft.

## Операции (те же, что на CHANEL)

1. **Content:** взять RU и KK Draft, создать отсутствующий KK через `PUT /content-manager/collection-types/api::category.category/{documentId}?locale=kk`, существующий обновить только по нужным различиям. Сохранять уже существующие KK локализованные тексты и Media любой глубины. Данные компонентов и Dynamic Zone сериализовать по живой схеме, Media — по ID. `filters_app` брать из RU Draft. `key`, `code`, `slug` не нормализовать и не включать в PUT, контролировать отсутствие побочного изменения. **Пустой RU Draft.key (`null` или `""`) не является причиной пропуска Category**: поля, связи и публикация обрабатываются обычным порядком; текущие значения `key` сохраняются и строго сверяются после записи. Если Strapi неожиданно преобразует `null` в `""` или меняет ключ, postflight останавливает запись без автоматического повторения. Для отсутствующей KK — уникальность `bitrix_id` с RU positive control по Content Manager list filter.
2. **Relations:** сравнить полные списки root relation `documentId` по RU/KK Draft (через native relation GET со всеми страницами), добавить **только недостающие** `parent`, `brand`, `product` по актуальным `id` KK Draft target. Точный payload `{locale:'kk',[field]:{connect:[{id,documentId,locale:'kk'}],disconnect:[]}}`. До 20 links на PUT, последовательные записи и проверки. Нет рекурсивного создания/публикации Product/Brand. `categories` восстанавливается через owner-side `child.parent`, а не отдельным PUT. Исторические inverse `products`/`top_brands` были пусты в CHANEL; ненулевой состав **пока не поддерживается текущим контрактом** — такая Category пропускается с reason, без опасной записи.
3. **Publish:** после полной сверки Draft-контента и Draft-графа публиковать сначала RU, затем KK с `POST /content-manager/collection-types/api::category.category/{documentId}/actions/publish?locale=ru|kk` только при необходимости. Проверить обе Draft без дрейфа, поля/Media/`key` опубликованной версии, отсутствие неожиданных Published links. Published имеет право содержать **подмножество** Draft relations (если связная KK запись ещё только Draft); это информационное отличие, а не потеря данных.

## Защита и вывод

- Перед каждым PUT/POST — полный prewrite snapshot и `pending` в IndexedDB `tm-category-normalizer-production-v1`. После — read-only postflight четырёх версий, атомарное `done` и снятие pending. Нет автоматического повтора PUT/POST. При прерывании повторный запуск сначала GET-сверкой подтверждает pending; неоднозначность приводит к остановке. GET при временных ошибках повторяется ограниченно, операции последовательно.
- Отдельная Category с неподдерживаемыми полями/связями или отсутствующим target KK Draft фиксируется в `issues` и пропускается; при нарушении целостности после записи — **global stop**. Прогресс в Console; `window.tmCategoryNormalizerStop=true` останавливает перед следующей операцией.
- Автоматический вывод: `category-normalization-production-YYYY-MM-DD.json` (полный отчёт, ошибки, статусы, сведения о невидимых Published links) и `category-normalization-production-results.csv` (по каждой Category). Итог `completed`, `completed-with-issues` или `stopped` — по реальному результату.
- Серверной резервной копии БД нет; браузерный журнал/JSON не является её заменой. Запуск скрипта означает разрешение реальных изменений в пределах scope.

## Степень подтверждения

- Из предшествующего CHANEL production-пилота подтверждены KK seed PUT, Brand connect PUT, Publish RU+KK, postflight и повторный production без лишних записей: 65/65 Category. Это доказательство логики для CHANEL, **не** проверка реального полного каталога.
- Новый list-scope проверен программно на 205 синтетических Category (3 страницы), с разными брендами и пустым `brand`: 205 обработаны, 410 опубликованных версий признаны актуальными, 0 PUT/POST и ошибок. Полный live запуск всего каталога пока не выполнялся.
