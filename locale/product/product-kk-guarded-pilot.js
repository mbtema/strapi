// Strapi 5.13 — контролируемое создание одной KK-локали Product.
// Запуск: открыть RU-карточку Product в Strapi Admin, вставить этот файл в Console.
// Сначала только GET + экспорт снимка и плана. PUT — только по явному нажатию кнопки.
// Важно: поддерживает RU published и modified (черновик с тестовыми значениями).
// Снимки RU draft и published и их relations сохраняются отдельно.
// Один PUT только по подтверждению; автоматического rollback нет.
// Любое изменение статуса RU или updatedAt Published — отдельный флаг риска.
(async () => {
  'use strict';

  const PREFIX = '[locale/product-kk-guarded-pilot]';
  const UID = 'api::product.product';
  const SOURCE = 'ru';
  const TARGET = 'kk';
  const ROOT_ID = 'tm-product-kk-guarded-pilot';
  const STORE_KEY = '__tmProductKkGuardedPilot';

  const pathMatch = location.pathname.match(
    /^\/admin\/content-manager\/collection-types\/api::product\.product\/([a-z0-9]+)\/?$/i
  );
  if (!pathMatch) {
    console.error(PREFIX, 'Открой карточку Product в Strapi Admin, не список.');
    return;
  }
  const documentId = pathMatch[1];
  const localeInUrl = new URLSearchParams(location.search).get('plugins[i18n][locale]');
  if (localeInUrl && localeInUrl !== SOURCE) {
    console.error(PREFIX, 'Открой RU-локаль Product. Сейчас: ' + localeInUrl);
    return;
  }

  const raw = localStorage.getItem('jwtToken');
  let token;
  try { token = JSON.parse(raw); } catch { token = raw; }
  if (typeof token !== 'string' || !token.trim()) {
    console.error(PREFIX, 'Не найдена действующая Admin-сессия (jwtToken).');
    return;
  }

  // Повторное выполнение очищает только собственную панель.
  document.getElementById(ROOT_ID)?.remove();
  const previous = window[STORE_KEY];
  if (previous?.running) {
    console.warn(PREFIX, 'Предыдущая проверка или запись ещё выполняется.');
    return;
  }
  const state = { running: false, preflight: null, lastReport: null };
  window[STORE_KEY] = state;

  function el(tag, text, props = {}) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    for (const [name, value] of Object.entries(props)) {
      node.style[name] = value;
    }
    return node;
  }
  const panel = el('section', null, {
    position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483600',
    width: 'min(460px, calc(100vw - 32px))', maxHeight: '70vh',
    overflow: 'auto', background: '#1b1b2c', color: '#fff',
    border: '1px solid #656590', borderRadius: '9px',
    padding: '15px', font: '13px/1.45 system-ui, sans-serif',
    boxShadow: '0 12px 35px rgba(0,0,0,.35)'
  });
  const header = el('div', null, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: '8px', marginBottom: '8px'
  });
  header.append(el('strong', 'KK — один товар, защищённый пилот'));
  const closeBtn = el('button', '×', {
    cursor: 'pointer', color: 'white', background: 'transparent',
    border: '0', fontSize: '22px', lineHeight: '1'
  });
  closeBtn.type = 'button';
  closeBtn.title = 'Закрыть панель';
  closeBtn.onclick = () => panel.remove();
  header.append(closeBtn);
  panel.append(header);
  panel.append(el('div', 'documentId: ' + documentId, {
    fontFamily: 'monospace', overflowWrap: 'anywhere', color: '#b8b8d8',
    marginBottom: '8px'
  }));
  const status = el('div', 'Читаем схему, RU и KK. Записей пока нет.', {
    whiteSpace: 'pre-wrap', marginBottom: '10px'
  });
  panel.append(status);
  const actions = el('div', null, { display: 'flex', flexWrap: 'wrap', gap: '8px' });
  panel.append(actions);
  const readBtn = el('button', 'Повторить проверку');
  const writeBtn = el('button', 'Создать один KK draft');
  for (const button of [readBtn, writeBtn]) {
    button.type = 'button';
    Object.assign(button.style, {
      borderRadius: '6px', padding: '7px 10px',
      border: '1px solid #656590', color: 'white', cursor: 'pointer',
      background: '#323250'
    });
    actions.append(button);
  }
  writeBtn.disabled = true;
  writeBtn.style.opacity = '.45';
  document.body.append(panel);

  function show(message, error = false) {
    status.textContent = message;
    status.style.color = error ? '#ff9b9b' : '#e5e5f6';
    console[error ? 'error' : 'log'](PREFIX, message);
  }
  function download(prefix, report) {
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = prefix + '-' + documentId + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      const output = {};
      for (const key of Object.keys(value).sort()) output[key] = canonical(value[key]);
      return output;
    }
    return value;
  }
  const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const SYSTEM_FIELDS = new Set([
    'id', 'documentId', 'locale', 'status', 'publishedAt',
    'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'localizations'
  ]);
  const SIMPLE_TYPES = new Set([
    'string', 'text', 'richtext', 'email', 'password', 'enumeration', 'json',
    'integer', 'biginteger', 'float', 'decimal', 'boolean',
    'date', 'time', 'datetime'
  ]);

  async function request(method, path, body) {
    const response = await fetch(path, {
      method, credentials: 'include', cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer ' + token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    return {
      ok: response.ok, status: response.status,
      body: json, message: !response.ok ? String(json?.error?.message || text).slice(0, 400) : null
    };
  }
  async function mustGet(path) {
    const response = await request('GET', path);
    if (!response.ok) {
      throw new Error('GET HTTP ' + response.status + ': ' + path + ' — ' + response.message);
    }
    return response.body;
  }
  const detailPath = locale =>
    '/content-manager/collection-types/' + UID + '/' +
    encodeURIComponent(documentId) + '?locale=' + encodeURIComponent(locale);

  function getMissingState(response) {
    const data = response.body?.data;
    if (response.status === 404) return 'missing';
    if (response.ok && data && typeof data === 'object' &&
        !Array.isArray(data) && Object.keys(data).length === 0) return 'missing';
    if (response.ok && data?.documentId === documentId && data?.locale === TARGET)
      return 'exists';
    return 'unverified';
  }

  function buildFields(schema, ru) {
    const fields = {};
    const valuesForPut = {};
    const blockers = [];
    const warnings = [];
    const requiredMissing = [];
    let candidateCount = 0;
    for (const [name, attr] of Object.entries(schema.attributes)) {
      const type = attr?.type;
      if (SYSTEM_FIELDS.has(name)) continue;
      const relation = type === 'relation';
      const localized = attr?.pluginOptions?.i18n?.localized === true ||
        relation || type === 'uid';
      fields[name] = {
        type: type ?? null, localized,
        shared: !localized,
        required: attr?.required === true,
        unique: attr?.unique === true
      };
      if (localized) continue;
      candidateCount++;

      if (!Object.prototype.hasOwnProperty.call(ru, name)) {
        blockers.push(name + ': значение отсутствует в RU-ответе (не null)');
        continue;
      }
      const value = ru[name];
      if (value === undefined) {
        blockers.push(name + ': undefined в RU-ответе');
        continue;
      }
      if (attr?.required && (value === null ||
          (typeof value === 'string' && value.trim() === ''))) {
        requiredMissing.push(name);
      }
      if (value === null) {
        valuesForPut[name] = null;
      } else if (SIMPLE_TYPES.has(type)) {
        // Скалярные и JSON-поля передаём без изменения значений.
        if (type !== 'json' && typeof value === 'object') {
          blockers.push(name + ': скалярное поле пришло как объект');
          continue;
        }
        valuesForPut[name] = value;
      } else if (type === 'media') {
        const mediaId = entry => {
          if (Number.isInteger(entry) && entry > 0) return entry;
          if (entry && typeof entry === 'object' &&
              Number.isInteger(entry.id) && entry.id > 0) return entry.id;
          return null;
        };
        if (Array.isArray(value)) {
          const ids = value.map(mediaId);
          if (ids.some(id => id === null)) {
            blockers.push(name + ': у media нет ID в RU-ответе');
          } else {
            valuesForPut[name] = ids;
            if (ids.length) warnings.push(name + ': media(' + ids.length + ')');
          }
        } else {
          const id = mediaId(value);
          if (id === null) blockers.push(name + ': у media нет ID');
          else {
            valuesForPut[name] = id;
            warnings.push(name + ': media ID ' + id);
          }
        }
      } else if (type === 'component' || type === 'dynamiczone') {
        if (Array.isArray(value) && value.length === 0) {
          valuesForPut[name] = [];
        } else {
          // Непустые вложенные компоненты требуют отдельной адаптации:
          // нельзя терять их ID, media или relations при преобразовании.
          blockers.push(name + ': non-localized ' + type +
            ' содержит данные или нетипичное значение');
        }
      } else {
        blockers.push(name + ': неизвестный тип "' + String(type) + '"');
      }
    }
    if (requiredMissing.length) {
      blockers.push('Обязательные общие поля пусты: ' + requiredMissing.join(', '));
    }
    // На Strapi 5.13 значениями общих полей управляет i18n middleware.
    // Пробел в name1 — только локализуемая заглушка для создания draft.
    return {
      fields, blockers, warnings, candidateCount,
      payload: { ...valuesForPut, name1: ' ' }
    };
  }

  function stableFields(ru, schema) {
    const output = {};
    for (const [name] of Object.entries(schema.attributes)) {
      if (SYSTEM_FIELDS.has(name)) continue;
      output[name] = Object.prototype.hasOwnProperty.call(ru, name)
        ? ru[name] : { __missing: true };
    }
    return canonical(output);
  }

  function relationFields(schema) {
    return Object.entries(schema.attributes)
      .filter(([, attr]) =>
        attr?.type === 'relation' &&
        typeof attr.target === 'string' && attr.target.startsWith('api::')
      )
      .map(([name]) => name);
  }

  async function fetchRelations(locale, names, status = null) {
    const report = {};
    // Последовательный обход: не перегружаем Admin API.
    for (const name of names) {
      const ids = [];
      let total = 0;
      let page = 1;
      while (true) {
        const path = '/content-manager/relations/' + UID + '/' +
          encodeURIComponent(documentId) + '/' + encodeURIComponent(name) +
          '?locale=' + encodeURIComponent(locale) +
          (status ? '&status=' + encodeURIComponent(status) : '') +
          '&page=' + page + '&pageSize=100';
        const json = await mustGet(path);
        if (!Array.isArray(json?.results) ||
            !Number.isInteger(json?.pagination?.total)) {
          throw new Error('Неожиданная структура relation ' + name + ', locale=' + locale);
        }
        total = json.pagination.total;
        for (const item of json.results) {
          const ref = item?.documentId ?? item?.id;
          if (ref == null) {
            throw new Error('Отсутствует идентификатор relation ' + name);
          }
          ids.push(String(ref));
        }
        if (ids.length >= total) break;
        if (json.results.length === 0 || page >= 50) {
          throw new Error('Не удалось прочитать relation целиком: ' + name);
        }
        page++;
      }
      report[name] = { total, ids: ids.sort() };
    }
    return report;
  }

  async function readSnapshot(schema) {
    const [ruResponse, publishedRuResponse, kkResponse] = await Promise.all([
      request('GET', detailPath(SOURCE)),
      request('GET', detailPath(SOURCE) + '&status=published'),
      request('GET', detailPath(TARGET))
    ]);
    if (!ruResponse.ok ||
        ruResponse.body?.data?.documentId !== documentId ||
        ruResponse.body?.data?.locale !== SOURCE) {
      throw new Error('Не удалось подтвердить RU detail: HTTP ' + ruResponse.status);
    }
    if (!publishedRuResponse.ok ||
        publishedRuResponse.body?.data?.documentId !== documentId ||
        publishedRuResponse.body?.data?.locale !== SOURCE ||
        publishedRuResponse.body?.data?.publishedAt == null) {
      throw new Error('Не удалось подтвердить опубликованную RU-версию: HTTP ' +
        publishedRuResponse.status);
    }
    const stateKk = getMissingState(kkResponse);
    const ru = ruResponse.body.data;
    const publishedRu = publishedRuResponse.body.data;
    const names = relationFields(schema);
    const [ruRelations, publishedRuRelations] = await Promise.all([
      fetchRelations(SOURCE, names),
      fetchRelations(SOURCE, names, 'published')
    ]);
    return {
      ru, publishedRu, kkState: stateKk,
      kk: stateKk === 'exists' ? kkResponse.body.data : null,
      ruRelations, publishedRuRelations,
      ruBusiness: stableFields(ru, schema),
      publishedRuBusiness: stableFields(publishedRu, schema),
      relationFieldCount: names.length
    };
  }

  function businessDiff(before, after) {
    return Object.keys(before).filter(name => !equal(before[name], after[name]))
      .map(name => ({
        field: name,
        before: before[name],
        after: after[name]
      }));
  }

  async function prepare() {
    if (state.running) return;
    state.running = true;
    readBtn.disabled = true;
    writeBtn.disabled = true;
    writeBtn.style.opacity = '.45';
    state.preflight = null;
    show('Проверка: схема → RU/KK → все relation-поля.');
    try {
      const allSchemas = await mustGet('/content-manager/content-types');
      const schema = allSchemas?.data?.find(item => item?.uid === UID);
      if (!schema?.attributes || schema.pluginOptions?.i18n?.localized !== true) {
        throw new Error('Схема Product не подтверждена как i18n.');
      }
      const snapshot = await readSnapshot(schema);
      const plan = buildFields(schema, snapshot.ru);
      const blockers = [...plan.blockers];
      if (snapshot.kkState !== 'missing') {
        blockers.push('KK сейчас: ' + snapshot.kkState + '. Создавать нельзя.');
      }
      if (!['published', 'modified'].includes(snapshot.ru.status)) {
        blockers.push('Статус RU draft не поддерживается: ' + snapshot.ru.status);
      }
      // На тесте с рыбой RU draft может отличаться от Published.
      // Сохраняем обе версии и никогда не публикуем RU автоматически.

      const report = {
        tool: 'product-kk-guarded-pilot',
        phase: 'preflight',
        readOnly: true,
        checkedAt: new Date().toISOString(),
        adminOrigin: location.origin,
        uid: UID, documentId,
        sourceLocale: SOURCE, targetLocale: TARGET,
        ruId: snapshot.ru.id,
        ruStatus: snapshot.ru.status,
        ruPublishedId: snapshot.publishedRu.id,
        ruPublishedAt: snapshot.publishedRu.publishedAt,
        kkState: snapshot.kkState,
        relationFieldCount: snapshot.relationFieldCount,
        sharedFieldCount: plan.candidateCount,
        payload: plan.payload,
        blockers,
        warnings: plan.warnings,
        before: {
          ru: snapshot.ru,
          ruBusiness: snapshot.ruBusiness,
          ruRelations: snapshot.ruRelations,
          publishedRu: snapshot.publishedRu,
          publishedRuBusiness: snapshot.publishedRuBusiness,
          publishedRuRelations: snapshot.publishedRuRelations
        }
      };
      state.preflight = { schema, snapshot, plan, report };
      state.lastReport = report;
      window.tmProductKkGuardedPilotReport = report;
      download('product-kk-preflight-safe', report);
      console.table({
        documentId, kk: snapshot.kkState,
        shared: plan.candidateCount,
        relations: snapshot.relationFieldCount,
        blockers: blockers.length
      });
      if (blockers.length) {
        show('Создание ЗАБЛОКИРОВАНО.\n' +
          blockers.slice(0, 8).join('\n') +
          (blockers.length > 8 ? '\n… ещё ' + (blockers.length - 8) : '') +
          '\nJSON-снимок скачан.', true);
      } else {
        show('Снимки RU Draft и Published + все relations сохранены в JSON.\n' +
          'KK отсутствует. Общих полей в payload: ' + plan.candidateCount +
          '. Relations не передаются.\n' +
          'Предупреждений: ' + plan.warnings.length +
          '. Можно выполнить ОДИН контролируемый PUT после проверки JSON.');
        writeBtn.disabled = false;
        writeBtn.style.opacity = '1';
      }
    } catch (error) {
      show('Ошибка безопасной проверки: ' + String(error.message || error), true);
    } finally {
      state.running = false;
      readBtn.disabled = false;
    }
  }

  async function createOne() {
    if (state.running || !state.preflight) return;
    const { schema, snapshot, plan, report } = state.preflight;
    if (report.blockers.length) return;
    const approved = confirm(
      'Создать ТОЛЬКО ОДНУ KK-локализацию у товара\n' + documentId +
      '\n\nСнимки RU Draft и Published скачаны. PUT всё равно может затронуть RU из-за бага Strapi 5.13.' +
      '\nПродолжить?'
    );
    if (!approved) return;

    state.running = true;
    writeBtn.disabled = true;
    writeBtn.style.opacity = '.45';
    readBtn.disabled = true;
    show('Перепроверяем RU и отсутствие KK непосредственно перед записью…');

    let mutationAttempted = false;
    let writeResult = null;
    let errors = [];
    let before = snapshot;
    try {
      const fresh = await readSnapshot(schema);
      if (fresh.kkState !== 'missing') {
        throw new Error('KK появилась после preflight — запись отменена.');
      }
      if (fresh.ru.id !== snapshot.ru.id ||
          !equal(fresh.ruBusiness, snapshot.ruBusiness) ||
          !equal(fresh.ruRelations, snapshot.ruRelations) ||
          fresh.ru.status !== snapshot.ru.status ||
          fresh.publishedRu.id !== snapshot.publishedRu.id ||
          fresh.publishedRu.publishedAt !== snapshot.publishedRu.publishedAt ||
          !equal(fresh.publishedRuBusiness, snapshot.publishedRuBusiness) ||
          !equal(fresh.publishedRuRelations, snapshot.publishedRuRelations)) {
        throw new Error('RU изменилась после preflight — запись отменена.');
      }
      const freshPlan = buildFields(schema, fresh.ru);
      if (freshPlan.blockers.length || !equal(freshPlan.payload, plan.payload)) {
        throw new Error('План изменился или есть неподдержанные поля — запись отменена.');
      }
      before = fresh;
      // Повторный экспорт прямо перед PUT, включая relations.
      download('product-kk-before-write', {
        tool: 'product-kk-guarded-pilot', phase: 'before-write',
        at: new Date().toISOString(), documentId, ru: fresh.ru,
        ruBusiness: fresh.ruBusiness, ruRelations: fresh.ruRelations,
        publishedRu: fresh.publishedRu,
        publishedRuBusiness: fresh.publishedRuBusiness,
        publishedRuRelations: fresh.publishedRuRelations,
        payload: freshPlan.payload
      });

      show('Выполняется один PUT ?locale=kk. После него будет полная сверка RU…');
      mutationAttempted = true;
      writeResult = await request('PUT', detailPath(TARGET), freshPlan.payload);
      if (!writeResult.ok) {
        errors.push('PUT HTTP ' + writeResult.status + ': ' + writeResult.message);
      }
    } catch (error) {
      errors.push(String(error.message || error));
    }

    let after = null;
    let differences = [];
    let relationDifferences = [];
    let publishedDifferences = [];
    let publishedRelationDifferences = [];
    let kkRelations = null;
    // Даже после HTTP-ошибки проверяем RU: write мог частично сработать.
    if (mutationAttempted) {
      try {
        show('Чтение RU, KK и всех relations после PUT…');
        after = await readSnapshot(schema);
        differences = businessDiff(before.ruBusiness, after.ruBusiness);
        relationDifferences = businessDiff(before.ruRelations, after.ruRelations);
        publishedDifferences = businessDiff(
          before.publishedRuBusiness, after.publishedRuBusiness
        );
        publishedRelationDifferences = businessDiff(
          before.publishedRuRelations, after.publishedRuRelations
        );
        if (after.kkState === 'exists') {
          kkRelations = await fetchRelations(TARGET, relationFields(schema));
        }
      } catch (error) {
        errors.push('Не удалось выполнить postflight: ' + String(error.message || error));
      }
    }

    const unsafe = mutationAttempted && (
      !after ||
      differences.length > 0 ||
      relationDifferences.length > 0 ||
      publishedDifferences.length > 0 ||
      publishedRelationDifferences.length > 0 ||
      after.publishedRu.id !== before.publishedRu.id ||
      after.publishedRu.publishedAt !== before.publishedRu.publishedAt ||
      after.ru.status !== before.ru.status ||
      after.ru.publishedAt !== before.ru.publishedAt ||
      after.publishedRu.updatedAt !== before.publishedRu.updatedAt ||
      after.kkState !== 'exists' ||
      after.kk?.status !== 'draft' ||
      (kkRelations && Object.values(kkRelations).some(item => item.total !== 0))
    );
    const success = mutationAttempted && writeResult?.ok === true &&
      errors.length === 0 && !unsafe;
    const result = {
      tool: 'product-kk-guarded-pilot',
      phase: 'postflight',
      createdAt: new Date().toISOString(),
      adminOrigin: location.origin,
      uid: UID, documentId,
      attemptedWrite: mutationAttempted,
      putHttpStatus: writeResult?.status ?? null,
      success,
      sourceRu: {
        beforeId: before.ru.id,
        afterId: after?.ru?.id ?? null,
        beforeStatus: before.ru.status,
        afterStatus: after?.ru?.status ?? null,
        statusChanged: after ? before.ru.status !== after.ru.status : null,
        beforeUpdatedAt: before.ru.updatedAt,
        afterUpdatedAt: after?.ru?.updatedAt ?? null,
        updatedAtChanged: after ? before.ru.updatedAt !== after.ru.updatedAt : null,
        beforePublishedAt: before.ru.publishedAt,
        afterPublishedAt: after?.ru?.publishedAt ?? null,
        businessDifferences: differences,
        relationDifferences
      },
      publishedRu: {
        beforeId: before.publishedRu.id,
        afterId: after?.publishedRu?.id ?? null,
        beforePublishedAt: before.publishedRu.publishedAt,
        afterPublishedAt: after?.publishedRu?.publishedAt ?? null,
        beforeUpdatedAt: before.publishedRu.updatedAt,
        afterUpdatedAt: after?.publishedRu?.updatedAt ?? null,
        businessDifferences: publishedDifferences,
        relationDifferences: publishedRelationDifferences
      },
      targetKk: {
        state: after?.kkState ?? 'unknown',
        id: after?.kk?.id ?? null,
        status: after?.kk?.status ?? null,
        relationCounts: kkRelations
          ? Object.fromEntries(
            Object.entries(kkRelations).map(([name, rel]) => [name, rel.total])
          ) : null
      },
      errors,
      before: {
        ru: before.ru,
        ruBusiness: before.ruBusiness,
        ruRelations: before.ruRelations,
        publishedRu: before.publishedRu,
        publishedRuBusiness: before.publishedRuBusiness,
        publishedRuRelations: before.publishedRuRelations
      },
      after: after ? {
        ru: after.ru,
        ruBusiness: after.ruBusiness,
        ruRelations: after.ruRelations,
        publishedRu: after.publishedRu,
        publishedRuBusiness: after.publishedRuBusiness,
        publishedRuRelations: after.publishedRuRelations,
        kk: after.kk,
        kkRelations
      } : null
    };
    state.lastReport = result;
    window.tmProductKkGuardedPilotReport = result;
    download('product-kk-postflight-safe', result);

    if (success) {
      show('ПРОВЕРКА ПРОЙДЕНА: один KK draft создан.\n' +
        'Сверка RU Draft и Published пройдена, включая статусы и связи.\n' +
        'Новый массовый запуск НЕ разрешён — нужен отдельный этап.');
    } else if (mutationAttempted) {
      show('ПРОВЕРКА НЕ ПРОЙДЕНА. Возможна порча RU!\n' +
        'Отличий RU по полям: ' + differences.length +
        ', по relations: ' + relationDifferences.length +
        ', опубликованная RU: ' + publishedDifferences.length +
        ', опубликованные relations: ' + publishedRelationDifferences.length +
        ', статус RU: ' + before.ru.status + ' → ' + (after?.ru?.status ?? '?') +
        '. Ошибок: ' + errors.length +
        '. Не публикуй RU и не создавай другие KK. Смотри скачанный JSON.', true);
      console.error(PREFIX, result);
    } else {
      show('Запись НЕ выполнялась: ' + errors.join(' | '), true);
    }
    state.running = false;
    readBtn.disabled = false;
  }

  readBtn.onclick = () => { void prepare(); };
  writeBtn.onclick = () => { void createOne(); };
  await prepare();
})();