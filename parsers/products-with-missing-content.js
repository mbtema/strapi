(async () => {
  'use strict';

  const PRODUCT_UID = 'api::product.product';
  const CATEGORY_UID = 'api::category.category';
  const HEADERS = [
    'documentId',
    'categoryState',
    'missingFields'
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

  const categories = await listAll(CATEGORY_UID, 'products-with-missing-content/categories');
  const categoryActiveById = new Map();

  for (const category of categories) {
    if (typeof category?.active !== 'boolean') {
      throw new Error(
        `Category ${category?.documentId || category?.id || 'unknown'}: Content Manager list не содержит active`
      );
    }
    categoryActiveById.set(category.documentId, category.active);
  }

  const products = await listAll(PRODUCT_UID, 'products-with-missing-content/products');
  let checked = 0;
  let activeCount = 0;
  let skippedInactiveCategories = 0;
  let noCategoriesCount = 0;
  let mixedCategoriesCount = 0;

  const logProgress = () => {
    if (checked % 250 === 0 || checked === products.length) {
      console.log(
        `[products-with-missing-content] checked ${checked}/${products.length} | ` +
        `active ${activeCount} | skipped categories inactive ${skippedInactiveCategories} | ` +
        `no categories ${noCategoriesCount} | mixed categories ${mixedCategoriesCount} | ` +
        `found ${rows.length}`
      );
    }
  };

  await mapLimit(products, 6, async item => {
    const detail = await getDetail(PRODUCT_UID, item.documentId, 'Product');

    if (typeof detail?.active !== 'boolean') {
      throw new Error(
        `Product ${item.documentId}: Content Manager detail не содержит active`
      );
    }

    if (detail.active !== true) {
      checked++;
      logProgress();
      return;
    }

    activeCount++;

    const relatedCategories = await getRelation(
      PRODUCT_UID,
      item.documentId,
      'categories'
    );

    let categoryState = 'normal';

    if (!relatedCategories.length) {
      categoryState = 'no_categories';
      noCategoriesCount++;
    } else {
      const activeStates = relatedCategories.map(category => {
        const documentId = relationDocumentId(category);

        if (!documentId) {
          throw new Error(
            `Product ${item.documentId}: relation categories содержит запись без documentId`
          );
        }

        if (!categoryActiveById.has(documentId)) {
          throw new Error(
            `Product ${item.documentId}: category ${documentId} не найдена в Content Manager list`
          );
        }

        return categoryActiveById.get(documentId);
      });

      const hasActiveCategory = activeStates.some(Boolean);
      const hasInactiveCategory = activeStates.some(active => active === false);

      if (!hasActiveCategory) {
        skippedInactiveCategories++;
        checked++;
        logProgress();
        return;
      }

      if (hasInactiveCategory) {
        categoryState = 'mixed_active';
        mixedCategoriesCount++;
      }
    }

    for (const field of ['name1', 'name2', 'detail_text', 'detail_picture']) {
      if (!Object.prototype.hasOwnProperty.call(detail, field)) {
        throw new Error(
          `Product ${item.documentId}: Content Manager detail не содержит ${field}`
        );
      }
    }

    const missing = [];
    if (!hasText(detail.name1)) missing.push('name1');
    if (!hasText(detail.name2)) missing.push('name2');
    if (!hasMedia(detail.detail_picture)) missing.push('detail_picture');
    if (!hasText(detail.detail_text)) missing.push('detail_text');

    if (categoryState !== 'normal' || missing.length) {
      rows.push({
        documentId: item.documentId,
        categoryState,
        missingFields: missing.join(', ')
      });
    }

    checked++;
    logProgress();
  });

  const categoryStateRank = {
    normal: 0,
    no_categories: 1,
    mixed_active: 2
  };

  rows.sort((a, b) =>
    (categoryStateRank[a.categoryState] ?? 99) - (categoryStateRank[b.categoryState] ?? 99) ||
    String(a.documentId).localeCompare(String(b.documentId))
  );

  console.table(rows);
  console.log(
    `Готово: отчет ${rows.length} products | active ${activeCount} | ` +
    `skipped categories inactive ${skippedInactiveCategories} | ` +
    `no categories ${noCategoriesCount} | mixed categories ${mixedCategoriesCount}`
  );

  window.productsWithMissingContent = rows;
  downloadCSV(rows, HEADERS, `products_missing_content_${timestamp()}.csv`);
})();
