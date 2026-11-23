(async () => {
  'use strict';

  const CFG = {
    locale: 'ru',
    pageSize: 100,
    concurrency: 12,
    httpConcurrency: 8,
    maxAttempts: 4,
    checkpointEvery: 50,
    filename: 'products-config.csv',
    issuesFilename: 'products-config-issues.csv'
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

  let activeHttp = 0;
  const httpQueue = [];
  let requestCount = 0;
  let retryCount = 0;
  const startedAt = performance.now();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  function withHttpSlot(task) {
    return new Promise((resolve, reject) => {
      const run = () => {
        activeHttp++;
        Promise.resolve().then(task).then(resolve, reject).finally(() => {
          activeHttp--;
          if (httpQueue.length) httpQueue.shift()();
        });
      };
      if (activeHttp < CFG.httpConcurrency) run();
      else httpQueue.push(run);
    });
  }
  async function get(url) {
    return withHttpSlot(async () => {
      for (let attempt = 1; attempt <= CFG.maxAttempts; attempt++) {
        let response;
        requestCount++;
        try {
          response = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers,
            signal: AbortSignal.timeout(30000)
          });
        } catch (error) {
          if (attempt === CFG.maxAttempts) {
            throw Error('GET не выполнен после ' + attempt +
              ' попыток: ' + url.split('?')[0] + '; ' + error.message);
          }
          retryCount++;
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }
        if (response.ok) return response.json();
        if (![429, 500, 502, 503, 504].includes(response.status) ||
            attempt === CFG.maxAttempts) {
          throw Error('HTTP ' + response.status + ': ' + url.split('?')[0]);
        }
        retryCount++;
        const retryAfter = Number(response.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(10000, retryAfter * 1000)
          : 500 * 2 ** (attempt - 1);
        await sleep(delay);
      }
    });
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
  let expectedTotal = null;
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
    const pagination = pageOf(json);
    pages = Number(pagination?.pageCount);
    const total = Number(pagination?.total);
    if (Number.isSafeInteger(total) && total >= 0) {
      if (expectedTotal === null) expectedTotal = total;
      else if (total !== expectedTotal) {
        throw Error('Количество Product изменилось во время обхода списка');
      }
    }
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
  if (expectedTotal !== null && ids.length !== expectedTotal) {
    throw Error('Список Product неполный: уникальных ' + ids.length +
      ', pagination.total=' + expectedTotal);
  }

  function catalogFingerprint(values) {
    let hash = 2166136261;
    for (const value of values) {
      for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      hash ^= 10;
      hash = Math.imul(hash, 16777619);
    }
    return CFG.locale + ':' + values.length + ':' + (hash >>> 0).toString(16);
  }
  async function openCheckpoint(values) {
    const prefix = catalogFingerprint(values) + ':';
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('tm-products-config', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('rows')) {
          req.result.createObjectStore('rows', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return {
      async load() {
        return new Promise((resolve, reject) => {
          const tx = db.transaction('rows', 'readonly');
          const request = tx.objectStore('rows').getAll(
            IDBKeyRange.bound(prefix, prefix + '\uffff'));
          request.onsuccess = () => resolve(new Map(
            request.result.map(record => [record.documentId, record])));
          request.onerror = () => reject(request.error);
        });
      },
      async save(records) {
        if (!records.length) return;
        await new Promise((resolve, reject) => {
          const tx = db.transaction('rows', 'readwrite');
          const store = tx.objectStore('rows');
          for (const record of records) {
            store.put({ ...record, key: prefix + record.documentId });
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      },
      async clear() {
        await new Promise((resolve, reject) => {
          const tx = db.transaction('rows', 'readwrite');
          const request = tx.objectStore('rows').openCursor(
            IDBKeyRange.bound(prefix, prefix + '\uffff'));
          request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) { cursor.delete(); cursor.continue(); }
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      }
    };
  }

  const checkpoint = await openCheckpoint(ids);
  const restored = await checkpoint.load();
  const result = new Array(ids.length);
  const issuesByProduct = new Array(ids.length);
  let cursor = 0;
  let done = 0;
  let restoredCount = 0;
  let issueCount = 0;
  const dirty = [];
  let saveChain = Promise.resolve();
  async function flushCheckpoint() {
    const batch = dirty.splice(0);
    if (!batch.length) return;
    saveChain = saveChain.then(() => checkpoint.save(batch));
    await saveChain;
  }
  let withoutAttributes = 0;
  let withoutCategories = 0;
  let failed = null;
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  for (let i = 0; i < ids.length; i++) {
    const saved = restored.get(ids[i]);
    if (!saved || saved.row?.documentId !== ids[i] ||
        !Array.isArray(saved.issues) || saved.issues.length) continue;
    result[i] = saved.row;
    issuesByProduct[i] = saved.issues;
    done++;
    restoredCount++;
    issueCount += saved.issues.length;
    if (!saved.row.attributes) withoutAttributes++;
    if (!saved.row.categories) withoutCategories++;
  }
  console.log('[Config] Checkpoint: восстановлено ' + restoredCount +
    '/' + ids.length + ' Product. Для новых строк действует лимит ' +
    CFG.httpConcurrency + ' одновременных GET.');

  async function worker() {
    while (cursor < ids.length && !failed) {
      const index = cursor++;
      if (result[index]) continue;
      const id = ids[index];
      try {
        const issues = [];
        const issue = (relation, relatedDocumentId, code) => {
          issues.push({ documentId: id, relation, relatedDocumentId, code });
        };
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
              issue('attributes', relation.documentId, 'ATTRIBUTE_BARCODE_MISSING');
            continue;
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
            issue('categories', relation.documentId, 'CATEGORY_CUSTOM_UNKNOWN');
            continue;
          }
          if (category.custom) continue;
          if (category.bitrix_id == null || !String(category.bitrix_id).trim()) {
            category = await relatedDetail(CATEGORY_UID, relation.documentId);
          }
          if (category.bitrix_id == null || !String(category.bitrix_id).trim()) {
            issue('categories', relation.documentId, 'CATEGORY_BITRIX_ID_MISSING');
            continue;
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
        issuesByProduct[index] = issues;
        if (!values.length) withoutAttributes++;
        if (!categoryValues.length) withoutCategories++;
        issueCount += issues.length;
        dirty.push({ documentId: id, row: result[index], issues });
        done++;
        if (dirty.length >= CFG.checkpointEvery) await flushCheckpoint();
        if (done % 50 === 0 || done === ids.length) {
          const freshDone = done - restoredCount;
          const elapsed = (performance.now() - startedAt) / 1000;
          const eta = freshDone > 0
            ? Math.round(elapsed * (ids.length - done) / freshDone)
            : null;
          console.log('[Config] Проверено ' + done + '/' + ids.length +
            '; без barcode ' + withoutAttributes +
            '; без категорий custom=false ' + withoutCategories +
            '; проблемных связей ' + issueCount +
            '; GET ' + requestCount + ', повторов ' + retryCount +
            (eta === null ? '' : '; ETA ~' + Math.round(eta / 60) + ' мин'));
        }
      } catch (error) {
        failed = error;
        break;
      }
    }
  }

  await Promise.all(Array.from({
    length: Math.min(CFG.concurrency, ids.length)
  }, worker));
  await flushCheckpoint();
  if (failed) {
    console.error('[Config] Прогресс сохранён: ' + done + '/' + ids.length +
      '. Повтори тот же скрипт для продолжения после исправления ошибки.');
    throw failed;
  }
  if (result.filter(Boolean).length !== ids.length) {
    throw Error('Неполный результат после worker; checkpoint сохранён');
  }

  const products = result.sort((a, b) =>
    String(a.name).localeCompare(String(b.name), 'ru') ||
    a.documentId.localeCompare(b.documentId)
  );
  const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
  function downloadCsv(filename, columns, rows) {
    const csv = '\uFEFF' + [
      columns.join(';'),
      ...rows.map(row => columns.map(field => quote(row[field])).join(';'))
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], {
      type: 'text/csv;charset=utf-8'
    }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  downloadCsv(CFG.filename, FIELDS, products);
  const issues = issuesByProduct.flatMap(x => x ?? []);
  if (issues.length) {
    console.warn('[Config] Проблемных связей: ' + issues.length +
      '. Они пропущены ТОЛЬКО в соответствующих полях CSV; исправь их перед Matcher.');
    console.table(issues.slice(0, 20));
    setTimeout(() => downloadCsv(CFG.issuesFilename,
      ['documentId','relation','relatedDocumentId','code'], issues), 750);
  }
  await checkpoint.clear();

  console.log('[Config] Итог:');
  console.table([{
    products: products.length,
    withBarcode: products.length - withoutAttributes,
    withoutBarcode: withoutAttributes,
    withBitrixCategories: products.length - withoutCategories,
    withoutBitrixCategories: withoutCategories,
    columns: FIELDS.join(', '),
    issues: issueCount,
    restored: restoredCount,
    requests: requestCount,
    retries: retryCount,
    file: CFG.filename
  }]);
  console.log('[Config] Готово. Только GET; изменений в Strapi нет.');
  console.log('[Config] CSV совместим с migrator/products/matcher.js (12 колонок).');
  if (issueCount) console.warn('[Config] Есть неполные связи. Сверь ' +
    CFG.issuesFilename + ' до Matcher.');
})();
