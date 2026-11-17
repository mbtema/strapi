// Category Localizer RU -> KK — Strapi Console, Content Manager API.
// Run from authenticated /admin/content-manager, no dependencies.
// Default: read-only dry-run. Apply requires explicit one-time console opt-in.
(async () => {
  'use strict';
  const UID = 'api::category.category';
  const RUN_KEY = '__tmCategoryLocalizerRunningV1';
  const DB_NAME = 'tm-category-localizer-v1';
  const SYSTEM = new Set(['id','documentId','locale','status','publishedAt','createdAt',
    'updatedAt','createdBy','updatedBy','localizations','__pivot']);
  const SCALAR = new Set(['string','text','richtext','email','enumeration','json','blocks',
    'integer','biginteger','float','decimal','boolean','date','time','datetime','uid']);
  const PAGE_SIZE = 100;
  // One-time opt-in for writes: window.tmCategoryLocalizerApplyOnce = true;
  // The flag is consumed before any CMS requests. Default is ALWAYS dry-run.
  const APPLY = window.tmCategoryLocalizerApplyOnce === true;
  delete window.tmCategoryLocalizerApplyOnce;
  const DRY_RUN = !APPLY;
  if (!location.pathname.startsWith('/admin/content-manager')) {
    console.error('[Category Localizer] Открой Content Manager Strapi.'); return;
  }
  if (window[RUN_KEY]) { console.warn('[Category Localizer] Уже запущен'); return; }
  window[RUN_KEY] = true;
  let jwt;
  try { jwt = JSON.parse(localStorage.getItem('jwtToken')); }
  catch { jwt = localStorage.getItem('jwtToken'); }
  if (!jwt || typeof jwt !== 'string') {
    window[RUN_KEY] = false;
    console.error('[Category Localizer] Не найден jwtToken'); return;
  }
  const state = {stop:false,done:0,total:0,phase:'init',current:'',get:0,put:0,post:0,
    retries:0,schemas:new Map(),components:new Map(),list:[],db:null,touched:new Set(),report:{
      tool:'category-localizer',version:2,mode:DRY_RUN?'dry-run':'apply',
      startedAt:new Date().toISOString(),finishedAt:null,
      results:[],operations:[],journals:[],errors:[],snapshots:[],plans:[],summary:null}};
  const $ = (tag, text) => { const e=document.createElement(tag); if(text!==undefined)e.textContent=text; return e; };
  document.getElementById('tm-category-localizer-panel')?.remove();
  const panel=$('section'); panel.id='tm-category-localizer-panel';
  panel.style.cssText='position:fixed;right:16px;bottom:16px;z-index:2147483600;'+
    'background:#202035;color:#fff;padding:14px;border:1px solid #7774b5;border-radius:10px;'+
    'width:min(490px,calc(100vw - 32px));max-height:75vh;overflow:auto;'+
    'box-shadow:0 10px 32px #0009;font:13px/1.5 system-ui';
  const heading=$('strong','Category Localizer · '+(DRY_RUN?'DRY RUN · только GET':'APPLY · RU → KK'));
  const message=$('pre','Подготовка…'); message.style.cssText='white-space:pre-wrap;font:12px/1.5 system-ui';
  const buttons=$('div'); buttons.style.cssText='display:flex;gap:7px;flex-wrap:wrap';
  const stop=$('button','Стоп'); const csv=$('button','CSV'); const json=$('button','JSON');
  for(const b of [stop,csv,json]) {b.type='button';b.style.cssText='padding:6px 10px;cursor:pointer';buttons.append(b);}
  panel.append(heading,message,buttons); document.body.append(panel);
  stop.onclick=()=>{state.stop=true;stop.disabled=true;render('Остановка после текущей операции…');};
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const now=()=>new Date().toISOString();
  const clean=x=>String(x??'').replace(/[\r\n\t]+/g,' ').slice(0,350);
  const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?
    Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
  const eq=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
  const uniq=items=>[...new Set(items)];
  const nonEmpty=x=>x!=null&&x!==''&&(!Array.isArray(x)||x.length>0);
  const localized=a=>a?.pluginOptions?.i18n?.localized===true;
  const fieldsOf=s=>Object.entries(s.attributes).filter(([f])=>!SYSTEM.has(f));
  const relFields=s=>fieldsOf(s).filter(([,a])=>a.type==='relation');
  const asIds=x=>x?x.map(v=>v.documentId).sort():[];
  const rowsStatus=()=>Object.fromEntries(['planned','success','already_ok','blocked','unresolved','error'].map(k=>
    [k,state.report.results.filter(v=>v.status===k).length]));
  function render(line='') {
    const c=rowsStatus();
    message.textContent=(line||state.phase)+'\n'+state.done+'/'+(state.total||'?')+
      ' Category · '+state.current+'\n'+
      (DRY_RUN?'Планируется '+c.planned+' · уже нормализовано '+c.already_ok:
        'Успешно '+c.success+' · без изменений '+c.already_ok)+
      ' · blocked '+c.blocked+' · unresolved '+c.unresolved+' · errors '+c.error+'\n'+
      'GET '+state.get+' · PUT '+state.put+' · POST '+state.post+' · retries '+state.retries;
  }
  const csvFields=['documentId','name','status','stage','changes','reason','attempts',
    'createKK','fieldsChanged','relationsConnect','relationsDisconnect',
    'dependenciesToPublish','publishRU','publishKK'];
  const q=x=>{let s=Array.isArray(x)?x.join(' | '):String(x??'');
    if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  function download(name,content,type){
    const url=URL.createObjectURL(new Blob([content],{type}));
    const a=$('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),20000);
  }
  csv.onclick=()=>download('category-localizer-'+(DRY_RUN?'dry-run':'apply')+'.csv','\uFEFF'+[
    csvFields.join(';'),...state.report.results.map(row=>csvFields.map(f=>q(row[f])).join(';'))
  ].join('\n'),'text/csv;charset=utf-8');
  json.onclick=()=>download('category-localizer-'+(DRY_RUN?'dry-run':'apply')+'.json',JSON.stringify(state.report,null,2),
    'application/json;charset=utf-8');
  const stopCheck=()=>{if(state.stop)throw Object.assign(Error('Остановка пользователем'),{stop:true});};
  class Blocked extends Error {constructor(message){super(message);this.blocked=true;}}
  class Unresolved extends Error {constructor(message){super(message);this.unresolved=true;}}

  // Persistent store: a completed stage is never inferred from an HTTP success alone.
  async function openDB(){
    if(!('indexedDB' in window))throw Error('IndexedDB недоступен: запись запрещена');
    return await new Promise((resolve,reject)=>{
      const request=indexedDB.open(DB_NAME,1);
      request.onupgradeneeded=()=>request.result.createObjectStore('jobs',{keyPath:'key'});
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
  }
  function dbOp(kind,value){return new Promise((resolve,reject)=>{
    const tx=state.db.transaction('jobs',kind==='get'?'readonly':'readwrite');
    const store=tx.objectStore('jobs');const req=kind==='get'?store.get(value):store.put(value);
    let result;
    req.onsuccess=()=>{result=req.result;};
    tx.oncomplete=()=>resolve(result); // durability: commit before making HTTP write
    req.onerror=()=>reject(req.error);
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error||Error('IndexedDB transaction aborted'));
  });}
  const keyOf=(uid,id)=>uid+'|'+id;
  const getJob=(uid,id)=>dbOp('get',keyOf(uid,id));
  const putJob=job=>dbOp('put',job);
  async function writeJournal(uid,id,stage,before,expected,extra={}){
    const prior=await getJob(uid,id); const job={key:keyOf(uid,id),uid,id,
      history:prior?.history||[],phase:'pending-'+stage,at:now(),before,expected,
      lastVerified:prior?.lastVerified||null,...extra};
    await putJob(job);state.touched.add(job.key);return job;
  }
  async function verifiedJournal(job,after){
    job.history.push({stage:job.phase.slice(8),at:now(),before:job.before,
      after,expected:job.expected});
    job.phase='verified-'+job.phase.slice(8);
    job.lastVerified=after;job.before=null;job.expected=null;
    await putJob(job);state.touched.add(job.key);
    state.report.operations.push({key:job.key,stage:job.phase,verified:true,at:now()});
  }
  async function completeJob(uid,id,snap){
    const job=(await getJob(uid,id))||{key:keyOf(uid,id),uid,id,history:[]};
    job.phase='complete';job.completedAt=now();job.lastVerified=snap;
    job.before=null;job.expected=null;
    await putJob(job);state.touched.add(job.key);
  }

  async function request(method,path,body,allow404=false){
    if(!['GET','PUT','POST'].includes(method))throw Error('Запрещённый метод '+method);
    if(DRY_RUN && method!=='GET')throw Error('DRY RUN запрещает '+method+' '+path);
    const attempts=method==='GET'?3:1;
    for(let attempt=0;attempt<attempts;attempt++){
      if(method==='GET')state.get++;else if(method==='PUT')state.put++;else state.post++;
      let response;
      try{response=await fetch(path,{method,credentials:'include',cache:'no-store',
        headers:{Authorization:'Bearer '+jwt,Accept:'application/json',
          ...(body===undefined?{}:{'Content-Type':'application/json'})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});}
      catch(e){if(method!=='GET'||attempt===attempts-1)
        throw Error(method+' NETWORK '+path+': '+clean(e));
        state.retries++;await sleep(600*(attempt+1));continue;}
      const raw=await response.text();let parsed;
      try{parsed=raw?JSON.parse(raw):null;}catch{throw Error(method+' non-JSON '+path);}
      if(response.status===404&&allow404)return null;
      if(response.ok)return parsed;
      if(method==='GET'&&attempt<attempts-1&&[408,429,500,502,503,504].includes(response.status)){
        state.retries++;await sleep(800*(attempt+1));continue;}
      const error=Error(method+' HTTP '+response.status+' '+path+': '+clean(parsed?.error?.message||raw));
      error.httpStatus=response.status;
      throw error;
    }
  }
  const get=(path,allow404=false)=>request('GET',path,undefined,allow404);
  const detailPath=(uid,id,locale,status)=>'/content-manager/collection-types/'+uid+'/'+
    encodeURIComponent(id)+'?locale='+locale+'&status='+status;
  async function detail(uid,id,locale,status){
    const data=await get(detailPath(uid,id,locale,status),true);
    const row=data?.data;
    if(data==null||row==null||(typeof row==='object'&&!Array.isArray(row)&&!Object.keys(row).length))return null;
    if(row.documentId!==id||row.locale!==locale||(status==='published'&&!row.publishedAt))
      throw Error('Неоднозначный detail '+keyOf(uid,id)+' '+locale+'/'+status);
    return row;
  }
  function parseList(data,page,first=null){
    const p=data?.pagination,rows=data?.results;
    if(!Array.isArray(rows)||!Number.isSafeInteger(p?.total)||p.total<0||
      !Number.isSafeInteger(p?.pageCount)||p.pageCount<0||
      (p.total>0&&rows.length===0)||
      (p.page!=null&&Number(p.page)!==page)||
      (first&&(p.total!==first.total||p.pageCount!==first.pageCount)))
      throw Error('Неверная пагинация: '+page);
    return {rows,total:p.total,pageCount:p.pageCount};
  }
  async function allCategoryIds(){
    const ids=[],seen=new Set();let page=1,first=null;
    do{
      stopCheck();
      const qs=new URLSearchParams({locale:'ru',status:'draft',page:String(page),
        pageSize:String(PAGE_SIZE),sort:'id:ASC'});
      const result=parseList(await get('/content-manager/collection-types/'+UID+'?'+qs),page,first);
      first||=result;
      for(const raw of result.rows){
        const r=raw?.attributes&&!raw.documentId?{...raw.attributes,id:raw.id}:raw;
        if(r?.locale!=='ru'||typeof r.documentId!=='string'||seen.has(r.documentId))
          throw Error('Повтор/неверная RU Category в списке');
        seen.add(r.documentId);ids.push({id:r.documentId,name:r.name||r.title||''});
      }
      render('Загружен список: '+ids.length+'/'+first.total);
      if(page>=first.pageCount)break;
      if(++page>10000)throw Error('Слишком много страниц');
    }while(true);
    if(ids.length!==first.total)throw Error('Неполный список категорий');
    return ids;
  }
  async function schemas(){
    const [types,comps]=await Promise.all([get('/content-manager/content-types'),
      get('/content-manager/components')]);
    if(!Array.isArray(types?.data)||!Array.isArray(comps?.data))throw Error('Схемы недоступны');
    state.schemas=new Map(types.data.map(s=>[s.uid,s]));
    state.components=new Map(comps.data.map(s=>[s.uid,s]));
    const s=state.schemas.get(UID);
    if(!s?.attributes||s.pluginOptions?.i18n?.localized!==true)
      throw Error('Schema Category не подтверждена');
    for(const [f,a]of relFields(s))if(typeof a.target!=='string'||!a.target.startsWith('api::'))
      throw Error('Неподдержанная Category relation '+f);
  }

  function media(value){
    if(value==null)return null;
    const one=x=>Number.isSafeInteger(x)&&x>0?x:
      Number.isSafeInteger(x?.id)&&x.id>0?x.id:null;
    if(Array.isArray(value)){
      const result=value.map(one);
      if(result.includes(null))throw new Blocked('Неизвестный media id');return result;
    }
    const id=one(value);if(id==null)throw new Blocked('Неизвестный media id');return id;
  }
  function canonicalField(attr,value,path){
    if(value===undefined)throw new Blocked('Отсутствует поле '+path);
    if(value==null)return value;
    if(attr.type==='media')return media(value);
    if(SCALAR.has(attr.type))return canonical(value);
    if(attr.type==='relation'){
      // Native root relations handled separately. Nested nonempty relations need a validated contract.
      const populated=Array.isArray(value)?value.length:
        Number.isSafeInteger(value?.count)?value.count:value?.documentId||value?.id?1:0;
      if(populated)throw new Blocked('Неподдержанная вложенная relation '+path);
      return null;
    }
    if(attr.type==='component'){
      const one=x=>componentField(attr.component,x,path);
      if(attr.repeatable){if(!Array.isArray(value))throw new Blocked('Неверный массив '+path);
        return value.map(one);}
      return one(value);
    }
    if(attr.type==='dynamiczone'){
      if(!Array.isArray(value))throw new Blocked('Неверная Dynamic Zone '+path);
      return value.map((part,i)=>{
        if(!attr.components?.includes(part?.__component))
          throw new Blocked('Неизвестный DZ '+path+'['+i+']');
        return {__component:part.__component,...componentField(part.__component,part,path+'['+i+']')};
      });
    }
    throw new Blocked('Неподдержанный тип '+attr.type+' в '+path);
  }
  function componentField(uid,value,path){
    if(value==null)return null;
    const s=state.components.get(uid);
    if(!s?.attributes||!value||typeof value!=='object'||Array.isArray(value))
      throw new Blocked('Неверный компонент '+uid+' '+path);
    const out={};
    for(const [f,a]of fieldsOf(s)){
      if(f==='__component')continue;
      if(!Object.hasOwn(value,f))throw new Blocked('Отсутствует '+path+'.'+f);
      out[f]=canonicalField(a,value[f],path+'.'+f);
    }
    return out;
  }
  function recordFields(s,row){
    if(!row)return null;
    const o={};for(const [f,a]of fieldsOf(s))if(a.type!=='relation'){
      if(!Object.hasOwn(row,f))throw new Blocked('Поле '+f+' отсутствует в CM detail');
      o[f]=canonicalField(a,row[f],f);
    }return o;
  }
  async function relations(uid,id,field,locale,status){
    const out=[];let page=1,first=null;
    do{
      const qs=new URLSearchParams({locale,status,page:String(page),pageSize:String(PAGE_SIZE)});
      const data=await get('/content-manager/relations/'+uid+'/'+encodeURIComponent(id)+'/'+
        encodeURIComponent(field)+'?'+qs);
      const result=parseList(data,page,first);first||=result;
      for(const row of result.rows){
        if(!row?.documentId||!Number.isSafeInteger(row.id)||row.id<=0)
          throw Error('Relation без numeric ID '+uid+'/'+field);
        out.push({documentId:row.documentId,id:row.id,locale:row.locale||locale});
      }
      if(page>=first.pageCount)break;
      if(++page>10000)throw Error('Слишком много страниц relation '+field);
    }while(true);
    if(out.length!==first.total||uniq(out.map(v=>v.documentId)).length!==out.length)
      throw Error('Потеря/дубли relation '+field+'/'+locale+'/'+status);
    return out.sort((a,b)=>a.documentId.localeCompare(b.documentId));
  }
  async function version(uid,id,locale,status){
    const row=await detail(uid,id,locale,status);if(!row)return null;
    const s=state.schemas.get(uid);
    if(!s?.attributes)throw new Blocked('Нет схемы зависимости '+uid);
    const rel={};
    for(const [f]of relFields(s))rel[f]=await relations(uid,id,f,locale,status);
    return {row,fields:recordFields(s,row),relations:rel};
  }
  async function snapshot(uid,id){
    const values=await Promise.all([
      version(uid,id,'ru','draft'),version(uid,id,'ru','published'),
      version(uid,id,'kk','draft'),version(uid,id,'kk','published')]);
    return {ru:{draft:values[0],published:values[1]},kk:{draft:values[2],published:values[3]}};
  }
  const relIDs=v=>Object.fromEntries(Object.entries(v?.relations||{}).map(([f,r])=>[f,asIds(r)]));
  const sameVersion=(a,b)=>a===null&&b===null||!!a&&!!b&&
    eq(a.fields,b.fields)&&eq(relIDs(a),relIDs(b));
  const intact=(before,after)=>sameVersion(before.ru.draft,after.ru.draft)&&
    sameVersion(before.ru.published,after.ru.published);
  function identicalDraftTarget(actual,expected){
    if(!actual||!expected)return false;
    return eq(actual.fields,expected.fields)&&eq(relIDs(actual),relIDs(expected));
  }
  const emptyRel=()=>({});
  function mergedComponent(uid,ru,kk,path){
    const s=state.components.get(uid);
    if(!s?.attributes)throw new Blocked('Нет схемы '+uid);
    if(!ru)return null;
    const out={};
    for(const [f,a]of fieldsOf(s)){
      if(f==='__component')continue;
      out[f]=desiredField(f,a,ru[f],kk?.[f],!!kk,path+'.'+f);
      if(out[f]===undefined)delete out[f];
    }
    return out;
  }
  function desiredField(field,attr,ru,kk,hasKK,path){
    if(ru===undefined)throw new Blocked('Отсутствует RU '+path);
    if(field==='filters_app')return canonicalField(attr,ru,path); // full sync, explicit exception
    if(field==='title'||attr.type==='boolean')return canonicalField(attr,ru,path);
    if(attr.type==='media')return hasKK?canonicalField(attr,kk,path):undefined;
    if(attr.type==='component'||attr.type==='dynamiczone'){
      // Localized containers may contain both local and shared nested fields.
      if(ru==null)return localized(attr)&&hasKK?canonicalField(attr,kk,path):ru;
      if(attr.type==='component'){
        const one=(r,k,p)=>mergedComponent(attr.component,r,k,p);
        if(attr.repeatable){
          if(!Array.isArray(ru))throw new Blocked('Неверный RU компонент '+path);
          if(hasKK&&kk!=null&&(!Array.isArray(kk)||kk.length!==ru.length))
            throw new Blocked('Структура KK component отличается: '+path);
          return ru.map((r,i)=>one(r,hasKK?kk?.[i]:null,path+'['+i+']'));
        }
        return one(ru,hasKK?kk:null,path);
      }
      if(!Array.isArray(ru))throw new Blocked('Неверная RU Dynamic Zone '+path);
      if(hasKK&&kk!=null&&(!Array.isArray(kk)||kk.length!==ru.length))
        throw new Blocked('Структура KK Dynamic Zone отличается: '+path);
      return ru.map((r,i)=>{
        if(!attr.components?.includes(r?.__component)||
          (hasKK&&kk?.[i]?.__component!==r.__component))
          throw new Blocked('Структура DZ не совпадает: '+path);
        return {__component:r.__component,...mergedComponent(r.__component,r,kk?.[i],path+'['+i+']')};
      });
    }
    if(path==='name'||path==='description'||localized(attr))
      return hasKK?canonicalField(attr,kk,path):undefined;
    if(attr.type==='relation')throw new Blocked('Вложенная relation '+path);
    return canonicalField(attr,ru,path);
  }
  function planFields(s,ru,kk){
    const payload={},expected=kk?{...kk.fields}:{};
    for(const [f,a]of fieldsOf(s)){
      if(a.type==='relation')continue;
      const v=desiredField(f,a,ru.row[f],kk?.row?.[f],!!kk,f);
      if(v===undefined){if(a.required===true)throw new Blocked('Обязательный перевод отсутствует: '+f);
        continue;}
      if(!kk||!eq(v,kk.fields[f]))payload[f]=v;
      expected[f]=v;
    }
    return {payload,expected};
  }
  function relationPlan(s,ru,kk){
    const changes={},expected={};
    for(const [f,a]of relFields(s)){
      const source=ru.relations[f]||[],target=kk?.relations?.[f]||[];
      const want=asIds(source),have=asIds(target);
      if(f==='products'&&want.length)throw new Blocked('RU legacy products не пуст: '+want.length);
      const add=want.filter(id=>!have.includes(id));
      const remove=have.filter(id=>!want.includes(id));
      expected[f]=want;
      if(add.length||remove.length)changes[f]={targetUid:a.target,add,remove,old:target};
    }
    return {changes,expected};
  }
  function withExpected(before,fields,rels){
    const copy=structuredClone(before);
    copy.kk.draft={row:null,fields,relations:Object.fromEntries(Object.entries(rels).map(([f,ids])=>
      [f,ids.map(documentId=>({documentId,id:0,locale:'kk'}))]))};
    return copy;
  }
  function matchSeed(before,after,expected){
    if(!intact(before,after)||before.kk.draft||!after.kk.draft||
      !sameVersion(before.kk.published,after.kk.published))return false;
    for(const [f,v]of Object.entries(expected.fields))
      if(!eq(after.kk.draft.fields[f],v))return false;
    // Untranslated fields of a newly created KK must stay empty.
    for(const [f,v]of Object.entries(after.kk.draft.fields))
      if(!Object.hasOwn(expected.fields,f)&&nonEmpty(v))return false;
    return Object.values(relIDs(after.kk.draft)).every(ids=>ids.length===0);
  }
  function matchSave(before,after,expected){
    return intact(before,after)&&!!after.kk.draft&&
      eq(after.kk.draft.fields,expected.fields)&&eq(relIDs(after.kk.draft),expected.relations)&&
      sameVersion(before.kk.published,after.kk.published);
  }
  function matchPublish(before,after,expected,locale){
    if(!after[locale].draft||!after[locale].published)return false;
    const other=locale==='ru'?'kk':'ru';
    return sameVersion(before[other].draft,after[other].draft)&&
      sameVersion(before[other].published,after[other].published)&&
      sameVersion(before[locale].draft,after[locale].draft)&&
      eq(after[locale].published.fields,expected.fields)&&
      eq(relIDs(after[locale].published),expected.relations);
  }
  function matchPending(job,after){
    if(!job?.phase?.startsWith('pending-')||!job.before||!job.expected)return false;
    const phase=job.phase.slice(8);
    if(phase==='seed')return matchSeed(job.before,after,job.expected);
    if(phase==='save')return matchSave(job.before,after,job.expected);
    if(phase==='publish-ru')return matchPublish(job.before,after,job.expected,'ru');
    if(phase==='publish-kk'||phase==='publish-dependency')
      return matchPublish(job.before,after,job.expected,'kk');
    return false;
  }
  async function reconcile(uid,id){
    const job=await getJob(uid,id);
    if(!job?.phase?.startsWith('pending-'))return job;
    const after=await snapshot(uid,id);
    if(!matchPending(job,after))throw new Unresolved('Незавершённая '+job.phase+
      ': автоматическая GET-сверка не подтвердила результат');
    await verifiedJournal(job,after);
    return job;
  }
  async function checkedWrite(uid,id,stage,before,expected,method,path,payload,verify){
    const pending=await writeJournal(uid,id,stage,before,expected,{method,path});
    let error=null;
    try{await request(method,path,payload);}catch(e){error=e;}
    let after=null;
    try{after=await snapshot(uid,id);}catch(e){error ||= e;}
    if(!after||!verify(before,after,expected)){
      state.report.operations.push({key:pending.key,stage,verified:false,at:now(),
        error:clean(error||'postflight mismatch')});
      throw new Unresolved(stage+': '+clean(error||'проверка после записи не пройдена'));
    }
    // A failed HTTP response is ambiguous. Confirmed postflight is authoritative.
    await verifiedJournal(pending,after);
    return after;
  }
  function publishPayload(uid,locale,draft){
    const schema=state.schemas.get(uid),payload={locale};
    for(const [f,a]of fieldsOf(schema)){
      if(a.type==='relation'){payload[f]={connect:[],disconnect:[]};continue;}
      if(f==='InStock'||f==='inStock')continue;
      if(a.required&&(!nonEmpty(draft.row[f])&&draft.row[f]!==false&&draft.row[f]!==0))
        throw new Blocked('Публикация: обязательное поле пустое '+uid+'.'+f);
      payload[f]=draft.fields[f];
    }
    return payload;
  }
  async function publishVersion(uid,id,locale){
    let before=await snapshot(uid,id);
    const draft=before[locale].draft;
    if(!draft)throw new Blocked('Нет '+locale+' Draft для Publish '+uid+'/'+id);
    const expected={fields:draft.fields,relations:relIDs(draft)};
    const path='/content-manager/collection-types/'+uid+'/'+encodeURIComponent(id)+
      '/actions/publish?locale='+locale;
    const stage=uid===UID?'publish-'+locale:'publish-dependency';
    return checkedWrite(uid,id,stage,before,expected,'POST',path,
      publishPayload(uid,locale,draft),(b,a,e)=>matchPublish(b,a,e,locale));
  }
  const depCache=new Map();
  async function ensureDependency(uid,id,stack=new Set()){
    if(uid===UID){
      // Two-phase processing: all KK Category drafts are seeded before relation writes.
      const kk=await detail(uid,id,'kk','draft');
      if(!kk)throw new Blocked('Нет KK Category '+id);
      return kk.id;
    }
    const key=keyOf(uid,id);
    if(depCache.has(key))return depCache.get(key);
    if(stack.has(key))throw new Blocked('Цикл зависимостей: '+key);
    const fresh=new Set(stack);fresh.add(key);
    await reconcile(uid,id);
    const s=state.schemas.get(uid);
    if(!s?.attributes)throw new Blocked('Нет schema зависимости '+uid);
    if(s.pluginOptions?.i18n?.localized!==true){
      const any=await detail(uid,id,'ru','draft');
      if(!any)throw new Blocked('Отсутствует общая зависимость '+key);
      depCache.set(key,any.id);return any.id;
    }
    let before=await snapshot(uid,id);
    if(!before.kk.draft)throw new Blocked('Нет KK Draft '+key);
    if(before.kk.published){depCache.set(key,before.kk.draft.row.id);return before.kk.draft.row.id;}
    if(!before.ru.published)throw new Blocked('Нет RU Published '+key);
    for(const [f,a]of relFields(s))for(const target of before.kk.draft.relations[f]||[])
      await ensureDependency(a.target,target.documentId,fresh);
    before=await snapshot(uid,id);
    if(!before.kk.published)await publishVersion(uid,id,'kk');
    depCache.set(key,before.kk.draft.row.id);
    return before.kk.draft.row.id;
  }
  async function uniquePreflight(id,s,targetFields){
    for(const [field,a]of fieldsOf(s)){
      if(a.unique!==true||!nonEmpty(targetFields[field]))continue;
      const query=new URLSearchParams({locale:'kk',status:'draft',page:'1',
        pageSize:String(PAGE_SIZE)});
      query.set('filters['+field+'][$eq]',String(targetFields[field]));
      const data=parseList(await get('/content-manager/collection-types/'+UID+'?'+query),1);
      if(data.total>PAGE_SIZE)throw new Blocked('Слишком много совпадений unique '+field);
      for(const item of data.rows){
        const row=item?.attributes&&!item.documentId?{...item.attributes,id:item.id}:item;
        if(row?.documentId!==id)throw new Blocked('Конфликт unique '+field+' с '+row?.documentId);
      }
    }
  }
  const safeStatus=e=>e instanceof Blocked?'blocked':e instanceof Unresolved?'unresolved':'error';
  function result(id,name,status,stage,reason='',changes=[],attempts=0){
    state.report.results.push({documentId:id,name,status,stage,reason:clean(reason),changes,attempts});
    state.done++;state.current=name||id;render(stage+': '+status);
  }
  function snapshotIsComplete(before,job){
    return job?.phase==='complete'&&job.lastVerified&&
      sameVersion(before.ru.draft,job.lastVerified.ru.draft)&&
      sameVersion(before.ru.published,job.lastVerified.ru.published)&&
      sameVersion(before.kk.draft,job.lastVerified.kk.draft)&&
      sameVersion(before.kk.published,job.lastVerified.kk.published);
  }
  async function seed(item){
    const id=item.id;
    await reconcile(UID,id);
    const before=await snapshot(UID,id),s=state.schemas.get(UID);
    if(!before.ru.draft)throw new Blocked('RU Draft отсутствует');
    if(asIds(before.ru.draft.relations.products||[]).length)
      throw new Blocked('RU legacy products содержит связи');
    if(before.kk.draft)return;
    if(before.kk.published)throw new Blocked('KK Published существует без KK Draft');
    // Do not create a Category when an external relation target lacks KK.
    // Category-to-Category targets are seeded in this same first pass.
    for(const [f,a]of relFields(s))if(a.target!==UID)
      for(const row of before.ru.draft.relations[f]){
        const targetSchema=state.schemas.get(a.target);
        if(!targetSchema?.attributes)throw new Blocked('Нет схемы '+a.target);
        const locale=targetSchema.pluginOptions?.i18n?.localized===true?'kk':'ru';
        const d=await detail(a.target,row.documentId,locale,'draft');
        if(!d)throw new Blocked('Отсутствует '+locale+' зависимость '+f+'/'+row.documentId);
      }
    const fields=planFields(s,before.ru.draft,null);
    await uniquePreflight(id,s,fields.expected);
    const expected={fields:fields.expected,relations:Object.fromEntries(relFields(s).map(([f])=>[f,[]]))};
    const path='/content-manager/collection-types/'+UID+'/'+encodeURIComponent(id)+'?locale=kk';
    await checkedWrite(UID,id,'seed',before,expected,'PUT',path,
      {locale:'kk',...fields.payload},matchSeed);
  }
  async function normalize(item){
    const id=item.id,s=state.schemas.get(UID);
    await reconcile(UID,id);
    let before=await snapshot(UID,id);
    if(!before.ru.draft||!before.kk.draft)throw new Blocked('Отсутствует RU/KK Draft');
    const {payload,expected}=planFields(s,before.ru.draft,before.kk.draft);
    const rel=relationPlan(s,before.ru.draft,before.kk.draft);
    // Resolve every target, not only missing connects, to catch unavailable KK relations.
    const targets=new Map();
    for(const [f,a]of relFields(s)){
      for(const row of before.ru.draft.relations[f])targets.set(keyOf(a.target,row.documentId),
        {uid:a.target,id:row.documentId});
    }
    for(const dep of targets.values())await ensureDependency(dep.uid,dep.id);
    const changes=[...Object.keys(payload),...Object.keys(rel.changes).map(f=>'relation:'+f)];
    if(!changes.length)return {before,changes};
    await uniquePreflight(id,s,expected);
    // Re-read changed relations through the native endpoint immediately before write.
    for(const [f]of Object.entries(rel.changes)){
      const [source,target]=await Promise.all([
        relations(UID,id,f,'ru','draft'),relations(UID,id,f,'kk','draft')]);
      if(!eq(asIds(source),asIds(before.ru.draft.relations[f]))||
        !eq(asIds(target),asIds(before.kk.draft.relations[f])))
        throw new Blocked('Relation изменена во время preflight '+f);
    }
    // Dependency publication must not change Category fields or source relations.
    const current=await snapshot(UID,id);
    if(!sameVersion(before.ru.draft,current.ru.draft)||
      !sameVersion(before.ru.published,current.ru.published)||
      !sameVersion(before.kk.draft,current.kk.draft))
      throw new Blocked('Категория изменена во время preflight');
    before=current;
    const write={locale:'kk',...payload};
    for(const [f,delta]of Object.entries(rel.changes)){
      const connects=[];
      for(const targetId of delta.add){
        const numeric=await ensureDependency(delta.targetUid,targetId);
        if(!Number.isSafeInteger(numeric)||numeric<=0)
          throw new Blocked('Нет numeric KK ID '+delta.targetUid+'/'+targetId);
        const targetSchema=state.schemas.get(delta.targetUid);
        const targetLocale=targetSchema?.pluginOptions?.i18n?.localized===true?'kk':'ru';
        connects.push({id:numeric,documentId:targetId,locale:targetLocale});
      }
      const disconnects=delta.remove.map(targetId=>{
        const existing=delta.old.find(x=>x.documentId===targetId);
        if(!existing?.id)throw new Blocked('Нет numeric KK ID для disconnect '+f+'/'+targetId);
        return {id:existing.id,documentId:targetId,locale:'kk'};
      });
      write[f]={connect:connects,disconnect:disconnects};
    }
    const expectedSave={fields:expected,relations:rel.expected};
    const path='/content-manager/collection-types/'+UID+'/'+encodeURIComponent(id)+'?locale=kk';
    const after=await checkedWrite(UID,id,'save',before,expectedSave,'PUT',path,write,matchSave);
    return {before:after,changes};
  }
  async function publishCategory(item){
    await reconcile(UID,item.id);
    // Another Category may have changed an inverse KK relation since phase 2.
    // Re-evaluate before publication, never publish stale normalized content.
    await normalize(item);
    let before=await snapshot(UID,item.id);
    if(!before.ru.draft||!before.kk.draft)throw new Blocked('Нет RU/KK Draft');
    const plan=planFields(state.schemas.get(UID),before.ru.draft,before.kk.draft);
    const rel=relationPlan(state.schemas.get(UID),before.ru.draft,before.kk.draft);
    if(Object.keys(plan.payload).length||Object.keys(rel.changes).length)
      throw new Blocked('KK Draft ещё не нормализован');
    const job=await getJob(UID,item.id);
    const sameAsVerified=job?.lastVerified&&
      ['ru','kk'].every(locale=>['draft','published'].every(status=>
        sameVersion(before[locale][status],job.lastVerified[locale][status])));
    const ruWasPublished=sameAsVerified&&
      ['verified-publish-ru','verified-publish-kk'].includes(job.phase);
    const kkWasPublished=sameAsVerified&&job.phase==='verified-publish-kk';
    if(!ruWasPublished)await publishVersion(UID,item.id,'ru');
    before=await snapshot(UID,item.id);
    // RU publish must not alter KK Draft or shared RU Draft contents.
    if(!before.kk.draft)throw new Unresolved('KK Draft исчез при Publish RU');
    if(!kkWasPublished)await publishVersion(UID,item.id,'kk');
    const final=await snapshot(UID,item.id);
    if(!sameVersion(final.ru.draft,final.ru.published)||
      !sameVersion(final.kk.draft,final.kk.published))
      throw new Unresolved('Published отличаются от Draft после Publish');
    await completeJob(UID,item.id,final);
    return final;
  }

  // Read-only preflight: no IndexedDB, PUT or POST. Capture all four versions
  // and their exact native root relations before proposing any action.
  async function dryRun(){
    await schemas();
    state.list=await allCategoryIds();
    state.total=state.list.length;
    const source=state.schemas.get(UID);
    const snapshots=new Map(),analyses=new Map(),failures=new Map();
    state.phase='Dry-run: чтение всех RU/KK версий';render();
    let scanned=0;
    for(const item of state.list){
      if(state.stop)break;
      state.current=item.name||item.id;
      try{
        const before=await snapshot(UID,item.id);
        snapshots.set(item.id,before);
        state.report.snapshots.push({documentId:item.id,before});
      }catch(e){
        failures.set(item.id,{status:safeStatus(e),reason:clean(e.message)});
        state.report.errors.push(item.id+': '+clean(e.message));
      }
      scanned++;render('Снимки '+scanned+'/'+state.total);
    }

    // All possible KK Category drafts are modelled together so cross-category
    // and cyclic links do not depend on the order of the read-only audit.
    const seedable=new Set();
    state.phase='Dry-run: план полей и связей';render();
    for(const item of state.list){
      if(state.stop)break;
      const before=snapshots.get(item.id);
      if(!before)continue;
      try{
        if(!before.ru.draft)throw new Blocked('Нет RU Draft');
        if(!before.kk.draft&&before.kk.published)
          throw new Blocked('KK Published существует без KK Draft');
        const fields=planFields(source,before.ru.draft,before.kk.draft);
        const rel=relationPlan(source,before.ru.draft,before.kk.draft);
        const createKK=!before.kk.draft;
        const uniqueChanged=createKK||Object.keys(fields.payload).some(f=>
          source.attributes[f]?.unique===true);
        if(uniqueChanged)await uniquePreflight(item.id,source,fields.expected);
        analyses.set(item.id,{item,before,fields,rel,createKK});
        if(createKK)seedable.add(item.id);
      }catch(e){
        failures.set(item.id,{status:safeStatus(e),reason:clean(e.message)});
      }
      state.current=item.name||item.id;render('Планы '+(analyses.size+failures.size)+'/'+state.total);
    }

    // A dependency is only a publication candidate if its KK Draft exists,
    // its KK Published is absent and its RU Published exists. No writes here.
    const depSnapshots=new Map();
    async function dependency(uid,id,allowed,stack=new Set()){
      if(uid===UID){
        const existing=snapshots.get(id);
        if(existing?.kk.draft||allowed.has(id))return [];
        throw new Blocked('Нет KK Category зависимости '+id);
      }
      const key=keyOf(uid,id);
      const schema=state.schemas.get(uid);
      if(!schema?.attributes)throw new Blocked('Нет схемы зависимости '+key);
      if(schema.pluginOptions?.i18n?.localized!==true){
        const ru=await detail(uid,id,'ru','draft');
        if(!ru)throw new Blocked('Не найдена общая зависимость '+key);
        return [];
      }
      let before=depSnapshots.get(key);
      if(!before){
        before=await snapshot(uid,id);
        depSnapshots.set(key,before);
      }
      if(!before.kk.draft)throw new Blocked('Нет KK Draft зависимости '+key);
      if(before.kk.published)return [];
      if(!before.ru.published)throw new Blocked('Нет RU Published зависимости '+key);
      if(stack.has(key))throw new Blocked('Цикл неопубликованных зависимостей '+key);
      const visited=new Set(stack);visited.add(key);
      const need=new Map();
      for(const [field,a]of relFields(schema)){
        for(const target of before.kk.draft.relations[field]||[]){
          for(const row of await dependency(a.target,target.documentId,allowed,visited))
            need.set(keyOf(row.uid,row.id),row);
        }
      }
      need.set(key,{uid,id});
      return [...need.values()];
    }
    async function dependenciesOf(analysis,allowed){
      const required=new Map();
      for(const [field,a]of relFields(source)){
        for(const target of analysis.before.ru.draft.relations[field]||[]){
          for(const row of await dependency(a.target,target.documentId,allowed))
            required.set(keyOf(row.uid,row.id),row);
        }
      }
      return [...required.values()];
    }

    // Remove from the future seed set any new Category whose dependencies
    // cannot be satisfied. Repeat until stable (including A → B → C).
    let changed=true;
    while(changed&&!state.stop){
      changed=false;
      for(const id of [...seedable]){
        try{await dependenciesOf(analyses.get(id),seedable);}
        catch(e){
          seedable.delete(id);
          failures.set(id,{status:safeStatus(e),reason:clean(e.message)});
          changed=true;
        }
      }
    }

    const allDependencies=new Map();
    const summary={createKK:0,fieldsChanged:0,relationsConnect:0,
      relationsDisconnect:0,dependenciesToPublish:0,publishRU:0,publishKK:0};
    state.phase='Dry-run: проверка зависимостей';render();
    for(const item of state.list){
      if(state.stop)break;
      const analysis=analyses.get(item.id);
      let status,reason='',plan=null;
      if(failures.has(item.id)){
        ({status,reason}=failures.get(item.id));
      }else if(!analysis){
        status='blocked';reason='Не удалось составить план';
      }else{
        try{
          const dependencies=await dependenciesOf(analysis,seedable);
          for(const d of dependencies)allDependencies.set(keyOf(d.uid,d.id),d);
          const fieldsChanged=Object.keys(analysis.fields.payload);
          const relations=Object.fromEntries(Object.entries(analysis.rel.changes).map(
            ([field,delta])=>[field,{connect:delta.add,disconnect:delta.remove}]));
          const relationsConnect=Object.values(relations).reduce((n,d)=>n+d.connect.length,0);
          const relationsDisconnect=Object.values(relations).reduce((n,d)=>n+d.disconnect.length,0);
          plan={createKK:analysis.createKK,fieldsChanged,relations,
            relationsConnect,relationsDisconnect,dependenciesToPublish:dependencies,
            publishRU:true,publishKK:true};
          status=plan.createKK||fieldsChanged.length||relationsConnect||relationsDisconnect?
            'planned':'already_ok';
          summary.createKK+=Number(plan.createKK);
          summary.fieldsChanged+=fieldsChanged.length;
          summary.relationsConnect+=relationsConnect;
          summary.relationsDisconnect+=relationsDisconnect;
          summary.publishRU++;
          summary.publishKK++;
          state.report.plans.push({documentId:item.id,...plan});
        }catch(e){status=safeStatus(e);reason=clean(e.message);}
      }
      const row={documentId:item.id,name:item.name,status,stage:'dry-run',
        reason,changes:plan?[
          ...(plan.createKK?['create KK']:[]),...plan.fieldsChanged,
          ...Object.keys(plan.relations).map(x=>'relation:'+x)
        ]:[],attempts:0,createKK:plan?.createKK||false,
        fieldsChanged:plan?.fieldsChanged||[],
        relationsConnect:plan?.relationsConnect||0,
        relationsDisconnect:plan?.relationsDisconnect||0,
        dependenciesToPublish:plan?.dependenciesToPublish.map(x=>keyOf(x.uid,x.id))||[],
        publishRU:plan?.publishRU||false,publishKK:plan?.publishKK||false};
      state.report.results.push(row);
      state.done++;state.current=item.name||item.id;render('Dry-run · '+item.name);
    }
    summary.dependenciesToPublish=allDependencies.size;
    state.report.dependencies=[...allDependencies.values()];
    state.report.summary=summary;
    state.phase=state.stop?'stopped':'completed';
  }

  // Categories are seeded before relations to permit mutual Category references.
  async function run(){
    try{
      if(DRY_RUN){await dryRun();return;}
      state.db=await openDB();await schemas();state.list=await allCategoryIds();
      state.total=state.list.length;
      const seeded=new Map(),pending=[];
      state.phase='Создание отсутствующих KK Draft';render();
      for(const item of state.list){
        if(state.stop)break;
        state.current=item.name||item.id;render();
        try{await seed(item);seeded.set(item.id,true);}
        catch(e){seeded.set(item.id,false);
          pending.push({item,status:safeStatus(e),reason:clean(e.message),stage:'seed'});}
      }
      const blocked=new Map(pending.map(x=>[x.item.id,x]));
      const planned=new Map();
      state.phase='Нормализация KK Draft';render();
      for(const item of state.list){
        if(state.stop)break;
        if(!seeded.get(item.id))continue;
        state.current=item.name||item.id;render();
        try{const before=await snapshot(UID,item.id);
          const job=await getJob(UID,item.id);
          if(snapshotIsComplete(before,job)){
            planned.set(item.id,{item,already:true,changes:[]});continue;
          }
          const result=await normalize(item);
          planned.set(item.id,{item,changes:result.changes});
        }catch(e){blocked.set(item.id,{item,status:safeStatus(e),reason:clean(e.message),
          stage:'normalize'});}
      }
      state.phase='Публикация Category RU и KK';render();
      const success=new Set(),attempts=new Map();
      let queue=[...planned.values()].filter(x=>!x.already);
      for(const x of blocked.values())if(x.status==='blocked'&&
        /зависим|target|KK Category|Нет KK Draft/i.test(x.reason))
        queue.push({item:x.item,changes:[],needsNormalize:true});
      for(const x of planned.values())if(x.already){success.add(x.item.id);
        result(x.item.id,x.item.name,'already_ok','complete','Без изменений, проверено по checkpoint');}
      // Retry only blocked dependencies or ordering effects; never retry an unknown write.
      let pass=0;
      while(queue.length&&!state.stop){
        pass++;let progressed=0;const postsBefore=state.post;
        const next=[];
        for(const row of queue){
          if(state.stop)break;
          const item=row.item;
          attempts.set(item.id,(attempts.get(item.id)||0)+1);
          state.current=item.name||item.id;render('Publish · проход '+pass);
          try{
            if(row.needsNormalize){
              const n=await normalize(item);row.changes=n.changes;row.needsNormalize=false;
            }
            await publishCategory(item);success.add(item.id);progressed++;
            result(item.id,item.name,'success','published','',row.changes,attempts.get(item.id));}
          catch(e){
            const status=safeStatus(e);
            const issue={item,status,reason:clean(e.message),stage:'publish'};
            blocked.set(item.id,issue);
            if(status==='blocked'&&/зависим|target|Published|KK Category|Нет KK Draft/i.test(issue.reason))
              next.push({...row,needsNormalize:true});
          }
        }
        if(!progressed&&state.post===postsBefore)break;
        queue=next;
      }
      for(const item of state.list){
        if(success.has(item.id))continue;
        const issue=blocked.get(item.id);
        if(issue)result(item.id,item.name,issue.status,issue.stage,issue.reason,[],attempts.get(item.id)||0);
        else if(state.stop)result(item.id,item.name,'blocked','stopped','Остановка пользователем');
        else result(item.id,item.name,'blocked','not_processed','Операция не завершена');
      }
      state.phase=state.stop?'stopped':'completed';
    }catch(e){
      state.phase='failed';state.report.errors.push(clean(e.message));
      console.error('[Category Localizer]',e);
      render('Ошибка инициализации: '+clean(e.message));
    }finally{
      // Full before/after snapshots and pending stages remain downloadable.
      if(state.db){
        const keys=new Set([...state.list.map(item=>keyOf(UID,item.id)),...state.touched]);
        for(const key of keys){
          const sep=key.indexOf('|'),uid=key.slice(0,sep),id=key.slice(sep+1);
          try{const job=await getJob(uid,id);if(job)state.report.journals.push(job);}
          catch(e){state.report.errors.push('Не удалось прочитать journal '+key+': '+clean(e));}
        }
      }
      state.report.finishedAt=now();
      state.report.summary={...state.report.summary,total:state.total,...rowsStatus(),get:state.get,
        put:state.put,post:state.post,retries:state.retries,phase:state.phase};
      stop.disabled=true;
      try{csv.onclick();json.onclick();}catch(e){console.error('[Category Localizer] export',e);}
      state.db?.close();window[RUN_KEY]=false;
      render('Завершено: '+state.phase+'. CSV/JSON скачаны.');
      console.log('[Category Localizer] Итог',state.report.summary);
    }
  }
  await run();
})();