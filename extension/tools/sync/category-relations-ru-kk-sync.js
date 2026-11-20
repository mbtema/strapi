(async () => {
'use strict';
// Одна открытая Category: RU Draft → KK Draft для parent/categories/product; Publish RU + KK.
// Production by default: no dry-run or apply flags; skip already-current records.
const TAG='[Category Relations RU→KK]';
const UID='api::category.category', BRAND_UID='api::brand.brand';
const PAGE=100, DB='tm-category-relations-one-v1';
const RUNKEY='__tmCategoryRelationSyncRunning';
const mode='production';
const here=new URL(location.href);
const route='/admin/content-manager/collection-types/'+UID+'/';
const categoryId=here.pathname.startsWith(route)?decodeURIComponent(here.pathname.slice(route.length)):'';
if(!categoryId || categoryId.includes('/')) {
  console.error(TAG,'Открой конкретную запись Category в Strapi Admin');return;
}
if(window[RUNKEY]){console.warn(TAG,'Уже выполняется');return;}
window[RUNKEY]=true;
delete window.tmCategoryRelationSyncStop;
const report={version:1,mode,startedAt:new Date().toISOString(),finishedAt:null,
  status:'running',scope:{collection:UID,sourceLocale:'ru',targetLocale:'kk',categoryCount:null,listPages:0},
  counters:{GET:0,PUT:0,POST:0,retries:0,verifiedWrites:0,restoredWrites:0},
  stages:{seed:{processed:0,created:0,updated:0,unchanged:0,blocked:0},
    relations:{processed:0,linked:0,unchanged:0,blocked:0},
    publish:{processed:0,ru:0,kk:0,skipped:0,blocked:0}},
  results:{},issues:[],errors:[],warnings:[],restorations:[],pendingDiagnostic:null,complete:false};
window.tmCategoryRelationSyncReport=report;
const SYSTEM=new Set(['id','documentId','locale','status','createdAt','updatedAt',
  'publishedAt','createdBy','updatedBy','localizations','__pivot']);
const OMIT=new Set(['key','code','slug']);
// Новый KK Draft нельзя создавать, когда nonlocalized code существует в RU:
// live Strapi 2026-11-18 обнулил RU Draft.code при KK PUT без code в payload.
const SHARED_SEED_GUARD=['code'];
const WRITABLE=['parent','product'];
const INVERSE=['categories','products','top_brands'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const canonicalJSON=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?
  Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const equal=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
const fail=m=>{throw Error(m);};
const ensure=(ok,m)=>{if(!ok)fail(m);};
const token=()=>{
  let jwt=localStorage.getItem('jwtToken');
  try{jwt=JSON.parse(jwt);}catch{}
  ensure(typeof jwt==='string'&&jwt.trim(),'Нет jwtToken Admin');
  return jwt.trim().replace(/^Bearer\s+/i,'');
};
const guard=()=>{if(window.tmCategoryRelationSyncStop===true)fail('Остановлено по window.tmCategoryRelationSyncStop=true');};
let db=null,schemas=new Map(),components=new Map(),schema=null;
const targets=new Map(),skipDocs=new Set(),linkedDocs=new Set();
let ids=[];
const positions=new Map();
async function request(method,path,payload,allow404=false){
  ensure(['GET','PUT','POST'].includes(method),'Запрещённый HTTP метод');
  const tries=method==='GET'?3:1;
  for(let t=1;t<=tries;t++){
    report.counters[method]++;
    let res,body;
    try{
      res=await fetch(path,{method,credentials:'include',cache:'no-store',
        headers:{Authorization:'Bearer '+token(),Accept:'application/json',
          ...(payload===undefined?{}:{'Content-Type':'application/json'})},
        ...(payload===undefined?{}:{body:JSON.stringify(payload)})});
      body=await res.text();
    }catch(e){
      if(method!=='GET'||t===tries)throw Error(method+' network '+path+': '+e.message);
      report.counters.retries++;await sleep(450*t);continue;
    }
    if(res.status===404&&allow404)return null;
    let data=null;try{data=body?JSON.parse(body):null;}
    catch{throw Error(method+' non-JSON '+path);}
    if(res.ok)return data;
    if(method==='GET'&&t<tries&&[408,429,500,502,503,504].includes(res.status)){
      report.counters.retries++;await sleep(600*t);continue;
    }
    throw Error(method+' HTTP '+res.status+' '+path+': '+(data?.error?.message||body.slice(0,180)));
  }
}
const get=(p,allow404=false)=>request('GET',p,undefined,allow404);
const url=(uid,id,locale,status)=>'/content-manager/collection-types/'+uid+'/'+encodeURIComponent(id)+
  '?locale='+locale+'&status='+status;
const attrList=sch=>Object.entries(sch.attributes||{}).filter(([f])=>!SYSTEM.has(f));
const rootRelations=sch=>attrList(sch).filter(([,a])=>a.type==='relation');
async function pages(path,firstQS,pageSize=PAGE){
  const out=[],seen=new Set();let total=null,pageCount=null;
  for(let page=1;page<=10000;page++){
    const qs=new URLSearchParams({...firstQS,page:String(page),pageSize:String(pageSize)});
    const data=await get(path+'?'+qs);
    ensure(Array.isArray(data?.results),'Неверный формат relations '+path);
    const p=data.pagination;
    ensure(Number.isSafeInteger(p?.total)&&p.total>=0&&
      Number.isSafeInteger(p.pageCount)&&p.pageCount>=0,'Нет точной пагинации');
    if(total===null){total=p.total;pageCount=p.pageCount;}
    ensure(total===p.total&&pageCount===p.pageCount,'Пагинация изменилась');
    for(const x of data.results){
      ensure(x?.documentId&&Number.isSafeInteger(x.id)&&x.id>0,
        'Неверный target ID '+path);
      ensure(!seen.has(x.documentId),'Дубликат relation '+x.documentId);
      seen.add(x.documentId);out.push({documentId:x.documentId,id:x.id,
        locale:x.locale||firstQS.locale});
    }
    if(page>=pageCount)break;
    ensure(data.results.length>0,'Пустая промежуточная страница '+path);
  }
  ensure(out.length===total,'Пропуск relations '+path+' '+out.length+'/'+total);
  return out.sort((a,b)=>a.documentId.localeCompare(b.documentId));
}
async function detail(uid,id,locale,status){
  const data=await get(url(uid,id,locale,status),true);
  const row=data?.data;
  if(!row||typeof row==='object'&&!Array.isArray(row)&&!Object.keys(row).length)return null;
  ensure(row.documentId===id&&row.locale===locale,
    'Не та локаль/documentId '+id+' '+locale+'/'+status);
  if(status==='published'&&!row.publishedAt)return null;
  return row;
}
function media(value,path,multiple){
  if(value==null)return null;
  const one=x=>{
    const n=Number.isSafeInteger(x)?x:x?.id;
    ensure(Number.isSafeInteger(n)&&n>0,'Неизвестный media id '+path);return n;
  };
  if(multiple){ensure(Array.isArray(value),'Media array '+path);return value.map(one);}
  return one(value);
}
function fieldVal(def,raw,path){
  if(raw===undefined)fail('Нет schema field '+path);
  if(raw==null)return null;
  if(def.type==='media')return media(raw,path,def.multiple);
  if(def.type==='relation'){
    const count=raw?.count??(Array.isArray(raw)?raw.length:raw?.documentId?1:0);
    if(count!==0)fail('Nested relation не проверена: '+path+'='+count);
    return {connect:[],disconnect:[]};
  }
  if(def.type==='component'){
    const one=(v,p)=>componentVal(def.component,v,p);
    if(def.repeatable){
      ensure(Array.isArray(raw),'Expected component list '+path);
      return raw.map((v,i)=>one(v,path+'['+i+']'));
    }
    return one(raw,path);
  }
  if(def.type==='dynamiczone'){
    ensure(Array.isArray(raw),'Expected Dynamic Zone '+path);
    return raw.map((v,i)=>{
      ensure(def.components?.includes(v?.__component),'Unknown component '+path);
      return {__component:v.__component,...componentVal(v.__component,v,path+'['+i+']')};
    });
  }
  if(['string','text','richtext','email','enumeration','json','blocks','integer',
    'biginteger','float','decimal','boolean','date','time','datetime','uid','password'].includes(def.type))
    return raw;
  fail('Неподдерживаемое поле '+path+' :'+def.type);
}
function componentVal(uid,raw,path){
  if(raw==null)return null;
  ensure(raw&&typeof raw==='object'&&!Array.isArray(raw),'Bad component '+path);
  const sch=components.get(uid);
  ensure(sch?.attributes,'Missing component schema '+uid);
  const out={};
  for(const [f,a]of attrList(sch))out[f]=fieldVal(a,raw[f],path+'.'+f);
  return out;
}
function fieldsFrom(row){
  const fields={};
  for(const [f,a]of attrList(schema)){
    if(a.type==='relation')continue;
    fields[f]=fieldVal(a,row[f],f);
  }
  return fields;
}
async function readVersion(id,locale,status){
  const row=await detail(UID,id,locale,status);
  if(!row)return null;
  const fields=fieldsFrom(row),relations={};
  for(const [f,a]of rootRelations(schema)){
    const count=row[f]?.count;
    if(status==='draft')ensure(Number.isSafeInteger(count)&&count>=0,
      'Нет точного count '+f+' '+id+'/'+locale);
    if(count===0){relations[f]=[];continue;}
    const list=await pages('/content-manager/relations/'+UID+'/'+encodeURIComponent(id)+'/'+f,
      {locale,status});
    if(status==='draft')ensure(count===list.length,
      'Draft links count mismatch '+id+'/'+locale+'/'+f);
    relations[f]=list;
  }
  return {meta:{id:row.id,documentId:row.documentId,locale,status:row.status,
    publishedAt:row.publishedAt||null,updatedAt:row.updatedAt||null},
    fields,relations,row};
}
async function snapshot(id){
  const result={ru:{draft:null,published:null},kk:{draft:null,published:null}};
  for(const locale of ['ru','kk'])for(const status of ['draft','published'])
    result[locale][status]=await readVersion(id,locale,status);
  return result;
}
const idsOf=rows=>(rows||[]).map(x=>x.documentId).sort();
const semantic=v=>v?{fields:v.fields,
  relations:Object.fromEntries(Object.entries(v.relations).map(([f,rs])=>[f,idsOf(rs)]))}:null;
const compact=s=>Object.fromEntries(['ru','kk'].map(l=>[l,Object.fromEntries(
  ['draft','published'].map(st=>[st,semantic(s[l][st])]))]));
const stableStatus=s=>Object.fromEntries(['ru','kk'].map(l=>[l,Object.fromEntries(
  ['draft','published'].map(st=>[st,{id:s[l][st]?.meta?.id||null,
    publishedAt:s[l][st]?.meta?.publishedAt||null,status:s[l][st]?.meta?.status||null}]))]));
function assertRU(before,after){
  for(const st of ['draft','published'])
    ensure(equal(semantic(before.ru[st]),semantic(after.ru[st])),
      'RU '+st+' изменился! key/fields/relations');
}
function assertOtherKKPublished(before,after){
  ensure(equal(semantic(before.kk.published),semantic(after.kk.published)),
    'KK Published изменился при PUT');
}
function ensureSafeRoot(before){
  const ru=before.ru.draft, kk=before.kk.draft;
  ensure(!!ru,'Нет RU Draft');
  if(!kk)return;
  for(const f of ['parent','categories','product']){
    const source=new Set(idsOf(ru.relations[f]));
    for(const id of idsOf(kk.relations[f]))
      ensure(source.has(id),'Лишняя KK связь '+f+':'+id+'; disconnect запрещён');
  }
}
function localized(def){return def?.pluginOptions?.i18n?.localized===true;}
function mergeField(def,ru,kk,hasKK,path){
  if(!hasKK)return ru;
  if(path==='filters_app')return ru;
  if(def.type==='media')return kk!=null?kk:ru;
  if(def.type==='component'){
    const one=(a,b,p)=>mergeComponent(def.component,a,b,b!=null,p);
    if(ru==null)return kk??null;
    if(def.repeatable){
      ensure(Array.isArray(ru)&&Array.isArray(kk),'Component list diff '+path);
      ensure(ru.length===kk.length,'Component length diff '+path);
      return ru.map((v,i)=>one(v,kk[i],path+'['+i+']'));
    }
    return one(ru,kk,path);
  }
  if(def.type==='dynamiczone'){
    if(ru==null)return kk??null;
    ensure(Array.isArray(ru)&&Array.isArray(kk)&&ru.length===kk.length,
      'Dynamic zone structural diff '+path);
    return ru.map((v,i)=>{
      const k=kk[i];
      ensure(v?.__component===k?.__component,'DZ component mismatch '+path);
      if(v.key&&k.key)ensure(v.key===k.key,'DZ semantic key mismatch '+path);
      return {__component:v.__component,...mergeComponent(v.__component,v,k,true,path+'['+i+']')};
    });
  }
  if(path==='name'||path==='description'||localized(def)&&path!=='title')
    return kk??ru;
  return ru;
}
function mergeComponent(uid,ru,kk,hasKK,path){
  ensure(ru,'Missing RU component '+path);
  const sch=components.get(uid);
  ensure(sch?.attributes,'Missing component '+uid);
  if(hasKK&&ru.key&&kk?.key)ensure(ru.key===kk.key,'Component key mismatch '+path);
  const out={};
  for(const [f,a]of attrList(sch))
    out[f]=mergeField(a,ru[f],kk?.[f],hasKK,path+'.'+f);
  return out;
}
function expectedKK(snap){
  const ru=snap.ru.draft,kk=snap.kk.draft;
  ensure(ru,'Нет RU Draft');
  const out={},updates={};
  for(const [f,a]of attrList(schema)){
    if(a.type==='relation'||OMIT.has(f))continue;
    const value=mergeField(a,ru.fields[f],kk?.fields[f],!!kk,f);
    if(a.required&&(value==null||value===''||Array.isArray(value)&&!value.length))
      fail('Обязательное поле пустое '+f);
    out[f]=value;
    if(!kk||!equal(value,kk.fields[f]))updates[f]=value;
  }
  return {fields:out,updates};
}
function assertDraftValues(snap,expected){
  const kk=snap.kk.draft;
  ensure(kk,'Нет KK Draft после PUT');
  for(const [f,val]of Object.entries(expected))
    ensure(equal(kk.fields[f],val),'KK Draft потерял field/media/component '+f);
}
function compareDraftGraph(snap){
  const ru=snap.ru.draft,kk=snap.kk.draft;
  if(!ru||!kk)return {ok:false,missing:['locale']};
  const missing=[],extra=[];
  for(const f of [...WRITABLE,...INVERSE]){
    const source=new Set(idsOf(ru.relations[f]));
    const target=new Set(idsOf(kk.relations[f]));
    for(const x of source)if(!target.has(x))missing.push({field:f,documentId:x});
    for(const x of target)if(!source.has(x))extra.push({field:f,documentId:x});
  }
  return {ok:!missing.length&&!extra.length,missing,extra};
}
function publishedCheck(ver){
  const draft=ver.draft,pub=ver.published;
  if(!draft||!pub?.meta.publishedAt)
    return {ok:false,missingPublished:true,fieldDiffs:['missing-published'],
      invisible:{},unexpected:{}};
  const fieldDiffs=Object.keys(draft.fields).filter(f=>!equal(draft.fields[f],pub.fields[f]));
  const invisible={},unexpected={};
  for(const f of Object.keys(draft.relations)){
    const want=new Set(idsOf(draft.relations[f]));
    const have=new Set(idsOf(pub.relations[f]));
    const gone=[...want].filter(x=>!have.has(x));
    const extra=[...have].filter(x=>!want.has(x));
    if(gone.length)invisible[f]={count:gone.length,documentIds:gone};
    if(extra.length)unexpected[f]=extra;
  }
  const draftModified=draft.meta.status==='modified';
  return {ok:!draftModified&&!fieldDiffs.length&&!Object.keys(unexpected).length,
    missingPublished:false,draftModified,fieldDiffs,invisible,unexpected,
    publishedAt:pub.meta.publishedAt};
}
async function targetKK(uid,id){
  const k=uid+'/'+id;
  if(targets.has(k))return targets.get(k);
  const row=await detail(uid,id,'kk','draft');
  const result=row&&Number.isSafeInteger(row.id)&&row.id>0
    ?{id:row.id,documentId:id,locale:'kk'}:null;
  targets.set(k,result);
  return result;
}
async function checkUnique(id,ru){
  const v=ru.fields.bitrix_id;
  if(v==null)return;
  async function rows(locale){
    const q=new URLSearchParams({locale,status:'draft',page:'1',pageSize:'100'});
    q.set('filters[bitrix_id][$eq]',String(v));
    const response=await get('/content-manager/collection-types/'+UID+'?'+q);
    const body=response?.results??response?.data?.results;
    const p=response?.pagination??response?.data?.pagination;
    ensure(Array.isArray(body)&&Number.isSafeInteger(p?.total)&&p.total<=100,
      'Неполный unique поиск bitrix_id');
    return body.map(x=>x?.attributes&&!x.documentId?x.attributes:x).map(x=>x?.documentId);
  }
  const [rs,ks]=await Promise.all([rows('ru'),rows('kk')]);
  ensure(rs.includes(id),'Unique bitrix_id positive-control не пройден: '+id);
  ensure([...rs,...ks].every(x=>x===id),'Дубликат bitrix_id у других Category');
}
async function dbOpen(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB,1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains('items'))
        db.createObjectStore('items',{keyPath:'key'});
    };
    req.onerror=()=>reject(req.error||Error('IndexedDB недоступен'));
    req.onblocked=()=>reject(Error('IndexedDB заблокирован'));
    req.onsuccess=()=>resolve(req.result);
  });
}
async function dbGet(key){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('items','readonly');
    const req=tx.objectStore('items').get(key);
    req.onsuccess=()=>resolve(req.result?.value||null);
    req.onerror=()=>reject(req.error);
  });
}
async function dbPut(key,value){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('items','readwrite');
    tx.objectStore('items').put({key,value});
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error||Error('IndexedDB write failed'));
    tx.onabort=()=>reject(tx.error||Error('IndexedDB aborted'));
  });
}
async function dbFinish(pending,after){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('items','readwrite'),o=tx.objectStore('items');
    o.put({key:'done/'+pending.stage+'/'+pending.documentId+
      (pending.locale?'/'+pending.locale:''),value:{
        at:new Date().toISOString(),stage:pending.stage,documentId:pending.documentId,
        locale:pending.locale||null,before:pending.before,
        after:compact(after),status:stableStatus(after),
        restoration:pending.restoration||null}});
    o.delete('pending');
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error||Error('IndexedDB verify journal failed'));
    tx.onabort=()=>reject(tx.error||Error('IndexedDB journal aborted'));
  });
}
function resultFor(id){
  return report.results[id]??={seed:null,relations:null,publish:null,notes:[]};
}
function update(stage,id,msg){
  console.log(TAG,'['+stage+']',positions.get(id)+'/'+ids.length,id,msg,
    'GET='+report.counters.GET,'PUT='+report.counters.PUT,'POST='+report.counters.POST);
}
async function checkpoint(stage,id,before,expected,locale){
  const pending={stage,documentId:id,locale:locale||null,
    at:new Date().toISOString(),before:compact(before),
    previousStatus:stableStatus(before),expected};
  await dbPut('pending',pending);
  return pending;
}
function verifyContent(before,after,expected){
  assertRU(before,after);assertOtherKKPublished(before,after);
  assertDraftValues(after,expected.fields);
  ensureSafeRoot(after);
  const prior=before.kk.draft;
  if(prior){
    for(const f of Object.keys(prior.relations))
      ensure(equal(idsOf(prior.relations[f]),idsOf(after.kk.draft.relations[f])),
        'KK root links изменились при переносе полей: '+f);
    for(const f of OMIT)
      ensure(equal(prior.fields[f],after.kk.draft.fields[f]),
        'Изменился исключённый key/code/slug: '+f);
  }else{
    ensure(after.kk.draft.fields.key===before.ru.draft.fields.key,
      'Создание KK изменило key');
    for(const f of INVERSE)
      ensure(!idsOf(after.kk.draft.relations[f]).length,
        'Системно добавлен обратный link '+f);
  }
}
function verifyLinks(before,after,expected){
  assertRU(before,after);assertOtherKKPublished(before,after);
  ensure(equal(after.kk.draft.fields,before.kk.draft.fields),
    'KK fields/media/key изменились при переносе связей');
  for(const [f,old]of Object.entries(before.kk.draft.relations)){
    const exp=f in expected?expected[f]:idsOf(old);
    ensure(equal(idsOf(after.kk.draft.relations[f]),exp),
      'KK relation '+f+' не совпал после PUT');
  }
}
function verifyCompact(pending,a,after=null){
  const b=pending.before;
  const stage=pending.stage;
  if(stage==='content'){
    for(const st of ['draft','published'])
      ensure(equal(b.ru[st],a.ru[st]),'RU drift при content');
    ensure(equal(b.kk.published,a.kk.published),'KK Published drift при content');
    for(const [f,val]of Object.entries(pending.expected.fields))
      ensure(equal(a.kk.draft?.fields?.[f],val),'KK content mismatch '+f);
    if(b.kk.draft){
      for(const f of Object.keys(b.kk.draft.relations))
        ensure(equal(a.kk.draft?.relations?.[f],b.kk.draft.relations[f]),
          'Relation drift при content '+f);
      for(const f of OMIT)
        ensure(equal(a.kk.draft?.fields?.[f],b.kk.draft.fields[f]),
          'Excluded field drift '+f);
    }else{
      for(const f of OMIT){
        const def=schema.attributes[f];
        // UID/localized slug у нового KK может быть null: не входит в PUT.
        if(f==='slug'||def?.type==='uid'||
            def?.pluginOptions?.i18n?.localized===true)
          continue;
        ensure(equal(a.kk.draft?.fields?.[f],b.ru.draft.fields[f]),
          'Создание KK изменило/не перенесло shared '+f);
      }
      for(const [f,ids]of Object.entries(a.kk.draft?.relations||{}))
        ensure(ids.every(id=>(b.ru.draft?.relations?.[f]||[]).includes(id)),
          'Новая KK получила постороннюю relation '+f);
    }
  }else if(stage==='links'){
    ensure(equal(b.ru,a.ru),'RU drift при links');
    ensure(equal(b.kk.published,a.kk.published),'KK Published drift при links');
    ensure(equal(b.kk.draft.fields,a.kk.draft?.fields),'KK field drift при links');
    for(const [f,ids]of Object.entries(pending.expected.relations))
      ensure(equal(a.kk.draft.relations[f],ids),'KK root '+f+' mismatch');
  }else if(stage==='publish'){
    ensure(equal(b.ru.draft,a.ru.draft)&&equal(b.kk.draft,a.kk.draft),
      'Draft drift при Publish');
    ensure(publishedCheck(after[pending.locale]).ok,'Published postflight invalid');
    ensure(after[pending.locale]?.published?.meta?.publishedAt &&
      after[pending.locale].published.meta.publishedAt!==
        pending.previousStatus[pending.locale].published.publishedAt,
      'Нет новой версии Published после POST');
    const other=pending.locale==='ru'?'kk':'ru';
    ensure(equal(b[other].published?.fields??null,a[other].published?.fields??null),
      'Другой Published поля изменились');
  }else fail('Unknown pending '+stage);
}
// The saved IndexedDB before-snapshot is the only baseline for self-repair.
// Never perform a broad rollback: repair only strictly missing RU Draft values
// when a virtual restoration of those values would fully verify the original write.
function recoveryPlan(pending,after){
  if(!['content','links'].includes(pending.stage))return null;
  const b=pending.before,a=compact(after);
  if(!b.ru.draft||!a.ru.draft||!equal(b.ru.published,a.ru.published)||
     !equal(b.ru.draft.relations,a.ru.draft.relations)||
     !equal(b.kk.published,a.kk.published))return null;
  const eligible=new Set(['string','text','richtext','email','enumeration',
    'json','blocks','integer','biginteger','float','decimal','boolean',
    'date','time','datetime','uid','media']);
  const lost={};
  const missing=v=>v==null||v===''||Array.isArray(v)&&v.length===0;
  for(const [field,prior]of Object.entries(b.ru.draft.fields)){
    const current=a.ru.draft.fields[field];
    if(equal(prior,current))continue;
    const type=schema?.attributes?.[field]?.type;
    if(!eligible.has(type)||missing(prior)||!missing(current))
      return null; // changed to another nonempty value: possible concurrent edit
    lost[field]=prior;
  }
  if(!Object.keys(lost).length)return null;
  const simulated=JSON.parse(JSON.stringify(a));
  for(const [field,value]of Object.entries(lost)){
    simulated.ru.draft.fields[field]=value;
    const definition=schema.attributes[field];
    if(definition.pluginOptions?.i18n?.localized!==true&&
       simulated.kk.draft&&missing(simulated.kk.draft.fields[field])){
      const oldKK=b.kk.draft?.fields?.[field];
      // Only shared values that previously matched RU may be predicted
      // to recover cross-locale. Never overwrite a KK-specific value.
      if(b.kk.draft&&!equal(oldKK,value))return null;
      simulated.kk.draft.fields[field]=value;
    }
  }
  // This must prove ALL saved constraints, including key, media and links.
  try{verifyCompact(pending,simulated);}catch{return null;}
  return {values:lost,fields:Object.keys(lost)};
}
function verifyWrite(pending,before,after){
  return verifyCompact(pending,compact(after),after);
}
async function restoreLostDraftFields(pending,after,originalError){
  if(pending.restoration)return null; // crash-safe: never repeat recovery PUT
  const plan=recoveryPlan(pending,after);
  if(!plan)return null;
  const id=pending.documentId;
  // Persist the recovery intent BEFORE its sole real CMS write.
  // If execution stops, next launch GET-verifies without retrying a PUT.
  pending.restoration={
    status:'attempted',at:new Date().toISOString(),
    cause:originalError.message,fields:plan.fields,
    previous:compact(after),values:plan.values
  };
  await dbPut('pending',pending);
  let error=null;
  try{
    await request('PUT',
      '/content-manager/collection-types/'+UID+'/'+encodeURIComponent(id)+'?locale=ru',
      {locale:'ru',...plan.values});
  }catch(e){error=e;}
  // Never trust write HTTP alone; re-read all four versions and all links.
  const restored=await snapshot(id);
  try{verifyWrite(pending,null,restored);}
  catch(e){
    throw Error('Восстановление RU Draft не подтверждено: '+e.message+
      (error?'; PUT: '+error.message:''));
  }
  const record={id,stage:pending.stage,fields:plan.fields,
    originalValues:plan.values,status:'verified',
    at:new Date().toISOString()};
  report.restorations.push(record);
  resultFor(id).notes.push('Автоматически восстановлено: '+plan.fields.join(', '));
  report.counters.restoredWrites++;
  console.warn(TAG,'Восстановлены поля RU Draft',id,plan.fields);
  if(error)report.warnings.push('Recovery PUT вернул ошибку, но полная GET сверка подтвердила восстановление '+
    id+': '+error.message);
  return restored;
}
async function perform(stage,id,before,expected,method,path,payload,locale){
  guard();
  let pending;
  try{pending=await checkpoint(stage,id,before,expected,locale);}
  catch(e){
    report.errors.push('Не удалось сохранить prewrite journal '+id+': '+e.message);
    throw e;
  }
  let after=null,writeError=null;
  try{await request(method,path,payload);}catch(e){writeError=e;}
  try{after=await snapshot(id);}catch(e){
    report.errors.push('Postflight GET '+id+'/'+stage+': '+e.message);
  }
  if(after){
    try{verifyWrite(pending,before,after);}
    catch(e){
      let recoveryError=null;
      try{
        const restored=await restoreLostDraftFields(pending,after,e);
        if(restored)after=restored;
        else report.errors.push('Integrity '+id+'/'+stage+': '+e.message+
          ' (небезопасно восстанавливать автоматически)');
      }catch(re){
        recoveryError=re;
        report.errors.push('Recovery '+id+'/'+stage+': '+re.message);
      }
      if(recoveryError)
        console.error(TAG,'Автовосстановление не подтверждено',id,recoveryError);
    }
  }
  if(writeError){
    if(after&&!report.errors.length)
      report.warnings.push('HTTP/Network error, но GET postflight подтвердил write '+
        id+'/'+stage+': '+writeError.message);
    else report.errors.push('Write '+id+'/'+stage+': '+writeError.message);
  }
  if(report.errors.length)fail('ГЛОБАЛЬНАЯ ОСТАНОВКА: неопределённый write '+id+'/'+stage+
    '. Pending сохранён в IndexedDB; повторять запись нельзя');
  try{await dbFinish(pending,after);}
  catch(e){
    report.errors.push('Невозможно завершить IndexedDB journal '+id+'/'+stage+': '+e.message);
    throw e;
  }
  report.counters.verifiedWrites++;
  await sleep(180);
  if(report.counters.verifiedWrites%20===0)await sleep(1500);
  return after;
}
// Read-only diagnostics for any unresolved pending write, not just one Category.
function pendingDiff(pending,after){
  const before=pending.before,current=compact(after);
  const differences={};
  for(const locale of ['ru','kk']){
    differences[locale]={};
    for(const version of ['draft','published']){
      const b=before[locale][version],a=current[locale][version];
      if(equal(b,a))continue;
      const info={beforeExists:!!b,currentExists:!!a};
      if(b&&a){
        const names=new Set([...Object.keys(b.fields),...Object.keys(a.fields)]);
        const fields={};
        for(const field of names){
          if(!equal(b.fields[field],a.fields[field]))
            fields[field]={before:b.fields[field],current:a.fields[field]};
        }
        const relationNames=new Set([
          ...Object.keys(b.relations),...Object.keys(a.relations)]);
        const relations={};
        for(const field of relationNames){
          const prev=new Set(b.relations[field]||[]);
          const next=new Set(a.relations[field]||[]);
          const added=[...next].filter(x=>!prev.has(x));
          const removed=[...prev].filter(x=>!next.has(x));
          if(added.length||removed.length)
            relations[field]={added,removed};
        }
        if(Object.keys(fields).length)info.fields=fields;
        if(Object.keys(relations).length)info.relations=relations;
      }else if(a&&!b){
        info.currentFields=a.fields;
        info.currentRelationCounts=Object.fromEntries(
          Object.entries(a.relations).map(([field,ids])=>[field,ids.length]));
      }else if(b&&!a){
        info.previousFields=b.fields;
        info.previousRelationCounts=Object.fromEntries(
          Object.entries(b.relations).map(([field,ids])=>[field,ids.length]));
      }
      differences[locale][version]=info;
    }
  }
  return {documentId:pending.documentId,stage:pending.stage,
    capturedAt:new Date().toISOString(),
    differences,status:stableStatus(after),
    restorationAlreadyAttempted:!!pending.restoration};
}
// A content pending may have been followed by an independent, valid KK Publish.
// Accept the already-complete state only if the original KK content write
// verifies in full AND KK Published is an exact mirror of current KK Draft.
function verifiedLaterPublished(pending,after){
  if(pending.stage!=='content'||pending.before.kk.published!==null||
     !after.kk.draft||!after.kk.published)return false;
  const current=compact(after);
  if(!equal(current.kk.draft,current.kk.published))return false;
  const withoutLaterPublication=JSON.parse(JSON.stringify(current));
  withoutLaterPublication.kk.published=null;
  try{verifyCompact(pending,withoutLaterPublication);}
  catch{return false;}
  return true;
}
async function recoverPending(){
  const pending=await dbGet('pending');
  if(!pending)return;
  console.warn(TAG,'Восстановление после прерванного write:',
    pending.stage,pending.documentId);
  let after=await snapshot(pending.documentId);
  try{verifyWrite(pending,null,after);}
  catch(e){
    // Reconcile a separately published, already fully verified KK version.
    // This does not repeat any earlier PUT/POST and never changes CMS data.
    if(verifiedLaterPublished(pending,after)){
      report.warnings.push('Позднее опубликованная KK совпадает с текущим KK Draft; '+
        'pending контента подтверждён без новых записей '+pending.documentId);
    }else{
      const diagnostic=pendingDiff(pending,after);
      report.pendingDiagnostic=diagnostic;
      console.warn(TAG,'Pending differences',diagnostic);
      // Exact same safeguards as the normal postwrite path. If repair was
      // attempted before a crash, no second recovery PUT is allowed.
      const restored=await restoreLostDraftFields(pending,after,e);
      if(!restored)throw Error('Pending не подтверждён; запись нельзя повторять: '+
        e.message+'. Журнал сохранён. Подробности: report.pendingDiagnostic');
      after=restored;
    }
  }
  await dbFinish(pending,after);
  if(pending.restoration&&!report.restorations.some(x=>
    x.id===pending.documentId&&x.stage===pending.stage)){
    report.restorations.push({id:pending.documentId,stage:pending.stage,
      fields:pending.restoration.fields,status:'verified-after-restart',
      at:new Date().toISOString()});
  }
  report.warnings.push('Восстановлена после GET ранее подтверждённая запись '+
    pending.documentId+'/'+pending.stage);
}
async function loadIndex(){
  const seen=new Set();
  let first=null,previousId=0;
  const path='/content-manager/collection-types/'+UID;
  for(let page=1;page<=10000;page++){
    guard();
    const qs=new URLSearchParams({
      locale:'ru',status:'draft',page:String(page),
      pageSize:String(PAGE),sort:'id:ASC'
    });
    const data=await get(path+'?'+qs);
    const meta=data?.pagination,rows=data?.results;
    ensure(Array.isArray(rows)&&Number.isSafeInteger(meta?.total)&&meta.total>=0&&
      Number.isSafeInteger(meta.pageCount)&&meta.pageCount>=0&&
      (meta.page==null||Number(meta.page)===page)&&
      (meta.total===0||rows.length>0),'Неверный ответ RU Category list page='+page);
    if(!first)first={total:meta.total,pageCount:meta.pageCount};
    ensure(meta.total===first.total&&meta.pageCount===first.pageCount,
      'Список категорий изменился в ходе загрузки (pagination drift)');
    for(const raw of rows){
      const row=raw?.attributes&&!raw.documentId?{...raw.attributes,id:raw.id}:raw;
      ensure(row?.locale==='ru'&&typeof row.documentId==='string'&&
        row.documentId.length>0&&!seen.has(row.documentId),
        'Неверная локаль/дубль RU Category в списке');
      ensure(Number.isSafeInteger(row.id)&&row.id>previousId,
        'Нарушен порядок id:ASC или изменилась пагинация');
      previousId=row.id;
      seen.add(row.documentId);
      positions.set(row.documentId,ids.length+1);
      ids.push(row.documentId);
    }
    report.scope.listPages=page;
    report.scope.categoryCount=first.total;
    console.log(TAG,'[index]','Страница',page+'/'+first.pageCount,
      'категорий:',ids.length+'/'+first.total);
    if(page>=first.pageCount)break;
    if(page===10000)fail('Превышен предел страниц Category list');
  }
  ensure(first&&first.total>0,'RU Category list пустой — запись запрещена');
  ensure(ids.length===first.total,'Неполная загрузка RU Category: '+
    ids.length+'/'+first.total);
  report.scope.documentIds=ids;
}
async function checkSchema(){
  const [types,parts]=await Promise.all([get('/content-manager/content-types'),
    get('/content-manager/components')]);
  ensure(Array.isArray(types?.data)&&Array.isArray(parts?.data),'Нет CMS schemas');
  schemas=new Map(types.data.map(x=>[x.uid,x]));
  components=new Map(parts.data.map(x=>[x.uid,x]));
  schema=schemas.get(UID);
  ensure(schema?.attributes,'Нет schema Category');
  const want={parent:'api::category.category',brand:BRAND_UID,product:'api::product.product'};
  for(const [f,uid]of Object.entries(want))
    ensure(schema.attributes[f]?.type==='relation'&&schema.attributes[f].target===uid,
      'Изменился source relation contract '+f);
  ensure(schema.attributes.categories?.mappedBy==='parent'&&
    schema.attributes.product?.mappedBy==='categories',
    'Изменился inverse relation contract');
}
async function seedPhase(){
  for(const id of ids){
    guard();const st=report.stages.seed;st.processed++;
    try{
      let before=await snapshot(id);ensureSafeRoot(before);
      const ru=before.ru.draft,kk=before.kk.draft;
      const wanted=expectedKK(before);
      if(!kk){
        const risky=SHARED_SEED_GUARD.filter(field=>{
          const def=schema.attributes[field];
          return def&&def.pluginOptions?.i18n?.localized!==true&&
            ru.fields[field]!==null&&ru.fields[field]!==undefined&&
            ru.fields[field]!=='';
        });
        ensure(!risky.length,
          'Создание KK запрещено: Strapi обнуляет общий RU Draft '+
          risky.join(', ')+'. Нужна проверенная схема синхронизации');
        await checkUnique(id,ru);
      }
      if(!Object.keys(wanted.updates).length){
        st.unchanged++;resultFor(id).seed='unchanged';update('seed',id,'Уже заполнено');continue;
      }
      const payload={locale:'kk',...wanted.updates};
      before=await perform('content',id,before,{fields:wanted.fields},'PUT',
        '/content-manager/collection-types/'+UID+'/'+id+'?locale=kk',payload);
      st[kk?'updated':'created']++;resultFor(id).seed=kk?'updated':'created';
      update('seed',id,resultFor(id).seed);
    }catch(e){
      if(report.errors.length)throw e;
      st.blocked++;skipDocs.add(id);resultFor(id).seed='blocked: '+e.message;
      report.issues.push({id,stage:'seed',reason:e.message});
      update('seed',id,'Пропущено: '+e.message);
    }
  }
}
async function linksPhase(){
  const CHUNK=20;
  for(const id of ids){
    guard();const st=report.stages.relations;st.processed++;
    if(skipDocs.has(id)){st.blocked++;continue;}
    try{
      let before=await snapshot(id);ensureSafeRoot(before);
      if(!before.kk.draft)fail('Нет KK Draft после seed');
      const ru=before.ru.draft,kk=before.kk.draft;
      const pending=[],operations=[];
      // Только forward-owner root relations. Inverse восстанавливается через
      // parent (categories) и Product.categories (product), без Product PUT.
      for(const field of WRITABLE){
        const source=ru.relations[field];
        const have=new Set(idsOf(kk.relations[field]));
        const missing=idsOf(source).filter(x=>!have.has(x));
        const ready=[];
        for(const documentId of missing){
          const target=await targetKK(schema.attributes[field].target,documentId);
          if(target)ready.push(target);
          else pending.push({field,documentId,reason:'Нет KK Draft у target'});
        }
        for(let i=0;i<ready.length;i+=CHUNK)
          operations.push({field,targets:ready.slice(i,i+CHUNK)});
      }
      if(pending.length){
        st.blocked++;skipDocs.add(id);resultFor(id).relations='pending-targets';
        report.issues.push({id,stage:'relations',pending});
        update('links',id,'Ожидаются '+pending.length+' KK Draft target');
        continue;
      }
      if(!operations.length){
        st.unchanged++;resultFor(id).relations='unchanged';continue;
      }
      let linked=0;
      for(const operation of operations){
        guard();
        before=await snapshot(id);ensureSafeRoot(before);
        const field=operation.field;
        const old=idsOf(before.kk.draft.relations[field]);
        const fresh=operation.targets.filter(x=>!old.includes(x.documentId));
        if(!fresh.length)continue;
        const payload={locale:'kk',
          [field]:{connect:fresh,disconnect:[]}};
        const wanted=Object.fromEntries(
          Object.entries(before.kk.draft.relations).map(([f,rs])=>[f,idsOf(rs)]));
        wanted[field]=[...old,...fresh.map(x=>x.documentId)].sort();
        await perform('links',id,before,{relations:wanted},'PUT',
          '/content-manager/collection-types/'+UID+'/'+id+'?locale=kk',payload);
        linked+=fresh.length;
        update('links',id,'Подключено '+linked+'; поле '+field);
      }
      st.linked+=linked;linkedDocs.add(id);
      resultFor(id).relations='linked '+linked;
    }catch(e){
      if(report.errors.length)throw e;
      st.blocked++;skipDocs.add(id);resultFor(id).relations='blocked: '+e.message;
      report.issues.push({id,stage:'relations',reason:e.message});
      update('links',id,'Пропущено: '+e.message);
    }
  }
}
async function finalGraphCheck(id,snap){
  ensure(snap.ru.draft&&snap.kk.draft,'Не найдены RU/KK Draft');
  for(const f of ['parent','categories','product']){
    ensure(equal(idsOf(snap.ru.draft.relations[f]),idsOf(snap.kk.draft.relations[f])),
      'KK Draft '+f+' не совпадает с RU');
  }
}
function publishPayload(draft,locale){
  const out={locale};
  for(const [f,a]of attrList(schema)){
    if(a.type==='relation'){out[f]={connect:[],disconnect:[]};continue;}
    out[f]=draft.fields[f];
  }
  return out;
}
async function publishPhase(){
  for(const id of ids){
    guard();const st=report.stages.publish;st.processed++;
    if(skipDocs.has(id)){st.blocked++;continue;}
    try{
      let snap=await snapshot(id);
      await finalGraphCheck(id,snap);
      for(const locale of ['ru','kk']){
        const ck=publishedCheck(snap[locale]);
        const done=await dbGet('done/publish/'+id+'/'+locale);
        const unchangedSinceDone=done&&
          equal(done.after?.[locale]?.draft,semantic(snap[locale].draft))&&ck.ok;
        // Уже Published + те же поля/Media/key = не нужен лишний POST.
        // Единственное исключение: в этой сессии добавлены KK Draft links,
        // тогда обновляем KK Published даже при неполной видимости targets.
        const alreadyPublished=ck.ok&&!linkedDocs.has(id);
        if(!linkedDocs.has(id)&&(unchangedSinceDone||alreadyPublished)){
          st.skipped++;continue;
        }
        const payload=publishPayload(snap[locale].draft,locale);
        snap=await perform('publish',id,snap,{locale},'POST',
          '/content-manager/collection-types/'+UID+'/'+id+
          '/actions/publish?locale='+locale,payload,locale);
        st[locale]++;update('publish',id,'Опубликована '+locale);
      }
      const r=publishedCheck(snap.ru),k=publishedCheck(snap.kk);
      ensure(r.ok&&k.ok,'Postflight Published нет/не совпадают после RU+KK');
      resultFor(id).publish={status:'verified',
        visibility:{ru:r.invisible,kk:k.invisible}};
    }catch(e){
      if(report.errors.length)throw e;
      st.blocked++;skipDocs.add(id);
      resultFor(id).publish='blocked: '+e.message;
      report.issues.push({id,stage:'publish',reason:e.message});
      update('publish',id,'Пропущено: '+e.message);
    }
  }
}
async function inverseCategoriesPhase(id){
  let parent=await snapshot(id);
  const source=idsOf(parent.ru.draft.relations.categories);
  const actual=new Set(idsOf(parent.kk.draft.relations.categories));
  const missing=source.filter(x=>!actual.has(x));
  for(let i=0;i<missing.length;i++){
    guard();
    const childId=missing[i];
    const beforeChild=await snapshot(childId);
    ensure(beforeChild.ru.draft&&beforeChild.kk.draft,
      'Нет RU/KK Draft дочерней Category '+childId);
    ensure(idsOf(beforeChild.ru.draft.relations.parent).includes(id),
      'Источник child.parent не указывает на текущую Category: '+childId);
    const old=idsOf(beforeChild.kk.draft.relations.parent);
    ensure(old.length===0,'В KK дочерняя Category уже имеет parent: '+childId);
    ensure(Number.isSafeInteger(parent.kk.draft.meta.id)&&parent.kk.draft.meta.id>0,
      'Нет numeric id текущей Category KK');
    const target={id:parent.kk.draft.meta.id,documentId:id,locale:'kk'};
    const wanted=Object.fromEntries(
      Object.entries(beforeChild.kk.draft.relations).map(([f,rows])=>[f,idsOf(rows)]));
    wanted.parent=[id];
    const parentBefore=parent;
    await perform('links',childId,beforeChild,{relations:wanted},'PUT',
      '/content-manager/collection-types/'+UID+'/'+encodeURIComponent(childId)+'?locale=kk',
      {locale:'kk',parent:{connect:[target],disconnect:[]}});
    parent=await snapshot(id);
    assertRU(parentBefore,parent);
    ensure(equal(parentBefore.kk.draft.fields,parent.kk.draft.fields),
      'KK Category fields drift при child.parent');
    ensure(equal(semantic(parentBefore.kk.published),semantic(parent.kk.published)),
      'KK Category Published drift при child.parent');
    for(const [f,rows]of Object.entries(parentBefore.kk.draft.relations)){
      const expected=idsOf(rows);
      if(f==='categories')expected.push(childId);
      ensure(equal([...new Set(expected)].sort(),idsOf(parent.kk.draft.relations[f])),
        'Обратная KK categories не восстановилась после child.parent: '+childId+'/'+f);
    }
    linkedDocs.add(id);
    report.stages.relations.linked++;
    update('categories',id,(i+1)+'/'+missing.length+' child.parent linked');
  }
}
try{
  await checkSchema();
  ids=[categoryId];
  positions.set(categoryId,1);
  report.scope.categoryCount=1;
  report.scope.listPages=0;
  db=await dbOpen();
  await recoverPending();
  const before=await snapshot(categoryId);
  ensure(before.ru.draft&&before.kk.draft,
    'У записи должны существовать обе локали RU и KK Draft; KK не создаётся');
  ensureSafeRoot(before);
  const plan={};
  const missing={};
  let changes=0;
  for(const f of ['parent','categories','product']){
    const ru=idsOf(before.ru.draft.relations[f]);
    const kk=idsOf(before.kk.draft.relations[f]);
    const extra=kk.filter(x=>!ru.includes(x));
    ensure(!extra.length,'Лишние KK связи '+f+': '+extra.join(', '));
    missing[f]=ru.filter(x=>!kk.includes(x));
    plan[f]={ru:ru.length,kk:kk.length,add:missing[f].length,extra:0,
      missingDocumentIds:missing[f]};
    changes+=missing[f].length;
  }
  report.plan=plan;
  console.table(Object.entries(plan).map(([field,v])=>({
    field,ru:v.ru,kk:v.kk,toAdd:v.add,extra:v.extra
  })));
  // Preflight: каждый целевой KK Draft существует; не посылаем частичный write.
  for(const f of ['parent','product']){
    const uid=f==='parent'?UID:'api::product.product';
    for(const targetId of missing[f])
      ensure(await targetKK(uid,targetId),'Нет KK Draft target '+f+'/'+targetId);
  }
  for(const childId of missing.categories){
    const child=await snapshot(childId);
    ensure(child.ru.draft&&child.kk.draft,'Нет KK child Draft '+childId);
    ensure(idsOf(child.ru.draft.relations.parent).includes(categoryId),
      'RU child.parent конфликтует: '+childId);
    ensure(!idsOf(child.kk.draft.relations.parent).length,
      'KK child.parent занят другим родителем: '+childId);
  }
  const stales=['ru','kk'].filter(l=>!publishedCheck(before[l]).ok);
  if(!changes&&!stales.length){
    report.status='completed';
    report.complete=true;
    report.summary={note:'Уже синхронизировано и опубликовано; 0 writes'};
  }else if(!confirm('Синхронизировать Category '+categoryId+
    '\nRU → KK: parent +'+missing.parent.length+', categories +'+
    missing.categories.length+', product +'+missing.product.length+
    '\nДочерние categories обновляются через KK child.parent (без Publish детей).'+
    '\nДалее Publish текущей RU и KK. Лишние связи не удаляются. Продолжить?')){
    report.status='cancelled';
    report.summary={note:'Отмена после read-only preflight; 0 writes'};
  }else{
    report.status='running';
    console.log(TAG,'Начата синхронизация',categoryId,plan);
    // Прямая запись только parent/product, обратная categories через child.parent.
    await linksPhase();
    ensure(!skipDocs.has(categoryId),'Связи не удалось применить, Publish отменён');
    await inverseCategoriesPhase(categoryId);
    const fresh=await snapshot(categoryId);
    await finalGraphCheck(categoryId,fresh);
    await publishPhase();
    ensure(!skipDocs.has(categoryId),'Publish не подтверждён');
    const verified=await snapshot(categoryId);
    await finalGraphCheck(categoryId,verified);
    ensure(publishedCheck(verified.ru).ok&&publishedCheck(verified.kk).ok,
      'Нет подтверждённого Published RU/KK');
    report.complete=true;
    report.status='completed';
    report.summary={scope:1,linksAdded:report.stages.relations.linked,
      publishedRU:report.stages.publish.ru,publishedKK:report.stages.publish.kk,
      note:'В KK Draft все 3 relation совпадают с RU Draft. Published может скрывать draft-only targets'};
  }
}catch(e){
  report.status='stopped';
  report.errors.push(e.message);
  console.error(TAG,'ОСТАНОВЛЕНО:',e);
}finally{
  report.finishedAt=new Date().toISOString();
  if(db)db.close();
  window[RUNKEY]=false;
  console.log(TAG,'Итог',report.status,report.counters,report.stages,
    'Errors:',report.errors.length);
  if(report.issues.length)console.warn(TAG,'Issues:',report.issues);
  if(report.warnings.length)console.warn(TAG,'Warnings:',report.warnings);
  if(report.errors.length)console.error(TAG,'Errors:',report.errors);
  console.log(TAG,'Подробности доступны в window.tmCategoryRelationSyncReport');
}
})();