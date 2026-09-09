// ==ConsoleParser==
// @name         products-with-wrong-prices
// @version      1.1.1
// @description  Ищет активные товары с предложениями, где price = 0, отсутствует или является дробным
// @output       CSV
// ==/ConsoleParser==

(async () => {
  const BASE_URL = '/api/attributes';
  const PAGE_SIZE = 100;
  const HEADERS = [
    'id', 'documentId', 'name', 'key', 'attributeCount', 'barcodes',
    'invalidAttributeCount', 'zeroPriceCount', 'missingPriceCount', 'fractionalPriceCount',
    'zeroPriceBarcodes', 'missingPriceBarcodes', 'fractionalPriceBarcodes',
    'invalidAttributeDocumentIds'
  ];
  const products = new Map();
  const badProductIds = new Set();

  const timestamp = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  };

  const relationOne = relation => Array.isArray(relation)
    ? relation[0] ?? null
    : Array.isArray(relation?.data)
      ? relation.data[0] ?? null
      : relation?.data ?? relation ?? null;

  const priceIssue = value => {
    if (value == null || String(value).trim() === '') return 'missing';
    const price = Number(value);
    if (!Number.isFinite(price)) return 'missing';
    if (price === 0) return 'zero';
    if (!Number.isInteger(price)) return 'fractional';
    return null;
  };

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
    'filters[product][active][$eq]': 'true',
    'fields[0]': 'price',
    'fields[1]': 'barcode',
    'populate[product][fields][0]': 'documentId',
    'populate[product][fields][1]': 'name',
    'populate[product][fields][2]': 'key'
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

    for (const attribute of data) {
      checked++;
      const product = relationOne(attribute.product);
      if (!product?.documentId) continue;

      let row = products.get(product.documentId);
      if (!row) {
        row = {
          id: product.id ?? '',
          documentId: product.documentId,
          name: product.name ?? '',
          key: product.key ?? '',
          attributeCount: 0,
          barcodes: [],
          invalidAttributeCount: 0,
          zeroPriceCount: 0,
          missingPriceCount: 0,
          fractionalPriceCount: 0,
          zeroPriceBarcodes: [],
          missingPriceBarcodes: [],
          fractionalPriceBarcodes: [],
          invalidAttributeDocumentIds: []
        };
        products.set(product.documentId, row);
      }

      row.attributeCount++;
      if (attribute.barcode) row.barcodes.push(attribute.barcode);

      const issue = priceIssue(attribute.price);
      if (!issue) continue;

      badProductIds.add(product.documentId);
      row.invalidAttributeCount++;
      row.invalidAttributeDocumentIds.push(attribute.documentId);

      const barcode = attribute.barcode || `[${attribute.documentId}]`;
      if (issue === 'zero') {
        row.zeroPriceCount++;
        row.zeroPriceBarcodes.push(barcode);
      } else if (issue === 'missing') {
        row.missingPriceCount++;
        row.missingPriceBarcodes.push(barcode);
      } else {
        row.fractionalPriceCount++;
        row.fractionalPriceBarcodes.push(`${barcode}: ${attribute.price}`);
      }
    }

    if (page === 1 || page % 25 === 0 || page === pageCount) {
      console.log(`Страница ${page}/${pageCount} | Проверено предложений: ${checked}/${total} | Проблемных товаров: ${badProductIds.size}`);
    }
    page++;
  }

  const rows = [...badProductIds]
    .map(documentId => products.get(documentId))
    .map(row => ({
      ...row,
      barcodes: row.barcodes.join(', '),
      zeroPriceBarcodes: row.zeroPriceBarcodes.join(', '),
      missingPriceBarcodes: row.missingPriceBarcodes.join(', '),
      fractionalPriceBarcodes: row.fractionalPriceBarcodes.join(', '),
      invalidAttributeDocumentIds: row.invalidAttributeDocumentIds.join(', ')
    }));

  console.table(rows);
  console.log(
    `Готово: найдено ${rows.length} активных товаров с критичной ценой ` +
    `(0 / отсутствует / дробная)`
  );

  window.productsWithZeroPrice = rows;
  window.productsWithInvalidPrice = rows;
  downloadCSV(rows, `products_invalid_prices_${timestamp()}.csv`);
})();
