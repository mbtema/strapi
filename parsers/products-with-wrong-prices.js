// ==Parser==
// @name         products-with-wrong-prices
// @version      1.2.3
// @description  Находит торговые предложения активных товаров с некорректной текущей ценой в Strapi CMS
// @output       CSV: barcode;price;errorType
// ==/Parser==

(async () => {
  'use strict';

  const PUBLIC_URL = '/api/attributes';
  const CONTENT_MANAGER_URL = '/content-manager/collection-types/api::attribute.attribute';
  const LOCALE = 'ru';
  const PUBLIC_PAGE_SIZE = 100;
  const CM_PAGE_SIZE = 50;
  const HEADERS = ['barcode', 'price', 'errorType'];

  const timestamp = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  };

  const priceIssue = value => {
    if (value == null || String(value).trim() === '') return 'missing';

    const price = Number(value);
    if (!Number.isFinite(price)) return 'invalid';
    if (price === 0) return 'zero';
    if (!Number.isInteger(price)) return 'fractional';

    return null;
  };

  const getAdminToken = () => {
    const raw = localStorage.getItem('jwtToken');
    if (!raw) return '';

    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'string') return parsed;
    } catch {}

    return raw.replace(/^"|"$/g, '');
  };

  const adminToken = getAdminToken();

  if (!adminToken) {
    throw new Error(
      'Не найден jwtToken в LocalStorage. Перезайди в Strapi Admin и запусти checker повторно.'
    );
  }

  const downloadCSV = (items, filename) => {
    const q = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [
      HEADERS.join(';'),
      ...items.map(row => HEADERS.map(key => q(row[key])).join(';'))
    ].join('\n');

    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    );

    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: filename
    });

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const getRows = json => {
    if (Array.isArray(json?.results)) return json.results;
    if (Array.isArray(json?.data)) return json.data;
    return [];
  };

  const getPagination = json => json?.pagination ?? json?.meta?.pagination ?? null;

  console.log('[Price Checker] Шаг 1/2: получаю предложения активных товаров из Public API...');

  const activeAttributeIds = new Set();

  const publicParams = new URLSearchParams({
    'pagination[pageSize]': String(PUBLIC_PAGE_SIZE),
    'pagination[page]': '1',
    'sort[0]': 'id:asc',
    'locale': LOCALE,
    'filters[product][active][$eq]': 'true',
    'fields[0]': 'documentId'
  });

  let publicPage = 1;
  let publicPageCount = 1;
  let publicTotal = 0;

  while (publicPage <= publicPageCount) {
    publicParams.set('pagination[page]', String(publicPage));

    const response = await fetch(`${PUBLIC_URL}?${publicParams}`);

    if (!response.ok) {
      throw new Error(
        `Public API: ошибка ${response.status} на странице ${publicPage}`
      );
    }

    const json = await response.json();
    const rows = getRows(json);
    const pagination = getPagination(json);

    publicPageCount = pagination?.pageCount ?? publicPageCount;
    publicTotal = pagination?.total ?? publicTotal;

    for (const attribute of rows) {
      if (attribute?.documentId) {
        activeAttributeIds.add(attribute.documentId);
      }
    }

    if (
      publicPage === 1 ||
      publicPage % 25 === 0 ||
      publicPage === publicPageCount
    ) {
      console.log(
        `[Price Checker] Active offers: страница ${publicPage}/${publicPageCount} | ` +
        `найдено ${activeAttributeIds.size}/${publicTotal || '?'}`
      );
    }

    publicPage++;
  }

  console.log(
    `[Price Checker] Шаг 1/2 готов: предложений активных товаров — ${activeAttributeIds.size}.`
  );
  console.log(
    '[Price Checker] Шаг 2/2: читаю текущие barcode/price из Content Manager...'
  );

  const invalidRows = [];
  const seenDocumentIds = new Set();

  let cmPage = 1;
  let cmPageCount = null;
  let cmTotal = null;

  while (true) {
    const cmParams = new URLSearchParams({
      page: String(cmPage),
      pageSize: String(CM_PAGE_SIZE),
      sort: 'id:ASC',
      locale: LOCALE
    });

    const response = await fetch(`${CONTENT_MANAGER_URL}?${cmParams}`, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${adminToken}`
      }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Content Manager: ошибка ${response.status} на странице ${cmPage}` +
        (body ? `: ${body.slice(0, 300)}` : '')
      );
    }

    const json = await response.json();
    const rows = getRows(json);
    const pagination = getPagination(json);

    if (cmPage === 1 && rows.length) {
      const sample = rows[0];

      if (!Object.prototype.hasOwnProperty.call(sample, 'price')) {
        throw new Error(
          'Content Manager list response не содержит поле price. ' +
          'Checker остановлен, чтобы не создавать ложный отчёт.'
        );
      }

      if (!Object.prototype.hasOwnProperty.call(sample, 'barcode')) {
        throw new Error(
          'Content Manager list response не содержит поле barcode. ' +
          'Checker остановлен, чтобы не создавать ложный отчёт.'
        );
      }
    }

    if (!rows.length) break;

    cmPageCount = pagination?.pageCount ?? cmPageCount;
    cmTotal = pagination?.total ?? cmTotal;

    let newRows = 0;

    for (const attribute of rows) {
      if (!attribute?.documentId || seenDocumentIds.has(attribute.documentId)) {
        continue;
      }

      seenDocumentIds.add(attribute.documentId);
      newRows++;

      if (!activeAttributeIds.has(attribute.documentId)) continue;

      const errorType = priceIssue(attribute.price);
      if (!errorType) continue;

      invalidRows.push({
        barcode: attribute.barcode ?? '',
        price: attribute.price ?? '',
        errorType
      });
    }

    if (
      cmPage === 1 ||
      cmPage % 25 === 0 ||
      (cmPageCount && cmPage === cmPageCount)
    ) {
      console.log(
        `[Price Checker] CMS: страница ${cmPage}${cmPageCount ? '/' + cmPageCount : ''} | ` +
        `прочитано ${seenDocumentIds.size}${cmTotal ? '/' + cmTotal : ''} | ` +
        `проблемных ${invalidRows.length}`
      );
    }

    if (!newRows) {
      console.warn(
        `[Price Checker] Страница ${cmPage} не дала новых documentId — останавливаюсь, чтобы не зациклиться.`
      );
      break;
    }

    if (cmPageCount && cmPage >= cmPageCount) break;
    if (!cmPageCount && rows.length < CM_PAGE_SIZE) break;

    cmPage++;
  }

  invalidRows.sort((a, b) =>
    String(a.barcode).localeCompare(String(b.barcode), 'en', { numeric: true })
  );

  console.table(invalidRows);
  console.log(
    `[Price Checker] Готово: найдено ${invalidRows.length} торговых предложений активных товаров ` +
    'с некорректной текущей ценой в CMS.'
  );

  window.attributesWithInvalidPrice = invalidRows;

  downloadCSV(
    invalidRows,
    `attributes_invalid_prices_${timestamp()}.csv`
  );
})();
