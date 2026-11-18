(async function chanelPublishedProductsAudit() {
  'use strict';
  // Read-only investigation: KK Published category lost 10 product links.
  // Run only on CHANEL RU brand page. Never PUT/POST/PATCH/DELETE.
  const TAG = '[CHANEL Published Product Links Audit]';
  const BRAND_UID = 'api::brand.brand';
  const CAT_UID = 'api::category.category';
  const PRODUCT_UID = 'api::product.product';
  const BRAND_ID = 'yeag7mng9hfpk7pd4ggm7495';
  const CAT_ID = 'adl0ggt49f808cv4j2xalioq';
  const EXPECTED_SOURCE_COUNT = 10;
  const RUN_KEY = '__tmChanelPublishedProductsAuditRunning';
  const page = new URL(location.href);
  const requiredPath = '/admin/content-manager/collection-types/' + BRAND_UID + '/' + BRAND_ID;
  if (page.pathname !== requiredPath ||
      page.searchParams.get('plugins[i18n][locale]') !== 'ru') {
    console.error(TAG, 'Откройте RU-страницу бренда CHANEL', requiredPath);
    return;
  }
  if (window[RUN_KEY]) {
    console.warn(TAG, 'Аудит уже запущен');
    return;
  }
  window[RUN_KEY] = true;
  const report = {
    version: 1, mode: 'GET-only', categoryId: CAT_ID, brandId: BRAND_ID,
    startedAt: new Date().toISOString(), complete: false,
    counters: { GET: 0, retries: 0, relationPages: 0 },
    category: {}, products: [], summary: null, warnings: [], errors: []
  };
  const jwt = () => {
    const raw = localStorage.getItem('jwtToken');
    let value = raw;
    try { value = JSON.parse(raw); } catch {}
    if (typeof value !== 'string' || !value.trim()) throw Error('Нет jwtToken Strapi Admin');
    return value.trim().replace(/^Bearer\\s+/i, '');
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function get(url, allow404 = false) {
    for (let i = 0; i < 3; i++) {
      report.counters.GET++;
      let response;
      try {
        response = await fetch(url, {
          method: 'GET', credentials: 'include', cache: 'no-store',
          headers: { Authorization: 'Bearer ' + jwt(), Accept: 'application/json' }
        });
      } catch (e) {
        if (i === 2) throw Error('GET network: ' + url + ': ' + e.message);
        report.counters.retries++; await sleep(500 * (i + 1)); continue;
      }
      if (response.status === 404 && allow404) return null;
      if (!response.ok) {
        if (i < 2 && [408,429,500,502,503,504].includes(response.status)) {
          report.counters.retries++; await sleep(600 * (i + 1)); continue;
        }
        throw Error('GET HTTP ' + response.status + ' ' + url);
      }
      return response.json();
    }
    throw Error('GET failed: ' + url);
  }
  function detailUrl(uid, id, locale, status) {
    return '/content-manager/collection-types/' + uid + '/' + encodeURIComponent(id) +
      '?locale=' + locale + '&status=' + status;
  }
  async function detail(uid, id, locale, status) {
    const response = await get(detailUrl(uid, id, locale, status), true);
    const row = response?.data;
    if (row == null || typeof row === 'object' && !Array.isArray(row) &&
        Object.keys(row).length === 0) return null;
    if (!row || row.documentId !== id || row.locale !== locale ||
        (status === 'published' && !row.publishedAt)) {
      throw Error('Некорректная локаль/статус ' + uid + '/' + id + '/' + locale + '/' + status);
    }
    return row;
  }
  async function relations(uid, id, field, locale, status) {
    const all = [], ids = new Set();
    let page = 1, total = null, pageCount = null;
    for (;;) {
      const q = new URLSearchParams({ locale, status, page: String(page), pageSize: '100' });
      const url = '/content-manager/relations/' + uid + '/' + encodeURIComponent(id) +
        '/' + encodeURIComponent(field) + '?' + q.toString();
      const data = await get(url);
      const p = data?.pagination;
      if (!Array.isArray(data?.results) || !Number.isSafeInteger(p?.total) ||
          !Number.isSafeInteger(p?.pageCount) || p.total < 0 ||
          (p.total > 0 && !data.results.length) ||
          (p.page != null && Number(p.page) !== page) ||
          (total !== null && (total !== p.total || pageCount !== p.pageCount))) {
        throw Error('Некорректная relation пагинация: ' + uid + '/' + field);
      }
      total = p.total; pageCount = p.pageCount;
      for (const item of data.results) {
        if (!item?.documentId || !Number.isSafeInteger(item?.id) ||
            ids.has(item.documentId) || item.locale && item.locale !== locale) {
          throw Error('Некорректная relation строка: ' + uid + '/' + field);
        }
        ids.add(item.documentId);
        all.push(item.documentId);
      }
      report.counters.relationPages++;
      if (page >= pageCount) break;
      if (++page > 1000) throw Error('Слишком много страниц: ' + uid + '/' + field);
    }
    if (all.length !== total) throw Error('Неполная relation: ' + uid + '/' + field);
    return all.sort();
  }
  function download(name, data) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)],
      { type: 'application/json;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.append(a);
    try { a.click(); } finally {
      a.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000);
    }
  }
  try {
    const [brand, schemas] = await Promise.all([
      detail(BRAND_UID, BRAND_ID, 'ru', 'draft'), get('/content-manager/content-types')
    ]);
    if (!brand || !Array.isArray(schemas?.data)) throw Error('Нет бренда или схем');
    const catSchema = schemas.data.find(x => x.uid === CAT_UID);
    const prodSchema = schemas.data.find(x => x.uid === PRODUCT_UID);
    if (catSchema?.attributes?.product?.target !== PRODUCT_UID ||
        catSchema.attributes.product.mappedBy !== 'categories' ||
        prodSchema?.attributes?.categories?.target !== CAT_UID) {
      throw Error('Схема Category.product / Product.categories изменилась; аудит остановлен');
    }
    const brandCats = await relations(BRAND_UID, BRAND_ID, 'categories', 'ru', 'draft');
    if (brandCats.length !== 65 || !brandCats.includes(CAT_ID)) {
      throw Error('Исходная связь CHANEL с категорией изменилась');
    }
    const versions = {};
    for (const locale of ['ru', 'kk']) {
      for (const status of ['draft', 'published']) {
        const row = await detail(CAT_UID, CAT_ID, locale, status);
        const key = locale + '_' + status;
        const targets = row
          ? await relations(CAT_UID, CAT_ID, 'product', locale, status) : [];
        const expectedCount = row?.product?.count ?? null;
        versions[key] = {
          exists: !!row, versionId: row?.id ?? null,
          publishedAt: row?.publishedAt ?? null,
          detailCount: expectedCount, nativeCount: targets.length,
          countMatches: !row || expectedCount === targets.length,
          productDocumentIds: targets,
          key: row?.key ?? null
        };
        if (row && expectedCount !== targets.length) {
          report.warnings.push(key + ': detailCount и native relation расходятся');
        }
      }
    }
    report.category = versions;
    const ruIds = versions.ru_draft.productDocumentIds;
    const kkIds = versions.kk_draft.productDocumentIds;
    if (ruIds.length !== EXPECTED_SOURCE_COUNT ||
        JSON.stringify(ruIds) !== JSON.stringify(kkIds)) {
      throw Error('Исходные RU/KK Draft links изменились, требуется новый полный аудит');
    }
    for (const [i, id] of ruIds.entries()) {
      console.log(TAG, 'Product ' + (i+1) + '/' + ruIds.length, id);
      const item = { documentId: id, localeVersions: {}, warnings: [] };
      for (const locale of ['ru','kk']) {
        for (const status of ['draft','published']) {
          const key = locale + '_' + status;
          try {
            const row = await detail(PRODUCT_UID, id, locale, status);
            if (!row) {
              item.localeVersions[key] = {exists: false, linkedToCategory: false};
              continue;
            }
            const linked = await relations(PRODUCT_UID, id, 'categories', locale, status);
            const count = row.categories?.count ?? null;
            item.localeVersions[key] = {
              exists: true, publishedAt: row.publishedAt ?? null, versionId: row.id,
              detailCount: count, nativeCount: linked.length,
              countMatches: count === linked.length,
              linkedToCategory: linked.includes(CAT_ID)
            };
            if (count !== linked.length) item.warnings.push(key + ': count mismatch');
          } catch (e) {
            item.localeVersions[key] = { error: e.message };
            item.warnings.push(key + ': ' + e.message);
            if (/HTTP 401|HTTP 403/.test(e.message)) throw e;
          }
        }
      }
      report.products.push(item);
    }
    report.summary = {
      categoryRU: { draftLinks: versions.ru_draft.nativeCount,
        publishedLinks: versions.ru_published.nativeCount },
      categoryKK: { draftLinks: versions.kk_draft.nativeCount,
        publishedLinks: versions.kk_published.nativeCount },
      productsChecked: report.products.length,
      kkPublishedProducts: report.products.filter(x=>x.localeVersions.kk_published?.exists).length,
      kkPublishedProductLinksToCategory: report.products.filter(x=>
        x.localeVersions.kk_published?.linkedToCategory).length,
      kkDraftProductLinksToCategory: report.products.filter(x=>
        x.localeVersions.kk_draft?.linkedToCategory).length,
      issues: report.products.filter(x=>x.warnings.length).length
    };
    report.complete = report.products.length === EXPECTED_SOURCE_COUNT &&
      report.products.every(x=>!x.warnings.length) && !report.warnings.length;
    console.table(report.products.map(x=>({
      productId: x.documentId,
      ruPublished: !!x.localeVersions.ru_published?.exists,
      kkDraft: !!x.localeVersions.kk_draft?.exists,
      kkPublished: !!x.localeVersions.kk_published?.exists,
      kkDraftCategory: !!x.localeVersions.kk_draft?.linkedToCategory,
      kkPublishedCategory: !!x.localeVersions.kk_published?.linkedToCategory,
      errors: x.warnings.join('; ')
    })));
    console.log(TAG, 'Результат:', report.summary, 'complete:', report.complete,
      'GET:', report.counters.GET, 'POST=0 PUT=0');
  } catch (error) {
    report.errors.push(error.message);
    console.error(TAG, 'Аудит прерван (CMS не изменена):', error);
  } finally {
    report.finishedAt = new Date().toISOString();
    window.tmChanelPublishedProductsAudit = report;
    try { download('chanel-published-product-links-audit.json', report); }
    catch (e) { console.error(TAG, 'Ошибка JSON download:', e); }
    window[RUN_KEY] = false;
  }
})();