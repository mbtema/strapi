// ==ConsoleParser==
// @name         products-with-missing-content
// @version      1.0.0
// @description  Ищет активные товары без name1, name2, detail_picture или detail_text
// @output       CSV
// ==/ConsoleParser==

(async () => {
  'use strict';

  const BASE_URL = '/api/products';
  const PAGE_SIZE = 100;
  const HEADERS = [
    'id',
    'documentId',
    'name',
    'key',
    'missingCount',
    'missingFields',
    'name1',
    'name2',
    'hasDetailPicture',
    'detailTextLength'
  ];
  const rows = [];

  const timestamp = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  };

  const hasText = value => {
    if (value == null) return false;
    return String(value)
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .trim()
      .length > 0;
  };

  const hasMedia = relation => {
    if (!relation) return false;
    if (Array.isArray(relation)) return relation.length > 0;
    if ('data' in Object(relation)) {
      return Array.isArray(relation.data)
        ? relation.data.length > 0
        : Boolean(relation.data);
    }
    return true;
  };

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

  const params = new URLSearchParams({
    'pagination[pageSize]': String(PAGE_SIZE),
    'sort[0]': 'id:asc',
    'filters[active][$eq]': 'true',
    'fields[0]': 'name',
    'fields[1]': 'key',
    'fields[2]': 'name1',
    'fields[3]': 'name2',
    'fields[4]': 'detail_text',
    'populate[detail_picture][fields][0]': 'documentId'
  });

  let page = 1;
  let pageCount = 1;
  let total = 0;
  let checked = 0;

  while (page <= pageCount) {
    params.set('pagination[page]', String(page));

    const response = await fetch(`${BASE_URL}?${params}`);
    if (!response.ok) {
      throw new Error(`Ошибка ${response.status} на странице ${page}`);
    }

    const { data, meta } = await response.json();
    pageCount = meta.pagination.pageCount;
    total = meta.pagination.total;

    for (const item of data) {
      checked++;

      const missing = [];
      if (!hasText(item.name1)) missing.push('name1');
      if (!hasText(item.name2)) missing.push('name2');
      if (!hasMedia(item.detail_picture)) missing.push('detail_picture');
      if (!hasText(item.detail_text)) missing.push('detail_text');

      if (!missing.length) continue;

      rows.push({
        id: item.id,
        documentId: item.documentId,
        name: item.name ?? '',
        key: item.key ?? '',
        missingCount: missing.length,
        missingFields: missing.join(', '),
        name1: item.name1 ?? '',
        name2: item.name2 ?? '',
        hasDetailPicture: hasMedia(item.detail_picture),
        detailTextLength: hasText(item.detail_text)
          ? String(item.detail_text).trim().length
          : 0
      });
    }

    if (page === 1 || page % 25 === 0 || page === pageCount) {
      console.log(
        `Страница ${page}/${pageCount} | Проверено: ${checked}/${total} | Найдено: ${rows.length}`
      );
    }

    page++;
  }

  console.table(rows);
  console.log(
    `Готово: найдено активных товаров с незаполненным критичным контентом: ${rows.length}`
  );

  window.productsWithMissingContent = rows;
  downloadCSV(rows, `products_missing_content_${timestamp()}.csv`);
})();
