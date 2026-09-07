// ==ConsoleParser==
// @name         missing-shades
// @version      1.0
// @description  Ищет активные торговые предложения с color_variant1C, но без shade
// @output       CSV
// ==/ConsoleParser==

(async () => {
  const BASE_URL = '/api/attributes';
  const PAGE_SIZE = 100;
  const CSV_HEADERS = [
    'id',
    'documentId',
    'barcode',
    'productDocumentId',
    'colorVariantDocumentId'
  ];

  const missingShades = [];

  function getTimestamp() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');

    return [
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      `${pad(now.getHours())}${pad(now.getMinutes())}`
    ].join('_');
  }

  function getDocumentId(relation) {
    if (!relation) return '';

    if (Array.isArray(relation)) {
      return relation[0]?.documentId ?? '';
    }

    if (relation.data) {
      if (Array.isArray(relation.data)) {
        return relation.data[0]?.documentId ?? '';
      }

      return relation.data?.documentId ?? '';
    }

    return relation.documentId ?? '';
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
    'filters[product][active][$eq]': 'true',
    'filters[color_variant1C][$notNull]': 'true',
    'filters[shade][$null]': 'true',
    'fields[0]': 'documentId',
    'fields[1]': 'barcode',
    'populate[product][fields][0]': 'documentId',
    'populate[color_variant1C][fields][0]': 'documentId'
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

      missingShades.push({
        id: item.id,
        documentId: item.documentId,
        barcode: item.barcode ?? '',
        productDocumentId: getDocumentId(item.product),
        colorVariantDocumentId: getDocumentId(item.color_variant1C)
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

  console.table(missingShades);
  console.log(
    `Готово: найдено торговых предложений без shade: ${missingShades.length}`
  );

  window.missingShades = missingShades;

  downloadCSV(
    missingShades,
    `missing_shades_${getTimestamp()}.csv`
  );
})();
