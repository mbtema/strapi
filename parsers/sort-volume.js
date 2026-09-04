(async () => {
  const BASE_URL = 'http://10.10.3.80:1337/api/products';
  const PAGE_SIZE = 100;

  const badProducts = [];
  const unreadableVolumes = [];

  // "100МЛ", "100 МЛ", "100", "4ГР", "2.5МЛ", "2,5 МЛ" → число
  function getNumber(value) {
    if (value == null) return null;

    const match = String(value)
      .replace(',', '.')
      .match(/\d+(?:\.\d+)?/);

    return match ? Number(match[0]) : null;
  }

  // Скачивание массива объектов как CSV
  function downloadCSV(data, filename) {
    if (!data.length) {
      console.log(`Файл ${filename} не создан — данных нет`);
      return;
    }

    const headers = Object.keys(data[0]);

    const escapeValue = value => {
      if (value == null) return '';

      return `"${String(value).replace(/"/g, '""')}"`;
    };

    const csv = [
      headers.join(';'),
      ...data.map(row =>
        headers
          .map(header => escapeValue(row[header]))
          .join(';')
      )
    ].join('\n');

    // BOM нужен, чтобы Excel корректно открыл кириллицу
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

    URL.revokeObjectURL(url);
  }

  let page = 1;
  let pageCount = 1;
  let checkedProducts = 0;

  while (page <= pageCount) {
    const url =
      `${BASE_URL}` +
      `?pagination[page]=${page}` +
      `&pagination[pageSize]=${PAGE_SIZE}` +
      `&fields[0]=documentId` +
      `&filters[active][$eq]=true` +
      `&filters[attributes][volume][name][$notNull]=true` +
      `&populate[attributes][fields][0]=documentId` +
      `&populate[attributes][populate][volume][fields][0]=name`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Ошибка ${response.status} на странице ${page}`
      );
    }

    const json = await response.json();

    pageCount = json.meta.pagination.pageCount;

    for (const product of json.data) {
      checkedProducts++;

      // Берём только attributes, где реально есть volume.name
      const volumes = (product.attributes || [])
        .filter(attribute => attribute.volume?.name != null)
        .map(attribute => ({
          attributeDocumentId: attribute.documentId,
          volume: attribute.volume.name,
          number: getNumber(attribute.volume.name)
        }));

      // Если объем только один — сортировку проверять бессмысленно
      if (volumes.length < 2) continue;

      // Значения, из которых не удалось достать число
      const unreadable = volumes.filter(v => v.number === null);

      if (unreadable.length) {
        unreadableVolumes.push({
          productDocumentId: product.documentId,
          volumes: unreadable
            .map(v => v.volume)
            .join(' | ')
        });

        continue;
      }

      const currentNumbers = volumes.map(v => v.number);

      const expectedNumbers = [...currentNumbers]
        .sort((a, b) => a - b);

      const isCorrect = currentNumbers.every(
        (value, index) => value === expectedNumbers[index]
      );

      if (!isCorrect) {
        const expectedVolumes = [...volumes]
          .sort((a, b) => a.number - b.number);

        badProducts.push({
          productDocumentId: product.documentId,

          currentOrder: volumes
            .map(v => v.volume)
            .join(' → '),

          expectedOrder: expectedVolumes
            .map(v => v.volume)
            .join(' → '),

          attributeDocumentIds: volumes
            .map(v => v.attributeDocumentId)
            .join(' | ')
        });
      }
    }

    console.log(
      `Страница ${page}/${pageCount} | ` +
      `Проверено товаров: ${checkedProducts} | ` +
      `Неверный порядок: ${badProducts.length}`
    );

    page++;
  }

  console.log('Проверка завершена');
  console.log(`Всего товаров проверено: ${checkedProducts}`);
  console.log(`С неверным порядком: ${badProducts.length}`);

  console.table(badProducts);

  if (unreadableVolumes.length) {
    console.warn(
      'Есть volume, из которых не удалось получить число:'
    );

    console.table(unreadableVolumes);
  }

  // Оставляем результаты доступными в Console
  window.badVolumeOrder = badProducts;
  window.unreadableVolumes = unreadableVolumes;

  // Автоматическое скачивание
  downloadCSV(
    badProducts,
    'products_bad_volume_order.csv'
  );

  if (unreadableVolumes.length) {
    downloadCSV(
      unreadableVolumes,
      'products_unreadable_volumes.csv'
    );
  }
})();
