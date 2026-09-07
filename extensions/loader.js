// ==UserScript==
// @name         strapi-extensions
// @version      1.0.1
// @description  Загружает и обновляет рабочие Strapi extensions из GitHub manifest
// @match        http://10.10.3.80:1337/admin/*
// @updateURL    https://raw.githubusercontent.com/mbtema/strapi/main/extensions/loader.js
// @downloadURL  https://raw.githubusercontent.com/mbtema/strapi/main/extensions/loader.js
// @run-at       document-start
// @connect      raw.githubusercontent.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(() => {
  'use strict';

  const RAW_ROOT = 'https://raw.githubusercontent.com/mbtema/strapi/main/';
  const MANIFEST_URL = `${RAW_ROOT}extensions/manifest.json`;
  const CACHE_KEY = 'tm-strapi-extensions-cache-v1';
  const LOADER_ATTR = 'data-tm-strapi-extensions-loader';

  if (document.documentElement?.hasAttribute(LOADER_ATTR)) return;
  document.documentElement?.setAttribute(LOADER_ATTR, '');

  function requestText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`,
        timeout: 15000,
        onload(response) {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.responseText);
            return;
          }
          reject(new Error(`HTTP ${response.status}: ${url}`));
        },
        onerror() {
          reject(new Error(`Network error: ${url}`));
        },
        ontimeout() {
          reject(new Error(`Timeout: ${url}`));
        }
      });
    });
  }

  function readCache() {
    try {
      const raw = GM_getValue(CACHE_KEY, '');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeCache(cache) {
    GM_setValue(CACHE_KEY, JSON.stringify(cache));
  }

  function normalizeManifest(manifest) {
    if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.extensions)) {
      throw new Error('Invalid extensions manifest');
    }

    return manifest.extensions
      .filter(item => item?.enabled === true)
      .map(item => ({
        id: String(item.id || '').trim(),
        path: String(item.path || '').trim(),
        version: String(item.version || '').trim()
      }))
      .filter(item =>
        item.id &&
        item.version &&
        /^(features|ui)\/[a-z0-9-]+\.js$/i.test(item.path)
      );
  }

  function getSignature(items) {
    return JSON.stringify(items.map(({ id, path, version }) => ({ id, path, version })));
  }

  function injectExtension(item) {
    const run = () => {
      const target = document.documentElement || document.head || document.body;
      if (!target) {
        requestAnimationFrame(run);
        return;
      }

      const script = document.createElement('script');
      script.dataset.tmStrapiExtension = item.id;
      script.textContent = `${item.code}\n//# sourceURL=strapi-extension/${item.path}`;
      target.appendChild(script);
      script.remove();
    };

    run();
  }

  function runExtensions(items) {
    for (const item of items || []) {
      if (!item?.id || !item?.path || typeof item.code !== 'string') continue;

      try {
        injectExtension(item);
      } catch (error) {
        console.error(`[Extensions] Failed to run ${item.id}`, error);
      }
    }
  }

  async function refreshCache(currentCache) {
    const manifestText = await requestText(MANIFEST_URL);
    const manifest = normalizeManifest(JSON.parse(manifestText));
    const signature = getSignature(manifest);

    if (currentCache?.signature === signature && Array.isArray(currentCache.extensions)) {
      return;
    }

    const extensions = await Promise.all(
      manifest.map(async item => ({
        ...item,
        code: await requestText(`${RAW_ROOT}${item.path}`)
      }))
    );

    const nextCache = {
      schemaVersion: 1,
      signature,
      updatedAt: new Date().toISOString(),
      extensions
    };

    writeCache(nextCache);

    if (!currentCache?.extensions?.length) {
      runExtensions(extensions);
      console.log(`[Extensions] Loaded ${extensions.length} extensions`);
    } else {
      console.log('[Extensions] Update cached. Reload Strapi to apply it.');
    }
  }

  const cache = readCache();

  if (cache?.extensions?.length) {
    runExtensions(cache.extensions);
  }

  refreshCache(cache).catch(error => {
    if (cache?.extensions?.length) {
      console.warn('[Extensions] GitHub unavailable, using cache', error);
      return;
    }

    console.error('[Extensions] Failed to load extensions', error);
  });
})();
