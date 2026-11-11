// DIOR Category KK relations: полный READ-ONLY Preflight второго прохода.
// Запуск в DevTools Console RU-карточки бренда DIOR.
// Input: оригинальный dior-category-kk-dry-run.json (55 Category).
// Output: JSON, Category CSV и Target CSV; НИКАКИХ PUT/POST/Publish.
(async()=>{
 'use strict';
 const UID='api::category.category',BRAND_UID='api::brand.brand';
 const BRAND_ID='qw7sja6ffpbufvzub5maxyrl',FIELD='categories';
 const KEY='__tmDiorCategoryKkRelationsAudit',PANEL='tm-dior-kk-relations-audit';
 const PAGE_SIZE=100,WORKERS=2,TARGET_WORKERS=3;
 const SYSTEM=new Set(['id','documentId','locale','status','publishedAt',
  'createdAt','updatedAt','createdBy','updatedBy','localizations']);
 if(!location.pathname.includes('/content-manager/collection-types/'+BRAND_UID+'/'+BRAND_ID)||
  (new URLSearchParams(location.search).get('plugins[i18n][locale]')||'ru')!=='ru'){
  console.error('[DIOR relations]', 'Открой RU-карточку DIOR');return;
 }
 if(window[KEY]?.running){console.warn('[DIOR relations] Уже запущен');return;}
 let token;
 try{token=JSON.parse(localStorage.getItem('jwtToken'));}
 catch{token=localStorage.getItem('jwtToken');}
 if(typeof token!=='string'||!token){console.error('[DIOR relations] Нет Strapi JWT');return;}
 document.getElementById(PANEL)?.remove();
 const state={running:false,stopped:false,requests:0,retries:0,processed:0,targetsDone:0,targetsTotal:0,
   report:{tool:'dior-category-kk-relations-audit',version:1,readOnly:true,
    brandDocumentId:BRAND_ID,startedAt:new Date().toISOString(),finishedAt:null,
    complete:false,outcome:'input_required',baselineAt:null,schemaRelations:null,
    categoryRows:[],targets:[],summary:null,errors:[]}};
 window[KEY]=state;
 window.tmDiorCategoryKkRelationsAuditReport=state.report;
 const el=(tag,t)=>{const e=document.createElement(tag);if(t!=null)e.textContent=t;return e};
 const panel=el('section');panel.id=PANEL;
 panel.style.cssText='position:fixed;bottom:14px;right:14px;z-index:2147483600;'+
  'width:min(520px,calc(100vw - 28px));max-height:78vh;overflow:auto;'+
  'padding:14px;border-radius:10px;background:#24243a;color:white;'+
  'border:1px solid #9691c3;font:13px/1.5 system-ui;box-shadow:0 8px 24px #0009';
 const title=el('strong','DIOR: аудит relations RU → KK (только GET)');
 const info=el('div','Выбери исходный dior-category-kk-dry-run.json.');
 info.style.cssText='white-space:pre-wrap;margin:9px 0';
 const picker=el('input');picker.type='file';picker.accept='.json,application/json';
 picker.style.cssText='width:100%;margin:8px 0';
 const controls=el('div');controls.style.cssText='display:flex;flex-wrap:wrap;gap:8px;margin-top:8px';
 const startBtn=el('button','Проверить связи (GET)');
 const stopBtn=el('button','Остановить');
 const csvBtn=el('button','CSV категорий');
 const targetsBtn=el('button','CSV целей');
 const jsonBtn=el('button','JSON');
 for(const x of [startBtn,stopBtn,csvBtn,targetsBtn,jsonBtn]){
  x.type='button';x.style.cssText='padding:7px 10px;cursor:pointer';controls.append(x);
 }
 startBtn.disabled=true;stopBtn.disabled=true;
 panel.append(title,info,picker,controls);document.body.append(panel);
 const check=()=>{if(state.stopped)throw Error('STOP_BY_USER')};
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const show=t=>{info.textContent=t+'\nCategory '+state.processed+'/55 · targets '+
  state.targetsDone+'/'+state.targetsTotal+
  '\nGET '+state.requests+' · retry '+state.retries};
 const download=(name,body,type)=>{
  const url=URL.createObjectURL(new Blob([body],{type}));
  const a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),15000);
 };
 const quote=x=>{
  let t=Array.isArray(x)?x.join(' | '):String(x??'');
  if(/^[=+\-@\t\r]/.test(t))t="'"+t;
  return '"'+t.replace(/"/g,'""')+'"';
 };
 const csv=(columns,rows)=>'\uFEFF'+[columns.join(';'),
  ...rows.map(r=>columns.map(k=>quote(r[k])).join(';'))].join('\n');
 const catColumns=['documentId','name','status','ruRelations','kkRelations',
  'missingTargetKK','missingTargetDetails','reason','url'];
 const targetColumns=['uid','documentId','categoryReferences','kkDraft','kkPublished','status','reason'];
 csvBtn.onclick=()=>download('dior-category-kk-relations-categories.csv',
  csv(catColumns,state.report.categoryRows),'text/csv;charset=utf-8');
 targetsBtn.onclick=()=>download('dior-category-kk-relations-targets.csv',
  csv(targetColumns,state.report.targets),'text/csv;charset=utf-8');
 jsonBtn.onclick=()=>download('dior-category-kk-relations-audit.json',
  JSON.stringify(state.report,null,2),'application/json;charset=utf-8');
 stopBtn.onclick=()=>{state.stopped=true;stopBtn.disabled=true;show('Остановка после текущих GET…');};
 async function request(method,path){
  if(method!=='GET')throw Error('READ_ONLY: запрещён метод '+method);
  for(let attempt=0;attempt<3;attempt++){
   check();state.requests++;
   let res;
   try{res=await fetch(path,{method:'GET',credentials:'include',cache:'no-store',
    headers:{Authorization:'Bearer '+token,Accept:'application/json'}});}
   catch(e){
    if(attempt===2)throw Error('NETWORK '+path+': '+String(e));
    state.retries++;await sleep(700*(attempt+1));continue;
   }
   const body=await res.text();let data=null;
   try{data=body?JSON.parse(body):null}
   catch{if(res.status!==404)throw Error('GET response не JSON: '+path);}
   if(res.ok||res.status===404)return {ok:res.ok,status:res.status,data};
   if(attempt<2&&[408,429,500,502,503,504].includes(res.status)){
    state.retries++;await sleep(800*(attempt+1));continue;
   }
   throw Error('GET HTTP '+res.status+' '+path+': '+
    String(data?.error?.message||body).slice(0,150));
  }
 }
 async function get(path){
  const r=await request('GET',path);
  if(!r.ok)throw Error('GET HTTP '+r.status+' '+path);
  return r.data;
 }
 function decode(res,id,locale,published=false){
  const data=res?.data?.data;
  if(res?.status===404||(res?.ok&&(data==null||
   typeof data==='object'&&!Array.isArray(data)&&!Object.keys(data).length)))return null;
  if(!res?.ok||data?.documentId!==id||data?.locale!==locale||
    (published&&data.publishedAt==null))
   throw Error('Неоднозначный '+id+'/'+locale+'/'+(published?'Published':'Draft')+
    ' HTTP '+res?.status);
  return data;
 }
 const detailPath=(uid,id,locale,status)=>'/content-manager/collection-types/'+uid+
  '/'+id+'?locale='+locale+'&status='+status;
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const ids=rel=>Object.fromEntries(Object.entries(rel||{}).map(([name,r])=>
  [name,r.entries.map(x=>x.documentId).sort()]));
 const total=rel=>Object.values(rel||{}).reduce((acc,r)=>acc+r.total,0);
 const targetId=(uid,id)=>uid+'|'+id;
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

 function checkBaseline(a) {
  if(a?.tool!=='dior-category-kk-dry-run'||a.version!==1||
   !a.complete||a.outcome!=='completed'||
   a.brandDocumentId!==BRAND_ID||a.summary?.found!==55||
   a.summary?.processed!==55||a.rows?.length!==55||
   a.summary?.statuses?.ready!==52||a.summary?.statuses?.already_synced!==3||
   a.errors?.length)throw Error('Нужен полный исходный dry-run DIOR 55/52/3');
  const set=new Set(a.rows.map(r=>r.documentId));
  if(set.size!==55||a.rows.some(r=>!r.before?.ruDraft?.relations||
   !r.before?.ruPublished?.relations||!['ready','already_synced'].includes(r.status)))
   throw Error('Нет полных снимков RU в исходном JSON');
  if(!Array.isArray(a.relationFields)||!a.schemaFields)
   throw Error('Нет схемы relations в JSON');
 }
 function actualSchema(schema) {
  return Object.fromEntries(Object.entries(schema.attributes)
    .filter(([n])=>!SYSTEM.has(n))
    .map(([n,a])=>[n,{type:a.type,required:!!a.required,
      localized:a.type==='relation'?a.pluginOptions?.i18n?.localized!==false:
       a.pluginOptions?.i18n?.localized===true,
      target:a.target??null,unique:!!a.unique}]));
 }
 async function category(id,name,schema,baseline){
  const [ruRes,kkRes,kkPubRes]=await Promise.all([
   request('GET',detailPath(UID,id,'ru','draft')),
   request('GET',detailPath(UID,id,'kk','draft')),
   request('GET',detailPath(UID,id,'kk','published'))
  ]);
  const ru=decode(ruRes,id,'ru'),kk=decode(kkRes,id,'kk');
  const kkPub=decode(kkPubRes,id,'kk',true);
  if(!ru||!kk)throw Error('RU Draft или KK Draft отсутствует: '+id);
  const fields=relations(schema);
  const ruRelations=await relationSnapshot(id,'ru','draft',fields);
  const kkRelations=await relationSnapshot(id,'kk','draft',fields);
  const ruIds=ids(ruRelations),kkIds=ids(kkRelations),baselineIds=ids(baseline.before.ruDraft.relations);
  const changed=!same(ruIds,baselineIds);
  let status='ready',reason='';
  if(changed){status='review';reason='RU relations изменились после исходного dry-run';}
  if(kkPub){status='review';reason+=(reason?' | ':'')+'KK Published существует';}
  const actualKK=total(kkRelations);
  if(actualKK>0){
   status='review';reason+=(reason?' | ':'')+
    (same(ruIds,kkIds)?'KK relations уже совпадают с RU':'KK relations заполнены частично/иначе');
  }
  const actualRU=total(ruRelations);
  return {
   documentId:id,name:ru.name||name,status,reason,ruRelations:actualRU,
   kkRelations:actualKK,ru:ruIds,kk:kkIds,
   ruStatus:ru.status,kkId:kk.id,kkStatus:kk.status,
   kkPublished:!!kkPub,sourceChanged:changed,
   missingTargetKK:0,missingTargetDetails:'',
   url:location.origin+'/admin/content-manager/collection-types/'+UID+'/'+id+
    '?plugins[i18n][locale]=ru'
  };
 }
 async function targetCheck(uid,id,refCount,categoryIndex) {
  if(uid===UID){
   const found=categoryIndex.get(id);
   if(!found)return {uid,documentId:id,categoryReferences:refCount,
    kkDraft:false,kkPublished:false,status:'missing_category',
    reason:'Целевая Category вне всех 55 DIOR'};
   return {uid,documentId:id,categoryReferences:refCount,
    kkDraft:true,kkPublished:found.kkPublished,status:'kk_draft_exists',reason:''};
  }
  const draft=await request('GET',detailPath(uid,id,'kk','draft'));
  const kk=decode(draft,id,'kk');
  // Published проверяем всегда: нужен снимок риска влияния на опубликованные данные.
  const pub=await request('GET',detailPath(uid,id,'kk','published'));
  const kkPub=decode(pub,id,'kk',true);
  return {uid,documentId:id,categoryReferences:refCount,
   kkDraft:!!kk,kkPublished:!!kkPub,
   status:kk?'kk_draft_exists':kkPub?'published_without_draft':'missing_kk',
   reason:!kk&&!kkPub?'Нет KK локали target':!kk&&kkPub?
     'Опубликованная KK без Draft: проверить отдельно':''};
 }
 function finalize(outcome,message){
  state.running=false;state.report.outcome=outcome;
  state.report.finishedAt=new Date().toISOString();
  const categories=state.report.categoryRows,targets=state.report.targets;
  const targetStats=Object.fromEntries([...new Set(targets.map(t=>t.status))].map(s=>
   [s,targets.filter(t=>t.status===s).length]));
  state.report.summary={
   categoriesChecked:categories.length,categoryReady:categories.filter(x=>x.status==='ready').length,
   categoryReview:categories.filter(x=>x.status==='review').length,
   relationEntriesRU:categories.reduce((n,r)=>n+r.ruRelations,0),
   relationEntriesKK:categories.reduce((n,r)=>n+r.kkRelations,0),
   targetsChecked:targets.length,targetsByStatus:targetStats,
   categoriesWithMissingTargetKK:categories.filter(x=>x.missingTargetKK>0).length,
   getRequests:state.requests,getRetries:state.retries
  };
  startBtn.disabled=true;stopBtn.disabled=true;
  show(message+'\nCSV/JSON автоматически скачаны.');
  csvBtn.onclick();targetsBtn.onclick();jsonBtn.onclick();
 }
 async function run(audit){
  state.running=true;state.stopped=false;startBtn.disabled=true;
  picker.disabled=true;stopBtn.disabled=false;
  state.report.outcome='running';state.report.baselineAt=audit.startedAt;
  try {
   show('GET: проверка схемы, Brand DIOR и DIOR.categories…');
   const [types,brand]=await Promise.all([
    get('/content-manager/content-types'),
    get('/content-manager/collection-types/'+BRAND_UID+'/'+BRAND_ID+'?locale=ru&status=draft')
   ]);
   const schema=types?.data?.find(x=>x.uid===UID);
   const brandSchema=types?.data?.find(x=>x.uid===BRAND_UID);
   if(!schema?.attributes||schema.pluginOptions?.i18n?.localized!==true||
    brandSchema?.attributes?.[FIELD]?.type!=='relation'||
    brandSchema.attributes[FIELD].target!==UID||
    brand?.data?.documentId!==BRAND_ID||brand?.data?.locale!=='ru')
    throw Error('Невозможно подтвердить текущую схему Category/Brand');
   const fields=relations(schema);
   if(!same(fields,audit.relationFields)||!same(actualSchema(schema),audit.schemaFields))
    throw Error('Схема Category/relations изменилась после исходного аудита');
   state.report.schemaRelations=Object.fromEntries(fields.map(f=>
     [f,{target:schema.attributes[f].target,localized:true}]));
   const members=await categories();
   if(!same(members.map(x=>x.documentId).sort(),audit.rows.map(x=>x.documentId).sort()))
    throw Error('Состав DIOR.categories изменился после dry-run');
   const auditMap=new Map(audit.rows.map(x=>[x.documentId,x]));
   const rows=new Array(members.length);let cursor=0,failure=null;
   const workers=Array.from({length:Math.min(WORKERS,members.length)},async()=>{
    while(!failure&&!state.stopped){
     const i=cursor++;if(i>=members.length)return;
     try{
      const item=members[i];
      rows[i]=await category(item.documentId,item.name,schema,auditMap.get(item.documentId));
      state.processed++;state.report.categoryRows=rows.filter(Boolean);
      show('GET Category relations: '+state.processed+'/'+members.length);
     }catch(e){if(!failure)failure=Error(itemLabel(members[i])+': '+String(e));return;}
    }
   });
   await Promise.all(workers);
   if(failure)throw failure;check();
   if(rows.some(x=>!x))throw Error('Неполный Category scan');
   state.report.categoryRows=rows;
   // Dedup targets by UID/documentId, сохраняем число фактических ссылок.
   const targetsMap=new Map();
   for(const row of rows)for(const [field,idList] of Object.entries(row.ru)){
    const uid=schema.attributes[field].target;
    if(!['api::category.category','api::product.product','api::brand.brand'].includes(uid))
     throw Error('Неожиданный target '+uid);
    for(const target of idList){
     if(!target)throw Error('Пустой documentId target '+field+'/'+row.documentId);
     const k=targetId(uid,target);
     const item=targetsMap.get(k)||{uid,documentId:target,categoryReferences:0};
     item.categoryReferences++;targetsMap.set(k,item);
    }
   }
   const categoryIndex=new Map(rows.map(r=>[r.documentId,r]));
   const candidates=[...targetsMap.values()].sort((a,b)=>
    a.uid.localeCompare(b.uid)||a.documentId.localeCompare(b.documentId));
   state.targetsTotal=candidates.length;const results=new Array(candidates.length);
   cursor=0;failure=null;
   const targetWorkers=Array.from({length:Math.min(TARGET_WORKERS,candidates.length)},async()=>{
    while(!failure&&!state.stopped){
     const i=cursor++;if(i>=candidates.length)return;
     try{
      const item=candidates[i];
      results[i]=await targetCheck(item.uid,item.documentId,item.categoryReferences,categoryIndex);
      state.targetsDone++;state.report.targets=results.filter(Boolean);
      show('GET KK target existence: '+state.targetsDone+'/'+candidates.length);
     }catch(e){if(!failure)failure=Error(candidates[i].uid+'/'+candidates[i].documentId+': '+String(e));return;}
    }
   });
   await Promise.all(targetWorkers);
   if(failure)throw failure;check();
   if(results.some(x=>!x))throw Error('Неполный target scan');
   state.report.targets=results;
   const missing=new Set(results.filter(x=>x.status!=='kk_draft_exists')
    .map(x=>targetId(x.uid,x.documentId)));
   for(const row of rows){
    const list=[];
    for(const [field,idList] of Object.entries(row.ru))for(const id of idList){
     const uid=schema.attributes[field].target;
     if(missing.has(targetId(uid,id)))list.push(field+':'+id);
    }
    row.missingTargetKK=list.length;row.missingTargetDetails=list.join(' | ');
    if(list.length&&row.status==='ready')row.status='target_review';
   }
   state.report.complete=true;
   finalize('completed','Read-only аудит 55 Category и всех targets завершён.');
  }catch(e){
   const error=String(e);
   state.report.errors.push(error);
   console.error('[DIOR relations]',error);
   finalize(state.stopped?'stopped':'failed','Аудит неполный: '+error);
  }
 }
 function itemLabel(x){return x?.documentId||'Category'}
 let source=null;
 picker.onchange=async()=>{
  if(state.running)return;
  try{
   source=JSON.parse(await picker.files[0].text());
   checkBaseline(source);
   startBtn.disabled=false;state.report.outcome='ready';
   show('Исходный JSON проверен: 55 Category. Только GET, записи отсутствуют.');
  }catch(e){
   source=null;startBtn.disabled=true;show('Неверный JSON: '+String(e));
  }
 };
 startBtn.onclick=()=>{if(source&&!state.running)return run(source);};
 show('Выбери исходный read-only dry-run JSON, затем нажми «Проверить связи».');
})();
