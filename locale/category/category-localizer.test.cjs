const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/category-localizer.js','utf8');
const U='api::category.category',P='api::product.product',B='api::brand.brand';
const attr=(type,loc=false,more={})=>({type,pluginOptions:{i18n:{localized:loc}},...more});
const schemas={
  [U]:{uid:U,pluginOptions:{i18n:{localized:true}},attributes:{
    name:attr('string',true),description:attr('text',true),title:attr('string',true,{required:true}),
    active:attr('boolean'),banner:attr('media',true),filters_app:attr('component',false,{component:'cat.filters',repeatable:true}),
    categories:attr('relation',true,{target:U}),product:attr('relation',true,{target:P}),
    top_brands:attr('relation',true,{target:B}),products:attr('relation',true,{target:P})}},
  [P]:{uid:P,pluginOptions:{i18n:{localized:true}},attributes:{name1:attr('string',true)}},
  [B]:{uid:B,pluginOptions:{i18n:{localized:true}},attributes:{title:attr('string',true)}}
};
const comps=[{uid:'cat.filters',attributes:{label:attr('string'),active:attr('boolean')}}];
const clone=x=>structuredClone(x);
function createFixture(options={}){
  const db=options.shared?.db||new Map(),data=options.shared?.data||new Map(),counts={GET:0,PUT:0,POST:0},writes=[],logs=[],urls=[];
  const fields={name:'Парфюмерия',description:'русское seo',title:'Каталог / Парфюмерия',
    active:true,banner:{id:5},filters_app:[{id:55,label:'Новый фильтр',active:true}]};
  const kkFields={...clone(fields),name:'Парфюмерия (қаз)',description:'қазақша seo',
    title:'old',active:false,banner:{id:9},filters_app:[{id:22,label:'Старый фильтр',active:false}]};
  const entries=[['cat1',U,fields,kkFields,{product:['p1'],top_brands:['b1'],categories:[],products:[]},
    {product:[],top_brands:['b1','b2'],categories:[],products:[]}],
    ['p1',P,{name1:'RU Product'},{name1:'KK Product'},{},{}],
    ['b1',B,{title:'RU brand1'},{title:'KK brand1'},{},{}],
    ['b2',B,{title:'RU brand2'},{title:'KK brand2'},{},{}]];
  let n=1;
  if(!options.shared)for(const [id,uid,ru,kk,ruRel,kkRel]of entries){
    const put=(locale,status,raw,rels)=>{
      if(raw===null)return;
      const row={...clone(raw),documentId:id,id:n++,locale,
        publishedAt:status==='published'?'2026-01-01T00:00:00.000Z':null};
      data.set(`${uid}|${id}|${locale}|${status}`,{row,rels:clone(rels)});
    };
    put('ru','draft',ru,ruRel);put('ru','published',ru,ruRel);
    put('kk','draft',options.missingKK&&id==='cat1'?null:kk,kkRel);
    put('kk','published',id==='cat1'?null:kk,kkRel);
  }
  if(options.depUnpublished)data.delete(`${P}|p1|kk|published`);
  if(options.depRuUnpublished){data.delete(`${P}|p1|kk|published`);data.delete(`${P}|p1|ru|published`);}
  if(options.legacy)data.get(`${U}|cat1|ru|draft`).rels.products=['p1'];
  if(options.missingDependency){data.delete(`${P}|p1|kk|draft`);data.delete(`${P}|p1|kk|published`);}
  const req=(method,url,body)=>{
    counts[method]++;
    const parsed=new URL(url,'https://cms.invalid');
    const q=parsed.searchParams;
    const p=parsed.pathname;
    let status=200,result;
    if(p==='/content-manager/content-types')result={data:Object.values(schemas)};
    else if(p==='/content-manager/components')result={data:comps};
    else if(p===`/content-manager/collection-types/${U}`){
      const rows=[...data.values()].filter(x=>x.row.documentId==='cat1'&&x.row.locale==='ru'&&!x.row.publishedAt);
      const matches=rows.filter(x=>{
        for(const [k,v]of q.entries())if(k.startsWith('filters[')){
          const field=k.slice(8,-6);if(String(x.row[field])!==v)return false;
        }return true;
      });
      // For uniquePreflight, enumerate KK (only Category) and respect filters.
      const byLocale=q.get('locale')==='kk'?
        [...data.values()].filter(x=>x.row.documentId==='cat1'&&x.row.locale==='kk'&&!x.row.publishedAt):matches;
      result={results:byLocale.map(x=>clone(x.row)),pagination:{page:Number(q.get('page')||1),total:byLocale.length,
        pageCount:byLocale.length?1:0}};
    }else if(p.startsWith('/content-manager/collection-types/')){
      const seg=p.slice('/content-manager/collection-types/'.length).split('/');
      const uid=seg[0],id=seg[1],locale=q.get('locale')||'ru';
      const k=`${uid}|${id}|${locale}|${q.get('status')||'draft'}`;
      if(method==='GET'){
        const item=data.get(k);if(!item){status=404;result={data:null};}else result={data:clone(item.row)};
      }else if(method==='PUT'){
        writes.push({method,uid,id,locale,body:clone(body)});
        const old=data.get(`${uid}|${id}|kk|draft`);
        const defaults=Object.fromEntries(Object.entries(schemas[uid].attributes)
          .filter(([,a])=>a.type!=='relation').map(([f,a])=>[f,a.type==='component'?[]:a.type==='boolean'?false:null]));
        const row=old?.row||{documentId:id,id:n++,locale:'kk',publishedAt:null,...defaults};
        const rels=clone(old?.rels||{});
        for(const [field,val]of Object.entries(body)){
          if(field==='locale')continue;
          if(schemas[uid].attributes[field]?.type==='relation'){
            const current=new Set(rels[field]||[]);
            for(const r of val.connect||[])current.add(r.documentId);
            for(const r of val.disconnect||[])current.delete(r.documentId);
            rels[field]=[...current];
          }else row[field]=clone(val);
        }
        data.set(`${uid}|${id}|kk|draft`,{row,rels});result={data:clone(row)};
      }else if(method==='POST'){
        writes.push({method,uid,id,locale,body:clone(body)});
        const from=data.get(`${uid}|${id}|${locale}|draft`);
        if(!from){status=400;result={error:{message:'No draft'}};}
        else{
          const pub=clone(from);pub.row.publishedAt='2026-11-16T13:00:00.000Z';
          data.set(`${uid}|${id}|${locale}|published`,pub);result={data:clone(pub.row)};
        }
      }
    }else if(p.startsWith('/content-manager/relations/')){
      const seg=p.slice('/content-manager/relations/'.length).split('/');
      const uid=seg[0],id=seg[1],field=seg[2],locale=q.get('locale'),st=q.get('status');
      const related=data.get(`${uid}|${id}|${locale}|${st}`)?.rels?.[field]||[];
      result={results:related.map((documentId,index)=>{
        const targetUid=schemas[uid].attributes[field].target;
        const target=data.get(`${targetUid}|${documentId}|${locale}|draft`)||
          data.get(`${targetUid}|${documentId}|ru|draft`);
        return {id:target?.row.id||index+100,locale,documentId};
      }),pagination:{page:Number(q.get('page')),total:related.length,pageCount:related.length?1:0}};
    }else throw Error('Unexpected '+method+' '+url);
    return Promise.resolve({ok:status>=200&&status<300,status,text:async()=>JSON.stringify(result)});
  };
  class El {constructor(tag){this.tag=tag;this.children=[];this.style={};this.textContent='';this.disabled=false;}
    append(...x){this.children.push(...x);}remove(){}click(){}setAttribute(){}}
  const document={body:new El('body'),createElement:tag=>new El(tag),getElementById:()=>null};
  const indexedDB={open(name,version){
    const request={result:{createObjectStore(){},close(){},transaction(name,mode){
      const tx={objectStore(){return {get(key){return operation('get',key);},put(item){return operation('put',item);}};}};
      function operation(kind,arg){
        const res={};queueMicrotask(()=>{res.result=kind==='get'?clone(db.get(arg)):arg;
          if(kind==='put')db.set(arg.key,clone(arg));res.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.());});
        return res;
      }
      return tx;
    }}};
    queueMicrotask(()=>{request.onupgradeneeded?.();queueMicrotask(()=>request.onsuccess?.());});
    return request;
  }};
  const sandbox={window:{indexedDB},indexedDB,document,
    localStorage:{getItem:()=>JSON.stringify('jwt')},location:{pathname:'/admin/content-manager',search:''},
    fetch:async(path,opts={})=>req(opts.method||'GET',path,opts.body?JSON.parse(opts.body):undefined),
    URL:{createObjectURL:blob=>{urls.push(blob);return 'blob:fake';},revokeObjectURL:()=>{}},
    URLSearchParams, Blob, Promise,Date,JSON,Map,Set,Error,Array,Object,Number,String,
    console:{error:(...a)=>logs.push(a),warn:(...a)=>logs.push(a),log:(...a)=>logs.push(a)},
    setTimeout:()=>{},setInterval:()=>{},structuredClone:clone};
  return {sandbox,data,db,writes,counts,logs,urls};
}
async function runFixture(o={}){
  const f=createFixture(o);
  await vm.runInNewContext(source,f.sandbox,{filename:'category-localizer.js',timeout:10000});
  return f;
}
(async()=>{
  const a=await runFixture();
  assert.deepEqual(a.logs.filter(x=>x[0]==='[Category Localizer] Итог').map(x=>JSON.stringify(x[1])).length,1);
  assert.equal(a.logs.at(-1)[1].success,1,JSON.stringify(a.logs.at(-1)));
  const kk=a.data.get(`${U}|cat1|kk|draft`);
  assert.equal(kk.row.name,'Парфюмерия (қаз)');assert.equal(kk.row.description,'қазақша seo');
  assert.equal(kk.row.banner.id,9);assert.equal(kk.row.title,'Каталог / Парфюмерия');
  assert.equal(kk.row.active,true);
  assert.equal(kk.row.filters_app[0].label,'Новый фильтр');
  assert.deepEqual(kk.rels.product,['p1']);assert.deepEqual(kk.rels.top_brands,['b1']);
  assert.equal(a.writes.filter(x=>x.method==='POST'&&x.uid===U).length,2);
  assert.equal(a.db.get(`${U}|cat1`).phase,'complete');
  assert.equal(a.urls.length,2);console.log('PASS: existing KK, translations/media, filters, connect/disconnect, RU+KK Publish');

  const b=await runFixture({missingKK:true});
  assert.equal(b.logs.at(-1)[1].success,1,JSON.stringify(b.logs));
  const newKK=b.data.get(`${U}|cat1|kk|draft`).row;
  assert.equal(newKK.name,null);assert.equal(newKK.description,null);assert.equal(newKK.banner,null);
  assert.equal(newKK.title,'Каталог / Парфюмерия');
  console.log('PASS: create KK without importing translated text/media');

  const c=await runFixture({missingDependency:true,missingKK:true});
  assert.equal(c.logs.at(-1)[1].blocked,1);
  assert.equal(c.writes.length,0);
  console.log('PASS: block missing KK dependency before any writes');

  const d=await runFixture({legacy:true});
  assert.equal(d.logs.at(-1)[1].blocked,1);
  assert.equal(d.writes.length,0);
  console.log('PASS: legacy RU products anomaly blocks Category');

  const e=await runFixture({depUnpublished:true});
  assert.equal(e.logs.at(-1)[1].success,1);
  assert.equal(e.writes.filter(x=>x.method==='POST'&&x.uid===P).length,1);
  assert.ok(e.data.get(`${P}|p1|kk|published`));
  console.log('PASS: publish KK dependency recursively before Category');

  const f=await runFixture({depRuUnpublished:true});
  assert.equal(f.logs.at(-1)[1].blocked,1);
  assert.equal(f.writes.length,0);
  console.log('PASS: missing RU Published blocks dependency publication');

  const repeated=await runFixture({shared:{data:a.data,db:a.db}});
  assert.equal(repeated.logs.at(-1)[1].already_ok,1);
  assert.equal(repeated.writes.length,0);
  console.log('PASS: full rescan skips confirmed completed Category');
})().catch(e=>{console.error(e);process.exitCode=1});