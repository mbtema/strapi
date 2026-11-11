// DIOR Category RU → KK. Один инструмент: scan → pilot → apply → verify.
// Запускать из Console RU-карточки бренда DIOR.
// Источник: RU Draft; RU Published защищаем от изменений.
// Только additive root relations; no disconnect, no Publish.
// Save Category.product на KK ранее не подтверждён: сначала один пилот.
(async () => {
'use strict';
const BRAND_UID='api::brand.brand', UID='api::category.category';
const BRAND_ID='qw7sja6ffpbufvzub5maxyrl', FIELD='categories';
const KEY='__tmDiorCategorySync', PANEL='tm-dior-category-sync';
const SYSTEM=new Set(['id','documentId','locale','status','publishedAt','createdAt',
  'updatedAt','createdBy','updatedBy','localizations']);
const SCALAR=new Set(['string','text','richtext','email','enumeration','json','blocks',
  'integer','biginteger','float','decimal','boolean','date','time','datetime']);
const PAGE_SIZE=100, READ_WORKERS=2, TARGET_WORKERS=4;
const JOURNAL_KEY='tm:dior:category:unresolved:v2';
const urlLocale=new URLSearchParams(location.search).get('plugins[i18n][locale]')||'ru';
if(!location.pathname.includes('/content-manager/collection-types/'+BRAND_UID+'/'+BRAND_ID)||
  urlLocale!=='ru'){
  console.error('[DIOR Category]', 'Открой RU-карточку Brand DIOR');
  return;
}
if(window[KEY]?.running){
  console.warn('[DIOR Category]', 'Инструмент уже выполняется');return;
}
let jwt;
try{jwt=JSON.parse(localStorage.getItem('jwtToken'));}
catch{jwt=localStorage.getItem('jwtToken');}
if(typeof jwt!=='string'||!jwt){console.error('[DIOR Category]', 'JWT не найден');return;}
document.getElementById(PANEL)?.remove();
const state={
  running:true,stopped:false,phase:'scan',getCount:0,putCount:0,retries:0,
  processed:0,total:0,targetsDone:0,targetsTotal:0,
  schema:null,components:null,scan:[],members:[],targetCache:new Map(),pilotPassed:false,
  report:{tool:'dior-category-sync',version:2,brandDocumentId:BRAND_ID,
    startedAt:new Date().toISOString(),finishedAt:null,phase:'scan',errors:[],
    categories:[],writes:[],summary:null}
};
window[KEY]=state;
window.tmDiorCategorySyncReport=state.report;
const el=(tag,value)=>{const node=document.createElement(tag);
  if(value!==undefined)node.textContent=value;return node;};
const panel=el('section');panel.id=PANEL;
panel.style.cssText='position:fixed;bottom:16px;right:16px;z-index:2147483600;'+
  'width:min(530px,calc(100vw - 32px));max-height:80vh;overflow:auto;'+
  'background:#202035;color:white;border:1px solid #9895c5;border-radius:10px;'+
  'padding:14px;box-shadow:0 8px 24px #0008;font:13px/1.5 system-ui';
const h=el('strong','DIOR · Category RU → KK · один механизм');
const statusEl=el('div','Начинаем read-only проверку…');
statusEl.style.cssText='white-space:pre-wrap;margin:12px 0';
const controls=el('div');controls.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
const contentBtn=el('button','Восстановить контент KK');
const pilotBtn=el('button','Пилот: 1 product.connect');
const applyBtn=el('button','Применить оставшиеся');
const stopBtn=el('button','Стоп');
const csvBtn=el('button','CSV');
const jsonBtn=el('button','JSON');
for(const btn of [contentBtn,pilotBtn,applyBtn,stopBtn,csvBtn,jsonBtn]){
  btn.type='button';btn.style.cssText='cursor:pointer;padding:7px 10px';
  controls.append(btn);
}
contentBtn.disabled=true;pilotBtn.disabled=true;applyBtn.disabled=true;
panel.append(h,statusEl,controls);document.body.append(panel);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const explain=message=>{
  const rows=state.report.categories;
  const count=x=>rows.filter(r=>r.status===x).length;
  statusEl.textContent=message+'\nCategory '+state.processed+'/'+
    (state.total||'?')+' · targets '+state.targetsDone+'/'+state.targetsTotal+
    '\nСовпадают: '+count('synced')+' · отличия: '+count('pending')+
    ' · review: '+count('review')+' · blocked: '+count('blocked')+
    '\nGET '+state.getCount+' · PUT '+state.putCount+' · GET retries '+state.retries;
};
const downloadable=(name,body,mime)=>{
  const u=URL.createObjectURL(new Blob([body],{type:mime}));
  const a=el('a');a.href=u;a.download=name;document.body.append(a);
  a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),15000);
};
const csvColumns=['documentId','name','status','fieldDifferences','missingProduct',
  'missingOtherRelations','extraRelations','missingTargetKK','reason'];
const quote=x=>{let t=Array.isArray(x)?x.join(' | '):String(x??'');
  if(/^[=+\-@\t\r]/.test(t))t="'"+t;return '"'+t.replace(/"/g,'""')+'"';};
csvBtn.onclick=()=>downloadable('dior-category-sync.csv',
  '\uFEFF'+[csvColumns.join(';'),
  ...state.report.categories.map(row=>csvColumns.map(k=>quote(row[k])).join(';'))].join('\n'),
  'text/csv;charset=utf-8');
jsonBtn.onclick=()=>downloadable('dior-category-sync.json',
  JSON.stringify(state.report,null,2),'application/json;charset=utf-8');
const checkpoint=()=>{try{return JSON.parse(localStorage.getItem(JOURNAL_KEY)||'null');}
  catch{return {reason:'checkpoint unreadable'};}};
const markUnresolved=(entry)=>localStorage.setItem(JOURNAL_KEY,JSON.stringify(entry));
stopBtn.onclick=()=>{state.stopped=true;stopBtn.disabled=true;
  explain('Стоп запрошен. Текущий запрос/проверка завершатся.');};
const assertRunning=()=>{if(state.stopped)throw Error('Остановлено пользователем');};
const reportError=(error,phase)=>{
  state.report.errors.push(String(error));state.report.phase=phase;
  console.error('[DIOR Category]',error);
};
const end=(phase,message)=>{
  state.phase=phase;state.running=false;state.report.phase=phase;
  state.report.finishedAt=new Date().toISOString();
  state.report.summary={
    total:state.total,checked:state.processed,targets:state.targetsTotal,
    statuses:Object.fromEntries(['synced','pending','review','blocked'].map(x=>
      [x,state.report.categories.filter(r=>r.status===x).length])),
    writesVerified:state.report.writes.filter(w=>w.verified===true).length,
    getRequests:state.getCount,putRequests:state.putCount,
    pilotPassed:state.pilotPassed
  };
  contentBtn.disabled=true;pilotBtn.disabled=true;applyBtn.disabled=true;stopBtn.disabled=true;
  explain(message+'\nCSV и JSON скачаны.');
  csvBtn.onclick();jsonBtn.onclick();
};
async function request(method,path,body){
  if(!['GET','PUT'].includes(method))throw Error('Недопустимый метод '+method);
  const attempts=method==='GET'?3:1;
  for(let i=0;i<attempts;i++){
    if(method==='GET')state.getCount++;else state.putCount++;
    let response;
    try{response=await fetch(path,{
      method,credentials:'include',cache:'no-store',
      headers:{Authorization:'Bearer '+jwt,Accept:'application/json',
        ...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})
    });}
    catch(e){
      if(method==='PUT'||i===attempts-1)throw Error('NETWORK '+method+' '+path+': '+String(e));
      state.retries++;await sleep((i+1)*700);continue;
    }
    const raw=await response.text();let json=null;
    try{json=raw?JSON.parse(raw):null;}
    catch{if(response.status!==404)throw Error(method+' не-JSON ответ '+path);}
    const result={ok:response.ok,status:response.status,data:json,
      message:String(json?.error?.message||raw).slice(0,200)};
    if(method==='PUT'||response.ok||response.status===404)return result;
    if(i<attempts-1&&[408,429,500,502,503,504].includes(response.status)){
      state.retries++;await sleep((i+1)*800);continue;
    }
    throw Error('GET HTTP '+response.status+' '+path+': '+result.message);
  }
}
async function get(path){
  const r=await request('GET',path);
  if(!r.ok)throw Error('GET HTTP '+r.status+' '+path+': '+r.message);
  return r.data;
}
function decode(result,documentId,locale,published=false){
  const data=result?.data?.data;
  if(result?.status===404||(result?.ok&&(data==null||
    typeof data==='object'&&!Array.isArray(data)&&!Object.keys(data).length)))return null;
  if(!result?.ok||data?.documentId!==documentId||data?.locale!==locale||
    (published&&data.publishedAt==null))
    throw Error('Неоднозначный detail '+documentId+'/'+locale+'/'+published+
      ' HTTP '+result?.status);
  return data;
}
const detailPath=(id,locale,publication,uid=UID)=>
  '/content-manager/collection-types/'+uid+'/'+id+
  '?locale='+locale+'&status='+publication;
async function categories(){
  const out=[],seen=new Set();let page=1,pages=null,total=null;
  while(true){
    assertRunning();
    const json=await get('/content-manager/relations/'+BRAND_UID+'/'+BRAND_ID+
      '/'+FIELD+'?locale=ru&page='+page+'&pageSize='+PAGE_SIZE);
    const rows=json?.results,p=json?.pagination;
    if(!Array.isArray(rows)||!Number.isInteger(p?.total)||p.total<0||
      !Number.isInteger(p?.pageCount)||p.pageCount<0||(p.total>0&&!rows.length)||
      (total!==null&&total!==p.total)||(pages!==null&&pages!==p.pageCount)||
      (p.page!=null&&p.page!==page))
      throw Error('Неполный DIOR.categories page '+page);
    total=p.total;pages=p.pageCount;
    for(const row of rows){
      if(typeof row.documentId!=='string'||seen.has(row.documentId))
        throw Error('Повтор/нет documentId в DIOR.categories');
      seen.add(row.documentId);out.push({documentId:row.documentId,name:row.name||''});
    }
    if(page>=pages||pages===0)break;
    if(page++>=100)throw Error('Слишком много страниц DIOR.categories');
  }
  if(out.length!==total)throw Error('DIOR.categories count mismatch');
  return out;
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


const relIds=entry=>Object.fromEntries(Object.entries(entry?.relations||{})
  .map(([field,r])=>[field,r.entries.map(x=>x.documentId).sort()]));
const fieldDiff=(a,b)=>Object.keys(a||{}).filter(f=>!equal(a[f],b?.[f]));
const setDiff=(x,y)=>{const yy=new Set(y||[]);return (x||[]).filter(id=>!yy.has(id));};
const counts=arr=>Object.fromEntries(arr.map(x=>[x.field,x.missing.length]));
function compareVersion(a,b,strictPublished=false){
  const issues=[];
  if(!a||!b)return ['Исчезла версия RU'];
  if(!equal(a.business,b.business))issues.push('Изменился RU контент: '+
    fieldDiff(a.business,b.business).join(', '));
  if(!equal(relIds(a),relIds(b)))issues.push('Изменились RU relations');
  if(strictPublished&&['id','publishedAt','updatedAt'].some(f=>
    !equal(a.detail[f],b.detail[f])))
    issues.push('Изменилась опубликованная RU версия/metadata');
  return issues;
}
function analyze(id,name,before){
  const ru=before.ru.draft,kk=before.kk.draft,pub=before.kk.published;
  const plan=ru?buildPayload(state.schema,ru.detail):null;
  const blockers=[];
  if(!ru||!before.ru.published)blockers.push('RU Draft/Published отсутствуют');
  if(pub)blockers.push('KK Published существует: без изменения');
  if(plan?.blockers?.length)blockers.push(...plan.blockers);
  if(ru&&plan&&!equal(ru.transferable,
    Object.fromEntries(Object.entries(plan.payload).filter(([k])=>k!=='locale'))))
    blockers.push('Payload не совпадает с RU transferable');
  const diffs=ru&&kk?fieldDiff(ru.business,kk.business):[];
  const fields=relations(state.schema);
  const deltas=[],extras=[],duplicates=[];
  for(const field of fields){
    const r=ru?.relations?.[field],k=kk?.relations?.[field];
    const rs=r?.entries.map(x=>x.documentId)||[];
    const ks=k?.entries.map(x=>x.documentId)||[];
    if(r&&new Set(rs).size!==r.total)duplicates.push('RU '+field);
    if(k&&new Set(ks).size!==k.total)duplicates.push('KK '+field);
    deltas.push({field,target:state.schema.attributes[field].target,
      missing:setDiff(rs,ks),sourceCount:rs.length,kkCount:ks.length});
    const e=setDiff(ks,rs);
    if(e.length)extras.push(field+':'+e.join(','));
  }
  if(duplicates.length)blockers.push('Повторные relation documentId: '+duplicates.join(' | '));
  if(extras.length)blockers.push('У KK есть лишние relations; disconnect запрещён');
  const missing=deltas.reduce((n,x)=>n+x.missing.length,0);
  const item={id,name:name||ru?.detail.name||'',before,plan,deltas,diffs,extras,
    blockers,missingTargets:[],targets:new Map()};
  return item;
}
function present(item){
  const missingProduct=item.deltas.find(x=>x.field==='product')?.missing.length||0;
  const missingOthers=item.deltas.filter(x=>x.field!=='product')
    .reduce((n,x)=>n+x.missing.length,0);
  const totalMissing=missingProduct+missingOthers;
  const status=item.blockers.length||item.missingTargets.length?'review':
    !item.diffs.length&&!totalMissing?'synced':'pending';
  return {documentId:item.id,name:item.name,status,
    fieldDifferences:item.diffs,missingProduct,missingOtherRelations:missingOthers,
    extraRelations:item.extras,missingTargetKK:item.missingTargets.length,
    reason:[...item.blockers,...item.missingTargets.slice(0,8)].join(' | '),
    ruRelations:item.deltas.reduce((n,x)=>n+x.sourceCount,0),
    kkRelations:item.deltas.reduce((n,x)=>n+x.kkCount,0),
    hasKK:!!item.before.kk.draft,ruPublished:!!item.before.ru.published,
    url:location.origin+'/admin/content-manager/collection-types/'+UID+'/'+item.id+
      '?plugins[i18n][locale]=ru'};
}
const keyOf=(uid,id)=>uid+'|'+id;
async function targetGet(uid,id){
  if(!state.targetCache.has(keyOf(uid,id))){
    state.targetCache.set(keyOf(uid,id),(async()=>{
      const r=await request('GET',detailPath(id,'kk','draft',uid));
      const d=decode(r,id,'kk');
      return d&&Number.isInteger(d.id)&&d.id>0?{id:d.id,documentId:id,locale:'kk'}:null;
    })());
  }
  return state.targetCache.get(keyOf(uid,id));
}
async function checkTargets(items){
  const required=new Map();
  for(const item of items)for(const d of item.deltas)for(const id of d.missing){
    required.set(keyOf(d.target,id),{uid:d.target,id});
  }
  const targets=[...required.values()];
  state.targetsTotal=targets.length;
  let cursor=0,failure=null;
  const workers=Array.from({length:Math.min(TARGET_WORKERS,targets.length)},async()=>{
    while(!failure&&!state.stopped){
      const i=cursor++;if(i>=targets.length)return;
      try{
        await targetGet(targets[i].uid,targets[i].id);
        state.targetsDone++;
        explain('Проверяем KK целевых Category/Product/Brand…');
      }catch(e){failure=e;return;}
    }
  });
  await Promise.all(workers);
  if(failure)throw failure;
  assertRunning();
  for(const item of items)for(const delta of item.deltas)for(const id of delta.missing){
    if(!(await state.targetCache.get(keyOf(delta.target,id))))
      item.missingTargets.push(delta.field+':'+id);
  }
}
const liveSchema=async()=>{
  const [types,components,brand]=await Promise.all([
    get('/content-manager/content-types'),
    get('/content-manager/components'),
    get(detailPath(BRAND_ID,'ru','draft',BRAND_UID))
  ]);
  const schema=types?.data?.find(x=>x.uid===UID);
  const brandSchema=types?.data?.find(x=>x.uid===BRAND_UID);
  if(!schema?.attributes||schema.pluginOptions?.i18n?.localized!==true||
    brandSchema?.attributes?.[FIELD]?.type!=='relation'||
    brandSchema.attributes[FIELD].target!==UID||
    brand?.data?.documentId!==BRAND_ID||brand?.data?.locale!=='ru'||
    !Array.isArray(components?.data)||!components.data.every(x=>x.uid&&x.attributes))
    throw Error('Схема/Brand DIOR недоступна');
  state.components=Object.fromEntries(components.data.map(x=>[x.uid,x]));
  return schema;
};
async function scan(){
  try{
    state.schema=await liveSchema();
    state.members=await categories();
    state.total=state.members.length;
    if(!state.total)throw Error('У DIOR нет связанных категорий');
    const scans=new Array(state.total);let cursor=0,failure=null;
    const workers=Array.from({length:Math.min(READ_WORKERS,state.total)},async()=>{
      while(!failure&&!state.stopped){
        const i=cursor++;if(i>=state.total)return;
        const item=state.members[i];
        try{
          const snap=await snapshot(item.documentId,state.schema);
          scans[i]=analyze(item.documentId,item.name,snap);
          state.processed++;state.report.categories=scans.filter(Boolean).map(present);
          explain('Читаем Category RU/KK и все root relations…');
        }catch(e){failure=Error(item.documentId+': '+String(e));return;}
      }
    });
    await Promise.all(workers);
    if(failure)throw failure;assertRunning();
    if(scans.some(x=>!x))throw Error('Не все категории обработаны');
    state.scan=scans;
    await checkTargets(scans);
    state.report.categories=scans.map(present);
    state.report.auditComplete=true;
    state.running=false;state.phase='ready';state.report.phase='ready';
    const unresolved=checkpoint();
    let candidate=null;
    for(const item of scans){
      if(item.blockers.length||!item.before.kk.draft)continue;
      const product=item.deltas.find(d=>d.field==='product');
      if(!product)continue;
      if((await Promise.all(product.missing.map(id=>
        state.targetCache.get(keyOf(product.target,id))))).some(Boolean)){
        candidate=item;break;
      }
    }
    state.pilotCandidate=candidate||null;
    contentBtn.disabled=!!unresolved||!scans.some(x=>!x.blockers.length&&
      (!x.before.kk.draft||x.diffs.length));
    pilotBtn.disabled=!candidate||!!unresolved;
    explain('GET-аудит завершён. Непустые различия требуют синхронизации.'+
      (candidate?'\nДоступен один пилот product.connect.':'\nПилот product недоступен: проверь missing targets.')+
      (unresolved?'\nЗАПИСЬ ЗАБЛОКИРОВАНА: есть unresolved checkpoint.':''));
    csvBtn.onclick();jsonBtn.onclick();
  }catch(e){
    reportError(e,'failed');end('failed','Аудит остановлен, записи не выполнялись.');
  }
}
async function oneWrite(item,{pilot=false,contentOnly=false}={}){
  const id=item.id;
  // После предыдущих writes другие KK relations могут измениться через inverse relations:
  // источник RU сравниваем строго, KK перечитываем заново.
  const before=await snapshot(id,state.schema);
  const sourceIssues=[
    ...compareVersion(item.before.ru.draft,before.ru.draft),
    ...compareVersion(item.before.ru.published,before.ru.published,true)
  ];
  if(sourceIssues.length)throw Error(id+': '+sourceIssues.join(' | '));
  const actual=analyze(id,item.name,before);
  if(actual.blockers.length)throw Error(id+': '+actual.blockers.join(' | '));
  if(pilot&&(!before.kk.draft||actual.deltas.find(x=>x.field==='product')?.missing.length===0))
    throw Error('Для пилота требуется KK Draft с отсутствующим product');
  const missing=actual.deltas.filter(d=>d.missing.length);
  if(before.kk.draft&&!actual.diffs.length&&(contentOnly||!missing.length))
    return {skipped:true,after:before};
  // Повторно сверяем все KK target IDs до write.
  const connect={};const missingTargets=[];
  for(const d of missing){
    const wanted=contentOnly?[]:pilot&&d.field==='product'?d.missing:
      pilot?[]:d.missing;
    for(const target of wanted){
      // Не доверять старому id: заново GET перед любой записью.
      state.targetCache.delete(keyOf(d.target,target));
      const entry=await targetGet(d.target,target);
      if(!entry){
        if(!pilot)missingTargets.push(d.field+':'+target);
      }else{
        (connect[d.field]||=[]).push(entry);
        if(pilot)break; // Единственная проверочная relation product.
      }
    }
  }
  if(missingTargets.length)throw Error(id+': отсутствует KK у target: '+
    missingTargets.join(' | '));
  if(!pilot&&!contentOnly&&item.missingTargets.length)
    throw Error(id+': есть missing target из Preflight');
  const plan=buildPayload(state.schema,before.ru.draft.detail);
  if(plan.blockers.length||!equal(plan.payload,item.plan?.payload))
    throw Error(id+': RU payload изменился относительно Preflight');
  // Full content payload защищает shared fields от обнуления при локальной записи.
  const payload={...plan.payload};
  for(const [field,entries] of Object.entries(connect))
    payload[field]={connect:entries,disconnect:[]};
  if(pilot&&!connect.product?.length)throw Error('Не найден продукт для pilot connect');
  const receipt={documentId:id,name:item.name,at:new Date().toISOString(),
    mode:contentOnly?'content':pilot?'pilot':'apply',relationsConnect:
      Object.fromEntries(Object.entries(connect).map(([f,entries])=>
        [f,entries.map(x=>x.documentId)])),
    contentUpdated:!!actual.diffs.length,attempted:false,verified:false};
  state.report.writes.push(receipt);
  if(checkpoint())throw Error('Остался unresolved checkpoint; write запрещён');
  markUnresolved({documentId:id,mode:receipt.mode,at:receipt.at,
    requested:receipt.relationsConnect,reason:'PUT outcome not verified'});
  receipt.attempted=true;
  explain('PUT KK '+id+' — '+(contentOnly?'только RU-контент':pilot?'одна связь product':'missing relations'));
  let response=null,writeError=null;
  try{
    response=await request('PUT','/content-manager/collection-types/'+UID+'/'+id+'?locale=kk',
      payload);
  }catch(e){writeError=String(e);}
  receipt.httpStatus=response?.status??'NETWORK';
  const after=await snapshot(id,state.schema);
  const errors=[
    ...compareVersion(before.ru.draft,after.ru.draft),
    ...compareVersion(before.ru.published,after.ru.published,true)
  ];
  if(!after.kk.draft||after.kk.published)
    errors.push('KK Draft отсутствует либо KK неожиданно Published');
  if(after.kk.draft){
    if(!equal(after.kk.draft.business,before.ru.draft.business))
      errors.push('Контент KK отличается от RU после PUT');
    if(!equal(after.kk.draft.transferable,before.ru.draft.transferable))
      errors.push('KK transferable отличается от RU');
    for(const d of actual.deltas){
      const pre=before.kk.draft?.relations[d.field]?.entries.map(x=>x.documentId)||[];
      const expected=[...new Set([...pre,...(connect[d.field]||[]).map(x=>x.documentId)])].sort();
      const real=after.kk.draft.relations[d.field];
      const ids=real.entries.map(x=>x.documentId).sort();
      if(!equal(expected,ids)||real.total!==ids.length)
        errors.push('KK '+d.field+': relation mismatch expected '+expected.length+
          ' actual '+real.total);
    }
  }
  if(!response?.ok)errors.push('Неоднозначный PUT: '+
    (writeError||('HTTP '+response?.status+' '+response?.message)));
  receipt.verified=errors.length===0;receipt.errors=errors;
  receipt.kkId=after.kk.draft?.detail.id??null;
  if(errors.length)throw Error(id+': '+errors.join(' | '));
  item.before=after;item.plan=plan;
  localStorage.removeItem(JOURNAL_KEY);
  return {skipped:false,after};
}
async function syncContent(){
  if(state.running||checkpoint())return;
  const candidates=state.scan.filter(item=>!item.blockers.length&&
    (!item.before.kk.draft||item.diffs.length));
  if(!candidates.length)return;
  if(!confirm('Скопировать RU Draft в '+candidates.length+
    ' KK Draft (создать отсутствующие и дополнить отличающиеся)?'+
    '\nБез relations, без Publish. Один PUT за раз с проверкой RU/KK.'))return;
  state.running=true;state.stopped=false;contentBtn.disabled=true;stopBtn.disabled=false;
  try{
    const schema=await liveSchema(),members=await categories();
    if(!equal(schema.attributes,state.schema.attributes)||
      !equal(members.map(x=>x.documentId).sort(),
        state.members.map(x=>x.documentId).sort()))
      throw Error('Схема/состав DIOR изменились до восстановления контента');
    for(let i=0;i<candidates.length;i++){
      assertRunning();
      const item=candidates[i];
      explain('Контент RU → KK '+(i+1)+'/'+candidates.length+': '+item.name);
      await oneWrite(item,{contentOnly:true});
      const revised=analyze(item.id,item.name,item.before);
      Object.assign(item,{deltas:revised.deltas,diffs:revised.diffs,
        blockers:revised.blockers,extras:revised.extras,
        missingTargets:revised.missingTargets});
      state.report.categories=state.scan.map(present);
      await sleep(200);
    }
    state.running=false;stopBtn.disabled=false;
    state.pilotCandidate=null;
    for(const item of state.scan){
      if(item.blockers.length||!item.before.kk.draft)continue;
      const product=item.deltas.find(d=>d.field==='product');
      if(product&&(await Promise.all(product.missing.map(id=>
        state.targetCache.get(keyOf(product.target,id))))).some(Boolean)){
        state.pilotCandidate=item;break;
      }
    }
    pilotBtn.disabled=!state.pilotCandidate;
    explain('Контент KK проверен. Для relations сначала выполнить pilot product.');
    csvBtn.onclick();jsonBtn.onclick();
  }catch(e){
    reportError(e,'review');
    end('review','STOP после ошибки синхронизации контента.');
  }
}
async function pilot(){
  if(state.running||!state.pilotCandidate||checkpoint())return;
  if(!confirm('Пилот одного Category.product.connect в KK Draft. '+
    'Контракт такого Save ещё не подтверждён на живой CMS.\n'+
    'Один PUT, затем полная проверка обеих RU-версий, KK и relations.\n'+
    'Никакого Publish/автоповтора. Продолжить?'))return;
  state.running=true;state.stopped=false;stopBtn.disabled=false;pilotBtn.disabled=true;
  try{
    const item=state.pilotCandidate;
    await oneWrite(item,{pilot:true});
    state.pilotPassed=true;
    const updated=analyze(item.id,item.name,item.before);
    Object.assign(item,{deltas:updated.deltas,diffs:updated.diffs,blockers:updated.blockers,
      extras:updated.extras,missingTargets:updated.missingTargets});
    state.report.categories=state.scan.map(present);
    state.running=false;
    applyBtn.disabled=false;
    explain('Пилот успешен, сохранность RU и точность KK подтверждены.'+
      '\nТеперь можно отдельно подтвердить оставшиеся изменения.');
    csvBtn.onclick();jsonBtn.onclick();
  }catch(e){reportError(e,'review');
    end('review','Пилот остановлен. Повторно PUT не отправлять.');
  }
}
async function apply(){
  if(state.running||!state.pilotPassed||checkpoint())return;
  if(!confirm('Синхронизировать оставшиеся доступные Category RU → KK?'+
    '\nТолько один PUT за раз, additive connect; ни одной публикации.'+
    '\nПри ошибке STOP, с отчётом и checkpoint.'))return;
  state.running=true;state.stopped=false;applyBtn.disabled=true;stopBtn.disabled=false;
  try{
    // Проверка состава brand relation и схемы до write.
    const schema=await liveSchema(),members=await categories();
    if(!equal(schema.attributes,state.schema.attributes)||
       !equal(members.map(x=>x.documentId).sort(),
         state.members.map(x=>x.documentId).sort()))
      throw Error('Схема или состав DIOR.categories изменились');
    for(let i=0;i<state.scan.length;i++){
      assertRunning();
      const item=state.scan[i];
      explain('Применение '+(i+1)+'/'+state.scan.length+': '+item.name);
      if(item.blockers.length||item.missingTargets.length){
        // Не изменяем записи с несовместимым состоянием или без KK у targets.
        continue;
      }
      await oneWrite(item);
      const revised=analyze(item.id,item.name,item.before);
      Object.assign(item,{deltas:revised.deltas,diffs:revised.diffs,blockers:revised.blockers,
        extras:revised.extras,missingTargets:revised.missingTargets});
      state.report.categories=state.scan.map(present);
      await sleep(200);
    }
    end('completed','Работа завершена; недоступные targets помечены review.');
  }catch(e){reportError(e,'review');
    end('review','STOP. Данные в отчёте, неоднозначный PUT не повторять.');
  }
}
contentBtn.onclick=syncContent;pilotBtn.onclick=pilot;applyBtn.onclick=apply;
await scan();
})();
