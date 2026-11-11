// DIOR / Category RU -> KK. Один Category за запуск; создание KK Draft
// либо строго разрешённый пилот восстановления существующей KK.
// RU Draft/Published + все relations сохраняются и сравниваются до/после PUT.
// Публикация, пакетная запись, восстановление и автоматический повтор НЕ выполняются.
(async () => {
  'use strict';
  const UID = 'api::category.category';
  const BRAND_UID = 'api::brand.brand';
  const BRAND_ID = 'qw7sja6ffpbufvzub5maxyrl';
  const BRAND_FIELD = 'categories';
  // Восстановление существующей KK разрешено только для проверенного ручного теста.
  const REPAIR_ID = 'q7mspugwd41y45u566r3xyux';
  const REPAIR_KK_ROW_ID = 12471;
  const REPAIR_BITRIX_ID = 1902;
  const KEY = '__tmDiorCategoryKkSync';
  const PANEL_ID = 'tm-dior-category-kk-sync';
  const SYSTEM = new Set([
    'id', 'documentId', 'locale', 'status', 'publishedAt',
    'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'localizations'
  ]);
  const SCALAR = new Set([
    'string', 'text', 'richtext', 'email', 'enumeration', 'json', 'blocks',
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
    running: false, stage: 'checking', mode: null, schema: null, components: null, before: null, plan: null,
    attempted: false, getCount: 0,
    report: {
      tool: 'dior-category-kk-sync', version: 2, readOnlyUntilConfirmation: true,
      uid: UID, documentId, brandDocumentId: BRAND_ID,
      startedAt: new Date().toISOString(), schemaFields: null, componentSchemas: null,
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
  // При переносе Strapi создает новые component id; переносим только поля по схеме.
  // Media нормализуется до числового id, вложенные items обходятся рекурсивно.
  const isObject = x => !!x && typeof x === 'object' && !Array.isArray(x);
  function normalizeRelation(value) {
    if (value == null) return null;
    if (Array.isArray(value)) return value.map(normalizeRelation);
    if (isObject(value)) {
      if (Number.isInteger(value.count)) return { count: value.count };
      if (typeof value.documentId === 'string') return { documentId: value.documentId };
      if (value.id != null) return { id: value.id };
      return canonical(value);
    }
    return value;
  }
  function normalizeValue(attr, value, fieldPath, mode, blockers, deferred, warnings = []) {
    const issue = message => {
      if (mode === 'payload') blockers.push(fieldPath + ': ' + message);
    };
    if (value === undefined) {
      issue('поле отсутствует в ответе RU');
      return { __missing: true };
    }
    if (attr.required === true && empty(value))
      issue('обязательное поле пусто');
    if (value === null)
      return attr.type === 'dynamiczone' && mode !== 'snapshot' ? [] : null;
    if (attr.type === 'uid') {
      if (!empty(value)) issue('непустой UID требует отдельной проверки');
      return value;
    }
    // В Strapi 5.13 unique не проверяется при сохранении Draft.
    // При Publish ограничение действует в пределах локали, поэтому
    // переносим исходное значение, но оставляем предупреждение для Publish.
    if (attr.unique === true && isLocalized(attr) && !empty(value) && mode === 'payload')
      warnings.push(fieldPath + ': localized unique — проверить перед Publish KK');
    if (SCALAR.has(attr.type)) {
      if (!['json','blocks'].includes(attr.type) && typeof value === 'object')
        issue('ожидался scalar, получен объект');
      return canonical(value);
    }
    if (attr.type === 'media') {
      const m = mediaIDs(value);
      if (!m.ok) issue('нет media ID');
      return m.ok ? m.value : { __invalidMedia: true };
    }
    if (attr.type === 'password') {
      issue('password нельзя копировать напрямую');
      return null;
    }
    if (attr.type === 'relation') {
      if (mode === 'snapshot') return normalizeRelation(value);
      if (mode === 'payload') {
        if (attr.pluginOptions?.i18n?.localized === false &&
            (value?.count > 0 || value?.documentId || value?.id ||
              Array.isArray(value) && value.length))
          issue('вложенная общая relation требует отдельной обработки');
        deferred.push(fieldPath);
      }
      return undefined;
    }
    if (attr.type === 'component' || attr.type === 'dynamiczone') {
      const one = (entry, uid, path, isDZ) => {
        const model = state.components?.[uid];
        if (!model?.attributes) {
          issue('нет схемы компонента '+uid);
          return { __unknownComponent: uid };
        }
        if (!isObject(entry)) {
          issue('неверная структура компонента '+uid);
          return { __invalidComponent: true };
        }
        const out = isDZ ? { __component: uid } : {};
        const unknown = Object.keys(entry).filter(name =>
          name !== '__component' && name !== '__pivot' &&
          !SYSTEM.has(name) && !Object.prototype.hasOwnProperty.call(model.attributes,name)
        );
        if (unknown.length) issue('поля вне схемы компонента '+uid+': '+unknown.join(', '));
        for (const [name, subAttr] of Object.entries(model.attributes)) {
          if (name === 'id' || SYSTEM.has(name)) continue;
          const nested = Object.prototype.hasOwnProperty.call(entry,name)
            ? entry[name] : undefined;
          const normalized = normalizeValue(subAttr, nested, path+'.'+name,
            mode, blockers, deferred, warnings);
          if (normalized !== undefined) out[name] = normalized;
        }
        return out;
      };
      if (attr.type === 'component') {
        if (typeof attr.component !== 'string') {
          issue('отсутствует UID компонента');
          return { __invalidComponentUID: true };
        }
        if (attr.repeatable) {
          if (!Array.isArray(value)) {
            issue('repeatable component не массив');
            return { __invalidRepeatable: true };
          }
          return value.map((item,i)=>one(item,attr.component,fieldPath+'['+i+']',false));
        }
        if (!isObject(value)) {
          issue('single component не объект');
          return { __invalidSingle: true };
        }
        return one(value,attr.component,fieldPath,false);
      }
      if (!Array.isArray(value)) {
        issue('Dynamic Zone не массив');
        return { __invalidDynamicZone: true };
      }
      return value.map((item,i)=>{
        const uid=item?.__component;
        if (typeof uid !== 'string' || !attr.components?.includes(uid)) {
          issue('неизвестный компонент Dynamic Zone: '+String(uid));
          return { __invalidDZComponent: String(uid) };
        }
        return one(item,uid,fieldPath+'['+i+']',true);
      });
    }
    issue('неподдержанный тип '+String(attr.type));
    return { __unsupportedType: String(attr.type) };
  }
  function businessFields(detail, schema) {
    const business={}, transferable={};
    for (const [name,attr] of Object.entries(schema.attributes)) {
      if (SYSTEM.has(name)||attr.type==='relation') continue;
      const v=Object.prototype.hasOwnProperty.call(detail,name)
        ?detail[name]:undefined;
      business[name]=normalizeValue(attr,v,name,'snapshot',[],[]);
      transferable[name]=normalizeValue(attr,v,name,'transfer',[],[]);
    }
    return { business:canonical(business), transferable:canonical(transferable) };
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
          ...businessFields(entry, schema),
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
  function pilotRepairBlockers(before) {
    const blockers = [];
    if (documentId !== REPAIR_ID) blockers.push('Сценарий восстановления разрешён только для Подарочных наборов');
    const ru = before.ru.draft, kk = before.kk.draft;
    if (!ru || !kk || before.kk.published) {
      blockers.push('Нужны RU Draft и существующая неопубликованная KK Draft');
      return blockers;
    }
    if (kk.detail.id !== REPAIR_KK_ROW_ID || kk.detail.locale !== 'kk' ||
        kk.detail.publishedAt !== null)
      blockers.push('KK Draft не совпадает с подтверждённой тестовой записью');
    if (ru.detail.bitrix_id !== REPAIR_BITRIX_ID || kk.detail.bitrix_id !== null)
      blockers.push('Состояние bitrix_id RU/KK отличается от ожидаемого 1902/null');
    const changed = diff(ru.transferable, kk.transferable);
    if (!equal(changed, ['bitrix_id']))
      blockers.push('Неожиданные различия KK: ' + changed.join(', '));
    for (const [name, relation] of Object.entries(kk.relations)) {
      if (relation.total !== 0)
        blockers.push('В KK уже есть relation ' + name + ', перенос отложен');
    }
    return blockers;
  }
  function buildPayload(schema, ru) {
    const payload={locale:'kk'},blockers=[],deferred=[],warnings=[];
    for(const [name,attr] of Object.entries(schema.attributes)){
      if(SYSTEM.has(name))continue;
      if(attr.type==='relation'){
        if(attr.pluginOptions?.i18n?.localized===false)
          blockers.push('Нелокализуемая relation: '+name);
        else deferred.push(name);
        continue;
      }
      const v=Object.prototype.hasOwnProperty.call(ru,name)?ru[name]:undefined;
      payload[name]=normalizeValue(attr,v,name,'payload',blockers,deferred,warnings);
    }
    return {payload,blockers,deferred,warnings};
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
      const [list, comps] = await Promise.all([
        get('/content-manager/content-types'), get('/content-manager/components')
      ]);
      const schema = list?.data?.find(x => x?.uid === UID);
      if(!Array.isArray(comps?.data) || !comps.data.every(c=>c?.uid&&c?.attributes))
        throw Error('Невозможно прочитать схемы компонентов');
      state.components=Object.fromEntries(comps.data.map(c=>[c.uid,c]));
      if (!schema?.attributes || schema.pluginOptions?.i18n?.localized !== true)
        throw Error('Схема Category/i18n не подтверждена');
      const brand = await membership();
      if (!brand.includesCurrent) throw Error('Category не входит в DIOR.categories');
      const before = await snapshot(schema);
      const plan = buildPayload(schema, before.ru.draft.detail);
      const blockers = [...plan.blockers];
      const repair = documentId === REPAIR_ID && !!before.kk.draft;
      if (repair) blockers.push(...pilotRepairBlockers(before));
      else if (before.kk.draft || before.kk.published)
        blockers.push('KK уже существует; повторное создание запрещено');
      state.mode = repair ? 'repair' : 'create';
      state.schema = schema; state.before = before; state.plan = plan;
      state.report.schemaFields = summarizeSchema(schema);
      state.report.componentSchemas=Object.fromEntries(
        Object.entries(state.components).map(([uid,c])=>[uid,{attributes:c.attributes}])
      );
      state.report.before = before;
      state.report.preflight = {
        checkedAt: new Date().toISOString(), brand,
        ruStatus: before.ru.draft.detail.status,
        ruPublished: !!before.ru.published,
        kkMissing: !before.kk.draft && !before.kk.published,
        mode: state.mode,
        kkChangedFields: before.kk.draft ?
          diff(before.ru.draft.transferable, before.kk.draft.transferable) : [],
        fieldCount: Object.keys(state.report.schemaFields).length,
        relationFields: Object.keys(before.ru.draft.relations).length,
        sharedCount: Object.entries(state.report.schemaFields)
          .filter(([, attr]) => !attr.localized).length,
        requiredCount: Object.entries(state.report.schemaFields)
          .filter(([, attr]) => attr.required).length,
        blockers, warnings: plan.warnings,
        deferredRelations: plan.deferred, payload: plan.payload
      };
      if (blockers.length) {
        fail('Preflight: ' + blockers.join(' | '));
        return;
      }
      state.stage = 'ready';
      createButton.disabled = false;
      createButton.textContent = state.mode === 'repair' ?
        'Дополнить KK Draft (1 PUT)' : 'Создать KK Draft (1 PUT)';
      show('Preflight пройден. Category входит в DIOR.categories (' + brand.total + ').' +
        (state.mode === 'repair' ?
          '\nПилот восстановления: KK Draft ID 12471, отличается только bitrix_id.' : '') +
        '\nОбщих полей: ' + state.report.preflight.sharedCount +
        ', обязательных: ' + state.report.preflight.requiredCount +
        ', relations: ' + state.report.preflight.relationFields +
        '.\nSnapshot RU Draft/Published сохранён в журнале.' +
        '\nDynamic Zone и вложенные items/media включены. Новые component id создаст Strapi.' +
        '\nUnique для Publish KK: ' + plan.warnings.length + ' предупреждений.' +
        '\nRelations — отдельно во втором проходе. Публикации не будет.');
    } catch (error) { fail('Preflight: ' + String(error.message || error)); }
    finally { state.running = false; }
  }
  async function createOne() {
    if (state.running || state.stage !== 'ready') return;
    if (!confirm((state.mode === 'repair' ?
      'ДОПОЛНИТЬ существующую KK Draft 12471' :
      'СОЗДАТЬ только KK Draft') + ' для категории ' + documentId +
      '?\nВсе RU Draft/Published, KK и relations будут повторно проверены перед PUT.'+
      '\nПосле PUT — проверка RU и KK. Без Publish, rollback и повторов.')) return;
    state.running = true; createButton.disabled = true;
    try {
      show('GET: сверка актуального состояния перед PUT…');
      const [list, comps] = await Promise.all([
        get('/content-manager/content-types'), get('/content-manager/components')
      ]);
      const schema = list?.data?.find(x => x?.uid === UID);
      const actual=Object.fromEntries((comps?.data||[]).map(c=>[c.uid,{attributes:c.attributes}]));
      if(!Array.isArray(comps?.data) || !equal(actual,state.report.componentSchemas))
        throw Error('Схемы компонентов изменились после Preflight');
      if (!schema?.attributes || !equal(schema.attributes, state.schema.attributes))
        throw Error('Схема Category изменилась после Preflight');
      const brand = await membership();
      if (!brand.includesCurrent) throw Error('Категория больше не связана с DIOR');
      const before = await snapshot(state.schema);
      const changes = beforeDiff(state.before, before);
      if (changes.length) throw Error('Снимок устарел: ' + changes.join(' | '));
      const plan = buildPayload(state.schema, before.ru.draft.detail);
      if (plan.blockers.length || !equal(plan.payload, state.plan.payload) ||
          !equal(plan.warnings, state.plan.warnings))
        throw Error('Payload изменился: ' + plan.blockers.join(' | '));
      if (state.mode === 'repair') {
        const issues = pilotRepairBlockers(before);
        if (issues.length) throw Error('Восстановление KK запрещено: ' + issues.join(' | '));
      } else if (before.kk.draft || before.kk.published) {
        throw Error('KK уже существует, PUT запрещён');
      }
      state.report.write = { at: new Date().toISOString(),
        mode: state.mode, existingKkId: before.kk.draft?.detail?.id ?? null,
        method: 'PUT', locale: 'kk', payload: plan.payload, attempted: false };
      state.attempted = true;
      state.report.write.attempted = true;
      show('PUT: ' + (state.mode === 'repair' ? 'дополняем' : 'создаём') +
        ' KK Draft с полным снимком полей RU…');
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
      if (!after.kk.draft) errors.push('KK Draft отсутствует после PUT');
      if (state.mode === 'repair' && after.kk.draft?.detail?.id !== REPAIR_KK_ROW_ID)
        errors.push('KK Draft ID изменился после обновления');
      if (state.mode === 'repair' &&
          !equal(before.kk.draft?.relations, after.kk.draft?.relations))
        errors.push('KK relations изменились при обновлении');
      if (after.kk.published) errors.push('KK опубликована без запроса');
      if (after.kk.draft) {
        for (const [name, attr] of Object.entries(state.schema.attributes)) {
          if (SYSTEM.has(name) || attr.type === 'relation') continue;
          if (!equal(before.ru.draft.transferable[name], after.kk.draft.transferable[name]))
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
        deferredRelations: state.plan.deferred,
        ruBeforeStatus: before.ru.draft.detail.status,
        ruAfterStatus: after.ru.draft?.detail?.status ?? null,
        ruPublishedBefore: before.ru.published?.detail?.publishedAt ?? null,
        ruPublishedAfter: after.ru.published?.detail?.publishedAt ?? null,
        ruContentPreserved: !errors.some(x => x.startsWith('RU ')),
        mode: state.mode,
        kkCreated: state.mode === 'create' && !!after.kk.draft,
        kkUpdated: state.mode === 'repair' && !!after.kk.draft &&
          after.kk.draft.detail.id === REPAIR_KK_ROW_ID
      };
      if (errors.length) throw Error('Postflight: ' + errors.join(' | '));
      state.stage = 'complete';
      state.report.success = true;
      state.report.finishedAt = new Date().toISOString();
      show('Готово: KK Draft ' + (state.mode === 'repair' ? 'дополнена' : 'создана') +
        ', RU Draft/Published и relations сохранены.' +
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