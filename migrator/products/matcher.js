// Этап 2: Bitrix Admin -> Console.
// Вход: migration-config.csv (documentId;name;barcodes).
// Выход: migration-matched.csv (только NAME + barcode подтверждены)
// и migration-unmatched.csv (остальные результаты).
// Запросы не изменяют товары; Bitrix filter сохраняет состояние в сессии.
(async () => {
  'use strict';

  const CFG = {
    iblockId: '1',
    locale: 'ru',
    checkpointEvery: 10,
    maxVisibleRows: 100,
    cardConcurrency: 3,
    maxPendingProducts: 4
  };

  if (!location.pathname.startsWith('/bitrix/admin/')) {
    throw Error('Открой Bitrix Admin');
  }
  if (window.__tmBitrixMatchingRunning) {
    throw Error('Сопоставление уже запущено');
  }
  window.__tmBitrixMatchingRunning = true;
  window.bitrixMatchStop = false;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const normalizeBarcode = value => String(value ?? '').replace(/\s+/g, '');
  const LIST_PATH = '/bitrix/admin/iblock_element_admin.php';
  const CARD_PATH = '/bitrix/admin/iblock_element_edit.php';

  function makeUrl(path, params = {}) {
    const url = new URL(path, location.origin);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
    return url.href;
  }

  function cardUrl(id) {
    return makeUrl(CARD_PATH, {
      IBLOCK_ID: CFG.iblockId,
      type: 'catalog',
      lang: CFG.locale,
      ID: id,
      find_section_section: '-1',
      WF: 'Y'
    });
  }

  async function request(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'include',
      redirect: 'follow',
      ...options
    });
    if (!response.ok || new URL(response.url).origin !== location.origin) {
      throw Error('Bitrix HTTP ' + response.status);
    }
    return response.text();
  }

  // CSV с разделителем ;, кавычками, экранированием и переносами строк.
  function parseCsv(input) {
    const source = input.replace(/^\uFEFF/, '');
    const output = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (quoted) {
        if (ch === '"' && source[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') {
          quoted = false;
        } else {
          cell += ch;
        }
      } else if (ch === '"' && cell === '') {
        quoted = true;
      } else if (ch === ';') {
        row.push(cell);
        cell = '';
      } else if (ch === '\n') {
        row.push(cell.replace(/\r$/, ''));
        if (row.some(v => v !== '')) output.push(row);
        row = [];
        cell = '';
      } else {
        cell += ch;
      }
    }
    if (quoted) throw Error('Незакрытые кавычки в CSV');
    if (cell !== '' || row.length) {
      row.push(cell.replace(/\r$/, ''));
      if (row.some(v => v !== '')) output.push(row);
    }
    return output;
  }

  async function selectCsv() {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv,text/csv';
      input.hidden = true;
      document.body.appendChild(input);
      let settled = false;
      const done = file => {
        if (settled) return;
        settled = true;
        input.remove();
        resolve(file);
      };
      input.addEventListener('change', () => done(input.files?.[0] ?? null), {
        once: true
      });
      input.addEventListener('cancel', () => done(null), { once: true });
      input.click();
    });
  }

  function downloadCsv(filename, columns, data) {
    const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const text = '\uFEFF' + [
      columns.join(';'),
      ...data.map(item => columns.map(key => quote(item[key])).join(';'))
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([text], {
      type: 'text/csv;charset=utf-8'
    }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  try {
    console.log('[Matcher] Выбери migration-config.csv');
    const file = await selectCsv();
    if (!file) {
      console.log('[Matcher] Файл не выбран');
      return;
    }
    const fileText = await file.text();
    const csv = parseCsv(fileText);
    const headers = csv.shift();
    if (!headers || headers.join(';') !== 'documentId;name;barcodes') {
      throw Error('Ожидаются колонки documentId;name;barcodes');
    }
    if (!csv.length || csv.some(row => row.length !== 3)) {
      throw Error('Пустой CSV или неправильное количество колонок');
    }

    const products = csv.map(([documentId, name, barcodes]) => ({
      documentId, name, barcodes
    }));
    if (products.some(p => !p.documentId || !p.name)) {
      throw Error('Пустой documentId или name');
    }
    if (new Set(products.map(p => p.documentId)).size !== products.length) {
      throw Error('В исходном CSV дубли documentId');
    }

    const nameCounts = new Map();
    for (const p of products) {
      nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1);
    }

    const hashBuffer = await crypto.subtle.digest(
      'SHA-256', new TextEncoder().encode(fileText)
    );
    const hash = [...new Uint8Array(hashBuffer)]
      .slice(0, 12)
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
    const checkpointKey = 'tm:bitrix-match:v2:' + hash;

    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(checkpointKey) || '{}');
    } catch {}
    const completed = new Map(
      Object.entries(saved).filter(([, value]) => value?.status !== 'ERROR')
    );

    console.log(
      '[Matcher] Вход: ' + products.length +
      '; подтвержденных/проверенных из checkpoint: ' + completed.size
    );

    const startedAt = performance.now();
    const listParams = {
      IBLOCK_ID: CFG.iblockId,
      type: 'catalog',
      lang: CFG.locale,
      find_section_section: '-1'
    };
    const listHtml = await request(makeUrl(LIST_PATH, listParams));
    const listDoc = new DOMParser().parseFromString(listHtml, 'text/html');
    const grid = listDoc.querySelector('.main-grid[id^="tbl_iblock_element_"]');
    const gridId = grid?.id;
    const ajaxId = grid?.dataset.ajaxid;
    const sessid = listDoc.querySelector('input[name="sessid"]')?.value;
    if (!gridId || !ajaxId || !sessid) {
      throw Error('Не найдены gridId, ajaxId или sessid Bitrix');
    }

    async function searchByName(name) {
      const filterBody = new URLSearchParams({
        'params[FILTER_ID]': gridId,
        'params[GRID_ID]': gridId,
        'params[action]': 'setFilter',
        'params[forAll]': 'false',
        'params[commonPresetsId]': '',
        'params[apply_filter]': 'Y',
        'params[clear_filter]': 'N',
        'params[with_preset]': 'N',
        'params[save]': 'Y',
        'data[fields][FIND]': '',
        'data[fields][NAME]': name,
        'data[rows]':
          'NAME,PROPERTY_19,PROPERTY_580,PROPERTY_4,' +
          'ACTIVE,SECTION_ID,CATALOG_AVAILABLE,ID,' +
          'PROPERTY_641,CODE,EXTERNAL_ID,PROPERTY_10',
        'data[preset_id]': 'tmp_filter',
        'data[name]': 'Фильтр',
        sessid
      });
      for (const field of [
        'PROPERTY_19', 'PROPERTY_580', 'PROPERTY_4', 'PROPERTY_4_label',
        'ACTIVE', 'SECTION_ID', 'CATALOG_AVAILABLE',
        'ID_from', 'ID_to', 'PROPERTY_641', 'CODE',
        'EXTERNAL_ID', 'PROPERTY_10'
      ]) {
        filterBody.set('data[fields][' + field + ']', '');
      }
      filterBody.set('data[fields][ID_numsel]', 'exact');

      const filterUrl = makeUrl('/bitrix/services/main/ajax.php', {
        'analyticsLabel[FILTER_ID]': gridId,
        'analyticsLabel[GRID_ID]': gridId,
        mode: 'ajax',
        c: 'bitrix:main.ui.filter',
        action: 'setFilter'
      });
      const text = await request(filterUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Bx-ajax': 'true'
        },
        body: filterBody.toString()
      });
      let answer;
      try { answer = JSON.parse(text); }
      catch { throw Error('Bitrix вернул не JSON при установке фильтра'); }
      if (answer?.status === 'error' || answer?.errors?.length) {
        throw Error('Bitrix отклонил фильтр NAME');
      }

      const gridUrl = makeUrl(LIST_PATH, {
        ...listParams, sessid,
        internal: 'true',
        grid_id: gridId,
        apply_filter: 'Y',
        clear_nav: 'Y',
        grid_action: 'showpage',
        bxajaxid: ajaxId
      });
      const form = new FormData();
      form.set('apply_filter', 'Y');
      form.set('clear_nav', 'Y');
      const gridHtml = await request(gridUrl, {
        method: 'POST',
        headers: {
          'Bx-ajax': 'true',
          'X-Ajax-Grid-Req': '{"action":"showpage"}',
          'X-Ajax-Grid-UID': ajaxId
        },
        body: form
      });
      const doc = new DOMParser().parseFromString(gridHtml, 'text/html');
      const table = doc.querySelector('table.main-grid-table');
      if (!table) throw Error('Bitrix grid не найден');
      const columns = [...table.querySelectorAll(
        'thead tr.main-grid-row-head > th'
      )].map(th => th.dataset.name || '');
      if (!columns.includes('NAME')) {
        throw Error('В Bitrix grid нет колонки NAME');
      }
      const ids = [...new Set(
        [...table.querySelectorAll('tbody > tr.main-grid-row-body[data-id]')]
          .map(tr => tr.dataset.id)
          .filter(id => /^\d+$/.test(id))
      )];
      const totalText = doc.querySelector(
        '.main-grid-panel-total .main-grid-panel-content-text'
      )?.textContent?.trim() ?? '';
      const total = /^\d+$/.test(totalText) ? Number(totalText) : null;
      if (total === null || total > ids.length || ids.length > CFG.maxVisibleRows) {
        throw Error('Неполный результат поиска: total=' +
          (totalText || '?') + ', rows=' + ids.length);
      }
      return ids;
    }

    async function readCard(bitrixId) {
      const html = await request(cardUrl(bitrixId));
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const nameInput = doc.querySelector('input[name="NAME"]');
      if (!nameInput) throw Error('Карточка Bitrix ' + bitrixId + ' недоступна');

      const offers = new Map();
      for (const table of doc.querySelectorAll('table')) {
        const trs = [...table.querySelectorAll('tr')].filter(tr =>
          tr.closest('table') === table
        );
        const index = trs.findIndex(tr => {
          const labels = [...tr.cells].map(cell => clean(cell.textContent));
          return labels.some(x => /^(штрих\s*[-–]?\s*код|barcode)$/i.test(x)) &&
            labels.some(x => /^id$/i.test(x));
        });
        if (index < 0) continue;
        const cols = [...trs[index].cells].map(cell => clean(cell.textContent));
        const barcodeCol = cols.findIndex(x =>
          /^(штрих\s*[-–]?\s*код|barcode)$/i.test(x)
        );
        const idCol = cols.findIndex(x => /^id$/i.test(x));
        for (const row of trs.slice(index + 1)) {
          const cells = [...row.cells];
          if (cells.length <= Math.max(barcodeCol, idCol)) continue;
          const offerId = clean(cells[idCol].textContent);
          if (!/^\d+$/.test(offerId)) continue;
          offers.set(offerId, normalizeBarcode(cells[barcodeCol].textContent));
        }
      }
      return {
        // Исходное NAME: никакого trim/toLowerCase/contains.
        name: nameInput.value,
        barcodes: [...new Set(offers.values())].filter(Boolean)
      };
    }

    // Лимит только для независимых GET карточек. Сессионный фильтр Bitrix
    // всегда обрабатывается одним последовательным потоком.
    function createLimiter(maxActive) {
      let active = 0;
      const queue = [];
      function startNext() {
        while (active < maxActive && queue.length) {
          const { work, resolve, reject } = queue.shift();
          active++;
          Promise.resolve().then(work).then(resolve, reject).finally(() => {
            active--;
            startNext();
          });
        }
      }
      return work => new Promise((resolve, reject) => {
        queue.push({ work, resolve, reject });
        startNext();
      });
    }

    const limitedCardRead = createLimiter(CFG.cardConcurrency);

    async function verifyCandidates(product, candidateIds) {
      // Проверяем ВСЕ карточки, даже если одна дала ошибку: результат
      // такого товара остаётся ERROR, как и до оптимизации.
      const responses = await Promise.allSettled(
        candidateIds.map(id => limitedCardRead(() => readCard(id)))
      );
      const failure = responses.find(x => x.status === 'rejected');
      if (failure) throw failure.reason;
      const exact = candidateIds.flatMap((bitrixId, index) => {
        const card = responses[index].value;
        return card.name === product.name
          ? [{ bitrixId, barcodes: card.barcodes }] : [];
      });
      if (exact.length === 0) {
        return { status: 'NAME_NOT_FOUND',
          details: 'Просмотрено кандидатов: ' + candidateIds.length };
      }
      if (exact.length !== 1) {
        return { status: 'NAME_DUPLICATE',
          details: 'Точных совпадений: ' + exact.length };
      }

      const sourceBarcodes = [...new Set(
        product.barcodes.split('|').map(normalizeBarcode).filter(Boolean)
      )];
      if (!sourceBarcodes.length) {
        return { status: 'BARCODE_MISSING',
          details: 'Нет штрихкодов в конфиге Strapi' };
      }
      if (sourceBarcodes.some(value => !/^\d{8,18}$/.test(value))) {
        return { status: 'BARCODE_INVALID',
          details: 'Штрихкод некорректен или преобразован Excel' };
      }
      const hit = sourceBarcodes.find(value => exact[0].barcodes.includes(value));
      if (!hit) {
        return {
          status: exact[0].barcodes.length
            ? 'BARCODE_MISMATCH' : 'BITRIX_BARCODE_MISSING',
          details: 'Bitrix ID ' + exact[0].bitrixId + ': общего barcode нет'
        };
      }
      return {
        status: 'MATCH_CONFIRMED',
        bitrixId: exact[0].bitrixId,
        bitrixCardUrl: cardUrl(exact[0].bitrixId),
        matchedBarcode: hit
      };
    }

    function persist() {
      localStorage.setItem(checkpointKey, JSON.stringify(Object.fromEntries(completed)));
    }

    const asError = error => ({
      status: 'ERROR',
      details: error instanceof Error ? error.message : String(error)
    });
    let executed = 0;
    let matchedCount = [...completed.values()].filter(
      x => x.status === 'MATCH_CONFIRMED'
    ).length;
    function recordResult(product, result) {
      completed.set(product.documentId, result);
      executed++;
      if (result.status === 'MATCH_CONFIRMED') matchedCount++;
      if (executed % CFG.checkpointEvery === 0) {
        persist();
        console.log('[Matcher] ' + completed.size + '/' + products.length +
          '; совпало ' + matchedCount + '; последний: ' + result.status);
      }
    }

    // Producer: только последовательные поиски NAME.
    // Consumer: до четырёх ожидающих проверок, до трёх GET карточек одновременно.
    const pending = new Set();
    let backgroundFailure = null;
    function scheduleVerification(product, ids) {
      const task = verifyCandidates(product, ids)
        .then(result => recordResult(product, result),
          error => recordResult(product, asError(error)))
        .catch(error => { backgroundFailure ??= error; });
      pending.add(task);
      task.then(() => pending.delete(task));
    }

    try {
      for (const product of products) {
        if (window.bitrixMatchStop || backgroundFailure) break;
        if (completed.has(product.documentId)) continue;
        if (nameCounts.get(product.name) !== 1) {
          recordResult(product, {
            status: 'STRAPI_NAME_DUPLICATE',
            details: 'Несколько Strapi Product с одинаковым NAME'
          });
          continue;
        }
        try {
          const ids = await searchByName(product.name);
          scheduleVerification(product, ids);
          if (pending.size >= CFG.maxPendingProducts) {
            await Promise.race(pending);
          }
        } catch (error) {
          recordResult(product, asError(error));
        }
      }
    } finally {
      // При остановке ждём уже начатые проверки карточек перед экспортом.
      await Promise.all(pending);
    }
    if (backgroundFailure) throw backgroundFailure;
    persist();

    const confirmed = [];
    const unmatched = [];
    for (const product of products) {
      const result = completed.get(product.documentId);
      if (!result) continue;
      if (result.status === 'MATCH_CONFIRMED') {
        confirmed.push({
          documentId: product.documentId,
          name: product.name,
          barcodes: product.barcodes,
          bitrixId: result.bitrixId,
          bitrixCardUrl: result.bitrixCardUrl,
          matchedBarcode: result.matchedBarcode
        });
      } else {
        unmatched.push({
          documentId: product.documentId,
          name: product.name,
          status: result.status,
          details: result.details ?? ''
        });
      }
    }

    const finished = completed.size === products.length;
    window.bitrixMatchResult = { confirmed, unmatched, finished, checkpointKey };
    window.bitrixMatchExport = () => {
      downloadCsv(
        finished ? 'migration-matched.csv' : 'migration-matched-partial.csv',
        ['documentId', 'name', 'barcodes', 'bitrixId',
          'bitrixCardUrl', 'matchedBarcode'],
        confirmed
      );
      if (unmatched.length) {
        setTimeout(() => downloadCsv('migration-unmatched.csv',
          ['documentId', 'name', 'status', 'details'], unmatched), 700);
      }
    };
    window.bitrixMatchExport();

    const summary = {};
    for (const result of completed.values()) {
      summary[result.status] = (summary[result.status] ?? 0) + 1;
    }
    console.log('[Matcher] Итог:');
    console.table(Object.entries(summary).map(([status, count]) => ({ status, count })));
    console.table(confirmed.slice(0, 5).map(item => ({
      name: item.name,
      bitrixId: item.bitrixId,
      matchedBarcode: item.matchedBarcode,
      bitrixCardUrl: item.bitrixCardUrl
    })));
    console.log('[Matcher] Время выполнения: ' +
      ((performance.now() - startedAt) / 1000).toFixed(1) + ' сек.');
    console.log('[Matcher] ' + (finished ? 'Готово' : 'Остановлено') +
      ': ' + completed.size + '/' + products.length +
      '; совпало ' + confirmed.length +
      '; не совпало ' + unmatched.length);
    console.log('[Matcher] Товары не изменены; обновлён только поисковый фильтр Bitrix.');
  } catch (error) {
    console.error('[Matcher] STOP:', error);
  } finally {
    window.__tmBitrixMatchingRunning = false;
  }
})();