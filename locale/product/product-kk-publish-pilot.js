// Product RU→KK — одноразовый пилот публикации локалей, Strapi Admin 5.13.
// Только для documentId ниже: сначала подготовить KK Draft через guarded-pilot.
// Порядок: GET schema/RU Draft/Published/KK Draft (+relations) → dry-run,
// ручное подтверждение → POST Publish KK → GET/verify → POST Publish RU → GET/verify.
// При повреждении/неопределённости после KK Publish второй Publish не выполняется.
// Не batch. Не создаёт KK. Не восстанавливает/не откатывает изменения.
(async () => {
  'use strict';
  const UID = 'api::product.product';
  const DOCUMENT_ID = 'eio2evn0avkjzrsjawn5wtpt';
  const LOCALES = ['ru', 'kk'];
  const STORAGE = '__tmProductKkPublishPilot';
  const PANEL_ID = 'tm-product-kk-publish-pilot';
  const SYSTEM = new Set([
    'id', 'documentId', 'locale', 'status', 'publishedAt',
    'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'localizations'
  ]);
  const SCALAR = new Set([
    'string','text','richtext','email','password','enumeration','json',
    'integer','biginteger','float','decimal','boolean','date','time','datetime'
  ]);
  const match = location.pathname.match(
    /^\/admin\/content-manager\/collection-types\/api::product\.product\/([a-z0-9]+)\/?$/i
  );
  if (!match || match[1] !== DOCUMENT_ID) {
    console.error('[Product Publish]', 'Открой RU-карточку товара:', DOCUMENT_ID);
    return;
  }
  const chosenLocale = new URLSearchParams(location.search).get('plugins[i18n][locale]');
  if (chosenLocale && chosenLocale !== 'ru') {
    console.error('[Product Publish]', 'Перейди на локаль RU товара');
    return;
  }
  const old = window[STORAGE];
  if (old?.running) {
    console.warn('[Product Publish]', 'Предыдущая операция ещё выполняется');
    return;
  }
  document.getElementById(PANEL_ID)?.remove();
  const state = { running: false, audit: null, lastReport: null };
  window[STORAGE] = state;
  let token;
  try { token = JSON.parse(localStorage.getItem('jwtToken')); }
  catch { token = localStorage.getItem('jwtToken'); }
  if (typeof token !== 'string' || !token) {
    console.error('[Product Publish]', 'Требуется авторизация Strapi Admin');
    return;
  }

  const elt = (tag, text) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    return node;
  };
  const panel = elt('section');
  panel.id = PANEL_ID;
  Object.assign(panel.style, {
    position: 'fixed', right: '14px', bottom: '14px', zIndex: '2147483600',
    width: 'min(450px, calc(100vw - 28px))', maxHeight: '80vh',
    overflowY: 'auto', background: '#1b1b2c', color: '#eee',
    padding: '16px', borderRadius: '10px', border: '1px solid #7777aa',
    font: '13px/1.5 system-ui, sans-serif', boxShadow: '0 8px 40px #0008'
  });
  const heading = elt('strong', 'Product: публикация KK → RU (один товар)');
  const status = elt('p', 'Читаем RU, KK, схему и все relations…');
  status.style.whiteSpace = 'pre-wrap';
  const buttons = elt('div');
  Object.assign(buttons.style, {display:'flex',gap:'8px',flexWrap:'wrap'});
  const checkBtn = elt('button', 'Повторить dry-run');
  const publishBtn = elt('button', 'Опубликовать KK → RU');
  const closeBtn = elt('button', 'Закрыть');
  for (const b of [checkBtn,publishBtn,closeBtn]) {
    Object.assign(b.style, {
      padding: '8px 11px', borderRadius: '6px', background: '#37375b',
      border: '1px solid #9696c8', color: 'white', cursor: 'pointer'
    });
    b.type = 'button'; buttons.append(b);
  }
  publishBtn.disabled = true;
  panel.append(heading, elt('p','documentId: '+DOCUMENT_ID), status, buttons);
  document.body.append(panel);
  closeBtn.onclick = () => { if (!state.running) panel.remove(); };

  const show = (message, error=false) => {
    status.textContent = message;
    status.style.color = error ? '#ffa9a9' : '#e5e5f6';
    console[error?'error':'log']('[Product Publish]', message);
  };
  function save(name, report) {
    const blob = new Blob([JSON.stringify(report,null,2)],{type:'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a=elt('a');a.href=url;a.download=name+'-'+DOCUMENT_ID+'.json';
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),6000);
  }
  const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      const v={};for(const key of Object.keys(value).sort())v[key]=canonical(value[key]);
      return v;
    }
    return value;
  };
  const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
  const fields=(detail,schema)=>Object.fromEntries(
    Object.keys(schema.attributes).filter(name=>!SYSTEM.has(name))
      .map(name=>[name,
        Object.prototype.hasOwnProperty.call(detail,name)
          ? detail[name] : {__missing:true}])
  );
  const diffs=(a,b)=>Object.keys(a).filter(key=>!same(a[key],b[key]))
    .map(key=>({field:key,before:a[key],after:b[key]}));
  const dpath=(locale,statusValue='draft')=>
    '/content-manager/collection-types/'+UID+'/'+DOCUMENT_ID+
    '?locale='+locale+'&status='+statusValue;
  async function request(method,path,body) {
    const response=await fetch(path,{
      method, credentials:'include',cache:'no-store',
      headers:{
        Authorization:'Bearer '+token,
        Accept:'application/json',
        ...(body===undefined?{}:{'Content-Type':'application/json'})
      },
      ...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    const t=await response.text();let json=null;
    try{json=t?JSON.parse(t):null;}catch{}
    return {ok:response.ok,status:response.status,body:json,
      message:String(json?.error?.message || (response.ok?'':t)).slice(0,350)};
  }
  async function mustGet(path) {
    const result=await request('GET',path);
    if(!result.ok)throw Error('GET HTTP '+result.status+' '+path+': '+result.message);
    return result.body;
  }
  function getDetailResult(r,locale,isPublished) {
    const d=r?.body?.data;
    if (r?.ok && d?.documentId===DOCUMENT_ID && d.locale===locale &&
        (isPublished ? d.publishedAt!=null : true)) return d;
    if (r?.status===404 ||
        (r?.ok && d && !Array.isArray(d) && Object.keys(d).length===0)) return null;
    throw Error('Неоднозначная версия '+locale+'/'+(isPublished?'published':'draft')+
      ', HTTP '+r?.status);
  }
  const relationNames=schema=>Object.entries(schema.attributes)
    .filter(([,a])=>a?.type==='relation' && typeof a.target==='string' &&
      a.target.startsWith('api::')).map(([name])=>name);
  async function readRelations(locale,publication,names) {
    const out={};
    for(const field of names){
      let p=1,total=null;const ids=[];
      do{
        const path='/content-manager/relations/'+UID+'/'+DOCUMENT_ID+'/'+field+
          '?locale='+locale+'&status='+publication+'&page='+p+'&pageSize=100';
        const r=await mustGet(path);
        if(!Array.isArray(r?.results)||!Number.isInteger(r?.pagination?.total)||
           (total!==null&&total!==r.pagination.total)) {
          throw Error('Некорректная пагинация relations '+locale+'/'+publication+'/'+field);
        }
        total=r.pagination.total;
        for(const entry of r.results) {
          const key=entry?.documentId ?? entry?.id;
          if(key==null)throw Error('Без ID в relation '+field);
          ids.push(String(key));
        }
        if(ids.length>=total)break;
        if(r.results.length===0||p>=50)throw Error('Неполная relation '+field);
        p++;
      }while(true);
      if(ids.length!==total)throw Error('Несовпадение count relation '+field);
      out[field]={total,ids:ids.sort()};
    }
    return out;
  }
  async function readAll(schema) {
    const responses=await Promise.all([
      request('GET',dpath('ru')),request('GET',dpath('ru','published')),
      request('GET',dpath('kk')),request('GET',dpath('kk','published'))
    ]);
    const ru=getDetailResult(responses[0],'ru',false);
    const ruPublished=getDetailResult(responses[1],'ru',true);
    const kk=getDetailResult(responses[2],'kk',false);
    const kkPublished=getDetailResult(responses[3],'kk',true);
    if(!ru)throw Error('RU Draft отсутствует');
    const names=relationNames(schema);
    const data={ru:{draft:ru,published:ruPublished},kk:{draft:kk,published:kkPublished}};
    const versions={};
    for(const locale of LOCALES){
      versions[locale]={};
      for(const [statusValue,detail] of Object.entries(data[locale])){
        versions[locale][statusValue]=detail ? {
          detail, business:canonical(fields(detail,schema)),
          relations:await readRelations(locale,statusValue,names)
        } : null;
      }
    }
    return versions;
  }
  const requiredEmpty=v=>v==null || typeof v==='string'&&v.trim()==='' ||
      Array.isArray(v)&&v.length===0;
  function mapMedia(value) {
    if (value==null) return {ok:true,value:null};
    const id=e=>Number.isInteger(e)&&e>0?e:
      Number.isInteger(e?.id)&&e.id>0?e.id:null;
    if(Array.isArray(value)){
      const all=value.map(id);
      return all.some(v=>v==null)?{ok:false}:{ok:true,value:all};
    }
    const one=id(value);return one==null?{ok:false}:{ok:true,value:one};
  }
  function buildPayload(schema,detail,locale) {
    const payload={locale},blockers=[],warnings=[];
    for(const [name,a] of Object.entries(schema.attributes)){
      if(SYSTEM.has(name)||a?.type==='relation')continue;
      const localized=a?.pluginOptions?.i18n?.localized===true || a?.type==='uid';
      if(!Object.prototype.hasOwnProperty.call(detail,name)){
        blockers.push(name+': отсутствует в '+locale);continue;
      }
      const v=detail[name];
      if(a?.required===true&&requiredEmpty(v)){
        blockers.push(name+': обязательное поле пусто в '+locale);continue;
      }
      if(a?.type==='uid'){
        if(v!=null && v!=='')blockers.push(name+': UID требует отдельной обработки');
        continue;
      }
      if(v===null){payload[name]=null;continue;}
      if(SCALAR.has(a?.type)){
        if(a.type!=='json'&&typeof v==='object'){
          blockers.push(name+': скаляр пришёл как объект');continue;
        }
        payload[name]=v;
      }else if(a?.type==='media'){
        const mapped=mapMedia(v);
        if(!mapped.ok)blockers.push(name+': отсутствуют media IDs');
        else payload[name]=mapped.value;
      }else if(a?.type==='component'||a?.type==='dynamiczone'){
        if(Array.isArray(v)&&v.length===0)payload[name]=[];
        else blockers.push(name+': непустой '+a.type+' требует отдельного теста');
      }else{
        blockers.push(name+': неподдержанный тип '+String(a?.type));
      }
      if(localized&&a?.required&&typeof v==='string'&&v.length<2)
        warnings.push('Короткое локализуемое поле '+name+' в '+locale);
    }
    return {payload,blockers,warnings};
  }
  function contentErrors(before,after,phase) {
    const errors=[];
    const compare=(label,a,b)=>{
      if(!a||!b){errors.push(label+': отсутствует версия');return;}
      const dd=diffs(a.business,b.business);
      const rr=diffs(a.relations,b.relations);
      if(dd.length)errors.push(label+': различаются поля '+dd.map(x=>x.field).join(','));
      if(rr.length)errors.push(label+': изменились relations '+rr.map(x=>x.field).join(','));
    };
    // Published RU до собственного Publish не должна измениться.
    if(phase==='kk') {
      compare('RU Draft',before.ru.draft,after.ru.draft);
      compare('RU Published',before.ru.published,after.ru.published);
      compare('KK Draft',before.kk.draft,after.kk.draft);
      compare('KK Published vs KK Draft',before.kk.draft,after.kk.published);
    }
    if(phase==='ru') {
      compare('RU Draft',before.ru.draft,after.ru.draft);
      compare('RU Published vs RU Draft',before.ru.draft,after.ru.published);
      compare('KK Draft',before.kk.draft,after.kk.draft);
      compare('KK Published vs KK Draft',before.kk.draft,after.kk.published);
    }
    return errors;
  }
  async function loadAudit() {
    const schemaList=await mustGet('/content-manager/content-types');
    const schema=schemaList?.data?.find(x=>x?.uid===UID);
    if(!schema?.attributes||schema.pluginOptions?.i18n?.localized!==true)
      throw Error('Схема Product / i18n не подтверждена');
    const versions=await readAll(schema);
    const blockers=[];
    if(!versions.ru.published)blockers.push('RU не опубликована до теста');
    if(!versions.kk.draft)blockers.push('KK Draft ещё нет: сначала создать безопасным guarded-pilot');
    if(versions.kk.published)blockers.push('KK уже опубликована — повторный publish запрещён');
    let payloads=null;
    if(versions.ru.draft&&versions.kk.draft){
      const ru=buildPayload(schema,versions.ru.draft.detail,'ru');
      const kk=buildPayload(schema,versions.kk.draft.detail,'kk');
      payloads={ru:ru.payload,kk:kk.payload};
      blockers.push(...ru.blockers.map(x=>'RU '+x),...kk.blockers.map(x=>'KK '+x));
      // До любой публикации все non-localized поля должны совпадать.
      for(const [name,a] of Object.entries(schema.attributes)){
        if(SYSTEM.has(name)||a.type==='relation'||a.type==='uid'||
           a.pluginOptions?.i18n?.localized===true)continue;
        if(!same(versions.ru.draft.business[name],versions.kk.draft.business[name])){
          blockers.push('Общее поле не совпадает RU/KK: '+name);
        }
      }
    }
    return {schema,versions,payloads,blockers,checkedAt:new Date().toISOString()};
  }
  function baseReport(audit) {
    return {
      tool:'product-kk-publish-pilot',documentId:DOCUMENT_ID,uid:UID,
      checkedAt:audit.checkedAt,blockers:audit.blockers,
      payloads:audit.payloads, before:audit.versions
    };
  }
  async function dryRun() {
    if(state.running)return;
    state.running=true;state.audit=null;
    checkBtn.disabled=true;publishBtn.disabled=true;
    show('GET: схема, RU/KK Draft и Published, все relations…');
    try{
      const audit=await loadAudit();
      const report={...baseReport(audit),phase:'dry-run',readOnly:true};
      state.audit=audit;state.lastReport=report;
      window.tmProductKkPublishReport=report;
      save('product-kk-publish-dry-run',report);
      if(audit.blockers.length){
        show('Публикация заблокирована:\n'+audit.blockers.slice(0,8).join('\n')+
          '\nСохранён dry-run JSON.',true);
      }else{
        publishBtn.disabled=false;
        show('Dry-run пройден. KK Draft существует, RU Draft/Published прочитаны.'+
          '\nPayload содержит все поддержанные поля каждой локали.'+
          '\nПеред публикацией сохранён JSON. Нажми Publish только для этого теста.');
      }
    }catch(error){
      show('Dry-run прерван: '+String(error.message||error),true);
    }finally{state.running=false;checkBtn.disabled=false;}
  }
  async function publishBoth() {
    if(state.running||!state.audit||state.audit.blockers.length)return;
    if(!confirm('Тест ОДНОГО товара '+DOCUMENT_ID+
      '\n\nПубликация KK, затем RU. RU Modified также будет опубликована.'+
      '\nПосле каждого POST — строгая сверка всех полей и relations.'+
      '\nЕсли первый POST частично сработал, автоматического rollback нет.'+
      '\n\nПродолжить?'))return;
    state.running=true;publishBtn.disabled=true;checkBtn.disabled=true;
    const report={
      tool:'product-kk-publish-pilot',phase:'publish',documentId:DOCUMENT_ID,
      at:new Date().toISOString(),attempts:[],errors:[],snapshots:{}
    };
    let wrote=false;
    try {
      show('Повторный GET перед первой публикацией…');
      const fresh=await loadAudit();
      if(fresh.blockers.length||!same(fresh.payloads,state.audit.payloads)||
         !same(fresh.versions,state.audit.versions)){
        throw Error('Состояние/план изменились с dry-run; публикация отменена');
      }
      report.snapshots.before=fresh.versions;
      save('product-kk-publish-before-write',{
        ...baseReport(fresh),phase:'before-write'
      });

      for(const locale of ['kk','ru']){
        show('POST Publish '+locale+'; затем полное чтение обеих локалей…');
        const uri='/content-manager/collection-types/'+UID+'/'+DOCUMENT_ID+
          '/actions/publish?locale='+locale;
        wrote=true;
        let response;
        try{
          response=await request('POST',uri,fresh.payloads[locale]);
          report.attempts.push({locale,httpStatus:response.status,
            ok:response.ok,message:response.message});
        }catch(error){
          report.attempts.push({locale,httpStatus:'NETWORK',ok:false,
            message:String(error.message||error)});
          throw Error('Неопределённый результат Publish '+locale+
            '; второй Publish не запускается');
        }
        const after=await readAll(fresh.schema);
        report.snapshots['after'+locale.toUpperCase()]=after;
        const errors=contentErrors(fresh.versions,after,locale);
        if(!response.ok)errors.unshift('HTTP '+response.status+' '+response.message);
        if(errors.length)throw Error('После Publish '+locale+': '+errors.join(' | '));
        if(locale==='kk') {
          // Только после полной проверки KK можно публиковать RU.
          if(!after.kk.published)throw Error('KK Published не подтверждена');
        }else{
          if(!after.ru.published || !after.kk.published)
            throw Error('Не подтверждены обе опубликованные версии');
        }
        report.attempts[report.attempts.length-1].verified=true;
      }
      report.success=true;
      show('Готово: обе публикации подтверждены. RU/KK поля и relations совпадают.'+
        '\nСкачан полный postflight JSON.');
    }catch(error){
      report.success=false;report.errors.push(String(error.message||error));
      show('СТОП: '+report.errors.join('\n')+
        (wrote?'\nЗапись могла выполниться; повторно не запускать без анализа JSON.':''),true);
    }finally{
      report.finishedAt=new Date().toISOString();
      state.lastReport=report;window.tmProductKkPublishReport=report;
      save('product-kk-publish-postflight',report);
      state.running=false;checkBtn.disabled=false;
      // На случай частично выполненных POST повторный Publish требует нового анализа.
      publishBtn.disabled=true;
      state.audit=null;
    }
  }
  checkBtn.onclick=dryRun;
  publishBtn.onclick=publishBoth;
  await dryRun();
})();