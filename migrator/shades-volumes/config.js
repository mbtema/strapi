// Этап 1: Strapi Admin -> Console -> shades-volumes-config.csv
// Только GET. Все Product locale=ru, включая inactive/draft/modified.
// В CSV попадают только Product с 2+ relation attributes (не только с 2+ barcode).
// attributes — JSON-массив [{documentId,barcode}, ...] в порядке relation API.
(async () => {
  'use strict';

  const CFG = {
    locale: 'ru',
    pageSize: 100,
    listConcurrency: 4,
    relationConcurrency: 8,
    maxPages: 10000,
    filename: 'shades-volumes-config.csv'
  };
  const PRODUCT_UID = 'api::product.product';
  const ATTRIBUTE_UID = 'api::attribute.attribute';
  const FIELDS = ['documentId', 'name', 'name1', 'name2', 'attributesCount', 'attributes'];
  const LOG = '[Shades/Volumes Config]';

  if (!location.pathname.startsWith('/admin')) {
    throw Error('Открой Strapi Admin и запусти скрипт в DevTools Console');
  }
  if (window.__tmShadesVolumesConfigRunning) {
    throw Error('Config shades-volumes уже выполняется');
  }
  window.__tmShadesVolumesConfigRunning = true;
  window.shadesVolumesConfigStop = false;

  try {
    const stored = localStorage.getItem('jwtToken');
    if (!stored) throw Error('Не найден jwtToken; войди в Strapi Admin');
    let token;
    try { token = JSON.parse(stored); } catch { token = stored; }
    if (typeof token !== 'string' || !token.trim()) {
      throw Error('Некорректный jwtToken');
    }

    const headers = { Accept: 'application/json', Authorization: 'Bearer ' + token };
    const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const rowsOf = json => Array.isArray(json?.results) ? json.results :
      Array.isArray(json?.data) ? json.data : null;
    const pagingOf = json => json?.pagination ?? json?.meta?.pagination ?? null;
    const flat = item => item?.attributes && !Array.isArray(item.attributes) && !item.documentId
      ? { ...item.attributes, id: item.id } : item;
    const stopped = () => {
      if (window.shadesVolumesConfigStop) throw Error('Остановлено пользователем; CSV не создан');
    };

    async function get(url) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        stopped();
        let response;
        try {
          response = await fetch(url, { method: 'GET', credentials: 'include', headers });
        } catch (error) {
          if (attempt === 3) throw Error('Network error: ' + url.split('?')[0] + ': ' + error.message);
          await sleep(500 * attempt);
          continue;
        }
        if (response.status === 429 || response.status >= 500) {
          if (attempt === 3) throw Error('HTTP ' + response.status + ': ' + url.split('?')[0]);
          await sleep(700 * attempt);
          continue;
        }
        if (!response.ok) {
          throw Error('HTTP ' + response.status + ': ' + url.split('?')[0]);
        }
        try { return await response.json(); }
        catch { throw Error('Content Manager вернул невалидный JSON: ' + url.split('?')[0]); }
      }
    }

    function pageInfo(json, context) {
      const p = pagingOf(json);
      const total = Number(p?.total);
      const count = Number(p?.pageCount);
      if (!p || p.total == null || p.pageCount == null ||
          !Number.isSafeInteger(total) || total < 0 ||
          !Number.isSafeInteger(count) || count < 0 || count > CFG.maxPages ||
          (total > 0 && count === 0) || (total === 0 && count > 1)) {
        throw Error(context + ': неверный pagination.total/pageCount');
      }
      return { total, count };
    }

    function validatePage(json, page, expected, context) {
      const rows = rowsOf(json);
      const p = pagingOf(json);
      const info = pageInfo(json, context);
      if (!rows || info.total !== expected.total || info.count !== expected.count ||
          (p.page != null && Number(p.page) !== page) || rows.length > CFG.pageSize ||
          (info.total > 0 && rows.length === 0)) {
        throw Error(context + ': несоответствие страницы ' + page + '/pagination');
      }
      return rows.map((row, index) => {
        const item = flat(row);
        if (typeof item?.documentId !== 'string' || !item.documentId.trim() ||
            (item.locale != null && item.locale !== CFG.locale)) {
          throw Error(context + ', page ' + page + ', row ' + (index + 1) + ': неверный documentId/locale');
        }
        return item;
      });
    }

    function makeListUrl(page) {
      const params = new URLSearchParams({
        locale: CFG.locale, page: String(page), pageSize: String(CFG.pageSize), sort: 'id:ASC'
      });
      return '/content-manager/collection-types/' + PRODUCT_UID + '?' + params;
    }

    async function readProducts() {
      const first = await get(makeListUrl(1));
      const expected = pageInfo(first, 'Product list');
      const pageCount = Math.max(1, expected.count);
      const pages = new Array(pageCount);
      pages[0] = validatePage(first, 1, expected, 'Product list');
      let cursor = 2;
      let completed = 1;
      let failure = null;
      async function worker() {
        while (cursor <= pageCount && !failure) {
          const page = cursor++;
          try {
            stopped();
            pages[page - 1] = validatePage(
              await get(makeListUrl(page)), page, expected, 'Product list'
            );
            completed++;
            if (completed % 10 === 0 || completed === pageCount) {
              console.log(LOG, 'Загружено страниц Product: ' + completed + '/' + pageCount);
            }
          } catch (error) { failure = error; }
        }
      }
      await Promise.all(Array.from({
        length: Math.min(CFG.listConcurrency, pageCount - 1)
      }, worker));
      if (failure) throw failure;
      const products = pages.flat();
      if (products.length !== expected.total) {
        throw Error('Product list: ожидалось ' + expected.total + ', получено ' + products.length);
      }
      const seen = new Set();
      for (const product of products) {
        if (seen.has(product.documentId)) {
          throw Error('Product list: повторный documentId ' + product.documentId);
        }
        seen.add(product.documentId);
      }
      return products.map(p => p.documentId);
    }

    async function readRelations(productId) {
      const context = 'Product ' + productId + '/attributes';
      const makeUrl = page => {
        const params = new URLSearchParams({
          locale: CFG.locale, page: String(page), pageSize: String(CFG.pageSize)
        });
        return '/content-manager/relations/' + PRODUCT_UID + '/' +
          encodeURIComponent(productId) + '/attributes?' + params;
      };
      const first = await get(makeUrl(1));
      const expected = pageInfo(first, context);
      const totalPages = Math.max(1, expected.count);
      const seen = new Set();
      const all = [];
      const addPage = (json, page) => {
        for (const relation of validatePage(json, page, expected, context)) {
          if (seen.has(relation.documentId)) {
            throw Error(context + ': дублируется relation ' + relation.documentId);
          }
          seen.add(relation.documentId);
          all.push(relation);
        }
      };
      addPage(first, 1);
      for (let page = 2; page <= totalPages; page++) {
        stopped();
        addPage(await get(makeUrl(page)), page);
      }
      if (all.length !== expected.total) {
        throw Error(context + ': ожидалось ' + expected.total + ', получено ' + all.length);
      }
      return all;
    }

    async function detail(uid, documentId) {
      const json = await get('/content-manager/collection-types/' + uid + '/' +
        encodeURIComponent(documentId) + '?locale=' + CFG.locale);
      const raw = json?.data ?? json;
      const items = (Array.isArray(raw) ? raw : [raw]).map(flat).filter(item =>
        item?.documentId === documentId && item?.locale === CFG.locale
      );
      if (items.length !== 1) {
        throw Error(uid + '/' + documentId + ': некорректный detail/locale');
      }
      return items[0];
    }

    // Promise cache предотвращает повторное чтение одного offer параллельными Product.
    const attributeCache = new Map();
    const attributeDetail = id => {
      if (!attributeCache.has(id)) attributeCache.set(id, detail(ATTRIBUTE_UID, id));
      return attributeCache.get(id);
    };

    console.log(LOG, 'Читаю все Product locale=ru...');
    const productIds = await readProducts();
    console.log(LOG, 'Всего Product: ' + productIds.length + '. Проверяю relation attributes...');

    const result = new Array(productIds.length);
    let cursor = 0;
    let checked = 0;
    let eligible = 0;
    let relatedAttributes = 0;
    let missingBarcodes = 0;
    let failure = null;

    async function worker() {
      while (cursor < productIds.length && !failure) {
        const index = cursor++;
        const productId = productIds[index];
        try {
          stopped();
          const relations = await readRelations(productId);
          if (relations.length > 1) {
            const product = await detail(PRODUCT_UID, productId);
            for (const key of ['name', 'name1', 'name2']) {
              if (!own(product, key)) {
                throw Error('Product ' + productId + ': detail не вернул ' + key);
              }
            }
            const attributes = await Promise.all(relations.map(async relation => {
              let barcode = own(relation, 'barcode') ? relation.barcode : undefined;
              if (barcode === undefined) {
                const attribute = await attributeDetail(relation.documentId);
                if (!own(attribute, 'barcode')) {
                  throw Error('Attribute ' + relation.documentId + ': detail не вернул barcode');
                }
                barcode = attribute.barcode;
              }
              if (barcode !== null && typeof barcode !== 'string') {
                throw Error('Attribute ' + relation.documentId + ': barcode не строка/null');
              }
              return { documentId: relation.documentId, barcode: barcode ?? '' };
            }));
            result[index] = {
              documentId: productId,
              name: product.name ?? '',
              name1: product.name1 ?? '',
              name2: product.name2 ?? '',
              attributesCount: relations.length,
              attributes: JSON.stringify(attributes)
            };
            eligible++;
            relatedAttributes += relations.length;
            missingBarcodes += attributes.filter(a => !a.barcode).length;
          }
          checked++;
          if (checked % 100 === 0 || checked === productIds.length) {
            console.log(LOG, 'Проверено ' + checked + '/' + productIds.length +
              '; Product с 2+ attributes: ' + eligible);
          }
        } catch (error) { failure = error; }
      }
    }

    await Promise.all(Array.from({
      length: Math.min(CFG.relationConcurrency, productIds.length)
    }, worker));
    if (failure) throw failure;
    stopped();

    const rows = result.filter(Boolean).sort((a, b) =>
      a.name.localeCompare(b.name, 'ru') || a.documentId.localeCompare(b.documentId)
    );
    if (rows.length !== eligible) throw Error('Внутренняя ошибка: количество кандидатов');
    const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const csv = '\uFEFF' + [
      FIELDS.join(';'),
      ...rows.map(row => FIELDS.map(key => quote(row[key])).join(';'))
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = CFG.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    window.shadesVolumesConfigReport = {
      totalProducts: productIds.length,
      withMultipleAttributes: eligible,
      excludedZeroOrOne: productIds.length - eligible,
      relatedAttributes,
      missingBarcodes,
      filename: CFG.filename
    };
    console.table([window.shadesVolumesConfigReport]);
    console.log(LOG, 'Готово: только GET. Все 2+ relation сохранены для matcher.');
  } catch (error) {
    console.error(LOG, 'Остановлено без частичного CSV:', error);
    throw error;
  } finally {
    window.__tmShadesVolumesConfigRunning = false;
  }
})();
