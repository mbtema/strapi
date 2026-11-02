// Этап 1: Strapi Admin -> Console -> migration-config.csv
// Только GET. Отбор: newFrom1C=true и отсутствие хотя бы одного
// из шести обязательных полей. CSV: documentId;name;barcodes.
(async () => {
  'use strict';

  const CFG = {
    locale: 'ru',
    pageSize: 100,
    concurrency: 4,
    filename: 'migration-config.csv'
  };
  const PRODUCT_UID = 'api::product.product';
  const ATTRIBUTE_UID = 'api::attribute.attribute';
  const REQUIRED = [
    'name1', 'name2', 'preview_picture',
    'detail_picture', 'categories', 'detail_text'
  ];

  if (!location.pathname.startsWith('/admin')) {
    throw Error('Запусти скрипт в Strapi Admin');
  }

  const raw = localStorage.getItem('jwtToken');
  if (!raw) throw Error('Не найден jwtToken');
  let token;
  try { token = JSON.parse(raw); } catch { token = raw; }
  if (typeof token !== 'string' || !token) {
    throw Error('Некорректный jwtToken');
  }

  const headers = { Authorization: 'Bearer ' + token };
  const flat = item =>
    item?.attributes && !Array.isArray(item.attributes) && !item.documentId
      ? { ...item.attributes, id: item.id } : item;
  const rowsOf = json =>
    Array.isArray(json?.results) ? json.results :
    Array.isArray(json?.data) ? json.data : null;
  const pageOf = json => json?.pagination ?? json?.meta?.pagination;
  const filled = value => {
    if (value == null) return false;
    if (typeof value === 'string') return !!value.trim();
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object' && 'data' in value) {
      return filled(value.data);
    }
    return true;
  };
  const normalizeBarcode = value =>
    String(value ?? '').replace(/\s+/g, '').trim();

  async function get(url) {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers
    });
    if (!response.ok) {
      throw Error('HTTP ' + response.status + ': ' + url.split('?')[0]);
    }
    return response.json();
  }

  async function detail(uid, documentId) {
    const json = await get(
      '/content-manager/collection-types/' + uid + '/' +
      encodeURIComponent(documentId) + '?locale=' + CFG.locale
    );
    const data = json.data ?? json;
    const matches = (Array.isArray(data) ? data : [data])
      .map(flat)
      .filter(item => item?.documentId === documentId && item?.locale === CFG.locale);
    if (matches.length !== 1) {
      throw Error(uid + '/' + documentId + ': найдено ' + matches.length + ' записей');
    }
    return matches[0];
  }

  async function relations(documentId, field, pageSize = 100) {
    const all = [];
    const seen = new Set();
    for (let page = 1; page <= 100; page++) {
      const params = new URLSearchParams({
        locale: CFG.locale,
        page: String(page),
        pageSize: String(pageSize)
      });
      const json = await get(
        '/content-manager/relations/' + PRODUCT_UID + '/' +
        encodeURIComponent(documentId) + '/' + field + '?' + params
      );
      const list = rowsOf(json);
      if (!list) {
        throw Error('Relations ' + field + '/' + documentId + ': неизвестный ответ');
      }
      for (const rawItem of list) {
        const item = flat(rawItem);
        if (!item?.documentId) {
          throw Error('Relations ' + field + '/' + documentId + ': нет documentId');
        }
        if (!seen.has(item.documentId)) {
          seen.add(item.documentId);
          all.push(item);
        }
      }
      const pagination = pageOf(json);
      if (
        pagination?.pageCount != null
          ? page >= Number(pagination.pageCount)
          : list.length < pageSize
      ) return all;
      if (list.length === 0) return all;
    }
    throw Error('Relations ' + field + '/' + documentId + ': достигнут лимит страниц');
  }

  console.log('[Config] Читаю все товары newFrom1C=true...');
  const ids = [];
  const seen = new Set();
  let page = 1;
  let pages = 1;
  do {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(CFG.pageSize),
      sort: 'id:ASC',
      locale: CFG.locale
    });
    params.set('filters[$and][0][newFrom1C][$eq]', 'true');
    const json = await get(
      '/content-manager/collection-types/' + PRODUCT_UID + '?' + params
    );
    const list = rowsOf(json);
    pages = Number(pageOf(json)?.pageCount);
    if (!list || !Number.isSafeInteger(pages) || pages < 0 || pages > 100000) {
      throw Error('Некорректная пагинация списка: ' + page);
    }
    if (!list.length && page < pages) {
      throw Error('Получена пустая страница до конца списка');
    }
    for (const rawItem of list) {
      const item = flat(rawItem);
      if (!item?.documentId) throw Error('Product без documentId');
      if (!seen.has(item.documentId)) {
        seen.add(item.documentId);
        ids.push(item.documentId);
      }
    }
    console.log('[Config] Страница ' + page + '/' + pages + '; найдено ' + ids.length);
    page++;
  } while (page <= pages);

  const result = new Array(ids.length);
  let cursor = 0;
  let done = 0;
  let candidateCount = 0;
  let noBarcode = 0;

  async function worker() {
    while (cursor < ids.length) {
      const index = cursor++;
      const id = ids[index];
      const product = await detail(PRODUCT_UID, id);
      if (
        product.newFrom1C !== true ||
        typeof product.name !== 'string' ||
        !product.name.trim()
      ) {
        throw Error('Некорректный Product ' + id + ': newFrom1C или name');
      }

      const categories = await relations(id, 'categories');
      const missing = REQUIRED.filter(field =>
        field === 'categories'
          ? categories.length === 0
          : !filled(product[field])
      );

      // Attributes читаем только для кандидатов с отсутствующим контентом.
      if (missing.length) {
        const attributes = await relations(id, 'attributes');
        const barcodes = new Set();
        for (const relation of attributes) {
          let value = relation.barcode;
          if (value == null) {
            const attribute = await detail(ATTRIBUTE_UID, relation.documentId);
            value = attribute.barcode;
          }
          const normalized = normalizeBarcode(value);
          if (normalized) barcodes.add(normalized);
        }
        const values = [...barcodes];
        result[index] = {
          documentId: id,
          name: product.name,
          barcodes: values.join('|')
        };
        candidateCount++;
        if (!values.length) noBarcode++;
      }

      done++;
      if (done % 50 === 0 || done === ids.length) {
        console.log('[Config] Проверено ' + done + '/' + ids.length +
          '; кандидатов ' + candidateCount);
      }
    }
  }

  await Promise.all(Array.from({
    length: Math.min(CFG.concurrency, ids.length)
  }, worker));

  const candidates = result.filter(Boolean).sort((a, b) =>
    a.name.localeCompare(b.name, 'ru') ||
    a.documentId.localeCompare(b.documentId)
  );
  const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
  const csv = '\uFEFF' + [
    'documentId;name;barcodes',
    ...candidates.map(item =>
      [item.documentId, item.name, item.barcodes].map(quote).join(';')
    )
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], {
    type: 'text/csv;charset=utf-8'
  }));
  const link = document.createElement('a');
  link.href = url;
  link.download = CFG.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);

  console.log('[Config] Итог:');
  console.table([{
    newFrom1C: ids.length,
    needsMigration: candidates.length,
    withBarcodes: candidates.length - noBarcode,
    withoutBarcodes: noBarcode,
    columns: 'documentId, name, barcodes',
    file: CFG.filename
  }]);
  console.log('[Config] Готово. Только GET; изменений в Strapi нет.');
})();
