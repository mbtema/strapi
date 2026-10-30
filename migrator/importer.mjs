// Bitrix -> Strapi: этап 3. Node.js 20+, npm install cheerio.
// Читает migration-matched.csv, по умолчанию dry-run, запись только --apply --confirm=<bitrixId>.
// JWT Strapi и Cookie Bitrix нужно один раз вставить в const AUTH ниже; отдельные файлы не нужны.
import * as cheerio from 'cheerio';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

// Рабочие файлы находятся на рабочем столе Windows.
const DESKTOP = resolve(process.env.USERPROFILE || homedir(), 'Desktop');
process.chdir(DESKTOP);

const CFG = {
  strapi: 'http://10.10.3.80:1337',
  bitrix: 'https://www.monamie.kz',
  locale: 'ru',
  input: 'migration-matched.csv',
  timeoutMs: 30000,
  maxImageMB: 20
};
const AUTH = {
  // Один раз вставь свои значения в кавычки, потом только запускай скрипт.
  strapiJwt: "ВСТАВЬ_JWT_STRAPI",
  bitrixCookie: "ВСТАВЬ_COOKIE_BITRIX"
};
const APPLY = process.argv.includes('--apply');
const confirmation = process.argv.find(x => x.startsWith('--confirm='))?.slice(10);
const stateFile = resolve('migration-media-checkpoint.json');
const log = (...v) => console.log('[Importer]', ...v);
const clean = x => String(x ?? '').replace(/\s+/g, ' ').trim();
const filled = x => x != null && (typeof x === 'string' ? !!x.trim() :
  Array.isArray(x) ? x.length > 0 : typeof x === 'object' && 'data' in x ? filled(x.data) : true);
const unwrap = x => x?.attributes && !Array.isArray(x.attributes) && !x.documentId
  ? { ...x.attributes, id: x.id } : x;
const listOf = x => Array.isArray(x?.results) ? x.results : Array.isArray(x?.data) ? x.data : null;
const pageOf = x => x?.pagination ?? x?.meta?.pagination;
const strapiUrl = path => new URL(path, CFG.strapi).href;
const bitrixUrl = (path, params={}) => {
  const u = new URL(path, CFG.bitrix);
  for (const [k,v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.href;
};
const cardUrl = id => bitrixUrl('/bitrix/admin/iblock_element_edit.php', {
  IBLOCK_ID: '1', type: 'catalog', lang: 'ru', ID: id,
  find_section_section: '-1', WF: 'Y'
});

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
const bGet = async url => (await http(url, { headers: {
  Cookie: AUTH.bitrixCookie, Accept: 'text/html',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0 Safari/537.36'
}})).text();

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
async function inputRow() {
  const data=parseCsv(await readFile(resolve(CFG.input),'utf8'));
  const heads=data.shift();
  const expected=['documentId','name','barcodes','bitrixId','bitrixCardUrl','matchedBarcode'];
  if(JSON.stringify(heads)!==JSON.stringify(expected)) {
    throw Error('Неверные колонки CSV: ' + heads?.join(';'));
  }
  if(data.length!==1 || data[0].length!==6) {
    throw Error('Для пилота нужен CSV ровно с одним товаром');
  }
  const row=Object.fromEntries(heads.map((h,i)=>[h,data[0][i]]));
  // Совпадение товара уже проверено matcher.js; здесь используются только ID.
  if(!/^[a-z0-9]+$/i.test(row.documentId) || !/^\d+$/.test(row.bitrixId)) {
    throw Error('CSV: некорректные documentId или bitrixId');
  }
  return row;
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

function prop(source,key) {
  const re=new RegExp(`(?:['"]${key}['"]|\\b${key}\\b)\\s*:\\s*(?:'((?:\\\\.|[^'\\\\])*)'|"((?:\\\\.|[^"\\\\])*)"|(\\d+))`);
  const m=source.match(re);
  return m ? String(m[1]??m[2]??m[3]).replace(/\\u002f/gi,'/').replace(/\\\//g,'/').replace(/\\(['"\\])/g,'$1') : null;
}
function imageFrom(source,id) {
  if(!/^\d+$/.test(String(id??'')))return null;
  const objects=source.replace(/&quot;/g,'"').replace(/&amp;/g,'&').match(/\{[^{}]{0,10000}\}/g)??[];
  for(const obj of objects) {
    if(prop(obj,'fileId')!==String(id))continue;
    const path=prop(obj,'real_url');
    if(!path)continue;
    let u;try{u=new URL(path,CFG.bitrix);}catch{continue;}
    if(u.origin!==CFG.bitrix || !u.pathname.startsWith('/upload/iblock/') || u.pathname.includes('/resize_cache/'))continue;
    return {fileId:String(id),url:u.href};
  }
  return null;
}
function extractBitrix(html) {
  const $=cheerio.load(html);
  if(typeof $('input[name="NAME"]').first().val()!=='string') {
    throw Error('Bitrix: не найдена карточка товара');
  }
  const property=id => {
    const matches=$('input[name], textarea[name]').toArray().filter(el=>
      new RegExp(`^PROP\\[${id}\\]\\[`).test($(el).attr('name')??''));
    return matches.length===1 ? String($(matches[0]).val()??'') : null;
  };
  const single=field=>{
    const row=$(`#tr_${field}`);
    if(!row.length)return null;
    const fileId=row.find(`input[type="hidden"][name="${field}"]`).first().val();
    if(!/^\d+$/.test(String(fileId??'')))return null;
    // Ищем метаданные в строке, затем в JS карточки.
    const fromRow=imageFrom($.html(row),fileId);
    if(fromRow)return fromRow;
    for(const s of $('script').toArray()) {
      const text=$(s).html()??'';
      if(text.includes(String(fileId))){const img=imageFrom(text,fileId);if(img)return img;}
    }
    return null;
  };
  const imgs=$('input[name]').toArray().filter(el=>
    /^PROP\[28\]\[\d+\]$/.test($(el).attr('name')??'') && /^\d+$/.test(String($(el).val())));
  const sources=[...new Set(imgs.map(el=>$(el).closest('tr').get(0)).filter(Boolean))].map(row=>$.html(row));
  $('script').each((_,s)=>{const t=$(s).html()??'';if(imgs.some(el=>t.includes(String($(el).val()))))sources.push(t);});
  const pictures=imgs.map((el,index)=>{
    const id=String($(el).val());
    return {order:index+1,fileId:id,...(sources.map(s=>imageFrom(s,id)).find(Boolean)??{})};
  });
  const selects=$('select[name^="IBLOCK_SECTION"]');
  const sections=[...new Set(selects.find('option:selected').toArray()
    .map(el=>String($(el).attr('value')??'')).filter(s=>/^\d+$/.test(s)&&Number(s)>0))];
  const activeInput=$('input[type="checkbox"][name="ACTIVE"]');
  const active=activeInput.length ? activeInput.is(':checked') : null;
  const detailText=$('textarea[name="DETAIL_TEXT"]');
  return {name1:property(216),name2:property(217),
    preview_picture:single('PREVIEW_PICTURE'),detail_picture:single('DETAIL_PICTURE'),
    pictures,detail_text:detailText.length?String(detailText.first().val()??''):null,
    active,sections};
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
async function upload(image,field,order,id,state) {
  const key=`${id}:${field}:${image.fileId}`;
  const known=state.uploads[key];
  if(known){log(`Media checkpoint: ${field} -> ${known}`);return known;}
  const u=new URL(image.url);
  if(u.origin!==CFG.bitrix || !u.pathname.startsWith('/upload/iblock/'))throw Error('Небезопасный URL изображения');
  const r=await http(u.href,{headers:{Cookie:AUTH.bitrixCookie,'User-Agent':'Mozilla/5.0','Accept':'image/*'}});
  const mime=r.headers.get('content-type')?.split(';')[0].trim();
  const ext=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'})[mime];
  if(!ext)throw Error(`Изображение ${image.fileId}: MIME ${mime}`);
  const buf=Buffer.from(await r.arrayBuffer());
  if(!buf.length||buf.length>CFG.maxImageMB*1024*1024)throw Error('Неверный размер изображения');
  const filename=`bitrix-${id}-${field}${order?'-'+String(order).padStart(2,'0'):''}-${image.fileId}.${ext}`;
  const form=new FormData();
  form.append('files',new Blob([buf],{type:mime}),filename);
  // POST /upload — без retry. Если ответ неясен, проверить Media Library вручную.
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

async function main() {
  const missingAuth = ['strapiJwt', 'bitrixCookie'].filter(key => {
    const value = AUTH[key];
    return !value || value.startsWith('ВСТАВЬ_') || value.startsWith('__LOCAL_') || value.startsWith('PASTE_');
  });
  if (missingAuth.length) throw Error('Открой importer.mjs и вставь JWT и Cookie в const AUTH: ' + missingAuth.join(', '));
  const row=await inputRow();
  if(APPLY && confirmation!==row.bitrixId)throw Error(`Для записи нужен --apply --confirm=${row.bitrixId}`);
  log(APPLY?'APPLY (1 товар)':'DRY-RUN (0 записей)');

  const [product,oldCats,html]=await Promise.all([
    detail('api::product.product',row.documentId),
    relations(row.documentId,'categories'),
    bGet(cardUrl(row.bitrixId))
  ]);
  const bitrix=extractBitrix(html);
  if(product.newFrom1C!==true)throw Error('Товар больше не является кандидатом: newFrom1C != true');
  log(`Перенос по CSV: Bitrix ID ${row.bitrixId} -> Strapi ${row.documentId}`);
  log(`Bitrix: ${cardUrl(row.bitrixId)}`);

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
  console.table(actions);
  const missingSource=actions.filter(x=>['SOURCE_EMPTY','SOURCE_UNAVAILABLE','SOURCE_INCOMPLETE'].includes(x.action));
  log(`План: ${actions.filter(x=>['FILL','UPLOAD_AND_LINK','SYNC','CONNECT'].includes(x.action)).length} изменений, ${missingSource.length} полей без источника`);
  if(!APPLY) {log('DRY_RUN_READY: без изменений и Publish');return;}

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
    if(byField.get(f)==='UPLOAD_AND_LINK')payload[f]=await upload(bitrix[f],f,0,row.bitrixId,state);
  }
  if(byField.get('pictures')==='UPLOAD_AND_LINK') {
    payload.pictures=[];
    for(const image of gallery)payload.pictures.push(await upload(image,'pictures',image.order,row.bitrixId,state));
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
  console.table(checks);
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
      return;
    }
  } else {
    // Отдельный Save флага после того, как все шесть обязательных полей проверены.
    const beforeFlag=await detail('api::product.product',row.documentId);
    const catsBeforeFlag=await relations(row.documentId,'categories');
    if(snapshot(beforeFlag)!==snapshot(after) || catIds(catsBeforeFlag)!==catIds(afterCats)) {
      throw Error('Карточка изменилась перед сбросом newFrom1C; Publish отменён');
    }
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

}
main().catch(e=>{console.error('[Importer] STOP:',e.message);process.exitCode=1;});