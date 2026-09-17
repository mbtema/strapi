(async () => {
  const BASE_URL = '/api/products';
  const PAGE_SIZE = 100;
  const UNIQUE_FIELDS = ['key', 'code_1c', 'bitrix_id', 'xml_id', 'code'];
  const HEADERS = [
    'duplicateField',
    'duplicateValue',
    'duplicateCount',
    'id',
    'documentId',
    'name',
    ...UNIQUE_FIELDS
  ];
  const products = [];

  const timestamp = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  };

  const normalize = value => {
    if (value == null) return '';
    return String(value).trim();
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
    'fields[0]': 'name',
    'fields[1]': 'key',
    'fields[2]': 'code_1c',
    'fields[3]': 'bitrix_id',
    'fields[4]': 'xml_id',
    'fields[5]': 'code'
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
      name: item.name ?? '',
      key: item.key,
      code_1c: item.code_1c,
      bitrix_id: item.bitrix_id,
      xml_id: item.xml_id,
      code: item.code
    })));

    if (page === 1 || page % 25 === 0 || page === pageCount) {
      console.log(`Страница ${page}/${pageCount} | Проверено: ${products.length}/${total}`);
    }

    page++;
  }

  const rows = [];
  const fieldStats = {};

  for (const field of UNIQUE_FIELDS) {
    const groups = new Map();

    for (const product of products) {
      const value = normalize(product[field]);
      if (!value) continue;

      if (!groups.has(value)) groups.set(value, new Map());
      groups.get(value).set(product.documentId, product);
    }

    const duplicateGroups = [...groups.entries()]
      .map(([value, itemsByDocumentId]) => [value, [...itemsByDocumentId.values()]])
      .filter(([, items]) => items.length > 1)
      .sort(([a], [b]) => a.localeCompare(b, 'ru', { numeric: true }));

    fieldStats[field] = duplicateGroups.length;

    for (const [value, items] of duplicateGroups) {
      for (const item of items) {
        rows.push({
          duplicateField: field,
          duplicateValue: value,
          duplicateCount: items.length,
          id: item.id,
          documentId: item.documentId,
          name: item.name,
          key: item.key ?? '',
          code_1c: item.code_1c ?? '',
          bitrix_id: item.bitrix_id ?? '',
          xml_id: item.xml_id ?? '',
          code: item.code ?? ''
        });
      }
    }
  }

  rows.sort((a, b) => {
    const fieldCompare = UNIQUE_FIELDS.indexOf(a.duplicateField) - UNIQUE_FIELDS.indexOf(b.duplicateField);
    if (fieldCompare !== 0) return fieldCompare;
    const valueCompare = String(a.duplicateValue).localeCompare(String(b.duplicateValue), 'ru', { numeric: true });
    if (valueCompare !== 0) return valueCompare;
    return Number(a.id) - Number(b.id);
  });

  console.table(rows);
  console.log(`Готово: проверено товаров: ${products.length}`);
  for (const field of UNIQUE_FIELDS) {
    console.log(`${field}: групп дублей ${fieldStats[field]}`);
  }
  console.log(`Строк в итоговом CSV: ${rows.length}`);

  window.productsWithDuplicateFields = rows;
  downloadCSV(rows, `products_with_duplicate_fields_${timestamp()}.csv`);
})();
