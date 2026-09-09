// ==ConsoleParser==
// @name         products-with-zero-price
// @version      1.0.1
// @description  Ищет активные товары с торговыми предложениями, но без цены > 0
// @output       CSV
// ==/ConsoleParser==

(async () => {
  const BASE_URL = '/api/products';
  const PAGE_SIZE = 100;
  const HEADERS = ['id', 'documentId', 'name', 'key', 'attributeCount', 'barcodes'];
  const rows = [];

  const timestamp = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  };

  const relationArray = relation => Array.isArray(relation)
    ? relation
    : Array.isArray(relation?.data)
      ? relation.data
      : relation?.data ? [relation.data] : [];

  const downloadCSV = (items, filename) => {
    const q = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [HEADERS.join(';'), ...items.map(row => HEADERS.map(key => q(row[key])).join(';'))].join('\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: filename });
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
  let total = 0;
  let checked = 0;

  while (page <= pageCount) {
    params.set('pagination[page]', String(page));
    const response = await fetch(`${BASE_URL}?${params}`);
    if (!response.ok) throw new Error(`Ошибка ${response.status} на странице ${page}`);

    const { data, meta } = await response.json();
    pageCount = meta.pagination.pageCount;
    total = meta.pagination.total;

    for (const item of data) {
      checked++;
      const attributes = relationArray(item.attributes);
      if (!attributes.length) continue;

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
      console.log(`Страница ${page}/${pageCount} | Проверено: ${checked}/${total} | Найдено: ${rows.length}`);
    }
    page++;
  }

  console.table(rows);
  console.log(`Готово: найдено активных товаров без цены > 0: ${rows.length}`);
  window.productsWithZeroPrice = rows;
  downloadCSV(rows, `products_with_zero_price_${timestamp()}.csv`);
})();
