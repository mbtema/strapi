// Этап 1: Strapi Admin -> Console -> attributes-config.csv
// Только GET. Все торговые предложения locale=ru, без фильтров active/published.
// CSV: documentId;barcode. Пустой barcode сохраняется пустой строкой.
(async () => {
  'use strict';

  const CFG = {
    locale: 'ru',
    pageSize: 100,
    concurrency: 5,
    filename: 'attributes-config.csv',
    maxPages: 10000
  };
  const AUTH = {
    // Необязательно: вставь JWT вручную. Если пусто, берётся jwtToken из localStorage Strapi Admin.
    jwtToken: ''
  };
  const UID = 'api::attribute.attribute';
  const LOG = '[Attributes config]';

  if (!location.pathname.startsWith('/admin/')) {
    throw Error('Открой Strapi Admin и запусти скрипт в DevTools Console');
  }
  if (window.__tmAttributesConfigRunning) {
    throw Error('Экспорт Attributes уже запущен');
  }
  window.__tmAttributesConfigRunning = true;

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
    const listOf = json => Array.isArray(json?.results)
      ? json.results
      : Array.isArray(json?.data) ? json.data : null;
    const paginationOf = json => json?.pagination ?? json?.meta?.pagination ?? null;
    const unwrap = item => item?.attributes && !Array.isArray(item.attributes) && !item.documentId
      ? { ...item.attributes, id: item.id }
      : item;

    async function getJson(url, page) {
      for (let attempt = 1; attempt <= 3; attempt++) {
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
        return {
          documentId: item.documentId,
          barcode: item.barcode ?? ''
        };
      });
    }

    pages[0] = parsePage(first, 1);
    let completedPages = 1;
    let nextPage = 2;
    console.log(LOG, 'Всего страниц:', pageCount, '| всего записей:', expectedTotal ?? '?');

    async function worker() {
      while (nextPage <= pageCount) {
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

    // CSV без преобразования barcode в число: ведущие нули сохраняются.
    const quote = value => '"' + String(value).replace(/"/g, '""') + '"';
    const csv = '\uFEFF' + [
      'documentId;barcode',
      ...rows.map(row => [row.documentId, row.barcode].map(quote).join(';'))
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
