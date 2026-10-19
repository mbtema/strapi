(async () => {
  'use strict';

  const PRODUCT_UID = 'api::product.product';
  const CATEGORY_UID = 'api::category.category';
  const LOCALE = 'ru';
  const PAGE_SIZE = 100;

  const MIRROR_PAIRS = [
    [
      'yiydsm3f7bh2pfxh18jhnwr5',
      'ojpi51144amf8wfk2fj85go9'
    ]
    // Добавляй следующие пары сюда:
    // ['categoryDocumentIdA', 'categoryDocumentIdB']
  ];

  const ADAPTIVE = {
    min: 5,
    start: 10,
    max: 40,
    step: 5,
    growAfterSuccesses: 20,
    minThroughputGainRatio: 0.03,
    underperformingLevelsBeforeLock: 2
  };

  const CSV_HEADERS = [
    'pair',
    'productDocumentId',
    'direction',
    'error',
    'verifyStatus'
  ];

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

  if (!adminToken) {
    throw new Error('[products-mirror-categories] Не найден jwtToken в LocalStorage');
  }

  const baseHeaders = {
    Accept: 'application/json',
    Authorization: 'Bearer ' + adminToken
  };

  const getRows = json => Array.isArray(json?.results)
    ? json.results
    : Array.isArray(json?.data)
      ? json.data
      : [];

  const getPagination = json =>
    json?.pagination ?? json?.meta?.pagination ?? null;

  const categoryLabel = category => {
    const candidates = [
      category?.title,
      category?.name,
      category?.name1
    ];

    const value = candidates.find(item =>
      typeof item === 'string' && item.trim()
    );

    return value ? value.trim() : category.documentId;
  };

  const difference = (left, right) => {
    const result = [];

    for (const value of left) {
      if (!right.has(value)) result.push(value);
    }

    return result;
  };

  async function getJson(url, label) {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: baseHeaders
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        label + ': HTTP ' + response.status +
        (body ? ' — ' + body.slice(0, 300) : '')
      );
    }

    return response.json();
  }

  async function getCategoryDetail(documentId) {
    const params = new URLSearchParams({ locale: LOCALE });
    const json = await getJson(
      '/content-manager/collection-types/' +
        CATEGORY_UID + '/' +
        encodeURIComponent(documentId) + '?' +
        params,
      'Category ' + documentId
    );

    const category = json?.data ?? json;

    if (!category?.documentId) {
      throw new Error(
        'Category ' + documentId + ': Content Manager не вернул documentId'
      );
    }

    if (category.id == null) {
      throw new Error(
        'Category ' + documentId + ': Content Manager не вернул numeric id'
      );
    }

    return {
      id: category.id,
      documentId: category.documentId,
      bitrixId: category.bitrix_id ?? '',
      label: categoryLabel(category)
    };
  }

  async function getCategoryProducts(category, phase) {
    const products = new Map();
    let page = 1;

    while (true) {
      const params = new URLSearchParams({
        locale: LOCALE,
        page: String(page),
        pageSize: String(PAGE_SIZE)
      });

      const json = await getJson(
        '/content-manager/relations/' +
          CATEGORY_UID + '/' +
          encodeURIComponent(category.documentId) +
          '/product?' + params,
        phase + ' | ' + category.documentId + ' | page ' + page
      );

      const items = getRows(json);
      const pagination = getPagination(json);

      for (const item of items) {
        if (!item?.documentId) continue;
        products.set(item.documentId, item);
      }

      const explicitPageCount = Number(pagination?.pageCount || 0);

      if (explicitPageCount > 0) {
        if (page >= explicitPageCount) break;
      } else if (items.length < PAGE_SIZE) {
        break;
      }

      if (!items.length) break;
      page++;
    }

    return products;
  }

  function validatePairConfig() {
    if (!Array.isArray(MIRROR_PAIRS) || !MIRROR_PAIRS.length) {
      throw new Error('[products-mirror-categories] MIRROR_PAIRS пуст');
    }

    MIRROR_PAIRS.forEach((pair, index) => {
      if (
        !Array.isArray(pair) ||
        pair.length !== 2 ||
        pair.some(value => typeof value !== 'string' || !value.trim())
      ) {
        throw new Error(
          '[products-mirror-categories] Некорректная пара #' + (index + 1)
        );
      }

      if (pair[0] === pair[1]) {
        throw new Error(
          '[products-mirror-categories] Пара #' + (index + 1) +
          ' содержит одну и ту же category дважды'
        );
      }
    });
  }

  async function resolveCategories() {
    const uniqueDocumentIds = [...new Set(MIRROR_PAIRS.flat())];
    const entries = await Promise.all(
      uniqueDocumentIds.map(async documentId => {
        try {
          const category = await getCategoryDetail(documentId);
          return { documentId, category, error: null };
        } catch (error) {
          return {
            documentId,
            category: null,
            error: error?.message || String(error)
          };
        }
      })
    );

    const errors = entries.filter(item => item.error);

    if (errors.length) {
      console.table(
        errors.map(item => ({
          documentId: item.documentId,
          error: item.error
        }))
      );

      throw new Error(
        '[products-mirror-categories] Ошибка конфигурации: ' +
        errors.length + ' category не удалось получить. Write не запущен.'
      );
    }

    return new Map(
      entries.map(item => [item.documentId, item.category])
    );
  }

  function buildPairInfo(pair, pairIndex, categories) {
    const a = categories.get(pair[0]);
    const b = categories.get(pair[1]);

    return {
      index: pairIndex,
      number: pairIndex + 1,
      key: 'pair-' + (pairIndex + 1),
      a,
      b,
      label:
        '#' + (pairIndex + 1) + ' ' +
        a.label + ' ↔ ' + b.label
    };
  }

  async function analyzePair(pairInfo, phase) {
    const pairPrefix =
      '[products-mirror-categories] ' +
      phase + ' | pair ' + pairInfo.number;

    const [aProducts, bProducts] = await Promise.all([
      getCategoryProducts(pairInfo.a, pairPrefix + ' A'),
      getCategoryProducts(pairInfo.b, pairPrefix + ' B')
    ]);

    const aIds = new Set(aProducts.keys());
    const bIds = new Set(bProducts.keys());

    const addToA = difference(bIds, aIds);
    const addToB = difference(aIds, bIds);

    const tasks = [
      ...addToA.map(productDocumentId => ({
        pairNumber: pairInfo.number,
        pairLabel: pairInfo.label,
        productDocumentId,
        direction: 'B→A',
        sourceCategory: pairInfo.b,
        targetCategory: pairInfo.a
      })),
      ...addToB.map(productDocumentId => ({
        pairNumber: pairInfo.number,
        pairLabel: pairInfo.label,
        productDocumentId,
        direction: 'A→B',
        sourceCategory: pairInfo.a,
        targetCategory: pairInfo.b
      }))
    ];

    return {
      pairInfo,
      aProducts,
      bProducts,
      aIds,
      bIds,
      addToA,
      addToB,
      tasks
    };
  }

  function dryRunRow(analysis) {
    return {
      pair: analysis.pairInfo.number,
      categoryA: analysis.pairInfo.a.label,
      categoryB: analysis.pairInfo.b.label,
      productsA: analysis.aIds.size,
      productsB: analysis.bIds.size,
      addToA: analysis.addToA.length,
      addToB: analysis.addToB.length,
      toPublish: analysis.tasks.length
    };
  }

  async function publishTask(task) {
    const startedAt = performance.now();
    const url =
      '/content-manager/collection-types/' +
      PRODUCT_UID + '/' +
      encodeURIComponent(task.productDocumentId) +
      '/actions/publish?locale=' +
      encodeURIComponent(LOCALE);

    const payload = {
      categories: {
        connect: [
          {
            id: task.targetCategory.id,
            documentId: task.targetCategory.documentId,
            locale: LOCALE
          }
        ],
        disconnect: []
      }
    };

    let response;

    try {
      response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...baseHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      return {
        ok: false,
        transient: true,
        status: 'NETWORK',
        durationMs: Math.round(performance.now() - startedAt),
        error: error?.message || String(error)
      };
    }

    const durationMs = Math.round(performance.now() - startedAt);

    if (response.ok) {
      return {
        ok: true,
        transient: false,
        status: response.status,
        durationMs,
        error: ''
      };
    }

    const body = await response.text().catch(() => '');
    const transient = response.status === 429 || response.status >= 500;

    return {
      ok: false,
      transient,
      status: response.status,
      durationMs,
      error:
        'HTTP ' + response.status +
        (body ? ' — ' + body.slice(0, 400) : '')
    };
  }

  async function runAdaptive(tasks, adaptiveState, globalProgress) {
    const failures = [];
    let successes = 0;
    let cursor = 0;
    let wave = 0;

    const resetStage = () => {
      adaptiveState.stageRequests = 0;
      adaptiveState.stageSuccesses = 0;
      adaptiveState.stageWallMs = 0;
    };

    const resetBenchmarkFromCurrent = () => {
      resetStage();
      adaptiveState.bestConcurrency = adaptiveState.current;
      adaptiveState.bestThroughput = 0;
      adaptiveState.underperformingLevels = 0;
      adaptiveState.tuned = false;
    };

    const evaluateStage = () => {
      if (
        adaptiveState.tuned ||
        adaptiveState.stageSuccesses < ADAPTIVE.growAfterSuccesses ||
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
          (1 + ADAPTIVE.minThroughputGainRatio);

        if (stageThroughput >= required) {
          adaptiveState.bestThroughput = stageThroughput;
          adaptiveState.bestConcurrency = currentLevel;
          adaptiveState.underperformingLevels = 0;
          action = 'new-best';
        } else {
          adaptiveState.underperformingLevels++;

          const shouldLock =
            adaptiveState.underperformingLevels >=
              ADAPTIVE.underperformingLevelsBeforeLock ||
            currentLevel >= ADAPTIVE.max;

          if (shouldLock) {
            adaptiveState.current = adaptiveState.bestConcurrency;
            adaptiveState.tuned = true;
            action = 'lock-best';
            resetStage();

            return {
              evaluated: true,
              action,
              stageThroughput
            };
          }

          action = 'probe-next';
        }
      }

      if (adaptiveState.current < ADAPTIVE.max) {
        adaptiveState.current = Math.min(
          ADAPTIVE.max,
          adaptiveState.current + ADAPTIVE.step
        );
      } else {
        adaptiveState.tuned = true;
        action = action || 'lock-max';
      }

      resetStage();

      return {
        evaluated: true,
        action,
        stageThroughput
      };
    };

    while (cursor < tasks.length) {
      wave++;

      const configuredConcurrency = adaptiveState.current;
      const concurrency = Math.min(
        configuredConcurrency,
        tasks.length - cursor
      );
      const batch = tasks.slice(cursor, cursor + concurrency);
      const fullWave = batch.length === configuredConcurrency;
      const waveStartedAt = performance.now();

      const results = await Promise.all(
        batch.map(async task => ({
          task,
          result: await publishTask(task)
        }))
      );

      const wallMs = Math.max(
        1,
        Math.round(performance.now() - waveStartedAt)
      );

      let waveSuccesses = 0;
      let waveFailures = 0;
      let transientFailures = 0;
      let totalRequestMs = 0;

      for (const item of results) {
        totalRequestMs += item.result.durationMs;

        if (item.result.ok) {
          waveSuccesses++;
          successes++;
          globalProgress.success++;
        } else {
          waveFailures++;
          globalProgress.failed++;

          if (item.result.transient) {
            transientFailures++;
          }

          failures.push({
            ...item.task,
            status: item.result.status,
            durationMs: item.result.durationMs,
            error: item.result.error,
            transient: item.result.transient
          });
        }

        globalProgress.completed++;
      }

      const avgMs = Math.round(
        totalRequestMs / Math.max(1, results.length)
      );
      const throughput = Number(
        (results.length / (wallMs / 1000)).toFixed(2)
      );

      const before = adaptiveState.current;
      let tuning = {
        evaluated: false,
        action: '',
        stageThroughput: null
      };

      if (transientFailures > 0) {
        adaptiveState.current = Math.max(
          ADAPTIVE.min,
          Math.floor(adaptiveState.current / 2)
        );
        resetBenchmarkFromCurrent();
        tuning.action = 'backoff-transient';
      } else if (waveFailures === 0) {
        if (!adaptiveState.tuned && fullWave) {
          adaptiveState.stageRequests += results.length;
          adaptiveState.stageSuccesses += waveSuccesses;
          adaptiveState.stageWallMs += wallMs;
          tuning = evaluateStage();
        }
      } else {
        resetStage();
        tuning.action = 'hold-on-error';
      }

      adaptiveState.waves.push({
        pair: batch[0]?.pairNumber ?? null,
        wave,
        concurrency,
        requests: results.length,
        success: waveSuccesses,
        failed: waveFailures,
        transientFailed: transientFailures,
        avgMs,
        wallMs,
        throughput,
        stageThroughput: tuning.stageThroughput,
        bestConcurrency: adaptiveState.bestConcurrency,
        bestThroughput: adaptiveState.bestThroughput || null,
        tuningAction: tuning.action,
        nextConcurrency: adaptiveState.current
      });

      console.log(
        '[products-mirror-categories] publish ' +
        globalProgress.completed + '/' + globalProgress.total +
        ' | success ' + globalProgress.success +
        ' | failed ' + globalProgress.failed +
        ' | concurrency ' + concurrency +
        ' → ' + adaptiveState.current +
        ' | avg ' + avgMs + ' ms' +
        ' | ' + throughput + ' req/s' +
        (tuning.stageThroughput != null
          ? ' | stage ' + tuning.stageThroughput + ' req/s'
          : '') +
        (adaptiveState.bestThroughput
          ? ' | best ' +
            adaptiveState.bestConcurrency + ' @ ' +
            adaptiveState.bestThroughput + ' req/s'
          : '') +
        (tuning.action ? ' | ' + tuning.action : '') +
        (before !== adaptiveState.current &&
          !tuning.action
            ? ' | adjusted'
            : '')
      );

      cursor += batch.length;
    }

    return { successes, failures };
  }

  function buildVerify(pairInfo, aProducts, bProducts) {
    const aIds = new Set(aProducts.keys());
    const bIds = new Set(bProducts.keys());

    return {
      aIds,
      bIds,
      missingInA: difference(bIds, aIds),
      missingInB: difference(aIds, bIds),
      ok: aIds.size === bIds.size &&
        difference(aIds, bIds).length === 0 &&
        difference(bIds, aIds).length === 0,
      pairInfo
    };
  }

  function verifyStatusForFailure(failure, verify) {
    const targetSet =
      failure.targetCategory.documentId === verify.pairInfo.a.documentId
        ? verify.aIds
        : verify.bIds;

    return targetSet.has(failure.productDocumentId)
      ? 'relation-present-after-error'
      : 'missing';
  }

  function issueKey(row) {
    return [
      row.pair,
      row.productDocumentId,
      row.direction
    ].join('|');
  }

  const downloadCSV = (items, headersList, filename) => {
    const q = value =>
      '"' + String(value ?? '').replace(/"/g, '""') + '"';

    const csv = [
      headersList.join(';'),
      ...items.map(row =>
        headersList.map(key => q(row[key])).join(';')
      )
    ].join('\n');

    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + csv], {
        type: 'text/csv;charset=utf-8;'
      })
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

  validatePairConfig();

  console.log('[products-mirror-categories] Проверяю MIRROR_PAIRS...');
  const categories = await resolveCategories();

  const pairInfos = MIRROR_PAIRS.map((pair, index) =>
    buildPairInfo(pair, index, categories)
  );

  console.log('[products-mirror-categories] Dry-run всех пар...');

  const dryRuns = [];

  for (const pairInfo of pairInfos) {
    dryRuns.push(await analyzePair(pairInfo, 'dry-run'));
  }

  const dryRunTable = dryRuns.map(dryRunRow);
  const dryRunTotal = dryRuns.reduce(
    (sum, analysis) => sum + analysis.tasks.length,
    0
  );

  console.table(dryRunTable);
  console.log(
    '[products-mirror-categories] Dry-run: пар ' +
    pairInfos.length + ', Products к публикации ' + dryRunTotal
  );

  if (dryRunTotal === 0) {
    const report = {
      status: 'no-changes',
      locale: LOCALE,
      pairs: pairInfos.length,
      dryRunChanges: 0,
      published: 0,
      failed: 0,
      verifyMismatches: 0
    };

    window.productsMirrorCategoriesReport = report;

    console.log(
      '[products-mirror-categories] Все пары синхронизированы. ' +
      'Изменений: 0. Publish не выполнялся.'
    );
    return;
  }

  const approved = window.confirm(
    'Зеркалирование категорий товаров\n\n' +
    'Locale: ' + LOCALE + '\n' +
    'Пар: ' + pairInfos.length + '\n' +
    'Products к публикации по dry-run: ' + dryRunTotal + '\n\n' +
    'Запустить write + publish?'
  );

  if (!approved) {
    console.log('[products-mirror-categories] Отменено пользователем');
    return;
  }

  const startedAt = performance.now();
  const adaptiveState = {
    current: ADAPTIVE.start,
    bestConcurrency: ADAPTIVE.start,
    bestThroughput: 0,
    underperformingLevels: 0,
    tuned: false,
    stageRequests: 0,
    stageSuccesses: 0,
    stageWallMs: 0,
    waves: []
  };

  const globalProgress = {
    total: 0,
    completed: 0,
    success: 0,
    failed: 0
  };

  const pairResults = [];
  const issueRows = [];
  const issueRowKeys = new Set();

  for (const pairInfo of pairInfos) {
    console.log(
      '[products-mirror-categories] Pair ' +
      pairInfo.number + '/' + pairInfos.length +
      ': live re-check | ' + pairInfo.label
    );

    let liveAnalysis;

    try {
      liveAnalysis = await analyzePair(pairInfo, 'live re-check');
    } catch (error) {
      const message = error?.message || String(error);

      pairResults.push({
        pair: pairInfo.number,
        status: 'read-error',
        planned: 0,
        published: 0,
        failed: 0,
        verifyMissing: null,
        error: message
      });

      const readErrorRow = {
        pair: pairInfo.number,
        productDocumentId: '',
        direction: '',
        error: message,
        verifyStatus: 'pair-read-error'
      };

      const readErrorKey = issueKey(readErrorRow);
      if (!issueRowKeys.has(readErrorKey)) {
        issueRowKeys.add(readErrorKey);
        issueRows.push(readErrorRow);
      }

      console.error(
        '[products-mirror-categories] Pair ' +
        pairInfo.number + ': read error, перехожу к следующей паре',
        error
      );

      continue;
    }

    const tasks = liveAnalysis.tasks;
    globalProgress.total += tasks.length;

    if (!tasks.length) {
      pairResults.push({
        pair: pairInfo.number,
        status: 'already-synced',
        planned: 0,
        published: 0,
        failed: 0,
        verifyMissing: 0,
        error: ''
      });

      console.log(
        '[products-mirror-categories] Pair ' +
        pairInfo.number + ': уже синхронизирована'
      );
      continue;
    }

    console.log(
      '[products-mirror-categories] Pair ' +
      pairInfo.number + ': publish ' + tasks.length +
      ' Products | +A ' + liveAnalysis.addToA.length +
      ' | +B ' + liveAnalysis.addToB.length +
      ' | start concurrency ' + adaptiveState.current
    );

    const writeResult = await runAdaptive(
      tasks,
      adaptiveState,
      globalProgress
    );

    let verify;

    try {
      const [aProducts, bProducts] = await Promise.all([
        getCategoryProducts(
          pairInfo.a,
          '[products-mirror-categories] verify | pair ' +
            pairInfo.number + ' A'
        ),
        getCategoryProducts(
          pairInfo.b,
          '[products-mirror-categories] verify | pair ' +
            pairInfo.number + ' B'
        )
      ]);

      verify = buildVerify(pairInfo, aProducts, bProducts);
    } catch (error) {
      const message = error?.message || String(error);

      pairResults.push({
        pair: pairInfo.number,
        status: 'verify-read-error',
        planned: tasks.length,
        published: writeResult.successes,
        failed: writeResult.failures.length,
        verifyMissing: null,
        error: message
      });

      const verifyReadErrorRow = {
        pair: pairInfo.number,
        productDocumentId: '',
        direction: '',
        error: message,
        verifyStatus: 'verify-read-error'
      };

      const verifyReadErrorKey = issueKey(verifyReadErrorRow);
      if (!issueRowKeys.has(verifyReadErrorKey)) {
        issueRowKeys.add(verifyReadErrorKey);
        issueRows.push(verifyReadErrorRow);
      }

      for (const failure of writeResult.failures) {
        const row = {
          pair: pairInfo.number,
          productDocumentId: failure.productDocumentId,
          direction: failure.direction,
          error: failure.error,
          verifyStatus: 'verify-read-error'
        };

        const key = issueKey(row);
        if (!issueRowKeys.has(key)) {
          issueRowKeys.add(key);
          issueRows.push(row);
        }
      }

      console.error(
        '[products-mirror-categories] Pair ' +
        pairInfo.number + ': verify read error, перехожу к следующей паре',
        error
      );

      continue;
    }

    for (const failure of writeResult.failures) {
      const row = {
        pair: pairInfo.number,
        productDocumentId: failure.productDocumentId,
        direction: failure.direction,
        error: failure.error,
        verifyStatus: verifyStatusForFailure(failure, verify)
      };

      const key = issueKey(row);
      if (!issueRowKeys.has(key)) {
        issueRowKeys.add(key);
        issueRows.push(row);
      }
    }

    for (const productDocumentId of verify.missingInA) {
      const row = {
        pair: pairInfo.number,
        productDocumentId,
        direction: 'B→A',
        error: 'verify mismatch',
        verifyStatus: 'missing'
      };

      const key = issueKey(row);
      if (!issueRowKeys.has(key)) {
        issueRowKeys.add(key);
        issueRows.push(row);
      }
    }

    for (const productDocumentId of verify.missingInB) {
      const row = {
        pair: pairInfo.number,
        productDocumentId,
        direction: 'A→B',
        error: 'verify mismatch',
        verifyStatus: 'missing'
      };

      const key = issueKey(row);
      if (!issueRowKeys.has(key)) {
        issueRowKeys.add(key);
        issueRows.push(row);
      }
    }

    const verifyMissing =
      verify.missingInA.length + verify.missingInB.length;

    pairResults.push({
      pair: pairInfo.number,
      status: verify.ok ? 'verified' : 'verify-mismatch',
      planned: tasks.length,
      published: writeResult.successes,
      failed: writeResult.failures.length,
      verifyMissing,
      error: ''
    });

    console.log(
      '[products-mirror-categories] Pair ' +
      pairInfo.number + ': verify ' +
      (verify.ok ? 'OK' : 'MISMATCH') +
      ' | A ' + verify.aIds.size +
      ' | B ' + verify.bIds.size +
      ' | missing ' + verifyMissing
    );
  }

  const elapsedMs = Math.round(performance.now() - startedAt);
  const mismatchPairs = pairResults.filter(
    item =>
      item.status === 'verify-mismatch' ||
      item.status === 'verify-read-error' ||
      item.status === 'read-error'
  ).length;

  const report = {
    status: issueRows.length || mismatchPairs
      ? 'completed-with-issues'
      : 'completed',
    locale: LOCALE,
    pairs: pairInfos.length,
    dryRunChanges: dryRunTotal,
    livePlanned: globalProgress.total,
    published: globalProgress.success,
    failed: globalProgress.failed,
    issueRows: issueRows.length,
    mismatchPairs,
    finalConcurrency: adaptiveState.current,
    bestConcurrency: adaptiveState.bestConcurrency,
    bestThroughput: adaptiveState.bestThroughput || null,
    elapsedMs,
    pairResults,
    benchmark: adaptiveState.waves
  };

  window.productsMirrorCategoriesReport = report;

  console.log('[products-mirror-categories] Итог');
  console.table(pairResults);

  if (adaptiveState.waves.length) {
    console.log('[products-mirror-categories] Adaptive concurrency benchmark');
    console.table(adaptiveState.waves);
  }

  console.log(
    '[products-mirror-categories] Готово | dry-run ' +
    dryRunTotal +
    ' | live planned ' + globalProgress.total +
    ' | published ' + globalProgress.success +
    ' | failed ' + globalProgress.failed +
    ' | problem rows ' + issueRows.length +
    ' | final concurrency ' + adaptiveState.current +
    (adaptiveState.bestThroughput
      ? ' | best ' +
        adaptiveState.bestConcurrency + ' @ ' +
        adaptiveState.bestThroughput + ' req/s'
      : '') +
    ' | ' + (elapsedMs / 1000).toFixed(1) + ' sec'
  );

  if (issueRows.length) {
    console.table(issueRows);
    downloadCSV(
      issueRows,
      CSV_HEADERS,
      'products-mirror-categories-errors.csv'
    );
  }
})();
