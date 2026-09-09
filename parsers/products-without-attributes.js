// ==ConsoleParser==
// @name         products-without-attributes
// @version      1.0.1
// @description  Ищет активные товары без торговых предложений
// @output       CSV
// ==/ConsoleParser==

(async () => {
  const BASE_URL = '/api/products';
  const PAGE_SIZE = 100;
  const HEADERS = ['id', 'documentId', 'name', 'key'];
  const rows = [];

  const timestamp = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
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
    'filters[active][$eq]': 'true',
    'filters[attributes][$null]': 'true',
    'fields[0]': 'name',
    'fields[1]': 'key'
  });

  let page = 1;
  let pageCount = 1;
  let total = 0;

  while (page <= pageCount) {
    params.set('pagination[page]', String(page));
    const response = await fetch(`${BASE_URL}?${params}`);
    if (!response.ok) throw new Error(`Ошибка ${response.status} на странице ${page}`);

    const { data, meta } = await response.json();
    pageCount = meta.pagination.pageCount;
    total = meta.pagination.total;

    rows.push(...data.map(item => ({
      id: item.id,
      documentId: item.documentId,
      name: item.name ?? '',
      key: item.key ?? ''
    })));

    if (page === 1 || page % 25 === 0 || page === pageCount) {
      console.log(`Страница ${page}/${pageCount} | Найдено: ${rows.length}/${total}`);
    }
    page++;
  }

  console.table(rows);
  console.log(`Готово: найдено активных товаров без attributes: ${rows.length}`);
  window.productsWithoutAttributes = rows;
  downloadCSV(rows, `products_without_attributes_${timestamp()}.csv`);
})();
