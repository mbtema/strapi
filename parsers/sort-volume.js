// ==ConsoleParser==
// @name         sort-volume
// @version      1.3
// @description  Выявляет товары с неправильной сортировкой volume с учетом единиц измерения
// @output       CSV
// ==/ConsoleParser==

(async () => {
  const BASE_URL = '/api/products';
  const PAGE_SIZE = 100;

  const badProducts = [];
  const unreadableVolumes = [];
  const mixedUnits = [];

  const UNIT_MAP = new Map([
    ['МЛ', { dimension: 'volume', factor: 1, baseUnit: 'мл' }],
    ['ML', { dimension: 'volume', factor: 1, baseUnit: 'мл' }],
    ['Л', { dimension: 'volume', factor: 1000, baseUnit: 'мл' }],
    ['L', { dimension: 'volume', factor: 1000, baseUnit: 'мл' }],
    ['МГ', { dimension: 'mass', factor: 1, baseUnit: 'мг' }],
    ['MG', { dimension: 'mass', factor: 1, baseUnit: 'мг' }],
    ['Г', { dimension: 'mass', factor: 1000, baseUnit: 'мг' }],
    ['ГР', { dimension: 'mass', factor: 1000, baseUnit: 'мг' }],
    ['G', { dimension: 'mass', factor: 1000, baseUnit: 'мг' }],
    ['GR', { dimension: 'mass', factor: 1000, baseUnit: 'мг' }],
    ['КГ', { dimension: 'mass', factor: 1000000, baseUnit: 'мг' }],
    ['KG', { dimension: 'mass', factor: 1000000, baseUnit: 'мг' }]
  ]);

  function parseVolume(value) {
    if (value == null) return null;

    const source = String(value).trim();
    const numberMatch = source
      .replace(',', '.')
      .match(/\d+(?:\.\d+)?/);

    if (!numberMatch) {
      return {
        readable: false,
        reason: 'number_not_found'
      };
    }

    const number = Number(numberMatch[0]);
    const unitKey = source
      .toUpperCase()
      .replace(/[^A-ZА-ЯЁ]+/g, '');

    if (!unitKey) {
      return {
        readable: true,
        number,
        dimension: 'unitless',
        normalized: number,
        baseUnit: ''
      };
    }

    const unit = UNIT_MAP.get(unitKey);

    if (!unit) {
      return {
        readable: false,
        reason: `unsupported_unit:${unitKey}`
      };
    }

    return {
      readable: true,
      number,
      dimension: unit.dimension,
      normalized: number * unit.factor,
      baseUnit: unit.baseUnit
    };
  }

  function getTimestamp() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');

    return [
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      `${pad(now.getHours())}${pad(now.getMinutes())}`
    ].join('_');
  }

  function downloadCSV(rows, filename) {
    const headers = [
      'type',
      'productDocumentId',
      'currentOrder',
      'expectedOrder',
      'attributeDocumentIds',
      'unreadableVolumes',
      'mixedUnits'
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
    'sort[0]': 'id:asc',
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
          parsed: parseVolume(volumeName)
        });
      }

      if (volumes.length < 2) continue;

      const unreadable = volumes.filter(
        item => !item.parsed?.readable
      );

      if (unreadable.length) {
        unreadableVolumes.push({
          productDocumentId: product.documentId,
          volumes: unreadable
            .map(item => {
              const reason = item.parsed?.reason || 'unknown';
              return `${item.volume} [${reason}]`;
            })
            .join(' | ')
        });
        continue;
      }

      const dimensions = new Set(
        volumes.map(item => item.parsed.dimension)
      );

      if (dimensions.size > 1) {
        mixedUnits.push({
          productDocumentId: product.documentId,
          volumes: volumes
            .map(item => item.volume)
            .join(' → '),
          dimensions: [...dimensions].join(' | ')
        });
        continue;
      }

      let isCorrect = true;

      for (let i = 1; i < volumes.length; i++) {
        if (
          volumes[i].parsed.normalized <
          volumes[i - 1].parsed.normalized
        ) {
          isCorrect = false;
          break;
        }
      }

      if (!isCorrect) {
        const expectedVolumes = [...volumes]
          .sort(
            (a, b) =>
              a.parsed.normalized - b.parsed.normalized
          );

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
        `Неверный порядок: ${badProducts.length} | ` +
        `Смешанные типы: ${mixedUnits.length}`
      );
    }

    page++;
  }

  console.table(badProducts);

  if (unreadableVolumes.length) {
    console.warn('Volume без читаемого значения/единицы:');
    console.table(unreadableVolumes);
  }

  if (mixedUnits.length) {
    console.warn('Volume разных физических типов в одном товаре:');
    console.table(mixedUnits);
  }

  const report = [
    ...badProducts.map(item => ({
      type: 'bad_order',
      ...item,
      unreadableVolumes: '',
      mixedUnits: ''
    })),
    ...unreadableVolumes.map(item => ({
      type: 'unreadable_volume',
      productDocumentId: item.productDocumentId,
      currentOrder: '',
      expectedOrder: '',
      attributeDocumentIds: '',
      unreadableVolumes: item.volumes,
      mixedUnits: ''
    })),
    ...mixedUnits.map(item => ({
      type: 'mixed_units',
      productDocumentId: item.productDocumentId,
      currentOrder: '',
      expectedOrder: '',
      attributeDocumentIds: '',
      unreadableVolumes: '',
      mixedUnits: `${item.volumes} [${item.dimensions}]`
    }))
  ];

  window.badVolumeOrder = badProducts;
  window.unreadableVolumes = unreadableVolumes;
  window.mixedVolumeUnits = mixedUnits;

  downloadCSV(
    report,
    `products_volume_sort_check_${getTimestamp()}.csv`
  );

  console.log(
    `Готово: проверено ${checkedProducts}, ` +
    `неверный порядок ${badProducts.length}, ` +
    `нечитаемых ${unreadableVolumes.length}, ` +
    `смешанных типов ${mixedUnits.length}`
  );
})();
