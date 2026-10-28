(async () => {
  'use strict';

  const CFG = {
    uid: 'api::product.product', field: 'attributes',
    source: 'ru', target: 'kk', pageSize: 100,
    adaptive: { min: 5, start: 10, max: 40, step: 5, sampleSize: 30, minGain: 0.03, lockAfter: 2 }
  };
  const KEY = '__tmProductAttributesAudit';
  const PREFIX = '[attributes-audit]';
  if (window[KEY]?.running) {
    console.warn(PREFIX, 'Проверка уже запущена');
    return;
  }
  document.getElementById('tm-attributes-audit')?.remove();

  const state = {
    running: true, stopped: false, started: performance.now(),
    phaseStarted: performance.now(), phase: 'Подготовка', done: 0, total: 0,
    errors: 0, lastSpeed: 0, concurrency: CFG.adaptive.start,
    bestConcurrency: CFG.adaptive.start, bestSpeed: 0, stageDone: 0,
    stageMs: 0, underperforming: 0, locked: false, waves: 0,
    benchmark: [], duplicateRuRows: 0, duplicateKkRows: 0
  };
  window[KEY] = state;

  const raw = localStorage.getItem('jwtToken');
  if (!raw) throw new Error('Не найден jwtToken');
  let token;
  try { token = JSON.parse(raw); } catch { token = raw; }
  if (typeof token !== 'string') throw new Error('Неверный формат jwtToken');

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const formatSeconds = value => {
    if (!Number.isFinite(value)) return '—';
    const n = Math.max(0, Math.ceil(value));
    const h = Math.floor(n / 3600), m = Math.floor(n % 3600 / 60), s = n % 60;
    return h ? `${h}ч ${m}м ${s}с` : m ? `${m}м ${s}с` : `${s}с`;
  };

/* @runtime progress */
  async function get(path) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(path, {
          credentials: 'include',
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
        });
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}: ${path}`);
          error.status = response.status;
          error.transient = response.status === 429 || response.status >= 500;
          throw error;
        }
        return await response.json();
      } catch (error) {
        lastError = error;
        if (error.message === 'STOPPED') throw error;
        const retryable = error.transient || error instanceof TypeError;
        if (!retryable || attempt === 3) break;
        await sleep(400 * attempt);
      }
    }
    throw lastError;
  }

  function rowsOf(json) {
    const rows = json?.results ?? json?.data;
    if (!Array.isArray(rows)) throw new Error('Неожиданный формат ответа Content Manager API');
    return rows;
  }
  const paginationOf = json => json.pagination ?? json.meta?.pagination;
  function pageUrl(base, locale, page, sort = false) {
    const params = new URLSearchParams({
      locale, page: String(page), pageSize: String(CFG.pageSize)
    });
    if (sort) params.set('sort', 'id:asc');
    return `${base}?${params}`;
  }

/* @runtime adaptive */
  async function loadProducts(locale) {
    const base = `/content-manager/collection-types/${CFG.uid}`;
    const first = await get(pageUrl(base, locale, 1, true));
    const pagination = paginationOf(first);
    if (!pagination || !Number.isInteger(Number(pagination.pageCount))) {
      throw new Error(`Не получена пагинация Product ${locale}`);
    }
    const pageCount = Number(pagination.pageCount);
    beginPhase(`Загрузка Product · ${locale}`, pageCount);
    state.done = 1;
    render();
    const pages = Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => index + 2);
    const chunks = await adaptiveRun(pages, page => get(pageUrl(base, locale, page, true)));
    const products = [...rowsOf(first), ...chunks.flatMap(rowsOf)];
    const ids = new Set();
    let duplicates = 0;
    for (const product of products) {
      if (!product.documentId) throw new Error(`Product без documentId · ${locale}`);
      if (ids.has(product.documentId)) duplicates++;
      ids.add(product.documentId);
    }
    if (locale === CFG.source) state.duplicateRuRows = duplicates;
    else state.duplicateKkRows = duplicates;
    console.log(PREFIX, `Product ${locale}: ${products.length} строк, ${ids.size} уникальных documentId, ${duplicates} повторов`);
    return ids;
  }

  async function getAttributes(documentId, locale) {
    const base = `/content-manager/relations/${CFG.uid}/${encodeURIComponent(documentId)}/${CFG.field}`;
    const ids = new Set();
    let page = 1;
    while (true) {
      const json = await get(pageUrl(base, locale, page));
      const rows = rowsOf(json);
      for (const item of rows) {
        if (!item.documentId) throw new Error(`Attribute без documentId: ${documentId}/${locale}`);
        ids.add(item.documentId);
      }
      const pagination = paginationOf(json);
      if (pagination?.pageCount != null) {
        if (page >= Number(pagination.pageCount)) break;
      } else if (rows.length < CFG.pageSize) break;
      if (!rows.length) break;
      page++;
    }
    return ids;
  }

  try {
    console.log(PREFIX, 'Начало read-only проверки attributes');
    const ru = await loadProducts(CFG.source);
    const kk = await loadProducts(CFG.target);
    const common = [...ru].filter(documentId => kk.has(documentId));
    const counts = {
      ruProducts: ru.size, kkProducts: kk.size,
      missingKkProducts: ru.size - common.length,
      onlyKkProducts: kk.size - common.length,
      checked: 0, matching: 0, different: 0,
      missingAttributesInKk: 0, extraAttributesInKk: 0, readErrors: 0
    };
    beginPhase('Сравнение attributes · RU ↔ KK', common.length);
    await adaptiveRun(common, async documentId => {
      try {
        const [ruAttributes, kkAttributes] = await Promise.all([
          getAttributes(documentId, CFG.source),
          getAttributes(documentId, CFG.target)
        ]);
        let missing = 0, extra = 0;
        for (const id of ruAttributes) if (!kkAttributes.has(id)) missing++;
        for (const id of kkAttributes) if (!ruAttributes.has(id)) extra++;
        counts.checked++;
        if (missing || extra) {
          counts.different++;
          counts.missingAttributesInKk += missing;
          counts.extraAttributesInKk += extra;
        } else counts.matching++;
      } catch (error) {
        counts.readErrors++;
        throw error;
      }
    });
    state.phase = 'Проверка завершена';
    render();
    console.log(PREFIX, 'Итоговые счётчики');
    console.table({
      'Product RU': counts.ruProducts,
      'Product KK': counts.kkProducts,
      'Повторов строк RU': state.duplicateRuRows,
      'Повторов строк KK': state.duplicateKkRows,
      'Отсутствует локаль KK': counts.missingKkProducts,
      'Есть только в KK': counts.onlyKkProducts,
      'Проверено пар': counts.checked,
      'Attributes совпадают': counts.matching,
      'Attributes отличаются': counts.different,
      'Связей не хватает в KK': counts.missingAttributesInKk,
      'Лишние связи в KK': counts.extraAttributesInKk,
      'Всего проблемных RU товаров': counts.different + counts.missingKkProducts,
      'Ошибок чтения': counts.readErrors
    });
    console.log(PREFIX, 'Время:', formatSeconds((performance.now() - state.started) / 1000),
      '| benchmark волн:', state.waves);
    el('[data-stop]').textContent = 'Закрыть';
    el('[data-stop]').disabled = false;
    el('[data-stop]').onclick = () => panel.remove();
  } catch (error) {
    state.phase = state.stopped ? 'Остановлено пользователем' : 'Проверка прервана';
    render();
    if (!state.stopped) console.error(PREFIX, error);
    el('[data-stop]').textContent = 'Закрыть';
    el('[data-stop]').disabled = false;
    el('[data-stop]').onclick = () => panel.remove();
  } finally {
    state.running = false;
  }
})();
