// Attributes: CSV из Bitrix Matcher -> Strapi api::attribute.attribute (locale=ru).
// Node.js 20+ без npm-зависимостей: --apply для записи, иначе dry-run.
// Только публичное скачивание картинок Bitrix: без Cookie и чтения админ-карточек.
// Рабочие CSV, журнал и отчёты — на рабочем столе Windows.
import { readFile, writeFile, rename, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const CFG = {
  strapi: 'http://10.10.3.80:1337',
  bitrix: 'https://www.monamie.kz',
  locale: 'ru',
  input: 'attributes-matched.csv',
  timeoutMs: 30000,
  maxImageMB: 20,
  pauseMs: 150,
  dictionaryPageSize: 100
};
const AUTH = {
  jwtToken: 'ВСТАВЬ_JWT_STRAPI',
  // Cookie Bitrix больше не требуются.
};
const DESKTOP = resolve(process.env.USERPROFILE || homedir(), 'Desktop');
process.chdir(DESKTOP);

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const VERBOSE = args.includes('--verbose');
const RETRY_ERRORS = args.includes('--retry-errors');
const PROBE_MEDIA = args.includes('--probe-media');
const ONLY = args.find(x => x.startsWith('--only='))?.slice(7) ?? null;
const customLimit = args.find(x => x.startsWith('--limit='))?.slice(8);
const LIMIT = customLimit === undefined ? null : Number(customLimit);
if (LIMIT !== null && (!Number.isSafeInteger(LIMIT) || LIMIT < 1 || LIMIT > 100000)) {
  throw Error('Неверное --limit (допустимо 1..100000)');
}
if (LIMIT !== null && ONLY !== null) throw Error('Используй только один из --only и --limit');
const customPause = args.find(x => x.startsWith('--pause-ms='))?.slice(11);
const PAUSE_MS = customPause == null ? CFG.pauseMs : Number(customPause);
if (!Number.isSafeInteger(PAUSE_MS) || PAUSE_MS < 0 || PAUSE_MS > 60000) {
  throw Error('Неверное --pause-ms (допустимо 0..60000)');
}
if (ONLY !== null && !/^[a-z0-9]+$/i.test(ONLY)) throw Error('Неверное --only=documentId');
if (PROBE_MEDIA && (APPLY || !ONLY)) {
  throw Error('Для проверки без записи используй --probe-media --only=DOCUMENT_ID без --apply');
}
for (const arg of args) {
  if (!['--apply', '--verbose', '--retry-errors', '--probe-media'].includes(arg) &&
      !/^--only=[a-z0-9]+$/i.test(arg) &&
      !/^--pause-ms=\d+$/.test(arg) &&
      !/^--limit=\d+$/.test(arg)) throw Error('Неизвестный параметр: ' + arg);
}
const LOG = '[Attributes importer]';
const BUILD = 'v2-volume-publish';
const log = (...v) => console.log(LOG, ...v);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UID = 'api::attribute.attribute';
const VOLUME_UID = 'api::volume.volume';
const strapiUrl = path => new URL(path, CFG.strapi).href;
const withLocale = (id, status) => {
  const q = new URLSearchParams({ locale: CFG.locale });
  if (status) q.set('status', status);
  return '/content-manager/collection-types/' + UID + '/' + encodeURIComponent(id) + '?' + q;
};
const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';

function parseCsv(input) {
  const text = input.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', quoted = false, afterQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; afterQuote = true; }
      else cell += ch;
    } else if (afterQuote) {
      if (ch === ';' || ch === '\n' || ch === '\r') {
        afterQuote = false;
        if (ch === ';') { row.push(cell); cell = ''; }
        else { if (ch === '\r' && text[i + 1] === '\n') i++;
          row.push(cell); rows.push(row); row = []; cell = ''; }
      } else throw Error('Некорректная кавычка в CSV');
    } else if (ch === '"' && !cell) quoted = true;
    else if (ch === ';') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else if (ch === '"') throw Error('Неэкранированная кавычка CSV');
    else cell += ch;
  }
  if (quoted) throw Error('Незакрытые кавычки CSV');
  if (cell !== '' || row.length || afterQuote) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x !== ''));
}

// Одинаковое числовое значение в двух CMS, независимо от запятой/точки.
// Название Volume должно быть СТРОГО числовым, без «МЛ»/«ГР».
function quantity(value, context) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const match = /^(\d+)(?:[.,](\d+))?$/.exec(raw);
  if (!match) throw Error(context + ': ожидалось числовое значение: ' + JSON.stringify(raw));
  const whole = match[1].replace(/^0+(?=\d)/, '');
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  return whole + (fraction ? '.' + fraction : '');
}
// «50» → value=50 + name «50»; «50МЛ» не подходит.
// Для десятичных чисел «0,1» и «0.1» считаются одинаковой цифровой записью.
function exactVolumeName(name, normalized) {
  const raw = String(name ?? '').trim();
  return raw === normalized || (normalized.includes('.') && raw === normalized.replace('.', ','));
}

function validatedImageUrl(value) {
  if (!value) return '';
  let url;
  try { url = new URL(value); }
  catch { throw Error('Некорректный pictureUrl в CSV'); }
  const root = new URL(CFG.bitrix);
  if (url.origin !== root.origin || url.protocol !== 'https:' ||
      url.username || url.password || url.search || url.hash ||
      !/^\/upload\/iblock\/(?!resize_cache\/)[^?#]+\.(?:jpe?g|png|webp|gif)$/i.test(url.pathname) ||
      /%2f|%5c/i.test(url.pathname)) {
    throw Error('pictureUrl не ведёт на публичный оригинал Bitrix /upload/iblock/');
  }
  return url.href;
}

async function inputRows() {
  const raw = await readFile(resolve(CFG.input), 'utf8');
  const lines = parseCsv(raw);
  const fields = lines.shift();
  const expected = 'documentId;barcode;active;hasDetailPicture;bitrixId;' +
    'bitrixActive;pictureUrl;volumeDocumentId;volumeValue;bitrixVolumeValue;bitrixVolumeStatus';
  if (fields?.join(';') !== expected || !lines.length) {
    throw Error('Нужен attributes-matched.csv из Matcher v5.2+ (11 колонок): ' + expected);
  }
  const docIds = new Set(), barcodes = new Set(), bitrixIds = new Set();
  const rows = lines.map((cells, idx) => {
    if (cells.length !== 11) throw Error('CSV строка ' + (idx + 2) + ': должно быть 11 колонок');
    const [documentId, barcode, active, hasDetailPicture, bitrixId, bitrixActive,
      imageUrl, volumeDocumentId, volumeValue, bitrixVolumeValue, bitrixVolumeStatus] = cells;
    const where = 'CSV строка ' + (idx + 2) + ': ';
    if (!/^[a-z0-9]+$/i.test(documentId) || docIds.has(documentId)) {
      throw Error(where + 'пустой/повторный documentId');
    }
    docIds.add(documentId);
    if (!barcode || barcode !== barcode.trim() ||
        /^[+-]?\d+(?:[.,]\d+)?[eE][+-]?\d+$/.test(barcode) || barcodes.has(barcode)) {
      throw Error(where + 'пустой, повторный или повреждённый barcode');
    }
    barcodes.add(barcode);
    if (!/^\d+$/.test(bitrixId) || bitrixId === '0' || bitrixIds.has(bitrixId)) {
      throw Error(where + 'неверный/повторный Bitrix ID');
    }
    bitrixIds.add(bitrixId);
    if (!['true', 'false', 'null'].includes(active) ||
        !['true', 'false'].includes(hasDetailPicture) ||
        !['true', 'false'].includes(bitrixActive)) {
      throw Error(where + 'некорректные active / Media');
    }
    const pictureUrl = validatedImageUrl(imageUrl);
    if (hasDetailPicture === 'true' && pictureUrl) {
      throw Error(where + 'в Strapi уже есть Media, но задан pictureUrl');
    }
    if (volumeDocumentId && !/^[a-z0-9]+$/i.test(volumeDocumentId)) {
      throw Error(where + 'неверный volumeDocumentId');
    }
    if (volumeValue && !volumeDocumentId) {
      throw Error(where + 'volumeValue заполнен без relation documentId');
    }
    if (volumeValue) quantity(volumeValue, where + 'Strapi volumeValue');
    if (!['known','empty','manual'].includes(bitrixVolumeStatus)) {
      throw Error(where + 'неизвестный bitrixVolumeStatus');
    }
    if (bitrixVolumeStatus === 'known' &&
        (!bitrixVolumeValue || quantity(bitrixVolumeValue, where + 'Bitrix volumeValue') !== bitrixVolumeValue)) {
      throw Error(where + 'Bitrix known должен содержать каноническое число');
    }
    if (bitrixVolumeStatus !== 'known' && bitrixVolumeValue) {
      throw Error(where + 'empty/manual не должны содержать числовое значение');
    }
    const needsActive = active !== bitrixActive;
    const needsPicture = hasDetailPicture === 'false' && Boolean(pictureUrl);
    const needsVolume = bitrixVolumeStatus === 'known'
      ? quantity(volumeValue, where + 'Strapi volumeValue') !== bitrixVolumeValue
      : bitrixVolumeStatus === 'empty' && Boolean(volumeDocumentId);
    if (!needsActive && !needsPicture && !needsVolume) {
      throw Error(where + 'Matcher включил запись без изменений');
    }
    return {
      documentId, barcode, bitrixId, pictureUrl,
      active: active === 'null' ? null : active === 'true',
      hasDetailPicture: hasDetailPicture === 'true',
      bitrixActive: bitrixActive === 'true',
      volumeDocumentId, volumeValue, bitrixVolumeValue, bitrixVolumeStatus
    };
  });
  if (ONLY && !rows.some(row => row.documentId === ONLY)) {
    throw Error('--only: documentId отсутствует в CSV');
  }
  return { rows, hash: createHash('sha256').update(raw).digest('hex').slice(0, 16) };
}

function bitrixBlocked(message) {
  const error = new Error(message);
  error.code = 'BITRIX_BLOCKED';
  return error;
}

async function http(url, options = {}, allowReadRetry = false) {
  const method = options.method ?? 'GET';
  const target = new URL(url);
  const fromBitrix = target.origin === new URL(CFG.bitrix).origin;
  const max = method === 'GET' && allowReadRetry ? 3 : 1;
  for (let attempt = 1; attempt <= max; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(CFG.timeoutMs),
        ...options
      });
    } catch (e) {
      if (attempt === max) throw Error(method + ' ' + new URL(url).pathname +
        ': network/timeout ' + (e.cause?.code ?? e.message));
      await sleep(400 * attempt);
      continue;
    }
    // При ограничении или истечении сессии Bitrix — немедленно стоп.
    // Не делаем retry и не переходим к тысячам следующих карточек.
    if (fromBitrix && ([401, 403, 429].includes(response.status) || response.status >= 500)) {
      await response.body?.cancel().catch(() => {});
      throw bitrixBlocked('Bitrix вернул HTTP ' + response.status + ' для ' +
        target.pathname + '. Доступ ограничен; импорт остановлен, без повторов.');
    }
    if (response.status >= 300 && response.status < 400) {
      if (fromBitrix) {
        await response.body?.cancel().catch(() => {});
        throw bitrixBlocked('Bitrix перенаправляет ' + target.pathname +
          ' (HTTP ' + response.status + '). Сессия/публичный доступ не подтверждены.');
      }
      throw Error(method + ' ' + target.pathname + ': redirect ' + response.status);
    }
    if ((response.status === 429 || response.status >= 500) && attempt < max) {
      await response.body?.cancel().catch(() => {});
      await sleep(500 * attempt);
      continue;
    }
    if (!response.ok) {
      if (!fromBitrix && ([401, 403, 429].includes(response.status) || response.status >= 500)) {
        const e = new Error('Strapi ' + method + ' ' + target.pathname +
          ': HTTP ' + response.status + '. Доступ/сервер не подтверждён.');
        e.code = 'STRAPI_BLOCKED';
        throw e;
      }
      throw Error(method + ' ' + new URL(url).pathname + ': HTTP ' + response.status);
    }
    return response;
  }
}
const sHeaders = () => ({ Authorization: 'Bearer ' + AUTH.jwtToken, Accept: 'application/json' });
// Оригиналы /upload/iblock скачиваем как публичные файлы, без сессии Bitrix.
// При отказе доступа не подставляем Cookie автоматически.
const publicImageHeaders = () => ({
  Accept: 'image/*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0 Safari/537.36'
});

async function readStrapi(id, status, expectedBarcode) {
  const path = withLocale(id, status);
  const json = await (await http(strapiUrl(path), { headers: sHeaders() }, true)).json();
  const data = json.data ?? json;
  const flat = value => value?.attributes && !value.documentId
    ? { ...value.attributes, id: value.id } : value;
  const matches = (Array.isArray(data) ? data : [data]).map(flat)
    .filter(value => value?.documentId === id && value?.locale === CFG.locale);
  if (matches.length !== 1) throw Error('Strapi ' + id + ': найдена не одна ru-запись');
  const value = matches[0];
  if (!Object.hasOwn(value, 'active') || !Object.hasOwn(value, 'detail_picture')) {
    throw Error('Strapi ' + id + ': в ответе нет active или detail_picture');
  }
  if (value.active !== true && value.active !== false && value.active !== null) {
    throw Error('Strapi ' + id + ': неподдерживаемое значение active');
  }
  // CSV — снимок на момент matcher. Перед любыми изменениями и после Publish
  // barcode Strapi должен по-прежнему совпадать с исходным точным значением.
  if (expectedBarcode !== undefined &&
      (typeof value.barcode !== 'string' || value.barcode !== expectedBarcode)) {
    throw Error('Strapi ' + id + ': barcode изменился относительно исходного CSV');
  }
  return value;
}
function mediaId(raw) {
  const v = raw && typeof raw === 'object' && 'data' in raw ? raw.data : raw;
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  if (typeof v === 'object' && Number.isSafeInteger(v.id) && v.id > 0) return v.id;
  throw Error('Неизвестный формат Strapi detail_picture: нельзя безопасно определить наличие Media');
}
function snapshot(item, volume) {
  return JSON.stringify({
    active: item.active,
    detail_picture: mediaId(item.detail_picture),
    volumeDocumentId: volume?.documentId ?? '',
    volumeId: volume?.id ?? null,
    updatedAt: item.updatedAt ?? null,
    publishedAt: item.publishedAt ?? null
  });
}

// Подтверждено Network: native GET relations Attribute/volume с locale=ru.
async function readVolumeRelation(documentId) {
  const query = new URLSearchParams({ locale: CFG.locale, pageSize: '5', page: '1' });
  const path = '/content-manager/relations/' + UID + '/' +
    encodeURIComponent(documentId) + '/volume?' + query;
  const data = await (await http(strapiUrl(path), { headers: sHeaders() }, true)).json();
  const entries = data?.results;
  const total = data?.pagination?.total;
  const pages = data?.pagination?.pageCount;
  if (!Array.isArray(entries) || !Number.isSafeInteger(total) || total > 1 ||
      total < 0 || !Number.isSafeInteger(pages) || pages < 0 || pages > 1 ||
      entries.length !== total || (data.pagination?.page != null && data.pagination.page !== 1)) {
    throw Error('Strapi ' + documentId + ': невозможно подтвердить to-one relation Volume');
  }
  if (!entries.length) return null;
  const entry = entries[0];
  if (!Number.isSafeInteger(entry?.id) || entry.id <= 0 ||
      typeof entry.documentId !== 'string' || !/^[a-z0-9]+$/i.test(entry.documentId)) {
    throw Error('Strapi ' + documentId + ': Volume relation без числового id/documentId');
  }
  return { id: entry.id, documentId: entry.documentId };
}

function unwrapRecord(value) {
  if (value && typeof value === 'object' && value.attributes && !value.documentId) {
    return { ...value.attributes, id: value.id };
  }
  return value;
}

// 447 Volume в справочнике: постранично загружаем ОДИН раз до любых записей.
async function readVolumeCatalog() {
  const byId = new Map();
  const byNumber = new Map();
  let page = 1, total = null, pageCount = null;
  do {
    const q = new URLSearchParams({
      page: String(page), pageSize: String(CFG.dictionaryPageSize),
      sort: 'id:ASC', locale: CFG.locale
    });
    q.append('fields[0]', 'name');
    q.append('fields[1]', 'value');
    const path = '/content-manager/collection-types/' + VOLUME_UID + '?' + q;
    const json = await (await http(strapiUrl(path), { headers: sHeaders() }, true)).json();
    const list = json?.results ?? json?.data;
    const pagination = json?.pagination ?? json?.meta?.pagination;
    if (!Array.isArray(list) || !pagination ||
        !Number.isSafeInteger(pagination.total) ||
        !Number.isSafeInteger(pagination.pageCount) ||
        pagination.pageCount < 1 || pagination.pageCount > 100 ||
        pagination.total < 0 ||
        (pagination.page != null && pagination.page !== page) ||
        list.length > CFG.dictionaryPageSize ||
        (page < pagination.pageCount && list.length !== CFG.dictionaryPageSize)) {
      throw Error('Некорректная пагинация справочника Volume, страница ' + page);
    }
    if (total === null) { total = pagination.total; pageCount = pagination.pageCount; }
    if (total !== pagination.total || pageCount !== pagination.pageCount) {
      throw Error('Справочник Volume менялся во время чтения; запись отменена');
    }
    for (const raw of list) {
      const item = unwrapRecord(raw);
      if (!Number.isSafeInteger(item?.id) || item.id <= 0 ||
          typeof item.documentId !== 'string' || !/^[a-z0-9]+$/i.test(item.documentId) ||
          typeof item.name !== 'string' || !Object.hasOwn(item, 'value')) {
        throw Error('В справочнике Volume запись без id/documentId/name/value');
      }
      if (byId.has(item.documentId)) throw Error('Дубли documentId в справочнике Volume');
      const entry = { id: item.id, documentId: item.documentId, name: item.name, value: item.value };
      byId.set(entry.documentId, entry);
      if (entry.value != null && entry.value !== '') {
        // Справочник может содержать вручную нормализованные/нечисловые значения.
        // Они не подходят для автоматического выбора, но не блокируют остальные записи.
        let value = '';
        try { value = quantity(entry.value, 'Volume ' + entry.documentId); }
        catch { /* только ручная обработка такого Volume */ }
        if (value && exactVolumeName(entry.name, value)) {
          const options = byNumber.get(value) ?? [];
          options.push(entry);
          byNumber.set(value, options);
        }
      }
    }
    page++;
  } while (page <= pageCount);
  if (byId.size !== total) {
    throw Error('Неполный список Volume: ожидалось ' + total + ', получено ' + byId.size);
  }
  log('Справочник Volume:', total, 'записей; уникальных числовых ключей:',
    byNumber.size, '| повторные пары name/value:',
    [...byNumber.values()].filter(items => items.length > 1).length);
  return { byId, byNumber };
}

async function currentVolumeValue(relation, catalog) {
  if (!relation) return '';
  let entry = catalog.byId.get(relation.documentId);
  if (!entry) {
    // Для существующего отношения, отсутствующего в list, читаем target напрямую.
    const path = '/content-manager/collection-types/' + VOLUME_UID + '/' +
      encodeURIComponent(relation.documentId) + '?locale=' + CFG.locale;
    const json = await (await http(strapiUrl(path), { headers: sHeaders() }, true)).json();
    entry = unwrapRecord(json?.data ?? json);
    if (entry?.documentId !== relation.documentId || entry.id !== relation.id ||
        !Object.hasOwn(entry, 'value')) {
      throw Error('Volume ' + relation.documentId + ': target не подтверждён');
    }
    catalog.byId.set(entry.documentId, entry);
  }
  if (entry.id !== relation.id) {
    throw Error('Volume ' + relation.documentId + ': изменился числовой ID relation');
  }
  return entry.value == null || entry.value === '' ? '' :
    quantity(entry.value, 'Volume ' + relation.documentId);
}

// Network 2026-11-09: Content Manager отправляет full data + delta relations
// в POST /actions/publish, не PUT. Передаём только поля, которые UI отправил
// в подтверждённом запросе; неизвестные/служебные поля не перезаписываем.
const PUBLISH_FIELDS = [
  'name','barcode','bitrix_id','xml_id','price','product_number','code_1c',
  'label_new','label_hit','home_new_priority','home_hit_priority','label_sales',
  'label_exclusive','shareUrl','key','color_info','isInStock','name_web','active'
];
function publishWithVolumePayload(item, action) {
  const payload = {};
  for (const key of PUBLISH_FIELDS) {
    if (Object.hasOwn(item, key)) payload[key] = item[key];
  }
  if (!Object.hasOwn(payload, 'name') || !Object.hasOwn(payload, 'barcode') ||
      !Object.hasOwn(payload, 'active') || !Object.hasOwn(item, 'detail_picture')) {
    throw Error('Publish: в live Attribute отсутствует обязательное поле');
  }
  payload.detail_picture = item.detail_picture;
  for (const name of ['product','shade','color_variant1C','filtry']) {
    // Структура подтверждена запросом Publish; не трогаем другие relations.
    payload[name] = { connect: [], disconnect: [] };
  }
  payload.volume = {
    connect: action?.target ?
      [{ id: action.target.id, documentId: action.target.documentId, isTemporary: true }] : [],
    disconnect: action?.previous ?
      [{ id: action.previous.id, documentId: action.previous.documentId }] : []
  };
  return payload;
}

function getMime(ct) {
  const type = ct.split(';')[0].trim().toLowerCase();
  const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'image/gif': 'gif' })[type];
  if (!ext) throw Error('Неизвестный MIME изображения Bitrix: ' + type);
  return { type, ext };
}
async function atomicWrite(path, text) {
  const temp = path + '.tmp';
  await writeFile(temp, text, 'utf8');
  await rename(temp, path);
}
async function readJournal(hash) {
  const path = resolve('attributes-import-journal-' + hash + '.jsonl');
  let text;
  try { text = await readFile(path, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') text = ''; else throw e; }
  if (text && !text.endsWith('\n')) {
    throw Error('Журнал оборван, нужна ручная проверка: ' + path);
  }
  const items = new Map();
  for (const line of text.split('\n').filter(Boolean)) {
    const event = JSON.parse(line);
    if (event.hash !== hash || !event.documentId || !event.item) {
      throw Error('Неверный формат журнала ' + path);
    }
    items.set(event.documentId, event.item);
  }
  const save = async (documentId, item) => {
    await appendFile(path, JSON.stringify({ hash, documentId, item }) + '\n', 'utf8');
    items.set(documentId, item);
  };
  return { path, items, save };
}

const REPORT = ['documentId','barcode','active','hasDetailPicture','bitrixId',
  'bitrixActive','pictureUrl','volumeDocumentId','volumeValue',
  'bitrixVolumeValue','bitrixVolumeStatus','volumeStrapi','volumeBitrix',
  'volumeAction','status','activeStrapi','pictureStrapi','pictureBitrix',
  'changes','published','phase','message'];
function reportCsv(rows, items) {
  return '\uFEFF' + [
    REPORT.join(';'),
    ...rows.map(row => {
      const result = items.get(row.documentId) ?? { status: 'pending' };
      return REPORT.map(field => {
        const value = Object.hasOwn(result, field) ? result[field] : row[field];
        return quote(value == null ? (field === 'active' ? 'null' : '') : value);
      }).join(';');
    })
  ].join('\r\n');
}

// Отдельный результат ручной проверки Volume — без фильтрации общего отчёта.
function volumeManualCsv(rows, items) {
  const fields = ['documentId','barcode','bitrixId','bitrixVolumeValue',
    'volumeDocumentId','volumeValue','status','reason'];
  const selected = rows.filter(row => {
    const item = items.get(row.documentId);
    return item?.status === 'review' &&
      String(item.message ?? '').startsWith('Volume для Bitrix ');
  });
  return '\uFEFF' + [
    fields.join(';'),
    ...selected.map(row => {
      const item = items.get(row.documentId);
      const data = { ...row, status: item.status, reason: item.message };
      return fields.map(key => quote(data[key])).join(';');
    })
  ].join('\r\n');
}

async function downloadOriginal(image, trace) {
  const url = validatedImageUrl(image.url);
  trace('MEDIA_DOWNLOAD_PUBLIC: GET оригинала без Cookie Bitrix');
  // Без retry: если сервер ограничивает доступ, не увеличиваем нагрузку.
  let response;
  try {
    response = await http(url, { headers: publicImageHeaders() });
  } catch (error) {
    if (error.code === 'BITRIX_BLOCKED') throw error;
    throw bitrixBlocked('Не удалось получить публичный файл Bitrix. ' +
      'Импорт остановлен без повторов: ' + error.message);
  }
  const contentType = response.headers.get('content-type') ?? '';
  let mime;
  try {
    mime = getMime(contentType);
  } catch {
    await response.body?.cancel().catch(() => {});
    throw bitrixBlocked('Bitrix вернул вместо изображения ' + (contentType || 'неизвестный MIME') +
      '. Публичный доступ не подтверждён, Cookie не используется.');
  }
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > CFG.maxImageMB * 1048576) {
    await response.body?.cancel().catch(() => {});
    throw Error('Слишком большой файл Bitrix');
  }
  const buf = Buffer.from(await response.arrayBuffer());
  if (!buf.length || buf.length > CFG.maxImageMB * 1048576) {
    throw Error('Пустой или слишком большой файл Bitrix');
  }
  return { buf, mime };
}

async function upload(image, bitrixId, markWrite, trace) {
  const { buf, mime } = await downloadOriginal(image, trace);
  const imageKey = createHash('sha256').update(image.url).digest('hex').slice(0, 12);
  const filename = 'bitrix-attribute-' + bitrixId + '-detail-' + imageKey + '.' + mime.ext;
  const form = new FormData();
  form.append('files', new Blob([buf], { type: mime.type }), filename);
  form.append('fileInfo', JSON.stringify({ name: filename }));
  await markWrite('UPLOAD_MEDIA');
  trace('UPLOAD_MEDIA: отправляю файл в Strapi (' + filename + ')');
  let media;
  try {
    media = await (await http(strapiUrl('/upload'), {
      method: 'POST', headers: { Authorization: 'Bearer ' + AUTH.jwtToken },
      body: form
    })).json();
  } catch (e) {
    throw Error('Upload исход неопределён, не повторять до проверки Media Library: ' + e.message);
  }
  const value = Array.isArray(media) ? media[0] : media;
  if (!Number.isSafeInteger(value?.id) || value.id <= 0) {
    throw Error('Upload вернул неизвестный Media ID, требуется ручная проверка');
  }
  trace('MEDIA_UPLOADED: Media ID=' + value.id);
  return value.id;
}

async function migrateOne(row, catalog, markWrite, markMediaUploaded, trace) {
  trace('READ: Strapi live + Volume relation; источник Bitrix — CSV');
  const [initial, initialVolume] = await Promise.all([
    readStrapi(row.documentId, null, row.barcode),
    readVolumeRelation(row.documentId)
  ]);
  const initialMedia = mediaId(initial.detail_picture);
  const needsActive = initial.active !== row.bitrixActive;
  const needsPicture = initialMedia === null && Boolean(row.pictureUrl);
  let volumeAction = null, volumeReviewMessage = '';
  let sourceValue = '';
  if (row.bitrixVolumeStatus === 'known') {
    sourceValue = await currentVolumeValue(initialVolume, catalog);
    if (sourceValue !== row.bitrixVolumeValue) {
      const targets = catalog.byNumber.get(row.bitrixVolumeValue) ?? [];
      if (targets.length !== 1) {
        // Не создаём словарь и не выбираем один из дубликатов произвольно.
        volumeReviewMessage = 'Volume для Bitrix ' + row.bitrixVolumeValue +
          ': подходящих name=value в Strapi ' + targets.length + '; проверить вручную';
      } else {
        volumeAction = {
          type: initialVolume ? 'replace' : 'add',
          target: targets[0], previous: initialVolume
        };
      }
    }
  } else if (row.bitrixVolumeStatus === 'empty' && initialVolume) {
    volumeAction = { type: 'remove', target: null, previous: initialVolume };
  }
  // status=manual: не изменяем Volume, даже если bitrixVolumeValue пуст.
  const base = {
    activeStrapi: String(initial.active),
    activeBitrix: String(row.bitrixActive),
    pictureStrapi: initialMedia ?? '',
    pictureBitrix: row.pictureUrl ? 'есть URL' : '',
    volumeStrapi: sourceValue,
    volumeBitrix: row.bitrixVolumeValue,
    volumeAction: volumeAction?.type ?? (volumeReviewMessage ? 'manual_review' : '')
  };
  const planned = [
    needsActive ? 'active' : '',
    needsPicture ? 'detail_picture' : '',
    volumeAction ? 'volume_' + volumeAction.type : ''
  ].filter(Boolean);
  trace('PLAN: active ' + String(initial.active) + ' → ' + String(row.bitrixActive) +
    (needsActive ? ' (изменить)' : ' (совпадает)') +
    '; picture ' + (initialMedia ?? 'нет') +
    (needsPicture ? ' (загрузить)' : ' (без загрузки)') +
    '; volume Strapi=' + (initialVolume?.documentId ?? 'нет') +
    (sourceValue ? ' (' + sourceValue + ')' : '') +
    ', Bitrix=' + row.bitrixVolumeStatus + ':' + row.bitrixVolumeValue +
    ', действие=' + (volumeAction?.type ?? 'нет'));
  if (volumeReviewMessage) trace('MANUAL_VOLUME: ' + volumeReviewMessage);
  if (VERBOSE) trace('PLAN_FIELDS: ' + (planned.join(', ') || 'нет изменений'));

  if (!planned.length) return {
    ...base,
    status: volumeReviewMessage ? 'review' : 'skipped_already',
    changes: '', published: false,
    message: volumeReviewMessage || 'Текущие значения уже совпадают с Bitrix'
  };
  if (!APPLY) return {
    ...base, status: 'dry_run', changes: planned.join('|'),
    published: false, message: 'Только план; изменений нет'
  };

  // При повторном чтении подтверждаем и поля, и live relation.
  trace('VERIFY_BEFORE_SAVE: повторное чтение Attribute и Volume');
  const [fresh, freshVolume] = await Promise.all([
    readStrapi(row.documentId, null, row.barcode),
    readVolumeRelation(row.documentId)
  ]);
  if (snapshot(fresh, freshVolume) !== snapshot(initial, initialVolume)) {
    throw Error('Strapi изменился между чтением и записью, отменено');
  }

  const payload = {};
  if (needsActive) payload.active = row.bitrixActive;
  if (needsPicture) {
    payload.detail_picture = await upload(
      { url: row.pictureUrl }, row.bitrixId, markWrite, trace
    );
    await markMediaUploaded(payload.detail_picture);
  }

  let saved = fresh, savedVolume = freshVolume;
  if (Object.keys(payload).length) {
    // Существующий подтверждённый PUT используем только для active/detail_picture.
    const [beforePut, beforePutVolume] = await Promise.all([
      readStrapi(row.documentId, null, row.barcode),
      readVolumeRelation(row.documentId)
    ]);
    if (snapshot(beforePut, beforePutVolume) !== snapshot(fresh, freshVolume)) {
      throw Error('Strapi изменился до Save: PUT отменён');
    }
    await markWrite('SAVE');
    trace('SAVE: обновляю ' + Object.keys(payload).join(', '));
    try {
      await http(strapiUrl(withLocale(row.documentId)), {
        method: 'PUT',
        headers: { ...sHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      throw Error('Save: результат неопределён, требуется проверка Strapi: ' + e.message);
    }
    [saved, savedVolume] = await Promise.all([
      readStrapi(row.documentId, null, row.barcode),
      readVolumeRelation(row.documentId)
    ]);
    if ((needsActive && saved.active !== row.bitrixActive) ||
        (needsPicture && mediaId(saved.detail_picture) !== payload.detail_picture) ||
        (savedVolume?.documentId ?? '') !== (initialVolume?.documentId ?? '')) {
      throw Error('Save выполнен, но не подтвердились active/Media/Volume');
    }
    if (!needsActive && saved.active !== initial.active) {
      throw Error('Save изменил active без запроса');
    }
    if (!needsPicture && mediaId(saved.detail_picture) !== initialMedia) {
      throw Error('Save изменил существующую Media без запроса');
    }
    trace('SAVE_VERIFIED: active/Media проверены, Volume сохранён');
  }

  const [beforePublish, beforeVolume] = await Promise.all([
    readStrapi(row.documentId, null, row.barcode),
    readVolumeRelation(row.documentId)
  ]);
  if (snapshot(beforePublish, beforeVolume) !== snapshot(saved, savedVolume)) {
    throw Error('Strapi изменился перед Publish; запись отменена');
  }

  // Именно POST Publish с full-body relation connect/disconnect подтверждён
  // Network от 2026-11-09. Для active/media без Volume оставляем старый {}.
  const publishBody = volumeAction
    ? publishWithVolumePayload(beforePublish, volumeAction)
    : {};
  const publishPath = '/content-manager/collection-types/' + UID + '/' +
    encodeURIComponent(row.documentId) + '/actions/publish?locale=' + CFG.locale;
  await markWrite('PUBLISH');
  trace('PUBLISH: ' + (volumeAction
    ? 'volume ' + volumeAction.type + ' через подтверждённый connect/disconnect'
    : 'только active/Media'));
  try {
    await http(strapiUrl(publishPath), {
      method: 'POST',
      headers: { ...sHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(publishBody)
    });
  } catch (e) {
    throw Error('Publish: исход неопределён, проверь Strapi перед повтором: ' + e.message);
  }

  const [published, publishedVolume] = await Promise.all([
    readStrapi(row.documentId, 'published', row.barcode),
    readVolumeRelation(row.documentId)
  ]);
  const expectedVolumeDocId = volumeAction
    ? volumeAction.target?.documentId ?? ''
    : initialVolume?.documentId ?? '';
  if (!published.publishedAt || Number.isNaN(Date.parse(published.publishedAt)) ||
      published.active !== (needsActive ? row.bitrixActive : initial.active) ||
      mediaId(published.detail_picture) !== (needsPicture ? payload.detail_picture : initialMedia) ||
      (publishedVolume?.documentId ?? '') !== expectedVolumeDocId) {
    throw Error('Publish выполнен, но проверка ru active/Media/Volume не прошла');
  }
  trace('PUBLISH_VERIFIED: ru active, Media, Volume подтверждены');
  return {
    ...base, status: volumeReviewMessage ? 'review' : 'done',
    changes: planned.join('|'), volumeAction: volumeAction?.type ?? base.volumeAction,
    pictureStrapi: mediaId(published.detail_picture) ?? '',
    published: true,
    message: volumeReviewMessage || 'Save/Publish подтверждены в ru, Volume сверён'
  };
}

// Статистика собирается из текущих результатов + checkpoint, а не только из этой сессии.
// Поэтому после перезапуска обработанные записи не начинают счётчик заново.
function getProgress(selected, items) {
  const stats = {
    processed: 0, updated: 0, unchanged: 0, uploaded: 0,
    unmatched: 0, errors: 0, review: 0, planned: 0
  };
  for (const row of selected) {
    const item = items.get(row.documentId);
    if (!item) continue;
    const status = item.status;
    if (['done', 'skipped_already', 'unmatched', 'review'].includes(status) ||
        (status === 'error' && !(APPLY && RETRY_ERRORS)) ||
        (status === 'dry_run' && !APPLY)) stats.processed++;
    if (status === 'done') stats.updated++;
    else if (status === 'skipped_already') stats.unchanged++;
    else if (status === 'unmatched') stats.unmatched++;
    else if (status === 'error') stats.errors++;
    else if (status === 'review') stats.review++;
    else if (status === 'dry_run') stats.planned++;
    // Совместимость с журналами до появления отдельного Media-счётчика.
    if (item.uploadedMediaId > 0 ||
        (status === 'done' && String(item.changes ?? '').split('|').includes('detail_picture'))) {
      stats.uploaded++;
    }
  }
  return stats;
}
function formatSeconds(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const secs = Math.round(ms / 1000);
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  const seconds = secs % 60;
  if (days) return days + 'д ' + hours + 'ч ' + mins + 'м';
  if (hours) return hours + 'ч ' + mins + 'м';
  if (mins) return mins + 'м ' + seconds + 'с';
  return seconds + 'с';
}
const count = n => Number(n).toLocaleString('ru-RU');
// После каждого RESULT показываем счётчик без пересчёта всех строк CSV.
// Полная сводка и прогресс-бар строятся только при старте, каждые 100 записей
// и в конце. Скорость/ETA считают только работу текущего запуска, без checkpoint.
function progressMetrics(total, completed, attempted, startedAt) {
  const elapsed = Math.max(0, Date.now() - startedAt);
  const fraction = total ? Math.min(1, completed / total) : 1;
  const rate = attempted > 0 && elapsed > 0 ? attempted * 1000 / elapsed : 0;
  const remaining = Math.max(0, total - completed);
  const width = Math.round(fraction * 24);
  return {
    percent: (fraction * 100).toFixed(1) + '%',
    bar: '[' + '#'.repeat(width) + '.'.repeat(24 - width) + ']',
    speed: rate ? (rate < 0.1 ? rate.toFixed(2) : rate.toFixed(1)) : '—',
    eta: remaining === 0 ? '0с' : rate ? formatSeconds(remaining / rate * 1000) : '—',
    elapsed: formatSeconds(elapsed)
  };
}
function showProgress(selected, items, completed, attempted, startedAt) {
  const stats = getProgress(selected, items);
  const p = progressMetrics(selected.length, completed, attempted, startedAt);
  log(APPLY ? 'APPLY' : 'DRY-RUN', p.bar, p.percent,
    count(completed) + '/' + count(selected.length),
    '| за запуск', count(attempted),
    '| скорость', p.speed, 'зап/сек',
    '| прошло', p.elapsed, '| осталось ~', p.eta);
  log(APPLY ? 'Обновлено ' + count(stats.updated) : 'В плане ' + count(stats.planned),
    '| Без изменений', count(stats.unchanged),
    '| Загружено картинок', count(stats.uploaded),
    '| Без пары', count(stats.unmatched),
    '| Ошибок', count(stats.errors),
    '| Проверить вручную', count(stats.review));
  return stats;
}

async function main() {
  const missing = Object.entries(AUTH).filter(([,v]) =>
    !v || ['ВСТАВЬ_', 'PASTE_', '__LOCAL_'].some(prefix => v.startsWith(prefix)));
  if (missing.length && !PROBE_MEDIA) {
    throw Error('В локальной копии заполни AUTH: ' + missing.map(([k])=>k).join(', '));
  }
  log('Версия:', BUILD, '| записываю Volume только через подтверждённый POST Publish');
  const { rows, hash } = await inputRows();
  if (PROBE_MEDIA) {
    // Ровно один публичный GET Media из CSV, без чтения Bitrix Admin и без Strapi POST/PUT.
    const row = rows.find(item => item.documentId === ONLY);
    if (!row?.pictureUrl) throw Error('--only: в CSV для этой записи нет pictureUrl');
    log('PROBE_MEDIA: проверяю публичную картинку без Cookie, Strapi не изменяется:', row.documentId);
    const { buf, mime } = await downloadOriginal({ url: row.pictureUrl }, log);
    log('PROBE_MEDIA_OK: тип', mime.type, '| байт', buf.length,
      '| Bitrix ID', row.bitrixId, '| Strapi не менялся.');
    return;
  }
  // Загружаем весь справочник до первой записи: никакого угадывания Volume ID.
  const catalog = await readVolumeCatalog();
  const journal = await readJournal(hash);
  const reportPath = resolve(APPLY ? 'attributes-import-report.csv' : 'attributes-import-plan.csv');
  const manualPath = resolve('attributes-import-volume-review.csv');
  const items = APPLY ? journal.items : new Map();
  // --limit=N выбирает не более N ещё не обработанных строк в порядке CSV.
  // После пилота checkpoint сохранится; массовый запуск с тем же CSV продолжит.
  const eligible = rows.filter(row => (!ONLY || row.documentId === ONLY));
  const selected = LIMIT === null ? eligible : eligible.filter(row => {
    const old = journal.items.get(row.documentId);
    return !(APPLY && old && (['done','skipped_already','unmatched','review'].includes(old.status) ||
      (old.status === 'error' && !RETRY_ERRORS)));
  }).slice(0, LIMIT);
  const totalPictures = selected.filter(row => Boolean(row.pictureUrl)).length;
  const startedAt = Date.now();
  let requestedStop = false;
  process.on('SIGINT', () => {
    requestedStop = true;
    log('Ctrl+C: завершу текущую запись, затем сохраню отчёт');
  });
  log(APPLY ? 'APPLY' : 'DRY-RUN', 'строк для обработки:', selected.length,
    '| с публичным Media URL:', totalPictures, '| пауза:', PAUSE_MS + 'ms');
  log('Volume: known=', selected.filter(r => r.bitrixVolumeStatus === 'known').length,
    '| empty=', selected.filter(r => r.bitrixVolumeStatus === 'empty').length,
    '| manual=', selected.filter(r => r.bitrixVolumeStatus === 'manual').length);
  if (APPLY && LIMIT === null && ONLY === null) {
    log('Внимание: массовая запись всех кандидатов; Ctrl+C завершит текущую запись.');
  }
  let attempted = 0;
  const alreadyCompleted = getProgress(selected, items).processed;
  showProgress(selected, items, alreadyCompleted, attempted, startedAt);
  for (const [index, row] of selected.entries()) {
    if (requestedStop) break;
    const old = items.get(row.documentId);
    // Сомнительный исход записи нельзя повторять автоматически.
    const prefix = '[' + (index + 1) + '/' + selected.length + '] ' +
      (row.bitrixId || 'без Bitrix ID') + ' → ' + row.documentId + ':';
    const trace = (...message) => log(prefix, ...message);
    if (APPLY && old && (['done','skipped_already','unmatched','review'].includes(old.status) ||
      (old.status === 'error' && !RETRY_ERRORS))) {
      trace('SKIP_CHECKPOINT: статус ' + old.status + '; повторная запись не выполняется');
      continue;
    }
    if (attempted && PAUSE_MS > 0) await sleep(PAUSE_MS);
    trace('START: ' + (APPLY ? 'APPLY' : 'DRY-RUN'));
    attempted++;
    const item = {
      status: 'running', phase: 'READ', attempts: (old?.attempts ?? 0) + 1,
      updatedAt: new Date().toISOString()
    };
    if (APPLY) await journal.save(row.documentId, item);
    let writeStarted = false;
    const markWrite = async phase => {
      writeStarted = true;
      item.phase = phase;
      item.status = 'review';
      item.message = 'Операция записи могла выполниться; проверить вручную';
      if (APPLY) await journal.save(row.documentId, item);
    };
    const markMediaUploaded = async mediaId => {
      item.uploadedMediaId = mediaId;
      if (APPLY) await journal.save(row.documentId, item);
    };
    try {
      const result = await migrateOne(row, catalog, markWrite, markMediaUploaded, trace);
      Object.assign(item, result, {
        phase: 'COMPLETE', updatedAt: new Date().toISOString()
      });
      trace('RESULT: ' + result.status +
        (result.changes ? '; изменения: ' + result.changes : '; изменений нет') +
        '; ' + result.message);
    } catch (e) {
      Object.assign(item, { status: writeStarted ? 'review' : 'error',
        message: e.message, updatedAt: new Date().toISOString() });
      console.error(LOG, prefix, 'ERROR (' + item.status + '):', item.message);
      if (writeStarted || e.code === 'BITRIX_BLOCKED' || e.code === 'STRAPI_BLOCKED') {
        requestedStop = true;
        console.error(LOG, 'STOP: операция записи могла выполниться либо доступ ограничен. ' +
          'Состояние этого Attribute нужно проверить вручную. ' +
          'Журнал и отчёт сохраняются; остальные записи не затрагиваются.');
      }
    }
    if (APPLY) await journal.save(row.documentId, item);
    else items.set(row.documentId, item);
    const completed = Math.min(selected.length, alreadyCompleted + attempted);
    const progress = progressMetrics(selected.length, completed, attempted, startedAt);
    trace('СЧЁТЧИК: обработано ' + count(completed) + '/' + count(selected.length) +
      ' (' + progress.percent + ')' +
      ' | за запуск ' + count(attempted) +
      ' | скорость ' + progress.speed + ' зап/сек' +
      ' | осталось ~ ' + progress.eta);
    if (attempted % 100 === 0) {
      showProgress(selected, items, completed, attempted, startedAt);
    }
    if (attempted % 100 === 0 || attempted === selected.length) {
      // Полный CSV пересоздаём раз в 100 записей, а не после каждой:
      // на больших входных файлах это устраняет квадратичные дисковые записи.
      await atomicWrite(reportPath, reportCsv(rows, items));
      await atomicWrite(manualPath, volumeManualCsv(rows, items));
    }
  }
  await atomicWrite(reportPath, reportCsv(rows, items));
  await atomicWrite(manualPath, volumeManualCsv(rows, items));
  const completed = Math.min(selected.length, alreadyCompleted + attempted);
  const summary = showProgress(selected, items, completed, attempted, startedAt);
  log('Итог:', count(completed) + '/' + count(selected.length),
    '| затрачено', formatSeconds(Date.now() - startedAt), '| отчёт:', reportPath,
    '| ручная проверка Volume:', manualPath);
  if (APPLY) log('Журнал:', journal.path, '| повтор с тем же CSV продолжит обработку');
  if (summary.errors || summary.review) process.exitCode = 1;
}
main().catch(e => { console.error('[Attributes importer] STOP:', e.message); process.exitCode = 1; });