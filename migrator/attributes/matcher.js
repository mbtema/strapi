// Этап 2: Bitrix Admin -> Console -> attributes-matched.csv
// Вход: attributes-config.csv (documentId;barcode).
// Выход: те же строки + bitrixUrl; у неподтверждённых совпадений URL пуст.
// Чтение IBLOCK_ID=2 / PROPERTY_19, только GET; никакого изменения элементов.
(async () => {
  'use strict';

  const CFG = {
    iblockId: '2',
    locale: 'ru',
    pageConcurrency: 4,
    maxPages: 4000,
    matchedFile: 'attributes-matched.csv',
    unmatchedFile: 'attributes-unmatched.csv',
    checkpointVersion: 'v1'
  };
  const AUTH = {
    // В DevTools браузер отправляет Bitrix Cookie сам (credentials: include).
    // Заголовок Cookie нельзя установить вручную через browser fetch.
    // Для Node importer будет отдельный ключ AUTH.bitrixCookies.
    bitrixCookies: ''
  };
  const LOG = '[Attributes matcher]';
  const LIST_PATH = '/bitrix/admin/iblock_element_admin.php';
  const CARD_PATH = '/bitrix/admin/iblock_element_edit.php';

  if (!location.pathname.startsWith('/bitrix/admin/')) {
    throw Error('Открой Bitrix Admin и запусти скрипт в DevTools Console');
  }
  if (window.__tmAttributesMatcherRunning) {
    throw Error('Matcher уже работает');
  }
  window.__tmAttributesMatcherRunning = true;
  window.bitrixAttributesMatchStop = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const trim = x => String(x ?? '').replace(/^\uFEFF/, '').trim();
  const quote = x => '"' + String(x ?? '').replace(/"/g, '""') + '"';

  // Точное сопоставление строк. Только trim по краям; ведущие нули и регистр не меняем.
  const barcodeOf = x => String(x ?? '').trim();

  function parseCsv(text) {
    const src = text.replace(/^\uFEFF/, '');
    const rows = [];
    let cells = [], cell = '', inQuotes = false, afterQuote = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inQuotes) {
        if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') { inQuotes = false; afterQuote = true; }
        else cell += ch;
      } else if (afterQuote) {
        if (ch === ';' || ch === '\n' || ch === '\r') {
          afterQuote = false;
          if (ch === ';') { cells.push(cell); cell = ''; }
          else if (ch === '\n') {
            cells.push(cell); rows.push(cells); cells = []; cell = '';
          } else if (src[i + 1] === '\n') { i++; cells.push(cell); rows.push(cells); cells = []; cell = ''; }
          else { cells.push(cell); rows.push(cells); cells = []; cell = ''; }
        } else { throw Error('Некорректный CSV: символ после закрывающей кавычки'); }
      } else if (ch === '"' && cell === '') {
        inQuotes = true;
      } else if (ch === ';') {
        cells.push(cell); cell = '';
      } else if (ch === '\n') {
        cells.push(cell.replace(/\r$/, ''));
        rows.push(cells); cells = []; cell = '';
      } else if (ch === '\r') {
        if (src[i + 1] === '\n') { i++; }
        cells.push(cell); rows.push(cells); cells = []; cell = '';
      } else if (ch === '"') {
        throw Error('Некорректный CSV: кавычка в неэкранированной ячейке');
      } else {
        cell += ch;
      }
    }
    if (inQuotes) throw Error('Некорректный CSV: незакрытые кавычки');
    if (cell || cells.length || afterQuote) {
      cells.push(cell);
      rows.push(cells);
    }
    return rows.filter(r => r.some(v => v !== ''));
  }

  function chooseFile() {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv,text/csv';
      input.hidden = true;
      document.body.appendChild(input);
      let finished = false;
      const finish = file => {
        if (finished) return;
        finished = true;
        input.remove();
        resolve(file);
      };
      input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
      input.addEventListener('cancel', () => finish(null), { once: true });
      input.click();
    });
  }

  function downloadCsv(name, fields, data) {
    const csv = '\uFEFF' + [
      fields.join(';'),
      ...data.map(row => fields.map(key => quote(row[key])).join(';'))
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function cardUrl(id) {
    const u = new URL(CARD_PATH, location.origin);
    u.searchParams.set('IBLOCK_ID', CFG.iblockId);
    u.searchParams.set('type', 'catalog');
    u.searchParams.set('lang', CFG.locale);
    u.searchParams.set('ID', id);
    return u.href;
  }

  function pageUrl(page) {
    const u = new URL(LIST_PATH, location.origin);
    u.searchParams.set('IBLOCK_ID', CFG.iblockId);
    u.searchParams.set('type', 'catalog');
    u.searchParams.set('lang', CFG.locale);
    u.searchParams.set('find_el_y', 'Y');
    u.searchParams.set('apply_filter', 'Y');
    if (page === 1) u.searchParams.set('clear_filter', 'Y');
    else u.searchParams.set('PAGEN_1', String(page));
    return u.href;
  }

  async function readPage(page) {
    const url = pageUrl(page);
    for (let attempt = 1; attempt <= 3; attempt++) {
      let response;
      try {
        response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'text/html' },
          redirect: 'follow'
        });
      } catch (err) {
        if (attempt === 3) throw Error('Страница ' + page + ': ' + err.message);
        await sleep(attempt * 450);
        continue;
      }
      if (new URL(response.url).origin !== location.origin) {
        throw Error('Страница ' + page + ': редирект за пределы Bitrix');
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 3) throw Error('Страница ' + page + ': HTTP ' + response.status);
        await sleep(attempt * 600);
        continue;
      }
      if (!response.ok) {
        throw Error('Страница ' + page + ': HTTP ' + response.status);
      }
      return response.text();
    }
  }

  function parseTotal(text) {
    const value = text.replace(/[\u00a0\u202f]/g, ' ').trim();
    const part = value.match(/(?:всего|total)\s*:?\s*([\d., ]+)/i) ??
      value.match(/^([\d., ]+)$/);
    if (!part) return null;
    const number = Number(part[1].replace(/[., ]/g, ''));
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  }

  function parseGrid(html, page) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const matches = [...doc.querySelectorAll('table.main-grid-table')].map(table => {
      const head = [...table.querySelectorAll('thead tr.main-grid-row-head > th')];
      return { table, barcodeIndex: head.findIndex(th => th.dataset.name === 'PROPERTY_19'),
        heads: head };
    }).filter(x => x.barcodeIndex >= 0);
    if (matches.length !== 1) {
      throw Error('Страница ' + page + ': не найден единственный Bitrix grid с колонкой PROPERTY_19. ' +
        'Убедись, что колонка «Штрихкод» отображается в списке, либо пришли Network/HTML таблицы.');
    }
    const { table, barcodeIndex, heads } = matches[0];
    if (!heads.some(th => th.dataset.name === 'ID')) {
      throw Error('Страница ' + page + ': в таблице нет заголовка ID');
    }

    const bodyRows = [...table.querySelectorAll('tbody > tr.main-grid-row-body[data-id]')];
    const rows = bodyRows.map(tr => {
      const cells = [...tr.querySelectorAll(':scope > td')];
      const id = trim(tr.dataset.id);
      if (!/^\d+$/.test(id) || !cells[barcodeIndex]) {
        throw Error('Страница ' + page + ': нет ID строки или ячейки PROPERTY_19');
      }

      // Известный шаблон карточки проверяем по реальным ссылкам строки, если они есть.
      const cardLinks = [...tr.querySelectorAll('a[href]')].map(a => {
        try { return new URL(a.getAttribute('href'), location.origin); }
        catch { return null; }
      }).filter(Boolean).filter(u =>
        u.origin === location.origin &&
        u.pathname.endsWith(CARD_PATH) &&
        u.searchParams.get('IBLOCK_ID') === CFG.iblockId
      );
      if (cardLinks.some(u => u.searchParams.get('ID') !== id)) {
        throw Error('Страница ' + page + ': ID ссылки не совпадает с ID строки ' + id);
      }
      const barcode = barcodeOf(cells[barcodeIndex].textContent);
      return { id, barcode };
    });

    const totalText = doc.querySelector(
      '.main-grid-panel-total .main-grid-panel-content-text'
    )?.textContent ?? '';
    return { rows, total: parseTotal(totalText), totalText: trim(totalText) };
  }

  function digest(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
      .then(buffer => [...new Uint8Array(buffer)].slice(0, 12)
        .map(b => b.toString(16).padStart(2, '0')).join(''));
  }

  try {
    if (AUTH.bitrixCookies.trim()) {
      console.warn(LOG, 'AUTH.bitrixCookies не применяется в браузере: Cookie отправляются текущей сессией Bitrix.');
    }
    console.log(LOG, 'Выбери attributes-config.csv из Strapi.');
    const file = await chooseFile();
    if (!file) {
      console.log(LOG, 'Выбор файла отменён');
      return;
    }
    const fileText = await file.text();
    const csv = parseCsv(fileText);
    const header = csv.shift();
    if (!header || header.join(';') !== 'documentId;barcode' || !csv.length ||
        csv.some(row => row.length !== 2)) {
      throw Error('Нужен непустой attributes-config.csv со строго двумя колонками: documentId;barcode');
    }

    const inputRows = csv.map(([documentId, barcode]) => ({ documentId, barcode }));
    if (inputRows.some(row => !row.documentId || row.documentId !== row.documentId.trim())) {
      throw Error('Пустой или некорректный documentId в исходном CSV');
    }
    if (new Set(inputRows.map(row => row.documentId)).size !== inputRows.length) {
      throw Error('Повторяющиеся documentId в исходном CSV');
    }
    const counts = new Map();
    for (const row of inputRows) {
      if (barcodeOf(row.barcode)) {
        counts.set(row.barcode, (counts.get(row.barcode) || 0) + 1);
      }
    }
    const target = new Set([...counts].filter(([, count]) => count === 1).map(([barcode]) => barcode));
    const inputHash = await digest(fileText);

    console.log(LOG, 'Strapi:', inputRows.length, '| уникальных непустых barcode:', target.size);
    const first = parseGrid(await readPage(1), 1);
    if (first.total === null) {
      throw Error('Bitrix не вернул однозначный total списка (поле .main-grid-panel-total): ' +
        JSON.stringify(first.totalText) + '. Пришли Network/HTML grid для точной пагинации.');
    }
    const total = first.total;
    const size = first.rows.length;
    if (total > 0 && (size === 0 || size > total)) {
      throw Error('Некорректная первая страница Bitrix: total=' + total + ', rows=' + size);
    }
    const pageCount = total === 0 ? 1 : Math.ceil(total / size);
    if (pageCount > CFG.maxPages) {
      throw Error('Ожидается ' + pageCount + ' страниц; превышен maxPages, не продолжаю');
    }
    const firstSignature = await digest(JSON.stringify(first.rows));
    const checkpointKey = 'tm:attributes-matcher:' + CFG.checkpointVersion + ':' + inputHash;
    let state;
    const saved = localStorage.getItem(checkpointKey);
    if (saved) {
      try { state = JSON.parse(saved); }
      catch { throw Error('Checkpoint повреждён; остановлено без экспорта'); }
      if (state?.total !== total || state?.pageSize !== size ||
          state?.pageCount !== pageCount || state?.firstSignature !== firstSignature ||
          !Number.isSafeInteger(state.nextPage) || state.nextPage < 2 ||
          state.nextPage > pageCount + 1 ||
          !Array.isArray(state.seenIds) || !Array.isArray(state.hits)) {
        throw Error('Checkpoint не соответствует текущему списку Bitrix. ' +
          'Не продолжаю, чтобы не пропустить/дублировать предложения.');
      }
      console.log(LOG, 'Продолжение из checkpoint со страницы', state.nextPage);
    } else {
      state = {
        total, pageSize: size, pageCount, firstSignature, nextPage: 2,
        seenIds: first.rows.map(row => row.id),
        hits: []
      };
      const initial = new Map();
      for (const item of first.rows) {
        if (!target.has(item.barcode)) continue;
        const ids = initial.get(item.barcode) ?? [];
        ids.push(item.id);
        initial.set(item.barcode, ids);
      }
      state.hits = [...initial];
      localStorage.setItem(checkpointKey, JSON.stringify(state));
    }

    const seen = new Set(state.seenIds);
    const hits = new Map(state.hits);
    if (seen.size !== state.seenIds.length ||
        [...hits].some(([barcode, ids]) => !target.has(barcode) ||
          !Array.isArray(ids) || ids.some(id => !/^\d+$/.test(id)))) {
      throw Error('Checkpoint повреждён (ID или barcode)');
    }
    if (seen.size !== Math.min(total, (state.nextPage - 1) * size)) {
      throw Error('Checkpoint содержит неполный список ID; экспорт отменён');
    }

    const started = performance.now();
    console.log(LOG, 'Bitrix:', total, 'предложений,', pageCount, 'страниц, размер страницы', size);
    while (state.nextPage <= pageCount) {
      if (window.bitrixAttributesMatchStop) {
        console.warn(LOG, 'Остановлено по команде. Checkpoint сохранён. Повторный запуск продолжит.');
        return;
      }
      const from = state.nextPage;
      const to = Math.min(pageCount, from + CFG.pageConcurrency - 1);
      const results = await Promise.all(
        Array.from({ length: to - from + 1 }, (_, i) => from + i)
          .map(async page => ({ page, data: parseGrid(await readPage(page), page) }))
      );

      // Сначала валидируем ВСЮ группу, потом меняем checkpoint.
      const batchIds = new Set();
      for (const { page, data } of results) {
        const expected = page < pageCount ? size : total - size * (pageCount - 1);
        if (data.rows.length !== expected ||
            (data.total !== null && data.total !== total)) {
          throw Error('Страница ' + page + ': ожидалось ' + expected +
            ' элементов и total=' + total + ', получено ' + data.rows.length +
            ' и total=' + data.total);
        }
        for (const row of data.rows) {
          if (seen.has(row.id) || batchIds.has(row.id)) {
            throw Error('Страница ' + page + ': повторился Bitrix ID ' + row.id +
              '. Пагинация не подтверждена или список изменился. CSV не сформирован.');
          }
          batchIds.add(row.id);
        }
      }

      for (const { data } of results) {
        for (const row of data.rows) {
          seen.add(row.id);
          if (!target.has(row.barcode)) continue;
          const ids = hits.get(row.barcode) ?? [];
          ids.push(row.id);
          hits.set(row.barcode, ids);
        }
      }
      state.nextPage = to + 1;
      state.seenIds = [...seen];
      state.hits = [...hits];
      localStorage.setItem(checkpointKey, JSON.stringify(state));
      if ((to % 20 < CFG.pageConcurrency) || to === pageCount) {
        console.log(LOG, 'Страниц', to + '/' + pageCount,
          '| предложений', seen.size + '/' + total,
          '| barcode с совпадениями', hits.size);
      }
    }

    if (seen.size !== total) {
      throw Error('Прочитано ' + seen.size + ' записей, ожидалось ' + total +
        '. Полный output не создаётся');
    }
    const mapped = [];
    const diagnostics = [];
    const summary = {
      totalStrapi: inputRows.length, totalBitrix: total,
      matched: 0, emptyBarcode: 0, notFound: 0,
      duplicateStrapiBarcode: 0, duplicateBitrixBarcode: 0
    };
    for (const row of inputRows) {
      let status, bitrixUrl = '';
      if (!barcodeOf(row.barcode)) {
        status = 'EMPTY_BARCODE'; summary.emptyBarcode++;
      } else if ((counts.get(row.barcode) ?? 0) > 1) {
        status = 'DUPLICATE_STRAPI_BARCODE'; summary.duplicateStrapiBarcode++;
      } else {
        const ids = hits.get(row.barcode) ?? [];
        if (!ids.length) { status = 'NOT_FOUND'; summary.notFound++; }
        else if (ids.length > 1) {
          status = 'DUPLICATE_BITRIX_BARCODE'; summary.duplicateBitrixBarcode++;
        } else {
          status = 'MATCHED'; bitrixUrl = cardUrl(ids[0]); summary.matched++;
        }
      }
      mapped.push({ ...row, bitrixUrl });
      if (status !== 'MATCHED') {
        diagnostics.push({ documentId: row.documentId, barcode: row.barcode,
          status, bitrixIds: (hits.get(row.barcode) ?? []).join('|') });
      }
    }

    window.bitrixAttributesMatchResult = { summary, rows: mapped, unmatched: diagnostics };
    window.bitrixAttributesMatchExport = () => {
      downloadCsv(CFG.matchedFile, ['documentId', 'barcode', 'bitrixUrl'], mapped);
      if (diagnostics.length) {
        setTimeout(() => downloadCsv(CFG.unmatchedFile,
          ['documentId', 'barcode', 'status', 'bitrixIds'], diagnostics), 750);
      }
    };
    window.bitrixAttributesMatchExport();
    localStorage.removeItem(checkpointKey);

    console.table([summary]);
    console.log(LOG, 'Готово. Проверено все', total,
      'Bitrix предложений за', ((performance.now() - started) / 1000).toFixed(1),
      'сек. Изменений в Bitrix нет.');
    console.log(LOG, 'В attributes-matched.csv сохранены все строки Strapi; только уникальные точные совпадения имеют bitrixUrl.');
  } catch (error) {
    console.error(LOG, 'STOP. Итоговый CSV не создаётся при ошибке.', error);
  } finally {
    window.__tmAttributesMatcherRunning = false;
  }
})();