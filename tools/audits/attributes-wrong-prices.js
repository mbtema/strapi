
(async () => {
  'use strict';

  const ATTRIBUTE_UID = 'api::attribute.attribute';
  const PRODUCT_UID = 'api::product.product';
  const HEADERS = ['documentId', 'barcode', 'price', 'errorType'];
  const invalidRows = [];

const LOCALE = 'ru';
const PAGE_SIZE = 100;

const getAdminToken = () => {
  const raw = localStorage.getItem('jwtToken');
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed : raw;
  } catch {
    return raw.replace(/^"|"$/g, '');
  }
};

const adminToken = getAdminToken();
if (!adminToken) throw new Error('Не найден jwtToken в LocalStorage');

const headers = {
  Accept: 'application/json',
  Authorization: `Bearer ${adminToken}`
};

const getRows = json => Array.isArray(json?.results)
  ? json.results
  : Array.isArray(json?.data)
    ? json.data
    : [];

const getPagination = json => json?.pagination ?? json?.meta?.pagination ?? null;

async function getJson(url, label) {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `${label}: HTTP ${response.status}${body ? ` — ${body.slice(0, 250)}` : ''}`
    );
  }

  return response.json();
}

async function listAll(uid, label) {
  const result = [];
  const seen = new Set();
  let page = 1;
  let pageCount = 1;

  while (page <= pageCount) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sort: 'id:ASC',
      locale: LOCALE
    });

    const json = await getJson(
      `/content-manager/collection-types/${uid}?${params}`,
      `${label} page ${page}`
    );

    const items = getRows(json);
    const pagination = getPagination(json);
    pageCount = Number(pagination?.pageCount || pageCount);

    for (const item of items) {
      if (!item?.documentId || seen.has(item.documentId)) continue;
      seen.add(item.documentId);
      result.push(item);
    }

    console.log(
      `[${label}] CMS list ${page}/${pageCount} | loaded ${result.length}` +
      (pagination?.total ? `/${pagination.total}` : '')
    );

    if (!items.length) break;
    page++;
  }

  return result;
}

async function getDetail(uid, documentId, label) {
  const params = new URLSearchParams({ locale: LOCALE });
  const json = await getJson(
    `/content-manager/collection-types/${uid}/${encodeURIComponent(documentId)}?${params}`,
    `${label} ${documentId}`
  );
  return json?.data ?? json;
}

async function getRelation(uid, documentId, field, pageSize = 100) {
  const all = [];
  let page = 1;
  let pageCount = 1;

  while (page <= pageCount) {
    const params = new URLSearchParams({
      locale: LOCALE,
      page: String(page),
      pageSize: String(pageSize)
    });

    const json = await getJson(
      `/content-manager/relations/${uid}/${encodeURIComponent(documentId)}/${field}?${params}`,
      `${documentId} relation ${field} page ${page}`
    );

    const items = getRows(json);
    const pagination = getPagination(json);
    pageCount = Number(pagination?.pageCount || pageCount);
    all.push(...items);

    if (!items.length) break;
    page++;
  }

  return all;
}

async function mapLimit(items, limit, worker) {
  let nextIndex = 0;
  const runnerCount = Math.min(limit, items.length);

  const runners = Array.from({ length: runnerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });

  await Promise.all(runners);
}

const downloadCSV = (items, headersList, filename) => {
  const q = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [
    headersList.join(';'),
    ...items.map(row => headersList.map(key => q(row[key])).join(';'))
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


  const priceIssue = value => {
    if (value == null || String(value).trim() === '') return 'missing';

    const price = Number(value);
    if (!Number.isFinite(price)) return 'invalid';
    if (price === 0) return 'zero';
    if (price < 0) return 'negative';
    if (!Number.isInteger(price)) return 'fractional';

    return null;
  };

  const hasOwn = (value, key) =>
    Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);

  const productActiveCache = new Map();

  async function isProductActive(product) {
    if (!product?.documentId) return false;
    if (typeof product.active === 'boolean') return product.active;

    if (!productActiveCache.has(product.documentId)) {
      productActiveCache.set(
        product.documentId,
        getDetail(PRODUCT_UID, product.documentId, 'Product')
          .then(detail => {
            if (typeof detail?.active !== 'boolean') {
              throw new Error(
                `Product ${product.documentId}: Content Manager detail не содержит active`
              );
            }
            return detail.active;
          })
      );
    }

    return productActiveCache.get(product.documentId);
  }

  const attributes = await listAll(ATTRIBUTE_UID, 'attributes-wrong-prices');
  let checked = 0;
  let activeProductOffers = 0;

  await mapLimit(attributes, 10, async item => {
    const products = await getRelation(
      ATTRIBUTE_UID,
      item.documentId,
      'product',
      1
    );

    const product = products[0] ?? null;
    if (!product || !(await isProductActive(product))) {
      checked++;
      return;
    }

    activeProductOffers++;

    let source = item;
    if (!hasOwn(item, 'price') || !hasOwn(item, 'barcode')) {
      source = await getDetail(ATTRIBUTE_UID, item.documentId, 'Attribute');
    }

    if (!hasOwn(source, 'price')) {
      throw new Error(
        `Attribute ${item.documentId}: Content Manager не вернул поле price`
      );
    }

    const errorType = priceIssue(source.price);
    if (errorType) {
      invalidRows.push({
        documentId: item.documentId,
        barcode: source.barcode ?? item.barcode ?? '',
        price: source.price ?? '',
        errorType
      });
    }

    checked++;
    if (checked % 250 === 0 || checked === attributes.length) {
      console.log(
        `[attributes-wrong-prices] checked ${checked}/${attributes.length} | ` +
        `offers of active products ${activeProductOffers} | invalid ${invalidRows.length}`
      );
    }
  });

  if (!invalidRows.length) {
    console.log('Готово: проблем с ценой у offers активных товаров не найдено');
    return;
  }

  console.table(invalidRows);
  console.log(
    `Готово: в CMS найдено ${invalidRows.length} offers активных товаров с некорректной ценой`
  );

  window.attributesWithInvalidPrice = invalidRows;
  downloadCSV(
    invalidRows,
    HEADERS,
    'attributes-wrong-prices.csv'
  );
})();
