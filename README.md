Набор рабочих инструментов для админки Strapi и миграции контента: постоянные extensions, UI/UX-кастомы, парсеры, Bitrix-утилиты, Postman и backup/sync snapshot Project Instructions и project context.

## Структура

| Папка | Назначение |
|---|---|
| [`extension/`](./extension) | Единый Tampermonkey loader и manifest постоянных расширений Strapi |
| [`features/`](./features) | Функции: горячие клавиши, barcode, Parser Launcher, Vimium helper |
| [`ui-ux/`](./ui-ux) | UI/UX-кастомы Strapi |
| [`parsers/`](./parsers) | Массовые проверки данных и вспомогательные browser parsers |
| [`migrator/`](./migrator) | Утилиты для аудита и миграции данных из Bitrix |
| [`postman/`](./postman) | Postman collection с общими variables и API paths |
| [`promts/`](./promts) | Backup/sync snapshot Project Instructions и project context; не используется как рабочий source of truth проекта |

## Extension loader

В Tampermonkey устанавливается только:

`extension/loader.js`

Loader при открытии Strapi:

1. мгновенно запускает последнюю сохранённую копию extensions из кеша;
2. в фоне загружает `extension/manifest.json` с GitHub;
3. при изменении версий или путей скачивает только изменившиеся файлы и сохраняет новый кеш;
4. обновлённые extensions применяются после следующей перезагрузки Strapi.

Старые отдельные Tampermonkey-скрипты после установки loader нужно отключить или удалить, иначе один функционал будет запускаться дважды.

### Manifest

`extension/manifest.json` определяет, какие extensions включены:

```json
{
  "id": "sidebar",
  "path": "ui-ux/sidebar.js",
  "version": "2.2.3",
  "enabled": true
}
```

При изменении extension обязательно увеличивать его `version` в manifest. Изменение пути также меняет сигнатуру кеша и заставляет loader скачать файл заново. `enabled: false` оставляет файл в репозитории, но исключает его из загрузки.

## Features

- `barcode-extractor.js` — `Ctrl+B`, копирует barcode из карточки товара и показывает toast.
- `ctrl-enter-publisher.js` — `Ctrl+Enter`, публикует текущую запись.
- `parser-launcher.js` — `Alt+P`, открывает список парсеров из `parsers/manifest.json`.
- `vimium-open-row.js` — делает строки таблиц доступными для Vimium; собственная ссылка помечается через `data-tm-*` и восстанавливается после React re-render.

## UI/UX

- `sidebar.js` — единый sidebar-модуль: sidebar видим по умолчанию, `Alt+S` плавно скрывает/показывает его; поиск, быстрый доступ, группы Collection Types/Single Types, active state, минималистичные иконки, future-safe fallback для новых коллекций и очистка глобальной левой навигации.
- `record-list-scrollbars.js` — визуально скрывает scrollbar/overflow decoration в списке записей Content Manager, сохраняя прокрутку.
- `list-view.js` — доработки list view Content Manager.
- `entry-relocate.js` — переносит действия Entry в строку с Draft / Published и освобождает ширину формы.
- `product-attributes-navigator.js` — навигация по торговым предложениям в карточке товара: автоматически загружает все relation `attributes`, даёт поиск по `name_web`/barcode, пагинацию по 10 записей и прямой переход в карточку предложения. Режим «Управление связями» раскрывает штатный Strapi relation list, автоматически догружает весь список через `Load More` и увеличивает его viewport до 540 px для reorder/remove.

## Версионирование

- patch (`1.3.1`) — небольшой фикс, доработка или оптимизация существующего поведения;
- minor (`1.4`) — заметное новое поведение;
- major (`2.0`) — крупная переработка.

Версия extension независима от версии loader.

## Parsers

Парсеры запускаются через `Alt+P`. Проверочные парсеры проходят API постранично, выводят прогресс в Console и автоматически скачивают CSV. Вспомогательные parsers могут иметь другой output, если это указано в meta header.

- `sort-volume.js` — неправильный порядок volume.
- `volume-checker.js` — разные единицы измерения volume.
- `missing-shades.js` — активные предложения с `color_variant1C`, но без `shade`.
- `shade-and-volume.js` — все предложения, у которых одновременно заполнены `shade` и `volume`.
- `attributes-without-product.js` — все предложения без `product`.
- `attributes-without-detail-picture.js` — предложения активных товаров без `detail_picture`.
- `products-without-attributes.js` — активные товары без предложений.
- `products-without-brand.js` — активные товары без `brand`.
- `products-without-categories.js` — активные товары без `categories`.
- `products-with-duplicate-bitrix-id.js` — товары с одинаковым `bitrix_id` для контроля дублей после миграции.
- `products-with-wrong-prices.js` — активные товары, у которых хотя бы одно предложение имеет `price = 0`, пустой `price` или дробный `price`.
- `products-with-missing-content.js` — активные товары без одного или нескольких критичных контентных полей: `name1`, `name2`, `detail_picture`, `detail_text`.
- `products-with-wrong-variants.js` — активные товары с несколькими предложениями, у которых нет единого типа выбора по `shade` или `volume`: отсутствующие relations, смешанный тип или одновременные `shade + volume`.
- `dom-stealer.js` — копирует текущий DOM страницы в Clipboard для диагностики UI.
- `manifest.json` — единый список парсеров и их групп для Parser Launcher.

Для нового регулярного парсера достаточно добавить `.js` в `parsers/` и зарегистрировать его в `parsers/manifest.json`. Группа задаётся там же через `group`; дублировать список файлов внутри `parser-launcher.js` больше не нужно.

Пример:

```json
{
  "name": "Товары без категорий",
  "file": "products-without-categories.js",
  "group": "products"
}
```

Рабочие группы: `products`, `offers`, `attributes`, `service`.

## Bitrix / Migrator

- `migrator/detail-picture-audit.js` — запускается в Bitrix Admin, принимает CSV от `attributes-without-detail-picture`, по barcode находит родительский товар и торговое предложение, проверяет `DETAIL_PICTURE` и автоматически скачивает mapping CSV для последующей миграции в Strapi.
- `migrator/detail-picture-migrator.js` — локальный Node.js migrator: читает audit CSV, берёт только `status=ok`, находит Strapi attribute сначала по точному `documentId`, затем сверяет barcode, скачивает изображение, загружает его в Strapi, привязывает `detail_picture`, публикует `ru` и проверяет результат через Public API.
- Migrator сохраняет checkpoint рядом с audit CSV после каждого этапа и продолжает с последней безопасной стадии; неопределённый результат `POST /upload` не повторяется автоматически, чтобы не создавать дубликаты media, а исходная ошибка сохраняется в checkpoint.
- Audit группирует строки по `productDocumentId`, чтобы не искать один и тот же родительский товар повторно, сохраняет checkpoint в LocalStorage и при повторном запуске с тем же CSV продолжает незавершённый аудит.
- Статусы audit: `ok`, `no_detail_picture`, `product_not_found`, `offer_not_found`, `duplicate_barcode_in_source`, `missing_barcode`, `error`.
- Bitrix browser-утилиты не входят в Parser Launcher Strapi и запускаются только на домене Bitrix Admin, где доступна авторизованная сессия. Node migrator запускается локально через Node.js.

Локальные audit/result/checkpoint-файлы и `.env` исключены через `.gitignore`, чтобы временные данные и секреты не попадали в публичный репозиторий случайным `git add`.

## Postman

Основной файл:

`postman/admin-api.json`

Коллекция намеренно не содержит большого набора готовых запросов. Повторяющиеся значения вынесены в collection variables.

Пример:

```text
{{baseUrl}}{{products}}
{{baseUrl}}{{attributes}}
{{baseUrl}}{{brands}}
{{baseUrl}}{{categories}}
```

Основные variables:

- URL: `baseUrl`, `contentManagerUrl`, `bffUrl`;
- API paths: `products`, `attributes`, `promotions`, `brands`, `categories` и другие endpoints;
- пагинация: `page`, `pageSize`, `sort`;
- локали: `locale`, `altLocale`;
- идентификаторы: `documentId`, `productDocumentId`, `attributeDocumentId`, `brandDocumentId`, `categoryDocumentId`;
- рабочие значения: `barcode`, `productKey`, `brandName`, `categoryCode`, `slug`;
- секреты: `jwtToken`, `bearerToken`, `categoryDebugToken`.

Секреты в GitHub не хранятся и заполняются только локально в Postman.

## Promts / project context

`promts/` не участвует в runtime и не является рабочим source of truth для ChatGPT Project. Это backup/sync snapshot двух файлов, которые пользователь хранит и использует непосредственно в Project ChatGPT.

- `promts/project-context.md` — snapshot текущего knowledge layer: архитектура, endpoints, ограничения, принятые решения, структура repo, исторические кейсы и рабочие паттерны.
- `promts/project-instructions.md` — snapshot operational layer: формат ответов, приоритеты и правила работы со Strapi/API/GitHub/парсерами/ТЗ.

Обычная работа ведётся из Project Instructions и `project-context.md`, загруженных в Project. К `promts/*` обращаются только для синхронизации/сравнения по прямой задаче. Сначала обновляется рабочая модель Project, затем её копия сохраняется в `promts/`.

При изменении структуры/назначения репозитория одновременно актуализируется README.

## Дерево

```text
.
├── .gitignore
├── extension/
│   ├── loader.js
│   └── manifest.json
├── features/
│   ├── barcode-extractor.js
│   ├── ctrl-enter-publisher.js
│   ├── parser-launcher.js
│   └── vimium-open-row.js
├── ui-ux/
│   ├── sidebar.js
│   ├── entry-relocate.js
│   ├── list-view.js
│   ├── product-attributes-navigator.js
│   └── record-list-scrollbars.js
├── parsers/
│   ├── manifest.json
│   ├── attributes-without-detail-picture.js
│   ├── attributes-without-product.js
│   ├── dom-stealer.js
│   ├── missing-shades.js
│   ├── shade-and-volume.js
│   ├── products-with-duplicate-bitrix-id.js
│   ├── products-with-missing-content.js
│   ├── products-with-wrong-variants.js
│   ├── products-without-attributes.js
│   ├── products-without-brand.js
│   ├── products-without-categories.js
│   ├── products-with-wrong-prices.js
│   ├── sort-volume.js
│   └── volume-checker.js
├── migrator/
│   ├── detail-picture-audit.js
│   └── detail-picture-migrator.js
├── postman/
│   └── admin-api.json
├── promts/
│   ├── project-context.md
│   └── project-instructions.md
└── README.md
```
