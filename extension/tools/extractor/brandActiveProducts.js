(async () => {
  'use strict';

  const LOCALE = 'ru';
  const PAGE_SIZE = 100;
  const CONCURRENCY = 8;
  const FILE_NAME = 'brand-active-products.csv';

  try {
    const brandId = decodeURIComponent(
      location.pathname.match(
        /\/collection-types\/api::brand\.brand\/([^/?#]+)/
      )?.[1] || ''
    );

    if (!brandId) {
      throw new Error('Откройте конкретную запись Brand');
    }

    const raw = localStorage.getItem('jwtToken');
    let token;
    try {
      token = JSON.parse(raw);
    } catch {
      token = raw;
    }

    if (typeof token !== 'string' || !token) {
      throw new Error('Не найден Admin JWT');
    }

    async function get(path) {
      const response = await fetch(path, {
        method: 'GET',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + token
        }
      });

      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ': ' + path);
      }

      return response.json();
    }

    const relationBase =
      '/content-manager/relations/api::brand.brand/' +
      encodeURIComponent(brandId) + '/products';

    async function relationPage(page) {
      const params = new URLSearchParams({
        locale: LOCALE,
        status: 'draft',
        page: String(page),
        pageSize: String(PAGE_SIZE)
      });

      const response = await get(relationBase + '?' + params);
      const results = response?.results ?? response?.data?.results;
      const pagination =
        response?.pagination ??
        response?.meta?.pagination ??
        response?.data?.pagination ??
        response?.data?.meta?.pagination;

      if (!Array.isArray(results) || !pagination) {
        throw new Error('Некорректная страница relation: ' + page);
      }

      return { results, pagination };
    }

    console.log('[brandActiveProducts] Brand:', brandId);
    console.log('[brandActiveProducts] Чтение relation products...');

    const first = await relationPage(1);
    const total = Number(first.pagination.total);
    const pageCount = Number(first.pagination.pageCount);

    if (!Number.isInteger(total) || total < 0 ||
        !Number.isInteger(pageCount) || pageCount < 0 ||
        (total > 0 && pageCount === 0)) {
      throw new Error('Некорректная pagination relation');
    }

    const relations = [...first.results];

    for (let page = 2; page <= pageCount; page++) {
      const result = await relationPage(page);

      if (Number(result.pagination.total) !== total ||
          Number(result.pagination.pageCount) !== pageCount) {
        throw new Error('Pagination relation изменилась во время чтения');
      }

      relations.push(...result.results);
      console.log(
        '[brandActiveProducts] Relation: ' + relations.length + '/' + total
      );
    }

    if (relations.length !== total) {
      throw new Error(
        'Relation неполная: ' + relations.length + '/' + total
      );
    }

    const allIds = relations.map(item => item?.documentId);

    if (allIds.some(id => typeof id !== 'string' || !id)) {
      throw new Error('Relation содержит Product без documentId');
    }

    if (new Set(allIds).size !== allIds.length) {
      throw new Error('В relation обнаружены дубликаты documentId');
    }

    const activeIds = [];
    let index = 0;
    let checked = 0;
    let failure = null;

    async function worker() {
      while (!failure) {
        const current = index++;
        if (current >= allIds.length) return;

        const documentId = allIds[current];

        try {
          const params = new URLSearchParams({
            locale: LOCALE,
            status: 'draft'
          });

          const response = await get(
            '/content-manager/collection-types/api::product.product/' +
            encodeURIComponent(documentId) + '?' + params
          );

          const product = response?.data ?? response;

          if (product?.documentId !== documentId ||
              typeof product.active !== 'boolean') {
            throw new Error('Некорректный Product: ' + documentId);
          }

          if (product.active === true) {
            activeIds.push(documentId);
          }

          checked++;

          if (checked % 25 === 0 || checked === allIds.length) {
            console.log(
              '[brandActiveProducts] Проверено: ' + checked + '/' +
              allIds.length + '; активных: ' + activeIds.length
            );
          }
        } catch (error) {
          failure = error;
          return;
        }
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(CONCURRENCY, allIds.length) },
        () => worker()
      )
    );

    if (failure) throw failure;

    activeIds.sort();

    const csv = ['productDocumentId', ...activeIds].join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], {
      type: 'text/csv;charset=utf-8'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = FILE_NAME;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    console.log('[brandActiveProducts] Готово');
    console.log('Brand:', brandId);
    console.log('Всего Product:', allIds.length);
    console.log('Active=true:', activeIds.length);
    console.log('Active=false:', allIds.length - activeIds.length);
    console.log('CSV скачан:', FILE_NAME);
  } catch (error) {
    console.error('[brandActiveProducts] Ошибка. CSV не сформирован:', error);
  }
})();