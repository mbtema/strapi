// Проверка после пилота: RU draft vs RU published, включая все relations.
// Strapi Admin 5.13: только GET, ничего не сохраняет, не публикует и не удаляет.
// Открой RU-карточку тестового товара Product в админке и запусти JS в Console.
(async () => {
  'use strict';
  const PREFIX = '[locale/product-kk-ru-versions-check]';
  const UID = 'api::product.product';
  const DOCUMENT_ID = 'loeqjcvawiaajxsyld5g3jqc';
  const SYSTEM_FIELDS = new Set([
    'id', 'documentId', 'locale', 'status', 'publishedAt',
    'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'localizations'
  ]);

  const match = location.pathname.match(
    /^\/admin\/content-manager\/collection-types\/api::product\.product\/([a-z0-9]+)\/?$/i
  );
  if (!match || match[1] !== DOCUMENT_ID) {
    console.error(PREFIX, 'Открой Product ' + DOCUMENT_ID + ' в Strapi Admin.');
    return;
  }
  const currentLocale = new URLSearchParams(location.search)
    .get('plugins[i18n][locale]');
  if (currentLocale && currentLocale !== 'ru') {
    console.error(PREFIX, 'Нужна RU-карточка, сейчас ' + currentLocale);
    return;
  }
  const raw = localStorage.getItem('jwtToken');
  let token;
  try { token = JSON.parse(raw); } catch { token = raw; }
  if (typeof token !== 'string' || !token.trim()) {
    console.error(PREFIX, 'Нет действующего jwtToken Strapi Admin.');
    return;
  }

  async function get(path) {
    const response = await fetch(path, {
      method: 'GET', credentials: 'include', cache: 'no-store',
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + token }
    });
    if (!response.ok) {
      throw new Error('GET HTTP ' + response.status + ': ' + path);
    }
    return response.json();
  }
  function normalized(value) {
    if (Array.isArray(value)) return value.map(normalized);
    if (value !== null && typeof value === 'object') {
      const sorted = {};
      for (const key of Object.keys(value).sort()) sorted[key] = normalized(value[key]);
      return sorted;
    }
    return value;
  }
  function eq(a, b) {
    return JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
  }
  function fields(record, attributes) {
    const result = {};
    for (const name of Object.keys(attributes)) {
      if (SYSTEM_FIELDS.has(name)) continue;
      result[name] = Object.prototype.hasOwnProperty.call(record, name)
        ? record[name] : { __fieldMissingInResponse: true };
    }
    return result;
  }
  function diff(a, b) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .sort()
      .filter(key => !eq(a[key], b[key]))
      .map(key => ({ field: key, draft: a[key] ?? null, published: b[key] ?? null }));
  }
  async function fetchRelations(status, relationFields) {
    const out = {};
    for (const name of relationFields) {
      let page = 1, total = 0;
      const ids = [];
      while (true) {
        const route = '/content-manager/relations/' + UID + '/' +
          DOCUMENT_ID + '/' + encodeURIComponent(name) +
          '?locale=ru&status=' + status + '&page=' + page + '&pageSize=100';
        const body = await get(route);
        if (!Array.isArray(body?.results) ||
            !Number.isInteger(body?.pagination?.total)) {
          throw new Error('Неожиданный ответ relation: ' + name + ', ' + status);
        }
        total = body.pagination.total;
        for (const entry of body.results) {
          const id = entry?.documentId ?? entry?.id;
          if (id == null) throw new Error('Нет id у relation ' + name);
          ids.push(String(id));
        }
        if (ids.length >= total) break;
        if (body.results.length === 0 || page >= 100) {
          throw new Error('Не удалось прочитать все relations ' + name);
        }
        page++;
      }
      out[name] = { total, ids: ids.sort() };
    }
    return out;
  }
  function save(result) {
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: 'application/json;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'product-kk-ru-versions-check-' + DOCUMENT_ID + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  try {
    console.log(PREFIX, 'GET схемы и RU draft/published');
    const route = '/content-manager/collection-types/' + UID + '/' + DOCUMENT_ID;
    const [schemaResponse, draftResponse, publishedResponse] = await Promise.all([
      get('/content-manager/content-types'),
      get(route + '?locale=ru&status=draft'),
      get(route + '?locale=ru&status=published')
    ]);
    const schema = schemaResponse?.data?.find(record => record?.uid === UID);
    if (!schema?.attributes) throw new Error('Не найдена схема Product.');
    const draft = draftResponse?.data;
    const published = publishedResponse?.data;
    for (const [status, record] of [['draft', draft], ['published', published]]) {
      if (!record || record.documentId !== DOCUMENT_ID || record.locale !== 'ru') {
        throw new Error('Не удалось подтвердить RU ' + status);
      }
    }

    const relationNames = Object.entries(schema.attributes)
      .filter(([, attr]) =>
        attr?.type === 'relation' &&
        typeof attr.target === 'string' && attr.target.startsWith('api::'))
      .map(([name]) => name);
    console.log(PREFIX, 'Читаем ' + relationNames.length + ' relations для обеих RU-версий');
    const [draftRelations, publishedRelations] = await Promise.all([
      fetchRelations('draft', relationNames),
      fetchRelations('published', relationNames)
    ]);
    const fieldDifferences = diff(
      fields(draft, schema.attributes), fields(published, schema.attributes)
    );
    const relationDifferences = diff(draftRelations, publishedRelations);
    const report = {
      tool: 'product-kk-ru-versions-check',
      readOnly: true,
      checkedAt: new Date().toISOString(),
      adminOrigin: location.origin,
      uid: UID, documentId: DOCUMENT_ID,
      checks: {
        draftAndPublishedSameBusinessFields: fieldDifferences.length === 0,
        draftAndPublishedSameRelations: relationDifferences.length === 0,
        draftStatus: draft.status ?? null,
        publishedStatus: published.status ?? null,
        publishedHasPublishedAt: published.publishedAt != null,
        sameRuDocumentId: draft.documentId === published.documentId
      },
      ruDraftMetadata: {
        id: draft.id, updatedAt: draft.updatedAt,
        publishedAt: draft.publishedAt, status: draft.status
      },
      ruPublishedMetadata: {
        id: published.id, updatedAt: published.updatedAt,
        publishedAt: published.publishedAt, status: published.status
      },
      fieldDifferences,
      relationDifferences,
      draftRelations, publishedRelations
    };
    window.tmProductKkRuVersionsCheck = report;
    console.table([report.checks]);
    console.log(PREFIX, 'JSON: window.tmProductKkRuVersionsCheck');
    save(report);
    if (fieldDifferences.length || relationDifferences.length) {
      console.warn(PREFIX, 'RU draft и published РАЗЛИЧАЮТСЯ: проверь скачанный JSON.');
    } else {
      console.log(PREFIX,
        'RU draft и published совпадают по всем доступным бизнес-полям и relations.');
    }
  } catch (error) {
    console.error(PREFIX, error);
  }
})();