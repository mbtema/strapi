(async () => {
  'use strict';

  const PRODUCT_UID = 'api::product.product';
  const ATTRIBUTE_UID = 'api::attribute.attribute';
  const HEADERS = ['documentId', 'errorType'];
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

  async function loadVariant(attribute) {
    const documentId = attribute?.documentId;
    if (!documentId) {
      throw new Error('Product attributes relation вернул запись без documentId');
    }

    const [shadeItems, volumeItems] = await Promise.all([
      getRelation(ATTRIBUTE_UID, documentId, 'shade', 1),
      getRelation(ATTRIBUTE_UID, documentId, 'volume', 1)
    ]);

    return {
      hasShade: shadeItems.length > 0,
      hasVolume: volumeItems.length > 0
    };
  }

  const products = await listAll(PRODUCT_UID, 'products-wrong-variants');
  let checkedProducts = 0;
  let activeProducts = 0;

  const logProgress = () => {
    if (checkedProducts % 100 === 0 || checkedProducts === products.length) {
      console.log(
        `[products-wrong-variants] checked ${checkedProducts}/${products.length} | ` +
        `active ${activeProducts} | problems ${rows.length}`
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
      checkedProducts++;
      logProgress();
      return;
    }

    activeProducts++;

    const attributes = await getRelation(
      PRODUCT_UID,
      item.documentId,
      'attributes'
    );

    if (!attributes.length) {
      checkedProducts++;
      logProgress();
      return;
    }

    const variants = [];
    await mapLimit(attributes, 3, async attribute => {
      variants.push(await loadVariant(attribute));
    });

    const shadeOnlyCount = variants.filter(v => v.hasShade && !v.hasVolume).length;
    const volumeOnlyCount = variants.filter(v => !v.hasShade && v.hasVolume).length;
    const emptyCount = variants.filter(v => !v.hasShade && !v.hasVolume).length;
    const bothCount = variants.filter(v => v.hasShade && v.hasVolume).length;

    const issues = [];

    if (bothCount) {
      issues.push('shade-volume');
    }

    if (variants.length > 1) {
      if (emptyCount === variants.length) {
        issues.push('no-variant');
      } else {
        if (emptyCount) issues.push('missing');
        if (shadeOnlyCount && volumeOnlyCount) issues.push('mixed');
      }
    }

    if (issues.length) {
      rows.push({
        documentId: item.documentId,
        errorType: [...new Set(issues)].join(', ')
      });
    }

    checkedProducts++;
    logProgress();
  });

  rows.sort((a, b) => String(a.documentId).localeCompare(String(b.documentId)));

  if (!rows.length) {
    console.log('Готово: проблем с вариантами у active products не найдено');
    return;
  }

  console.table(rows);
  console.log(
    `Готово: проверено active products ${activeProducts} | проблемных ${rows.length}`
  );

  window.productsWrongVariants = rows;
  downloadCSV(rows, HEADERS, 'products-wrong-variants.csv');
})();
