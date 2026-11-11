// DIOR / Category RU -> KK. Один Category за запуск, только создание KK Draft.
// RU Draft/Published + все relations сохраняются и сравниваются до/после PUT.
// Публикация, пакетная запись, восстановление и автоматический повтор НЕ выполняются.
(async () => {
  'use strict';
  const UID = 'api::category.category';
  const BRAND_UID = 'api::brand.brand';
  const BRAND_ID = 'qw7sja6ffpbufvzub5maxyrl';
  const BRAND_FIELD = 'categories';
  const KEY = '__tmDiorCategoryKkSync';
  const PANEL_ID = 'tm-dior-category-kk-sync';
  const SYSTEM = new Set([
    'id', 'documentId', 'locale', 'status', 'publishedAt',
    'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'localizations'
  ]);
  const SCALAR = new Set([
    'string', 'text', 'richtext', 'email', 'enumeration', 'json',
    'integer', 'biginteger', 'float', 'decimal', 'boolean',
    'date', 'time', 'datetime'
  ]);
  const match = location.pathname.match(
    /^\/admin\/content-manager\/collection-types\/api::category\.category\/([a-z0-9]+)\/?$/i
  );
  const selectedLocale = new URLSearchParams(location.search)
    .get('plugins[i18n][locale]');
  if (!match || (selectedLocale && selectedLocale !== 'ru')) {
    console.error('[Category KK]', 'Открой RU-карточку категории DIOR');
    return;
  }
  const documentId = match[1];
  if (window[KEY]?.running) {
    console.warn('[Category KK]', 'Операция уже выполняется');
    return;
  }
  if (window[KEY]?.stage === 'ready') {
    console.warn('[Category KK]', 'Preflight уже открыт. Используй существующую панель');
    return;
  }
  let token;
  try { token = JSON.parse(localStorage.getItem('jwtToken')); }
  catch { token = localStorage.getItem('jwtToken'); }
  if (typeof token !== 'string' || !token) {
    console.error('[Category KK]', 'Нет JWT авторизованной Strapi Admin');
    return;
  }

  document.getElementById(PANEL_ID)?.remove();
  const state = {
    running: false, stage: 'checking', schema: null, before: null, plan: null,
    attempted: false, getCount: 0,
    report: {
      tool: 'dior-category-kk-sync', version: 1, readOnlyUntilConfirmation: true,
      uid: UID, documentId, brandDocumentId: BRAND_ID,
      startedAt: new Date().toISOString(), schemaFields: null,
      preflight: null, before: null, after: null,
      write: null, verification: null, errors: [], success: false
    }
  };
  window[KEY] = state;
  window.tmDiorCategoryKkSyncReport = state.report;

  const el = (tag, label) => {
    const node = document.createElement(tag);
    if (label != null) node.textContent = String(label);
    return node;
  };
  const panel = el('section');
  panel.id = PANEL_ID;
  Object.assign(panel.style, {
    position: 'fixed', bottom: '16px', right: '16px', zIndex: '2147483600',
    width: 'min(460px, calc(100vw - 32px))', maxHeight: '78vh',
    overflowY: 'auto', border: '1px solid #8484af', borderRadius: '10px',
    background: '#202035', color: '#fff', padding: '15px',
    font: '13px/1.5 system-ui', boxShadow: '0 8px 32px #0009'
  });
  const headline = el('strong', 'DIOR · Category RU → KK (одна запись)');
  const sub = el('div', 'documentId: ' + documentId);
  sub.style.cssText = 'font:12px monospace;margin:6px 0;word-break:break-all';
  const status = el('div', 'Preflight: GET схема, RU/KK и relations…');
  status.style.cssText = 'white-space:pre-wrap;margin:11px 0';
  const controls = el('div');
  controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
  const createButton = el('button', 'Preflight…');
  const downloadButton = el('button', 'Скачать JSON');
  const closeButton = el('button', 'Закрыть');
  for (const b of [createButton, downloadButton, closeButton]) {
    b.type = 'button';
    b.style.cssText = 'padding:7px 10px;cursor:pointer;background:#444472;color:white;border:1px solid #9292b9;border-radius:6px';
    controls.append(b);
  }
  createButton.disabled = true;
  panel.append(headline, sub, status, controls);
  document.body.append(panel);
  closeButton.onclick = () => {
    if (state.running) return;
    if (state.stage === 'ready') state.stage = 'closed';
    panel.remove();
  };
  const show = (message, isError = false) => {
    status.textContent = message + '\nGET: ' + state.getCount;
    status.style.color = isError ? '#ffb0b0' : '#eee';
    console[isError ? 'error' : 'log']('[Category KK]', message);
  };
  function download() {
    const blob = new Blob([JSON.stringify(state.report, null, 2)], {
      type: 'application/json;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const a = el('a');
    a.href = url;
    a.download = 'dior-category-kk-sync-' + documentId + '.json';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }
  downloadButton.onclick = download;
  const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      const out = {};
      for (const name of Object.keys(value).sort()) out[name] = canonical(value[name]);
      return out;
    }
    return value;
  };
  const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const empty = value => value == null ||
    (typeof value === 'string' && !value.trim()) ||
    (Array.isArray(value) && !value.length);
  const isLocalized = attr => attr?.pluginOptions?.i18n?.localized === true;
  const mediaIDs = value => {
    if (value === null) return { ok: true, value: null };
    const getId = x => Number.isInteger(x) && x > 0 ? x :
      Number.isInteger(x?.id) && x.id > 0 ? x.id : null;
    if (Array.isArray(value)) {
      const ids = value.map(getId);
      return ids.includes(null) ? { ok: false } : { ok: true, value: ids };
    }
    const id = getId(value);
    return id === null ? { ok: false } : { ok: true, value: id };
  };

  async function request(method, path, body) {
    state.getCount += method === 'GET' ? 1 : 0;
    const response = await fetch(path, {
      method, credentials: 'include', cache: 'no-store',
      headers: {
        Authorization: 'Bearer ' + token, Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const content = await response.text();
    let json = null;
    try { json = content ? JSON.parse(content) : null; } catch { /* error below */ }
    return { ok: response.ok, status: response.status, data: json,
      message: response.ok ? '' : String(json?.error?.message || content).slice(0, 300) };
  }
  async function get(path) {
    const result = await request('GET', path);
    if (!result.ok) throw Error('GET HTTP ' + result.status + ' ' + path + ': ' + result.message);
    return result.data;
  }
  function decode(result, locale, published) {
    const data = result?.data?.data;
    if (result?.status === 404 ||
      (result?.ok && (data == null ||
       (typeof data === 'object' && !Array.isArray(data) &&
        Object.keys(data).length === 0)))) return null;
    if (!result?.ok || data?.documentId !== documentId || data?.locale !== locale ||
       (published && data.publishedAt == null)) {
      throw Error('Неоднозначный detail ' + locale + '/' + (published ? 'published' : 'draft') +
        ': HTTP ' + result?.status);
    }
    return data;
  }
  const detailPath = (locale, publication) =>
    '/content-manager/collection-types/' + UID + '/' + documentId +
    '?locale=' + locale + '&status=' + publication;
  function relations(schema) {
    const out = [];
    for (const [field, attr] of Object.entries(schema.attributes)) {
      if (SYSTEM.has(field) || attr.type !== 'relation') continue;
      if (typeof attr.target !== 'string' || !attr.target.startsWith('api::')) {
        throw Error('Неизвестная бизнес-relation ' + field + '/' + attr.target);
      }
      if (attr.pluginOptions?.i18n?.localized === false) {
        throw Error('Нелокализуемая relation требует отдельной обработки: ' + field);
      }
      out.push(field);
    }
    return out;
  }
  async function relationSnapshot(locale, publication, names) {
    const out = {};
    for (const name of names) {
      let page = 1, pages = null, total = null;
      const entries = [];
      while (true) {
        const value = await get('/content-manager/relations/' + UID + '/' +
          documentId + '/' + encodeURIComponent(name) + '?locale=' + locale +
          '&status=' + publication + '&page=' + page + '&pageSize=100');
        const rows = value?.results;
        const p = value?.pagination;
        if (!Array.isArray(rows) || !Number.isInteger(p?.total) || p.total < 0 ||
            !Number.isInteger(p?.pageCount) || p.pageCount < 0 ||
            (p.total > 0 && !rows.length) ||
            (total !== null && total !== p.total) ||
            (pages !== null && pages !== p.pageCount) ||
            (p.page != null && p.page !== page)) {
          throw Error('Некорректная relation-пагинация ' + name + '/' + locale + '/' + publication);
        }
        total = p.total;
        pages = p.pageCount;
        for (const item of rows) {
          if (item?.documentId == null && item?.id == null)
            throw Error('Отсутствует ID relation ' + name);
          entries.push({ documentId: String(item.documentId ?? ''), id: item.id ?? null });
        }
        if (page >= pages || pages === 0) break;
        if (page >= 100) throw Error('Слишком много страниц relation ' + name);
        page++;
      }
      if (entries.length !== total)
        throw Error('Relation ' + name + ': count mismatch ' + entries.length + '/' + total);
      out[name] = {
        total,
        entries: entries.sort((a, b) =>
          a.documentId.localeCompare(b.documentId) || String(a.id).localeCompare(String(b.id)))
      };
    }
    return out;
  }
  function businessFields(detail, schema) {
    const result = {};
    for (const [name, attr] of Object.entries(schema.attributes)) {
      if (SYSTEM.has(name) || attr.type === 'relation') continue;
      if (!Object.prototype.hasOwnProperty.call(detail, name)) {
        result[name] = { __missing: true };
        continue;
      }
      const value = detail[name];
      if (attr.type === 'media') {
        const mapped = mediaIDs(value);
        result[name] = mapped.ok ? mapped.value : { __invalidMedia: true };
      } else result[name] = value;
    }
    return canonical(result);
  }
  async function snapshot(schema) {
    const names = relations(schema);
    const responses = await Promise.all([
      request('GET', detailPath('ru', 'draft')),
      request('GET', detailPath('ru', 'published')),
      request('GET', detailPath('kk', 'draft')),
      request('GET', detailPath('kk', 'published'))
    ]);
    const ruDraft = decode(responses[0], 'ru', false);
    const ruPublished = decode(responses[1], 'ru', true);
    const kkDraft = decode(responses[2], 'kk', false);
    const kkPublished = decode(responses[3], 'kk', true);
    if (!ruDraft) throw Error('RU Draft отсутствует');
    const data = {
      ru: { draft: ruDraft, published: ruPublished },
      kk: { draft: kkDraft, published: kkPublished }
    };
    for (const locale of ['ru', 'kk']) {
      for (const publication of ['draft', 'published']) {
        const entry = data[locale][publication];
        data[locale][publication] = entry ? {
          detail: entry,
          business: businessFields(entry, schema),
          relations: await relationSnapshot(locale, publication, names)
        } : null;
      }
    }
    return data;
  }
  function diff(expected, actual) {
    return Object.keys(expected || {}).filter(name => !equal(expected[name], actual?.[name]));
  }
  function compare(name, expected, actual, errors, strictMeta = false) {
    if (!expected && !actual) return;
    if (!expected || !actual) { errors.push(name + ': версия исчезла/появилась'); return; }
    const fieldChanges = diff(expected.business, actual.business);
    const relationChanges = diff(expected.relations, actual.relations);
    if (fieldChanges.length) errors.push(name + ': поля ' + fieldChanges.join(', '));
    if (relationChanges.length) errors.push(name + ': relations ' + relationChanges.join(', '));
    if (strictMeta) {
      for (const field of ['id', 'updatedAt', 'publishedAt', 'status']) {
        if (!equal(expected.detail[field], actual.detail[field]))
          errors.push(name + ': изменилось служебное поле ' + field);
      }
    }
  }
  function beforeDiff(a, b) {
    const errors = [];
    compare('RU Draft', a.ru.draft, b.ru.draft, errors, true);
    compare('RU Published', a.ru.published, b.ru.published, errors, true);
    compare('KK Draft', a.kk.draft, b.kk.draft, errors, true);
    compare('KK Published', a.kk.published, b.kk.published, errors, true);
    return errors;
  }
  function buildPayload(schema, ru) {
    const payload = { locale: 'kk' }, blockers = [];
    for (const [name, attr] of Object.entries(schema.attributes)) {
      if (SYSTEM.has(name)) continue;
      if (attr.type === 'relation') continue; // localized relations: отдельно
      if (!Object.prototype.hasOwnProperty.call(ru, name) || ru[name] === undefined) {
        blockers.push('RU поле отсутствует: ' + name); continue;
      }
      const value = ru[name];
      if (attr.required && empty(value)) {
        blockers.push('Обязательное поле RU пусто: ' + name); continue;
      }
      if (attr.type === 'uid') {
        if (value == null || value === '') payload[name] = null;
        else blockers.push('Непустой UID требует отдельной проверки: ' + name);
      } else if (attr.type === 'password') {
        blockers.push('Password нельзя переносить напрямую: ' + name);
      } else if (attr.unique === true && isLocalized(attr) && !empty(value)) {
        blockers.push('Локализуемое unique-поле: ' + name);
      } else if (SCALAR.has(attr.type)) {
        if (attr.type !== 'json' && value !== null && typeof value === 'object')
          blockers.push('Неверный тип scalar: ' + name);
        else payload[name] = value;
      } else if (attr.type === 'media') {
        const normalized = mediaIDs(value);
        if (!normalized.ok) blockers.push('Нет media ID: ' + name);
        else payload[name] = normalized.value;
      } else if (attr.type === 'component' || attr.type === 'dynamiczone' || attr.type === 'blocks') {
        if (value === null) payload[name] = null;
        else if (Array.isArray(value) && !value.length) payload[name] = [];
        else blockers.push('Непустое сложное поле ' + attr.type + ': ' + name);
      } else blockers.push('Неизвестный тип ' + attr.type + ': ' + name);
    }
    return { payload, blockers };
  }
  async function membership() {
    const seen = new Set();
    let page = 1, total = null, pages = null, raw = 0;
    while (true) {
      const json = await get('/content-manager/relations/' + BRAND_UID + '/' +
        BRAND_ID + '/' + BRAND_FIELD + '?locale=ru&page=' + page + '&pageSize=100');
      const rows = json?.results, p = json?.pagination;
      if (!Array.isArray(rows) || !Number.isInteger(p?.total) ||
        !Number.isInteger(p?.pageCount) ||
        (total !== null && total !== p.total) ||
        (pages !== null && pages !== p.pageCount) ||
        (p.total > 0 && !rows.length)) {
        throw Error('Не удалось полностью подтвердить relation DIOR.categories');
      }
      total = p.total; pages = p.pageCount;
      for (const row of rows) { if (row.documentId) seen.add(row.documentId); raw++; }
      if (page >= pages || pages === 0) break;
      if (page >= 100) throw Error('DIOR.categories: слишком много страниц');
      page++;
    }
    if (raw !== total) throw Error('DIOR.categories неполная: ' + raw + '/' + total);
    return { total, unique: seen.size, includesCurrent: seen.has(documentId) };
  }
  function summarizeSchema(schema) {
    return Object.fromEntries(Object.entries(schema.attributes)
      .filter(([name]) => !SYSTEM.has(name))
      .map(([name, attr]) => [name, {
        type: attr.type, required: attr.required === true,
        localized: attr.type === 'relation' ?
          attr.pluginOptions?.i18n?.localized !== false : isLocalized(attr),
        target: attr.target ?? null, unique: attr.unique === true
      }]));
  }
  function fail(reason, autoDownload = false) {
    state.stage = 'failed';
    state.report.errors.push(reason);
    state.report.finishedAt = new Date().toISOString();
    createButton.disabled = true;
    show('СТОП: ' + reason + '\nНет следующих операций. JSON доступен в панели.', true);
    if (autoDownload) download();
  }
  async function preflight() {
    state.running = true;
    createButton.disabled = true;
    try {
      show('GET: актуальная схема, связь DIOR.categories, RU/KK и все relations…');
      const list = await get('/content-manager/content-types');
      const schema = list?.data?.find(x => x?.uid === UID);
      if (!schema?.attributes || schema.pluginOptions?.i18n?.localized !== true)
        throw Error('Схема Category/i18n не подтверждена');
      const brand = await membership();
      if (!brand.includesCurrent) throw Error('Category не входит в DIOR.categories');
      const before = await snapshot(schema);
      const plan = buildPayload(schema, before.ru.draft.detail);
      const blockers = [...plan.blockers];
      if (before.kk.draft || before.kk.published)
        blockers.push('KK уже существует; повторное создание запрещено');
      state.schema = schema; state.before = before; state.plan = plan;
      state.report.schemaFields = summarizeSchema(schema);
      state.report.before = before;
      state.report.preflight = {
        checkedAt: new Date().toISOString(), brand,
        ruStatus: before.ru.draft.detail.status,
        ruPublished: !!before.ru.published,
        kkMissing: !before.kk.draft && !before.kk.published,
        fieldCount: Object.keys(state.report.schemaFields).length,
        relationFields: Object.keys(before.ru.draft.relations).length,
        sharedCount: Object.entries(state.report.schemaFields)
          .filter(([, attr]) => !attr.localized).length,
        requiredCount: Object.entries(state.report.schemaFields)
          .filter(([, attr]) => attr.required).length,
        blockers, payload: plan.payload
      };
      if (blockers.length) {
        fail('Preflight: ' + blockers.join(' | '));
        return;
      }
      state.stage = 'ready';
      createButton.disabled = false;
      createButton.textContent = 'Создать KK Draft (1 PUT)';
      show('Preflight пройден. Category входит в DIOR.categories (' + brand.total + ').' +
        '\nОбщих полей: ' + state.report.preflight.sharedCount +
        ', обязательных: ' + state.report.preflight.requiredCount +
        ', relations: ' + state.report.preflight.relationFields +
        '.\nSnapshot RU Draft/Published сохранён в журнале.' +
        '\nНажатие кнопки создаст ровно один KK Draft. Публикации не будет.');
    } catch (error) { fail('Preflight: ' + String(error.message || error)); }
    finally { state.running = false; }
  }
  async function createOne() {
    if (state.running || state.stage !== 'ready') return;
    if (!confirm('Создать ТОЛЬКО KK Draft для категории ' + documentId +
      '?\nВсе текущие RU Draft/Published и relations будут повторно проверены перед PUT.'+
      '\nПосле PUT — проверка RU и KK. Без Publish, rollback и повторов.')) return;
    state.running = true; createButton.disabled = true;
    try {
      show('GET: сверка актуального состояния перед PUT…');
      const list = await get('/content-manager/content-types');
      const schema = list?.data?.find(x => x?.uid === UID);
      if (!schema?.attributes || !equal(schema.attributes, state.schema.attributes))
        throw Error('Схема Category изменилась после Preflight');
      const brand = await membership();
      if (!brand.includesCurrent) throw Error('Категория больше не связана с DIOR');
      const before = await snapshot(state.schema);
      const changes = beforeDiff(state.before, before);
      if (changes.length) throw Error('Снимок устарел: ' + changes.join(' | '));
      const plan = buildPayload(state.schema, before.ru.draft.detail);
      if (plan.blockers.length || !equal(plan.payload, state.plan.payload))
        throw Error('Payload изменился: ' + plan.blockers.join(' | '));
      if (before.kk.draft || before.kk.published)
        throw Error('KK уже существует, PUT запрещён');
      state.report.write = { at: new Date().toISOString(),
        method: 'PUT', locale: 'kk', payload: plan.payload, attempted: false };
      state.attempted = true;
      state.report.write.attempted = true;
      show('PUT: создаём KK Draft с полным снимком полей RU…');
      let response = null, networkError = null;
      try {
        response = await request('PUT',
          '/content-manager/collection-types/' + UID + '/' + documentId + '?locale=kk',
          plan.payload);
      } catch (error) { networkError = String(error.message || error); }
      state.report.write.response = response ? {
        httpStatus: response.status, ok: response.ok, message: response.message
      } : { httpStatus: 'NETWORK', ok: false, message: networkError };
      show('GET: после PUT проверяем RU Draft/Published, KK и все relations…');
      const after = await snapshot(state.schema);
      state.report.after = after;
      const errors = [];
      compare('RU Draft', before.ru.draft, after.ru.draft, errors);
      compare('RU Published', before.ru.published, after.ru.published, errors);
      if (before.ru.draft?.detail?.id !== after.ru.draft?.detail?.id)
        errors.push('RU Draft id изменился');
      if (before.ru.published?.detail?.id !== after.ru.published?.detail?.id ||
          before.ru.published?.detail?.publishedAt !== after.ru.published?.detail?.publishedAt)
        errors.push('RU Published id/publishedAt изменились');
      if (!after.kk.draft) errors.push('KK Draft не создана');
      if (after.kk.published) errors.push('KK опубликована без запроса');
      if (after.kk.draft) {
        for (const [name, attr] of Object.entries(state.schema.attributes)) {
          if (SYSTEM.has(name) || attr.type === 'relation') continue;
          if (!equal(before.ru.draft.business[name], after.kk.draft.business[name]))
            errors.push('KK поле не совпадает с RU: ' + name);
        }
        for (const [name, relation] of Object.entries(after.kk.draft.relations)) {
          if (relation.total !== 0)
            errors.push('KK relation неожиданно заполнена: ' + name);
        }
      }
      if (networkError || !response?.ok)
        errors.unshift('PUT HTTP ' + (response?.status ?? 'NETWORK') + ': ' +
          (networkError || response?.message || 'unknown'));
      state.report.verification = {
        checkedAt: new Date().toISOString(), errors,
        ruBeforeStatus: before.ru.draft.detail.status,
        ruAfterStatus: after.ru.draft?.detail?.status ?? null,
        ruPublishedBefore: before.ru.published?.detail?.publishedAt ?? null,
        ruPublishedAfter: after.ru.published?.detail?.publishedAt ?? null,
        ruContentPreserved: !errors.some(x => x.startsWith('RU ')),
        kkCreated: !!after.kk.draft
      };
      if (errors.length) throw Error('Postflight: ' + errors.join(' | '));
      state.stage = 'complete';
      state.report.success = true;
      state.report.finishedAt = new Date().toISOString();
      show('Готово: KK Draft создана, RU Draft/Published и relations сохранены.' +
        '\nRU status: ' + before.ru.draft.detail.status + ' → ' +
        after.ru.draft.detail.status + '. Публикации НЕ было.' +
        '\nСкачан единый итоговый JSON.');
      download();
    } catch (error) { fail(String(error.message || error), !!state.attempted); }
    finally { state.running = false; createButton.disabled = true; }
  }
  createButton.onclick = createOne;
  await preflight();
})();