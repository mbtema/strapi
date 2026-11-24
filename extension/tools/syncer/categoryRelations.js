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
  const INTEGRITY_IGNORE = {
    [UID]: new Set(['key']),
    [PRODUCT_UID]: new Set(['InStock', 'inStock'])
  };
  const PAGE_SIZE = 100;
  const RUN_KEY = '__tmCategoryRelationsRunning';
  if (window[RUN_KEY]) {
    console.warn(TAG, 'Уже выполняется');
    return;
  }
  window[RUN_KEY] = true;
  delete window.categoryRelationsStop;

  async function normalize(categoryId, bulk = false) {
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
      integrityDiffs: [],
      ignoredIntegrityDiffs: [],
      unpublishedRelations: [],
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
      ensure(bulk || window.categoryRelationsStop !== true, 'Остановлено пользователем');
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

    async function relations(uid, id, field, locale, count, status = 'draft') {
      if (count === 0) return [];
      const base = '/content-manager/relations/' + uid + '/' +
        encodeURIComponent(id) + '/' + field;
      const result = [];
      const unique = new Set();
      let total = null, pageCount = null;
      for (let page = 1; page <= 10000; page++) {
        const params = new URLSearchParams({
          locale, status, page: String(page), pageSize: String(PAGE_SIZE)
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
            (!item.locale || item.locale === locale) &&
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

    async function links(uid, id, field, locale = 'kk', knownRow = null, status = 'draft') {
      const row = knownRow || await detail(uid, id, locale, status);
      const count = row[field]?.count;
      ensure(Number.isSafeInteger(count) && count >= 0,
        'Нет точного count ' + uid + '/' + id + '/' + field + '/' + locale);
      return relations(uid, id, field, locale, count, status);
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

    function normalizeField(def, raw, label, forWrite = false) {
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
        const convert = (item, name) => normalizeComponent(def.component, item, name, forWrite);
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
            ...normalizeComponent(item.__component, item, label + '[' + index + ']', forWrite)
          };
        });
      }
      if (def.type === 'relation') {
        const count = raw?.count ?? (Array.isArray(raw) ? raw.length : raw?.documentId ? 1 : 0);
        if (!forWrite) return raw;
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

    function normalizeComponent(uid, raw, label, forWrite = false) {
      if (raw == null) return null;
      const component = components.get(uid);
      ensure(component?.attributes, 'Нет схемы компонента ' + uid);
      const result = {};
      if (forWrite) {
        ensure(Number.isSafeInteger(raw.id) && raw.id > 0, 'Нет id компонента ' + label);
        result.id = raw.id;
      }
      for (const [name, def] of Object.entries(component.attributes)) {
        if (system.has(name)) continue;
        result[name] = normalizeField(def, raw[name], label + '.' + name, forWrite);
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
      const payload = {};
      for (const [name, def] of Object.entries(schema.attributes)) {
        if (system.has(name)) continue;
        payload[name] = def.type === 'relation'
          ? { connect: [], disconnect: [] }
          : normalizeField(def, row[name], name, true);
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

    function checkIntegrity(stage, uid, id, relation, beforeRU, afterRU, beforeKK, afterKK) {
      let differences = [];
      for (const [locale, before, after] of [
        ['ru', beforeRU, afterRU],
        ['kk', beforeKK, afterKK]
      ]) {
        if (same(before, after)) continue;
        if (before == null || after == null) {
          differences.push({ locale, field: '$record', before, after });
          continue;
        }
        for (const field of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
          if (!same(before[field], after[field])) differences.push({
            locale, field,
            before: Object.hasOwn(before, field) ? before[field] : { missing: true },
            after: Object.hasOwn(after, field) ? after[field] : { missing: true }
          });
        }
      }
      const ignored = differences.filter(item => INTEGRITY_IGNORE[uid]?.has(item.field));
      if (ignored.length) {
        const warning = { stage, uid, documentId: id, relation, categoryId,
          capturedAt: new Date().toISOString(), differences: ignored };
        report.ignoredIntegrityDiffs.push(warning);
        console.warn(TAG, 'Игнорируемые изменения полей', warning);
        differences = differences.filter(item => !INTEGRITY_IGNORE[uid]?.has(item.field));
      }
      if (!differences.length) return;
      const diagnostic = {
        stage, uid, documentId: id, relation, categoryId,
        capturedAt: new Date().toISOString(), differences
      };
      report.integrityDiffs.push(diagnostic);
      console.error(TAG, 'Расхождения целостности', diagnostic);
      console.table(differences.map(({ locale, field, before, after }) => ({
        locale, field, before: JSON.stringify(before), after: JSON.stringify(after)
      })));
      const fieldsList = differences.map(item => item.locale + '.' + item.field).join(', ');
      throw Error('После ' + stage + ' изменились поля ' + uid + '/' + id + ': ' + fieldsList);
    }

    function downloadIntegrity() {
      if (!report.integrityDiffs.length) return;
      const data = {
        categoryId, status: report.status, pending: report.pending,
        differences: report.integrityDiffs, ignoredDifferences: report.ignoredIntegrityDiffs,
        errors: report.errors
      };
      const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json;charset=utf-8'
      }));
      const link = document.createElement('a');
      link.href = href;
      link.download = 'category-relations-integrity-' + categoryId + '.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    }

    async function snapshot(uid, id, relationFields = []) {
      const result = {};
      for (const locale of ['ru', 'kk']) {
        for (const status of ['draft', 'published']) {
          const row = await detail(uid, id, locale, status, true);
          const key = locale + '/' + status;
          if (!row) {
            result[key] = null;
            continue;
          }
          const relationIds = {};
          for (const field of relationFields)
            relationIds[field] = idsOf(await links(uid, id, field, locale, row, status));
          result[key] = { row, fields: fields(row, uid), relations: relationIds };
        }
      }
      return result;
    }

    function verifySnapshot(stage, uid, id, relation, before, after) {
      for (const status of ['draft', 'published']) {
        const ru = 'ru/' + status, kk = 'kk/' + status;
        checkIntegrity(stage + ' ' + status, uid, id, relation,
          before[ru]?.fields ?? null, after[ru]?.fields ?? null,
          before[kk]?.fields ?? null, after[kk]?.fields ?? null);
      }
    }

    async function prepareChanges(root, desired) {
      const delta = {}, affected = new Map();
      for (const field of FIELDS) {
        const current = names(root.kkLinks[field]);
        const connect = [], disconnect = root.kkLinks[field]
          .filter(row => !desired[field].includes(row.documentId));
        for (const id of desired[field].filter(id => !current.has(id))) {
          const row = await target(TARGET_UID[field], id);
          ensure(row, 'KK target исчез: ' + field + '/' + id);
          connect.push({ ...row, isTemporary: true });
        }
        delta[field] = { connect, disconnect };
        for (const row of [...connect, ...disconnect]) {
          const uid = TARGET_UID[field], id = row.documentId;
          ensure(uid !== UID || id !== categoryId, 'Category не может ссылаться на себя');
          const key = uid + '/' + id;
          if (!affected.has(key)) affected.set(key, { uid, id, fields: [] });
          affected.get(key).fields.push(field);
        }
      }
      return { delta, affected: [...affected.values()] };
    }

    async function captureTargets(affected) {
      for (const item of affected) {
        item.before = await snapshot(item.uid, item.id);
        ensure(item.before['kk/draft'], 'KK target исчез: ' + item.uid + '/' + item.id);
      }
    }

    function expectedPublishedFields(before, after) {
      const expected = { ...before['kk/draft'].fields };
      const actual = after['kk/published']?.fields;
      const previousKey = before['kk/published']?.fields.key;
      const ruKey = before['ru/published']?.fields.key;
      if (expected.key === null && typeof actual?.key === 'string' && actual.key.trim()) {
        if (previousKey === actual.key || (previousKey == null && ruKey === actual.key))
          expected.key = actual.key;
      }
      return expected;
    }

    async function verifyPublishedLinks(actual, desired) {
      const missingVersions = new Map();
      for (const field of FIELDS) {
        const have = actual[field];
        const want = desired[field];
        ensure(Array.isArray(have) && have.every(id => want.includes(id)),
          'Лишние KK published связи: ' + field);
        for (const id of want.filter(id => !have.includes(id))) {
          const uid = TARGET_UID[field], key = uid + '/' + id;
          if (!missingVersions.has(key))
            missingVersions.set(key, !(await detail(uid, id, 'kk', 'published', true)));
          ensure(missingVersions.get(key),
            'Отсутствует связь с опубликованной KK записью: ' + field + '/' + id);
          report.unpublishedRelations.push({ field, documentId: id });
        }
      }
      if (report.unpublishedRelations.length) {
        console.log(TAG, 'Связи с неопубликованными KK записями сохранены в Draft:',
          report.unpublishedRelations.length);
        console.table(report.unpublishedRelations);
      }
    }

    async function publishCategory(root, desired, delta, affected) {
      stopCheck();
      const before = await snapshot(UID, categoryId, FIELDS);
      for (const locale of ['ru', 'kk']) {
        const draft = before[locale + '/draft'];
        ensure(draft && same(draft.fields, fields(root[locale])) &&
          FIELDS.every(field => same(draft.relations[field], idsOf(root[locale + 'Links'][field]))),
          'Category изменилась после расчёта плана: ' + locale);
      }
      const kk = before['kk/draft'];
      const payload = { ...publishPayload(kk.row), ...delta };
      const path = '/content-manager/collection-types/' + UID + '/' +
        encodeURIComponent(categoryId) + '/actions/publish?locale=kk';
      report.pending = { stage: 'publish', uid: UID, id: categoryId, expected: desired };
      await request('POST', path, payload);
      const after = await snapshot(UID, categoryId, FIELDS);
      checkIntegrity('Publish draft', UID, categoryId, FIELDS,
        before['ru/draft'].fields, after['ru/draft']?.fields ?? null,
        kk.fields, after['kk/draft']?.fields ?? null);
      checkIntegrity('Publish published', UID, categoryId, FIELDS,
        before['ru/published']?.fields ?? null, after['ru/published']?.fields ?? null,
        expectedPublishedFields(before, after), after['kk/published']?.fields ?? null);
      ensure(after['kk/published']?.row.publishedAt &&
        after['kk/published'].row.publishedAt !== before['kk/published']?.row.publishedAt,
        'Не удалось подтвердить новую KK Published версию');
      for (const status of ['draft', 'published']) {
        const ru = 'ru/' + status, key = 'kk/' + status;
        ensure(same(before[ru]?.relations ?? null, after[ru]?.relations ?? null),
          'Изменились RU ' + status + ' связи Category');
        if (status === 'draft') {
          for (const field of FIELDS)
            ensure(same(after[key]?.relations[field], desired[field]),
              'Итоговая KK draft связь не совпала: ' + field);
        } else {
          await verifyPublishedLinks(after[key].relations, desired);
        }
      }
      for (const item of affected) {
        const actual = await snapshot(item.uid, item.id);
        verifySnapshot('Publish Category', item.uid, item.id, item.fields, item.before, actual);
      }
      for (const field of FIELDS) {
        const { connect, disconnect } = delta[field];
        if (connect.length || disconnect.length)
          report.operations.push({
            uid: UID, documentId: categoryId, field,
            connect: connect.length, disconnect: disconnect.length, verified: true
          });
      }
      report.published.push({ uid: UID, documentId: categoryId });
      report.pending = null;
      console.log(TAG, 'Опубликована и проверена KK Category', categoryId,
        'связанных записей проверено:', affected.length);
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

      console.table(Object.entries(report.plan).map(([field, values]) => ({
        field, ...values
      })));
      if (report.skipped.length) console.table(report.skipped);

      const changes = Object.values(report.plan)
        .reduce((total, item) => total + item.add + item.disconnect, 0);
      const existingPublication = await detail(UID, categoryId, 'kk', 'published', true);
      if (!changes && existingPublication && root.kk.status !== 'modified') {
        report.status = report.skipped.length ? 'partial' : 'completed';
      } else if (!bulk && !confirm(
        'Category ' + categoryId + '\n' +
        'RU → KK: ' + FIELDS.join(', ') + '\n' +
        'Добавить: ' + Object.values(report.plan).reduce((n, v) => n + v.add, 0) +
        ', удалить лишних: ' +
        Object.values(report.plan).reduce((n, v) => n + v.disconnect, 0) +
        '\nПропустить без KK: ' + report.skipped.length +
        '\nИзменятся только связи через KK Category, без отдельных записей Product и Brand.' +
        '\nОпубликовать KK Category?'
      )) {
        report.status = 'cancelled';
      } else {
        const { delta, affected } = await prepareChanges(root, desired);
        await captureTargets(affected);
        await publishCategory(root, desired, delta, affected);
        report.status = report.skipped.length ? 'partial' : 'completed';
      }
    } catch (error) {
      report.status = 'stopped';
      report.errors.push(error.message);
      console.error(TAG, 'ОСТАНОВЛЕНО:', error.message, 'documentId:', categoryId);
    } finally {
      report.finishedAt = new Date().toISOString();
      try { downloadIntegrity(); }
      catch (error) { console.error(TAG, 'Ошибка экспорта диагностики:', error.message); }
      if (!bulk) {
        try { outputSkips(); }
        catch (error) { console.error(TAG, 'Ошибка экспорта CSV:', error.message); }
      }
      console.log(TAG, 'Итог:', report.status, report.counters,
        'пропущено:', report.skipped.length, 'опубликовано:', report.published.length);
      console.log(TAG, 'Детали: window.categoryRelationsReport');
    }
    return report;
  }

  function parseCsv(source) {
    const text = source.replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], cell = '', quoted = false, closed = false;
    function pushCell() {
      row.push(cell);
      cell = '';
      closed = false;
    }
    function pushRow() {
      pushCell();
      rows.push(row);
      row = [];
    }
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else { quoted = false; closed = true; }
        } else cell += ch;
      } else if (ch === ',') pushCell();
      else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        pushRow();
      } else if (ch === '"' && !cell && !closed) quoted = true;
      else {
        if (closed || ch === '"') throw Error('Некорректный CSV');
        cell += ch;
      }
    }
    if (quoted) throw Error('Незакрытая кавычка в CSV');
    if (row.length || cell || closed) pushRow();
    const header = (rows.shift() || []).map(value => value.trim());
    const index = header.indexOf('documentId');
    if (index < 0 || header.lastIndexOf('documentId') !== index)
      throw Error('Нужна одна колонка documentId в первой строке');
    const ids = new Set();
    let duplicates = 0;
    for (const [i, values] of rows.entries()) {
      const id = (values[index] || '').trim();
      if (!id) continue;
      if (!/^[a-zA-Z0-9]+$/.test(id))
        throw Error('Некорректный documentId в строке ' + (i + 2));
      if (ids.has(id)) duplicates++;
      ids.add(id);
    }
    if (!ids.size) throw Error('В таблице нет documentId');
    return { ids: [...ids], duplicates };
  }

  function exportUrl(value) {
    let url;
    try { url = new URL(value.trim()); }
    catch { throw Error('Введите URL Google Sheets'); }
    const match = url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/.*)?$/);
    if (url.origin !== 'https://docs.google.com' || !match || url.username || url.password)
      throw Error('Нужна ссылка на Google Sheets');
    const hash = new URLSearchParams(url.hash.slice(1));
    const gid = hash.get('gid') ?? url.searchParams.get('gid');
    if (gid !== null && !/^\d+$/.test(gid)) throw Error('Некорректный gid листа');
    return 'https://docs.google.com/spreadsheets/d/' + match[1] +
      '/export?format=csv' + (gid === null ? '' : '&gid=' + gid);
  }

  function summarize(report) {
    const totals = report.operations.reduce((sum, op) => ({
      added: sum.added + op.connect, removed: sum.removed + op.disconnect
    }), { added: 0, removed: 0 });
    return {
      documentId: report.categoryId, status: report.status,
      ...totals, skipped: report.skipped.length, published: report.published.length,
      comment: [
        ...report.errors,
        ...report.ignoredIntegrityDiffs.flatMap(item => item.differences.map(diff =>
          'Игнорировано ' + item.stage + ' ' + item.uid + '/' + item.documentId + ' ' +
          diff.locale + '.' + diff.field + ': ' + JSON.stringify(diff.before) + ' → ' + JSON.stringify(diff.after))),
        ...(report.unpublishedRelations.length ? ['Связи с неопубликованными KK записями: ' + report.unpublishedRelations.length] : []),
        ...report.skipped.map(item => item.field + '/' + item.documentId + ': ' + item.reason),
        ...(report.pending ? ['Неподтверждённая операция: ' + JSON.stringify(report.pending)] : [])
      ].join(' | ') || (totals.added || totals.removed ? 'Связи обновлены' : 'Изменений связей нет')
    };
  }

  function downloadResults(batch) {
    const columns = ['documentId', 'status', 'added', 'removed', 'skipped', 'published', 'comment'];
    const cell = value => {
      let text = String(value ?? '');
      if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    const csv = '\uFEFF' + columns.join(';') + '\n' +
      batch.rows.map(row => columns.map(key => cell(row[key])).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'category-relations-results.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function fatalReport(report) {
    return !!report.pending || (report.status === 'stopped' && (
      report.counters.PUT > 0 || report.counters.POST > 0 ||
      report.errors.some(message =>
        /HTTP (401|403|429|5\d\d)\b|network |Нет Admin jwtToken|схем[аы]|Не удалось прочитать схемы|Некорректный JSON/i.test(message))
    ));
  }

  async function runBatch(ids, onProgress) {
    const batch = {
      startedAt: new Date().toISOString(), finishedAt: null, status: 'running',
      rows: ids.map(documentId => ({ documentId, status: 'pending' })), reports: []
    };
    window.categoryRelationsBatchReport = batch;
    try {
      for (let i = 0; i < ids.length; i++) {
        if (window.categoryRelationsStop === true) {
          batch.status = 'stopped';
          break;
        }
        onProgress(batch, i, ids[i]);
        const report = await normalize(ids[i], true);
        batch.reports.push(report);
        batch.rows[i] = summarize(report);
        if (fatalReport(report)) {
          batch.status = 'stopped';
          break;
        }
        onProgress(batch, i + 1, '');
        if (i + 1 < ids.length)
          await new Promise(resolve => setTimeout(resolve, 350));
      }
      if (batch.status === 'running')
        batch.status = batch.rows.some(row => row.status !== 'completed') ? 'partial' : 'completed';
    } finally {
      batch.finishedAt = new Date().toISOString();
      if (batch.status === 'running') batch.status = 'stopped';
      onProgress(batch, batch.reports.length, '');
      try { downloadResults(batch); }
      catch (error) { console.error(TAG, 'Ошибка экспорта CSV:', error.message); }
      console.log(TAG, 'Массовый отчёт: window.categoryRelationsBatchReport');
    }
    return batch;
  }

  async function chooseMode() {
    const route = '/admin/content-manager/collection-types/' + UID + '/';
    const pathname = location.pathname;
    const current = pathname.startsWith(route) ? pathname.slice(route.length) : '';
    const currentId = /^[a-zA-Z0-9]+$/.test(current) && current !== 'create' ? current : '';
    const dialog = document.createElement('dialog');
    dialog.setAttribute('data-tm-category-relations', '');
    dialog.setAttribute('data-tm-ds', '');
    dialog.setAttribute('aria-label', 'Category Relations');
    dialog.style.cssText = 'width:min(520px,calc(100vw - 32px));max-height:85vh;overflow:auto;padding:24px;border:1px solid var(--tm-ds-neutral200,#4a4a6a);border-radius:8px;background:var(--tm-ds-neutral0,#212134);color:var(--tm-ds-neutral800,#fff);font:inherit;box-sizing:border-box';
    const style = document.createElement('style');
    style.textContent = '[data-tm-category-relations]::backdrop{background:rgba(0,0,0,.55)}[data-tm-category-relations] input{width:100%;box-sizing:border-box}[data-tm-category-relations] [hidden]{display:none!important}[data-tm-category-relations] button:disabled{opacity:.55;cursor:default}';
    const add = (tag, text, cls, parent = dialog) => {
      const node = document.createElement(tag);
      if (text) node.textContent = text;
      if (cls) node.className = cls;
      parent.appendChild(node);
      return node;
    };
    const button = (text, parent = dialog) => {
      const node = add('button', text, 'tm-ds-button', parent);
      node.type = 'button';
      return node;
    };
    const gap = node => { node.style.marginTop = '12px'; return node; };
    const heading = add('h2', 'Category Relations', 'tm-ds-text');
    heading.style.cssText = 'font-size:18px;font-weight:600;margin:0 0 12px';
    add('p', 'Синхронизация связей RU → KK', 'tm-ds-meta');
    const single = gap(button('Текущая запись'));
    single.disabled = !currentId;
    if (!currentId) gap(add('p', 'Для стандартного режима откройте Category.', 'tm-ds-meta'));
    gap(add('h3', 'Массовая синхронизация', 'tm-ds-text'));
    const input = gap(add('input', '', 'tm-ds-input'));
    input.type = 'url';
    input.placeholder = 'URL Google Sheets';
    input.setAttribute('aria-label', 'URL Google Sheets');
    const preview = gap(button('Загрузить конфиг'));
    const status = gap(add('p', '', 'tm-ds-text'));
    status.setAttribute('role', 'status');
    status.style.whiteSpace = 'pre-wrap';
    status.style.overflowWrap = 'anywhere';
    gap(add('p', 'RU → KK: изменения связей публикуются через текущую KK Category. Отдельные Product и Brand не сохраняются. Google Sheets не изменяется.', 'tm-ds-meta'));
    const actions = gap(add('div', ''));
    actions.style.cssText += ';display:flex;gap:8px;flex-wrap:wrap';
    const start = button('Запустить', actions);
    const stop = button('Остановить', actions);
    const save = button('Скачать CSV', actions);
    const close = button('Закрыть', actions);
    start.disabled = true;
    stop.hidden = true;
    save.hidden = true;
    let config = null, busy = false, batch = null;
    const invalidate = () => { config = null; start.disabled = true; };
    input.addEventListener('input', () => {
      invalidate();
      status.textContent = '';
    });
    function lock(value) {
      busy = value;
      input.disabled = value;
      preview.disabled = value;
      single.disabled = value || !currentId;
      close.disabled = value;
      start.disabled = value || !config;
    }
    try {
      document.head.appendChild(style);
      document.body.appendChild(dialog);
      const selected = await new Promise(resolve => {
        const finish = value => {
          if (busy) return;
          dialog.close();
          resolve(value);
        };
        close.onclick = () => finish(null);
        dialog.addEventListener('cancel', event => {
          event.preventDefault();
          finish(null);
        });
        single.onclick = () => {
          if (location.pathname !== pathname) {
            status.textContent = 'Открытая запись изменилась. Запустите инструмент повторно.';
            return;
          }
          finish(currentId);
        };
        preview.onclick = async () => {
          if (busy) return;
          invalidate();
          lock(true);
          status.textContent = 'Чтение Google Sheets…';
          try {
            const url = exportUrl(input.value);
            const response = await fetch(url, { credentials: 'omit', cache: 'no-store' });
            if (!response.ok) throw Error('Google Sheets: HTTP ' + response.status);
            if (!/^text\/csv\b/i.test(response.headers.get('content-type') || ''))
              throw Error('Google Sheets не вернул CSV. Проверьте доступ по ссылке.');
            config = parseCsv(await response.text());
            status.textContent = 'Записей к обработке: ' + config.ids.length +
              '\nИсключено дублей: ' + config.duplicates;
          } catch (error) {
            status.textContent = error.message;
          } finally { lock(false); }
        };
        stop.onclick = () => {
          window.categoryRelationsStop = true;
          stop.disabled = true;
          status.textContent += '\nОстановка после текущей записи…';
        };
        save.onclick = () => {
          const report = batch || window.categoryRelationsBatchReport;
          if (report) downloadResults(report);
        };
        start.onclick = async () => {
          if (busy || !config) return;
          const ids = config.ids.slice();
          if (!confirm('Обработать ' + ids.length + ' Category RU → KK с публикацией только KK Category?')) return;
          delete window.categoryRelationsStop;
          invalidate();
          lock(true);
          stop.hidden = false;
          stop.disabled = false;
          save.hidden = false;
          batch = null;
          try {
            batch = await runBatch(ids, (report, done, id) => {
              const count = name => report.rows.filter(row => row.status === name).length;
              status.textContent = (report.status === 'running' ? 'Обработка' : 'Итог: ' + report.status) +
                '\nОбработано: ' + done + '/' + ids.length +
                '\nУспешно: ' + count('completed') + ', частично: ' + count('partial') +
                ', ошибки: ' + count('stopped') + ', осталось: ' + count('pending') +
                (id ? '\nТекущая Category: ' + id : '') +
                (window.categoryRelationsStop === true && report.status === 'running'
                  ? '\nОстановка после текущей записи…' : '') +
                (report.status === 'stopped' && report.reports.at(-1)?.errors.length
                  ? '\n' + report.reports.at(-1).errors.join('; ') : '');
            });
          } catch (error) {
            status.textContent = 'Ошибка: ' + error.message;
            console.error(TAG, error);
          } finally {
            stop.hidden = true;
            lock(false);
          }
        };
        dialog.showModal();
      });
      dialog.remove();
      style.remove();
      if (selected) await normalize(selected);
    } finally {
      dialog.remove();
      style.remove();
    }
  }

  try {
    await chooseMode();
  } catch (error) {
    console.error(TAG, error);
  } finally {
    window[RUN_KEY] = false;
  }
})();
