(async () => {
  'use strict';

  const BASE_URL = '/content-manager/collection-types/api::attribute.attribute';
  const LOCALE = 'ru';
  const PAGE_SIZE = 100;
  const HEADERS = ['documentId', 'barcode'];
  const CSV_FILENAME = 'attributes-without-product.csv';
  const rows = [];

  const getAdminToken = () => {
    const raw = localStorage.getItem('jwtToken');
    if (!raw) return '';

    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'string' ? parsed : raw;
    } catch {
      return raw.replace(/^"|"$/g, '');
    }
  };

  const adminToken = getAdminToken();
  if (!adminToken) {
    throw new Error('Не найден jwtToken в LocalStorage');
  }

  const downloadCSV = items => {
    const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [
      HEADERS.join(';'),
      ...items.map(row => HEADERS.map(key => quote(row[key])).join(';'))
    ].join('\n');

    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    );

    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: CSV_FILENAME
    });

    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  let page = 1;
  let pageCount = 1;

  while (page <= pageCount) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sort: 'barcode:ASC',
      'filters[$and][0][product][name][$null]': 'true',
      locale: LOCALE
    });

    const response = await fetch(`${BASE_URL}?${params}`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${adminToken}`
      }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Content Manager: HTTP ${response.status} on page ${page}` +
        (body ? ` — ${body.slice(0, 250)}` : '')
      );
    }

    const json = await response.json();

    if (!Array.isArray(json?.results) || !json?.pagination) {
      throw new Error('Content Manager вернул неожиданный формат ответа');
    }

    const rawPageCount = Number(json.pagination.pageCount);
    pageCount = Number.isInteger(rawPageCount) && rawPageCount > 0
      ? rawPageCount
      : 1;

    for (const item of json.results) {
      if (typeof item?.documentId !== 'string' || !item.documentId) {
        throw new Error('Content Manager вернул запись без documentId');
      }

      rows.push({
        documentId: item.documentId,
        barcode: item.barcode ?? ''
      });
    }

    console.log(`Страница ${page}/${pageCount} | Найдено: ${rows.length}`);
    page++;
  }

  const barcode = row => String(row.barcode ?? '').trim();

  rows.sort((a, b) => {
    const aBarcode = barcode(a);
    const bBarcode = barcode(b);

    if (!aBarcode && !bBarcode) {
      return a.documentId.localeCompare(b.documentId);
    }
    if (!aBarcode) return 1;
    if (!bBarcode) return -1;

    return (
      aBarcode.localeCompare(bBarcode, 'en', { numeric: true }) ||
      a.documentId.localeCompare(b.documentId)
    );
  });

  console.table(rows);
  console.log(`Готово: ${rows.length}`);

  if (!rows.length) return;
  downloadCSV(rows);
})();