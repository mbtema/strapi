// ==ConsoleParser==
// @name         sort-volume
// @version      1.3.1
// @description  Выявляет товары с неправильной сортировкой volume с учетом единиц измерения
// @output       CSV
// ==/ConsoleParser==

(async () => {
  const BASE_URL = '/api/products';
  const PAGE_SIZE = 100;
  const HEADERS = [
    'type', 'productDocumentId', 'currentOrder', 'expectedOrder',
    'attributeDocumentIds', 'unreadableVolumes', 'mixedUnits'
  ];

  const badProducts = [];
  const unreadableVolumes = [];
  const mixedUnits = [];

  const UNIT_MAP = new Map([
    ['МЛ', ['volume', 1, 'мл']], ['ML', ['volume', 1, 'мл']],
    ['Л', ['volume', 1000, 'мл']], ['L', ['volume', 1000, 'мл']],
    ['МГ', ['mass', 1, 'мг']], ['MG', ['mass', 1, 'мг']],
    ['Г', ['mass', 1000, 'мг']], ['ГР', ['mass', 1000, 'мг']],
    ['G', ['mass', 1000, 'мг']], ['GR', ['mass', 1000, 'мг']],
    ['КГ', ['mass', 1000000, 'мг']], ['KG', ['mass', 1000000, 'мг']]
  ]);

  const parseVolume = value => {
    if (value == null) return null;

    const source = String(value).trim();
    const match = source.replace(',', '.').match(/\d+(?:\.\d+)?/);
    if (!match) return { readable: false, reason: 'number_not_found' };

    const number = Number(match[0]);
    const unitKey = source.toUpperCase().replace(/[^A-ZА-ЯЁ]+/g, '');
    if (!unitKey) {
      return { readable: true, number, dimension: 'unitless', normalized: number, baseUnit: '' };
    }

    const unit = UNIT_MAP.get(unitKey);
    if (!unit) return { readable: false, reason: `unsupported_unit:${unitKey}` };

    const [dimension, factor, baseUnit] = unit;
    return { readable: true, number, dimension, normalized: number * factor, baseUnit };
  };

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
    'fields[0]': 'documentId',
    'filters[active][$eq]': 'true',
    'filters[attributes][volume][name][$notNull]': 'true',
    'populate[attributes][fields][0]': 'documentId',
    'populate[attributes][populate][volume][fields][0]': 'name'
  });

  let page = 1;
  let pageCount = 1;
  let total = 0;
  let checked = 0;

  while (page <= pageCount) {
    params.set('pagination[page]', String(page));
    const response = await fetch(`${BASE_URL}?${params}`);
    if (!response.ok) throw new Error(`Ошибка ${response.status} на странице ${page}`);

    const { data, meta } = await response.json();
    pageCount = meta.pagination.pageCount;
    total = meta.pagination.total;

    for (const product of data) {
      checked++;
      const volumes = (product.attributes ?? [])
        .filter(attribute => attribute.volume?.name != null)
        .map(attribute => ({
          attributeDocumentId: attribute.documentId,
          volume: attribute.volume.name,
          parsed: parseVolume(attribute.volume.name)
        }));

      if (volumes.length < 2) continue;

      const unreadable = volumes.filter(item => !item.parsed?.readable);
      if (unreadable.length) {
        unreadableVolumes.push({
          productDocumentId: product.documentId,
          volumes: unreadable
            .map(item => `${item.volume} [${item.parsed?.reason || 'unknown'}]`)
            .join(' | ')
        });
        continue;
      }

      const dimensions = new Set(volumes.map(item => item.parsed.dimension));
      if (dimensions.size > 1) {
        mixedUnits.push({
          productDocumentId: product.documentId,
          volumes: volumes.map(item => item.volume).join(' → '),
          dimensions: [...dimensions].join(' | ')
        });
        continue;
      }

      const isCorrect = volumes.every((item, index) =>
        index === 0 || item.parsed.normalized >= volumes[index - 1].parsed.normalized
      );
      if (isCorrect) continue;

      const expected = [...volumes].sort((a, b) => a.parsed.normalized - b.parsed.normalized);
      badProducts.push({
        productDocumentId: product.documentId,
        currentOrder: volumes.map(item => item.volume).join(' → '),
        expectedOrder: expected.map(item => item.volume).join(' → '),
        attributeDocumentIds: volumes.map(item => item.attributeDocumentId).join(' | ')
      });
    }

    if (page === 1 || page % 25 === 0 || page === pageCount) {
      console.log(
        `Страница ${page}/${pageCount} | Проверено: ${checked}/${total} | ` +
        `Неверный порядок: ${badProducts.length} | Смешанные типы: ${mixedUnits.length}`
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
      type: 'bad_order', ...item, unreadableVolumes: '', mixedUnits: ''
    })),
    ...unreadableVolumes.map(item => ({
      type: 'unreadable_volume',
      productDocumentId: item.productDocumentId,
      currentOrder: '', expectedOrder: '', attributeDocumentIds: '',
      unreadableVolumes: item.volumes, mixedUnits: ''
    })),
    ...mixedUnits.map(item => ({
      type: 'mixed_units',
      productDocumentId: item.productDocumentId,
      currentOrder: '', expectedOrder: '', attributeDocumentIds: '', unreadableVolumes: '',
      mixedUnits: `${item.volumes} [${item.dimensions}]`
    }))
  ];

  window.badVolumeOrder = badProducts;
  window.unreadableVolumes = unreadableVolumes;
  window.mixedVolumeUnits = mixedUnits;
  downloadCSV(report, `products_volume_sort_check_${timestamp()}.csv`);

  console.log(
    `Готово: проверено ${checked}, неверный порядок ${badProducts.length}, ` +
    `нечитаемых ${unreadableVolumes.length}, смешанных типов ${mixedUnits.length}`
  );
})();
