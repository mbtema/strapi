// ==ConsoleParser==
// @name         volume-checker
// @version      1.1
// @description  Выявляет товары с неоднородными единицами измерения volume в торговых предложениях
// @output       CSV
// ==/ConsoleParser==

(async () => {
  const BASE_URL = '/api/products';
  const PAGE_SIZE = 100;

  function getUnit(name) {
    if (!name) return '';

    return String(name)
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/[0-9.,]+/g, '');
  }

  function downloadCSV(rows, filename) {
    const headers = ['documentId', 'volumes', 'units'];

    const escapeValue = value =>
      `"${String(value ?? '').replace(/"/g, '""')}"`;

    const csv = [
      headers.join(';'),
      ...rows.map(row =>
        headers
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
    'fields[0]': 'documentId',
    'filters[active][$eq]': 'true',
    'filters[attributes][volume][name][$notNull]': 'true',
    'populate[attributes][populate][volume][fields][0]': 'name'
  });

  let page = 1;
  let pageCount = 1;
  let apiTotal = 0;
  let totalScanned = 0;
  let productsWithMultipleVolumes = 0;

  const problematic = new Map();

  while (page <= pageCount) {
    params.set('pagination[page]', String(page));

    const response = await fetch(
      `${BASE_URL}?${params.toString()}`
    );

    if (!response.ok) {
      throw new Error(
        `Ошибка страницы ${page}: ${response.status}`
      );
    }

    const json = await response.json();

    pageCount = json.meta.pagination.pageCount;
    apiTotal = json.meta.pagination.total;

    for (const product of json.data) {
      totalScanned++;

      const volumeNames = [];

      for (const attribute of product.attributes ?? []) {
        const name = attribute?.volume?.name;

        if (
          name === null ||
          name === undefined ||
          String(name).trim() === ''
        ) {
          continue;
        }

        volumeNames.push(name);
      }

      if (volumeNames.length < 2) continue;

      productsWithMultipleVolumes++;

      const uniqueUnits = [
        ...new Set(volumeNames.map(getUnit))
      ];

      if (uniqueUnits.length > 1) {
        problematic.set(product.documentId, {
          documentId: product.documentId,
          volumes: volumeNames.join(' | '),
          units: uniqueUnits
            .map(unit => unit || '[БЕЗ ЕДИНИЦЫ]')
            .join(' | ')
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
        `Проверено: ${totalScanned}/${apiTotal}`
      );
    }

    page++;
  }

  const results = [...problematic.values()];

  console.table(results);
  console.log(
    `Готово: проверено ${totalScanned}, ` +
    `с 2+ volume ${productsWithMultipleVolumes}, ` +
    `проблемных ${results.length}`
  );

  window.volumeCheckResults = results;

  downloadCSV(
    results,
    'products_inconsistent_volume_units.csv'
  );
})();
