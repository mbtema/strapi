(async () => {
  'use strict';

  const CATEGORY_UID = 'api::category.category';
  const LOCALE = 'ru';
  const PAGE_SIZE = 100;
  const FILE_NAME = 'catalog-tree-products.csv';

  const rootDocumentId = decodeURIComponent(
    location.pathname.match(
      /\/collection-types\/api::category\.category\/([^/?#]+)/
    )?.[1] || ''
  );

  if (!rootDocumentId) {
    throw new Error('Открой карточку корневой категории');
  }

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
  if (!adminToken) {
    throw new Error('Не найден jwtToken в LocalStorage');
  }

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${adminToken}`
  };

  const getRows = json => {
    if (Array.isArray(json?.results)) return json.results;
    if (Array.isArray(json?.data?.results)) return json.data.results;
    if (Array.isArray(json?.data)) return json.data;
    return null;
  };

  const getPagination = json =>
    json?.pagination ??
    json?.meta?.pagination ??
    json?.data?.pagination ??
    json?.data?.meta?.pagination ??
    null;

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

  async function getAllRelation(categoryDocumentId, field) {
    const all = [];
    let page = 1;

    while (true) {
      const params = new URLSearchParams({
        locale: LOCALE,
        page: String(page),
        pageSize: String(PAGE_SIZE)
      });

      const json = await getJson(
        `/content-manager/relations/${CATEGORY_UID}/${encodeURIComponent(categoryDocumentId)}/${field}?${params}`,
        `${categoryDocumentId} relation ${field} page ${page}`
      );

      const items = getRows(json);

      if (!Array.isArray(items)) {
        throw new Error(
          `${categoryDocumentId} relation ${field}: неожиданный ответ API`
        );
      }

      all.push(...items);

      const pagination = getPagination(json);
      const pageCount = Number(pagination?.pageCount);

      if (Number.isFinite(pageCount) && pageCount > 0) {
        if (page >= pageCount) break;
      } else if (items.length < PAGE_SIZE) {
        break;
      }

      if (!items.length) {
        throw new Error(
          `${categoryDocumentId} relation ${field}: пустая страница ${page} до конца pagination`
        );
      }

      page++;
    }

    return all;
  }

  const queue = [rootDocumentId];
  const visitedCategories = new Set();
  const productDocumentIds = new Set();

  while (queue.length) {
    const categoryDocumentId = queue.shift();

    if (visitedCategories.has(categoryDocumentId)) {
      continue;
    }

    visitedCategories.add(categoryDocumentId);

    const [children, products] = await Promise.all([
      getAllRelation(categoryDocumentId, 'categories'),
      getAllRelation(categoryDocumentId, 'product')
    ]);

    for (const product of products) {
      if (!product?.documentId) {
        throw new Error(
          `Категория ${categoryDocumentId}: relation product вернул запись без documentId`
        );
      }

      productDocumentIds.add(product.documentId);
    }

    for (const child of children) {
      if (!child?.documentId) {
        throw new Error(
          `Категория ${categoryDocumentId}: relation categories вернул запись без documentId`
        );
      }

      if (!visitedCategories.has(child.documentId)) {
        queue.push(child.documentId);
      }
    }

    console.log(
      `[catalog-tree-products] categories ${visitedCategories.size} | queue ${queue.length} | products ${productDocumentIds.size}`
    );
  }

  const csv = [
    'documentId',
    ...[...productDocumentIds].sort()
  ].join('\r\n');

  const url = URL.createObjectURL(
    new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  );

  const link = Object.assign(document.createElement('a'), {
    href: url,
    download: FILE_NAME
  });

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);

  console.log(
    `[catalog-tree-products] Готово: категорий ${visitedCategories.size} | уникальных товаров ${productDocumentIds.size}`
  );
})();
