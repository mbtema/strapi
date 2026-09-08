// ==ConsoleParser==
// @name         shade-and-volume
// @version      1.0
// @description  Ищет все торговые предложения, у которых одновременно заполнены shade и volume
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
    'shadeDocumentId',
    'shadeName',
    'volumeDocumentId',
    'volumeName'
  ];

  const matches = [];

  function getTimestamp() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');

    return [
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      `${pad(now.getHours())}${pad(now.getMinutes())}`
    ].join('_');
  }

  function getRelation(relation) {
    if (!relation) return null;

    if (Array.isArray(relation)) {
      return relation[0] ?? null;
    }

    if (relation.data) {
      if (Array.isArray(relation.data)) {
        return relation.data[0] ?? null;
      }

      return relation.data ?? null;
    }

    return relation;
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
    'filters[shade][$notNull]': 'true',
    'filters[volume][$notNull]': 'true',
    'fields[0]': 'documentId',
    'fields[1]': 'barcode',
    'populate[product][fields][0]': 'documentId',
    'populate[shade][fields][0]': 'documentId',
    'populate[shade][fields][1]': 'name',
    'populate[volume][fields][0]': 'documentId',
    'populate[volume][fields][1]': 'name'
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

      const product = getRelation(item.product);
      const shade = getRelation(item.shade);
      const volume = getRelation(item.volume);

      matches.push({
        id: item.id,
        documentId: item.documentId,
        barcode: item.barcode ?? '',
        productDocumentId: product?.documentId ?? '',
        shadeDocumentId: shade?.documentId ?? '',
        shadeName: shade?.name ?? '',
        volumeDocumentId: volume?.documentId ?? '',
        volumeName: volume?.name ?? ''
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

  console.table(matches);
  console.log(
    `Готово: найдено предложений одновременно с shade и volume: ${matches.length}`
  );

  window.attributesWithShadeAndVolume = matches;

  downloadCSV(
    matches,
    `attributes_with_shade_and_volume_${getTimestamp()}.csv`
  );
})();
