// Одноразовый read-only аудит Product-отношений бренда DIOR для тестов RU → KK.
// Открыть RU-карточку DIOR в Strapi Admin и запустить файл в DevTools → Console.
// Загружает ВСЕ страницы products бренда, затем RU/KK detail каждого Product.
// Только GET; результат: CSV со всеми товарами + JSON с группами и статистикой.
// НИЧЕГО не создаёт, не сохраняет и не публикует.
(async () => {
  'use strict';

  const PREFIX = '[locale/dior-product-kk-candidates-audit]';
  const BRAND_UID = 'api::brand.brand';
  const PRODUCT_UID = 'api::product.product';
  const DIOR_DOCUMENT_ID = 'qw7sja6ffpbufvzub5maxyrl';
  const ROOT_ID = 'tm-dior-product-kk-audit';
  const GLOBAL_KEY = '__tmDiorProductKkAudit';
  const PAGE_SIZE = 100;
  const CONCURRENCY = 4;
  const MAX_RETRIES = 2;
  const SIMPLE_TYPES = new Set([
    'string', 'text', 'richtext', 'email', 'password', 'enumeration', 'json',
    'integer', 'biginteger', 'float', 'decimal', 'boolean',
    'date', 'time', 'datetime'
  ]);
  const SYSTEM_FIELDS = new Set([
    'id', 'documentId', 'locale', 'status', 'publishedAt',
    'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'localizations'
  ]);

  const match = location.pathname.match(
    /^\/admin\/content-manager\/collection-types\/api::brand\.brand\/([a-z0-9]+)\/?$/i
  );
  if (!match || match[1] !== DIOR_DOCUMENT_ID) {
    console.error(PREFIX, 'Открой RU-карточку бренда DIOR: ' + DIOR_DOCUMENT_ID);
    return;
  }
  const currentLocale = new URLSearchParams(location.search).get('plugins[i18n][locale]');
  if (currentLocale && currentLocale !== 'ru') {
    console.error(PREFIX, 'Открой RU-локаль бренда DIOR; сейчас: ' + currentLocale);
    return;
  }
  const previous = window[GLOBAL_KEY];
  if (previous?.running) {
    console.warn(PREFIX, 'Аудит уже выполняется.');
    return;
  }
  document.getElementById(ROOT_ID)?.remove();

  const raw = localStorage.getItem('jwtToken');
  let token;
  try { token = JSON.parse(raw); } catch { token = raw; }
  if (typeof token !== 'string' || !token.trim()) {
    console.error(PREFIX, 'Не найден действующий токен Strapi Admin.');
    return;
  }

  const state = {
    running: true, stopped: false, count: 0, total: 0,
    pages: 0, requests: 0, retries: 0, startedAt: Date.now()
  };
  window[GLOBAL_KEY] = state;

  function uiNode(tag, text) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    return el;
  }
  const panel = uiNode('section');
  panel.id = ROOT_ID;
  Object.assign(panel.style, {
    position: 'fixed', right: '16px', bottom: '16px',
    zIndex: '2147483647', padding: '16px', width: '390px',
    maxWidth: 'calc(100vw - 32px)', background: '#1b1b2c', color: '#fff',
    font: '13px/1.5 system-ui, sans-serif', borderRadius: '10px',
    border: '1px solid #5d59a3', boxShadow: '0 12px 36px #0007'
  });
  const title = uiNode('strong', 'DIOR → Product → тесты KK (только GET)');
  const line = uiNode('div', 'Читаем схему и products бренда…');
  line.style.marginTop = '10px';
  const progress = uiNode('div', '0 / ?');
  progress.style.marginTop = '8px';
  const barOuter = uiNode('div');
  Object.assign(barOuter.style, {
    height: '8px', borderRadius: '5px', marginTop: '8px',
    background: '#34344b', overflow: 'hidden'
  });
  const bar = uiNode('div');
  Object.assign(bar.style, {
    background: '#8e8cff', height: '100%', width: '0%'
  });
  barOuter.append(bar);
  const stats = uiNode('div', 'Ошибки: 0 · GET: 0');
  stats.style.marginTop = '8px';
  const stopButton = uiNode('button', 'Остановить');
  stopButton.type = 'button';
  Object.assign(stopButton.style, {
    borderRadius: '6px', marginTop: '12px', padding: '7px 12px',
    background: '#43416f', color: '#fff', border: '1px solid #9896c0',
    cursor: 'pointer'
  });
  stopButton.onclick = () => {
    if (state.running) {
      state.stopped = true;
      stopButton.disabled = true;
      stopButton.textContent = 'Останавливается…';
    } else {
      panel.remove();
    }
  };
  panel.append(title, line, progress, barOuter, stats, stopButton);
  document.body.append(panel);

  let lastDraw = 0;
  function draw(phase, force = false) {
    const now = Date.now();
    if (!force && now - lastDraw < 150) return;
    lastDraw = now;
    line.textContent = phase;
    progress.textContent = state.count + ' / ' + (state.total || '?') +
      (state.total ? ' (' + Math.floor(state.count / state.total * 100) + '%)' : '');
    bar.style.width = state.total
      ? (state.count / state.total * 100).toFixed(1) + '%' : '0%';
    stats.textContent = 'Страниц products: ' + state.pages +
      ' · GET: ' + state.requests +
      ' · Повторы: ' + state.retries +
      ' · Прошло: ' + Math.floor((now - state.startedAt) / 1000) + ' сек';
  }
  function assertRunning() {
    if (state.stopped) throw new Error('Остановлено пользователем');
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function get(path) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      assertRunning();
      state.requests++;
      let response;
      try {
        response = await fetch(path, {
          method: 'GET', credentials: 'include', cache: 'no-store',
          headers: {
            Accept: 'application/json',
            Authorization: 'Bearer ' + token
          }
        });
      } catch (error) {
        if (attempt === MAX_RETRIES) {
          throw new Error('Сетевой сбой GET ' + path + ': ' + error);
        }
        state.retries++;
        await sleep(500 * (attempt + 1));
        continue;
      }
      if (response.ok) {
        try { return { status: response.status, json: await response.json() }; }
        catch { throw new Error('Не JSON: GET ' + path); }
      }
      if (response.status === 404) return { status: 404, json: null };
      if (![429, 500, 502, 503, 504].includes(response.status) ||
          attempt === MAX_RETRIES) {
        const body = await response.text().catch(() => '');
        throw new Error('GET HTTP ' + response.status + ' ' + path +
          (body ? ' — ' + body.slice(0, 160) : ''));
      }
      state.retries++;
      await sleep(600 * (attempt + 1));
    }
    throw new Error('Недоступен GET ' + path);
  }

  function parsePagination(json, label, page, expectedTotal) {
    const pagination = json?.pagination ?? json?.meta?.pagination;
    const rows = json?.results ?? json?.data;
    const total = Number(pagination?.total);
    const pageCount = Number(pagination?.pageCount);
    if (!Array.isArray(rows) || !Number.isInteger(total) || total < 0 ||
        !Number.isInteger(pageCount) || pageCount < 0 ||
        (page > 1 && Number(pagination?.page) !== page) ||
        (expectedTotal !== null && total !== expectedTotal)) {
      throw new Error('Некорректная пагинация ' + label + ', страница ' + page);
    }
    if (pageCount === 0 && (total !== 0 || page !== 1)) {
      throw new Error('Некорректный pageCount ' + label);
    }
    if (rows.length === 0 && total > 0) {
      throw new Error('Пустая страница при ненулевом total: ' + label);
    }
    return { rows, total, pageCount };
  }
  async function loadBrandProducts() {
    const all = [], seen = new Set();
    let page = 1, pages = 1, expectedTotal = null;
    while (page <= pages) {
      assertRunning();
      const url = '/content-manager/relations/' + BRAND_UID + '/' +
        DIOR_DOCUMENT_ID + '/products?locale=ru&page=' + page +
        '&pageSize=' + PAGE_SIZE;
      const { status, json } = await get(url);
      if (status !== 200) throw new Error('Не удалось загрузить relation brand.products');
      const result = parsePagination(json, 'brand.products', page, expectedTotal);
      if (expectedTotal === null) expectedTotal = result.total;
      if (page > 1 && result.pageCount !== pages) {
        throw new Error('Изменилось число страниц brand.products во время аудита');
      }
      pages = result.pageCount;
      for (const item of result.rows) {
        const documentId = item?.documentId ?? item?.attributes?.documentId;
        if (typeof documentId !== 'string' || !/^[a-z0-9]+$/i.test(documentId) ||
            seen.has(documentId)) {
          throw new Error('Некорректный/повторный product documentId: ' + documentId);
        }
        seen.add(documentId);
        all.push({
          documentId,
          relationName: item?.name ?? item?.attributes?.name ?? ''
        });
      }
      state.pages = page;
      draw('Чтение products бренда DIOR (' + all.length + '/' + expectedTotal + ')', true);
      page++;
    }
    if (all.length !== expectedTotal) {
      throw new Error('Неполный relation brand.products: ' +
        all.length + ' из ' + expectedTotal);
    }
    return all;
  }

  function kkState(result, documentId) {
    if (result.status === 404) return 'missing';
    const data = result.json?.data;
    if (result.status === 200 && data && typeof data === 'object' &&
        !Array.isArray(data) && Object.keys(data).length === 0) return 'missing';
    if (result.status === 200 &&
        data?.documentId === documentId && data?.locale === 'kk') return 'exists';
    return 'unverified';
  }
  function hasValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }
  function mediaInfo(value) {
    if (value == null) return { count: 0, valid: true };
    const asArray = Array.isArray(value) ? value : [value];
    return {
      count: asArray.length,
      valid: asArray.every(x =>
        (Number.isInteger(x) && x > 0) ||
        (x && typeof x === 'object' &&
          Number.isInteger(x.id) && x.id > 0))
    };
  }
  function classifyProduct(detail, schema) {
    const blockers = [], mediaNames = [], componentNames = [];
    const relationNames = [], relationUnknown = [];
    let relationTotal = 0, sharedCount = 0;
    for (const [name, attr] of Object.entries(schema.attributes)) {
      if (SYSTEM_FIELDS.has(name)) continue;
      const type = attr?.type;
      const relation = type === 'relation';
      if (relation) {
        // У Strapi i18n relations локализуются по умолчанию.
        if (attr.target?.startsWith('api::')) {
          const val = detail[name];
          const count = val?.count;
          if (Number.isInteger(count) && count >= 0) {
            relationTotal += count;
            if (count > 0) relationNames.push(name + ':' + count);
          } else {
            relationUnknown.push(name);
          }
        }
        continue;
      }
      if (attr?.pluginOptions?.i18n?.localized === true || type === 'uid') continue;
      sharedCount++;
      if (!Object.prototype.hasOwnProperty.call(detail, name)) {
        blockers.push('нет RU-поля ' + name);
        continue;
      }
      const value = detail[name];
      if (attr.required === true && !hasValue(value)) {
        blockers.push('required пуст: ' + name);
      }
      if (value == null) continue;
      if (SIMPLE_TYPES.has(type)) {
        if (type !== 'json' && typeof value === 'object') {
          blockers.push('неожиданный тип ' + name);
        }
        continue;
      }
      if (type === 'media') {
        const info = mediaInfo(value);
        if (!info.valid) blockers.push('media ID недоступен: ' + name);
        if (info.count > 0) mediaNames.push(name + ':' + info.count);
        continue;
      }
      if (type === 'component' || type === 'dynamiczone') {
        if (Array.isArray(value) && value.length === 0) continue;
        if (!hasValue(value)) continue;
        componentNames.push(name);
        blockers.push('непустой общий ' + type + ': ' + name);
        continue;
      }
      blockers.push('неизвестный тип поля ' + name + ':' + type);
    }
    if (relationUnknown.length) blockers.push('нет counts relations: ' + relationUnknown.join(','));
    return {
      blockers, mediaNames, componentNames, relationNames,
      relationTotal, sharedCount
    };
  }

  async function examine(item, schema) {
    const path = '/content-manager/collection-types/' + PRODUCT_UID + '/' +
      encodeURIComponent(item.documentId);
    const [ruReply, kkReply] = await Promise.all([
      get(path + '?locale=ru'),
      get(path + '?locale=kk')
    ]);
    const ru = ruReply.json?.data;
    if (ruReply.status !== 200 ||
        ru?.documentId !== item.documentId || ru?.locale !== 'ru') {
      throw new Error('RU detail не подтверждён: ' + item.documentId);
    }
    const localeState = kkState(kkReply, item.documentId);
    const profile = classifyProduct(ru, schema);
    const ready = localeState === 'missing' &&
      ru.status === 'published' && profile.blockers.length === 0;
    let scenario;
    if (localeState === 'exists') scenario = 'KK_EXISTS';
    else if (localeState === 'unverified') scenario = 'KK_UNVERIFIED';
    else if (ru.status !== 'published') scenario = 'RU_NOT_PUBLISHED_OR_MODIFIED';
    else if (profile.componentNames.length) scenario = 'BLOCKED_COMPONENTS';
    else if (profile.blockers.length) scenario = 'BLOCKED_FIELDS';
    else if (profile.mediaNames.length) scenario = 'READY_MEDIA';
    else if (profile.relationTotal > 2) scenario = 'READY_MORE_RELATIONS';
    else scenario = 'READY_SIMPLE';
    return {
      documentId: item.documentId,
      name: ru.name ?? item.relationName ?? '',
      ruStatus: ru.status ?? 'unknown',
      kkState: localeState,
      scenario, ready,
      sharedFields: profile.sharedCount,
      media: profile.mediaNames.join(', '),
      components: profile.componentNames.join(', '),
      relatedCount: profile.relationTotal,
      nonemptyRelations: profile.relationNames.join(', '),
      blockers: profile.blockers.join(' | '),
      ruUrl: location.origin + '/admin/content-manager/collection-types/' +
        PRODUCT_UID + '/' + item.documentId + '?plugins[i18n][locale]=ru'
    };
  }

  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 6000);
  }
  function exportCSV(rows) {
    const headers = [
      'scenario', 'documentId', 'name', 'ruStatus', 'kkState',
      'ready', 'sharedFields', 'media', 'components', 'relatedCount',
      'nonemptyRelations', 'blockers', 'ruUrl'
    ];
    function quoted(value) {
      let s = String(value ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    }
    const csv = [headers.join(';'), ...rows.map(row =>
      headers.map(key => quoted(row[key])).join(';'))].join('\n');
    download('dior-product-kk-test-candidates.csv',
      new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  }
  function exportJSON(payload) {
    download('dior-product-kk-test-candidates.json',
      new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8'
      }));
  }
  function finish(text, isError = false) {
    state.running = false;
    line.textContent = text;
    line.style.color = isError ? '#ff9d9d' : '#c7ffc7';
    stopButton.textContent = 'Закрыть';
    stopButton.disabled = false;
    stopButton.onclick = () => panel.remove();
    draw(text, true);
  }

  try {
    const schemaReply = await get('/content-manager/content-types');
    const productSchema = schemaReply.json?.data?.find(x => x?.uid === PRODUCT_UID);
    const brandSchema = schemaReply.json?.data?.find(x => x?.uid === BRAND_UID);
    if (!productSchema?.attributes ||
        productSchema.pluginOptions?.i18n?.localized !== true ||
        brandSchema?.attributes?.products?.type !== 'relation' ||
        brandSchema.attributes.products.target !== PRODUCT_UID) {
      throw new Error('Не совпадает проверенная схема Brand.products → Product/i18n.');
    }
    const products = await loadBrandProducts();
    state.total = products.length;
    state.count = 0;
    const rows = new Array(products.length);
    let next = 0;
    let failed = null;
    const workers = Array.from({ length: Math.min(CONCURRENCY, products.length) },
      async () => {
        while (!failed && !state.stopped) {
          const index = next++;
          if (index >= products.length) return;
          try {
            rows[index] = await examine(products[index], productSchema);
            state.count++;
            draw('Проверка RU + KK каждого товара DIOR');
          } catch (error) {
            failed = error;
            return;
          }
        }
      });
    await Promise.all(workers);
    if (failed) throw failed;
    assertRunning();
    if (state.count !== products.length || rows.some(x => !x)) {
      throw new Error('Неполный результат проверки товаров: ' +
        state.count + '/' + products.length);
    }

    const counts = {};
    for (const row of rows) counts[row.scenario] = (counts[row.scenario] || 0) + 1;
    const scenarioPriority = [
      'READY_SIMPLE', 'READY_MEDIA', 'READY_MORE_RELATIONS',
      'BLOCKED_COMPONENTS', 'BLOCKED_FIELDS',
      'RU_NOT_PUBLISHED_OR_MODIFIED', 'KK_UNVERIFIED', 'KK_EXISTS'
    ];
    const sorted = [...rows].sort((a, b) => {
      const left = scenarioPriority.indexOf(a.scenario);
      const right = scenarioPriority.indexOf(b.scenario);
      return left - right || a.documentId.localeCompare(b.documentId);
    });
    const picks = {};
    for (const group of scenarioPriority) {
      picks[group] = sorted.filter(row => row.scenario === group).slice(0, 10);
    }
    const report = {
      tool: 'dior-product-kk-candidates-audit',
      readOnly: true,
      generatedAt: new Date().toISOString(),
      adminOrigin: location.origin,
      brandDocumentId: DIOR_DOCUMENT_ID,
      brandLocale: 'ru',
      sourceRelation: 'products',
      totalProducts: products.length,
      checked: state.count,
      requests: state.requests,
      retries: state.retries,
      scenarioCounts: counts,
      readyCount: sorted.filter(row => row.ready).length,
      suggestedSamples: picks,
      rows: sorted
    };
    window.tmDiorProductKkCandidates = report;
    console.table(Object.entries(counts).map(([scenario, count]) =>
      ({ scenario, count })));
    console.table(sorted.filter(row => row.ready).slice(0, 15)
      .map(({ documentId, name, scenario, media, nonemptyRelations, ruUrl }) =>
        ({ documentId, name, scenario, media, nonemptyRelations, ruUrl })));
    exportCSV(sorted);
    exportJSON(report);
    finish('Готово: ' + state.count + ' товаров. Готовы к пилотам: ' +
      report.readyCount + '. Скачаны CSV и JSON.');
    console.log(PREFIX, 'Результат: window.tmDiorProductKkCandidates');
  } catch (error) {
    finish(state.stopped ? 'Остановлено. Итоговые файлы не создавались.' :
      'Аудит прерван: ' + (error?.message || error) +
      '. Неполный CSV не создавался.', !state.stopped);
    if (!state.stopped) console.error(PREFIX, error);
  }
})();