(async function attributeKKPreflight() {
  'use strict';
  const UID = 'api::attribute.attribute', TAG = '[Attribute KK Preflight]';
  const ROOT = '/admin/content-manager/collection-types/' + UID + '/';
  const documentId = location.pathname.startsWith(ROOT)
    ? decodeURIComponent(location.pathname.slice(ROOT.length).replace(/\/$/, '')) : '';
  if (!/^[a-z0-9]{16,32}$/i.test(documentId) ||
      new URL(location.href).searchParams.get('plugins[i18n][locale]') !== 'ru') {
    console.error(TAG, 'Откройте RU-карточку конкретного Предложения');
    return;
  }
  if (window.__tmAttributeKKPreflightRunning) {
    console.warn(TAG, 'Проверка уже выполняется');
    return;
  }
  window.__tmAttributeKKPreflightRunning = true;
  const report = {
    version: 1, mode: 'GET-only', uid: UID, documentId,
    startedAt: new Date().toISOString(), finishedAt: null,
    status: 'running', counters: { GET: 0, retries: 0 },
    schema: null, versions: { ru: { draft: null, published: null },
      kk: { draft: null, published: null } },
    dependencies: [], plan: null, warnings: [], errors: []
  };
  window.tmAttributeKKPreflightReport = report;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const check = (ok, msg) => { if (!ok) throw Error(msg); };
  const system = new Set(['id', 'documentId', 'locale', 'status', 'createdAt',
    'updatedAt', 'publishedAt', 'createdBy', 'updatedBy', 'localizations', '__pivot']);
  const token = () => {
    let jwt = localStorage.getItem('jwtToken');
    try { jwt = JSON.parse(jwt); } catch {}
    check(typeof jwt === 'string' && jwt.trim(), 'Не найден Admin jwtToken');
    return jwt.trim().replace(/^Bearer\s+/i, '');
  };
  async function get(path, allow404 = false) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      report.counters.GET++;
      let response, raw;
      try {
        response = await fetch(path, {
          method: 'GET', credentials: 'include', cache: 'no-store',
          headers: { Authorization: 'Bearer ' + token(), Accept: 'application/json' }
        });
        raw = await response.text();
      } catch (e) {
        if (attempt === 3) throw Error('Network GET ' + path + ': ' + e.message);
        report.counters.retries++; await wait(attempt * 500); continue;
      }
      if (allow404 && response.status === 404) return null;
      let data;
      try { data = raw ? JSON.parse(raw) : null; }
      catch { throw Error('Non-JSON GET ' + path); }
      if (response.ok) return data;
      if (attempt < 3 && [408, 429, 500, 502, 503, 504].includes(response.status)) {
        report.counters.retries++; await wait(attempt * 500); continue;
      }
      throw Error('HTTP ' + response.status + ' ' + path + ': ' +
        (data?.error?.message || raw.slice(0, 200)));
    }
  }
  async function detail(uid, id, locale, status) {
    const path = '/content-manager/collection-types/' + uid + '/' +
      encodeURIComponent(id) + '?locale=' + locale + '&status=' + status;
    const data = (await get(path, true))?.data;
    if (data == null || (typeof data === 'object' && Object.keys(data).length === 0)) return null;
    check(!Array.isArray(data) && data.documentId === id && data.locale === locale,
      'Ошибка locale/documentId: ' + uid + '/' + id + '/' + locale + '/' + status);
    if (status === 'published' && !data.publishedAt) return null;
    return data;
  }
  async function relations(id, field, locale, status) {
    const all = [], seen = new Set();
    let total = null, pageCount = null;
    const base = '/content-manager/relations/' + UID + '/' +
      encodeURIComponent(id) + '/' + encodeURIComponent(field);
    for (let page = 1; page <= 10000; page++) {
      const qs = new URLSearchParams({ locale, status, page: String(page), pageSize: '100' });
      const response = await get(base + '?' + qs);
      check(Array.isArray(response?.results) && Number.isSafeInteger(response?.pagination?.total)
        && Number.isSafeInteger(response?.pagination?.pageCount),
        'Неполная пагинация relation ' + field);
      if (total === null) { total = response.pagination.total; pageCount = response.pagination.pageCount; }
      check(total === response.pagination.total && pageCount === response.pagination.pageCount,
        'Изменилась пагинация ' + field);
      for (const entry of response.results) {
        check(entry?.documentId && Number.isSafeInteger(entry.id) && entry.id > 0,
          'Неверный ID связи ' + field);
        check(!seen.has(entry.documentId), 'Дублирующая связь ' + field);
        seen.add(entry.documentId);
        all.push({ documentId: entry.documentId, id: entry.id, locale: entry.locale || locale });
      }
      if (page >= pageCount) break;
      check(response.results.length > 0, 'Пропущенная страница связей ' + field);
    }
    check(all.length === total, 'Неполный список связей ' + field);
    return all.sort((a, b) => a.documentId.localeCompare(b.documentId));
  }
  function download() {
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'attribute-kk-preflight-' + documentId + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  try {
    console.log(TAG, 'Получаю схему, 4 версии и все root relations:', documentId);
    const [typeData, componentData] = await Promise.all([
      get('/content-manager/content-types'), get('/content-manager/components')
    ]);
    check(Array.isArray(typeData?.data) && Array.isArray(componentData?.data),
      'Не получены Content Manager schemas');
    const schemas = new Map(typeData.data.map(s => [s.uid, s]));
    const schema = schemas.get(UID);
    check(schema?.attributes, 'Отсутствует схема Attribute');
    const defs = Object.entries(schema.attributes)
      .filter(([field]) => !system.has(field));
    const relDefs = defs.filter(([, def]) => def.type === 'relation');
    report.schema = {
      fields: Object.fromEntries(defs.map(([field, def]) => [field, {
        type: def.type, required: !!def.required, unique: !!def.unique,
        localized: def.pluginOptions?.i18n?.localized === true,
        target: def.type === 'relation' ? def.target : null,
        mappedBy: def.mappedBy || null, inversedBy: def.inversedBy || null,
        component: def.component || null, repeatable: !!def.repeatable
      }])),
      components: componentData.data.filter(c => c?.uid && c?.attributes)
        .map(c => ({ uid: c.uid, attributes: c.attributes }))
    };
    for (const locale of ['ru', 'kk']) {
      for (const status of ['draft', 'published']) {
        const data = await detail(UID, documentId, locale, status);
        if (!data) continue;
        const fields = {}, links = {}, omittedFields = [];
        for (const [field, def] of defs) {
          if (def.type === 'relation') continue;
          if (!Object.hasOwn(data, field)) {
            omittedFields.push(field);
            continue;
          }
          fields[field] = data[field];
        }
        if (omittedFields.length)
          report.warnings.push('API не вернул поля ' + locale + '/' + status +
            ': ' + omittedFields.join(', ') +
            '. Значения неизвестны (это не null); полный перенос пока не разрешён.');
        for (const [field] of relDefs) {
          const linked = await relations(documentId, field, locale, status);
          if (Number.isSafeInteger(data[field]?.count))
            check(data[field].count === linked.length, 'Несовпадение count ' + field + '/' + locale);
          links[field] = linked;
        }
        report.versions[locale][status] = {
          meta: { id: data.id, documentId: data.documentId, locale: data.locale,
            status: data.status, publishedAt: data.publishedAt, updatedAt: data.updatedAt },
          fields, omittedFields, relations: links
        };
      }
    }
    const ru = report.versions.ru.draft;
    check(ru, 'Нет RU Draft');
    for (const [field, def] of relDefs) {
      check(schemas.has(def.target), 'Не найдена схема relation target: ' + field);
      for (const relation of ru.relations[field]) {
        const targetKKDraft = await detail(def.target, relation.documentId, 'kk', 'draft');
        const targetKKPublished = await detail(def.target, relation.documentId, 'kk', 'published');
        report.dependencies.push({ field, uid: def.target, documentId: relation.documentId,
          ruNumericId: relation.id, kkDraftId: targetKKDraft?.id || null,
          kkPublishedId: targetKKPublished?.id || null });
      }
    }
    const shared = defs.filter(([field, def]) => def.type !== 'relation' &&
      def.pluginOptions?.i18n?.localized !== true &&
      ru.fields[field] !== null && ru.fields[field] !== undefined && ru.fields[field] !== '')
      .map(([field]) => field);
    if (shared.length) report.warnings.push(
      'Непустые shared поля, подлежащие защите от изменения RU: ' + shared.join(', '));
    const missing = report.dependencies.filter(d => !d.kkDraftId);
    const unpublished = report.dependencies.filter(d => d.kkDraftId && !d.kkPublishedId);
    if (missing.length) report.warnings.push('Нет KK Draft у связанных записей: ' + missing.length);
    if (unpublished.length) report.warnings.push('Нет KK Published у связанных записей: ' + unpublished.length);
    report.plan = {
      action: report.versions.kk.draft ? 'kk_exists' : 'create_kk',
      source: 'ru/draft', target: 'kk', publish: 'kk_only', writes: 0,
      fields: Object.keys(ru.fields),
      omittedSourceFields: ru.omittedFields,
      safeToCopyAllFields: ru.omittedFields.length === 0,
      relationCounts: Object.fromEntries(Object.entries(ru.relations)
        .map(([field, rows]) => [field, rows.length])),
      missingKKTargets: missing.length, unpublishedKKTargets: unpublished.length
    };
    report.status = 'complete';
    console.log(TAG, report.plan, 'GET:', report.counters.GET);
    if (report.warnings.length) console.warn(TAG, report.warnings);
  } catch (e) {
    report.status = 'failed';
    report.errors.push(e?.message || String(e));
    console.error(TAG, e);
  } finally {
    report.finishedAt = new Date().toISOString();
    try { download(); } catch (e) { console.error(TAG, 'Ошибка выгрузки JSON:', e); }
    window.__tmAttributeKKPreflightRunning = false;
  }
})();
