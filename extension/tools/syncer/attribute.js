(async () => {
  'use strict';

  const TAG = '[attributeSync]';
  const UID = 'api::attribute.attribute';
  const PAGE_SIZE = 100;
  const RUN_KEY = '__tmAttributeSyncRunning';
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

  if (window[RUN_KEY]) return;
  window[RUN_KEY] = true;
  delete window.attributeSyncStop;
  let schemaPromise = null;

  function ensure(value, message) {
    if (!value) throw Error(message);
  }


  function token() {
    let value = localStorage.getItem('jwtToken');
    try { value = JSON.parse(value); } catch {}
    ensure(typeof value === 'string' && value.trim(), 'Нет Admin jwtToken');
    return value.trim().replace(/^Bearer\s+/i, '');
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


  function same(a, b) {
    return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  }

  async function normalize(attributeId, bulk = false, dryRun = true) {
    const report = {
      attributeId, status: 'running', dryRun, startedAt: new Date().toISOString(),
      finishedAt: null, plan: {}, skipped: [], operations: [], published: [],
      errors: [], integrityDiffs: [], ignoredIntegrityDiffs: [], unpublishedRelations: [],
      counters: { GET: 0, PUT: 0, POST: 0, retries: 0 }, pending: null
    };
    window.attributeSyncReport = report;
    let fields, schemas;
    const entryPath = (uid, id, locale, status = 'draft') =>
      '/content-manager/collection-types/' + uid + '/' + encodeURIComponent(id) +
      '?locale=' + locale + '&status=' + status;

    async function request(method, path, payload, allow404 = false) {
      const attempts = method === 'GET' ? 3 : 1;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        report.counters[method]++;
        let response, body;
        try {
          response = await fetch(path, {
            method,
            credentials: 'include',
            cache: 'no-store',
            headers: {
              Authorization: 'Bearer ' + token(),
              Accept: 'application/json',
              ...(payload === undefined ? {} : { 'Content-Type': 'application/json' })
            },
            ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
          });
          body = await response.text();
        } catch (error) {
          if (method !== 'GET' || attempt === attempts)
            throw Error(method + ' network ' + path + ': ' + error.message);
          report.counters.retries++;
          await new Promise(resolve => setTimeout(resolve, attempt * 450));
          continue;
        }

        if (response.status === 404 && allow404) return null;
        let data;
        try { data = body ? JSON.parse(body) : null; }
        catch { throw Error('Некорректный JSON: ' + method + ' ' + path); }
        if (response.ok) return data;
        if (method === 'GET' && attempt < attempts &&
            [408, 429, 500, 502, 503, 504].includes(response.status)) {
          report.counters.retries++;
          await new Promise(resolve => setTimeout(resolve, attempt * 600));
          continue;
        }
        throw Error(method + ' HTTP ' + response.status + ' ' + path + ': ' +
          (data?.error?.message || body.slice(0, 180)));
      }
    }


    async function detail(uid, id, locale, status = 'draft', optional = false) {
      const data = await request('GET', entryPath(uid, id, locale, status), undefined, optional);
      if (data === null) return null;
      const row = data?.data;
      if (optional && (!row || !Object.keys(row).length)) return null;
      const dictionary = schemas.get(uid)?.pluginOptions?.i18n?.localized !== true &&
        schemas.get(uid)?.isLocalized !== true && uid !== UID;
      ensure(row?.documentId === id && (row.locale === locale || (dictionary && row.locale === null)) &&
        Number.isSafeInteger(row.id) && row.id > 0,
        'Неверная версия ' + uid + '/' + id + '/' + locale + '/' + status);
      if (status === 'published' && !row.publishedAt) return null;
      return row;
    }

    async function relations(uid, id, field, locale, count, status = 'draft') {
      if (count === 0) return [];
      const base = '/content-manager/relations/' + uid + '/' +
        encodeURIComponent(id) + '/' + field;
      const result = [];
      const unique = new Set();
      let total = null, pageCount = null;
      for (let page = 1; page <= 10000; page++) {
        const params = new URLSearchParams({
          locale, status, page: String(page), pageSize: String(PAGE_SIZE)
        });
        const data = await request('GET', base + '?' + params);
        const pagination = data?.pagination;
        ensure(Array.isArray(data?.results) &&
          Number(pagination?.page) === page && Number.isSafeInteger(pagination?.total) && pagination.total >= 0 &&
          Number.isSafeInteger(pagination?.pageCount) && pagination.pageCount >= 0,
          'Некорректная пагинация ' + field + '/' + id);
        if (total === null) {
          total = pagination.total;
          pageCount = pagination.pageCount;
        }
        ensure(total === pagination.total && pageCount === pagination.pageCount,
          'Пагинация изменилась ' + field + '/' + id);
        for (const item of data.results) {
          ensure(typeof item?.documentId === 'string' && item.documentId &&
            Number.isSafeInteger(item.id) && item.id > 0 &&
            (!item.locale || item.locale === locale) &&
            !unique.has(item.documentId), 'Некорректная связь ' + field + '/' + id);
          unique.add(item.documentId);
          result.push({ documentId: item.documentId, id: item.id, locale });
        }
        if (page >= pageCount) break;
        ensure(page < 10000 && data.results.length > 0, 'Пустая промежуточная страница ' + field);
      }
      ensure(result.length === total && (count == null || result.length === count),
        'Неполный набор связей ' + field + '/' + id);
      return result.sort((a, b) => a.documentId.localeCompare(b.documentId));
    }


    async function schemaCheck() {
      if (!schemaPromise) {
        schemaPromise = request('GET', '/content-manager/content-types').then(data => {
          ensure(Array.isArray(data?.data), 'Не удалось прочитать схемы CMS');
          return new Map(data.data.map(type => [type.uid, type]));
        }).catch(error => { schemaPromise = null; throw error; });
      }
      schemas = await schemaPromise;
      const schema = schemas.get(UID);
      ensure(schema?.attributes, 'Нет схемы Attribute');
      fields = Object.entries(schema.attributes).filter(([name]) =>
        !SYSTEM.has(name) && !EXCLUDED.has(name));
      for (const name of ['product', 'shade', 'volume', 'color_variant1C', 'filtry'])
        ensure(fields.some(([field, def]) => field === name && def.type === 'relation'),
          'Изменилась схема Attribute.' + name);
      for (const [name, def] of fields)
        ensure(SCALARS.has(def.type) || def.type === 'media' ||
          (def.type === 'relation' && schemas.has(def.target) &&
          ['oneToOne', 'manyToOne', 'oneToMany', 'manyToMany', 'oneWay', 'manyWay'].includes(def.relation)),
          'Неподдерживаемый тип Attribute.' + name + ': ' + def.type);
    }

    const ids = rows => rows.map(row => row.documentId).sort();
    async function snapshot(locale, status = 'draft') {
      const row = await detail(UID, attributeId, locale, status, true);
      if (!row) return null;
      const values = {}, links = {};
      for (const [name, def] of fields) {
        if (def.type !== 'relation') {
          const value = readValue(row[name], def);
          ensure(value !== undefined, 'Не удалось прочитать ' + locale + '/' + name);
          values[name] = value;
          continue;
        }
        const info = inlineLinks(row[name], own(row, name), name, def);
        links[name] = await relations(UID, attributeId, name, locale, info.count, status);
        ensure(!singleRelation(def) || links[name].length <= 1, 'Несколько to-one связей: ' + name);
      }
      return { row, values, links };
    }

    function content(snap) {
      return snap ? { values: snap.values, relations: Object.fromEntries(
        Object.entries(snap.links).map(([name, rows]) => [name, ids(rows)])) } : null;
    }

    function verify(stage, expected, actual) {
      if (same(expected, actual)) return;
      report.integrityDiffs.push({ stage, expected, actual });
      throw Error('Проверка не пройдена: ' + stage);
    }

    async function plan(ru, kk) {
      const patch = {}, delta = {}, desired = {};
      for (const [name, def] of fields) {
        if (def.type !== 'relation') {
          if (!same(ru.values[name], kk.values[name])) patch[name] = ru.values[name];
          continue;
        }
        const want = ids(ru.links[name]), have = ids(kk.links[name]);
        desired[name] = want;
        const connect = [], disconnect = kk.links[name].filter(row => !want.includes(row.documentId));
        for (const id of want.filter(id => !have.includes(id))) {
          const target = await detail(def.target, id, 'kk', 'draft', true);
          if (!target) report.skipped.push({ field: name, documentId: id, reason: 'Нет целевой записи KK' });
          else connect.push({ id: target.id, documentId: id,
            ...(target.locale === 'kk' ? { locale: 'kk' } : {}), isTemporary: true });
        }
        delta[name] = { connect, disconnect: disconnect.map(({id, documentId}) => ({id, documentId})) };
      }
      return { patch, delta, desired };
    }

    async function verifyPublished(snap, expected) {
      ensure(snap?.row.publishedAt, 'Нет KK Published');
      verify('KK Published fields', expected.values, snap.values);
      for (const [name, def] of fields.filter(([, def]) => def.type === 'relation')) {
        const want = expected.relations[name], have = ids(snap.links[name]);
        ensure(have.every(id => want.includes(id)), 'Лишние Published связи: ' + name);
        for (const id of want.filter(id => !have.includes(id))) {
          ensure(!(await detail(def.target, id, 'kk', 'published', true)),
            'Отсутствует Published связь: ' + name + '/' + id);
          report.unpublishedRelations.push({ field: name, documentId: id });
        }
      }
    }

    try {
      await schemaCheck();
      const [ru, kk] = await Promise.all([snapshot('ru'), snapshot('kk')]);
      if (!ru || !kk) {
        report.skipped.push({ field: '$record', documentId: attributeId, reason: 'Нет одной из локалей' });
        report.status = 'partial';
        return report;
      }
      const initial = await plan(ru, kk);
      const expected = content(ru), previous = content(kk);
      for (const name of Object.keys(initial.patch))
        report.plan[name] = { ru: ru.values[name], kk: kk.values[name] };
      for (const [name, change] of Object.entries(initial.delta))
        if (!same(expected.relations[name], previous.relations[name]))
          report.plan[name] = { ru: expected.relations[name], kk: previous.relations[name],
            add: change.connect.length, disconnect: change.disconnect.length };
      console.table(Object.entries(report.plan).map(([field, change]) => ({
        field, RU: JSON.stringify(change.ru), KK: JSON.stringify(change.kk)
      })));
      if (report.skipped.length) { report.status = 'partial'; return report; }
      if (!Object.keys(report.plan).length || dryRun) { report.status = 'completed'; return report; }
      if (!bulk && !confirm('Attribute ' + attributeId + ': ' + Object.keys(report.plan).length +
        ' полей отличаются. Обновить и опубликовать KK?')) {
        report.status = 'cancelled';
        return report;
      }
      const [ruPub, kkPub, freshRU, freshKK] = await Promise.all([
        snapshot('ru', 'published'), snapshot('kk', 'published'), snapshot('ru'), snapshot('kk')
      ]);
      verify('RU перед записью', expected, content(freshRU));
      verify('KK перед записью', previous, content(freshKK));
      report.before = { ru: expected, kk: previous, ruPublished: content(ruPub), kkPublished: content(kkPub) };
      const currentPlan = await plan(freshRU, freshKK);
      ensure(!report.skipped.length, 'Целевая связь исчезла перед записью');
      if (window.attributeSyncStop === true) { report.status = 'cancelled'; return report; }
      const path = '/content-manager/collection-types/' + UID + '/' + encodeURIComponent(attributeId);
      if (Object.keys(currentPlan.patch).length) {
        report.pending = { stage: 'save', documentId: attributeId, fields: Object.keys(currentPlan.patch) };
        await request('PUT', path + '?locale=kk', currentPlan.patch);
        const saved = await snapshot('kk');
        verify('KK после Save', { values: expected.values, relations: previous.relations }, content(saved));
        verify('RU Draft после Save', expected, content(await snapshot('ru')));
        verify('RU Published после Save', content(ruPub), content(await snapshot('ru', 'published')));
        report.operations.push({ field: '$fields', connect: 0, disconnect: 0, fields: Object.keys(currentPlan.patch) });
      }
      const [beforePublishRU, beforePublishKK] = await Promise.all([snapshot('ru'), snapshot('kk')]);
      verify('RU перед Publish', expected, content(beforePublishRU));
      verify('KK перед Publish', { values: expected.values, relations: previous.relations }, content(beforePublishKK));
      const final = await plan(beforePublishRU, beforePublishKK);
      ensure(!report.skipped.length && !Object.keys(final.patch).length, 'План изменился перед Publish');
      const payload = { ...beforePublishKK.values, ...final.delta };
      ensure(!own(payload, 'price'), 'price исключён');
      report.pending = { stage: 'publish', documentId: attributeId, fields: Object.keys(report.plan) };
      await request('POST', path + '/actions/publish?locale=kk', payload);
      const [afterRU, afterRUPub, afterKK, afterKKPub] = await Promise.all([
        snapshot('ru'), snapshot('ru', 'published'), snapshot('kk'), snapshot('kk', 'published')
      ]);
      verify('RU Draft после Publish', expected, content(afterRU));
      verify('RU Published после Publish', content(ruPub), content(afterRUPub));
      verify('KK Draft после Publish', expected, content(afterKK));
      await verifyPublished(afterKKPub, expected);
      ensure(afterKKPub.row.publishedAt !== kkPub?.row.publishedAt,
        'Не подтверждена новая версия KK Published');
      for (const [field, change] of Object.entries(final.delta))
        if (change.connect.length || change.disconnect.length)
          report.operations.push({ field, connect: change.connect.length, disconnect: change.disconnect.length });
      report.published.push({ documentId: attributeId });
      report.pending = null;
      report.status = report.unpublishedRelations.length ? 'partial' : 'completed';
    } catch (error) {
      report.status = 'stopped';
      report.errors.push(error.message);
      console.error(TAG, attributeId, error);
    } finally {
      report.finishedAt = new Date().toISOString();
      console.log(TAG, report.status, report);
    }
    return report;
  }

  function parseCsv(source) {
    const text = source.replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], cell = '', quoted = false, closed = false;
    function pushCell() {
      row.push(cell);
      cell = '';
      closed = false;
    }
    function pushRow() {
      pushCell();
      rows.push(row);
      row = [];
    }
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else { quoted = false; closed = true; }
        } else cell += ch;
      } else if (ch === ',') pushCell();
      else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        pushRow();
      } else if (ch === '"' && !cell && !closed) quoted = true;
      else {
        if (closed || ch === '"') throw Error('Некорректный CSV');
        cell += ch;
      }
    }
    if (quoted) throw Error('Незакрытая кавычка в CSV');
    if (row.length || cell || closed) pushRow();
    const header = (rows.shift() || []).map(value => value.trim());
    const index = header.indexOf('documentId');
    if (index < 0 || header.lastIndexOf('documentId') !== index)
      throw Error('Нужна одна колонка documentId в первой строке');
    const ids = new Set();
    let duplicates = 0;
    for (const [i, values] of rows.entries()) {
      const id = (values[index] || '').trim();
      if (!id) continue;
      if (!/^[a-zA-Z0-9]+$/.test(id))
        throw Error('Некорректный documentId в строке ' + (i + 2));
      if (ids.has(id)) duplicates++;
      ids.add(id);
    }
    if (!ids.size) throw Error('В таблице нет documentId');
    return { ids: [...ids], duplicates };
  }

  function exportUrl(value) {
    let url;
    try { url = new URL(value.trim()); }
    catch { throw Error('Введите URL Google Sheets'); }
    const match = url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]+)(?:\/.*)?$/);
    if (url.origin !== 'https://docs.google.com' || !match || url.username || url.password)
      throw Error('Нужна ссылка на Google Sheets');
    const hash = new URLSearchParams(url.hash.slice(1));
    const gid = hash.get('gid') ?? url.searchParams.get('gid');
    if (gid !== null && !/^\d+$/.test(gid)) throw Error('Некорректный gid листа');
    return 'https://docs.google.com/spreadsheets/d/' + match[1] +
      '/export?format=csv' + (gid === null ? '' : '&gid=' + gid);
  }

  function summarize(report) {
    const totals = report.operations.reduce((sum, op) => ({
      added: sum.added + op.connect, removed: sum.removed + op.disconnect
    }), { added: 0, removed: 0 });
    return {
      documentId: report.attributeId, status: report.status,
      changedFields: Object.keys(report.plan).length, dryRun: report.dryRun,
      ...totals, skipped: report.skipped.length, published: report.published.length,
      comment: [
        ...report.errors,
        ...report.ignoredIntegrityDiffs.flatMap(item => item.differences.map(diff =>
          'Игнорировано ' + item.stage + ' ' + item.uid + '/' + item.documentId + ' ' +
          diff.locale + '.' + diff.field + ': ' + JSON.stringify(diff.before) + ' → ' + JSON.stringify(diff.after))),
        ...(report.unpublishedRelations.length ? ['Связи с неопубликованными KK записями: ' + report.unpublishedRelations.length] : []),
        ...report.skipped.map(item => item.field + '/' + item.documentId + ': ' + item.reason),
        ...(report.pending ? ['Неподтверждённая операция: ' + JSON.stringify(report.pending)] : [])
      ].join(' | ') || (Object.keys(report.plan).length ? (report.dryRun ? 'План изменений' : 'Обновлено') : 'Изменений нет')
    };
  }

  function downloadResults(batch) {
    const columns = ['documentId', 'status', 'dryRun', 'changedFields', 'added', 'removed', 'skipped', 'published', 'comment'];
    const cell = value => {
      let text = String(value ?? '');
      if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    const csv = '\uFEFF' + columns.join(';') + '\n' +
      batch.rows.map(row => columns.map(key => cell(row[key])).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'attribute-sync-results.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function fatalReport(report) {
    return report.status === 'stopped' || !!report.pending;
  }

  async function runBatch(ids, onProgress, dryRun) {
    const batch = {
      startedAt: new Date().toISOString(), finishedAt: null, status: 'running',
      rows: ids.map(documentId => ({ documentId, status: 'pending' })), reports: []
    };
    window.attributeSyncBatchReport = batch;
    let pilotPassed = false;
    try {
      for (let i = 0; i < ids.length; i++) {
        if (window.attributeSyncStop === true) {
          batch.status = 'stopped';
          break;
        }
        onProgress(batch, i, ids[i]);
        const report = await normalize(ids[i], true, dryRun);
        batch.reports.push(report);
        batch.rows[i] = summarize(report);
        if (fatalReport(report)) {
          batch.status = 'stopped';
          break;
        }
        onProgress(batch, i + 1, '');
        if (!dryRun && report.published.length && !pilotPassed) {
          pilotPassed = true;
          if (i + 1 < ids.length && !confirm('Контрольная запись опубликована и проверена. Продолжить остальные ' + (ids.length - i - 1) + '?')) {
            batch.status = 'stopped';
            break;
          }
        }
        if (i + 1 < ids.length)
          await new Promise(resolve => setTimeout(resolve, 350));
      }
      if (batch.status === 'running')
        batch.status = batch.rows.some(row => row.status !== 'completed') ? 'partial' : 'completed';
    } finally {
      batch.finishedAt = new Date().toISOString();
      if (batch.status === 'running') batch.status = 'stopped';
      onProgress(batch, batch.reports.length, '');
      try { downloadResults(batch); }
      catch (error) { console.error(TAG, 'Ошибка экспорта CSV:', error.message); }
      console.log(TAG, 'Массовый отчёт: window.attributeSyncBatchReport');
    }
    return batch;
  }

  async function chooseMode() {
    const route = '/admin/content-manager/collection-types/' + UID + '/';
    const pathname = location.pathname;
    const current = pathname.startsWith(route) ? pathname.slice(route.length) : '';
    const currentId = /^[a-zA-Z0-9]+$/.test(current) && current !== 'create' ? current : '';
    const dialog = document.createElement('dialog');
    dialog.setAttribute('data-tm-attribute-sync', '');
    dialog.setAttribute('data-tm-tool-dialog', '');
    dialog.setAttribute('data-tm-created', 'attribute-sync');
    dialog.setAttribute('data-tm-ds', '');
    dialog.setAttribute('aria-labelledby', 'tm-as-heading');
    const style = document.createElement('style');
    style.textContent = [
      '[data-tm-attribute-sync] [hidden]{display:none!important}',
      '[data-tm-attribute-sync] .tm-as-header,[data-tm-attribute-sync] .tm-as-actions,[data-tm-attribute-sync] .tm-as-line{display:flex;align-items:center;gap:8px}',
      '[data-tm-attribute-sync] .tm-as-header,[data-tm-attribute-sync] .tm-as-line{justify-content:space-between}',
      '[data-tm-attribute-sync] h2{font-size:20px;font-weight:600;line-height:1.3;margin:0 0 4px}',
      '[data-tm-attribute-sync] h3{font-size:14px;font-weight:600;margin:0}',
      '[data-tm-attribute-sync] p{margin:0;overflow-wrap:anywhere}',
      '[data-tm-attribute-sync] .tm-as-stack{display:flex;flex-direction:column;gap:16px;margin-top:20px}',
      '[data-tm-attribute-sync] .tm-as-switch{display:flex;gap:4px;padding:4px;border-radius:6px;background:var(--tm-ds-neutral100);border:1px solid var(--tm-ds-neutral200)}',
      '[data-tm-attribute-sync] .tm-as-switch button{flex:1;min-width:0;padding:8px;border:1px solid transparent;background:transparent}',
      '[data-tm-attribute-sync] .tm-as-switch button[aria-pressed="true"]{background:var(--tm-ds-neutral0);border-color:var(--tm-ds-primary600);color:var(--tm-ds-primary700)}',
      '[data-tm-attribute-sync] .tm-as-switch button:disabled{opacity:.55}',
      '[data-tm-attribute-sync] .tm-as-section{display:flex;flex-direction:column;gap:10px}',
      '[data-tm-attribute-sync] input{width:100%;min-width:0;box-sizing:border-box}',
      '[data-tm-attribute-sync] .tm-as-file{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;border:1px dashed var(--tm-ds-neutral300);border-radius:6px;padding:18px;overflow-wrap:anywhere}',
      '[data-tm-attribute-sync] .tm-as-file input{font:inherit;color:inherit;font-size:12px;max-width:100%}',
      '[data-tm-attribute-sync] .tm-as-file input::file-selector-button{font:inherit;color:inherit;background:var(--tm-ds-neutral100);border:1px solid var(--tm-ds-neutral200);border-radius:4px;padding:7px 10px;margin-right:8px;cursor:pointer}',
      '[data-tm-attribute-sync] .tm-as-note{padding:12px;border-radius:6px;background:var(--tm-ds-neutral100);border:1px solid var(--tm-ds-neutral200)}',
      '[data-tm-attribute-sync] [data-tone="error"]{color:var(--tm-ds-danger600)}',
      '[data-tm-attribute-sync] [data-tone="success"]{color:var(--tm-ds-success600)}',
      '[data-tm-attribute-sync] [data-tone="warning"]{color:var(--tm-ds-warning600)}',
      '[data-tm-attribute-sync] .tm-as-primary:not(:disabled){background:var(--tm-ds-buttonPrimary600);border-color:var(--tm-ds-buttonPrimary600);color:var(--tm-ds-buttonNeutral0)}',
      '[data-tm-attribute-sync] .tm-as-primary:hover:not(:disabled){background:var(--tm-ds-primary500)}',
      '[data-tm-attribute-sync] .tm-as-close{width:32px;padding:0;font-size:20px;flex-shrink:0}',
      '[data-tm-attribute-sync] .tm-as-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}',
      '[data-tm-attribute-sync] .tm-as-metric{padding:12px;border:1px solid var(--tm-ds-neutral200);border-radius:6px;min-width:0}',
      '[data-tm-attribute-sync] .tm-as-value{font-size:24px;font-weight:600;line-height:1.2;margin-top:4px;font-variant-numeric:tabular-nums}',
      '@media(max-width:420px){[data-tm-attribute-sync]{padding:16px}[data-tm-attribute-sync] .tm-as-actions>button{flex:1}}'
    ].join('\n');

    const add = (parent, tag, text = '', cls = '') => {
      const node = document.createElement(tag);
      node.textContent = text;
      node.className = cls;
      parent.appendChild(node);
      return node;
    };
    const button = (parent, text, cls = '') => {
      const node = add(parent, 'button', text, 'tm-ds-button ' + cls);
      node.type = 'button';
      return node;
    };
    const header = add(dialog, 'div', '', 'tm-as-header');
    const heading = add(header, 'div');
    add(heading, 'h2', 'Attribute Sync').id = 'tm-as-heading';
    add(heading, 'p', 'Синхронизация полей и связей RU → KK', 'tm-ds-meta');
    const cross = button(header, '×', 'tm-as-close');
    cross.setAttribute('aria-label', 'Закрыть');

    const form = add(dialog, 'div', '', 'tm-as-stack');
    const modes = add(form, 'div', '', 'tm-as-switch');
    modes.setAttribute('role', 'group');
    modes.setAttribute('aria-label', 'Режим синхронизации');
    const single = button(modes, 'Текущая запись');
    single.title = currentId ? '' : 'Откройте карточку Attribute';
    const multiple = button(modes, 'Массовая');
    const singleForm = add(form, 'div', '', 'tm-as-section');
    add(singleForm, 'h3', 'Открытая Attribute');
    add(singleForm, 'p', currentId, 'tm-ds-meta tm-as-note');
    add(singleForm, 'p', 'Поля и связи текущей записи будут сверены с RU. Цена исключена.', 'tm-ds-text');
    const massForm = add(form, 'div', '', 'tm-as-section');
    add(massForm, 'h3', 'Источник конфигурации');
    const sources = add(massForm, 'div', '', 'tm-as-switch');
    sources.setAttribute('role', 'group');
    sources.setAttribute('aria-label', 'Источник конфигурации');
    const local = button(sources, 'CSV-файл');
    const remote = button(sources, 'Google Sheets');
    const fileForm = add(massForm, 'div', '', 'tm-as-file');
    add(fileForm, 'h3', 'Выберите CSV с documentId');
    const file = add(fileForm, 'input');
    file.type = 'file';
    file.accept = '.csv,text/csv';
    file.setAttribute('aria-label', 'CSV-файл конфигурации');
    add(fileForm, 'p', 'Можно использовать файл из config → attribute.js.', 'tm-ds-meta');
    const urlForm = add(massForm, 'div', '', 'tm-as-section');
    const urlLabel = add(urlForm, 'label', 'URL Google Sheets', 'tm-ds-meta');
    urlLabel.htmlFor = 'tm-as-url';
    const input = add(urlForm, 'input', '', 'tm-ds-input');
    input.id = 'tm-as-url';
    input.type = 'url';
    input.placeholder = 'https://docs.google.com/spreadsheets/d/…';
    const preview = button(urlForm, 'Загрузить конфиг');
    add(urlForm, 'p', 'Таблица должна быть доступна по ссылке.', 'tm-ds-meta');
    const configStatus = add(massForm, 'p', 'Конфиг не загружен', 'tm-ds-meta tm-as-note');
    configStatus.setAttribute('role', 'status');
    const dryLabel = add(form, 'label', '', 'tm-ds-text');
    const dry = document.createElement('input');
    dry.type = 'checkbox';
    dry.checked = true;
    dry.style.width = 'auto';
    dryLabel.append(dry, document.createTextNode(' Dry-run (только чтение)'));
    add(form, 'p', 'Только KK Attribute. Цена не передаётся. Связанные записи отдельно не публикуются. При отсутствии целевой связи запись пропускается.', 'tm-ds-meta');

    const result = add(dialog, 'div', '', 'tm-as-stack');
    result.hidden = true;
    const resultLine = add(result, 'div', '', 'tm-as-line');
    const phase = add(resultLine, 'h3', 'Обработка');
    const percent = add(resultLine, 'span', '', 'tm-ds-meta');
    const progress = add(result, 'progress');
    progress.setAttribute('aria-label', 'Прогресс синхронизации');
    const metrics = add(result, 'div', '', 'tm-as-metrics');
    const values = {};
    for (const [key, label, tone] of [
      ['completed', 'Успешно', 'success'],
      ['partial', 'Частично', 'warning'],
      ['stopped', 'Ошибки', 'error'],
      ['pending', 'Осталось', '']
    ]) {
      const metric = add(metrics, 'div', '', 'tm-as-metric');
      add(metric, 'p', label, 'tm-ds-meta');
      values[key] = add(metric, 'p', '0', 'tm-as-value');
      if (tone) values[key].dataset.tone = tone;
    }
    const detail = add(result, 'p', '', 'tm-ds-meta');
    detail.setAttribute('role', 'status');
    const resultError = add(result, 'p', '', 'tm-ds-text tm-as-note');
    resultError.dataset.tone = 'error';
    resultError.hidden = true;

    const actions = add(dialog, 'div', '', 'tm-as-actions tm-ds-tool-actions');
    const close = button(actions, 'Закрыть');
    const reset = button(actions, 'Новая синхронизация');
    const stop = button(actions, 'Остановить');
    const save = button(actions, 'Скачать отчёт CSV');
    const start = button(actions, 'Запустить', 'tm-as-primary');

    let mode = currentId ? 'single' : 'bulk';
    let source = 'file';
    let config = null, busy = false, view = 'form', batch = null;

    function setConfigStatus(text, tone = '') {
      configStatus.textContent = text;
      configStatus.dataset.tone = tone;
    }

    function invalidate() {
      config = null;
      setConfigStatus('Конфиг не загружен');
    }

    function render() {
      const inForm = view === 'form';
      form.hidden = !inForm;
      result.hidden = inForm;
      single.setAttribute('aria-pressed', String(mode === 'single'));
      multiple.setAttribute('aria-pressed', String(mode === 'bulk'));
      local.setAttribute('aria-pressed', String(source === 'file'));
      remote.setAttribute('aria-pressed', String(source === 'sheet'));
      singleForm.hidden = mode !== 'single';
      massForm.hidden = mode !== 'bulk';
      fileForm.hidden = source !== 'file';
      urlForm.hidden = source !== 'sheet';
      single.disabled = busy || !currentId;
      for (const node of [multiple, local, remote, file, input, preview]) node.disabled = busy;
      preview.disabled = busy || !input.value.trim();
      start.hidden = !inForm;
      start.disabled = busy || (mode === 'single' ? !currentId : !config);
      dry.disabled = busy;
      start.textContent = (dry.checked ? 'Проверить' : 'Синхронизировать') + (mode === 'bulk' && config ? ' · ' + config.ids.length : '');
      close.disabled = cross.disabled = busy;
      close.hidden = !inForm && busy;
      stop.hidden = inForm || !busy || mode !== 'bulk';
      stop.disabled = window.attributeSyncStop === true;
      stop.textContent = stop.disabled ? 'Остановка…' : 'Остановить';
      save.hidden = inForm || !batch;
      reset.hidden = inForm || busy;
    }

    function showConfig(value, name) {
      config = value;
      setConfigStatus(name + ' · ' + value.ids.length + ' записей' +
        (value.duplicates ? ' · дублей исключено: ' + value.duplicates : ''), 'success');
    }

    function renderReport(report, done, id) {
      batch = report;
      const total = report.rows.length;
      const running = report.status === 'running';
      phase.textContent = running ? (dry.checked ? 'Dry-run' : 'Синхронизация') : ({
        completed: dry.checked ? 'Проверка завершена' : 'Синхронизация завершена',
        partial: 'Завершено с исключениями',
        stopped: 'Синхронизация остановлена',
        cancelled: 'Синхронизация отменена'
      })[report.status] || 'Итог';
      progress.max = Math.max(total, 1);
      progress.value = done;
      percent.textContent = done + ' / ' + total + ' · ' + Math.round(100 * done / Math.max(total, 1)) + '%';
      for (const key of Object.keys(values))
        values[key].textContent = String(report.rows.filter(row => row.status === key).length);
      detail.textContent = running
        ? (window.attributeSyncStop === true ? 'Остановка после текущей записи…' : id ? 'Текущая Attribute: ' + id : 'Обработка…')
        : 'Полей с расхождениями: ' + report.rows.reduce((n, row) => n + (row.changedFields || 0), 0) + ' · Подключено: ' + report.rows.reduce((n, row) => n + (row.added || 0), 0) +
          ' · Отключено: ' + report.rows.reduce((n, row) => n + (row.removed || 0), 0) +
          ' · Опубликовано: ' + report.rows.reduce((n, row) => n + (row.published || 0), 0);
      const error = report.status === 'stopped' ? report.reports.at(-1)?.errors.join('; ') || '' : '';
      resultError.textContent = error;
      resultError.hidden = !error;
      render();
    }

    dry.onchange = render;
    single.onclick = () => { mode = 'single'; render(); };
    multiple.onclick = () => { mode = 'bulk'; render(); };
    local.onclick = () => {
      if (source === 'file') return;
      source = 'file';
      file.value = '';
      invalidate();
      render();
    };
    remote.onclick = () => {
      if (source === 'sheet') return;
      source = 'sheet';
      file.value = '';
      invalidate();
      render();
    };
    input.addEventListener('input', () => { invalidate(); render(); });
    file.addEventListener('change', async () => {
      invalidate();
      const selected = file.files?.[0];
      if (!selected) { render(); return; }
      busy = true;
      setConfigStatus('Чтение CSV…');
      render();
      try {
        if (!/\.csv$/i.test(selected.name)) throw Error('Выберите файл CSV');
        showConfig(parseCsv(await selected.text()), selected.name);
      } catch (error) {
        setConfigStatus(error.message, 'error');
        file.value = '';
      } finally {
        busy = false;
        render();
      }
    });
    preview.onclick = async () => {
      if (busy) return;
      invalidate();
      busy = true;
      setConfigStatus('Чтение Google Sheets…');
      render();
      try {
        const url = exportUrl(input.value);
        const response = await fetch(url, { credentials: 'omit', cache: 'no-store' });
        if (!response.ok) throw Error('Google Sheets: HTTP ' + response.status);
        if (!/^text\/csv\b/i.test(response.headers.get('content-type') || ''))
          throw Error('Google Sheets не вернул CSV. Проверьте доступ по ссылке.');
        showConfig(parseCsv(await response.text()), 'Google Sheets');
      } catch (error) {
        setConfigStatus(error.message, 'error');
      } finally {
        busy = false;
        render();
      }
    };

    reset.onclick = () => {
      batch = null;
      view = 'form';
      delete window.attributeSyncStop;
      file.value = '';
      invalidate();
      render();
    };
    stop.onclick = () => {
      window.attributeSyncStop = true;
      detail.textContent = 'Остановка после текущей записи…';
      render();
    };
    save.onclick = () => { if (batch) downloadResults(batch); };
    start.onclick = async () => {
      if (busy || view !== 'form') return;
      if (mode === 'single' && (!currentId || location.pathname !== pathname)) {
        singleForm.querySelector('.tm-as-note').textContent = 'Открытая запись изменилась. Запустите инструмент повторно.';
        return;
      }
      if (mode === 'bulk' && !config) return;
      const ids = mode === 'single' ? [currentId] : config.ids.slice();
      if (!dry.checked && mode === 'bulk' && !confirm('Обработать ' + ids.length + ' Attribute RU → KK? Сначала одна контрольная запись, затем подтверждение продолжения.')) return;
      delete window.attributeSyncStop;
      busy = true;
      view = 'result';
      batch = null;
      renderReport({ status: 'running', rows: ids.map(documentId => ({ documentId, status: 'pending' })), reports: [] }, 0, ids[0]);
      try {
        if (mode === 'bulk') {
          batch = await runBatch(ids, renderReport, dry.checked);
        } else {
          const report = await normalize(currentId, false, dry.checked);
          const singleBatch = { status: report.status, rows: [summarize(report)], reports: [report] };
          renderReport(singleBatch, 1, '');
          if (report.status === 'cancelled') batch = null;
        }
      } catch (error) {
        phase.textContent = 'Ошибка синхронизации';
        resultError.textContent = error.message;
        resultError.hidden = false;
        console.error(TAG, error);
      } finally {
        busy = false;
        render();
      }
    };

    try {
      document.head.appendChild(style);
      if (document.querySelector('[data-tm-tool-dialog][open]')) throw Error('Закройте предыдущее окно инструмента');
      document.body.appendChild(dialog);
      window.__tmStrapiDesignSystem?.syncTheme();
      render();
      await new Promise(resolve => {
        const finish = () => {
          if (busy) return;
          dialog.close();
          resolve();
        };
        close.onclick = cross.onclick = finish;
        dialog.addEventListener('cancel', event => {
          event.preventDefault();
          finish();
        });
        dialog.showModal();
      });
    } finally {
      dialog.remove();
      style.remove();
    }
  }

  try {
    await chooseMode();
  } catch (error) {
    console.error(TAG, error);
  } finally {
    window[RUN_KEY] = false;
  }
})();
