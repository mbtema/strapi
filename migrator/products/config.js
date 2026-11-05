// Этап 1: Strapi Admin -> Console -> products-config.csv
// Только GET. Все товары локали ru без фильтра newFrom1C/active/контента.
// Полный снимок Product + barcodes из attributes + bitrix_id категорий custom=false.
(async () => {
  'use strict';

  const CFG = {
    locale: 'ru',
    pageSize: 100,
    concurrency: 4,
    filename: 'products-config.csv'
  };
  const PRODUCT_UID = 'api::product.product';
  const ATTRIBUTE_UID = 'api::attribute.attribute';
  const CATEGORY_UID = 'api::category.category';
  const FIELDS = [
    'documentId', 'name', 'name1', 'name2', 'detail_picture',
    'preview_picture', 'pictures', 'active', 'newFrom1C',
    'attributes', 'categories', 'detail_text'
  ];
  const SNAPSHOT_FIELDS = [
    'name', 'name1', 'name2', 'detail_picture', 'preview_picture',
    'pictures', 'active', 'newFrom1C', 'detail_text'
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

  // Кешируем именно Promise: параллельные товары не читают одну связь повторно.
  const attributeCache = new Map();
  const categoryCache = new Map();
  function relatedDetail(uid, documentId) {
    const cache = uid === ATTRIBUTE_UID ? attributeCache : categoryCache;
    if (!cache.has(documentId)) cache.set(documentId, detail(uid, documentId));
    return cache.get(documentId);
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

  console.log('[Config] Читаю все товары locale=ru без фильтров...');
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
    console.log('[Config] Страница ' + page + '/' + pages +
      '; уникальных Product ' + ids.length);
    page++;
  } while (page <= pages);

  const result = new Array(ids.length);
  let cursor = 0;
  let done = 0;
  let withoutAttributes = 0;
  let withoutCategories = 0;
  let failed = null;
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  async function worker() {
    while (cursor < ids.length && !failed) {
      const index = cursor++;
      const id = ids[index];
      try {
        const product = await detail(PRODUCT_UID, id);
        for (const field of SNAPSHOT_FIELDS) {
          if (!own(product, field)) {
            throw Error('Product ' + id + ': Content Manager не вернул ' + field);
          }
        }
        if (typeof product.active !== 'boolean') {
          throw Error('Product ' + id + ': active должен быть boolean');
        }
        if (product.newFrom1C !== null &&
            typeof product.newFrom1C !== 'boolean') {
          throw Error('Product ' + id + ': newFrom1C должен быть true/false/null');
        }
        const [attributes, categories] = await Promise.all([
          relations(id, 'attributes'),
          relations(id, 'categories')
        ]);

        const barcodes = new Set();
        for (const relation of attributes) {
          let barcode = relation.barcode;
          if (barcode == null) {
            const attribute = await relatedDetail(ATTRIBUTE_UID, relation.documentId);
            if (!own(attribute, 'barcode')) {
              throw Error('Attribute ' + relation.documentId + ': barcode отсутствует в ответе');
            }
            barcode = attribute.barcode;
          }
          const value = normalizeBarcode(barcode);
          if (value) barcodes.add(value);
        }

        const bitrixIds = new Set();
        for (const relation of categories) {
          let category = relation;
          if (typeof category.custom !== 'boolean') {
            category = await relatedDetail(CATEGORY_UID, relation.documentId);
          }
          if (typeof category.custom !== 'boolean') {
            throw Error('Category ' + relation.documentId + ': custom не boolean');
          }
          if (category.custom) continue; // custom=true полностью игнорируем.
          if (category.bitrix_id == null || !String(category.bitrix_id).trim()) {
            // Поле может отсутствовать в сокращённом ответе relations.
            category = await relatedDetail(CATEGORY_UID, relation.documentId);
          }
          if (category.bitrix_id == null || !String(category.bitrix_id).trim()) {
            throw Error('Category ' + relation.documentId +
              ': custom=false, но bitrix_id отсутствует');
          }
          bitrixIds.add(String(category.bitrix_id).trim());
        }

        const values = [...barcodes].sort();
        const categoryValues = [...bitrixIds].sort((a, b) =>
          a.localeCompare(b, 'en', { numeric: true })
        );
        result[index] = {
          documentId: id,
          name: product.name ?? '',
          name1: product.name1 ?? '',
          name2: product.name2 ?? '',
          detail_picture: filled(product.detail_picture),
          preview_picture: filled(product.preview_picture),
          pictures: filled(product.pictures),
          active: product.active,
          newFrom1C: product.newFrom1C === null ? 'null' : product.newFrom1C,
          attributes: values.join('|'),
          categories: categoryValues.join('|'),
          detail_text: filled(product.detail_text)
        };
        if (!values.length) withoutAttributes++;
        if (!categoryValues.length) withoutCategories++;

        done++;
        if (done % 50 === 0 || done === ids.length) {
          console.log('[Config] Проверено ' + done + '/' + ids.length +
            '; без barcode ' + withoutAttributes +
            '; без категорий custom=false ' + withoutCategories);
        }
      } catch (error) {
        failed = error;
        break;
      }
    }
  }

  // При ошибке дожидаемся остальных начатых GET и не скачиваем неполный CSV.
  await Promise.all(Array.from({
    length: Math.min(CFG.concurrency, ids.length)
  }, worker));
  if (failed) throw failed;

  const products = result.sort((a, b) =>
    String(a.name).localeCompare(String(b.name), 'ru') ||
    a.documentId.localeCompare(b.documentId)
  );
  const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
  const csv = '\uFEFF' + [
    FIELDS.join(';'),
    ...products.map(item => FIELDS.map(field => quote(item[field])).join(';'))
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
    products: products.length,
    withBarcode: products.length - withoutAttributes,
    withoutBarcode: withoutAttributes,
    withBitrixCategories: products.length - withoutCategories,
    withoutBitrixCategories: withoutCategories,
    columns: FIELDS.join(', '),
    file: CFG.filename
  }]);
  console.log('[Config] Готово. Только GET; изменений в Strapi нет.');
  console.log('[Config] CSV совместим с migrator/products/matcher.js (12 колонок).');
})();
