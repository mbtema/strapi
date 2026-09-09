// ==ConsoleParser==
// @name         zero-prices
// @version      1.1.1
// @description  Ищет торговые предложения с price = 0, привязанные к активным товарам
// @output       CSV
// ==/ConsoleParser==

(async () => {
  const BASE_URL = '/api/attributes';
  const PAGE_SIZE = 100;
  const HEADERS = ['id', 'documentId', 'barcode', 'name', 'price'];
  const zeroPrices = [];

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
    'filters[price][$eq]': '0',
    'filters[product][active][$eq]': 'true',
    'fields[0]': 'barcode',
    'fields[1]': 'name',
    'fields[2]': 'price'
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

    zeroPrices.push(...data.map(item => ({
      id: item.id,
      documentId: item.documentId,
      barcode: item.barcode ?? '',
      name: item.name ?? '',
      price: item.price
    })));

    if (page === 1 || page % 25 === 0 || page === pageCount) {
      console.log(`Страница ${page}/${pageCount} | Найдено: ${zeroPrices.length}/${total}`);
    }
    page++;
  }

  console.table(zeroPrices);
  console.log(`Готово: найдено активных торговых предложений с price = 0: ${zeroPrices.length}`);
  window.zeroPrices = zeroPrices;
  downloadCSV(zeroPrices, `zero_prices_${timestamp()}.csv`);
})();
