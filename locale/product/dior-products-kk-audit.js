// DIOR Product RU → KK: единый pipeline, read-only preflight и контролируемые записи.
// Запуск: Strapi Admin -> RU-карточка Brand DIOR -> DevTools Console.
// Все PUT/POST только по ручному запуску, без retry. Повреждение RU: STOP, recovery отдельно.
// Strapi Product.key unique + nonlocalized: одинаковый key у RU и KK одного documentId.
// Один ручной пилот -> после postflight автоматическая обработка eligible Product.
// Неопубликованные KK target => defer Product без Publish и без публикации справочников.
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
    targetWorkers: 4,
    maxPages: 200,
    retries: 3
  };
  const KEY = '__tmDiorProductsKkAudit';
  const BACKUP_NAME = 'dior-products-kk-backup.json';
  const RESULT_NAME = 'dior-products-kk-result.json';
  const UNRESOLVED_KEY = 'tm:dior:product:unresolved:v1';
  const PROGRESS_KEY = 'tm:dior:product:progress:v1';
  const STAGE_KEY = 'tm:dior:product:verified-stage:v1';
  const DEFERRED_KEY = 'tm:dior:product:unpublished-targets:v1';
  const SCALARS = new Set(['string','text','richtext','email','enumeration','json','blocks',
    'integer','biginteger','float','decimal','boolean','date','time','datetime']);
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

  const prior = window.tmDiorProductsKkAudit;
  const reuse = prior?.complete === true && prior?.brandDocumentId === CFG.brandDocumentId &&
    prior?.products?.length > 0 && prior?.rawSchemas?.product?.attributes &&
    [3,4,5,6,7].includes(prior.version) && prior?.mode === 'dry-run';
  document.getElementById(PANEL_ID)?.remove();
  const node = (tag, value) => {
    const el = document.createElement(tag);
    if (value !== undefined) el.textContent = String(value);
    return el;
  };
  const panel = node('section');
  panel.id = PANEL_ID;
  panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483640;' +
    'width:min(400px,calc(100vw - 32px));max-height:78vh;overflow:auto;' +
    'background:#1e1e32;color:#fff;border:1px solid #7770bf;border-radius:10px;' +
    'padding:14px;box-shadow:0 8px 30px #0009;font:13px/1.5 system-ui';
  const title = node('strong', 'DIOR · RU → KK · Pipeline');
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
    running: true, stopped: false, critical: false, phase: 'init', processed: 0, total: 0,
    batch: null,
    getCount: 0, getRetries: 0, targetsDone: 0, targetsTotal: 0,
    started: Date.now(), schema: null, components: null, targetCache: new Map(),
    report: {
      tool: 'dior-products-kk-pipeline', version: 7, mode: 'dry-run',
      brandDocumentId: CFG.brandDocumentId, brandRelation: CFG.brandField,
      source: 'ru/draft', target: 'kk/draft',
      startedAt: new Date().toISOString(), finishedAt: null,
      complete: false, failure: null, summary: null, schema: [],
      rawSchemas: null, plan: null, pilotCandidate: null,
      writesEnabled: false, backupKind: 'pre-write-complete', products: [],
      operations: [], verifiedTypes: [], skipped: [], progress: [],
      safety: {recoveryVerified: false, autoRecoveryEnabled: false,
        globalKeyUniquenessVerified: false}
    }
  };
  window[KEY] = state;
  window.tmDiorProductsKkAudit = state.report;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const checkStop = () => {
    if (state.stopped && !state.critical) throw Error('Остановлено пользователем');
  };
  const journal = () => {
    try { return JSON.parse(localStorage.getItem(UNRESOLVED_KEY) || 'null'); }
    catch { return {reason:'Повреждён unresolved journal'}; }
  };
  const savedProgress = () => {
    try { const x=JSON.parse(localStorage.getItem(PROGRESS_KEY) || '[]');
      return Array.isArray(x)?x:[]; }
    catch { return []; }
  };
  const verifiedStage = () => {
    try { return JSON.parse(localStorage.getItem(STAGE_KEY)||'null'); }
    catch { return {reason:'Повреждён stage checkpoint'}; }
  };
  const saveStage = entry => localStorage.setItem(STAGE_KEY,JSON.stringify(entry));
  const clearStage = () => localStorage.removeItem(STAGE_KEY);
  const setJournal = entry => localStorage.setItem(UNRESOLVED_KEY,JSON.stringify(entry));
  const clearJournal = () => localStorage.removeItem(UNRESOLVED_KEY);
  const savedDeferred = () => {
    try {
      const data=JSON.parse(localStorage.getItem(DEFERRED_KEY)||'null');
      return data?.backupAt===state.report.startedAt && Array.isArray(data.rows) ?
        data.rows.filter(row=>row?.documentId && row.reason==='unpublished_kk_target') : [];
    } catch { return []; }
  };
  function deferProduct(documentId,missing,stage='before-save') {
    if (!Array.isArray(missing) || !missing.length)
      throw Error('Нельзя отложить товар без подтверждённой KK Published-зависимости');
    const rows=savedDeferred().filter(row=>row.documentId!==documentId);
    const entry={documentId,reason:'unpublished_kk_target',
      missing,stage,at:new Date().toISOString()};
    rows.push(entry);
    localStorage.setItem(DEFERRED_KEY,JSON.stringify({backupAt:state.report.startedAt,rows}));
    state.report.skipped=state.report.skipped||[];
    state.report.skipped=state.report.skipped.filter(row=>row.documentId!==documentId);
    state.report.skipped.push(entry);
    return entry;
  }
  const markProgress = (id,types,metadata={}) => {
    const rows = savedProgress().filter(row => row.id !== id);
    rows.push({id,types,at:new Date().toISOString(),...metadata});
    localStorage.setItem(PROGRESS_KEY,JSON.stringify(rows));
    state.report.progress = rows;
  };
  const count = status => state.report.products.filter(p => p?.status === status).length;
  const render = message => {
    if (message) state.phase = message;
    info.textContent = state.phase;
    const batch = state.batch;
    const percent = batch && state.report.mode==='batch-running' ?
      (batch.total ? 100 * batch.processed / batch.total : 100) :
      (state.total ? 100 * state.processed / state.total : 0);
    barFill.style.width = percent.toFixed(1) + '%';
    barTrack.setAttribute('aria-valuenow', String(batch && state.report.mode==='batch-running' ? batch.processed : state.processed));
    barTrack.setAttribute('aria-valuemax', String(batch && state.report.mode==='batch-running' ? batch.total || 1 : state.total || 1));
    stats.textContent = batch && state.report.mode==='batch-running' ?
      'Batch '+batch.processed+'/'+batch.total+' · проверено '+batch.verified+
      ' · пропущено '+batch.skipped+' · GET '+state.getCount : state.total ?
      'Товары ' + state.processed + '/' + state.total +
        ' · OK ' + count('ok') + ' · ожидают ' + count('pending') +
        (state.targetsTotal ? ' · связи ' + state.targetsDone + '/' + state.targetsTotal : '') :
      'Загружаем список товаров…';
  };
  const stopRunning = () => {
    state.stopped = true;
    actionButton.disabled = true;
    render(state.critical ? 'Остановка после обязательной проверки текущей записи…' :
      'Останавливаем после текущих запросов…');
  };
  actionButton.onclick = stopRunning;
  const setAction = (label,handler) => {
    actionButton.disabled = false;
    actionButton.textContent = label;
    actionButton.onclick = handler;
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

  async function detail(uid, documentId, locale, status = 'draft') {
    const result = await request(detailPath(uid, documentId, locale, status), true);
    if (result === null) return null;
    const data = result?.data;
    if (data == null || (typeof data === 'object' && !Array.isArray(data) &&
        !Object.keys(data).length)) return null;
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        data.documentId !== documentId || data.locale !== locale) {
      throw Error('Неожиданный detail ' + uid + '/' + documentId + '/' + locale + '/' + status);
    }
    if (status === 'published' && data.publishedAt == null) {
      throw Error('Не подтверждена Published версия ' + locale + '/' + documentId);
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

  async function relationList(uid, documentId, field, locale, status = 'draft', withEntries = false) {
    const entries = [], rows = [];
    let page = 1, first = null;
    for (;;) {
      checkStop();
      const endpoint = '/content-manager/relations/' + uid + '/' + documentId + '/' +
        encodeURIComponent(field) + '?locale=' + locale + '&status=' + status + '&page=' +
        page + '&pageSize=' + CFG.pageSize;
      const json = await request(endpoint);
      const p = pagination(json, page, first);
      if (!first) first = p;
      for (const row of json.results) {
        if (typeof row?.documentId !== 'string' || !row.documentId) {
          throw Error('Relation ' + field + '/' + locale + ' без documentId (' + documentId + ')');
        }
        entries.push(row.documentId);
        if (withEntries) rows.push({id:row.id,documentId:row.documentId,locale:row.locale||locale});
      }
      if (page >= p.pageCount || p.pageCount === 0) break;
      if (page >= CFG.maxPages) throw Error('Превышен лимит страниц relation ' + field);
      page++;
    }
    if (entries.length !== first.total || new Set(entries).size !== entries.length) {
      throw Error('Relation ' + field + '/' + locale + ' count/duplicate mismatch ' + documentId);
    }
    return withEntries ? rows.sort((a,b)=>a.documentId.localeCompare(b.documentId)) : entries.sort();
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
      issue(issues, localized ? 'translation_review' : 'shared_kk_empty', path,
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

  // Каждый снимок содержит исходный detail для аварийного восстановления,
  // нормализованные поля (без служебных ID вложенных компонентов)
  // и полные relation documentId, прочитанные со ВСЕХ страниц.
  async function snapshotVersion(documentId, locale, status, schema, components, relationFields) {
    const data = await detail(CFG.productUid, documentId, locale, status);
    if (!data) return null;
    const pairs = await eachLimited(relationFields, CFG.relationWorkers, async field =>
      [field, await relationList(CFG.productUid, documentId, field, locale, status, true)]);
    return {
      relationEntries: Object.fromEntries(pairs),
      meta: { id: data.id, status: data.status, publishedAt: data.publishedAt ?? null,
        createdAt: data.createdAt, updatedAt: data.updatedAt },
      detail: data,
      fields: productFields(data, schema, components),
      relations: Object.fromEntries(pairs.map(([field,rows])=>
        [field,rows.map(row=>row.documentId)]))
    };
  }

  const versionEqual = (a,b) => {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return equal(a.fields,b.fields) && equal(a.relations,b.relations);
  };

  function analyzePlan(base, schema, components, relationFields) {
    const draftRu = base.snapshots.ru.draft, draftKk = base.snapshots.kk.draft;
    const pubRu = base.snapshots.ru.published, pubKk = base.snapshots.kk.published;
    const plan = {
      actions: [], operationTypes: [], blockers: [], translationReview: [],
      missingTargets: [], modifications: 0, fieldTypes: [],
      needPublishRu: false, needPublishKk: false, needsSaveKk: false,
      eligible: false, ready: false
    };
    if (!draftRu) plan.blockers.push('RU Draft отсутствует');
    if (!draftKk) plan.blockers.push('KK Draft отсутствует: перевод не создаём автоматически');
    if (!draftRu || !draftKk) return plan;
    const src = draftRu.detail, dst = draftKk.detail;
    for (const [field, attr] of Object.entries(schema.attributes)) {
      if (SYSTEM.has(field) || attr?.type === 'relation') continue;
      const ru = draftRu.fields[field], kk = draftKk.fields[field];
      const localized = flagLocalized(attr);
      if (attr.required && !present(ru)) {
        plan.blockers.push('Обязательное поле RU пусто: ' + field);
        continue;
      }
      if (localized) {
        if (present(ru) && !present(kk)) plan.translationReview.push(field);
        continue;
      }
      if (attr.unique === true) {
        if (field !== 'key' || typeof src[field] !== 'string' || !src[field].length) {
          plan.blockers.push('Unique field требует отдельного контракта: ' + field);
          continue;
        }
        // У одного documentId общий key во всех локалях.
        // unique запрещает повторное значение у ДРУГОГО Product, не у kk того же документа.
        const expected = src[field];
        if (dst[field] !== expected) {
          plan.actions.push({ kind: 'unique_key', field, ru: src[field], kk: dst[field],
            expected, uniquenessCheck: 'global-check-required-before-write' });
          plan.operationTypes.push('unique:key');
        }
        continue;
      }
      if (!equal(ru,kk)) {
        let type = attr.type;
        if (type === 'component' || type === 'dynamiczone') {
          // Различия только в локализуемом вложенном контенте допустимы.
          const issues = base.issues.filter(x => x.path === field ||
            x.path.startsWith(field+'.') || x.path.startsWith(field+'['));
          if (!issues.length) continue;
          plan.actions.push({ kind: 'nested_review', field, type, ru, kk });
          plan.blockers.push('Нужен безопасный payload вложенного поля: ' + field);
          continue;
        }
        if (!SCALARS.has(type) && type !== 'media') {
          plan.blockers.push('Неподдержанный тип: ' + field + '/' + type);
          continue;
        }
        if (type === 'media' && (ru?.__invalidMedia || kk?.__invalidMedia)) {
          plan.blockers.push('Не подтверждены media ID: ' + field);
          continue;
        }
        plan.actions.push({ kind: type === 'media' ? 'media' : 'field',
          field, type, ru, kk, expected: ru });
        plan.operationTypes.push(type === 'media' ? 'media' : 'field:' + type);
      }
    }
    for (const field of relationFields) {
      const attr = schema.attributes[field];
      const ruIds = draftRu.relations[field] || [];
      const kkIds = draftKk.relations[field] || [];
      const ruSet = new Set(ruIds), kkSet = new Set(kkIds);
      const connect = ruIds.filter(id => !kkSet.has(id));
      const disconnect = kkIds.filter(id => !ruSet.has(id));
      if (connect.length || disconnect.length) {
        plan.actions.push({ kind: 'relation', field, target: attr.target,
          connect, disconnect, ruTotal: ruIds.length, kkTotal: kkIds.length });
        if (connect.length) plan.operationTypes.push('relation:' + field + ':connect');
        if (disconnect.length) plan.operationTypes.push('relation:' + field + ':disconnect');
      }
    }
    for (const item of base.issues) {
      if (item.kind === 'translation_review' && !plan.translationReview.includes(item.path))
        plan.translationReview.push(item.path);
      if (['unverified','component_structure','required_ru_empty'].includes(item.kind))
        plan.blockers.push(item.path + ': ' + item.detail);
    }
    plan.operationTypes = [...new Set(plan.operationTypes)].sort();
    plan.fieldTypes = [...new Set(plan.actions.map(a => a.type || a.kind))].sort();
    plan.modifications = plan.actions.reduce((n,a) =>
      n + (a.kind === 'relation' ? a.connect.length + a.disconnect.length : 1), 0);
    plan.needsSaveKk = plan.actions.length > 0;
    plan.needPublishRu = !versionEqual(draftRu,pubRu);
    plan.needPublishKk = plan.needsSaveKk || !versionEqual(draftKk,pubKk);
    plan.blockers = [...new Set(plan.blockers)];
    plan.eligible = !plan.blockers.length;
    plan.ready = plan.eligible && (plan.needsSaveKk || plan.needPublishRu || plan.needPublishKk);
    return plan;
  }

  async function auditProduct(documentId, schema, components, relationFields) {
    const base = {
      documentId, name: '', status: 'ok', issues: [],
      localizedDifferent: 0, kkOnlyFilled: 0,
      snapshots: { ru: { draft: null, published: null },
        kk: { draft: null, published: null } }, plan: null
    };
    const versions = await Promise.all([
      snapshotVersion(documentId,'ru','draft',schema,components,relationFields),
      snapshotVersion(documentId,'ru','published',schema,components,relationFields),
      snapshotVersion(documentId,'kk','draft',schema,components,relationFields),
      snapshotVersion(documentId,'kk','published',schema,components,relationFields)
    ]);
    base.snapshots.ru.draft = versions[0];
    base.snapshots.ru.published = versions[1];
    base.snapshots.kk.draft = versions[2];
    base.snapshots.kk.published = versions[3];
    const ru = versions[0], kk = versions[2];
    base.name = ru?.detail.name || ru?.detail.name1 || '';
    if (!ru) issue(base.issues,'missing_ru','*','RU Draft отсутствует');
    if (!kk) issue(base.issues,'missing_kk','*','KK Draft отсутствует');
    if (ru && kk) {
      const meta = { localizedDifferent: 0, kkOnlyFilled: 0 };
      for (const [field, attr] of Object.entries(schema.attributes)) {
        if (SYSTEM.has(field) || attr.type === 'relation') continue;
        compareField(attr,ru.detail[field],kk.detail[field],field,components,base.issues,meta);
      }
      for (const field of relationFields) {
        const source = ru.relations[field], target = kk.relations[field];
        const rs = new Set(source), ks = new Set(target);
        const missing = source.filter(id => !ks.has(id));
        const extra = target.filter(id => !rs.has(id));
        if (missing.length || extra.length) issue(base.issues,'relation_diff',field,
          'Не хватает KK: ' + missing.length + '; лишних KK: ' + extra.length,
          missing, extra);
      }
      base.localizedDifferent = meta.localizedDifferent;
      base.kkOnlyFilled = meta.kkOnlyFilled;
    }
    base.plan = analyzePlan(base,schema,components,relationFields);
    base.status = !ru ? 'review' : !kk ? 'missing_kk' :
      base.plan.blockers.length ? 'review' :
      base.plan.ready ? 'pending' :
      base.issues.some(x=>x.kind!=='translation_review') ? 'diff' : 'ok';
    return base;
  }

  // План из v3/v4 строился на неверном правиле key+0.
  // Пересчитываем по ИСХОДНЫМ снимкам, не выполняя записей и не теряя
  // проверенные блокировки отсутствующих KK справочников.
  function refreshPlansFromBackup(products,schema,components) {
    const fields=Object.entries(schema.attributes).filter(([name,a])=>
      !SYSTEM.has(name) && a.type==='relation').map(([name])=>name);
    return products.map(original=>{
      const row={...original};
      const plan=analyzePlan(row,schema,components,fields);
      const missing=original.plan?.missingTargets||[];
      plan.missingTargets=missing;
      if (missing.length) {
        plan.blockers.push('Нет KK Draft у '+missing.length+' связанных записей');
        plan.eligible=false;plan.ready=false;
      }
      row.plan=plan;
      row.status=!row.snapshots?.ru?.draft?'review':
        !row.snapshots?.kk?.draft?'missing_kk':
        plan.blockers.length?'blocked':plan.ready?'pending':'ok';
      return row;
    });
  }

  // Отсутствие KK у любого target из RU блокирует конкретный товар,
  // не запускает создание справочников и не влияет на другие товары.
  async function verifyRelationTargets(schema) {
    // Проверяем ВСЕ связи RU, а не только missing для connect:
    // даже уже совпадающая relation может вести на запись без KK Draft.
    const needs = new Map();
    for (const row of state.report.products.filter(Boolean)) {
      for (const [field, ids] of Object.entries(row.snapshots.ru.draft?.relations || {})) {
        const uid = schema.attributes[field]?.target;
        for (const id of ids) needs.set(uid + '|' + id, {uid, id});
      }
    }
    state.targetsTotal = needs.size;
    const pairs = await eachLimited([...needs.values()], CFG.targetWorkers, async target => {
      const found = await detail(target.uid,target.id,'kk','draft');
      const ok = !!found && Number.isInteger(found.id) && found.id > 0;
      state.targetsDone++;
      render('Проверяем наличие KK у связанных записей…');
      return [target.uid + '|' + target.id, ok];
    });
    state.targetCache = new Map(pairs);
    for (const row of state.report.products.filter(Boolean)) {
      for (const [field, ids] of Object.entries(row.snapshots.ru.draft?.relations || {})) {
        const uid = schema.attributes[field]?.target;
        for (const id of ids) {
          if (!state.targetCache.get(uid + '|' + id))
            row.plan.missingTargets.push({field, target:uid, documentId:id});
        }
      }
      if (row.plan.missingTargets.length) {
        row.plan.blockers.push('Нет KK Draft у '+row.plan.missingTargets.length+' связанных записей');
        row.plan.eligible = false; row.plan.ready = false; row.status = 'blocked';
      }
    }
  }

  async function filteredProductKey(key,locale,status) {
    const matches = [], seen = new Set();
    let page = 1, first = null;
    while (page <= CFG.maxPages) {
      const qs = new URLSearchParams({
        locale, status, page:String(page), pageSize:String(CFG.pageSize)
      });
      qs.set('filters[key][$eq]',key);
      const url = '/content-manager/collection-types/' + CFG.productUid + '?' + qs.toString();
      const json = await request(url);
      const rows = Array.isArray(json?.results) ? json.results : json?.data;
      const pg = json?.pagination || json?.meta?.pagination;
      if (!Array.isArray(rows) || !Number.isSafeInteger(pg?.total) ||
          !Number.isSafeInteger(pg?.pageCount) ||
          (first && (first.total!==pg.total || first.pageCount!==pg.pageCount))) {
        throw Error('Не подтверждён фильтр уникальности key: ' + locale+'/'+status);
      }
      if (!first) first = {total:pg.total,pageCount:pg.pageCount};
      for (const row of rows) {
        const product = row?.attributes && !row.documentId ?
          {...row.attributes,id:row.id} : row;
        if (typeof product?.documentId !== 'string' ||
            product?.key !== key || product?.locale !== locale ||
            seen.has(product.documentId)) {
          throw Error('Фильтр Product key вернул не тот товар/локаль или дубль');
        }
        seen.add(product.documentId);
        matches.push(product.documentId);
      }
      if (page >= pg.pageCount || pg.pageCount === 0) break;
      page++;
    }
    if (!first || page>CFG.maxPages || matches.length!==first.total)
      throw Error('Неполная выборка по key: '+key);
    return matches;
  }

  async function globalKeyCheck(ruKey,desiredKey,documentId) {
    if (typeof ruKey !== 'string' || !ruKey ||
        typeof desiredKey !== 'string' || desiredKey !== ruKey) {
      throw Error('Для всех локалей одного Product key должен совпадать с RU');
    }
    // Положительный контроль доказывает, что фильтр действительно применяется.
    const control = await filteredProductKey(ruKey,'ru','draft');
    if (!control.includes(documentId)) {
      throw Error('Не подтверждён CM фильтр по известному RU key: '+ruKey);
    }
    const checked = [];
    for (const locale of ['ru','kk']) {
      for (const status of ['draft','published']) {
        const ids = await filteredProductKey(desiredKey,locale,status);
        const foreign = ids.filter(id=>id!==documentId);
        if (foreign.length) throw Error('Конфликт уникального key '+
          desiredKey+' у '+locale+'/'+status+': '+foreign.join(','));
        checked.push({locale,status,matches:ids});
      }
    }
    return {at:new Date().toISOString(),ruKey,desiredKey,positiveControl:control,
      checked,scope:'all Product via filtered Content Manager, ru/kk draft/published'};
  }

  function choosePilot() {
    const skipped=new Set(state.report.skipped.map(x=>x.documentId));
    const done=new Set(savedProgress().map(x=>x.id));
    const rows = state.report.products.filter(r => r?.plan?.ready &&
      r.plan.eligible && !skipped.has(r.documentId) && !done.has(r.documentId));
    rows.sort((a,b) => b.plan.modifications - a.plan.modifications ||
      b.plan.operationTypes.length - a.plan.operationTypes.length ||
      a.documentId.localeCompare(b.documentId));
    const p = rows[0];
    return p ? { documentId:p.documentId, name:p.name,
      modifications:p.plan.modifications, types:p.plan.operationTypes,
      plannedActions:p.plan.actions, needPublishRu:p.plan.needPublishRu,
      needPublishKk:p.plan.needPublishKk } : null;
  }

  function summarize() {
    const rows = state.report.products.filter(Boolean);
    const issues = rows.flatMap(r => r.issues || []);
    const ruRelations = rows.reduce((n,r) => n + Object.values(
      r.snapshots.ru.draft?.relations || {}).reduce((x,ids)=>x+ids.length,0),0);
    const kkRelations = rows.reduce((n,r) => n + Object.values(
      r.snapshots.kk.draft?.relations || {}).reduce((x,ids)=>x+ids.length,0),0);
    return {
      total:state.total, processed:rows.length,
      ok:count('ok'), pending:count('pending'), review:count('review'),
      blocked:count('blocked'), missingKk:count('missing_kk'),
      plannedWrites:rows.filter(r=>r.plan?.needsSaveKk&&r.plan.eligible).length,
      plannedPublishesRu:rows.filter(r=>r.plan?.needPublishRu&&r.plan.eligible).length,
      plannedPublishesKk:rows.filter(r=>r.plan?.needPublishKk&&r.plan.eligible).length,
      plannedChanges:rows.filter(r=>r.plan?.eligible).reduce((n,r)=>n+r.plan.modifications,0),
      translationReviews:rows.reduce((n,r)=>n+r.plan.translationReview.length,0),
      relationDifferences:issues.filter(x=>x.kind==='relation_diff').length,
      sharedDifferences:issues.filter(x=>x.kind==='shared_value_diff'||x.kind==='shared_kk_empty').length,
      relationEntriesRu:ruRelations, relationEntriesKk:kkRelations,
      missingRelationEntries:issues.filter(x=>x.kind==='relation_diff').reduce((n,x)=>n+x.ru.length,0),
      extraRelationEntries:issues.filter(x=>x.kind==='relation_diff').reduce((n,x)=>n+x.kk.length,0),
      uniqueFieldsInSchema:state.report.schema.filter(x=>x.unique).length,
      localizedFieldsInSchema:state.report.schema.filter(x=>x.localized).length,
      relationFieldsInSchema:state.report.schema.filter(x=>x.type==='relation').length,
      getRequests:state.getCount, getRetries:state.getRetries
    };
  }
  function downloadBackup() {
    // Единственный полный JSON dry-run: схема, RU/KK Draft/Published,
    // план изменений, проблемы, проверенные target KK и пилотный кандидат.
    const output = {
      ...state.report,
      products: state.report.products.filter(Boolean)
    };
    const blob = new Blob([JSON.stringify(output,null,2)],{
      type:'application/json;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const a = node('a');
    a.download = BACKUP_NAME; a.href = url;
    document.body.append(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),15000);
  }

  function versionSummary(item) {
    return item && {
      fields:item.fields, relations:item.relations,
      meta:item.meta
    };
  }
  async function allVersions(documentId) {
    const fields = Object.entries(state.schema.attributes).filter(([field,a])=>
      !SYSTEM.has(field) && a.type === 'relation').map(([field])=>field);
    const [ruDraft,ruPublished,kkDraft,kkPublished]=await Promise.all([
      snapshotVersion(documentId,'ru','draft',state.schema,state.components,fields),
      snapshotVersion(documentId,'ru','published',state.schema,state.components,fields),
      snapshotVersion(documentId,'kk','draft',state.schema,state.components,fields),
      snapshotVersion(documentId,'kk','published',state.schema,state.components,fields)
    ]);
    return {ru:{draft:ruDraft,published:ruPublished},
      kk:{draft:kkDraft,published:kkPublished}};
  }
  function stateDifferences(a,b) {
    const bad=[];
    for (const locale of ['ru','kk']) for (const status of ['draft','published']) {
      if (!versionEqual(a[locale][status],b[locale][status]))
        bad.push(locale+'/'+status);
    }
    return bad;
  }
  function payloadContent(before,locale) {
    const ru=before.ru.draft?.detail, kk=before.kk.draft?.detail;
    if (!ru || !kk) throw Error('Нет RU/KK Draft для полного payload');
    const payload={locale};
    for (const [field,attr] of Object.entries(state.schema.attributes)) {
      if (SYSTEM.has(field) || attr.type === 'relation') continue;
      if (attr.type === 'component' || attr.type === 'dynamiczone') {
        const a=ru[field],b=kk[field];
        if (Array.isArray(a) && !a.length && Array.isArray(b) && !b.length) {
          payload[field]=[]; continue;
        }
        if (a == null && b == null) {payload[field]=null;continue;}
        throw Error('Непроверенный непустой component/DZ: '+field);
      }
      let value;
      if (field === 'key' && attr.unique === true) {
        value = ru[field];
      } else if (attr.type === 'media') {
        value = normalizeMedia(ru[field]);
        if (Array.isArray(value) ? value.some(id=>idOfMedia(id)==null) :
            value!=null && idOfMedia(value)==null) {
          throw Error('Media без числовых ID: '+field);
        }
      } else if (SCALARS.has(attr.type)) {
        value = locale === 'kk' && flagLocalized(attr) ? kk[field] : ru[field];
      } else {
        throw Error('Неподдерживаемое поле payload: '+field+'/'+attr.type);
      }
      if (value === undefined) throw Error('Отсутствует поле '+field+' в '+locale+' payload');
      if (attr.required && !present(value))
        throw Error('Required поле пусто: '+field+'/'+locale);
      payload[field]=value;
    }
    return payload;
  }
  function expectedKkFields(before,payload) {
    const expected={...before.kk.draft.fields};
    for (const [field,value] of Object.entries(payload)) {
      if (field!=='locale' && state.schema.attributes[field]?.type!=='relation')
        expected[field]=canonical(value);
    }
    return expected;
  }
  async function checkFreshDependencies(before) {
    const checked=[];
    for (const [field,ids] of Object.entries(before.ru.draft.relations)) {
      const attr=state.schema.attributes[field];
      for (const id of ids) {
        const target=await detail(attr.target,id,'kk','draft');
        if (!Number.isInteger(target?.id) || target.id<=0) {
          return {ok:false,missing:{field,uid:attr.target,documentId:id}};
        }
        checked.push({field,documentId:id,numericId:target.id});
      }
    }
    return {ok:true,checked};
  }
  // Content Manager status=published может вернуть 404/пустое data либо
  // запись с publishedAt=null, если target существует только в KK Draft.
  // Никаких записей в target: только GET текущего состояния.
  async function kkPublishedDependency(uid,documentId) {
    const json=await request(detailPath(uid,documentId,'kk','published'),true);
    if (json===null || json.data==null) return false;
    const item=json.data;
    if (!item || typeof item!=='object' || Array.isArray(item) ||
        item.documentId!==documentId || item.locale!=='kk')
      throw Error('Неожиданный ответ Published KK target '+uid+'/'+documentId);
    return typeof item.publishedAt==='string' && item.publishedAt.length>0;
  }
  async function publicationDependencies(snapshot) {
    const source=snapshot?.ru?.draft;
    if (!source?.relations) throw Error('Нет RU Draft relations перед проверкой Publish KK');
    const targets=new Map(),refs=[];
    for (const [field,ids] of Object.entries(source.relations)) {
      const uid=state.schema.attributes[field]?.target;
      if (!uid?.startsWith('api::') || !Array.isArray(ids))
        throw Error('Не подтверждена схема relation перед Publish: '+field);
      for (const documentId of ids) {
        if (typeof documentId!=='string' || !documentId)
          throw Error('Некорректный target documentId: '+field);
        const key=uid+'|'+documentId;
        targets.set(key,{uid,documentId});
        refs.push({field,uid,documentId,key});
      }
    }
    // Проверяем полные связи, включая те, которые уже существовали в KK Draft.
    const verified=await eachLimited([...targets.entries()],CFG.targetWorkers,async ([key,t])=>
      [key,await kkPublishedDependency(t.uid,t.documentId)]);
    const statuses=new Map(verified);
    const missing=refs.filter(x=>!statuses.get(x.key)).map(({field,uid,documentId})=>
      ({field,uid,documentId}));
    return {ok:missing.length===0,missing,checked:targets.size};
  }
  function publishedVisibleRelations(draftRelations,missing) {
    const omit=new Set(missing.map(x=>x.field+'|'+x.documentId));
    return Object.fromEntries(Object.entries(draftRelations).map(([field,ids])=>
      [field,ids.filter(id=>!omit.has(field+'|'+id))]));
  }
  async function payloadRelations(before,plan,payload) {
    for (const action of plan.actions.filter(x=>x.kind==='relation')) {
      const connect=[],disconnect=[];
      for (const documentId of action.connect) {
        const entity=await detail(action.target,documentId,'kk','draft');
        if (!Number.isInteger(entity?.id) || entity.id<=0)
          throw Error('Отсутствует KK target для connect '+action.field+':'+documentId);
        connect.push({id:entity.id,documentId,locale:'kk'});
      }
      const attached=before.kk.draft.relationEntries?.[action.field];
      if (!Array.isArray(attached))
        throw Error('Не подтверждены полные KK relation entries: '+action.field);
      for (const documentId of action.disconnect) {
        const target=attached.find(x=>x.documentId===documentId);
        if (!Number.isInteger(target?.id) || target.id<=0)
          throw Error('Нет numeric ID для disconnect '+action.field+':'+documentId);
        disconnect.push({id:target.id,documentId,locale:'kk'});
      }
      payload[action.field]={connect,disconnect};
    }
    return payload;
  }
  function assertRuProtected(before,after,what) {
    const changed=[];
    for (const status of ['draft','published']) {
      if (!versionEqual(before.ru[status],after.ru[status]))
        changed.push('RU '+status);
    }
    if (changed.length) {
      const error=Error(what+': потеря данных '+changed.join(','));
      error.ruDamaged=true;
      throw error;
    }
  }
  function assertKKDraftExpected(after,expectedFields,expectedRelations) {
    if (!after.kk.draft) throw Error('KK Draft исчезла');
    if (!equal(after.kk.draft.fields,expectedFields))
      throw Error('KK Draft бизнес-поля не соответствуют ожидаемому snapshot');
    if (!equal(after.kk.draft.relations,expectedRelations))
      throw Error('KK Draft relations не совпадают с RU');
  }
  function verifyAfterSave(before,after,payload) {
    assertRuProtected(before,after,'Save KK');
    if (!versionEqual(before.kk.published,after.kk.published))
      throw Error('Save KK неожиданно изменил KK Published');
    assertKKDraftExpected(after,expectedKkFields(before,payload),before.ru.draft.relations);
  }
  function verifyAfterPublish(before,after,locale) {
    if (locale==='ru') {
      if (!versionEqual(before.ru.draft,after.ru.draft)) {
        const e=Error('Publish RU изменил RU Draft'); e.ruDamaged=true; throw e;
      }
      if (!versionEqual(after.ru.draft,after.ru.published))
        throw Error('RU Published не совпадает с RU Draft');
      if (!versionEqual(before.kk.draft,after.kk.draft) ||
          !versionEqual(before.kk.published,after.kk.published))
        throw Error('Publish RU изменил KK');
    } else {
      assertRuProtected(before,after,'Publish KK');
      if (!versionEqual(before.kk.draft,after.kk.draft))
        throw Error('Publish KK изменил KK Draft');
      if (!versionEqual(after.kk.draft,after.kk.published))
        throw Error('KK Published не соответствует KK Draft');
    }
  }
  async function schemaPreflight() {
    const [types,componentsResponse] = await Promise.all([
      request('/content-manager/content-types'),
      request('/content-manager/components')
    ]);
    const schema=types?.data?.find(x=>x.uid===CFG.productUid);
    if (!schema?.attributes || !equal(schema.attributes,state.schema.attributes) ||
        !equal(componentsResponse?.data,state.report.rawSchemas.components))
      throw Error('Схемы Product/компонентов изменились после backup');
  }
  function safeReadReport() {
    const p=state.report;
    return {
      ...p,mode:p.mode,
      products:p.products.filter(Boolean),
      sourceBackup:{file:BACKUP_NAME,at:p.startedAt}
    };
  }
  function downloadResult() {
    state.report.runtimeSummary={
      getRequests:state.getCount,getRetries:state.getRetries,
      writesAttempted:state.report.operations?.length||0,
      writesVerified:state.report.operations?.filter(x=>x.verified).length||0,
      productsVerified:savedProgress().length,
      productsSkipped:state.report.skipped?.length||0
    };
    const output=safeReadReport();
    const u=URL.createObjectURL(new Blob([JSON.stringify(output,null,2)],
      {type:'application/json;charset=utf-8'}));
    const a=node('a');
    a.href=u;a.download=RESULT_NAME;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(u),15000);
  }
  function recordStop(reason) {
    state.running=false;state.critical=false;
    state.report.mode='result';state.report.executionFailure=reason;
    state.report.stoppedAt=new Date().toISOString();
    state.report.unresolved=journal();
    state.report.progress=savedProgress();
    console.error('[DIOR Pipeline] STOP:',reason);
    const ruDamaged=state.report.operations.some(x=>x.ruDamaged);
    render('СТОП: '+reason+'. Скачан полный JSON. Новых записей нет.'+
      (ruDamaged?'\nRU повреждена: восстановление пока НЕ запускалось — recovery-контракт не проверен.':''));
    setAction('Скачать JSON повторно',downloadResult);
    downloadResult();
  }
  async function writeStep(documentId,phase,method,url,payload,before,verify) {
    if (journal()) throw Error('Есть unresolved операция: сначала ручной разбор журнала');
    const entry={documentId,phase,method,url,at:new Date().toISOString(),
      attempted:false,verified:false,
      payload, snapshots:{before}, errors:[]};
    state.report.operations.push(entry);
    setJournal({documentId,phase,method,at:entry.at,reason:'Результат записи не подтверждён'});
    entry.attempted=true;
    state.critical=true;
    render('Запись '+phase+' '+documentId+' и обязательная GET-проверка…');
    let response=null,networkError=null;
    try {
      const r=await fetch(url,{
        method,credentials:'include',cache:'no-store',
        headers:{Authorization:'Bearer '+token,Accept:'application/json',
          'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      });
      const body=await r.text();
      let data=null;
      try{data=body?JSON.parse(body):null;}catch{/* Неоднозначный результат */ }
      response={status:r.status,ok:r.ok,message:data?.error?.message||body.slice(0,250)};
    } catch (error) {networkError=String(error.message||error);}
    entry.response=response||{status:'NETWORK',ok:false,message:networkError};
    let after;
    try {after=await allVersions(documentId);}
    catch (error) {
      entry.verificationError=String(error.message||error);
      throw Error('Невозможно прочитать postflight '+phase+': '+entry.verificationError);
    }
    entry.snapshots.after=after;
    try {
      verify(before,after);
      if (!response?.ok || networkError)
        throw Error('Неоднозначный HTTP/NETWORK '+phase+': '+entry.response.message);
    } catch (error) {
      entry.errors.push(String(error.message||error));
      entry.ruDamaged=!!error.ruDamaged;
      throw error;
    } finally {state.critical=false;}
    entry.verified=true;
    saveStage({documentId,phase,at:new Date().toISOString(),
      after:{ru:{draft:versionSummary(after.ru.draft),
        published:versionSummary(after.ru.published)},
        kk:{draft:versionSummary(after.kk.draft),
          published:versionSummary(after.kk.published)}}});
    clearJournal();
    return after;
  }
  function requiredTypes(plan) {
    const types=[...plan.operationTypes];
    if (plan.needPublishRu) types.push('publish:ru');
    if (plan.needPublishKk) types.push('publish:kk');
    return [...new Set(types)].sort();
  }
  function baselineRow(documentId) {
    return state.report.products.find(row=>row?.documentId===documentId);
  }
  async function oneProduct(documentId,pilot=false) {
    const baseline=baselineRow(documentId);
    if (!baseline?.plan?.eligible) return {skipped:'blocked'};
    if (journal()) throw Error('Осталась unresolved запись: '+journal().documentId);
    await schemaPreflight();
    const before=await allVersions(documentId);
    const stage=verifiedStage();
    if (stage && (stage.reason || stage.documentId!==documentId))
      throw Error('Есть незавершённый подтверждённый этап другого товара: '+stage.documentId);
    if (!versionEqual(baseline.snapshots.ru.draft,before.ru.draft))
      return {skipped:'source_changed'};
    if (stage) {
      if (stateDifferences(stage.after,before).length)
        return {skipped:'verified_stage_changed'};
    } else {
      if (!versionEqual(baseline.snapshots.ru.published,before.ru.published))
        return {skipped:'source_changed'};
      if (!versionEqual(baseline.snapshots.kk.draft,before.kk.draft) ||
          !versionEqual(baseline.snapshots.kk.published,before.kk.published))
        return {skipped:'target_changed'};
    }
    const dependencies=await checkFreshDependencies(before);
    if (!dependencies.ok) return {skipped:'missing_kk_target',missing:dependencies.missing};
    const planned=baseline.plan;
    if (planned.needPublishKk || planned.needsSaveKk) {
      const published=await publicationDependencies(before);
      if (!published.ok) {
        deferProduct(documentId,published.missing,stage?'after-verified-save':'before-save');
        if (stage) clearStage(); // Save уже проверен; запрет повторного PUT сохраняется через defer.
        return {skipped:'unpublished_kk_target',missing:published.missing};
      }
    }
    if (!planned.ready) return {skipped:'verified'};
    const receipt={documentId,name:baseline.name,pilot,at:new Date().toISOString(),
      types:requiredTypes(planned),plannedActions:planned.actions,
      baseline:before,steps:[],verified:false};
    state.report.execution=state.report.execution||[];
    state.report.execution.push(receipt);
    let current=before;
    if (planned.needsSaveKk && !stage) {
      // Даже если ключ уже совпадает, проверяем его уникальность по другим Product.
      receipt.keyCheck=await globalKeyCheck(before.ru.draft.detail.key,
        before.ru.draft.detail.key,documentId);
      state.report.safety.globalKeyUniquenessVerified=true;
      const payload=await payloadRelations(current,planned,payloadContent(current,'kk'));
      const url='/content-manager/collection-types/'+CFG.productUid+'/'+documentId+'?locale=kk';
      const actualBefore=await allVersions(documentId);
      if (stateDifferences(current,actualBefore).length)
        return {skipped:'preflight_changed'};
      current=await writeStep(documentId,'save-kk','PUT',url,payload,actualBefore,
        (pre,post)=>verifyAfterSave(pre,post,payload));
      receipt.steps.push('save-kk');
      checkStop();
    }
    // Даже если Save не нужен, Published сравниваем с последним Draft.
    if (!versionEqual(current.ru.draft,current.ru.published)) {
      const pre=await allVersions(documentId);
      if (stateDifferences(current,pre).length)
        throw Error('Перед Publish RU состояние изменилось');
      const payload=payloadContent(pre,'ru');
      current=await writeStep(documentId,'publish-ru','POST',
        '/content-manager/collection-types/'+CFG.productUid+'/'+documentId+
          '/actions/publish?locale=ru',payload,pre,
        (a,b)=>verifyAfterPublish(a,b,'ru'));
      receipt.steps.push('publish-ru');
      checkStop();
    }
    if (!versionEqual(current.kk.draft,current.kk.published)) {
      const pre=await allVersions(documentId);
      if (stateDifferences(current,pre).length)
        throw Error('Перед Publish KK состояние изменилось');
      const publication=await publicationDependencies(pre);
      if (!publication.ok) {
        // Изменение target после Save. Подтверждённый Save уже в stage journal.
        deferProduct(documentId,publication.missing,'after-verified-save');
        clearStage();
        receipt.skipped='unpublished_kk_target';
        receipt.missing=publication.missing;
        return {skipped:'unpublished_kk_target',missing:publication.missing};
      }
      receipt.publishKeyCheck=await globalKeyCheck(pre.ru.draft.detail.key,
        pre.ru.draft.detail.key,documentId);
      const payload=payloadContent(pre,'kk');
      current=await writeStep(documentId,'publish-kk','POST',
        '/content-manager/collection-types/'+CFG.productUid+'/'+documentId+
          '/actions/publish?locale=kk',payload,pre,
        (a,b)=>verifyAfterPublish(a,b,'kk'));
      receipt.steps.push('publish-kk');
      checkStop();
    }
    if (!versionEqual(current.ru.draft,current.ru.published) ||
        !versionEqual(current.kk.draft,current.kk.published) ||
        !equal(current.ru.draft.relations,current.kk.draft.relations)) {
      throw Error('Финальная сверка Published/relations не выполнена');
    }
    receipt.verified=true;receipt.finishedAt=new Date().toISOString();
    receipt.final=current;
    markProgress(documentId,receipt.types,{automatedPilot:pilot});
    clearStage();
    return {verified:true,types:receipt.types,receipt};
  }
  // После ручной публикации уже частично записанного пилота разрешён
  // ТОЛЬКО read-only контроль: никаких повторных PUT/POST и неочевидной
  // автоматической перезаписи из backup.
  function expectedKkFromOriginalBackup(baseline) {
    const originalRu=baseline.snapshots.ru.draft;
    const originalKk=baseline.snapshots.kk.draft;
    const fields={...originalKk.fields};
    for (const [name,a] of Object.entries(state.schema.attributes)) {
      if (SYSTEM.has(name) || a.type==='relation') continue;
      if (!flagLocalized(a)) fields[name]=originalRu.fields[name];
    }
    return fields;
  }
  async function reconcileStoppedPilot() {
    const unresolved=journal();
    if (state.running) return;
    if (unresolved?.reason !== 'Результат записи не подтверждён' ||
        unresolved?.phase !== 'save-kk' || unresolved?.method !== 'PUT' ||
        !unresolved?.documentId) {
      render('Нельзя сверить автоматически: журнал не соответствует Save KK.');
      return;
    }
    const original=baselineRow(unresolved.documentId);
    if (!original?.snapshots?.ru?.draft || !original.snapshots?.kk?.draft) {
      render('Нет полного исходного снимка остановленного товара');
      return;
    }
    if (!confirm('Выполнить только GET-проверку остановленного товара?\n'+
      'Никаких Save/Publish и автоматической очистки без успешного сравнения.')) return;
    state.running=true;state.stopped=false;
    setAction('Остановить',stopRunning);
    const record={documentId:unresolved.documentId,kind:'manual-publish-reconciliation',
      at:new Date().toISOString(),verified:false,conditions:[],before:original.snapshots};
    state.report.reconciliations=state.report.reconciliations||[];
    state.report.reconciliations.push(record);
    try {
      await schemaPreflight();
      const after=await allVersions(unresolved.documentId);
      record.after=after;
      const add=(name,ok)=>{record.conditions.push({name,ok});};
      add('RU Draft неизменён',versionEqual(original.snapshots.ru.draft,after.ru.draft));
      add('RU Published неизменён',versionEqual(original.snapshots.ru.published,after.ru.published));
      const fields=expectedKkFromOriginalBackup(original);
      add('KK Draft все поля и переводы',!!after.kk.draft && equal(fields,after.kk.draft.fields));
      add('KK Published все поля и переводы',!!after.kk.published && equal(fields,after.kk.published.fields));
      add('KK Draft все relations',equal(original.snapshots.ru.draft.relations,after.kk.draft?.relations));
      add('KK Published все relations',equal(original.snapshots.ru.draft.relations,after.kk.published?.relations));
      add('RU/KK key одинаковый в обеих версиях',
        ['draft','published'].every(status=>
          after.ru[status]?.fields?.key === after.kk[status]?.fields?.key &&
          after.ru[status]?.fields?.key === original.snapshots.ru.draft.fields.key));
      const failed=record.conditions.filter(x=>!x.ok).map(x=>x.name);
      record.verified=!failed.length;
      if (failed.length) {
        record.failure=failed;
        state.running=false;
        render('НЕ СВЕРЕНО: '+failed.join('; ')+'. Unresolved не очищен.');
        setAction('Скачать JSON результата',downloadResult);
        downloadResult();
        return;
      }
      // Проверка после ручного Publish не делает Publish проверенной операцией скрипта.
      // Отмечаем только этот Product, а новый пилот выбирается из оставшихся.
      record.finishedAt=new Date().toISOString();
      markProgress(unresolved.documentId,[],{manualRecovered:true});
      clearJournal();
      clearStage();
      state.report.pilotCandidate=choosePilot();
      state.report.mode='manual-reconciled';
      downloadResult();
      state.running=false;
      if (state.report.pilotCandidate) {
        render('Ручной пилот сверён по GET. Новый пилот нужен для проверки POST Publish.'+
          '\n'+state.report.pilotCandidate.name);
        setAction('Запустить пилот',runPilot);
      } else {
        render('Ручная проверка выполнена; доступных товаров нет.');
        setAction('Скачать JSON результата',downloadResult);
      }
    } catch (error) {
      state.running=false;
      record.failure=[String(error.message||error)];
      render('Проверка прервана: '+record.failure[0]+'. Unresolved не очищен.');
      setAction('Скачать JSON результата',downloadResult);
      downloadResult();
    }
  }

  function setPendingState(message,handler,buttonLabel) {
    state.running=false;state.critical=false;state.stopped=false;
    render(message);setAction(buttonLabel,handler);
  }
  async function runPilot() {
    if (state.running || journal()) {
      if (journal()) render('СТОП: unresolved журнал, записи запрещены');
      return;
    }
    const candidate=state.report.pilotCandidate;
    if (!candidate) return;
    const description=candidate.name+'\n'+candidate.documentId+
      '\nИзменений: '+candidate.modifications+'\nТипы: '+candidate.types.join(', ');
    if (!confirm('Подтверждаю, что полный '+BACKUP_NAME+' сохранён на диске.'+
      '\n\nЗапустить пилот одного товара, а после полного успеха '+
      'АВТОМАТИЧЕСКИ синхронизировать ВСЕ доступные товары DIOR?\n'+description+
      '\n\nОстальные типы изменений будут проверяться для каждого товара.'+
      '\nПри первой ошибке STOP, без автоматического восстановления RU.')) return;
    state.running=true;state.stopped=false;setAction('Остановить',stopRunning);
    try {
      const output=await oneProduct(candidate.documentId,true);
      if (output.skipped) {
        state.report.skipped.push({documentId:candidate.documentId,reason:output.skipped});
        state.report.pilotCandidate=choosePilot();
        setPendingState('Пилот пропущен: '+output.skipped+'. Массовый запуск не начат.',runPilot,'Запустить другой пилот');
        return;
      }
      state.report.verifiedTypes=[...new Set([...state.report.verifiedTypes,...output.types])].sort();
      state.report.mode='pilot-verified';
      state.report.pilotResult={documentId:candidate.documentId,at:new Date().toISOString(),
        types:output.types,verified:true};
      state.report.progress=savedProgress();
      // Если пользователь остановил во время финальной проверки пилота,
      // не переходить к batch даже при подтверждённой записи.
      checkStop();
      // Без второй кнопки и подтверждения. Результат скачивается в конце
      // batch или при STOP, чтобы не дублировать многомегабайтный JSON.
      state.running=false;
      await runBatch();
    } catch (error) {
      recordStop(String(error.message||error));
    }
  }
  async function verifyCompletedFromCheckpoint(documentId) {
    const original=baselineRow(documentId);
    if (!original?.snapshots.ru.draft) throw Error('Checkpoint без RU baseline '+documentId);
    const now=await allVersions(documentId);
    if (!versionEqual(original.snapshots.ru.draft,now.ru.draft))
      throw Error('RU Draft обработанного товара изменён: '+documentId);
    if (!versionEqual(now.ru.draft,now.ru.published))
      throw Error('RU Published обработанного товара устарела: '+documentId);
    if (!versionEqual(now.kk.draft,now.kk.published))
      throw Error('KK Published обработанного товара устарела: '+documentId);
    if (!equal(now.ru.draft.relations,now.kk.draft.relations))
      throw Error('Связи обработанного товара расходятся: '+documentId);
    const desired=expectedKkFields(now,payloadContent(now,'kk'));
    if (!equal(now.kk.draft.fields,desired))
      throw Error('KK поля обработанного товара расходятся: '+documentId);
    return {documentId,verified:true,at:new Date().toISOString()};
  }

  async function runBatch() {
    // Вызывается сразу после успешного пилота или вручную при возобновлении
    // ранее подтверждённого пилота. Второго confirm нет.
    if (state.running || journal() || !state.report.pilotResult?.verified) return;
    state.running=true;state.stopped=false;
    state.report.mode='batch-running';
    state.batch={total:0,processed:0,verified:0,skipped:0,alreadyDone:0,
      startedAt:new Date().toISOString(),finishedAt:null};
    state.report.batchSummary=state.batch;
    setAction('Остановить',stopRunning);
    try {
      const stage=verifiedStage();
      if (stage) {
        if (stage.reason || !stage.documentId) throw Error('Некорректный checkpoint');
        const recovered=await oneProduct(stage.documentId,false);
        if (!recovered.verified)
          throw Error('Не удалось продолжить подтверждённый этап '+stage.documentId);
      }
      const already=savedProgress();
      state.report.checkpointVerifications=[];
      for (let i=0;i<already.length;i++) {
        checkStop();
        render('Повторная проверка checkpoint '+(i+1)+'/'+already.length);
        const result=await verifyCompletedFromCheckpoint(already[i].id);
        state.report.checkpointVerifications.push(result);
      }
      // Только запланированные, доступные товары. Недостающие KK targets
      // уже отмечены как blocked и не получат PUT/POST.
      const rows=state.report.products.filter(row=>row?.plan?.ready && row.plan.eligible &&
        row.documentId!==state.report.pilotResult.documentId);
      state.batch.total=rows.length;
      const completed=new Set(savedProgress().map(p=>p.id));
      for (const row of rows) {
        checkStop();
        if (completed.has(row.documentId)) {
          state.batch.alreadyDone++;
        } else {
          render('Синхронизируем '+row.name+' · '+row.documentId);
          const output=await oneProduct(row.documentId);
          if (output.verified) {
            state.batch.verified++;
            completed.add(row.documentId);
          } else {
            state.batch.skipped++;
            state.report.skipped.push({documentId:row.documentId,
              reason:output.skipped||'unverified',missing:output.missing||null});
          }
          await sleep(200);
        }
        state.batch.processed++;
        render('Синхронизация DIOR: '+state.batch.processed+'/'+state.batch.total);
      }
      checkStop();
      state.batch.finishedAt=new Date().toISOString();
      state.report.mode='batch-finished';
      state.report.progress=savedProgress();
      state.running=false;
      render('Обработка завершена: '+state.batch.verified+' проверено, '+
        state.batch.skipped+' пропущено, '+state.batch.alreadyDone+' уже были выполнены.'+
        '\nЗаблокированные товары остаются в отчёте.');
      setAction('Скачать JSON повторно',downloadResult);
      downloadResult();
    } catch (error) {
      recordStop(String(error.message||error));
    }
  }

  function finish(complete,reason=null,fromMemory=false) {
    state.running=false;
    state.report.complete=complete;state.report.failure=reason;
    state.report.finishedAt=new Date().toISOString();
    state.report.summary=summarize();
    window.tmDiorProductsKkAudit=state.report;
    if (!complete) {
      render('Dry-run прерван: '+reason+'. Скачан неполный JSON.');
      setAction('Скачать JSON повторно',downloadBackup);
      downloadBackup();
      return;
    }
    const incomplete=verifiedStage();
    state.report.pilotCandidate=choosePilot();
    if (incomplete && incomplete.documentId) {
      const row=baselineRow(incomplete.documentId);
      if (row) state.report.pilotCandidate={
        documentId:row.documentId,name:row.name,
        modifications:row.plan.modifications,types:row.plan.operationTypes,
        plannedActions:row.plan.actions
      };
    }
    state.report.plan.writesEnabled=!!state.report.pilotCandidate&&!journal();
    state.report.writesEnabled=!!state.report.pilotCandidate&&!journal();
    if (journal() || incomplete?.reason) {
      const j=journal();
      if (j?.phase==='save-kk' && j?.method==='PUT' && j?.documentId &&
          j?.reason==='Результат записи не подтверждён' && !incomplete?.reason) {
        render('Есть незавершённый пилот '+j.documentId+
          '. Перед любым новым пилотом нужна GET-сверка после ручной публикации.');
        setAction('Проверить остановленный пилот',reconcileStoppedPilot);
      } else {
        render('Записи запрещены: unresolved journal или повреждённый checkpoint.');
        setAction('Скачать JSON повторно',downloadBackup);
      }
    } else if (incomplete?.documentId && state.report.pilotCandidate) {
      render('Найден подтверждённый незавершённый этап: '+incomplete.phase+
        '\n'+incomplete.documentId+'. Повторного PUT не будет.');
      setAction('Продолжить товар',runPilot);
    } else if (state.report.pilotResult?.verified) {
      render('Пилот проверен. Нажми «Продолжить», чтобы синхронизировать все оставшиеся товары.');
      setAction('Продолжить синхронизацию',runBatch);
    } else if (savedProgress().some(p=>p.automatedPilot===true)) {
      // Признак автоматического успешного пилота сохраняется отдельно от
      // ручного восстановления: оно НЕ подтверждает pipeline Publish.
      const p=savedProgress().find(p=>p.automatedPilot===true);
      state.report.pilotResult={documentId:p.id,verified:true,
        recoveredFromCheckpoint:true,types:p.types};
      render('Автоматический пилот уже выполнен. При продолжении повторно проверим checkpoint.');
      setAction('Продолжить синхронизацию',runBatch);
    } else if (state.report.pilotCandidate) {
      const pilot=state.report.pilotCandidate;
      render((fromMemory?'Используем сохранённый backup. Проверь файл.':
        'Backup JSON скачан. Проверь файл.')+'\nПилот: '+pilot.name+
        '\n'+pilot.documentId+' · '+pilot.modifications+' изменений'+
        '\nПосле успеха пилота остальные доступные товары запускаются автоматически.');
      setAction('Запустить пилот → все товары',runPilot);
    } else {
      render('Dry-run готов. Доступных для пилота товаров нет.');
      setAction('Скачать JSON повторно',downloadBackup);
    }
    if (!fromMemory) downloadBackup();
  }


  let rescanLink=null;
  async function initial(imported=null) {
    rescanLink?.remove();rescanLink=null;
    state.running=true;state.stopped=false;
    setAction('Остановить',stopRunning);
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
    const brand = await detail(CFG.brandUid, CFG.brandDocumentId, 'ru');
    if (!brand) throw Error('RU Brand DIOR не найден');
    const components = Object.fromEntries(componentsList.map(x => [x.uid, x]));
    state.schema = productSchema;
    state.components = components;
    state.report.schema = nestedSchemaLines(productSchema.attributes, components, '');
    state.report.rawSchemas = { product: productSchema, components: componentsResponse.data };
    const sourceReport=imported || (reuse?prior:null);
    if (sourceReport) {
      const actualMembers=await brandProducts();
      const priorMembers=sourceReport.products.map(row=>row.documentId).sort();
      if (!equal(actualMembers,priorMembers)) throw Error(
        'Состав Brand DIOR изменился после backup: требуется новый dry-run');
      if (!equal(sourceReport.rawSchemas.product.attributes,productSchema.attributes) ||
          !equal(sourceReport.rawSchemas.components,componentsResponse.data)) {
        throw Error('Схема отличается от сохранённого backup. Нужен новый dry-run');
      }
      state.report={...sourceReport,version:7,mode:'dry-run',complete:true,failure:null,
        products:refreshPlansFromBackup(sourceReport.products,productSchema,components),
        operations:[],execution:[],
        verifiedTypes:[...new Set([...(sourceReport.verifiedTypes||[]),
          ...savedProgress().flatMap(x=>x.types||[])])],
        skipped:savedDeferred(),
        progress:savedProgress(),safety:{recoveryVerified:false,autoRecoveryEnabled:false,
          globalKeyUniquenessVerified:false},
        writesEnabled:false};
      state.total=sourceReport.products.length;
      state.processed=state.total;
      state.report.schema=nestedSchemaLines(productSchema.attributes,components,'');
      state.report.plan={...state.report.plan,
        uniquenessCheck:'unique-across-products-shared-within-document',
        revalidatedFrom:sourceReport.version};
      window.tmDiorProductsKkAudit=state.report;
      finish(true,null,true);
      return;
    }
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
    await verifyRelationTargets(productSchema);
    checkStop();
    state.report.pilotCandidate = choosePilot();
    state.report.plan = { phase:'dry-run-completed', records:state.total,
      writesEnabled:false, publicationEnabled:false,
      blockedCount:count('blocked')+count('review')+count('missing_kk'),
      backupRequired:true, uniquenessCheck:'unique-across-products-shared-within-document',
      note:'Перед pilot необходима подтверждённая проверка PUT/POST и recovery на live.' };
    finish(true);
    } catch (error) {
      const message=String(error.message||error);
      console.error('[DIOR Pipeline] STOP:',message);
      if (imported) {
        state.running=false;state.report.failure=message;
        render('Backup не принят: '+message+'. Записи не выполнялись.');
        setAction('Загрузить backup',()=>fileInput.click());
      } else {
        finish(false,message);
      }
    }
  }

  function validateBackup(r) {
    if (!r || r.complete!==true || ![3,4,5,6,7].includes(r.version) ||
        r.tool!=='dior-products-kk-pipeline' ||
        r.brandDocumentId!==CFG.brandDocumentId ||
        r.mode!=='dry-run' || !r.rawSchemas?.product?.attributes ||
        !Array.isArray(r.rawSchemas.components) || !Array.isArray(r.products) ||
        !r.products.length || !Array.isArray(r.schema)) {
      throw Error('Не полный backup pipeline DIOR версии 3/4/5/6/7');
    }
    const ids=new Set();
    for (const row of r.products) {
      if (!row?.documentId || ids.has(row.documentId) ||
          !row.snapshots?.ru?.draft?.fields || !row.snapshots?.ru?.draft?.relations ||
          !row.snapshots?.kk?.draft?.fields || !row.snapshots?.kk?.draft?.relations ||
          !row.plan?.actions || !Array.isArray(row.plan.operationTypes)) {
        throw Error('Backup содержит отсутствующие/повторные или неполные записи');
      }
      ids.add(row.documentId);
    }
    return r;
  }
  const fileInput=node('input');
  fileInput.type='file';
  fileInput.accept='.json,application/json';
  fileInput.style.display='none';
  panel.append(fileInput);
  fileInput.onchange=async()=>{
    try {
      const file=fileInput.files?.[0];
      if (!file) return;
      render('Читаем резервную копию…');
      const parsed=validateBackup(JSON.parse(await file.text()));
      await initial(parsed);
    } catch (error) {
      state.running=false;
      render('Не удалось прочитать backup: '+String(error.message||error));
      setAction('Загрузить backup',()=>fileInput.click());
    } finally {fileInput.value='';}
  };
  if (reuse) {
    await initial();
  } else {
    state.running=false;
    render('Открой сохранённый backup JSON, чтобы не повторять полный аудит.');
    setAction('Загрузить backup',()=>fileInput.click());
    rescanLink=node('a','Выполнить новый dry-run вместо загрузки');
    rescanLink.style.cssText='display:block;margin-top:9px;color:#c5c0ff;text-decoration:underline;cursor:pointer';
    rescanLink.onclick=()=>initial();
    panel.append(rescanLink);
  }
})();