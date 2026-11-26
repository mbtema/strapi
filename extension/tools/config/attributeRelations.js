(async () => {
  'use strict';

  const TAG = '[attributeRelationsConfig]';
  const UID = 'api::attribute.attribute';
  const SYSTEM = new Set([
    'id', 'documentId', 'locale', 'status', 'createdAt', 'updatedAt',
    'publishedAt', 'createdBy', 'updatedBy', 'localizations', '__pivot'
  ]);
  const EXCLUDED = new Set(['price']);
  const SCALARS = new Set([
    'string', 'text', 'richtext', 'email', 'enumeration', 'json', 'blocks',
    'integer', 'biginteger', 'float', 'decimal', 'boolean', 'date',
    'time', 'datetime', 'uid'
  ]);
  let fields = [];
  const CONCURRENCY = 3;
  const PAGE_SIZE = 100;
  const RUN_KEY = '__tmAttributeRelationsConfigRunning';
  if (window[RUN_KEY]) return;
  const designSystem = window.__tmStrapiDesignSystem;
  if (!designSystem?.createToolStatus) throw Error('Обновите расширения через forceUpdate()');
  window[RUN_KEY] = true;

  const report = {
    status: 'running', total: 0, checked: 0, matched: 0,
    ruTotal: 0, kkTotal: 0, pairs: 0, ruOnly: 0, kkOnly: 0, relationFallbacks: 0, detailFallbacks: 0,
    sourceLocale: 'ru', targetLocale: 'kk',
    comparedFields: [], excludedFields: [...EXCLUDED], fieldDifferences: Object.create(null),
    differences: [], blocked: [], requests: 0, errors: []
  };
  window.attributeRelationsConfigReport = report;
  let stopped = false;

  function ensure(value, message) {
    if (!value) throw Error(message);
  }

  function guard() {
    if (stopped) throw Error('Остановлено пользователем');
  }

  function token() {
    let value = localStorage.getItem('jwtToken');
    try { value = JSON.parse(value); } catch {}
    ensure(typeof value === 'string' && value.trim(), 'Нет Admin jwtToken');
    return value.trim().replace(/^Bearer\s+/i, '');
  }

  async function get(path) {
    guard();
    report.requests++;
    const response = await fetch(path, {
      method: 'GET', cache: 'no-store', credentials: 'include',
      headers: { Authorization: 'Bearer ' + token(), Accept: 'application/json' }
    });
    ensure(response.ok, 'HTTP ' + response.status + ': ' + path);
    return response.json();
  }

  function own(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function unwrap(raw) {
    return raw?.attributes && !raw.documentId
      ? { ...raw.attributes, id: raw.id } : raw;
  }

  function validDocumentId(value) {
    return typeof value === 'string' && /^[a-z0-9]+$/i.test(value);
  }

  async function readPages(path, params, validate, expectedCount = null, onPage = () => {}) {
    const rows = [], seen = new Set();
    let total = null, pageCount = null;
    for (let page = 1; page <= 10000; page++) {
      const qs = new URLSearchParams({
        ...params, page: String(page), pageSize: String(PAGE_SIZE)
      });
      const data = await get(path + '?' + qs);
      const p = data?.pagination;
      ensure(Array.isArray(data?.results) &&
        Number.isSafeInteger(p?.total) && p.total >= 0 &&
        Number.isSafeInteger(p?.pageCount) && p.pageCount >= 0 &&
        Number(p.page) === page, 'Неверная пагинация: ' + path);
      if (total === null) {
        total = p.total;
        pageCount = p.pageCount;
      }
      ensure(p.total === total && p.pageCount === pageCount &&
        data.results.length <= PAGE_SIZE &&
        (page >= pageCount || data.results.length > 0),
        'Неполная или изменившаяся пагинация: ' + path);
      for (const raw of data.results) {
        const row = validate(unwrap(raw));
        const id = typeof row === 'string' ? row : row.documentId;
        ensure(validDocumentId(id) && !seen.has(id),
          'Дубль или неверный documentId: ' + path);
        seen.add(id);
        rows.push(row);
      }
      onPage(rows.length, total);
      if (page >= pageCount) break;
      ensure(page < 10000, 'Превышен лимит страниц: ' + path);
    }
    ensure(rows.length === total && (expectedCount === null || expectedCount === total),
      'Неполный набор данных: ' + path);
    return rows;
  }

  async function readSchema() {
    const data = await get('/content-manager/content-types');
    ensure(Array.isArray(data?.data), 'Не удалось прочитать схему CMS');
    const schema = data.data.find(type => type.uid === UID);
    ensure(schema?.attributes && typeof schema.attributes === 'object', 'Нет схемы Attribute');
    fields = Object.entries(schema.attributes).filter(([name]) => !SYSTEM.has(name) && !EXCLUDED.has(name));
    ensure(fields.length > 0, 'Пустая схема Attribute');
    for (const name of ['product', 'shade', 'volume', 'color_variant1C', 'filtry']) {
      ensure(fields.some(([field, def]) => field === name && def.type === 'relation'),
        'Изменилась схема Attribute.' + name);
    }
    for (const [name, def] of fields) {
      ensure(SCALARS.has(def.type) || def.type === 'media' ||
        (def.type === 'relation' && typeof def.target === 'string' &&
          ['oneToOne', 'manyToOne', 'oneToMany', 'manyToMany', 'oneWay', 'manyWay'].includes(def.relation)),
        'Неподдерживаемый тип Attribute.' + name + ': ' + def.type);
    }
    report.comparedFields = fields.map(([name, def]) => ({ name, type: def.type }));
  }

  function singleRelation(def) {
    return ['oneToOne', 'manyToOne', 'oneWay'].includes(def.relation);
  }

  function inlineLinks(raw, present, field, def) {
    if (!present || raw === undefined) return { ids: null, count: null };
    const value = raw && typeof raw === 'object' && own(raw, 'data') ? raw.data : raw;
    if (value === null) return { ids: [], count: 0 };
    if (value && !Array.isArray(value) && typeof value === 'object' && own(value, 'count')) {
      ensure(Number.isSafeInteger(value.count) && value.count >= 0, 'Неверный count: ' + field);
      if (singleRelation(def)) ensure(value.count <= 1, 'Несколько to-one связей: ' + field);
      return { ids: value.count === 0 ? [] : null, count: value.count };
    }
    const items = Array.isArray(value) ? value : [value];
    const ids = items.map(item => unwrap(item)?.documentId);
    if (!ids.every(validDocumentId)) return { ids: null, count: null };
    ensure(new Set(ids).size === ids.length, 'Дубли связей: ' + field);
    if (singleRelation(def)) ensure(ids.length <= 1, 'Несколько to-one связей: ' + field);
    return { ids, count: ids.length };
  }

  function mediaValue(raw, def) {
    const value = raw && typeof raw === 'object' && own(raw, 'data') ? raw.data : raw;
    if (value === null) return def.multiple ? [] : null;
    const idOf = item => Number.isSafeInteger(item) ? item : item?.id;
    if (def.multiple) {
      if (!Array.isArray(value)) return undefined;
      const ids = value.map(idOf);
      return ids.every(id => Number.isSafeInteger(id) && id > 0) ? ids : undefined;
    }
    const id = idOf(value);
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
  }

  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    }
    return value;
  }

  function readValue(raw, def) {
    if (raw === undefined) return undefined;
    if (def.type === 'media') return mediaValue(raw, def);
    return canonical(raw);
  }

  function parseRecord(row) {
    const relations = Object.create(null), values = Object.create(null), missing = [];
    for (const [name, def] of fields) {
      if (def.type === 'relation') {
        relations[name] = inlineLinks(row[name], own(row, name), name, def);
      } else {
        const value = own(row, name) ? readValue(row[name], def) : undefined;
        if (value === undefined) missing.push(name);
        else values[name] = value;
      }
    }
    return { documentId: row.documentId, relations, values, missing };
  }

  async function listAttributes(locale, render) {
    let previousId = 0;
    const params = { locale, status: 'draft', sort: 'id:ASC' };
    for (const [name, def] of fields) {
      if (def.type === 'relation') params['populate[' + name + '][fields][0]'] = 'documentId';
      if (def.type === 'media') params['populate[' + name + '][fields][0]'] = 'id';
    }
    return readPages('/content-manager/collection-types/' + UID, params, row => {
      ensure(row?.locale === locale && Number.isSafeInteger(row.id) && row.id > previousId,
        'Неверная локаль или порядок ' + locale + ' Attribute');
      previousId = row.id;
      ensure(validDocumentId(row.documentId), 'Нет documentId Attribute');
      return parseRecord(row);
    }, null, (loaded, total) => {
      report[locale + 'Total'] = loaded;
      render('Чтение ' + locale.toUpperCase() + ': ' + loaded + '/' + total, '', { loaded, total });
    });
  }

  async function fillMissing(row, locale) {
    if (!row.missing.length) return;
    report.detailFallbacks++;
    const data = await get('/content-manager/collection-types/' + UID + '/' +
      encodeURIComponent(row.documentId) + '?locale=' + locale + '&status=draft');
    const detail = unwrap(data?.data);
    ensure(detail?.documentId === row.documentId && detail.locale === locale,
      'Неверная карточка: ' + row.documentId + '/' + locale);
    for (const name of row.missing) {
      const def = fields.find(([field]) => field === name)[1];
      const value = own(detail, name) ? readValue(detail[name], def) : undefined;
      ensure(value !== undefined, 'Не удалось прочитать ' + row.documentId + '/' + locale + '/' + name);
      row.values[name] = value;
    }
    row.missing = [];
  }

  async function links(row, field, locale, def) {
    const value = row.relations[field];
    if (value.ids !== null) return value.ids;
    report.relationFallbacks++;
    const ids = await readPages('/content-manager/relations/' + UID + '/' +
      encodeURIComponent(row.documentId) + '/' + field, { locale, status: 'draft' }, item => {
      ensure(Number.isSafeInteger(item?.id) && item.id > 0 &&
        validDocumentId(item.documentId), 'Неверная relation: ' + row.documentId + '/' + field);
      return item.documentId;
    }, value.count);
    if (singleRelation(def)) ensure(ids.length <= 1, 'Несколько to-one связей: ' + field);
    return ids;
  }

  function diff(ru, kk) {
    const source = new Set(ru), target = new Set(kk);
    return {
      connect: ru.filter(id => !target.has(id)).sort(),
      disconnect: kk.filter(id => !source.has(id)).sort()
    };
  }

  async function inspect(ru, kk) {
    await fillMissing(ru, 'ru');
    await fillMissing(kk, 'kk');
    const changes = Object.create(null);
    for (const [field, def] of fields) {
      guard();
      if (def.type === 'relation') {
        const source = await links(ru, field, 'ru', def);
        const target = await links(kk, field, 'kk', def);
        const delta = diff(source, target);
        if (delta.connect.length || delta.disconnect.length) changes[field] = delta;
      } else {
        const source = ru.values[field], target = kk.values[field];
        ensure(source !== undefined && target !== undefined,
          'Неполные данные: ' + ru.documentId + '/' + field);
        if (JSON.stringify(source) !== JSON.stringify(target)) {
          changes[field] = { ru: source, kk: target };
        }
      }
    }
    return changes;
  }

  function csv(columns, rows) {
    const cell = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    return '\uFEFF' + [columns.join(','), ...rows.map(row =>
      columns.map(key => cell(row[key])).join(','))].join('\r\n');
  }

  function download(name, content) {
    const href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  function configCsv() {
    return csv(['documentId'], report.differences);
  }

  function blockedCsv() {
    return csv(['documentId', 'reason'], report.blocked);
  }

  async function scan(render) {
    render('Чтение схемы Attribute');
    await readSchema();
    const ru = await listAttributes('ru', render);
    const kk = await listAttributes('kk', render);
    const kkById = new Map(kk.map(row => [row.documentId, row]));
    const ruIds = new Set(ru.map(row => row.documentId));
    const pairs = [];
    for (const row of ru) {
      const target = kkById.get(row.documentId);
      if (target) pairs.push([row, target]);
      else {
        report.ruOnly++;
        report.blocked.push({ documentId: row.documentId, reason: 'Отсутствует KK Attribute' });
      }
    }
    for (const row of kk) {
      if (!ruIds.has(row.documentId)) {
        report.kkOnly++;
        report.blocked.push({ documentId: row.documentId, reason: 'Отсутствует RU Attribute' });
      }
    }
    report.total = pairs.length;
    report.pairs = pairs.length;
    render('Сравнение RU / KK');
    let cursor = 0, failure = null;
    async function worker() {
      try {
        while (!failure && cursor < pairs.length) {
          guard();
          const [source, target] = pairs[cursor++];
          const fields = await inspect(source, target);
          guard();
          if (Object.keys(fields).length) {
            report.differences.push({ documentId: source.documentId, fields });
            for (const name of Object.keys(fields)) {
              report.fieldDifferences[name] = (report.fieldDifferences[name] || 0) + 1;
            }
          } else report.matched++;
          report.checked++;
          render('Сравнение RU / KK', source.documentId);
        }
      } catch (error) {
        failure ||= error;
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pairs.length) }, worker));
    if (failure) throw failure;
    guard();
    ensure(report.checked === report.total &&
      report.matched + report.differences.length === report.total &&
      report.ruOnly + report.pairs === report.ruTotal &&
      report.kkOnly + report.pairs === report.kkTotal, 'Обход не завершён');
    report.differences.sort((a, b) => a.documentId.localeCompare(b.documentId));
    report.blocked.sort((a, b) => a.documentId.localeCompare(b.documentId));
    report.status = 'completed';
  }

  const ui = designSystem.createToolStatus('Attribute RU / KK Config');
  const { phase: phaseLabel, detail: status } = ui;
  const stop = ui.button('Остановить');
  const save = ui.button('Скачать конфиг');
  const review = ui.button('Скачать исключения');
  save.hidden = review.hidden = true;
  stop.onclick = () => {
    stopped = true;
    stop.disabled = true;
    stop.textContent = 'Остановка…';
  };
  save.onclick = () => download('attribute-relations-config.csv', configCsv());
  review.onclick = () => download('attribute-relations-config-blocked.csv', blockedCsv());

  function render(phase, id = '', reading = null) {
    phaseLabel.textContent = phase;
    status.textContent = 'Проверено: ' + report.checked + '/' + report.total +
      '\nС расхождениями: ' + report.differences.length +
      '\nСовпадают: ' + report.matched + ' · Исключено: ' + report.blocked.length +
      '\nRU: ' + report.ruTotal + ' · KK: ' + report.kkTotal +
      '\nТолько RU: ' + report.ruOnly + ' · Только KK: ' + report.kkOnly +
      '\nПолей: ' + report.comparedFields.length + ' · Запросов: ' + report.requests +
      '\nFallback: relations ' + report.relationFallbacks + ' · detail ' + report.detailFallbacks +
      (id ? '\nAttribute: ' + id : '');
    ui.setProgress(reading ? reading.loaded : report.checked,
      reading ? reading.total : report.total);
    if (stopped && report.status === 'running') status.textContent += '\nОстановка…';
  }

  try {
    ui.open();
    render('Загрузка списков RU / KK Attribute');
    await scan(render);
    render(report.differences.length ? 'Конфиг готов' : 'Расхождений для синхронизации нет');
    save.hidden = !report.differences.length;
    review.hidden = !report.blocked.length;
    if (report.differences.length) save.click();
    console.log(TAG, 'Готово', report);
  } catch (error) {
    report.status = stopped ? 'stopped' : 'error';
    report.errors.push(error.message);
    render(stopped ? 'Остановлено. Конфиг не сформирован' : 'Ошибка: ' + error.message);
    console.error(TAG, error);
  } finally {
    ui.finish(stop);
    window[RUN_KEY] = false;
  }
})();
