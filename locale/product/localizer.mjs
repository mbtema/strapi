#!/usr/bin/env node
// Product localizer RU → KK. Node.js 20+, без зависимостей.
// По умолчанию только аудит; --apply разрешает запись. InStock НЕ читается как критерий.
import { mkdir, readFile, writeFile, rename, appendFile, unlink, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, argv, pid } from 'node:process';
import { createHash } from 'node:crypto';

const UID = 'api::product.product';
const URL_ROOT = (env.STRAPI_URL || 'http://10.10.3.80:1337').replace(/\/+$/, '');
const args = argv.slice(2);
const APPLY = args.includes('--apply');
const DRY_RUN = args.includes('--dry-run');
if(APPLY && DRY_RUN)throw Error('Выбери один режим: --apply либо --dry-run');
const TEST = args.includes('--self-test');
const NEW_RUN = args.includes('--new-run');
const ALLOW_LEGACY = args.includes('--allow-legacy-unresolved');
// Безопасный первый production-проход: только существующие KK Product,
// только опубликованные KK targets. Не создаём KK и не публикуем справочники.
const EXISTING_ONLY = args.includes('--existing-only');
const num = (key, fallback, min, max) => {
  const a = args.filter(x => x.startsWith('--' + key + '='));
  if (a.length > 1) throw Error('Повторён параметр --' + key);
  const n = a.length ? Number(a[0].split('=')[1]) : fallback;
  if (!Number.isSafeInteger(n) || n < min || n > max) throw Error('Некорректный --' + key);
  return n;
};
const WORKERS = num('workers', 8, 1, 32);
const REQUESTS = num('requests', 24, 1, 80);
const LIMIT = num('limit', 0, 0, 1000000);
const ONLY_OPTIONS=args.filter(x=>x.startsWith('--only=')||x.startsWith('--id='));
if(ONLY_OPTIONS.length>1)throw Error('Повторён --only/--id');
const ONLY_ID=ONLY_OPTIONS.length?ONLY_OPTIONS[0].split('=')[1]:null;
if(ONLY_ID&&!/^[a-z0-9]{16,40}$/i.test(ONLY_ID))throw Error('Некорректный --only=DOCUMENT_ID');
if(ONLY_ID && LIMIT)throw Error('Используй только один из --only и --limit');
const PROBE_OPTIONS=args.filter(x=>x.startsWith('--probe='));
if(PROBE_OPTIONS.length>1)throw Error('Повторён --probe');
const PROBE_ID=PROBE_OPTIONS.length?PROBE_OPTIONS[0].slice(8):null;
if(PROBE_ID&&!/^[a-z0-9]{16,40}$/i.test(PROBE_ID))throw Error('Некорректный --probe=DOCUMENT_ID');
if(PROBE_ID&&(APPLY||ONLY_ID||LIMIT||NEW_RUN))
  throw Error('--probe только для чтения, без --apply, --only, --limit, --new-run');
const PAGE_SIZE = num('page-size', 100, 1, 100);
const RETRIES = num('get-retries', 3, 1, 6);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const MODE = APPLY ? 'apply' : 'audit';
const PREFIX = 'product-kk-' + MODE;
if (args.some(x => !['--apply','--dry-run','--self-test','--new-run',
  '--allow-legacy-unresolved','--existing-only'].includes(x) &&
  !/^--(workers|requests|limit|page-size|get-retries)=\d+$/.test(x) &&
  !/^--(only|id|probe)=[a-z0-9]{16,40}$/i.test(x))) {
  throw Error('Неизвестный параметр запуска');
}
const SYSTEM = new Set(['id','documentId','locale','status','publishedAt','createdAt',
  'updatedAt','createdBy','updatedBy','localizations','__pivot']);
const TEXT_KK = new Set(['name1','name2','detail_text','composition']);
const SKIP = new Set(['InStock','inStock','key']);
// Не перезаписывать товар с незавершённым журналом старого DIOR pipeline.
const LEGACY_UNRESOLVED = new Set(['fajndt11d4br9jmuy32n9xq9']);
const scalarTypes = new Set(['string','text','richtext','email','enumeration','json',
  'blocks','integer','biginteger','float','decimal','boolean','date','time','datetime','uid']);
let token = env.STRAPI_JWT || '';
const contentToken = env.STRAPI_API_TOKEN || ''; // Отдельный токен Content API, только для создания KK
let schema, allSchemas, stopped = false, fatal = null, finishWrite = Promise.resolve();
let interruptRequested=false;
if(!TEST)process.on('SIGINT',()=>{
  if(!interruptRequested) {
    interruptRequested=true;
    stopped=true;
    log('Ctrl+C: прекращаем назначать новые Product; текущие операции и checkpoint завершим.');
  } else log('Остановка уже запрошена. Дождись окончания текущих запросов и записи checkpoint.');
});
let successRequests = 0;
const targetLocks = new Map();
const targetCache = new Map();
const counters = { total:0, scanned:0, already_ok:0, would_update:0,
  would_create_kk:0, normalized:0, published:0, errors:0, blocked:0,
  created:0, requests:0, retries:0 };
function countStatus(status) {
  if (status==='would_create_kk')counters.would_create_kk++;
  else if (status==='already_ok'||status==='would_update'||status==='normalized'||
    status==='published'||status==='created')counters[status]++;
  else if (status.startsWith('blocked_'))counters.blocked++;
  else counters.errors++;
}
const log = (...parts) => console.log('[localizer]', ...parts);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const canonical = x => Array.isArray(x) ? x.map(canonical) :
  x && typeof x === 'object' ? Object.fromEntries(
    Object.keys(x).sort().map(k => [k,canonical(x[k])])) : x;
const eq = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const clean = x => String(x ?? '').replace(/[\r\n\t]+/g,' ').slice(0,400);
const unique = xs => [...new Set(xs)];
const localized = attr => attr?.pluginOptions?.i18n?.localized === true ||
  (attr?.type === 'uid' && attr?.pluginOptions?.i18n?.localized !== false);
const empty = x => x == null || (typeof x === 'string' && !x.trim()) ||
  (Array.isArray(x) && !x.length);
const mediaIds = x => x == null ? x : Array.isArray(x) ? x.map(mediaIds) :
  Number.isSafeInteger(x) && x > 0 ? x : Number.isSafeInteger(x?.id) && x.id > 0 ? x.id : null;
const recordSafe = x => {
  if (Array.isArray(x)) return x.map(recordSafe);
  if (x && typeof x === 'object') return Object.fromEntries(
    Object.entries(x).filter(([k]) => !['id','createdAt','updatedAt','__pivot'].includes(k))
      .map(([k,v]) => [k,recordSafe(v)]));
  return x;
};
function fieldValue(attr,value) {
  if (attr.type === 'media') return mediaIds(value);
  if (attr.type === 'component' || attr.type === 'dynamiczone') return recordSafe(value);
  return value;
}
function targetFields(data,targetSchema) {
  if(!data)return null;
  return Object.fromEntries(Object.entries(targetSchema.attributes)
    .filter(([f,a])=>!SYSTEM.has(f)&&!SKIP.has(f)&&a.type!=='relation')
    .map(([f,a])=>[f,fieldValue(a,data[f])]));
}
function fieldMap(data) {
  if (!data) return null;
  return Object.fromEntries(Object.entries(schema.attributes)
    .filter(([k,a]) => !SYSTEM.has(k) && a.type !== 'relation' && !SKIP.has(k))
    .map(([k,a]) => [k,fieldValue(a,data[k])]));
}
function sameVersions(a,b) {
  if (!a || !b) return a === b;
  return eq(a.fields,b.fields) && eq(a.relations,b.relations);
}
function csvCell(v) { const s=String(v??''); return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; }
const csvHeader = 'documentId;status;changes;reason;details\n';
const csvFile = join(SCRIPT_DIR,PREFIX+'-report.csv');
const progressFile = join(SCRIPT_DIR,PREFIX+'-progress.jsonl');
const summaryFile = join(SCRIPT_DIR,PREFIX+'-summary.json');
const schemaFile = join(SCRIPT_DIR,PREFIX+'-schema.sha256');
const lockFile = join(SCRIPT_DIR,PREFIX+'.lock');
const backupDir = join(SCRIPT_DIR,'product-kk-backups');
let seen = new Set();
let runStartedAt=0, runProcessed=0, runKnown=0, runTotal=0;
const duration = ms => { const s=Math.max(0,Math.round(ms/1000));
  return Math.floor(s/3600)+':'+String(Math.floor(s%3600/60)).padStart(2,'0')+
    ':'+String(s%60).padStart(2,'0'); };
async function safeWrite(file,data) {
  const temporary = file + '.' + pid + '.tmp';
  await writeFile(temporary, data,{mode:0o600});
  await rename(temporary,file);
}
async function serialize(fn) {
  const next = finishWrite.then(fn);
  finishWrite = next.catch(() => {});
  return next;
}
async function report(id,status,changes='',reason='',details='') {
  return serialize(async () => {
    // JSONL — основной checkpoint; CSV можно полностью восстановить после сбоя.
    await appendFile(progressFile,JSON.stringify({id,status,changes,reason,details,
      at:new Date().toISOString()})+'\n');
    await appendFile(csvFile,[id,status,changes,reason,details].map(csvCell).join(';') + '\n');
    seen.add(id);
    counters.scanned++;
    countStatus(status);
    runProcessed++;
    const elapsed=Date.now()-runStartedAt;
    const speed=runProcessed/(Math.max(elapsed,1)/1000);
    const done=runKnown+runProcessed;
    const eta=speed>0?duration((runTotal-done)/speed*1000):'—';
    log(done+'/'+runTotal, '('+(runTotal?Math.floor(done/runTotal*100):100)+'%)',
      id, status, changes?clean(changes).slice(0,80):'',
      'скорость='+speed.toFixed(2)+'/с','прошло='+duration(elapsed),'осталось='+eta);
  });
}
class Gate {
  active = 0; waiters = []; limit;
  constructor(n) { this.limit=n; }
  async acquire() {
    if (this.active < this.limit) {this.active++;return;}
    await new Promise(r=>this.waiters.push(r));
  }
  release() {
    this.active--;
    while (this.waiters.length && this.active < this.limit) {
      this.active++; this.waiters.shift()();
    }
  }
  async run(fn) { await this.acquire();try{return await fn();}finally{this.release();} }
}
const gate = new Gate(REQUESTS);
async function http(method,path,body=null,allow404=false,authToken=token) {
  const url = new URL(path, URL_ROOT);
  if (url.origin !== new URL(URL_ROOT).origin) throw Error('Недопустимый URL');
  let lastError;
  const max=method==='GET'?RETRIES:1;
  for(let tryNo=1;tryNo<=max;tryNo++) {
    let response=null;
    try {
      response=await gate.run(async () => {
        counters.requests++;
        return await fetch(url,{method,redirect:'manual',signal:AbortSignal.timeout(35000),
          headers:{Authorization:'Bearer '+authToken,Accept:'application/json',
            ...(body==null?{}:{'Content-Type':'application/json'})},
          ...(body==null?{}:{body:JSON.stringify(body)})});
      });
    } catch(error) {
      lastError=error;
      if(method!=='GET' || tryNo>=max) throw Error(method+' NETWORK '+url.pathname+': '+error.message);
    }
    if(response && (response.status===401 || response.status===403)) {
      const error=Error('Авторизация Strapi отклонена (HTTP '+response.status+
        '). Получи свежий JWT и возобнови тот же apply checkpoint.');
      error.fatal=true;
      throw error;
    }
    if(response?.status===404 && allow404) return null;
    if(response?.ok) {
      if (successRequests++ % 75===0 && gate.limit<REQUESTS) gate.limit++;
      const raw=await response.text();
      try {return raw?JSON.parse(raw):{};} catch {throw Error('Ответ не JSON: '+url.pathname);}
    }
    if(response && (method!=='GET' || tryNo>=max || ![408,429,500,502,503,504].includes(response.status))) {
      const msg=(await response.text().catch(()=>'' )).slice(0,220);
      throw Error(method+' HTTP '+response.status+' '+url.pathname+' '+msg);
    }
    counters.retries++;
    if (response?.status===429 || response?.status===503) gate.limit=Math.max(2,Math.floor(gate.limit*0.75));
    await sleep((response?.status===429?1200:400)*tryNo);
  }
  throw lastError || Error('GET повтор исчерпан '+path);
}
const get = (path,allow404=false) => http('GET',path,null,allow404);
function detailPath(uid,id,locale,status='draft') {
  return '/content-manager/collection-types/'+uid+'/'+encodeURIComponent(id)+
    '?locale='+locale+'&status='+status;
}
function unpack(json,uid,id,locale,status) {
  if (json==null || json.data==null) return null;
  const data=json.data;
  if (Array.isArray(data) && !data.length || data && typeof data==='object' &&
      !Array.isArray(data) && !Object.keys(data).length) return null;
  if (!data || typeof data!=='object' || Array.isArray(data) ||
      data.documentId!==id || data.locale!==locale ||
      (status==='published' && !data.publishedAt))
    throw Error('Неверный detail '+uid+'/'+id+'/'+locale+'/'+status);
  return data;
}
async function detail(uid,id,locale,status='draft') {
  return unpack(await get(detailPath(uid,id,locale,status),true),uid,id,locale,status);
}
function listResult(json,page,old=null) {
  const rows=json?.results;
  const p=json?.pagination;
  if (!Array.isArray(rows) || !Number.isSafeInteger(p?.total) ||
      !Number.isSafeInteger(p?.pageCount) ||
      (p.page!=null && Number(p.page)!==page) ||
      (old && (old.total!==p.total || old.pageCount!==p.pageCount)))
    throw Error('Неверная пагинация page='+page);
  return {rows,total:p.total,pageCount:p.pageCount};
}
async function relations(uid,id,field,locale,status='draft') {
  let page=1,first=null; const entries=[];
  while(true) {
    const q=new URLSearchParams({locale,status,page:String(page),pageSize:String(PAGE_SIZE)});
    const j=await get('/content-manager/relations/'+uid+'/'+encodeURIComponent(id)+'/'+
      encodeURIComponent(field)+'?'+q);
    const p=listResult(j,page,first);if(!first)first=p;
    for(const r of p.rows) {
      if (!r?.documentId || !Number.isSafeInteger(r.id) || r.id<=0)
        throw Error('Relation '+field+' без documentId или numeric id');
      entries.push({id:r.id,documentId:r.documentId,locale:r.locale||locale});
    }
    if(page>=p.pageCount)break;
    if(++page>1000) throw Error('Слишком много страниц relation '+field);
  }
  if(entries.length!==first.total ||
      unique(entries.map(r=>r.documentId)).length!==entries.length)
    throw Error('Потеря/дубли relation '+field+'/'+locale+'/'+status);
  return entries.sort((a,b)=>a.documentId.localeCompare(b.documentId));
}
let relationFields;
const MAX_POPULATE_FIELDS = 19;
// Нельзя слепо доверять populate: Content Manager может вернуть только часть many-relations.
// Сверяем каждый набор documentId с числом из исходного detail.count.
// Неоднозначные поля читаем проверенным /content-manager/relations/{uid}/{id}/{field}.
function relationFromPopulate(value,raw,locale) {
  const count=Number.isSafeInteger(raw?.count) && raw.count>=0 ? raw.count : null;
  if(count===null)return null;
  let entries;
  if(Array.isArray(value))entries=value;
  else if(value===null && count===0)entries=[];
  else if(value && typeof value==='object' && typeof value.documentId==='string')entries=[value];
  else return null;
  if(entries.length!==count)return null;
  const result=[];
  for(const e of entries) {
    if(!e || typeof e.documentId!=='string' || !e.documentId ||
      !Number.isSafeInteger(e.id) || e.id<=0 ||
      (e.locale!=null && e.locale!==locale))return null;
    result.push({id:e.id,documentId:e.documentId,locale:e.locale||locale});
  }
  if(new Set(result.map(x=>x.documentId)).size!==result.length)return null;
  return result.sort((a,b)=>a.documentId.localeCompare(b.documentId));
}
async function populatedRelations(uid,id,locale,status,raw) {
  const out={},fields=relationFields;
  // Один запрос для группы root relations вместо отдельного запроса на каждое поле.
  // Если сервер ограничивает populate, пробуем обычные точные GET для сомнительных fields.
  for(let i=0;i<fields.length;i+=MAX_POPULATE_FIELDS) {
    const group=fields.slice(i,i+MAX_POPULATE_FIELDS);
    const q=new URLSearchParams({locale,status});
    for(const f of group)q.set('populate['+f+'][fields][0]','documentId');
    let expanded=null;
    try {
      expanded=unpack(await get('/content-manager/collection-types/'+uid+'/'+
        encodeURIComponent(id)+'?'+q),uid,id,locale,status);
    } catch(e) {
      if(e.fatal)throw e;
      log('Populate fallback '+locale+'/'+status+' '+id+': '+clean(e.message).slice(0,110));
    }
    const missing=[];
    for(const field of group) {
      const candidate=expanded && relationFromPopulate(expanded[field],raw[field],locale);
      if(candidate)out[field]=candidate;
      else missing.push(field);
    }
    if(missing.length) {
      log('Native fallback '+locale+'/'+status+' '+id+': '+missing.join(', '));
      const rows=await Promise.all(missing.map(async f=>[f,
        await relations(uid,id,f,locale,status)]));
      for(const [field,entries]of rows)out[field]=entries;
    }
  }
  return out;
}
async function version(id,locale,status='draft',withRelations=true) {
  const data=await detail(UID,id,locale,status);
  if(!data)return null;
  const rel=withRelations ? await populatedRelations(UID,id,locale,status,data) : {};
  return {data,fields:fieldMap(data),relations:rel};
}
function ids(v,f) {return (v?.relations[f]||[]).map(x=>x.documentId);}
function relEqual(a,b) {
  return relationFields.every(f=>eq(ids(a,f).slice().sort(),ids(b,f).slice().sort()));
}
function snapshot(v) {
  if (!v)return null;
  return {data:v.data,fields:v.fields,relations:v.relations};
}
function compareFields(a,b) {
  const changed=[];
  for(const f of Object.keys(a?.fields||{}))if(!eq(a.fields[f],b?.fields?.[f]))changed.push(f);
  return changed;
}
function plan(ru,kd,kp) {
  const changes=[],blockers=[];
  if(!ru)return {changes,blockers:['missing_ru']};
  if(!kd)return {changes,blockers:['missing_kk_create_unverified']};
  for(const [f,a]of Object.entries(schema.attributes)) {
    if(SYSTEM.has(f) || SKIP.has(f) || a.type==='relation' || (localized(a) && a.type!=='media' && a.type!=='boolean' && f!=='name'))continue;
    const source=ru.fields[f],target=kd.fields[f];
    if(eq(source,target))continue;
    if(a.unique || !(['media','boolean'].includes(a.type) || f==='name')) {
      blockers.push('unmanaged_shared:'+f);
      continue;
    }
    if(a.type==='media' && (source===null || typeof source==='number' ||
      Array.isArray(source) && source.every(x=>Number.isSafeInteger(x)))===false) {
      blockers.push('invalid_media:'+f);continue;
    }
    if(!Object.prototype.hasOwnProperty.call(ru.data,f)) {blockers.push('missing_source:'+f);continue;}
    changes.push({kind:'field',field:f,from:target,to:source});
  }
  for(const f of relationFields) {
    const source=ids(ru,f),target=ids(kd,f);
    const add=source.filter(x=>!target.includes(x));
    const remove=target.filter(x=>!source.includes(x));
    if(add.length||remove.length)changes.push({kind:'relation',field:f,
      target:schema.attributes[f].target,add,remove});
  }
  const publication = !kp || !eq(kd.fields,kp.fields) || !relEqual(kd,kp);
  return {changes,blockers,publication};
}

// Диагностика способа чтения root relations без изменений Content Manager.
// Не сохраняем полные карточки и токены: только структуру ответа и сравнительные counts.
function relationShape(value,present) {
  if(!present)return {kind:'absent'};
  if(value===null)return {kind:'null'};
  if(Array.isArray(value))return {kind:'array',length:value.length,
    itemKeys:value[0]&&typeof value[0]==='object'?Object.keys(value[0]).slice(0,12):[],
    documentIds:value.map(x=>x?.documentId||x?.attributes?.documentId).filter(Boolean)};
  if(value&&typeof value==='object')return {kind:'object',
    keys:Object.keys(value).slice(0,18),
    count:typeof value.count==='number'?value.count:null,
    dataKind:Array.isArray(value.data)?'array':typeof value.data,
    dataLength:Array.isArray(value.data)?value.data.length:null,
    documentIds:Array.isArray(value.data)?value.data.map(x=>
      x?.documentId||x?.attributes?.documentId).filter(Boolean):[]};
  return {kind:typeof value,value:String(value).slice(0,60)};
}
async function probeRelations(documentId) {
  const fields=['categories','category','shade_groups'].filter(f=>relationFields.includes(f));
  if(!fields.length)throw Error('В схеме Product нет проверяемых relation fields');
  const result={at:new Date().toISOString(),documentId,
    inspectedFields:fields,versions:[],purpose:'probe-detail-populate-versus-native-relations'};
  log('Диагностика отношений '+documentId+', полей: '+fields.join(', '));
  for(const [locale,status] of [['ru','draft'],['kk','draft'],['kk','published']]) {
    const raw=await detail(UID,documentId,locale,status);
    const row={locale,status,exists:!!raw,fields:[]};
    result.versions.push(row);
    if(!raw){log('Проба '+locale+'/'+status+': версия отсутствует');continue;}
    const q=new URLSearchParams({locale,status});
    for(const field of fields)q.set('populate['+field+'][fields][0]','documentId');
    let populated=null;
    try {
      const json=await get('/content-manager/collection-types/'+UID+'/'+
        encodeURIComponent(documentId)+'?'+q);
      populated=unpack(json,UID,documentId,locale,status);
    } catch(error) {row.populateError=clean(error.message||error);}
    for(const field of fields) {
      const plain=relationShape(raw[field],Object.hasOwn(raw,field));
      const expanded=populated?relationShape(populated[field],Object.hasOwn(populated,field)):null;
      const exact=await relations(UID,documentId,field,locale,status);
      const exactIds=exact.map(x=>x.documentId).sort();
      const candidate=expanded?.documentIds?.slice().sort()||[];
      const match=(expanded?.kind==='array' || expanded?.dataKind==='array')?
        eq(candidate,exactIds):null;
      row.fields.push({field,raw:plain,populated:expanded,
        nativeCount:exact.length,populateMatchesNative:match});
      log('Проба '+locale+'/'+status+' '+field+': исходный='+plain.kind+
        ', populate='+String(expanded?.kind||row.populateError||'none')+
        ', точный count='+exact.length+', совпадение='+String(match));
    }
  }
  const file=join(SCRIPT_DIR,'product-kk-relation-probe.json');
  await safeWrite(file,JSON.stringify(result,null,2));
  log('Диагностика завершена. Файл:',file);
}

async function allIds() {
  const size=LIMIT ? Math.min(PAGE_SIZE,LIMIT) : PAGE_SIZE;
  log('Читаем каталог Product RU: страница 1; режим '+(LIMIT?'первые '+LIMIT:'весь каталог'));
  const q=new URLSearchParams({locale:'ru',status:'draft',page:'1',
    pageSize:String(size),sort:'id:ASC'});
  const first=listResult(await get('/content-manager/collection-types/'+UID+'?'+q),1);
  const required=Math.min(first.total,LIMIT||first.total);
  const pagesNeeded=Math.ceil(required/size);
  const idsList=[...first.rows];
  log('Каталог RU: '+first.total+' товаров; для запуска нужно '+required+
    ' (страниц '+pagesNeeded+'), прочитано '+Math.min(idsList.length,required)+'/'+required);
  const pages=Array.from({length:Math.max(0,pagesNeeded-1)},(_,i)=>i+2);
  // При --limit не выгружаем оставшиеся 22 тыс. товаров.
  // Полный обход сохраняет проверку total/pageCount/дубликатов.
  for(let i=0;i<pages.length;i+=REQUESTS) {
    const chunk=await Promise.all(pages.slice(i,i+REQUESTS).map(async page=>{
      const query=new URLSearchParams({locale:'ru',status:'draft',page:String(page),
        pageSize:String(size),sort:'id:ASC'});
      const data=listResult(await get('/content-manager/collection-types/'+UID+'?'+query),
        page,first);
      const loaded=Math.min(required,(page-1)*size+data.rows.length);
      log('Загрузка списка RU: страница '+page+'/'+pagesNeeded+
        ' · примерно '+loaded+'/'+required+' товаров');
      return {page,data};
    }));
    for(const item of chunk.sort((a,b)=>a.page-b.page))idsList.push(...item.data.rows);
  }
  const out=idsList.slice(0,required).map(x=>{
    const row=x?.attributes&&!x.documentId?{...x.attributes,id:x.id}:x;
    if(!row || typeof row.documentId!=='string' || row.locale!=='ru')
      throw Error('Неверный RU список Product');
    return row.documentId;
  });
  if(out.length!==required || unique(out).length!==out.length)
    throw Error('Product list: пропуски/дубли/изменение пагинации — остановка');
  log('Список Product загружен: '+out.length+' documentId');
  return out;
}
function localTargetSchema(uid) {return allSchemas.find(x=>x.uid===uid);}
async function publishTarget(uid,id) {
  const key=uid+'|'+id;
  if(targetLocks.has(key))return targetLocks.get(key);
  const promise=(async () => {
    const current=await detail(uid,id,'kk','published');
    if(current)return {ok:true};
    const draft=await detail(uid,id,'kk','draft');
    if(!draft)return {ok:false,reason:'missing_kk_target',uid,id};
    const tSchema=localTargetSchema(uid);
    if(!tSchema?.attributes || tSchema.pluginOptions?.i18n?.localized!==true)
      return {ok:false,reason:'unverified_target_schema',uid,id};
    if(!APPLY)return {ok:true,wouldPublish:true};
    const name=key.replace(/[^a-z0-9|:_-]/gi,'_').replace('|','--');
    const file=join(backupDir,'target--'+name+'.json');
    const presentFile=await readFile(file,'utf8').catch(()=>null);
    if(presentFile)return {ok:false,reason:'target_pending_backup',uid,id};
    const relationsNames=Object.entries(tSchema.attributes).filter(([,a])=>a.type==='relation').map(([f])=>f);
    const beforeRelations={};
    for(const f of relationsNames) beforeRelations[f]=await relations(uid,id,f,'kk');
    const ruDraftBefore=await detail(uid,id,'ru','draft');
    const ruPublishedBefore=await detail(uid,id,'ru','published');
    const ruRelBefore={draft:{},published:{}};
    for(const f of relationsNames) {
      if(ruDraftBefore)ruRelBefore.draft[f]=await relations(uid,id,f,'ru','draft');
      if(ruPublishedBefore)ruRelBefore.published[f]=await relations(uid,id,f,'ru','published');
    }
    await safeWrite(file,JSON.stringify({uid,id,locale:'kk',before:draft,relations:beforeRelations,
      ruDraftBefore,ruPublishedBefore,ruRelBefore,phase:'publish-target'},null,2));
    const payload={locale:'kk'};
    for(const [f,a]of Object.entries(tSchema.attributes)) {
      if(SYSTEM.has(f) || f==='InStock' || f==='inStock')continue;
      if(a.type==='relation')payload[f]={connect:[],disconnect:[]};
      else if(Object.hasOwn(draft,f)) {
        if(a.required && empty(draft[f]))return {ok:false,reason:'target_required_empty:'+f,uid,id};
        if(!scalarTypes.has(a.type) && !['media','component','dynamiczone'].includes(a.type))
          return {ok:false,reason:'target_unknown_field:'+f,uid,id};
        payload[f]=a.type==='media'?mediaIds(draft[f]):draft[f];
      }
    }
    try {
      await http('POST','/content-manager/collection-types/'+uid+'/'+encodeURIComponent(id)+
        '/actions/publish?locale=kk',payload);
      const after=await detail(uid,id,'kk','published');
      const afterDraft=await detail(uid,id,'kk','draft');
      if(!after || !afterDraft) throw Error('Справочник KK не опубликован');
      const [ruDraftAfter,ruPublishedAfter]=await Promise.all([
        detail(uid,id,'ru','draft'),detail(uid,id,'ru','published')]);
      if(!eq(targetFields(ruDraftBefore,tSchema),targetFields(ruDraftAfter,tSchema))||
        !eq(targetFields(ruPublishedBefore,tSchema),targetFields(ruPublishedAfter,tSchema)))
        throw Error('Публикация KK справочника изменила RU бизнес-поля');
      for(const f of relationsNames) {
        if(ruDraftBefore) {
          const now=await relations(uid,id,f,'ru','draft');
          if(!eq(ruRelBefore.draft[f].map(x=>x.documentId),now.map(x=>x.documentId)))
            throw Error('Публикация KK справочника изменила RU Draft relation '+f);
        }
        if(ruPublishedBefore) {
          const now=await relations(uid,id,f,'ru','published');
          if(!eq(ruRelBefore.published[f].map(x=>x.documentId),now.map(x=>x.documentId)))
            throw Error('Публикация KK справочника изменила RU Published relation '+f);
        }
      }
      if(draft.key!==afterDraft.key||draft.key!==after.key)
        throw Error('Публикация KK справочника изменила key');
      for(const [f,a]of Object.entries(tSchema.attributes)) {
        if(SYSTEM.has(f)||SKIP.has(f)||a.type==='relation')continue;
        if(!eq(fieldValue(a,draft[f]),fieldValue(a,after[f])) ||
          !eq(fieldValue(a,draft[f]),fieldValue(a,afterDraft[f])))
          throw Error('Справочник изменил поле '+f);
      }
      for(const f of relationsNames) {
        const now=await relations(uid,id,f,'kk');
        if(!eq(beforeRelations[f].map(x=>x.documentId),now.map(x=>x.documentId)))
          throw Error('Справочник изменил relation '+f);
      }
      await unlink(file);
      return {ok:true};
    } catch(e) {
      if(e.fatal)throw e;
      return {ok:false,reason:'target_publish_failed:'+e.message,uid,id};
    }
  })();
  targetLocks.set(key,promise);
  const output=await promise;
  targetLocks.delete(key);
  return output;
}
async function dependencyCheck(ru) {
  const needed=new Map();
  for(const f of relationFields)for(const id of ids(ru,f)) {
    const uid=schema.attributes[f].target;
    if(!uid || !uid.startsWith('api::'))throw Error('Неизвестный target '+f);
    needed.set(uid+'|'+id,{uid,id,field:f});
  }
  const rows=await Promise.all([...needed.values()].map(async item=>{
    const key=item.uid+'|'+item.id;
    if(targetCache.has(key))return {...item,...targetCache.get(key)};
    const d=await detail(item.uid,item.id,'kk','draft');
    const p=await detail(item.uid,item.id,'kk','published');
    const result=d||p?{ok:true,requiresPublish:!p}:{ok:false,reason:'missing_kk_target'};
    // Отсутствие или непубликация могут измениться за время обработки: кеш только текущего прогона.
    if(result.ok&&!result.requiresPublish)targetCache.set(key,result);
    return {...item,...result};
  }));
  return rows;
}
async function recheckBeforeWrite(id,baseline) {
  const [r,rp,k,p]=await Promise.all([
    version(id,'ru'),version(id,'ru','published'),version(id,'kk'),version(id,'kk','published')]);
  if(!sameVersions(r,baseline.ru)||!sameVersions(rp,baseline.ruPublished)||
    !sameVersions(k,baseline.kk)||!sameVersions(p,baseline.pub))
    throw Error('Данные Product изменились между GET и записью');
}
async function postflight(id,before,expected,phase) {
  const [r,rp,k,p]=await Promise.all([
    version(id,'ru'),version(id,'ru','published'),version(id,'kk'),version(id,'kk','published')]);
  if(!sameVersions(r,before.ru)||!sameVersions(rp,before.ruPublished)||
    rp?.data?.key!==before.ruPublished?.data?.key) {
    const e=Error('Изменение RU после '+phase);
    e.fatal=true;throw e;
  }
  if(r?.data?.key!==before.ru?.data?.key || k?.data?.key!==before.kk?.data?.key)
    throw Error('Save/Publish изменил уникальный RU/KK.key');
  if(!k || !eq(k.fields,expected.fields)||!relEqual(k,expected))
    throw Error('KK Draft после '+phase+' не совпадает с ожидаемым');
  if(phase==='save' && (!sameVersions(p,before.pub)||p?.data?.key!==before.pub?.data?.key))
    throw Error('KK Published изменился при Save');
  if(phase==='publish' && (!p||p.data?.key!==k.data.key||
    !eq(p.fields,expected.fields)||!relEqual(p,expected)))
    throw Error('KK Published не совпадает с ожидаемым KK Draft');
  return {ru:r,ruPublished:rp,kk:k,pub:p};
}
// Перед записью повторно читаем *изменяемые* relations через native endpoint.
// Populated numeric id может отличаться от id, который CM ожидает при disconnect.
async function nativeWriteRelationPreflight(documentId,before,changes) {
  const fields=changes.filter(x=>x.kind==='relation').map(x=>x.field);
  if(!fields.length)return before;
  const snapshots={ru:{...before.ru,relations:{...before.ru.relations}},
    kk:{...before.kk,relations:{...before.kk.relations}}};
  for(const field of fields) {
    const [source,target]=await Promise.all([
      relations(UID,documentId,field,'ru','draft'),
      relations(UID,documentId,field,'kk','draft')
    ]);
    const sorted=rows=>rows.map(x=>x.documentId).sort();
    if(!eq(sorted(source),sorted(before.ru.relations[field])) ||
      !eq(sorted(target),sorted(before.kk.relations[field])))
      throw Error('Native preflight не подтвердил состав relation: '+field);
    snapshots.ru.relations[field]=source;
    snapshots.kk.relations[field]=target;
  }
  return {...before,...snapshots};
}
function payloadForSave(before,changes) {
  const payload={locale:'kk'};
  for(const action of changes) {
    if(action.kind==='field')payload[action.field]=action.to;
    else {
      const old=before.kk.relations[action.field]||[];
      const connect=action.add.map(id=>{
        const found=targetCache.get(action.target+'|'+id);
        return found?.numericId ? {id:found.numericId,documentId:id,locale:'kk'} : null;
      });
      if(connect.some(x=>x===null))throw Error('Неизвестен numeric id для connect '+action.field);
      const disconnect=action.remove.map(id=>{
        const x=old.find(t=>t.documentId===id);
        if(!x)throw Error('Неизвестен numeric id для disconnect '+action.field);
        return {id:x.id,documentId:id,locale:'kk'};
      });
      payload[action.field]={connect,disconnect};
    }
  }
  return payload;
}
function expectedDraft(before,changes) {
  const fields={...before.kk.fields};
  const relations=Object.fromEntries(Object.entries(before.kk.relations).map(([k,v])=>
    [k,v.map(x=>({...x}))]));
  for(const c of changes) {
    if(c.kind==='field')fields[c.field]=c.to;
    else relations[c.field]=before.ru.relations[c.field].map(x=>({...x}));
  }
  return {fields,relations};
}
function publishPayload(v) {
  const payload={locale:'kk'};
  for(const [f,a]of Object.entries(schema.attributes)) {
    if(SYSTEM.has(f)||f==='InStock'||f==='inStock')continue;
    if(f==='key'&&a.unique===true) {
      if(typeof v.data.key!=='string'||!v.data.key)throw Error('Пустой KK.key');
      payload.key=v.data.key;continue; // сохраняем KK.key, не переносим RU.key
    }
    if(a.type==='relation') {payload[f]={connect:[],disconnect:[]};continue;}
    if(!Object.hasOwn(v.data,f)) {
      if(a.required)throw Error('Required поле отсутствует '+f);
      continue;
    }
    if(a.required && empty(v.data[f]))throw Error('Required KK поле пусто '+f);
    if(!scalarTypes.has(a.type)&&!['media','component','dynamiczone'].includes(a.type))
      throw Error('Неподдержанный Publish тип '+f+'/'+a.type);
    payload[f]=a.type==='media'?mediaIds(v.data[f]):v.data[f];
  }
  return payload;
}

async function createKk(id,ru,ruPublished,original) {
  if(!contentToken)return {ok:false,reason:'no_content_api_token'};
  const localizedFields={};
  for(const [f,a] of Object.entries(schema.attributes)) {
    if(SYSTEM.has(f)||SKIP.has(f)||a.type==='relation'||!localized(a))continue;
    if(a.required)return {ok:false,reason:'required_localized_field:'+f};
    // Намеренно НЕ копируем RU переводы, медиа и relations в REST create.
    // Поля, не указанные здесь, остаются значениями по умолчанию Strapi.
    if(TEXT_KK.has(f))localizedFields[f]=null;
  }
  const file=join(backupDir,id+'.json');
  await safeWrite(file,JSON.stringify({documentId:id,at:new Date().toISOString(),
    before:original,phase:'create-kk',payload:{data:localizedFields}},null,2));
  // Документированный Strapi 5 Content API: PUT создаёт локаль существующего documentId.
  // Только status=draft; Admin JWT к Content API НЕ приравнивается.
  await http('PUT','/api/products/'+encodeURIComponent(id)+'?locale=kk&status=draft',
    {data:localizedFields},false,contentToken);
  const [source,ruPublishedAfter,target,publication]=await Promise.all([
    version(id,'ru'),version(id,'ru','published'),version(id,'kk'),version(id,'kk','published')]);
  if(!sameVersions(ru,source)||!sameVersions(ruPublished,ruPublishedAfter)||
    ru.data?.key!==source?.data?.key||ruPublished?.data?.key!==ruPublishedAfter?.data?.key) {
    const e=Error('Создание KK изменило RU Draft/Published');e.fatal=true;throw e;
  }
  if(!target || publication)throw Error('Создание KK: не подтверждён новый KK Draft без Published');
  for(const [f,a] of Object.entries(schema.attributes)) {
    if(SYSTEM.has(f)||SKIP.has(f)||!localized(a)||
      !['string','text','richtext','email','blocks'].includes(a.type))continue;
    if(!empty(target.data[f]))throw Error('Создание KK скопировало русский текст в '+f);
  }
  return {ok:true,draft:target};
}

async function one(id) {
  let file=null,committed=false;
  try {
    if(stopped)return;
    if(seen.has(id))return;
    log('Начали Product '+id+': читаем RU/KK Draft/Published и relations...');
    if(LEGACY_UNRESOLVED.has(id)&&!ALLOW_LEGACY)
      return report(id,'blocked_legacy_unresolved','','Сначала завершить recovery старого DIOR pipeline');
    const prior=await readFile(join(backupDir,id+'.json'),'utf8').catch(()=>null);
    if(prior)return report(id,'blocked_pending_backup','', 'Неопределённая предыдущая запись, повтор запрещён');
    const [ru,initialKk,initialPub]=await Promise.all([
      version(id,'ru'),version(id,'kk'),version(id,'kk','published')]);
    let kk=initialKk,pub=initialPub;
    const originalBefore={ru:snapshot(ru),ruPublished:null,
      kk:snapshot(kk),published:snapshot(pub)};
    if(!ru)return report(id,'blocked_missing_ru','','RU Draft отсутствует');
    // category — устаревшая связь: в RU она должна быть пустой. Не копируем аномалию в KK.
    if(relationFields.includes('category') && ids(ru,'category').length)
      return report(id,'blocked_legacy_ru_category','',
        'RU.category должен быть пустым',ids(ru,'category').join('|'));
    if(!kk) {
      if(pub)return report(id,'blocked_inconsistent_kk','','KK Published без KK Draft');
      if(EXISTING_ONLY)return report(id,'blocked_missing_kk_product','',
        'existing-only: создание отсутствующей KK отключено');
      const dependencies=await dependencyCheck(ru);
      const missing=dependencies.filter(x=>!x.ok);
      if(missing.length)return report(id,'blocked_missing_kk_target','',
        'Не создаём Product без KK справочников',
        missing.map(x=>x.field+'/'+x.uid+'/'+x.id).join('|'));
      const required=Object.entries(schema.attributes).filter(([f,a])=>
        localized(a)&&a.required&&!SKIP.has(f)&&!SYSTEM.has(f)&&a.type!=='relation')
        .map(([f])=>f);
      if(required.length)return report(id,'blocked_required_localized','',
        'Нельзя создать пустую KK локаль',required.join('|'));
      if(!APPLY)return report(id,'would_create_kk','','Новая KK Draft без переводов');
      if(!contentToken)return report(id,'blocked_no_content_api_token','',
        'STRAPI_API_TOKEN нужен только для создания KK через документированный REST');
      originalBefore.ruPublished=snapshot(await version(id,'ru','published'));
      file=join(backupDir,id+'.json');
      const created=await createKk(id,ru,originalBefore.ruPublished,originalBefore);
      if(!created.ok)return report(id,'blocked_create_kk','',created.reason,
        'backup:'+id+'.json');
      kk=created.draft;
      pub=null;committed=true;
    }
    if(EXISTING_ONLY && !pub)return report(id,'blocked_unpublished_kk_product','',
      'existing-only: KK Product должен иметь Published версию');
    let draft=plan(ru,kk,pub);
    if(draft.blockers.length) {
      if(file)throw Error('KK создана, но нормализация заблокирована: '+draft.blockers.join('|'));
      return report(id,'blocked_plan','',draft.blockers.join('|'));
    }
    if(!draft.changes.length && !draft.publication) {
      if(!file)return report(id,'already_ok');
      await unlink(file);file=null;
      return report(id,'normalized','','Создана KK Draft');
    }
    const parts=draft.changes.map(x=>x.kind==='relation'?x.field+':'+x.add.length+'+'+x.remove.length:
      x.field).join('|');
    const targets=await dependencyCheck(ru);
    const missing=targets.filter(x=>!x.ok);
    if(missing.length) {
      const why=missing.map(x=>x.field+'/'+x.uid+'/'+x.id).join('|');
      if(committed)throw Error('После создания KK отсутствует target: '+why);
      return report(id,'blocked_missing_kk_target',parts,'Отсутствует KK справочник',why);
    }
    if(EXISTING_ONLY && targets.some(x=>x.requiresPublish))
      return report(id,'blocked_unpublished_kk_target',parts,
        'existing-only: публикация KK справочников отключена',
        targets.filter(x=>x.requiresPublish).map(x=>x.uid+'/'+x.id).join('|'));
    if(!APPLY)return report(id,'would_update',parts,'',
      targets.filter(x=>x.requiresPublish).map(x=>'publish-target:'+x.uid+'/'+x.id).join('|'));
    if(!originalBefore.ruPublished)originalBefore.ruPublished=snapshot(await version(id,'ru','published'));
    file ||= join(backupDir,id+'.json');
    await safeWrite(file,JSON.stringify({documentId:id,at:new Date().toISOString(),
      before:originalBefore,plan:draft,phase:'preflight'},null,2));
    // Зависимые справочники публикуются только после сохранённого backup товара.
    const depIssues=[];
    for(const t of targets.filter(x=>x.requiresPublish)) {
      const r=await publishTarget(t.uid,t.id);
      if(!r.ok)depIssues.push(t.field+':'+r.reason);
    }
    if(depIssues.length) {
      if(committed)throw Error('KK создана, но публикация target не завершена: '+depIssues.join('|'));
      await unlink(file);file=null; // Product не менялся; backup target сохранён отдельно при ошибке.
      return report(id,'blocked_target_publish',parts,depIssues.join('|'));
    }
    // Для connect нужен numeric KK id, а не RU id.
    for(const t of targets) {
      const key=t.uid+'|'+t.id;
      if(!targetCache.get(key)?.numericId) {
        const d=await detail(t.uid,t.id,'kk','draft') ||
          await detail(t.uid,t.id,'kk','published');
        if(!d||!Number.isSafeInteger(d.id)) {
          if(committed)throw Error('После создания KK отсутствует numeric target ID '+key);
          await unlink(file);file=null;
          return report(id,'blocked_missing_kk_target',parts,'Нет numeric ID '+key);
        }
        targetCache.set(key,{ok:true,numericId:d.id});
      }
    }
    const freshPub=await version(id,'kk','published');
    const baseline={ru,ruPublished:originalBefore.ruPublished,kk,pub:freshPub};
    await recheckBeforeWrite(id,baseline);
    let actual=baseline;
    if(draft.changes.length) {
      const writeSnapshot=await nativeWriteRelationPreflight(id,actual,draft.changes);
      const payload=payloadForSave(writeSnapshot,draft.changes);
      await safeWrite(file,JSON.stringify({documentId:id,at:new Date().toISOString(),
        before:originalBefore,plan:draft,phase:'save-kk',payload},null,2));
      // Не повторять PUT даже при HTTP 200, если GET postflight не подтверждён.
      await http('PUT','/content-manager/collection-types/'+UID+'/'+id+'?locale=kk',payload);
      actual=await postflight(id,actual,expectedDraft(actual,draft.changes),'save');
      committed=true;
    }
    // Published ещё может содержать старые relations или отсутствовать.
    if(!actual.pub || !eq(actual.pub.fields,actual.kk.fields)||!relEqual(actual.pub,actual.kk)) {
      const payload=publishPayload(actual.kk);
      await safeWrite(file,JSON.stringify({documentId:id,at:new Date().toISOString(),
        before:originalBefore,plan:draft,phase:'publish-kk',payload},null,2));
      await http('POST','/content-manager/collection-types/'+UID+'/'+id+
        '/actions/publish?locale=kk',payload);
      actual=await postflight(id,actual,actual.kk,'publish');
      committed=true;
    }
    await unlink(file);file=null;
    return report(id,committed?'normalized':'already_ok',parts);
  } catch(e) {
    if(e.fatal) {fatal=e;stopped=true;}
    const note=clean(e.message||e);
    if(!file) {
      return report(id,'error', '',note);
    }
    // При потенциальной записи backup и journal остаются. Не делаем автоматический rollback.
    return report(id,'error_pending_backup','',note,'backup:'+id+'.json');
  }
}
function selfTest() {
  const a={type:'boolean'},m={type:'media'};
  if(!eq(canonical({b:2,a:1}),{a:1,b:2}))throw Error('canonical');
  if(!eq(fieldValue(m,[{id:1},{id:2}]),[1,2]))throw Error('media');
  if(!eq(fieldValue(a,false),false))throw Error('boolean');
  if(!eq(unique(['a','b','a']),['a','b']))throw Error('unique');
  if(!localized({pluginOptions:{i18n:{localized:true}}}))throw Error('locale flag');
  schema={attributes:{
    name:{type:'string'},name1:{type:'string',pluginOptions:{i18n:{localized:true}}},
    active:{type:'boolean',pluginOptions:{i18n:{localized:true}}},InStock:{type:'boolean'},key:{type:'uid',unique:true},
    pictures:{type:'media',pluginOptions:{i18n:{localized:true}}},
    categories:{type:'relation',target:'api::category.category'}}};
  relationFields=['categories'];
  const ru={data:{name:'Номенклатура',active:true,pictures:[{id:10}]},
    fields:{name:'Номенклатура',name1:'Русский',active:true,
      pictures:[10],key:'a',InStock:false},
    relations:{categories:[{documentId:'c1',id:1}]}};
  const kk={data:{name:'Другое',active:false,pictures:[]},
    fields:{name:'Другое',name1:'Қазақша',active:false,
      pictures:[],key:'b',InStock:true},relations:{categories:[]}};
  const p=plan(ru,kk,null);
  if(p.blockers.length || p.changes.length!==4 ||
    p.changes.some(x=>['name1','InStock','key'].includes(x.field)) ||
    !p.changes.some(x=>x.field==='pictures') ||
    !p.changes.some(x=>x.field==='categories'))
    throw Error('plan: перевод, InStock, key, media, relations');
  const sameKk={data:{name:ru.data.name,active:true,pictures:[{id:10}]},
    fields:{...ru.fields,name1:'Қазақша',InStock:true,key:'different'},
    relations:{categories:[{documentId:'c1',id:999}]}};
  const published={fields:{...sameKk.fields},relations:{categories:[{documentId:'c1',id:501}]}};
  const okPlan=plan(ru,sameKk,published);
  if(okPlan.changes.length||okPlan.publication||okPlan.blockers.length)
    throw Error('already_ok: RU↔KK translated text, InStock, key, relation numeric ids');
  if(!plan(ru,null,null).blockers.includes('missing_kk_create_unverified'))
    throw Error('missing KK plan');
  schema.attributes.bitrix_id={type:'string'};
  ru.fields.bitrix_id='123';kk.fields.bitrix_id='456';
  if(!plan(ru,kk,null).blockers.includes('unmanaged_shared:bitrix_id'))
    throw Error('unmanaged shared guard');
  const beforeCounts={...counters};
  countStatus('would_create_kk');countStatus('would_update');countStatus('blocked_missing_kk_target');countStatus('error');
  if(counters.would_create_kk-beforeCounts.would_create_kk!==1||
    counters.would_update-beforeCounts.would_update!==1||
    counters.blocked-beforeCounts.blocked!==1||counters.errors-beforeCounts.errors!==1)
    throw Error('Счётчики статусов normal/create/blocked/error');
  Object.assign(counters,beforeCounts);
  const populatedOk=relationFromPopulate(
    [{id:23,documentId:'abc',locale:'kk'}],{count:1},'kk');
  if(!populatedOk || populatedOk[0].documentId!=='abc')throw Error('populate array');
  if(relationFromPopulate(null,{count:0},'kk')?.length!==0)
    throw Error('populate null singular');
  if(relationFromPopulate({id:31,documentId:'cat',locale:'kk'}, {count:1},'kk')?.length!==1)
    throw Error('populate singular');
  if(relationFromPopulate([{id:4,documentId:'abc'}],{count:2},'kk')!==null ||
     relationFromPopulate([{id:4,documentId:'abc'},{id:5,documentId:'abc'}],{count:2},'kk')!==null)
    throw Error('incomplete/duplicate fallback');
  if(relationFromPopulate([{id:4,documentId:'abc',locale:'ru'}],{count:1},'kk')!==null)
    throw Error('wrong locale fallback');
  relationFields.push('category');
  if(ids({relations:{category:[]}},'category').length!==0 ||
    ids({relations:{category:[{documentId:'legacy'}]}},'category').length!==1)
    throw Error('Legacy category: RU пустой, иначе blocked');
  relationFields.pop();
  if(typeof EXISTING_ONLY!=='boolean')throw Error('existing-only mode');
  log('Self-test: 17/17 OK');
}
// По умолчанию ищем JWT в TXT на рабочем столе (имя файла не важно).
// STRAPI_JWT остаётся приоритетным способом запуска для автоматизации.
async function jwtFromDesktopTxt() {
  const dirs=[SCRIPT_DIR];
  for(const root of [env.USERPROFILE,env.OneDrive,env.OneDriveCommercial,env.OneDriveConsumer])
    if(root)dirs.push(join(root,'Desktop'));
  const seenDirs=new Set(),files=[];
  for(const dir of dirs) {
    const key=process.platform==='win32'?dir.toLowerCase():dir;
    if(seenDirs.has(key))continue;
    seenDirs.add(key);
    const names=await readdir(dir).catch(error=>{
      if(error.code==='ENOENT')return [];
      throw error;
    });
    for(const name of names.filter(n=>/\.txt$/i.test(n))) {
      const full=join(dir,name);
      const raw=await readFile(full,'utf8').catch(error=>{
        if(['ENOENT','EISDIR','EACCES'].includes(error.code))return null;
        throw error;
      });
      if(raw===null)continue;
      const value=raw.replace(/^\uFEFF/,'').trim()
        .replace(/^(?:Bearer\s+|(?:STRAPI_JWT|JWT)\s*[:=]\s*)/i,'')
        .replace(/^["']|["']$/g,'').trim();
      if(/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(value))
        files.push({name,value});
    }
  }
  const tokens=[...new Set(files.map(x=>x.value))];
  if(!tokens.length)throw Error('JWT не найден: сохрани токен в любой .txt файл на рабочем столе');
  if(tokens.length>1)throw Error('Найдено несколько разных JWT в TXT: оставь один актуальный токен');
  log('JWT прочитан из TXT рабочего стола (значение скрыто)');
  return tokens[0];
}
async function main() {
  if(TEST){selfTest();return;}
  if(!token)token=await jwtFromDesktopTxt();
  if(NEW_RUN) {
    const priorLock=await readFile(lockFile,'utf8').catch(()=>null);
    if(priorLock!==null)throw Error('Предыдущий запуск может работать: есть '+lockFile);
    const pending=await readdir(backupDir).catch(()=>[]);
    if(pending.length)throw Error('Неразобранные product-kk-backups: --new-run запрещён');
    const targets=[csvFile,progressFile,summaryFile,schemaFile];
    const existing=[];
    for(const file of targets)if(await readFile(file,'utf8').catch(()=>null)!==null)existing.push(file);
    if(existing.length) {
      const archive=join(SCRIPT_DIR,PREFIX+'-archive-'+Date.now());
      await mkdir(archive,{recursive:true});
      for(const file of existing)await rename(file,join(archive,file.split(/[\\/]/).pop()));
      log('Предыдущие результаты сохранены:',archive);
    }
  }
  await mkdir(backupDir,{recursive:true});
  const lock=lockFile;
  let acquired=false;
  try {
    try {await writeFile(lock,String(pid),{flag:'wx'});acquired=true;}
    catch (error) {
      if(error.code!=='EEXIST')throw error;
      const previous=Number(await readFile(lock,'utf8'));
      if(!Number.isSafeInteger(previous)||previous<1)throw Error('Неверный run.lock');
      let alive=true;
      try {process.kill(previous,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}
      if(alive)throw Error('Другой экземпляр localizer уже запущен (PID '+previous+')');
      await unlink(lock);await writeFile(lock,String(pid),{flag:'wx'});acquired=true;
      log('Восстановлен stale lock предыдущего завершённого процесса');
    }
    const saved=await readFile(progressFile,'utf8').catch(()=>'');
    if(saved&&!saved.endsWith('\n'))throw Error('Неполная последняя строка checkpoint: нужен ручной разбор');
    const previous=saved.split('\n').filter(Boolean).map(line=>JSON.parse(line));
    for(const row of previous) {
      if(!row.id||seen.has(row.id))throw Error('Некорректный/повторённый documentId checkpoint');
      seen.add(row.id);
      counters.scanned++;
      countStatus(row.status);
    }
    await safeWrite(csvFile,csvHeader+previous.map(row=>
      [row.id,row.status,row.changes,row.reason,row.details].map(csvCell).join(';')).join('\n')+
      (previous.length?'\n':''));
    const pending=await readdir(backupDir);
    log('Режим:',APPLY?'APPLY':'DRY-RUN', 'existingOnly='+EXISTING_ONLY,
      'workers='+WORKERS,'maxRequests='+REQUESTS,
      'checkpoint='+seen.size,'pendingBackup='+pending.length);
    log('Strapi:',URL_ROOT);
    log('Читаем схему Content Manager...');
    const [types,components]=await Promise.all([
      get('/content-manager/content-types'),get('/content-manager/components')]);
    allSchemas=types?.data;
    schema=allSchemas?.find(x=>x.uid===UID);
    if(!schema?.attributes || !Array.isArray(components?.data)) throw Error('Схема Strapi недоступна');
    relationFields=Object.entries(schema.attributes).filter(([k,a])=>!SYSTEM.has(k)&&a.type==='relation')
      .map(([k])=>k);
    if(PROBE_ID){await probeRelations(PROBE_ID);return;}
    const signature=createHash('sha256').update(JSON.stringify(canonical(schema.attributes))).digest('hex');
    const signaturePath=schemaFile;
    const oldHash=await readFile(signaturePath,'utf8').catch(()=>null);
    if(oldHash && oldHash!==signature)throw Error('Схема изменилась после checkpoint; начни новый state dir');
    if(!oldHash)await safeWrite(signaturePath,signature);
    const productIds=ONLY_ID?[ONLY_ID]:await allIds();
    const selected=LIMIT?productIds.slice(0,LIMIT):productIds;
    counters.total=selected.length;
    runTotal=selected.length;
    runKnown=selected.filter(id=>seen.has(id)).length;
    runStartedAt=Date.now();
    log('RU Product:',productIds.length,'к обработке:',selected.length,'relations:',relationFields.length);
    log('Результаты рядом со скриптом:',SCRIPT_DIR);
    if(runKnown)log('Уже проверено по checkpoint:',runKnown+'/'+runTotal);
    let cursor=0;
    await Promise.all(Array.from({length:Math.min(WORKERS,selected.length)},async ()=>{
      while(!stopped) {
        const i=cursor++;
        if(i>=selected.length)return;
        await one(selected[i]);
      }
    }));
    await finishWrite;
    await safeWrite(summaryFile,JSON.stringify({
      completed:!stopped,at:new Date().toISOString(),mode:APPLY?'apply':'dry-run',
      counters,requestsLimit:REQUESTS,workers:WORKERS,existingOnly:EXISTING_ONLY,
      interrupted:interruptRequested,
      fatal:fatal?.message||null,unfinished:Math.max(0,selected.length-seen.size)
    },null,2));
    log('Итог:', 'проверено='+counters.scanned+'/'+counters.total,
      'normalized='+counters.normalized,'already_ok='+counters.already_ok,
      'blocked='+counters.blocked,'errors='+counters.errors,
      'interrupted='+interruptRequested);
    log('Завершено. CSV:',csvFile,'summary:',summaryFile);
    if(fatal)throw fatal;
  } finally {if(acquired)await unlink(lock).catch(()=>{});}
}
main().catch(e=>{console.error('[localizer] STOP:',e.message);process.exitCode=1;});
