(async function attributeKKDryRun() {
  'use strict';
  const UID = 'api::attribute.attribute';
  const TAG = '[Attribute KK Dry-run]';
  const SHARED_DICTIONARIES = new Set(['api::shade.shade','api::volume.volume']);
  const ROOT = '/admin/content-manager/collection-types/' + UID + '/';
  const docId = location.pathname.startsWith(ROOT)
    ? decodeURIComponent(location.pathname.slice(ROOT.length).replace(/\/$/, '')) : '';
  if (!/^[a-z0-9]{16,32}$/i.test(docId) ||
      new URL(location.href).searchParams.get('plugins[i18n][locale]') !== 'ru') {
    console.error(TAG, 'Откройте RU-карточку конкретного предложения');
    return;
  }
  if (window.__tmAttributeKKDryRunRunning) {
    console.warn(TAG, 'Dry-run уже выполняется'); return;
  }
  window.__tmAttributeKKDryRunRunning = true;
  const report = {
    version: 1, mode: 'dry-run', uid: UID, documentId: docId,
    startedAt: new Date().toISOString(), finishedAt: null,
    status: 'running', counters: {GET:0,PUT:0,POST:0,retries:0},
    source: null, target: null, plan: null, warnings: [], errors: []
  };
  window.tmAttributeKKDryRunReport = report;
  const ensure = (ok,msg) => { if (!ok) throw Error(msg); };
  const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
  const eq = (x,y) => JSON.stringify(x) === JSON.stringify(y);
  const ids = xs => xs.map(x => x.documentId).sort();
  function jwt() {
    let value = localStorage.getItem('jwtToken');
    try { value = JSON.parse(value); } catch {}
    ensure(typeof value === 'string' && value.trim(), 'Нет Admin jwtToken');
    return value.trim().replace(/^Bearer\s+/i,'');
  }
  async function get(path,allow404=false) {
    for (let attempt=1;attempt<=3;attempt++) {
      report.counters.GET++;
      let response, raw;
      try {
        response = await fetch(path,{
          method:'GET',credentials:'include',cache:'no-store',
          headers:{Authorization:'Bearer '+jwt(),Accept:'application/json'}
        });
        raw=await response.text();
      } catch(e) {
        if(attempt===3) throw Error('GET network '+path+': '+e.message);
        report.counters.retries++;await sleep(500*attempt);continue;
      }
      if(allow404 && response.status===404) return null;
      let data;
      try { data=raw?JSON.parse(raw):null; }
      catch {throw Error('GET non-JSON '+path);}
      if(response.ok) return data;
      if(attempt<3 && [408,429,500,502,503,504].includes(response.status)) {
        report.counters.retries++;await sleep(500*attempt);continue;
      }
      throw Error('GET HTTP '+response.status+' '+path+': '+
        (data?.error?.message || raw.slice(0,120)));
    }
  }
  function url(uid,id,locale,status) {
    return '/content-manager/collection-types/'+uid+'/'+encodeURIComponent(id)+
      '?locale='+locale+'&status='+status;
  }
  async function detail(uid,id,locale,status,allowFallback=false) {
    const raw=(await get(url(uid,id,locale,status),true))?.data;
    if(raw==null || (typeof raw==='object' && !Array.isArray(raw) &&
       !Object.keys(raw).length)) return null;
    ensure(!Array.isArray(raw) && raw.documentId===id,
      'Неверный documentId '+uid+'/'+id+'/'+locale);
    if(raw.locale!==locale) {
      if(allowFallback) return {fallbackLocale:raw.locale||null};
      throw Error('Неверная locale '+uid+'/'+id+'/'+locale+': '+raw.locale);
    }
    if(status==='published' && !raw.publishedAt) return null;
    return raw;
  }
  async function relations(field,locale,status) {
    const result=[],seen=new Set();
    let expected=null, pages=null;
    const base='/content-manager/relations/'+UID+'/'+encodeURIComponent(docId)+
      '/'+encodeURIComponent(field);
    for(let page=1;page<=10000;page++) {
      const q=new URLSearchParams({locale,status,page:String(page),pageSize:'100'});
      const data=await get(base+'?'+q);
      ensure(Array.isArray(data?.results) &&
        Number.isSafeInteger(data.pagination?.total) &&
        Number.isSafeInteger(data.pagination?.pageCount),
        'Нет достоверной пагинации '+field+'/'+locale+'/'+status);
      if(expected===null) {
        expected=data.pagination.total;pages=data.pagination.pageCount;
      }
      ensure(expected===data.pagination.total && pages===data.pagination.pageCount,
        'Пагинация изменилась '+field);
      for(const row of data.results) {
        ensure(row?.documentId && Number.isSafeInteger(row.id) && row.id>0,
          'Связь без id '+field);
        ensure(!seen.has(row.documentId),'Дубликат relation '+field+'/'+row.documentId);
        seen.add(row.documentId);
        result.push({documentId:row.documentId,id:row.id,locale:row.locale||locale});
      }
      if(page>=pages) break;
      ensure(data.results.length>0,'Пустая страница relation '+field);
    }
    ensure(result.length===expected,'Не все relations загружены '+field);
    return result.sort((a,b)=>a.documentId.localeCompare(b.documentId));
  }
  function exportFile() {
    const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download='attribute-kk-dry-run-'+docId+'.json';
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),3000);
  }
  try {
    const typeData=await get('/content-manager/content-types');
    ensure(Array.isArray(typeData?.data),'Нет схем Content Manager');
    const allSchemas=new Map(typeData.data.map(x=>[x.uid,x]));
    const schema=allSchemas.get(UID);
    ensure(schema?.attributes,'Нет схемы Attribute');
    const system=new Set(['id','documentId','locale','status','createdAt',
      'updatedAt','publishedAt','createdBy','updatedBy','localizations','__pivot']);
    const defs=Object.entries(schema.attributes).filter(([name])=>!system.has(name));
    const relationDefs=defs.filter(([,def])=>def.type==='relation');
    const unsupported=defs.filter(([,def])=>def.type==='component' ||
      def.type==='dynamiczone');
    const snapshots={ru:{draft:null,published:null},kk:{draft:null,published:null}};
    const omissions={};
    for(const locale of ['ru','kk']) for(const status of ['draft','published']) {
      const row=await detail(UID,docId,locale,status);
      if(!row) continue;
      const fields={},links={},missing=[];
      for(const [name,def] of defs) {
        if(def.type==='relation') continue;
        if(!Object.hasOwn(row,name)) {missing.push(name);continue;}
        fields[name]=row[name];
      }
      for(const [name] of relationDefs) {
        const list=await relations(name,locale,status);
        if(Number.isSafeInteger(row[name]?.count))
          ensure(row[name].count===list.length,
            'relation count mismatch '+locale+'/'+status+'/'+name);
        else report.warnings.push('Нет исходного count relation '+locale+'/'+status+'/'+name);
        links[name]=list;
      }
      snapshots[locale][status]={
        meta:{id:row.id,documentId:row.documentId,locale:row.locale,
          status:row.status,publishedAt:row.publishedAt||null,
          updatedAt:row.updatedAt||null},
        fields,relations:links,omittedFields:missing
      };
      if(missing.length) omissions[locale+'/'+status]=missing;
    }
    const ru=snapshots.ru.draft,ruPublished=snapshots.ru.published;
    ensure(ru,'RU Draft отсутствует');
    const blockers=[],notes=[];
    if(unsupported.length)
      blockers.push('Неподдерживаемые компоненты: '+unsupported.map(x=>x[0]).join(', '));
    if(!ruPublished) blockers.push('RU Published отсутствует');
    if(snapshots.kk.draft || snapshots.kk.published)
      blockers.push('KK уже существует: режим create не применяется');
    if(ru.omittedFields.length)
      blockers.push('Невозможно проверить общие RU поля из-за прав: '+
        ru.omittedFields.join(', '));
    if(report.warnings.some(x=>x.startsWith('Нет исходного count')))
      blockers.push('Есть связи без проверяемого исходного count');
    const fieldDiffs=ruPublished
      ? Object.keys(ru.fields).filter(k=>!eq(ru.fields[k],ruPublished.fields[k])) : [];
    const relationDiffs=ruPublished
      ? Object.keys(ru.relations).filter(k=>
        !eq(ids(ru.relations[k]),ids(ruPublished.relations[k]))) : [];
    if(fieldDiffs.length || relationDiffs.length)
      blockers.push('RU Draft отличается от Published; поля: '+fieldDiffs.join(', ')+
        '; связи: '+relationDiffs.join(', '));
    const savePayload={locale:'kk'};
    const fieldPlan={};
    for(const [name,def] of defs) {
      if(def.type==='relation') continue;
      const readable=Object.hasOwn(ru.fields,name);
      fieldPlan[name]={
        shared:def.pluginOptions?.i18n?.localized!==true,
        readable,action:readable?'copy_ru':'omit_permission_limited'
      };
      if(!readable) continue;
      let value=ru.fields[name];
      if(def.type==='media' && value!=null) {
        const number=x=>Number.isSafeInteger(x)?x:x?.id;
        value=def.multiple
          ? (Array.isArray(value)?value.map(number):null)
          : number(value);
        ensure(value!=null && (Array.isArray(value)
          ?value.every(n=>Number.isSafeInteger(n)&&n>0)
          :Number.isSafeInteger(value)&&value>0),'Неверное media ID '+name);
      } else if(!['string','text','richtext','email','enumeration','json','blocks',
        'integer','biginteger','float','decimal','boolean','date','time',
        'datetime','uid','password','media'].includes(def.type)) {
        blockers.push('Неподдерживаемое поле '+name+': '+def.type);continue;
      }
      savePayload[name]=value;
      if(def.required && (value===null || value==='' || value===undefined))
        blockers.push('RU обязательное поле пустое: '+name);
    }
    const relPlans={},connect={};
    for(const [name,def] of relationDefs) {
      const shared=SHARED_DICTIONARIES.has(def.target);
      const candidates=[];
      for(const row of ru.relations[name]) {
        if(shared) {
          candidates.push({id:row.id,documentId:row.documentId,locale:row.locale});
          continue;
        }
        const other=await detail(def.target,row.documentId,'kk','draft',true);
        const published=await detail(def.target,row.documentId,'kk','published',true);
        if(!other || other.fallbackLocale || !Number.isSafeInteger(other.id))
          blockers.push('Нет подтверждённого KK Draft для '+name+'/'+row.documentId);
        else if(!published || published.fallbackLocale)
          blockers.push('Нет KK Published для '+name+'/'+row.documentId);
        if(other?.id && !other.fallbackLocale)
          candidates.push({id:other.id,documentId:row.documentId,locale:'kk'});
      }
      relPlans[name]={
        target:def.target,sharedDictionary:shared,
        count:ru.relations[name].length,connectCandidate:candidates,
        afterSeedCheckRequired:true
      };
      if(candidates.length) connect[name]={connect:candidates,disconnect:[]};
    }
    const path='/content-manager/collection-types/'+UID+'/'+docId;
    const publishPayload={...savePayload};
    for(const [name] of relationDefs)
      publishPayload[name]={connect:[],disconnect:[]};
    notes.push('PUT seed и POST publish для Attribute ещё не подтверждены live Network; это только кандидаты.');
    notes.push('После seed повторно проверить KK связи: если Strapi скопировал volume сам, PUT connect не нужен.');
    notes.push('Сохранение и публикация требуют сравнения RU Draft/Published до и после каждой записи.');
    if(ru.omittedFields.length)
      notes.push('Невидимые поля не отправляются как null; их неизменность без дополнительных прав не доказать.');
    report.source={
      ruDraft:ru.meta,ruPublished:ruPublished?.meta||null,
      fieldCount:Object.keys(ru.fields).length,
      omittedFields:ru.omittedFields,
      relationCounts:Object.fromEntries(Object.entries(ru.relations)
        .map(([name,rows])=>[name,rows.length])),
      draftVsPublished:{fieldDiffs,relationDiffs}
    };
    report.target={
      kkDraft:snapshots.kk.draft?.meta||null,
      kkPublished:snapshots.kk.published?.meta||null
    };
    report.plan={
      action:snapshots.kk.draft?'kk_exists_blocked':'would_create_kk',
      readyToApply:blockers.length===0,blockers,notes,fieldPlan,relationPlans:relPlans,
      requestsNotExecuted:[
        {stage:'seed',method:'PUT',url:path+'?locale=kk',
          payloadCandidate:savePayload},
        {stage:'connect_if_missing_after_seed',method:'PUT',
          url:path+'?locale=kk',payloadCandidate:{locale:'kk',...connect}},
        {stage:'publish_after_verified_draft',method:'POST',
          url:path+'/actions/publish?locale=kk',payloadCandidate:publishPayload}
      ],
      postflight:{
        compareFourVersions:true,compareRUFieldsAndRelations:true,
        compareKKFieldsAndRelations:true,
        compareRelationDocumentIdsNotNumericIds:true,
        unverifiableFields:ru.omittedFields
      }
    };
    report.status='complete';
    console.log(TAG,report.plan.action,'готовность:',report.plan.readyToApply,
      'блокеров:',blockers.length,'GET:',report.counters.GET);
    if(blockers.length)console.warn(TAG,blockers);
  } catch(e) {
    report.status='failed';
    report.errors.push(e?.message||String(e));
    console.error(TAG,e);
  } finally {
    report.finishedAt=new Date().toISOString();
    try{exportFile();}catch(e){console.error(TAG,'Не выгружен JSON:',e);}
    window.__tmAttributeKKDryRunRunning=false;
  }
})();