(async function chanelNormalizerProduction() {
'use strict';
// One CHANEL-only RU→KK pipeline: seed → root relations → RU/KK Publish.
// No recursive writes, no Product Publish, no disconnect, default GET-only.
const TAG='[CHANEL Normalizer]', BRAND='yeag7mng9hfpk7pd4ggm7495';
const UID='api::category.category', BRAND_UID='api::brand.brand';
const EXPECTED=65, PAGE=100, DB='tm-chanel-normalizer-production-v1';
const RUNKEY='__tmChanelNormalizerRunning';
const APPLY=window.tmChanelProductionOnce==='RUN_ALL';
const RISK=window.tmChanelNoDbBackupRiskAcceptedOnce===true;
delete window.tmChanelProductionOnce;
delete window.tmChanelNoDbBackupRiskAcceptedOnce;
const mode=APPLY?'production':'dry-run';
const here=new URL(location.href);
if(here.pathname!=='/admin/content-manager/collection-types/'+BRAND_UID+'/'+BRAND ||
   here.searchParams.get('plugins[i18n][locale]')!=='ru') {
  console.error(TAG,'Откройте RU-страницу CHANEL в Strapi Admin');return;
}
if(window[RUNKEY]){console.warn(TAG,'Уже выполняется');return;}
window[RUNKEY]=true;
delete window.tmChanelStop;
const report={version:1,mode,startedAt:new Date().toISOString(),finishedAt:null,
  status:'running',scope:{brandDocumentId:BRAND,categoryCount:EXPECTED},
  counters:{GET:0,PUT:0,POST:0,retries:0,verifiedWrites:0,plannedWrites:0},
  stages:{seed:{processed:0,created:0,updated:0,unchanged:0,blocked:0,
      plannedCreates:0,plannedUpdates:0},
    relations:{processed:0,linked:0,plannedLinks:0,unchanged:0,blocked:0},
    publish:{processed:0,ru:0,kk:0,plannedRU:0,plannedKK:0,
      skipped:0,blocked:0}},
  results:{},issues:[],errors:[],warnings:[],complete:false};
window.tmChanelNormalizerReport=report;
const SYSTEM=new Set(['id','documentId','locale','status','createdAt','updatedAt',
  'publishedAt','createdBy','updatedBy','localizations','__pivot']);
const OMIT=new Set(['key','code','slug']);
const WRITABLE=['parent','brand','product'];
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
const guard=()=>{if(window.tmChanelStop===true)fail('Остановлено по window.tmChanelStop=true');};
let db=null,schemas=new Map(),components=new Map(),schema=null;
const targets=new Map(),skipDocs=new Set(),linkedDocs=new Set();
let ids=[];
async function request(method,path,payload,allow404=false){
  ensure(['GET','PUT','POST'].includes(method),'Запрещённый HTTP метод');
  if(method!=='GET'&&!APPLY)fail('Dry-run запрещает '+method);
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
  ensure(before.ru.draft,'Нет RU Draft');
  ensure(typeof before.ru.draft.fields.key==='string'&&before.ru.draft.fields.key.length>0,
    'Пустой RU key, документ пропущен без записи');
  ensure(equal(idsOf(before.ru.draft.relations.brand),[BRAND]),
    'RU Category не принадлежит строго CHANEL');
  for(const f of INVERSE){
    ensure(idsOf(before.ru.draft.relations[f]).length===0||f==='categories',
      'Неподдерживаемая inverse relation '+f+' с links');
  }
  const kk=before.kk.draft;
  if(kk){
    for(const f of [...WRITABLE,...INVERSE]){
      const source=new Set(idsOf(before.ru.draft.relations[f]));
      for(const target of idsOf(kk.relations[f]))
        ensure(source.has(target),'Посторонний KK Draft link '+f+':'+target);
    }
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
        after:compact(after),status:stableStatus(after)}});
    o.delete('pending');
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error||Error('IndexedDB verify journal failed'));
    tx.onabort=()=>reject(tx.error||Error('IndexedDB journal aborted'));
  });
}
function download(name,data){
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});
  const link=document.createElement('a'),u=URL.createObjectURL(blob);
  link.href=u;link.download=name;document.body.appendChild(link);
  try{link.click();}finally{
    link.remove();setTimeout(()=>URL.revokeObjectURL(u),20000);
  }
}
function downloadCSV(){
  const issues=new Map();
  for(const item of report.issues){
    const list=issues.get(item.id)||[];
    list.push(item.stage+': '+(item.reason||item.pending?.length+' missing targets'||'review'));
    issues.set(item.id,list);
  }
  const quote=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
  const records=[['documentId','seed','relations','publish','issues'],
    ...ids.map(id=>[id,report.results[id]?.seed,report.results[id]?.relations,
      report.results[id]?.publish&&typeof report.results[id].publish==='object'?
        report.results[id].publish.status:report.results[id]?.publish,
      (issues.get(id)||[]).join('; ')])];
  const value='\uFEFF'+records.map(x=>x.map(quote).join(',')).join('\r\n');
  const u=URL.createObjectURL(new Blob([value],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=u;
  a.download='chanel-normalization-'+mode+'-results.csv';
  document.body.appendChild(a);
  try{a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(u),20000);}
}
function resultFor(id){
  return report.results[id]??={seed:null,relations:null,publish:null,notes:[]};
}
function update(stage,id,msg){
  console.log(TAG,'['+stage+']',ids.indexOf(id)+1+'/'+ids.length,id,msg,
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
function verifyWrite(pending,before,after){
  const b=pending.before,a=compact(after);
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
      for(const f of OMIT)
        ensure(equal(a.kk.draft?.fields?.[f],b.ru.draft.fields[f]),
          'Создание KK изменило/не перенесло shared '+f);
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
    catch(e){report.errors.push('Integrity '+id+'/'+stage+': '+e.message);}
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
async function recoverPending(){
  const pending=await dbGet('pending');
  if(!pending)return;
  console.warn(TAG,'Восстановление после прерванного write:',pending.stage,pending.documentId);
  const after=await snapshot(pending.documentId);
  verifyWrite(pending,null,after);
  await dbFinish(pending,after);
  report.warnings.push('Восстановлена после GET ранее подтверждённая запись '+
    pending.documentId+'/'+pending.stage);
}
async function loadIndex(){
  const brand=await detail(BRAND_UID,BRAND,'ru','draft');
  ensure(brand,'RU CHANEL Brand не найден');
  const rows=await pages('/content-manager/relations/'+BRAND_UID+'/'+BRAND+'/categories',
    {locale:'ru',status:'draft'});
  ensure(rows.length===EXPECTED,'CHANEL categories изменились: '+rows.length+' вместо 65');
  ids=rows.map(x=>x.documentId);
  ensure(new Set(ids).size===EXPECTED,'Дубли CHANEL Category');
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
      if(!kk)await checkUnique(id,ru);
      if(!Object.keys(wanted.updates).length){
        st.unchanged++;resultFor(id).seed='unchanged';update('seed',id,'Уже заполнено');continue;
      }
      if(!APPLY){
        st[kk?'plannedUpdates':'plannedCreates']++;
        report.counters.plannedWrites++;
        resultFor(id).seed='planned '+(kk?'update':'create')+
          ' '+Object.keys(wanted.updates).join(', ');
        update('seed',id,'План полей '+Object.keys(wanted.updates).length);
        continue;
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
      if(!before.kk.draft){
        if(APPLY)fail('Нет KK Draft после seed');
        resultFor(id).relations='planned-after-seed';
        st.unchanged++;continue;
      }
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
      if(!APPLY){
        report.counters.plannedWrites+=operations.length;
        const planned=operations.reduce((n,x)=>n+x.targets.length,0);
        st.plannedLinks+=planned;
        resultFor(id).relations='planned '+planned+' links';
        update('links',id,'План: '+operations.length+' PUT по ≤20 links');
        continue;
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
  const graph=compareDraftGraph(snap);
  ensure(graph.ok,'KK Draft links не совпадают с RU: '+JSON.stringify({
    missing:graph.missing.slice(0,6),extra:graph.extra.slice(0,6),
    missingCount:graph.missing.length,extraCount:graph.extra.length}));
  const wanted=expectedKK(snap).fields;
  assertDraftValues(snap,wanted);
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
      const plannedLocales=[];
      for(const locale of ['ru','kk']){
        const ck=publishedCheck(snap[locale]);
        const done=APPLY?await dbGet('done/publish/'+id+'/'+locale):null;
        const unchangedSinceDone=done&&
          equal(done.after?.[locale]?.draft,semantic(snap[locale].draft))&&ck.ok;
        // Уже Published + те же поля/Media/key = не нужен лишний POST.
        // Единственное исключение: в этой сессии добавлены KK Draft links,
        // тогда обновляем KK Published даже при неполной видимости targets.
        const alreadyPublished=ck.ok&&(locale==='ru'||!linkedDocs.has(id));
        if(unchangedSinceDone||alreadyPublished){
          st.skipped++;continue;
        }
        if(!APPLY){
          st[locale==='ru'?'plannedRU':'plannedKK']++;
          report.counters.plannedWrites++;
          plannedLocales.push(locale);
          update('publish',id,'План '+locale);continue;
        }
        const payload=publishPayload(snap[locale].draft,locale);
        snap=await perform('publish',id,snap,{locale},'POST',
          '/content-manager/collection-types/'+UID+'/'+id+
          '/actions/publish?locale='+locale,payload,locale);
        st[locale]++;update('publish',id,'Опубликована '+locale);
      }
      if(APPLY){
        const r=publishedCheck(snap.ru),k=publishedCheck(snap.kk);
        ensure(r.ok&&k.ok,'Postflight Published нет/не совпадают после RU+KK');
        resultFor(id).publish={status:'verified',
          visibility:{ru:r.invisible,kk:k.invisible}};
      }else{
        const ru=publishedCheck(snap.ru),kk=publishedCheck(snap.kk);
        resultFor(id).publish={
          status:plannedLocales.length?'planned':'verified',
          plannedLocales,
          visibility:{ru:ru.invisible,kk:kk.invisible},
          diagnostics:{
            ru:{ok:ru.ok,draftModified:!!ru.draftModified,
              missingPublished:ru.missingPublished,fieldDiffs:ru.fieldDiffs,
              unexpected:ru.unexpected},
            kk:{ok:kk.ok,draftModified:!!kk.draftModified,
              missingPublished:kk.missingPublished,fieldDiffs:kk.fieldDiffs,
              unexpected:kk.unexpected}
          }
        };
      }
    }catch(e){
      if(report.errors.length)throw e;
      st.blocked++;skipDocs.add(id);
      resultFor(id).publish='blocked: '+e.message;
      report.issues.push({id,stage:'publish',reason:e.message});
      update('publish',id,'Пропущено: '+e.message);
    }
  }
}
try{
  if(APPLY&&!RISK)fail('Массовая запись без DB backup запрещена без явного флага принятия риска');
  await checkSchema();await loadIndex();
  if(APPLY){db=await dbOpen();await recoverPending();}
  report.summary={scope:ids.length,
    note:'KK Media и переводы защищены; Product не публикуется'};
  console.log(TAG,mode,'Старт',ids.length,'категорий. Для остановки window.tmChanelStop=true');
  await seedPhase();
  if(APPLY){
    targets.clear();
    await linksPhase();
    await publishPhase();
  }else{
    // При уже нормализованном контенте безопасно провести полный GET-аудит
    // root relations и RU/KK Published, ничего не записывая.
    const contentReady=!report.stages.seed.plannedCreates &&
      !report.stages.seed.plannedUpdates;
    if(contentReady){
      await linksPhase();
      await publishPhase();
      report.summary.fullReadOnlyAudit=true;
      report.summary.note+='; relations и Published проверены только GET';
    }else{
      report.summary.preflightOnly=true;
      report.summary.fullReadOnlyAudit=false;
      report.summary.note+='; есть план изменений KK content: '+
        'связи и публикация проверяются после применения content';
    }
  }
  report.complete=report.issues.length===0;
  report.summary={...report.summary,created:report.stages.seed.created,
    updated:report.stages.seed.updated,linksAdded:report.stages.relations.linked,
    publishedRU:report.stages.publish.ru,publishedKK:report.stages.publish.kk,
    incompleteDocuments:skipDocs.size,verifiedWrites:report.counters.verifiedWrites};
  report.status=!APPLY?(report.issues.length?'dry-run-with-issues':'dry-run-ready'):
    report.issues.length?'completed-with-issues':'completed';
}catch(e){
  report.status='stopped';
  report.errors.push(e.message);
  console.error(TAG,'ОСТАНОВЛЕНО:',e);
}finally{
  report.finishedAt=new Date().toISOString();
  try{
    download('chanel-normalization-'+mode+'-'+new Date().toISOString().slice(0,10)+'.json',report);
  }catch(e){console.warn(TAG,'JSON download error',e);}
  try{downloadCSV();}
  catch(e){console.warn(TAG,'CSV download error',e);}
  if(db)db.close();
  window[RUNKEY]=false;
  console.log(TAG,'Итог',report.status,report.counters,report.stages,
    'Issues:',report.issues.length,'Errors:',report.errors.length);
}
})();