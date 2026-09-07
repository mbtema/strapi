// ==ConsoleParser==
// @name         zero-prices
// @version      1.0
// @description  Ищет торговые предложения со значением price = 0
// @output       CSV
// ==/ConsoleParser==

(async () => {
  const BASE_URL = '/api/attributes';
  const PAGE_SIZE = 100;
  const CSV_HEADERS = [
    'id',
    'documentId',
    'barcode',
    'name',
    'price'
  ];

  const zeroPrices = [];

  function getTimestamp() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');

    return [
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      `${pad(now.getHours())}${pad(now.getMinutes())}`
    ].join('_');
  }

  function downloadCSV(rows, filename) {
    const escapeValue = value =>
      `"${String(value ?? '').replace(/"/g, '""')}"`;

    const csv = [
      CSV_HEADERS.join(';'),
      ...rows.map(row =>
        CSV_HEADERS
          .map(header => escapeValue(row[header]))
          .join(';')
      )
    ].join('\n');

    const blob = new Blob(
      ['\uFEFF' + csv],
      { type: 'text/csv;charset=utf-8;' }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const params = new URLSearchParams({
    'pagination[pageSize]': String(PAGE_SIZE),
    'sort[0]': 'id:asc',
    'filters[price][$eq]': '0',
    'fields[0]': 'barcode',
    'fields[1]': 'name',
    'fields[2]': 'price'
  });

  let page = 1;
  let pageCount = 1;
  let apiTotal = 0;
  let checked = 0;

  while (page <= pageCount) {
    params.set('pagination[page]', String(page));

    const response = await fetch(
      `${BASE_URL}?${params.toString()}`
    );

    if (!response.ok) {
      throw new Error(
        `Ошибка ${response.status} на странице ${page}`
      );
    }

    const json = await response.json();

    pageCount = json.meta.pagination.pageCount;
    apiTotal = json.meta.pagination.total;

    for (const item of json.data) {
      checked++;

      zeroPrices.push({
        id: item.id,
        documentId: item.documentId,
        barcode: item.barcode ?? '',
        name: item.name ?? '',
        price: item.price
      });
    }

    if (
      page === 1 ||
      page % 25 === 0 ||
      page === pageCount
    ) {
      console.log(
        `Страница ${page}/${pageCount} | ` +
        `Найдено: ${checked}/${apiTotal}`
      );
    }

    page++;
  }

  console.table(zeroPrices);
  console.log(
    `Готово: найдено торговых предложений с price = 0: ${zeroPrices.length}`
  );

  window.zeroPrices = zeroPrices;

  downloadCSV(
    zeroPrices,
    `zero_prices_${getTimestamp()}.csv`
  );
})();
