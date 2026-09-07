// ==ConsoleParser==
// @name         products-without-price
// @version      1.0
// @description  Ищет активные товары с торговыми предложениями, но без цены > 0
// @output       CSV
// ==/ConsoleParser==

(async () => {
  const BASE_URL = '/api/products';
  const PAGE_SIZE = 100;
  const CSV_HEADERS = [
    'id',
    'documentId',
    'name',
    'key',
    'attributeCount',
    'barcodes'
  ];
  const rows = [];

  const timestamp = () => {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  };

  const getRelationArray = relation => {
    if (!relation) return [];
    if (Array.isArray(relation)) return relation;
    if (Array.isArray(relation.data)) return relation.data;
    if (relation.data) return [relation.data];
    return [];
  };

  const downloadCSV = (items, filename) => {
    const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [
      CSV_HEADERS.join(';'),
      ...items.map(item => CSV_HEADERS.map(key => escape(item[key])).join(';'))
    ].join('\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
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
    'populate[attributes][fields][0]': 'price',
    'populate[attributes][fields][1]': 'barcode'
  });

  let page = 1;
  let pageCount = 1;
  let checked = 0;
  let apiTotal = 0;

  while (page <= pageCount) {
    params.set('pagination[page]', String(page));
    const response = await fetch(`${BASE_URL}?${params.toString()}`);
    if (!response.ok) throw new Error(`Ошибка ${response.status} на странице ${page}`);

    const json = await response.json();
    pageCount = json.meta.pagination.pageCount;
    apiTotal = json.meta.pagination.total;

    for (const item of json.data) {
      checked++;
      const attributes = getRelationArray(item.attributes);

      if (attributes.length === 0) continue;

      const hasValidPrice = attributes.some(attribute => {
        const price = Number(attribute?.price);
        return Number.isFinite(price) && price > 0;
      });

      if (hasValidPrice) continue;

      rows.push({
        id: item.id,
        documentId: item.documentId,
        name: item.name ?? '',
        key: item.key ?? '',
        attributeCount: attributes.length,
        barcodes: attributes.map(attribute => attribute?.barcode).filter(Boolean).join(', ')
      });
    }

    if (page === 1 || page % 25 === 0 || page === pageCount) {
      console.log(`Страница ${page}/${pageCount} | Проверено: ${checked}/${apiTotal} | Найдено: ${rows.length}`);
    }
    page++;
  }

  console.table(rows);
  console.log(`Готово: найдено активных товаров без цены > 0: ${rows.length}`);
  window.productsWithoutPrice = rows;
  downloadCSV(rows, `products_without_price_${timestamp()}.csv`);
})();
