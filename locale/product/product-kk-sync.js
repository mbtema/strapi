// Product RU → KK | один последовательный процесс в Strapi 5.13 Admin.
// Запускать на карточке Product, locale=ru. Нет привязки к бренду / documentId.
// Автоматически выполняется ТОЛЬКО GET preflight. Далее кнопка "Следующий шаг":
// 1) создать отсутствующий KK Draft (PUT shared + required localized);
// 2) Publish RU с полным payload (RU Draft -> Published);
// 3) Publish KK с полным payload (KK Draft -> Published).
// Каждая запись предваряется re-check; после неё GET обеих локалей / двух версий
// и всех relations. При расхождении — СТОП, один JSON с журналом и снимками.
// Никаких batch, rollback, автоматических повторов POST/PUT и публикации при ошибке.
(async () => {
  'use strict';
  const UID = 'api::product.product';
  const ROOT = 'tm-product-kk-sync';
  const KEY = '__tmProductKkSync';
  const SYSTEM = new Set([
    'id','documentId','locale','status','publishedAt','updatedAt',
    'createdAt','createdBy','updatedBy','localizations'
  ]);
  const TYPES = new Set([
    'string','text','richtext','email','password','enumeration','json',
    'integer','biginteger','float','decimal','boolean','date','time','datetime'
  ]);
  const pathMatch = location.pathname.match(
    /^\/admin\/content-manager\/collection-types\/api::product\.product\/([a-z0-9]+)\/?$/i
  );
  if (!pathMatch || (new URLSearchParams(location.search).get('plugins[i18n][locale]') &&
    new URLSearchParams(location.search).get('plugins[i18n][locale]') !== 'ru')) {
    console.error('[Product KK Sync]', 'Открой RU-карточку одного товара Product');
    return;
  }
  const documentId = pathMatch[1];
  const previous = window[KEY];
  if (previous && previous.stage !== 'complete' && previous.stage !== 'failed') {
    console.warn('[Product KK Sync]', 'Текущая сессия уже открыта. Используй панель, не запускай скрипт повторно.');
    return;
  }
  let token;
  try { token = JSON.parse(localStorage.getItem('jwtToken')); }
  catch { token = localStorage.getItem('jwtToken'); }
  if (typeof token !== 'string' || !token) {
    console.error('[Product KK Sync]', 'Нужна авторизация Strapi Admin (jwtToken)');
    return;
  }

  document.getElementById(ROOT)?.remove();
  const state = {
    documentId, stage: 'initializing', busy: false, schema: null,
    baseline: null, checkpoint: null, plan: null, written: false,
    report: {
      tool: 'product-kk-sync', version: 1, uid: UID, documentId,
      origin: location.origin, startedAt: new Date().toISOString(),
      mode: 'single-product', steps: [], snapshots: {}, warnings: [],
      errors: [], success: false
    }
  };
  window[KEY] = state;
  window.tmProductKkSyncReport = state.report;

  function element(tag, label) {
    const n = document.createElement(tag);
    if (label !== undefined) n.textContent = String(label);
    return n;
  }
  const panel = element('section');
  panel.id = ROOT;
  Object.assign(panel.style, {
    position:'fixed',right:'16px',bottom:'16px',zIndex:'2147483600',
    width:'min(460px, calc(100vw - 32px))', maxHeight:'80vh',overflowY:'auto',
    background:'#1b1b2c',color:'#eee',font:'13px/1.5 system-ui,sans-serif',
    border:'1px solid #7070aa',borderRadius:'10px',
    padding:'16px',boxShadow:'0 10px 36px #0008'
  });
  const title = element('strong','Product RU → KK — одна запись');
  const note = element('div','documentId: '+documentId);
  Object.assign(note.style,{fontFamily:'monospace',wordBreak:'break-all',marginTop:'5px',color:'#b8b8d8'});
  const steps=element('div');
  Object.assign(steps.style,{whiteSpace:'pre-wrap',margin:'12px 0'});
  const message=element('div','Получаем схему, RU/KK и relations…');
  Object.assign(message.style,{whiteSpace:'pre-wrap',margin:'10px 0'});
  const actions=element('div');
  Object.assign(actions.style,{display:'flex',flexWrap:'wrap',gap:'7px'});
  const next=element('button','Проверка…');
  const downloadButton=element('button','Скачать журнал');
  const close=element('button','Закрыть');
  for(const button of [next,downloadButton,close]){
    button.type='button';
    Object.assign(button.style,{
      padding:'8px 10px',border:'1px solid #8d8dc2',
      borderRadius:'6px',background:'#38385a',color:'#fff',cursor:'pointer'
    });
    actions.append(button);
  }
  next.disabled=true;
  close.onclick=()=>{if(!state.busy)panel.remove();};
  panel.append(title,note,steps,message,actions);
  document.body.append(panel);

  function render(text, isError=false){
    const phases = [
      ['ready-create','Снимок RU + проверка схемы'],
      ['ready-ru','Создать KK Draft и проверить RU'],
      ['ready-kk','Опубликовать RU и проверить обе локали'],
      ['complete','Опубликовать KK и проверить обе локали']
    ];
    const idx=phases.findIndex(([stage])=>stage===state.stage);
    steps.textContent=phases.map(([stage,label],i)=>
      (state.stage==='failed'?'•':idx>i?'✓':idx===i?'→':'○')+' '+label
    ).join('\n');
    message.textContent=text;
    message.style.color=isError?'#ffb0b0':'#e8e8ff';
    next.disabled=state.busy||!['ready-create','ready-ru','ready-kk'].includes(state.stage);
    next.textContent=state.stage==='ready-create'?'1. Создать KK Draft':
      state.stage==='ready-ru'?'2. Опубликовать RU':
      state.stage==='ready-kk'?'3. Опубликовать KK':
      state.stage==='complete'?'Завершено':'Недоступно';
  }
  function download(){
    const blob=new Blob([JSON.stringify(state.report,null,2)],{
      type:'application/json;charset=utf-8'
    });
    const url=URL.createObjectURL(blob);
    const a=element('a');
    a.download='product-kk-sync-'+documentId+'.json';
    a.href=url;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),6000);
  }
  downloadButton.onclick=download;

  const canonical = value => {
    if(Array.isArray(value))return value.map(canonical);
    if(value&&typeof value==='object'){
      const r={};for(const k of Object.keys(value).sort())r[k]=canonical(value[k]);
      return r;
    }
    return value;
  };
  const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
  const invalid=v=>v==null || typeof v==='string'&&v.trim()==='' ||
    Array.isArray(v)&&v.length===0;
  const localized=a=>a?.pluginOptions?.i18n?.localized===true || a?.type==='uid';
  function mediaIds(v){
    if(v===null)return {ok:true,value:null};
    const id=x=>Number.isInteger(x)&&x>0?x:
      Number.isInteger(x?.id)&&x.id>0?x.id:null;
    if(Array.isArray(v)){
      const items=v.map(id);
      return items.some(x=>x===null)?{ok:false}:{ok:true,value:items};
    }
    const one=id(v);
    return one===null?{ok:false}:{ok:true,value:one};
  }
  function normalizeFields(detail,schema){
    const out={};
    for(const [name,attr] of Object.entries(schema.attributes)){
      if(SYSTEM.has(name))continue;
      if(!Object.prototype.hasOwnProperty.call(detail,name)){
        out[name]={__missing:true};continue;
      }
      const v=detail[name];
      if(attr.type==='media'){
        const media=mediaIds(v);out[name]=media.ok?media.value:{__invalidMedia:true};
      }else out[name]=v;
    }
    return canonical(out);
  }
  function comparison(a,b){
    const names=new Set([...Object.keys(a||{}),...Object.keys(b||{})]);
    return [...names].filter(k=>!equal(a?.[k],b?.[k])).sort();
  }
  const dpath=(locale,publication)=>
    '/content-manager/collection-types/'+UID+'/'+documentId+
    '?locale='+locale+'&status='+publication;
  async function request(method,path,payload){
    const r=await fetch(path,{
      method,credentials:'include',cache:'no-store',
      headers:{
        Authorization:'Bearer '+token,Accept:'application/json',
        ...(payload===undefined?{}:{'Content-Type':'application/json'})
      },
      ...(payload===undefined?{}:{body:JSON.stringify(payload)})
    });
    const text=await r.text();let json=null;
    try{json=text?JSON.parse(text):null;}catch{}
    return {
      ok:r.ok,status:r.status,body:json,
      message:r.ok?'':String(json?.error?.message||text).slice(0,400)
    };
  }
  async function get(path){
    const result=await request('GET',path);
    if(!result.ok)throw Error('GET '+result.status+' '+path+': '+result.message);
    return result.body;
  }
  function detail(result,locale,published){
    const d=result?.body?.data;
    if(result.ok&&d?.documentId===documentId&&d?.locale===locale&&
      (!published||d.publishedAt!==null&&d.publishedAt!==undefined))return d;
    if(result.status===404 || result.ok&&d&&typeof d==='object'&&
      !Array.isArray(d)&&Object.keys(d).length===0)return null;
    throw Error('Не подтверждена версия '+locale+'/'+(published?'Published':'Draft')+
      ' (HTTP '+result.status+')');
  }
  function relationNames(schema){
    const fields=[];
    for(const [name,attr] of Object.entries(schema.attributes)){
      if(attr?.type!=='relation')continue;
      if(typeof attr.target!=='string'||!attr.target.startsWith('api::')){
        throw Error('Неподдержанная relation '+name+': '+String(attr.target));
      }
      if(attr?.pluginOptions?.i18n?.localized===false){
        throw Error('Non-localized relation '+name+' требует отдельной проверки');
      }
      fields.push(name);
    }
    return fields;
  }
  async function getRelations(locale,publication,names){
    const out={};
    for(const field of names){
      let page=1,total=null;
      const ids=[];
      while(true){
        const result=await get('/content-manager/relations/'+UID+'/'+documentId+'/'+
          encodeURIComponent(field)+'?locale='+locale+'&status='+publication+
          '&page='+page+'&pageSize=100');
        const pagination=result?.pagination;
        if(!Array.isArray(result?.results)||
          !Number.isInteger(pagination?.total)||
          (total!==null&&pagination.total!==total)){
          throw Error('Некорректная страница relation '+locale+'/'+publication+'/'+field);
        }
        total=pagination.total;
        for(const ref of result.results){
          const id=ref?.documentId??ref?.id;
          if(id==null)throw Error('Отсутствует ID relation '+field);
          ids.push(String(id));
        }
        if(ids.length>=total)break;
        if(result.results.length===0||page>=100)
          throw Error('Неполная relation '+field);
        page++;
      }
      if(ids.length!==total)throw Error('Несовпадение count в '+field);
      out[field]={total,ids:ids.sort()};
    }
    return canonical(out);
  }
  async function snapshot(schema){
    const rs=await Promise.all([
      request('GET',dpath('ru','draft')),
      request('GET',dpath('ru','published')),
      request('GET',dpath('kk','draft')),
      request('GET',dpath('kk','published'))
    ]);
    const versions={
      ru:{
        draft:detail(rs[0],'ru',false),
        published:detail(rs[1],'ru',true)
      },
      kk:{
        draft:detail(rs[2],'kk',false),
        published:detail(rs[3],'kk',true)
      }
    };
    if(!versions.ru.draft)throw Error('RU Draft не найден');
    const names=relationNames(schema);
    for(const locale of ['ru','kk']){
      for(const publication of ['draft','published']){
        const entity=versions[locale][publication];
        versions[locale][publication]=entity?{
          detail:entity,
          business:normalizeFields(entity,schema),
          relations:await getRelations(locale,publication,names)
        }:null;
      }
    }
    return versions;
  }
  // Копирует все общие поля RU. В KK локализуемые поля по умолчанию НЕ копируются:
  // добавляем только обязательные значения из RU, и name1 как ранний known fallback.
  function buildPayload(schema,source,local,mode,kkSource=null){
    const result={locale:local};
    const blockers=[],warnings=[];
    for(const [name,attr] of Object.entries(schema.attributes)){
      if(SYSTEM.has(name)||attr?.type==='relation')continue;
      const shared=!localized(attr);
      // KK: только общие из RU, а локализованные значения — из KK Draft.
      // RU: все поддержанные значения из RU Draft.
      const from=mode==='create'?(shared||attr.required?source:null):
        (shared||local==='ru'?source:kkSource);
      if(!from)continue;
      if(!Object.prototype.hasOwnProperty.call(from,name)){
        blockers.push('Нет поля '+name+' в '+(shared?'RU':local));continue;
      }
      const value=from[name];
      if(value===undefined){
        blockers.push('Undefined '+name+' ('+local+'): передача общего поля невозможна');
        continue;
      }
      if(attr?.type==='uid'){
        if(invalid(value)&&attr.required)blockers.push('Required UID '+name+' пуст');
        else if(!invalid(value))blockers.push('UID '+name+' требует отдельного контракта');
        continue;
      }
      if(attr.required&&invalid(value)){
        blockers.push('Required '+name+' пусто ('+local+')');continue;
      }
      if(value===null){result[name]=null;continue;}
      if(TYPES.has(attr?.type)){
        if(attr.type!=='json' && typeof value==='object'){
          blockers.push('Неверный тип '+name);continue;
        }
        result[name]=value;
      }else if(attr?.type==='media'){
        const v=mediaIds(value);
        if(!v.ok)blockers.push('Неизвестный media ID '+name);
        else result[name]=v.value;
      }else if(attr?.type==='component'||attr?.type==='dynamiczone'){
        if(Array.isArray(value)&&value.length===0)result[name]=[];
        else blockers.push('Непустой/нетипичный '+attr.type+' '+name);
      }else{
        blockers.push('Неподдержанный тип '+name+' ('+attr?.type+')');
      }
    }
    if(mode==='create'&&schema.attributes.name1&&
      localized(schema.attributes.name1)&&!('name1' in result)){
      if(typeof source.name1==='string'&&source.name1.trim()){
        result.name1=source.name1;
        warnings.push('KK name1 временно скопировано из RU');
      }else{
        result.name1=' ';
        warnings.push('KK name1: проверенная заглушка из пилотов (один пробел)');
      }
    }
    return {payload:result,blockers,warnings};
  }
  function sharedDiff(schema,ru,kk){
    const changed=[];
    for(const [name,a] of Object.entries(schema.attributes)){
      if(SYSTEM.has(name)||a?.type==='relation'||localized(a))continue;
      if(!equal(ru.business[name],kk.business[name]))changed.push(name);
    }
    return changed;
  }
  function compareVersion(name,expected,actual,errors,{checkMeta=false}={}){
    if(!expected&&!actual)return;
    if(!expected||!actual){errors.push(name+': версия исчезла/появилась');return;}
    const b=comparison(expected.business,actual.business);
    const r=comparison(expected.relations,actual.relations);
    if(b.length)errors.push(name+': изменены поля '+b.join(', '));
    if(r.length)errors.push(name+': изменены relations '+r.join(', '));
    if(checkMeta){
      const a=expected.detail, c=actual.detail;
      if(a.id!==c.id||a.updatedAt!==c.updatedAt||
         a.publishedAt!==c.publishedAt||a.status!==c.status)
        errors.push(name+': запись изменилась после снимка (id/status/timestamps)');
    }
  }
  function compareState(expected,actual,checkMeta){
    const errors=[];
    for(const locale of ['ru','kk'])for(const status of ['draft','published']){
      compareVersion(locale+' '+status,
        expected[locale][status],actual[locale][status],errors,{checkMeta});
    }
    return errors;
  }
  function afterCreate(before,after,schema){
    const errors=[];
    compareVersion('RU Draft',before.ru.draft,after.ru.draft,errors);
    compareVersion('RU Published',before.ru.published,after.ru.published,errors);
    if(!after.kk.draft)errors.push('KK Draft не появилась');
    if(after.kk.published)errors.push('KK Published появилась до публикации');
    if(after.kk.draft){
      const shared=sharedDiff(schema,after.ru.draft,after.kk.draft);
      if(shared.length)errors.push('Общие RU/KK поля отличаются: '+shared.join(', '));
      for(const [name,ref] of Object.entries(after.kk.draft.relations)){
        if(ref.total!==0)errors.push('KK relation не пуста: '+name);
      }
    }
    return errors;
  }
  function afterPublishRu(before,after,schema){
    const errors=[];
    compareVersion('RU Draft',before.ru.draft,after.ru.draft,errors);
    compareVersion('RU Published от RU Draft',before.ru.draft,after.ru.published,errors);
    compareVersion('KK Draft',before.kk.draft,after.kk.draft,errors);
    if(after.kk.published)errors.push('KK Published появилась до второго Publish');
    if(after.ru.published&&after.kk.draft){
      const shared=sharedDiff(schema,after.ru.published,after.kk.draft);
      if(shared.length)errors.push('Общие RU Published/KK Draft отличаются: '+shared.join(', '));
    }
    return errors;
  }
  function afterPublishKk(before,after,schema){
    const errors=[];
    compareVersion('RU Draft',before.ru.draft,after.ru.draft,errors);
    compareVersion('RU Published',before.ru.published,after.ru.published,errors);
    compareVersion('KK Draft',before.kk.draft,after.kk.draft,errors);
    compareVersion('KK Published от KK Draft',before.kk.draft,after.kk.published,errors);
    if(after.ru.published&&after.kk.published){
      const shared=sharedDiff(schema,after.ru.published,after.kk.published);
      if(shared.length)errors.push('Общие опубликованные поля отличаются: '+shared.join(', '));
    }
    return errors;
  }
  async function audit(){
    const schemas=await get('/content-manager/content-types');
    const schema=schemas?.data?.find(x=>x?.uid===UID);
    if(!schema?.attributes||schema?.pluginOptions?.i18n?.localized!==true)
      throw Error('Схема Product/i18n не подтверждена');
    const before=await snapshot(schema);
    const blocks=[];
    if(before.kk.draft||before.kk.published)
      blocks.push('KK уже существует. Создание/публикация другой записи запрещены');
    const plan=buildPayload(schema,before.ru.draft.detail,'kk','create');
    blocks.push(...plan.blockers);
    return {schema,before,plan,blocks};
  }
  async function initial(){
    if(state.busy)return;
    state.busy=true;render('GET preflight: схема, RU Draft/Published, KK, relations…');
    try{
      const a=await audit();
      state.schema=a.schema;state.baseline=a.before;state.checkpoint=a.before;
      state.plan=a.plan;
      state.report.snapshots.initial=a.before;
      state.report.schemaSummary=Object.fromEntries(Object.entries(a.schema.attributes)
        .filter(([name])=>!SYSTEM.has(name)).map(([name,x])=>[name,{
          type:x.type,required:x.required===true,
          localized:localized(x)||x.type==='relation'
        }]));
      state.report.warnings.push(...a.plan.warnings);
      state.report.preflight={
        blockers:a.blocks,
        sharedFields:Object.entries(a.schema.attributes).filter(
          ([name,attr])=>!SYSTEM.has(name)&&attr.type!=='relation'&&!localized(attr)
        ).length,
        requiredFields:Object.entries(a.schema.attributes).filter(
          ([name,attr])=>!SYSTEM.has(name)&&attr.required===true
        ).length,
        relationFields:Object.keys(a.before.ru.draft.relations).length,
        kk:'missing',ruStatus:a.before.ru.draft.detail.status
      };
      if(a.blocks.length)throw Error(a.blocks.join('\n'));
      state.stage='ready-create';
      render('Preflight пройден. Общих полей: '+state.report.preflight.sharedFields+
        ', обязательных: '+state.report.preflight.requiredFields+
        ', relation-полей: '+state.report.preflight.relationFields+'.'+
        '\nRU снимок сохранён в журнале (пока без записи).'+
        '\nShared-поля будут скопированы из RU. KK локализуемые значения не переносятся,'+
        ' кроме необходимых для создания. При необходимости скачай снимок.'+
        (a.plan.warnings.length?'\n'+a.plan.warnings.join('\n'):''));
    }catch(e){fail('Preflight: '+String(e.message||e));}
    finally{state.busy=false;render(message.textContent,state.stage==='failed');}
  }
  function fail(reason){
    state.stage='failed';
    state.report.errors.push(reason);
    state.report.stoppedAt=new Date().toISOString();
    console.error('[Product KK Sync]',reason);
    render('СТОП. '+reason+'\nНикаких следующих записей. Скачай JSON для диагностики.',true);
    if(state.written)download();
  }
  function logStep(phase,stepResult){
    state.report.steps.push({
      phase,at:new Date().toISOString(),...stepResult
    });
  }
  async function advance(){
    if(state.busy)return;
    const stage=state.stage;
    if(!['ready-create','ready-ru','ready-kk'].includes(stage))return;
    const titles={
      'ready-create':'создать KK Draft',
      'ready-ru':'опубликовать RU',
      'ready-kk':'опубликовать KK'
    };
    if(!confirm('Только ОДИН товар '+documentId+
      '\nДействие: '+titles[stage]+
      '\n\nПеред записью будет повторная проверка. После записи — полный postflight.'+
      '\nПри ошибке выполнение остановится, rollback нет. Продолжить?'))return;
    state.busy=true;
    render('Повторно читаем обе локали и все relations перед записью…');
    let attempted=false, method=null,uri=null,payload=null,response=null;
    try{
      const actualSchemas=await get('/content-manager/content-types');
      const actualSchema=actualSchemas?.data?.find(x=>x?.uid===UID);
      if(!actualSchema?.attributes || !equal(actualSchema.attributes,state.schema.attributes))
        throw Error('Схема Product изменилась; операция остановлена');
      const before=await snapshot(state.schema);
      const changes=compareState(state.checkpoint,before,true);
      if(changes.length)throw Error('С момента последнего шага данные изменились: '+changes.join(' | '));
      if(stage==='ready-create'){
        if(before.kk.draft||before.kk.published)throw Error('KK уже существует');
        const plan=buildPayload(state.schema,before.ru.draft.detail,'kk','create');
        if(plan.blockers.length||!equal(plan.payload,state.plan.payload))
          throw Error('План создания KK изменился: '+plan.blockers.join(' | '));
        payload=plan.payload;method='PUT';uri=dpath('kk','draft').replace('&status=draft','');
      }else if(stage==='ready-ru'){
        if(!before.kk.draft||before.kk.published)
          throw Error('Нет проверенного KK Draft или KK уже Published');
        const plan=buildPayload(state.schema,before.ru.draft.detail,'ru','publish-ru');
        if(plan.blockers.length)throw Error('RU Publish заблокирован: '+plan.blockers.join(' | '));
        payload=plan.payload;method='POST';
        uri='/content-manager/collection-types/'+UID+'/'+documentId+
          '/actions/publish?locale=ru';
      }else{
        if(!before.ru.published||!before.kk.draft||before.kk.published)
          throw Error('Ожидаются RU Published и KK Draft');
        const plan=buildPayload(state.schema,before.ru.draft.detail,
          'kk','publish-kk',before.kk.draft.detail);
        if(plan.blockers.length)throw Error('KK Publish заблокирован: '+plan.blockers.join(' | '));
        payload=plan.payload;method='POST';
        uri='/content-manager/collection-types/'+UID+'/'+documentId+
          '/actions/publish?locale=kk';
      }
      state.report.snapshots['before-'+stage]=before;
      logStep(stage,{action:method+' '+uri,payload,attempted:false});
      attempted=true;state.written=true;
      render('Отправляем '+method+' '+titles[stage]+'…');
      let networkFailure=null;
      try{response=await request(method,uri,payload);}
      catch(e){networkFailure=String(e.message||e);}
      const step=state.report.steps[state.report.steps.length-1];
      step.attempted=true;step.response=response?
        {httpStatus:response.status,ok:response.ok,message:response.message}:
        {httpStatus:'NETWORK',ok:false,message:networkFailure};
      render('GET проверка после '+titles[stage]+'…');
      let after;
      try{after=await snapshot(state.schema);}
      catch(e){
        step.verificationError=String(e.message||e);
        throw Error('Невозможно подтвердить итог после '+stage+': '+step.verificationError);
      }
      state.report.snapshots['after-'+stage]=after;
      const differences=stage==='ready-create'?afterCreate(before,after,state.schema):
        stage==='ready-ru'?afterPublishRu(before,after,state.schema):
          afterPublishKk(before,after,state.schema);
      step.contentDifferences=differences;
      if(networkFailure||!response?.ok||differences.length)
        throw Error('Операция '+stage+' не подтверждена: '+(
          networkFailure||response?.message||'')+
          (differences.length?'\n'+differences.join('\n'):''));
      step.verified=true;
      state.checkpoint=after;
      if(stage==='ready-create'){
        state.stage='ready-ru';
        render('KK Draft создана. RU Draft и Published, все relations и общие поля проверены.'+
          '\nТеперь можно опубликовать RU, даже если она стала Modified.');
      }else if(stage==='ready-ru'){
        state.stage='ready-kk';
        render('RU Published сверена с RU Draft, KK не изменилась.'+
          '\nСледующий этап — Publish KK.');
      }else{
        state.stage='complete';
        state.report.success=true;
        state.report.finishedAt=new Date().toISOString();
        render('Готово. RU и KK опубликованы; обе версии и relations проверены.'+
          '\nСкачан единый итоговый JSON.');
        download();
      }
    }catch(e){
      if(attempted)logStep('error',{after:stage,message:String(e.message||e)});
      fail(String(e.message||e));
    }finally{
      state.busy=false;
      render(message.textContent,state.stage==='failed');
    }
  }
  next.onclick=advance;
  await initial();
})();