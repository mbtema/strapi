// Attributes: Bitrix IBLOCK_ID=2 -> Strapi api::attribute.attribute (locale=ru).
// Node.js 20+; npm install cheerio. По умолчанию read-only dry-run; --apply записывает.
// Рабочие CSV, журнал и отчёты — на рабочем столе Windows.
// Перед --apply необходима проверка HTML реальной карточки предложения Bitrix.
import * as cheerio from 'cheerio';
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
  pauseMs: 0
};
const AUTH = {
  jwtToken: 'ВСТАВЬ_JWT_STRAPI',
  bitrixCookies: 'ВСТАВЬ_COOKIE_BITRIX'
};
const DESKTOP = resolve(process.env.USERPROFILE || homedir(), 'Desktop');
process.chdir(DESKTOP);

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const VERBOSE = args.includes('--verbose');
const RETRY_ERRORS = args.includes('--retry-errors');
const PROBE_MEDIA = args.includes('--probe-media');
const ONLY = args.find(x => x.startsWith('--only='))?.slice(7) ?? null;
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
      !/^--pause-ms=\d+$/.test(arg)) throw Error('Неизвестный параметр: ' + arg);
}
const LOG = '[Attributes importer]';
const log = (...v) => console.log(LOG, ...v);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UID = 'api::attribute.attribute';
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

function validatedCardUrl(value) {
  let u;
  try { u = new URL(value); } catch { throw Error('Некорректный bitrixUrl'); }
  const root = new URL(CFG.bitrix);
  if (u.origin !== root.origin || u.username || u.password ||
      u.pathname !== '/bitrix/admin/iblock_element_edit.php' ||
      u.searchParams.get('IBLOCK_ID') !== '2' ||
      u.searchParams.get('type') !== 'catalog' ||
      u.searchParams.get('lang') !== CFG.locale ||
      !/^\d+$/.test(u.searchParams.get('ID') ?? '') ||
      u.searchParams.has('action')) {
    throw Error('bitrixUrl ведёт не на карточку предложения IBLOCK_ID=2');
  }
  return { url: u.href, id: u.searchParams.get('ID') };
}

async function inputRows() {
  const raw = await readFile(resolve(CFG.input), 'utf8');
  const lines = parseCsv(raw);
  const fields = lines.shift();
  if (fields?.join(';') !== 'documentId;barcode;bitrixUrl' || !lines.length) {
    throw Error('Ожидается attributes-matched.csv: documentId;barcode;bitrixUrl');
  }
  const docIds = new Set(), bitrixIds = new Set();
  const rows = lines.map((cells, idx) => {
    if (cells.length !== 3) throw Error('CSV строка ' + (idx + 2) + ': число колонок');
    const [documentId, barcode, bitrixUrl] = cells;
    if (!/^[a-z0-9]+$/i.test(documentId) || docIds.has(documentId)) {
      throw Error('CSV строка ' + (idx + 2) + ': пустой/повторный documentId');
    }
    docIds.add(documentId);
    if (!bitrixUrl) return { documentId, barcode, bitrixUrl: '', bitrixId: '' };
    if (!barcode || barcode !== barcode.trim()) {
      throw Error('CSV строка ' + (idx + 2) + ': неверный barcode');
    }
    const card = validatedCardUrl(bitrixUrl);
    if (bitrixIds.has(card.id)) throw Error('CSV повторный Bitrix ID: ' + card.id);
    bitrixIds.add(card.id);
    return { documentId, barcode, bitrixUrl: card.url, bitrixId: card.id };
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
    if (!response.ok) throw Error(method + ' ' + new URL(url).pathname +
      ': HTTP ' + response.status);
    return response;
  }
}
const sHeaders = () => ({ Authorization: 'Bearer ' + AUTH.jwtToken, Accept: 'application/json' });
const bHeaders = () => ({
  Cookie: AUTH.bitrixCookies,
  Accept: 'text/html',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143.0 Safari/537.36'
});
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
function snapshot(item) {
  return JSON.stringify({
    active: item.active,
    detail_picture: mediaId(item.detail_picture),
    updatedAt: item.updatedAt ?? null,
    publishedAt: item.publishedAt ?? null
  });
}

// Ищем файл по реальному fileId Bitrix + real_url оригинала (не resize_cache).
function prop(source, key) {
  const re = new RegExp("(?:['\\\"]" + key + "['\\\"]|\\b" + key + "\\b)\\s*:\\s*" +
    "(?:'((?:\\\\.|[^'\\\\])*)'|\"((?:\\\\.|[^\"\\\\])*)\"|(\\d+))");
  const m = source.match(re);
  return m ? String(m[1] ?? m[2] ?? m[3])
    .replace(/\\u002f/gi, '/').replace(/\\\//g, '/').replace(/\\(['"\\])/g, '$1') : null;
}
function imageFrom(text, id) {
  if (!/^\d+$/.test(id)) return null;
  const objects = text.replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .match(/\{[^{}]{0,10000}\}/g) ?? [];
  for (const obj of objects) {
    if (prop(obj, 'fileId') !== id) continue;
    const raw = prop(obj, 'real_url');
    if (!raw) continue;
    let url;
    try { url = new URL(raw, CFG.bitrix); } catch { continue; }
    if (url.origin !== new URL(CFG.bitrix).origin ||
        !url.pathname.startsWith('/upload/iblock/') ||
        url.pathname.includes('/resize_cache/')) continue;
    return { fileId: id, url: url.href };
  }
  return null;
}

function parseBitrix(html, expectedBarcode, expectedId) {
  const $ = cheerio.load(html);
  if (typeof $('input[name="NAME"]').first().val() !== 'string') {
    throw Error('Bitrix вернул не карточку предложения (нет NAME)');
  }
  // В реальной форме Bitrix есть hidden ID. Проверяем саму карточку, а не только URL.
  const elementIds = $('input[type="hidden"][name="ID"]').toArray()
    .map(el => String($(el).val() ?? '').trim());
  if (elementIds.length !== 1 || elementIds[0] !== expectedId) {
    throw Error('Bitrix ID карточки не совпадает с ID из matcher: ' + expectedId);
  }
  // Подтверждение актуального barcode обязательно перед записью. Неподтверждённая
  // разметка карточки -> ошибка чтения, а НЕ разрешение на импорт.
  const barcodeInputs = $('input[name],textarea[name]').toArray().filter(el => {
    const name = $(el).attr('name') ?? '';
    return /^PROP\[19\]\[/.test(name) ||
      /^FIELDS\[\d+\]\[PROPERTY_19\]\[/.test(name);
  }).map(el => String($(el).val() ?? '').trim()).filter(Boolean);
  const barcodes = [...new Set(barcodeInputs)];
  if (barcodes.length !== 1 || barcodes[0] !== expectedBarcode) {
    throw Error('Bitrix barcode не подтверждён: найдено ' + barcodes.length +
      ' значений, ожидается точное ' + expectedBarcode);
  }
  const active = $('input[type="checkbox"][name="ACTIVE"]');
  if (active.length !== 1) throw Error('Bitrix: невозможно определить ACTIVE (нет единственного checkbox)');
  const pictureRow = $('#tr_DETAIL_PICTURE');
  if (pictureRow.length !== 1) throw Error('Bitrix: нет строки DETAIL_PICTURE');
  const ids = pictureRow.find('input[type="hidden"][name="DETAIL_PICTURE"]')
    .toArray().map(el => String($(el).val() ?? '').trim()).filter(x => x && x !== '0');
  if (ids.length > 1 || ids.some(id => !/^\d+$/.test(id))) {
    throw Error('Bitrix: неоднозначный DETAIL_PICTURE fileId');
  }
  let picture = null;
  if (ids.length) {
    const sources = [$.html(pictureRow)];
    $('script').each((_, el) => {
      const script = $(el).html() ?? '';
      if (script.includes(ids[0])) sources.push(script);
    });
    picture = sources.map(text => imageFrom(text, ids[0])).find(Boolean);
    if (!picture) throw Error('Bitrix DETAIL_PICTURE существует (fileId=' +
      ids[0] + '), но URL оригинала не подтверждён');
  }
  return { active: active.is(':checked'), picture };
}

async function readBitrix(row) {
  const html = await (await http(row.bitrixUrl, { headers: bHeaders() }, true)).text();
  try {
    return parseBitrix(html, row.barcode, row.bitrixId);
  } catch (e) {
    if (e.message.includes('Bitrix вернул не карточку предложения')) {
      throw bitrixBlocked('Bitrix вернул не карточку предложения (возможно, сессия истекла). ' +
        'Импорт остановлен, проверь авторизацию.');
    }
    throw e;
  }
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

const REPORT = ['documentId','barcode','bitrixUrl','status','activeStrapi',
  'activeBitrix','pictureStrapi','pictureBitrix','changes','published','phase','message'];
function reportCsv(rows, items) {
  return '\uFEFF' + [
    REPORT.join(';'),
    ...rows.map(row => {
      const result = items.get(row.documentId) ?? { status: row.bitrixUrl ? 'pending' : 'unmatched' };
      return REPORT.map(field => quote(Object.hasOwn(result, field) ? result[field] : row[field])).join(';');
    })
  ].join('\r\n');
}

async function downloadOriginal(image, trace) {
  const url = new URL(image.url);
  if (url.origin !== new URL(CFG.bitrix).origin ||
      !url.pathname.startsWith('/upload/iblock/') ||
      url.pathname.includes('/resize_cache/')) {
    throw Error('Небезопасный URL оригинала изображения');
  }
  trace('MEDIA_DOWNLOAD_PUBLIC: GET оригинала без Cookie Bitrix, fileId=' + image.fileId);
  // Без retry: если сервер ограничивает доступ, не увеличиваем нагрузку.
  const response = await http(url.href, { headers: publicImageHeaders() });
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
  const filename = 'bitrix-attribute-' + bitrixId + '-detail-' + image.fileId + '.' + mime.ext;
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

async function migrateOne(row, markWrite, markMediaUploaded, trace) {
  if (!row.bitrixUrl) return { status: 'unmatched', changes: '', published: false,
    message: 'Для этого barcode Bitrix URL отсутствует' };
  trace('READ: проверяю Strapi и карточку Bitrix');
  const [initial, bitrix] = await Promise.all([readStrapi(row.documentId, null, row.barcode), readBitrix(row)]);
  const initialMedia = mediaId(initial.detail_picture);
  const needsActive = initial.active !== bitrix.active;
  const needsPicture = initialMedia === null && !!bitrix.picture;
  const base = {
    activeStrapi: String(initial.active),
    activeBitrix: String(bitrix.active),
    pictureStrapi: initialMedia ?? '',
    pictureBitrix: bitrix.picture?.fileId ?? ''
  };
  const planned = [needsActive ? 'active' : '', needsPicture ? 'detail_picture' : '']
    .filter(Boolean);
  const activeLabel = value => value === null ? 'null' : String(value);
  trace('PLAN: active ' + activeLabel(initial.active) + ' → ' + activeLabel(bitrix.active) +
    (needsActive ? ' (изменить)' : ' (совпадает)') +
    '; detail_picture Strapi=' + (initialMedia ?? 'пусто') +
    ', Bitrix=' + (bitrix.picture?.fileId ?? 'пусто') +
    (needsPicture ? ' (загрузить)' : ' (без загрузки)'));
  if (VERBOSE) trace('PLAN_FIELDS: ' + (planned.join(', ') || 'нет изменений'));

  if (!planned.length) return { ...base, status: 'skipped_already',
    changes: '', published: false, message: 'Активность совпадает; существующее изображение не меняем' };
  if (!APPLY) return { ...base, status: 'dry_run', changes: planned.join('|'),
    published: false, message: 'План составлен, запись не выполнена' };

  trace('VERIFY_BEFORE_SAVE: перепроверяю актуальность Strapi');
  const fresh = await readStrapi(row.documentId, null, row.barcode);
  if (snapshot(fresh) !== snapshot(initial)) {
    throw Error('Strapi изменился между чтением и записью, отменено');
  }

  const payload = {};
  if (needsActive) payload.active = bitrix.active;
  if (needsPicture) {
    payload.detail_picture = await upload(bitrix.picture, row.bitrixId, markWrite, trace);
    // Upload подтверждён: сохраняем Media ID в журнале даже если позже Save/Publish не пройдут.
    await markMediaUploaded(payload.detail_picture);
  }
  const beforePut = await readStrapi(row.documentId, null, row.barcode);
  if (snapshot(beforePut) !== snapshot(fresh)) {
    throw Error('Strapi изменился до сохранения, PUT отменён (загруженную Media нужно проверить)');
  }

  await markWrite('SAVE');
  trace('SAVE: отправляю ' + Object.keys(payload).join(', ') + ' в Strapi');
  try {
    await http(strapiUrl(withLocale(row.documentId)), {
      method: 'PUT',
      headers: { ...sHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    throw Error('PUT: результат неопределён, требуется проверка Strapi: ' + e.message);
  }
  const saved = await readStrapi(row.documentId, null, row.barcode);
  if ((needsActive && saved.active !== bitrix.active) ||
      (needsPicture && mediaId(saved.detail_picture) !== payload.detail_picture)) {
    throw Error('Save выполнен, но проверка контента не прошла');
  }
  if (!needsActive && saved.active !== initial.active) {
    throw Error('Save неожиданно изменил active');
  }
  if (!needsPicture && mediaId(saved.detail_picture) !== initialMedia) {
    throw Error('Save неожиданно изменил существующее изображение');
  }
  trace('SAVE_VERIFIED: изменения сохранены и проверены');

  const beforePublish = await readStrapi(row.documentId, null, row.barcode);
  if (snapshot(beforePublish) !== snapshot(saved)) {
    throw Error('Strapi изменился перед Publish, отменено');
  }
  trace('VERIFY_BEFORE_PUBLISH: состояние Strapi не изменилось');
  const publishPath = '/content-manager/collection-types/' + UID + '/' +
    encodeURIComponent(row.documentId) + '/actions/publish?locale=' + CFG.locale;
  await markWrite('PUBLISH');
  trace('PUBLISH: публикую локаль ' + CFG.locale);
  try {
    await http(strapiUrl(publishPath), {
      method: 'POST',
      headers: { ...sHeaders(), 'Content-Type': 'application/json' },
      body: '{}'
    });
  } catch (e) {
    throw Error('Publish: результат неопределён, требуется проверка Strapi: ' + e.message);
  }
  const published = await readStrapi(row.documentId, 'published', row.barcode);
  if (!published.publishedAt || Number.isNaN(Date.parse(published.publishedAt)) ||
      published.active !== saved.active ||
      mediaId(published.detail_picture) !== mediaId(saved.detail_picture)) {
    throw Error('Publish отправлен, но опубликованная ru-версия не совпадает с сохранённой');
  }
  trace('PUBLISH_VERIFIED: опубликованная ru-версия совпадает с сохранённой');
  return { ...base, status: 'done', changes: planned.join('|'),
    pictureStrapi: mediaId(published.detail_picture) ?? '',
    published: true, message: 'Save и Publish проверены на ru-версии' };
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
  if (missing.length) {
    throw Error('В локальной копии заполни AUTH: ' + missing.map(([k])=>k).join(', '));
  }
  const { rows, hash } = await inputRows();
  if (PROBE_MEDIA) {
    // Ровно одна карточка Bitrix + одно анонимное чтение оригинала, без Strapi POST/PUT.
    const row = rows.find(item => item.documentId === ONLY);
    if (!row?.bitrixUrl) throw Error('--only: нет подходящей карточки Bitrix в CSV');
    log('PROBE_MEDIA: проверяю одну запись, без изменений Strapi:', row.documentId);
    const offer = await readBitrix(row);
    if (!offer.picture) {
      log('PROBE_MEDIA: у выбранного предложения нет detail_picture в Bitrix. Записей нет.');
      return;
    }
    const { buf, mime } = await downloadOriginal(offer.picture, log);
    log('PROBE_MEDIA_OK: публичное изображение доступно без Cookie; тип',
      mime.type, '| байт', buf.length, '| Bitrix fileId', offer.picture.fileId,
      '| Strapi не менялся.');
    return;
  }
  const journal = await readJournal(hash);
  const reportPath = resolve(APPLY ? 'attributes-import-report.csv' : 'attributes-import-plan.csv');
  const items = APPLY ? journal.items : new Map();
  const selected = rows.filter(row => (!ONLY || row.documentId === ONLY));
  const totalMatched = selected.filter(row => row.bitrixUrl).length;
  const startedAt = Date.now();
  let requestedStop = false;
  process.on('SIGINT', () => {
    requestedStop = true;
    log('Ctrl+C: завершу текущую запись, затем сохраню отчёт');
  });
  log(APPLY ? 'APPLY' : 'DRY-RUN', 'строк для обработки:', selected.length,
    '| с URL Bitrix:', totalMatched, '| пауза:', PAUSE_MS + 'ms');
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
      const result = await migrateOne(row, markWrite, markMediaUploaded, trace);
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
      if (e.code === 'BITRIX_BLOCKED') {
        requestedStop = true;
        console.error(LOG, 'STOP: Bitrix ограничил доступ. ' +
          'Не возобновляй массовый импорт до проверки. Checkpoint и отчёт сохраняются.');
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
    }
  }
  await atomicWrite(reportPath, reportCsv(rows, items));
  const completed = Math.min(selected.length, alreadyCompleted + attempted);
  const summary = showProgress(selected, items, completed, attempted, startedAt);
  log('Итог:', count(completed) + '/' + count(selected.length),
    '| затрачено', formatSeconds(Date.now() - startedAt), '| отчёт:', reportPath);
  if (APPLY) log('Журнал:', journal.path, '| повтор с тем же CSV продолжит обработку');
  if (summary.errors || summary.review) process.exitCode = 1;
}
main().catch(e => { console.error('[Attributes importer] STOP:', e.message); process.exitCode = 1; });