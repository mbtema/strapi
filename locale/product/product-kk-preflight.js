// Проверка одного Product DIOR из списка отсутствующих KK-локализаций.
// Запуск: открыть нужный Product в Strapi Admin (locale=ru), затем вставить этот файл в Console.
// Только GET. Ничего не создаёт, не сохраняет и не публикует.
(async () => {
  'use strict';

  const PREFIX = '[locale/product-kk-preflight]';
  const STATE_KEY = '__tmProductKkPreflight';
  const UID = 'api::product.product';
  // Пилот из проверенного отчёта DIOR: этот Product не имел KK на момент аудита.
  const EXPECTED_DOCUMENT_ID = 'loeqjcvawiaajxsyld5g3jqc';

  if (window[STATE_KEY]?.running) {
    console.warn(PREFIX, 'Проверка уже выполняется');
    return;
  }

  const state = { running: true };
  window[STATE_KEY] = state;

  function log(message) {
    console.log(PREFIX, message);
  }
  function fail(message) {
    throw new Error(PREFIX + ' ' + message);
  }
  function downloadJson(filename, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], {
      type: 'application/json;charset=utf-8'
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 3000);
  }
  function fieldShape(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array(' + value.length + ')';
    if (typeof value === 'object') return 'object';
    return typeof value;
  }

  try {
    const match = location.pathname.match(
      /^\/admin\/content-manager\/collection-types\/api::product\.product\/([a-z0-9]+)\/?$/i
    );
    if (!match) {
      fail('Открой карточку Product (не список и не Category) в Strapi Admin.');
    }

    const documentId = match[1];
    if (documentId !== EXPECTED_DOCUMENT_ID) {
      fail('Открой тестовый товар ' + EXPECTED_DOCUMENT_ID + '. Сейчас ' + documentId);
    }
    const localeInUrl = new URLSearchParams(location.search)
      .get('plugins[i18n][locale]');
    if (localeInUrl && localeInUrl !== 'ru') {
      fail('Открой RU-локаль Product. Сейчас locale=' + localeInUrl);
    }

    const rawToken = localStorage.getItem('jwtToken');
    if (!rawToken) fail('Нет jwtToken текущей Strapi Admin-сессии.');
    let token;
    try { token = JSON.parse(rawToken); } catch { token = rawToken; }
    if (typeof token !== 'string' || !token) {
      fail('Некорректный формат jwtToken.');
    }

    const headers = {
      Accept: 'application/json',
      Authorization: 'Bearer ' + token
    };
    async function read(path, allow404 = false) {
      const response = await fetch(path, {
        method: 'GET', credentials: 'include', headers
      });
      if (response.status === 404 && allow404) {
        return { exists: false, status: 404, body: null };
      }
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        fail('GET HTTP ' + response.status + ' — ' +
          path + (body ? ' — ' + body.slice(0, 160) : ''));
      }
      const json = await response.json();
      if (!json || typeof json !== 'object') {
        fail('Некорректный Content Manager JSON: ' + path);
      }
      return { exists: true, status: response.status, body: json };
    }

    function unwrap(json) {
      const value = json?.data ?? json;
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail('Неожиданный формат Content Manager detail.');
      }
      return value?.attributes && !value.documentId
        ? { ...value.attributes, id: value.id }
        : value;
    }

    const base = '/content-manager/collection-types/' + UID +
      '/' + encodeURIComponent(documentId);
    log('Чтение RU: ' + documentId);
    const ruResponse = await read(base + '?locale=ru');
    const ru = unwrap(ruResponse.body);
    if (ru.documentId !== documentId || ru.locale !== 'ru') {
      fail('RU detail не подтверждает documentId и locale.');
    }

    log('Проверка ответа KK (включая несовпадение locale/documentId)');
    const kkResponse = await read(base + '?locale=kk', true);
    const kkRaw = kkResponse.body;
    const kkRawData = kkRaw && Object.prototype.hasOwnProperty.call(kkRaw, 'data')
      ? kkRaw.data : kkRaw;
    const kkUnwrapped = kkRawData && typeof kkRawData === 'object' &&
      !Array.isArray(kkRawData)
      ? (kkRawData.attributes && !kkRawData.documentId
        ? { ...kkRawData.attributes, id: kkRawData.id }
        : kkRawData)
      : null;
    const kkConfirmed = Boolean(
      kkUnwrapped?.documentId === documentId && kkUnwrapped?.locale === 'kk'
    );
    // Strapi Content Manager для отсутствующей KK может вернуть HTTP 200 с data: {}.
    // Пустым считаем только явное data: {} или HTTP 404. Любой другой ответ —
    // unverified, чтобы не рискнуть существующей локализацией.
    const emptyDataObject = kkResponse.status === 200 &&
      kkRaw && Object.prototype.hasOwnProperty.call(kkRaw, 'data') &&
      kkRawData !== null && typeof kkRawData === 'object' &&
      !Array.isArray(kkRawData) && Object.keys(kkRawData).length === 0;
    const kkState = kkConfirmed ? 'exists'
      : kkResponse.status === 404 || emptyDataObject ? 'missing'
      : 'unverified';
    const briefLocalization = item => ({
      documentId: item?.documentId ?? null,
      id: item?.id ?? null,
      locale: item?.locale ?? null,
      status: item?.status ?? null
    });

    log('Чтение конфигурации Content Manager');
    const configurationResponse = await read(
      '/content-manager/content-types/' + UID + '/configuration'
    );
    const configuration = configurationResponse.body;

    const requiredInputs = Array.from(
      document.querySelectorAll('main input[aria-required="true"]')
    ).map(input => ({
      field: input.name || '',
      disabled: input.disabled,
      type: input.type
    })).filter(item => item.field);

    const result = {
      tool: 'product-kk-preflight',
      createdAt: new Date().toISOString(),
      readOnly: true,
      uid: UID,
      documentId,
      pageUrl: location.pathname + location.search,
      checks: {
        ruVerified: true,
        kkLocale: kkState,
        safeForPlaceholderTest: kkState === 'missing',
        kkHttpStatus: kkResponse.status,
        expectedDocumentId: EXPECTED_DOCUMENT_ID,
        documentIdMatchesAudit: true
      },
      source: {
        documentId: ru.documentId,
        id: ru.id ?? null,
        locale: ru.locale,
        status: ru.status ?? null,
        publishedAt: ru.publishedAt ?? null,
        name: ru.name,
        name1: ru.name1 ?? null,
        name2: ru.name2 ?? null,
        code_1c: ru.code_1c,
        xml_id: ru.xml_id,
        fields: Object.fromEntries(
          Object.entries(ru).map(([key, value]) => [key, fieldShape(value)])
        )
      },
      target: kkConfirmed ? {
        documentId: kkUnwrapped.documentId,
        id: kkUnwrapped.id ?? null,
        locale: kkUnwrapped.locale,
        status: kkUnwrapped.status ?? null,
        publishedAt: kkUnwrapped.publishedAt ?? null
      } : null,
      kkResponseDiagnostic: {
        httpStatus: kkResponse.status,
        rootKeys: kkRaw && typeof kkRaw === 'object' ? Object.keys(kkRaw) : [],
        dataType: kkRawData === null ? 'null'
          : Array.isArray(kkRawData) ? 'array'
          : typeof kkRawData,
        dataKeys: kkUnwrapped ? Object.keys(kkUnwrapped) : [],
        returnedDocumentId: kkUnwrapped?.documentId ?? null,
        returnedLocale: kkUnwrapped?.locale ?? null,
        returnedId: kkUnwrapped?.id ?? null,
        returnedStatus: kkUnwrapped?.status ?? null,
        localizations: Array.isArray(kkUnwrapped?.localizations)
          ? kkUnwrapped.localizations.map(briefLocalization) : null
      },
      ruLocalizations: Array.isArray(ru.localizations)
        ? ru.localizations.map(briefLocalization) : null,
      requiredInputsVisibleInRu: requiredInputs,
      configuration
    };

    window.tmProductKkPreflightResult = result;
    console.table(result.checks);
    console.table(requiredInputs);
    console.table([result.kkResponseDiagnostic]);
    console.log(PREFIX, 'Полный отчёт: window.tmProductKkPreflightResult');
    downloadJson('product-kk-preflight-' + documentId + '.json', result);
    log('Готово: KK = ' + kkState +
      (kkState === 'unverified'
        ? '. Ответ API не подтверждает локализацию; запись заблокирована до анализа JSON.'
        : '. Запись не меняли.'));
  } catch (error) {
    console.error(PREFIX, error);
  } finally {
    state.running = false;
  }
})();