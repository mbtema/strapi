(async function chanelFirstCategoryPublishPilot() {
  'use strict';

  // CHANEL: первая категория, пилот Publish RU + KK с обязательным dry-run.
  // Не создаёт KK, не меняет Draft, не вызывает PUT. Только два POST publish.
  const TAG = '[CHANEL Pilot Publish]';
  const BRAND_UID = 'api::brand.brand';
  const CATEGORY_UID = 'api::category.category';
  const BRAND_ID = 'yeag7mng9hfpk7pd4ggm7495';
  const FIRST_CATEGORY_ID = 'adl0ggt49f808cv4j2xalioq'; // Первый documentId из проверенного JSON
  const BRAND_PATH = '/admin/content-manager/collection-types/' + BRAND_UID + '/' + BRAND_ID;
  const PAGE_SIZE = 100;
  const RUN_KEY = '__tmChanelFirstCategoryPublishPilotRunning';
  const SYSTEM = new Set(['id', 'documentId', 'locale', 'status', 'createdAt', 'updatedAt',
    'publishedAt', 'createdBy', 'updatedBy', 'localizations', '__pivot']);
  const MEDIA_FIELDS = new Set(['largeImage_app', 'largeImage', 'previewImage_app', 'preview_picture', 'menu_banner']);
  const SOURCE_FIELDS = new Set(['active', 'custom', 'title', 'seo_name', 'code',
    'bitrix_id', 'sortOrder', 'detail_available_from', 'slug', 'description',
    'key', 'customName', 'showProducts']);
  const COMPONENT_FIELDS = new Set(['productsLabelFilter', 'brandZoneBanners',
    'filters_app', 'dynamic']);

  const here = new URL(location.href);
  if (here.pathname !== BRAND_PATH ||
      here.searchParams.get('plugins[i18n][locale]') !== 'ru') {
    console.error(TAG, 'Откройте RU-страницу бренда CHANEL:', BRAND_PATH);
    return;
  }
  if (window[RUN_KEY]) {
    console.warn(TAG, 'Аудит уже выполняется');
    return;
  }
  window[RUN_KEY] = true;

  const report = {
    version: 1,
    mode: 'read-only',
    plan: null,
    phases: [],
    baselineHash: null,
    final: null,
    status: 'reading',
    createdAt: new Date().toISOString(),
    brand: { uid: BRAND_UID, documentId: BRAND_ID, locale: 'ru' },
    category: null,
    schema: null,
    components: {},
    versions: { ru: { draft: null, published: null }, kk: { draft: null, published: null } },
    fieldAudit: [],
    relationAudit: [],
    warnings: [],
    errors: [],
    counters: { GET: 0, retries: 0, relationPages: 0 },
    complete: false
  };

  // Export отчётов и предзаписных снимков: предыдущая версия пилота
  // не содержала эту функцию, поэтому dry-run завершался без JSON.
  function download(filename, data) {
    const content = JSON.stringify(data, null, 2);
    const href = URL.createObjectURL(new Blob([content],
      { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.append(link);
    try { link.click(); }
    finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 15000);
    }
  }

  // Durable browser journal: подтверждение завершения IndexedDB transaction
  // обязательно до каждого CMS POST. Даже при блокировке скачивания Chrome
  // сырые снимки останутся в браузере (но это не backup БД).
  const BACKUP_DB = 'tm-chanel-pilot-journal-v1';
  async function persistEvidence(stage, evidence) {
    if (!('indexedDB' in window)) throw new Error('IndexedDB недоступна');
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(BACKUP_DB, 1);
      request.onupgradeneeded = () => {
        const d = request.result;
        if (!d.objectStoreNames.contains('evidence')) {
          d.createObjectStore('evidence', { keyPath: 'id' });
        }
      };
      request.onerror = () => reject(request.error || Error('IndexedDB open error'));
      request.onblocked = () => reject(Error('IndexedDB open blocked'));
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const stored = { id: FIRST_CATEGORY_ID + ':' + new Date().toISOString() +
          ':' + stage, categoryId: FIRST_CATEGORY_ID, stage, at: new Date().toISOString(),
        evidence };
      await new Promise((resolve, reject) => {
        const tx = db.transaction('evidence', 'readwrite');
        tx.objectStore('evidence').put(stored);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || Error('IndexedDB write error'));
        tx.onabort = () => reject(tx.error || Error('IndexedDB transaction abort'));
      });
    } finally { db.close(); }
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const token = () => {
    const raw = localStorage.getItem('jwtToken');
    let jwt = raw;
    try { jwt = JSON.parse(raw); } catch {}
    if (typeof jwt !== 'string' || !jwt.trim()) {
      throw new Error('Нет jwtToken Strapi Admin');
    }
    return jwt.trim().replace(/^Bearer\s+/i, '');
  };

  async function get(path, allow404 = false) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      report.counters.GET++;
      let response;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        response = await fetch(path, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
          headers: { Authorization: 'Bearer ' + token(), Accept: 'application/json' }
        });
      } catch (error) {
        if (attempt === 3) throw new Error('GET network ' + path + ': ' + error.message);
        report.counters.retries++;
        await sleep(600 * attempt);
        continue;
      } finally {
        clearTimeout(timeout);
      }
      if (response.status === 404 && allow404) return null;
      if (!response.ok) {
        if (attempt < 3 && [408, 429, 500, 502, 503, 504].includes(response.status)) {
          report.counters.retries++;
          await sleep(800 * attempt);
          continue;
        }
        throw new Error('GET HTTP ' + response.status + ' ' + path);
      }
      const json = await response.json();
      if (!json || typeof json !== 'object') throw new Error('Неожиданный JSON ' + path);
      return json;
    }
    throw new Error('GET failed ' + path);
  }

  function parsePage(data, page, first) {
    const rows = data?.results, p = data?.pagination;
    if (!Array.isArray(rows) ||
        !Number.isSafeInteger(p?.total) || p.total < 0 ||
        !Number.isSafeInteger(p?.pageCount) || p.pageCount < 0 ||
        (p.total > 0 && (p.pageCount === 0 || rows.length === 0)) ||
        (p.page != null && Number(p.page) !== page) ||
        (first && (p.total !== first.total || p.pageCount !== first.pageCount))) {
      throw new Error('Недостоверная пагинация на странице ' + page);
    }
    return { rows, total: p.total, pageCount: p.pageCount };
  }

  async function paginated(path, query) {
    const out = [], seen = new Set();
    let first = null, page = 1;
    while (true) {
      const qs = new URLSearchParams({ ...query, page: String(page), pageSize: String(PAGE_SIZE) });
      const current = parsePage(await get(path + '?' + qs), page, first);
      first ||= current;
      for (const row of current.rows) {
        if (typeof row?.documentId !== 'string' || !row.documentId ||
            !Number.isSafeInteger(row?.id) || row.id <= 0 ||
            (row.locale != null && row.locale !== query.locale) ||
            seen.has(row.documentId)) {
          throw new Error('Relation без корректных ID, locale или дубли: ' + path);
        }
        seen.add(row.documentId);
        out.push({ id: row.id, documentId: row.documentId, locale: row.locale || query.locale,
          name: String(row.title || row.name || '') });
      }
      report.counters.relationPages++;
      if (page >= first.pageCount) break;
      page++;
      if (page > 10000) throw new Error('Слишком много страниц: ' + path);
    }
    if (out.length !== first.total) {
      throw new Error('Неполное чтение relations ' + path + ': ' + out.length + '/' + first.total);
    }
    return out;
  }

  function relations(uid, id, field, locale, status) {
    return paginated('/content-manager/relations/' + uid + '/' +
      encodeURIComponent(id) + '/' + encodeURIComponent(field), { locale, status });
  }

  function attrs(schema) {
    return schema && typeof schema.attributes === 'object' ? schema.attributes : {};
  }

  async function nestedRelations(value, schema, path, locale, status, components, collected) {
    if (value == null || !schema) return;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        await nestedRelations(value[i], schema, path + '[' + i + ']', locale, status,
          components, collected);
      }
      return;
    }
    if (typeof value !== 'object') return;

    for (const [field, definition] of Object.entries(attrs(schema))) {
      const fieldValue = value[field];
      const childPath = path + '.' + field;
      if (definition.type === 'relation') {
        const count = Number.isSafeInteger(fieldValue?.count) ? fieldValue.count : null;
        if (!Number.isSafeInteger(value.id) || value.id <= 0) {
          collected.push({ path: childPath, status: 'unverified_no_component_id',
            expectedCount: count, raw: fieldValue });
          report.warnings.push(childPath + ' (' + locale + '/' + status + '): нет numeric component id');
          continue;
        }
        // В Strapi Published-вложения могут вернуть 0 при фактическом count > 0.
        // Не трактуем такие ответы как отсутствие связей.
        try {
          const links = await relations(schema.uid, value.id, field, locale, status);
          const countMatches = count === null ? null : links.length === count;
          const trusted = status === 'draft' && countMatches === true;
          collected.push({ path: childPath, componentUid: schema.uid, componentId: value.id,
            expectedCount: count, links, countMatches,
            status: trusted ? 'verified_draft' : 'unverified' });
          if (!trusted) {
            report.warnings.push(childPath + ' (' + locale + '/' + status +
              '): вложенная relation не подтверждена полностью');
          }
        } catch (error) {
          collected.push({ path: childPath, componentUid: schema.uid, componentId: value.id,
            expectedCount: count, status: 'unverified_error', error: error.message });
          report.warnings.push(childPath + ' (' + locale + '/' + status + '): ' + error.message);
        }
      } else if (definition.type === 'component') {
        const component = components.get(definition.component);
        if (!component) {
          report.warnings.push('Неизвестная схема компонента ' + definition.component);
          continue;
        }
        await nestedRelations(fieldValue, component, childPath, locale, status, components,
          collected);
      } else if (definition.type === 'dynamiczone' && Array.isArray(fieldValue)) {
        for (let i = 0; i < fieldValue.length; i++) {
          const part = fieldValue[i];
          const component = components.get(part?.__component);
          if (!component) {
            report.warnings.push('Неизвестная схема Dynamic Zone ' + childPath + '[' + i + ']');
            continue;
          }
          await nestedRelations(part, component, childPath + '[' + i + ']', locale, status,
            components, collected);
        }
      }
    }
  }

  async function readVersion(documentId, locale, status, schema, components) {
    const path = '/content-manager/collection-types/' + CATEGORY_UID + '/' +
      encodeURIComponent(documentId) + '?locale=' + locale + '&status=' + status;
    const response = await get(path, true);
    const row = response?.data;
    if (row == null || (typeof row === 'object' && !Array.isArray(row) &&
        Object.keys(row).length === 0)) return null;
    if (!row || Array.isArray(row) ||
        row.documentId !== documentId || row.locale !== locale) {
      throw new Error('Неоднозначная версия ' + locale + '/' + status);
    }
    if (status === 'published' && !row.publishedAt) return null;

    const values = {};
    const links = {};
    const nested = [];
    for (const [field, definition] of Object.entries(attrs(schema))) {
      if (SYSTEM.has(field)) continue;
      if (!Object.hasOwn(row, field)) {
        report.warnings.push('Поле ' + field + ' отсутствует в ' + locale + '/' + status);
        continue;
      }
      if (definition.type === 'relation') {
        links[field] = await relations(CATEGORY_UID, documentId, field, locale, status);
        const count = row[field]?.count;
        if (Number.isSafeInteger(count) && links[field].length !== count) {
          throw new Error('Root relation ' + field + ' неполная: ' +
            locale + '/' + status + ' ' + links[field].length + '/' + count);
        }
      } else {
        values[field] = row[field];  // Исходный контент Media/Component/DZ без модификации.
        if (definition.type === 'component') {
          const component = components.get(definition.component);
          if (!component) throw new Error('Нет схемы ' + definition.component);
          await nestedRelations(row[field], component, field, locale, status, components, nested);
        } else if (definition.type === 'dynamiczone' && Array.isArray(row[field])) {
          for (let i = 0; i < row[field].length; i++) {
            const part = row[field][i];
            const component = components.get(part?.__component);
            if (!component) throw new Error('Нет схемы Dynamic Zone ' + part?.__component);
            await nestedRelations(part, component, field + '[' + i + ']', locale, status,
              components, nested);
          }
        }
      }
    }
    return {
      meta: { id: row.id, documentId: row.documentId, locale: row.locale,
        status: row.status, publishedAt: row.publishedAt, updatedAt: row.updatedAt },
      fields: values,
      relations: links,
      nestedRelations: nested,
      // Оригинальный ответ CM для последующего расследования проблем Strapi i18n.
      raw: row
    };
  }

  const comparable = input => {
    const recurse = value => {
      if (Array.isArray(value)) return value.map(recurse);
      if (!value || typeof value !== 'object') return value;
      const o = {};
      for (const key of Object.keys(value).sort()) {
        if (!SYSTEM.has(key)) o[key] = recurse(value[key]);
      }
      return o;
    };
    return JSON.stringify(recurse(input));
  };
  const present = value => value != null && value !== '' &&
    (!Array.isArray(value) || value.length > 0);
  const same = (a, b) => comparable(a) === comparable(b);
  const ids = values => (values || []).map(item => item.documentId).sort();
  const fieldValue = (ver, field) => ver?.fields?.[field];


  // Нет независимого DB backup: режим включается только при отдельном
  // подтверждении риска. JSON/IndexedDB снимки НЕ являются backup базы.
  const APPLY = window.tmChanelPilotApplyOnce === 'PUBLISH_BOTH';
  const RISK_ACK = window.tmChanelPilotNoDbBackupRiskAcceptedOnce === true;
  const CONFIRM_HASH = typeof window.tmChanelPilotBaselineHashOnce === 'string'
    ? window.tmChanelPilotBaselineHashOnce : null;
  delete window.tmChanelPilotApplyOnce;
  delete window.tmChanelPilotNoDbBackupRiskAcceptedOnce;
  delete window.tmChanelPilotDbBackupConfirmedOnce; // очистка устаревшего флага
  delete window.tmChanelPilotBaselineHashOnce;
  report.mode = APPLY ? 'apply-publish-both' : 'dry-run';
  report.noDbBackup = true;
  report.riskAcceptedForThisRun = APPLY && RISK_ACK;
  const stable = value => JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
  function assetId(value, path) {
    if (value === null) return null;
    const id = typeof value === 'object' ? value.id : value;
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Недостоверный media id: ' + path);
    return id;
  }
  function canonicalField(def, value, path, components) {
    if (value === undefined) throw new Error('Нет поля ' + path);
    if (value == null) return null;
    if (def.type === 'media') {
      if (def.multiple === true) {
        if (!Array.isArray(value)) throw new Error('Media array: ' + path);
        return value.map((v, i) => assetId(v, path + '[' + i + ']'));
      }
      return assetId(value, path);
    }
    if (def.type === 'component') {
      const component = x => canonicalComponent(def.component, x, path, components);
      if (def.repeatable) {
        if (!Array.isArray(value)) throw new Error('Component array: ' + path);
        return value.map((part, i) =>
          canonicalComponent(def.component, part, path + '[' + i + ']', components));
      }
      return component(value);
    }
    if (def.type === 'dynamiczone') {
      if (!Array.isArray(value)) throw new Error('DynamicZone array: ' + path);
      return value.map((part, i) => {
        if (!def.components?.includes(part?.__component)) {
          throw new Error('Неизвестный DZ ' + path + '[' + i + ']');
        }
        return { __component: part.__component,
          ...canonicalComponent(part.__component, part, path + '[' + i + ']', components) };
      });
    }
    if (def.type === 'relation') {
      // Only count=0 is acceptable in pilot; positive count needs verified links
      // and a separate tested publish payload (do not infer from count).
      const count = Number.isSafeInteger(value?.count) ? value.count :
        Array.isArray(value) ? value.length : (value?.id ? 1 : 0);
      if (count) throw new Error('Вложенная relation требует отдельного пилота: ' + path);
      return null;
    }
    if (['string','text','richtext','email','enumeration','json','blocks',
        'integer','biginteger','float','decimal','boolean','date','time',
        'datetime','uid'].includes(def.type)) return value;
    throw new Error('Неподдержанный тип ' + def.type + ': ' + path);
  }
  function canonicalComponent(uid, row, path, components) {
    if (row == null) return null;
    const sc = components.get(uid);
    if (!sc?.attributes || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('Некорректный компонент ' + path + ' ' + uid);
    }
    const result = {};
    for (const [name, def] of Object.entries(attrs(sc))) {
      if (SYSTEM.has(name)) continue;
      result[name] = canonicalField(def, row[name], path + '.' + name, components);
    }
    return result;
  }
  function canonicalVersion(version, schema, components) {
    if (!version) return null;
    const fields = {};
    for (const [name, def] of Object.entries(attrs(schema))) {
      if (SYSTEM.has(name) || def.type === 'relation') continue;
      fields[name] = canonicalField(def, version.fields[name], name, components);
    }
    const links = {};
    for (const [name, def] of Object.entries(attrs(schema))) {
      if (SYSTEM.has(name) || def.type !== 'relation') continue;
      const list = version.relations[name];
      if (!Array.isArray(list) || list.some(x => !x.documentId)) {
        throw new Error('Нет проверенного состава relation ' + name);
      }
      links[name] = list.map(x => x.documentId).sort();
    }
    return { fields, relations: links };
  }
  function mergeMedia(def, ru, kk, path, components, kept) {
    if (def.type === 'media') {
      if (def.multiple) {
        const keep = Array.isArray(kk) && kk.length > 0;
        if (keep && !same(ru, kk)) kept.push(path);
        return canonicalField(def, keep ? kk : ru, path, components);
      }
      const keep = kk != null;
      if (keep && !same(ru, kk)) kept.push(path);
      return canonicalField(def, keep ? kk : ru, path, components);
    }
    if (def.type === 'component' || def.type === 'dynamiczone') {
      const ruArr = Array.isArray(ru) ? ru : ru == null ? [] : [ru];
      const kkArr = Array.isArray(kk) ? kk : kk == null ? [] : [kk];
      if (ruArr.length !== kkArr.length) {
        throw new Error('Разная структура компонентов: ' + path);
      }
      const sourceKeys = new Set();
      const targetByKey = new Map();
      const getKey = (x, uid, p) => {
        if (!x || typeof x.key !== 'string' || !x.key.trim()) {
          throw new Error('Нет устойчивого key: ' + p);
        }
        return uid + ':' + x.key;
      };
      for (let i = 0; i < kkArr.length; i++) {
        const part = kkArr[i];
        const uid = def.type === 'dynamiczone' ? part?.__component : def.component;
        const k = getKey(part, uid, path + '[' + i + '] KK');
        if (targetByKey.has(k)) throw new Error('Дубли KK component key ' + k);
        targetByKey.set(k, part);
      }
      const out = [];
      for (let i = 0; i < ruArr.length; i++) {
        const part = ruArr[i];
        const uid = def.type === 'dynamiczone' ? part?.__component : def.component;
        const k = getKey(part, uid, path + '[' + i + '] RU');
        if (sourceKeys.has(k)) throw new Error('Дубли RU component key ' + k);
        sourceKeys.add(k);
        const old = targetByKey.get(k);
        if (!old) throw new Error('Нет KK component match ' + k);
        const sc = components.get(uid);
        if (!sc?.attributes) throw new Error('Нет схемы ' + uid);
        const merged = {};
        if (def.type === 'dynamiczone') merged.__component = uid;
        for (const [name, child] of Object.entries(attrs(sc))) {
          if (SYSTEM.has(name)) continue;
          const childPath = path + '[' + i + '].' + name;
          if (child.type === 'media' || child.type === 'component' || child.type === 'dynamiczone') {
            merged[name] = mergeMedia(child, part[name], old[name], childPath, components, kept);
          } else {
            merged[name] = canonicalField(child, part[name], childPath, components);
          }
        }
        out.push(merged);
      }
      if (sourceKeys.size !== targetByKey.size) {
        throw new Error('В KK есть непарные компоненты: ' + path);
      }
      if (def.type === 'component' && !def.repeatable) return out[0] ?? null;
      return out;
    }
    return canonicalField(def, ru, path, components);
  }
  // Проверяем опубликованную запись, НЕ требуя опубликованных target records.
  // Relations в Published могут быть подмножеством Draft из-за неопубликованных
  // связных записей. В Draft точный состав всех links остаётся обязательным.
  function publishedAssessment(snapshot, locale, schema, components) {
    const draft = snapshot[locale]?.draft;
    const published = snapshot[locale]?.published;
    if (!draft) throw new Error('Нет ' + locale + ' Draft для проверки');
    if (!published?.meta?.publishedAt) {
      return { locale, published: false, fieldsMatch: false,
        critical: ['missing-published'], missingPublishedLinks: {},
        unexpectedPublishedLinks: {}, requiresPublish: true, ok: false };
    }
    const d = canonicalVersion(draft, schema, components);
    const p = canonicalVersion(published, schema, components);
    const fieldDiffs = Object.keys(d.fields).filter(name =>
      stable(d.fields[name]) !== stable(p.fields[name]));
    const missingPublishedLinks = {}, unexpectedPublishedLinks = {};
    for (const name of Object.keys(d.relations)) {
      const draftIds = new Set(d.relations[name]);
      const pubIds = new Set(p.relations[name] ?? []);
      const missing = [...draftIds].filter(id => !pubIds.has(id));
      const unexpected = [...pubIds].filter(id => !draftIds.has(id));
      if (missing.length) {
        missingPublishedLinks[name] = { count: missing.length, documentIds: missing };
      }
      if (unexpected.length) {
        unexpectedPublishedLinks[name] = { count: unexpected.length, documentIds: unexpected };
      }
    }
    // Критичны только потеря полей/компонентов/media/key и новые лишние links.
    // Недостающие Published links — заметка о видимости целей, а не потеря
    // связи, если исходные links существуют в локальном Draft.
    const critical = [
      ...fieldDiffs.map(name => 'field:' + name),
      ...Object.keys(unexpectedPublishedLinks).map(name => 'unexpected-relation:' + name)
    ];
    const draftModified = draft.meta?.status === 'modified';
    return {
      locale, published: true, publishedAt: published.meta.publishedAt,
      fieldsMatch: fieldDiffs.length === 0, fieldDiffs,
      missingPublishedLinks, unexpectedPublishedLinks,
      draftModified, critical,
      // Modified требует нового Publish; missing relations само по себе нет.
      requiresPublish: critical.length > 0 || draftModified,
      ok: critical.length === 0 && !draftModified
    };
  }

  function previewPlan(snapshot, schema, components) {
    const ru = snapshot.ru.draft, kk = snapshot.kk.draft;
    if (!ru || !kk) throw new Error('Пилот предназначен только для существующих RU и KK Draft');
    if (!ru.fields.key || ru.fields.key !== kk.fields.key) {
      throw new Error('Блокировка: RU/KK Draft.key отсутствует или не совпадает');
    }
    if (ru.relations.products.length || kk.relations.products.length) {
      throw new Error('Legacy products должен быть пуст в обеих локалях');
    }
    const expectedKK = canonicalVersion(kk, schema, components);
    const expectedRU = canonicalVersion(ru, schema, components);
    const kept = [];
    const merged = { fields: {}, relations: expectedRU.relations };
    for (const [name, def] of Object.entries(attrs(schema))) {
      if (SYSTEM.has(name) || def.type === 'relation') continue;
      if (name === 'name') {
        merged.fields[name] = kk.fields[name]?.trim()
          ? canonicalField(def, kk.fields[name], name, components)
          : canonicalField(def, ru.fields[name], name, components);
      } else if (name === 'key') {
        // key вне нормализации: ожидается исходное значение KK, никакого RU -> KK.
        // Равенство RU/KK проверяется отдельно как safety gate первой Category.
        merged.fields[name] = expectedKK.fields[name];
      } else if (def.type === 'media' || def.type === 'component' || def.type === 'dynamiczone') {
        merged.fields[name] = mergeMedia(
          def, ru.fields[name], kk.fields[name], name, components, kept);
      } else {
        merged.fields[name] = canonicalField(def, ru.fields[name], name, components);
      }
    }
    const changes = [];
    for (const name of Object.keys(merged.fields)) {
      if (stable(expectedKK.fields[name]) !== stable(merged.fields[name])) changes.push(name);
    }
    for (const name of Object.keys(merged.relations)) {
      if (stable(expectedKK.relations[name]) !== stable(merged.relations[name])) {
        changes.push('relation:' + name);
      }
    }
    if (changes.length) {
      throw new Error('Пилот только для Publish без KK Save; отличия: ' + changes.join(', '));
    }
    if (report.warnings.some(x => !x.includes('сохраняем KK media'))) {
      throw new Error('Есть предупреждения аудита, публикация запрещена');
    }
    const ruPublication = publishedAssessment(snapshot, 'ru', schema, components);
    const kkPublication = publishedAssessment(snapshot, 'kk', schema, components);
    return {
      categoryId: FIRST_CATEGORY_ID,
      allowedActions: [
        ruPublication.requiresPublish ? 'publish-ru' : null,
        kkPublication.requiresPublish ? 'publish-kk' : null
      ].filter(Boolean),
      publication: { ru: ruPublication, kk: kkPublication },
      protectedKkMediaPaths: kept,
      rootLinksRU: expectedRU.relations,
      rootLinksKK: expectedKK.relations,
      ruDraft: expectedRU, kkDraft: expectedKK
    };
  }
  function publishPayload(locale, draft, schema, components) {
    const fields = canonicalVersion(draft, schema, components).fields;
    const payload = { locale };
    for (const [name, def] of Object.entries(attrs(schema))) {
      if (SYSTEM.has(name)) continue;
      if (def.type === 'relation') {
        payload[name] = { connect: [], disconnect: [] };
        continue;
      }
      const raw = draft.fields[name];
      if (def.required && (raw === null || raw === undefined || raw === '' ||
          Array.isArray(raw) && raw.length === 0)) {
        throw new Error('Обязательное поле пусто: ' + name);
      }
      payload[name] = fields[name];
    }
    return payload;
  }
  function digestData(snap, schema, components) {
    // Digest = four complete, canonical semantic versions. Include schema by UID
    // and stable format, not timestamps or component numeric instance IDs.
    return {
      categoryId: FIRST_CATEGORY_ID,
      schema: Object.keys(attrs(schema)).sort(),
      ru: { draft: canonicalVersion(snap.ru.draft, schema, components),
        published: canonicalVersion(snap.ru.published, schema, components) },
      kk: { draft: canonicalVersion(snap.kk.draft, schema, components),
        published: canonicalVersion(snap.kk.published, schema, components) }
    };
  }
  async function hashOf(snap, schema, components) {
    const serialized = stable(digestData(snap, schema, components));
    const bytes = new TextEncoder().encode(serialized);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  async function readSnapshot(schema, components, id) {
    const result = {ru: {draft: null, published: null},
      kk: {draft: null, published: null}};
    for (const locale of ['ru','kk']) {
      for (const status of ['draft','published']) {
        result[locale][status] = await readVersion(id, locale, status, schema, components);
      }
    }
    return result;
  }
  // Без автоповторов. Любая ошибка POST вызывает read-only after и GLOBAL STOP.
  // key никогда не нормализуется: Publish по известному CM контракту содержит
  // исходный Draft.key, postflight проверяет сохранность в обеих локалях.
  async function postPublish(locale, draft, schema, components) {
    const path = '/content-manager/collection-types/' + CATEGORY_UID + '/' +
      encodeURIComponent(FIRST_CATEGORY_ID) + '/actions/publish?locale=' + locale;
    report.counters.POST = (report.counters.POST || 0) + 1;
    const response = await fetch(path, {
      method: 'POST', credentials: 'include', cache: 'no-store',
      headers: { Authorization: 'Bearer ' + token(),
        Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(publishPayload(locale, draft, schema, components))
    });
    const body = await response.text();
    if (!response.ok) throw new Error('POST publish ' + locale + ' HTTP ' +
      response.status + ': ' + body.slice(0, 350));
    return response.status;
  }
  function checkAfter(before, after, locale, schema, components) {
    // Only published version of locale can change during its Publish.
    const b = digestData(before, schema, components);
    const a = digestData(after, schema, components);
    const changed = [];
    for (const lc of ['ru', 'kk']) for (const st of ['draft', 'published']) {
      if (lc === locale && st === 'published') continue;
      if (stable(b[lc][st]) !== stable(a[lc][st])) changed.push(lc + '/' + st);
    }
    if (changed.length) throw new Error('ОПАСНО: непредвиденный дрейф ' + changed.join(', '));
    const status = publishedAssessment(after, locale, schema, components);
    if (!status.ok) {
      throw new Error('Published ' + locale +
        ' не прошёл проверку полей/публикации: ' + status.critical.join(', ') +
        (status.draftModified ? ' (Draft остался modified)' : ''));
    }
    if (locale === 'kk' && stable(a.kk.draft) !== stable(b.kk.draft)) {
      throw new Error('ОПАСНО: изменение защищённого KK Draft');
    }
    return status;
  }

  let schema, components, current;
  try {
    if (APPLY && (!RISK_ACK || !/^[a-f0-9]{64}$/i.test(CONFIRM_HASH ?? ''))) {
      throw new Error('APPLY запрещён: нужен dry-run hash и отдельное согласие ' +
        'на публикацию без DB backup. Снимки JSON/IndexedDB не заменяют backup БД');
    }
    console.log(TAG, 'Проверяю связь категории с брендом');
    const brandResponse = await get('/content-manager/collection-types/' +
      BRAND_UID + '/' + BRAND_ID + '?locale=ru&status=draft');
    if (brandResponse?.data?.documentId !== BRAND_ID || brandResponse?.data?.locale !== 'ru') {
      throw new Error('Неверная RU запись CHANEL');
    }
    const linked = await relations(BRAND_UID, BRAND_ID, 'categories', 'ru', 'draft');
    if (linked.length !== 65 || linked[0]?.documentId !== FIRST_CATEGORY_ID) {
      throw new Error('CHANEL relation изменился, повторите аудит и обновите пилот');
    }
    report.category = { id: FIRST_CATEGORY_ID, title: linked[0].name, order: 1 };
    const [types, comps] = await Promise.all([
      get('/content-manager/content-types'), get('/content-manager/components')
    ]);
    schema = types?.data?.find(x => x.uid === CATEGORY_UID);
    if (!schema?.attributes || !Array.isArray(comps?.data)) throw new Error('Нет schema');
    components = new Map(comps.data.map(x => [x.uid, x]));
    report.schema = schema;
    // Final audit must be free of warnings about nested relations/schema.
    current = await readSnapshot(schema, components, FIRST_CATEGORY_ID);
    report.versions = current;
    const plan = previewPlan(current, schema, components);
    report.plan = {
      actions: plan.allowedActions, preserveKkMedia: plan.protectedKkMediaPaths,
      publication: plan.publication,
      validationBasis: 'RU/KK Draft; Published fields/key/media + status only',
      relationPublishedPolicy: 'subset of Draft; missing links informational',
      independentDbBackup: false, browserEvidenceRequired: true,
      requiresNoBackupRiskAcceptance: true, requiresManualApply: true,
      keyNormalization: 'skipped; original Draft.key retained and postflight checked'
    };
    report.baselineHash = await hashOf(current, schema, components);
    report.complete = true;
    report.status = plan.allowedActions.length ? 'ready' : 'verified-published';
    if (!APPLY) {
      if (!plan.allowedActions.length) report.final = current;
      console.log(TAG, 'DRY-RUN готов. POST=0. actions:', plan.allowedActions,
        'KK media:', plan.protectedKkMediaPaths,
        'Published relations visibility notes:',
        {ru: plan.publication.ru.missingPublishedLinks,
          kk: plan.publication.kk.missingPublishedLinks},
        'baselineHash:', report.baselineHash);
    } else {
      if (CONFIRM_HASH !== report.baselineHash) {
        throw new Error('Снимок изменился со времени dry-run. APPLY заблокирован');
      }
      if (plan.allowedActions.some(x => !['publish-ru','publish-kk'].includes(x))) {
        throw new Error('В пилоте разрешена только публикация');
      }
      // Снимки before сохраняются в IndexedDB до первого POST. Если браузер
      // запретит запись, скрипт завершится без изменения CMS.
      report.phases.push({ phase: 'preflight', at: new Date().toISOString(),
        verified: true, hash: report.baselineHash });
      await persistEvidence('before', { snapshot: current, report });
      download('chanel-pilot-before-' + FIRST_CATEGORY_ID + '.json', report);
      report.status = 'publishing';
      for (const locale of ['ru','kk']) {
        if (!plan.allowedActions.includes('publish-' + locale)) continue;
        const before = current;
        const fresh = await readSnapshot(schema, components, FIRST_CATEGORY_ID);
        const beforeHash = await hashOf(before, schema, components);
        const freshHash = await hashOf(fresh, schema, components);
        if (freshHash !== beforeHash) {
          throw new Error('Данные изменились перед публикацией ' + locale + ': stop');
        }
        report.phases.push({ phase: 'pending-publish-' + locale,
          at: new Date().toISOString(), beforeHash: freshHash });
        const pendingEvidence = { phase: 'pending-publish-' + locale, before: fresh,
          previousPhases: report.phases };
        await persistEvidence('pending-publish-' + locale, pendingEvidence);
        download('chanel-pilot-pending-' + locale + '-' + FIRST_CATEGORY_ID + '.json',
          pendingEvidence);
        let postError = null;
        try {
          await postPublish(locale, fresh[locale].draft, schema, components);
        } catch (error) { postError = error; }
        let after = null;
        try { after = await readSnapshot(schema, components, FIRST_CATEGORY_ID); }
        catch (error) { postError ||= error; }
        report.phases.push({ phase: 'after-publish-' + locale,
          at: new Date().toISOString(), after, postError: postError?.message ?? null });
        const afterEvidence = { before: fresh, after,
          postError: postError?.message ?? null };
        try {
          await persistEvidence('after-publish-' + locale, afterEvidence);
        } catch (journalError) {
          // Не продолжать другую локаль, если evidence потерян.
          postError ||= journalError;
          report.errors.push('Не удалось сохранить postflight journal: ' +
            journalError.message);
        }
        download('chanel-pilot-after-' + locale + '-' + FIRST_CATEGORY_ID + '.json',
          afterEvidence);
        if (!after) throw new Error('Не удалось получить postflight ' + locale + ': STOP');
        try {
          const publication = checkAfter(fresh, after, locale, schema, components);
          report.phases.push({ phase: 'publication-check-' + locale,
            at: new Date().toISOString(), ...publication });
        } catch (error) {
          report.status = 'integrity-stop';
          throw error;
        }
        if (postError) throw new Error('POST ' + locale +
          ' завершился неоднозначно: ' + postError.message +
          '. Не повторять автоматически');
        report.phases.push({ phase: 'verified-publish-' + locale,
          at: new Date().toISOString(), verified: true });
        current = after;
      }
      const finalRU = publishedAssessment(current, 'ru', schema, components);
      const finalKK = publishedAssessment(current, 'kk', schema, components);
      report.postflight = { ru: finalRU, kk: finalKK };
      if (!finalRU.ok || !finalKK.ok) {
        throw new Error('Финальная проверка Published fields/key/media/status не пройдена');
      }
      // Draft fields, media and root links verified by previewPlan before POST;
      // all non-target versions protected by checkAfter between each action.
      previewPlan(current, schema, components);
      report.final = current;
      report.status = 'success';
      console.log(TAG, 'SUCCESS: Draft RU/KK проверены, обе локали Published; ' +
        'разница visibility relations не блокирует', report.postflight);
    }
  } catch (error) {
    report.errors.push(error.message);
    if (report.status !== 'integrity-stop') report.status = 'blocked-or-unresolved';
    console.error(TAG, 'Остановлено:', error);
  } finally {
    report.finishedAt = new Date().toISOString();
    window.tmChanelCategoryPublishPilot = report;
    try {
      download('chanel-pilot-' + report.mode + '-' + FIRST_CATEGORY_ID + '.json', report);
    } catch (error) { console.error(TAG, 'Ошибка скачивания:', error); }
    window[RUN_KEY] = false;
    console.log(TAG, 'Итог:', report.status, 'GET:', report.counters.GET,
      'POST:', report.counters.POST || 0, 'PUT=0');
  }
})();
