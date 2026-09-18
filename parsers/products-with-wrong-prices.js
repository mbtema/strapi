(async () => {
  const BASE_URL = '/api/attributes';
  const PAGE_SIZE = 100;
  const HEADERS = ['barcode', 'price', 'errorType'];
  const rows = [];

  const timestamp = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  };

  const priceIssue = value => {
    if (value == null || String(value).trim() === '') return 'missing';

    const price = Number(value);
    if (!Number.isFinite(price)) return 'missing';
    if (price === 0) return 'zero';
    if (!Number.isInteger(price)) return 'fractional';

    return null;
  };

  const downloadCSV = (items, filename) => {
    const q = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [
      HEADERS.join(';'),
      ...items.map(row => HEADERS.map(key => q(row[key])).join(';'))
    ].join('\n');

    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    );

    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: filename
    });

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const params = new URLSearchParams({
    'pagination[pageSize]': String(PAGE_SIZE),
    'sort[0]': 'id:asc',
    'filters[product][active][$eq]': 'true',
    'fields[0]': 'price',
    'fields[1]': 'barcode'
  });

  let page = 1;
  let pageCount = 1;
  let total = 0;
  let checked = 0;

  while (page <= pageCount) {
    params.set('pagination[page]', String(page));

    const response = await fetch(`${BASE_URL}?${params}`);
    if (!response.ok) {
      throw new Error(`Ошибка ${response.status} на странице ${page}`);
    }

    const { data, meta } = await response.json();

    pageCount = meta.pagination.pageCount;
    total = meta.pagination.total;

    for (const attribute of data) {
      checked++;

      const errorType = priceIssue(attribute.price);
      if (!errorType) continue;

      rows.push({
        barcode: attribute.barcode ?? '',
        price: attribute.price ?? '',
        errorType
      });
    }

    if (page === 1 || page % 25 === 0 || page === pageCount) {
      console.log(
        `Страница ${page}/${pageCount} | Проверено предложений: ${checked}/${total} | Проблемных предложений: ${rows.length}`
      );
    }

    page++;
  }

  console.table(rows);
  console.log(
    `Готово: найдено ${rows.length} торговых предложений активных товаров с некорректной ценой.`
  );

  window.attributesWithInvalidPrice = rows;

  downloadCSV(
    rows,
    `attributes_invalid_prices_${timestamp()}.csv`
  );
})();
