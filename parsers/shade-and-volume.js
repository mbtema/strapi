// ==ConsoleParser==
// @name         shade-and-volume
// @version      1.0.1
// @description  Ищет все торговые предложения, у которых одновременно заполнены shade и volume
// @output       CSV
// ==/ConsoleParser==

(async () => {
  const BASE_URL = '/api/attributes';
  const PAGE_SIZE = 100;
  const HEADERS = [
    'id', 'documentId', 'barcode', 'productDocumentId',
    'shadeDocumentId', 'shadeName', 'volumeDocumentId', 'volumeName'
  ];
  const matches = [];

  const timestamp = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  };

  const getRelation = relation => Array.isArray(relation)
    ? relation[0] ?? null
    : Array.isArray(relation?.data)
      ? relation.data[0] ?? null
      : relation?.data ?? relation ?? null;

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
  let total = 0;

  while (page <= pageCount) {
    params.set('pagination[page]', String(page));
    const response = await fetch(`${BASE_URL}?${params}`);
    if (!response.ok) throw new Error(`Ошибка ${response.status} на странице ${page}`);

    const { data, meta } = await response.json();
    pageCount = meta.pagination.pageCount;
    total = meta.pagination.total;

    for (const item of data) {
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

    if (page === 1 || page % 25 === 0 || page === pageCount) {
      console.log(`Страница ${page}/${pageCount} | Найдено: ${matches.length}/${total}`);
    }
    page++;
  }

  console.table(matches);
  console.log(`Готово: найдено предложений одновременно с shade и volume: ${matches.length}`);
  window.attributesWithShadeAndVolume = matches;
  downloadCSV(matches, `attributes_with_shade_and_volume_${timestamp()}.csv`);
})();
