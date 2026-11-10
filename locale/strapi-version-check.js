// Проверка версии установленного Strapi через подтверждённый Admin API.
// Только GET /admin/information. Никаких изменений в CMS.
// Открой Strapi Admin на нужном сервере, вставь скрипт в Console.
// В отчёт включён адрес сервера: это защищает от смешивания DEV/PROD.
(async () => {
  'use strict';

  const PREFIX = '[locale/strapi-version-check]';
  const raw = localStorage.getItem('jwtToken');
  let token;
  try { token = JSON.parse(raw); } catch { token = raw; }
  if (typeof token !== 'string' || !token.trim()) {
    console.error(PREFIX, 'Не обнаружен jwtToken активной Strapi Admin-сессии.');
    return;
  }

  try {
    const response = await fetch('/admin/information', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer ' + token
      }
    });
    if (!response.ok) throw new Error('HTTP ' + response.status + ' у /admin/information');

    const json = await response.json();
    const data = json?.data;
    if (!data || typeof data.strapiVersion !== 'string') {
      throw new Error('В ответе отсутствует ожидаемое data.strapiVersion.');
    }

    const report = {
      tool: 'strapi-version-check',
      readOnly: true,
      checkedAt: new Date().toISOString(),
      adminOrigin: location.origin,
      strapiVersion: data.strapiVersion,
      nodeVersion: typeof data.nodeVersion === 'string' ? data.nodeVersion : null,
      currentEnvironment: typeof data.currentEnvironment === 'string'
        ? data.currentEnvironment : null
    };

    console.table([report]);
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'strapi-version-check.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    console.log(PREFIX, 'Готово. Версия получена без изменений в CMS.');
  } catch (error) {
    console.error(PREFIX, error);
  }
})();
