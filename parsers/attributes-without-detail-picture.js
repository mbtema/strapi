// ==ConsoleParser==
// @name         attributes-without-detail-picture
// @version      1.0.1
// @description  Ищет предложения активных товаров без detail_picture и приоритизирует их по isInStock
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
    'isInStock',
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

  const stockRank = value => value === true ? 0 : value === false ? 1 : 2;

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
    'fields[3]': 'isInStock',
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
        isInStock: item.isInStock ?? '',
        productDocumentId: product?.documentId ?? '',
        productName: product?.name ?? ''
      };
    }));

    if (page === 1 || page % 25 === 0 || page === pageCount) {
      console.log(`Страница ${page}/${pageCount} | Найдено без detail_picture: ${rows.length}/${total}`);
    }

    page++;
  }

  rows.sort((a, b) => {
    const byStock = stockRank(a.isInStock) - stockRank(b.isInStock);
    if (byStock) return byStock;
    return String(a.barcode).localeCompare(String(b.barcode));
  });

  const inStockCount = rows.filter(row => row.isInStock === true).length;
  const outOfStockCount = rows.filter(row => row.isInStock === false).length;
  const unknownStockCount = rows.length - inStockCount - outOfStockCount;

  console.table(rows);
  console.log(
    `Готово: без detail_picture — ${rows.length} | ` +
    `isInStock=true: ${inStockCount} | ` +
    `isInStock=false: ${outOfStockCount} | ` +
    `isInStock не заполнен: ${unknownStockCount}`
  );

  window.attributesWithoutDetailPicture = rows;
  downloadCSV(rows, `attributes_without_detail_picture_${timestamp()}.csv`);
})();
