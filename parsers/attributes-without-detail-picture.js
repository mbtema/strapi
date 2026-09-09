// ==ConsoleParser==
// @name         attributes-without-detail-picture
// @version      1.0.0
// @description  Ищет предложения активных товаров без detail_picture
// @output       CSV
// ==/ConsoleParser==

(async () => {
  'use strict';

  const BASE_URL = '/api/attributes';
  const PAGE_SIZE = 100;
  const HEADERS = [
    'id',
    'documentId',
    'barcode',
    'name',
    'price',
    'productDocumentId',
    'productName'
  ];
  const rows = [];

  const timestamp = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  };

  const getRelation = relation => Array.isArray(relation)
    ? relation[0] ?? null
    : Array.isArray(relation?.data)
      ? relation.data[0] ?? null
      : relation?.data ?? relation ?? null;

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
    'filters[product][active][$eq]': 'true',
    'filters[detail_picture][$null]': 'true',
    'fields[0]': 'barcode',
    'fields[1]': 'name',
    'fields[2]': 'price',
    'populate[product][fields][0]': 'documentId',
    'populate[product][fields][1]': 'name'
  });

  let page = 1;
  let pageCount = 1;
  let total = 0;

  while (page <= pageCount) {
    params.set('pagination[page]', String(page));

    const response = await fetch(`${BASE_URL}?${params}`);
    if (!response.ok) {
      throw new Error(`Ошибка ${response.status} на странице ${page}`);
    }

    const { data, meta } = await response.json();
    pageCount = meta.pagination.pageCount;
    total = meta.pagination.total;

    rows.push(...data.map(item => {
      const product = getRelation(item.product);
      return {
        id: item.id,
        documentId: item.documentId,
        barcode: item.barcode ?? '',
        name: item.name ?? '',
        price: item.price ?? '',
        productDocumentId: product?.documentId ?? '',
        productName: product?.name ?? ''
      };
    }));

    if (page === 1 || page % 25 === 0 || page === pageCount) {
      console.log(`Страница ${page}/${pageCount} | Найдено: ${rows.length}/${total}`);
    }

    page++;
  }

  console.table(rows);
  console.log(`Готово: найдено предложений активных товаров без detail_picture: ${rows.length}`);
  window.attributesWithoutDetailPicture = rows;
  downloadCSV(rows, `attributes_without_detail_picture_${timestamp()}.csv`);
})();
