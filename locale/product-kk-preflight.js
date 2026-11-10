// Проверка одной Product-записи перед созданием пустой KK-локализации.
// Запуск: открыть нужный Product в Strapi Admin (locale=ru), затем вставить этот файл в Console.
// Только GET. Ничего не создаёт, не сохраняет и не публикует.
(async () => {
  'use strict';

  const PREFIX = '[locale/product-kk-preflight]';
  const STATE_KEY = '__tmProductKkPreflight';
  const UID = 'api::product.product';
  const EXPECTED = {
    name: 'Dior Dior Addict Makeup Ritual Set Holiday Edition Y26 Подарочный набор',
    code_1c: 'e000035346',
    xml_id: '3926cc63-ab85-11f1-9890-e43d1aa594dd'
  };

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
    for (const [field, expected] of Object.entries(EXPECTED)) {
      if (String(ru[field] ?? '').trim() !== expected) {
        fail('Карточка не совпадает с тестовым товаром по ' + field +
          '. Получено: ' + String(ru[field] ?? 'null'));
      }
    }

    log('Проверка существования локализации KK');
    const kkResponse = await read(base + '?locale=kk', true);
    let kk = null;
    if (kkResponse.exists) {
      kk = unwrap(kkResponse.body);
      if (kk.documentId !== documentId || kk.locale !== 'kk') {
        fail('KK detail вернул неожиданный documentId или locale; нельзя считать локализацию существующей.');
      }
    }

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
        kkLocale: kk ? 'exists' : 'missing',
        safeForPlaceholderTest: !kk,
        matchingSourceName: true,
        matchingSourceCode1c: true,
        matchingSourceXmlId: true
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
      target: kk ? {
        documentId: kk.documentId,
        id: kk.id ?? null,
        locale: kk.locale,
        status: kk.status ?? null,
        publishedAt: kk.publishedAt ?? null
      } : null,
      requiredInputsVisibleInRu: requiredInputs,
      configuration
    };

    window.tmProductKkPreflightResult = result;
    console.table(result.checks);
    console.table(requiredInputs);
    console.log(PREFIX, 'Полный отчёт: window.tmProductKkPreflightResult');
    downloadJson('product-kk-preflight-' + documentId + '.json', result);
    log('Готово. ' + (kk ? 'KK уже существует; запись не меняли.' :
      'KK отсутствует; можно готовить отдельный безопасный тест создания.'));
  } catch (error) {
    console.error(PREFIX, error);
  } finally {
    state.running = false;
  }
})();