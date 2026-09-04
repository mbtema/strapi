(async () => {
  const baseUrl = '/api/products';

  const params = new URLSearchParams({
    'pagination[pageSize]': '100',
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

  const problematic = [];

  function getUnit(name) {
    if (!name) return '';

    return String(name)
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/[0-9.,]+/g, '');
  }

  do {
    params.set('pagination[page]', page);

    const response = await fetch(
      `${baseUrl}?${params.toString()}`
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

      const volumeNames = (product.attributes ?? [])
        .map(attribute => attribute?.volume?.name)
        .filter(name =>
          name !== null &&
          name !== undefined &&
          String(name).trim() !== ''
        );

      if (volumeNames.length < 2) {
        continue;
      }

      productsWithMultipleVolumes++;

      const units = volumeNames.map(getUnit);
      const uniqueUnits = [...new Set(units)];

      if (uniqueUnits.length > 1) {
        problematic.push({
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
        `Страница ${page}/${pageCount} | Проверено: ${totalScanned}/${apiTotal}`
      );
    }

    page++;

  } while (page <= pageCount);

  const unique = [
    ...new Map(
      problematic.map(item => [
        item.documentId,
        item
      ])
    ).values()
  ];

  console.table(unique);

  console.log('----------------------------');
  console.log(`API total: ${apiTotal}`);
  console.log(`Фактически проверено: ${totalScanned}`);
  console.log(`С 2+ volume: ${productsWithMultipleVolumes}`);
  console.log(`Проблемных товаров: ${unique.length}`);

  if (totalScanned === apiTotal) {
    console.log('✅ Проверены все товары');
  } else {
    console.log('❌ Проверены НЕ все товары');
  }

  console.log('----------------------------');

  const csv = [
    'documentId',
    ...unique.map(item => item.documentId)
  ].join('\n');

  window.volumeCheckResults = unique;
  window.volumeCheckCSV = csv;

  const oldButton =
    document.getElementById('volume-csv-download');

  if (oldButton) oldButton.remove();

  const button = document.createElement('button');

  button.id = 'volume-csv-download';
  button.textContent =
    `Скачать CSV (${unique.length})`;

  Object.assign(button.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    zIndex: '999999',
    padding: '14px 20px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    borderRadius: '8px'
  });

  button.onclick = () => {
    const blob = new Blob(
      ['\uFEFF' + csv],
      {
        type: 'text/csv;charset=utf-8'
      }
    );

    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');

    a.href = url;
    a.download =
      'products_with_inconsistent_volume.csv';

    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(
      () => URL.revokeObjectURL(url),
      5000
    );
  };

  document.body.appendChild(button);

  console.log(
    '✅ Готово. Кнопка скачивания появилась справа сверху.'
  );
})();
