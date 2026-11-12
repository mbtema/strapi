// DIOR Brand.products: read-only Product RU Draft vs KK Draft audit.
// Запуск: Strapi Admin -> RU-карточка Brand DIOR -> DevTools Console.
// Только GET. Один JSON с итогами, схемой и точными различиями. Полные снимки остаются в памяти.
(async () => {
  'use strict';
  const CFG = {
    brandUid: 'api::brand.brand',
    brandDocumentId: 'qw7sja6ffpbufvzub5maxyrl',
    brandField: 'products',
    productUid: 'api::product.product',
    pageSize: 100,
    productWorkers: 2,
    relationWorkers: 3,
    maxPages: 200,
    retries: 3
  };
  const KEY = '__tmDiorProductsKkAudit';
  const PANEL_ID = 'tm-dior-products-kk-audit';
  const SYSTEM = new Set([
    'id', 'documentId', 'locale', 'status', 'publishedAt', 'createdAt',
    'updatedAt', 'createdBy', 'updatedBy', 'localizations', '__pivot'
  ]);
  const path = `/admin/content-manager/collection-types/${CFG.brandUid}/${CFG.brandDocumentId}`;
  const queryLocale = new URLSearchParams(location.search).get('plugins[i18n][locale]') || 'ru';
  if (location.pathname.replace(/\/$/, '') !== path || queryLocale !== 'ru') {
    console.error('[DIOR Product Audit] Открой RU-карточку Brand DIOR:', path);
    return;
  }
  if (window[KEY]?.running) {
    console.warn('[DIOR Product Audit] Аудит уже выполняется.');
    return;
  }
  let token = localStorage.getItem('jwtToken');
  try { token = JSON.parse(token); } catch { /* raw token */ }
  if (typeof token !== 'string' || !token) {
    console.error('[DIOR Product Audit] Не найден jwtToken Strapi Admin.');
    return;
  }

  document.getElementById(PANEL_ID)?.remove();
  const node = (tag, value) => {
    const el = document.createElement(tag);
    if (value !== undefined) el.textContent = String(value);
    return el;
  };
  const panel = node('section');
  panel.id = PANEL_ID;
  panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483640;' +
    'width:min(480px,calc(100vw - 32px));max-height:78vh;overflow:auto;' +
    'background:#1e1e32;color:#fff;border:1px solid #7770bf;border-radius:10px;' +
    'padding:14px;box-shadow:0 8px 30px #0009;font:13px/1.5 system-ui';
  const title = node('strong', 'DIOR · Аудит товаров RU / KK');
  const info = node('div', 'Читаем схему и список товаров…');
  info.style.cssText = 'margin:9px 0 8px;overflow-wrap:anywhere';
  const barTrack = node('div');
  barTrack.setAttribute('role', 'progressbar');
  barTrack.setAttribute('aria-valuemin', '0');
  barTrack.style.cssText = 'height:7px;background:#34344c;border-radius:7px;overflow:hidden';
  const barFill = node('div');
  barFill.style.cssText = 'height:100%;width:0%;background:#aaa6ee;transition:width .15s';
  barTrack.append(barFill);
  const stats = node('div', 'Загружаем список товаров…');
  stats.style.cssText = 'margin:9px 0 11px;color:#cbcbe2;font-size:12px';
  const actionButton = node('button', 'Остановить');
  actionButton.type = 'button';
  actionButton.style.cssText = 'padding:7px 11px;cursor:pointer;color:#fff;' +
    'background:#444266;border:1px solid #7770bf;border-radius:5px';
  panel.append(title, info, barTrack, stats, actionButton);
  document.body.append(panel);

  const state = {
    running: true, stopped: false, phase: 'init', processed: 0, total: 0,
    getCount: 0, getRetries: 0, started: Date.now(),
    report: {
      tool: 'dior-products-kk-audit', version: 2, mode: 'read-only',
      brandDocumentId: CFG.brandDocumentId, brandRelation: CFG.brandField,
      source: 'ru/draft', target: 'kk/draft',
      startedAt: new Date().toISOString(), finishedAt: null,
      complete: false, failure: null, summary: null, schema: [], products: []
    }
  };
  window[KEY] = state;
  window.tmDiorProductsKkAudit = state.report;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const checkStop = () => {
    if (state.stopped) throw Error('Остановлено пользователем');
  };
  const count = status => state.report.products.filter(p => p?.status === status).length;
  const render = message => {
    if (message) state.phase = message;
    info.textContent = state.phase;
    const percent = state.total ? 100 * state.processed / state.total : 0;
    barFill.style.width = percent.toFixed(1) + '%';
    barTrack.setAttribute('aria-valuenow', String(state.processed));
    barTrack.setAttribute('aria-valuemax', String(state.total || 1));
    stats.textContent = state.total ?
      'Товары ' + state.processed + '/' + state.total +
        ' · OK ' + count('ok') + ' · отличия ' + count('diff') :
      'Загружаем список товаров…';
  };
  actionButton.onclick = () => {
    state.stopped = true;
    actionButton.disabled = true;
    render('Останавливаем после текущих запросов…');
  };
  const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
    }
    return value;
  };
  const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const present = value => {
    if (value == null || value?.__missing === true) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true; // false и 0 — заполненные значения
  };
  const flagLocalized = attr =>
    typeof attr?.pluginOptions?.i18n?.localized === 'boolean' ?
      attr.pluginOptions.i18n.localized : attr?.type === 'uid';
  const idOfMedia = v => Number.isInteger(v) && v > 0 ? v :
    (Number.isInteger(v?.id) && v.id > 0 ? v.id : null);
  const normalizeMedia = v => v == null ? v : Array.isArray(v) ?
    v.map(idOfMedia) : idOfMedia(v);
  const detailPath = (uid, documentId, locale, status = 'draft') =>
    '/content-manager/collection-types/' + uid + '/' + encodeURIComponent(documentId) +
    '?locale=' + locale + '&status=' + status;

  async function request(url, allow404 = false) {
    for (let attempt = 1; attempt <= CFG.retries; attempt++) {
      checkStop();
      state.getCount++;
      let response;
      try {
        response = await fetch(url, {
          method: 'GET', cache: 'no-store', credentials: 'include',
          headers: { Accept: 'application/json', Authorization: 'Bearer ' + token }
        });
      } catch (error) {
        if (attempt === CFG.retries) throw Error('NETWORK GET ' + url + ': ' + error);
        state.getRetries++;
        await sleep(450 * attempt);
        continue;
      }
      if (response.status === 404 && allow404) return null;
      if (!response.ok) {
        if (attempt < CFG.retries && [408, 429, 500, 502, 503, 504].includes(response.status)) {
          state.getRetries++;
          await sleep(500 * attempt);
          continue;
        }
        const body = await response.text().catch(() => '');
        throw Error('GET HTTP ' + response.status + ' ' + url + ': ' + body.slice(0, 250));
      }
      let result;
      try { result = await response.json(); }
      catch { throw Error('GET не-JSON ответ: ' + url); }
      if (result == null || typeof result !== 'object') throw Error('GET пустой JSON: ' + url);
      return result;
    }
    throw Error('GET retries exhausted: ' + url);
  }

  async function detail(uid, documentId, locale) {
    const result = await request(detailPath(uid, documentId, locale), true);
    if (result === null) return null;
    const data = result?.data;
    if (data == null || (typeof data === 'object' && !Array.isArray(data) && !Object.keys(data).length))
      return null;
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        data.documentId !== documentId || data.locale !== locale) {
      throw Error('Неожиданный detail ' + uid + '/' + documentId + '/' + locale);
    }
    return data;
  }

  function pagination(json, page, first = null) {
    const p = json?.pagination;
    if (!Array.isArray(json?.results) || !Number.isInteger(p?.total) || p.total < 0 ||
        !Number.isInteger(p?.pageCount) || p.pageCount < 0 ||
        (p.page != null && Number(p.page) !== page) ||
        (p.total > 0 && json.results.length === 0) ||
        (first && (first.total !== p.total || first.pageCount !== p.pageCount))) {
      throw Error('Некорректная пагинация page=' + page);
    }
    return { total: p.total, pageCount: p.pageCount };
  }

  async function relationList(uid, documentId, field, locale) {
    const entries = [];
    let page = 1, first = null;
    for (;;) {
      checkStop();
      const endpoint = '/content-manager/relations/' + uid + '/' + documentId + '/' +
        encodeURIComponent(field) + '?locale=' + locale + '&status=draft&page=' +
        page + '&pageSize=' + CFG.pageSize;
      const json = await request(endpoint);
      const p = pagination(json, page, first);
      if (!first) first = p;
      for (const row of json.results) {
        if (typeof row?.documentId !== 'string' || !row.documentId) {
          throw Error('Relation ' + field + '/' + locale + ' без documentId (' + documentId + ')');
        }
        entries.push(row.documentId);
      }
      if (page >= p.pageCount || p.pageCount === 0) break;
      if (page >= CFG.maxPages) throw Error('Превышен лимит страниц relation ' + field);
      page++;
    }
    if (entries.length !== first.total || new Set(entries).size !== entries.length) {
      throw Error('Relation ' + field + '/' + locale + ' count/duplicate mismatch ' + documentId);
    }
    return entries.sort();
  }

  async function brandProducts() {
    const list = await relationList(CFG.brandUid, CFG.brandDocumentId, CFG.brandField, 'ru');
    return list;
  }
  async function eachLimited(items, limit, handler) {
    const results = new Array(items.length);
    let cursor = 0;
    const jobs = Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        checkStop();
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await handler(items[i], i);
      }
    });
    await Promise.all(jobs);
    return results;
  }

  function nestedSchemaLines(attrs, componentSchemas, prefix, inherited = false, ancestors = []) {
    const out = [];
    for (const [name, attr] of Object.entries(attrs || {})) {
      if (SYSTEM.has(name)) continue;
      const path = prefix ? prefix + '.' + name : name;
      const localized = flagLocalized(attr) ||
        (inherited && attr?.pluginOptions?.i18n?.localized !== false);
      out.push({ path, type: attr.type || '', scope: attr.type === 'relation' ? 'relation' :
        localized ? 'localized' : 'shared', localized, explicitlyLocalized:
        attr?.pluginOptions?.i18n?.localized ?? null,
        unique: attr.unique === true, required: attr.required === true,
        repeatable: attr.repeatable === true, target: attr.target || '',
        component: attr.component || (Array.isArray(attr.components) ? attr.components.join('|') : '') });
      const children = attr.type === 'component' ? [attr.component] :
        attr.type === 'dynamiczone' ? attr.components : [];
      for (const uid of children || []) {
        if (ancestors.includes(uid)) throw Error('Рекурсивный компонент ' + uid);
        const child = componentSchemas[uid];
        if (!child?.attributes) throw Error('Нет схемы компонента ' + uid);
        out.push(...nestedSchemaLines(child.attributes, componentSchemas,
          path + '[' + uid + ']', localized, [...ancestors, uid]));
      }
    }
    return out;
  }

  function normalizeNested(attr, value, components) {
    if (value === undefined) return { __missing: true };
    if (value == null) return value;
    if (attr.type === 'media') return normalizeMedia(value);
    if (attr.type === 'relation') {
      if (Array.isArray(value)) return value.map(item => item?.documentId || item?.id || null);
      if (typeof value === 'object') {
        if (typeof value.documentId === 'string') return { documentId: value.documentId };
        if (Number.isInteger(value.count)) return { count: value.count };
        return { __unresolvedRelation: true };
      }
      return value;
    }
    if (attr.type === 'component') {
      const child = components[attr.component];
      if (!child?.attributes) return { __unknownComponent: attr.component };
      const one = entry => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
        return Object.fromEntries(Object.entries(child.attributes).filter(([key]) => !SYSTEM.has(key))
          .map(([key, a]) => [key, normalizeNested(a, entry[key], components)]));
      };
      return attr.repeatable && Array.isArray(value) ? value.map(one) : one(value);
    }
    if (attr.type === 'dynamiczone') {
      if (!Array.isArray(value)) return value;
      return value.map(entry => {
        const uid = entry?.__component;
        const child = components[uid];
        if (!child?.attributes) return { __unknownComponent: uid || null };
        return {
          __component: uid,
          ...Object.fromEntries(Object.entries(child.attributes).filter(([key]) => !SYSTEM.has(key))
            .map(([key, a]) => [key, normalizeNested(a, entry?.[key], components)]))
        };
      });
    }
    return canonical(value);
  }

  function productFields(data, schema, components) {
    return Object.fromEntries(Object.entries(schema.attributes)
      .filter(([key, a]) => !SYSTEM.has(key) && a.type !== 'relation')
      .map(([key, a]) => [key, normalizeNested(a, data[key], components)]));
  }
  const issue = (list, kind, path, detailText, ru = null, kk = null) => {
    list.push({ kind, path, detail: detailText, ru, kk });
  };
  const short = value => {
    const raw = JSON.stringify(value);
    return String(raw === undefined ? '[undefined]' : raw).slice(0, 180);
  };

  function compareField(attr, ru, kk, path, components, issues, meta, inherited = false) {
    const localized = flagLocalized(attr) ||
      (inherited && attr?.pluginOptions?.i18n?.localized !== false);
    const hasRu = present(ru), hasKk = present(kk);
    if (attr.required && !hasRu) issue(issues, 'required_ru_empty', path, 'Required RU пусто');
    if (hasRu && !hasKk) {
      issue(issues, localized ? 'localized_kk_empty' : 'shared_kk_empty', path,
        'RU заполнено, KK пусто', short(ru), short(kk));
      return;
    }
    if (!hasRu && hasKk) {
      if (!localized) issue(issues, 'shared_value_diff', path, 'RU пусто, KK заполнено', short(ru), short(kk));
      else meta.kkOnlyFilled++;
      return;
    }
    if (!hasRu && !hasKk) return;
    if (attr.type === 'component' || attr.type === 'dynamiczone') {
      if (attr.type === 'component' && !attr.repeatable) {
        if (!ru || !kk || typeof ru !== 'object' || typeof kk !== 'object' ||
            Array.isArray(ru) || Array.isArray(kk)) {
          issue(issues, 'component_structure', path, 'Неверный формат single component');
          return;
        }
        const child = components[attr.component];
        for (const [name, a] of Object.entries(child.attributes)) {
          if (!SYSTEM.has(name)) compareField(a, ru[name], kk[name], path + '.' + name,
            components, issues, meta, localized);
        }
        return;
      }
      if (!Array.isArray(ru) || !Array.isArray(kk)) {
        issue(issues, 'component_structure', path, 'Ожидались два массива');
        return;
      }
      if (ru.length !== kk.length) issue(issues, 'component_structure', path,
        'Разная длина массива: RU ' + ru.length + ', KK ' + kk.length);
      const min = Math.min(ru.length, kk.length);
      for (let i = 0; i < min; i++) {
        const uid = attr.type === 'component' ? attr.component : ru[i]?.__component;
        if (attr.type === 'dynamiczone' && uid !== kk[i]?.__component) {
          issue(issues, 'component_structure', path + '[' + i + ']',
            'Тип компонента отличается: ' + uid + ' / ' + kk[i]?.__component);
          continue;
        }
        const child = components[uid];
        if (!child?.attributes) {
          issue(issues, 'unverified', path + '[' + i + ']', 'Неизвестная схема ' + uid);
          continue;
        }
        if (!ru[i] || !kk[i] || typeof ru[i] !== 'object' || typeof kk[i] !== 'object') {
          issue(issues, 'component_structure', path + '[' + i + ']', 'Неверный элемент массива');
          continue;
        }
        for (const [name, a] of Object.entries(child.attributes)) {
          if (!SYSTEM.has(name)) compareField(a, ru[i][name], kk[i][name],
            path + '[' + i + '].' + name, components, issues, meta, localized);
        }
      }
      return;
    }
    if (attr.type === 'media' &&
        ((Array.isArray(ru) && ru.some(x => idOfMedia(x) == null)) ||
         (Array.isArray(kk) && kk.some(x => idOfMedia(x) == null)) ||
         (!Array.isArray(ru) && idOfMedia(ru) == null) ||
         (!Array.isArray(kk) && idOfMedia(kk) == null))) {
      issue(issues, 'unverified', path, 'Media без подтверждённого числового ID');
      return;
    }
    if (attr.type === 'relation') {
      // Внутренние relations могут приходить как count; точный состав не подтверждён.
      issue(issues, 'unverified', path,
        'Вложенная relation требует отдельного Content Manager контракта');
      return;
    }
    const ar = attr.type === 'media' ? normalizeMedia(ru) : canonical(ru);
    const ak = attr.type === 'media' ? normalizeMedia(kk) : canonical(kk);
    if (localized) {
      if (!equal(ar, ak)) meta.localizedDifferent++;
    } else if (!equal(ar, ak)) {
      issue(issues, 'shared_value_diff', path, 'Разные значения нелокализуемого поля', short(ar), short(ak));
    }
  }

  async function auditProduct(documentId, schema, components, relationFields) {
    const [ru, kk] = await Promise.all([
      detail(CFG.productUid, documentId, 'ru'),
      detail(CFG.productUid, documentId, 'kk')
    ]);
    const base = {
      documentId, name: ru?.name || ru?.name1 || '',
      status: 'ok', issues: [], localizedDifferent: 0, kkOnlyFilled: 0,
      snapshots: { ru: null, kk: null }
    };
    const getSnapshot = async (data, locale) => {
      if (!data) return null;
      const values = await eachLimited(relationFields, CFG.relationWorkers, async field => {
        return [field, await relationList(CFG.productUid, documentId, field, locale)];
      });
      return {
        meta: { id: data.id, status: data.status, publishedAt: data.publishedAt ?? null },
        fields: productFields(data, schema, components),
        relations: Object.fromEntries(values)
      };
    };
    const [ruSnapshot, kkSnapshot] = await Promise.all([
      getSnapshot(ru, 'ru'), getSnapshot(kk, 'kk')
    ]);
    base.snapshots.ru = ruSnapshot;
    base.snapshots.kk = kkSnapshot;
    if (!ru) {
      base.status = 'review';
      issue(base.issues, 'missing_ru', '*', 'RU Draft отсутствует');
      return base;
    }
    if (!kk) {
      base.status = 'missing_kk';
      issue(base.issues, 'missing_kk', '*', 'KK Draft отсутствует');
      return base;
    }
    const meta = { localizedDifferent: 0, kkOnlyFilled: 0 };
    for (const [field, attr] of Object.entries(schema.attributes)) {
      if (SYSTEM.has(field) || attr.type === 'relation') continue;
      compareField(attr, ru[field], kk[field], field, components, base.issues, meta);
    }
    for (const field of relationFields) {
      const source = ruSnapshot.relations[field], target = kkSnapshot.relations[field];
      const rs = new Set(source), ks = new Set(target);
      const missing = source.filter(id => !ks.has(id));
      const extra = target.filter(id => !rs.has(id));
      if (missing.length || extra.length) {
        issue(base.issues, 'relation_diff', field,
          'Не хватает KK: ' + missing.length + '; лишних KK: ' + extra.length,
          missing, extra);
      }
    }
    base.localizedDifferent = meta.localizedDifferent;
    base.kkOnlyFilled = meta.kkOnlyFilled;
    base.status = base.issues.some(x => x.kind !== 'unverified') ? 'diff' :
      base.issues.length ? 'review' : 'ok';
    return base;
  }

  function summarize() {
    const rows = state.report.products.filter(Boolean);
    const issues = rows.flatMap(r => r.issues || []);
    return {
      total: state.total, processed: rows.length, ok: count('ok'),
      diff: count('diff'), missingKk: count('missing_kk'), review: count('review'),
      localizedValueDifferencesAllowed: rows.reduce((sum, r) => sum + r.localizedDifferent, 0),
      kkOnlyLocalizedFilledAllowed: rows.reduce((sum, r) => sum + r.kkOnlyFilled, 0),
      relationIssues: issues.filter(x => x.kind === 'relation_diff').length,
      missingLocalizedIssues: issues.filter(x => x.kind === 'localized_kk_empty').length,
      sharedIssues: issues.filter(x => x.kind === 'shared_value_diff' || x.kind === 'shared_kk_empty').length,
      relationEntriesRu: rows.reduce((sum, r) => sum + (r.snapshots.ru ?
        Object.values(r.snapshots.ru.relations).reduce((n, ids) => n + ids.length, 0) : 0), 0),
      relationEntriesKk: rows.reduce((sum, r) => sum + (r.snapshots.kk ?
        Object.values(r.snapshots.kk.relations).reduce((n, ids) => n + ids.length, 0) : 0), 0),
      missingRelationEntries: issues.filter(x => x.kind === 'relation_diff').reduce(
        (sum, x) => sum + x.ru.length, 0),
      extraRelationEntries: issues.filter(x => x.kind === 'relation_diff').reduce(
        (sum, x) => sum + x.kk.length, 0),
      uniqueFieldsInSchema: state.report.schema.filter(x => x.unique).length,
      localizedFieldsInSchema: state.report.schema.filter(x => x.localized).length,
      relationFieldsInSchema: state.report.schema.filter(x => x.type === 'relation').length,
      getRequests: state.getCount, getRetries: state.getRetries
    };
  }
  function downloadReport() {
    // Сохраняем всю схему, итоги и точные расхождения для работы с одним файлом.
    // Полные RU/KK snapshots используются при сравнении, но в JSON не дублируются.
    const report = {
      ...state.report,
      format: 'findings',
      products: state.report.products.filter(Boolean).map(({ snapshots, ...product }) => ({
        ...product,
        url: location.origin + '/admin/content-manager/collection-types/' +
          CFG.productUid + '/' + product.documentId + '?plugins[i18n][locale]=ru'
      }))
    };
    const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)],
      { type: 'application/json;charset=utf-8' }));
    const a = node('a');
    a.href = objectUrl;
    a.download = 'dior-products-kk-audit.json';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
  }
  function finish(complete, reason = null) {
    state.running = false;
    state.report.complete = complete;
    state.report.failure = reason;
    state.report.finishedAt = new Date().toISOString();
    state.report.summary = summarize();
    window.tmDiorProductsKkAudit = state.report;
    actionButton.disabled = false;
    actionButton.textContent = 'Скачать JSON повторно';
    actionButton.onclick = downloadReport;
    render(complete ? 'Аудит завершён. Один JSON скачан.' :
      'Аудит прерван: ' + reason + '. Скачан неполный JSON.');
    downloadReport();
  }

  try {
    const [types, componentsResponse] = await Promise.all([
      request('/content-manager/content-types'),
      request('/content-manager/components')
    ]);
    const typesList = types?.data, componentsList = componentsResponse?.data;
    if (!Array.isArray(typesList) || !Array.isArray(componentsList)) {
      throw Error('Неожиданный ответ схем Content Manager');
    }
    const brandSchema = typesList.find(x => x?.uid === CFG.brandUid);
    const productSchema = typesList.find(x => x?.uid === CFG.productUid);
    if (!brandSchema?.attributes || !productSchema?.attributes ||
        brandSchema.attributes?.[CFG.brandField]?.type !== 'relation' ||
        brandSchema.attributes[CFG.brandField].target !== CFG.productUid ||
        productSchema.pluginOptions?.i18n?.localized !== true) {
      throw Error('Не подтверждены схемы Brand.products или локализуемого Product');
    }
    const components = Object.fromEntries(componentsList.map(x => [x.uid, x]));
    state.report.schema = nestedSchemaLines(productSchema.attributes, components, '');
    const relationFields = Object.entries(productSchema.attributes)
      .filter(([name, a]) => !SYSTEM.has(name) && a.type === 'relation')
      .map(([name, a]) => {
        if (!a.target?.startsWith('api::')) throw Error('Неподдержанная relation: ' + name);
        return name;
      });
    render('Читаем все страницы relation Brand.products…');
    const productIds = await brandProducts();
    if (!productIds.length) throw Error('У Brand DIOR нет products: проверь relation/локаль');
    state.total = productIds.length;
    state.report.products = new Array(productIds.length);
    render('Проверяем RU/KK поля и все Product relations…');
    let cursor = 0, failure = null;
    const workers = Array.from({ length: Math.min(CFG.productWorkers, productIds.length) }, async () => {
      while (!failure && !state.stopped) {
        const i = cursor++;
        if (i >= productIds.length) return;
        try {
          state.report.products[i] = await auditProduct(productIds[i], productSchema, components, relationFields);
          state.processed++;
          render('Проверяем RU/KK поля и все Product relations…');
        } catch (error) {
          if (!failure) failure = `${productIds[i]}: ${String(error.message || error)}`;
        }
      }
    });
    await Promise.all(workers);
    if (failure) throw Error(failure);
    checkStop();
    if (state.report.products.some(x => !x) || state.processed !== state.total) {
      throw Error('Не все товары обработаны');
    }
    finish(true);
  } catch (error) {
    const message = String(error.message || error);
    console.error('[DIOR Product Audit] STOP:', message);
    finish(false, message);
  }
})();