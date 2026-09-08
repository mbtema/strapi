# project-context.md

> Расширенный технический и рабочий контекст проекта.
>
> Этот файл **дополняет Project Instructions, но не заменяет их**. Базовые правила поведения, формат ответа и приоритеты определяются Project Instructions. Здесь хранится подробная архитектура, рабочие паттерны, известные endpoints, структура репозитория, исторические решения и предметный контекст.
>
> Если данные в этом файле конфликтуют с явной текущей инструкцией пользователя, актуальным API-response, Strapi UI/Network или текущим состоянием GitHub — использовать более свежий источник.
>
> Для исторических задач действует правило: считать их справочным контекстом, а не гарантией текущего состояния системы.

**Последняя сборка контекста:** 2026-09-08  
**Основной репозиторий:** `mbtema/strapi`  
**Основной Strapi backend:** `http://10.10.3.80:1337`

---

# 1. Назначение проекта и рабочая модель

Strapi используется как CMS для мобильного приложения MonAmie и связанных процессов контента/e-commerce. Работа регулярно находится на стыке:

- Strapi Content Manager;
- Public REST API Strapi;
- internal Content Manager API;
- Flutter/mobile client;
- Bitrix как источник части товарных данных;
- BFF;
- Postman;
- DevTools;
- browser JavaScript;
- Tampermonkey;
- GitHub;
- n8n/Make;
- Notion;
- таблицы/CSV;
- контент, локализация `ru/kk`, товарный ассортимент и технические задания разработчикам.

Типичная задача — не «написать систему с нуля», а быстро найти источник проблемы, проверить данные, сформировать точный API-запрос, автоматизировать массовую проверку или грамотно упаковать изменение для разработчика.

Главная диагностическая цепочка:

`Strapi data → API response → Flutter/mobile rendering/logic`

Нельзя автоматически считать проблему CMS-проблемой. Если данные в Strapi сохранены корректно и API возвращает нужный массив/значение, следующий уровень проверки — клиент.

---

# 2. Стиль работы и формат результата

Предпочтительный результат должен быть максимально прикладным:

- готовый URL;
- готовый JS для Console;
- готовый Postman script;
- готовый parser;
- CSV, который скачивается автоматически;
- готовое ТЗ;
- готовое письмо/сообщение;
- компактная таблица;
- конкретные действия в DevTools.

Не требуется длинное объяснение там, где достаточно рабочего решения.

Если пользователь присылает ошибку или ответ разработчика, полезный формат:

1. что это значит простыми словами;
2. где вероятнее всего проблема;
3. что сделать или проверить;
4. готовый исправленный вариант, если проблема синтаксическая/техническая.

Если пользователь просит идти «по порядку», не давать многоэтажный ответ с несколькими параллельными решениями. Сначала один endpoint/шаг, затем следующий.

---

# 3. Данные, JSON и сравнения

Часто используемые сущности/поля:

- `documentId`;
- `id`;
- `barcode`;
- `active`;
- `locale`;
- `products`;
- `attributes`;
- `offers`;
- `brand`;
- `categories`;
- `volume`;
- `shade`;
- `price`;
- `slug`;
- `title`;
- `name`;
- `xml_id`;
- `code_1c`;
- `bitrix_id`.

## Правила обработки

Если пользователь прислал большой JSON:

- не пересказывать его словами;
- для просмотра/сравнения — таблица;
- для извлечения — `.map()`, `.filter()`, `.find()` или короткий parser;
- при массовой обработке не заставлять вручную копировать Console output.

При сравнении списков стандартный ключ — `documentId`, если не указано другое.

Желательно показывать:

- размер первого списка;
- размер второго списка;
- совпадения;
- отсутствующие;
- лишние;
- дубликаты, если они влияют на результат.

Если пользователю нужен только один слой данных, не тащить лишнюю вложенность. Пример подхода:

- первый слой → только `documentId`;
- relation `product` → только нужная relation;
- внутри `brand` → только `name`.

---

# 4. Strapi: окружение и ограничения

Основной backend:

`http://10.10.3.80:1337`

Strapi Admin:

`http://10.10.3.80:1337/admin/`

Пользователь работает с ограниченными административными правами:

- нет свободного изменения схем collection types;
- нет свободного управления Public API roles/permissions;
- стандартный `/api/auth/local` может возвращать `400`;
- поэтому совет «просто включить permission» часто практически бесполезен.

Не использовать запрос на расширение прав как первый workaround, если задачу можно решить существующей admin-сессией, Network, internal API, Postman или browser script.

---

# 5. Public REST API Strapi

Рабочие элементы query:

- `filters`;
- `fields`;
- `populate`;
- `pagination`;
- `sort`;
- `locale`.

При ответе удобнее давать полный URL, а не отдельный кусок фильтра.

## Populate

Рабочее правило:

- production/рабочий запрос → минимально нужный `populate`;
- `populate=*` → допустим как быстрый диагностический способ посмотреть неизвестную структуру;
- после диагностики запрос нужно сузить.

Relations желательно ограничивать только нужными `fields`.

Особое внимание:

- Dynamic Zones;
- вложенные components;
- nested relations;
- локализованные relations;
- различие поля relation и локализации связанной collection.

## Известный пример запроса товаров

Использовался запрос в стиле:

```text
http://10.10.3.80:1337/api/products?pagination[pageSize]=1&pagination[page]=1&fields[0]=documentId&populate[attributes][fields][0]=documentId&populate[attributes][populate][volume][fields][0]=name
```

Назначение: получить `documentId` товара, `documentId` attributes и `volume.name` без лишних полей.

Это исторический рабочий пример синтаксиса; при изменении Strapi schema/версии проверять фактический response.

---

# 6. Internal Content Manager API

Если Public API не позволяет выполнить операцию, использовать internal API Content Manager:

```text
/content-manager/collection-types/api::...
```

Рабочая схема:

1. пользователь авторизован в Strapi Admin;
2. Strapi Admin уже выполняет нужное действие;
3. в DevTools → Network находится реальный request;
4. копируются endpoint, method, headers/payload;
5. запрос повторяется/изменяется через Postman или Console.

JWT admin-сессии обычно доступен в LocalStorage как `jwtToken`.

Не угадывать internal endpoint, если его можно получить из Network.

## Быстрая трактовка ошибок

- `400` → структура body/query, неправильные параметры, формат relation/locale;
- `403` → токен, cookies, Authorization, permission/session;
- `404` → endpoint, UID collection, `documentId`, locale, неправильный API namespace.

---

# 7. DevTools

Основные вкладки:

- Network;
- Application;
- LocalStorage;
- Cookies;
- Console.

## Типовой workflow

```text
Strapi UI action
→ Network
→ найти request
→ endpoint + method + payload
→ повторить в Postman/Console
→ при необходимости массово изменить
```

Network имеет приоритет над попытками восстановить internal Strapi API по памяти.

Для диагностики UI-extensions Console используется до изменения кода:

- существует ли нужный DOM-элемент;
- где он находится;
- сохраняется ли после SPA navigation;
- есть ли `data-tm-*`;
- не пересоздан ли toolbar;
- не потерялись ли event handlers;
- на каком этапе прекращается `apply()/init()`.

---

# 8. Postman

Основной файл репозитория:

`postman/admin-api.json`

Текущая идея collection: не хранить большой набор готовых requests, а хранить общие paths/variables и добавлять запросы по мере необходимости.

## URL variables

```text
baseUrl = http://10.10.3.80:1337
contentManagerUrl = http://10.10.3.80:1337/content-manager
bffUrl = https://bff2.monamie.kz
```

## Основные API path variables

```text
products = /api/products
attributes = /api/attributes
promotions = /api/promotions
brands = /api/brands
cities = /api/cities
giftCertificates = /api/gift-certificates
feedbackContactInfos = /api/feedback-contact-infos
shops = /api/shops
deliveryMethods = /api/delivery-methods
menuItems = /api/menu-items
categories = /api/categories
feedbackContactMethods = /api/feedback-contact-methods
articles = /api/articles
pages = /api/pages
brandCountries = /api/brand-countries
feedbackTopics = /api/feedback-topics
volumes = /api/volumes
shades = /api/shades
colorVariants = /api/color-variants
productAgeGroups = /api/product-age-groups
productUsageTimes = /api/product-usage-times
fragranceGroups = /api/fragrance-groups
shadeGroups = /api/shade-groups
productFeatures = /api/product-features
ingredients = /api/ingredients
fragranceConcentrations = /api/fragrance-concentrations
productEffects = /api/product-effects
productSegments = /api/product-segments
productCoverages = /api/product-coverages
hairTypes = /api/hair-types
skinTypes = /api/skin-types
productForms = /api/product-forms
filtries = /api/filtries
productFinishes = /api/product-finishes
productReleaseForms = /api/product-release-forms
homePage = /api/home-page
```

## Общие variables

```text
page = 1
pageSize = 100
sort = id:asc
locale = ru
altLocale = kk
active = true

documentId
productDocumentId
attributeDocumentId
brandDocumentId
categoryDocumentId

barcode
productKey
brandName
categoryCode
slug
```

## Secret variables

```text
jwtToken
bearerToken
categoryDebugToken
```

Секреты не должны храниться в GitHub; они заполняются локально.

---

# 9. GitHub repository `mbtema/strapi`

Назначение: рабочие инструменты для Strapi Admin — постоянные extensions, UI-кастомы, parsers и Postman.

## Текущая структура main

```text
.
├── README.md
├── extensions/
│   ├── loader.js
│   └── manifest.json
├── features/
├── parsers/
├── postman/
└── ui/
```

Расширенное дерево, подтверждённое README:

```text
extensions/
  loader.js
  manifest.json

features/
  barcode-extractor.js
  ctrl-enter-publisher.js
  parser-launcher.js
  vimium-open-row.js

ui/
  entry-relocate.js
  record-list-scrollbars.js
  sidebar-sorter.js
  sidebar-ui-cleanup.js
  toggle-sidebar.js

parsers/
  manifest.json
  missing-brand.js
  missing-categories.js
  missing-shades.js
  orphan-attributes.js
  price-checker.js
  products-without-attributes.js
  products-without-price.js
  sort-volume.js
  volume-checker.js
  zero-prices.js

postman/
  admin-api.json
```

## Актуальность snapshot

На 2026-09-08 последний наблюдавшийся commit main:

```text
c231667e1ea3157e48cf67426e29e010d40ab3d5
Bump entry-relocate to 1.4.4
```

Непосредственно перед ним:

```text
077fbea8961ab0fe3708c5bd39116087a4ed6781
Make entry layout detection resilient
```

Это важно как контекст: `entry-relocate` недавно дорабатывался именно на устойчивость определения layout/SPA.

Перед любым новым code review состояние GitHub нужно читать заново — этот snapshot не должен заменять актуальный repo.

---

# 10. Extensions loader

Tampermonkey должен содержать один основной script:

`extensions/loader.js`

Текущая версия loader в snapshot:

`1.0.2`

Основные параметры:

```text
@match      http://10.10.3.80:1337/admin/*
@run-at     document-start
@connect    raw.githubusercontent.com
```

Loader:

1. читает локальный cache;
2. запускает кешированные extensions сразу;
3. в фоне загружает `extensions/manifest.json`;
4. сравнивает `id/path/version`;
5. скачивает изменившиеся extensions;
6. сохраняет новый cache;
7. если ранее рабочий cache уже был — сообщает, что нужен reload;
8. если GitHub недоступен, но cache есть — продолжает работать с cache.

Cache key:

```text
tm-strapi-extensions-cache-v1
```

Loader ставит атрибут:

```text
data-tm-strapi-extensions-loader
```

для защиты от повторного запуска.

Manifest принимает только enabled extensions из `features/*.js` и `ui/*.js`.

## Практическое правило обновления

Изменил extension → повысил его `version` в `extensions/manifest.json`.

Если version не повысить, пользователь может продолжать запускать старый cache и решить, что код «не обновился».

Изменение path также меняет сигнатуру cache.

Старые отдельные Tampermonkey scripts должны быть отключены/удалены, иначе один функционал может выполняться дважды.

Loader менять только когда меняется сама инфраструктура загрузки/cache, а не ради обычной правки extension.

---

# 11. Актуальный extensions manifest

Snapshot 2026-09-08:

| id | path | version | enabled |
|---|---|---:|---|
| `toggle-sidebar` | `ui/toggle-sidebar.js` | `1.3.5` | yes |
| `sidebar-ui-cleanup` | `ui/sidebar-ui-cleanup.js` | `1.0.4` | yes |
| `sidebar-sorter` | `ui/sidebar-sorter.js` | `1.0.2` | **no** |
| `record-list-scrollbars` | `ui/record-list-scrollbars.js` | `1.0.2` | yes |
| `entry-relocate` | `ui/entry-relocate.js` | `1.4.4` | yes |
| `barcode-extractor` | `features/barcode-extractor.js` | `1.4.1` | yes |
| `ctrl-enter-publisher` | `features/ctrl-enter-publisher.js` | `1.1` | yes |
| `parser-launcher` | `features/parser-launcher.js` | `1.3` | yes |
| `vimium-open-row` | `features/vimium-open-row.js` | `1.1.1` | yes |

Перед изменением extension:

- прочитать текущий файл;
- прочитать актуальный manifest;
- проверить latest version;
- после изменения bump version.

---

# 12. Известные extensions и хоткеи

## `barcode-extractor.js`

Назначение:

- копирует barcode из карточки товара;
- hotkey: `Ctrl+B`;
- показывает toast в UI Strapi;
- успех и ошибка должны визуально сообщаться пользователю.

Это появилось как замена ручному наведению/копированию barcode через мышь/Vimium.

## `ctrl-enter-publisher.js`

- hotkey: `Ctrl+Enter`;
- публикует текущую запись.

## `parser-launcher.js`

- hotkey: `Alt+P`;
- открывает список parsers из `parsers/manifest.json`.

## `vimium-open-row.js`

- делает строки таблицы доступными/удобными для Vimium navigation.

## `toggle-sidebar.js`

- sidebar скрыт по умолчанию;
- hotkey в текущем README: `Alt+S`;
- визуально скрываются scrollbar/лишние точки.

Исторически использовался `Ctrl+S`; текущий README указывает `Alt+S`, поэтому актуальным считать значение из repo.

## `sidebar-ui-cleanup.js`

- убирает верхний блок Content Manager/Search/COLLECTION TYPES/count;
- активную collection выделяет визуально.

## `sidebar-sorter.js`

- drag-and-drop sorting collections;
- текущий manifest: `enabled: false`.

## `record-list-scrollbars.js`

- визуально скрывает scrollbar/overflow decoration списка records;
- прокрутка должна сохраняться.

## `entry-relocate.js`

- переносит Entry actions в строку Draft/Published;
- освобождает ширину формы;
- особенно чувствителен к SPA navigation и меняющемуся DOM/layout.

---

# 13. Стандарты Strapi Admin extension code

Strapi Admin — React SPA. DOM нельзя считать статичным.

## Селекторы

Приоритет:

1. `aria-*`;
2. `role`;
3. стабильные `data-*`;
4. собственные `data-tm-*`;
5. семантическая DOM-структура;
6. назначение/текст элемента;
7. геометрия — только дополнительный сигнал.

Не использовать generated styled-components classes `sc-*` как главный selector.

## Идемпотентность

`init()` / `apply()` может вызываться много раз.

Повторный вызов не должен:

- создавать второй toolbar/button;
- повторно добавлять style;
- накапливать listeners;
- ломать layout;
- перемещать уже перемещённый элемент некорректно.

## SPA navigation

Проверять работу:

- после hard reload;
- после перехода в другую запись без reload;
- после смены collection;
- после смены locale;
- после возврата назад;
- когда React полностью пересоздаёт subtree.

Если хранится DOM reference:

```js
document.contains(node)
```

должно использоваться для проверки актуальности.

## React elements

Если нужен штатный Strapi button/toolbar/action, предпочитать перемещение реального DOM node вместо clone/copy. Это сохраняет:

- React handler;
- internal state;
- `disabled`;
- loading;
- accessibility;
- штатное поведение.

## MutationObserver

Не нужно переоптимизировать observer ценой надёжности.

Для ограничения нагрузки:

- idempotent `apply()`;
- `requestAnimationFrame`;
- debounce/throttle;
- локальные early returns.

## Diagnostics

До переписывания кода:

- найти target;
- проверить parent/ancestor relation;
- проверить marker;
- проверить `data-tm-*`;
- убедиться, что target не был пересоздан;
- увидеть точку, где `apply()` перестал находить layout;
- только затем менять selector/logic.

При невозможности выполнить функцию полезен:

```js
console.warn('[extension-name] ...конкретная причина...')
```

---

# 14. Парсеры

Общий стандарт:

```text
meta header
→ fetch API
→ pagination
→ validation
→ Console progress
→ totals
→ automatic CSV download
```

Парсер не должен требовать ручного копирования JSON/Console.

Meta header должен содержать минимум:

- имя;
- version;
- назначение.

## Parser Launcher manifest — snapshot

| Название | Файл |
|---|---|
| Предложения с дробными ценами | `price-checker.js` |
| Проверка сортировки объемов | `sort-volume.js` |
| Проверка единиц объемов | `volume-checker.js` |
| Отсутствующие оттенки | `missing-shades.js` |
| Предложения с нулевой ценой | `zero-prices.js` |
| Предложения без товара | `orphan-attributes.js` |
| Товары без предложений | `products-without-attributes.js` |
| Товары без бренда | `missing-brand.js` |
| Товары без категорий | `missing-categories.js` |
| Товары без цены | `products-without-price.js` |

Назначения по README:

- `price-checker.js` — дробные `price`;
- `sort-volume.js` — неверный порядок volume;
- `volume-checker.js` — разные единицы измерения volume;
- `missing-shades.js` — active offers с `color_variant1C`, но без `shade`;
- `zero-prices.js` — offers с `price = 0`, связанные с active products;
- `orphan-attributes.js` — offers/attributes без `product`;
- `products-without-attributes.js` — active products без offers;
- `missing-brand.js` — active products без `brand`;
- `missing-categories.js` — active products без `categories`;
- `products-without-price.js` — active products с offers, но без цены `> 0`.

Для нового parser:

1. добавить `.js` в `parsers/`;
2. добавить запись в `parsers/manifest.json`, если он должен появиться в `Alt+P`;
3. убедиться, что parser проходит все API pages;
4. добавить auto-download CSV;
5. дать понятное имя CSV;
6. вывести totals/progress.

---

# 15. Массовые browser scripts

Для разовых массовых проверок предпочтителен Console JS, если:

- нет смысла делать постоянный extension;
- endpoint доступен;
- пользователь может выполнить script из Strapi/DevTools;
- нужно один раз получить CSV.

Типовые требования:

- `PAGE_SIZE` обычно 100;
- читать `meta.pagination.pageCount` или аналог;
- проходить до последней страницы;
- считать checked records;
- логировать прогресс;
- обрабатывать пустые/нечитаемые значения отдельно;
- автоматически собирать и скачивать CSV;
- CSV filename должен отражать проверку.

Если parser становится регулярным — вынести в GitHub `parsers/` и Parser Launcher.

---

# 16. Mobile/CMS: главная страница

Главная управляется Strapi Single Type + Dynamic Zone.

Часто используемые components:

```text
home.main-banners
home.highlights-slider
home.product-slider
home.product-grid
```

Частые поля:

```text
title
deeplink
mode
maxItems
products
```

Известный исторический кейс:

- в Strapi `home.product-slider` содержал несколько корректных `products` relations;
- mobile показывал не более одного товара;
- правильный подход: проверить API response;
- если API отдаёт массив корректно — задача Flutter/client, а не CMS.

---

# 17. Deeplink

Пример схемы:

```text
monamie://...
```

Внешне корректная строка не гарантирует рабочий deeplink.

Проверять:

- зарегистрирован ли route в Flutter;
- какой path ожидается;
- какие query/path params разрешены;
- есть ли существующий рабочий пример.

Исторический пример:

```text
monamie://brands/christian-dior
```

Не считать его универсально корректным только из-за синтаксиса — валидность зависит от route table mobile app.

---

# 18. UI / adaptive / media

При описании UI использовать точные понятия:

- container;
- aspect ratio;
- adaptive;
- desktop/mobile;
- media;
- preview;
- clipping/cropping;
- dimensions;
- padding/margin;
- responsive behavior.

Если desktop корректен, а adaptive меняет форму/обрезает контент, формулировать причинно:

`изменяется container/aspect ratio → вложенное media/text обрезается/растягивается → требуется сохранить ожидаемые пропорции/поведение`.

## Strapi media formats

Известные форматы:

```text
thumbnail
small
medium
```

Историческая задача:

- часть product cards использовала `small` или `thumbnail`;
- preview выглядел пиксельным;
- для preview требуется `medium` 750×750.

Если API уже содержит `medium`, а client выбирает `small`, это client-side задача.

---

# 19. Локализация `ru/kk`

Основной принцип: локализация field, relation field и target collection — разные уровни.

Для каждого случая отдельно выяснять:

1. локализовано ли поле;
2. локализовано ли relation field;
3. локализована ли связанная entity;
4. должна ли relation синхронизироваться между `ru` и `kk`;
5. какое значение должно считаться source-of-truth.

Часто затрагиваются:

- categories;
- attributes;
- brands;
- offers;
- product relations;
- product fields;
- home components.

## Исторический кейс `products.name`

Был запрос отключить локализацию поля `name` у товаров:

- `name` не должен различаться между `ru` и `kk`;
- приоритет должен иметь значение из `ru`;
- авто-переведённый `kk name` мешал создавать relations, потому что поиск relation выполнялся по `name`;
- также требовалось определить, что делать с уже существующими переводами.

Это исторический task context, не гарантия, что изменение уже внедрено.

---

# 20. Перевод RU → KK

## Plain text translator

Используется для небольших текстов без сложной структуры.

Требования:

- перевод по исходному смыслу;
- не добавлять информацию;
- не сокращать важное;
- английский без необходимости не переводить;
- естественный казахский;
- избегать буквальной кальки;
- использовать принятую терминологию.

## HTML translator

Используется для:

- product descriptions;
- articles;
- custom pages;
- HTML из Bitrix.

Правило:

- переводить только текстовые nodes;
- HTML tags не менять;
- CSS/classes не менять;
- ссылки/technical values не менять;
- структуру не ломать.

Результат должен быть пригоден для прямой вставки в CMS.

---

# 21. Bitrix → Strapi

Bitrix — один из источников product content.

Из известных процессов:

- product связан с разделом Bitrix;
- исторически уточнялось: один product может находиться только в одном разделе;
- для сопоставления раздела использовалось поле `code`;
- HTML descriptions могут приходить из Bitrix;
- часть переводов может генерироваться при sync.

При ТЗ на resync всегда разносить:

1. какие текущие values в Strapi очистить/перезаписать;
2. какие данные снова загрузить из Bitrix;
3. какие поля перевести;
4. каким translator/prompt;
5. какие relations должны синхронизироваться отдельно.

---

# 22. ТЗ разработчикам

ТЗ — не формальный документ ради структуры.

Рабочая форма:

```text
Название

Что сейчас происходит.
В чём проблема.
Что нужно изменить.
```

Добавлять:

- collection;
- component;
- relation;
- field;
- endpoint;
- UI-element;

только если это реально помогает разработчику понять задачу.

Не добавлять без запроса:

- Acceptance Criteria;
- «Что проверить»;
- отдельный Expected result;
- Objective;
- Business value;
- DoD;
- очевидные test cases;
- длинные формальные сценарии.

Не придумывать реализацию, если задача — описать поведение.

ТЗ должно быть понятно человеку без контекста и при этом не вызывать у разработчика очевидную серию вопросов.

---

# 23. Исторические Strapi/CMS задачи

Эти кейсы полезны как доменная память. Они **не означают автоматически, что задача всё ещё открыта**.

## Collection `volumes`

Был запрос:

- дать Content Manager возможность удалять records;
- поля `xml_id` и `code_1c` сделать необязательными;
- сейчас/на момент задачи без них нельзя было создать новый volume.

## Brands

Был массовый check:

- найти brands, у которых `showDiscountOnProductCard !== true`.

Для подобных проверок предпочтителен parser/Console script с pagination и CSV.

## Product active / offers / volume

Регулярные проверки включали:

- active products;
- offers/attributes;
- volume relation;
- несовпадающие `volume.name`;
- price;
- наличие product relation;
- category/brand relation.

## Promotions

В проекте были отдельные ТЗ/файлы по:

- promotion `slug` и `shareUrl`;
- promotion warehouses/stocks;
- синхронизации локалей.

При возвращении к этим темам желательно запросить/прочитать актуальные файлы или API, потому что этот контекст не содержит полного текста старых PDF.

---

# 24. Gift certificates — исторический UX context

В работе были замечания по сертификатам:

1. при выборе пластикового сертификата временно вести в WebView;
2. убрать «Заберите в любом магазине»;
3. для электронного объяснить, что ссылка приходит через SMS/Push, сертификат отображается у конечного получателя в ЛК → «Мои сертификаты»;
4. убрать информацию о физической доставке electronic certificate;
5. добавить выбор даты и времени отправки;
6. добавить возможность собственного номинала;
7. после добавления в cart кнопка «Готово» должна вести к оплате, а не назад к выбору сертификатов;
8. убрать «Отправим на телефон получателя»;
9. при добавлении второго сертификата не терять первый; перед оплатой показывать список добавленных сертификатов для проверки номеров.

Это исторический список замечаний; статус каждого пункта нужно уточнять по текущему build/task tracker.

---

# 25. Товарный контент и ассортимент

Частые понятия:

- SKU;
- barcode;
- shade;
- offer/attribute;
- brand;
- category;
- label;
- ассортимент.

Для отбора ассортимента, если задача этого типа:

- постоянный ассортимент;
- исключать сезонные;
- исключать временные;
- исключать лимитированные;
- исключать низкооборачиваемые;
- приоритет бестселлерам;
- приоритет востребованным/коммерчески значимым shades.

Оцифровка/AR может идти отдельно по каждому barcode/shade.

## AR product list — известный формат

Для подготовки товаров под AR-примерочную использовались правила:

- отдельный файл для каждого brand;
- brand указывать в filename;
- column «Название товара» — полное product name;
- column «Штрихкод» — barcode конкретного shade/SKU;
- каждый barcode — отдельная row;
- при нескольких shades product name можно указать один раз на группу barcode по шаблону;
- не добавлять лишние internal fields, prices, categories, service codes;
- включать постоянный ассортимент, bestsellers, востребованные shades.

---

# 26. Деловая переписка

Адресаты:

- developers;
- руководство;
- коллеги;
- content team;
- brand managers;
- юристы;
- внешние подрядчики.

Стиль:

- лаконично;
- делово;
- человечески;
- без бюрократических штампов;
- без искусственной сверхвежливости;
- без пассивной агрессии.

Технический контекст можно оставлять техническим:

```text
prod
dev
API
endpoint
relation
sync
frontend
backend
deploy
adaptive
build
deeplink
```

Не нужно переводить эти слова на русский, если становится менее понятно.

---

# 27. Таблицы и отчёты

Большие наборы задач лучше сводить в компактную рабочую таблицу.

Полезные fields:

- раздел;
- задача;
- описание;
- ответственный;
- статус;
- комментарий;
- ссылка;
- количество;
- язык;
- приоритет.

Не добавлять столбцы «для красоты».

Если пользователь просит объединить несколько источников в отчёт:

- убрать дубликаты;
- сохранить смысл статусов;
- привести формулировки к одному уровню;
- не делать отдельную сводку по статусам, если она не нужна;
- форматировать компактно;
- высота строк должна вместить текст без лишнего воздуха.

---

# 28. Notion

Известный рабочий сценарий:

- Notion Plus;
- 1 основной администратор;
- внешние пользователи — guests;
- при необходимости guests получают Full Access.

Relations / rollups / formulas использовать, только если они реально уменьшают ручную работу.

Не строить сложную database architecture, если простой tracker решает задачу.

---

# 29. n8n / Make / automation

Приоритет автоматизации:

1. API query;
2. browser JS;
3. Postman script;
4. parser;
5. GitHub extension, если функция постоянная;
6. n8n/Make, если workflow действительно повторяемый/межсистемный;
7. backend changes — когда client-side/workaround недостаточен.

Автоматизация должна уменьшать число ручных действий, а не добавлять инфраструктуру.

---

# 30. Vimium

Vimium использовался для keyboard navigation в Strapi.

Исторические команды:

- `enterVisualLineMode`;
- `enterVisualMode` (`g` в обсуждении).

Проблема: readonly barcode field было неудобно выделять/копировать keyboard-only.

Практическое решение в текущем repo — `barcode-extractor.js` с `Ctrl+B`, поэтому для barcode предпочтителен extension, а не сложный Vimium flow.

---

# 31. Security context

JWT из Strapi Admin LocalStorage технически можно увидеть через DevTools. Это само по себе не означает автоматически критическую уязвимость: риск зависит от XSS, доступности устройства/session, срока жизни token и серверных controls.

В рабочих инструкциях token используется только как локальный credential для повторения собственных admin requests.

Не публиковать реальные tokens в GitHub, документации, screenshots или shared snippets.

---

# 32. Приоритеты диагностики

## API/data problem

Проверять в порядке:

1. Strapi record;
2. locale;
3. relation заполнен;
4. Public API query;
5. fields/populate;
6. API response;
7. client behavior.

## Internal request problem

Проверять:

1. реальный Network request;
2. endpoint/UID;
3. method;
4. payload;
5. locale;
6. `documentId`;
7. Authorization/session.

## UI extension problem

Проверять:

1. воспроизводится ли after hard reload;
2. воспроизводится ли after SPA navigation;
3. существует ли target;
4. selector stable?;
5. DOM node был пересоздан?;
6. marker/idempotency;
7. duplicate listeners/styles;
8. observer fires?;
9. layout assumption;
10. manifest version/cache.

## Parser problem

Проверять:

1. endpoint;
2. pagination;
3. pageCount;
4. API response shape;
5. filtering condition;
6. counters;
7. empty/error responses;
8. CSV creation;
9. auto-download;
10. parser manifest entry.

---

# 33. Что не делать

Без необходимости не:

- давать длинные лекции;
- повторять вопрос;
- строить корпоративное ТЗ;
- добавлять acceptance criteria;
- предлагать backend change до проверки API/client;
- предлагать «попросить admin rights» как универсальный ответ;
- заставлять вручную чистить JSON;
- угадывать internal endpoint вместо Network;
- держать постоянный Tampermonkey script отдельно от loader architecture;
- забывать bump extension version;
- делать parser только на page 1;
- оставлять parser result только в Console, если его можно скачать;
- завязывать UI extension на `sc-*`;
- копировать штатный Strapi React element, если его можно переместить;
- оптимизировать MutationObserver ценой нестабильности;
- считать historical task автоматически актуальным;
- считать deeplink рабочим только по его внешнему виду.

---

# 34. Как использовать этот файл в будущих задачах

Project Instructions должны содержать ссылку на `project-context.md`.

Когда задача простая — не нужно вытаскивать весь контекст.

Когда задача касается:

- Strapi API;
- repo/extensions;
- parser architecture;
- known fields/endpoints;
- localization;
- mobile CMS;
- Bitrix;
- previous task patterns;

использовать соответствующий section этого файла.

Если вопрос про текущую версию extension, manifest, parser list или GitHub state — **проверять GitHub заново**, даже если snapshot есть здесь.

Если вопрос про текущий API shape — **смотреть актуальный response/Network**, а не опираться на старый пример.

Если пользователь прислал новый контекст, который меняет правило, свежий контекст выше этого файла.

---

# 35. Связь с Project Instructions

Короткая Project Instructions — operational layer: как отвечать и какие принципы применять всегда.

`project-context.md` — knowledge layer: что известно о проекте, архитектуре, инструментах, исторических задачах и рабочих паттернах.

Использовать их вместе:

```text
Project Instructions
        ↓
выбирают подход/формат
        ↓
project-context.md
        ↓
даёт подробный предметный контекст
        ↓
актуальный API / GitHub / Network
        ↓
подтверждает текущее состояние
```

Приоритет всегда остаётся у текущего явно заданного пользователем требования и актуальных данных системы.
