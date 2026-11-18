(async function chanelCategoriesIndex() {
  'use strict';

  // Этап 1 CHANEL: только чтение полного списка relation categories из RU Draft.
  const TAG = '[CHANEL categories]';
  const BRAND_UID = 'api::brand.brand';
  const CATEGORY_UID = 'api::category.category';
  const BRAND_DOCUMENT_ID = 'yeag7mng9hfpk7pd4ggm7495';
  const PAGE_SIZE = 100;
  const BRAND_PATH = '/admin/content-manager/collection-types/' +
    BRAND_UID + '/' + BRAND_DOCUMENT_ID;
  const current = new URL(location.href);

  if (current.pathname !== BRAND_PATH ||
      current.searchParams.get('plugins[i18n][locale]') !== 'ru') {
    console.error(TAG, 'Откройте страницу CHANEL в локали ru:', BRAND_PATH);
    return;
  }

  if (window.__tmChanelCategoriesIndexRunning) {
    console.warn(TAG, 'Считывание списка уже выполняется');
    return;
  }
  window.__tmChanelCategoriesIndexRunning = true;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const getToken = () => {
    const raw = localStorage.getItem('jwtToken');
    if (!raw) throw new Error('В localStorage отсутствует jwtToken Strapi Admin');
    let token = raw;
    try { token = JSON.parse(raw); } catch {}
    if (typeof token !== 'string' || !token.trim()) {
      throw new Error('Некорректный jwtToken Strapi Admin');
    }
    return token.trim().replace(/^Bearer\s+/i, '');
  };
  const auth = getToken;

  async function getJSON(path) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      let response;
      try {
        response = await fetch(path, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: 'Bearer ' + auth()
          },
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal
        });
      } catch (error) {
        lastError = new Error('GET network: ' + path + ' — ' + error.message);
        if (attempt === 3) throw lastError;
        console.warn(TAG, 'Повтор GET после сетевой ошибки:', attempt, path);
        await sleep(500 * attempt);
        continue;
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        lastError = new Error('GET HTTP ' + response.status + ': ' + path);
        if (attempt < 3 && [408, 429, 500, 502, 503, 504].includes(response.status)) {
          console.warn(TAG, 'Повтор GET после HTTP ' + response.status, path);
          await sleep(800 * attempt);
          continue;
        }
        throw lastError;
      }

      const data = await response.json();
      if (!data || typeof data !== 'object') {
        throw new Error('Неожиданный JSON GET: ' + path);
      }
      return data;
    }
    throw lastError || new Error('Не удалось прочитать ' + path);
  }

  function parsePage(data, page, first) {
    const rows = data?.results;
    const p = data?.pagination;
    if (!Array.isArray(rows) ||
        !Number.isSafeInteger(p?.total) || p.total < 0 ||
        !Number.isSafeInteger(p?.pageCount) || p.pageCount < 0 ||
        (p.total > 0 && p.pageCount < 1) ||
        (p.total > 0 && rows.length === 0) ||
        (p.page != null && Number(p.page) !== page) ||
        (first && (p.total !== first.total || p.pageCount !== first.pageCount))) {
      throw new Error('Неполная/неожиданная пагинация relation categories, page=' + page);
    }
    return { rows, total: p.total, pageCount: p.pageCount };
  }

  function categoryURL(documentId) {
    const u = new URL('/admin/content-manager/collection-types/' +
      CATEGORY_UID + '/' + encodeURIComponent(documentId), location.origin);
    u.searchParams.set('plugins[i18n][locale]', 'ru');
    return u.href;
  }

  function download(name, content, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  function csvCell(value) {
    return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
  }

  try {
    console.log(TAG, 'Проверяю RU Draft бренда CHANEL…');
    const detailPath = '/content-manager/collection-types/' + BRAND_UID + '/' +
      BRAND_DOCUMENT_ID + '?locale=ru&status=draft';
    const brandResponse = await getJSON(detailPath);
    const brand = brandResponse?.data;
    if (!brand || brand.documentId !== BRAND_DOCUMENT_ID || brand.locale !== 'ru') {
      throw new Error('Ответ Content Manager не соответствует RU-версии CHANEL');
    }

    const expected = brand.categories?.count;
    const expectedCount = Number.isSafeInteger(expected) ? expected : null;
    const records = [];
    const seen = new Set();
    let first = null;
    let page = 1;

    while (true) {
      // Читаем именно текущие связи CHANEL, а не весь справочник Categories.
      const qs = new URLSearchParams({
        locale: 'ru',
        status: 'draft',
        page: String(page),
        pageSize: String(PAGE_SIZE)
      });
      const path = '/content-manager/relations/' + BRAND_UID + '/' +
        BRAND_DOCUMENT_ID + '/categories?' + qs;
      const result = parsePage(await getJSON(path), page, first);
      if (!first) first = result;

      for (const item of result.rows) {
        const docId = item?.documentId;
        if (typeof docId !== 'string' || !docId ||
            !Number.isSafeInteger(item.id) || item.id <= 0 ||
            (item.locale != null && item.locale !== 'ru') ||
            seen.has(docId)) {
          throw new Error('Неверная категория или дубль на странице ' + page);
        }
        seen.add(docId);
        records.push({
          order: records.length + 1,
          documentId: docId,
          id: item.id,
          title: String(item.title || item.name || item.name1 || ''),
          url: categoryURL(docId)
        });
      }

      console.log(TAG, 'Прочитано', records.length, '/', first.total,
        '— страница', page, '/', first.pageCount || 1);
      if (page >= first.pageCount) break;
      page++;
      if (page > 10000) throw new Error('Слишком много страниц categories');
    }

    if (records.length !== first.total) {
      throw new Error('Количество считанных категорий не равно pagination.total: ' +
        records.length + ' / ' + first.total);
    }
    if (expectedCount !== null && records.length !== expectedCount) {
      throw new Error('Количество categories в RU Draft бренда отличается от relation API: ' +
        expectedCount + ' / ' + records.length);
    }

    const report = {
      version: 1,
      mode: 'read-only',
      timestamp: new Date().toISOString(),
      brand: {
        uid: BRAND_UID,
        documentId: BRAND_DOCUMENT_ID,
        locale: 'ru',
        name: String(brand.name || brand.title || 'CHANEL'),
        categoriesCount: expectedCount
      },
      count: records.length,
      categories: records
    };
    // Данные доступны и в Console для следующего этапа pipeline.
    window.tmChanelCategoriesIndex = report;
    const columns = ['order', 'documentId', 'id', 'title', 'url'];
    const csv = '\uFEFF' + columns.join(';') + '\r\n' +
      records.map(row => columns.map(key => csvCell(row[key])).join(';')).join('\r\n');
    console.table(records);
    download('chanel-categories-ru.csv', csv, 'text/csv;charset=utf-8');
    download('chanel-categories-ru.json', JSON.stringify(report, null, 2),
      'application/json;charset=utf-8');
    console.log(TAG, 'Готово:', records.length,
      'категорий. CSV и JSON выгружены. CMS не изменялась.');
  } catch (error) {
    console.error(TAG, 'Список НЕ сформирован — данные CMS не менялись:', error);
  } finally {
    window.__tmChanelCategoriesIndexRunning = false;
  }
})();
