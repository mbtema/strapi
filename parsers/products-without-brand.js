// ==ConsoleParser==
// @name         products-without-brand
// @version      1.0
// @description  Ищет активные товары без связанного brand
// @output       CSV
// ==/ConsoleParser==

(async () => {
  const BASE_URL = '/api/products';
  const PAGE_SIZE = 100;
  const CSV_HEADERS = ['id', 'documentId', 'name', 'key'];
  const rows = [];

  const timestamp = () => {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
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
    'filters[brand][$null]': 'true',
    'fields[0]': 'name',
    'fields[1]': 'key'
  });

  let page = 1;
  let pageCount = 1;
  let total = 0;

  while (page <= pageCount) {
    params.set('pagination[page]', String(page));
    const response = await fetch(`${BASE_URL}?${params.toString()}`);
    if (!response.ok) throw new Error(`Ошибка ${response.status} на странице ${page}`);

    const json = await response.json();
    pageCount = json.meta.pagination.pageCount;
    total = json.meta.pagination.total;

    for (const item of json.data) {
      rows.push({
        id: item.id,
        documentId: item.documentId,
        name: item.name ?? '',
        key: item.key ?? ''
      });
    }

    if (page === 1 || page % 25 === 0 || page === pageCount) {
      console.log(`Страница ${page}/${pageCount} | Найдено: ${rows.length}/${total}`);
    }
    page++;
  }

  console.table(rows);
  console.log(`Готово: найдено активных товаров без brand: ${rows.length}`);
  window.productsWithoutBrand = rows;
  downloadCSV(rows, `products_without_brand_${timestamp()}.csv`);
})();
