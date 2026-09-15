// ==ConsoleParser==
// @name         attributes-with-barcode-issues
// @version      1.0.0
// @description  Тестовый аудит опубликованных предложений без barcode и с дублирующимися barcode
// @output       CSV
// ==/ConsoleParser==

(async () => {
  'use strict';

  const BASE_URL = '/api/attributes';
  const PAGE_SIZE = 100;
  const HEADERS = [
    'issue',
    'barcode',
    'duplicateCount',
    'attributeId',
    'attributeDocumentId',
    'attributeName',
    'productDocumentId',
    'productName',
    'productKey',
    'productActive'
  ];

  const attributes = [];

  const timestamp = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  };

  const normalizeBarcode = value => value == null ? '' : String(value).trim();

  const relationOne = relation => Array.isArray(relation)
    ? relation[0] ?? null
    : Array.isArray(relation?.data)
      ? relation.data[0] ?? null
      : relation?.data ?? relation ?? null;

  const downloadCSV = (items, filename) => {
    const q = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [
      HEADERS.join(';'),
      ...items.map(row => HEADERS.map(key => q(row[key])).join(';'))
    ].join('\n');

    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    );
    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: filename
    });

    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const params = new URLSearchParams({
    'pagination[pageSize]': String(PAGE_SIZE),
    'sort[0]': 'id:asc',
    'fields[0]': 'barcode',
    'fields[1]': 'name_web',
    'populate[product][fields][0]': 'documentId',
    'populate[product][fields][1]': 'name',
    'populate[product][fields][2]': 'key',
    'populate[product][fields][3]': 'active'
  });

  let page = 1;
  let pageCount = 1;
  let total = 0;

  while (page <= pageCount) {
    params.set('pagination[page]', String(page));

    const response = await fetch(`${BASE_URL}?${params}`);
    if (!response.ok) {
      throw new Error(`Ошибка ${response.status} на странице ${page}`);
    }

    const { data, meta } = await response.json();
    pageCount = meta.pagination.pageCount;
    total = meta.pagination.total;

    for (const item of data) {
      const product = relationOne(item.product);
      attributes.push({
        id: item.id,
        documentId: item.documentId ?? '',
        barcode: item.barcode ?? '',
        normalizedBarcode: normalizeBarcode(item.barcode),
        name: item.name_web ?? '',
        productDocumentId: product?.documentId ?? '',
        productName: product?.name ?? '',
        productKey: product?.key ?? '',
        productActive: typeof product?.active === 'boolean' ? product.active : ''
      });
    }

    if (page === 1 || page % 25 === 0 || page === pageCount) {
      console.log(`Страница ${page}/${pageCount} | Проверено offers: ${attributes.length}/${total}`);
    }

    page++;
  }

  const duplicateGroups = new Map();

  for (const attribute of attributes) {
    if (!attribute.normalizedBarcode) continue;

    if (!duplicateGroups.has(attribute.normalizedBarcode)) {
      duplicateGroups.set(attribute.normalizedBarcode, new Map());
    }

    duplicateGroups
      .get(attribute.normalizedBarcode)
      .set(attribute.documentId || `id:${attribute.id}`, attribute);
  }

  for (const [barcode, itemsByDocumentId] of [...duplicateGroups]) {
    if (itemsByDocumentId.size < 2) duplicateGroups.delete(barcode);
  }

  const rows = [];

  for (const attribute of attributes) {
    if (attribute.normalizedBarcode) continue;

    rows.push({
      issue: 'missing_barcode',
      barcode: attribute.barcode,
      duplicateCount: 0,
      attributeId: attribute.id,
      attributeDocumentId: attribute.documentId,
      attributeName: attribute.name,
      productDocumentId: attribute.productDocumentId,
      productName: attribute.productName,
      productKey: attribute.productKey,
      productActive: attribute.productActive
    });
  }

  for (const [barcode, itemsByDocumentId] of duplicateGroups) {
    const items = [...itemsByDocumentId.values()];

    for (const attribute of items) {
      rows.push({
        issue: 'duplicate_barcode',
        barcode,
        duplicateCount: items.length,
        attributeId: attribute.id,
        attributeDocumentId: attribute.documentId,
        attributeName: attribute.name,
        productDocumentId: attribute.productDocumentId,
        productName: attribute.productName,
        productKey: attribute.productKey,
        productActive: attribute.productActive
      });
    }
  }

  rows.sort((a, b) => {
    const issueCompare = a.issue.localeCompare(b.issue);
    if (issueCompare !== 0) return issueCompare;

    const barcodeCompare = String(a.barcode).localeCompare(String(b.barcode), 'ru', {
      numeric: true
    });
    if (barcodeCompare !== 0) return barcodeCompare;

    return Number(a.attributeId) - Number(b.attributeId);
  });

  const missingCount = rows.filter(row => row.issue === 'missing_barcode').length;
  const duplicateOfferCount = rows.filter(row => row.issue === 'duplicate_barcode').length;
  const activeProblemCount = rows.filter(row => row.productActive === true).length;
  const inactiveProblemCount = rows.filter(row => row.productActive === false).length;
  const withoutProductCount = rows.filter(row => !row.productDocumentId).length;

  console.table(rows);
  console.log(`Готово: проверено offers: ${attributes.length}`);
  console.log(`Без barcode: ${missingCount}`);
  console.log(`Offers с повторяющимся barcode: ${duplicateOfferCount}`);
  console.log(`Групп дублирующихся barcode: ${duplicateGroups.size}`);
  console.log(`Из проблемных у active товаров: ${activeProblemCount}`);
  console.log(`Из проблемных у inactive товаров: ${inactiveProblemCount}`);
  console.log(`Из проблемных без product: ${withoutProductCount}`);
  console.log(`Строк в итоговом CSV: ${rows.length}`);

  window.attributesWithBarcodeIssues = rows;
  downloadCSV(rows, `attributes_barcode_issues_${timestamp()}.csv`);
})();
