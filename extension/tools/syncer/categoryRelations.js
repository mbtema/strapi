(async () => {
  'use strict';

  const TAG = '[categoryRelations]';
  const UID = 'api::category.category';
  const PRODUCT_UID = 'api::product.product';
  const BRAND_UID = 'api::brand.brand';
  const FIELDS = ['parent', 'categories', 'product', 'products', 'brand', 'top_brands'];
  const TARGET_UID = {
    parent: UID,
    categories: UID,
    product: PRODUCT_UID,
    products: PRODUCT_UID,
    brand: BRAND_UID,
    top_brands: BRAND_UID
  };
  const PAGE_SIZE = 100;
  const CHUNK_SIZE = 20;
  const RUN_KEY = '__tmCategoryRelationsRunning';
  const route = '/admin/content-manager/collection-types/' + UID + '/';
  const pathname = location.pathname;
  const categoryId = pathname.startsWith(route)
    ? decodeURIComponent(pathname.slice(route.length))
    : '';

  if (!categoryId || categoryId.includes('/')) {
    console.error(TAG, 'Открой запись Category в Strapi Admin');
    return;
  }
  if (window[RUN_KEY]) {
    console.warn(TAG, 'Уже выполняется');
    return;
  }

  window[RUN_KEY] = true;
  delete window.categoryRelationsStop;
  const report = {
    categoryId,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    plan: {},
    skipped: [],
    operations: [],
    published: [],
    errors: [],
    counters: { GET: 0, PUT: 0, POST: 0, retries: 0 },
    pending: null
  };
  window.categoryRelationsReport = report;

  const seenSkips = new Set();
  const schemas = new Map();
  const components = new Map();
  const targetCache = new Map();
  let categorySchema;

  function ensure(condition, reason) {
    if (!condition) throw Error(reason);
  }

  function token() {
    let value = localStorage.getItem('jwtToken');
    try { value = JSON.parse(value); } catch {}
    ensure(typeof value === 'string' && value.trim(), 'Нет Admin jwtToken');
    return value.trim().replace(/^Bearer\s+/i, '');
  }

  function stopCheck() {
    ensure(window.categoryRelationsStop !== true, 'Остановлено пользователем');
  }

  function same(a, b) {
    const normalize = value => JSON.stringify(value, (_, current) =>
      current && typeof current === 'object' && !Array.isArray(current)
        ? Object.fromEntries(Object.keys(current).sort().map(key => [key, current[key]]))
        : current);
    return normalize(a) === normalize(b);
  }

  const idsOf = rows => rows.map(row => row.documentId).sort();
  const names = rows => new Set(idsOf(rows));
  const sortUnique = values => [...new Set(values)].sort();
  const entryPath = (uid, id, locale, status = 'draft') =>
    '/content-manager/collection-types/' + uid + '/' + encodeURIComponent(id) +
    '?locale=' + locale + '&status=' + status;

  async function request(method, path, payload, allow404 = false) {
    const attempts = method === 'GET' ? 3 : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      report.counters[method]++;
      let response, body;
      try {
        response = await fetch(path, {
          method,
          credentials: 'include',
          cache: 'no-store',
          headers: {
            Authorization: 'Bearer ' + token(),
            Accept: 'application/json',
            ...(payload === undefined ? {} : { 'Content-Type': 'application/json' })
          },
          ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
        });
        body = await response.text();
      } catch (error) {
        if (method !== 'GET' || attempt === attempts)
          throw Error(method + ' network ' + path + ': ' + error.message);
        report.counters.retries++;
        await new Promise(resolve => setTimeout(resolve, attempt * 450));
        continue;
      }

      if (response.status === 404 && allow404) return null;
      let data;
      try { data = body ? JSON.parse(body) : null; }
      catch { throw Error('Некорректный JSON: ' + method + ' ' + path); }
      if (response.ok) return data;
      if (method === 'GET' && attempt < attempts &&
          [408, 429, 500, 502, 503, 504].includes(response.status)) {
        report.counters.retries++;
        await new Promise(resolve => setTimeout(resolve, attempt * 600));
        continue;
      }
      throw Error(method + ' HTTP ' + response.status + ' ' + path + ': ' +
        (data?.error?.message || body.slice(0, 180)));
    }
  }

  async function detail(uid, id, locale = 'kk', status = 'draft', optional = false) {
    const data = await request('GET', entryPath(uid, id, locale, status), undefined, optional);
    if (data === null) return null;
    const row = data?.data;
    if (optional && (!row || !Object.keys(row).length)) return null;
    ensure(row && row.documentId === id && row.locale === locale,
      'Неверный ответ ' + uid + '/' + id + '/' + locale + '/' + status);
    if (status === 'published' && !row.publishedAt) return null;
    return row;
  }

  async function relations(uid, id, field, locale, count) {
    if (count === 0) return [];
    const base = '/content-manager/relations/' + uid + '/' +
      encodeURIComponent(id) + '/' + field;
    const result = [];
    const unique = new Set();
    let total = null, pageCount = null;
    for (let page = 1; page <= 10000; page++) {
      const params = new URLSearchParams({
        locale, status: 'draft', page: String(page), pageSize: String(PAGE_SIZE)
      });
      const data = await request('GET', base + '?' + params);
      const pagination = data?.pagination;
      ensure(Array.isArray(data?.results) &&
        Number.isSafeInteger(pagination?.total) && pagination.total >= 0 &&
        Number.isSafeInteger(pagination?.pageCount) && pagination.pageCount >= 0,
        'Некорректная пагинация ' + field + '/' + id);
      if (total === null) {
        total = pagination.total;
        pageCount = pagination.pageCount;
      }
      ensure(total === pagination.total && pageCount === pagination.pageCount,
        'Пагинация изменилась ' + field + '/' + id);
      for (const item of data.results) {
        ensure(typeof item?.documentId === 'string' && item.documentId &&
          Number.isSafeInteger(item.id) && item.id > 0 &&
          !unique.has(item.documentId), 'Некорректная связь ' + field + '/' + id);
        unique.add(item.documentId);
        result.push({ documentId: item.documentId, id: item.id, locale });
      }
      if (page >= pageCount) break;
      ensure(data.results.length > 0, 'Пустая промежуточная страница ' + field);
    }
    ensure(result.length === total && (count == null || result.length === count),
      'Неполный набор связей ' + field + '/' + id);
    return result.sort((a, b) => a.documentId.localeCompare(b.documentId));
  }

  async function links(uid, id, field, locale = 'kk', knownRow = null) {
    const row = knownRow || await detail(uid, id, locale);
    const count = row[field]?.count;
    ensure(Number.isSafeInteger(count) && count >= 0,
      'Нет точного count ' + uid + '/' + id + '/' + field + '/' + locale);
    return relations(uid, id, field, locale, count);
  }

  async function rootSnapshot() {
    const ru = await detail(UID, categoryId, 'ru');
    const kk = await detail(UID, categoryId, 'kk', 'draft', true);
    ensure(kk, 'У Category ' + categoryId + ' отсутствует KK-локаль. Синхронизация остановлена без записей');
    const ruLinks = {}, kkLinks = {};
    for (const field of FIELDS) {
      ruLinks[field] = await links(UID, categoryId, field, 'ru', ru);
      kkLinks[field] = await links(UID, categoryId, field, 'kk', kk);
    }
    return { ru, kk, ruLinks, kkLinks };
  }

  async function target(uid, id) {
    const key = uid + '/' + id;
    if (!targetCache.has(key)) {
      const row = await detail(uid, id, 'kk', 'draft', true);
      targetCache.set(key, row
        ? { id: row.id, documentId: id, locale: 'kk' }
        : null);
    }
    return targetCache.get(key);
  }

  function skip(field, id) {
    const key = field + '/' + id;
    if (seenSkips.has(key)) return;
    seenSkips.add(key);
    report.skipped.push({
      field,
      documentId: id,
      reason: 'Отсутствует KK-локаль связанной записи'
    });
  }

  const system = new Set([
    'id', 'documentId', 'locale', 'status', 'createdAt', 'updatedAt',
    'publishedAt', 'createdBy', 'updatedBy', 'localizations', '__pivot'
  ]);

  function normalizeField(def, raw, label) {
    ensure(raw !== undefined, 'Нет поля ' + label + ' в CMS');
    if (raw === null) return null;
    if (def.type === 'media') {
      const mediaId = item => {
        const id = Number.isSafeInteger(item) ? item : item?.id;
        ensure(Number.isSafeInteger(id) && id > 0, 'Нет media id ' + label);
        return id;
      };
      if (!def.multiple) return mediaId(raw);
      ensure(Array.isArray(raw), 'Неверный media list ' + label);
      return raw.map(mediaId);
    }
    if (def.type === 'component') {
      const convert = (item, name) => normalizeComponent(def.component, item, name);
      if (def.repeatable) {
        ensure(Array.isArray(raw), 'Неверный component list ' + label);
        return raw.map((item, index) => convert(item, label + '[' + index + ']'));
      }
      return convert(raw, label);
    }
    if (def.type === 'dynamiczone') {
      ensure(Array.isArray(raw), 'Неверная dynamic zone ' + label);
      return raw.map((item, index) => {
        ensure(def.components?.includes(item?.__component),
          'Неизвестный компонент ' + label);
        return {
          __component: item.__component,
          ...normalizeComponent(item.__component, item, label + '[' + index + ']')
        };
      });
    }
    if (def.type === 'relation') {
      const count = raw?.count ?? (Array.isArray(raw) ? raw.length : raw?.documentId ? 1 : 0);
      ensure(count === 0, 'Неподдерживаемая вложенная связь ' + label);
      return { connect: [], disconnect: [] };
    }
    ensure([
      'string', 'text', 'richtext', 'email', 'enumeration', 'json',
      'blocks', 'integer', 'biginteger', 'float', 'decimal', 'boolean',
      'date', 'time', 'datetime', 'uid', 'password'
    ].includes(def.type), 'Неизвестный тип поля ' + label + ': ' + def.type);
    return raw;
  }

  function normalizeComponent(uid, raw, label) {
    if (raw == null) return null;
    const component = components.get(uid);
    ensure(component?.attributes, 'Нет схемы компонента ' + uid);
    const result = {};
    for (const [name, def] of Object.entries(component.attributes)) {
      if (system.has(name)) continue;
      result[name] = normalizeField(def, raw[name], label + '.' + name);
    }
    return result;
  }

  function fields(row, uid = UID) {
    const schema = schemas.get(uid);
    ensure(schema?.attributes, 'Нет схемы ' + uid);
    const result = {};
    for (const [name, def] of Object.entries(schema.attributes)) {
      if (system.has(name) || def.type === 'relation') continue;
      result[name] = normalizeField(def, row[name], name);
    }
    return result;
  }

  function publishPayload(row, uid = UID) {
    const schema = schemas.get(uid);
    ensure(schema?.attributes, 'Нет схемы ' + uid);
    const payload = { locale: 'kk' };
    for (const [name, def] of Object.entries(schema.attributes)) {
      if (system.has(name)) continue;
      payload[name] = def.type === 'relation'
        ? { connect: [], disconnect: [] }
        : normalizeField(def, row[name], name);
    }
    return payload;
  }

  async function schemaCheck() {
    const [types, parts] = await Promise.all([
      request('GET', '/content-manager/content-types'),
      request('GET', '/content-manager/components')
    ]);
    ensure(Array.isArray(types?.data) && Array.isArray(parts?.data),
      'Не удалось прочитать схемы CMS');
    for (const type of types.data) schemas.set(type.uid, type);
    for (const part of parts.data) components.set(part.uid, part);
    categorySchema = schemas.get(UID);
    ensure(categorySchema?.attributes, 'Нет схемы Category');
    const expected = {
      parent: ['manyToOne', 'inversedBy', 'categories'],
      categories: ['oneToMany', 'mappedBy', 'parent'],
      product: ['manyToMany', 'mappedBy', 'categories'],
      products: ['oneToMany', 'mappedBy', 'category'],
      brand: ['manyToOne', 'inversedBy', 'categories'],
      top_brands: ['oneToMany', 'mappedBy', 'category']
    };
    for (const [field, [relation, side, opposite]] of Object.entries(expected)) {
      const def = categorySchema.attributes[field];
      ensure(def?.type === 'relation' && def.target === TARGET_UID[field] &&
        def.relation === relation && def[side] === opposite,
        'Изменилась схема Category.' + field);
    }
    const productSchema = schemas.get(PRODUCT_UID)?.attributes;
    const brandSchema = schemas.get(BRAND_UID)?.attributes;
    ensure(productSchema?.category?.relation === 'manyToOne' &&
      productSchema.category.target === UID &&
      productSchema.category.inversedBy === 'products' &&
      productSchema.categories?.inversedBy === 'product' &&
      brandSchema?.category?.relation === 'manyToOne' &&
      brandSchema.category.target === UID &&
      brandSchema.category.inversedBy === 'top_brands' &&
      brandSchema.categories?.mappedBy === 'brand',
      'Изменилась обратная схема Product/Brand');
  }

  async function writeRelation(uid, id, field, connect, disconnect, expected) {
    stopCheck();
    const beforeRU = await detail(uid, id, 'ru', 'draft', uid !== UID);
    const beforeKK = await detail(uid, id, 'kk');
    const ruFields = beforeRU ? fields(beforeRU, uid) : null;
    const ruRelation = uid !== UID && beforeRU
      ? idsOf(await links(uid, id, field, 'ru', beforeRU)) : null;
    const kkFields = fields(beforeKK, uid);
    const previous = await links(uid, id, field, 'kk', beforeKK);
    const nextIds = sortUnique([
      ...previous.filter(item =>
        !disconnect.some(removed => removed.documentId === item.documentId))
        .map(item => item.documentId),
      ...connect.map(item => item.documentId)
    ]);
    ensure(same(nextIds, sortUnique(expected)),
      'План изменился перед записью ' + id + '/' + field);
    const path = '/content-manager/collection-types/' + uid + '/' +
      encodeURIComponent(id) + '?locale=kk';
    const payload = {
      locale: 'kk',
      [field]: { connect, disconnect }
    };
    report.pending = { stage: 'save', uid, id, field, expected: nextIds };
    let writeError = null;
    try { await request('PUT', path, payload); }
    catch (error) { writeError = error; }
    const afterRU = await detail(uid, id, 'ru', 'draft', uid !== UID);
    const afterKK = await detail(uid, id, 'kk');
    ensure(same(afterRU ? fields(afterRU, uid) : null, ruFields) &&
      same(fields(afterKK, uid), kkFields),
      'ПОСЛЕ ЗАПИСИ изменились поля RU или KK: ' + uid + '/' + id + '/' + field +
      '. Остановлено, проверь исходные значения в CMS');
    if (uid !== UID && beforeRU) {
      const actualRU = idsOf(await links(uid, id, field, 'ru', afterRU));
      ensure(same(actualRU, ruRelation),
        'KK Save изменил RU relation ' + uid + '/' + id + '/' + field);
    }
    const actual = idsOf(await links(uid, id, field, 'kk', afterKK));
    ensure(same(actual, nextIds),
      'Связь ' + id + '/' + field + ' не совпала после PUT' +
      (writeError ? ': ' + writeError.message : ''));
    if (writeError) console.warn(TAG, 'PUT вернул ошибку, но GET подтвердил изменение', id, field);
    report.operations.push({
      uid, documentId: id, field, connect: connect.length,
      disconnect: disconnect.length, verified: true
    });
    report.pending = null;
    console.log(TAG, 'Сохранено', uid, id, field, '+' + connect.length, '-' + disconnect.length);
  }

  async function publish(uid, id, changedFields) {
    stopCheck();
    const previousPublished = await detail(uid, id, 'kk', 'published', true);
    const row = await detail(uid, id, 'kk');
    const beforeRU = await detail(uid, id, 'ru', 'draft', uid !== UID);
    const beforeFields = fields(row, uid);
    const ruFields = beforeRU ? fields(beforeRU, uid) : null;
    const ruRelations = uid !== UID && beforeRU
      ? Object.fromEntries(await Promise.all(changedFields.map(async field =>
          [field, idsOf(await links(uid, id, field, 'ru', beforeRU))])))
      : null;
    const payload = publishPayload(row, uid);
    const path = '/content-manager/collection-types/' + uid + '/' +
      encodeURIComponent(id) + '/actions/publish?locale=kk';
    report.pending = { stage: 'publish', uid, id, changedFields };
    let writeError = null;
    try { await request('POST', path, payload); }
    catch (error) { writeError = error; }
    const draft = await detail(uid, id, 'kk');
    const ruAfter = await detail(uid, id, 'ru', 'draft', uid !== UID);
    const published = await detail(uid, id, 'kk', 'published', true);
    ensure(published?.publishedAt && published.publishedAt !== previousPublished?.publishedAt,
      'Не удалось подтвердить новую KK Published версию: ' + uid + '/' + id +
      (writeError ? ': ' + writeError.message : ''));
    ensure(same(fields(draft, uid), beforeFields) &&
      same(ruAfter ? fields(ruAfter, uid) : null, ruFields),
      'Publish изменил поля RU/KK: ' + uid + '/' + id);
    if (ruRelations) {
      for (const [field, beforeIds] of Object.entries(ruRelations)) {
        const afterIds = idsOf(await links(uid, id, field, 'ru', ruAfter));
        ensure(same(beforeIds, afterIds),
          'KK Publish изменил RU relation ' + uid + '/' + id + '/' + field);
      }
    }
    for (const field of changedFields) {
      const actual = idsOf(await links(uid, id, field, 'kk', draft));
      const targetIds = idsOf(await links(uid, id, field, 'kk', row));
      ensure(same(actual, targetIds), 'Draft связи изменились при Publish: ' + uid + '/' + id + '/' + field);
    }
    report.published.push({ uid, documentId: id });
    report.pending = null;
    if (writeError) console.warn(TAG, 'POST вернул ошибку, но Published подтверждён', uid, id);
    console.log(TAG, 'Опубликовано KK', uid, id);
  }

  function outputSkips() {
    report.skipped.sort((a, b) =>
      a.field.localeCompare(b.field) || a.documentId.localeCompare(b.documentId));
    if (!report.skipped.length) {
      console.log(TAG, 'Пропущенных связей без KK-локали: 0');
      return;
    }
    console.warn(TAG, 'Пропущены связи без KK-локали: ' + report.skipped.length);
    console.table(report.skipped);
    const columns = ['field', 'documentId', 'reason'];
    const csv = '\uFEFF' + columns.join(';') + '\n' +
      report.skipped.map(row => columns.map(key =>
        '"' + String(row[key]).replace(/"/g, '""') + '"').join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = 'category-relations-missing-kk.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  try {
    stopCheck();
    await schemaCheck();
    const root = await rootSnapshot();
    const rootId = { id: root.kk.id, documentId: categoryId, locale: 'kk' };
    ensure(Number.isSafeInteger(rootId.id) && rootId.id > 0, 'Нет numeric id текущей KK Category');

    const desired = {};
    for (const field of FIELDS) {
      desired[field] = [];
      const targetUid = TARGET_UID[field];
      const current = names(root.kkLinks[field]);
      if (field === 'products') {
        ensure(root.ruLinks.products.length === 0,
          'RU Category.products не пусто: сначала требуется восстановить legacy-нормализацию RU');
      }
      for (const item of field === 'products' ? [] : root.ruLinks[field]) {
        if (current.has(item.documentId)) {
          desired[field].push(item.documentId);
          continue;
        }
        const match = await target(targetUid, item.documentId);
        if (match) desired[field].push(item.documentId);
        else skip(field, item.documentId);
      }
      desired[field] = sortUnique(desired[field]);
      const old = idsOf(root.kkLinks[field]);
      report.plan[field] = {
        ru: root.ruLinks[field].length,
        kk: old.length,
        add: desired[field].filter(id => !old.includes(id)).length,
        disconnect: old.filter(id => !desired[field].includes(id)).length
      };
    }

    const parentAdd = desired.parent.filter(id =>
      !names(root.kkLinks.parent).has(id));
    const parentRemove = root.kkLinks.parent.filter(row =>
      !desired.parent.includes(row.documentId));
    const brandAdd = desired.brand.filter(id =>
      !names(root.kkLinks.brand).has(id));
    const brandRemove = root.kkLinks.brand.filter(row =>
      !desired.brand.includes(row.documentId));
    const productAdd = desired.product.filter(id =>
      !names(root.kkLinks.product).has(id));
    const productRemove = root.kkLinks.product.filter(row =>
      !desired.product.includes(row.documentId));
    const categoryAdd = desired.categories.filter(id =>
      !names(root.kkLinks.categories).has(id));
    const categoryRemove = root.kkLinks.categories.filter(row =>
      !desired.categories.includes(row.documentId));

    const childChanges = [];
    for (const id of categoryAdd) childChanges.push({ id, added: true });
    for (const row of categoryRemove) childChanges.push({ id: row.documentId, added: false });
    childChanges.sort((a, b) => a.id.localeCompare(b.id));

    for (const change of childChanges) {
      const childRU = await detail(UID, change.id, 'ru');
      const childKK = await detail(UID, change.id, 'kk');
      const sourceParents = idsOf(await links(UID, change.id, 'parent', 'ru', childRU));
      const targetParents = await links(UID, change.id, 'parent', 'kk', childKK);
      if (change.added) {
        ensure(sourceParents.includes(categoryId),
          'RU child.parent не указывает на текущую Category: ' + change.id);
      } else {
        ensure(targetParents.some(row => row.documentId === categoryId),
          'KK child.parent изменился до preflight: ' + change.id);
      }
      change.previous = targetParents;
    }

    const inverseChanges = [];
    for (const [field, uid] of [['products', PRODUCT_UID], ['top_brands', BRAND_UID]]) {
      const have = new Set(idsOf(root.kkLinks[field]));
      for (const id of sortUnique([
        ...desired[field].filter(value => !have.has(value)),
        ...root.kkLinks[field].map(row => row.documentId)
          .filter(value => !desired[field].includes(value))
      ])) {
        const added = desired[field].includes(id);
        const row = await detail(uid, id, 'kk');
        const previous = idsOf(await links(uid, id, 'category', 'kk', row));
        if (added) {
          ensure(field === 'top_brands',
            'Legacy products запрещено добавлять');
          const ruBrand = await detail(uid, id, 'ru');
          const source = idsOf(await links(uid, id, 'category', 'ru', ruBrand));
          ensure(same(source, [categoryId]),
            'RU Brand.category не указывает на Category ' + categoryId + ': ' + id);
          ensure(!previous.includes(categoryId),
            'KK Brand.category уже связан, но Category.top_brands не совпадает: ' + id);
        } else {
          ensure(same(previous, [categoryId]),
            'Обратная KK связь ' + uid + '.category изменилась: ' + id);
        }
        publishPayload(row, uid);
        inverseChanges.push({
          field, uid, id, added, previous, expected: added ? [categoryId] : []
        });
      }
    }

    console.table(Object.entries(report.plan).map(([field, values]) => ({
      field, ...values
    })));
    if (report.skipped.length) console.table(report.skipped);

    const changes = Object.values(report.plan)
      .reduce((total, item) => total + item.add + item.disconnect, 0);
    const existingPublication = await detail(UID, categoryId, 'kk', 'published', true);
    if (!changes && existingPublication && root.kk.status !== 'modified') {
      report.status = report.skipped.length ? 'partial' : 'completed';
    } else if (!confirm(
      'Category ' + categoryId + '\n' +
      'RU → KK: ' + FIELDS.join(', ') + '\n' +
      'Добавить: ' + Object.values(report.plan).reduce((n, v) => n + v.add, 0) +
      ', удалить лишних: ' +
      Object.values(report.plan).reduce((n, v) => n + v.disconnect, 0) +
      '\nПропустить без KK: ' + report.skipped.length +
      '\nОчистка legacy products и синхронизация Brand могут изменить KK Product/Brand.' +
      '\nСохранить и опубликовать затронутые KK Product, Brand и Category?'
    )) {
      report.status = 'cancelled';
    } else {
      if (parentAdd.length || parentRemove.length) {
        const connect = [];
        for (const id of parentAdd) connect.push(await target(UID, id));
        await writeRelation(UID, categoryId, 'parent', connect, parentRemove, desired.parent);
      }

      if (productAdd.length || productRemove.length) {
        const operations = [
          ...productRemove.map(value => ({ type: 'disconnect', value })),
          ...await Promise.all(productAdd.map(async id => ({
            type: 'connect', value: await target(PRODUCT_UID, id)
          })))
        ];
        let updated = idsOf(root.kkLinks.product);
        for (let index = 0; index < operations.length; index += CHUNK_SIZE) {
          const batch = operations.slice(index, index + CHUNK_SIZE);
          const connect = batch.filter(item => item.type === 'connect').map(item => item.value);
          const disconnect = batch.filter(item => item.type === 'disconnect').map(item => item.value);
          updated = sortUnique([
            ...updated.filter(id => !disconnect.some(item => item.documentId === id)),
            ...connect.map(item => item.documentId)
          ]);
          await writeRelation(UID, categoryId, 'product', connect, disconnect, updated);
        }
      }

      if (brandAdd.length || brandRemove.length) {
        const connect = [];
        for (const id of brandAdd) connect.push(await target(BRAND_UID, id));
        await writeRelation(UID, categoryId, 'brand', connect, brandRemove, desired.brand);
      }

      for (const child of childChanges) {
        stopCheck();
        const row = await detail(UID, child.id, 'kk');
        const previous = await links(UID, child.id, 'parent', 'kk', row);
        const expected = child.added ? [categoryId] : [];
        const connect = child.added ? [rootId] : [];
        if (same(idsOf(previous), expected)) continue;
        await writeRelation(UID, child.id, 'parent', connect, previous, expected);
        const actual = idsOf(await links(UID, categoryId, 'categories', 'kk'));
        ensure(actual.includes(child.id) === child.added,
          'Обратная связь categories не обновилась: ' + child.id);
        await publish(UID, child.id, ['parent']);
      }

      for (const change of inverseChanges) {
        stopCheck();
        const row = await detail(change.uid, change.id, 'kk');
        const previous = await links(change.uid, change.id, 'category', 'kk', row);
        ensure(same(idsOf(previous), change.previous),
          'Обратная KK связь изменилась до записи: ' + change.uid + '/' + change.id);
        const connect = change.added ? [rootId] : [];
        const disconnect = previous.filter(item => !change.expected.includes(item.documentId));
        await writeRelation(change.uid, change.id, 'category',
          connect, disconnect, change.expected);
        const actualRoot = idsOf(await links(UID, categoryId, change.field, 'kk'));
        ensure(actualRoot.includes(change.id) === change.added,
          'Обратная связь Category.' + change.field + ' не обновилась: ' + change.id);
        await publish(change.uid, change.id, ['category']);
      }

      const finalLinks = {};
      for (const field of FIELDS)
        finalLinks[field] = idsOf(await links(UID, categoryId, field, 'kk'));
      for (const field of FIELDS)
        ensure(same(finalLinks[field], desired[field]),
          'Итоговая KK связь ' + field + ' не совпала с планом');

      const updatedRoot = await detail(UID, categoryId, 'kk');
      if (changes || !existingPublication || updatedRoot.status === 'modified')
        await publish(UID, categoryId, FIELDS);

      for (const field of FIELDS) {
        const finalIds = idsOf(await links(UID, categoryId, field, 'kk'));
        ensure(same(finalIds, desired[field]), 'Проверка после Publish: ' + field);
      }
      report.status = report.skipped.length ? 'partial' : 'completed';
    }
  } catch (error) {
    report.status = 'stopped';
    report.errors.push(error.message);
    console.error(TAG, 'ОСТАНОВЛЕНО:', error.message, 'documentId:', categoryId);
  } finally {
    report.finishedAt = new Date().toISOString();
    try { outputSkips(); }
    catch (error) { console.error(TAG, 'Ошибка экспорта CSV:', error.message); }
    window[RUN_KEY] = false;
    console.log(TAG, 'Итог:', report.status, report.counters,
      'пропущено:', report.skipped.length, 'опубликовано:', report.published.length);
    console.log(TAG, 'Детали: window.categoryRelationsReport');
  }
})();
