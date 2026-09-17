// ==BrowserParser==
// @name         bitrix-detail-picture-audit
// @version      2.0.0
// @description  Проверяет DETAIL_PICTURE напрямую по торговым предложениям Bitrix IBLOCK_ID=2
// @run          Bitrix Admin -> Пакет предложений (Товары)
// @input        CSV с колонками barcode и productDocumentId
// @output       CSV
// ==/BrowserParser==

(async () => {
  'use strict';

  const VERSION = '2.0.0';
  const PAGE_SIZE = 100;
  const LIST_CONCURRENCY = 8;
  const CARD_CONCURRENCY = 6;
  const FETCH_RETRIES = 2;
  const CHECKPOINT_PREFIX = 'tm_bitrix_detail_picture_audit:';

  if (!/monamie\.kz$/i.test(location.hostname) || !location.pathname.startsWith('/bitrix/')) {
    console.warn('[Bitrix Detail Picture Audit] Запусти скрипт в Bitrix Admin на monamie.kz.');
    return;
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const timestamp = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  };

  function pickCsvFile() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv,text/csv';
      input.style.display = 'none';

      input.addEventListener('change', () => {
        const file = input.files?.[0];
        input.remove();
        file ? resolve(file) : reject(new Error('CSV не выбран'));
      }, { once: true });

      document.body.appendChild(input);
      input.click();
    });
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let value = '';
    let quoted = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            value += '"';
            i++;
          } else {
            quoted = false;
          }
        } else {
          value += ch;
        }
        continue;
      }

      if (ch === '"') {
        quoted = true;
      } else if (ch === ';') {
        row.push(value);
        value = '';
      } else if (ch === '\n') {
        row.push(value.replace(/\r$/, ''));
        rows.push(row);
        row = [];
        value = '';
      } else {
        value += ch;
      }
    }

    if (value.length || row.length) {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
    }

    return rows;
  }

  function csvQuote(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  function downloadCsv(results, filename) {
    const headers = [
      'documentId',
      'barcode',
      'productDocumentId',
      'bitrixProductId',
      'bitrixOfferId',
      'imageUrl',
      'status',
      'error'
    ];

    const csv = [
      headers.join(';'),
      ...results.map(item => headers.map(key => csvQuote(item[key])).join(';'))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function isLoginPage(text) {
    return /name=["']USER_LOGIN["']|bitrix\/admin\/index\.php\?login=yes/i.test(text);
  }

  async function fetchText(url, label) {
    let lastError = null;

    for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
      try {
        const response = await fetch(url, { credentials: 'include' });
        const text = await response.text();

        if (isLoginPage(text)) {
          const error = new Error(`${label}: Bitrix-сессия истекла`);
          error.noRetry = true;
          throw error;
        }

        if (response.ok) return text;

        const error = new Error(`${label}: HTTP ${response.status}`);
        error.noRetry = response.status < 500 && response.status !== 429;
        throw error;
      } catch (error) {
        lastError = error;
        if (error?.noRetry || attempt >= FETCH_RETRIES) break;
        await sleep(500 * (attempt + 1));
      }
    }

    throw lastError || new Error(`${label}: неизвестная ошибка`);
  }

  async function mapLimit(items, limit, worker) {
    let nextIndex = 0;

    async function run() {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        await worker(items[index], index);
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, () => run())
    );
  }

  function offerListUrl(page) {
    const params = new URLSearchParams({
      IBLOCK_ID: '2',
      type: 'catalog',
      lang: 'ru',
      find_el_y: 'Y',
      clear_filter: 'Y',
      apply_filter: 'Y',
      SIZEN_1: String(PAGE_SIZE),
      PAGEN_1: String(page)
    });

    return `/bitrix/admin/iblock_element_admin.php?${params}`;
  }

  function pageCountFromHtml(html) {
    let maxPage = 1;
    const re = /[?&]PAGEN_1=(\d+)/g;
    let match;

    while ((match = re.exec(html))) {
      maxPage = Math.max(maxPage, Number(match[1]) || 1);
    }

    return maxPage;
  }

  function barcodeColumnIndex(doc) {
    const headerRows = [
      ...doc.querySelectorAll('tr.main-grid-row-head, tr.main-grid-header-row')
    ];

    for (const headerRow of headerRows) {
      const cells = [...headerRow.querySelectorAll(':scope > th, :scope > td')];
      const index = cells.findIndex(cell => {
        const key = [
          cell.getAttribute('data-column-id'),
          cell.getAttribute('data-name'),
          cell.textContent
        ].filter(Boolean).join(' ').trim().toUpperCase();

        return key.includes('PROPERTY_19') || key.includes('ШТРИХ КОД') || key.includes('ШТРИХ-КОД');
      });

      if (index >= 0) return index;
    }

    return -1;
  }

  function normalizeHref(href) {
    if (!href) return '';
    try {
      const url = new URL(href, location.origin);
      return `${url.pathname}${url.search}`;
    } catch {
      return '';
    }
  }

  function getOfferEditLink(row, offerId) {
    for (const anchor of row.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href');
      if (!href || !/iblock_(?:subelement|element)_edit\.php/i.test(href)) continue;

      try {
        const url = new URL(href, location.origin);
        if (url.searchParams.get('IBLOCK_ID') !== '2') continue;
        if (url.searchParams.get('ID') !== String(offerId)) continue;

        return {
          editUrl: `${url.pathname}${url.search}`,
          productId: url.searchParams.get('PRODUCT_ID') || ''
        };
      } catch {}
    }

    return { editUrl: '', productId: '' };
  }

  function rowImageUrl(row) {
    const anchor = row.querySelector('a[href*="/upload/iblock/"], a[href*="/upload/"]');
    const href = anchor?.getAttribute('href') || '';
    return href ? new URL(href, location.origin).href : '';
  }

  function parseOfferPage(html, targetBarcodes) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = [...doc.querySelectorAll('tr.main-grid-row-body[data-id]')]
      .filter(row => row.dataset.id && row.dataset.id !== 'template_0');
    const barcodeIndex = barcodeColumnIndex(doc);
    const hasPropertyCell = rows.some(row =>
      row.querySelector('[data-column-id="PROPERTY_19"], [data-name="PROPERTY_19"]')
    );

    if (rows.length && barcodeIndex < 0 && !hasPropertyCell) {
      throw new Error(
        'В списке IBLOCK_ID=2 не найдена колонка «ШТРИХ КОД». Добавь её через настройки таблицы Bitrix.'
      );
    }

    const matches = [];

    for (const row of rows) {
      const offerId = row.dataset.id;
      const directBarcodeCell = row.querySelector(
        '[data-column-id="PROPERTY_19"], [data-name="PROPERTY_19"]'
      );
      const cells = [...row.querySelectorAll(':scope > td')];

      let barcode = directBarcodeCell?.textContent?.trim() || '';
      if (!barcode && barcodeIndex >= 0) {
        barcode = cells[barcodeIndex]?.textContent?.trim() || '';
      }
      if (!barcode || !targetBarcodes.has(barcode)) continue;

      const { editUrl, productId } = getOfferEditLink(row, offerId);

      matches.push({
        barcode,
        bitrixOfferId: offerId,
        bitrixProductId: productId,
        editUrl,
        imageUrl: rowImageUrl(row)
      });
    }

    return matches;
  }

  function detailPictureFromHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const selectors = [
      '[id*="__detail_picture__" i] a[href*="/upload/iblock/"]',
      '[id*="detail_picture" i] a[href*="/upload/"]',
      'a[id*="detail_picture" i][href*="/upload/"]'
    ];

    for (const selector of selectors) {
      const href = doc.querySelector(selector)?.getAttribute('href');
      if (href) return new URL(href, location.origin).href;
    }

    for (const row of doc.querySelectorAll('tr')) {
      const label = row.textContent || '';
      if (!/DETAIL_PICTURE|ДЕТАЛЬН.*КАРТИН/i.test(label)) continue;
      const href = row.querySelector('a[href*="/upload/"]')?.getAttribute('href');
      if (href) return new URL(href, location.origin).href;
    }

    return '';
  }

  async function loadOfferDetailPicture(offer) {
    let editUrl = offer.editUrl;

    if (!editUrl && offer.bitrixProductId) {
      editUrl =
        `/bitrix/admin/iblock_subelement_edit.php?IBLOCK_ID=2` +
        `&PRODUCT_ID=${encodeURIComponent(offer.bitrixProductId)}` +
        `&ID=${encodeURIComponent(offer.bitrixOfferId)}` +
        `&type=catalog&lang=ru`;
    }

    if (!editUrl) {
      throw new Error(`offer ${offer.bitrixOfferId}: не найдена ссылка на карточку предложения`);
    }

    const html = await fetchText(editUrl, `Карточка предложения ${offer.bitrixOfferId}`);
    return detailPictureFromHtml(html);
  }

  let stopRequested = false;
  window.stopBitrixDetailPictureAudit = () => {
    stopRequested = true;
    console.warn('[Bitrix Detail Picture Audit] Остановка запрошена. Текущие запросы завершатся и CSV скачается.');
  };

  console.log(`[Bitrix Detail Picture Audit v${VERSION}] Выбери CSV из attributes-without-detail-picture.`);

  let file;
  try {
    file = await pickCsvFile();
  } catch {
    console.warn('[Bitrix Detail Picture Audit] CSV не выбран.');
    return;
  }

  const text = (await file.text()).replace(/^\uFEFF/, '');
  const parsed = parseCsv(text).filter(row => row.some(value => value !== ''));

  if (parsed.length < 2) {
    console.warn('[Bitrix Detail Picture Audit] CSV пустой.');
    return;
  }

  const headers = parsed[0].map(value => value.trim());
  const indexOf = name => headers.findIndex(header => header.toLowerCase() === name.toLowerCase());

  const barcodeIndex = indexOf('barcode');
  const documentIdIndex = indexOf('documentId');
  const productDocumentIdIndex = indexOf('productDocumentId');

  if (barcodeIndex === -1) {
    console.warn('[Bitrix Detail Picture Audit] В CSV нет колонки barcode.');
    return;
  }

  const sourceRows = parsed.slice(1).map((row, sourceIndex) => ({
    sourceIndex,
    documentId: documentIdIndex >= 0 ? (row[documentIdIndex] ?? '').trim() : '',
    barcode: (row[barcodeIndex] ?? '').trim(),
    productDocumentId: productDocumentIdIndex >= 0 ? (row[productDocumentIdIndex] ?? '').trim() : ''
  }));

  const results = new Array(sourceRows.length);
  const barcodeCounts = new Map();

  for (const row of sourceRows) {
    if (!row.barcode) continue;
    barcodeCounts.set(row.barcode, (barcodeCounts.get(row.barcode) || 0) + 1);
  }

  for (const row of sourceRows) {
    if (!row.barcode) {
      results[row.sourceIndex] = {
        ...row,
        bitrixProductId: '',
        bitrixOfferId: '',
        imageUrl: '',
        status: 'missing_barcode',
        error: ''
      };
    } else if ((barcodeCounts.get(row.barcode) || 0) > 1) {
      results[row.sourceIndex] = {
        ...row,
        bitrixProductId: '',
        bitrixOfferId: '',
        imageUrl: '',
        status: 'duplicate_barcode_in_source',
        error: ''
      };
    }
  }

  const checkpointKey =
    CHECKPOINT_PREFIX +
    [file.name, file.size, file.lastModified].join(':');

  try {
    const checkpoint = JSON.parse(localStorage.getItem(checkpointKey) || 'null');

    if (checkpoint?.version === VERSION && Array.isArray(checkpoint.results)) {
      for (let i = 0; i < results.length; i++) {
        if (!results[i] && checkpoint.results[i]) {
          results[i] = checkpoint.results[i];
        }
      }

      const restored = results.filter(Boolean).length;
      if (restored) {
        console.log(`[Bitrix Detail Picture Audit] Восстановлен checkpoint: ${restored}/${results.length}.`);
      }
    }
  } catch (error) {
    console.warn('[Bitrix Detail Picture Audit] Не удалось прочитать checkpoint:', error);
  }

  function saveCheckpoint() {
    try {
      localStorage.setItem(
        checkpointKey,
        JSON.stringify({
          version: VERSION,
          savedAt: new Date().toISOString(),
          results
        })
      );
    } catch (error) {
      console.warn('[Bitrix Detail Picture Audit] Не удалось сохранить checkpoint:', error);
    }
  }

  function resultFor(row, patch) {
    results[row.sourceIndex] = {
      documentId: row.documentId,
      barcode: row.barcode,
      productDocumentId: row.productDocumentId,
      bitrixProductId: '',
      bitrixOfferId: '',
      imageUrl: '',
      status: '',
      error: '',
      ...patch
    };
  }

  function getCounters() {
    const counters = {
      done: 0,
      ok: 0,
      noDetailPicture: 0,
      offerNotFound: 0,
      duplicateSource: 0,
      duplicateBitrix: 0,
      missingBarcode: 0,
      error: 0
    };

    for (const item of results) {
      if (!item) continue;
      counters.done++;

      if (item.status === 'ok') counters.ok++;
      else if (item.status === 'no_detail_picture') counters.noDetailPicture++;
      else if (item.status === 'offer_not_found') counters.offerNotFound++;
      else if (item.status === 'duplicate_barcode_in_source') counters.duplicateSource++;
      else if (item.status === 'duplicate_barcode_in_bitrix') counters.duplicateBitrix++;
      else if (item.status === 'missing_barcode') counters.missingBarcode++;
      else if (item.status === 'error') counters.error++;
    }

    return counters;
  }

  const pendingRows = sourceRows.filter(row => !results[row.sourceIndex]);
  const targetBarcodes = new Set(pendingRows.map(row => row.barcode).filter(Boolean));
  const offerIndex = new Map();

  function addOffers(items) {
    for (const offer of items) {
      if (!offerIndex.has(offer.barcode)) offerIndex.set(offer.barcode, []);
      offerIndex.get(offer.barcode).push(offer);
    }
  }

  console.log(
    `[Bitrix Detail Picture Audit] Строк: ${sourceRows.length}; ` +
    `к обработке: ${pendingRows.length}; уникальных barcode: ${targetBarcodes.size}.`
  );

  if (targetBarcodes.size && !stopRequested) {
    try {
      const firstHtml = await fetchText(offerListUrl(1), 'Список предложений, страница 1');
      const pageCount = pageCountFromHtml(firstHtml);
      addOffers(parseOfferPage(firstHtml, targetBarcodes));

      console.log(
        `[Bitrix Detail Picture Audit] IBLOCK_ID=2: страниц ${pageCount}; ` +
        `совпадений после первой страницы ${[...offerIndex.values()].reduce((sum, items) => sum + items.length, 0)}.`
      );

      const pages = Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => index + 2);
      let completedPages = 1;

      await mapLimit(pages, LIST_CONCURRENCY, async page => {
        if (stopRequested) return;
        const html = await fetchText(offerListUrl(page), `Список предложений, страница ${page}`);
        addOffers(parseOfferPage(html, targetBarcodes));
        completedPages++;

        if (completedPages % 25 === 0 || completedPages === pageCount) {
          const matched = [...offerIndex.values()].reduce((sum, items) => sum + items.length, 0);
          console.log(
            `[Bitrix Detail Picture Audit] Список offers: ${completedPages}/${pageCount} | ` +
            `совпадений ${matched}/${targetBarcodes.size}`
          );
        }
      });
    } catch (error) {
      console.error('[Bitrix Detail Picture Audit] Не удалось прочитать IBLOCK_ID=2:', error);
      for (const row of pendingRows) {
        if (!results[row.sourceIndex]) {
          resultFor(row, { status: 'error', error: error.message || String(error) });
        }
      }
      saveCheckpoint();
      stopRequested = true;
    }
  }

  const cardTasks = [];

  if (!stopRequested) {
    for (const row of pendingRows) {
      if (results[row.sourceIndex]) continue;

      const offers = offerIndex.get(row.barcode) || [];

      if (!offers.length) {
        resultFor(row, { status: 'offer_not_found' });
        continue;
      }

      if (offers.length > 1) {
        resultFor(row, {
          bitrixProductId: [...new Set(offers.map(item => item.bitrixProductId).filter(Boolean))].join(', '),
          bitrixOfferId: offers.map(item => item.bitrixOfferId).join(', '),
          status: 'duplicate_barcode_in_bitrix',
          error: `Найдено предложений: ${offers.length}`
        });
        continue;
      }

      const offer = offers[0];

      if (offer.imageUrl) {
        resultFor(row, {
          bitrixProductId: offer.bitrixProductId,
          bitrixOfferId: offer.bitrixOfferId,
          imageUrl: offer.imageUrl,
          status: 'ok'
        });
        continue;
      }

      cardTasks.push({ row, offer });
    }

    saveCheckpoint();
  }

  let completedCards = 0;

  await mapLimit(cardTasks, CARD_CONCURRENCY, async ({ row, offer }) => {
    if (stopRequested || results[row.sourceIndex]) return;

    try {
      const imageUrl = await loadOfferDetailPicture(offer);

      resultFor(row, {
        bitrixProductId: offer.bitrixProductId,
        bitrixOfferId: offer.bitrixOfferId,
        imageUrl,
        status: imageUrl ? 'ok' : 'no_detail_picture'
      });
    } catch (error) {
      const message = error.message || String(error);
      resultFor(row, {
        bitrixProductId: offer.bitrixProductId,
        bitrixOfferId: offer.bitrixOfferId,
        status: 'error',
        error: message
      });

      if (/сессия истекла/i.test(message)) {
        stopRequested = true;
      }
    }

    completedCards++;
    if (completedCards % 20 === 0 || completedCards === cardTasks.length) {
      saveCheckpoint();
      const c = getCounters();
      console.log(
        `[Bitrix Detail Picture Audit] Карточки offers: ${completedCards}/${cardTasks.length} | ` +
        `done ${c.done}/${sourceRows.length} | ok ${c.ok} | ` +
        `no picture ${c.noDetailPicture} | errors ${c.error}`
      );
    }
  });

  saveCheckpoint();

  const finalResults = sourceRows.map(row =>
    results[row.sourceIndex] || {
      documentId: row.documentId,
      barcode: row.barcode,
      productDocumentId: row.productDocumentId,
      bitrixProductId: '',
      bitrixOfferId: '',
      imageUrl: '',
      status: 'not_processed',
      error: ''
    }
  );

  window.bitrixDetailPictureAudit = finalResults;

  const c = getCounters();

  console.log('');
  console.log('===== BITRIX DETAIL PICTURE AUDIT =====');
  console.log('TOTAL:', sourceRows.length);
  console.log('OK:', c.ok);
  console.log('NO DETAIL PICTURE:', c.noDetailPicture);
  console.log('OFFER NOT FOUND:', c.offerNotFound);
  console.log('DUPLICATE BARCODE SOURCE:', c.duplicateSource);
  console.log('DUPLICATE BARCODE BITRIX:', c.duplicateBitrix);
  console.log('MISSING BARCODE:', c.missingBarcode);
  console.log('ERROR:', c.error);
  console.log('NOT PROCESSED:', finalResults.filter(x => x.status === 'not_processed').length);

  const filename =
    `bitrix_detail_picture_audit_${timestamp()}` +
    (stopRequested ? '_partial' : '') +
    '.csv';

  downloadCsv(finalResults, filename);

  if (!stopRequested) {
    localStorage.removeItem(checkpointKey);
  }

  console.log(`CSV скачан: ${filename}`);
  console.log(
    stopRequested
      ? 'Аудит остановлен. Повторный запуск с тем же CSV продолжит с checkpoint.'
      : 'Аудит завершён.'
  );
})();
