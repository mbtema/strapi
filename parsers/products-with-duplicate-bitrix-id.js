// ==ConsoleParser==
// @name         products-with-duplicate-bitrix-id
// @version      1.0.0
// @description  Ищет товары с одинаковым bitrix_id
// @output       CSV
// ==/ConsoleParser==

(async () => {
  const BASE_URL = '/api/products';
  const PAGE_SIZE = 100;
  const HEADERS = ['bitrix_id', 'duplicateCount', 'id', 'documentId', 'name'];
  const products = [];

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
    'fields[0]': 'bitrix_id',
    'fields[1]': 'name'
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

    products.push(...data.map(item => ({
      id: item.id,
      documentId: item.documentId,
      bitrix_id: item.bitrix_id,
      name: item.name ?? ''
    })));

    if (page === 1 || page % 25 === 0 || page === pageCount) {
      console.log(`Страница ${page}/${pageCount} | Проверено: ${products.length}/${total}`);
    }

    page++;
  }

  const groups = new Map();

  for (const product of products) {
    if (product.bitrix_id == null || String(product.bitrix_id).trim() === '') continue;

    const key = String(product.bitrix_id).trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(product);
  }

  const duplicateGroups = [...groups.entries()]
    .filter(([, items]) => new Set(items.map(item => item.documentId)).size > 1)
    .sort(([a], [b]) => {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.localeCompare(b, 'ru', { numeric: true });
    });

  const rows = duplicateGroups.flatMap(([bitrixId, items]) => {
    const uniqueItems = [...new Map(items.map(item => [item.documentId, item])).values()];
    return uniqueItems.map(item => ({
      bitrix_id: bitrixId,
      duplicateCount: uniqueItems.length,
      id: item.id,
      documentId: item.documentId,
      name: item.name
    }));
  });

  console.table(rows);
  console.log(`Готово: проверено товаров: ${products.length}`);
  console.log(`Дублирующихся bitrix_id: ${duplicateGroups.length}`);
  console.log(`Товаров в группах дублей: ${rows.length}`);

  window.productsWithDuplicateBitrixId = rows;
  downloadCSV(rows, `products_with_duplicate_bitrix_id_${timestamp()}.csv`);
})();
