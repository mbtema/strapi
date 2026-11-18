(async function productNormalizerProduction() {
'use strict';
// All RU Content Manager Products → KK: reconcile fields → links → KK Publish.
// Production by default: no dry-run or apply flags; skip already-current records.
const TAG='[Product Normalizer]';
const UID='api::product.product';
const PAGE=100, DB='tm-product-normalizer-production-v1';
const RUNKEY='__tmProductNormalizerRunning';
const mode='production';
const here=new URL(location.href);
if(here.pathname!=='/admin/content-manager/collection-types/'+UID ||
   here.searchParams.get('plugins[i18n][locale]')!=='ru') {
  console.error(TAG,'Откройте общий список RU Product в Strapi Admin');return;
}
if(window[RUNKEY]){console.warn(TAG,'Уже выполняется');return;}
window[RUNKEY]=true;
delete window.tmProductNormalizerStop;
const report={version:1,mode,startedAt:new Date().toISOString(),finishedAt:null,
  status:'running',scope:{collection:UID,sourceLocale:'ru',targetLocale:'kk',productCount:null,listPages:0},
  counters:{GET:0,PUT:0,POST:0,retries:0,verifiedWrites:0},
  stages:{seed:{processed:0,created:0,updated:0,unchanged:0,blocked:0},
    relations:{processed:0,linked:0,unchanged:0,blocked:0},
    publish:{processed:0,kk:0,skipped:0,blocked:0}},
  results:{},issues:[],errors:[],warnings:[],complete:false};
window.tmProductNormalizerReport=report;
const SYSTEM=new Set(['id','documentId','locale','status','createdAt','updatedAt',
  'publishedAt','createdBy','updatedBy','localizations','__pivot']);
const OMIT=new Set(['key','InStock','inStock']);
let WRITABLE=[],INVERSE=[];
const LEGACY_HALT_IDS=new Set(['fajndt11d4br9jmuy32n9xq9']);
const MAX_POPULATE_FIELDS=19;
const MAX_GET_PARALLEL=8;
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
const guard=()=>{if(window.tmProductNormalizerStop===true)fail('Остановлено по window.tmProductNormalizerStop=true');};
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
let activeGets=0;
const getWaiters=[];
async function limitedGet(fn){
  if(activeGets>=MAX_GET_PARALLEL)await new Promise(resolve=>getWaiters.push(resolve));
  activeGets++;
  try{return await fn();}
  finally{
    activeGets--;
    if(getWaiters.length)getWaiters.shift()();
  }
}
const get=(p,allow404=false)=>limitedGet(()=>request('GET',p,undefined,allow404));
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
function populated(value,count,locale){
  if(!Number.isSafeInteger(count)||count<0)return null;
  const candidates=Array.isArray(value)?value:
    value==null&&count===0?[]:
    value&&typeof value==='object'&&value.documentId?[value]:null;
  if(!candidates||candidates.length!==count)return null;
  const rows=candidates.map(x=>({id:x.id,documentId:x.documentId,locale:x.locale||locale}));
  if(rows.some(x=>!Number.isSafeInteger(x.id)||x.id<1||
      typeof x.documentId!=='string'||!x.documentId||x.locale!==locale)||
      new Set(rows.map(x=>x.documentId)).size!==rows.length)return null;
  return rows.sort((a,b)=>a.documentId.localeCompare(b.documentId));
}
async function detailWithPopulate(id,locale,status,query){
  const result=await get('/content-manager/collection-types/'+UID+'/'+
    encodeURIComponent(id)+'?'+query);
  const row=result?.data;
  if(!row||row.documentId!==id||row.locale!==locale||
    status==='published'&&!row.publishedAt)
    throw Error('Не подтвержден populate '+id+'/'+locale+'/'+status);
  return row;
}
async function readVersion(id,locale,status){
  const row=await detail(UID,id,locale,status);
  if(!row)return null;
  const fields=fieldsFrom(row),relations={};
  const relationDefs=rootRelations(schema),pending=[];
  for(const [f] of relationDefs){
    const count=row[f]?.count;
    if(Number.isSafeInteger(count)&&count===0)relations[f]=[];
    else pending.push(f);
  }
  for(let offset=0;offset<pending.length;offset+=MAX_POPULATE_FIELDS){
    const group=pending.slice(offset,offset+MAX_POPULATE_FIELDS);
    const query=new URLSearchParams({locale,status});
    for(const f of group)query.set('populate['+f+'][fields][0]','documentId');
    let expanded=null;
    try{expanded=await detailWithPopulate(id,locale,status,query);}
    catch(error){
      if(error.fatal)throw error;
      console.warn(TAG,'Populate fallback:',id,locale,status,error.message);
    }
    const fallback=[];
    for(const f of group){
      const checked=populated(expanded?.[f],row[f]?.count,locale);
      if(checked)relations[f]=checked;
      else fallback.push(f);
    }
    const entries=await Promise.all(fallback.map(async f=>[f,
      await pages('/content-manager/relations/'+UID+'/'+encodeURIComponent(id)+'/'+
        encodeURIComponent(f),{locale,status})]));
    for(const [f,rows]of entries)relations[f]=rows;
  }
  if(Object.keys(relations).length!==relationDefs.length)
    throw Error('Не все root relations получены '+id+'/'+locale+'/'+status);
  for(const [f] of relationDefs){
    const count=row[f]?.count;
    if(Number.isSafeInteger(count)&&count!==relations[f].length)
      throw Error('Не совпал count '+id+'/'+locale+'/'+status+'/'+f);
  }
  return {meta:{id:row.id,documentId:row.documentId,locale,status:row.status,
    publishedAt:row.publishedAt||null,updatedAt:row.updatedAt||null},
    fields,relations,row};
}
async function snapshot(id){
  const [ruDraft,ruPublished,kkDraft,kkPublished]=await Promise.all([
    readVersion(id,'ru','draft'),readVersion(id,'ru','published'),
    readVersion(id,'kk','draft'),readVersion(id,'kk','published')
  ]);
  return {ru:{draft:ruDraft,published:ruPublished},
    kk:{draft:kkDraft,published:kkPublished}};
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
  ensure(!LEGACY_HALT_IDS.has(before.ru.draft.meta.documentId),
    'Незавершённое legacy восстановление Product (карантин)');
  for(const f of INVERSE){
    if(f==='category'&&idsOf(before.ru.draft.relations[f]).length)
      fail('Legacy RU Product.category не пуст, пропуск без записи');
    if(before.kk.draft && !equal(idsOf(before.ru.draft.relations[f]),
      idsOf(before.kk.draft.relations[f])))
      fail('Inverse relation '+f+' отличается, нельзя менять с Product');
  }
  const kk=before.kk.draft;
  if(kk){
    for(const [f] of rootRelations(schema)){
      const source=new Set(idsOf(before.ru.draft.relations[f]));
      for(const target of idsOf(kk.relations[f]))
        ensure(source.has(target),'Посторонний KK Draft link '+f+':'+target);
    }
  }
}
function localized(def){return def?.pluginOptions?.i18n?.localized===true;}
function mergeField(def,ru,kk,hasKK,path){
  if(!hasKK){
    if(localized(def)&&def.type!=='boolean'&&def.type!=='media'&&
       path!=='name'&&def.type!=='component'&&def.type!=='dynamiczone')
      return null;
    return ru;
  }
  if(def.type==='media')return kk;
  if(def.type==='component'){
    if(ru==null||kk==null){
      if(ru==null&&kk==null)return null;
      throw Error('Product component mismatch '+path);
    }
    if(def.repeatable){
      ensure(Array.isArray(ru)&&Array.isArray(kk)&&ru.length===kk.length,
        'Product component count differs '+path);
      return ru.map((v,i)=>mergeComponent(def.component,v,kk[i],true,path+'['+i+']'));
    }
    return mergeComponent(def.component,ru,kk,true,path);
  }
  if(def.type==='dynamiczone'){
    ensure(Array.isArray(ru)&&Array.isArray(kk)&&ru.length===kk.length,
      'Product Dynamic Zone differs '+path);
    return ru.map((v,i)=>{
      const k=kk[i];
      ensure(v.__component===k?.__component,'Product DZ type differs '+path);
      return {__component:v.__component,...mergeComponent(v.__component,v,k,true,path+'['+i+']')};
    });
  }
  if(path==='name'||def.type==='boolean')return ru;
  if(localized(def))return kk;
  if(!equal(ru,kk))
    throw Error('Product shared field mismatch (не перезаписываем): '+path);
  return kk;
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
  for(const [f,a] of attrList(schema)){
    if(a.type==='relation'||OMIT.has(f))continue;
    const val=mergeField(a,ru.fields[f],kk?.fields[f],!!kk,f);
    if(a.required&&(val==null||val===''||Array.isArray(val)&&!val.length))
      throw Error('Обязательное Product поле не задано: '+f);
    if(!kk&&a.unique===true)
      throw Error('Создание KK с unique полем '+f+' требует отдельной проверки');
    out[f]=val;
    if(!kk||!equal(val,kk.fields[f]))updates[f]=val;
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
  for(const [f] of rootRelations(schema)){
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
  // Product Published relations must match Draft exactly: attributes and
  // Product.categories must not silently disappear as in older incidents.
  return {ok:!draftModified&&!fieldDiffs.length&&!Object.keys(invisible).length&&
      !Object.keys(unexpected).length,
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
// KK Product.key is unique; never overwrite it with RU.key.
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
  a.download='category-normalization-'+mode+'-results.csv';
  document.body.appendChild(a);
  try{a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(u),20000);}
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
      (meta.total===0||rows.length>0),'Неверный ответ RU Product list page='+page);
    if(!first)first={total:meta.total,pageCount:meta.pageCount};
    ensure(meta.total===first.total&&meta.pageCount===first.pageCount,
      'Список категорий изменился в ходе загрузки (pagination drift)');
    for(const raw of rows){
      const row=raw?.attributes&&!raw.documentId?{...raw.attributes,id:raw.id}:raw;
      ensure(row?.locale==='ru'&&typeof row.documentId==='string'&&
        row.documentId.length>0&&!seen.has(row.documentId),
        'Неверная локаль/дубль RU Product в списке');
      ensure(Number.isSafeInteger(row.id)&&row.id>previousId,
        'Нарушен порядок id:ASC или изменилась пагинация');
      previousId=row.id;
      seen.add(row.documentId);
      positions.set(row.documentId,ids.length+1);
      ids.push(row.documentId);
    }
    report.scope.listPages=page;
    report.scope.productCount=first.total;
    console.log(TAG,'[index]','Страница',page+'/'+first.pageCount,
      'категорий:',ids.length+'/'+first.total);
    if(page>=first.pageCount)break;
    if(page===10000)fail('Превышен предел страниц Product list');
  }
  ensure(first&&first.total>0,'RU Product list пустой — запись запрещена');
  ensure(ids.length===first.total,'Неполная загрузка RU Product: '+
    ids.length+'/'+first.total);
  report.scope.documentIds=ids;
}
async function checkSchema(){
  const [types,parts]=await Promise.all([get('/content-manager/content-types'),
    get('/content-manager/components')]);
  ensure(Array.isArray(types?.data)&&Array.isArray(parts?.data),'Нет схем Content Manager');
  schemas=new Map(types.data.map(x=>[x.uid,x]));
  components=new Map(parts.data.map(x=>[x.uid,x]));
  schema=schemas.get(UID);
  ensure(schema?.attributes&&schema.pluginOptions?.i18n?.localized===true,
    'Не подтверждена локализованная schema Product');
  for(const [f,a] of rootRelations(schema)){
    ensure(typeof a.target==='string'&&a.target.startsWith('api::'),
      'Неподдержанный root relation target '+f);
  }
  WRITABLE=rootRelations(schema).filter(([f,a])=>!a.mappedBy&&f!=='category').map(([f])=>f);
  INVERSE=rootRelations(schema).filter(([f,a])=>a.mappedBy||f==='category').map(([f])=>f);
  ensure(schema.attributes.key?.unique===true,
    'Schema Product.key отличается от подтверждённого unique contract');
  report.scope.writableRelations=WRITABLE;
  report.scope.inverseRelations=INVERSE;
}
async function seedPhase(){
  for(const id of ids){
    guard();const st=report.stages.seed;st.processed++;
    try{
      let before=await snapshot(id);ensureSafeRoot(before);
      const ru=before.ru.draft,kk=before.kk.draft;
      const wanted=expectedKK(before);
      // Missing KK Product seed via Content Manager is not yet live-confirmed:
      // one attempted PUT is guarded by prewrite journal and strict postflight.
      // No Product.key is copied from RU.
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
  const graph=compareDraftGraph(snap);
  ensure(graph.ok,'KK Draft links не совпадают с RU: '+JSON.stringify({
    missing:graph.missing.slice(0,6),extra:graph.extra.slice(0,6),
    missingCount:graph.missing.length,extraCount:graph.extra.length}));
  const wanted=expectedKK(snap).fields;
  assertDraftValues(snap,wanted);
}
function publishPayload(draft){
  const out={locale:'kk'};
  ensure(typeof draft.fields.key==='string'&&draft.fields.key.length>0,
    'Нельзя публиковать Product без уникального KK.key');
  for(const [f,a]of attrList(schema)){
    if(OMIT.has(f)){if(f==='key')out[f]=draft.fields.key;continue;}
    if(a.type==='relation'){out[f]={connect:[],disconnect:[]};continue;}
    out[f]=draft.fields[f];
  }
  return out;
}
const publishedTargets=new Map();
async function allTargetsPublished(snap){
  const missing=[];
  for(const [field,a] of rootRelations(schema)){
    for(const documentId of idsOf(snap.kk.draft.relations[field])){
      const key=a.target+'/'+documentId;
      let status=publishedTargets.get(key);
      if(status===undefined){
        const pub=await detail(a.target,documentId,'kk','published');
        status=!!pub?.publishedAt;
        if(status)publishedTargets.set(key,true);
      }
      if(!status)missing.push({field,documentId,target:a.target});
    }
  }
  return missing;
}
async function publishPhase(){
  for(const id of ids){
    guard();const st=report.stages.publish;st.processed++;
    if(skipDocs.has(id)){st.blocked++;continue;}
    try{
      let snap=await snapshot(id);
      await finalGraphCheck(id,snap);
      const current=publishedCheck(snap.kk);
      if(current.ok&&!linkedDocs.has(id)){
        st.skipped++;
        resultFor(id).publish={status:'verified',visibility:current.invisible};
        continue;
      }
      if(typeof snap.kk.draft.fields.key!=='string'||!snap.kk.draft.fields.key){
        st.blocked++;skipDocs.add(id);
        report.issues.push({id,stage:'publish',reason:'KK.key пустой, публикация запрещена'});
        resultFor(id).publish='blocked-key';continue;
      }
      const missing=await allTargetsPublished(snap);
      if(missing.length){
        st.blocked++;skipDocs.add(id);
        report.issues.push({id,stage:'publish',reason:'Неопубликованные KK dependencies',
          count:missing.length,pending:missing.slice(0,200)});
        resultFor(id).publish='blocked-dependencies';
        update('publish',id,'Отложено: '+missing.length+' KK Published targets');
        continue;
      }
      snap=await perform('publish',id,snap,{locale:'kk'},'POST',
        '/content-manager/collection-types/'+UID+'/'+id+'/actions/publish?locale=kk',
        publishPayload(snap.kk.draft),'kk');
      const checked=publishedCheck(snap.kk);
      ensure(checked.ok,'После POST KK Product Published не соответствует Draft');
      st.kk++;resultFor(id).publish={status:'verified',visibility:checked.invisible};
      update('publish',id,'KK опубликована');
    }catch(e){
      if(report.errors.length||e.fatal||window.tmProductNormalizerStop===true)throw e;
      st.blocked++;skipDocs.add(id);
      resultFor(id).publish='blocked: '+e.message;
      report.issues.push({id,stage:'publish',reason:e.message});
      update('publish',id,'Пропущено: '+e.message);
    }
  }
}
try{
  await checkSchema();
  await loadIndex();
  // DB journal opens on every launch, before any CMS writes.
  db=await dbOpen();
  await recoverPending();
  report.summary={scope:ids.length,
    note:'KK переводы, изображения и уникальные key защищены; RU и справочники не публикуются'};
  console.log(TAG,'production','Старт',ids.length,
    'категорий. Для остановки window.tmProductNormalizerStop=true');
  await seedPhase();
  targets.clear();
  await linksPhase();
  await publishPhase();
  report.complete=report.issues.length===0;
  report.summary={...report.summary,created:report.stages.seed.created,
    updated:report.stages.seed.updated,linksAdded:report.stages.relations.linked,
    publishedKK:report.stages.publish.kk,
    incompleteDocuments:skipDocs.size,verifiedWrites:report.counters.verifiedWrites};
  report.status=report.issues.length?'completed-with-issues':'completed';
}catch(e){
  report.status='stopped';
  report.errors.push(e.message);
  console.error(TAG,'ОСТАНОВЛЕНО:',e);
}finally{
  report.finishedAt=new Date().toISOString();
  try{
    download('category-normalization-'+mode+'-'+new Date().toISOString().slice(0,10)+'.json',report);
  }catch(e){console.warn(TAG,'JSON download error',e);}
  try{downloadCSV();}
  catch(e){console.warn(TAG,'CSV download error',e);}
  if(db)db.close();
  window[RUNKEY]=false;
  console.log(TAG,'Итог',report.status,report.counters,report.stages,
    'Issues:',report.issues.length,'Errors:',report.errors.length);
}
})();