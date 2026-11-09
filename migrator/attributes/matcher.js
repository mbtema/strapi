// Этап 2: Bitrix Admin -> Console -> attributes-matched.csv
// Вход: attributes-config.csv, 10 колонок (включая shadeHex и volumeValue).
// Выход: attributes-matched.csv (кандидаты importer по active/Media/volume),
//        attributes-shade-review.csv (отсутствующий shade),
//        attributes-volume-review.csv (нестандартные значения Bitrix, без автозаписи Volume).
// Чтение IBLOCK_ID=2 / PROPERTY_19, PROPERTY_202, PROPERTY_271, ACTIVE, DETAIL_PICTURE. Только GET.
(async () => {
  'use strict';

  const CFG = {
    iblockId: '2',
    locale: 'ru',
    // Bitrix Admin хранит состояние навигации в сессии: не запрашивать страницы параллельно.
    pageConcurrency: 1,
    maxPages: 4000,
    matchedFile: 'attributes-matched.csv',
    unmatchedFile: 'attributes-unmatched.csv',
    shadeReviewFile: 'attributes-shade-review.csv',
    volumeReviewFile: 'attributes-volume-review.csv',
    checkpointVersion: 'v6-volume-review'
  };
  const AUTH = {
    // В DevTools браузер отправляет Bitrix Cookie сам (credentials: include).
    // Заголовок Cookie нельзя установить вручную через browser fetch.
    bitrixCookies: ''
  };
  const LOG = '[Attributes matcher]';
  const BUILD = 'v5.3-indexeddb-checkpoint';
  const LIST_PATH = '/bitrix/admin/iblock_element_admin.php';
  const CARD_PATH = '/bitrix/admin/iblock_element_edit.php';
  const VOLUME_IBLOCK_ID = '12';

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

  // Сравнение по числу: "050", "50.0" и "50,00" = 50.
  // Названия "50МЛ", "50ГР" здесь намеренно не используются.
  function volumeNumber(value, context) {
    const raw = trim(value);
    if (!raw) return '';
    const m = /^(\d+)(?:[.,](\d+))?$/.exec(raw);
    if (!m) throw Error(context + ': volume должен быть числом без единиц: ' + JSON.stringify(raw));
    const whole = m[1].replace(/^0+(?=\d)/, '');
    const fractional = (m[2] ?? '').replace(/0+$/, '');
    return whole + (fractional ? '.' + fractional : '');
  }

  function bitrixVolume(cell, page, id) {
    const context = 'Страница ' + page + ', Bitrix ID ' + id + ', PROPERTY_202';
    const content = cell?.querySelector('.main-grid-cell-content') ?? cell;
    if (!content) throw Error(context + ': отсутствует ячейка');
    const rawText = trim(content.textContent);
    const anchors = [...content.querySelectorAll('a[href]')];
    if (!anchors.length) {
      if (!rawText) return { status: 'empty', value: '', raw: '', refId: '' };
      // Не принимаем текст без подтверждённого ID за пустую relation:
      // иначе будущий Importer удалит Volume в Strapi.
      return { status: 'manual', value: '', raw: rawText, refId: '' };
    }
    if (anchors.length !== 1) throw Error(context + ': неоднозначные ссылки Volume');
    let target;
    try { target = new URL(anchors[0].getAttribute('href'), location.origin); }
    catch { throw Error(context + ': некорректная ссылка'); }
    const refId = target.searchParams.get('ID');
    if (target.origin !== location.origin || target.pathname !== CARD_PATH ||
        target.searchParams.get('IBLOCK_ID') !== VOLUME_IBLOCK_ID ||
        !/^\d+$/.test(refId ?? '') ||
        trim(anchors[0].textContent) !== refId) {
      throw Error(context + ': ссылка не указывает на ожидаемый справочник Volume');
    }
    // Пример: "100 [62913]" или нестандартное значение "2х5 [107307]".
    // Строго подтверждаем ID по ссылке, но не пытаемся преобразовать 2х5 в 10.
    const display = /^(.+?)\s*\[\s*(\d+)\s*\]$/.exec(rawText);
    if (!display || display[2] !== refId) {
      throw Error(context + ': ID в ячейке не совпадает со ссылкой или формат повреждён: ' +
        JSON.stringify(rawText.slice(0, 90)));
    }
    const raw = trim(display[1]);
    if (!/^\d+(?:[.,]\d+)?$/.test(raw)) {
      return { status: 'manual', value: '', raw, refId };
    }
    return { status: 'known', value: volumeNumber(raw, context), raw, refId };
  }

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

  function pageUrl(page) {
    const u = new URL(LIST_PATH, location.origin);
    u.searchParams.set('IBLOCK_ID', CFG.iblockId);
    u.searchParams.set('type', 'catalog');
    u.searchParams.set('lang', CFG.locale);
    u.searchParams.set('find_el_y', 'Y');
    u.searchParams.set('apply_filter', 'Y');
    // Подтверждено Network: сортировка Bitrix main.ui.grid — by=id&order=asc.
    // Применяем к КАЖДОЙ странице, а не полагаемся только на состояние сессии.
    u.searchParams.set('by', 'id');
    u.searchParams.set('order', 'asc');
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

  function originalImageUrl(cell, page, id) {
    // В Bitrix в <a href> — оригинал, в <img src> — resize_cache (миниатюра).
    // Только публичный оригинал /upload/iblock/; не читаем никакие карточки.
    const anchors = [...cell.querySelectorAll('a[href]')];
    const originals = new Set();
    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') ?? '';
      if (!href.includes('/upload/iblock/')) continue;
      let url;
      try { url = new URL(href, location.origin); }
      catch { throw Error('Страница ' + page + ', Bitrix ID ' + id + ': неверный href Media'); }
      if (url.origin !== location.origin || url.username || url.password ||
          url.search || url.hash ||
          !/^\/upload\/iblock\/(?!resize_cache\/)[^?#]+\.(?:jpe?g|png|webp|gif)$/i.test(url.pathname)) {
        throw Error('Страница ' + page + ', Bitrix ID ' + id +
          ': URL оригинала Media не прошёл проверку: ' + url.pathname);
      }
      originals.add(url.href);
    }
    if (originals.size > 1) {
      throw Error('Страница ' + page + ', Bitrix ID ' + id +
        ': несколько разных оригиналов DETAIL_PICTURE');
    }
    if (originals.size === 1) return [...originals][0];

    const hasPreview = [...cell.querySelectorAll('img[src]')].some(img => {
      const src = img.getAttribute('src') ?? '';
      return src.includes('/upload/resize_cache/') || src.includes('/upload/iblock/');
    });
    if (hasPreview || anchors.some(a => (a.getAttribute('href') ?? '').includes('/upload/'))) {
      throw Error('Страница ' + page + ', Bitrix ID ' + id +
        ': есть превью/ссылка на Media, но URL оригинала не подтверждён');
    }
    return '';
  }

  function parseGrid(html, page, target, pictureWanted) {
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
    const activeIndex = heads.findIndex(th => th.dataset.name === 'ACTIVE');
    if (activeIndex < 0) {
      throw Error('Страница ' + page + ': нет колонки ACTIVE. ' +
        'В настройках таблицы Bitrix включи «Активность» и повтори matcher.');
    }
    const pictureIndexes = heads.map((th, index) =>
      th.dataset.name === 'DETAIL_PICTURE' ||
      /детальная картинка/i.test(th.textContent ?? '') ? index : -1
    ).filter(index => index >= 0);
    if (pictureIndexes.length !== 1) {
      throw Error('Страница ' + page + ': нет единственной колонки DETAIL_PICTURE. ' +
        'Включи «Детальная картинка» в настройках таблицы Bitrix.');
    }
    const pictureIndex = pictureIndexes[0];
    const volumeIndex = heads.findIndex(th => th.dataset.name === 'PROPERTY_202');
    const hintIndex = heads.findIndex(th => th.dataset.name === 'PROPERTY_271');
    if (volumeIndex < 0 || hintIndex < 0) {
      throw Error('Страница ' + page + ': включи в таблице Bitrix колонки ' +
        (volumeIndex < 0 ? '«Объём» (PROPERTY_202) ' : '') +
        (hintIndex < 0 ? '«Текст-подсказка» (PROPERTY_271)' : ''));
    }
    if (!heads.some(th => th.dataset.name === 'ID')) {
      throw Error('Страница ' + page + ': в таблице нет заголовка ID');
    }

    // В Bitrix grid есть скрытая служебная строка main-grid-not-count
    // с data-id="template_0": это шаблон редактора, а не предложение.
    // Пропускаем ТОЛЬКО явно опознанные шаблоны, чтобы не скрыть ошибки данных.
    const bodyRows = [...table.querySelectorAll('tbody > tr.main-grid-row-body[data-id]')]
      .filter(tr => !(
        tr.classList.contains('main-grid-not-count') &&
        tr.hasAttribute('hidden') &&
        /^template_\d+$/.test(tr.dataset.id ?? '')
      ));
    const rows = bodyRows.map(tr => {
      const cells = [...tr.querySelectorAll(':scope > td')];
      const id = trim(tr.dataset.id);
      if (!/^\d+$/.test(id) || cells.length !== heads.length || !cells[barcodeIndex]) {
        throw Error('Страница ' + page + ': некорректные ID/ячейки строки ' +
          id + ' (cells=' + cells.length + ', headers=' + heads.length + ')');
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
      // Для проверки уникальности учитываем весь Bitrix, а ACTIVE читаем только
      // для barcode из Strapi, иначе неизвестная разметка чужих строк остановит аудит.
      if (!target.has(barcode)) return { id, barcode, active: null, pictureUrl: '' };
      const activeCell = cells[activeIndex];
      const content = activeCell?.querySelector('.main-grid-cell-content') ?? activeCell;
      const value = trim(content?.textContent).toLowerCase();
      const iconLabels = [...(content?.querySelectorAll('img[alt],img[title]') ?? [])]
        .flatMap(img => [img.getAttribute('alt'), img.getAttribute('title')])
        .map(v => trim(v).toLowerCase()).filter(Boolean);
      const parseActive = text => {
        if (['да','y','yes','true','1','активен'].includes(text)) return true;
        if (['нет','n','no','false','0','неактивен'].includes(text)) return false;
        return null;
      };
      const candidates = [...new Set([value, ...iconLabels].filter(Boolean))];
      const parsed = candidates.map(parseActive).filter(v => v !== null);
      if (!parsed.length || new Set(parsed).size !== 1 ||
          (value && parseActive(value) === null)) {
        throw Error('Страница ' + page + ', Bitrix ID ' + id +
          ': не удалось прочитать ACTIVE (значение: ' +
          JSON.stringify(value.slice(0, 70)) + '). Нужен HTML ячейки ACTIVE.');
      }
      // Ссылки не сохраняем для записей, где Strapi Media уже существует.
      const pictureUrl = pictureWanted.has(barcode)
        ? originalImageUrl(cells[pictureIndex], page, id)
        : '';
      const volume = bitrixVolume(cells[volumeIndex], page, id);
      const shadeHint = trim(
        (cells[hintIndex]?.querySelector('.main-grid-cell-content') ??
          cells[hintIndex])?.textContent
      );
      return { id, barcode, active: parsed[0], pictureUrl,
        volumeValue: volume.value, volumeStatus: volume.status,
        volumeRaw: volume.raw, volumeRefId: volume.refId, shadeHint };
    });

    const totalText = doc.querySelector(
      '.main-grid-panel-total .main-grid-panel-content-text'
    )?.textContent ?? '';
    return { rows, total: parseTotal(totalText), totalText: trim(totalText) };
  }

  // Не полагаемся на видимую стрелку в браузере: каждый ответ GET обязан
  // содержать строго возрастающие ID, включая переход между страницами.
  // BigInt исключает ошибки числового округления больших идентификаторов.
  function ascendingIssue(rows, previousId) {
    let prev = previousId == null ? null : BigInt(previousId);
    for (const row of rows) {
      const current = BigInt(row.id);
      if (prev !== null && current <= prev) {
        return 'нарушен ID ASC: ' + row.id + ' после ' + prev;
      }
      prev = current;
    }
    return null;
  }

  function digest(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
      .then(buffer => [...new Uint8Array(buffer)].slice(0, 12)
        .map(b => b.toString(16).padStart(2, '0')).join(''));
  }

  // IndexedDB хранит большой checkpoint без жёсткого лимита localStorage.
  // Объект state сохраняем атомарно по ключу версии + хешу исходного CSV.
  function openCheckpointDb() {
    if (!window.indexedDB) {
      throw Error('Для checkpoint требуется IndexedDB. Проверь доступ к хранилищу браузера.');
    }
    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open('tm-attributes-matcher', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('checkpoints')) {
          request.result.createObjectStore('checkpoints');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(Error('Не удалось открыть IndexedDB: ' + request.error?.message));
      request.onblocked = () => reject(Error('IndexedDB заблокирован другой вкладкой Bitrix'));
    });
  }

  function readCheckpoint(db, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('checkpoints', 'readonly');
      const request = tx.objectStore('checkpoints').get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(Error('Не удалось прочитать checkpoint из IndexedDB'));
      tx.onabort = () => reject(Error('Чтение checkpoint из IndexedDB прервано'));
    });
  }

  function writeCheckpoint(db, key, state) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('checkpoints', 'readwrite');
      tx.objectStore('checkpoints').put(state, key);
      // Считаем страницу сохранённой только после commit всей транзакции.
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(Error('Не удалось сохранить checkpoint в IndexedDB: ' +
        (tx.error?.message ?? 'ошибка хранилища')));
      tx.onabort = () => reject(Error('Сохранение checkpoint в IndexedDB прервано: ' +
        (tx.error?.message ?? 'ошибка хранилища')));
    });
  }

  function deleteCheckpoint(db, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('checkpoints', 'readwrite');
      tx.objectStore('checkpoints').delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(Error('Не удалось очистить checkpoint в IndexedDB'));
      tx.onabort = () => reject(Error('Очистка checkpoint в IndexedDB прервана'));
    });
  }

  let checkpointDb = null;

  try {
    if (AUTH.bitrixCookies.trim()) {
      console.warn(LOG, 'AUTH.bitrixCookies не применяется в браузере: Cookie отправляются текущей сессией Bitrix.');
    }
    console.log(LOG, 'Версия:', BUILD, '| Volume: числа автоматически, 2х5 — вручную');
    console.log(LOG, 'Выбери attributes-config.csv из Strapi.');
    const file = await chooseFile();
    if (!file) {
      console.log(LOG, 'Выбор файла отменён');
      return;
    }
    const fileText = await file.text();
    const csv = parseCsv(fileText);
    const header = csv.shift();
    const sourceHeader = 'documentId;barcode;active;hasDetailPicture;' +
      'shade;shadeDocumentId;volume;volumeDocumentId;shadeHex;volumeValue';
    if (!header || header.join(';') !== sourceHeader ||
        !csv.length || csv.some(row => row.length !== 10)) {
      throw Error('Нужен attributes-config.csv из обновлённого Config (10 колонок): ' +
        sourceHeader);
    }

    const inputRows = csv.map(([documentId, barcode, active, hasDetailPicture,
      shade, shadeDocumentId, volume, volumeDocumentId, shadeHex, volumeValue], index) => {
      if (!['true','false','null'].includes(active) ||
          !['true','false'].includes(hasDetailPicture)) {
        throw Error('CSV строка ' + (index + 2) + ': некорректные active/hasDetailPicture');
      }
      if (/^[+-]?\d+(?:[.,]\d+)?[eE][+-]?\d+$/.test(barcode)) {
        throw Error('CSV строка ' + (index + 2) +
          ': barcode в научном формате Excel; возьми оригинальный CSV из config.js.');
      }
      if (!shadeDocumentId && (shade || shadeHex)) {
        throw Error('CSV строка ' + (index + 2) + ': Shade заполнен без relation documentId');
      }
      if (!volumeDocumentId && (volume || volumeValue)) {
        throw Error('CSV строка ' + (index + 2) + ': Volume заполнен без relation documentId');
      }
      return { documentId, barcode,
        active: active === 'null' ? null : active === 'true',
        hasDetailPicture: hasDetailPicture === 'true',
        shadeDocumentId, volumeDocumentId,
        volumeValue: volumeNumber(volumeValue, 'CSV строка ' + (index + 2)) };
    });
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
    const pictureWanted = new Set(inputRows.filter(row =>
      !row.hasDetailPicture && target.has(row.barcode)
    ).map(row => row.barcode));
    const inputHash = await digest(fileText);

    console.log(LOG, 'Strapi:', inputRows.length, '| уникальных непустых barcode:', target.size);
    const first = parseGrid(await readPage(1), 1, target, pictureWanted);
    const firstOrderIssue = ascendingIssue(first.rows, null);
    if (firstOrderIssue) {
      throw Error('Страница 1: ' + firstOrderIssue +
        '. Bitrix не применил сортировку ID ASC; не продолжаю без проверки Network.');
    }
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
    // Совместимость: сохранённый checkpoint v6 из localStorage автоматически
    // переносится в IndexedDB после обычных проверок целостности.
    checkpointDb = await openCheckpointDb();
    let state = await readCheckpoint(checkpointDb, checkpointKey);
    let fromLegacyStorage = false;
    if (state === null) {
      const saved = localStorage.getItem(checkpointKey);
      if (saved) {
        try { state = JSON.parse(saved); }
        catch { throw Error('Старый checkpoint повреждён; остановлено без экспорта'); }
        fromLegacyStorage = true;
      }
    }
    if (state !== null) {
      if (state?.total !== total || state?.pageSize !== size ||
          state?.pageCount !== pageCount || state?.firstSignature !== firstSignature ||
          !Number.isSafeInteger(state.nextPage) || state.nextPage < 2 ||
          state.nextPage > pageCount + 1 ||
          !Array.isArray(state.seenIds) || !Array.isArray(state.hits) ||
          (total > 0 && !/^\d+$/.test(state.lastId ?? ''))) {
        throw Error('Checkpoint не соответствует текущему списку Bitrix. ' +
          'Не продолжаю, чтобы не пропустить/дублировать предложения.');
      }
      if (fromLegacyStorage) {
        await writeCheckpoint(checkpointDb, checkpointKey, state);
        localStorage.removeItem(checkpointKey);
        console.log(LOG, 'Старый checkpoint перенесён из localStorage в IndexedDB');
      }
      console.log(LOG, 'Продолжение из checkpoint со страницы', state.nextPage);
    } else {
      state = {
        total, pageSize: size, pageCount, firstSignature, nextPage: 2,
        seenIds: first.rows.map(row => row.id),
        lastId: first.rows.at(-1)?.id ?? null,
        hits: []
      };
      const initial = new Map();
      for (const item of first.rows) {
        if (!target.has(item.barcode)) continue;
        const ids = initial.get(item.barcode) ?? [];
        ids.push({ id: item.id, active: item.active, pictureUrl: item.pictureUrl,
          volumeValue: item.volumeValue, volumeStatus: item.volumeStatus,
          volumeRaw: item.volumeRaw, volumeRefId: item.volumeRefId,
          shadeHint: item.shadeHint });
        initial.set(item.barcode, ids);
      }
      state.hits = [...initial];
      await writeCheckpoint(checkpointDb, checkpointKey, state);
    }

    const seen = new Set(state.seenIds);
    const hits = new Map(state.hits);
    if (seen.size !== state.seenIds.length ||
        [...hits].some(([barcode, ids]) => !target.has(barcode) ||
          !Array.isArray(ids) || ids.some(hit =>
            !hit || !/^\d+$/.test(hit.id) || typeof hit.active !== 'boolean' ||
            typeof hit.pictureUrl !== 'string' ||
            typeof hit.volumeValue !== 'string' || typeof hit.shadeHint !== 'string' ||
            typeof hit.volumeRaw !== 'string' || typeof hit.volumeRefId !== 'string' ||
            !['known', 'empty', 'manual'].includes(hit.volumeStatus) ||
            (hit.volumeStatus === 'known' &&
              (!hit.volumeRefId || !hit.volumeValue ||
               volumeNumber(hit.volumeValue, 'Checkpoint Bitrix ' + hit.id) !== hit.volumeValue)) ||
            (hit.volumeStatus === 'empty' &&
              (hit.volumeValue || hit.volumeRaw || hit.volumeRefId)) ||
            (hit.volumeStatus === 'manual' &&
              (hit.volumeValue || !hit.volumeRaw)) ||
            (hit.pictureUrl && (
              !pictureWanted.has(barcode) ||
              !hit.pictureUrl.startsWith(location.origin + '/upload/iblock/')
            ))))) {
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
      const results = [];
      for (let page = from; page <= to; page++) {
        let validData = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          const data = parseGrid(await readPage(page), page, target, pictureWanted);
          const expected = page < pageCount ? size : total - size * (pageCount - 1);
          const pageIds = new Set();
          const repeated = data.rows.find(row => {
            if (seen.has(row.id) || pageIds.has(row.id)) return true;
            pageIds.add(row.id);
            return false;
          });
          const orderIssue = ascendingIssue(data.rows, state.lastId);
          const stable = data.rows.length === expected &&
            (data.total === null || data.total === total) && !repeated && !orderIssue;
          if (stable) {
            validData = data;
            break;
          }
          const reason = orderIssue || (repeated
            ? 'повторился Bitrix ID ' + repeated.id
            : 'ожидалось ' + expected + ' записей и total=' + total +
              ', получено ' + data.rows.length + ' и total=' + data.total);
          if (attempt === 3) {
            throw Error('Страница ' + page + ': ' + reason +
              ' после 3 последовательных чтений. Пагинация нестабильна; ' +
              'checkpoint сохранён, CSV не сформирован.');
          }
          console.warn(LOG, 'Страница', page + ':', reason,
            '| повторное последовательное чтение', (attempt + 1) + '/3');
          await sleep(500 * attempt);
        }
        results.push({ page, data: validData });
      }

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
          ids.push({ id: row.id, active: row.active, pictureUrl: row.pictureUrl,
            volumeValue: row.volumeValue, volumeStatus: row.volumeStatus,
            volumeRaw: row.volumeRaw, volumeRefId: row.volumeRefId,
            shadeHint: row.shadeHint });
          hits.set(row.barcode, ids);
        }
      }
      state.nextPage = to + 1;
      state.lastId = results.at(-1)?.data.rows.at(-1)?.id ?? state.lastId;
      state.seenIds = [...seen];
      state.hits = [...hits];
      await writeCheckpoint(checkpointDb, checkpointKey, state);
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
    const shadeReview = [];
    const volumeReview = [];
    const summary = {
      totalStrapi: inputRows.length, totalBitrix: total,
      candidates: 0, alreadySynced: 0, needsActive: 0, missingStrapiPicture: 0,
      needsVolumeAdd: 0, needsVolumeReplace: 0, needsVolumeRemove: 0,
      shadeManualReview: 0, shadeAlreadyLinked: 0, volumeManualReview: 0,
      noBitrixPicture: 0, emptyBarcode: 0, notFound: 0,
      duplicateStrapiBarcode: 0, duplicateBitrixBarcode: 0
    };
    for (const row of inputRows) {
      let status, hit = null;
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
          hit = ids[0];

          // Shade: текст-подсказка — единственный подтверждённый признак в Bitrix.
          // Не сопоставляем с HEX; в importer Shade не передаём.
          if (hit.shadeHint.trim()) {
            if (row.shadeDocumentId) {
              summary.shadeAlreadyLinked++;
            } else {
              summary.shadeManualReview++;
              const bitrixCardUrl = new URL(CARD_PATH, location.origin);
              bitrixCardUrl.searchParams.set('IBLOCK_ID', CFG.iblockId);
              bitrixCardUrl.searchParams.set('type', 'catalog');
              bitrixCardUrl.searchParams.set('lang', CFG.locale);
              bitrixCardUrl.searchParams.set('ID', hit.id);
              shadeReview.push({
                documentId: row.documentId, barcode: row.barcode,
                bitrixId: hit.id, bitrixShadeHint: hit.shadeHint,
                bitrixCardUrl: bitrixCardUrl.href
              });
            }
          }

          const activeDiffers = row.active !== hit.active;
          const needsPicture = !row.hasDetailPicture && Boolean(hit.pictureUrl);

          // Нестандартный объём (например 2х5): ручная проверка.
          // Не записываем и не удаляем Volume, но active/Media обрабатываем независимо.
          if (hit.volumeStatus === 'manual') {
            summary.volumeManualReview++;
            const bitrixCardUrl = new URL(CARD_PATH, location.origin);
            bitrixCardUrl.searchParams.set('IBLOCK_ID', CFG.iblockId);
            bitrixCardUrl.searchParams.set('type', 'catalog');
            bitrixCardUrl.searchParams.set('lang', CFG.locale);
            bitrixCardUrl.searchParams.set('ID', hit.id);
            volumeReview.push({
              documentId: row.documentId, barcode: row.barcode, bitrixId: hit.id,
              bitrixVolumeRaw: hit.volumeRaw, bitrixVolumeRefId: hit.volumeRefId,
              strapiVolumeDocumentId: row.volumeDocumentId,
              strapiVolumeValue: row.volumeValue,
              bitrixCardUrl: bitrixCardUrl.href
            });
          }
          // Только подтверждённые числовые или действительно пустые Bitrix values.
          // Ручная нормализация name в Strapi сохраняется при совпадении value.
          const needsVolume = hit.volumeStatus === 'manual' ? false :
            hit.volumeStatus === 'known'
              ? row.volumeValue !== hit.volumeValue
              : Boolean(row.volumeDocumentId);
          const volumeAction = !needsVolume ? '' :
            hit.volumeStatus === 'empty' ? 'remove' :
            !row.volumeDocumentId ? 'add' : 'replace';

          if (!activeDiffers && !needsPicture && !needsVolume) {
            status = row.hasDetailPicture ? 'ALREADY_SYNCED' : 'NO_BITRIX_PICTURE';
            if (status === 'ALREADY_SYNCED') summary.alreadySynced++;
            else summary.noBitrixPicture++;
          } else {
            status = 'MATCHED';
            summary.candidates++;
            if (activeDiffers) summary.needsActive++;
            if (needsPicture) summary.missingStrapiPicture++;
            if (volumeAction === 'add') summary.needsVolumeAdd++;
            if (volumeAction === 'replace') summary.needsVolumeReplace++;
            if (volumeAction === 'remove') summary.needsVolumeRemove++;
          }
        }
      }
      if (status === 'MATCHED') {
        mapped.push({
          documentId: row.documentId, barcode: row.barcode,
          active: row.active === null ? 'null' : String(row.active),
          hasDetailPicture: String(row.hasDetailPicture),
          bitrixId: hit.id, bitrixActive: String(hit.active),
          pictureUrl: hit.pictureUrl,
          volumeDocumentId: row.volumeDocumentId,
          volumeValue: row.volumeValue,
          bitrixVolumeValue: hit.volumeValue,
          bitrixVolumeStatus: hit.volumeStatus
        });
      } else if (status !== 'ALREADY_SYNCED') {
        diagnostics.push({ documentId: row.documentId, barcode: row.barcode,
          status, bitrixIds: (hits.get(row.barcode) ?? []).map(hit => hit.id).join('|') });
      }
    }

    window.bitrixAttributesMatchResult = {
      summary, rows: mapped, unmatched: diagnostics, shadeReview, volumeReview
    };
    window.bitrixAttributesMatchExport = () => {
      downloadCsv(CFG.matchedFile,
        ['documentId', 'barcode', 'active', 'hasDetailPicture',
          'bitrixId', 'bitrixActive', 'pictureUrl',
          'volumeDocumentId', 'volumeValue', 'bitrixVolumeValue',
          'bitrixVolumeStatus'], mapped);
      if (diagnostics.length) {
        setTimeout(() => downloadCsv(CFG.unmatchedFile,
          ['documentId', 'barcode', 'status', 'bitrixIds'], diagnostics), 750);
      }
      if (shadeReview.length) {
        setTimeout(() => downloadCsv(CFG.shadeReviewFile,
          ['documentId', 'barcode', 'bitrixId', 'bitrixShadeHint', 'bitrixCardUrl'],
          shadeReview), 1500);
      }
      if (volumeReview.length) {
        setTimeout(() => downloadCsv(CFG.volumeReviewFile,
          ['documentId', 'barcode', 'bitrixId', 'bitrixVolumeRaw', 'bitrixVolumeRefId',
            'strapiVolumeDocumentId', 'strapiVolumeValue', 'bitrixCardUrl'],
          volumeReview), 2250);
      }
    };
    window.bitrixAttributesMatchExport();
    await deleteCheckpoint(checkpointDb, checkpointKey);
    // Если миграция из localStorage не понадобилась, старых данных здесь нет.
    localStorage.removeItem(checkpointKey);

    console.table([summary]);
    console.log(LOG, 'Готово. Проверено все', total,
      'Bitrix предложений за', ((performance.now() - started) / 1000).toFixed(1),
      'сек. Изменений в Bitrix нет.');
    console.log(LOG, 'attributes-matched.csv: кандидатов importer', mapped.length +
      ' (volume add/replace/remove:', summary.needsVolumeAdd + '/' +
      summary.needsVolumeReplace + '/' + summary.needsVolumeRemove + ')');
    console.log(LOG, 'attributes-shade-review.csv: ручная работа', shadeReview.length +
      '; Shade уже назначен:', summary.shadeAlreadyLinked +
      '. Importer не меняет Shade.');
    console.log(LOG, 'attributes-volume-review.csv: нестандартные объёмы', volumeReview.length +
      '. Для них автоматическое изменение Volume запрещено.');
  } catch (error) {
    console.error(LOG, 'STOP. Итоговый CSV не создаётся при ошибке.', error);
  } finally {
    checkpointDb?.close();
    window.__tmAttributesMatcherRunning = false;
  }
})();