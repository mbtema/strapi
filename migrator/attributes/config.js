// Этап 1: Strapi Admin -> Console -> attributes-config.csv
// Только GET. Все торговые предложения locale=ru, без фильтров active/published.
// CSV: documentId;barcode;active;hasDetailPicture;shade;shadeDocumentId;volume;volumeDocumentId;shadeHex;volumeValue.
// shade/volume — name связанных записей (может отсутствовать); *DocumentId — их идентификаторы Strapi.
// Если имя целевой записи недоступно, сохраняем её documentId и фиксируем случай в отчёте.
// Только GET, без привязки к Product.
(async () => {
  'use strict';

  const CFG = {
    locale: 'ru',
    pageSize: 100,
    concurrency: 5,
    relationConcurrency: 6,
    dictionaryConcurrency: 4,
    dictionaryDetailConcurrency: 6,
    filename: 'attributes-config.csv',
    maxPages: 10000
  };
  const AUTH = {
    // Необязательно: вставь JWT вручную. Если пусто, берётся jwtToken из localStorage Strapi Admin.
    jwtToken: ''
  };
  const UID = 'api::attribute.attribute';
  const LOG = '[Attributes config]';

  if (location.pathname !== '/admin' && !location.pathname.startsWith('/admin/')) {
    throw Error('Открой Strapi Admin и запусти скрипт в DevTools Console');
  }
  if (window.__tmAttributesConfigRunning) {
    throw Error('Экспорт Attributes уже запущен');
  }
  window.__tmAttributesConfigRunning = true;
  window.attributesConfigStop = false;

  try {
    const stored = localStorage.getItem('jwtToken');
    let token = AUTH.jwtToken.trim();
    if (!token && stored) {
      try {
        const parsed = JSON.parse(stored);
        token = typeof parsed === 'string' ? parsed : '';
      } catch {
        token = stored;
      }
    }
    if (!token) throw Error('Не найден jwtToken: заполни AUTH.jwtToken или войди в Strapi Admin');

    const headers = {
      Accept: 'application/json',
      Authorization: 'Bearer ' + token
    };
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const stopped = () => {
      if (window.attributesConfigStop) throw Error('Остановлено пользователем; CSV не создан');
    };
    const listOf = json => Array.isArray(json?.results)
      ? json.results
      : Array.isArray(json?.data) ? json.data : null;
    const paginationOf = json => json?.pagination ?? json?.meta?.pagination ?? null;
    const unwrap = item => item?.attributes && !Array.isArray(item.attributes) && !item.documentId
      ? { ...item.attributes, id: item.id }
      : item;

    async function getJson(url, page) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        stopped();
        let response;
        try {
          response = await fetch(url, { method: 'GET', headers, credentials: 'include' });
        } catch (error) {
          if (attempt === 3) throw Error('Страница ' + page + ': network error: ' + error.message);
          await sleep(400 * attempt);
          continue;
        }
        if (response.status === 429 || response.status >= 500) {
          if (attempt === 3) throw Error('Страница ' + page + ': HTTP ' + response.status);
          await sleep(500 * attempt);
          continue;
        }
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw Error('Страница ' + page + ': HTTP ' + response.status + ' ' + body.slice(0, 200));
        }
        try {
          return await response.json();
        } catch {
          throw Error('Страница ' + page + ': сервер вернул невалидный JSON');
        }
      }
    }

    async function loadPage(page) {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(CFG.pageSize),
        sort: 'barcode:ASC',
        locale: CFG.locale
      });
      // Для массового экспорта явно запрашиваем только ID медиа, а не весь файл.
      // Если Content Manager не вернёт поле, экспорт остановится без CSV.
      params.append('populate[detail_picture][fields][0]', 'id');
      params.append('populate[shade][fields][0]', 'name');
      params.append('populate[volume][fields][0]', 'name');
      return getJson('/content-manager/collection-types/' + UID + '?' + params, page);
    }

    const first = await loadPage(1);
    const firstPaging = paginationOf(first);
    const pageCount = Number(firstPaging?.pageCount);
    const expectedTotal = firstPaging?.total == null ? null : Number(firstPaging.total);
    if (!Number.isSafeInteger(pageCount) || pageCount < 0 || pageCount > CFG.maxPages ||
        (expectedTotal !== null && (!Number.isSafeInteger(expectedTotal) || expectedTotal < 0))) {
      throw Error('Некорректный ответ pagination на первой странице');
    }

    const pages = new Array(Math.max(pageCount, 1));

    // Наличие Media подтверждаем по реальному ID. Не считаем любой непустой
    // объект медиа: таблица может возвращать служебную структуру без файла.
    function hasDetailPicture(raw, docId) {
      const value = raw && typeof raw === 'object' && 'data' in raw ? raw.data : raw;
      if (value == null || value === '') return false;
      if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return true;
      if (typeof value === 'string' && /^\d+$/.test(value) && Number(value) > 0) return true;
      if (value && !Array.isArray(value) && typeof value === 'object' &&
          Number.isSafeInteger(value.id) && value.id > 0) return true;
      throw Error('Strapi ' + docId + ': detail_picture получен в неизвестном формате. ' +
        'Массовый список должен возвращать null или Media с числовым id; CSV не создан.');
    }

    function parsePage(json, page) {
      const list = listOf(json);
      const paging = paginationOf(json);
      if (!list || !paging || Number(paging.pageCount) !== pageCount ||
          (paging.page != null && Number(paging.page) !== page)) {
        throw Error('Страница ' + page + ': изменился формат ответа или пагинация');
      }
      if (page < pageCount && list.length === 0) {
        throw Error('Страница ' + page + ': пустая страница до конца списка');
      }
      if (list.length > CFG.pageSize) {
        throw Error('Страница ' + page + ': сервер вернул больше ' + CFG.pageSize + ' записей');
      }
      return list.map((raw, index) => {
        const item = unwrap(raw);
        if (typeof item?.documentId !== 'string' || !item.documentId.trim()) {
          throw Error('Страница ' + page + ', строка ' + (index + 1) + ': нет documentId');
        }
        if (item.locale != null && item.locale !== CFG.locale) {
          throw Error('Страница ' + page + ': получена другая локаль ' + item.locale);
        }
        if (!Object.prototype.hasOwnProperty.call(item, 'barcode')) {
          throw Error('Страница ' + page + ', ' + item.documentId +
            ': в list API отсутствует поле barcode — проверь Network');
        }
        if (item.barcode != null && typeof item.barcode !== 'string') {
          throw Error('Страница ' + page + ', ' + item.documentId +
            ': barcode не строка; экспорт остановлен во избежание потери ведущих нулей');
        }
        if (!Object.prototype.hasOwnProperty.call(item, 'active') ||
            (item.active !== true && item.active !== false && item.active !== null)) {
          throw Error('Strapi ' + item.documentId + ': нет корректного active в list API; CSV не создан.');
        }
        if (!Object.prototype.hasOwnProperty.call(item, 'detail_picture')) {
          throw Error('Strapi ' + item.documentId +
            ': list API не вернул detail_picture. Проверь Network/populate; CSV не создан.');
        }
        return {
          documentId: item.documentId,
          barcode: item.barcode ?? '',
          active: item.active === null ? 'null' : String(item.active),
          hasDetailPicture: String(hasDetailPicture(item.detail_picture, item.documentId)),
          _shade: own(item, 'shade') ? item.shade : undefined,
          _volume: own(item, 'volume') ? item.volume : undefined
        };
      });
    }

    pages[0] = parsePage(first, 1);
    let completedPages = 1;
    let nextPage = 2;
    console.log(LOG, 'Всего страниц:', pageCount, '| всего записей:', expectedTotal ?? '?');

    async function worker() {
      while (nextPage <= pageCount) {
        stopped();
        const page = nextPage++;
        pages[page - 1] = parsePage(await loadPage(page), page);
        completedPages++;
        if (completedPages % 10 === 0 || completedPages === pageCount) {
          console.log(LOG, 'Загружено страниц:', completedPages + '/' + pageCount);
        }
      }
    }

    await Promise.all(Array.from({
      length: Math.min(CFG.concurrency, Math.max(0, pageCount - 1))
    }, worker));

    const rows = pages.flat();
    if (expectedTotal !== null && rows.length !== expectedTotal) {
      throw Error('Список изменился при выгрузке: ожидалось ' +
        expectedTotal + ', получено ' + rows.length + '. CSV не сформирован');
    }

    const seenIds = new Set();
    const barcodeCounts = new Map();
    let withoutBarcode = 0;
    for (const row of rows) {
      if (seenIds.has(row.documentId)) {
        throw Error('Дублируется documentId ' + row.documentId +
          '. Возможно, список изменился во время пагинации. CSV не сформирован');
      }
      seenIds.add(row.documentId);
      if (!row.barcode.trim()) {
        withoutBarcode++;
      } else {
        barcodeCounts.set(row.barcode, (barcodeCounts.get(row.barcode) || 0) + 1);
      }
    }
    const duplicateBarcodes = [...barcodeCounts.values()].filter(n => n > 1).length;

    // Сначала используем явный populate из списка. Если он неполный,
    // обращаемся к native relations API, не считая {count:...} значением.
    function relationValue(raw, context) {
      if (raw === undefined) return null; // Поле не пришло: нужен отдельный GET.
      let data = raw && typeof raw === 'object' && own(raw, 'data') ? raw.data : raw;
      if (data == null || data === '') return { name: '', documentId: '' };
      if (Array.isArray(data)) {
        if (!data.length) return { name: '', documentId: '' };
        if (data.length !== 1) throw Error(context + ': больше одной связи');
        data = data[0];
      }
      const item = unwrap(data);
      if (item && typeof item === 'object' &&
          typeof item.documentId === 'string' && item.documentId.trim()) {
        // В Content Manager для отдельных связей name отсутствует или заменяется ID.
        // Это не делает существующий relation пустым.
        return {
          name: typeof item.name === 'string' ? item.name : '',
          documentId: item.documentId
        };
      }
      return null;
    }

    let relationFallbacks = 0;
    let relationNameLookups = 0;
    let nameLookupFailures = 0;
    let missingRelationNames = 0;
    const missingNameSamples = [];
    const targetNameCache = new Map();

    async function targetName(field, documentId) {
      const cacheKey = field + ':' + documentId;
      if (!targetNameCache.has(cacheKey)) {
        targetNameCache.set(cacheKey, (async () => {
          relationNameLookups++;
          const targetUid = field === 'shade' ? 'api::shade.shade' : 'api::volume.volume';
          const url = '/content-manager/collection-types/' + targetUid + '/' +
            encodeURIComponent(documentId) + '?locale=' + CFG.locale;
          try {
            const json = await getJson(url, targetUid + '/' + documentId);
            const raw = json?.data ?? json;
            const item = unwrap(Array.isArray(raw) ? raw[0] : raw);
            if (item?.documentId !== documentId) {
              nameLookupFailures++;
              return '';
            }
            return typeof item.name === 'string' ? item.name : '';
          } catch (error) {
            // Полное значение relation уже известно по documentId.
            // Ошибка чтения только его подписи не должна отменять весь экспорт.
            nameLookupFailures++;
            return '';
          }
        })());
      }
      return targetNameCache.get(cacheKey);
    }

    async function fillRelationName(value, field, attributeId) {
      if (!value.documentId) return value;
      if (!value.name.trim() || value.name.trim() === value.documentId) {
        const name = await targetName(field, value.documentId);
        if (name.trim()) value = { ...value, name };
      }
      if (!value.name.trim() || value.name.trim() === value.documentId) {
        missingRelationNames++;
        if (missingNameSamples.length < 10) {
          missingNameSamples.push({
            attributeDocumentId: attributeId,
            relation: field,
            targetDocumentId: value.documentId
          });
        }
      }
      return value;
    }

    async function readRelation(attributeId, field, inline) {
      const context = 'Attribute ' + attributeId + '/' + field;
      const fromList = relationValue(inline, context);
      if (fromList !== null) return fillRelationName(fromList, field, attributeId);

      relationFallbacks++;
      const params = new URLSearchParams({
        locale: CFG.locale, page: '1', pageSize: '10'
      });
      const json = await getJson(
        '/content-manager/relations/' + UID + '/' +
        encodeURIComponent(attributeId) + '/' + field + '?' + params, context
      );
      const list = listOf(json);
      const paging = paginationOf(json);
      const total = Number(paging?.total);
      const pages = Number(paging?.pageCount);
      if (!list || !paging || paging.total == null || paging.pageCount == null ||
          !Number.isSafeInteger(total) || total < 0 || total > 1 ||
          !Number.isSafeInteger(pages) || pages < 0 || pages > 1 ||
          (paging.page != null && Number(paging.page) !== 1) ||
          list.length !== total) {
        throw Error(context + ': некорректный ответ relations/pagination; CSV не создан');
      }
      if (total === 0) return { name: '', documentId: '' };
      const value = relationValue(list[0], context);
      if (!value || !value.documentId) {
        const keys = list[0] && typeof list[0] === 'object'
          ? Object.keys(list[0]).slice(0, 12).join(', ') : typeof list[0];
        throw Error(context + ': relation API не вернул documentId (поля: ' + keys + ')');
      }
      return fillRelationName(value, field, attributeId);
    }

    console.log(LOG, 'Проверяю shade и volume у ' + rows.length + ' Attributes...');
    let cursor = 0;
    let checkedRelations = 0;
    let withShade = 0;
    let withVolume = 0;
    let withBoth = 0;
    let relationFailure = null;
    async function relationWorker() {
      while (cursor < rows.length && !relationFailure) {
        const index = cursor++;
        const row = rows[index];
        try {
          stopped();
          const [shade, volume] = await Promise.all([
            readRelation(row.documentId, 'shade', row._shade),
            readRelation(row.documentId, 'volume', row._volume)
          ]);
          row.shade = shade.name;
          row.shadeDocumentId = shade.documentId;
          row.volume = volume.name;
          row.volumeDocumentId = volume.documentId;
          delete row._shade;
          delete row._volume;
          if (shade.documentId) withShade++;
          if (volume.documentId) withVolume++;
          if (shade.documentId && volume.documentId) withBoth++;
          checkedRelations++;
          if (checkedRelations % 500 === 0 || checkedRelations === rows.length) {
            console.log(LOG, 'Проверено relations: ' + checkedRelations + '/' + rows.length +
              '; shade: ' + withShade + '; volume: ' + withVolume +
              '; fallback GET: ' + relationFallbacks);
          }
        } catch (error) {
          relationFailure = error;
        }
      }
    }
    await Promise.all(Array.from({
      length: Math.min(CFG.relationConcurrency, rows.length)
    }, relationWorker));
    if (relationFailure) throw relationFailure;
    stopped();
    if (missingRelationNames) {
      console.warn(LOG, 'Relations с недоступным названием:', missingRelationNames,
        '(documentId сохранён). Примеры:', missingNameSamples);
    }


    // Справочники загружаем один раз, а не делаем GET для каждого Attribute:
    // shade.hexes[].hex (может быть несколько HEX), volume.value (число).
    // Не запрашиваем offers и не открываем карточки Product.
    const SHADE_UID = 'api::shade.shade';
    const VOLUME_UID = 'api::volume.volume';
    const dictionaryStats = {
      pages: { shade: 0, volume: 0 },
      uniqueUsed: { shade: 0, volume: 0 },
      detailFallbacks: { shade: 0, volume: 0 },
      missingValues: { shade: 0, volume: 0 },
      multipleHexes: 0,
      missingValueSamples: []
    };

    function targetValue(item, field, context) {
      if (field === 'shade') {
        if (!own(item, 'hexes')) return undefined; // Неполный list API.
        const raw = item.hexes && typeof item.hexes === 'object' &&
          own(item.hexes, 'data') ? item.hexes.data : item.hexes;
        if (raw == null) return '';
        if (!Array.isArray(raw)) {
          throw Error(context + ': hexes должен быть массивом/null');
        }
        const hexes = raw.map((entry, i) => {
          const hex = unwrap(entry);
          if (!hex || typeof hex !== 'object' || !own(hex, 'hex') ||
              (hex.hex !== null && typeof hex.hex !== 'string')) {
            throw Error(context + ': неверное значение hexes[' + i + ']');
          }
          return (hex.hex ?? '').trim();
        }).filter(Boolean);
        if (hexes.length > 1) dictionaryStats.multipleHexes++;
        return hexes.join('|');
      }
      if (!own(item, 'value')) return undefined;
      if (item.value == null || item.value === '') return '';
      if (typeof item.value === 'number' && Number.isFinite(item.value)) {
        return String(item.value);
      }
      if (typeof item.value === 'string' && item.value.trim()) {
        return item.value.trim();
      }
      throw Error(context + ': volume.value должен быть числом, строкой или null');
    }

    function dictionaryUrl(field, page) {
      const uid = field === 'shade' ? SHADE_UID : VOLUME_UID;
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(CFG.pageSize),
        sort: 'id:ASC',
        locale: CFG.locale
      });
      if (field === 'shade') {
        params.append('populate[hexes][fields][0]', 'hex');
      } else {
        params.append('fields[0]', 'value');
      }
      return '/content-manager/collection-types/' + uid + '?' + params;
    }

    async function dictionary(field, wanted) {
      if (!wanted.size) return new Map();
      const first = await getJson(dictionaryUrl(field, 1), field + ' page 1');
      const paging = paginationOf(first);
      const total = Number(paging?.total);
      const pageCount = Number(paging?.pageCount);
      if (!paging || paging.total == null || paging.pageCount == null ||
          !Number.isSafeInteger(total) || total < 0 ||
          !Number.isSafeInteger(pageCount) || pageCount < 0 ||
          pageCount > CFG.maxPages || (total > 0 && !pageCount)) {
        throw Error(field + ': некорректная пагинация справочника');
      }
      dictionaryStats.pages[field] = pageCount;
      const pages = new Array(Math.max(pageCount, 1));

      function parse(json, page) {
        const p = paginationOf(json);
        const list = listOf(json);
        if (!p || !list || Number(p.total) !== total ||
            Number(p.pageCount) !== pageCount ||
            (p.page != null && Number(p.page) !== page) ||
            list.length > CFG.pageSize ||
            (page < pageCount && list.length === 0)) {
          throw Error(field + ': неверный ответ страницы ' + page);
        }
        return list.map(unwrap);
      }

      pages[0] = parse(first, 1);
      let cursor = 2, done = 1, error = null;
      async function worker() {
        while (cursor <= pageCount && !error) {
          const page = cursor++;
          try {
            stopped();
            pages[page - 1] = parse(
              await getJson(dictionaryUrl(field, page), field + ' page ' + page), page
            );
            done++;
            if (done % 20 === 0 || done === pageCount) {
              console.log(LOG, 'Справочник ' + field + ': ' + done + '/' + pageCount);
            }
          } catch (e) { error = e; }
        }
      }
      await Promise.all(Array.from({
        length: Math.min(CFG.dictionaryConcurrency, Math.max(0, pageCount - 1))
      }, worker));
      if (error) throw error;
      const items = pages.flat();
      if (items.length !== total) {
        throw Error(field + ': список изменился при выгрузке (ожидалось ' +
          total + ', получено ' + items.length + ')');
      }

      const values = new Map();
      const seen = new Set();
      for (const item of items) {
        if (typeof item?.documentId !== 'string' || !item.documentId.trim()) {
          throw Error(field + ': запись справочника без documentId');
        }
        if (seen.has(item.documentId)) {
          throw Error(field + ': повтор documentId ' + item.documentId);
        }
        seen.add(item.documentId);
        if (!wanted.has(item.documentId)) continue;
        const value = targetValue(item, field, field + '/' + item.documentId);
        if (value !== undefined) values.set(item.documentId, value);
      }

      // Точечно читаем только те целевые записи, которые list API не раскрыл.
      const pending = [...wanted].filter(id => !values.has(id));
      let next = 0, resolved = 0, failed = null;
      const uid = field === 'shade' ? SHADE_UID : VOLUME_UID;
      async function detailWorker() {
        while (next < pending.length && !failed) {
          const documentId = pending[next++];
          try {
            stopped();
            const params = new URLSearchParams({ locale: CFG.locale });
            if (field === 'shade') params.append('populate[hexes][fields][0]', 'hex');
            const url = '/content-manager/collection-types/' + uid + '/' +
              encodeURIComponent(documentId) + '?' + params;
            const json = await getJson(url, field + '/' + documentId);
            const data = json?.data ?? json;
            const item = unwrap(Array.isArray(data) ? data[0] : data);
            if (item?.documentId !== documentId) {
              throw Error(field + '/' + documentId + ': detail вернул другую запись');
            }
            const value = targetValue(item, field, field + '/' + documentId);
            if (value === undefined) {
              throw Error(field + '/' + documentId + ': detail не вернул нужное поле');
            }
            values.set(documentId, value);
            dictionaryStats.detailFallbacks[field]++;
            resolved++;
            if (resolved % 500 === 0 || resolved === pending.length) {
              console.log(LOG, 'Уточнено ' + field + ': ' + resolved + '/' + pending.length);
            }
          } catch (e) { failed = e; }
        }
      }
      await Promise.all(Array.from({
        length: Math.min(CFG.dictionaryDetailConcurrency, pending.length)
      }, detailWorker));
      if (failed) throw failed;
      console.log(LOG, field + ': нужных уникальных ' + wanted.size +
        ', получено из справочника ' + (wanted.size - pending.length) +
        ', отдельных GET ' + pending.length);
      return values;
    }

    const shadeIds = new Set(rows.map(row => row.shadeDocumentId).filter(Boolean));
    const volumeIds = new Set(rows.map(row => row.volumeDocumentId).filter(Boolean));
    dictionaryStats.uniqueUsed.shade = shadeIds.size;
    dictionaryStats.uniqueUsed.volume = volumeIds.size;
    console.log(LOG, 'Загружаю hexes (' + shadeIds.size +
      ' shade) и value (' + volumeIds.size + ' volume)...');
    const [shadeValues, volumeValues] = await Promise.all([
      dictionary('shade', shadeIds),
      dictionary('volume', volumeIds)
    ]);
    stopped();
    for (const row of rows) {
      const shadeHex = row.shadeDocumentId ? shadeValues.get(row.shadeDocumentId) : '';
      const volumeValue = row.volumeDocumentId ? volumeValues.get(row.volumeDocumentId) : '';
      if (shadeHex === undefined || volumeValue === undefined) {
        throw Error('Attribute ' + row.documentId +
          ': не найдены значения связанного shade/volume; CSV не создан');
      }
      row.shadeHex = shadeHex;
      row.volumeValue = volumeValue;
      if (row.shadeDocumentId && !shadeHex) {
        dictionaryStats.missingValues.shade++;
        if (dictionaryStats.missingValueSamples.length < 10) {
          dictionaryStats.missingValueSamples.push({
            attribute: row.documentId, relation: 'shade', target: row.shadeDocumentId
          });
        }
      }
      if (row.volumeDocumentId && !volumeValue) {
        dictionaryStats.missingValues.volume++;
        if (dictionaryStats.missingValueSamples.length < 10) {
          dictionaryStats.missingValueSamples.push({
            attribute: row.documentId, relation: 'volume', target: row.volumeDocumentId
          });
        }
      }
    }
    if (dictionaryStats.missingValues.shade || dictionaryStats.missingValues.volume) {
      console.warn(LOG, 'Связи без заполненного HEX/value:',
        dictionaryStats.missingValues, dictionaryStats.missingValueSamples);
    }

    // CSV без преобразования barcode в число: ведущие нули сохраняются.
    const quote = value => '"' + String(value).replace(/"/g, '""') + '"';
    const csv = '\uFEFF' + [
      'documentId;barcode;active;hasDetailPicture;shade;shadeDocumentId;volume;volumeDocumentId;shadeHex;volumeValue',
      ...rows.map(row => [row.documentId, row.barcode, row.active, row.hasDetailPicture,
        row.shade, row.shadeDocumentId, row.volume, row.volumeDocumentId,
        row.shadeHex, row.volumeValue]
        .map(quote).join(';'))
    ].join('\r\n');

    const blobUrl = URL.createObjectURL(new Blob([csv], {
      type: 'text/csv;charset=utf-8'
    }));
    try {
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = CFG.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    }

    window.attributesConfigReport = {
      total: rows.length,
      withoutBarcode,
      duplicateBarcodeValues: duplicateBarcodes,
      withDetailPicture: rows.filter(row => row.hasDetailPicture === 'true').length,
      withShade,
      withVolume,
      withBoth,
      relationFallbacks,
      relationNameLookups,
      nameLookupFailures,
      missingRelationNames,
      missingNameSamples,
      shadeHexVolumeValue: dictionaryStats,
      activeTrue: rows.filter(row => row.active === 'true').length,
      activeFalse: rows.filter(row => row.active === 'false').length,
      activeNull: rows.filter(row => row.active === 'null').length,
      pages: pageCount,
      filename: CFG.filename
    };
    console.table([window.attributesConfigReport]);
    console.log(LOG, 'Готово. Только чтение. CSV не открывай и не пересохраняй через Excel перед matcher.');
  } catch (error) {
    console.error(LOG, 'Экспорт остановлен, неполный CSV не создаётся:', error);
    throw error;
  } finally {
    window.__tmAttributesConfigRunning = false;
  }
})();
