// ==BrowserParser==
// @name         bitrix-detail-picture-audit
// @version      1.0.0
// @description  Проверяет по CSV, есть ли DETAIL_PICTURE у торговых предложений в Bitrix
// @run          Bitrix Admin -> Товары
// @input        CSV с колонками barcode и productDocumentId
// @output       CSV
// ==/BrowserParser==

(async () => {
  'use strict';

  const VERSION = '1.0.0';
  const FILTER_ID = 'tbl_iblock_element_160552fecab66c961b2b218b964e1a9a';
  const REQUEST_DELAY_MS = 120;
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

  async function fetchText(url, options, label) {
    const response = await fetch(url, options);
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`${label}: HTTP ${response.status}`);
    }

    if (/name=["']USER_LOGIN["']|bitrix\/admin\/index\.php\?login=yes/i.test(text)) {
      throw new Error(`${label}: Bitrix-сессия истекла`);
    }

    await sleep(REQUEST_DELAY_MS);
    return text;
  }

  const sessid =
    window.BX?.bitrix_sessid?.() ||
    document.querySelector('input[name="sessid"]')?.value;

  if (!sessid) {
    console.warn('[Bitrix Detail Picture Audit] Не найден sessid. Обнови страницу Bitrix Admin.');
    return;
  }

  let stopRequested = false;
  window.stopBitrixDetailPictureAudit = () => {
    stopRequested = true;
    console.warn('[Bitrix Detail Picture Audit] Остановка запрошена. Текущая группа завершится и CSV скачается.');
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
      productNotFound: 0,
      offerNotFound: 0,
      duplicate: 0,
      missingBarcode: 0,
      error: 0
    };

    for (const item of results) {
      if (!item) continue;
      counters.done++;

      if (item.status === 'ok') counters.ok++;
      else if (item.status === 'no_detail_picture') counters.noDetailPicture++;
      else if (item.status === 'product_not_found') counters.productNotFound++;
      else if (item.status === 'offer_not_found') counters.offerNotFound++;
      else if (item.status === 'duplicate_barcode_in_source') counters.duplicate++;
      else if (item.status === 'missing_barcode') counters.missingBarcode++;
      else if (item.status === 'error') counters.error++;
    }

    return counters;
  }

  async function setBarcodeFilter(barcode) {
    const body = new URLSearchParams({
      'params[FILTER_ID]': FILTER_ID,
      'params[GRID_ID]': FILTER_ID,
      'params[action]': 'setFilter',
      'params[forAll]': 'false',
      'params[commonPresetsId]': '',
      'params[apply_filter]': 'Y',
      'params[clear_filter]': 'N',
      'params[with_preset]': 'N',
      'params[save]': 'Y',

      'data[fields][FIND]': '',
      'data[fields][NAME]': '',
      'data[fields][PROPERTY_19]': barcode,
      'data[fields][PROPERTY_580]': '',
      'data[fields][PROPERTY_4]': '',
      'data[fields][PROPERTY_4_label]': '',
      'data[fields][ACTIVE]': '',
      'data[fields][SECTION_ID]': '',
      'data[fields][CATALOG_AVAILABLE]': '',
      'data[fields][ID_from]': '',
      'data[fields][ID_to]': '',
      'data[fields][ID_numsel]': 'exact',
      'data[fields][PROPERTY_641]': '',

      'data[rows]':
        'NAME,PROPERTY_19,PROPERTY_580,PROPERTY_4,ACTIVE,SECTION_ID,CATALOG_AVAILABLE,ID,PROPERTY_641',

      'data[preset_id]': 'tmp_filter',
      'data[name]': 'Фильтр',
      sessid
    });

    const url =
      `/bitrix/services/main/ajax.php` +
      `?analyticsLabel[FILTER_ID]=${encodeURIComponent(FILTER_ID)}` +
      `&analyticsLabel[GRID_ID]=${encodeURIComponent(FILTER_ID)}` +
      `&mode=ajax&c=bitrix%3Amain.ui.filter&action=setFilter`;

    await fetchText(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body
    }, `setFilter ${barcode}`);
  }

  async function findProductId(barcode) {
    await setBarcodeFilter(barcode);

    const html = await fetchText(
      `/bitrix/admin/iblock_element_admin.php` +
      `?IBLOCK_ID=1&type=catalog&lang=ru` +
      `&find_el_y=Y&apply_filter=Y&clear_nav=Y`,
      { credentials: 'include' },
      `Список товаров ${barcode}`
    );

    const doc = new DOMParser().parseFromString(html, 'text/html');

    const rows = [...doc.querySelectorAll('tr.main-grid-row-body[data-id]')]
      .filter(tr => tr.dataset.id && tr.dataset.id !== 'template_0');

    const exact = rows.find(tr =>
      [...tr.querySelectorAll('td')]
        .some(td => td.textContent.trim() === barcode)
    );

    if (exact) return exact.dataset.id;
    if (rows.length === 1) return rows[0].dataset.id;

    return null;
  }

  async function fetchOffers(productId) {
    const html = await fetchText(
      `/bitrix/admin/iblock_element_edit.php` +
      `?IBLOCK_ID=1&type=catalog&lang=ru` +
      `&ID=${encodeURIComponent(productId)}` +
      `&find_section_section=-1&WF=Y`,
      { credentials: 'include' },
      `Карточка товара ${productId}`
    );

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const offers = new Map();

    for (const tr of doc.querySelectorAll('tr')) {
      const checkbox = tr.querySelector('input[name="SUB_ID[]"]');
      if (!checkbox?.value) continue;

      const cells = [...tr.querySelectorAll(':scope > td')]
        .map(td => td.textContent.trim());

      const barcode = cells.find(value => /^\d{8,14}$/.test(value));
      if (!barcode || offers.has(barcode)) continue;

      const detailPath =
        tr.querySelector(
          '[id*="__detail_picture__"] a[href*="/upload/iblock/"]'
        )?.getAttribute('href') ?? '';

      offers.set(barcode, {
        bitrixOfferId: checkbox.value,
        imageUrl: detailPath
          ? new URL(detailPath, location.origin).href
          : ''
      });
    }

    return offers;
  }

  const pendingRows = sourceRows.filter(row => !results[row.sourceIndex]);

  const groupsMap = new Map();

  for (const row of pendingRows) {
    const key = row.productDocumentId || `barcode:${row.barcode}`;

    if (!groupsMap.has(key)) groupsMap.set(key, []);
    groupsMap.get(key).push(row);
  }

  const groups = [...groupsMap.values()];
  const parentCache = new Map();

  console.log(
    `[Bitrix Detail Picture Audit] Строк: ${sourceRows.length}; ` +
    `к обработке: ${pendingRows.length}; групп товаров: ${groups.length}.`
  );

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    if (stopRequested) break;

    const group = groups[groupIndex].filter(row => !results[row.sourceIndex]);
    if (!group.length) continue;

    let productId = '';
    let offers = null;
    let lastError = '';

    for (const candidate of group) {
      try {
        productId = await findProductId(candidate.barcode);

        if (productId) {
          offers = parentCache.get(productId);

          if (!offers) {
            offers = await fetchOffers(productId);
            parentCache.set(productId, offers);
          }

          break;
        }
      } catch (error) {
        lastError = error.message || String(error);

        if (/сессия истекла/i.test(lastError)) {
          stopRequested = true;
          break;
        }
      }
    }

    if (stopRequested && !productId) {
      for (const row of group) {
        if (!results[row.sourceIndex]) {
          resultFor(row, {
            status: 'error',
            error: lastError || 'Остановлено: Bitrix-сессия недоступна'
          });
        }
      }
      saveCheckpoint();
      break;
    }

    if (!productId || !offers) {
      for (const row of group) {
        resultFor(row, {
          status: lastError ? 'error' : 'product_not_found',
          error: lastError
        });
      }
    } else {
      for (const row of group) {
        const offer = offers.get(row.barcode);

        if (!offer) {
          resultFor(row, {
            bitrixProductId: productId,
            status: 'offer_not_found'
          });
          continue;
        }

        resultFor(row, {
          bitrixProductId: productId,
          bitrixOfferId: offer.bitrixOfferId,
          imageUrl: offer.imageUrl,
          status: offer.imageUrl ? 'ok' : 'no_detail_picture'
        });
      }
    }

    saveCheckpoint();

    const c = getCounters();

    console.log(
      `[${groupIndex + 1}/${groups.length} товаров] ` +
      `${c.done}/${sourceRows.length} предложений | ` +
      `ok ${c.ok} | no picture ${c.noDetailPicture} | ` +
      `product not found ${c.productNotFound} | offer not found ${c.offerNotFound} | ` +
      `errors ${c.error}`
    );
  }

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
  console.log('PRODUCT NOT FOUND:', c.productNotFound);
  console.log('OFFER NOT FOUND:', c.offerNotFound);
  console.log('DUPLICATE BARCODE:', c.duplicate);
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
