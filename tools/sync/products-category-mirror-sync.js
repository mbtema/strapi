(async () => {
  'use strict';
  const __tm=(()=>{
    const box=document.createElement('div');
    Object.assign(box.style,{position:'fixed',right:'24px',bottom:'24px',width:'370px',padding:'18px',background:'#171923',color:'#fff',border:'1px solid #4945ff',borderRadius:'12px',boxShadow:'0 8px 35px #0008',font:'13px system-ui,sans-serif',zIndex:'2147483647'});
    box.innerHTML='<div style="display:flex;justify-content:space-between"><b>products-category-mirror-sync.js</b><button data-stop style="background:#4945ff;color:#fff;border:0;border-radius:5px;padding:6px 10px;cursor:pointer">Стоп</button></div><div data-phase style="margin-top:14px">Подготовка</div><div style="height:10px;background:#363846;border-radius:8px;margin-top:9px;overflow:hidden"><div data-bar style="background:#7b79ff;width:0%;height:100%;transition:width .2s"></div></div><div data-progress style="margin-top:8px">0 / ?</div><div data-speed style="margin-top:8px;color:#b8bacb">—</div><div data-metrics style="margin-top:5px;color:#b8bacb">—</div><div data-eta style="margin-top:5px;color:#b8bacb">—</div>';
    document.body.appendChild(box);const el=k=>box.querySelector('[data-'+k+']');
    const st={stop:false,done:0,total:0,phase:'Подготовка',start:performance.now(),phaseStart:performance.now(),failed:0,concurrency:null,best:null};
    el('stop').onclick=()=>{st.stop=true;el('stop').textContent='Остановка…';el('stop').disabled=true;};
    function render(){const dt=Math.max(.001,(performance.now()-st.phaseStart)/1000),speed=st.done/dt,pct=st.total?Math.min(100,100*st.done/st.total):0;el('phase').textContent=st.phase;el('bar').style.width=pct.toFixed(1)+'%';el('progress').textContent=st.done+' / '+(st.total||'?')+' ('+pct.toFixed(1)+'%)';el('speed').textContent='Скорость: '+speed.toFixed(1)+'/сек';el('metrics').textContent='Ошибки: '+st.failed+(st.concurrency===null?'':' · concurrency: '+st.concurrency)+(st.best===null?'':' · best: '+st.best);el('eta').textContent='ETA: '+(speed&&st.total?Math.ceil((st.total-st.done)/speed)+' сек':'—')+' · прошло: '+Math.ceil((performance.now()-st.start)/1000)+' сек';}
    function phase(name,total=0){st.phase=name;st.total=total;st.done=0;st.phaseStart=performance.now();render();}
    function step(n=1){st.done+=n;render();}
    function perf(cur,best){st.concurrency=cur;st.best=best;render();}
    function finish(status='Завершено'){st.phase=status;render();el('stop').disabled=false;el('stop').textContent='Закрыть';el('stop').onclick=()=>box.remove();}
    render();return {st,phase,step,perf,finish,render};
  })();


  const PRODUCT_UID = 'api::product.product';
  const CATEGORY_UID = 'api::category.category';
  const LOCALE = 'ru';
  const PAGE_SIZE = 100;

  const MIRROR_SYNC_GROUPS = [
    [
      // Группа: Парфюмерные наборы для нее
      'yiydsm3f7bh2pfxh18jhnwr5',
      'ojpi51144amf8wfk2fj85go9'
    ],
    [
      // Группа: Парфюмерные наборы для него
      'k37blstm44sz9x1pib51b4s6',
      'pybua20raonlmbtk8grtc81p',
      'v08z42zs9vwx8dxx3kzkr93o'
    ],
    [
      // Группа: Мужские ароматы
      'z6any10eysps8lq87zi41kuv',
      'xknqvho95grwz8g8oq2knqie'
    ],
    [
      // Группа: Накладные ресницы
      'cs1pn1fsfgnccbzeybf6m93b',
      'dkt914987gaoa4k85ro5nqub',
      'bk1oxriqa9uv9ayztf96xh0g'
    ],
    [
      // Группа: BB CC крема
      'rcdjq59axctxbwlgxonekvsl',
      's9s5o9pc2grmazelvp9t4lol'
    ],
    [
      // Группа: Декоративные наборы
      'tpu6an49hhza41r6nf8v1ozb',
      'q3dy0xlgvxqq0ag2rah2ar8h'
    ],
    [
      // Группа: Зеркала
      'i54m20lo1pumrx32he9856c7',
      'lyw5la9cjdmqua8blaxmjp4l'
    ],
    [
      // Группа: Кисти и аппликаторы
      'zkxi0kay7okxiifqewspza06',
      'v0w0bfafqb57ccdj2dzcbilj'
    ],
    [
      // Группа: Пинцеты
      'pwvwb9fs0hrnw4j2zm58jg17',
      'myskvjdzzdf9uw5xwrqrougm'
    ],
    [
      // Группа: Прочее
      'rssbmhycuxxf2lptllo4wmgw',
      's9gy1g4fjfnclh4g5bonstka',
      'o2rh7h558cshdud8vipu39tl'
    ],
    [
      // Группа: Спонжи и пуфы
      'q9sj5patwtfwqyxvqdh60xr9',
      'k9v6199z48mqux3urhk3slwr'
    ],
    [
      // Группа: Точилки
      'kz95bqjiih1wez27az8c9h7j',
      'v7dxsm3b1gqvc27e6yxq0qwh'
    ],
    [
      // Группа: Щипцы для завивки
      'rcvdcahqvj9r2zc8n5yyzmcp',
      'xz5onwixhlsxycob2gavl7f4'
    ],
    [
      // Группа: Наборы по уходу за лицом (М)
      'r80pm3gk1n5a9panxahra78r',
      'guuddnd684zilyxygrbnz6zx'
    ],
    [
      // Группа: Наборы по уходу за телом (М)
      'uenx7ueeq7pebj1c4m2xr7dj',
      'urr31xq3jdt7tkcfnchkowke'
    ],
    [
      // Группа: Наборы для бритья
      'p4mlbvnmv54t13yhmuhz2qwa',
      'zf9c9knukrboxq5wqbtzsp99'
    ],
    [
      // Группа: Наборы по уходу за волосами (М)
      'sj4ug9485b1it7ccxs8grfva',
      'bml9vy58rjoekruo3kel9wie'
    ],
    [
      // Группа: Наборы по уходу за лицом (Ж)
      'nrbgr3jjygcwpsswf4u276u4',
      'xtunbkgbi1yaihwm3mvi5ifq'
    ],
    [
      // Группа: Наборы по уходу за телом (Ж)
      'kqxpeb7abzyhlle224w3jfdw',
      'w5oulzst4bv7kxnktfdo3znu'
    ],
    [
      // Группа: Расчески
      'ppg02oir0j3m82nt44xte6zv',
      'jj4kjryw9a80emyhsmc8enyd'
    ],
    [
      // Группа: Наборы по уходу за волосами (Ж)
      'z20lqspttx2u4bp8z4ryocpc',
      'ce192gec9vkw4c4t7baallyq'
    ]

    // Добавляй следующие группы сюда по тому же принципу:
    // [
    //   // Группа: Название группы
    //   'categoryDocumentIdA',
    //   'categoryDocumentIdB'
    // ]
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
    'targetCategories',
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
      '[products-category-mirror-sync] Не найден jwtToken в LocalStorage'
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

  const targetDocumentIds = task =>
    task.targetCategories.map(category => category.documentId);

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
    if (!Array.isArray(MIRROR_SYNC_GROUPS) || !MIRROR_SYNC_GROUPS.length) {
      throw new Error(
        '[products-category-mirror-sync] MIRROR_SYNC_GROUPS пуст'
      );
    }

    MIRROR_SYNC_GROUPS.forEach((group, index) => {
      if (
        !Array.isArray(group) ||
        group.length < 2 ||
        group.some(value =>
          typeof value !== 'string' || !value.trim()
        )
      ) {
        throw new Error(
          '[products-category-mirror-sync] Некорректная группа #' +
          (index + 1) +
          ': нужно минимум 2 category documentId'
        );
      }

      if (new Set(group).size !== group.length) {
        throw new Error(
          '[products-category-mirror-sync] Группа #' +
          (index + 1) +
          ' содержит дубли category documentId'
        );
      }
    });
  }

  async function resolveCategories() {
    const uniqueDocumentIds = [
      ...new Set(MIRROR_SYNC_GROUPS.flat())
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
        '[products-category-mirror-sync] Ошибка конфигурации: ' +
        errors.length +
        ' category не удалось получить. Write не запущен.'
      );
    }

    return new Map(
      entries.map(item => [item.documentId, item.category])
    );
  }

  function buildGroupInfo(group, groupIndex, categories) {
    const groupCategories = group.map(documentId =>
      categories.get(documentId)
    );

    return {
      index: groupIndex,
      number: groupIndex + 1,
      key: 'group-' + (groupIndex + 1),
      categories: groupCategories,
      label:
        '#' + (groupIndex + 1) + ' ' +
        groupCategories
          .map(category => category.label)
          .join(' ↔ ')
    };
  }

  async function analyzeGroup(groupInfo, phase) {
    const prefix =
      '[products-category-mirror-sync] ' +
      phase + ' | group ' + groupInfo.number;

    const categoryStates = await Promise.all(
      groupInfo.categories.map(async (category, index) => {
        const products = await getCategoryProducts(
          category,
          prefix + ' C' + (index + 1)
        );

        return {
          category,
          products,
          ids: new Set(products.keys())
        };
      })
    );

    const unionIds = new Set();

    for (const state of categoryStates) {
      for (const productDocumentId of state.ids) {
        unionIds.add(productDocumentId);
      }
    }

    const tasks = [];

    for (const productDocumentId of unionIds) {
      const targetCategories = categoryStates
        .filter(state => !state.ids.has(productDocumentId))
        .map(state => state.category);

      if (!targetCategories.length) continue;

      tasks.push({
        groupNumber: groupInfo.number,
        groupLabel: groupInfo.label,
        productDocumentId,
        targetCategories
      });
    }

    const missingByCategory = categoryStates.map(state => ({
      category: state.category,
      missing: difference(unionIds, state.ids)
    }));

    return {
      groupInfo,
      categoryStates,
      unionIds,
      tasks,
      missingByCategory
    };
  }

  function dryRunRow(analysis) {
    const counts = analysis.categoryStates
      .map((state, index) =>
        'C' + (index + 1) + '=' + state.ids.size
      )
      .join(' | ');

    const missing = analysis.missingByCategory
      .map((item, index) =>
        '+C' + (index + 1) + '=' + item.missing.length
      )
      .join(' | ');

    const missingRelations = analysis.tasks.reduce(
      (sum, task) => sum + task.targetCategories.length,
      0
    );

    return {
      group: analysis.groupInfo.number,
      categories: analysis.groupInfo.categories.length,
      products: counts,
      union: analysis.unionIds.size,
      missing,
      toPublish: analysis.tasks.length,
      relationsToAdd: missingRelations
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
        connect: task.targetCategories.map(category => ({
          id: category.id,
          documentId: category.documentId,
          locale: LOCALE
        })),
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

    __tm.phase('Публикация товаров',tasks.length);
    while (cursor < tasks.length && !__tm.st.stop) {
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
        '[products-category-mirror-sync] publish ' +
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

      __tm.step(batch.length);__tm.st.failed+=waveFailures;__tm.perf(adaptiveState.current,adaptiveState.bestConcurrency);
      cursor += batch.length;
    }

    if(__tm.st.stop){__tm.finish('Остановлено');throw new Error('Остановлено после завершения текущей волны');}
    __tm.finish();return { successes, failures };
  }

  function buildVerify(groupInfo, categoryStates) {
    const unionIds = new Set();

    for (const state of categoryStates) {
      for (const productDocumentId of state.ids) {
        unionIds.add(productDocumentId);
      }
    }

    const missingByCategory =
      categoryStates.map(state => ({
        category: state.category,
        missing: difference(unionIds, state.ids)
      }));

    const missingByProduct = new Map();

    for (const item of missingByCategory) {
      for (const productDocumentId of item.missing) {
        if (!missingByProduct.has(productDocumentId)) {
          missingByProduct.set(productDocumentId, []);
        }

        missingByProduct
          .get(productDocumentId)
          .push(item.category);
      }
    }

    return {
      groupInfo,
      categoryStates,
      unionIds,
      missingByCategory,
      missingByProduct,
      ok: missingByProduct.size === 0
    };
  }

  function verifyStatusForFailure(
    failure,
    verify
  ) {
    const missingTargets =
      failure.targetCategories.filter(category => {
        const state = verify.categoryStates.find(
          item =>
            item.category.documentId ===
            category.documentId
        );

        return !state?.ids.has(
          failure.productDocumentId
        );
      });

    return missingTargets.length
      ? 'missing:' +
        missingTargets
          .map(category => category.documentId)
          .join('|')
      : 'relation-present-after-error';
  }

  function issueKey(row) {
    return [
      row.group,
      row.productDocumentId,
      row.targetCategories
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
    '[products-category-mirror-sync] Проверяю MIRROR_SYNC_GROUPS...'
  );

  const categories = await resolveCategories();

  const groupInfos = MIRROR_SYNC_GROUPS.map(
    (group, index) =>
      buildGroupInfo(group, index, categories)
  );

  console.log(
    '[products-category-mirror-sync] Dry-run всех групп...'
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
  const dryRunRelations =
    dryRuns.reduce(
      (sum, analysis) =>
        sum +
        analysis.tasks.reduce(
          (taskSum, task) =>
            taskSum +
            task.targetCategories.length,
          0
        ),
      0
    );

  console.table(dryRunTable);
  console.log(
    '[products-category-mirror-sync] Dry-run: групп ' +
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

    window.productsCategoryMirrorSyncReport =
      report;

    console.log(
      '[products-category-mirror-sync] Все группы синхронизированы. ' +
      'Изменений: 0. Publish не выполнялся.'
    );
    return;
  }

  const approved = window.confirm(
    'Зеркальная синхронизация категорий товаров\n\n' +
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
      '[products-category-mirror-sync] Отменено пользователем'
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
      '[products-category-mirror-sync] Group ' +
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
        targetCategories: '',
        error: message,
        verifyStatus: 'group-read-error'
      };

      const key = issueKey(row);
      if (!issueRowKeys.has(key)) {
        issueRowKeys.add(key);
        issueRows.push(row);
      }

      console.error(
        '[products-category-mirror-sync] Group ' +
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
        '[products-category-mirror-sync] Group ' +
        groupInfo.number +
        ': уже синхронизирована'
      );
      continue;
    }

    const relationCount = tasks.reduce(
      (sum, task) =>
        sum + task.targetCategories.length,
      0
    );

    console.log(
      '[products-category-mirror-sync] Group ' +
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
      const categoryStates = await Promise.all(
        groupInfo.categories.map(
          async (category, index) => {
            const products =
              await getCategoryProducts(
                category,
                '[products-category-mirror-sync] verify | group ' +
                groupInfo.number +
                ' C' + (index + 1)
              );

            return {
              category,
              products,
              ids: new Set(products.keys())
            };
          }
        )
      );

      verify = buildVerify(
        groupInfo,
        categoryStates
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
        targetCategories: '',
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
          targetCategories:
            targetDocumentIds(failure).join('|'),
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
        '[products-category-mirror-sync] Group ' +
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
        targetCategories:
          targetDocumentIds(failure).join('|'),
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

    for (
      const [
        productDocumentId,
        missingCategories
      ] of verify.missingByProduct
    ) {
      const row = {
        group: groupInfo.number,
        productDocumentId,
        targetCategories:
          missingCategories
            .map(category =>
              category.documentId
            )
            .join('|'),
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
      [...verify.missingByProduct.values()]
        .reduce(
          (sum, missingCategories) =>
            sum + missingCategories.length,
          0
        );

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
      verify.categoryStates
        .map((state, index) =>
          'C' + (index + 1) +
          '=' + state.ids.size
        )
        .join(' | ');

    console.log(
      '[products-category-mirror-sync] Group ' +
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

  window.productsCategoryMirrorSyncReport =
    report;

  console.log(
    '[products-category-mirror-sync] Итог'
  );
  console.table(groupResults);

  if (adaptiveState.waves.length) {
    console.log(
      '[products-category-mirror-sync] Adaptive concurrency benchmark'
    );
    console.table(adaptiveState.waves);
  }

  console.log(
    '[products-category-mirror-sync] Готово | dry-run ' +
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
      'products-category-mirror-sync-errors.csv'
    );
  }
})();
