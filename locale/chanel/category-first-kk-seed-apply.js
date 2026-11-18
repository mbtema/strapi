(async function chanelFirstKKSeedApplyPilot() {
  'use strict';

  // CHANEL pilot создания ОДНОЙ отсутствующей KK Draft.
  // По умолчанию только GET; PUT возможен лишь с тремя отдельными флагами.
  const TAG = '[CHANEL KK Seed Apply Pilot]';
  const BRAND_UID = 'api::brand.brand';
  const CATEGORY_UID = 'api::category.category';
  const BRAND_ID = 'yeag7mng9hfpk7pd4ggm7495';
  const BASELINE_CATEGORY_COUNT = 65; // Источник: chanel-categories-ru.json
  const BRAND_PATH = '/admin/content-manager/collection-types/' + BRAND_UID + '/' + BRAND_ID;
  const PAGE_SIZE = 100;
  const RUN_KEY = '__tmChanelKKSeedApplyPilotRunning';
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
    mode: 'GET-only / pilot KK seed',
    attemptedWrites: 0,
    postflight: null,
    evidence: [],
    plan: null,
    baselineHash: null,
    snapshots: null,
    chosen: PILOT_ID,
    status: 'reading',
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


  const APPLY = window.tmChanelKKSeedApplyOnce === 'CREATE_KK_DRAFT';
  const RISK = window.tmChanelKKSeedNoDbBackupRiskAcceptedOnce === true;
  const EXPECTED_HASH = typeof window.tmChanelKKSeedBaselineHashOnce === 'string'
    ? window.tmChanelKKSeedBaselineHashOnce : '';
  delete window.tmChanelKKSeedApplyOnce;
  delete window.tmChanelKKSeedNoDbBackupRiskAcceptedOnce;
  delete window.tmChanelKKSeedBaselineHashOnce;
  report.mode = APPLY ? 'apply-one-kk-seed' : 'GET-only / pilot KK seed';
  const SKIPPED_FIELDS = new Set(['key','code','slug']);
  // key/code/slug — shared/unique: не посылать в seed PUT.
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
  async function localeTarget(uid,documentId) {
    if (uid === CATEGORY_UID) {
      const x=await get('/content-manager/collection-types/'+uid+'/'+
        encodeURIComponent(documentId)+'?locale=kk&status=draft',true);
      const row=x?.data;
      if (!row || !Object.keys(row).length) return null;
      if (row.documentId !== documentId || row.locale !== 'kk' ||
          !Number.isSafeInteger(row.id) || row.id<=0) {
        throw Error('Неоднозначный KK target Category '+documentId);
      }
      return {id:row.id,documentId,locale:'kk'};
    }
    const x=await get('/content-manager/collection-types/'+uid+'/'+
      encodeURIComponent(documentId)+'?locale=kk&status=draft',true);
    const row=x?.data;
    if (!row || !Object.keys(row).length) return null;
    if (row.documentId !== documentId || row.locale !== 'kk' ||
        !Number.isSafeInteger(row.id) || row.id<=0) {
      throw Error('Неоднозначный KK target '+uid+'/'+documentId);
    }
    return {id:row.id,documentId,locale:'kk'};
  }
  async function checkUnique(field,value,id) {
    const matches=async locale => {
      const qs=new URLSearchParams({locale,status:'draft',page:'1',
        pageSize:String(PAGE_SIZE)});
      qs.set('filters['+field+'][$eq]',String(value));
      const out=await get('/content-manager/collection-types/'+CATEGORY_UID+'?'+qs);
      const parsed=parsePage(out,1,null);
      if (parsed.total>PAGE_SIZE || parsed.pageCount>1)
        throw Error('Unique search требует все страницы '+field);
      return parsed.rows.map(x=>x?.attributes&&!x.documentId?
        {...x.attributes,id:x.id}:x).map(x=>x.documentId);
    };
    const [ru,kk]=await Promise.all([matches('ru'),matches('kk')]);
    if (!ru.includes(id)) throw Error('Unique control RU не нашёл Category '+field);
    const conflict=[...ru,...kk].filter(x=>x!==id);
    if (conflict.length) throw Error('Конфликт '+field+' c '+conflict.join(','));
    return {field,value,ru,kk,verified:true};
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

  const DATABASE_NAME='tm-chanel-kk-seed-pilot-journal-v1';
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
  function verifyAfter(before,after,schema,components,seed) {
    if(!after.ru.draft||!after.ru.published||!after.kk.draft||after.kk.published)
      throw Error('Непредвиденное создание/исчезновение версий после PUT');
    const aRU=semanticVersion(after.ru.draft,schema,components);
    const bRU=semanticVersion(before.ru.draft,schema,components);
    const aRUPub=semanticVersion(after.ru.published,schema,components);
    const bRUPub=semanticVersion(before.ru.published,schema,components);
    if(stable(aRU)!==stable(bRU))
      throw Error('ОПАСНО: изменился RU Draft после создания KK (включая key/links)');
    if(stable(aRUPub)!==stable(bRUPub))
      throw Error('ОПАСНО: изменился RU Published после создания KK');
    const kk=semanticVersion(after.kk.draft,schema,components);
    const mismatches=[];
    for(const [name,want] of Object.entries(seed)) {
      if(name==='locale')continue;
      if(stable(kk.fields[name])!==stable(want))
        mismatches.push(name);
    }
    if(mismatches.length)
      throw Error('KK Draft не совпал с seed payload: '+mismatches.join(', '));
    // Shared key/code/slug не меняем: в новом KK могут быть проставлены системой.
    // Однако RU key и остальные нецелевые бизнес-поля уже защищены выше.
    const missing=[],inherited=[],unexpected=[];
    for(const [name,src] of Object.entries(bRU.relations)) {
      const current=kk.relations[name]||[];
      const allowed=new Set(src);
      for(const id of current){
        if(!allowed.has(id))unexpected.push(name+':'+id);
        else inherited.push(name+':'+id);
      }
      for(const id of src)if(!current.includes(id))missing.push({field:name,documentId:id});
    }
    if(unexpected.length)throw Error('KK Draft унаследовал посторонние links: '+unexpected.join(', '));
    const plannedParent='xff5b8l7kowombgqbfekk8ms';
    if(!missing.some(x=>x.field==='parent'&&x.documentId===plannedParent))
      throw Error('Требуется пересмотреть parent: исходная отложенная связь изменилась');
    return {
      ruDraftIntact:true,ruPublishedIntact:true,
      kkDraftMatchesSeed:true,kkPublishedAbsent:true,
      inheritedDraftLinks:inherited, pendingDraftLinks:missing,
      kkDraftKey:kk.fields.key??null, ruKey:bRU.fields.key,
      completed:false, reason:'Сначала создать KK parent и восстановить root links'
    };
  }
  async function snapshotFour(schema,components){
    const snap={ru:{draft:null,published:null},kk:{draft:null,published:null}};
    for(const lc of ['ru','kk'])for(const st of ['draft','published'])
      snap[lc][st]=await readVersion(PILOT_ID,lc,st,schema,components);
    return snap;
  }
  async function onePut(path,payload){
    report.attemptedWrites++;
    const response=await fetch(path,{
      method:'PUT',credentials:'include',cache:'no-store',
      headers:{Authorization:'Bearer '+token(),Accept:'application/json',
        'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    const raw=await response.text();
    if(!response.ok)throw Error('PUT HTTP '+response.status+': '+raw.slice(0,400));
    return {httpStatus:response.status,responseSummary:raw.slice(0,300)};
  }

  try {
    const brand=await get('/content-manager/collection-types/'+BRAND_UID+
      '/'+BRAND_ID+'?locale=ru&status=draft');
    if (brand?.data?.documentId!==BRAND_ID || brand?.data?.locale!=='ru')
      throw Error('Неверная RU Brand CHANEL');
    const index=await relations(BRAND_UID,BRAND_ID,'categories','ru','draft');
    if(index.length!==BASELINE_CATEGORY_COUNT || !index.some(x=>x.documentId===PILOT_ID))
      throw Error('Список из 65 CHANEL изменился или пилот отсутствует');
    report.source={total:index.length,order:index.findIndex(x=>x.documentId===PILOT_ID)+1};
    const [types,comps]=await Promise.all([
      get('/content-manager/content-types'),get('/content-manager/components')
    ]);
    const schema=types?.data?.find(x=>x.uid===CATEGORY_UID);
    if(!schema?.attributes || !Array.isArray(comps?.data))
      throw Error('Нет schemas Category/Components');
    const components=new Map(comps.data.map(x=>[x.uid,x]));
    report.schema=schema;
    const snaps={ru:{draft:null,published:null},kk:{draft:null,published:null}};
    for(const lc of ['ru','kk']) for(const st of ['draft','published'])
      snaps[lc][st]=await readVersion(PILOT_ID,lc,st,schema,components);
    report.snapshots=snaps;
    if(!snaps.ru.draft)throw Error('Отсутствует RU Draft пилота');
    if(snaps.kk.draft || snaps.kk.published)
      throw Error('KK для пилота уже существует: нельзя повторно создавать');
    const ru=snaps.ru.draft;
    const base=seedPayload(ru,schema,components);
    if (report.warnings.length) {
      throw Error('Schema/компоненты прочитаны с предупреждениями: ' +
        report.warnings.join(' | '));
    }
    if (base.nestedPending.length) {
      throw Error('В выбранной категории есть вложенные links: ' +
        JSON.stringify(base.nestedPending) +
        '. Не выполнять seed до отдельного контракта');
    }
    const available=[],pending=[],sourceIds={};
    for(const [field,def] of Object.entries(attrs(schema))) {
      if(def.type!=='relation'||SYSTEM.has(field))continue;
      const source=ru.relations[field];
      if(!Array.isArray(source))throw Error('Root relation '+field+' не прочитана');
      const docIds=source.map(x=>x.documentId);
      sourceIds[field]=docIds;
      if(field==='products'&&docIds.length)
        throw Error('Legacy products не пуст, пилот заблокирован');
      for(const id of docIds) {
        const target=await localeTarget(def.target,id);
        const record={field,targetUid:def.target,documentId:id};
        if(target)available.push({...record,target});
        else pending.push({...record,reason:'Нет KK Draft у связной записи'});
      }
    }
    const checks=[];
    for(const [name,def] of Object.entries(attrs(schema))) {
      if(!def.unique || SKIPPED_FIELDS.has(name))continue;
      const v=base.payload[name];
      if(v==null || v==='')continue;
      checks.push(await checkUnique(name,v,PILOT_ID));
    }
    report.plan={
      operation:'seed-kk-draft-only',
      noCMSWrites:!APPLY, intendedMethod:'PUT',
      intendedEndpoint:'/content-manager/collection-types/'+CATEGORY_UID+
        '/'+PILOT_ID+'?locale=kk',
      pilotTitle:ru.fields.title,
      seedPayload:base.payload,
      excludedSharedUniqueFields:base.excluded,
      nestedRelationsPending:base.nestedPending,
      sourceRootRelations:sourceIds,
      availableRootTargets:available,
      pendingRootTargets:pending,
      uniquenessChecks:checks,
      constraints:{
        publishNow:false,
        noRecursiveWrites:true,
        afterSeedMustVerifyAllFourVersions:true,
        keyIntegrityMandatory:true,
        afterSeedParentPending:pending.some(x=>x.field==='parent'),
        followUp:'Связать parent/children в KK Draft после создания остальных KK Category, затем Publish RU+KK'
      }
    };
    report.baselineHash=await digest({
      pilot:PILOT_ID,ru:snaps.ru.draft,kk:snaps.kk.draft,
      ruPublished:snaps.ru.published,kkPublished:snaps.kk.published,
      schema:schema.attributes
    });
    report.complete=true;
    report.status='ready-seed-draft';
    report.noDbBackupAcknowledged=APPLY && RISK;
    console.log(TAG,'Preflight OK. Seed fields:',Object.keys(base.payload),
      'available root links:',available.length,
      'pending:',pending.length,'hash:',report.baselineHash);
    console.table(pending);
    if(APPLY){
      if(!RISK || !/^[0-9a-f]{64}$/i.test(EXPECTED_HASH))
        throw Error('APPLY запрещён без одноразового согласия на риск '+
          'отсутствия DB backup и SHA-256 из проверенного preflight');
      if(EXPECTED_HASH!==report.baselineHash)
        throw Error('Данные изменились после preflight: hash не совпадает, PUT запрещён');
      if(pending.filter(x=>x.field!=='parent').length)
        throw Error('Неожиданные отложенные связи, нужен отдельный этап');
      if(available.some(x=>x.field!=='brand'||
          x.documentId!==BRAND_ID||x.target.locale!=='kk'))
        throw Error('Неожиданные доступные target links');
      // Persist and download FULL prewrite snapshot before any attempted PUT.
      await persist('before-put',{snapshots:snaps,plan:report.plan,
        baselineHash:report.baselineHash,at:new Date().toISOString()});
      download('chanel-kk-seed-before-'+PILOT_ID+'.json',{
        snapshots:snaps,plan:report.plan,baselineHash:report.baselineHash});
      report.status='put-pending';
      let writeError=null,writeResult=null;
      try {
        writeResult=await onePut(report.plan.intendedEndpoint,base.payload);
      } catch(error){writeError=error;}
      let after=null,readError=null,verification=null;
      try {after=await snapshotFour(schema,components);}
      catch(error){readError=error;}
      report.after=after;
      if(after){
        try {verification=verifyAfter(snaps,after,schema,components,base.payload);}
        catch(error){
          report.status='integrity-stop';
          report.errors.push(error.message);
        }
      }
      report.postflight=verification;
      report.writeResult=writeResult;
      if(writeError)report.errors.push(writeError.message);
      if(readError)report.errors.push(readError.message);
      // Persist postflight before proceeding / claiming success.
      try {
        await persist('after-put',{before:snaps,after,
          verification,writeResult,writeError:writeError?.message,
          readError:readError?.message});
      }catch(error){
        report.errors.push('Невозможно записать postflight journal: '+error.message);
        report.status='integrity-stop';
      }
      download('chanel-kk-seed-after-'+PILOT_ID+'.json',{
        before:snaps,after,verification,writeResult,
        errors:report.errors});
      if(report.errors.length||!verification) {
        report.status='integrity-stop';
        throw Error('Seed PUT завершился с ошибкой/неоднозначно; никаких повторов. '+
          report.errors.join(' | '));
      }
      report.status='seeded-pending-relations';
      console.log(TAG,'KK Draft создан, RU intact. Остались relations:',
        verification.pendingDraftLinks);
    }
  } catch(e) {
    report.errors.push(e.message);
    if(report.attemptedWrites) {
      report.status='integrity-stop';
      console.error(TAG,'ОСТАНОВЛЕНО после PUT (не повторять автоматически):',e);
    } else {
      report.status='blocked';
      console.error(TAG,'Preflight блокировка; CMS не менялась:',e);
    }
  } finally {
    report.finishedAt=new Date().toISOString();
    window.tmChanelKKSeedApplyPilot=report;
    try {download('chanel-kk-seed-pilot-'+report.mode+'-'+PILOT_ID+'.json',report);}
    catch(e) {console.error(TAG,'Ошибка выгрузки JSON:',e);}
    window[RUN_KEY]=false;
    console.log(TAG,'Итог:',report.status,'GET:',report.counters.GET,
      'PUT:',report.attemptedWrites,'POST=0');
  }
})();
