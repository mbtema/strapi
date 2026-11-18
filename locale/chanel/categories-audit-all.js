(async function chanelAllCategoriesAudit() {
  'use strict';

  // CHANEL pipeline / этап 3: полные RU/KK Draft/Published snapshots 65 категорий.
  // Только GET. Нет PUT/POST, создания локалей или публикации.
  const TAG = '[CHANEL All Categories Audit]';
  const BRAND_UID = 'api::brand.brand';
  const CATEGORY_UID = 'api::category.category';
  const BRAND_ID = 'yeag7mng9hfpk7pd4ggm7495';
  const BASELINE_CATEGORY_COUNT = 65; // Источник: chanel-categories-ru.json
  const BRAND_PATH = '/admin/content-manager/collection-types/' + BRAND_UID + '/' + BRAND_ID;
  const PAGE_SIZE = 100;
  const RUN_KEY = '__tmChanelAllCategoriesAuditRunning';
  const SYSTEM = new Set(['id', 'documentId', 'locale', 'status', 'createdAt', 'updatedAt',
    'publishedAt', 'createdBy', 'updatedBy', 'localizations', '__pivot']);
  const MEDIA_FIELDS = new Set(['largeimage_app', 'larheImage', 'preview_picture', 'menu_banner']);
  const SOURCE_FIELDS = new Set(['active', 'custom', 'title', 'seo_name', 'code',
    'bitrix_id', 'sortOrder', 'detail_avaible_from', 'slug', 'description',
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
    version: 2,
    mode: 'read-only',
    records: [],
    summary: null,
    globalWarnings: [],
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

  // Сравнение вложенных компонентов по схеме: numeric id экземпляров и
  // локализованные KK media не означают необходимость перезаписать компонент.
  // Остальные несовпадения сохраняем как явный план, без записи в CMS.
  function componentDifferences(def, ru, kk, path, components, pending, mediaKept, review) {
    if (def.type === 'media') {
      if (present(kk)) {
        if (!same(ru?.id ?? ru, kk?.id ?? kk)) mediaKept.push(path);
      } else if (present(ru)) pending.push(path);
      return;
    }
    if (def.type === 'component' || def.type === 'dynamiczone') {
      const itemsRu = Array.isArray(ru) ? ru : ru == null ? [] : [ru];
      const itemsKk = Array.isArray(kk) ? kk : kk == null ? [] : [kk];
      if (itemsRu.length !== itemsKk.length) {
        pending.push(path + ' (количество)'); return;
      }
      for (let i = 0; i < itemsRu.length; i++) {
        const a = itemsRu[i], b = itemsKk[i], suffix = path + '[' + i + ']';
        const uid = def.type === 'dynamiczone' ? a?.__component : def.component;
        if (def.type === 'dynamiczone' && a?.__component !== b?.__component) {
          pending.push(suffix + ' (__component)'); continue;
        }
        const sc = components.get(uid);
        if (!sc) { review.push(suffix + ' (нет схемы ' + uid + ')'); continue; }
        if (!a || !b) { pending.push(suffix + ' (нет компонента)'); continue; }
        for (const [name, child] of Object.entries(attrs(sc))) {
          if (SYSTEM.has(name) || name === 'id') continue;
          const childPath = suffix + '.' + name;
          if (child.type === 'component' || child.type === 'dynamiczone' ||
              child.type === 'media') {
            componentDifferences(child, a[name], b[name], childPath, components,
              pending, mediaKept, review);
          } else if (child.type === 'relation') {
            const ar = a[name]?.count, br = b[name]?.count;
            if (ar !== br) pending.push(childPath + ' (count)');
            else if ((ar || 0) > 0) review.push(childPath + ' (сверить точные links)');
          } else if (!same(a[name], b[name])) {
            pending.push(childPath);
          }
        }
      }
      return;
    }
    if (!same(ru, kk)) pending.push(path);
  }

  function buildAudit(schema, components) {
    const ru = report.versions.ru.draft;
    const kk = report.versions.kk.draft;
    if (!ru) throw new Error('У категории отсутствует RU Draft');

    for (const [name, definition] of Object.entries(attrs(schema))) {
      if (SYSTEM.has(name)) continue;
      const a = fieldValue(ru, name), b = fieldValue(kk, name);
      if (definition.type === 'relation') {
        const source = ids(ru.relations[name]), target = ids(kk?.relations[name]);
        const decision = !kk ? 'missing_kk' :
          name === 'products' && source.length ? 'block_legacy_ru_products' :
          name === 'products' && target.length ? 'clear_legacy_kk_products' :
          same(source, target) ? 'same' : 'mirror_ru_relation';
        report.relationAudit.push({
          field: name, sourceCount: source.length, targetCount: kk ? target.length : null,
          sourceDocumentIds: source, targetDocumentIds: kk ? target : null, decision
        });
        if (name === 'products' && source.length) {
          report.warnings.push('Legacy products содержит RU связи, нужна отдельная проверка');
        }
        continue;
      }

      let decision;
      if (!kk) decision = 'create_kk_required';
      else if (name === 'name') decision =
        present(b) ? 'preserve_kk_translation' : (present(a) ? 'copy_ru_if_kk_empty' : 'same');
      else if (definition.type === 'media' || MEDIA_FIELDS.has(name)) decision =
        present(b) ? 'preserve_kk_media' : (present(a) ? 'copy_ru_media' : 'same');
      else if (name === 'key' && !same(a, b)) decision = 'unsafe_shared_key_review';
      else if (definition.type === 'component' || definition.type === 'dynamiczone' ||
          COMPONENT_FIELDS.has(name)) {
        const pending = [], mediaKept = [], review = [];
        componentDifferences(definition, a, b, name, components, pending, mediaKept, review);
        decision = pending.length ? 'mirror_ru_component_fields' :
          review.length ? 'review_nested_relations' :
          mediaKept.length ? 'preserve_kk_component_media' : 'same';
        if (pending.length) report.warnings.push(name + ': различия ' + pending.join(', '));
        if (review.length) report.warnings.push(name + ': требуют проверки ' + review.join(', '));
        if (mediaKept.length) report.warnings.push(name + ': сохраняем KK media ' + mediaKept.join(', '));
      }
      else if (same(a, b)) decision = 'same';
      else if (definition.pluginOptions?.i18n?.localized === true &&
          !SOURCE_FIELDS.has(name)) decision = 'review_other_localized_field';
      else decision = 'mirror_ru_field';

      report.fieldAudit.push({
        field: name, type: definition.type,
        localized: definition.pluginOptions?.i18n?.localized === true,
        ru: a === undefined ? null : a,
        kk: kk ? (b === undefined ? null : b) : null,
        decision
      });
      if (decision === 'unsafe_shared_key_review') {
        report.warnings.push('RU/KK Draft.key отличаются: запись запрещена до разбора i18n');
      }
    }
  }

  function download(filename, data) {
    const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)],
      { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 15000);
  }

  const panelId = 'tm-chanel-categories-audit-progress';
  document.getElementById(panelId)?.remove();
  const panel = document.createElement('div');
  panel.id = panelId;
  panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483600;' +
    'background:#202035;color:#fff;padding:12px 16px;border-radius:10px;' +
    'box-shadow:0 8px 25px #0008;font:13px/1.45 system-ui;min-width:250px';
  panel.textContent = 'CHANEL: подготовка аудита…';
  document.body.appendChild(panel);
  const progress = message => {
    panel.textContent = 'CHANEL · только GET · ' + message;
    console.log(TAG, message);
  };
  const quoteCsv = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
  function downloadCsv(filename, rows) {
    const keys = ['order','documentId','titleRU','titleKK','ruDraft','ruPublished','kkDraft',
      'kkPublished','fieldsToCopy','relationsToMirror','mediaToPreserve',
      'keyReview','nestedReview','errors','warnings'];
    const content = '\uFEFF' + [keys.map(quoteCsv).join(';'),
      ...rows.map(row => keys.map(k => quoteCsv(row[k])).join(';'))].join('\r\n');
    const href = URL.createObjectURL(new Blob([content],
      { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = href; link.download = filename;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 15000);
  }

  try {
    progress('Читаю список категорий бренда');
    const brandResponse = await get('/content-manager/collection-types/' +
      BRAND_UID + '/' + BRAND_ID + '?locale=ru&status=draft');
    if (brandResponse?.data?.documentId !== BRAND_ID ||
        brandResponse?.data?.locale !== 'ru') {
      throw new Error('Неверный RU Draft бренда CHANEL');
    }
    const source = await relations(BRAND_UID, BRAND_ID, 'categories', 'ru', 'draft');
    const count = brandResponse?.data?.categories?.count;
    if (Number.isSafeInteger(count) && source.length !== count) {
      throw new Error('Несовпадение relation count у бренда, повторите index');
    }
    if (source.length !== BASELINE_CATEGORY_COUNT) {
      throw new Error('Список категорий CHANEL изменился: ' + source.length +
        ' вместо ' + BASELINE_CATEGORY_COUNT + '. Сначала повторите categories-index.js');
    }
    report.brand.name = brandResponse.data.name;
    report.brand.categoriesCount = source.length;
    report.source = source.map((v, i) => ({
      order: i + 1, documentId: v.documentId, id: v.id, title: v.name
    }));

    const [types, comps] = await Promise.all([
      get('/content-manager/content-types'),
      get('/content-manager/components')
    ]);
    if (!Array.isArray(types.data) || !Array.isArray(comps.data)) {
      throw new Error('Content Manager не отдал схемы');
    }
    const schema = types.data.find(item => item.uid === CATEGORY_UID);
    if (!schema?.attributes) throw new Error('Схема Category не найдена');
    const components = new Map(comps.data.map(item => [item.uid, item]));
    report.schema = schema;
    // Сохраняем схемы компонентов, вложенных в Category.
    const wanted = new Set();
    const collect = sc => {
      for (const def of Object.values(attrs(sc))) {
        const names = def.type === 'component' ? [def.component] :
          def.type === 'dynamiczone' ? (def.components || []) : [];
        for (const uid of names) {
          if (wanted.has(uid)) continue;
          wanted.add(uid);
          const child = components.get(uid);
          if (child) collect(child);
          else report.globalWarnings.push('Нет схемы компонента ' + uid);
        }
      }
    };
    collect(schema);
    report.components = Object.fromEntries([...wanted].filter(uid => components.has(uid))
      .map(uid => [uid, components.get(uid)]));

    for (let i = 0; i < source.length; i++) {
      const current = source[i];
      report.category = {
        order: i + 1, documentId: current.documentId, id: current.id, title: current.name,
        url: new URL('/admin/content-manager/collection-types/' +
          CATEGORY_UID + '/' + current.documentId +
          '?plugins%5Bi18n%5D%5Blocale%5D=ru', location.origin).href
      };
      report.versions = {
        ru: { draft: null, published: null },
        kk: { draft: null, published: null }
      };
      report.fieldAudit = [];
      report.relationAudit = [];
      report.warnings = [];
      const entryStartedAt = new Date().toISOString();
      let failure = null;
      progress((i + 1) + '/' + source.length + ' · ' + current.documentId);
      try {
        for (const locale of ['ru', 'kk']) {
          for (const status of ['draft', 'published']) {
            report.versions[locale][status] = await readVersion(
              current.documentId, locale, status, schema, components);
          }
        }
        buildAudit(schema, components);
      } catch (error) {
        failure = error.message;
        report.errors.push({ order: i + 1, documentId: current.documentId, message: failure });
        console.error(TAG, '#' + (i + 1), current.documentId, error);
      }
      const row = {
        category: report.category, versions: report.versions, fieldAudit: report.fieldAudit,
        relationAudit: report.relationAudit, warnings: report.warnings, error: failure,
        startedAt: entryStartedAt, finishedAt: new Date().toISOString()
      };
      report.records.push(row);
      if ((i + 1) % 5 === 0 || failure) {
        const failures = report.records.filter(x => x.error).length;
        console.log(TAG, 'Снимки:', i + 1 + '/' + source.length,
          'ошибок:', failures, 'GET:', report.counters.GET);
      }
      // Ошибки авторизации нельзя повторять для остальных 65 записей.
      if (failure && /^GET HTTP (401|403)\b/.test(failure)) {
        throw new Error('Авторизация потеряна, аудит прерван после ' + (i + 1) +
          ' категорий; выгружаем полученные снимки');
      }
    }
  } catch (error) {
    report.errors.push({ scope: 'global', message: error.message });
    console.error(TAG, 'Чтение прервано, CMS не изменена:', error);
  } finally {
    const flags = new Set(['mirror_ru_field','mirror_ru_component_fields',
      'copy_ru_if_kk_empty','copy_ru_media','create_kk_required']);
    const csvRows = report.records.map(item => {
      const fields = item.fieldAudit.filter(x => flags.has(x.decision));
      const links = item.relationAudit.filter(x => !['same','missing_kk'].includes(x.decision));
      const kept = item.fieldAudit.filter(x =>
        ['preserve_kk_media','preserve_kk_component_media'].includes(x.decision));
      const keyReview = item.fieldAudit.filter(x => x.decision === 'unsafe_shared_key_review');
      const nestedReview = item.fieldAudit.filter(x => x.decision === 'review_nested_relations');
      return {
        order: item.category.order,
        documentId: item.category.documentId,
        titleRU: item.versions.ru.draft?.fields?.title ?? item.category.title,
        titleKK: item.versions.kk.draft?.fields?.title ?? '',
        ruDraft: Boolean(item.versions.ru.draft),
        ruPublished: Boolean(item.versions.ru.published),
        kkDraft: Boolean(item.versions.kk.draft),
        kkPublished: Boolean(item.versions.kk.published),
        fieldsToCopy: fields.map(x => x.field).join(', '),
        relationsToMirror: links.map(x => x.field + ':' + x.decision).join(', '),
        mediaToPreserve: kept.map(x => x.field).join(', '),
        keyReview: keyReview.length,
        nestedReview: nestedReview.map(x => x.field).join(', '),
        errors: item.error || '',
        warnings: item.warnings.length
      };
    });
    report.summary = {
      expected: BASELINE_CATEGORY_COUNT,
      processed: report.records.length,
      failed: report.records.filter(x => x.error).length,
      ruDraftMissing: csvRows.filter(x => !x.ruDraft).length,
      kkDraftMissing: csvRows.filter(x => !x.kkDraft).length,
      ruPublishedMissing: csvRows.filter(x => !x.ruPublished).length,
      kkPublishedMissing: csvRows.filter(x => !x.kkPublished).length,
      fieldsToCopy: csvRows.filter(x => x.fieldsToCopy).length,
      relationsToMirror: csvRows.filter(x => x.relationsToMirror).length,
      preservingMedia: csvRows.filter(x => x.mediaToPreserve).length,
      keyReview: csvRows.filter(x => x.keyReview).length,
      nestedReview: csvRows.filter(x => x.nestedReview).length,
      GET: report.counters.GET, retries: report.counters.retries
    };
    report.complete = report.records.length === BASELINE_CATEGORY_COUNT &&
      report.errors.length === 0 && !report.globalWarnings.length;
    report.finishedAt = new Date().toISOString();
    delete report.category;
    delete report.versions;
    delete report.fieldAudit;
    delete report.relationAudit;
    delete report.warnings;
    window.tmChanelAllCategoriesAudit = report;
    try {
      download('chanel-categories-audit-all.json', report);
      downloadCsv('chanel-categories-audit-all.csv', csvRows);
    } catch (error) {
      console.error(TAG, 'Ошибка выгрузки JSON/CSV:', error);
    }
    panel.textContent = 'CHANEL · ' + report.summary.processed + '/' +
      BASELINE_CATEGORY_COUNT + ' · ошибок: ' + report.summary.failed +
      ' · GET: ' + report.counters.GET + ' · CMS не менялась';
    console.table(csvRows);
    console.log(TAG, 'Итог:', report.summary, 'complete:', report.complete,
      'PUT/POST = 0. JSON и CSV выгружены.');
    window[RUN_KEY] = false;
  }
})();
