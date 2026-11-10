// Диагностика схемы i18n и состояния RU/KK для пилотного товара DIOR.
// Только GET, не меняет локализации, черновики, связи или Content-Type Builder.
// Запускать из Console на карточке Product loeqjcvawiaajxsyld5g3jqc в Strapi Admin.
(async () => {
  'use strict';

  const PREFIX = '[locale/product-i18n-schema-audit]';
  const UID = 'api::product.product';
  const DOCUMENT_ID = 'loeqjcvawiaajxsyld5g3jqc';
  const FIELDS_TO_REVIEW = [
    'name', 'xml_id', 'code_1c', 'sort', 'active',
    'key', 'newFrom1C', 'InStock', 'name1',
    'name2', 'preview_text', 'detail_text',
    'attributes', 'brand', 'categories', 'preview_picture'
  ];
  const AFFECTED_IN_PREVIOUS_TEST = ['name', 'code_1c', 'xml_id', 'sort', 'active'];

  const match = location.pathname.match(
    /^\/admin\/content-manager\/collection-types\/api::product\.product\/([a-z0-9]+)\/?$/i
  );
  if (!match || match[1] !== DOCUMENT_ID) {
    console.error(PREFIX, 'Открой пилотный Product ' + DOCUMENT_ID);
    return;
  }

  const tokenSource = localStorage.getItem('jwtToken');
  let token;
  try { token = JSON.parse(tokenSource); } catch { token = tokenSource; }
  if (typeof token !== 'string' || !token.trim()) {
    console.error(PREFIX, 'Не найдена действующая сессия Strapi Admin.');
    return;
  }

  async function get(path) {
    const response = await fetch(path, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + token }
    });
    if (!response.ok) {
      throw new Error('GET HTTP ' + response.status + ' — ' + path);
    }
    const json = await response.json();
    if (!json || typeof json !== 'object') throw new Error('Неожиданный JSON: ' + path);
    return json;
  }

  function download(filename, obj) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], {
      type: 'application/json;charset=utf-8'
    }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  try {
    console.log(PREFIX, 'Чтение схемы Content Manager и обеих локализаций');
    const base = '/content-manager/collection-types/' + UID + '/' + DOCUMENT_ID;
    const [schemasResponse, ruResponse, kkResponse] = await Promise.all([
      get('/content-manager/content-types'),
      get(base + '?locale=ru'),
      get(base + '?locale=kk')
    ]);

    if (!Array.isArray(schemasResponse?.data)) {
      throw new Error('Content Manager вернул неожиданную структуру схем.');
    }
    const schema = schemasResponse.data.find(item => item?.uid === UID);
    if (!schema || !schema.attributes || typeof schema.attributes !== 'object') {
      throw new Error('В ответе /content-manager/content-types нет схемы ' + UID);
    }
    const ru = ruResponse?.data;
    const kk = kkResponse?.data;
    if (!ru || ru.documentId !== DOCUMENT_ID || ru.locale !== 'ru') {
      throw new Error('RU-карточка не подтверждена.');
    }
    if (!kk || kk.documentId !== DOCUMENT_ID || kk.locale !== 'kk') {
      throw new Error('KK-карточка не подтверждена.');
    }

    const fields = Object.fromEntries(
      Object.entries(schema.attributes).map(([name, attr]) => {
        // undefined не приравниваем к false: сохраняем как unknown.
        const localized = attr?.pluginOptions?.i18n?.localized;
        const localization = localized === true ? 'localized'
          : localized === false ? 'shared'
          : 'not-explicit';
        return [name, {
          type: attr?.type ?? null,
          localization,
          required: attr?.required === true,
          unique: attr?.unique === true,
          target: attr?.target ?? null,
          relation: attr?.relation ?? null
        }];
      })
    );

    const review = FIELDS_TO_REVIEW.map(name => ({
      name,
      localization: fields[name]?.localization ?? 'field-not-found',
      type: fields[name]?.type ?? null,
      affectedInPreviousTest: AFFECTED_IN_PREVIOUS_TEST.includes(name),
      ruValue: ru[name] !== undefined && (ru[name] === null || ['string', 'number', 'boolean'].includes(typeof ru[name]))
        ? ru[name] : undefined,
      kkValue: kk[name] !== undefined && (kk[name] === null || ['string', 'number', 'boolean'].includes(typeof kk[name]))
        ? kk[name] : undefined
    }));

    const report = {
      tool: 'product-i18n-schema-audit',
      readOnly: true,
      checkedAt: new Date().toISOString(),
      uid: UID,
      documentId: DOCUMENT_ID,
      note: 'localization=not-explicit означает, что в schema.pluginOptions.i18n.localized нет true/false; не угадывать семантику.',
      schema: {
        localizedContentType: schema.pluginOptions?.i18n?.localized ?? null,
        draftAndPublish: schema.options?.draftAndPublish ?? null,
        fields
      },
      recordState: {
        ru: {
          id: ru.id,
          locale: ru.locale,
          status: ru.status ?? null,
          updatedAt: ru.updatedAt ?? null
        },
        kk: {
          id: kk.id,
          locale: kk.locale,
          status: kk.status ?? null,
          updatedAt: kk.updatedAt ?? null
        }
      },
      previousTestAffectedFields: AFFECTED_IN_PREVIOUS_TEST,
      review
    };

    window.tmProductI18nSchemaAuditReport = report;
    console.table(review.map(({ name, localization, type, affectedInPreviousTest }) => ({
      name, localization, type, affectedInPreviousTest
    })));
    console.log(PREFIX, 'Схема и состояние: window.tmProductI18nSchemaAuditReport');
    download('product-i18n-schema-audit-' + DOCUMENT_ID + '.json', report);
    console.log(PREFIX, 'Готово. Выполнены только GET-запросы.');
  } catch (error) {
    console.error(PREFIX, error);
  }
})();
