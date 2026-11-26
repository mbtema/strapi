# Скрипты репозитория

Краткий каталог активных скриптов: назначение и архитектура. Подробные рабочие контракты и история хранятся отдельно в `promts/project/context.md`.

## Strapi Admin — расширения

| Скрипт | Функция и архитектура |
|---|---|
| [`extension/extension.js`](./extension/extension.js) | Tampermonkey loader: подключает `features` и `ui-ux` через manifests, запускает кешированные модули, проверяет commit snapshot и Git blob SHA; `forceUpdate()` обновляет кеш и перезагружает CMS. |
| [`features/alt-enter-publisher.js`](./extension/features/alt-enter-publisher.js) | Публикация текущей записи по `Alt+Enter` через штатную кнопку интерфейса Strapi. |
| [`features/tools-launcher.js`](./extension/features/tools-launcher.js) | Панель `Alt+P`: читает `manifests/tools.json`, группирует инструменты и загружает JS из GitHub при запуске; защищает от повторного параллельного запуска. |
| [`ui-ux/designSystem.js`](./extension/ui-ux/designSystem.js) | Общая визуальная основа: официальные токены Strapi, Light/Dark, переиспользуемые компоненты и цветовые образцы. |
| [`ui-ux/collection/attribute.js`](./extension/ui-ux/collection/attribute.js) | Вкладки Content/AR/Marketing/System карточки Attribute, show/hide нативных полей. |
| [`ui-ux/collection/product.js`](./extension/ui-ux/collection/product.js) | Вкладки контента, фильтров и системных полей Product; смысловые группы без перемещения нативных React-полей. |
| [`ui-ux/relation/attribute.js`](./extension/ui-ux/relation/attribute.js) | Navigator торговых предложений Product.attributes: поиск, пагинация, ссылки, объём, оттенок и HEX-образцы; нативное управление связями. |
| [`ui-ux/relation/shade.js`](./extension/ui-ux/relation/shade.js) | Реальные цветовые образцы выбранных Shade-связей в любых коллекциях; нативный поиск и механика сохранены. |
| [`ui-ux/common/sidebar.js`](./extension/ui-ux/common/sidebar.js) | Группировка коллекций, навигация, поиск и состояние групп боковой панели. |
| [`ui-ux/common/recordList.js`](./extension/ui-ux/common/recordList.js) | Настройка таблиц Content Manager: компактные RU/KK, переходы в записи, управление отображением строк. |
| [`ui-ux/common/entryLayout.js`](./extension/ui-ux/common/entryLayout.js) | Компоновка штатных действий записи рядом с Draft/Published без копирования React-кнопок. |

UI/UX разделён на `collection` (конкретные карточки), `relation` (целевые связи), `common` (общий интерфейс). Визуальный стандарт — [Strapi Design System](https://design-system.strapi.io/); `designSystem.js` загружается первым.

## Strapi Admin — Tools

Инструменты запускаются через Tools Launcher; реестр — `extension/manifests/tools.json` (`file`, `group`).

| Скрипт | Функция и архитектура |
|---|---|
| [`extractor/brandActiveProducts.js`](./extension/tools/extractor/brandActiveProducts.js) | Читает все Product-связи открытого Brand, отбирает активные товары и выгружает `documentId` в CSV. |
| [`extractor/categoryTreeProducts.js`](./extension/tools/extractor/categoryTreeProducts.js) | Рекурсивно обходит дочерние Category, собирает уникальные связанные Products и экспортирует CSV. |
| [`pusher/brandProductsDeactivate.js`](./extension/tools/pusher/brandProductsDeactivate.js) | Выключает `active` у связанных с Brand товаров: проверка, последовательные небольшие батчи Save/Publish, верификация и CSV результата. |
| [`catalog/groupForward.js`](./extension/tools/catalog/groupForward.js) | Переносит недостающие Products из source Category в target по настроенным парам; только `connect`, без удаления существующих связей, с dry-run и проверкой. |
| [`catalog/groupMirror.js`](./extension/tools/catalog/groupMirror.js) | Выравнивает Products внутри именованных групп Category: объединяет множества и добавляет недостающие связи; последовательные группы, проверка и адаптивная параллельность. |
| [`config/categoryRelations.js`](./extension/tools/config/categoryRelations.js) | GET-only конфигурация и отбор Category для синхронизации связей RU → KK. |
| [`syncer/categoryRelations.js`](./extension/tools/syncer/categoryRelations.js) | Синхронизирует `parent`, `categories`, `product` RU → KK одной Category; обратные дочерние связи меняет через `child.parent`, пропуски KK отражает в CSV и публикует изменённые KK Category. |
| [`service/dom.js`](./extension/tools/service/dom.js) | Снимок DOM текущей страницы в буфер обмена, с fallback на стандартное копирование. |
| [`service/layout.js`](./extension/tools/service/layout.js) | Сопоставляет порядок полей Product/Attribute в UI с `layouts.edit`; dry-run, подтверждённая запись configuration и GET-проверка. |
| [`service/network.js`](./extension/tools/service/network.js) | Перехватывает same-origin `fetch`/XHR между Start и Stop; собирает диагностический JSON запросов и ответов. |
| [`service/styles.js`](./extension/tools/service/styles.js) | Извлекает вычисленные стили, CSS-правила и токены Strapi; группирует снимки по native/modified/custom и экспортирует JSON. |

## Локализация RU → KK

Промпты перевода — [`promts/translator/`](./promts/translator). Рабочие контракты и исторические эксперименты по локализации данных сохранены в [`promts/project/context.md`](./promts/project/context.md). Удалённые скрипты `locale/` не входят в активный каталог.

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
