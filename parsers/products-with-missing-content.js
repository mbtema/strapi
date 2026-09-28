
(async () => {
  'use strict';

  const PRODUCT_UID = 'api::product.product';
  const EXCLUDED_CATEGORY_IDS = new Set([
    'kns3po2mz8hq9kezm3szbvjg',
    'a4zy2gvb479ku9nd6py5uxzh'
  ]);
  const HEADERS = [
    'id',
    'documentId',
    'name',
    'key',
    'missingCount',
    'missingFields',
    'name1',
    'name2',
    'hasDetailPicture',
    'detailTextLength'
  ];
  const rows = [];

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

async function hasRelation(uid, documentId, field) {
  const params = new URLSearchParams({
    locale: LOCALE,
    page: '1',
    pageSize: '1'
  });

  const json = await getJson(
    `/content-manager/relations/${uid}/${encodeURIComponent(documentId)}/${field}?${params}`,
    `${documentId} relation ${field}`
  );

  return getRows(json).length > 0;
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

const timestamp = () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};

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


  const hasText = value => {
    if (value == null) return false;
    return String(value)
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .trim()
      .length > 0;
  };

  const hasMedia = value => {
    if (!value) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (Array.isArray(value?.data)) return value.data.length > 0;
    if (Object.prototype.hasOwnProperty.call(Object(value), 'data')) {
      return Boolean(value.data);
    }
    return true;
  };

  const relationDocumentId = item =>
    item?.documentId ?? item?.attributes?.documentId ?? '';

  const products = await listAll(PRODUCT_UID, 'products-with-missing-content');
  let checked = 0;
  let activeCount = 0;
  let excludedByCategory = 0;

  await mapLimit(products, 6, async item => {
    const detail = await getDetail(PRODUCT_UID, item.documentId, 'Product');

    if (typeof detail?.active !== 'boolean') {
      throw new Error(
        `Product ${item.documentId}: Content Manager detail не содержит active`
      );
    }

    if (detail.active !== true) {
      checked++;
      return;
    }

    activeCount++;

    for (const field of ['name1', 'name2', 'detail_text', 'detail_picture']) {
      if (!Object.prototype.hasOwnProperty.call(detail, field)) {
        throw new Error(
          `Product ${item.documentId}: Content Manager detail не содержит ${field}`
        );
      }
    }

    const categories = await getRelation(
      PRODUCT_UID,
      item.documentId,
      'categories'
    );

    if (
      categories.some(category =>
        EXCLUDED_CATEGORY_IDS.has(relationDocumentId(category))
      )
    ) {
      excludedByCategory++;
      checked++;
      return;
    }

    const missing = [];
    if (!hasText(detail.name1)) missing.push('name1');
    if (!hasText(detail.name2)) missing.push('name2');
    if (!hasMedia(detail.detail_picture)) missing.push('detail_picture');
    if (!hasText(detail.detail_text)) missing.push('detail_text');

    if (missing.length) {
      rows.push({
        id: detail.id ?? item.id ?? '',
        documentId: item.documentId,
        name: detail.name ?? item.name ?? '',
        key: detail.key ?? item.key ?? '',
        missingCount: missing.length,
        missingFields: missing.join(', '),
        name1: detail.name1 ?? '',
        name2: detail.name2 ?? '',
        hasDetailPicture: hasMedia(detail.detail_picture),
        detailTextLength: hasText(detail.detail_text)
          ? String(detail.detail_text).trim().length
          : 0
      });
    }

    checked++;
    if (checked % 250 === 0 || checked === products.length) {
      console.log(
        `[products-with-missing-content] checked ${checked}/${products.length} | ` +
        `active ${activeCount} | excluded ${excludedByCategory} | found ${rows.length}`
      );
    }
  });

  rows.sort((a, b) => String(a.documentId).localeCompare(String(b.documentId)));
  console.table(rows);
  console.log(
    `Готово: в CMS найдено active products с незаполненным критичным контентом: ${rows.length}`
  );
  console.log(`Исключено по служебным категориям: ${excludedByCategory}`);

  window.productsWithMissingContent = rows;
  downloadCSV(rows, HEADERS, `products_missing_content_${timestamp()}.csv`);
})();
