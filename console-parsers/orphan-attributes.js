// ==ConsoleParser==
// @name         orphan-attributes
// @version      1.0
// @description  Ищет торговые предложения без связанного product
// @output       CSV
// ==/ConsoleParser==

(async () => {
  const BASE_URL = '/api/attributes';
  const PAGE_SIZE = 100;
  const CSV_HEADERS = ['id', 'documentId', 'barcode', 'name', 'price'];
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
    'filters[product][$null]': 'true',
    'fields[0]': 'barcode',
    'fields[1]': 'name',
    'fields[2]': 'price'
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
        barcode: item.barcode ?? '',
        name: item.name ?? '',
        price: item.price ?? ''
      });
    }

    if (page === 1 || page % 25 === 0 || page === pageCount) {
      console.log(`Страница ${page}/${pageCount} | Найдено: ${rows.length}/${total}`);
    }
    page++;
  }

  console.table(rows);
  console.log(`Готово: найдено предложений без product: ${rows.length}`);
  window.orphanAttributes = rows;
  downloadCSV(rows, `orphan_attributes_${timestamp()}.csv`);
})();
