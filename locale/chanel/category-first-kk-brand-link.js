(async function chanelFirstKKBrandConnectPilot() {
  'use strict';

  // CHANEL pilot подключения только Brand relation к уже созданной KK Draft.
  // Default GET-only; единственный PUT включается одноразовыми флагами.
  const TAG = '[CHANEL KK Brand Connect Pilot]';
  const BRAND_UID = 'api::brand.brand';
  const CATEGORY_UID = 'api::category.category';
  const BRAND_ID = 'yeag7mng9hfpk7pd4ggm7495';
  const BASELINE_CATEGORY_COUNT = 65; // Источник: chanel-categories-ru.json
  const BRAND_PATH = '/admin/content-manager/collection-types/' + BRAND_UID + '/' + BRAND_ID;
  const PAGE_SIZE = 100;
  const RUN_KEY = '__tmChanelKKBrandConnectPilotRunning';
  const PILOT_ID = 'c1hhh17jjftb14qdysnwi9rx'; // CHANEL / Мужская парфюмерия / Pour Monsieur
  const SYSTEM = new Set(['id', 'documentId', 'locale', 'status', 'createdAt', 'updatedAt',
    'publishedAt', 'createdBy', 'updatedBy', 'localizations', '__pivot']);
  const MEDIA_FIELDS = new Set(['largeImage_app', 'largeImage', 'previewImage_app', 'preview_picture', 'menu_banner']);
  const SOURCE_FIELDS = new Set(['active', 'custom', 'title', 'seo_name', 'code',
    'bitrix_id', 'sortOrder', 'detail_available_from', 'slug', 'description',
    'key', 'customName', 'showProducts']);
  const COMPONENT_FIELDS = new Set(['productsLabelFilter', 'brandZoneBanners',
    'filters_app', 'dynamic']);

  const here = new URL(location.href);
  if (here.pathname !== BRAND_PATH ||
      here.searchParams.get('plugins[i18n][locale]') !== 'ru') {
    console.error(TAG, 'Откройте RU-страницу бренда CHANEL:', BRAND_PATH);
    return;
  }
  if (window[RUN_KEY]) {
    console.warn(TAG, 'Аудит уже выполняется');
    return;
  }
  window[RUN_KEY] = true;

  const report = {
    version: 1,
    mode: 'dry-run',
    attemptedWrites: 0,
    postflight: null,
    evidence: [],
    plan: null,
    baselineHash: null,
    snapshots: null,
    chosen: PILOT_ID,
    status: 'reading',
    action: 'link-existing-kk-brand-only',
    records: [],
    summary: null,
    globalWarnings: [],
    createdAt: new Date().toISOString(),
    brand: { uid: BRAND_UID, documentId: BRAND_ID, locale: 'ru' },
    category: null,
    schema: null,
    components: {},
    versions: { ru: { draft: null, published: null }, kk: { draft: null, published: null } },
    fieldAudit: [],
    relationAudit: [],
    warnings: [],
    errors: [],
    counters: { GET: 0, retries: 0, relationPages: 0 },
    complete: false
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const token = () => {
    const raw = localStorage.getItem('jwtToken');
    let jwt = raw;
    try { jwt = JSON.parse(raw); } catch {}
    if (typeof jwt !== 'string' || !jwt.trim()) {
      throw new Error('Нет jwtToken Strapi Admin');
    }
    return jwt.trim().replace(/^Bearer\s+/i, '');
  };

  async function get(path, allow404 = false) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      report.counters.GET++;
      let response;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        response = await fetch(path, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
          headers: { Authorization: 'Bearer ' + token(), Accept: 'application/json' }
        });
      } catch (error) {
        if (attempt === 3) throw new Error('GET network ' + path + ': ' + error.message);
        report.counters.retries++;
        await sleep(600 * attempt);
        continue;
      } finally {
        clearTimeout(timeout);
      }
      if (response.status === 404 && allow404) return null;
      if (!response.ok) {
        if (attempt < 3 && [408, 429, 500, 502, 503, 504].includes(response.status)) {
          report.counters.retries++;
          await sleep(800 * attempt);
          continue;
        }
        throw new Error('GET HTTP ' + response.status + ' ' + path);
      }
      const json = await response.json();
      if (!json || typeof json !== 'object') throw new Error('Неожиданный JSON ' + path);
      return json;
    }
    throw new Error('GET failed ' + path);
  }

  function parsePage(data, page, first) {
    const rows = data?.results, p = data?.pagination;
    if (!Array.isArray(rows) ||
        !Number.isSafeInteger(p?.total) || p.total < 0 ||
        !Number.isSafeInteger(p?.pageCount) || p.pageCount < 0 ||
        (p.total > 0 && (p.pageCount === 0 || rows.length === 0)) ||
        (p.page != null && Number(p.page) !== page) ||
        (first && (p.total !== first.total || p.pageCount !== first.pageCount))) {
      throw new Error('Недостоверная пагинация на странице ' + page);
    }
    return { rows, total: p.total, pageCount: p.pageCount };
  }

  async function paginated(path, query) {
    const out = [], seen = new Set();
    let first = null, page = 1;
    while (true) {
      const qs = new URLSearchParams({ ...query, page: String(page), pageSize: String(PAGE_SIZE) });
      const current = parsePage(await get(path + '?' + qs), page, first);
      first ||= current;
      for (const row of current.rows) {
        if (typeof row?.documentId !== 'string' || !row.documentId ||
            !Number.isSafeInteger(row?.id) || row.id <= 0 ||
            (row.locale != null && row.locale !== query.locale) ||
            seen.has(row.documentId)) {
          throw new Error('Relation без корректных ID, locale или дубли: ' + path);
        }
        seen.add(row.documentId);
        out.push({ id: row.id, documentId: row.documentId, locale: row.locale || query.locale,
          name: String(row.title || row.name || '') });
      }
      report.counters.relationPages++;
      if (page >= first.pageCount) break;
      page++;
      if (page > 10000) throw new Error('Слишком много страниц: ' + path);
    }
    if (out.length !== first.total) {
      throw new Error('Неполное чтение relations ' + path + ': ' + out.length + '/' + first.total);
    }
    return out;
  }

  function relations(uid, id, field, locale, status) {
    return paginated('/content-manager/relations/' + uid + '/' +
      encodeURIComponent(id) + '/' + encodeURIComponent(field), { locale, status });
  }

  function attrs(schema) {
    return schema && typeof schema.attributes === 'object' ? schema.attributes : {};
  }

  async function nestedRelations(value, schema, path, locale, status, components, collected) {
    if (value == null || !schema) return;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        await nestedRelations(value[i], schema, path + '[' + i + ']', locale, status,
          components, collected);
      }
      return;
    }
    if (typeof value !== 'object') return;

    for (const [field, definition] of Object.entries(attrs(schema))) {
      const fieldValue = value[field];
      const childPath = path + '.' + field;
      if (definition.type === 'relation') {
        const count = Number.isSafeInteger(fieldValue?.count) ? fieldValue.count : null;
        if (!Number.isSafeInteger(value.id) || value.id <= 0) {
          collected.push({ path: childPath, status: 'unverified_no_component_id',
            expectedCount: count, raw: fieldValue });
          report.warnings.push(childPath + ' (' + locale + '/' + status + '): нет numeric component id');
          continue;
        }
        // В Strapi Published-вложения могут вернуть 0 при фактическом count > 0.
        // Не трактуем такие ответы как отсутствие связей.
        try {
          const links = await relations(schema.uid, value.id, field, locale, status);
          const countMatches = count === null ? null : links.length === count;
          const trusted = status === 'draft' && countMatches === true;
          collected.push({ path: childPath, componentUid: schema.uid, componentId: value.id,
            expectedCount: count, links, countMatches,
            status: trusted ? 'verified_draft' : 'unverified' });
          if (!trusted) {
            report.warnings.push(childPath + ' (' + locale + '/' + status +
              '): вложенная relation не подтверждена полностью');
          }
        } catch (error) {
          collected.push({ path: childPath, componentUid: schema.uid, componentId: value.id,
            expectedCount: count, status: 'unverified_error', error: error.message });
          report.warnings.push(childPath + ' (' + locale + '/' + status + '): ' + error.message);
        }
      } else if (definition.type === 'component') {
        const component = components.get(definition.component);
        if (!component) {
          report.warnings.push('Неизвестная схема компонента ' + definition.component);
          continue;
        }
        await nestedRelations(fieldValue, component, childPath, locale, status, components,
          collected);
      } else if (definition.type === 'dynamiczone' && Array.isArray(fieldValue)) {
        for (let i = 0; i < fieldValue.length; i++) {
          const part = fieldValue[i];
          const component = components.get(part?.__component);
          if (!component) {
            report.warnings.push('Неизвестная схема Dynamic Zone ' + childPath + '[' + i + ']');
            continue;
          }
          await nestedRelations(part, component, childPath + '[' + i + ']', locale, status,
            components, collected);
        }
      }
    }
  }

  async function readVersion(documentId, locale, status, schema, components) {
    const path = '/content-manager/collection-types/' + CATEGORY_UID + '/' +
      encodeURIComponent(documentId) + '?locale=' + locale + '&status=' + status;
    const response = await get(path, true);
    const row = response?.data;
    if (row == null || (typeof row === 'object' && !Array.isArray(row) &&
        Object.keys(row).length === 0)) return null;
    if (!row || Array.isArray(row) ||
        row.documentId !== documentId || row.locale !== locale) {
      throw new Error('Неоднозначная версия ' + locale + '/' + status);
    }
    if (status === 'published' && !row.publishedAt) return null;

    const values = {};
    const links = {};
    const nested = [];
    for (const [field, definition] of Object.entries(attrs(schema))) {
      if (SYSTEM.has(field)) continue;
      if (!Object.hasOwn(row, field)) {
        report.warnings.push('Поле ' + field + ' отсутствует в ' + locale + '/' + status);
        continue;
      }
      if (definition.type === 'relation') {
        links[field] = await relations(CATEGORY_UID, documentId, field, locale, status);
        const count = row[field]?.count;
        if (Number.isSafeInteger(count) && links[field].length !== count) {
          throw new Error('Root relation ' + field + ' неполная: ' +
            locale + '/' + status + ' ' + links[field].length + '/' + count);
        }
      } else {
        values[field] = row[field];  // Исходный контент Media/Component/DZ без модификации.
        if (definition.type === 'component') {
          const component = components.get(definition.component);
          if (!component) throw new Error('Нет схемы ' + definition.component);
          await nestedRelations(row[field], component, field, locale, status, components, nested);
        } else if (definition.type === 'dynamiczone' && Array.isArray(row[field])) {
          for (let i = 0; i < row[field].length; i++) {
            const part = row[field][i];
            const component = components.get(part?.__component);
            if (!component) throw new Error('Нет схемы Dynamic Zone ' + part?.__component);
            await nestedRelations(part, component, field + '[' + i + ']', locale, status,
              components, nested);
          }
        }
      }
    }
    return {
      meta: { id: row.id, documentId: row.documentId, locale: row.locale,
        status: row.status, publishedAt: row.publishedAt, updatedAt: row.updatedAt },
      fields: values,
      relations: links,
      nestedRelations: nested,
      // Оригинальный ответ CM для последующего расследования проблем Strapi i18n.
      raw: row
    };
  }

  const comparable = input => {
    const recurse = value => {
      if (Array.isArray(value)) return value.map(recurse);
      if (!value || typeof value !== 'object') return value;
      const o = {};
      for (const key of Object.keys(value).sort()) {
        if (!SYSTEM.has(key)) o[key] = recurse(value[key]);
      }
      return o;
    };
    return JSON.stringify(recurse(input));
  };
  const present = value => value != null && value !== '' &&
    (!Array.isArray(value) || value.length > 0);
  const same = (a, b) => comparable(a) === comparable(b);
  const ids = values => (values || []).map(item => item.documentId).sort();
  const fieldValue = (ver, field) => ver?.fields?.[field];



  const APPLY = window.tmChanelKKBrandApplyOnce === 'CONNECT_BRAND';
  const RISK = window.tmChanelKKBrandNoDbBackupRiskAcceptedOnce === true;
  const BASELINE = typeof window.tmChanelKKBrandBaselineHashOnce === 'string'
    ? window.tmChanelKKBrandBaselineHashOnce.trim() : '';
  delete window.tmChanelKKBrandApplyOnce;
  delete window.tmChanelKKBrandNoDbBackupRiskAcceptedOnce;
  delete window.tmChanelKKBrandBaselineHashOnce;
  report.mode = APPLY ? 'apply-one-brand-link' : 'dry-run';
  const BRAND_KK_ID = 2403; // verified in user preflight, recheck live
  const PARENT_ID = 'xff5b8l7kowombgqbfekk8ms';
  const SKIPPED_FIELDS = new Set(['key','code','slug']);
  const stable = value => JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
  function mediaId(value, path) {
    if (value == null) return null;
    const id = typeof value === 'number' ? value : value?.id;
    if (!Number.isSafeInteger(id) || id <= 0)
      throw Error('Недостоверный media id: ' + path);
    return id;
  }
  function seedField(def, value, path, components, nestedPending) {
    if (value === undefined) throw Error('В RU отсутствует поле ' + path);
    if (value == null) return null;
    if (def.type === 'media') {
      if (def.multiple) {
        if (!Array.isArray(value)) throw Error('Ожидался массив Media: ' + path);
        return value.map((part,i) => mediaId(part, path+'['+i+']'));
      }
      return mediaId(value, path);
    }
    if (def.type === 'relation') {
      const count = Number.isSafeInteger(value?.count) ? value.count :
        Array.isArray(value) ? value.length : (value?.id ? 1 : 0);
      if (count !== 0) {
        nestedPending.push({path, count, reason:'nested relation требует отдельного save'});
      }
      return {connect:[],disconnect:[]}; // seed only, never invent target links
    }
    if (def.type === 'component') {
      const one=(part,p) => seedComponent(def.component,part,p,components,nestedPending);
      if (!def.repeatable) return one(value,path);
      if (!Array.isArray(value)) throw Error('Ожидался массив компонентов: ' + path);
      return value.map((part,i)=>one(part,path+'['+i+']'));
    }
    if (def.type === 'dynamiczone') {
      if (!Array.isArray(value)) throw Error('Ожидался Dynamic Zone: ' + path);
      return value.map((part,i) => {
        const uid=part?.__component;
        if (!def.components?.includes(uid)) throw Error('Неизвестный UID компонента: '+uid);
        return {__component:uid,
          ...seedComponent(uid,part,path+'['+i+']',components,nestedPending)};
      });
    }
    if (['string','text','richtext','email','enumeration','json','blocks',
         'integer','biginteger','float','decimal','boolean','date','time',
         'datetime','uid','password'].includes(def.type)) {
      return value;
    }
    throw Error('Неизвестный тип ' + def.type + ' (' + path + ')');
  }
  function seedComponent(uid, value, path, components, nestedPending) {
    if (value == null) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw Error('Некорректный компонент ' + path);
    const schema=components.get(uid);
    if (!schema?.attributes) throw Error('Нет schema компонента ' + uid);
    const out={};
    for (const [name,def] of Object.entries(attrs(schema))) {
      if (SYSTEM.has(name)) continue;
      out[name]=seedField(def,value[name],path+'.'+name,components,nestedPending);
    }
    return out;
  }
  function seedPayload(draft, schema, components) {
    const payload={locale:'kk'}, excluded={}, nestedPending=[];
    for (const [name,def] of Object.entries(attrs(schema))) {
      if (SYSTEM.has(name) || def.type === 'relation') continue;
      if (SKIPPED_FIELDS.has(name)) {
        excluded[name]={ruValue:draft.fields[name]??null,
          reason:'nonlocalized / unique: вне нормализации'};
        continue;
      }
      const value=seedField(def,draft.fields[name],name,components,nestedPending);
      if (def.required &&
          (value == null || value === '' || Array.isArray(value) && !value.length)) {
        throw Error('Обязательное поле пустое: ' + name);
      }
      payload[name]=value;
    }
    return {payload,excluded,nestedPending};
  }
  function download(name,data) {
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],
      {type:'application/json;charset=utf-8'}));
    const a=document.createElement('a');
    a.href=url;a.download=name;document.body.append(a);
    try{a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);}
  }
  async function digest(value) {
    const bytes=new TextEncoder().encode(stable(value));
    const arr=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    return [...arr].map(x=>x.toString(16).padStart(2,'0')).join('');
  }

  const DATABASE_NAME='tm-chanel-kk-brand-pilot-journal-v1';
  async function persist(stage, value) {
    if (!window.indexedDB) throw Error('IndexedDB недоступна, PUT запрещён');
    const db=await new Promise((resolve,reject)=>{
      const req=indexedDB.open(DATABASE_NAME,1);
      req.onupgradeneeded=()=>{
        if(!req.result.objectStoreNames.contains('evidence'))
          req.result.createObjectStore('evidence',{keyPath:'id'});
      };
      req.onerror=()=>reject(req.error||Error('IndexedDB error'));
      req.onblocked=()=>reject(Error('IndexedDB blocked'));
      req.onsuccess=()=>resolve(req.result);
    });
    try {
      const item={id:PILOT_ID+':'+Date.now()+':'+stage,
        at:new Date().toISOString(),stage,value};
      await new Promise((resolve,reject)=>{
        const tx=db.transaction('evidence','readwrite');
        tx.objectStore('evidence').put(item);
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error||Error('IndexedDB write error'));
        tx.onabort=()=>reject(tx.error||Error('IndexedDB aborted'));
      });
      report.evidence.push({stage,stored:true,at:item.at});
    } finally {db.close();}
  }
  function semanticVersion(version,schema,components) {
    if(!version)return null;
    const result={fields:{},relations:{}};
    const pending=[];
    for(const [name,def] of Object.entries(attrs(schema))) {
      if(SYSTEM.has(name))continue;
      if(def.type==='relation'){
        const links=version.relations?.[name];
        if(!Array.isArray(links)||links.some(x=>!x?.documentId))
          throw Error('Неполный состав relation '+name);
        result.relations[name]=links.map(x=>x.documentId).sort();
      }else{
        result.fields[name]=seedField(def,version.fields?.[name],
          name,components,pending);
      }
    }
    if(pending.length)throw Error('Непроверенные nested relations: '+JSON.stringify(pending));
    return result;
  }
  async function snapshotFour(schema,components){
    const snap={ru:{draft:null,published:null},kk:{draft:null,published:null}};
    for(const lc of ['ru','kk'])for(const st of ['draft','published'])
      snap[lc][st]=await readVersion(PILOT_ID,lc,st,schema,components);
    return snap;
  }

  function sourceFields(ver,schema,components) {
    return semanticVersion(ver,schema,components);
  }
  function normalizedFour(snap,schema,components) {
    return Object.fromEntries(['ru','kk'].map(locale=>[locale,
      Object.fromEntries(['draft','published'].map(status=>[status,
        sourceFields(snap[locale][status],schema,components)]))]));
  }
  async function hashOf(data) {
    const raw=new TextEncoder().encode(stable(data));
    const bytes=await crypto.subtle.digest('SHA-256',raw);
    return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  async function readLive(schema,components) {
    const snapshots=await snapshotFour(schema,components);
    const brandResp=await get('/content-manager/collection-types/'+BRAND_UID+'/'+
      BRAND_ID+'?locale=kk&status=draft');
    const brand=brandResp?.data;
    if(brand?.id!==BRAND_KK_ID||brand.documentId!==BRAND_ID||
       brand.locale!=='kk')throw Error('KK Brand numeric id / documentId изменились');
    return {snapshots,brand:{id:brand.id,documentId:brand.documentId,locale:brand.locale}};
  }
  function inspect(snap,schema,components) {
    const ru=snap.ru.draft,kk=snap.kk.draft;
    if(!ru||!snap.ru.published||!kk||snap.kk.published)
      throw Error('Неожиданный состав 4 версий: нужны RU Draft/Published, KK Draft, нет KK Published');
    const ruSem=sourceFields(ru,schema,components);
    const kkSem=sourceFields(kk,schema,components);
    if(stable(ruSem.fields)!==stable(kkSem.fields))
      throw Error('KK Draft поля не равны RU Draft: изменение после успешного seed');
    if(stable(ruSem.relations.parent)!==stable([PARENT_ID])||
       stable(ruSem.relations.brand)!==stable([BRAND_ID]))
      throw Error('RU parent/brand не соответствуют проверенному CHANEL');
    if(kkSem.relations.parent.length!==0)
      throw Error('KK parent изменился; требуется новый план');
    if(kkSem.relations.brand.length>1||
       kkSem.relations.brand.length===1&&kkSem.relations.brand[0]!==BRAND_ID)
      throw Error('В KK brand находится неизвестная ссылка');
    for(const [name,ids] of Object.entries(kkSem.relations))
      if(!['parent','brand'].includes(name) && ids.length)
        throw Error('Неожиданная KK relation '+name+': '+ids.length);
    if(ru.fields.key!==kk.fields.key)
      throw Error('Различается сохранённый key, нужен отдельный review');
    return {alreadyLinked:kkSem.relations.brand.includes(BRAND_ID),
      ruRelations:ruSem.relations, kkRelations:kkSem.relations,
      missingAfter:kkSem.relations.brand.includes(BRAND_ID)
        ? [{field:'parent',documentId:PARENT_ID}]
        : [{field:'parent',documentId:PARENT_ID},
           {field:'brand',documentId:BRAND_ID}]};
  }
  function verify(before,after,schema,components) {
    const b=normalizedFour(before,schema,components);
    const a=normalizedFour(after,schema,components);
    if(stable(a.ru)!==stable(b.ru))
      throw Error('ОПАСНО: RU Draft/Published изменились после KK PUT');
    if(stable(a.kk.published)!==stable(b.kk.published))
      throw Error('ОПАСНО: KK Published появился/изменился');
    if(stable(a.kk.draft?.fields)!==stable(b.kk.draft?.fields))
      throw Error('ОПАСНО: KK Draft fields/Media/key изменились при подключении Brand');
    for(const [name,oldIds] of Object.entries(b.kk.draft.relations)) {
      if(name==='brand')continue;
      if(stable(a.kk.draft.relations[name])!==stable(oldIds))
        throw Error('ОПАСНО: KK Draft relation '+name+' изменился');
    }
    if(stable(a.kk.draft.relations.brand)!==stable([BRAND_ID]))
      throw Error('KK Draft.brand не подключился к нужной KK записи');
    return {ruDraftIntact:true,ruPublishedIntact:true,kkFieldsAndMediaIntact:true,
      kkBrandLinked:true,remainingPending:[{field:'parent',documentId:PARENT_ID}]};
  }
  async function oneWrite(payload) {
    report.attemptedWrites++;
    const path='/content-manager/collection-types/'+CATEGORY_UID+'/'+
      encodeURIComponent(PILOT_ID)+'?locale=kk';
    const resp=await fetch(path,{method:'PUT',credentials:'include',
      cache:'no-store',headers:{Authorization:'Bearer '+token(),
      Accept:'application/json','Content-Type':'application/json'},
      body:JSON.stringify(payload)});
    const body=await resp.text();
    if(!resp.ok)throw Error('PUT brand HTTP '+resp.status+': '+body.slice(0,380));
    return {status:resp.status,bodyHead:body.slice(0,220)};
  }
  try {
    if(APPLY&&(!RISK || !/^[0-9a-f]{64}$/i.test(BASELINE)))
      throw Error('Для PUT нужен SHA из brand dry-run и одноразовое согласие с отсутствием DB backup');
    const brandRU=await get('/content-manager/collection-types/'+BRAND_UID+'/'+
      BRAND_ID+'?locale=ru&status=draft');
    if(brandRU?.data?.documentId!==BRAND_ID||brandRU.data.locale!=='ru')
      throw Error('Не подтвердился RU бренд CHANEL');
    const categoryIds=await relations(BRAND_UID,BRAND_ID,'categories','ru','draft');
    if(categoryIds.length!==BASELINE_CATEGORY_COUNT||
       !categoryIds.some(x=>x.documentId===PILOT_ID))
      throw Error('CHANEL membership изменился, нужен новый аудит');
    const [types,comps]=await Promise.all([
      get('/content-manager/content-types'),get('/content-manager/components')]);
    const schema=types?.data?.find(x=>x.uid===CATEGORY_UID);
    if(!schema?.attributes||!Array.isArray(comps?.data))
      throw Error('Нет схемы Category/Component');
    if(schema.attributes.brand?.type!=='relation' ||
       schema.attributes.brand.target!==BRAND_UID ||
       schema.attributes.parent?.target!==CATEGORY_UID)
      throw Error('Изменилась root relation schema');
    const components=new Map(comps.data.map(x=>[x.uid,x]));
    const beforeLive=await readLive(schema,components);
    const before=beforeLive.snapshots;
    report.before=before;
    if(report.warnings.length)
      throw Error('Недостоверное чтение: '+report.warnings.join('; '));
    const plan=inspect(before,schema,components);
    report.plan={operation:'connect-single-kk-brand',alreadyLinked:plan.alreadyLinked,
      target:{documentId:BRAND_ID,id:BRAND_KK_ID,locale:'kk'},
      parentPending:PARENT_ID,keyNormalization:'none',
      plannedWrite:plan.alreadyLinked?null:{
        locale:'kk',brand:{connect:[{id:BRAND_KK_ID,documentId:BRAND_ID,locale:'kk'}],
          disconnect:[]}},
      publishedNow:false};
    report.baselineHash=await hashOf({
      category:PILOT_ID,versions:normalizedFour(before,schema,components),
      target:beforeLive.brand});
    report.complete=true;
    if(plan.alreadyLinked) {
      report.status='brand-already-linked';
      if(APPLY)console.warn(TAG,'Brand уже привязан, PUT не выполняем');
    } else if(!APPLY){
      report.status='ready-brand-link';
      console.log(TAG,'DRY-RUN GET-only: поле brand будет подключено через один PUT.',
        'SHA:',report.baselineHash,'parent остаётся pending');
    } else {
      if(BASELINE!==report.baselineHash)
        throw Error('Изменился baseline с brand dry-run: PUT запрещён');
      // Fresh GET checkpoint before any operation.
      const fresh=await readLive(schema,components);
      const freshHash=await hashOf({
        category:PILOT_ID,versions:normalizedFour(fresh.snapshots,schema,components),
        target:fresh.brand});
      if(freshHash!==report.baselineHash)
        throw Error('Данные изменились перед PUT, остановка');
      if(inspect(fresh.snapshots,schema,components).alreadyLinked)
        throw Error('Brand уже подключён: повтор запрещён');
      await persist('before-brand-put',{before:fresh.snapshots,
        plan:report.plan,hash:freshHash});
      download('chanel-kk-brand-before-'+PILOT_ID+'.json',{
        before:fresh.snapshots,plan:report.plan,hash:freshHash});
      report.status='pending-put';
      let postError=null,writeResult=null,after=null,readError=null,verification=null;
      try{writeResult=await oneWrite(report.plan.plannedWrite);}
      catch(error){postError=error;}
      try{after=(await readLive(schema,components)).snapshots;}
      catch(error){readError=error;}
      if(after) {
        try{verification=verify(fresh.snapshots,after,schema,components);}
        catch(error){report.errors.push(error.message);report.status='integrity-stop';}
      }
      report.after=after;
      report.postflight=verification;
      report.writeResult=writeResult;
      if(postError)report.errors.push(postError.message);
      if(readError)report.errors.push(readError.message);
      try{await persist('after-brand-put',{
        before:fresh.snapshots,after,verification,
        errors:report.errors,postError:postError?.message,
        readError:readError?.message,writeResult});}
      catch(error){report.errors.push('Postflight IndexedDB failed: '+error.message);}
      try{download('chanel-kk-brand-after-'+PILOT_ID+'.json',{
        before:fresh.snapshots,after,verification,writeResult,errors:report.errors});}
      catch(error){report.errors.push('Postflight download failed: '+error.message);}
      if(report.errors.length||!verification){
        report.status='integrity-stop';
        throw Error('Однократная связь Brand не подтверждена; не повторять автоматически');
      }
      report.status='brand-linked-pending-parent';
      console.log(TAG,'Brand подключён и проверен. Осталось создать KK parent.');
    }
  }catch(error){
    if(!report.errors.includes(error.message))report.errors.push(error.message);
    if(report.attemptedWrites) report.status='integrity-stop';
    else report.status='blocked';
    console.error(TAG,'Остановлено:',error);
  }finally{
    report.finishedAt=new Date().toISOString();
    window.tmChanelKKBrandConnectPilot=report;
    try{download('chanel-kk-brand-'+report.mode+'-'+PILOT_ID+'.json',report);}
    catch(e){console.error(TAG,'Ошибка выгрузки:',e);}
    window[RUN_KEY]=false;
    console.log(TAG,'Результат:',report.status,'GET=',report.counters.GET,
      'PUT=',report.attemptedWrites,'POST=0');
  }
})();
