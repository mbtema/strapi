
(async () => {
  'use strict';

  const ATTRIBUTE_UID = 'api::attribute.attribute';
  const PRODUCT_UID = 'api::product.product';
  const HEADERS = ['documentId', 'barcode', 'price', 'errorType'];
  const invalidRows = [];

const LOCALE = 'ru';
const PAGE_SIZE = 100;

const READ_ADAPTIVE = {
  min: 5,
  start: 10,
  max: 60,
  step: 5,
  growAfterSuccesses: 50,
  minThroughputGainRatio: 0.03,
  underperformingLevelsBeforeLock: 2
};

const READ_RETRY = {
  attempts: 3,
  baseDelayMs: 300,
  maxDelayMs: 1500
};

const readMetrics = {
  requests: 0,
  retries: 0,
  transientEvents: 0
};

const getAdminToken = () => {
  const raw = localStorage.getItem('jwtToken');
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed : raw;
  } catch {
    return raw.replace(/^"|"$/g, '');
  }
};

const adminToken = getAdminToken();
if (!adminToken) throw new Error('Не найден jwtToken в LocalStorage');

const headers = {
  Accept: 'application/json',
  Authorization: `Bearer ${adminToken}`
};

const getRows = json => Array.isArray(json?.results)
  ? json.results
  : Array.isArray(json?.data)
    ? json.data
    : [];

const getPagination = json => json?.pagination ?? json?.meta?.pagination ?? null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const isTransientStatus = status =>
  status === 429 || status >= 500;

async function getJson(url, label) {
  let lastError = null;

  for (let attempt = 1; attempt <= READ_RETRY.attempts; attempt++) {
    let response;

    readMetrics.requests++;

    try {
      response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers
      });
    } catch (error) {
      const wrapped = new Error(
        `${label}: network error — ${error?.message || String(error)}`
      );
      wrapped.transient = true;
      lastError = wrapped;

      if (attempt >= READ_RETRY.attempts) {
        throw wrapped;
      }

      readMetrics.retries++;
      readMetrics.transientEvents++;

      await sleep(
        Math.min(
          READ_RETRY.maxDelayMs,
          READ_RETRY.baseDelayMs * (2 ** (attempt - 1))
        )
      );
      continue;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const error = new Error(
        `${label}: HTTP ${response.status}${body ? ` — ${body.slice(0, 250)}` : ''}`
      );
      error.status = response.status;
      error.transient = isTransientStatus(response.status);
      lastError = error;

      if (!error.transient || attempt >= READ_RETRY.attempts) {
        throw error;
      }

      readMetrics.retries++;
      readMetrics.transientEvents++;

      await sleep(
        Math.min(
          READ_RETRY.maxDelayMs,
          READ_RETRY.baseDelayMs * (2 ** (attempt - 1))
        )
      );
      continue;
    }

    try {
      return await response.json();
    } catch (error) {
      throw new Error(
        `${label}: Content Manager вернул некорректный JSON — ${error?.message || String(error)}`
      );
    }
  }

  throw lastError || new Error(`${label}: unknown read error`);
}

function createAdaptiveState() {
  return {
    current: READ_ADAPTIVE.start,
    bestConcurrency: READ_ADAPTIVE.start,
    bestThroughput: 0,
    underperformingLevels: 0,
    tuned: false,
    stageRequests: 0,
    stageSuccesses: 0,
    stageWallMs: 0,
    waves: []
  };
}

function resetAdaptiveStage(adaptiveState) {
  adaptiveState.stageRequests = 0;
  adaptiveState.stageSuccesses = 0;
  adaptiveState.stageWallMs = 0;
}

function resetAdaptiveBenchmark(adaptiveState) {
  resetAdaptiveStage(adaptiveState);
  adaptiveState.bestConcurrency = adaptiveState.current;
  adaptiveState.bestThroughput = 0;
  adaptiveState.underperformingLevels = 0;
  adaptiveState.tuned = false;
}

function evaluateAdaptiveStage(adaptiveState) {
  if (
    adaptiveState.tuned ||
    adaptiveState.stageSuccesses < READ_ADAPTIVE.growAfterSuccesses ||
    adaptiveState.stageRequests <= 0 ||
    adaptiveState.stageWallMs <= 0
  ) {
    return {
      evaluated: false,
      action: '',
      stageThroughput: null
    };
  }

  const stageThroughput = Number(
    (
      adaptiveState.stageRequests /
      (adaptiveState.stageWallMs / 1000)
    ).toFixed(2)
  );

  const currentLevel = adaptiveState.current;
  let action = '';

  if (adaptiveState.bestThroughput === 0) {
    adaptiveState.bestThroughput = stageThroughput;
    adaptiveState.bestConcurrency = currentLevel;
    adaptiveState.underperformingLevels = 0;
    action = 'baseline';
  } else {
    const required =
      adaptiveState.bestThroughput *
      (1 + READ_ADAPTIVE.minThroughputGainRatio);

    if (stageThroughput >= required) {
      adaptiveState.bestThroughput = stageThroughput;
      adaptiveState.bestConcurrency = currentLevel;
      adaptiveState.underperformingLevels = 0;
      action = 'new-best';
    } else {
      adaptiveState.underperformingLevels++;

      const shouldLock =
        adaptiveState.underperformingLevels >=
          READ_ADAPTIVE.underperformingLevelsBeforeLock ||
        currentLevel >= READ_ADAPTIVE.max;

      if (shouldLock) {
        adaptiveState.current = adaptiveState.bestConcurrency;
        adaptiveState.tuned = true;
        action = 'lock-best';
        resetAdaptiveStage(adaptiveState);

        return {
          evaluated: true,
          action,
          stageThroughput
        };
      }

      action = 'probe-next';
    }
  }

  if (adaptiveState.current < READ_ADAPTIVE.max) {
    adaptiveState.current = Math.min(
      READ_ADAPTIVE.max,
      adaptiveState.current + READ_ADAPTIVE.step
    );
  } else {
    adaptiveState.tuned = true;
    action = action || 'lock-max';
  }

  resetAdaptiveStage(adaptiveState);

  return {
    evaluated: true,
    action,
    stageThroughput
  };
}

async function runAdaptiveRead(
  items,
  adaptiveState,
  worker,
  options = {}
) {
  const output = new Array(items.length);
  const label = options.label || 'read';
  const onWave =
    typeof options.onWave === 'function'
      ? options.onWave
      : null;

  let cursor = 0;
  let wave = 0;

  while (cursor < items.length) {
    wave++;

    const configuredConcurrency = adaptiveState.current;
    const concurrency = Math.min(
      configuredConcurrency,
      items.length - cursor
    );
    const batch = items.slice(
      cursor,
      cursor + concurrency
    );
    const fullWave =
      batch.length === configuredConcurrency;

    const waveStartedAt = performance.now();
    const requestsBefore = readMetrics.requests;
    const transientBefore = readMetrics.transientEvents;

    const results = await Promise.all(
      batch.map(async (item, offset) => {
        const index = cursor + offset;

        try {
          return {
            ok: true,
            index,
            value: await worker(item, index)
          };
        } catch (error) {
          return {
            ok: false,
            index,
            error
          };
        }
      })
    );

    const wallMs = Math.max(
      1,
      Math.round(performance.now() - waveStartedAt)
    );

    const failure = results.find(item => !item.ok);

    if (failure) {
      console.error(
        `[attributes-wrong-prices] ${label}: read failed at item ${failure.index + 1}/${items.length}`,
        failure.error
      );
      throw failure.error;
    }

    for (const result of results) {
      output[result.index] = result.value;
    }

    const requests =
      readMetrics.requests - requestsBefore;
    const transientEvents =
      readMetrics.transientEvents - transientBefore;

    const taskThroughput = Number(
      (
        results.length /
        (wallMs / 1000)
      ).toFixed(2)
    );
    const requestThroughput = Number(
      (
        requests /
        (wallMs / 1000)
      ).toFixed(2)
    );

    const before = adaptiveState.current;
    let tuning = {
      evaluated: false,
      action: '',
      stageThroughput: null
    };

    if (transientEvents > 0) {
      adaptiveState.current = Math.max(
        READ_ADAPTIVE.min,
        Math.floor(adaptiveState.current / 2)
      );
      resetAdaptiveBenchmark(adaptiveState);
      tuning.action = 'backoff-transient';
    } else if (!adaptiveState.tuned && fullWave) {
      adaptiveState.stageRequests += results.length;
      adaptiveState.stageSuccesses += results.length;
      adaptiveState.stageWallMs += wallMs;
      tuning = evaluateAdaptiveStage(adaptiveState);
    }

    adaptiveState.waves.push({
      phase: label,
      wave,
      concurrency,
      tasks: results.length,
      requests,
      retries:
        readMetrics.retries,
      wallMs,
      taskThroughput,
      requestThroughput,
      stageThroughput:
        tuning.stageThroughput,
      bestConcurrency:
        adaptiveState.bestConcurrency,
      bestThroughput:
        adaptiveState.bestThroughput || null,
      tuningAction:
        tuning.action,
      nextConcurrency:
        adaptiveState.current
    });

    if (onWave) {
      await onWave({
        values: results.map(item => item.value),
        completed: cursor + batch.length,
        total: items.length,
        concurrency,
        wallMs,
        requests,
        taskThroughput,
        requestThroughput,
        tuning
      });
    }

    if (
      tuning.action ||
      wave % 25 === 0 ||
      cursor + batch.length === items.length
    ) {
      console.log(
        `[attributes-wrong-prices] ${label} ${cursor + batch.length}/${items.length}` +
        ` | concurrency ${concurrency} → ${adaptiveState.current}` +
        ` | ${taskThroughput} tasks/s` +
        ` | ${requestThroughput} req/s` +
        (
          tuning.stageThroughput != null
            ? ` | stage ${tuning.stageThroughput} tasks/s`
            : ''
        ) +
        (
          adaptiveState.bestThroughput
            ? ` | best ${adaptiveState.bestConcurrency} @ ${adaptiveState.bestThroughput} tasks/s`
            : ''
        ) +
        (
          tuning.action
            ? ` | ${tuning.action}`
            : before !== adaptiveState.current
              ? ' | adjusted'
              : ''
        )
      );
    }

    cursor += batch.length;
  }

  return output;
}

async function getListPage(uid, label, page) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
    sort: 'id:ASC',
    locale: LOCALE
  });

  const json = await getJson(
    `/content-manager/collection-types/${uid}?${params}`,
    `${label} page ${page}`
  );

  return {
    page,
    items: getRows(json),
    pagination: getPagination(json)
  };
}

async function listAll(uid, label, adaptiveState) {
  const first = await getListPage(uid, label, 1);
  const firstPageCount = Number(
    first.pagination?.pageCount || 0
  );

  const pages = new Map([
    [1, first.items]
  ]);

  let loaded = first.items.length;
  let loadedPages = 1;

  console.log(
    `[${label}] CMS list 1/${firstPageCount || '?'} | loaded ${loaded}` +
    (first.pagination?.total ? `/${first.pagination.total}` : '')
  );

  if (firstPageCount > 1) {
    const pageNumbers = Array.from(
      { length: firstPageCount - 1 },
      (_, index) => index + 2
    );

    resetAdaptiveBenchmark(adaptiveState);

    const rest = await runAdaptiveRead(
      pageNumbers,
      adaptiveState,
      page => getListPage(uid, label, page),
      {
        label: `${label}/pages`,
        onWave: ({ values }) => {
          loadedPages += values.length;
          loaded += values.reduce(
            (sum, entry) => sum + entry.items.length,
            0
          );

          if (
            loadedPages % 25 < values.length ||
            loadedPages === firstPageCount
          ) {
            console.log(
              `[${label}] CMS list ${loadedPages}/${firstPageCount} | loaded ${loaded}` +
              (first.pagination?.total ? `/${first.pagination.total}` : '')
            );
          }
        }
      }
    );

    for (const entry of rest) {
      pages.set(entry.page, entry.items);
    }
  } else if (
    firstPageCount === 0 &&
    first.items.length === PAGE_SIZE
  ) {
    let page = 2;

    while (true) {
      const entry = await getListPage(
        uid,
        label,
        page
      );

      pages.set(page, entry.items);
      loaded += entry.items.length;
      loadedPages++;

      console.log(
        `[${label}] CMS list ${loadedPages}/? | loaded ${loaded}`
      );

      if (entry.items.length < PAGE_SIZE) break;
      page++;
    }
  }

  const result = [];
  const seen = new Set();

  for (
    const page of [...pages.keys()].sort((a, b) => a - b)
  ) {
    for (const item of pages.get(page)) {
      if (
        !item?.documentId ||
        seen.has(item.documentId)
      ) {
        continue;
      }

      seen.add(item.documentId);
      result.push(item);
    }
  }

  return result;
}

async function getDetail(uid, documentId, label) {
  const params = new URLSearchParams({ locale: LOCALE });
  const json = await getJson(
    `/content-manager/collection-types/${uid}/${encodeURIComponent(documentId)}?${params}`,
    `${label} ${documentId}`
  );
  return json?.data ?? json;
}

async function getFirstRelation(uid, documentId, field) {
  const params = new URLSearchParams({
    locale: LOCALE,
    page: '1',
    pageSize: '1'
  });

  const json = await getJson(
    `/content-manager/relations/${uid}/${encodeURIComponent(documentId)}/${field}?${params}`,
    `${documentId} relation ${field} page 1`
  );

  return getRows(json)[0] ?? null;
}

const downloadCSV = (items, headersList, filename) => {
  const q = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [
    headersList.join(';'),
    ...items.map(row => headersList.map(key => q(row[key])).join(';'))
  ].join('\n');

  const url = URL.createObjectURL(
    new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  );
  const link = Object.assign(document.createElement('a'), {
    href: url,
    download: filename
  });

  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};


  const priceIssue = value => {
    if (value == null || String(value).trim() === '') return 'missing';

    const price = Number(value);
    if (!Number.isFinite(price)) return 'invalid';
    if (price === 0) return 'zero';
    if (price < 0) return 'negative';
    if (!Number.isInteger(price)) return 'fractional';

    return null;
  };

  const hasOwn = (value, key) =>
    Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);

  const productActiveCache = new Map();

  async function isProductActive(product) {
    if (!product?.documentId) return false;
    if (typeof product.active === 'boolean') return product.active;

    if (!productActiveCache.has(product.documentId)) {
      const promise = getDetail(
        PRODUCT_UID,
        product.documentId,
        'Product'
      )
        .then(detail => {
          if (typeof detail?.active !== 'boolean') {
            throw new Error(
              `Product ${product.documentId}: Content Manager detail не содержит active`
            );
          }
          return detail.active;
        })
        .catch(error => {
          productActiveCache.delete(product.documentId);
          throw error;
        });

      productActiveCache.set(
        product.documentId,
        promise
      );
    }

    return productActiveCache.get(product.documentId);
  }

  const adaptiveState = createAdaptiveState();

  const attributes = await listAll(
    ATTRIBUTE_UID,
    'attributes-wrong-prices',
    adaptiveState
  );

  resetAdaptiveBenchmark(adaptiveState);

  let checked = 0;
  let activeProductOffers = 0;
  let nextProgress = 250;

  const logProgress = force => {
    if (!force && checked < nextProgress) return;

    console.log(
      `[attributes-wrong-prices] checked ${checked}/${attributes.length} | ` +
      `offers of active products ${activeProductOffers} | invalid ${invalidRows.length}`
    );

    while (nextProgress <= checked) {
      nextProgress += 250;
    }
  };

  await runAdaptiveRead(
    attributes,
    adaptiveState,
    async item => {
      const product = await getFirstRelation(
        ATTRIBUTE_UID,
        item.documentId,
        'product'
      );

      if (!product || !(await isProductActive(product))) {
        return {
          activeProductOffer: false,
          invalidRow: null
        };
      }

      let source = item;

      if (!hasOwn(item, 'price') || !hasOwn(item, 'barcode')) {
        source = await getDetail(
          ATTRIBUTE_UID,
          item.documentId,
          'Attribute'
        );
      }

      if (!hasOwn(source, 'price')) {
        throw new Error(
          `Attribute ${item.documentId}: Content Manager не вернул поле price`
        );
      }

      const errorType = priceIssue(source.price);

      return {
        activeProductOffer: true,
        invalidRow: errorType
          ? {
              documentId: item.documentId,
              barcode: source.barcode ?? item.barcode ?? '',
              price: source.price ?? '',
              errorType
            }
          : null
      };
    },
    {
      label: 'attribute-relations',
      onWave: ({ values }) => {
        for (const value of values) {
          checked++;

          if (value.activeProductOffer) {
            activeProductOffers++;
          }

          if (value.invalidRow) {
            invalidRows.push(value.invalidRow);
          }
        }

        logProgress(false);
      }
    }
  );

  logProgress(true);

  const readReport = {
    totalAttributes: attributes.length,
    checked,
    activeProductOffers,
    invalid: invalidRows.length,
    requests: readMetrics.requests,
    retries: readMetrics.retries,
    finalConcurrency: adaptiveState.current,
    bestConcurrency: adaptiveState.bestConcurrency,
    bestThroughput: adaptiveState.bestThroughput || null,
    benchmark: adaptiveState.waves
  };

  window.attributesWrongPricesReadReport = readReport;

  console.log(
    '[attributes-wrong-prices] Read summary | ' +
    `requests ${readReport.requests} | retries ${readReport.retries} | ` +
    `final concurrency ${readReport.finalConcurrency}` +
    (
      readReport.bestThroughput
        ? ` | best ${readReport.bestConcurrency} @ ${readReport.bestThroughput} tasks/s`
        : ''
    )
  );

  if (!invalidRows.length) {
    console.log('Готово: проблем с ценой у offers активных товаров не найдено');
    return;
  }

  console.table(invalidRows);
  console.log(
    `Готово: в CMS найдено ${invalidRows.length} offers активных товаров с некорректной ценой`
  );

  window.attributesWithInvalidPrice = invalidRows;
  downloadCSV(
    invalidRows,
    HEADERS,
    'attributes-wrong-prices.csv'
  );
})();
