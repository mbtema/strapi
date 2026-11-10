// Проверка результата ручного создания KK-пустышки у одного Product DIOR.
// Запуск: открыть RU/KK-карточку указанного товара в Strapi Admin; вставить код в Console.
// Только GET. Скрипт не сохраняет, не создаёт и не публикует записи.
(async () => {
  'use strict';

  const PREFIX = '[locale/product-kk-postflight]';
  const UID = 'api::product.product';
  const DOCUMENT_ID = 'loeqjcvawiaajxsyld5g3jqc';
  const EXPECTED_KK_ID = 4812483;
  // Снимок RU до ручного создания KK, взят из предыдущего preflight.
  const RU_BEFORE = {
    id: 12690,
    name: 'Подарок Dior Miss Dior Millefiori Notebook GWP Блокнот',
    code_1c: 'e000014675 ',
    xml_id: '26df26c3-6396-11ef-9545-9c69b464fe3d',
    key: 'a3662db567bbbdf8',
    newFrom1C: true,
    InStock: false
  };
  const RELATIONS = ['attributes', 'brand', 'categories'];
  const pathMatch = location.pathname.match(
    /^\/admin\/content-manager\/collection-types\/api::product\.product\/([a-z0-9]+)\/?$/i
  );
  if (!pathMatch || pathMatch[1] !== DOCUMENT_ID) {
    console.error(PREFIX, 'Открой товар ' + DOCUMENT_ID + ' в Strapi Admin.');
    return;
  }

  const raw = localStorage.getItem('jwtToken');
  let token;
  try { token = JSON.parse(raw); } catch { token = raw; }
  if (typeof token !== 'string' || !token.trim()) {
    console.error(PREFIX, 'Нет корректного токена Admin-сессии.');
    return;
  }

  async function get(path) {
    const response = await fetch(path, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer ' + token
      }
    });
    if (!response.ok) throw new Error('GET HTTP ' + response.status + ': ' + path);
    const json = await response.json();
    if (!json || typeof json !== 'object') throw new Error('Неожиданный ответ: ' + path);
    return json;
  }

  function download(obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], {
      type: 'application/json;charset=utf-8'
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = 'product-kk-postflight-' + DOCUMENT_ID + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 3000);
  }

  const base = '/content-manager/collection-types/' + UID + '/' + DOCUMENT_ID;
  try {
    const [ruResponse, kkResponse] = await Promise.all([
      get(base + '?locale=ru'),
      get(base + '?locale=kk')
    ]);
    const ru = ruResponse?.data;
    const kk = kkResponse?.data;
    if (!ru || ru.documentId !== DOCUMENT_ID || ru.locale !== 'ru') {
      throw new Error('RU detail: отсутствует запись или неверные documentId/locale.');
    }
    if (!kk || kk.documentId !== DOCUMENT_ID || kk.locale !== 'kk') {
      throw new Error('KK detail: отсутствует запись или неверные documentId/locale.');
    }

    const differences = Object.entries(RU_BEFORE)
      .filter(([field, before]) => !Object.is(ru[field], before))
      .map(([field, before]) => ({
        field, before, now: ru[field] ?? null
      }));

    const relations = {};
    for (const field of RELATIONS) {
      const path = '/content-manager/relations/' + UID + '/' + DOCUMENT_ID +
        '/' + field + '?locale=kk&pageSize=5&page=1';
      const response = await get(path);
      if (!Array.isArray(response?.results) ||
          !Number.isInteger(response?.pagination?.total)) {
        throw new Error('Неожиданный формат relation ' + field);
      }
      relations[field] = {
        total: response.pagination.total,
        firstPageCount: response.results.length
      };
    }

    const data = {
      tool: 'product-kk-postflight',
      checkedAt: new Date().toISOString(),
      readOnly: true,
      uid: UID,
      documentId: DOCUMENT_ID,
      checks: {
        ruIdUnchanged: ru.id === RU_BEFORE.id,
        ruFieldsUnchangedFromPreflight: differences.length === 0,
        kkIdMatchesNetwork: kk.id === EXPECTED_KK_ID,
        kkDraft: kk.status === 'draft',
        sameDocumentId: ru.documentId === kk.documentId,
        kkRelationsEmpty: RELATIONS.every(field => relations[field].total === 0)
      },
      ru: {
        id: ru.id,
        locale: ru.locale,
        status: ru.status ?? null,
        publishedAt: ru.publishedAt ?? null,
        name: ru.name ?? null,
        code_1c: ru.code_1c ?? null,
        xml_id: ru.xml_id ?? null,
        baselineDifferences: differences,
        availableLocales: Array.isArray(ruResponse?.meta?.availableLocales)
          ? ruResponse.meta.availableLocales.map(x => ({
            id: x.id, locale: x.locale, status: x.status,
            name: x.name ?? null, code_1c: x.code_1c ?? null
          }))
          : null
      },
      kk: {
        id: kk.id,
        locale: kk.locale,
        status: kk.status ?? null,
        publishedAt: kk.publishedAt ?? null,
        name: kk.name ?? null,
        name1: kk.name1 ?? null,
        code_1c: kk.code_1c ?? null,
        xml_id: kk.xml_id ?? null,
        newFrom1C: kk.newFrom1C ?? null,
        InStock: kk.InStock ?? null,
        relationCountsFromDetail: Object.fromEntries(
          Object.entries(kk)
            .filter(([, value]) => value && typeof value === 'object' &&
              !Array.isArray(value) && Number.isInteger(value.count))
            .map(([key, value]) => [key, value.count])
        )
      },
      relations
    };

    window.tmProductKkPostflightResult = data;
    console.table([data.checks]);
    console.log(PREFIX, 'Полный результат: window.tmProductKkPostflightResult');
    if (differences.length) {
      console.warn(PREFIX, 'RU поля отличаются от preflight:', differences);
    }
    if (ru.status === 'modified') {
      console.warn(PREFIX, 'RU status = modified. Проверить перед следующим write.');
    }
    download(data);
    console.log(PREFIX, 'Готово: JSON скачан. Данные не изменялись.');
  } catch (error) {
    console.error(PREFIX, error);
  }
})();
