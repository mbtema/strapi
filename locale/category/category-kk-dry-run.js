// DIOR Category RU -> KK: массовый READ-ONLY dry-run, без PUT/POST/Publish.
// Запуск в Strapi Admin Console на RU-карточке бренда DIOR.
// Берёт все категории из DIOR.categories и проверяет каждый перенос по схеме.
// Источник: locale/category/category-kk-sync.js (проверенный single-category pilot).
(async () => {
  'use strict';
  const BRAND_UID = 'api::brand.brand';
  const UID = 'api::category.category';
  const BRAND_ID = 'qw7sja6ffpbufvzub5maxyrl';
  const FIELD = 'categories';
  const KEY = '__tmDiorCategoryKkDryRun';
  const PANEL = 'tm-dior-category-kk-dry-run';
  const WORKERS = 2; // Только GET; умеренная нагрузка.
  const PAGE_SIZE = 100;
  const SYSTEM = new Set([
    'id', 'documentId', 'locale', 'status', 'publishedAt',
    'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'localizations'
  ]);
  const SCALAR = new Set([
    'string', 'text', 'richtext', 'email', 'enumeration', 'json', 'blocks',
    'integer', 'biginteger', 'float', 'decimal', 'boolean',
    'date', 'time', 'datetime'
  ]);
  if (!location.pathname.includes('/content-manager/collection-types/' + BRAND_UID + '/' + BRAND_ID) ||
      (new URLSearchParams(location.search).get('plugins[i18n][locale]') || 'ru') !== 'ru') {
    console.error('[DIOR KK audit]', 'Открой RU-карточку бренда DIOR: ' + BRAND_ID);
    return;
  }
  if (window[KEY]?.running) {
    console.warn('[DIOR KK audit]', 'Аудит уже запущен');
    return;
  }
  let token;
  try { token = JSON.parse(localStorage.getItem('jwtToken')); }
  catch { token = localStorage.getItem('jwtToken'); }
  if (typeof token !== 'string' || !token) {
    console.error('[DIOR KK audit]', 'Нет JWT авторизованной Strapi Admin');
    return;
  }
  document.getElementById(PANEL)?.remove();
  const state = {
    running: true, stopped: false, requests: 0, retries: 0, processed: 0, total: 0,
    components: null, report: {
      tool: 'dior-category-kk-dry-run', version: 1,
      readOnly: true, scope: 'DIOR.categories', brandDocumentId: BRAND_ID,
      startedAt: new Date().toISOString(), finishedAt: null,
      complete: false, outcome: 'running',
      schemaFields: null, relationFields: null,
      summary: null, rows: [], errors: []
    }
  };
  window[KEY] = state;
  window.tmDiorCategoryKkDryRunReport = state.report;
  const el = (tag, value) => {
    const node = document.createElement(tag);
    if (value !== undefined) node.textContent = value;
    return node;
  };
  const panel = el('section');
  panel.id = PANEL;
  Object.assign(panel.style, {
    position: 'fixed', bottom: '16px', right: '16px', zIndex: 2147483600,
    width: 'min(490px, calc(100vw - 32px))', maxHeight: '78vh', overflowY: 'auto',
    background: '#202035', color: '#fff', border: '1px solid #9895c5',
    borderRadius: '10px', padding: '14px', font: '13px/1.5 system-ui',
    boxShadow: '0 8px 24px #0008'
  });
  const title = el('strong', 'DIOR → Category RU/KK · массовый Preflight (GET)');
  const status = el('div', 'Инициализация…');
  status.style.cssText = 'white-space:pre-wrap;margin:12px 0';
  const controls = el('div');
  controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px';
  const stopButton = el('button', 'Остановить');
  const csvButton = el('button', 'Скачать CSV');
  const jsonButton = el('button', 'Скачать JSON');
  for (const b of [stopButton,csvButton,jsonButton]) {
    b.type = 'button';
    b.style.cssText = 'cursor:pointer;padding:7px 11px';
    controls.append(b);
  }
  panel.append(title,status,controls);
  document.body.append(panel);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = () => { if (state.stopped) throw Error('STOP_BY_USER'); };
  const counts = () => state.report.rows.reduce((out,row) => {
    out[row.status] = (out[row.status] || 0) + 1; return out;
  },{});
  let lastRender = 0;
  const show = (message,force=false) => {
    if (!force && Date.now()-lastRender < 180) return;
    lastRender=Date.now();
    const c=counts();
    status.textContent = message + '\nПроверено: ' + state.processed + '/' +
      (state.total || '?') + ' · ready: '+(c.ready||0)+
      ' · synced: '+(c.already_synced||0)+ ' · review: '+(c.review||0)+
      ' · blocked: '+(c.blocked||0)+
      '\nGET: '+state.requests+' · повторы GET: '+state.retries;
  };
  stopButton.onclick = () => {
    state.stopped = true; stopButton.disabled = true;
    show('Остановка после текущих GET…', true);
  };
  function download(filename, contents, mime) {
    const blob = new Blob([contents], {type:mime});
    const url=URL.createObjectURL(blob);
    const a=el('a'); a.href=url; a.download=filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 15000);
  }
  const csvFields = ['documentId','name','status','reason','ruStatus','ruPublished',
    'kkDraft','kkPublished','kkStatus','differentFields','filtersAppCount',
    'dynamicCount','ruRelations','kkRelations','payloadFields','warnings','url'];
  const quote = value => {
    let t = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return '"' + t.replace(/"/g,'""') + '"';
  };
  const csv = () => '\uFEFF' + [
    csvFields.join(';'), ...state.report.rows.map(row =>
      csvFields.map(key => quote(Array.isArray(row[key]) ?
        row[key].join(' | ') : row[key])).join(';'))
  ].join('\n');
  csvButton.onclick = () => download('dior-category-kk-dry-run.csv',
    csv(), 'text/csv;charset=utf-8');
  jsonButton.onclick = () => download('dior-category-kk-dry-run.json',
    JSON.stringify(state.report,null,2), 'application/json;charset=utf-8');

  // Только GET. Повторяем исключительно временные ошибки чтения.
  async function request(method, path) {
    if (method !== 'GET') throw Error('READ_ONLY: write запрещён');
    for(let attempt=0;attempt<3;attempt++) {
      check(); state.requests++;
      let response;
      try {
        response=await fetch(path,{
          method:'GET',credentials:'include',cache:'no-store',
          headers:{Authorization:'Bearer '+token,Accept:'application/json'}
        });
      } catch(error) {
        if(attempt===2) throw Error('GET network '+path+': '+String(error));
        state.retries++; await sleep((attempt+1)*700);continue;
      }
      const body=await response.text();
      let data=null;
      try { data=body ? JSON.parse(body) : null; }
      catch {
        // Strapi может вернуть HTML для отсутствующей locale (404).
        if (response.status!==404) throw Error('GET response не JSON: '+path);
        data=null;
      }
      if(response.ok || response.status===404)
        return {ok:response.ok,status:response.status,data,
          message:response.ok?'':String(data?.error?.message||'')};
      if(attempt<2 && [408,429,500,502,503,504].includes(response.status)){
        state.retries++; await sleep((attempt+1)*800);continue;
      }
      throw Error('GET HTTP '+response.status+' '+path+': '+
        String(data?.error?.message || body).slice(0,150));
    }
  }
  async function get(path) {
    const r=await request('GET',path);
    if(!r.ok) throw Error('GET HTTP '+r.status+' '+path+': '+r.message);
    return r.data;
  }
  function decode(result, documentId, locale, published) {
    const data=result?.data?.data;
    if(result?.status===404 || (result?.ok &&
      (data==null || (typeof data==='object' && !Array.isArray(data) &&
        Object.keys(data).length===0)))) return null;
    if(!result?.ok || data?.documentId!==documentId || data?.locale!==locale ||
      (published && data.publishedAt==null))
      throw Error('Неоднозначный Category detail '+documentId+'/'+locale+'/'+published+
        ': HTTP '+result?.status);
    return data;
  }
  const detailPath = (id,locale,publication) =>
    '/content-manager/collection-types/'+UID+'/'+id+
    '?locale='+locale+'&status='+publication;

  // Обход Brand.categories до конца с проверкой полноты и уникальности.
  async function categories() {
    const output=[],seen=new Set();
    let page=1,total=null,pages=null;
    while(true) {
      check();
      const value=await get('/content-manager/relations/'+BRAND_UID+'/'+BRAND_ID+
        '/'+FIELD+'?locale=ru&page='+page+'&pageSize='+PAGE_SIZE);
      const rows=value?.results,p=value?.pagination;
      if(!Array.isArray(rows) || !Number.isInteger(p?.total) || p.total<0 ||
        !Number.isInteger(p?.pageCount) || p.pageCount<0 ||
        (p.total>0 && !rows.length) ||
        (p.page!=null && p.page!==page) ||
        (total!==null && total!==p.total) || (pages!==null && pages!==p.pageCount))
        throw Error('Некорректная pagination DIOR.categories, page '+page);
      total=p.total;pages=p.pageCount;
      for(const row of rows) {
        const id=row?.documentId;
        if(typeof id!=='string' || !/^[a-z0-9]+$/i.test(id))
          throw Error('DIOR.categories: отсутствует documentId');
        if(seen.has(id)) throw Error('DIOR.categories: повтор documentId '+id);
        seen.add(id);
        output.push({documentId:id,name:row.name||row.title||''});
      }
      show('Получено категорий DIOR: '+output.length+'/'+total,true);
      if(page>=pages || pages===0) break;
      if(page>=100) throw Error('Слишком много страниц DIOR.categories');
      page++;
    }
    if(output.length!==total) throw Error('DIOR.categories: неполная relation');
    return output;
  }
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
  async function relationSnapshot(documentId, locale, publication, names) {
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
  async function snapshot(documentId, schema) {
    const names = relations(schema);
    const responses = await Promise.all([
      request('GET', detailPath(documentId, 'ru', 'draft')),
      request('GET', detailPath(documentId, 'ru', 'published')),
      request('GET', detailPath(documentId, 'kk', 'draft')),
      request('GET', detailPath(documentId, 'kk', 'published'))
    ]);
    const ruDraft = decode(responses[0], documentId, 'ru', false);
    const ruPublished = decode(responses[1], documentId, 'ru', true);
    const kkDraft = decode(responses[2], documentId, 'kk', false);
    const kkPublished = decode(responses[3], documentId, 'kk', true);
    // Отсутствие RU Draft станет блокировкой конкретной категории.
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
          relations: await relationSnapshot(documentId, locale, publication, names)
        } : null;
      }
    }
    return data;
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

  // Условный dry-run: всё проверяем, ничего не сохраняем.
  const relationCount = item => Object.values(item?.relations||{})
    .reduce((sum,r)=>sum+r.total,0);
  const fieldDiff = (a,b) => Object.keys(a||{})
    .filter(name => !equal(a[name],b?.[name]));
  const snapshotSummary = snap => snap && ({
    id:snap.detail.id, locale:snap.detail.locale, status:snap.detail.status,
    publishedAt:snap.detail.publishedAt, updatedAt:snap.detail.updatedAt,
    fields:snap.business, relations:snap.relations
  });
  function evaluate(item,snap,schema) {
    const ru=snap.ru.draft, ruPub=snap.ru.published;
    const kk=snap.kk.draft, kkPub=snap.kk.published;
    const blockers=[],warnings=[];
    let plan={payload:null,blockers:[],warnings:[],deferred:[]};
    if(!ru) blockers.push('RU Draft отсутствует');
    if(!ruPub) blockers.push('RU Published отсутствует');
    if(ru) {
      plan=buildPayload(schema,ru.detail);
      blockers.push(...plan.blockers);
      warnings.push(...plan.warnings);
    }
    const differentFields=ru&&kk ? fieldDiff(ru.transferable,kk.transferable) : [];
    const kkRelationTotal=relationCount(kk);
    const existing=!!kk || !!kkPub;
    let status,reason='';
    if(existing) {
      status=kk && !kkPub && ru && !blockers.length &&
        !differentFields.length && kkRelationTotal===0 ?
        'already_synced':'review';
      if(status==='review') reason=[
        kkPub?'KK Published уже существует':'',
        !kk?'KK Draft отсутствует':'',
        differentFields.length?'KK отличается: '+differentFields.join(', '):'',
        kkRelationTotal?'KK relations заполнены: '+kkRelationTotal:'',
        ...blockers
      ].filter(Boolean).join(' | ');
    } else {
      status=blockers.length?'blocked':'ready';
      reason=blockers.join(' | ');
    }
    const row={
      documentId:item.documentId, name:ru?.detail?.name||ruPub?.detail?.name||item.name,
      status,reason,
      ruStatus:ru?.detail.status||'',ruPublished:!!ruPub,
      kkDraft:!!kk,kkPublished:!!kkPub,kkStatus:kk?.detail.status||'',
      differentFields,filtersAppCount:ru?.detail?.filters_app?.length||0,
      dynamicCount:ru?.detail?.dynamic?.length||0,
      ruRelations:relationCount(ru),kkRelations:kkRelationTotal,
      payloadFields:plan.payload?Object.keys(plan.payload).length:0,
      warnings, deferredRelations:plan.deferred,
      url:location.origin+'/admin/content-manager/collection-types/'+UID+'/'+
        item.documentId+'?plugins[i18n][locale]=ru',
      before:{
        ruDraft:snapshotSummary(ru),ruPublished:snapshotSummary(ruPub),
        kkDraft:snapshotSummary(kk),kkPublished:snapshotSummary(kkPub)
      },
      // Без payload существующих локалей: повторная запись им запрещена.
      payload:status==='ready'?plan.payload:null
    };
    return row;
  }
  let result = null;
  try {
    show('GET: проверяем схему Category/Brand и схемы компонентов…',true);
    const [types,components,brand]=await Promise.all([
      get('/content-manager/content-types'),
      get('/content-manager/components'),
      get('/content-manager/collection-types/'+BRAND_UID+'/'+BRAND_ID+
        '?locale=ru&status=draft')
    ]);
    const brandSchema=types?.data?.find(x=>x.uid===BRAND_UID);
    const schema=types?.data?.find(x=>x.uid===UID);
    if(!schema?.attributes || schema.pluginOptions?.i18n?.localized!==true ||
      brandSchema?.attributes?.[FIELD]?.type!=='relation' ||
      brandSchema.attributes[FIELD].target!==UID)
      throw Error('Схема Category/i18n или Brand.categories не подтверждена');
    if(!Array.isArray(components?.data) ||
      !components.data.every(c=>c?.uid&&c?.attributes))
      throw Error('Не удалось проверить все схемы компонентов');
    state.components=Object.fromEntries(components.data.map(c=>[c.uid,c]));
    if(brand?.data?.documentId!==BRAND_ID || brand?.data?.locale!=='ru')
      throw Error('Не удалось подтвердить RU Brand DIOR');
    const relationNames=relations(schema);
    state.report.schemaFields=Object.fromEntries(
      Object.entries(schema.attributes).filter(([n])=>!SYSTEM.has(n))
        .map(([n,a])=>[n,{type:a.type,required:!!a.required,
          localized:a.type==='relation'?
            a.pluginOptions?.i18n?.localized!==false:isLocalized(a),
          unique:!!a.unique,target:a.target??null}])
    );
    state.report.relationFields=relationNames;
    const items=await categories();
    const countInBrand=brand.data?.categories?.count;
    if(Number.isInteger(countInBrand) && countInBrand!==items.length)
      throw Error('Brand.categories.count '+countInBrand+
        ' не совпадает с полной relation '+items.length);
    state.total=items.length;
    const rows=new Array(items.length);
    let cursor=0,failure=null;
    const workers=Array.from({length:Math.min(WORKERS,items.length)},async()=>{
      while(!failure && !state.stopped) {
        const index=cursor++;
        if(index>=items.length) return;
        try {
          const snap=await snapshot(items[index].documentId,schema);
          const row=evaluate(items[index],snap,schema);
          rows[index]=row; state.processed++;
          state.report.rows=rows.filter(Boolean);
          show('Preflight RU → KK: '+state.processed+'/'+state.total);
        } catch(error) {
          if(!failure) failure=Error('Category '+items[index].documentId+': '+String(error));
          return;
        }
      }
    });
    await Promise.all(workers);
    if(failure) throw failure;
    check();
    if(rows.some(x=>!x) || state.processed!==state.total)
      throw Error('Обход Category неполный');
    state.report.rows=rows;
    state.report.complete=true;
    state.report.outcome='completed';
    result='completed';
  } catch(error) {
    state.report.outcome=state.stopped?'stopped':'failed';
    state.report.errors.push(String(error));
    result=state.report.outcome;
    console.error('[DIOR KK audit]',String(error));
  } finally {
    state.running=false;
    stopButton.disabled=true;
    state.report.finishedAt=new Date().toISOString();
    state.report.summary={
      found:state.total,processed:state.processed,
      statuses:counts(),
      getRequests:state.requests,getRetries:state.retries
    };
    show(result==='completed'?'Аудит завершён, CSV и JSON скачаны.' :
      'Аудит не завершён ('+result+'). Скачаны частичные CSV и JSON.',true);
    csvButton.onclick(); jsonButton.onclick();
    console.log('[DIOR KK audit] summary',state.report.summary,
      'complete:',state.report.complete);
  }
})();