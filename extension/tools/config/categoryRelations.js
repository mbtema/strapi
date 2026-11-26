(async () => {
  'use strict';

  const TAG = '[categoryRelationsConfig]';
  const UID = 'api::category.category';
  const FIELDS = ['parent', 'categories', 'product', 'products', 'brand', 'top_brands'];
  const PAGE_SIZE = 100;
  const RUN_KEY = '__tmCategoryRelationsConfigRunning';
  if (window[RUN_KEY]) return;
  const designSystem = window.__tmStrapiDesignSystem;
  if (!designSystem?.createToolStatus) throw Error('Обновите расширения через forceUpdate()');
  window[RUN_KEY] = true;

  const report = {
    status: 'running', total: 0, checked: 0, matched: 0,
    differences: [], blocked: [], requests: 0, errors: []
  };
  window.categoryRelationsConfigReport = report;
  let stopped = false;

  function ensure(value, message) {
    if (!value) throw Error(message);
  }

  function guard() {
    if (stopped) throw Error('Остановлено пользователем');
  }

  function token() {
    let value = localStorage.getItem('jwtToken');
    try { value = JSON.parse(value); } catch {}
    ensure(typeof value === 'string' && value.trim(), 'Нет Admin jwtToken');
    return value.trim().replace(/^Bearer\s+/i, '');
  }

  async function get(path, optional = false) {
    guard();
    report.requests++;
    const response = await fetch(path, {
      method: 'GET', cache: 'no-store', credentials: 'include',
      headers: { Authorization: 'Bearer ' + token(), Accept: 'application/json' }
    });
    if (optional && response.status === 404) return null;
    ensure(response.ok, 'HTTP ' + response.status + ': ' + path);
    return response.json();
  }

  async function readPages(path, params, validate, expectedCount = null, onPage = () => {}) {
    const rows = [], seen = new Set();
    let total = null, pageCount = null;
    for (let page = 1; page <= 10000; page++) {
      const qs = new URLSearchParams({
        ...params, page: String(page), pageSize: String(PAGE_SIZE)
      });
      const data = await get(path + '?' + qs);
      const p = data?.pagination;
      ensure(Array.isArray(data?.results) &&
        Number.isSafeInteger(p?.total) && p.total >= 0 &&
        Number.isSafeInteger(p?.pageCount) && p.pageCount >= 0 &&
        (p.page == null || Number(p.page) === page), 'Неверная пагинация: ' + path);
      if (total === null) {
        total = p.total;
        pageCount = p.pageCount;
      }
      ensure(p.total === total && p.pageCount === pageCount,
        'Пагинация изменилась: ' + path);
      for (const row of data.results) {
        const id = validate(row);
        ensure(/^[a-zA-Z0-9]+$/.test(id || '') && !seen.has(id),
          'Дубль или неверный documentId: ' + path);
        seen.add(id);
        rows.push(id);
      }
      onPage(rows.length, total);
      if (page >= pageCount) break;
      ensure(data.results.length > 0 && page < 10000, 'Неполная пагинация: ' + path);
    }
    ensure(rows.length === total && (expectedCount === null || expectedCount === total),
      'Неполный набор данных: ' + path);
    return rows;
  }

  async function listCategories(render) {
    let previousId = 0;
    return readPages('/content-manager/collection-types/' + UID, {
      locale: 'ru', status: 'draft', sort: 'id:ASC'
    }, raw => {
      const row = raw?.attributes && !raw.documentId
        ? { ...raw.attributes, id: raw.id } : raw;
      ensure(row?.locale === 'ru' && Number.isSafeInteger(row.id) && row.id > previousId,
        'Неверная локаль или порядок RU Category');
      previousId = row.id;
      return row.documentId;
    }, null, (loaded, total) => render('Чтение RU: ' + loaded + '/' + total, '', { loaded, total }));
  }

  async function detail(id, locale) {
    const data = await get('/content-manager/collection-types/' + UID + '/' +
      encodeURIComponent(id) + '?locale=' + locale + '&status=draft', locale === 'kk');
    if (data === null && locale === 'kk') return null;
    const row = data?.data;
    if (locale === 'kk' && (!row || !Object.keys(row).length)) return null;
    ensure(row?.documentId === id && row.locale === locale,
      'Неверная Category: ' + id + '/' + locale);
    for (const field of FIELDS)
      ensure(Number.isSafeInteger(row[field]?.count) && row[field].count >= 0,
        'Нет точного count: ' + id + '/' + locale + '/' + field);
    return row;
  }

  async function links(id, field, locale, count) {
    if (count === 0) return [];
    return readPages('/content-manager/relations/' + UID + '/' +
      encodeURIComponent(id) + '/' + field, { locale, status: 'draft' }, row => {
      ensure(Number.isSafeInteger(row?.id) && row.id > 0 &&
        (!row.locale || row.locale === locale), 'Неверная relation: ' + id + '/' + field);
      return row.documentId;
    }, count);
  }

  function diff(ru, kk) {
    const source = new Set(ru), target = new Set(kk);
    return {
      connect: ru.filter(id => !target.has(id)).sort(),
      disconnect: kk.filter(id => !source.has(id)).sort()
    };
  }

  async function inspect(id) {
    const [ru, kk] = await Promise.all([detail(id, 'ru'), detail(id, 'kk')]);
    if (!kk) return { blocked: 'Отсутствует KK Category' };
    if (ru.products.count > 0) return { blocked: 'RU products не пусто' };
    const changes = {};
    for (const field of FIELDS) {
      guard();
      const [source, target] = await Promise.all([
        links(id, field, 'ru', ru[field].count),
        links(id, field, 'kk', kk[field].count)
      ]);
      const delta = diff(source, target);
      if (delta.connect.length || delta.disconnect.length) changes[field] = delta;
    }
    return { changes };
  }

  function csv(columns, rows) {
    const cell = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    return '\uFEFF' + [columns.join(','), ...rows.map(row =>
      columns.map(key => cell(row[key])).join(','))].join('\r\n');
  }

  function download(name, content) {
    const href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  function configCsv() {
    return csv(['documentId'], report.differences);
  }

  function blockedCsv() {
    return csv(['documentId', 'reason'], report.blocked);
  }

  async function scan(render) {
    const ids = await listCategories(render);
    report.total = ids.length;
    render('Проверка Category');
    for (const id of ids) {
      guard();
      const result = await inspect(id);
      if (result.blocked) report.blocked.push({ documentId: id, reason: result.blocked });
      else if (Object.keys(result.changes).length)
        report.differences.push({ documentId: id, fields: result.changes });
      else report.matched++;
      report.checked++;
      render('Проверка Category', id);
    }
    guard();
    ensure(report.checked === report.total, 'Обход не завершён');
    report.status = 'completed';
  }

  const ui = designSystem.createToolStatus('Category Relations Config');
  const { phase: phaseLabel, detail: status } = ui;
  const stop = ui.button('Остановить');
  const save = ui.button('Скачать конфиг');
  const review = ui.button('Скачать исключения');
  save.hidden = review.hidden = true;
  stop.onclick = () => {
    stopped = true;
    stop.disabled = true;
    stop.textContent = 'Остановка…';
  };
  save.onclick = () => download('category-relations-config.csv', configCsv());
  review.onclick = () => download('category-relations-config-blocked.csv', blockedCsv());

  function render(phase, id = '', reading = null) {
    phaseLabel.textContent = phase;
    status.textContent = 'Проверено: ' + report.checked + '/' + report.total +
      '\nС расхождениями: ' + report.differences.length +
      '\nСовпадают: ' + report.matched + ' · Исключено: ' + report.blocked.length +
      (id ? '\nCategory: ' + id : '');
    ui.setProgress(reading ? reading.loaded : report.checked,
      reading ? reading.total : report.total);
    if (stopped && report.status === 'running') status.textContent += '\nОстановка…';
  }

  try {
    ui.open();
    render('Загрузка списка RU Category');
    await scan(render);
    render(report.differences.length ? 'Конфиг готов' : 'Расхождений для синхронизации нет');
    save.hidden = !report.differences.length;
    review.hidden = !report.blocked.length;
    if (report.differences.length) save.click();
    console.log(TAG, 'Готово', report);
  } catch (error) {
    report.status = stopped ? 'stopped' : 'error';
    report.errors.push(error.message);
    render(stopped ? 'Остановлено. Конфиг не сформирован' : 'Ошибка: ' + error.message);
    console.error(TAG, error);
  } finally {
    ui.finish(stop);
    window[RUN_KEY] = false;
  }
})();
