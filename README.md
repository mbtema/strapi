Набор рабочих инструментов для админки Strapi: постоянные extensions, UI/UX-кастомы, browser tools, универсальный RU → KK переводчик и backup/sync snapshot Project Instructions и Project Context.

## Структура

| Папка | Назначение |
|---|---|
| [`extension/`](./extension) | Модули Strapi Admin: loader, manifests, features, UI/UX и browser tools |
| [`migrator/`](./migrator) | Независимые pipeline: `products/` — товары, `attributes/` — торговые предложения (включая shade/volume) |
| [`locale/`](./locale) | Небольшие отдельные инструменты для подготовки локализаций Strapi: сначала проверка одной записи, затем пилот создания KK-черновика |
| [`helpdesk/`](./helpdesk) | n8n workflows Telegram-бота MonAmie Helpdesk |
| [`translator/`](./translator) | RU → KK переводчик: полная версия, compressed-версия и extractor для накопленного translation context |
| [`project/`](./project) | Sync/staging copies для Project Instructions и источника `context.md` |

## Extension loader

В Tampermonkey устанавливается только:

`extension/extension.js`

Userscript metadata (`==UserScript==`, `@name`, `@version`, `@match` и т.д.) нужна только этому loader. Дочерние extensions и tools загружаются через manifests и не содержат собственные metadata-блоки.

Loader при открытии Strapi:

1. мгновенно запускает последнюю сохранённую копию extensions из кеша;
2. в фоне загружает корневой `extension/manifests/extensions.json`;
3. по нему загружает `extension/manifests/ui-ux.json` и `extension/manifests/features.json`;
4. объединяет и валидирует их как единый registry;
5. при изменении версий или путей скачивает только изменившиеся файлы и сохраняет новый кеш;
6. обновлённые extensions применяются после следующей перезагрузки Strapi.

Старые отдельные Tampermonkey-скрипты после установки loader нужно отключить или удалить, иначе один функционал будет запускаться дважды.

После переименования установочного файла используйте [`extension/extension.js`](./extension/extension.js), версия `1.3.6`. Старый `extension/loader.js` удалён: ранее установленный Tampermonkey-скрипт с прежним `@updateURL` не сможет обновиться автоматически. Один раз откройте новый URL и установите скрипт в Tampermonkey, затем отключите/удалите старую копию во избежание двойного запуска. После этого перезагрузите страницу Strapi, чтобы loader обновил кеш; ещё одна перезагрузка применит скачанные extensions.

Для ручной проверки обновлений в Console доступна команда `checkUpdates()`. Она проверяет установленную версию loader и все дочерние manifests, скачивает изменившиеся extensions в кеш и сообщает, нужна ли перезагрузка Strapi. Если в repo появилась новая версия самого loader, команда сообщает, что userscript нужно обновить через Tampermonkey.

### Manifest

`extension/manifests/` — единое место для runtime-реестров. `extension/manifests/extensions.json` содержит список extension manifests, сейчас `extension/manifests/features.json` и `extension/manifests/ui-ux.json`. Все manifests используют `schemaVersion: 1`; это версия формата конкретного manifest, а не версия скриптов.

Метаданные конкретных extensions (`id`, `path`, semver `version`, `enabled`) хранятся в `extension/manifests/features.json` и `extension/manifests/ui-ux.json`. При изменении extension увеличивается его `version` в соответствующем manifest. Изменение пути также меняет сигнатуру кеша и заставляет loader скачать файл заново. `enabled: false` оставляет файл в репозитории, но исключает его из загрузки.

Loader валидирует каждый дочерний manifest и итоговый объединённый registry: формат путей, соответствие имени файла `id`, semver и глобальные дубли `id/path`. Если root/child manifest недоступен или некорректен, новый кеш не записывается, а при наличии старого loader продолжает использовать его.

## Features

- `alt-enter-publisher.js` — `Alt+Enter`, публикует текущую запись.
- `tools-launcher.js` — `Alt+P`, открывает browser tools из `extension/manifests/tools.json` колонками `audits`, `sync`, `diagnostics`; `group` обязан совпадать с первой папкой в `file`, валидируются path / semver / group и дубли файлов; блокирует повторный параллельный запуск async tool и для GET-запросов автоматически повторяет временные network / `429` / `5xx` ошибки.

## UI/UX

- `sidebar.js` — единый sidebar-модуль: `Alt+S`, поиск, быстрый доступ, группировка Content Manager (`Каталог`, `Справочник`, `Фильтры`, `Главная страница MOBILE`, `Главная страница WEB`, `Другое`), active state и очистка глобальной левой навигации; новые нераспознанные collection types по умолчанию попадают в `Другое`; группы по умолчанию раскрыты, их свернутое/раскрытое состояние сохраняется в `localStorage` и восстанавливается после reload, раскрытие/сворачивание анимировано; состояние всего sidebar скрыт/показан сохраняется на время текущей вкладки браузера.
- `record-list.js` — единый модуль для списков записей Content Manager: скрывает scrollbar/overflow decoration, скрывает колонку `to be released in`, компактно показывает `Available in` как RU/KK, добавляет рядом с checkbox ссылку открытия записи для Vimium и поддерживает обычный click, Ctrl/Meta-click и middle-click в новую вкладку через реальный `documentId`; при ошибке lookup используется безопасный `row.click()` fallback.
- `entry-relocate.js` — переносит действия Entry в строку с Draft / Published и освобождает ширину формы.
- `product-attributes-navigator.js` — навигация по торговым предложениям в карточке товара: загрузка всех relation `attributes`, поиск, пагинация и прямые ссылки; режим «Управление связями» раскрывает штатный Strapi relation list.
- `product-sections.js` — разделяет карточку Product на вкладки `Контент`, `Фильтры`, `Системное` и показывает смысловые группы `Парфюмерия`, `Макияж`, `Уход за кожей`, `Уход за волосами`, `Другое`; в `Уход за кожей` входят `usage_time`, `age_group`, `product_segment`, `ingredients`, в `Уход за волосами` — `hair_types`, `is_hypoallergenic`, а `Другое` автоматически собирает остальные поля из `FILTER_FIELDS`. Нативные React-поля не перемещает в DOM; визуальный порядок групп задаётся через CSS `order`, а штатный порядок полей хранится в Strapi `layouts.edit` и при необходимости синхронизируется через `layout-sync.js`.

## Версионирование extensions

- patch (`1.3.1`) — небольшой фикс, доработка или оптимизация существующего поведения;
- minor (`1.4`) — заметное новое поведение;
- major (`2.0`) — крупная переработка.

Версия extension независима от версии loader. Единственный источник версии для extension — его запись в `extension/manifests/features.json` или `extension/manifests/ui-ux.json`; отдельные metadata-блоки и `@version` внутри этих файлов не используются.

## Tools

Browser tools запускаются через `Alt+P`. `audits/` содержит массовые проверки данных, `sync/` — инструменты синхронизации/изменения данных, `diagnostics/` — диагностические утилиты. Data-audit tools проверяют текущее состояние CMS только через Content Manager API, включая draft/modified записи; Public API `/api/...` для этих проверок не используется. Массовые tools проходят данные постранично, показывают progress/counters и при необходимости автоматически скачивают CSV. Для девяти длительных tools реализована одинаковая плавающая панель прогресса внутри CMS с мягкой остановкой; массовые независимые задания адаптируют параллельность, последовательные UI/DOM-операции сохраняют исходный порядок. Кнопка Stop не отменяет уже начатые операции записи, а дожидается завершения текущей группы с её проверкой. При запуске через Tools Launcher временные ошибки чтения автоматически повторяются; постоянные `4xx` не ретраятся. Регистрация tool и его версия (`file`, semver `version`, `group`) хранятся только в `extension/manifests/tools.json`; metadata-блоки внутри tool-файлов не используются.

- `audits/attributes-wrong-prices.js` — attributes активных товаров в текущем состоянии CMS с пустой, нечисловой, нулевой, отрицательной или дробной ценой; CSV включает `documentId` предложения.
- `audits/products-missing-content.js` — проверяет критичные контентные поля активных товаров с учётом `categories.active`: товары только в отключённых категориях пропускаются, а товары без categories или со смешанными active/inactive categories всегда попадают в отчёт как edge cases.
- `audits/lux-normalizer.js` — одноразовый инструмент отключения Products двух заданных брендов в `ru`: проверяет все товары и relation `brand` через Content Manager, показывает dry-run, после подтверждения сохраняет `active=false`, публикует, проверяет published state и скачивает CSV. Запуск через `Alt+P`; остановка из Console: `window.brandDisableStop = true`.
- `audits/products-wrong-variants.js` — проверяет варианты `shade`/`volume` у attributes активных товаров и формирует компактный отчёт `documentId` + `errorType`.
- `audits/catalog-tree-products.js` — от открытой категории обходит всё поддерево вниз по `categories`, собирает relation `product` на каждом уровне и скачивает CSV с одной колонкой `documentId`; товары не фильтруются по active/draft/published.
- `sync/products-category-mirror-sync.js` — зеркально синхронизирует Products внутри настроенных групп из 2+ categories: для каждой группы строит union Products, одним `actions/publish` добавляет Product все недостающие categories этой группы, обрабатывает группы последовательно с live re-check/verify, использует throughput-aware adaptive concurrency без auto-retry POST и скачивает CSV только при ошибках/расхождениях.
- `sync/products-category-forward-sync.js` — односторонне синхронизирует Products по настроенным группам `source → target`: добавляет в target только отсутствующие там Products из source, обратно из target в source ничего не добавляет, выполняет общий dry-run, live re-check/verify по группам, использует тот же throughput-aware adaptive concurrency без auto-retry POST и скачивает CSV только при ошибках/расхождениях.
- `diagnostics/dom-stealer.js` — копирует текущий DOM страницы в Clipboard для диагностики UI.
- `diagnostics/network-recorder.js` — Start/Stop recorder для same-origin Strapi `fetch`/XHR: собирает `/api/...`, `/content-manager/...`, `/upload`, request/response context и на Stop копирует JSON dump в Clipboard.
- `diagnostics/style-stealer.js` — снимает design snapshot текущей страницы Strapi: UI-релевантные computed styles, matched CSS rules, `::before` / `::after`, design tokens и отдельные дедуплицированные профили `native` / `modified` / `custom`; `data-tm-created="<extension-id>"` отмечает созданный extension UI, `data-tm-modified="<extension-id>"` — нативный узел внутри custom-контейнера; показывает progress, копирует JSON в Clipboard или скачивает `style-stealer.json`.
- `sync/layout-sync.js` — service dry-run для Product: читает фактический порядок и строки полей из UI после `product-sections`, во вкладке `Фильтры` учитывает порядок смысловых групп, сохраняет текущий `size` каждого поля, показывает diff и только после подтверждения записывает `layouts.edit` через штатный Content Manager configuration API с последующим GET verify.
- `extension/manifests/tools.json` — runtime-источник `file`, semver `version` и `group` для Tools Launcher; `file` хранит путь относительно `extension/tools/`, а `group` обязан совпадать с первой папкой пути (`audits`, `sync`, `diagnostics`).

Для нового tool добавь файл в подходящую подпапку `extension/tools/` (`audits/`, `sync/` или `diagnostics/`) и зарегистрируй его в `extension/manifests/tools.json` через `file`, `version` и `group`. `version` и `group` внутри tool-файла не дублируются.

Рабочие группы: `audits`, `sync`, `diagnostics`.

## Locale

Инструменты для осторожной подготовки локализаций Strapi. Запуск: открой указанную карточку товара в Strapi Admin, скопируй нужный JS из GitHub в DevTools → Console.

- [`product-kk-preflight.js`](./locale/product-kk-preflight.js) — проверка RU/KK для пилотного товара `loeqjcvawiaajxsyld5g3jqc`, только GET; автоматически сохраняет JSON с состоянием локализации и конфигурацией.
- [`product-kk-postflight.js`](./locale/product-kk-postflight.js) — проверка того же товара после ручного создания KK: сравнение RU с исходным снимком, статус KK, общность `documentId`, пустые relations; только GET, результат — JSON.
- [`product-i18n-schema-audit.js`](./locale/product-i18n-schema-audit.js) — расследование потери RU-полей после создания KK. Только GET: читает проверенный маршрут `/content-manager/content-types`, определяет из `pluginOptions.i18n.localized`, какие поля локализованы, а какие общие, и сравнивает текущие RU/KK для одного товара. Выгружает JSON; никаких записей в CMS.
- [`product-kk-guarded-pilot.js`](./locale/product-kk-guarded-pilot.js) — экспериментальный Console-пилот **одного** Product без KK, с RU `published` **или `modified`**. GET схемы, отдельных RU Draft и Published, всех relations обеих версий и KK; экспорт preflight JSON. Формирует PUT из общих полей RU Draft и `name1: " "`; локализуемые поля и relations в KK не переносит. Неизвестные структуры и наличие KK блокируют write. Для одного PUT нужно нажать кнопку и подтвердить; postflight сравнивает RU Draft **и Published**, включая все relations, с предшествующим снимком. При расхождении полей, relations или переходе статуса RU — аварийное сообщение и JSON, а не ложный `success: true`. Повторный запуск с существующей KK делает только GET и экспортирует RU Draft/Published для диагностики. **Автоматического rollback нет. RU `published` с заполненными media и 19 связями подтверждён одним стресс-тестом; сценарий исходного RU `modified` с медиа отдельно не проверен. Массовый запуск без собственного dry-run и postflight запрещён.**
- [`dior-product-kk-candidates-audit.js`](./locale/dior-product-kk-candidates-audit.js) — **одноразовый read-only аудит всей связи `products` RU-бренда DIOR** (`qw7sja6ffpbufvzub5maxyrl`). Запуск из Console открытой RU-карточки бренда; все страницы relation, затем RU/KK detail каждого связанного Product (до 4 параллельных GET, progress/Stop/retry). Сверяет схему i18n и готовность для `product-kk-guarded-pilot.js`: нет KK, RU Published, известные общие поля; отдельно выделяет товары с media, расширенными relations, непустыми components, блокировки и уже существующие KK. После полного прохода автоматически формирует `dior-product-kk-test-candidates.csv` и `.json` (ссылки на карточки, сценарий и причины). При сбое/остановке неполный CSV не формируется. **Никаких PUT/POST, новая KK не создаётся; на живой CMS проверено чтение всех 705 товаров DIOR, найдено 87 без KK на момент аудита.**
- [`product-kk-ru-versions-check.js`](./locale/product-kk-ru-versions-check.js) — read-only сверка RU `status=draft` и `status=published` по бизнес-полям и всем relations на пилотном товаре. Скачивает JSON с отличиями.
- **Стресс-тест KK с медиа и большим числом relations (2026-11-10):** Product `b8tzy63p6ij03w5z4yuutuwu`, новый KK Draft `4812550` (PUT HTTP 200). Все 45 бизнес-полей RU Draft/Published, 19 relation IDs RU и медиа `170312` сохранились; Published не изменился. **Побочный эффект:** RU Draft `published → modified`, поэтому строгий postflight дал `success:false` без ошибок содержимого. Подробности — [`locale/STRAPI-I18N-5130.md`](./locale/STRAPI-I18N-5130.md). 
- **Результат повторного пилота (2026-11-10, `10.10.3.80:1337`):** один KK draft создан (HTTP 200, id `4812516`) при отправке 21 общего поля RU и локализуемого `name1: " "`. Сравнение RU до/после: **0 отличий бизнес-полей и 0 отличий 19 relations**, у KK все 19 relations пустые. При этом RU стал `modified`, обновился `updatedAt`, в `localizations` появилась KK. Дополнительная read-only сверка RU Draft и Published подтвердила **0 различий по бизнес-полям и 0 различий по всем 19 relations**; опубликованная RU-версия существует (`publishedAt` заполнен, id `4812499`). `modified` в ответе — статус документа в метаданных, а не отсутствие публикации. Это результат **одного** товара, не основание для массовой записи.
- [`strapi-version-check.js`](./locale/strapi-version-check.js) — только GET `/admin/information`; получает установленную версию backend Strapi и адрес Admin-сервера (`adminOrigin`), автоматически выгружает JSON без JWT и projectId. **Версию нужно проверять именно на сервере, где выполнялся проблемный PUT.**
- [`STRAPI-I18N-5130.md`](./locale/STRAPI-I18N-5130.md) — техническое расследование риска i18n в Strapi 5.13.0, ссылки на upstream, безопасный порядок backend-исправления и тестирования.
- Если нужно записать фактический запрос из интерфейса, используй [`diagnostics/network-recorder.js`](./extension/tools/diagnostics/network-recorder.js) через `Alt+P`, затем повторный запуск для завершения записи.
- **Пустая локализация через UI:** полностью пустую KK-форму сохранить не удалось; для пилота в `name1` введён один пробел. На сохранении Strapi отправил `PUT /content-manager/collection-types/api::product.product/<documentId>?locale=kk` с `{ "newFrom1C": true, "InStock": false, "name1": " " }`. Ответ — KK draft с тем же `documentId`, без relations. При будущей синхронизации пробельную строку считать незаполненным текстом.
- **Причина и исправление upstream:** в Strapi i18n скалярные поля без `pluginOptions.i18n.localized: true` считаются общими; relations, напротив, считаются локализуемыми по умолчанию. Поведение совпадает с классом проблемы [#27182](https://github.com/strapi/strapi/issues/27182). [PR #27184](https://github.com/strapi/strapi/pull/27184) (merged 2026-11-03) блокирует общие поля во вторичных локалях и наследует их в новых draft; в релиз v5.61.0 (2026-11-04) этот PR ещё не вошёл. До оценки установленной версии и безопасной фиксации backend не рекомендовать повторное создание пустышек через минимальный PUT.
- **Ограничение пилота:** после сохранения KK у тестового товара RU-черновик стал `modified`; в нём обнулились `name`, `code_1c`, `xml_id` и `sort` (подтверждено postflight и DOM). В опубликованной RU-версии значения сохранились (подтверждено отдельным DOM-снимком). **Нельзя повторять исходный минимальный PUT массово:** пока не локализована причина побочного изменения RU-черновика. Не публиковать повреждённый RU-черновик. Восстановление/Discard changes — только после отдельной проверки, что черновик не содержит нужных правок.

## Migrator

Pipeline разделены по типу записей и не используют общие конфиги. `products/` содержит существующий pipeline для товаров; все его CSV, media checkpoint, journal и отчёты теперь используют префикс `products-` вместо `migration-`. При переходе не смешивать новые файлы со старыми checkpoint. `attributes/` предназначен для торговых предложений (`api::attribute.attribute`, Bitrix `IBLOCK_ID=2`). Новые данные shade/volume включены в Config существующего `attributes/`, отдельного pipeline нет.

### Attributes — `migrator/attributes/`

1. **Config** — [`config.js`](./migrator/attributes/config.js) запускается в Console Strapi Admin. Только GET: все Attribute локали `ru` (включая draft, неактивные и пустой barcode), без Product. Результат `attributes-config.csv` (10 колонок): `documentId;barcode;active;hasDetailPicture;shade;shadeDocumentId;volume;volumeDocumentId;shadeHex;volumeValue`. Предыдущие 8 полей сохранены; `shadeHex` читает `shade.hexes[].hex` (если цветов несколько — значения объединены через `|` в порядке массива), `volumeValue` читает числовое/текстовое `volume.value` без единиц измерения и без преобразования в name. Пустой relation даёт пустые поля; связанный shade с пустым `hexes` или volume с `value:null` сохраняет `documentId`, но соответствующий `shadeHex`/`volumeValue` пуст. Сначала читает все предложения с точным populate `detail_picture.id`, `shade.name`, `volume.name` и native fallback для relations. Дополнительно **постранично загружает справочники** `api::shade.shade` (`populate[hexes][fields][0]=hex`) и `api::volume.volume` (`fields[0]=value`) и сопоставляет по `documentId`, а отдельный GET target detail использует только если поле отсутствует в list API. Изображения, `active`, баркоды не меняет; GET с ограниченной параллельностью, прогресс/счётчики и без частичного CSV при ошибке. Счётчики `shadeHexVolumeValue.missingValues` и `missingValueSamples` показывают существующие связи без заполненного HEX/value. Если target detail отвечает 404, Config сохраняет ID связи и пустое HEX/value, отражая проблему в `shadeHexVolumeValue.inaccessibleTargets` и `inaccessibleSamples`; иные ошибки API не маскируются. Мягкая остановка: `window.attributesConfigStop = true`. **Matcher/Importer пока не обновлены: новый CSV не передавать в старый Matcher.**
2. **Matcher** — [`matcher.js`](./migrator/attributes/matcher.js) запускается в Console Bitrix Admin с 10-колоночным `attributes-config.csv`. Последовательно читает весь grid `IBLOCK_ID=2` по ID ASC, только GET, без открытия карточек; обязательные колонки `PROPERTY_19` (штрихкод), `ACTIVE`, `DETAIL_PICTURE`, `PROPERTY_202` (объём), `PROPERTY_271` (текст-подсказка) и ID. Сверяет предложения по точному уникальному barcode, сохраняет ранее проверенные механизмы active/Media и checkpoint `v6-volume-review`. **Volume** в Bitrix отображается как `100 [62913]`; число извлекается из текста ячейки, а ID проверяется по ссылке на справочник `IBLOCK_ID=12`. Числовое значение сравнивается с `volumeValue` Strapi: совпало — ничего не менять независимо от `name`; отличается — добавить/заменить; действительно пустое в Bitrix — удалить существующую relation. **Нестандартное значение** (`2х5 [107307]`, `2x5` и др.) не преобразуется в число и не считается пустым: идёт в `attributes-volume-review.csv` для ручной проверки, автоматическая запись Volume запрещена, но active/Media для того же предложения продолжают обрабатываться независимо. В `attributes-matched.csv` (11 колонок) добавлен явный `bitrixVolumeStatus=known|empty|manual`, чтобы Importer различал подтверждённый пустой Volume и неизвестный формат. **Shade**: только заполненное `PROPERTY_271` при отсутствии `shadeDocumentId` в Strapi → `attributes-shade-review.csv`; если Shade уже есть — не проверять и не менять. Одна запись может присутствовать и в matched, и в ручной очереди. Выгрузки: `attributes-matched.csv` (`documentId;barcode;active;hasDetailPicture;bitrixId;bitrixActive;pictureUrl;volumeDocumentId;volumeValue;bitrixVolumeValue;bitrixVolumeStatus`), `attributes-shade-review.csv`, `attributes-volume-review.csv` (`documentId;barcode;bitrixId;bitrixVolumeRaw;bitrixVolumeRefId;strapiVolumeDocumentId;strapiVolumeValue;bitrixCardUrl`) и `attributes-unmatched.csv` (если есть исключения barcode). При неоднозначных ID/ссылках, ошибках пагинации или сортировки — STOP без итоговых файлов; нестандартный **подтверждённый** Volume не останавливает обход. `window.bitrixAttributesMatchStop = true` — мягкая остановка и повторный запуск. Большой checkpoint `v6-volume-review` сохраняется **в IndexedDB**, без лимита `localStorage`; уже сохранённый старый checkpoint из `localStorage` автоматически проверяется и переносится в IndexedDB без потери успешно обработанных страниц. Запуск с тем же исходным CSV продолжит обход с последней сохранённой страницы. Версия в Console: `v5.3-indexeddb-checkpoint`. Новый `attributes-matched.csv` (11 колонок) поддерживается текущим Importer.
3. **Importer** — [`importer.mjs`](./migrator/attributes/importer.mjs) (Node.js 20+, без npm) читает **только 11-колоночный** `attributes-matched.csv`: `documentId;barcode;active;hasDetailPicture;bitrixId;bitrixActive;pictureUrl;volumeDocumentId;volumeValue;bitrixVolumeValue;bitrixVolumeStatus`. Перед записью сверяет live Attribute по `documentId` + точному `barcode` и его to-one relation Volume через подтверждённый Content Manager GET `/content-manager/relations/api::attribute.attribute/<documentId>/volume?locale=ru&pageSize=5&page=1`. Справочник `api::volume.volume` читает один раз постранично; выбранный target перед первым подключением дополнительно проверяет через подтверждённый GET его карточки (для корректного числового `id` версии документа); для **добавления или замены** нужна запись с числовым `value=bitrixVolumeValue` и `name`, равным самому числу (допускается десятичная запятая вместо точки, но не `МЛ`, `ГР` или иной суффикс). Если совпадений **несколько**, выбрать первую по `id:ASC` (минимальный `id` из списка), проверить карточку выбранного target и назначить relation; выбор фиксируется в `attributes-import-report.csv` и отдельном `attributes-import-volume-duplicates.csv` для последующей ручной нормализации. Если совпадений **нет** → пропуск Volume и `attributes-import-volume-review.csv`, без создания справочника; остальные `active`/Media могут обновляться независимо. Если текущий Volume имеет совпадающий **value**, его relation сохраняется даже при нормализованном `name`. `bitrixVolumeStatus=known` → добавить/заменить, `empty` → удалить текущую relation, `manual` → никогда не изменять Volume. Shade не изменяет.

**Network-подтверждение 2026-11-09:** реальная замена Volume прошла HTTP 200 через `POST /content-manager/collection-types/api::attribute.attribute/<documentId>/actions/publish?locale=ru` с полным телом Attribute и `volume: {connect:[{id,documentId,isTemporary:true}],disconnect:[{id,documentId}]}`. Для Volume Importer отправляет только подтверждённый Publish payload; PUT выполняется отдельно **только для active/detail_picture**, если требуется, и после него проверяется, что Volume не изменился. Другие relations передаются с пустыми `connect/disconnect`, как в записанном Network-запросе. Изображение загружается из публичного оригинала Bitrix, без Cookie. После любой операции — GET/verify сохранённой и опубликованной ru-версии и целевого Volume documentId. Если запись могла выполниться, но результат не подтверждён, **весь импорт останавливается**; журнал защищает от повторных неопределённых записей. Не считать статус `modified` или существующий draft признаком чужих изменений. Мягкая остановка `Ctrl+C` после текущей записи; последовательная обработка с паузой по умолчанию 150 мс. Версия Console: `v2.1-volume-first-duplicate`.

**Запуск на Windows:** скопируй свежий `importer.mjs` на Desktop как `importer.mjs` и `attributes-matched.csv` из Matcher; в локальном файле укажи `AUTH.jwtToken`, не коммить токен. PowerShell: `node --use-system-ca "$env:USERPROFILE\Desktop\importer.mjs" --apply --only=DOCUMENT_ID` — **реальный пилот одной записи, без dry-run**; затем `--apply --limit=20` — следующая пачка, `--apply` — весь оставшийся CSV. Параметры `--limit`, `--only`, `--pause-ms`, `--retry-errors`; без `--apply` доступен dry-run, но он не обязателен. `--probe-media --only=DOCUMENT_ID` проверяет публичное изображение без записи. На Desktop создаются `attributes-import-report.csv`, `attributes-import-volume-review.csv` (отсутствующий Volume), `attributes-import-volume-duplicates.csv` (выбранные при дублях relation) и `attributes-import-journal-<hash>.jsonl`. Файл с тем же хешем безопасно продолжает прежний журнал, обработанные и требующие ручной проверки записи повторно не записываются. **Перед тысячами операций обязательно проверить одну фактическую запись после пилота в Strapi**, особенно удаление Volume; полная production-проверка этого Importer пока не выполнялась. CSV не пересохранять через Excel, чтобы не испортить ведущие нули barcode.


### Products — `migrator/products/`

1. **Config** — [`config.js`](./migrator/products/config.js) запускается в Console Strapi Admin. Read-only экспорт всех Product `ru`, независимо от `newFrom1C` и `active`. Итог `products-config.csv` (12 колонок): `documentId;name;name1;name2;detail_picture;preview_picture;pictures;active;newFrom1C;attributes;categories;detail_text`. Флаги Media и `detail_text` показывают заполненность; `attributes` — штрихкоды через `|`, `categories` — `bitrix_id` только категорий `custom=false` через `|`. CSV не открывать/пересохранять в Excel, чтобы не повредить штрихкоды и названия.
2. **Matcher** — [`matcher.js`](./migrator/products/matcher.js) запускается в Console Bitrix Admin и читает исходный `products-config.csv`. Находит **одно строгое** совпадение названия (`NAME === name`, с учётом регистра и пробелов) и подтверждает хотя бы один общий штрихкод. Читает из карточки Bitrix `name1`, `name2`, `detail_text`, `ACTIVE`, `SECTION_ID`; оригинальные публичные URL `preview_picture`, `detail_picture` получает **только если соответствующее Media в Strapi пусто**, а `pictures` проверяет только при пустой галерее Strapi (тогда передаёт все доступные оригиналы в исходном порядке). Сравнивает **заполненность**, не текстовые значения; уже заполненные поля Strapi не перезаписываются. Matcher отбирает различия контента, галереи, категории и `active`, а также все записи с `newFrom1C=true/null` без расчёта целевого значения флага: **только Importer** после сохранения определяет `newFrom1C` по пяти обязательным полям и хотя бы одной категории. Итоговый `products-matched.csv` содержит 12 исходных колонок плюс 10 полей Bitrix: `bitrixId;matchedBarcode;bitrixActive;bitrixSectionId;bitrixName1;bitrixName2;bitrixDetailText;bitrixPreviewPictureUrl;bitrixDetailPictureUrl;bitrixPicturesJson`. Попадают товары с необходимыми изменениями либо с `newFrom1C=true/null` для итоговой проверки Importer. Диагностика — `products-unmatched.csv`; если у **необходимого для переноса** Media нет достоверного оригинального URL, либо нельзя определить `SECTION_ID`, товар целиком исключается. Заполненное Media Strapi не блокирует импорт при проблемном URL Bitrix. Сначала **одним проходом** обходит страницы каталога Bitrix (`IBLOCK_ID=1`, `GET`, `by=id&order=asc`) и составляет индекс по исходным названиям, как в `attributes/matcher.js`; проверяет total, количество строк, сортировку и уникальность ID. Это заменяет нестабильный `main.ui.filter`, который при отсутствующем товаре возвращал весь каталог. Из индекса берутся только строго равные `NAME` (без изменения регистра/пробелов); затем один точный кандидат подтверждается общим штрихкодом из карточки. Отсутствующие в Bitrix товары попадают в `products-unmatched.csv` со статусом `NAME_NOT_FOUND`. Одновременное чтение карточек ограничено тремя запросами. Checkpoint `v5-media-flag` хранится в IndexedDB по хешу CSV; **старые `v3-content` и `v4-catalog-index` не переиспользуются**, поэтому первый запуск обновлённого Matcher пересопоставляет товары заново. Сканирование Bitrix-каталога повторяется при каждом запуске, checkpoint сохраняет результаты проверки товаров, но не индекс каталога. **Частичных CSV нет** — файлы скачиваются только после полного успешного прогона.
3. **Importer** — [`importer.mjs`](./migrator/products/importer.mjs) — Node.js 20+ **без npm-зависимостей**. Читает только `products-matched.csv`, **не запрашивает Bitrix Admin и не требует Bitrix Cookie**; медиа скачивает по публичным URL оригиналов из CSV и загружает через Strapi `/upload`. Укажи `AUTH.strapiJwt` в локальной копии файла. Перед изменением проверяет текущее состояние товара и нужную категорию Strapi по `bitrix_id=bitrixSectionId`. Если категории нет, товар целиком пропускается до любых записей и включается в `products-category-not-found.csv`. Existing relations сохраняются, добавляются только недостающие; заполненные контентные поля не меняются. `active` приводится к Bitrix; `newFrom1C` выставляется по результату проверки пяти обязательных полей и категории (галерея может быть пустой в обеих CMS). После Save/Verify выполняется Publish ru/Verify; при неизвестном исходе записи требуется ручная проверка.

**Запуск Products Importer из PowerShell:** помести `importer.mjs` и `products-matched.csv` на рабочий стол; `node --use-system-ca "$env:USERPROFILE\Desktop\importer.mjs"` — dry-run всех кандидатов с `products-import-plan.csv`; добавь `--apply` только после пилотной проверки для записи в Strapi. Обработка последовательная без обязательной паузы (по умолчанию `--pause-ms=0`); при необходимости можно задать `--pause-ms=N` до 60000 мс. `--confirm=<BitrixID>` разрешён только для входного CSV с одной записью. Результаты: `products-import-report.csv`, при отсутствии категорий — `products-category-not-found.csv`, журнал `products-import-journal-<hash>.jsonl`, Media checkpoint `products-media-checkpoint.json`. Для повтора используй тот же CSV: завершённые записи пропускаются, `--retry-errors` позволяет повторить ошибки чтения, `--retry-partial` — неполные карточки; статусы `review` не повторяются без ручной проверки.



## Helpdesk

`helpdesk/workflow.json` — основной n8n workflow Telegram-бота MonAmie Helpdesk: регистрация сотрудника, создание обращения одним сообщением, загрузка медиа и создание карточки в Notion. После нажатия `Создать обращение` сотрудник отправляет текст или медиа с подписью; текст обязателен, медиа опционально, отдельной кнопки отправки нет.

`helpdesk/notifications.json` — отдельный outbound workflow Notion → n8n → Telegram для уведомлений по статусам `В работе`, `Решено` и `Не по адресу`. Он принимает webhook от Notion, собирает текст уведомления из `Обращение`, `Статус`, `Ответ` и `Telegram chat ID`, затем отправляет сообщение через тот же Telegram credential. Webhook настроен на Header Auth; секрет хранится только в n8n credential и Notion custom header, не в repo.

Raw URL для импорта:

`https://raw.githubusercontent.com/mbtema/strapi/main/helpdesk/workflow.json`

`https://raw.githubusercontent.com/mbtema/strapi/main/helpdesk/notifications.json`

После обновления workflow в n8n экспорт заменяется в соответствующем файле, чтобы raw URL оставался постоянным.

## Translator

- `translator/full.md` — полный source of truth для RU → KK перевода: без искусственной экономии символов, с подробными правилами, приоритетами, глоссарием и самопроверкой.
- `translator/compressed.md` — поведенчески эквивалентная сжатая версия для ChatGPT Project Instructions; должна оставаться не длиннее 8000 символов. Правила и приоритеты те же, сокращаются объяснения и примеры, а не логика.
- `translator/extractor.md` — служебный prompt для анализа review-таблиц и накопленного translation context перед merge подтверждённых правил.

При изменении translation logic сначала обновляется `full.md`, затем те же правила синхронизируются в `compressed.md` и проверяется лимит 8000 символов. `compressed.md` не должен иметь самостоятельную терминологию, расходящуюся с `full.md`.

## Project

`project/` не участвует в runtime.

- `project/instruction.md` — готовый текст для поля Project Instructions; operational rules, приоритеты и формат работы.
- `project/context.md` — готовый knowledge source для загрузки в ChatGPT Project: устойчивые факты, CANONICAL workflows, решения, доменная память, history/experiments.

Эти файлы используются как sync/staging copies: при плановой консолидации они обновляются и проверяются в repo, после чего пользователь вручную переносит `instruction.md` в Project Instructions и загружает `context.md` как источник. В обычной работе активными источниками остаются версии внутри ChatGPT Project.

Текущее code/version/manifest/Issue состояние берётся из live GitHub/API/Network/UI, а не из `context.md`.

README обновляется, когда меняются структура, назначение, установка, использование или перечень основных инструментов репозитория.

## Дерево

```text
.
├── extension/
│   ├── extension.js
│   ├── manifests/
│   │   ├── extensions.json
│   │   ├── features.json
│   │   ├── ui-ux.json
│   │   └── tools.json
│   ├── features/
│   │   ├── alt-enter-publisher.js
│   │   └── tools-launcher.js
│   ├── ui-ux/
│   │   ├── entry-relocate.js
│   │   ├── product-attributes-navigator.js
│   │   ├── product-sections.js
│   │   ├── record-list.js
│   │   └── sidebar.js
│   └── tools/
│       ├── audits/
│       │   ├── attributes-wrong-prices.js
│       │   ├── catalog-tree-products.js
│       │   ├── lux-normalizer.js
│       │   ├── products-attributes-locale-audit.js
│       │   ├── products-missing-content.js
│       │   └── products-wrong-variants.js
│       ├── sync/
│       │   ├── layout-sync.js
│       │   ├── products-category-forward-sync.js
│       │   └── products-category-mirror-sync.js
│       └── diagnostics/
│           ├── dom-stealer.js
│           ├── network-recorder.js
│           └── style-stealer.js
├── migrator/
│   ├── products/
│   │   ├── config.js
│   │   ├── matcher.js
│   │   ├── importer.mjs
│   │   └── starter.ps1
│   └── attributes/
│       ├── config.js
│       ├── matcher.js
│       ├── importer.mjs
│       └── starter.ps1
├── helpdesk/
│   ├── workflow.json
│   └── notifications.json
├── translator/
│   ├── full.md
│   ├── compressed.md
│   └── extractor.md
├── project/
│   ├── context.md
│   └── instruction.md
└── README.md
```
