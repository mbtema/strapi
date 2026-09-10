// ==NodeMigrator==
// @name         bitrix-detail-picture-migrator
// @version      1.0.1
// @description  Переносит DETAIL_PICTURE из Bitrix audit CSV в Strapi attributes
// @input        bitrix_detail_picture_audit_*.csv
// @output       checkpoint JSON + migration result CSV
// @run          Node.js 18+
// ==/NodeMigrator==

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const VERSION = '1.0.1';
const BASE_URL = (process.env.STRAPI_BASE_URL || 'http://10.10.3.80:1337').replace(/\/$/, '');
const LOCALE = process.env.STRAPI_LOCALE || 'ru';
const JWT = process.env.STRAPI_JWT || '';
const REQUEST_DELAY_MS = Number(process.env.MIGRATION_DELAY_MS || 100);
const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_BYTES || 30 * 1024 * 1024);
const VERIFY_ATTEMPTS = 5;
const VERIFY_DELAY_MS = 750;

const args = process.argv.slice(2);
const argValue = name => {
  const prefix = `--${name}=`;
  const item = args.find(arg => arg.startsWith(prefix));
  return item ? item.slice(prefix.length) : '';
};
const positional = args.find(arg => !arg.startsWith('--')) || '';
const LIMIT = Number(argValue('limit') || 0);
const ONLY_BARCODE = argValue('barcode').trim();

let stopRequested = false;
process.on('SIGINT', () => {
  if (stopRequested) {
    console.error('\n[Migration] Повторный Ctrl+C — аварийная остановка.');
    process.exit(130);
  }
  stopRequested = true;
  console.warn('\n[Migration] Остановка запрошена. Текущая операция завершится, checkpoint сохранится.');
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function timestamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        value += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ';') {
      row.push(value);
      value = '';
    } else if (ch === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += ch;
    }
  }

  if (value.length || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }

  return rows.filter(columns => columns.some(column => column !== ''));
}

function csvQuote(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function rowsToObjects(parsed) {
  if (parsed.length < 2) throw new Error('CSV пустой.');
  const headers = parsed[0].map(value => value.trim());
  const required = ['documentId', 'barcode', 'productDocumentId', 'imageUrl', 'status'];
  const missing = required.filter(name => !headers.includes(name));
  if (missing.length) throw new Error(`В CSV нет обязательных колонок: ${missing.join(', ')}`);

  return {
    headers,
    rows: parsed.slice(1).map((columns, index) => {
      const item = { __sourceIndex: index };
      headers.forEach((header, i) => { item[header] = (columns[i] ?? '').trim(); });
      return item;
    })
  };
}

function findAuditFile() {
  if (positional) return path.resolve(positional);

  const candidates = [];
  const dirs = [process.cwd(), path.join(os.homedir(), 'Downloads')];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!/^bitrix_detail_picture_audit_.*\.csv$/i.test(name)) continue;
      const fullPath = path.join(dir, name);
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) candidates.push({ fullPath, mtimeMs: stat.mtimeMs });
    }
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!candidates.length) {
    throw new Error('Не найден bitrix_detail_picture_audit_*.csv. Передай путь первым аргументом.');
  }
  return candidates[0].fullPath;
}

function unwrapItem(item) {
  if (!item || typeof item !== 'object') return item;
  if (item.attributes && typeof item.attributes === 'object') {
    return {
      id: item.id,
      documentId: item.documentId ?? item.attributes.documentId,
      ...item.attributes
    };
  }
  return item;
}

function unwrapRelation(value) {
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'data')) {
    return value.data;
  }
  return value;
}

function hasDetailPicture(item) {
  const relation = unwrapRelation(item?.detail_picture);
  return Array.isArray(relation) ? relation.length > 0 : Boolean(relation);
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return { text: '', json: null };
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: null };
  }
}

async function fetchSafe(url, options = {}, { retries = 2, label = 'request' } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;

      const { text } = await readBody(response);
      const error = new Error(`${label}: HTTP ${response.status}${text ? ` — ${text.slice(0, 300)}` : ''}`);
      error.httpStatus = response.status;

      if (response.status < 500 && response.status !== 429) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (error.httpStatus && error.httpStatus < 500 && error.httpStatus !== 429) throw error;
    }

    if (attempt < retries) await sleep(500 * (attempt + 1));
  }

  throw lastError;
}

async function findAttributeByDocumentId(row) {
  const params = new URLSearchParams({
    'filters[documentId][$eq]': row.documentId,
    'pagination[pageSize]': '2',
    'fields[0]': 'documentId',
    'fields[1]': 'barcode',
    'populate[detail_picture]': 'true',
    'locale': LOCALE
  });

  const response = await fetchSafe(
    `${BASE_URL}/api/attributes?${params}`,
    { headers: { Accept: 'application/json' } },
    { retries: 3, label: `attribute ${row.documentId}` }
  );
  const { json } = await readBody(response);
  const data = Array.isArray(json?.data) ? json.data.map(unwrapItem) : [];

  if (data.length !== 1) {
    throw new Error(`documentId ${row.documentId}: ожидался 1 attribute, найдено ${data.length}`);
  }

  const item = data[0];
  if (String(item.barcode || '') !== row.barcode) {
    throw new Error(
      `documentId ${row.documentId}: barcode Strapi ${item.barcode || '[empty]'} != audit ${row.barcode}`
    );
  }

  return item;
}

function extensionFromContentType(contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/avif': '.avif'
  };
  return map[type] || '';
}

function filenameFromUrl(imageUrl, barcode, contentType) {
  try {
    const url = new URL(imageUrl);
    const base = decodeURIComponent(path.basename(url.pathname)).replace(/[\\/:*?"<>|]/g, '_');
    if (base && base.includes('.')) return base;
  } catch {}
  return `${barcode}${extensionFromContentType(contentType) || '.jpg'}`;
}

async function downloadImage(row) {
  const response = await fetchSafe(
    row.imageUrl,
    { headers: { Accept: 'image/*' } },
    { retries: 3, label: `download ${row.barcode}` }
  );

  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  if (!contentType.toLowerCase().startsWith('image/')) {
    throw new Error(`barcode ${row.barcode}: source вернул не изображение (${contentType})`);
  }

  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength && declaredLength > MAX_IMAGE_BYTES) {
    throw new Error(`barcode ${row.barcode}: изображение больше лимита ${MAX_IMAGE_BYTES} байт`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error(`barcode ${row.barcode}: пустой image response`);
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`barcode ${row.barcode}: изображение больше лимита ${MAX_IMAGE_BYTES} байт`);
  }

  return {
    buffer,
    contentType,
    filename: filenameFromUrl(row.imageUrl, row.barcode, contentType)
  };
}

async function uploadImage(row, image) {
  const form = new FormData();
  const blob = new Blob([image.buffer], { type: image.contentType });

  form.append('files', blob, image.filename);
  form.append('fileInfo', JSON.stringify({
    name: image.filename,
    alternativeText: '',
    caption: ''
  }));

  // POST /upload intentionally has no automatic retry: after a network/5xx failure
  // the server may already have created media, so a blind retry can create duplicates.
  let response;
  try {
    response = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${JWT}`,
        Accept: 'application/json'
      },
      body: form
    });
  } catch (error) {
    error.uploadUncertain = true;
    throw error;
  }

  const body = await readBody(response);
  if (!response.ok) {
    const error = new Error(`upload ${row.barcode}: HTTP ${response.status}${body.text ? ` — ${body.text.slice(0, 300)}` : ''}`);
    // 5xx is treated as uncertain because the upload may have partially succeeded server-side.
    if (response.status >= 500) error.uploadUncertain = true;
    throw error;
  }

  const media = Array.isArray(body.json) ? body.json[0] : body.json;
  if (!media || typeof media !== 'object' || media.id == null) {
    const error = new Error(`upload ${row.barcode}: Strapi не вернул media object с id`);
    error.uploadUncertain = true;
    throw error;
  }
  return media;
}

async function linkDetailPicture(documentId, media) {
  const response = await fetchSafe(
    `${BASE_URL}/content-manager/collection-types/api::attribute.attribute/${encodeURIComponent(documentId)}?locale=${encodeURIComponent(LOCALE)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${JWT}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ detail_picture: media })
    },
    { retries: 2, label: `PUT detail_picture ${documentId}` }
  );
  await readBody(response);
}

async function publishAttribute(documentId) {
  const response = await fetchSafe(
    `${BASE_URL}/content-manager/collection-types/api::attribute.attribute/${encodeURIComponent(documentId)}/actions/publish?locale=${encodeURIComponent(LOCALE)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${JWT}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: '{}'
    },
    { retries: 2, label: `publish ${documentId}` }
  );
  await readBody(response);
}

async function verifyPublished(row) {
  let lastError = '';
  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
    try {
      const item = await findAttributeByDocumentId(row);
      if (String(item.documentId || '') !== row.documentId) {
        throw new Error(`verify ${row.barcode}: documentId ${item.documentId} != audit ${row.documentId}`);
      }
      if (hasDetailPicture(item)) return true;
      lastError = 'detail_picture всё ещё пустой';
    } catch (error) {
      lastError = error.message;
    }
    if (attempt < VERIFY_ATTEMPTS) await sleep(VERIFY_DELAY_MS);
  }
  throw new Error(`verify ${row.barcode}: ${lastError}`);
}

function atomicWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function loadState(statePath, fingerprint, auditPath) {
  if (!fs.existsSync(statePath)) {
    return {
      version: VERSION,
      auditFile: path.basename(auditPath),
      fingerprint,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: {}
    };
  }

  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (state.fingerprint !== fingerprint) {
    throw new Error(`Checkpoint относится к другому содержимому CSV: ${statePath}`);
  }
  state.items ||= {};
  return state;
}

function saveState(statePath, state) {
  state.updatedAt = new Date().toISOString();
  atomicWriteJson(statePath, state);
}

function getItemState(state, row) {
  const key = row.documentId;
  if (!state.items[key]) {
    state.items[key] = {
      barcode: row.barcode,
      stage: 'pending',
      attempts: 0,
      media: null,
      error: '',
      updatedAt: new Date().toISOString()
    };
  }
  return state.items[key];
}

function setStage(itemState, stage, patch = {}) {
  itemState.stage = stage;
  itemState.error = '';
  itemState.updatedAt = new Date().toISOString();
  Object.assign(itemState, patch);
}

function setError(itemState, error) {
  itemState.error = error?.message || String(error);
  itemState.updatedAt = new Date().toISOString();
}

function validateAudit(rows) {
  const okRows = rows.filter(row => row.status === 'ok');
  const duplicate = (key) => {
    const seen = new Set();
    const dup = new Set();
    for (const row of okRows) {
      const value = row[key];
      if (!value) continue;
      if (seen.has(value)) dup.add(value);
      seen.add(value);
    }
    return [...dup];
  };

  const duplicateBarcodes = duplicate('barcode');
  const duplicateDocumentIds = duplicate('documentId');
  const missing = okRows.filter(row => !row.barcode || !row.documentId || !row.imageUrl);

  if (duplicateBarcodes.length || duplicateDocumentIds.length || missing.length) {
    throw new Error(
      `Audit validation failed: duplicate barcode=${duplicateBarcodes.length}, ` +
      `duplicate documentId=${duplicateDocumentIds.length}, incomplete ok rows=${missing.length}`
    );
  }

  return okRows;
}

function writeResultCsv(auditHeaders, rows, state, outputPath) {
  const extra = ['migrationStatus', 'migrationStage', 'mediaId', 'attempts', 'migrationError'];
  const headers = [...auditHeaders, ...extra];
  const lines = [headers.join(';')];

  for (const row of rows) {
    const itemState = state.items[row.documentId];
    let migrationStatus = row.status === 'ok' ? 'pending' : 'audit_skipped';
    let stage = itemState?.stage || '';

    if (itemState?.stage === 'success') migrationStatus = 'success';
    else if (itemState?.stage === 'already_filled') migrationStatus = 'already_filled';
    else if (itemState?.stage === 'upload_uncertain') migrationStatus = 'upload_uncertain';
    else if (itemState?.error) migrationStatus = 'failed';
    else if (row.status === 'ok' && itemState?.stage) migrationStatus = itemState.stage;

    const result = {
      ...row,
      migrationStatus,
      migrationStage: stage,
      mediaId: itemState?.media?.id ?? '',
      attempts: itemState?.attempts ?? '',
      migrationError: itemState?.error ?? ''
    };

    lines.push(headers.map(header => csvQuote(result[header])).join(';'));
  }

  fs.writeFileSync(outputPath, '\uFEFF' + lines.join('\n'), 'utf8');
}

async function processRow(row, itemState, statePath, state) {
  if (itemState.stage === 'upload_uncertain') {
    const reason = itemState.error ? ` Причина: ${itemState.error}` : '';
    throw new Error(
      `предыдущий upload имеет неопределённый результат; строка заблокирована от автоматического повтора.${reason}`
    );
  }

  if (itemState.stage === 'success' || itemState.stage === 'already_filled') return itemState.stage;

  itemState.attempts = (itemState.attempts || 0) + 1;
  itemState.error = '';
  itemState.updatedAt = new Date().toISOString();
  saveState(statePath, state);

  if (itemState.stage === 'pending') {
    const current = await findAttributeByDocumentId(row);
    if (String(current.documentId || '') !== row.documentId) {
      throw new Error(`barcode ${row.barcode}: Strapi documentId ${current.documentId} != audit ${row.documentId}`);
    }

    if (hasDetailPicture(current)) {
      setStage(itemState, 'already_filled');
      saveState(statePath, state);
      return 'already_filled';
    }

    const image = await downloadImage(row);

    let media;
    try {
      media = await uploadImage(row, image);
    } catch (error) {
      if (error.uploadUncertain) {
        setStage(itemState, 'upload_uncertain', { error: error.message });
        saveState(statePath, state);
      }
      throw error;
    }

    setStage(itemState, 'uploaded', { media });
    saveState(statePath, state); // critical: persist media before any next write
  }

  if (itemState.stage === 'uploaded') {
    if (!itemState.media) throw new Error(`barcode ${row.barcode}: checkpoint stage=uploaded, но media отсутствует`);
    await linkDetailPicture(row.documentId, itemState.media);
    setStage(itemState, 'linked');
    saveState(statePath, state);
  }

  if (itemState.stage === 'linked') {
    await publishAttribute(row.documentId);
    setStage(itemState, 'published');
    saveState(statePath, state);
  }

  if (itemState.stage === 'published') {
    await verifyPublished(row);
    setStage(itemState, 'success');
    saveState(statePath, state);
  }

  return itemState.stage;
}

async function main() {
  if (!JWT) {
    throw new Error("Не задан STRAPI_JWT. В PowerShell: $env:STRAPI_JWT = '...' ");
  }

  const auditPath = findAuditFile();
  if (!fs.existsSync(auditPath)) throw new Error(`CSV не найден: ${auditPath}`);

  const raw = fs.readFileSync(auditPath, 'utf8');
  const fingerprint = sha256(raw);
  const { headers, rows } = rowsToObjects(parseCsv(raw));
  let candidates = validateAudit(rows);

  if (ONLY_BARCODE) candidates = candidates.filter(row => row.barcode === ONLY_BARCODE);
  if (LIMIT > 0) candidates = candidates.slice(0, LIMIT);

  const baseName = path.basename(auditPath, path.extname(auditPath));
  const statePath = path.join(path.dirname(auditPath), `${baseName}.migration-state.json`);
  const outputPath = path.join(path.dirname(auditPath), `${baseName}.migration-result_${timestamp()}.csv`);
  const state = loadState(statePath, fingerprint, auditPath);

  const auditCounts = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});

  console.log(`[Bitrix → Strapi Detail Picture Migrator v${VERSION}]`);
  console.log(`CSV: ${auditPath}`);
  console.log(`Strapi: ${BASE_URL} | locale=${LOCALE}`);
  console.log(`Audit rows: ${rows.length} | ok=${auditCounts.ok || 0} | selected=${candidates.length}`);
  console.log(`Checkpoint: ${statePath}`);
  if (LIMIT > 0) console.log(`LIMIT: ${LIMIT}`);
  if (ONLY_BARCODE) console.log(`BARCODE: ${ONLY_BARCODE}`);

  let processedThisRun = 0;
  for (let i = 0; i < candidates.length; i++) {
    if (stopRequested) break;

    const row = candidates[i];
    const itemState = getItemState(state, row);

    if (itemState.stage === 'success' || itemState.stage === 'already_filled') {
      continue;
    }

    processedThisRun++;
    const prefix = `[${i + 1}/${candidates.length}] ${row.barcode}`;

    try {
      const result = await processRow(row, itemState, statePath, state);
      console.log(`${prefix} → ${result}`);
    } catch (error) {
      if (itemState.stage !== 'upload_uncertain') {
        setError(itemState, error);
        saveState(statePath, state);
      }
      console.error(`${prefix} → ERROR: ${error.message}`);
    }

    if (REQUEST_DELAY_MS > 0) await sleep(REQUEST_DELAY_MS);
  }

  writeResultCsv(headers, rows, state, outputPath);

  const candidateStates = candidates.map(row => state.items[row.documentId]).filter(Boolean);
  const summary = candidateStates.reduce((acc, item) => {
    const key = item.stage || 'pending';
    acc[key] = (acc[key] || 0) + 1;
    if (item.error) acc.withError = (acc.withError || 0) + 1;
    return acc;
  }, {});

  console.log('\n[Migration summary]');
  console.table(summary);
  console.log(`Processed this run: ${processedThisRun}`);
  console.log(`Result CSV: ${outputPath}`);
  console.log(`Checkpoint: ${statePath}`);

  const hasProblems = (summary.upload_uncertain || 0) > 0 || (summary.withError || 0) > 0;
  if (hasProblems) process.exitCode = 1;
}

main().catch(error => {
  console.error(`[Migration fatal] ${error.stack || error.message || error}`);
  process.exitCode = 1;
});
