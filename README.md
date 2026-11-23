# Скрипты репозитория

Краткий каталог активных скриптов: назначение и архитектура. Подробные рабочие контракты и история хранятся отдельно в `project/context.md`.

## Strapi Admin — расширения

| Скрипт | Функция и архитектура |
|---|---|
| [`extension/extension.js`](./extension/extension.js) | Tampermonkey loader: подключает `features` и `ui-ux` через manifests, запускает кешированные модули и обновляет кеш по версиям. |
| [`features/alt-enter-publisher.js`](./extension/features/alt-enter-publisher.js) | Публикация текущей записи по `Alt+Enter` через штатную кнопку интерфейса Strapi. |
| [`features/tools-launcher.js`](./extension/features/tools-launcher.js) | Панель `Alt+P`: читает `manifests/tools.json`, группирует инструменты и загружает JS из GitHub при запуске; защищает от повторного параллельного запуска. |
| [`ui-ux/sidebar.js`](./extension/ui-ux/sidebar.js) | Группировка коллекций, навигация и поиск в боковой панели Strapi; поддерживает состояние групп и SPA-навигацию. |
| [`ui-ux/record-list.js`](./extension/ui-ux/record-list.js) | Настройка таблиц Content Manager: компактные локали, переходы в записи и управление отображением строк. |
| [`ui-ux/entry-relocate.js`](./extension/ui-ux/entry-relocate.js) | Перенос штатных действий записи к информации о Draft/Published, без копирования React-кнопок. |
| [`ui-ux/product-attributes-navigator.js`](./extension/ui-ux/product-attributes-navigator.js) | Поиск и пагинация торговых предложений в Product; чтение relation `attributes` и переход к нативному управлению связями. |
| [`ui-ux/product-sections.js`](./extension/ui-ux/product-sections.js) | Разделение Product на вкладки контента, фильтров и системных полей; визуальная группировка без перемещения нативных React-полей. |

## Strapi Admin — Tools

Инструменты запускаются через Tools Launcher; реестр — `extension/manifests/tools.json` (`file`, `group`).

| Скрипт | Функция и архитектура |
|---|---|
| [`extractor/brandActiveProducts.js`](./extension/tools/extractor/brandActiveProducts.js) | Читает все Product-связи открытого Brand, отбирает активные товары и выгружает `documentId` в CSV. |
| [`extractor/categoryTreeProducts.js`](./extension/tools/extractor/categoryTreeProducts.js) | Рекурсивно обходит дочерние Category, собирает уникальные связанные Products и экспортирует CSV. |
| [`pusher/brandProductsDeactivate.js`](./extension/tools/pusher/brandProductsDeactivate.js) | Выключает `active` у связанных с Brand товаров: проверка, последовательные небольшие батчи Save/Publish, верификация и CSV результата. |
| [`syncer/categoryGroupForward.js`](./extension/tools/syncer/categoryGroupForward.js) | Переносит недостающие Products из source Category в target по настроенным парам; только `connect`, без удаления существующих связей, с dry-run и проверкой. |
| [`syncer/categoryGroupMirror.js`](./extension/tools/syncer/categoryGroupMirror.js) | Выравнивает Products внутри именованных групп Category: объединяет множества и добавляет недостающие связи; последовательные группы, проверка и адаптивная параллельность. |
| [`syncer/categoryRelations.js`](./extension/tools/syncer/categoryRelations.js) | Синхронизирует `parent`, `categories`, `product` RU → KK одной Category; обратные дочерние связи меняет через `child.parent`, пропуски KK отражает в CSV и публикует изменённые KK Category. |
| [`service/dom.js`](./extension/tools/service/dom.js) | Снимок DOM текущей страницы в буфер обмена, с fallback на стандартное копирование. |
| [`service/layout.js`](./extension/tools/service/layout.js) | Сопоставляет порядок полей Product в UI с `layouts.edit`; dry-run, подтверждённая запись configuration и GET-проверка. |
| [`service/network.js`](./extension/tools/service/network.js) | Перехватывает same-origin `fetch`/XHR между Start и Stop; собирает диагностический JSON запросов и ответов. |
| [`service/styles.js`](./extension/tools/service/styles.js) | Извлекает вычисленные стили, CSS-правила и токены Strapi; группирует снимки по native/modified/custom и экспортирует JSON. |

## Локализация RU → KK

| Скрипт | Функция и архитектура |
|---|---|
| [`locale/attribute/dry-run.js`](./locale/attribute/dry-run.js) | Без записи сравнивает RU/KK версии одного Attribute, связи и план переноса; результат — диагностический JSON. |
| [`locale/attribute/preflight.js`](./locale/attribute/preflight.js) | GET-only проверка схемы, четырёх версий Attribute и доступности KK связанных записей; экспорт JSON. |
| [`locale/category/normalizer.js`](./locale/category/normalizer.js) | Обходит RU Category, создаёт/обновляет KK Draft, дополняет доступные связи и публикует необходимые версии; использует snapshots, IndexedDB journal и проверки записей. |
| [`locale/product/normalizer.js`](./locale/product/normalizer.js) | Браузерная нормализация Product RU → KK: обход каталога, сохранение KK переводов/медиа, дополнение связей, публикация и проверки с IndexedDB journal. |
| [`locale/product/localizer.mjs`](./locale/product/localizer.mjs) | Отдельный Node.js localizer с dry-run, backup, checkpoint и recovery старых RU → KK Product операций. |

## Миграция Bitrix ↔ Strapi

Два независимых pipeline: `config` (Strapi) → `matcher` (Bitrix) → `importer` (Node.js).

| Скрипт | Функция и архитектура |
|---|---|
| [`migrator/products/config.js`](./migrator/products/config.js) | Извлекает Product из Strapi в CSV для сопоставления: данные записи и связи, с постраничным чтением и диагностикой. |
| [`migrator/products/matcher.js`](./migrator/products/matcher.js) | Сопоставляет товары с каталогом Bitrix по точному названию и общему штрихкоду; сохраняет CSV и checkpoint. |
| [`migrator/products/importer.mjs`](./migrator/products/importer.mjs) | По CSV обновляет Product в Strapi: активность, медиа, недостающий контент и категории; dry-run/apply, проверка и журнал. |
| [`migrator/products/starter.ps1`](./migrator/products/starter.ps1) | PowerShell-обёртка запуска Node.js `importer.mjs --apply` с системным хранилищем сертификатов. |
| [`migrator/attributes/config.js`](./migrator/attributes/config.js) | Извлекает Attribute и связанные Shade/Volume из Strapi в CSV; чтение всех страниц и справочников. |
| [`migrator/attributes/matcher.js`](./migrator/attributes/matcher.js) | Сопоставляет Attribute с Bitrix по штрихкоду; готовит CSV для обновления active, Media, Volume и ручного review Shade/Volume. |
| [`migrator/attributes/importer.mjs`](./migrator/attributes/importer.mjs) | Обновляет Attribute из CSV: active/Media и подтверждённые изменения Volume; защищённая публикация, проверка и отчёты. |
| [`migrator/attributes/starter.ps1`](./migrator/attributes/starter.ps1) | PowerShell-обёртка запуска Node.js `importer.mjs --apply` с системным хранилищем сертификатов. |

## Helpdesk — n8n workflows

| Workflow | Функция и архитектура |
|---|---|
| [`helpdesk/workflow.json`](./helpdesk/workflow.json) | Telegram → n8n → Notion: регистрация сотрудника, приём обращения с текстом/медиа и создание карточки обращения. |
| [`helpdesk/notifications.json`](./helpdesk/notifications.json) | Notion → webhook n8n → Telegram: отправляет уведомления об изменении статусов обращения. |
