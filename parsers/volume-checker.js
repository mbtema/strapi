// ==ConsoleParser==
// @name         volume-checker
// @version      1.2.1
// @description  Выявляет товары с неоднородными единицами измерения volume в торговых предложениях
// @output       CSV
// ==/ConsoleParser==

(async () => {
  const BASE_URL = '/api/products';
  const PAGE_SIZE = 100;
  const HEADERS = ['documentId', 'volumes', 'units'];
  const problematic = new Map();

  const getUnit = name => name
    ? String(name).trim().toUpperCase().replace(/\s+/g, '').replace(/[0-9.,]+/g, '')
    : '';

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
    'populate[attributes][populate][volume][fields][0]': 'name'
  });

  let page = 1;
  let pageCount = 1;
  let total = 0;
  let scanned = 0;
  let multiVolume = 0;

  while (page <= pageCount) {
    params.set('pagination[page]', String(page));
    const response = await fetch(`${BASE_URL}?${params}`);
    if (!response.ok) throw new Error(`Ошибка страницы ${page}: ${response.status}`);

    const { data, meta } = await response.json();
    pageCount = meta.pagination.pageCount;
    total = meta.pagination.total;

    for (const product of data) {
      scanned++;
      const volumeNames = (product.attributes ?? [])
        .map(attribute => attribute?.volume?.name)
        .filter(name => name != null && String(name).trim() !== '');

      if (volumeNames.length < 2) continue;
      multiVolume++;

      const units = [...new Set(volumeNames.map(getUnit))];
      if (units.length < 2) continue;

      problematic.set(product.documentId, {
        documentId: product.documentId,
        volumes: volumeNames.join(' | '),
        units: units.map(unit => unit || '[БЕЗ ЕДИНИЦЫ]').join(' | ')
      });
    }

    if (page === 1 || page % 25 === 0 || page === pageCount) {
      console.log(`Страница ${page}/${pageCount} | Проверено: ${scanned}/${total}`);
    }
    page++;
  }

  const results = [...problematic.values()];
  console.table(results);
  console.log(`Готово: проверено ${scanned}, с 2+ volume ${multiVolume}, проблемных ${results.length}`);
  window.volumeCheckResults = results;
  downloadCSV(results, `products_inconsistent_volume_units_${timestamp()}.csv`);
})();
