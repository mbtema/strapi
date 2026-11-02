// Read-only диагностика внутреннего Strapi Content Manager detail API для Attributes.
// Запусти в Console на странице отдельного торгового предложения Strapi Admin.
// Результат: attributes-strapi-probe.json без JWT и других полей записи.
(async () => {
  'use strict';
  const CFG = { locale: 'ru', output: 'attributes-strapi-probe.json' };
  const AUTH = { jwtToken: '' };
  const LOG = '[Attributes probe]';
  const uid = 'api::attribute.attribute';
  const prefix = '/admin/content-manager/collection-types/' + uid + '/';
  if (!location.pathname.startsWith(prefix)) {
    throw Error('Открой карточку отдельного торгового предложения Strapi Admin');
  }
  if (window.__tmAttributesProbeRunning) throw Error('Диагностика уже выполняется');
  window.__tmAttributesProbeRunning = true;
  try {
    const documentId = decodeURIComponent(location.pathname.slice(prefix.length)).replace(/\/$/, '');
    if (!/^[a-z0-9]+$/i.test(documentId)) {
      throw Error('Не удаётся определить documentId из URL карточки');
    }
    let token = AUTH.jwtToken.trim();
    if (!token) {
      const stored = localStorage.getItem('jwtToken');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          token = typeof parsed === 'string' ? parsed : '';
        } catch { token = stored; }
      }
    }
    if (!token) throw Error('Нет JWT — войди в Strapi Admin или заполни AUTH.jwtToken локально');
    const path = '/content-manager/collection-types/' + uid + '/' + encodeURIComponent(documentId);
    const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };

    async function fetchDetail(status) {
      const url = path + '?' + new URLSearchParams({
        locale: CFG.locale, ...(status ? { status } : {})
      });
      const response = await fetch(url, {
        method: 'GET', credentials: 'include', headers, redirect: 'error'
      });
      if (!response.ok) {
        // Нет публикации — штатный случай. Другие ошибки не маскируем.
        if (status === 'published' && response.status === 404) {
          return { httpStatus: 404, note: 'Опубликованная версия не найдена' };
        }
        throw Error((status || 'draft') + ' GET: HTTP ' + response.status);
      }
      const body = await response.json();
      const obj = body?.data ?? body;
      const record = obj?.attributes && !obj.documentId
        ? { ...obj.attributes, id: obj.id } : obj;
      const media = record?.detail_picture;
      const payload = media && typeof media === 'object' && 'data' in media
        ? media.data : media;
      const unwrap = value => value?.attributes
        ? { ...value.attributes, id: value.id } : value;
      const item = Array.isArray(payload) ? payload.map(unwrap) : unwrap(payload);
      const summarizeMedia = value => {
        if (value == null || value === '') return null;
        if (typeof value !== 'object') return { type: typeof value, value };
        return {
          type: Array.isArray(value) ? 'array' : 'object',
          keys: Object.keys(value),
          id: value.id ?? null,
          documentId: value.documentId ?? null,
          name: value.name ?? null,
          mime: value.mime ?? null
        };
      };
      return {
        httpStatus: response.status,
        responseKeys: body && typeof body === 'object' ? Object.keys(body) : [],
        dataType: Array.isArray(obj) ? 'array' : typeof obj,
        recordKeys: record && typeof record === 'object' ? Object.keys(record) : [],
        documentId: record?.documentId ?? null,
        locale: record?.locale ?? null,
        barcode: record?.barcode ?? null,
        active: record?.active ?? null,
        activeType: typeof record?.active,
        publishedAt: record?.publishedAt ?? null,
        updatedAt: record?.updatedAt ?? null,
        detailPicturePresent: record != null && Object.hasOwn(record, 'detail_picture'),
        detailPictureShape: Array.isArray(item)
          ? item.map(summarizeMedia) : summarizeMedia(item)
      };
    }
    const data = {
      diagnostic: 'attributes-strapi-probe/v1',
      uid, expectedDocumentId: documentId, locale: CFG.locale,
      draft: await fetchDetail(null),
      published: await fetchDetail('published')
    };
    const content = JSON.stringify(data, null, 2);
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = CFG.output;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    console.log(LOG, 'Готово: ' + CFG.output);
    console.table([
      { variant: 'draft', documentId: data.draft.documentId,
        active: data.draft.active, media: JSON.stringify(data.draft.detailPictureShape) },
      { variant: 'published', documentId: data.published.documentId ?? '',
        active: data.published.active ?? '', media: JSON.stringify(data.published.detailPictureShape) }
    ]);
  } catch (error) {
    console.error(LOG, error);
  } finally {
    window.__tmAttributesProbeRunning = false;
  }
})();