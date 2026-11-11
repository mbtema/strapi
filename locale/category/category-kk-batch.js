// DIOR / Category RU -> KK: управляемое создание отсутствующих KK Draft.
// В Console открытой RU-карточки бренда DIOR.
// Пользователь выбирает JSON уже завершённого category-kk-dry-run.js.
// Никаких write до отдельного подтверждения. Только один PUT за раз.
// RU Draft/Published и relations защищены preflight/postflight.
// После ошибки/неопределённого PUT весь batch останавливается. Без Publish.
(async () => {
  'use strict';
  const UID = 'api::category.category';
  const BRAND_UID = 'api::brand.brand';
  const BRAND_ID = 'qw7sja6ffpbufvzub5maxyrl';
  const FIELD = 'categories';
  const KEY = '__tmDiorCategoryKkBatch';
  const PANEL = 'tm-dior-category-kk-batch';
  const SYSTEM = new Set([
    'id','documentId','locale','status','publishedAt',
    'createdAt','updatedAt','createdBy','updatedBy','localizations'
  ]);
  const SCALAR = new Set([
    'string','text','richtext','email','enumeration','json','blocks',
    'integer','biginteger','float','decimal','boolean','date','time','datetime'
  ]);
  if (!location.pathname.includes('/content-manager/collection-types/'+BRAND_UID+'/'+BRAND_ID) ||
      (new URLSearchParams(location.search).get('plugins[i18n][locale]')||'ru')!=='ru') {
    console.error('[DIOR KK batch]', 'Открой RU-карточку бренда DIOR');
    return;
  }
  if (window[KEY]?.running) {
    console.warn('[DIOR KK batch]', 'Уже выполняется'); return;
  }
  let token;
  try { token=JSON.parse(localStorage.getItem('jwtToken')); }
  catch { token=localStorage.getItem('jwtToken'); }
  if(typeof token!=='string'||!token) {
    console.error('[DIOR KK batch]', 'Нет Strapi Admin JWT');return;
  }
  document.getElementById(PANEL)?.remove();
  const state={
    running:false,stopRequested:false,getCount:0,putCount:0,retries:0,
    attempted:false,components:null,audit:null,schema:null,checkpoint:null,
    checkpointKey:null,
    report:{
      tool:'dior-category-kk-batch',version:1,source:'category-kk-dry-run',
      brandDocumentId:BRAND_ID,firstPassOnly:true,published:false,
      startedAt:new Date().toISOString(),finishedAt:null,
      status:'input_required',auditStartedAt:null,summary:null,rows:[],errors:[]
    }
  };
  window[KEY]=state;
  window.tmDiorCategoryKkBatchReport=state.report;
  const el=(tag,txt)=>{const e=document.createElement(tag);if(txt!=null)e.textContent=txt;return e};
  const p=el('section');p.id=PANEL;
  p.style.cssText='position:fixed;bottom:14px;right:14px;z-index:2147483600;'+
    'width:min(520px,calc(100vw - 28px));max-height:80vh;overflow:auto;'+
    'background:#24243a;color:#fff;border:1px solid #9691c3;border-radius:10px;'+
    'box-shadow:0 8px 24px #0009;padding:14px;font:13px/1.5 system-ui';
  const h=el('strong','DIOR: массовое создание KK Draft (первый проход)');
  const info=el('div','Выбери итоговый JSON от category-kk-dry-run.js.');
  info.style.cssText='white-space:pre-wrap;margin:9px 0';
  const picker=el('input');picker.type='file';picker.accept='.json,application/json';
  picker.style.cssText='width:100%;margin:8px 0';
  const controls=el('div');controls.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin-top:8px';
  const launch=el('button','Запустить последовательные PUT');
  const stop=el('button','Стоп после текущей записи');
  const exportCsv=el('button','Скачать CSV');
  const exportJson=el('button','Скачать JSON');
  for(const b of [launch,stop,exportCsv,exportJson]){
    b.type='button';b.style.cssText='cursor:pointer;padding:6px 9px';
    controls.append(b);
  }
  launch.disabled=true;stop.disabled=true;
  p.append(h,info,picker,controls);document.body.append(p);
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const show=(m)=>{info.textContent=m+'\nGET: '+state.getCount+
    ' · PUT: '+state.putCount+' · GET retry: '+state.retries;};
  const tell=(status,message)=>{
    state.report.status=status;
    show(message); console.log('[DIOR KK batch]',status,message);
  };
  const csvFields=['documentId','name','result','reason','putStatus','kkId','verified'];
  const quote=x=>{
    let s=String(x??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  };
  const csv=()=> '\uFEFF'+[csvFields.join(';'),
    ...state.report.rows.map(row=>csvFields.map(k=>quote(row[k])).join(';'))].join('\n');
  function download(name,content,mime) {
    const u=URL.createObjectURL(new Blob([content],{type:mime}));
    const a=el('a');a.href=u;a.download=name;document.body.append(a);
    a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),15000);
  }
  exportCsv.onclick=()=>download('dior-category-kk-batch.csv',csv(),'text/csv;charset=utf-8');
  exportJson.onclick=()=>download('dior-category-kk-batch.json',
    JSON.stringify(state.report,null,2),'application/json;charset=utf-8');
  function persist(){
    if(!state.checkpointKey)return;
    localStorage.setItem(state.checkpointKey,JSON.stringify(state.checkpoint));
  }
  function finish(status,message) {
    state.running=false;state.report.status=status;
    state.report.finishedAt=new Date().toISOString();
    state.report.summary={
      total:state.audit?.rows?.length||0,
      candidates:state.audit?.rows?.filter(x=>x.status==='ready').length||0,
      verifiedWrites:state.report.rows.filter(x=>x.result==='created').length,
      already:state.report.rows.filter(x=>x.result==='already').length,
      review:state.report.rows.filter(x=>x.result==='review').length,
      pending:state.report.rows.filter(x=>x.result==='pending').length,
      getRequests:state.getCount,putRequests:state.putCount
    };
    launch.disabled=true;stop.disabled=true;
    show(message+'\nОтчёты сохранены. Для возобновления повторно открой скрипт и выбери тот же JSON.');
    exportCsv.onclick();exportJson.onclick();
  }
  stop.onclick=()=>{state.stopRequested=true;stop.disabled=true;
    show('Остановка запрошена. Если PUT выполняется, сначала завершится его проверка.');};
  // Временные ошибки GET можно повторять; PUT НЕ повторять ни при каких условиях.
  async function request(method,path,body) {
    if(method!=='GET'&&method!=='PUT')throw Error('Запрещённый метод '+method);
    if(method==='PUT')state.putCount++;
    const attempts=method==='GET'?3:1;
    for(let i=0;i<attempts;i++){
      if(method==='GET')state.getCount++;
      let response;
      try {
        response=await fetch(path,{
          method,credentials:'include',cache:'no-store',
          headers:{Authorization:'Bearer '+token,Accept:'application/json',
            ...(body===undefined?{}:{'Content-Type':'application/json'})},
          ...(body===undefined?{}:{body:JSON.stringify(body)})
        });
      }catch(error){
        if(method!=='GET'||i===attempts-1)throw Error('NETWORK '+method+' '+path+': '+String(error));
        state.retries++;await sleep((i+1)*800);continue;
      }
      const text=await response.text();
      let data=null;
      try{data=text?JSON.parse(text):null}
      catch{
        if(response.status!==404)throw Error('Ответ не JSON: '+method+' '+path);
      }
      const result={ok:response.ok,status:response.status,data,
        message:String(data?.error?.message||'').slice(0,300)};
      if(method==='PUT'||response.ok||response.status===404)return result;
      if(i<attempts-1&&[408,429,500,502,503,504].includes(response.status)){
        state.retries++;await sleep((i+1)*900);continue;
      }
      throw Error('GET HTTP '+response.status+' '+path+': '+result.message);
    }
  }
  async function get(path) {
    const r=await request('GET',path);
    if(!r.ok)throw Error('GET HTTP '+r.status+' '+path+': '+r.message);
    return r.data;
  }
  function decode(result,documentId,locale,published) {
    const data=result?.data?.data;
    if(result?.status===404 || (result?.ok &&
      (data==null || (typeof data==='object'&&!Array.isArray(data)&&
        Object.keys(data).length===0))))return null;
    if(!result?.ok||data?.documentId!==documentId||data?.locale!==locale||
      (published&&data.publishedAt==null))
      throw Error('Неоднозначный detail '+documentId+'/'+locale+'/'+published+
        ': HTTP '+result?.status);
    return data;
  }
  const detailPath=(id,locale,publication)=>
    '/content-manager/collection-types/'+UID+'/'+id+
    '?locale='+locale+'&status='+publication;
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


  const relIds=entry=>Object.fromEntries(
    Object.entries(entry?.relations||{}).map(([name,r])=>
      [name,r.entries.map(x=>x.documentId).sort()])
  );
  const actualFields=schema=>Object.fromEntries(
    Object.entries(schema.attributes).filter(([name])=>!SYSTEM.has(name))
      .map(([name,attr])=>[name,{
        type:attr.type,required:!!attr.required,
        localized:attr.type==='relation'?
          attr.pluginOptions?.i18n?.localized!==false:isLocalized(attr),
        unique:!!attr.unique,target:attr.target??null
      }])
  );
  function assertSource(row,snap,plan) {
    const draft=snap.ru.draft,pub=snap.ru.published;
    const b=row.before;
    if(!draft||!pub)throw Error('RU Draft/Published отсутствует');
    if(!equal(draft.business,b.ruDraft?.fields))
      throw Error('RU Draft изменён со времени аудита');
    if(!equal(pub.business,b.ruPublished?.fields))
      throw Error('RU Published изменён со времени аудита');
    if(!equal(relIds(draft),relIds(b.ruDraft)))
      throw Error('RU Draft relations изменились со времени аудита');
    if(!equal(relIds(pub),relIds(b.ruPublished)))
      throw Error('RU Published relations изменились со времени аудита');
    if(pub.detail.publishedAt!==b.ruPublished.publishedAt)
      throw Error('RU Published дата публикации изменилась');
    if(plan.blockers.length)
      throw Error('Payload blocked: '+plan.blockers.join(' | '));
    if(!equal(plan.payload,row.payload))
      throw Error('Payload изменился со времени аудита');
    if(!equal(plan.warnings,row.warnings) ||
      !equal(plan.deferred,row.deferredRelations))
      throw Error('Предупреждения/отложенные relations изменились');
  }
  function assertPost(before,after,plan) {
    const errors=[];
    for(const locale of ['ru'])for(const publication of ['draft','published']){
      const a=before[locale][publication],b=after[locale][publication];
      if(!a||!b||!equal(a.business,b.business)||
        !equal(a.relations,b.relations))
        errors.push('Изменились RU '+publication+' поля/relations');
      if(publication==='published' &&
        a.detail.publishedAt!==b.detail.publishedAt)
        errors.push('Изменился RU Published publishedAt');
    }
    if(!after.kk.draft||after.kk.published)
      errors.push('Нет KK Draft или внезапная публикация KK');
    if(after.kk.draft){
      const kk=after.kk.draft;
      if(kk.detail.publishedAt!=null||kk.detail.locale!=='kk')
        errors.push('Некорректный статус/локаль KK Draft');
      if(!equal(kk.business,before.ru.draft.business))
        errors.push('KK не совпадает с RU Draft по бизнес-полям');
      if(!equal(kk.transferable,before.ru.draft.transferable))
        errors.push('KK отличается от RU с игнорированием component ID');
      if(Object.values(kk.relations).some(r=>r.total!==0))
        errors.push('KK relations заполнены, хотя перенесены быть не должны');
    }
    return errors;
  }
  function validateAudit(audit) {
    if(audit?.tool!=='dior-category-kk-dry-run'||audit.version!==1||
      audit.complete!==true||audit.outcome!=='completed'||
      audit.brandDocumentId!==BRAND_ID||
      audit.summary?.found!==55||audit.summary?.processed!==55||
      audit.summary?.statuses?.ready!==52||
      audit.summary?.statuses?.already_synced!==3||
      !Array.isArray(audit.rows)||audit.rows.length!==55||
      !Array.isArray(audit.relationFields)||
      !audit.schemaFields||audit.errors?.length)
      throw Error('JSON не соответствует завершённому аудиту DIOR 55/52/3');
    const ids=audit.rows.map(x=>x.documentId);
    if(new Set(ids).size!==55||ids.some(id=>!/^[a-z0-9]+$/i.test(id)))
      throw Error('Повторы/некорректные documentId в JSON');
    for(const row of audit.rows) {
      if(!['ready','already_synced'].includes(row.status))
        throw Error('Недопустимый статус в JSON');
      if(row.status==='ready'&&
        (!row.payload||row.payload.locale!=='kk'||
          !row.before?.ruDraft||!row.before?.ruPublished||
          row.before?.kkDraft||row.before?.kkPublished))
        throw Error('В JSON некорректный кандидат '+row.documentId);
      if(row.status==='already_synced' && !row.before?.kkDraft)
        throw Error('В JSON нет существующей KK '+row.documentId);
    }
    if(!crypto?.subtle)throw Error('Для проверки файла нужен crypto.subtle (secure context)');
  }
  async function fileSha(fileText) {
    const data=new TextEncoder().encode(fileText);
    const digest=await crypto.subtle.digest('SHA-256',data);
    return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
  }
  async function liveCategoryIds() {
    let page=1,total=null,pages=null,output=[];
    while(true){
      const json=await get('/content-manager/relations/'+BRAND_UID+'/'+BRAND_ID+
        '/'+FIELD+'?locale=ru&page='+page+'&pageSize=100');
      const rows=json?.results,p=json?.pagination;
      if(!Array.isArray(rows)||!Number.isInteger(p?.total)||
        !Number.isInteger(p?.pageCount)||
        p.total<0||p.pageCount<0||(p.total>0&&!rows.length)||
        (total!==null&&total!==p.total)||(pages!==null&&pages!==p.pageCount)||
        (p.page!=null&&p.page!==page))
        throw Error('Неверная пагинация DIOR.categories');
      total=p.total;pages=p.pageCount;
      output.push(...rows.map(x=>x.documentId));
      if(page>=pages||pages===0)break;
      if(page>=100)throw Error('DIOR.categories слишком много страниц');
      page++;
    }
    if(output.length!==total||new Set(output).size!==total)
      throw Error('DIOR.categories неполная/дубли');
    return output.sort();
  }
  async function liveSchema() {
    const [types,components,brand]=await Promise.all([
      get('/content-manager/content-types'),
      get('/content-manager/components'),
      get('/content-manager/collection-types/'+BRAND_UID+'/'+BRAND_ID+
        '?locale=ru&status=draft')
    ]);
    const schema=types?.data?.find(x=>x.uid===UID);
    const brandSchema=types?.data?.find(x=>x.uid===BRAND_UID);
    if(!schema?.attributes||schema.pluginOptions?.i18n?.localized!==true||
      brandSchema?.attributes?.[FIELD]?.type!=='relation'||
      brandSchema.attributes[FIELD].target!==UID||
      brand?.data?.documentId!==BRAND_ID||brand?.data?.locale!=='ru')
      throw Error('Изменилась схема Category/Brand либо DIOR недоступен');
    if(!Array.isArray(components?.data)||
      !components.data.every(x=>x.uid&&x.attributes))
      throw Error('Схемы компонентов неполные');
    state.components=Object.fromEntries(components.data.map(x=>[x.uid,x]));
    return schema;
  }
  async function start() {
    if(state.running||!state.audit)return;
    if(!confirm('Запустить создание недостающих 52 KK Draft для DIOR?'+
      '\nТолько один PUT за раз. RU не публикуем, relations откладываем.'+
      '\nСтоп при первой неоднозначности. Это РЕАЛЬНЫЕ изменения CMS.'))return;
    state.running=true;launch.disabled=true;picker.disabled=true;stop.disabled=false;
    state.stopRequested=false;state.report.status='running';
    const audit=state.audit;
    const done=state.checkpoint.done;
    try {
      tell('checking','GET: проверяем схемы и членство в DIOR…');
      const schema=await liveSchema();
      state.schema=schema;
      if(!equal(actualFields(schema),audit.schemaFields)||
        !equal(relations(schema),audit.relationFields))
        throw Error('Схема Category не совпадает с исходным аудитом');
      const members=await liveCategoryIds();
      if(!equal(members,audit.rows.map(x=>x.documentId).sort()))
        throw Error('Состав DIOR.categories изменился со времени аудита');
      if(state.checkpoint.unresolved)
        throw Error('Предыдущая запись с неопределённым исходом: '+
          state.checkpoint.unresolved+'; проверь вручную, автоматический повтор запрещён');
      const candidates=audit.rows.filter(x=>x.status==='ready');
      for(let i=0;i<candidates.length;i++){
        if(state.stopRequested) {
          tell('stopped','Остановлено по запросу пользователя');break;
        }
        const row=candidates[i],id=row.documentId;
        const display=(i+1)+'/'+candidates.length+' '+row.name;
        show('GET preflight: '+display);
        if(i>0 && i%5===0){
          const current=await liveCategoryIds();
          if(!equal(current,members))throw Error('DIOR.categories изменились в ходе запуска');
        }
        // Snapshot всех локалей и всех 6 root relation-полей.
        const before=await snapshot(id,schema);
        if(!before.ru.draft||!before.ru.published)
          throw Error('Нет RU Draft/Published: '+display);
        const plan=buildPayload(schema,before.ru.draft.detail);
        assertSource(row,before,plan);
        const r={documentId:id,name:row.name,putStatus:'',kkId:'',
          result:'pending',verified:false,reason:'',preflightAt:new Date().toISOString()};
        state.report.rows.push(r);
        if(before.kk.draft||before.kk.published){
          if(before.kk.draft && !before.kk.published &&
            equal(before.kk.draft.business,before.ru.draft.business) &&
            equal(before.kk.draft.transferable,before.ru.draft.transferable) &&
            Object.values(before.kk.draft.relations).every(x=>x.total===0)){
            if(done[id]&&done[id].kkId!==before.kk.draft.detail.id)
              throw Error('KK ID не совпадает с подтверждённым checkpoint: '+display);
            r.result='already';r.verified=true;r.kkId=before.kk.draft.detail.id;
            done[id]={kkId:r.kkId,verifiedAt:new Date().toISOString()};
            persist();
            show('SKIP: уже создана и проверена KK '+display);
            continue;
          }
          r.result='review';r.reason='KK существует, но отличается от RU или опубликована';
          throw Error('Существующая KK требует review: '+display);
        }
        if(done[id])
          throw Error('В checkpoint запись была выполнена, но сейчас KK отсутствует: '+display);
        if(state.stopRequested){r.reason='Остановлено до PUT';break;}
        // Записать unresolved ДО запроса, чтобы после reload запись не повторилась.
        state.checkpoint.unresolved=id;persist();
        r.putAt=new Date().toISOString();
        show('PUT KK: '+display);
        let response=null,putError=null;
        try {
          response=await request('PUT','/content-manager/collection-types/'+UID+'/'+
            id+'?locale=kk',plan.payload);
        }catch(error){putError=String(error);}
        r.putStatus=response?.status??'NETWORK';
        // Даже если PUT дал NETWORK/HTTP error, всегда пытаемся проверить GET.
        show('GET postflight: '+display);
        let after=null,postError=null;
        try {after=await snapshot(id,schema);}
        catch(error){postError=String(error);}
        const problems=after?assertPost(before,after,plan):['GET postflight: '+postError];
        if(!response?.ok)problems.push('Неоднозначный PUT: '+
          (putError||('HTTP '+response?.status+' '+response?.message)));
        if(problems.length){
          r.result='review';r.reason=problems.join(' | ');
          r.after=after?{
            ruDraft:after.ru.draft?.business,ruPublished:after.ru.published?.business,
            kkDraft:after.kk.draft?.business,kkId:after.kk.draft?.detail.id
          }:null;
          throw Error('STOP '+display+': '+r.reason);
        }
        r.result='created';r.verified=true;r.kkId=after.kk.draft.detail.id;
        done[id]={kkId:r.kkId,verifiedAt:new Date().toISOString()};
        state.checkpoint.unresolved=null;persist();
        show('OK '+display+' · проверено PUT: '+
          state.report.rows.filter(x=>x.result==='created').length);
        await sleep(300);
      }
      if(state.stopRequested) {
        finish('stopped','Остановлено по запросу. Дальше безопасно возобновить с тем же JSON.');
      } else {
        finish('completed','Массовое создание завершено. Все кандидаты проверены.');
      }
    }catch(error) {
      const message=String(error);
      state.report.errors.push(message);
      console.error('[DIOR KK batch]',message);
      finish('review','СТОП: '+message);
    }
  }
  launch.onclick=start;
  picker.onchange=async()=>{
    if(state.running)return;
    const file=picker.files?.[0];if(!file)return;
    try{
      const content=await file.text();
      const audit=JSON.parse(content);
      validateAudit(audit);
      const sha=await fileSha(content);
      const checkpointKey='tm:dior:category:kk:batch:v1:'+sha;
      const existing=localStorage.getItem(checkpointKey);
      let checkpoint=existing?JSON.parse(existing):{done:{},unresolved:null};
      if(!checkpoint||typeof checkpoint.done!=='object'||
        Array.isArray(checkpoint.done)||!('unresolved' in checkpoint))
        throw Error('Checkpoint повреждён, остановка');
      state.audit=audit;state.checkpoint=checkpoint;
      state.checkpointKey=checkpointKey;
      state.report.auditStartedAt=audit.startedAt;
      state.report.auditSha256=sha;
      state.report.rows=[];
      state.report.errors=[];
      state.report.startedAt=new Date().toISOString();
      state.report.finishedAt=null;
      state.report.status='ready';
      if(checkpoint.unresolved){
        launch.disabled=true;
        show('Блокировка: предыдущий PUT '+checkpoint.unresolved+
          ' имеет неопределённый результат. Нужна ручная проверка.');
        return;
      }
      launch.disabled=false;
      show('Файл проверен: 55 DIOR, 52 ready, 3 already_synced.'+
        '\nВ checkpoint подтверждено: '+Object.keys(checkpoint.done).length+
        '.\nНикаких записей пока нет. Для старта нажми кнопку и подтверди PUT.');
    }catch(error){
      launch.disabled=true;
      show('Неверный JSON: '+String(error));console.error('[DIOR KK batch]',error);
    }
  };
  tell('input_required','Выбери JSON из завершённого DIOR dry-run. Запись не начнётся без подтверждения.');
})();
