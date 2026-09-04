// ==ConsoleParser==
// @name         price-checker
// @version      1.1
// @description  Проверяет цены торговых предложений и находит дробные значения price
// @output       CSV
// ==/ConsoleParser==

(async () => {
  const BASE_URL = '/api/attributes';
  const PAGE_SIZE = 100;
  const CSV_HEADERS = ['id', 'documentId', 'price'];

  const invalidPrices = [];

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
    'fields[0]': 'price'
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

      if (item.price == null) continue;

      const price = Number(item.price);

      if (!Number.isInteger(price)) {
        invalidPrices.push({
          id: item.id,
          documentId: item.documentId,
          price: item.price
        });
      }
    }

    if (
      page === 1 ||
      page % 25 === 0 ||
      page === pageCount
    ) {
      console.log(
        `Страница ${page}/${pageCount} | ` +
        `Проверено: ${checked}/${apiTotal} | ` +
        `Дробных: ${invalidPrices.length}`
      );
    }

    page++;
  }

  console.table(invalidPrices);
  console.log(
    `Готово: проверено ${checked}, найдено ${invalidPrices.length}`
  );

  window.invalidPrices = invalidPrices;

  downloadCSV(
    invalidPrices,
    'attributes_fractional_prices.csv'
  );
})();
