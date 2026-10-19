(async () => {
  'use strict';

  const PRODUCT_UID = 'api::product.product';
  const CATEGORY_UID = 'api::category.category';
  const LOCALE = 'ru';
  const PAGE_SIZE = 100;

  const NORMALIZATION_GROUPS = [
    {
      name: 'Питание и увлажнение',
      source: 'r4mskoxq9sf8x4kbmxos84v2',
      target: 'bp1hq8n7b9px82t2i8p4f7zj'
    },
    {
      name: 'Очищение',
      source: 's1oepjnv5is7lwdo2blauyjk',
      target: 'x6yjqk3pcqo04px1njwkzai5'
    },
    {
      name: 'Уход за кожей вокруг глаз',
      source: 'uvbntzls7ou3ixdkzcexgb5m',
      target: 'l7eg3exlskpsngjli7415l8z'
    },
    {
      name: 'Антивозрастной уход',
      source: 'to6qf40s4aeh9g8zw5p1anrx',
      target: 'qgb4mkvanvvs24chnjkkdzst'
    },
    {
      name: 'Специальный уход',
      source: 'a6xmudit8u5kivwa0ztrt1p4',
      target: 'p6pkrxo0tlwedvov0e36yo68'
    },
    {
      name: 'BB CC крема',
      source: 'wlaptimja0i6obm3bp1kd01v',
      target: 'rcdjq59axctxbwlgxonekvsl'
    },
    {
      name: 'Маски',
      source: 'fyzb2kdqgwhyv7iglqxvw2na',
      target: 'e6ydbzikuhrmfci9fe8yn7fg'
    },
    {
      name: 'Очищение',
      source: 'ik2jvqljb6hebv0qigkpue66',
      target: 'skcrmqztdt90uvuxjixjon12'
    },
    {
      name: 'Питание и увлажнение',
      source: 'wggtl2k14x05etlu8fyes6zk',
      target: 'mek0fsgegv52s9q9z2nymto4'
    }

    // Добавляй следующие группы source → target сюда:
    // {
    //   name: 'Название группы',
    //   source: 'asianCareCategoryDocumentId',
    //   target: 'mainCatalogCategoryDocumentId'
    // }
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
    'group',
    'productDocumentId',
    'sourceCategory',
    'targetCategory',
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
    throw new Error(
      '[products-normalize-asian-care] Не найден jwtToken в LocalStorage'
    );
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

  const sourceDocumentId = task =>
    task.sourceCategory.documentId;

  const targetDocumentId = task =>
    task.targetCategory.documentId;

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
        'Category ' + documentId +
        ': Content Manager не вернул documentId'
      );
    }

    if (category.id == null) {
      throw new Error(
        'Category ' + documentId +
        ': Content Manager не вернул numeric id'
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

  function validateGroupConfig() {
    if (
      !Array.isArray(NORMALIZATION_GROUPS) ||
      !NORMALIZATION_GROUPS.length
    ) {
      throw new Error(
        '[products-normalize-asian-care] NORMALIZATION_GROUPS пуст'
      );
    }

    const pairs = new Set();

    NORMALIZATION_GROUPS.forEach((group, index) => {
      const valid =
        group &&
        typeof group === 'object' &&
        !Array.isArray(group) &&
        typeof group.name === 'string' &&
        group.name.trim() &&
        typeof group.source === 'string' &&
        group.source.trim() &&
        typeof group.target === 'string' &&
        group.target.trim();

      if (!valid) {
        throw new Error(
          '[products-normalize-asian-care] Некорректная группа #' +
          (index + 1) +
          ': нужны name, source и target'
        );
      }

      if (group.source === group.target) {
        throw new Error(
          '[products-normalize-asian-care] Группа #' +
          (index + 1) +
          ': source и target не должны совпадать'
        );
      }

      const pairKey =
        group.source.trim() + '→' + group.target.trim();

      if (pairs.has(pairKey)) {
        throw new Error(
          '[products-normalize-asian-care] Дублирующая группа #' +
          (index + 1) +
          ': ' + pairKey
        );
      }

      pairs.add(pairKey);
    });
  }

  async function resolveCategories() {
    const uniqueDocumentIds = [
      ...new Set(
        NORMALIZATION_GROUPS.flatMap(group => [
          group.source.trim(),
          group.target.trim()
        ])
      )
    ];

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
        '[products-normalize-asian-care] Ошибка конфигурации: ' +
        errors.length +
        ' category не удалось получить. Write не запущен.'
      );
    }

    return new Map(
      entries.map(item => [item.documentId, item.category])
    );
  }

  function buildGroupInfo(group, groupIndex, categories) {
    const sourceCategory =
      categories.get(group.source.trim());
    const targetCategory =
      categories.get(group.target.trim());

    return {
      index: groupIndex,
      number: groupIndex + 1,
      key: 'group-' + (groupIndex + 1),
      name: group.name.trim(),
      sourceCategory,
      targetCategory,
      label:
        '#' + (groupIndex + 1) + ' ' +
        group.name.trim() + ' | ' +
        sourceCategory.label + ' → ' +
        targetCategory.label
    };
  }

  async function analyzeGroup(groupInfo, phase) {
    const prefix =
      '[products-normalize-asian-care] ' +
      phase + ' | group ' + groupInfo.number;

    const [sourceProducts, targetProducts] =
      await Promise.all([
        getCategoryProducts(
          groupInfo.sourceCategory,
          prefix + ' source'
        ),
        getCategoryProducts(
          groupInfo.targetCategory,
          prefix + ' target'
        )
      ]);

    const sourceIds =
      new Set(sourceProducts.keys());
    const targetIds =
      new Set(targetProducts.keys());
    const missingIds =
      difference(sourceIds, targetIds);

    const tasks = missingIds.map(
      productDocumentId => ({
        groupNumber: groupInfo.number,
        groupLabel: groupInfo.label,
        productDocumentId,
        sourceCategory: groupInfo.sourceCategory,
        targetCategory: groupInfo.targetCategory
      })
    );

    return {
      groupInfo,
      sourceState: {
        category: groupInfo.sourceCategory,
        products: sourceProducts,
        ids: sourceIds
      },
      targetState: {
        category: groupInfo.targetCategory,
        products: targetProducts,
        ids: targetIds
      },
      missingIds,
      tasks
    };
  }

  function dryRunRow(analysis) {
    return {
      group: analysis.groupInfo.number,
      name: analysis.groupInfo.name,
      sourceProducts: analysis.sourceState.ids.size,
      targetProducts: analysis.targetState.ids.size,
      missingInTarget: analysis.missingIds.length,
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
        durationMs: Math.round(
          performance.now() - startedAt
        ),
        error: error?.message || String(error)
      };
    }

    const durationMs = Math.round(
      performance.now() - startedAt
    );

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
    const transient =
      response.status === 429 || response.status >= 500;

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

  async function runAdaptive(
    tasks,
    adaptiveState,
    globalProgress
  ) {
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
      adaptiveState.bestConcurrency =
        adaptiveState.current;
      adaptiveState.bestThroughput = 0;
      adaptiveState.underperformingLevels = 0;
      adaptiveState.tuned = false;
    };

    const evaluateStage = () => {
      if (
        adaptiveState.tuned ||
        adaptiveState.stageSuccesses <
          ADAPTIVE.growAfterSuccesses ||
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
            adaptiveState.current =
              adaptiveState.bestConcurrency;
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

      const configuredConcurrency =
        adaptiveState.current;
      const concurrency = Math.min(
        configuredConcurrency,
        tasks.length - cursor
      );
      const batch = tasks.slice(
        cursor,
        cursor + concurrency
      );
      const fullWave =
        batch.length === configuredConcurrency;
      const waveStartedAt = performance.now();

      const results = await Promise.all(
        batch.map(async task => ({
          task,
          result: await publishTask(task)
        }))
      );

      const wallMs = Math.max(
        1,
        Math.round(
          performance.now() - waveStartedAt
        )
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
        totalRequestMs /
        Math.max(1, results.length)
      );
      const throughput = Number(
        (
          results.length /
          (wallMs / 1000)
        ).toFixed(2)
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
          adaptiveState.stageRequests +=
            results.length;
          adaptiveState.stageSuccesses +=
            waveSuccesses;
          adaptiveState.stageWallMs += wallMs;
          tuning = evaluateStage();
        }
      } else {
        resetStage();
        tuning.action = 'hold-on-error';
      }

      adaptiveState.waves.push({
        group: batch[0]?.groupNumber ?? null,
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
        bestConcurrency:
          adaptiveState.bestConcurrency,
        bestThroughput:
          adaptiveState.bestThroughput || null,
        tuningAction: tuning.action,
        nextConcurrency:
          adaptiveState.current
      });

      console.log(
        '[products-normalize-asian-care] publish ' +
        globalProgress.completed + '/' +
        globalProgress.total +
        ' | success ' + globalProgress.success +
        ' | failed ' + globalProgress.failed +
        ' | concurrency ' + concurrency +
        ' → ' + adaptiveState.current +
        ' | avg ' + avgMs + ' ms' +
        ' | ' + throughput + ' req/s' +
        (
          tuning.stageThroughput != null
            ? ' | stage ' +
              tuning.stageThroughput + ' req/s'
            : ''
        ) +
        (
          adaptiveState.bestThroughput
            ? ' | best ' +
              adaptiveState.bestConcurrency +
              ' @ ' +
              adaptiveState.bestThroughput +
              ' req/s'
            : ''
        ) +
        (
          tuning.action
            ? ' | ' + tuning.action
            : ''
        ) +
        (
          before !== adaptiveState.current &&
          !tuning.action
            ? ' | adjusted'
            : ''
        )
      );

      cursor += batch.length;
    }

    return { successes, failures };
  }

  function buildVerify(
    groupInfo,
    sourceState,
    targetState
  ) {
    const missingIds = difference(
      sourceState.ids,
      targetState.ids
    );

    return {
      groupInfo,
      sourceState,
      targetState,
      missingIds,
      ok: missingIds.length === 0
    };
  }

  function verifyStatusForFailure(
    failure,
    verify
  ) {
    return verify.targetState.ids.has(
      failure.productDocumentId
    )
      ? 'relation-present-after-error'
      : 'missing';
  }

  function issueKey(row) {
    return [
      row.group,
      row.productDocumentId,
      row.sourceCategory,
      row.targetCategory
    ].join('|');
  }

  const downloadCSV = (
    items,
    headersList,
    filename
  ) => {
    const q = value =>
      '"' +
      String(value ?? '').replace(/"/g, '""') +
      '"';

    const csv = [
      headersList.join(';'),
      ...items.map(row =>
        headersList
          .map(key => q(row[key]))
          .join(';')
      )
    ].join('\n');

    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + csv], {
        type: 'text/csv;charset=utf-8;'
      })
    );

    const link = Object.assign(
      document.createElement('a'),
      {
        href: url,
        download: filename
      }
    );

    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(
      () => URL.revokeObjectURL(url),
      1000
    );
  };

  validateGroupConfig();

  console.log(
    '[products-normalize-asian-care] Проверяю NORMALIZATION_GROUPS...'
  );

  const categories = await resolveCategories();

  const groupInfos = NORMALIZATION_GROUPS.map(
    (group, index) =>
      buildGroupInfo(group, index, categories)
  );

  console.log(
    '[products-normalize-asian-care] Dry-run всех групп...'
  );

  const dryRuns = [];

  for (const groupInfo of groupInfos) {
    dryRuns.push(
      await analyzeGroup(groupInfo, 'dry-run')
    );
  }

  const dryRunTable =
    dryRuns.map(dryRunRow);
  const dryRunTotal =
    dryRuns.reduce(
      (sum, analysis) =>
        sum + analysis.tasks.length,
      0
    );
  const dryRunRelations = dryRunTotal;

  console.table(dryRunTable);
  console.log(
    '[products-normalize-asian-care] Dry-run: групп ' +
    groupInfos.length +
    ', Products к публикации ' +
    dryRunTotal +
    ', relations к добавлению ' +
    dryRunRelations
  );

  if (dryRunTotal === 0) {
    const report = {
      status: 'no-changes',
      locale: LOCALE,
      groups: groupInfos.length,
      dryRunChanges: 0,
      published: 0,
      failed: 0,
      verifyMismatches: 0
    };

    window.productsNormalizeAsianCareReport =
      report;

    console.log(
      '[products-normalize-asian-care] Все группы синхронизированы. ' +
      'Изменений: 0. Publish не выполнялся.'
    );
    return;
  }

  const approved = window.confirm(
    'Нормализация каталога «Азиатский уход»\n\n' +
    'Locale: ' + LOCALE + '\n' +
    'Групп: ' + groupInfos.length + '\n' +
    'Products к публикации по dry-run: ' +
    dryRunTotal + '\n' +
    'Relations к добавлению: ' +
    dryRunRelations + '\n\n' +
    'Запустить write + publish?'
  );

  if (!approved) {
    console.log(
      '[products-normalize-asian-care] Отменено пользователем'
    );
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

  const groupResults = [];
  const issueRows = [];
  const issueRowKeys = new Set();

  for (const groupInfo of groupInfos) {
    console.log(
      '[products-normalize-asian-care] Group ' +
      groupInfo.number + '/' +
      groupInfos.length +
      ': live re-check | ' +
      groupInfo.label
    );

    let liveAnalysis;

    try {
      liveAnalysis = await analyzeGroup(
        groupInfo,
        'live re-check'
      );
    } catch (error) {
      const message =
        error?.message || String(error);

      groupResults.push({
        group: groupInfo.number,
        status: 'read-error',
        planned: 0,
        published: 0,
        failed: 0,
        verifyMissing: null,
        error: message
      });

      const row = {
        group: groupInfo.number,
        productDocumentId: '',
        sourceCategory: groupInfo.sourceCategory.documentId,
        targetCategory: groupInfo.targetCategory.documentId,
        error: message,
        verifyStatus: 'group-read-error'
      };

      const key = issueKey(row);
      if (!issueRowKeys.has(key)) {
        issueRowKeys.add(key);
        issueRows.push(row);
      }

      console.error(
        '[products-normalize-asian-care] Group ' +
        groupInfo.number +
        ': read error, перехожу к следующей группе',
        error
      );

      continue;
    }

    const tasks = liveAnalysis.tasks;
    globalProgress.total += tasks.length;

    if (!tasks.length) {
      groupResults.push({
        group: groupInfo.number,
        status: 'already-synced',
        planned: 0,
        published: 0,
        failed: 0,
        verifyMissing: 0,
        error: ''
      });

      console.log(
        '[products-normalize-asian-care] Group ' +
        groupInfo.number +
        ': уже синхронизирована'
      );
      continue;
    }

    const relationCount = tasks.length;

    console.log(
      '[products-normalize-asian-care] Group ' +
      groupInfo.number +
      ': publish ' + tasks.length +
      ' Products | relations +' +
      relationCount +
      ' | start concurrency ' +
      adaptiveState.current
    );

    const writeResult = await runAdaptive(
      tasks,
      adaptiveState,
      globalProgress
    );

    let verify;

    try {
      const [sourceProducts, targetProducts] =
        await Promise.all([
          getCategoryProducts(
            groupInfo.sourceCategory,
            '[products-normalize-asian-care] verify | group ' +
              groupInfo.number + ' source'
          ),
          getCategoryProducts(
            groupInfo.targetCategory,
            '[products-normalize-asian-care] verify | group ' +
              groupInfo.number + ' target'
          )
        ]);

      verify = buildVerify(
        groupInfo,
        {
          category: groupInfo.sourceCategory,
          products: sourceProducts,
          ids: new Set(sourceProducts.keys())
        },
        {
          category: groupInfo.targetCategory,
          products: targetProducts,
          ids: new Set(targetProducts.keys())
        }
      );
    } catch (error) {
      const message =
        error?.message || String(error);

      groupResults.push({
        group: groupInfo.number,
        status: 'verify-read-error',
        planned: tasks.length,
        published: writeResult.successes,
        failed: writeResult.failures.length,
        verifyMissing: null,
        error: message
      });

      const verifyReadErrorRow = {
        group: groupInfo.number,
        productDocumentId: '',
        sourceCategory: groupInfo.sourceCategory.documentId,
        targetCategory: groupInfo.targetCategory.documentId,
        error: message,
        verifyStatus: 'verify-read-error'
      };

      const verifyReadErrorKey =
        issueKey(verifyReadErrorRow);

      if (
        !issueRowKeys.has(
          verifyReadErrorKey
        )
      ) {
        issueRowKeys.add(
          verifyReadErrorKey
        );
        issueRows.push(
          verifyReadErrorRow
        );
      }

      for (const failure of writeResult.failures) {
        const row = {
          group: groupInfo.number,
          productDocumentId:
            failure.productDocumentId,
          sourceCategory:
            sourceDocumentId(failure),
          targetCategory:
            targetDocumentId(failure),
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
        '[products-normalize-asian-care] Group ' +
        groupInfo.number +
        ': verify read error, перехожу к следующей группе',
        error
      );

      continue;
    }

    for (const failure of writeResult.failures) {
      const row = {
        group: groupInfo.number,
        productDocumentId:
          failure.productDocumentId,
        sourceCategory:
          sourceDocumentId(failure),
        targetCategory:
          targetDocumentId(failure),
        error: failure.error,
        verifyStatus:
          verifyStatusForFailure(
            failure,
            verify
          )
      };

      const key = issueKey(row);
      if (!issueRowKeys.has(key)) {
        issueRowKeys.add(key);
        issueRows.push(row);
      }
    }

    for (const productDocumentId of verify.missingIds) {
      const row = {
        group: groupInfo.number,
        productDocumentId,
        sourceCategory:
          groupInfo.sourceCategory.documentId,
        targetCategory:
          groupInfo.targetCategory.documentId,
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
      verify.missingIds.length;

    groupResults.push({
      group: groupInfo.number,
      status:
        verify.ok
          ? 'verified'
          : 'verify-mismatch',
      planned: tasks.length,
      published: writeResult.successes,
      failed: writeResult.failures.length,
      verifyMissing,
      error: ''
    });

    const counts =
      'source=' + verify.sourceState.ids.size +
      ' | target=' + verify.targetState.ids.size;

    console.log(
      '[products-normalize-asian-care] Group ' +
      groupInfo.number +
      ': verify ' +
      (verify.ok ? 'OK' : 'MISMATCH') +
      ' | ' + counts +
      ' | missing relations ' +
      verifyMissing
    );
  }

  const elapsedMs = Math.round(
    performance.now() - startedAt
  );

  const mismatchGroups =
    groupResults.filter(
      item =>
        item.status === 'verify-mismatch' ||
        item.status === 'verify-read-error' ||
        item.status === 'read-error'
    ).length;

  const report = {
    status:
      issueRows.length || mismatchGroups
        ? 'completed-with-issues'
        : 'completed',
    locale: LOCALE,
    groups: groupInfos.length,
    dryRunChanges: dryRunTotal,
    dryRunRelations,
    livePlanned: globalProgress.total,
    published: globalProgress.success,
    failed: globalProgress.failed,
    issueRows: issueRows.length,
    mismatchGroups,
    finalConcurrency: adaptiveState.current,
    bestConcurrency:
      adaptiveState.bestConcurrency,
    bestThroughput:
      adaptiveState.bestThroughput || null,
    elapsedMs,
    groupResults,
    benchmark: adaptiveState.waves
  };

  window.productsNormalizeAsianCareReport =
    report;

  console.log(
    '[products-normalize-asian-care] Итог'
  );
  console.table(groupResults);

  if (adaptiveState.waves.length) {
    console.log(
      '[products-normalize-asian-care] Adaptive concurrency benchmark'
    );
    console.table(adaptiveState.waves);
  }

  console.log(
    '[products-normalize-asian-care] Готово | dry-run ' +
    dryRunTotal +
    ' | live planned ' +
    globalProgress.total +
    ' | published ' +
    globalProgress.success +
    ' | failed ' +
    globalProgress.failed +
    ' | problem rows ' +
    issueRows.length +
    ' | final concurrency ' +
    adaptiveState.current +
    (
      adaptiveState.bestThroughput
        ? ' | best ' +
          adaptiveState.bestConcurrency +
          ' @ ' +
          adaptiveState.bestThroughput +
          ' req/s'
        : ''
    ) +
    ' | ' +
    (elapsedMs / 1000).toFixed(1) +
    ' sec'
  );

  if (issueRows.length) {
    console.table(issueRows);

    downloadCSV(
      issueRows,
      CSV_HEADERS,
      'products-normalize-asian-care-errors.csv'
    );
  }
})();
