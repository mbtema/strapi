// Этап 3: импорт из готового CSV Matcher. Node.js 20+, без запросов к карточкам Bitrix.
// Читает весь products-matched.csv: по одному товару за раз до конца файла.
// По умолчанию dry-run; --apply для последовательной записи всех товаров.
// Нужен только JWT Strapi; медиа скачиваются по публичным URL без Cookie.
import { readFile, writeFile, rename, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

// Рабочие файлы находятся на рабочем столе Windows.
const DESKTOP = resolve(process.env.USERPROFILE || homedir(), 'Desktop');
process.chdir(DESKTOP);

const CFG = {
  strapi: 'http://10.10.3.80:1337',
  bitrix: 'https://www.monamie.kz',
  locale: 'ru',
  input: 'products-matched.csv',
  timeoutMs: 30000,
  maxImageMB: 20
};
const AUTH = {
  // Один раз вставь свои значения в кавычки, потом только запускай скрипт.
  strapiJwt: "ВСТАВЬ_JWT_STRAPI"
};
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const confirmation = args.find(x => x.startsWith('--confirm='))?.slice(10);
const VERBOSE = args.includes('--verbose');
const RETRY_ERRORS = args.includes('--retry-errors');
const RETRY_PARTIAL = args.includes('--retry-partial');
const getNumberOption = (key, fallback, min, max) => {
  const values = args.filter(x => x.startsWith(key + '='));
  if (values.length > 1) throw Error('Параметр повторён: ' + key);
  if (!values.length) return fallback;
  const n = Number(values[0].split('=')[1]);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw Error('Некорректное значение ' + key);
  return n;
};
const PAUSE_MS = getNumberOption('--pause-ms', 1500, 500, 60000);
for (const a of args) {
  if (!['--apply','--verbose','--retry-errors','--retry-partial'].includes(a) &&
      !/^--confirm=\d+$/.test(a) &&
      !/^--pause-ms=\d+$/.test(a)) throw Error('Неизвестный параметр: ' + a);
}
const stateFile = resolve('products-media-checkpoint.json');
const log = (...v) => console.log('[Importer]', ...v);
const clean = x => String(x ?? '').replace(/\s+/g, ' ').trim();
const filled = x => x != null && (typeof x === 'string' ? !!x.trim() :
  Array.isArray(x) ? x.length > 0 : typeof x === 'object' && 'data' in x ? filled(x.data) : true);
const unwrap = x => x?.attributes && !Array.isArray(x.attributes) && !x.documentId
  ? { ...x.attributes, id: x.id } : x;
const listOf = x => Array.isArray(x?.results) ? x.results : Array.isArray(x?.data) ? x.data : null;
const pageOf = x => x?.pagination ?? x?.meta?.pagination;
const strapiUrl = path => new URL(path, CFG.strapi).href;
async function http(url, opts={}) {
  let response;
  try {
    response = await fetch(url, {
      redirect: 'manual', signal: AbortSignal.timeout(CFG.timeoutMs), ...opts
    });
  } catch (e) {
    throw Error(`${opts.method || 'GET'} ${new URL(url).host}: ${e.cause?.code || e.message}`);
  }
  if (!response.ok) {
    // Не повторять автоматически POST/PUT при неоднозначном исходе.
    throw Error(`${opts.method || 'GET'} ${new URL(url).pathname}: HTTP ${response.status}`);
  }
  return response;
}
const sGet = async path => (await http(strapiUrl(path), {
  headers: { Authorization: `Bearer ${AUTH.strapiJwt}`, Accept: 'application/json' }
})).json();
function parseCsv(text) {
  const rows=[]; let row=[], cell='', quoted=false;
  const src=text.replace(/^\uFEFF/, '');
  for(let i=0;i<src.length;i++) {
    const c=src[i];
    if(quoted) {
      if(c==='"' && src[i+1]==='"') {cell+='"'; i++;}
      else if(c==='"') quoted=false;
      else cell+=c;
    } else if(c==='"' && !cell) quoted=true;
    else if(c===';') { row.push(cell); cell=''; }
    else if(c==='\n') {
      row.push(cell.replace(/\r$/, '')); if(row.some(Boolean)) rows.push(row);
      row=[];cell='';
    } else cell+=c;
  }
  if(quoted) throw Error('CSV: незакрытая кавычка');
  if(cell || row.length) {row.push(cell.replace(/\r$/, ''));if(row.some(Boolean))rows.push(row);}
  return rows;
}

const INPUT_FIELDS = [
 'documentId','name','name1','name2','detail_picture','preview_picture',
 'pictures','active','newFrom1C','attributes','categories','detail_text',
 'bitrixId','matchedBarcode','bitrixActive','bitrixSectionId','bitrixName1',
 'bitrixName2','bitrixDetailText','bitrixPreviewPictureUrl',
 'bitrixDetailPictureUrl','bitrixPicturesJson'
];
function validateMediaUrl(value) {
 if (!value) return '';
 let url;
 try { url = new URL(value); } catch { throw Error('Некорректный URL медиа из CSV'); }
 const root = new URL(CFG.bitrix);
 if (url.origin !== root.origin || url.protocol !== 'https:' ||
     url.username || url.password || url.search || url.hash ||
     !/^\/upload\/iblock\/(?!resize_cache\/)[^?#]+\.(?:jpe?g|png|webp|gif)$/i.test(url.pathname) ||
     /%2f|%5c/i.test(url.pathname)) {
   throw Error('URL не является публичным оригиналом Bitrix /upload/iblock/');
 }
 return url.href;
}
async function inputRows() {
 const raw = await readFile(resolve(CFG.input), 'utf8');
 const data = parseCsv(raw);
 const heads = data.shift();
 if (JSON.stringify(heads) !== JSON.stringify(INPUT_FIELDS)) {
   throw Error('Ожидаются 22 колонки нового products-matched.csv из Matcher');
 }
 if (!data.length) throw Error('В products-matched.csv нет кандидатов');
 const ids=new Set(), bIds=new Set();
 const rows=data.map((cells,index) => {
   const where='CSV строка '+(index+2)+': ';
   if (cells.length !== heads.length) throw Error(where+'число колонок');
   const row=Object.fromEntries(heads.map((h,i)=>[h,cells[i]]));
   if (!/^[a-z0-9]+$/i.test(row.documentId) ||
       !/^\d+$/.test(row.bitrixId) || row.bitrixId==='0' ||
       !/^\d+$/.test(row.bitrixSectionId) || row.bitrixSectionId==='0') {
     throw Error(where+'неверный идентификатор');
   }
   if (ids.has(row.documentId) || bIds.has(row.bitrixId)) throw Error(where+'дубликат ID');
   if (!['true','false'].includes(row.bitrixActive) ||
       !['true','false'].includes(row.active) ||
       !['true','false','null'].includes(row.newFrom1C) ||
       ['detail_picture','preview_picture','pictures','detail_text']
         .some(f=>!['true','false'].includes(row[f]))) {
     throw Error(where+'некорректные флаги');
   }
   if (!row.matchedBarcode || !row.attributes.split('|').includes(row.matchedBarcode)) {
     throw Error(where+'нет matchedBarcode среди attributes');
   }
   row.bitrixPreviewPictureUrl=validateMediaUrl(row.bitrixPreviewPictureUrl);
   row.bitrixDetailPictureUrl=validateMediaUrl(row.bitrixDetailPictureUrl);
   let images;
   try { images=JSON.parse(row.bitrixPicturesJson); }
   catch { throw Error(where+'bitrixPicturesJson не JSON'); }
   if (!Array.isArray(images)) throw Error(where+'галерея не массив');
   images.forEach((image,i)=>{
     if (!image || image.order!==i+1 || !/^\d+$/.test(String(image.fileId)) || !image.url) {
       throw Error(where+'неполная галерея');
     }
     image.url=validateMediaUrl(image.url);
   });
   row.bitrixPictures=images;
   ids.add(row.documentId);bIds.add(row.bitrixId);
   return row;
 });
 return {rows,hash:createHash('sha256').update(raw).digest('hex').slice(0,16)};
}

async function detail(uid,id,status=null) {
  const q=new URLSearchParams({locale:CFG.locale});
  if(status)q.set('status',status);
  const j=await sGet(`/content-manager/collection-types/${uid}/${encodeURIComponent(id)}?${q}`);
  const data=j.data??j;
  const matches=(Array.isArray(data)?data:[data]).map(unwrap)
    .filter(x=>x?.documentId===id && x?.locale===CFG.locale);
  if(matches.length!==1) throw Error(`Strapi ${uid}/${id}: найдено ${matches.length}`);
  return matches[0];
}
async function relations(id, field) {
  const all=[],seen=new Set();
  for(let page=1;page<=100;page++) {
    const q=new URLSearchParams({locale:CFG.locale,page:String(page),pageSize:'100'});
    const j=await sGet(`/content-manager/relations/api::product.product/${id}/${field}?${q}`);
    const values=listOf(j);
    if(!values) throw Error(`Relations ${field}: неизвестный формат`);
    for(const v of values) {
      const x=unwrap(v);
      if(!x?.documentId)throw Error(`Relations ${field}: нет documentId`);
      if(!seen.has(x.documentId)){seen.add(x.documentId);all.push(x);}
    }
    const pg=pageOf(j);
    if(pg?.pageCount != null ? page >= Number(pg.pageCount) : values.length<100) return all;
    if(!values.length)return all;
  }
  throw Error(`Relations ${field}: более 100 страниц`);
}

async function categoryBySection(sectionId) {
  const q=new URLSearchParams({locale:CFG.locale,page:'1',pageSize:'20'});
  q.set('filters[bitrix_id][$eq]',sectionId);
  const j=await sGet(`/content-manager/collection-types/api::category.category?${q}`);
  const rows=listOf(j);
  if(!rows)throw Error(`Category ${sectionId}: неизвестный формат`);
  const m=rows.map(unwrap).filter(x=>String(x.bitrix_id)===sectionId && x.locale===CFG.locale);
  const total=Number(pageOf(j)?.total??m.length);
  return (m.length===1 && total===1 && m[0].documentId && Number.isInteger(m[0].id))?m[0]:null;
}

function mediaId(v) {
  if(typeof v==='number')return v;
  if(typeof v==='string'&&/^\d+$/.test(v))return Number(v);
  if(v && typeof v==='object' && 'data' in v)return mediaId(v.data);
  return Number.isInteger(v?.id)?v.id:null;
}
function mediaIds(v) {
  const arr=Array.isArray(v)?v:Array.isArray(v?.data)?v.data:[];
  return arr.map(mediaId);
}
// Те же шесть обязательных полей, по которым config.js отбирает товары.
// Галерея (pictures) необязательна; active не является критерием полноты.
const requiredContent = ['name1','name2','preview_picture','detail_picture','detail_text'];
const missingRequired = (product, categories) => [
  ...requiredContent.filter(field => !filled(product[field])),
  ...(categories.length ? [] : ['categories'])
];
async function loadState() {
  try {return JSON.parse(await readFile(stateFile,'utf8'));}
  catch(e){if(e.code==='ENOENT')return {uploads:{}};throw e;}
}
async function storeState(state) {
  const temp=stateFile+'.tmp';
  await writeFile(temp,JSON.stringify(state,null,2),{mode:0o600});
  await rename(temp,stateFile);
}
async function upload(image,field,order,id,state,markWrite) {
  const key=`${id}:${field}:${image.fileId}`;
  const known=state.uploads[key];
  if(known){log(`Media checkpoint: ${field} -> ${known}`);return known;}
  const u=new URL(image.url);
  validateMediaUrl(u.href);
  const r=await http(u.href,{headers:{'User-Agent':'Mozilla/5.0','Accept':'image/*'}});
  const mime=r.headers.get('content-type')?.split(';')[0].trim();
  const ext=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'})[mime];
  if(!ext)throw Error(`Изображение ${image.fileId}: MIME ${mime}`);
  const buf=Buffer.from(await r.arrayBuffer());
  if(!buf.length||buf.length>CFG.maxImageMB*1024*1024)throw Error('Неверный размер изображения');
  const filename=`bitrix-${id}-${field}${order?'-'+String(order).padStart(2,'0'):''}-${image.fileId}.${ext}`;
  const form=new FormData();
  form.append('files',new Blob([buf],{type:mime}),filename);
  // POST /upload — без retry. Если ответ неясен, проверить Media Library вручную.
  await markWrite('UPLOAD '+field+' '+image.fileId);
  let j;
  try {j=await (await http(strapiUrl('/upload'),{method:'POST',
    headers:{Authorization:`Bearer ${AUTH.strapiJwt}`},body:form})).json();}
  catch(e){throw Error(`Upload ${filename}: результат неопределён; не повторяй до проверки Media Library (${e.message})`);}
  const result=Array.isArray(j)?j[0]:null;
  if(!Number.isInteger(result?.id))throw Error(`Upload ${filename}: нет Media ID; не повторять без проверки`);
  state.uploads[key]=result.id;
  await storeState(state);
  log(`Media: ${field} ${image.fileId} -> ${result.id}`);
  return result.id;
}

// Контроль массовой обработки: отдельный checkpoint для каждой версии CSV.
// Перед любой записью фиксируем review. После сбоя во время POST/PUT автоматический retry запрещён.
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const csvCell = value => {
  const str = String(value ?? '');
  return /[;"\r\n]/.test(str) ? '"'+str.replace(/"/g,'""')+'"' : str;
};
const reportFields=['documentId','bitrixId','name','status','changes','missing','newFrom1C','published','phase','message'];
function reportCsv(rows, items) {
  return '\uFEFF'+reportFields.join(';')+'\r\n'+rows.map(row=>{
    const record=items[row.documentId]||{};
    const obj={...row,...record,missing:Array.isArray(record.missing)?record.missing.join('|'):record.missing};
    return reportFields.map(f=>csvCell(obj[f])).join(';');
  }).join('\r\n')+'\r\n';
}
async function atomicWrite(filename,data) {
  const temp=filename+'.tmp';
  await writeFile(temp,data,'utf8');
  await rename(temp,filename);
}
async function loadJob(hash,rows) {
  const file=resolve('products-import-journal-'+hash+'.jsonl');
  const items=Object.create(null);
  let raw='';
  try {raw=await readFile(file,'utf8');}
  catch(e){if(e.code!=='ENOENT')throw e;}
  if(raw && !raw.endsWith('\n')) {
    throw Error('Checkpoint оборван: проверь последний товар вручную перед продолжением: '+file);
  }
  for(const line of raw.split('\n').filter(Boolean)) {
    const event=JSON.parse(line);
    if(event.hash!==hash || !event.documentId || !event.item)throw Error('Неверный формат checkpoint');
    items[event.documentId]=event.item;
  }
  const save=async(id,item)=>{
    await appendFile(file,JSON.stringify({hash,documentId:id,item})+'\n','utf8');
    items[id]=item;
  };
  const reportFile=resolve(APPLY?'products-import-report.csv':'products-import-plan.csv');
  const report=async()=>atomicWrite(reportFile,reportCsv(rows,items));
  return {items,save,report,file,reportFile};
}

async function migrateOne(row, markWrite, verbose) {

  const [product,oldCats,html]=await Promise.all([
    detail('api::product.product',row.documentId),
    relations(row.documentId,'categories'),
    bGet(cardUrl(row.bitrixId))
  ]);
  const bitrix=extractBitrix(html);
  if(product.newFrom1C!==true) {
    log('SKIP: newFrom1C уже false, Bitrix ID '+row.bitrixId);
    return {status:'skipped_already',changes:0,missing:[],newFrom1C:false,published:null,message:'newFrom1C уже false'};
  }
  if(verbose) {
    log('Перенос по CSV: Bitrix ID '+row.bitrixId+' -> Strapi '+row.documentId);
    log('Bitrix: '+cardUrl(row.bitrixId));
  }

  const mapping=[];
  for(const section of bitrix.sections) {
    const category=await categoryBySection(section);
    mapping.push({section,category});
  }
  const missingCats=mapping.filter(x=>x.category && !oldCats.some(c=>c.documentId===x.category.documentId)).map(x=>x.category);
  const byField=new Map();
  const actions=[];
  function add(field,action,note=''){
    byField.set(field,action); actions.push({field,action,note});
  }
  for(const f of ['name1','name2','detail_text']) {
    add(f,filled(product[f])?'KEEP':filled(bitrix[f])?'FILL':'SOURCE_EMPTY');
  }
  for(const f of ['preview_picture','detail_picture']) {
    add(f,filled(product[f])?'KEEP':bitrix[f]?.url?'UPLOAD_AND_LINK':'SOURCE_EMPTY');
  }
  // Не записываем неполную галерею: иначе повторный запуск сочтёт поле заполненным.
  const galleryComplete=bitrix.pictures.length>0 && bitrix.pictures.every(x=>!!x.url);
  const gallery=galleryComplete?bitrix.pictures:[];
  add('pictures',filled(product.pictures)?'KEEP':galleryComplete?'UPLOAD_AND_LINK':
    bitrix.pictures.length?'SOURCE_INCOMPLETE':'SOURCE_EMPTY',
    `${bitrix.pictures.filter(x=>!!x.url).length}/${bitrix.pictures.length} изображений доступны`);
  add('active',bitrix.active===null?'SOURCE_UNAVAILABLE':product.active===bitrix.active?'KEEP':'SYNC');
  add('categories',missingCats.length?'CONNECT':mapping.some(x=>!x.category)?'SOURCE_UNAVAILABLE':'KEEP',
    `${missingCats.length} добавить; ${mapping.filter(x=>!x.category).length} разделов без соответствия`);
  // Показываем решение по флагу заранее, но снимаем его только после проверки фактического сохранения.
  const projected={...product};
  for(const field of ['name1','name2','detail_text']) {
    if(!filled(projected[field]) && filled(bitrix[field]))projected[field]=bitrix[field];
  }
  for(const field of ['preview_picture','detail_picture']) {
    if(!filled(projected[field]) && bitrix[field]?.url)projected[field]={id:1};
  }
  const plannedMissing=missingRequired(projected,[...oldCats,...missingCats]);
  add('newFrom1C',plannedMissing.length?'KEEP_INCOMPLETE':'CLEAR_AFTER_VERIFY',
    plannedMissing.length?`останутся пустыми: ${plannedMissing.join(', ')}`:'отдельный PUT после успешной проверки всех полей');
  add('publish','PUBLISH_AFTER_SAVE','после Save и проверки записи, только locale=ru');
  if(verbose)console.table(actions);
  const missingSource=actions.filter(x=>['SOURCE_EMPTY','SOURCE_UNAVAILABLE','SOURCE_INCOMPLETE'].includes(x.action));
  log(`План: ${actions.filter(x=>['FILL','UPLOAD_AND_LINK','SYNC','CONNECT'].includes(x.action)).length} изменений, ${missingSource.length} полей без источника`);
  if(!APPLY) return {status:'dry_run',changes:actions.filter(x=>['FILL','UPLOAD_AND_LINK','SYNC','CONNECT'].includes(x.action)).length,missing:plannedMissing,newFrom1C:product.newFrom1C,published:false,message:'План составлен, записей нет'};

  // Прямо перед записью заново проверяем значения целевых полей.
  const snapshot=p=>JSON.stringify(['name1','name2','detail_text','preview_picture','detail_picture','pictures','active','name','newFrom1C'].map(f=>p[f]));
  const fresh=await detail('api::product.product',row.documentId);
  const freshCats=await relations(row.documentId,'categories');
  if(snapshot(fresh)!==snapshot(product) ||
     JSON.stringify(freshCats.map(x=>x.documentId).sort())!==JSON.stringify(oldCats.map(x=>x.documentId).sort())) {
    throw Error('Товар или его категории изменились; запуск остановлен');
  }

  const state=await loadState();
  const payload={};
  for(const f of ['name1','name2','detail_text']) {
    if(byField.get(f)==='FILL')payload[f]=bitrix[f];
  }
  if(byField.get('active')==='SYNC')payload.active=bitrix.active;
  for(const f of ['preview_picture','detail_picture']) {
    if(byField.get(f)==='UPLOAD_AND_LINK')payload[f]=await upload(bitrix[f],f,0,row.bitrixId,state,markWrite);
  }
  if(byField.get('pictures')==='UPLOAD_AND_LINK') {
    payload.pictures=[];
    for(const image of gallery)payload.pictures.push(await upload(image,'pictures',image.order,row.bitrixId,state,markWrite));
  }
  if(missingCats.length)payload.categories={connect:missingCats.map(x=>({id:x.id,documentId:x.documentId,locale:CFG.locale})),disconnect:[]};
  if(!Object.keys(payload).length)log('Новых значений контента нет; проверю полноту карточки');

  // Изображения могли загружаться долго: проверяем ещё раз перед PUT.
  const now=await detail('api::product.product',row.documentId);
  const nowCats=await relations(row.documentId,'categories');
  if(snapshot(fresh)!==snapshot(now) ||
     JSON.stringify(nowCats.map(x=>x.documentId).sort())!==JSON.stringify(freshCats.map(x=>x.documentId).sort())) {
    throw Error('Strapi изменился во время загрузки Media; PUT отменён, checkpoint сохранён');
  }

  const productPath=`/content-manager/collection-types/api::product.product/${row.documentId}?locale=${CFG.locale}`;
  if(Object.keys(payload).length) {
    await markWrite('PUT_CONTENT');
    try {
      await http(strapiUrl(productPath),{
        method:'PUT',headers:{Authorization:`Bearer ${AUTH.strapiJwt}`,'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      });
    } catch(e) {throw Error(`PUT контента: результат требует проверки; не повторять вслепую (${e.message})`);}
  }
  const after=await detail('api::product.product',row.documentId);
  const afterCats=await relations(row.documentId,'categories');
  const checks=[];
  for(const [field,expected] of Object.entries(payload)) {
    let ok;
    if(field==='categories')ok=missingCats.every(x=>afterCats.some(y=>y.documentId===x.documentId)) &&
      oldCats.every(x=>afterCats.some(y=>y.documentId===x.documentId));
    else if(field==='pictures')ok=JSON.stringify(mediaIds(after.pictures))===JSON.stringify(expected);
    else if(['preview_picture','detail_picture'].includes(field))ok=mediaId(after[field])===expected;
    else ok=after[field]===expected;
    checks.push({field,verify:ok?'OK':'FAILED'});
  }
  if(verbose)console.table(checks);
  if(checks.some(x=>x.verify!=='OK'))throw Error('Save выполнен, но проверка не прошла; ручная диагностика перед повтором');
  log('CONTENT_VERIFIED: доступный контент сохранён и проверен.');

  const catIds=x=>JSON.stringify(x.map(c=>c.documentId).sort());
  const stillMissing=missingRequired(after,afterCats);
  let finalSaved=after;
  let finalCats=afterCats;
  if(stillMissing.length) {
    // Частичный перенос разрешён: остаётся признак незавершённой миграции.
    log(`FLAG_KEEP: newFrom1C=true; карточка неполная: ${stillMissing.join(', ')}`);
    if(!Object.keys(payload).length) {
      log('SAVE_SKIP: изменений нет; Publish не выполняется');
      return {status:'partial',changes:0,missing:stillMissing,newFrom1C:true,published:false,message:'Нет изменений; обязательный контент неполный'};
    }
  } else {
    // Отдельный Save флага после того, как все шесть обязательных полей проверены.
    const beforeFlag=await detail('api::product.product',row.documentId);
    const catsBeforeFlag=await relations(row.documentId,'categories');
    if(snapshot(beforeFlag)!==snapshot(after) || catIds(catsBeforeFlag)!==catIds(afterCats)) {
      throw Error('Карточка изменилась перед сбросом newFrom1C; Publish отменён');
    }
    await markWrite('PUT_NEWFROM1C');
    try {
      await http(strapiUrl(productPath),{
        method:'PUT',headers:{Authorization:`Bearer ${AUTH.strapiJwt}`,'Content-Type':'application/json'},
        body:JSON.stringify({newFrom1C:false})
      });
    } catch(e) {
      throw Error(`PUT newFrom1C: исход требует проверки; контент уже сохранён, Publish не выполнялся (${e.message})`);
    }
    finalSaved=await detail('api::product.product',row.documentId);
    finalCats=await relations(row.documentId,'categories');
    if(finalSaved.newFrom1C!==false ||
       missingRequired(finalSaved,finalCats).length ||
       catIds(finalCats)!==catIds(afterCats)) {
      throw Error('newFrom1C / обязательный контент не прошли проверку после PUT; Publish отменён');
    }
    log('FLAG_VERIFIED: newFrom1C=false сохранён и проверен');
  }

  // Последнее действие: Publish только после всех Save и подтверждённых проверок.
  // Повторный live-read защищает от публикации изменённой во время операции карточки.
  const beforePublish=await detail('api::product.product',row.documentId);
  const beforePublishCats=await relations(row.documentId,'categories');
  if(snapshot(beforePublish)!==snapshot(finalSaved) ||
     catIds(beforePublishCats)!==catIds(finalCats)) {
    throw Error('Карточка изменилась перед Publish; публикация отменена');
  }

  const publishPath=`/content-manager/collection-types/api::product.product/${row.documentId}/actions/publish?locale=${CFG.locale}`;
  await markWrite('POST_PUBLISH');
  try {
    await http(strapiUrl(publishPath),{
      method:'POST',
      headers:{Authorization:`Bearer ${AUTH.strapiJwt}`,'Content-Type':'application/json'},
      body:'{}'
    });
  } catch(e) {
    // POST Publish не повторять автоматически: исход может быть неизвестен.
    throw Error(`Publish: результат требует проверки в Strapi; не запускай повторно вслепую (${e.message})`);
  }
  log('PUBLISH_SENT: запрос принят, проверяю опубликованную версию');

  // Читаем именно опубликованную версию, а не текущий draft.
  const published=await detail('api::product.product',row.documentId,'published');
  if(!published.publishedAt || Number.isNaN(Date.parse(published.publishedAt))) {
    throw Error('Publish отправлен, но publishedAt не подтверждён; проверь статус товара в Strapi');
  }
  const scalarFields=['name','name1','name2','detail_text','active','newFrom1C'];
  for(const field of scalarFields) {
    if(published[field]!==finalSaved[field]) {
      throw Error(`Publish выполнен, но опубликованное поле ${field} отличается от сохранённого`);
    }
  }
  for(const field of ['preview_picture','detail_picture']) {
    if(mediaId(published[field])!==mediaId(finalSaved[field])) {
      throw Error(`Publish выполнен, но опубликованное поле ${field} отличается от сохранённого`);
    }
  }
  if(JSON.stringify(mediaIds(published.pictures))!==JSON.stringify(mediaIds(finalSaved.pictures))) {
    throw Error('Publish выполнен, но опубликованная галерея отличается от сохранённой');
  }
  log(`PUBLISH_VERIFIED: опубликована ru-версия, publishedAt=${published.publishedAt}, newFrom1C=${published.newFrom1C}`);
  log('MIGRATION_COMPLETE: Save → проверка → newFrom1C → Publish → проверка опубликованной версии');
  return {status:stillMissing.length?'partial':'done',changes:checks.length,missing:stillMissing,
    newFrom1C:published.newFrom1C,published:true,message:'Publish проверен'};

}
async function main() {
  const missingAuth=['strapiJwt'].filter(k=>{
    const v=AUTH[k];return !v || ['ВСТАВЬ_','__LOCAL_','PASTE_'].some(p=>v.startsWith(p));
  });
  if(missingAuth.length)throw Error('Заполни JWT Strapi в const AUTH: '+missingAuth.join(', '));
  const {rows,hash}=await inputRows();
  // --apply обрабатывает все строки файла; старый --confirm доступен только для одиночного теста.
  if(APPLY && confirmation && (rows.length!==1 || confirmation!==rows[0].bitrixId)) {
    throw Error('--confirm=<BitrixID> допускается только для CSV с одним соответствующим товаром');
  }
  const job=await loadJob(hash,rows);
  const items=APPLY?job.items:{};
  const started=Date.now();
  let attempted=0,successful=0,failed=0,manual=0,skipped=0;
  log((APPLY?'APPLY':'DRY-RUN')+': '+rows.length+' товаров; обработка всех строк последовательно; пауза '+PAUSE_MS+' мс');
  log('Отчёт: '+job.reportFile);
  let stopRequested=false;
  process.on('SIGINT',()=>{stopRequested=true;log('Остановка запрошена; заканчиваю текущий товар');});
  for(let idx=0;idx<rows.length && !stopRequested;idx++) {
    const row=rows[idx];
    const previous=items[row.documentId];
    if(APPLY && previous && (['done','skipped_already','review'].includes(previous.status) ||
        (previous.status==='error' && !RETRY_ERRORS) ||
        (previous.status==='partial' && !RETRY_PARTIAL))) {
      skipped++;
      continue;
    }
    if(attempted>0)await sleep(PAUSE_MS);
    attempted++;
    let writeStarted=false;
    const item={status:'running',attempts:(previous?.attempts||0)+1,bitrixId:row.bitrixId,
      name:row.name,updatedAt:new Date().toISOString(),phase:'READ'};
    if(APPLY)await job.save(row.documentId,item);
    const markWrite=async phase=>{
      writeStarted=true;
      if(APPLY){Object.assign(item,{status:'review',phase,message:'Не повторять до проверки возможной записи'});await job.save(row.documentId,item);}
    };
    try {
      const result=await migrateOne(row,markWrite,VERBOSE || rows.length===1);
      Object.assign(item,result,{phase:'COMPLETE',updatedAt:new Date().toISOString()});
      if(['done','partial','skipped_already','dry_run'].includes(result.status))successful++;
      log('['+(idx+1)+'/'+rows.length+'] '+row.bitrixId+': '+result.status+
          '; изменений: '+result.changes+'; осталось полей: '+(result.missing?.length||0));
    }catch(e){
      Object.assign(item,{status:writeStarted?'review':'error',phase:item.phase||'READ',
        message:String(e?.message||e),updatedAt:new Date().toISOString()});
      if(writeStarted)manual++; else failed++;
      console.error('[Importer] ['+(idx+1)+'/'+rows.length+'] '+row.bitrixId+' '+item.status+': '+item.message);
    }
    if(APPLY)await job.save(row.documentId,item);
    else items[row.documentId]=item;
    log('Прогресс: обработано '+attempted+', успешно/частично '+successful+
        ', ошибки чтения '+failed+', ручная проверка '+manual);
  }
  await atomicWrite(job.reportFile,reportCsv(rows,items));
  log('ИТОГО за запуск: '+attempted+' обработано, '+successful+' успешно/частично, '+
      failed+' ошибок, '+manual+' требуется проверить вручную, '+skipped+
      ' пропущено по checkpoint. Прошло '+Math.round((Date.now()-started)/1000)+' сек.');
  log('CSV-отчёт: '+job.reportFile);
  if(APPLY) {
    log('Checkpoint: '+job.file+'; следующий запуск с тем же CSV продолжит обработку');
    const totals={done:0,partial:0,skipped_already:0,error:0,review:0,pending:0};
    for(const row of rows){
      const status=items[row.documentId]?.status||'pending';
      totals[status in totals ? status : 'pending']++;
    }
    log('Сводка CSV: '+JSON.stringify(totals));
    if(totals.error || totals.review || totals.pending && !attempted)process.exitCode=1;
  } else if(failed)process.exitCode=1;
}
main().catch(e=>{console.error('[Importer] STOP:',e.message);process.exitCode=1;});