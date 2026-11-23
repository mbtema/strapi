(async () => {
  'use strict';

  if (window.__brandProductsDeactivateRunning) {
    console.warn('[brandProductsDeactivate] Скрипт уже запущен');
    return;
  }

  window.__brandProductsDeactivateRunning = true;
  window.brandProductsDeactivateStop = false;

  const BRAND_UID = 'api::brand.brand';
  const PRODUCT_UID = 'api::product.product';
  const LOCALE = 'ru';
  const PAGE_SIZE = 100;
  const WRITE_CONCURRENCY = 4;
  const FILE_NAME = 'brand-products-deactivate.csv';
  let report = null;
  let confirmed = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function adminToken() {
    const raw = localStorage.getItem('jwtToken');
    if (!raw) throw new Error('Не найден Admin JWT');
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'string' ? parsed : raw;
    } catch {
      return raw.replace(/^"|"$/g, '');
    }
  }

  function rows(json) {
    return json?.results ?? json?.data?.results ?? null;
  }

  function pagination(json) {
    return json?.pagination ??
      json?.meta?.pagination ??
      json?.data?.pagination ??
      json?.data?.meta?.pagination ??
      null;
  }

  function unpack(json, id, label) {
    const item = json?.data ?? json;
    if (!item || item.documentId !== id) {
      throw new Error(label + ': неверный documentId ' + id);
    }
    return item;
  }

  function downloadCsv() {
    const columns = ['documentId', 'brandDocumentId', 'stage', 'result', 'error'];
    const quote = value => {
      let s = String(value ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const csv = [
      columns.join(';'),
      ...report.results.map(row => columns.map(key => quote(row[key])).join(';'))
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], {
      type: 'text/csv;charset=utf-8'
    }));
    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: FILE_NAME
    });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  try {
    const brandDocumentId = decodeURIComponent(
      location.pathname.match(/\/collection-types\/api::brand\.brand\/([^/?#]+)/)?.[1] || ''
    );

    if (!brandDocumentId) {
      throw new Error('Откройте карточку конкретного Brand в Strapi Admin');
    }

    const token = adminToken();
    const headers = {
      Accept: 'application/json',
      Authorization: 'Bearer ' + token
    };

    async function request(url, method = 'GET', body) {
      const attempts = method === 'GET' ? 3 : 1;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        let response;
        try {
          response = await fetch(url, {
            method,
            credentials: 'include',
            headers: {
              ...headers,
              ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
          });
        } catch (error) {
          if (attempt === attempts) throw error;
          await sleep(500 * attempt);
          continue;
        }

        if (response.ok) {
          const text = await response.text();
          return text ? JSON.parse(text) : null;
        }

        if (method === 'GET' && attempt < attempts &&
            (response.status === 429 || response.status >= 500)) {
          await sleep(500 * attempt);
          continue;
        }

        const message = (await response.text().catch(() => '')).slice(0, 300);
        throw new Error(method + ' ' + url + ': HTTP ' + response.status + ' ' + message);
      }
      throw new Error('Запрос не выполнен: ' + url);
    }

    const relationBase = '/content-manager/relations/' + BRAND_UID + '/' +
      encodeURIComponent(brandDocumentId) + '/products';

    async function relationPage(page) {
      const params = new URLSearchParams({
        locale: LOCALE,
        status: 'draft',
        page: String(page),
        pageSize: String(PAGE_SIZE)
      });
      const json = await request(relationBase + '?' + params);
      const items = rows(json);
      const p = pagination(json);
      const total = Number(p?.total);
      const pageCount = Number(p?.pageCount);

      if (!Array.isArray(items) || !Number.isInteger(total) || total < 0 ||
          !Number.isInteger(pageCount) || pageCount < 0 ||
          pageCount !== (total === 0 ? pageCount : Math.ceil(total / PAGE_SIZE)) ||
          (total === 0 && pageCount > 1)) {
        throw new Error('Некорректный ответ Brand.products, страница ' + page);
      }
      return { items, total, pageCount };
    }

    console.log('[brandProductsDeactivate] Brand:', brandDocumentId);
    const first = await relationPage(1);
    const items = [...first.items];

    for (let page = 2; page <= first.pageCount; page++) {
      if (window.brandProductsDeactivateStop) {
        throw new Error('Остановлено до записи: CSV не сформирован');
      }
      const result = await relationPage(page);
      if (result.total !== first.total || result.pageCount !== first.pageCount) {
        throw new Error('Pagination Brand.products изменилась во время чтения');
      }
      items.push(...result.items);
      console.log('[brandProductsDeactivate] Прочитано Product:', items.length, '/', first.total);
    }

    if (items.length !== first.total) {
      throw new Error('Relation Brand.products неполная: ' + items.length + '/' + first.total);
    }

    const ids = items.map(item => item?.documentId);
    if (ids.some(id => typeof id !== 'string' || !id)) {
      throw new Error('Brand.products содержит Product без documentId');
    }
    if (new Set(ids).size !== ids.length) {
      throw new Error('Brand.products содержит повторяющиеся documentId');
    }

    report = {
      brandDocumentId,
      locale: LOCALE,
      total: ids.length,
      successful: 0,
      needsReview: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      results: ids.map(documentId => ({
        documentId,
        brandDocumentId,
        stage: 'pending',
        result: 'not_started',
        error: ''
      }))
    };
    window.brandProductsDeactivateReport = report;

    console.log('[brandProductsDeactivate] DRY-RUN: Product для отключения:', ids.length);
    if (!ids.length) {
      console.log('[brandProductsDeactivate] Связанных Product нет, изменения не нужны');
      return;
    }

    if (window.brandProductsDeactivateStop) return;
    if (!confirm('Brand ' + brandDocumentId + ': ' + ids.length +
      ' связанных Product.\nДля каждого: active=false → Save → Publish (ru).\n' +
      'Первый Product — контрольный пилот; после успеха — остальные.\nЗапустить?')) {
      console.log('[brandProductsDeactivate] Отменено без изменений');
      return;
    }
    confirmed = true;

    const productBase = '/content-manager/collection-types/' + PRODUCT_UID;
    let halted = false;

    async function processProduct(row) {
      if (halted || window.brandProductsDeactivateStop) return;

      const path = productBase + '/' + encodeURIComponent(row.documentId);
      const params = '?locale=' + LOCALE;

      try {
        row.stage = 'save';
        await request(path + params, 'PUT', { active: false });

        row.stage = 'verify-save';
        const saved = unpack(
          await request(path + params + '&status=draft'),
          row.documentId,
          'Save verify'
        );
        if (saved.active !== false) {
          throw new Error('Save verify: active !== false');
        }

        row.stage = 'publish';
        await request(path + '/actions/publish' + params, 'POST', {});

        row.stage = 'verify-published';
        const published = unpack(
          await request(path + params + '&status=published'),
          row.documentId,
          'Published verify'
        );
        if (published.active !== false || !published.publishedAt) {
          throw new Error('Published verify: active !== false или нет publishedAt');
        }

        row.stage = 'complete';
        row.result = 'success';
        report.successful++;
      } catch (error) {
        row.result = 'needs_review';
        row.error = error?.message || String(error);
        report.needsReview++;
        halted = true;
        console.error('[brandProductsDeactivate] STOP на', row.documentId, row.stage, row.error);
      }
    }

    // Один подтверждённый пилот перед массовым запуском.
    await processProduct(report.results[0]);

    for (let index = 1; index < report.results.length &&
         !halted && !window.brandProductsDeactivateStop; index += WRITE_CONCURRENCY) {
      const batch = report.results.slice(index, index + WRITE_CONCURRENCY);
      await Promise.all(batch.map(processProduct));
      console.log('[brandProductsDeactivate] Обработано',
        report.successful + report.needsReview, '/', report.total,
        '| успешно', report.successful, '| review', report.needsReview);
      if (index + WRITE_CONCURRENCY < report.results.length) await sleep(200);
    }

    console.log('[brandProductsDeactivate] Итог:', {
      brandDocumentId,
      total: report.total,
      successful: report.successful,
      needsReview: report.needsReview,
      stopped: halted || window.brandProductsDeactivateStop
    });
  } catch (error) {
    console.error('[brandProductsDeactivate] Остановлено:', error);
  } finally {
    if (report && confirmed) {
      report.finishedAt = new Date().toISOString();
      downloadCsv();
    }
    window.__brandProductsDeactivateRunning = false;
  }
})();