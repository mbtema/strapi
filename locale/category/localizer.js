// Category Localizer RU -> KK — Strapi Console, Content Manager API.
// Run from authenticated /admin/content-manager, no dependencies.
// Default: read-only dry-run. Apply: one Category at a time; never full-scan details.
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
  const MAX_POPULATE_FIELDS = 19;
  const MAX_PARALLEL_GET = 12; // reads only; all writes remain strictly sequential
  let activeGets=0;
  const queuedGets=[];
  async function limitedGet(fn){
    // A released permit is transferred to the first waiter, never counted twice.
    if(activeGets>=MAX_PARALLEL_GET)
      await new Promise(resolve=>queuedGets.push(resolve));
    else activeGets++;
    try{return await fn();}
    finally{
      const next=queuedGets.shift();
      if(next)next();
      else activeGets--;
    }
  }
  // One-time opt-in for writes: window.tmCategoryLocalizerApplyOnce = true;
  // The flag is consumed before any CMS requests. Default is ALWAYS dry-run.
  const APPLY = window.tmCategoryLocalizerApplyOnce === true;
  const ONLY = typeof window.tmCategoryLocalizerOnlyOnce === 'string'?
    window.tmCategoryLocalizerOnlyOnce.trim():null;
  // Explicit scope is mandatory for writes: one Category, N first Category,
  // OR an intentional full-production flag. Invalid limits can never mean ALL.
  const RAW_LIMIT = window.tmCategoryLocalizerLimitOnce;
  const LIMIT = Number.isSafeInteger(RAW_LIMIT)&&RAW_LIMIT>0?RAW_LIMIT:null;
  const FULL = window.tmCategoryLocalizerFullOnce === true;
  const EXPORT_ONLY = window.tmCategoryLocalizerExportBackupsOnce === true;
  const RECOVERY_PREVIEW=typeof window.tmCategoryLocalizerRecoveryPreviewOnce==='string'?
    window.tmCategoryLocalizerRecoveryPreviewOnce.trim():null;
  const RECOVERY_APPLY=typeof window.tmCategoryLocalizerRecoveryApplyOnce==='string'?
    window.tmCategoryLocalizerRecoveryApplyOnce.trim():null;
  const RECOVERY_CONFIRM=typeof window.tmCategoryLocalizerRecoveryKeyConfirmOnce==='string'?
    window.tmCategoryLocalizerRecoveryKeyConfirmOnce.trim():null;
  delete window.tmCategoryLocalizerApplyOnce;
  delete window.tmCategoryLocalizerOnlyOnce;
  delete window.tmCategoryLocalizerLimitOnce;
  delete window.tmCategoryLocalizerFullOnce;
  delete window.tmCategoryLocalizerExportBackupsOnce;
  delete window.tmCategoryLocalizerRecoveryPreviewOnce;
  delete window.tmCategoryLocalizerRecoveryApplyOnce;
  delete window.tmCategoryLocalizerRecoveryKeyConfirmOnce;
  const DRY_RUN = !(APPLY||RECOVERY_APPLY);
  const OUTPUT_KIND=RECOVERY_APPLY?'recovery-apply':
    RECOVERY_PREVIEW?'recovery-preview':
    EXPORT_ONLY?'backup-export':DRY_RUN?'dry-run':'apply';
  const invalidLimit=RAW_LIMIT!==undefined&&LIMIT===null;
  if(invalidLimit||(APPLY&&Number(!!ONLY)+Number(!!LIMIT)+Number(FULL)!==1)||
    (EXPORT_ONLY&&(APPLY||ONLY||LIMIT||FULL||RECOVERY_PREVIEW||RECOVERY_APPLY))||
    (RECOVERY_PREVIEW&&(APPLY||ONLY||LIMIT||FULL||EXPORT_ONLY||RECOVERY_APPLY||
      RECOVERY_CONFIRM||!/^[a-z0-9]{24}$/.test(RECOVERY_PREVIEW)))||
    (RECOVERY_APPLY&&(APPLY||ONLY||LIMIT||FULL||EXPORT_ONLY||RECOVERY_PREVIEW||
      !/^[a-z0-9]{24}$/.test(RECOVERY_APPLY)||
      !/^[a-z0-9]{16}$/.test(RECOVERY_CONFIRM||'')))||
    (!RECOVERY_APPLY&&!!RECOVERY_CONFIRM)){
    console.error('[Category Localizer] Запуск запрещён: укажи ровно один режим'+
      ' Apply — OnlyOnce (documentId), LimitOnce (целое число > 0),'+
      ' либо FullOnce = true. RecoveryPreviewOnce допускает только один documentId'+
      ' без флагов записи. RecoveryApplyOnce требует точный documentId и'+
      ' RecoveryKeyConfirmOnce (16 символов), без любых других режимов.'+
      ' Некорректный LimitOnce не означает FULL.');
    return;
  }
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
    retries:0,populateGET:0,populateHits:0,nativeFallbacks:0,
    schemas:new Map(),components:new Map(),list:[],db:null,touched:new Set(),
    publishedNestedCountOnly:new Set(),report:{
      tool:'category-localizer',version:4,mode:OUTPUT_KIND,
      startedAt:new Date().toISOString(),finishedAt:null,
      results:[],operations:[],journals:[],errors:[],snapshots:[],plans:[],summary:null}};
  const $ = (tag, text) => { const e=document.createElement(tag); if(text!==undefined)e.textContent=text; return e; };
  document.getElementById('tm-category-localizer-panel')?.remove();
  const panel=$('section'); panel.id='tm-category-localizer-panel';
  panel.style.cssText='position:fixed;right:16px;bottom:16px;z-index:2147483600;'+
    'background:#202035;color:#fff;padding:14px;border:1px solid #7774b5;border-radius:10px;'+
    'width:min(490px,calc(100vw - 32px));max-height:75vh;overflow:auto;'+
    'box-shadow:0 10px 32px #0009;font:13px/1.5 system-ui';
  const heading=$('strong','Category Localizer · '+
    (RECOVERY_APPLY?'RECOVERY APPLY · один RU Draft PUT без Publish':
      RECOVERY_PREVIEW?'RECOVERY PREVIEW · только GET':
      DRY_RUN?'DRY RUN · только GET':'APPLY · RU → KK'));
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
  const rowsStatus=()=>Object.fromEntries(['planned','success','partial_published','partial','already_ok','blocked','unresolved','error'].map(k=>
    [k,state.report.results.filter(v=>v.status===k).length]));
  function render(line='') {
    const c=rowsStatus();
    message.textContent=(line||state.phase)+'\n'+state.done+'/'+(state.total||'?')+
      ' Category · '+state.current+'\n'+
      (DRY_RUN?'Планируется '+c.planned+' · уже нормализовано '+c.already_ok:
        'Успешно '+c.success+' · частично '+(c.partial+c.partial_published)+
        ' · без изменений '+c.already_ok)+
      ' · blocked '+c.blocked+' · unresolved '+c.unresolved+' · errors '+c.error+'\n'+
      'GET '+state.get+' · PUT '+state.put+' · POST '+state.post+' · retries '+state.retries;
  }
  const csvFields=['documentId','name','status','stage','changes','reason','attempts',
    'createKK','fieldsChanged','relationsConnect','relationsDisconnect',
    'dependenciesToPublish','publishRU','publishKK','pendingLinks',
    'pendingFields','pendingPublications','publicationWarnings'];
  const q=x=>{let s=Array.isArray(x)?x.join(' | '):String(x??'');
    if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  function download(name,content,type){
    const url=URL.createObjectURL(new Blob([content],{type}));
    const a=$('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),20000);
  }
  csv.onclick=()=>download('category-localizer-'+OUTPUT_KIND+'.csv','\uFEFF'+[
    csvFields.join(';'),...state.report.results.map(row=>csvFields.map(f=>q(row[f])).join(';'))
  ].join('\n'),'text/csv;charset=utf-8');
  json.onclick=()=>download('category-localizer-'+OUTPUT_KIND+'.json',JSON.stringify(state.report,null,2),
    'application/json;charset=utf-8');
  const stopCheck=()=>{if(state.stop)throw Object.assign(Error('Остановка пользователем'),{stop:true});};
  class Blocked extends Error {constructor(message){super(message);this.blocked=true;}}
  // Unknown outcome is a global stop: never continue bulk writes after one ambiguous mutation.
  class Unresolved extends Error {constructor(message){super(message);this.unresolved=true;this.fatal=true;}}
  class IntegrityViolation extends Error {
    constructor(message,after){super(message);this.integrity=true;this.fatal=true;this.after=after;}
  }

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
    const tx=state.db.transaction('jobs',kind==='put'?'readwrite':'readonly');
    const store=tx.objectStore('jobs');
    const req=kind==='get'?store.get(value):
      kind==='all'?store.getAll():store.put(value);
    let result;
    req.onsuccess=()=>{result=req.result;};
    tx.oncomplete=()=>resolve(result); // durability: commit before making HTTP write
    req.onerror=()=>reject(req.error);
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error||Error('IndexedDB transaction aborted'));
  });}
  const keyOf=(uid,id)=>uid+'|'+id;
  const getJob=async(uid,id)=>{
    try{return await dbOp('get',keyOf(uid,id));}
    catch(e){e.fatal=true;throw e;}
  };
  const putJob=async job=>{
    try{return await dbOp('put',job);}
    catch(e){e.fatal=true;throw e;}
  };
  async function writeJournal(uid,id,stage,before,expected,extra={}){
    const prior=await getJob(uid,id);
    const incidents=[...(prior?.incidents||[])];
    if(prior?.phase?.startsWith('pending-')&&prior.failure)
      incidents.push({at:prior.at,phase:prior.phase,
        before:prior.before,expected:prior.expected,failure:prior.failure});
    const job={key:keyOf(uid,id),uid,id,
      history:prior?.history||[],recoveries:prior?.recoveries||[],incidents,
      phase:'pending-'+stage,at:now(),before,expected,
      lastVerified:prior?.lastVerified||null,...extra};
    await putJob(job);state.touched.add(job.key);return job;
  }
  async function failedJournal(job,after,error){
    job.failure={at:now(),reason:clean(error.message||error),
      integrity:error.integrity===true,after:after||null};
    await putJob(job);state.touched.add(job.key);
    state.report.operations.push({key:job.key,stage:job.phase,verified:false,
      at:now(),integrity:error.integrity===true,reason:clean(error.message||error)});
  }
  async function stopWithEvidence(job,after,failure){
    try{await failedJournal(job,after,failure);}
    catch(storageError){
      // Never lose the fatal stop even when IndexedDB is full/unavailable.
      console.error('[Category Localizer] СБОЙ ЗАПИСИ BACKUP',storageError);
      failure.message+='; backup update error: '+clean(storageError);
    }
    throw failure;
  }
  async function verifiedJournal(job,after){
    if(job.failure){
      // Reconciliation proved the result from GET; retain the former reason,
      // but do not leave a resolved failure marked as active.
      job.recoveries=[...(job.recoveries||[]),{
        at:now(),stage:job.phase.slice(8),reason:job.failure.reason}];
      delete job.failure;
    }
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
      if(response.status===401||response.status===403)error.fatal=true;
      throw error;
    }
  }
  const get=(path,allow404=false)=>limitedGet(()=>request('GET',path,undefined,allow404));
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
      // Read snapshots even when nested component relations are populated.
      // Empty nested relations normalize to null, never to a {count:0} payload.
      if(Array.isArray(value))return canonical(value);
      const count=Number.isSafeInteger(value?.count)?value.count:
        value?.documentId||value?.id?1:0;
      return count?canonical(value):null;
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
  function populatedRelation(value,original,locale){
    const count=Number.isSafeInteger(original?.count)&&original.count>=0?
      original.count:null;
    if(count===null)return null;
    let candidates;
    if(Array.isArray(value))candidates=value;
    else if(value===null&&count===0)candidates=[];
    else if(value&&typeof value==='object'&&value.documentId)candidates=[value];
    else return null;
    if(candidates.length!==count)return null;
    const result=[];
    for(const row of candidates){
      if(typeof row?.documentId!=='string'||!row.documentId||
        !Number.isSafeInteger(row.id)||row.id<=0||
        (row.locale!=null&&row.locale!==locale))return null;
      result.push({id:row.id,documentId:row.documentId,locale:row.locale||locale});
    }
    if(uniq(result.map(x=>x.documentId)).length!==result.length)return null;
    return result.sort((a,b)=>a.documentId.localeCompare(b.documentId));
  }
  // Product Localizer's proven scalable approach: one populated GET per 19 fields,
  // then exact native GET for every incomplete/unsupported field.
  async function populatedRelations(uid,id,locale,status,row,schema){
    const output={},names=relFields(schema).map(([f])=>f);
    for(let i=0;i<names.length;i+=MAX_POPULATE_FIELDS){
      const group=names.slice(i,i+MAX_POPULATE_FIELDS);
      const q=new URLSearchParams({locale,status});
      for(const f of group)q.set('populate['+f+'][fields][0]','documentId');
      let expanded=null;
      try{
        state.populateGET++;
        const data=await get('/content-manager/collection-types/'+uid+'/'+
          encodeURIComponent(id)+'?'+q);
        const v=data?.data;
        if(v?.documentId!==id||v.locale!==locale||
          (status==='published'&&!v.publishedAt))
          throw new Error('Неоднозначный populated detail '+uid+'/'+id+'/'+locale);
        expanded=v;
      }catch(e){
        if(e.httpStatus===401||e.httpStatus===403)throw e;
        // Do not infer from a failed populate: every field uses the native API.
        console.warn('[Category Localizer] Populate fallback '+uid+'/'+id+' '+clean(e.message));
      }
      const missing=[];
      for(const field of group){
        const candidate=expanded&&populatedRelation(expanded[field],row[field],locale);
        if(candidate!==null){output[field]=candidate;state.populateHits++;}
        else missing.push(field);
      }
      if(missing.length){
        state.nativeFallbacks+=missing.length;
        const rows=await Promise.all(missing.map(async f=>
          [f,await relations(uid,id,f,locale,status)]));
        for(const [f,r]of rows)output[f]=r;
      }
    }
    return output;
  }
  async function version(uid,id,locale,status){
    const row=await detail(uid,id,locale,status);if(!row)return null;
    const s=state.schemas.get(uid);
    if(!s?.attributes)throw new Blocked('Нет схемы зависимости '+uid);
    const root=await populatedRelations(uid,id,locale,status,row,s);
    const fields=recordFields(s,row),nested={};
    if(uid===UID&&Array.isArray(row.brandZoneBanners)&&row.brandZoneBanners.length){
      const componentUid='sections.brand-zone-banners';
      if(status==='draft'){
        nested.brandZoneBanners=await Promise.all(row.brandZoneBanners.map(async (part,i)=>{
          if(!Number.isSafeInteger(part?.id)||part.id<=0)
            throw new Blocked('Нет numeric ID brandZoneBanners['+i+']');
          const links=await relations(componentUid,part.id,'products',locale,status);
          const count=part.products?.count;
          if(!Number.isSafeInteger(count)||count<0||links.length!==count)
            throw new Blocked('Неполные вложенные relations brandZoneBanners['+i+
              ']: получено '+links.length+' из '+count);
          return links;
        }));
        if(!Array.isArray(fields.brandZoneBanners)||
          fields.brandZoneBanners.length!==nested.brandZoneBanners.length)
          throw new Blocked('Неверный компонент brandZoneBanners в detail');
        for(let i=0;i<nested.brandZoneBanners.length;i++)
          fields.brandZoneBanners[i].products=asIds(nested.brandZoneBanners[i]);
      }else{
        // Confirmed live on 2026-11-17: Published component numeric IDs
        // return 0 from native relations GET even with detail count:3.
        // Never treat this 0 as a true empty relation; expose count-only proof.
        for(const [i,part] of row.brandZoneBanners.entries()){
          const count=part.products?.count;
          if(!Number.isSafeInteger(part?.id)||part.id<=0||
            !Number.isSafeInteger(count)||count<0)
            throw new Blocked('Нет достоверного Published count brandZoneBanners['+i+']');
          fields.brandZoneBanners[i].products={count};
        }
        state.publishedNestedCountOnly.add(keyOf(uid,id));
      }
    }
    return {row,fields,relations:root,nested};
  }
  async function draftPair(uid,id){
    const [ru,kk]=await Promise.all([
      version(uid,id,'ru','draft'),version(uid,id,'kk','draft')]);
    return {ru:{draft:ru,published:null},kk:{draft:kk,published:null}};
  }
  async function withPublished(uid,id,pair){
    const [ru,kk]=await Promise.all([
      version(uid,id,'ru','published'),version(uid,id,'kk','published')]);
    return {ru:{draft:pair.ru.draft,published:ru},
      kk:{draft:pair.kk.draft,published:kk}};
  }
  async function snapshot(uid,id){
    return withPublished(uid,id,await draftPair(uid,id));
  }
  const relIDs=v=>Object.fromEntries(Object.entries(v?.relations||{}).map(([f,r])=>[f,asIds(r)]));
  function sameFields(a,b){
    if(eq(a,b))return true;
    if(!a||!b||!Array.isArray(a.brandZoneBanners)||
      !Array.isArray(b.brandZoneBanners))return false;
    // Only array(documentIds) vs Published {count} uses count comparison.
    // Two Draft arrays ALWAYS compare their exact documentIds.
    const normalize=(source,other)=>({...source,
      brandZoneBanners:source.brandZoneBanners.map((part,i)=>{
        const p=part?.products,op=other.brandZoneBanners[i]?.products;
        return Array.isArray(p)&&Number.isSafeInteger(op?.count)?
          {...part,products:{count:p.length}}:part;
      })
    });
    return eq(normalize(a,b),normalize(b,a));
  }
  const sameVersion=(a,b)=>a===null&&b===null||!!a&&!!b&&
    sameFields(a.fields,b.fields)&&eq(relIDs(a),relIDs(b));
  // Live 2026-11-17: Category Draft.key=null, while the existing
  // Published.key is non-null. Strapi preserved the old value on RU publish.
  // Treat ONLY this unchanged legacy discrepancy as aligned; never overwrite
  // or silently accept a different key, or ignore any other field/relation.
  function preservedPublishedKey(draft,published){
    if(!draft||!published||draft.fields?.key!==null||
      !nonEmpty(published.fields?.key))return false;
    return sameFields(draft.fields,{...published.fields,key:null})&&
      eq(relIDs(draft),relIDs(published));
  }
  const publicationAligned=(draft,published)=>
    sameVersion(draft,published)||preservedPublishedKey(draft,published);
  const publicationWarnings=snap=>['ru','kk'].filter(locale=>
    preservedPublishedKey(snap[locale].draft,snap[locale].published)).map(locale=>
    locale+'.published.key: сохранено историческое значение; Draft.key=null');
  function assertSafeCategoryKey(uid,snap){
    if(uid!==UID)return;
    const ruKey=snap?.ru?.draft?.fields?.key;
    const kkKey=snap?.kk?.draft?.fields?.key;
    // LIVE 2026-11-18: KK PUT with RU Draft.key present and KK Draft.key null
    // unexpectedly erased RU Draft.key. Do not risk this mismatch again.
    // No automatic repair or silent omission of the nonlocalized unique key.
    if(nonEmpty(ruKey)&&!eq(ruKey,kkKey))
      throw new Blocked('Запись запрещена: RU Draft.key='+clean(ruKey)+
        ', KK Draft.key='+clean(kkKey)+
        '. Известный риск удаления RU key при сохранении KK; нужна отдельная коррекция.');
  }
  const intact=(before,after)=>sameVersion(before.ru.draft,after.ru.draft)&&
    sameVersion(before.ru.published,after.ru.published);
  function immutableIntact(before,after,stage){
    if(stage==='publish-ru')return sameVersion(before.ru.draft,after.ru.draft)&&
      sameVersion(before.kk.draft,after.kk.draft)&&
      sameVersion(before.kk.published,after.kk.published);
    return intact(before,after);
  }
  function identicalDraftTarget(actual,expected){
    if(!actual||!expected)return false;
    return eq(actual.fields,expected.fields)&&eq(relIDs(actual),relIDs(expected));
  }
  const emptyRel=()=>({});
  function validateNestedRelations(attr,value,path){
    if(value==null)return;
    if(attr.type==='relation'){
      const count=Array.isArray(value)?value.length:
        Number.isSafeInteger(value?.count)?value.count:
        value?.documentId||value?.id?1:0;
      if(count)throw new Blocked('Неподдержанная вложенная relation '+path);
      return;
    }
    const component=(uid,row,p)=>{
      const schema=state.components.get(uid);
      if(!schema?.attributes)throw new Blocked('Нет schema компонента '+uid);
      for(const [field,a]of fieldsOf(schema))if(Object.hasOwn(row||{},field))
        validateNestedRelations(a,row[field],p+'.'+field);
    };
    if(attr.type==='component'){
      for(const [i,row] of (attr.repeatable?(Array.isArray(value)?value:[]):[value]).entries())
        if(row!=null)component(attr.component,row,path+'['+i+']');
    }
    if(attr.type==='dynamiczone'&&Array.isArray(value)){
      for(const [i,row]of value.entries())
        if(row?.__component)component(row.__component,row,path+'['+i+']');
    }
  }
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
    if(field==='filters_app'){
      validateNestedRelations(attr,ru,path);
      return canonicalField(attr,ru,path);
    } // full sync, explicit exception
    if(field==='title'||attr.type==='boolean')return canonicalField(attr,ru,path);
    if(attr.type==='media')return hasKK?canonicalField(attr,kk,path):undefined;
    if(attr.type==='component'||attr.type==='dynamiczone'){
      // Localized containers may contain both local and shared nested fields.
      if(!localized(attr)&&field!=='brandZoneBanners')
        validateNestedRelations(attr,ru,path);
      if(ru==null)return localized(attr)&&hasKK?canonicalField(attr,kk,path):ru;
      if(attr.type==='component'){
        const one=(r,k,p)=>mergedComponent(attr.component,r,k,p);
        if(attr.repeatable){
          if(!Array.isArray(ru))throw new Blocked('Неверный RU компонент '+path);
          if(hasKK&&kk!=null&&(!Array.isArray(kk)||
            (field!=='brandZoneBanners'&&kk.length!==ru.length)))
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
    if(attr.type==='relation'&&/^brandZoneBanners\[\d+\]\.products$/.test(path))
      return canonicalField(attr,ru,path);
    if(attr.type==='relation')throw new Blocked('Вложенная relation '+path);
    return canonicalField(attr,ru,path);
  }
  function planFields(s,ru,kk,allowPartial=false){
    const payload={},expected=kk?{...kk.fields}:{},skippedFields=[];
    for(const [f,a]of fieldsOf(s)){
      if(a.type==='relation')continue;
      let v;
      try{v=desiredField(f,a,
        f==='brandZoneBanners'?ru.fields[f]:ru.row[f],
        f==='brandZoneBanners'?kk?.fields?.[f]:kk?.row?.[f],!!kk,f);}
      catch(e){
        if(!allowPartial||!(e instanceof Blocked)||(!kk&&a.required))throw e;
        skippedFields.push({field:f,reason:clean(e.message)});
        continue;
      }
      if(v===undefined){if(a.required===true)throw new Blocked('Обязательный перевод отсутствует: '+f);
        continue;}
      if(!kk||!eq(v,kk.fields[f]))payload[f]=v;
      expected[f]=v;
    }
    return {payload,expected,skippedFields};
  }
  // Mirror nested banner relations by documentId, preserving KK component IDs.
  // Native relation GET identifies actual links; a count alone is never treated as a link list.
  async function bannerPlan(ru,kk,expected){
    if(ru?.fields?.brandZoneBanners==null){
      const old=kk?.fields?.brandZoneBanners??null;
      return {changed:old!==null,wanted:null,parts:null,pending:[],
        newTargets:[],connected:0,disconnected:0};
    }
    const src=ru?.fields?.brandZoneBanners||[];
    const dst=kk?.fields?.brandZoneBanners||[];
    const dstRows=kk?.row?.brandZoneBanners||[];
    if(!Array.isArray(src)||!Array.isArray(dst)||!Array.isArray(expected))
      throw new Blocked('Неверная структура brandZoneBanners');
    const parts=[],wanted=[],pending=[],newTargets=[];
    let connected=0,disconnected=0;
    for(let i=0;i<src.length;i++){
      const sourceIDs=src[i]?.products;
      if(!Array.isArray(sourceIDs))
        throw new Blocked('Неполная вложенная relation brandZoneBanners['+i+']');
      const present=kk?.nested?.brandZoneBanners?.[i]||[];
      const byId=new Map(present.map(x=>[x.documentId,x]));
      const set=new Set(present.map(x=>x.documentId));
      const connect=[],disconnect=[];
      for(const documentId of sourceIDs){
        if(set.has(documentId))continue;
        const target=await targetDraftId('api::product.product',documentId);
        if(!target.id){
          pending.push({field:'brandZoneBanners['+i+'].products',
            targetUid:'api::product.product',documentId,
            reason:target.reason||'KK Draft отсутствует'});
          continue;
        }
        connect.push({id:target.id,documentId,locale:target.locale});
        newTargets.push({uid:'api::product.product',id:documentId});
        set.add(documentId);connected++;
      }
      for(const [documentId,old]of byId)
        if(!sourceIDs.includes(documentId)){
          disconnect.push({id:old.id,documentId,locale:old.locale||'kk'});
          set.delete(documentId);disconnected++;
        }
      const part={...expected[i],products:[...set].sort()};
      wanted.push(part);
      const payload={...part};
      if(dstRows[i]?.id){
        if(!Number.isSafeInteger(dstRows[i].id))throw new Blocked('Неверный KK component ID');
        payload.id=dstRows[i].id;
      }
      payload.products={connect,disconnect};
      parts.push(payload);
    }
    return {changed:!eq(wanted,dst),wanted,parts,pending,newTargets,
      connected,disconnected};
  }
  function stripBannerLinks(parts){
    if(parts==null)return parts;
    if(!Array.isArray(parts))throw new Blocked('Неожиданная структура brandZoneBanners');
    return parts.map(part=>({...part,products:[]}));
  }
  function seedBannerPayload(parts){
    if(parts==null)return parts;
    return parts.map(part=>({...part,products:{connect:[],disconnect:[]}}));
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
  function matchPublish(before,after,expected,locale,uid){
    if(!after[locale].draft||!after[locale].published)return false;
    const oldPublished=before[locale].published;
    const newPublished=after[locale].published;
    // A new Published version, not merely a successful HTTP response.
    if(!newPublished.row?.publishedAt||
      newPublished.row.publishedAt===oldPublished?.row?.publishedAt)return false;
    const previousKey=oldPublished?.fields?.key;
    let actualFields=newPublished.fields;
    if(uid===UID&&expected.fields?.key===null&&nonEmpty(previousKey)){
      // Preserve the exact previously published key; clearing it is data loss.
      if(!eq(actualFields.key,previousKey))return false;
      actualFields={...actualFields,key:null};
    }
    const other=locale==='ru'?'kk':'ru';
    return sameVersion(before[other].draft,after[other].draft)&&
      sameVersion(before[other].published,after[other].published)&&
      sameVersion(before[locale].draft,after[locale].draft)&&
      sameFields(actualFields,expected.fields)&&
      eq(relIDs(newPublished),expected.relations);
  }
  function matchPending(job,after){
    if(!job?.phase?.startsWith('pending-')||!job.before||!job.expected)return false;
    const phase=job.phase.slice(8);
    if(phase==='seed')return matchSeed(job.before,after,job.expected);
    if(phase==='save')return matchSave(job.before,after,job.expected);
    if(phase==='publish-ru')return matchPublish(job.before,after,job.expected,'ru',job.uid);
    if(phase==='publish-kk'||phase==='publish-dependency')
      return matchPublish(job.before,after,job.expected,'kk',job.uid);
    return false;
  }
  async function reconcile(uid,id){
    const job=await getJob(uid,id);
    if(job?.phase==='quarantine-ru-drift')
      throw new IntegrityViolation('Category в карантине после нарушения RU: '+uid+'/'+id,
        job.failure?.after);
    if(!job?.phase?.startsWith('pending-'))return job;
    if(!job.before)throw new Unresolved('Нет prewrite snapshot в pending journal '+uid+'/'+id);
    let after;
    try{after=await snapshot(uid,id);}
    catch(e){throw new Unresolved('Recovery snapshot недоступен '+uid+'/'+id+': '+clean(e));}
    if(!immutableIntact(job.before,after,job.phase.slice(8)))
      await stopWithEvidence(job,after,new IntegrityViolation(
        'При recovery обнаружено изменение RU '+uid+'/'+id,after));
    if(!matchPending(job,after))
      await stopWithEvidence(job,after,new Unresolved('Незавершённая '+job.phase+
        ': GET-сверка не подтвердила результат'));
    await verifiedJournal(job,after);
    return job;
  }
  function matchingBaseline(before,after){
    return ['ru','kk'].every(locale=>
      ['draft','published'].every(status=>
        sameVersion(before?.[locale]?.[status],after?.[locale]?.[status])));
  }
  async function checkedWrite(uid,id,stage,before,expected,method,path,payload,verify){
    // Four full versions, including ALL root relations and nested Draft links.
    // Any change since preparation invalidates the write, even in a single-user CMS.
    const fresh=await snapshot(uid,id);
    assertSafeCategoryKey(uid,fresh);
    if(!matchingBaseline(before,fresh)){
      if(!intact(before,fresh)){
        const issue=new IntegrityViolation('RU изменилась ДО '+stage+
          ' между сохранённым снимком и записью '+uid+'/'+id,fresh);
        const old=await getJob(uid,id);
        const job=old||{key:keyOf(uid,id),uid,id,history:[]};
        job.phase='quarantine-ru-drift';job.before=before;
        job.failure={at:now(),reason:clean(issue.message),integrity:true,after:fresh};
        await putJob(job);state.touched.add(job.key);
        throw issue;
      }
      throw new Blocked('KK или Published изменились между snapshot и '+stage+
        '. Запись пропущена; нужен новый проход');
    }
    const pending=await writeJournal(uid,id,stage,fresh,expected,{method,path});
    let error=null;
    try{await request(method,path,payload);}catch(e){error=e;}
    let after=null;
    try{after=await snapshot(uid,id);}catch(e){error ||= e;}
    // Strapi can mutate RU during a KK save/publish. Stop the WHOLE batch immediately,
    // preserve before + after snapshots in IndexedDB; do not blindly overwrite RU.
    if(after&&!immutableIntact(fresh,after,stage)){
      const failure=new IntegrityViolation(stage+
        ': нарушение целостности RU Draft/Published после записи',after);
      await stopWithEvidence(pending,after,failure);
    }
    if(!after||!verify(fresh,after,expected)){
      const failure=new Unresolved(stage+': '+
        clean(error||'проверка после записи не пройдена'));
      await stopWithEvidence(pending,after,failure);
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
      if(uid===UID&&f==='brandZoneBanners'&&Array.isArray(draft.fields[f])){
        const parts=draft.fields[f],rows=draft.row[f]||[];
        const nested=draft.nested?.brandZoneBanners||[];
        if(parts.length!==rows.length||parts.length!==nested.length)
          throw new Blocked('Нет вложенных links для публикации brandZoneBanners');
        payload[f]=parts.map((part,i)=>({
          ...part,id:rows[i].id,
          products:{connect:nested[i].map(x=>({id:x.id,documentId:x.documentId,
            locale:x.locale||locale})),disconnect:[]}
        }));
        continue;
      }
      payload[f]=draft.fields[f];
    }
    return payload;
  }
  async function uniquePreflight(id,s,targetFields,ruRow,kkRow,onlyFields){
    // Apply only to unique values actually being written. A positive control
    // prevents silent ignoring of Content Manager's filter query.
    for(const field of onlyFields){
      const a=s.attributes[field];
      if(a?.unique!==true||!nonEmpty(targetFields[field]))continue;
      const val=String(targetFields[field]);
      const source=String(ruRow?.[field]??'');
      const current=String(kkRow?.[field]??'');
      const control=source===val?'ru':current===val?'kk':null;
      if(!control)throw new Blocked('Нет positive control unique '+field);
      async function matches(locale){
        const query=new URLSearchParams({locale,status:'draft',page:'1',
          pageSize:String(PAGE_SIZE)});
        query.set('filters['+field+'][$eq]',val);
        const data=parseList(await get('/content-manager/collection-types/'+UID+'?'+query),1);
        if(data.total>PAGE_SIZE)throw new Blocked('Неполный unique поиск '+field);
        return data.rows.map(item=>item?.attributes&&!item.documentId?
          {...item.attributes,id:item.id}:item);
      }
      const [controlRows,otherRows]=await Promise.all([
        matches(control),matches(control==='ru'?'kk':'ru')]);
      if(!controlRows.some(row=>row?.documentId===id))
        throw new Blocked('Unique filter не прошёл контроль '+field);
      for(const row of [...controlRows,...otherRows])
        if(row?.documentId!==id)
          throw new Blocked('Конфликт unique '+field+' с '+row?.documentId);
    }
  }
  const safeStatus=e=>e instanceof Blocked?'blocked':e instanceof Unresolved?'unresolved':'error';
  // Read-only preflight: no IndexedDB, PUT or POST. Capture all four versions
  // and their exact native root relations before proposing any action.
  async function dryRun(){
    await schemas();
    state.list=await allCategoryIds();
    if(ONLY){
      state.list=state.list.filter(item=>item.id===ONLY);
      if(!state.list.length)throw Error('Category documentId не найден: '+ONLY);
    }else if(LIMIT)state.list=state.list.slice(0,LIMIT);
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


  // Apply uses the list of RU IDs only. All data is read just-in-time per Category.
  // Missing KK targets are postponed for the next MANUAL run, never recursively seeded.
  const targetIdCache=new Map();
  const dependencyPublicationCache=new Map();
  async function targetDraftId(uid,id){
    const s=state.schemas.get(uid);
    if(!s?.attributes)throw new Blocked('Неизвестная схема target '+uid);
    const locale=s.pluginOptions?.i18n?.localized===true?'kk':'ru';
    const key=uid+'|'+id+'|'+locale;
    if(targetIdCache.has(key))return {id:targetIdCache.get(key),locale};
    const row=await detail(uid,id,locale,'draft');
    if(!row)return {id:null,locale,reason:'Нет '+locale.toUpperCase()+' Draft'};
    if(!Number.isSafeInteger(row.id)||row.id<=0)
      throw new Blocked('Неверный numeric target ID '+key);
    targetIdCache.set(key,row.id);
    return {id:row.id,locale};
  }
  async function publishDependencyOnce(uid,id){
    const key=keyOf(uid,id);
    if(dependencyPublicationCache.has(key))return dependencyPublicationCache.get(key);
    const schema=state.schemas.get(uid);
    if(!schema?.attributes)return {uid,id,reason:'Нет schema зависимости'};
    // Category locales are created/published by the stream, not recursively.
    if(uid===UID||schema.pluginOptions?.i18n?.localized!==true)return null;
    try{
      await reconcile(uid,id);
      if(await detail(uid,id,'kk','published')){
        dependencyPublicationCache.set(key,null);
        return null;
      }
      if(!await detail(uid,id,'ru','published')){
        const issue={uid,id,reason:'RU Published отсутствует'};
        dependencyPublicationCache.set(key,issue);
        return issue;
      }
      const before=await snapshot(uid,id);
      if(!before.kk.draft){
        const issue={uid,id,reason:'Нет KK Draft'};
        dependencyPublicationCache.set(key,issue);
        return issue;
      }
      if(before.kk.published){
        dependencyPublicationCache.set(key,null);
        return null;
      }
      confirmPublishable(uid,before);
      await publishFrom(uid,id,'kk',before);
      dependencyPublicationCache.set(key,null);
      state.report.operations.push({key,stage:'dependency-published',verified:true,at:now()});
      return null;
    }catch(e){
      // An ambiguous or integrity-breaking write must stop ALL further work.
      if(e.fatal||e.unresolved||e.integrity)throw e;
      const issue={uid,id,reason:clean(e.message),status:safeStatus(e)};
      dependencyPublicationCache.set(key,issue);
      return issue;
    }
  }
  function needsResume(job){
    return !!job&&['verified-seed','verified-save','verified-publish-ru',
      'verified-publish-kk'].includes(job.phase);
  }
  function verifiedPhaseStillCurrent(job,snap){
    return !!job?.lastVerified&&['ru','kk'].every(locale=>
      ['draft','published'].every(status=>
        sameVersion(snap[locale][status],job.lastVerified[locale][status])));
  }
  function confirmPublishable(uid,snap){
    // Do not send populated, non-root component relations inside a Publish payload
    // until their Strapi write semantics have been confirmed independently.
    const schema=state.schemas.get(uid);
    for(const locale of ['ru','kk']){
      const row=snap[locale].draft?.row;
      if(!row)continue;
      for(const [field,attr]of fieldsOf(schema)){
        if((attr.type==='component'||attr.type==='dynamiczone')&&
          !(uid===UID&&field==='brandZoneBanners'))
          validateNestedRelations(attr,row[field],field);
      }
    }
  }
  async function publishFrom(uid,id,locale,before){
    const draft=before[locale].draft;
    if(!draft)throw new Blocked('Нет '+locale+' Draft при Publish '+id);
    const expected={fields:draft.fields,relations:relIDs(draft)};
    const path='/content-manager/collection-types/'+uid+'/'+encodeURIComponent(id)+
      '/actions/publish?locale='+locale;
    return checkedWrite(uid,id,'publish-'+locale,before,expected,'POST',path,
      publishPayload(uid,locale,draft),(a,b,e)=>matchPublish(a,b,e,locale,uid));
  }
  async function applyOne(item){
    const uid=UID,id=item.id,s=state.schemas.get(uid);
    const previous=await reconcile(uid,id);
    let pair=await draftPair(uid,id);
    if(!pair.ru.draft)throw new Blocked('RU Draft отсутствует');
    // Early gate avoids extra GET and planning for a known unsafe key mismatch.
    assertSafeCategoryKey(uid,pair);
    if(asIds(pair.ru.draft.relations.products||[]).length)
      throw new Blocked('RU legacy products не пуст — пропуск Category');
    const createKK=!pair.kk.draft;
    if(createKK&&await detail(uid,id,'kk','published'))
      throw new Blocked('KK Published существует без KK Draft');
    let fields=planFields(s,pair.ru.draft,pair.kk.draft,true);
    let rel=relationPlan(s,pair.ru.draft,pair.kk.draft);
    const requested=Object.keys(fields.payload).length+
      Object.keys(rel.changes).length+Number(createKK);
    let before=null;
    let needsPublication=false;
    // Draft can already match RU while KK Published is missing or outdated.
    // Do not call this already_ok without checking BOTH Published versions.
    if(!requested&&!needsResume(previous)){
      before=await withPublished(uid,id,pair);
      // This tool never changes RU business values. Existing RU Published drift
      // is not a reason to Publish RU or overwrite a colleague's historical data.
      needsPublication=!publicationAligned(before.kk.draft,before.kk.published);
      if(!needsPublication){
        const ruDrift=!publicationAligned(before.ru.draft,before.ru.published);
        const pendingFields=[...fields.skippedFields,
          ...(ruDrift?[{field:'ru.published',reason:
            'RU Draft и Published различались до запуска; RU не перезаписывается'}]:[])];
        return {status:pendingFields.length?'partial':'already_ok',
          stage:'checked',changes:[],pendingLinks:[],pendingFields,
          publicationWarnings:publicationWarnings(before),
          reason:pendingFields.length?'Отложены неподдержанные поля или RU Published':''};
      }
    }
    // Fast path: no mutable operation exists while every missing connect
    // still lacks KK Draft. Avoid loading both Published versions for this case.
    if(!createKK&&!needsResume(previous)&&!Object.keys(fields.payload).length&&
      Object.values(rel.changes).every(x=>!x.remove.length)){
      const deferred=[];let available=false;
      for(const [field,delta]of Object.entries(rel.changes))
        for(const targetId of delta.add){
          const target=await targetDraftId(delta.targetUid,targetId);
          if(target.id){available=true;break;}
          deferred.push({field,targetUid:delta.targetUid,documentId:targetId,
            reason:target.reason||'Нет KK Draft'});
        }
      if(!available){
        before=await withPublished(uid,id,pair);
        needsPublication=!publicationAligned(before.kk.draft,before.kk.published);
        if(!needsPublication)return {status:'partial',stage:'checked',changes:[],
          pendingLinks:deferred,pendingFields:fields.skippedFields,
          reason:'Связи ожидают создания KK Draft в следующих проходах'};
      }
    }
    // Full prewrite backup includes all four versions and exact native relations.
    before ||= await withPublished(uid,id,pair);
    let didSeed=false,didSave=false;
    // Check ALL populated unique values (including localized KK bitrix_id)
    // before the first write, not only fields changed in this pass.
    const uniqueFields=fieldsOf(s).filter(([field,a])=>
      a.unique===true&&nonEmpty(fields.expected[field])).map(([field])=>field);
    if(uniqueFields.length)await uniquePreflight(id,s,fields.expected,
      before.ru.draft.row,before.kk.draft?.row,uniqueFields);
    // For potentially published data, ensure every non-root relation is understood.
    confirmPublishable(uid,before);
    if(createKK){
      const seedFields=structuredClone(fields.expected);
      const seedPayload={...fields.payload};
      if(Object.hasOwn(seedFields,'brandZoneBanners')){
        seedFields.brandZoneBanners=stripBannerLinks(seedFields.brandZoneBanners);
        seedPayload.brandZoneBanners=seedBannerPayload(seedFields.brandZoneBanners);
      }
      const expectedSeed={fields:seedFields,relations:
        Object.fromEntries(relFields(s).map(([field])=>[field,[]]))};
      const path='/content-manager/collection-types/'+uid+'/'+encodeURIComponent(id)+'?locale=kk';
      before=await checkedWrite(uid,id,'seed',before,expectedSeed,'PUT',path,
        {locale:'kk',...seedPayload},matchSeed);
      didSeed=true;
    }
    fields=planFields(s,before.ru.draft,before.kk.draft,true);
    rel=relationPlan(s,before.ru.draft,before.kk.draft);
    if(fields.skippedFields.some(x=>x.field==='brandZoneBanners'))
      throw new Blocked('Нельзя подтвердить brandZoneBanners: '+
        fields.skippedFields.find(x=>x.field==='brandZoneBanners').reason);
    const nestedPlan=await bannerPlan(before.ru.draft,before.kk.draft,
      fields.expected.brandZoneBanners||[]);
    fields.expected.brandZoneBanners=nestedPlan.wanted;
    if(nestedPlan.changed)fields.payload.brandZoneBanners=nestedPlan.parts;
    else delete fields.payload.brandZoneBanners;
    const write={locale:'kk',...fields.payload};
    const wanted=Object.fromEntries(Object.entries(relIDs(before.kk.draft))
      .map(([field,ids])=>[field,[...ids]]));
    const pendingLinks=[...nestedPlan.pending],pendingFields=[...fields.skippedFields];
    if(!publicationAligned(before.ru.draft,before.ru.published))
      pendingFields.push({field:'ru.published',reason:
        'RU Draft и Published различались до запуска; RU не перезаписывается'});
    const publishTargets=new Map(nestedPlan.newTargets.map(x=>[keyOf(x.uid,x.id),x]));
    const touchedRelations=[];
    let addedCount=nestedPlan.connected,removedCount=nestedPlan.disconnected;
    for(const [field,delta]of Object.entries(rel.changes)){
      const connects=[],disconnects=[],set=new Set(wanted[field]||[]);
      for(const targetId of delta.add){
        const target=await targetDraftId(delta.targetUid,targetId);
        if(!target.id){
          pendingLinks.push({field,targetUid:delta.targetUid,documentId:targetId,
            reason:target.reason||'KK Draft недоступен'});
          continue;
        }
        connects.push({id:target.id,documentId:targetId,locale:target.locale});
        publishTargets.set(keyOf(delta.targetUid,targetId),
          {uid:delta.targetUid,id:targetId});
        addedCount++;
        set.add(targetId);
      }
      for(const targetId of delta.remove){
        const old=delta.old.find(x=>x.documentId===targetId);
        if(!Number.isSafeInteger(old?.id)||old.id<=0)
          throw new Blocked('Нельзя безопасно disconnect '+field+'/'+targetId);
        disconnects.push({id:old.id,documentId:targetId,locale:old.locale||'kk'});
        removedCount++;
        set.delete(targetId);
      }
      wanted[field]=[...set].sort();
      if(connects.length||disconnects.length){
        write[field]={connect:connects,disconnect:disconnects};
        touchedRelations.push(field);
      }
    }
    const writeChanges=Object.keys(write).filter(x=>x!=='locale');
    if(writeChanges.length){
      // Unique values were checked before the seed/save; avoid duplicate queries.
      // Verify the exact two relation sets immediately before each mutable PUT.
      const checks=await Promise.all(touchedRelations.map(async field=>{
        const [source,target]=await Promise.all([
          relations(uid,id,field,'ru','draft'),
          relations(uid,id,field,'kk','draft')]);
        return {field,source,target};
      }));
      for(const {field,source,target}of checks)
        if(!eq(asIds(source),asIds(before.ru.draft.relations[field]))||
          !eq(asIds(target),asIds(before.kk.draft.relations[field])))
          throw new Blocked('Relation изменилась до Save: '+field);
      const expected={fields:fields.expected,relations:wanted};
      const path='/content-manager/collection-types/'+uid+'/'+encodeURIComponent(id)+'?locale=kk';
      before=await checkedWrite(uid,id,'save',before,expected,'PUT',path,
        write,matchSave);
      didSave=true;
    }
    const changes=[...(didSeed?['createKK']:[]),...writeChanges.map(f=>
      s.attributes[f]?.type==='relation'?'relation:'+f:f)];
    // Publish only the dependencies of links added during this Category write.
    // No recursive walk, no global dependency scan, no retries of ambiguous writes.
    const pendingPublications=[];
    for(const dependency of publishTargets.values()){
      const issue=await publishDependencyOnce(dependency.uid,dependency.id);
      if(issue)pendingPublications.push(issue);
    }
    const incomplete=!!(pendingLinks.length||pendingFields.length||
      pendingPublications.length);
    if(!didSeed&&!didSave&&!needsResume(previous)&&!needsPublication){
      return {status:incomplete?'partial':'already_ok',stage:'checked',
        changes,pendingLinks,pendingFields,pendingPublications,
        addedCount,removedCount,
        reason:incomplete?'Остались недоступные поля/связи/публикации':''};
    }
    // Do not publish RU: the normalizer never edits RU business values.
    // A past RU publish can still be reconciled from journal, without a retry.
    const alreadyVerified=verifiedPhaseStillCurrent(previous,before);
    const kkAlready=alreadyVerified&&previous.phase==='verified-publish-kk';
    let publishedKK=false;
    if(!kkAlready&&!publicationAligned(before.kk.draft,before.kk.published)){
      before=await publishFrom(uid,id,'kk',before);publishedKK=true;
    }
    if(!publicationAligned(before.kk.draft,before.kk.published))
      throw new Unresolved('KK Published не совпадает с KK Draft после публикации');
    await completeJob(uid,id,before);
    return {status:incomplete?'partial_published':'success',stage:'published',
      changes,pendingLinks,pendingFields,pendingPublications,
      publicationWarnings:publicationWarnings(before),publishedRU:false,publishedKK,
      addedCount,removedCount,
      reason:incomplete?'Частичная нормализация; повторить проход':''};
  }
  function compareRecoveryVersions(before,after){
    if(!before||!after)return [];
    const changes=[];
    for(const locale of ['ru','kk'])for(const status of ['draft','published']){
      const old=before[locale]?.[status],cur=after[locale]?.[status];
      if(!old||!cur){
        if(!!old!==!!cur)changes.push({locale,status,field:'__version',
          before:!!old,after:!!cur});
        continue;
      }
      const keys=uniq([...Object.keys(old.fields||{}),...Object.keys(cur.fields||{})]);
      for(const field of keys)
        if(!eq(old.fields?.[field],cur.fields?.[field]))
          changes.push({locale,status,field,
            before:old.fields?.[field],after:cur.fields?.[field]});
      const oldRelations=relIDs(old),curRelations=relIDs(cur);
      for(const field of uniq([...Object.keys(oldRelations),...Object.keys(curRelations)]))
        if(!eq(oldRelations[field]||[],curRelations[field]||[]))
          changes.push({locale,status,field:'relation:'+field,
            before:oldRelations[field]||[],after:curRelations[field]||[]});
    }
    return changes;
  }
  async function previewRecovery(id){
    state.phase='Recovery preview: схемы, старый backup и текущие четыре версии';
    state.current=id;state.total=1;render();
    state.db=await openDB();
    await schemas();
    const job=await getJob(UID,id);
    if(!job?.before||!job?.failure?.after)
      throw new Error('Для '+id+' нет незавершённого before/after backup в IndexedDB');
    const current=await snapshot(UID,id);
    const keySchema=state.schemas.get(UID).attributes?.key;
    const before=job.before,after=job.failure.after;
    const originalKey=before.ru?.draft?.fields?.key;
    const currentRuKey=current.ru?.draft?.fields?.key;
    const currentKkKey=current.kk?.draft?.fields?.key;
    const publishedRuKey=current.ru?.published?.fields?.key;
    const publishedKkKey=current.kk?.published?.fields?.key;
    const changes=compareRecoveryVersions(before,current);
    const onlyKnownChanges=changes.every(x=>
      (x.locale==='ru'&&x.status==='draft'&&x.field==='key'&&
        eq(x.before,originalKey)&&x.after===null)||
      (x.locale==='kk'&&x.status==='draft'&&x.field==='slug'&&
        eq(x.after,after.kk?.draft?.fields?.slug)));
    const sourceConfirmed=nonEmpty(originalKey)&&eq(originalKey,publishedRuKey);
    const schemaConfirmed=keySchema?.type==='string'&&keySchema.unique===true&&
      !localized(keySchema);
    const liveMatchesFailure=matchingBaseline(current,after);
    const pendingConfirmed=job.phase==='pending-save'&&job.failure.integrity===true;
    state.report.recovery={
      documentId:id,mode:'GET-only; no writes or publish',
      source:'IndexedDB '+DB_NAME+' '+keyOf(UID,id),
      schema:{key:keySchema},
      journalPhase:job.phase,journalFailure:job.failure.reason,
      originalKey,currentRuKey,currentKkKey,publishedRuKey,publishedKkKey,
      sourceConfirmed,schemaConfirmed,liveMatchesFailure,pendingConfirmed,
      unchangedFieldsConfirmed:onlyKnownChanges,
      differencesFromOriginal:changes,
      crossLocaleConflict:!eq(originalKey,publishedKkKey),
      plannedTarget:'RU Draft.key only; NO Publish',
      canSafelyAutoWrite:false,
      reason:'Shared nonlocalized unique key and distinct KK Published value require'+
        ' confirmation of safe Strapi write behavior before recovery',
      originalBackup:before,current,failedPostflight:after
    };
    state.report.results.push({documentId:id,name:before.ru?.draft?.row?.name||id,
      status:'planned',stage:'recovery-preview',changes:changes.map(x=>
        x.locale+'.'+x.status+'.'+x.field),reason:state.report.recovery.reason});
    state.done=1;state.phase='recovery_preview_completed';
    render('Recovery GET-only: '+(sourceConfirmed&&schemaConfirmed&&liveMatchesFailure?
      'исходный backup подтверждён':'требуется разбор расхождений'));
  }
  function matchesRuKeyRecovery(before,after,expectedKey){
    if(!before?.ru?.draft||!after?.ru?.draft||
      before.ru.draft.fields.key!==null||
      !eq(after.ru.draft.fields.key,expectedKey))return false;
    // Success permits exactly ONE semantic difference, RU Draft.key.
    // Any KK Draft/Published, RU Published, Media, component or relation
    // change is a global unresolved stop, even if Strapi returned HTTP 200.
    const normalized=structuredClone(after);
    normalized.ru.draft.fields.key=null;
    return matchingBaseline(before,normalized);
  }
  async function uniqueRecoveryCheck(id,key){
    // Positive control in RU Published, because damaged RU Draft.key is NULL.
    // Never trust a filtered list until this exact document is returned.
    let positive=false;
    for(const locale of ['ru','kk'])for(const status of ['draft','published']){
      const q=new URLSearchParams({locale,status,page:'1',
        pageSize:String(PAGE_SIZE)});
      q.set('filters[key][$eq]',key);
      const data=parseList(await get('/content-manager/collection-types/'+UID+'?'+q),1);
      if(data.total>PAGE_SIZE||data.pageCount>1||data.rows.length!==data.total)
        throw new Blocked('Unique key search неполный: '+locale+'/'+status);
      for(const raw of data.rows){
        const row=raw?.attributes&&!raw.documentId?
          {...raw.attributes,id:raw.id}:raw;
        if(!row?.documentId)
          throw new Blocked('В unique key search нет documentId');
        if(row.documentId!==id)
          throw new Blocked('Ключ уже занят другой Category '+row.documentId);
        if(locale==='ru'&&status==='published')positive=true;
      }
    }
    if(!positive)throw new Blocked(
      'Unique filter не прошёл положительную проверку RU Published');
  }
  async function applyRecoveryRuKey(id){
    // Dedicated single-record recovery. Never enters the normal Category apply.
    state.db=await openDB();
    const existing=await getJob(UID,id);
    if(existing?.phase==='pending-recovery-ru-key'){
      const after=await snapshot(UID,id);
      if(!matchesRuKeyRecovery(existing.before,after,existing.expected?.key))
        throw new Unresolved('Незавершённая recovery не подтверждена; повторный PUT запрещён');
      await verifiedJournal(existing,after);
      await completeJob(UID,id,after);
      state.report.results.push({documentId:id,status:'success',
        stage:'recovery-verified-without-repeat',changes:['ru.draft.key'],
        reason:'Проверено GET, повторный PUT не отправлен'});
      state.report.recovery={documentId:id,verified:true,
        before:existing.before,after,putRepeated:false,publish:false};
      state.total=state.done=1;state.phase='recovery_completed';return;
    }
    if(existing?.phase!=='pending-save'||existing?.failure?.integrity!==true)
      throw new Blocked('Нет исходного подтверждённого pending-save для восстановления');
    await previewRecovery(id);
    const p=state.report.recovery;
    const differences=p.differencesFromOriginal||[];
    const exactlyKnown=differences.length===2&&
      differences.some(x=>x.locale==='ru'&&x.status==='draft'&&x.field==='key'&&
        x.before===p.originalKey&&x.after===null)&&
      differences.some(x=>x.locale==='kk'&&x.status==='draft'&&x.field==='slug'&&
        x.before===null&&x.after===p.failedPostflight?.kk?.draft?.fields?.slug);
    if(!p.sourceConfirmed||!p.schemaConfirmed||!p.liveMatchesFailure||
      !p.pendingConfirmed||!p.unchangedFieldsConfirmed||!exactlyKnown||
      p.currentRuKey!==null||p.currentKkKey!==null||
      p.originalKey!==RECOVERY_CONFIRM||
      !eq(p.publishedKkKey,p.originalBackup?.kk?.published?.fields?.key))
      throw new Blocked('Recovery preflight не подтверждён; ни один PUT не отправлен');
    // Explicitly verify uniqueness across all locales/statuses before the write.
    await uniqueRecoveryCheck(id,p.originalKey);
    stopCheck();
    const fresh=await snapshot(UID,id);
    if(!matchingBaseline(p.current,fresh))
      throw new Blocked('Данные изменились во время recovery preflight; PUT запрещён');
    const path='/content-manager/collection-types/'+UID+'/'+encodeURIComponent(id)+
      '?locale=ru';
    const payload={locale:'ru',key:p.originalKey};
    const pending=await writeJournal(UID,id,'recovery-ru-key',fresh,
      {key:p.originalKey},{method:'PUT',path,payload,
        originalIncident:'pending-save integrity after KK Save'});
    let error=null,after=null;
    try{await request('PUT',path,payload);}
    catch(e){error=e;}
    try{after=await snapshot(UID,id);}
    catch(e){error ||=e;}
    p.recoveryPostflight=after;
    if(!after||!matchesRuKeyRecovery(fresh,after,p.originalKey)||error){
      const failure=after&&!matchesRuKeyRecovery(fresh,after,p.originalKey)?
        new IntegrityViolation(
          'Recovery изменила поля за пределами RU Draft.key; STOP, без rollback',after):
        new Unresolved('Recovery PUT не подтверждён: '+clean(error));
      await stopWithEvidence(pending,after,failure);
    }
    await verifiedJournal(pending,after);
    await completeJob(UID,id,after);
    p.verified=true;p.current=after;p.canSafelyAutoWrite=false;
    p.recoveryOperation={method:'PUT',locale:'ru',fields:['key'],
      published:false,verified:true};
    state.report.results[0]={documentId:id,name:fresh.ru.draft.row.name,
      status:'success',stage:'recovered-ru-draft-key',
      changes:['ru.draft.key'],reason:'RU key восстановлен; остальные три версии неизменны'};
    state.done=state.total=1;state.phase='recovery_completed';
  }
  async function run(){
    try{
      if(RECOVERY_APPLY){await applyRecoveryRuKey(RECOVERY_APPLY);return;}
      if(RECOVERY_PREVIEW){await previewRecovery(RECOVERY_PREVIEW);return;}
      if(EXPORT_ONLY){
        state.db=await openDB();
        state.report.journals=await dbOp('all');
        state.total=state.done=state.report.journals.length;
        state.phase='backup_export_only';
        return;
      }
      if(DRY_RUN){await dryRun();return;}
      state.db=await openDB();
      await schemas();
      state.list=await allCategoryIds();
      if(ONLY){
        state.list=state.list.filter(item=>item.id===ONLY);
        if(!state.list.length)throw Error('Пилот: Category documentId не найден: '+ONLY);
      }else if(LIMIT)state.list=state.list.slice(0,LIMIT);
      state.total=state.list.length;
      state.phase='Последовательная нормализация Category';render();
      for(const item of state.list){
        if(state.stop)break;
        state.current=item.name||item.id;render('Обработка '+(state.done+1)+'/'+state.total);
        let resultRow;
        try{
          const outcome=await applyOne(item);
          const pendingLinks=outcome.pendingLinks||[];
          const pendingFields=outcome.pendingFields||[];
          resultRow={documentId:item.id,name:item.name,status:outcome.status,
            stage:outcome.stage,reason:outcome.reason||'',
            changes:outcome.changes||[],attempts:1,
            pendingLinks:pendingLinks.map(x=>
              x.field+':'+x.targetUid+'/'+x.documentId+' ('+x.reason+')'),
            pendingDetails:pendingLinks,
            pendingFields:pendingFields.map(x=>x.field+' ('+x.reason+')'),
            pendingFieldDetails:pendingFields,
            pendingPublications:(outcome.pendingPublications||[]).map(x=>
              x.uid+'/'+x.id+' ('+x.reason+')'),
            pendingPublicationDetails:outcome.pendingPublications||[],
            publicationWarnings:outcome.publicationWarnings||[],
            createKK:(outcome.changes||[]).includes('createKK'),
            fieldsChanged:(outcome.changes||[]).filter(x=>x!=='createKK'&&
              !x.startsWith('relation:')),
            relationsConnect:outcome.addedCount||0,
            relationsDisconnect:outcome.removedCount||0,
            publishRU:!!outcome.publishedRU,publishKK:!!outcome.publishedKK};
        }catch(e){
          const status=safeStatus(e);
          if(e.fatal||e.integrity||e.unresolved){
            state.stop=true;
            state.phase=e.integrity?'halted_integrity':'halted_unresolved';
            console.error('[Category Localizer] ОСТАНОВКА ВСЕХ ЗАПИСЕЙ: '+clean(e.message),e);
          }
          resultRow={documentId:item.id,name:item.name,status,stage:'apply',
            reason:clean(e.message),changes:[],attempts:1,
            pendingLinks:[],pendingFields:[],pendingPublications:[]};
          state.report.errors.push({documentId:item.id,status,reason:clean(e.message)});
          console.warn('[Category Localizer] '+item.id+' '+status+': '+clean(e.message));
        }
        state.report.results.push(resultRow);
        state.done++;render(item.name+': '+resultRow.status);
      }
      if(!state.stop)state.phase='completed';
      else if(!state.phase.startsWith('halted_'))state.phase='stopped';
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
      const statuses=rowsStatus();
      state.report.summary={...state.report.summary,total:state.total,...statuses,
        successful:state.phase==='completed'&&
          !['blocked','unresolved','error','partial','partial_published']
            .some(k=>statuses[k]>0),
        scope:RECOVERY_APPLY?'recovery-apply':RECOVERY_PREVIEW?'recovery-preview':
          EXPORT_ONLY?'backup-export':
          ONLY?'single':LIMIT?'first-'+LIMIT:FULL?'full':'dry-run',
        get:state.get,
        put:state.put,post:state.post,retries:state.retries,phase:state.phase,
        populateGET:state.populateGET,populateHits:state.populateHits,
        nativeFallbacks:state.nativeFallbacks,
        dependenciesPublished:state.report.operations.filter(x=>
          x.stage==='dependency-published').length,
        publishedNestedCountOnly:state.publishedNestedCountOnly.size,
        publishedNestedVerification:'count-only (composition not proven)' };
      stop.disabled=true;
      try{csv.onclick();json.onclick();}catch(e){console.error('[Category Localizer] export',e);}
      state.db?.close();window[RUN_KEY]=false;
      render('Завершено: '+state.phase+'. CSV/JSON скачаны.');
      console.log('[Category Localizer] Итог',state.report.summary);
    }
  }
  await run();
})();