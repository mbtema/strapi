// ==ConsoleParser==
// @name         sort-volume
// @version      1.1
// @description  Выявляет товары с неправильной сортировкой volume в торговых предложениях
// @output       CSV
// ==/ConsoleParser==

(async () => {
  const BASE_URL = '/api/products';
  const PAGE_SIZE = 100;

  const badProducts = [];
  const unreadableVolumes = [];

  function getNumber(value) {
    if (value == null) return null;

    const match = String(value)
      .replace(',', '.')
      .match(/\d+(?:\.\d+)?/);

    return match ? Number(match[0]) : null;
  }

  function downloadCSV(rows, filename) {
    const headers = [
      'type',
      'productDocumentId',
      'currentOrder',
      'expectedOrder',
      'attributeDocumentIds',
      'unreadableVolumes'
    ];

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
    'populate[attributes][fields][0]': 'documentId',
    'populate[attributes][populate][volume][fields][0]': 'name'
  });

  let page = 1;
  let pageCount = 1;
  let apiTotal = 0;
  let checkedProducts = 0;

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

    for (const product of json.data) {
      checkedProducts++;

      const volumes = [];

      for (const attribute of product.attributes ?? []) {
        const volumeName = attribute.volume?.name;

        if (volumeName == null) continue;

        volumes.push({
          attributeDocumentId: attribute.documentId,
          volume: volumeName,
          number: getNumber(volumeName)
        });
      }

      if (volumes.length < 2) continue;

      const unreadable = volumes.filter(
        item => item.number === null
      );

      if (unreadable.length) {
        unreadableVolumes.push({
          productDocumentId: product.documentId,
          volumes: unreadable
            .map(item => item.volume)
            .join(' | ')
        });
        continue;
      }

      let isCorrect = true;

      for (let i = 1; i < volumes.length; i++) {
        if (volumes[i].number < volumes[i - 1].number) {
          isCorrect = false;
          break;
        }
      }

      if (!isCorrect) {
        const expectedVolumes = [...volumes]
          .sort((a, b) => a.number - b.number);

        badProducts.push({
          productDocumentId: product.documentId,
          currentOrder: volumes
            .map(item => item.volume)
            .join(' → '),
          expectedOrder: expectedVolumes
            .map(item => item.volume)
            .join(' → '),
          attributeDocumentIds: volumes
            .map(item => item.attributeDocumentId)
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
        `Проверено: ${checkedProducts}/${apiTotal} | ` +
        `Неверный порядок: ${badProducts.length}`
      );
    }

    page++;
  }

  console.table(badProducts);

  if (unreadableVolumes.length) {
    console.warn('Volume без читаемого числового значения:');
    console.table(unreadableVolumes);
  }

  const report = [
    ...badProducts.map(item => ({
      type: 'bad_order',
      ...item,
      unreadableVolumes: ''
    })),
    ...unreadableVolumes.map(item => ({
      type: 'unreadable_volume',
      productDocumentId: item.productDocumentId,
      currentOrder: '',
      expectedOrder: '',
      attributeDocumentIds: '',
      unreadableVolumes: item.volumes
    }))
  ];

  window.badVolumeOrder = badProducts;
  window.unreadableVolumes = unreadableVolumes;

  downloadCSV(
    report,
    'products_volume_sort_check.csv'
  );

  console.log(
    `Готово: проверено ${checkedProducts}, ` +
    `неверный порядок ${badProducts.length}, ` +
    `нечитаемых ${unreadableVolumes.length}`
  );
})();
