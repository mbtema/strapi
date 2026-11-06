// Этап 1: Strapi Admin -> Console -> attributes-config.csv
// Только GET. Все торговые предложения locale=ru, без фильтров active/published.
// CSV: documentId;barcode;active;hasDetailPicture;shade;shadeDocumentId;volume;volumeDocumentId.
// shade/volume — name связанных записей; *DocumentId — их идентификаторы Strapi.
// Только GET, без привязки к Product.
(async () => {
  'use strict';

  const CFG = {
    locale: 'ru',
    pageSize: 100,
    concurrency: 5,
    relationConcurrency: 6,
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
          typeof item.documentId === 'string' && item.documentId.trim() &&
          typeof item.name === 'string' && item.name.trim()) {
        return { name: item.name, documentId: item.documentId };
      }
      return null;
    }

    let relationFallbacks = 0;
    async function readRelation(attributeId, field, inline) {
      const context = 'Attribute ' + attributeId + '/' + field;
      const fromList = relationValue(inline, context);
      if (fromList !== null) return fromList;

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
        throw Error(context + ': relation API не вернул documentId/name; проверь Network');
      }
      return value;
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

    // CSV без преобразования barcode в число: ведущие нули сохраняются.
    const quote = value => '"' + String(value).replace(/"/g, '""') + '"';
    const csv = '\uFEFF' + [
      'documentId;barcode;active;hasDetailPicture;shade;shadeDocumentId;volume;volumeDocumentId',
      ...rows.map(row => [row.documentId, row.barcode, row.active, row.hasDetailPicture,
        row.shade, row.shadeDocumentId, row.volume, row.volumeDocumentId]
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
