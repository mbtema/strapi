/*
 * Category RU → KK: diagnostic dry-run (read-only, standalone).
 * Console: Strapi Admin → DevTools → Sources → Snippets → Ctrl+Enter.
 * READS ONLY: fetch(GET); no PUT/POST/DELETE, no IndexedDB, no CMS changes.
 * Outputs: category-dry-run-diagnostic.json + category-dry-run-diagnostic.csv.
 * Intended to collect live CMS contracts and blockers for production localizer.js.
 */
(async () => {
  'use strict';
  const UID = 'api::category.category';
  const RUN_KEY = '__tmCategoryDiagnosticV1';
  const VERSION = '1.0.0';
  const PAGE_SIZE = 100;
  const RETRIES = 3;
  const WAIT_BETWEEN_CATEGORIES_MS = 45;
  const SYSTEM = new Set(['id','documentId','locale','status','publishedAt','createdAt',
    'updatedAt','createdBy','updatedBy','localizations','__pivot']);
  const SCALARS = new Set(['string','text','richtext','email','enumeration','json','blocks',
    'integer','biginteger','float','decimal','boolean','date','time','datetime','uid']);
  const SKIP = Symbol('keep-localized-empty');
  const started = new Date().toISOString();
  if (!location.pathname.startsWith('/admin/content-manager')) {
    console.error('[Category Dry Run] Открой Content Manager в Strapi Admin.');
    return;
  }
  if (window[RUN_KEY]) {
    console.warn('[Category Dry Run] Диагностика уже выполняется.');
    return;
  }
  window[RUN_KEY] = true;
  let jwt = localStorage.getItem('jwtToken');
  try { jwt = JSON.parse(jwt); } catch { /* plain token */ }
  if (typeof jwt !== 'string' || !jwt.trim()) {
    console.error('[Category Dry Run] JWT не найден.');
    window[RUN_KEY] = false;
    return;
  }
  jwt = jwt.replace(/^Bearer\s+/i, '').trim();
  const report = {
    tool:'category-dry-run-diagnostic',version:VERSION,mode:'read-only',
    source:'Strapi Content Manager internal GET endpoints',
    startedAt:started,finishedAt:null,origin:location.origin,
    sourcePolicy:{
      root:'RU Draft',relations:'exact mirror (connect/disconnect)',
      legacyProducts:'block RU if nonempty, clear KK when RU empty',
      forceRU:['title','boolean fields','filters_app'],
      preserveKK:['name','description','all Media','localized text/fields'],
      newKK:'create Draft without localized text/media',
      publication:'publish RU and KK Category; dependencies KK only if KK Published absent and RU Published exists'
    },
    schema:{category:null,contentTypes:[],components:[],componentUids:[],relatedSchemas:{}},
    catalog:{pages:[],total:null,rows:[]},categories:[],targets:[],uniqueEvidence:[],
    api:{requests:0,retries:0,byEndpoint:{},unexpectedResponses:[],samples:[]},
    summary:null,errors:[],warnings:[],incomplete:false,stopped:false
  };
  const state = {stop:false,phase:'init',current:'',scanned:0,total:0,
    targetsChecked:0,targetsTotal:0,types:new Map(),components:new Map(),
    categoryById:new Map(),targetByKey:new Map(),uniqueChecks:new Map()};
  const tag=(kind,text)=>{const n=document.createElement(kind); if(text!==undefined)n.textContent=text;return n;};
  document.getElementById('tm-category-diagnostic-panel')?.remove();
  const panel=tag('section');panel.id='tm-category-diagnostic-panel';
  panel.style.cssText='position:fixed;z-index:2147483600;right:16px;bottom:16px;'+
    'width:min(520px,calc(100vw - 32px));max-height:80vh;overflow:auto;'+
    'background:#202035;color:#fff;border:1px solid #8582be;border-radius:12px;'+
    'padding:14px;box-shadow:0 12px 36px #0009;font:13px/1.5 system-ui';
  const title=tag('strong','Category · DIAGNOSTIC DRY RUN · GET ONLY');
  const status=tag('pre');status.style.cssText='font:12px/1.5 system-ui;white-space:pre-wrap;margin:10px 0';
  const buttons=tag('div');buttons.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
  const stopButton=tag('button','Стоп');
  const jsonButton=tag('button','Скачать полный JSON');
  const csvButton=tag('button','Скачать CSV');
  for(const b of [stopButton,jsonButton,csvButton]){
    b.type='button';b.style.cssText='padding:7px 10px;cursor:pointer';buttons.append(b);
  }
  panel.append(title,status,buttons);document.body.append(panel);
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?
    Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const eq=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
  const errText=e=>String(e?.message||e).replace(/[\t\r\n]+/g,' ').slice(0,500);
  const urlPath=(uid,id,locale,status)=>'/content-manager/collection-types/'+uid+'/'+
    encodeURIComponent(id)+'?locale='+locale+'&status='+status;
  const fieldsOf=schema=>Object.entries(schema?.attributes||{}).filter(([f])=>!SYSTEM.has(f));
  const relFields=schema=>fieldsOf(schema).filter(([,a])=>a.type==='relation');
  const isLocalized=a=>a?.pluginOptions?.i18n?.localized===true;
  const getIds=entry=>(entry?.items||[]).map(v=>v.documentId).sort();
  const safeDetail=d=>{
    if(!d||typeof d!=='object')return d;
    // Do not export populated author accounts, tokens or internal auth data.
    const out={...d};delete out.createdBy;delete out.updatedBy;
    return out;
  };
  function render(message){
    status.textContent=(message||state.phase)+'\nКатегории: '+state.scanned+'/'+(state.total||'?')+
      ' · '+state.current+'\nСвязанные записи: '+state.targetsChecked+'/'+state.targetsTotal+
      '\nGET '+report.api.requests+' · retries '+report.api.retries+
      '\nCMS writes: 0 (запрещены)';
  }
  stopButton.onclick=()=>{state.stop=true;report.stopped=true;
    stopButton.disabled=true;render('Остановка после текущего GET…');};
  function escapeCsv(x){
    let s=Array.isArray(x)?x.join(' | '):typeof x==='object'&&x!==null?JSON.stringify(x):String(x??'');
    if(/^[=+\-@\t\r]/.test(s))s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  }
  const cols=['documentId','name','status','reason','hasRuDraft','hasRuPublished',
    'hasKkDraft','hasKkPublished','createKK','changedFields','relationsConnect',
    'relationsDisconnect','missingKKTargets','dependenciesToPublish',
    'expectedRUandKKPublish','warnings','errors'];
  function csvText(){
    return '\uFEFF'+[cols.join(';'),...report.categories.map(r=>cols.map(c=>escapeCsv(r.csv?.[c])).join(';'))].join('\n');
  }
  function download(filename,content,mime){
    const blob=new Blob([content],{type:mime}),u=URL.createObjectURL(blob);
    const a=tag('a');a.href=u;a.download=filename;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(u),30000);
  }
  jsonButton.onclick=()=>download('category-dry-run-diagnostic.json',JSON.stringify(report,null,2),'application/json;charset=utf-8');
  csvButton.onclick=()=>download('category-dry-run-diagnostic.csv',csvText(),'text/csv;charset=utf-8');
  // GET is the only HTTP method exposed anywhere in this file.
  async function get(path,kind='other',optional404=false){
    if(!path.startsWith('/content-manager/'))throw Error('GET за пределами Content Manager: '+path);
    const group=report.api.byEndpoint[kind]||{requests:0,errors:0,retries:0};
    report.api.byEndpoint[kind]=group;
    let last;
    for(let i=0;i<RETRIES;i++){
      report.api.requests++;group.requests++;
      let response;
      try{
        response=await fetch(path,{method:'GET',credentials:'include',cache:'no-store',
          headers:{Authorization:'Bearer '+jwt,Accept:'application/json'}});
      }catch(e){
        last=Error('GET network '+kind+': '+errText(e));
        if(i<RETRIES-1){group.retries++;report.api.retries++;await delay(500*(i+1));continue;}
        break;
      }
      let bodyText='';
      try{bodyText=await response.text();}
      catch(e){last=Error('GET response read '+kind+': '+errText(e));break;}
      if(response.status===404&&optional404)return null;
      let data;
      try{data=bodyText?JSON.parse(bodyText):null;}
      catch(e){last=Error('GET not JSON '+kind+' HTTP '+response.status+' '+bodyText.slice(0,120));break;}
      if(response.ok){
        if(report.api.samples.length<16)report.api.samples.push({kind,status:response.status,
          responseKeys:Object.keys(data||{}),size:bodyText.length});
        return data;
      }
      last=Error('GET '+kind+' HTTP '+response.status+' '+String(data?.error?.message||bodyText).slice(0,240));
      if([408,429,500,502,503,504].includes(response.status)&&i<RETRIES-1){
        group.retries++;report.api.retries++;await delay(700*(i+1));continue;
      }
      break;
    }
    group.errors++;throw last||Error('GET '+kind+' failed');
  }
  function parsePage(json,page,initial,where){
    const rows=json?.results,p=json?.pagination;
    if(!Array.isArray(rows)||!Number.isSafeInteger(p?.total)||p.total<0||
      !Number.isSafeInteger(p?.pageCount)||p.pageCount<0||
      (p.page!=null&&Number(p.page)!==page)||
      (p.total>0&&rows.length===0)||
      (initial&&(initial.total!==p.total||initial.pageCount!==p.pageCount))){
      report.api.unexpectedResponses.push({where,page,
        receivedKeys:Object.keys(json||{}),pagination:p||null,
        resultCount:Array.isArray(rows)?rows.length:null});
      throw Error('Некорректная пагинация '+where+' page='+page);
    }
    return {rows,pagination:{page,total:p.total,pageCount:p.pageCount,pageSize:p.pageSize}};
  }
  async function loadSchema(){
    const [types,components]=await Promise.all([
      get('/content-manager/content-types','content-types'),
      get('/content-manager/components','components')]);
    if(!Array.isArray(types?.data)||!Array.isArray(components?.data))throw Error('Схемы Content Manager недоступны');
    state.types=new Map(types.data.map(t=>[t.uid,t]));
    state.components=new Map(components.data.map(c=>[c.uid,c]));
    const cat=state.types.get(UID);
    if(!cat?.attributes||cat?.pluginOptions?.i18n?.localized!==true)
      throw Error('Схема api::category.category отсутствует или не локализована');
    report.schema.category=cat;
    report.schema.contentTypes=types.data.map(t=>({uid:t.uid,localized:t.pluginOptions?.i18n?.localized===true}));
    report.schema.componentUids=components.data.map(x=>x.uid);
    report.schema.components=components.data;
    // Include all reachable relation target schemas, even if no data is linked.
    for(const [,a] of relFields(cat)){
      const target=state.types.get(a.target);
      report.schema.relatedSchemas[a.target]=target||null;
    }
  }
  async function allCategoryIds(){
    const ids=[],seen=new Set();let page=1,first=null;
    while(!state.stop){
      const q=new URLSearchParams({locale:'ru',status:'draft',page:String(page),
        pageSize:String(PAGE_SIZE),sort:'id:ASC'});
      const json=await get('/content-manager/collection-types/'+UID+'?'+q,'category-list');
      const p=parsePage(json,page,first,'category-list');first||=p.pagination;
      report.catalog.pages.push({page,total:p.pagination.total,pageCount:p.pagination.pageCount,count:p.rows.length});
      report.catalog.total=p.pagination.total;
      for(const item of p.rows){
        const row=item?.attributes&&!item.documentId?{...item.attributes,id:item.id}:item;
        if(row?.locale!=='ru'||typeof row.documentId!=='string'||seen.has(row.documentId))
          throw Error('Неверный/повторный RU documentId в списке page '+page);
        seen.add(row.documentId);
        const o={documentId:row.documentId,name:row.name||row.title||'',id:row.id};
        ids.push(o);report.catalog.rows.push(o);
      }
      render('Читаем список RU Category: '+ids.length+'/'+first.total);
      if(page>=first.pageCount)break;
      page++;
      if(page>10000)throw Error('Слишком много страниц списка');
    }
    if(!state.stop&&ids.length!==first?.total)throw Error('Неполный список RU Category: '+ids.length+'/'+first?.total);
    return ids;
  }
  async function detail(uid,id,locale,status){
    const json=await get(urlPath(uid,id,locale,status),'detail',true);
    if(json===null||json?.data==null||
       (typeof json.data==='object'&&!Array.isArray(json.data)&&Object.keys(json.data).length===0))return null;
    const row=json.data;
    if(row.documentId!==id||row.locale!==locale||
       (status==='published'&&row.publishedAt==null))
      throw Error('Неоднозначная detail-версия '+uid+'/'+id+' '+locale+'/'+status);
    return safeDetail(row);
  }
  async function relation(uid,id,field,locale,status){
    const items=[];let first=null,page=1;
    while(true){
      const q=new URLSearchParams({locale,status,page:String(page),pageSize:String(PAGE_SIZE)});
      const path='/content-manager/relations/'+uid+'/'+encodeURIComponent(id)+'/'+encodeURIComponent(field)+'?'+q;
      const result=parsePage(await get(path,'relation'),page,first,'relation '+uid+'/'+id+'/'+field+'/'+locale+'/'+status);
      first||=result.pagination;
      for(const row of result.rows){
        if(typeof row?.documentId!=='string'||!Number.isSafeInteger(row.id)||row.id<=0)
          throw Error('Неверный relation target '+field+' '+uid+'/'+id);
        items.push({documentId:row.documentId,id:row.id,locale:row.locale||locale,
          name:row.name||row.title||undefined});
      }
      if(page>=first.pageCount)break;
      if(++page>10000)throw Error('Relation слишком много страниц');
    }
    if(items.length!==first.total||new Set(items.map(v=>v.documentId)).size!==items.length)
      throw Error('Relation count/duplicate mismatch '+uid+'/'+id+'/'+field);
    return {items,count:items.length,pageCount:first.pageCount};
  }
  async function version(uid,id,locale,status){
    const result={exists:false,locale,status,detail:null,relations:{},errors:[]};
    try{
      result.detail=await detail(uid,id,locale,status);
      if(!result.detail)return result;
      result.exists=true;
    }catch(e){result.errors.push({scope:'detail',reason:errText(e)});return result;}
    const schema=state.types.get(uid);
    if(!schema?.attributes){
      result.errors.push({scope:'schema',reason:'Отсутствует schema '+uid});return result;
    }
    for(const [field] of relFields(schema)){
      if(state.stop)break;
      try{result.relations[field]=await relation(uid,id,field,locale,status);}
      catch(e){result.relations[field]={error:errText(e),items:null,count:null};
        result.errors.push({scope:'relation:'+field,reason:errText(e)});}
    }
    return result;
  }
  async function snapshot(uid,id){
    const snap={uid,documentId:id,readAt:new Date().toISOString(),
      ru:{},kk:{},errors:[]};
    for(const locale of ['ru','kk'])for(const status of ['draft','published']){
      snap[locale][status]=await version(uid,id,locale,status);
      for(const e of snap[locale][status].errors){
        snap.errors.push({locale,status,...e});
      }
    }
    return snap;
  }
  function normalize(attr,value,path){
    if(value===undefined)throw Error('Поле отсутствует в detail: '+path);
    if(value===null)return null;
    if(attr.type==='media'){
      const one=x=>Number.isSafeInteger(x)?x:Number.isSafeInteger(x?.id)?x.id:null;
      if(Array.isArray(value)){
        const ids=value.map(one);if(ids.includes(null))throw Error('Нет media.id '+path);return ids;
      }
      const id=one(value);if(id===null)throw Error('Нет media.id '+path);return id;
    }
    if(SCALARS.has(attr.type))return canonical(value);
    if(attr.type==='component'){
      const c=state.components.get(attr.component);
      if(!c?.attributes)throw Error('Нет схемы компонента '+attr.component);
      const one=(x,p)=>{
        if(x===null)return null;
        if(!x||typeof x!=='object'||Array.isArray(x))throw Error('Структура компонента '+p);
        const out={};for(const [f,a]of fieldsOf(c))out[f]=normalize(a,x[f],p+'.'+f);
        return out;
      };
      if(attr.repeatable){if(!Array.isArray(value))throw Error('Ожидался массив '+path);
        return value.map((x,i)=>one(x,path+'['+i+']'));}
      return one(value,path);
    }
    if(attr.type==='dynamiczone'){
      if(!Array.isArray(value))throw Error('Ожидалась Dynamic Zone '+path);
      return value.map((x,i)=>{
        const c=state.components.get(x?.__component);
        if(!c||!attr.components?.includes(x.__component))throw Error('Неизвестный DZ компонент '+path+'['+i+']');
        const out={__component:x.__component};
        for(const [f,a]of fieldsOf(c))out[f]=normalize(a,x[f],path+'['+i+'].'+f);
        return out;
      });
    }
    if(attr.type==='relation'){
      // Root relations are tracked by exact native pages, not detail.populate.
      // A nested relation in a component can be uncertain without native contract.
      const n=Array.isArray(value)?value.length:value?.count||
        (value?.documentId||value?.id?1:0);
      if(n)throw Error('Неподдержанная вложенная relation '+path);
      return null;
    }
    throw Error('Неизвестный тип '+attr.type+' '+path);
  }
  function mergeComponent(componentId,ru,kk,path,issues){
    const component=state.components.get(componentId);
    if(!component?.attributes)throw Error('Нет схема компонента '+componentId);
    if(ru==null)return null;
    const result={};
    for(const [field,a]of fieldsOf(component)){
      const v=desired(field,a,ru[field],kk?.[field],kk!=null,path+'.'+field,issues);
      if(v!==SKIP)result[field]=v;
    }
    return result;
  }
  function desired(field,attr,ru,kk,hasKK,path,issues){
    if(ru===undefined)throw Error('RU поле отсутствует: '+path);
    if(field==='filters_app'||field==='title'||attr.type==='boolean')return normalize(attr,ru,path);
    if(attr.type==='media')return hasKK?normalize(attr,kk,path):SKIP;
    if(attr.type==='component'||attr.type==='dynamiczone'){
      if(ru==null)return hasKK&&isLocalized(attr)?normalize(attr,kk,path):ru;
      if(attr.type==='component'){
        const mergeOne=(a,b,p)=>mergeComponent(attr.component,a,b,p,issues);
        if(attr.repeatable){
          if(!Array.isArray(ru))throw Error('RU component не массив '+path);
          if(hasKK&&kk!=null&&(!Array.isArray(kk)||kk.length!==ru.length))
            throw Error('Структура KK компонента различается '+path);
          return ru.map((x,i)=>mergeOne(x,kk?.[i],path+'['+i+']'));
        }
        return mergeOne(ru,kk,path);
      }
      if(!Array.isArray(ru))throw Error('RU Dynamic Zone не массив '+path);
      if(hasKK&&kk!=null&&(!Array.isArray(kk)||kk.length!==ru.length))
        throw Error('Структура KK DZ различается '+path);
      return ru.map((x,i)=>{
        if(!attr.components?.includes(x?.__component)||(hasKK&&kk?.[i]?.__component!==x.__component))
          throw Error('Несовпадение структуры Dynamic Zone '+path+'['+i+']');
        return {__component:x.__component,...mergeComponent(x.__component,x,kk?.[i],path+'['+i+']',issues)};
      });
    }
    if(path==='name'||path==='description'||isLocalized(attr))return hasKK?normalize(attr,kk,path):SKIP;
    return normalize(attr,ru,path);
  }
  function auditCategory(item,record){
    const schema=state.types.get(UID),ru=record.snapshot.ru.draft,kk=record.snapshot.kk.draft;
    const plan={createKK:!kk.exists,fields:{},relations:{},changedFields:[],
      connect:0,disconnect:0,requiredEmpty:[],preservedKK:[],blockers:[],warnings:[],
      dependencies:[],uniqueChecks:[],publish:{ru:true,kk:true}};
    if(!ru.exists){plan.blockers.push('Нет RU Draft');return plan;}
    if(record.snapshot.errors.length){
      plan.blockers.push('Неполный snapshot: '+record.snapshot.errors.map(e=>
        e.locale+'/'+e.status+'/'+e.scope+': '+e.reason).join(' | '));
    }
    if(!kk.exists&&record.snapshot.kk.published.exists)
      plan.blockers.push('KK Published существует без KK Draft');
    for(const [field,a]of fieldsOf(schema)){
      if(a.type==='relation')continue;
      const r=ru.detail?.[field],k=kk.detail?.[field];
      const policy=field==='filters_app'?'force:filters_app':field==='title'?'force:title':
        a.type==='boolean'?'mirror:boolean':a.type==='media'?'preserve:media':
        field==='name'||field==='description'||isLocalized(a)?'preserve:localized':'mirror:unlocalized';
      const entry={type:a.type,localized:isLocalized(a),required:!!a.required,unique:!!a.unique,
        policy,ruPresent:r!==undefined,kkPresent:kk.exists?k!==undefined:false,
        ru:null,kk:null,expected:null,changed:false,skipped:false};
      try{entry.ru=normalize(a,r,field);}catch(e){entry.ruError=errText(e);}
      if(kk.exists)try{entry.kk=normalize(a,k,field);}catch(e){entry.kkError=errText(e);}
      try{
        const d=desired(field,a,r,k,kk.exists,field,plan.warnings);
        if(d===SKIP){
          entry.skipped=true;entry.expected=null;
          if(a.required)plan.requiredEmpty.push(field);
        }else{
          entry.expected=d;
          entry.changed=!kk.exists||!eq(d,entry.kk);
          if(entry.changed)plan.changedFields.push(field);
        }
        if(policy.startsWith('preserve')&&kk.exists)plan.preservedKK.push(field);
      }catch(e){entry.error=errText(e);plan.blockers.push('field:'+field+': '+errText(e));}
      if(entry.ruError||entry.kkError)plan.blockers.push('normalize:'+field+': '+[entry.ruError,entry.kkError].filter(Boolean).join(', '));
      plan.fields[field]=entry;
    }
    if(plan.requiredEmpty.length)plan.blockers.push('Пустые обязательные переводы: '+plan.requiredEmpty.join(', '));
    for(const [field,a]of relFields(schema)){
      const src=ru.relations[field],target=kk.relations[field];
      if(!src||src.error){plan.blockers.push('RU relation не прочитана: '+field);continue;}
      if(kk.exists&&(!target||target.error)){plan.blockers.push('KK relation не прочитана: '+field);continue;}
      const sourceIds=getIds(src),kkIds=getIds(target),sourceSet=new Set(sourceIds),kkSet=new Set(kkIds);
      const add=sourceIds.filter(x=>!kkSet.has(x)),remove=kkIds.filter(x=>!sourceSet.has(x));
      const entry={targetUid:a.target,localized:isLocalized(a),sourceIds,kkIds,
        sourceNumericIds:src.items,kkNumericIds:target?.items||[],
        connect:add,disconnect:remove,sourceCount:sourceIds.length,kkCount:kkIds.length};
      plan.relations[field]=entry;
      plan.connect+=add.length;plan.disconnect+=remove.length;
      if(field==='products'&&sourceIds.length)
        plan.blockers.push('RU legacy products содержит '+sourceIds.length+' связей');
    }
    if(!record.snapshot.ru.published.exists)plan.warnings.push('RU Published отсутствует — Category будет публиковаться из Draft');
    if(!record.snapshot.kk.published.exists)plan.warnings.push('KK Published отсутствует');
    for(const [field,a] of relFields(schema)){
      for(const documentId of plan.relations[field]?.sourceIds||[])
        plan.dependencies.push({field,targetUid:a.target,documentId});
    }
    return plan;
  }
  function publicationDelta(snapshot,locale){
    const draft=snapshot[locale].draft,published=snapshot[locale].published;
    if(!draft?.exists)return {status:'missing_draft'};
    if(!published?.exists)return {status:'missing_published'};
    if(draft.errors?.length||published.errors?.length)return {status:'unverified_snapshot'};
    const schema=state.types.get(UID),fieldsChanged=[],relationDifferences=[];
    for(const [field,a]of fieldsOf(schema)){
      if(a.type==='relation')continue;
      try{
        const x=normalize(a,draft.detail[field],locale+'/draft/'+field);
        const y=normalize(a,published.detail[field],locale+'/published/'+field);
        if(!eq(x,y))fieldsChanged.push(field);
      }catch(e){fieldsChanged.push(field+' [не удалось сравнить: '+errText(e)+']');}
    }
    for(const [field]of relFields(schema)){
      const a=draft.relations[field],b=published.relations[field];
      if(!a||!b||a.error||b.error){relationDifferences.push({field,error:'unreadable'});continue;}
      const src=getIds(a),dst=getIds(b);
      if(!eq(src,dst))relationDifferences.push({field,draftCount:src.length,
        publishedCount:dst.length,missingPublished:src.filter(x=>!dst.includes(x)),
        extraPublished:dst.filter(x=>!src.includes(x))});
    }
    return {status:fieldsChanged.length||relationDifferences.length?'different':'matches_draft',
      fieldsChanged,relationDifferences};
  }

  async function uniqueEvidenceFor(record){
    const schema=state.types.get(UID),plan=record.plan;
    if(!record.snapshot?.ru?.draft?.exists||plan.blockers.length)return;
    const filterList=async(field,value,locale)=>{
      const q=new URLSearchParams({locale,status:'draft',page:'1',pageSize:String(PAGE_SIZE)});
      q.set('filters['+field+'][$eq]',String(value));
      const p=parsePage(await get('/content-manager/collection-types/'+UID+'?'+q,
        'unique-filter'),1,null,'unique-filter '+field+'/'+locale);
      if(p.pagination.total>PAGE_SIZE)throw Error('Unique filter вернул слишком много записей: '+field);
      return p.rows.map(x=>x?.attributes&&!x.documentId?{...x.attributes,id:x.id}:x);
    };
    for(const [field,attr]of fieldsOf(schema)){
      if(attr.unique!==true)continue;
      const info=plan.fields[field];
      if(!info||info.skipped||(!plan.createKK&&!info.changed))continue;
      if(info.expected==null||info.expected==='')continue;
      const evidence={documentId:record.documentId,field,expected:info.expected,
        status:'unverified',control:null,matches:{ru:[],kk:[]},errors:[]};
      plan.uniqueChecks.push(evidence);
      report.uniqueEvidence.push(evidence);
      try{
        const currentRU=record.snapshot.ru.draft.detail[field];
        if(currentRU!=null&&currentRU!==''){
          const positive=await filterList(field,currentRU,'ru');
          evidence.control={value:currentRU,matchingDocumentIds:positive.map(x=>x.documentId),
            exact:positive.some(x=>x.documentId===record.documentId&&String(x[field])===String(currentRU))};
          if(!evidence.control.exact)throw Error('Нет положительного контроля фильтра '+field);
        }else{
          throw Error('Положительный контроль unique невозможен: RU значение пустое');
        }
        for(const locale of ['ru','kk']){
          const records=await filterList(field,info.expected,locale);
          if(records.some(x=>String(x[field])!==String(info.expected)))
            throw Error('CM list filter вернул посторонние значения '+field+'/'+locale);
          evidence.matches[locale]=records.map(x=>({documentId:x.documentId,id:x.id,value:x[field]}));
        }
        const conflicts=[...evidence.matches.ru,...evidence.matches.kk].filter(x=>x.documentId!==record.documentId);
        if(conflicts.length){evidence.status='conflict';evidence.conflicts=conflicts;
          plan.blockers.push('Конфликт unique '+field+' с '+conflicts.map(x=>x.documentId).join(','));}
        else evidence.status='no-other-documentId-found';
      }catch(e){
        evidence.status='unverified';evidence.errors.push(errText(e));
        plan.blockers.push('Unique filter требует проверки '+field+': '+errText(e));
      }
    }
  }

  async function targetSummary(uid,id){
    const key=uid+'|'+id;
    if(state.targetByKey.has(key))return state.targetByKey.get(key);
    const schema=state.types.get(uid);
    const entry={uid,id,localized:schema?.pluginOptions?.i18n?.localized===true,
      status:'unchecked',ruPublished:false,kkDraft:false,kkPublished:false,
      ruDraft:false,numericId:null,errors:[],publishNeeded:false,
      source:null,dependentRelations:[],snapshot:null};
    state.targetByKey.set(key,entry);
    if(!schema?.attributes){entry.status='schema_missing';entry.errors.push('Нет схемы '+uid);return entry;}
    if(uid===UID){
      const existing=state.categoryById.get(id)?.snapshot;
      if(!existing){entry.status='category_not_in_list';entry.errors.push('Category вне RU каталога');return entry;}
      for(const locale of ['ru','kk'])for(const st of ['draft','published'])
        entry[locale+(st==='draft'?'Draft':'Published')]=existing[locale][st].exists;
      entry.numericId=existing.kk.draft.detail?.id||null;
      entry.status=entry.kkDraft?'category_draft':'category_needs_seed';
      return entry;
    }
    if(!entry.localized){
      try{const d=await detail(uid,id,'ru','draft');entry.ruDraft=!!d;
        entry.numericId=d?.id||null;entry.status=d?'shared_exists':'missing_shared';}
      catch(e){entry.status='error';entry.errors.push(errText(e));}
      return entry;
    }
    try{
      const kk=await detail(uid,id,'kk','draft');entry.kkDraft=!!kk;
      entry.numericId=kk?.id||null;
      const published=await detail(uid,id,'kk','published');entry.kkPublished=!!published;
      if(!kk){entry.status='missing_kk_draft';return entry;}
      if(published){entry.status='published';return entry;}
      const ruPub=await detail(uid,id,'ru','published');entry.ruPublished=!!ruPub;
      if(!ruPub){entry.status='missing_ru_published';return entry;}
      entry.publishNeeded=true;entry.status='needs_publish';
      entry.source={kkDraft:safeDetail(kk),ruPublished:safeDetail(ruPub)};
      // For only potentially publishable dependencies, capture entire native root graph.
      for(const [f,a]of relFields(schema)){
        try{
          const x=await relation(uid,id,f,'kk','draft');
          entry.dependentRelations.push({field:f,targetUid:a.target,count:x.count,items:x.items});
        }catch(e){entry.errors.push('relation:'+f+': '+errText(e));entry.status='error';}
      }
    }catch(e){entry.status='error';entry.errors.push(errText(e));}
    return entry;
  }
  // No writes. Recurse only if linked KK Published is missing and a publish would be needed.
  async function analyzeDependency(uid,id,stack=new Set(),out=new Map()){
    const key=uid+'|'+id;
    const t=await targetSummary(uid,id);
    if(['error','schema_missing','category_not_in_list','missing_shared',
      'missing_kk_draft','missing_ru_published'].includes(t.status))
      throw Error('Недоступна зависимость '+key+': '+t.status+' '+t.errors.join(', '));
    if(uid===UID)return out;
    if(t.status!=='needs_publish')return out;
    if(stack.has(key))throw Error('Цикл неопубликованных зависимостей '+key);
    const next=new Set(stack);next.add(key);
    for(const r of t.dependentRelations)for(const item of r.items)
      await analyzeDependency(r.targetUid,item.documentId,next,out);
    out.set(key,{uid,id});
    return out;
  }
  function summarizeReport(){
    const rows=report.categories;
    const counts={};for(const r of rows)counts[r.csv.status]=(counts[r.csv.status]||0)+1;
    const valid=rows.filter(x=>x.plan&&!x.plan.blockers.length);
    const deps=new Set(valid.flatMap(x=>x.plan.dependenciesToPublish||[]).map(x=>x.uid+'|'+x.id));
    const changedFieldsByName={},relationsByField={};
    for(const rec of valid){
      for(const field of rec.plan.changedFields)changedFieldsByName[field]=(changedFieldsByName[field]||0)+1;
      for(const [field,delta]of Object.entries(rec.plan.relations)){
        const totals=relationsByField[field]||{connect:0,disconnect:0};
        totals.connect+=delta.connect.length;totals.disconnect+=delta.disconnect.length;
        relationsByField[field]=totals;
      }
    }
    const pubStatus=(locale,status)=>rows.filter(r=>r.publicationComparison?.[locale]?.status===status).length;
    return {categoriesTotal:state.total,scanned:state.scanned,
      statuses:counts,createKK:valid.filter(x=>x.plan.createKK).length,
      changedFieldCount:valid.reduce((n,x)=>n+x.plan.changedFields.length,0),
      relationsConnect:valid.reduce((n,x)=>n+x.plan.connect,0),
      relationsDisconnect:valid.reduce((n,x)=>n+x.plan.disconnect,0),
      publishRUandKKCandidates:valid.length,dependenciesToPublish:deps.size,
      targetsChecked:state.targetsChecked,changedFieldsByName,relationsByField,
      published:{ruMissing:pubStatus('ru','missing_published'),
        kkMissing:pubStatus('kk','missing_published'),
        ruDifferent:pubStatus('ru','different'),kkDifferent:pubStatus('kk','different')},
      GET:report.api.requests,PUT:0,POST:0,retries:report.api.retries,
      stopped:state.stop,incomplete:report.incomplete,errors:report.errors.length};
  }
  async function run(){
    try{
      state.phase='Читаем схемы Content Manager';render();
      await loadSchema();
      state.phase='Читаем список всех RU Category';render();
      const ids=await allCategoryIds();state.total=ids.length;
      state.phase='Снимки RU/KK Draft/Published и relations';render();
      for(const item of ids){
        if(state.stop)break;
        state.current=item.name||item.documentId;render();
        const rec={documentId:item.documentId,name:item.name,
          snapshot:null,plan:null,dependencyProblems:[],targetKeys:[],csv:null};
        try{
          rec.snapshot=await snapshot(UID,item.documentId);
          rec.plan=auditCategory(item,rec);
        }catch(e){
          rec.failure=errText(e);
          rec.plan={createKK:false,changedFields:[],connect:0,disconnect:0,blockers:[rec.failure],warnings:[]};
        }
        if(rec.snapshot)rec.publicationComparison={
          ru:publicationDelta(rec.snapshot,'ru'),kk:publicationDelta(rec.snapshot,'kk')};
        state.categoryById.set(item.documentId,rec);
        report.categories.push(rec);
        state.scanned++;render('Снимки: '+state.scanned+'/'+state.total);
        if(WAIT_BETWEEN_CATEGORIES_MS)await delay(WAIT_BETWEEN_CATEGORIES_MS);
      }
      // Addressed read-only unique field checks with a positive-control query.
      state.phase='Проверка unique полей (GET-фильтры)';render();
      for(const rec of report.categories){
        if(state.stop)break;
        try{await uniqueEvidenceFor(rec);}
        catch(e){rec.plan.blockers.push('Unique диагностика: '+errText(e));}
      }
      // Build source-side target inventory from all root relations.
      const refs=new Map();
      for(const rec of report.categories)for(const ref of rec.plan.dependencies||[])
        refs.set(ref.targetUid+'|'+ref.documentId,{uid:ref.targetUid,id:ref.documentId});
      state.targetsTotal=refs.size;
      state.phase='Проверяем все уникальные relation targets и KK-версии';render();
      for(const ref of refs.values()){
        if(state.stop)break;
        await targetSummary(ref.uid,ref.id);
        state.targetsChecked++;
        render('Проверка целей: '+state.targetsChecked+'/'+state.targetsTotal);
      }
      // Dependency closure and final per-Category statuses.
      state.phase='Проверяем зависимости и уточняем план';render();
      const futureSeedable=new Set(report.categories.filter(r=>r.plan.createKK&&
        r.plan.blockers.length===0).map(r=>r.documentId));
      // Resolve blocked seed chains until stable: don't treat invalid future KK as available.
      let changed=true,passes=0;
      while(changed&&!state.stop){
        changed=false;passes++;
        for(const id of [...futureSeedable]){
          const rec=state.categoryById.get(id);
          let possible=true;
          for(const d of rec.plan.dependencies){
            if(d.targetUid===UID){
              if(!state.categoryById.get(d.documentId)?.snapshot?.kk?.draft?.exists&&
                 !futureSeedable.has(d.documentId)){possible=false;break;}
              continue;
            }
            // A newly created KK cannot be seeded when an external target or
            // its necessary publication chain is unavailable.
            try{await analyzeDependency(d.targetUid,d.documentId);}
            catch{possible=false;break;}
          }
          if(!possible){futureSeedable.delete(id);changed=true;}
        }
        if(passes>state.total+1)break;
      }
      for(const rec of report.categories){
        const plan=rec.plan,problems=rec.dependencyProblems;
        if(!plan.blockers.length){
          for(const d of plan.dependencies){
            if(state.stop)break;
            const key=d.targetUid+'|'+d.documentId;
            const target=state.targetByKey.get(key);
            rec.targetKeys.push(key);
            if(d.targetUid===UID){
              if(!target||(!target.kkDraft&&!futureSeedable.has(d.documentId)))
                problems.push({field:d.field,target:key,reason:'missing_kk_category_and_not_seedable'});
              continue;
            }
            if(!target||['error','schema_missing','category_not_in_list','missing_shared',
              'missing_kk_draft','missing_ru_published'].includes(target.status)){
              problems.push({field:d.field,target:key,reason:target?.status||'target_missing',
                errors:target?.errors});
            }else if(target.status==='needs_publish'){
              try{
                const chain=await analyzeDependency(d.targetUid,d.documentId);
                plan.dependenciesToPublish||=[];
                for(const x of chain.values())if(!plan.dependenciesToPublish.some(y=>y.uid===x.uid&&y.id===x.id))
                  plan.dependenciesToPublish.push(x);
              }catch(e){problems.push({field:d.field,target:key,reason:errText(e)});}
            }
          }
        }
        if(problems.length)plan.blockers.push('Некорректные KK зависимости: '+problems.length);
        const blocked=plan.blockers.length>0;
        const changedData=!!plan.createKK||plan.changedFields.length>0||plan.connect>0||plan.disconnect>0;
        const statusName=blocked?'blocked':changedData?'pending':'already_normalized';
        rec.csv={documentId:rec.documentId,name:rec.name,status:statusName,
          reason:plan.blockers.join(' | '),
          hasRuDraft:!!rec.snapshot?.ru.draft.exists,
          hasRuPublished:!!rec.snapshot?.ru.published.exists,
          hasKkDraft:!!rec.snapshot?.kk.draft.exists,
          hasKkPublished:!!rec.snapshot?.kk.published.exists,
          createKK:!!plan.createKK,changedFields:plan.changedFields,
          relationsConnect:plan.connect,relationsDisconnect:plan.disconnect,
          missingKKTargets:problems.map(x=>x.target+':'+x.reason),
          dependenciesToPublish:(plan.dependenciesToPublish||[]).map(x=>x.uid+'|'+x.id),
          expectedRUandKKPublish:!blocked,warnings:plan.warnings,errors:rec.snapshot?.errors||[]};
        render('Планы: '+(report.categories.indexOf(rec)+1)+'/'+report.categories.length);
      }
      report.targets=[...state.targetByKey.values()];
      if(state.stop){report.incomplete=true;report.warnings.push('Остановка по запросу пользователя: частичный отчёт');}
    }catch(e){report.incomplete=true;report.errors.push({phase:state.phase,reason:errText(e)});
      console.error('[Category Dry Run] Ошибка этапа',state.phase,e);
    }finally{
      for(const rec of report.categories)if(!rec.csv){
        rec.csv={documentId:rec.documentId,name:rec.name,status:'incomplete',
          reason:rec.plan?.blockers?.join(' | ')||'Не завершена проверка',errors:rec.snapshot?.errors||[]};
      }
      report.finishedAt=new Date().toISOString();report.summary=summarizeReport();
      stopButton.disabled=true;state.phase='completed';render('Готово. Скачиваем полный JSON и CSV');
      try{jsonButton.onclick();csvButton.onclick();}catch(e){console.warn('[Category Dry Run] Скачивание: '+errText(e));}
      console.log('[Category Dry Run] Итог',report.summary);
      // Expose report for manual download/debug in the same tab, without persistent storage.
      window.tmCategoryDiagnosticReport=report;
      window[RUN_KEY]=false;
    }
  }
  await run();
})();