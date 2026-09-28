
(async () => {
  'use strict';

  const UID = 'api::product.product';
  const HEADERS = ['id', 'documentId', 'name', 'key'];
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


  const products = await listAll(UID, 'products-without-categories');
  let checked = 0;
  let activeCount = 0;

  await mapLimit(products, 6, async item => {
    const detail = await getDetail(UID, item.documentId, 'Product');

    if (detail?.active === true) {
      activeCount++;
      const hasCategories = await hasRelation(UID, item.documentId, 'categories');

      if (!hasCategories) {
        rows.push({
          id: detail?.id ?? item.id ?? '',
          documentId: item.documentId,
          name: detail?.name ?? item.name ?? '',
          key: detail?.key ?? item.key ?? ''
        });
      }
    }

    checked++;
    if (checked % 250 === 0 || checked === products.length) {
      console.log(
        `[products-without-categories] checked ${checked}/${products.length} | ` +
        `active ${activeCount} | found ${rows.length}`
      );
    }
  });

  rows.sort((a, b) => String(a.documentId).localeCompare(String(b.documentId)));
  console.table(rows);
  console.log(`Готово: в CMS найдено active products без categories: ${rows.length}`);
  window.productsWithoutCategories = rows;
  downloadCSV(rows, HEADERS, `products_without_categories_${timestamp()}.csv`);
})();
