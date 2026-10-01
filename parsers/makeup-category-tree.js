(async () => {
  'use strict';

  const CATEGORY_UID = 'api::category.category';
  const ROOT_DOCUMENT_ID = 'keziuozkg1hgs2c1427457tm';
  const LOCALE = 'ru';
  const PAGE_SIZE = 100;
  const HEADERS = [
    'depth',
    'parentDocumentId',
    'documentId',
    'title',
    'childCount'
  ];

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

  async function getDetail(documentId) {
    const params = new URLSearchParams({ locale: LOCALE });
    const json = await getJson(
      `/content-manager/collection-types/${CATEGORY_UID}/${encodeURIComponent(documentId)}?${params}`,
      `Category ${documentId}`
    );

    return json?.data ?? json;
  }

  async function getChildren(documentId) {
    const all = [];
    const seenPageItems = new Set();
    let page = 1;
    let pageCount = 1;

    while (page <= pageCount) {
      const params = new URLSearchParams({
        locale: LOCALE,
        page: String(page),
        pageSize: String(PAGE_SIZE)
      });

      const json = await getJson(
        `/content-manager/relations/${CATEGORY_UID}/${encodeURIComponent(documentId)}/categories?${params}`,
        `${documentId} relation categories page ${page}`
      );

      const items = getRows(json);
      const pagination = getPagination(json);
      pageCount = Number(pagination?.pageCount || pageCount);

      for (const item of items) {
        if (!item?.documentId) {
          throw new Error(
            `Category ${documentId}: relation categories содержит запись без documentId`
          );
        }

        if (seenPageItems.has(item.documentId)) continue;
        seenPageItems.add(item.documentId);
        all.push(item);
      }

      if (!items.length) break;
      page++;
    }

    return all;
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

  const root = await getDetail(ROOT_DOCUMENT_ID);

  if (root?.documentId !== ROOT_DOCUMENT_ID) {
    throw new Error(
      `Корень Макияж: ожидался documentId ${ROOT_DOCUMENT_ID}, получен ${root?.documentId || 'empty'}`
    );
  }

  const rootTitle = root?.title || root?.name || ROOT_DOCUMENT_ID;
  const rows = [{
    depth: 0,
    parentDocumentId: '',
    documentId: ROOT_DOCUMENT_ID,
    title: rootTitle,
    childCount: 0
  }];

  const rowByDocumentId = new Map([[ROOT_DOCUMENT_ID, rows[0]]]);
  const parentByDocumentId = new Map([[ROOT_DOCUMENT_ID, '']]);
  const queue = [rows[0]];
  let scanned = 0;

  while (queue.length) {
    const current = queue.shift();
    const children = await getChildren(current.documentId);
    current.childCount = children.length;

    for (const child of children) {
      const documentId = child.documentId;
      const knownParent = parentByDocumentId.get(documentId);

      if (knownParent !== undefined) {
        if (knownParent !== current.documentId) {
          throw new Error(
            `Category ${documentId}: найдена под двумя родителями: ` +
            `${knownParent || '[root]'} и ${current.documentId}`
          );
        }
        continue;
      }

      const row = {
        depth: current.depth + 1,
        parentDocumentId: current.documentId,
        documentId,
        title: child?.title || documentId,
        childCount: 0
      };

      rows.push(row);
      queue.push(row);
      rowByDocumentId.set(documentId, row);
      parentByDocumentId.set(documentId, current.documentId);
    }

    scanned++;
    console.log(
      `[makeup-category-tree] scanned ${scanned}/${scanned + queue.length} | ` +
      `categories ${rows.length} | current ${current.title}`
    );
  }

  const maxDepth = rows.reduce((max, row) => Math.max(max, row.depth), 0);

  console.table(rows);
  console.log(
    `Готово: корень 1 | дочерних категорий ${rows.length - 1} | ` +
    `всего ${rows.length} | max depth ${maxDepth}`
  );

  window.makeupCategoryTree = rows;
  downloadCSV(rows, HEADERS, 'makeup-category-tree.csv');
})();