// ==ConsoleParser==
// @name         missing-shades
// @version      1.0.1
// @description  Ищет активные торговые предложения с color_variant1C, но без shade
// @output       CSV
// ==/ConsoleParser==

(async () => {
  const BASE_URL = '/api/attributes';
  const PAGE_SIZE = 100;
  const HEADERS = ['id', 'documentId', 'barcode', 'productDocumentId', 'colorVariantDocumentId'];
  const missingShades = [];

  const timestamp = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  };

  const getDocumentId = relation => {
    const value = Array.isArray(relation)
      ? relation[0]
      : Array.isArray(relation?.data)
        ? relation.data[0]
        : relation?.data ?? relation;
    return value?.documentId ?? '';
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
  let total = 0;

  while (page <= pageCount) {
    params.set('pagination[page]', String(page));
    const response = await fetch(`${BASE_URL}?${params}`);
    if (!response.ok) throw new Error(`Ошибка ${response.status} на странице ${page}`);

    const { data, meta } = await response.json();
    pageCount = meta.pagination.pageCount;
    total = meta.pagination.total;

    missingShades.push(...data.map(item => ({
      id: item.id,
      documentId: item.documentId,
      barcode: item.barcode ?? '',
      productDocumentId: getDocumentId(item.product),
      colorVariantDocumentId: getDocumentId(item.color_variant1C)
    })));

    if (page === 1 || page % 25 === 0 || page === pageCount) {
      console.log(`Страница ${page}/${pageCount} | Найдено: ${missingShades.length}/${total}`);
    }
    page++;
  }

  console.table(missingShades);
  console.log(`Готово: найдено торговых предложений без shade: ${missingShades.length}`);
  window.missingShades = missingShades;
  downloadCSV(missingShades, `missing_shades_${timestamp()}.csv`);
})();
