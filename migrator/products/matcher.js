// Этап 2: Bitrix Admin -> Console. Только чтение Bitrix.
// Вход: products-config.csv (12 колонок Config, все товары Strapi ru).
// Выход: products-matched.csv (Config + данные Bitrix, только необходимые изменения)
// и products-unmatched.csv (ошибки сопоставления/проверки).
// Checkpoint: IndexedDB, по хешу входного CSV; неполные CSV не экспортируются.
(async () => {
  'use strict';

  const CFG = {
    iblockId: '1',
    locale: 'ru',
    checkpointEvery: 10,
    maxVisibleRows: 100,
    cardConcurrency: 3,
    maxPendingProducts: 4,
    checkpointVersion: 'v3-content'
  };

  const INPUT_FIELDS = [
    'documentId', 'name', 'name1', 'name2', 'detail_picture',
    'preview_picture', 'pictures', 'active', 'newFrom1C',
    'attributes', 'categories', 'detail_text'
  ];
  const BITRIX_FIELDS = [
    'bitrixId', 'matchedBarcode', 'bitrixActive', 'bitrixSectionId',
    'bitrixName1', 'bitrixName2', 'bitrixDetailText',
    'bitrixPreviewPictureUrl', 'bitrixDetailPictureUrl', 'bitrixPicturesJson'
  ];
  const OUTPUT_FIELDS = [...INPUT_FIELDS, ...BITRIX_FIELDS];
  const REQUIRED = ['name1', 'name2', 'detail_text', 'preview_picture', 'detail_picture'];

  if (!location.pathname.startsWith('/bitrix/admin/')) {
    throw Error('Открой Bitrix Admin');
  }
  if (window.__tmBitrixMatchingRunning) throw Error('Matcher уже работает');
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


  function fail(status, details) {
    const error = Error(details);
    error.matcherStatus = status;
    throw error;
  }

  function isOriginalUrl(value) {
    let url;
    try { url = new URL(value, location.origin); }
    catch { return ''; }
    if (url.origin !== location.origin || url.protocol !== 'https:' ||
        url.username || url.password || url.search || url.hash ||
        !/^\/upload\/iblock\/(?!resize_cache\/)[^?#]+\.(?:jpe?g|png|webp|gif)$/i.test(url.pathname) ||
        /%2f|%5c/i.test(url.pathname)) return '';
    return url.href;
  }

  function mediaProperty(source, key) {
    const re = new RegExp("(?:['\"]" + key + "['\"]|\\b" + key +
      "\\b)\\s*:\\s*(?:'((?:\\\\.|[^'\\\\])*)'|\"((?:\\\\.|[^\"\\\\])*)\"|(\\d+))");
    const match = source.match(re);
    return match ? String(match[1] ?? match[2] ?? match[3])
      .replace(/\\u002f/gi, '/').replace(/\\\//g, '/')
      .replace(/\\(['"\\])/g, '$1') : null;
  }

  function mediaFromSources(sources, fileId) {
    for (const source of sources) {
      const objects = source.replace(/&quot;/g, '"').replace(/&amp;/g, '&')
        .match(/\{[^{}]{0,10000}\}/g) ?? [];
      for (const obj of objects) {
        if (mediaProperty(obj, 'fileId') !== String(fileId)) continue;
        const url = isOriginalUrl(mediaProperty(obj, 'real_url'));
        if (url) return url;
      }
    }
    return '';
  }

  function parseBitrixContent(doc, bitrixId) {
    const scripts = [...doc.querySelectorAll('script')].map(s => s.textContent ?? '');
    const property = number => {
      const re = new RegExp('^PROP\\[' + number + '\\]\\[');
      const inputs = [...doc.querySelectorAll('input[name], textarea[name]')]
        .filter(el => re.test(el.getAttribute('name') ?? ''));
      return inputs.length === 1 ? String(inputs[0].value ?? '') : '';
    };
    const single = field => {
      const row = doc.getElementById('tr_' + field);
      if (!row) return '';
      const fileId = row.querySelector('input[type="hidden"][name="' + field + '"]')?.value ?? '';
      const hints = [...row.querySelectorAll('img[src], a[href]')].some(el =>
        /\/upload\/(?:iblock|resize_cache)\//.test(el.getAttribute('src') ?? el.getAttribute('href') ?? ''));
      if (!/^\d+$/.test(fileId) || fileId === '0') {
        if (hints) fail('MEDIA_URL_INCOMPLETE', field + ': изображение есть, но File ID не получен');
        return '';
      }
      const local = [row.outerHTML, ...scripts.filter(s => s.includes(fileId))];
      const url = mediaFromSources(local, fileId);
      if (!url) fail('MEDIA_URL_INCOMPLETE', field + ': File ID ' + fileId +
        ', оригинальный URL не подтверждён');
      return url;
    };
    const galleryNodes = [...doc.querySelectorAll('input[name]')].filter(el =>
      /^PROP\[28\]\[\d+\]$/.test(el.getAttribute('name') ?? '') &&
      /^\d+$/.test(String(el.value)) && el.value !== '0');
    const gallerySources = [...new Set(galleryNodes.map(el => el.closest('tr')).filter(Boolean))]
      .map(el => el.outerHTML);
    gallerySources.push(...scripts.filter(s => galleryNodes.some(el => s.includes(el.value))));
    const pictures = galleryNodes.map((el, index) => ({
      order: index + 1,
      fileId: el.value,
      url: mediaFromSources(gallerySources, el.value)
    }));
    const missing = pictures.filter(x => !x.url);
    if (missing.length) fail('MEDIA_URL_INCOMPLETE', 'pictures: URL получено ' +
      (pictures.length - missing.length) + '/' + pictures.length +
      ', File ID без URL: ' + missing.map(x => x.fileId).join('|'));

    const sections = [...new Set(
      [...doc.querySelectorAll('select[name^="IBLOCK_SECTION"] option:checked')]
        .map(el => el.value).filter(v => /^\d+$/.test(v) && v !== '0')
    )];
    if (sections.length !== 1) fail('BITRIX_SECTION_MISSING',
      'Bitrix ID ' + bitrixId + ': разделов найдено ' + sections.length);
    const active = doc.querySelector('input[type="checkbox"][name="ACTIVE"]');
    if (!active) fail('BITRIX_ACTIVE_MISSING',
      'Bitrix ID ' + bitrixId + ': checkbox ACTIVE не найден');
    const detailText = doc.querySelector('textarea[name="DETAIL_TEXT"]');
    if (!detailText) fail('BITRIX_CONTENT_UNAVAILABLE',
      'Bitrix ID ' + bitrixId + ': DETAIL_TEXT не найден');
    return {
      name1: property(216),
      name2: property(217),
      detail_text: String(detailText.value ?? ''),
      preview_picture: single('PREVIEW_PICTURE'),
      detail_picture: single('DETAIL_PICTURE'),
      pictures, active: active.checked,
      sectionId: sections[0]
    };
  }

  function hasStrapiContent(row, field) {
    return ['detail_text', 'preview_picture', 'detail_picture', 'pictures']
      .includes(field) ? row[field] === 'true' : Boolean(row[field].trim());
  }

  function needsImport(row, bitrix) {
    const fields = ['name1', 'name2', 'detail_text', 'preview_picture', 'detail_picture'];
    const needContent = fields.some(f => !hasStrapiContent(row, f) && Boolean(
      ['preview_picture', 'detail_picture'].includes(f) ? bitrix[f] : bitrix[f].trim()
    ));
    const needGallery = row.pictures === 'false' && bitrix.pictures.length > 0;
    const needCategory = !row.categories.split('|').includes(bitrix.sectionId);
    const needActive = row.active !== String(bitrix.active);
    const futureComplete = REQUIRED.every(f =>
      hasStrapiContent(row, f) || Boolean(
        ['preview_picture', 'detail_picture'].includes(f) ? bitrix[f] : bitrix[f].trim()
      )
    );
    // Пустая галерея в обеих CMS допустима, при наличии в Bitrix — импортируем.
    const desiredFlag = futureComplete ? 'false' : 'true';
    const needFlag = row.newFrom1C !== desiredFlag;
    return { needed: needContent || needGallery || needCategory || needActive || needFlag,
      desiredFlag };
  }

  async function checkpoint(hash) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('tm-products-matcher', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('results')) {
          request.result.createObjectStore('results', { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const prefix = CFG.checkpointVersion + ':' + hash + ':';
    return {
      async load() {
        const values = await new Promise((resolve, reject) => {
          const tr = db.transaction('results', 'readonly');
          const req = tr.objectStore('results').getAll(
            IDBKeyRange.bound(prefix, prefix + '\uffff'));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        return new Map(values.map(x => [x.documentId, x.result]));
      },
      async save(records) {
        if (!records.length) return;
        await new Promise((resolve, reject) => {
          const tr = db.transaction('results', 'readwrite');
          const store = tr.objectStore('results');
          for (const [documentId, result] of records) {
            store.put({key:prefix + documentId, documentId, result});
          }
          tr.oncomplete = () => resolve();
          tr.onerror = () => reject(tr.error);
          tr.onabort = () => reject(tr.error);
        });
      },
      async clear() {
        await new Promise((resolve, reject) => {
          const tr = db.transaction('results', 'readwrite');
          const store = tr.objectStore('results');
          const req = store.openCursor(IDBKeyRange.bound(prefix, prefix + '\uffff'));
          req.onsuccess = () => {
            const cursor = req.result;
            if (cursor) { cursor.delete(); cursor.continue(); }
          };
          tr.oncomplete = () => resolve();
          tr.onerror = () => reject(tr.error);
          tr.onabort = () => reject(tr.error);
        });
      }
    };
  }

  try {
    console.log('[Matcher] Выбери products-config.csv (12 колонок)');
    const file = await selectCsv();
    if (!file) { console.log('[Matcher] Файл не выбран'); return; }
    const fileText = await file.text();
    const csv = parseCsv(fileText);
    const headers = csv.shift();
    if (!headers || headers.join(';') !== INPUT_FIELDS.join(';') ||
        !csv.length || csv.some(row => row.length !== INPUT_FIELDS.length)) {
      throw Error('Нужен новый products-config.csv из products/config.js (12 колонок)');
    }
    const products = csv.map((cells, index) => {
      const row = Object.fromEntries(INPUT_FIELDS.map((f, i) => [f, cells[i]]));
      if (!row.documentId || !row.name ||
          !['true', 'false'].includes(row.active) ||
          !['true', 'false', 'null'].includes(row.newFrom1C) ||
          ['preview_picture', 'detail_picture', 'pictures', 'detail_text']
            .some(f => !['true', 'false'].includes(row[f]))) {
        throw Error('Некорректные данные Config, строка ' + (index + 2));
      }
      return row;
    });
    if (new Set(products.map(x => x.documentId)).size !== products.length) {
      throw Error('Повторяющиеся documentId в Config');
    }
    const counts = new Map();
    for (const product of products) {
      counts.set(product.name, (counts.get(product.name) ?? 0) + 1);
    }
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fileText));
    const hash = [...new Uint8Array(buffer)].slice(0, 12)
      .map(x => x.toString(16).padStart(2, '0')).join('');
    const store = await checkpoint(hash);
    const completed = await store.load();
    const dirty = new Map();
    const errors = new Map();
    console.log('[Matcher] Всего: ' + products.length + ', из checkpoint: ' + completed.size);
    const startedAt = performance.now();

    const listParams = {
      IBLOCK_ID: CFG.iblockId, type: 'catalog', lang: CFG.locale,
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
        const trs = [...table.querySelectorAll('tr')]
          .filter(tr => tr.closest('table') === table);
        const index = trs.findIndex(tr => {
          const labels = [...tr.cells].map(cell => clean(cell.textContent));
          return labels.some(x => /^(штрих\s*[-–]?\s*код|barcode)$/i.test(x)) &&
            labels.some(x => /^id$/i.test(x));
        });
        if (index < 0) continue;
        const cols = [...trs[index].cells].map(cell => clean(cell.textContent));
        const bc = cols.findIndex(x => /^(штрих\s*[-–]?\s*код|barcode)$/i.test(x));
        const id = cols.findIndex(x => /^id$/i.test(x));
        for (const tr of trs.slice(index + 1)) {
          const cells = [...tr.cells];
          if (cells.length <= Math.max(bc, id)) continue;
          const offerId = clean(cells[id].textContent);
          if (/^\d+$/.test(offerId)) {
            offers.set(offerId, normalizeBarcode(cells[bc].textContent));
          }
        }
      }
      return {
        name: nameInput.value,
        barcodes: [...new Set(offers.values())].filter(Boolean),
        doc
      };
    }

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
      const sourceBarcodes = [...new Set(
        product.attributes.split('|').map(normalizeBarcode).filter(Boolean)
      )];
      if (!sourceBarcodes.length) return {
        status: 'BARCODE_MISSING', details: 'Нет штрихкодов в Config Strapi'
      };
      if (sourceBarcodes.some(x => !/^\d{8,18}$/.test(x))) return {
        status: 'BARCODE_INVALID', details: 'Некорректный ШК в Config'
      };
      const responses = await Promise.allSettled(
        candidateIds.map(id => limitedCardRead(() => readCard(id)))
      );
      const failed = responses.find(x => x.status === 'rejected');
      if (failed) throw failed.reason;
      const exact = candidateIds.flatMap((id, index) =>
        responses[index].value.name === product.name
          ? [{bitrixId:id, card:responses[index].value}] : []);
      if (!exact.length) return {
        status: 'NAME_NOT_FOUND',
        details: 'Точных совпадений нет; предложено ' + candidateIds.length
      };
      if (exact.length !== 1) return {
        status: 'NAME_DUPLICATE',
        details: 'Несколько точных названий Bitrix: ' + exact.map(x => x.bitrixId).join('|')
      };
      const match = exact[0];
      const barcode = sourceBarcodes.find(x => match.card.barcodes.includes(x));
      if (!barcode) return {
        status: match.card.barcodes.length ? 'BARCODE_MISMATCH' : 'BITRIX_BARCODE_MISSING',
        details: 'Bitrix ID ' + match.bitrixId + ': общего штрихкода нет'
      };
      const bitrix = parseBitrixContent(match.card.doc, match.bitrixId);
      const decision = needsImport(product, bitrix);
      if (!decision.needed) return {
        status:'ALREADY_SYNCED', bitrixId:match.bitrixId
      };
      return {
        status:'MATCH_CONFIRMED',
        bitrixId:match.bitrixId, matchedBarcode:barcode,
        bitrixActive:String(bitrix.active), bitrixSectionId:bitrix.sectionId,
        bitrixName1:bitrix.name1, bitrixName2:bitrix.name2,
        bitrixDetailText:bitrix.detail_text,
        bitrixPreviewPictureUrl:bitrix.preview_picture,
        bitrixDetailPictureUrl:bitrix.detail_picture,
        bitrixPicturesJson:JSON.stringify(bitrix.pictures)
      };
    }

    function recordResult(product, result) {
      if (result.status === 'ERROR') {
        errors.set(product.documentId, result);
      } else {
        completed.set(product.documentId, result);
        dirty.set(product.documentId, result);
      }
      const count = completed.size + errors.size;
      if (count % 25 === 0) console.log('[Matcher] ' + count + '/' +
        products.length + '; кандидатов ' + [...completed.values()]
          .filter(x => x.status === 'MATCH_CONFIRMED').length +
        '; ошибок ' + errors.size);
    }
    async function persist() {
      if (!dirty.size) return;
      const batch = [...dirty.entries()];
      await store.save(batch);
      for (const [id, result] of batch) {
        if (dirty.get(id) === result) dirty.delete(id);
      }
    }
    const asError = error => error?.matcherStatus ? {
      status:error.matcherStatus, details:error.message
    } : {status:'ERROR', details:String(error?.message ?? error)};
    const pending = new Set();
    let fatal = null;
    function schedule(product, ids) {
      const task = verifyCandidates(product, ids)
        .then(result => recordResult(product, result),
          error => recordResult(product, asError(error)))
        .catch(error => { fatal ??= error; });
      pending.add(task);
      task.finally(() => pending.delete(task));
    }
    try {
      for (const product of products) {
        if (window.bitrixMatchStop || fatal) break;
        if (completed.has(product.documentId)) continue;
        if ((counts.get(product.name) ?? 0) !== 1) {
          recordResult(product, {
            status:'STRAPI_NAME_DUPLICATE',
            details:'Точное имя повторяется в Config'
          });
          continue;
        }
        // Пустые/некорректные ШК сразу в диагностику, без Bitrix-запроса.
        const barcodes = product.attributes.split('|').map(normalizeBarcode).filter(Boolean);
        if (!barcodes.length || barcodes.some(x => !/^\d{8,18}$/.test(x))) {
          recordResult(product, {status:barcodes.length ? 'BARCODE_INVALID':'BARCODE_MISSING',
            details:'Проверь ШК в Config'});
          continue;
        }
        try {
          const ids = await searchByName(product.name);
          schedule(product, ids);
          if (pending.size >= CFG.maxPendingProducts) await Promise.race(pending);
          if (dirty.size >= CFG.checkpointEvery) await persist();
        } catch (error) {
          recordResult(product, asError(error));
        }
      }
    } finally {
      await Promise.all(pending);
      await persist();
    }
    if (fatal) throw fatal;
    const finished = !window.bitrixMatchStop &&
      completed.size === products.length && errors.size === 0;
    const summary = {};
    for (const result of completed.values()) {
      summary[result.status] = (summary[result.status] ?? 0) + 1;
    }
    console.table(Object.entries(summary).map(([status, count]) => ({status,count})));
    if (!finished) {
      console.warn('[Matcher] Неполная обработка. CSV не создан. ' +
        'Checkpoint сохранён, следующий запуск продолжит с необработанных.');
      if (errors.size) console.table([...errors.entries()].slice(0, 30)
        .map(([documentId, x]) => ({documentId, ...x})));
      return;
    }
    const matched = [], unmatched = [];
    for (const product of products) {
      const result = completed.get(product.documentId);
      if (result.status === 'MATCH_CONFIRMED') {
        matched.push({...product, ...result});
      } else if (result.status !== 'ALREADY_SYNCED') {
        unmatched.push({
          documentId:product.documentId, name:product.name,
          bitrixId:result.bitrixId ?? '',
          status:result.status, details:result.details ?? ''
        });
      }
    }
    const exportResult = () => {
      downloadCsv('products-matched.csv', OUTPUT_FIELDS, matched);
      if (unmatched.length) setTimeout(() =>
        downloadCsv('products-unmatched.csv',
          ['documentId','name','bitrixId','status','details'], unmatched), 750);
    };
    window.bitrixMatchResult = {summary, matched, unmatched, finished, hash};
    window.bitrixMatchExport = exportResult;
    exportResult();
    await store.clear();
    console.log('[Matcher] Готово за ' +
      ((performance.now() - startedAt) / 1000).toFixed(1) +
      ' сек. Кандидаты: ' + matched.length +
      '; ручной разбор: ' + unmatched.length +
      '; уже синхронизировано: ' + (summary.ALREADY_SYNCED ?? 0));
  } catch (error) {
    console.error('[Matcher] STOP:', error);
  } finally {
    window.__tmBitrixMatchingRunning = false;
  }
})();
