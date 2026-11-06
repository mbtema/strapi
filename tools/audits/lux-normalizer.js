(async () => {
  'use strict';

  if (window.__brandDisableRunning) {
    console.warn('[lux-normalizer] Скрипт уже запущен');
    return;
  }
  window.__brandDisableRunning = true;
  window.brandDisableStop = false;

  const UID = 'api::product.product';
  const LOCALE = 'ru';
  const PAGE_SIZE = 100;
  const READ_CONCURRENCY = 10;
  const WRITE_CONCURRENCY = 4;
  const TARGET_BRANDS = new Set([
    'yeag7mng9hfpk7pd4ggm7495',
    'qw7sja6ffpbufvzub5maxyrl'
  ]);
  const BASE = '/content-manager/collection-types/' + UID;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const report = window.brandDeactivationReport = {
    scanned: 0,
    matched: 0,
    savedAndPublished: 0,
    failed: 0,
    results: []
  };

  function authToken() {
    const value = localStorage.getItem('jwtToken');
    if (!value) throw new Error('Не найден jwtToken. Авторизуйтесь в Strapi Admin.');
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'string' ? parsed : value;
    } catch {
      return value.replace(/^"|"$/g, '');
    }
  }

  async function request(url, method = 'GET', body) {
    const maxAttempts = method === 'GET' ? 3 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response;
      try {
        response = await fetch(url, {
          method,
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            Authorization: 'Bearer ' + token,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
      } catch (error) {
        if (attempt === maxAttempts) throw error;
        await sleep(500 * attempt);
        continue;
      }
      if (response.ok) {
        const text = await response.text();
        return text ? JSON.parse(text) : null;
      }
      const detail = (await response.text().catch(() => '')).slice(0, 350);
      if (method === 'GET' && attempt < maxAttempts &&
          (response.status === 429 || response.status >= 500)) {
        await sleep(500 * attempt);
        continue;
      }
      throw new Error(method + ' ' + url + ': HTTP ' + response.status + ' ' + detail);
    }
  }

  function rows(json, label) {
    const value = json?.results ?? json?.data;
    if (!Array.isArray(value)) throw new Error(label + ': нет массива results/data');
    return value;
  }

  function pageInfo(json, label) {
    const p = json?.pagination ?? json?.meta?.pagination;
    const pageCount = Number(p?.pageCount);
    const total = Number(p?.total);
    if (!p || !Number.isInteger(pageCount) || pageCount < 0 ||
        !Number.isInteger(total) || total < 0) {
      throw new Error(label + ': некорректная пагинация');
    }
    return { pageCount, total };
  }

  async function listProducts() {
    const found = [];
    const seen = new Set();
    let pageCount = null;
    let total = null;
    for (let page = 1; ; page++) {
      if (window.brandDisableStop) throw new Error('Остановлено пользователем');
      const q = new URLSearchParams({
        page: String(page), pageSize: String(PAGE_SIZE),
        sort: 'id:ASC', locale: LOCALE
      });
      const json = await request(BASE + '?' + q);
      const items = rows(json, 'Products page ' + page);
      const p = pageInfo(json, 'Products page ' + page);
      if (pageCount === null) {
        pageCount = p.pageCount;
        total = p.total;
      } else if (p.pageCount !== pageCount || p.total !== total) {
        throw new Error('Пагинация Products изменилась во время чтения');
      }
      if (page > Math.max(1, pageCount) ||
          (pageCount === 0 && (items.length || total !== 0))) {
        throw new Error('Некорректная страница Products');
      }
      for (const item of items) {
        if (!item?.documentId || seen.has(item.documentId)) {
          throw new Error('Пустой или повторный Product documentId');
        }
        seen.add(item.documentId);
        found.push(item);
      }
      console.log('[lux-normalizer] Список: ' + found.length + '/' + total +
        ' | страница ' + page + '/' + Math.max(1, pageCount));
      if (page >= Math.max(1, pageCount)) break;
    }
    if (found.length !== total) {
      throw new Error('Список Products неполный: ' + found.length + '/' + total);
    }
    return found;
  }

  async function getBrands(documentId) {
    const q = new URLSearchParams({
      locale: LOCALE, page: '1', pageSize: String(PAGE_SIZE)
    });
    const json = await request('/content-manager/relations/' + UID + '/' +
      encodeURIComponent(documentId) + '/brand?' + q);
    const items = rows(json, 'brand ' + documentId);
    const p = pageInfo(json, 'brand ' + documentId);
    if (items.length !== p.total || p.pageCount > 1) {
      throw new Error('Неполный relation brand: ' + documentId);
    }
    return items.map(item => item?.documentId ?? item?.attributes?.documentId)
      .filter(Boolean);
  }

  async function productDetail(documentId, published = false) {
    const q = new URLSearchParams({ locale: LOCALE });
    if (published) q.set('status', 'published');
    const json = await request(BASE + '/' + encodeURIComponent(documentId) + '?' + q);
    const item = json?.data ?? json;
    if (!item || item.documentId !== documentId) {
      throw new Error('Некорректный Product detail: ' + documentId);
    }
    return item;
  }

  function downloadCsv() {
    const columns = [
      'documentId', 'name', 'brandDocumentId',
      'previousActive', 'result', 'error'
    ];
    const quote = value => {
      let str = String(value ?? '');
      if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
      return '"' + str.replace(/"/g, '""') + '"';
    };
    const lines = [
      columns.join(';'),
      ...report.results.map(item =>
        columns.map(key => quote(item[key])).join(';'))
    ];
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], {
      type: 'text/csv;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'products-brand-active-false.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  let token;
  try {
    token = authToken();
    const products = await listProducts();
    const matches = [];

    for (let i = 0; i < products.length; i += READ_CONCURRENCY) {
      if (window.brandDisableStop) throw new Error('Остановлено пользователем');
      const batch = products.slice(i, i + READ_CONCURRENCY);
      const checked = await Promise.all(batch.map(async product => ({
        product,
        brands: await getBrands(product.documentId)
      })));

      for (const { product, brands } of checked) {
        const brandDocumentId = brands.find(id => TARGET_BRANDS.has(id));
        if (brandDocumentId) {
          matches.push({
            documentId: product.documentId,
            name: product.name ?? product.name1 ?? '',
            brandDocumentId
          });
        }
      }
      report.scanned += checked.length;
      if (report.scanned % 250 < READ_CONCURRENCY ||
          report.scanned === products.length) {
        console.log('[lux-normalizer] Проверено ' + report.scanned +
          '/' + products.length + ', найдено ' + matches.length);
      }
    }

    report.matched = matches.length;
    report.results = matches.map(item => ({
      ...item, previousActive: '', result: 'не обработано', error: ''
    }));
    console.log('[lux-normalizer] DRY-RUN: проверено ' + report.scanned +
      ', совпадений ' + report.matched);
    console.table(report.results.slice(0, 30));

    if (!matches.length) return;
    if (!confirm('Найдено ' + matches.length +
      ' Products с указанными brand.\n' +
      'Для каждого: active=false → Save → Publish (ru).\nЗапустить изменения?')) {
      console.log('[lux-normalizer] Отменено. Данные не изменены.');
      return;
    }

    for (let i = 0; i < report.results.length; i += WRITE_CONCURRENCY) {
      if (window.brandDisableStop) {
        console.warn('[lux-normalizer] Остановлено по запросу');
        break;
      }
      const batch = report.results.slice(i, i + WRITE_CONCURRENCY);
      await Promise.all(batch.map(async item => {
        try {
          const currentBrands = await getBrands(item.documentId);
          if (!currentBrands.includes(item.brandDocumentId)) {
            throw new Error('Brand изменился после dry-run: пропуск');
          }
          const before = await productDetail(item.documentId);
          if (!Object.prototype.hasOwnProperty.call(before, 'active')) {
            throw new Error('В Product detail отсутствует active');
          }
          item.previousActive = before.active;

          const itemUrl = BASE + '/' + encodeURIComponent(item.documentId);
          await request(itemUrl + '?locale=' + LOCALE, 'PUT', { active: false });
          item.result = 'сохранено';

          await request(itemUrl + '/actions/publish?locale=' + LOCALE, 'POST', {});
          item.result = 'опубликовано';

          const verified = await productDetail(item.documentId, true);
          if (verified.active !== false || !verified.publishedAt) {
            throw new Error('Published verify: active !== false или нет publishedAt');
          }
          item.result = 'успешно';
          report.savedAndPublished++;
        } catch (error) {
          item.error = error?.message || String(error);
          item.result = 'ошибка (этап: ' + item.result + ')';
          report.failed++;
          console.error('[lux-normalizer] ' + item.documentId + ': ' + item.error);
        }
      }));
      const done = Math.min(i + batch.length, report.results.length);
      console.log('[lux-normalizer] Write ' + done + '/' + report.results.length +
        ' | успешно ' + report.savedAndPublished + ' | ошибок ' + report.failed);
      await sleep(200);
    }

    console.table(report.results.filter(item => item.result !== 'успешно'));
    console.log('[lux-normalizer] Итог:', {
      scanned: report.scanned,
      matched: report.matched,
      successful: report.savedAndPublished,
      errors: report.failed
    });
    downloadCsv();
  } catch (error) {
    console.error('[lux-normalizer] Остановлено с ошибкой:', error);
  } finally {
    window.__brandDisableRunning = false;
  }
})();
