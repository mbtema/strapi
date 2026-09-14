// ==UserScript==
// @name         strapi-extensions
// @version      1.1.2
// @description  Загружает и обновляет рабочие Strapi extensions из GitHub manifest
// @match        http://10.10.3.80:1337/admin/*
// @updateURL    https://raw.githubusercontent.com/mbtema/strapi/main/extension/loader.js
// @downloadURL  https://raw.githubusercontent.com/mbtema/strapi/main/extension/loader.js
// @run-at       document-start
// @connect      raw.githubusercontent.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(() => {
  'use strict';

  const RAW_ROOT = 'https://raw.githubusercontent.com/mbtema/strapi/main/';
  const MANIFEST_URL = `${RAW_ROOT}extension/manifest.json`;
  const CACHE_KEY = 'tm-strapi-extensions-cache-v1';
  const LOADER_ATTR = 'data-tm-strapi-extensions-loader';
  const EXTENSION_ID_RE = /^[a-z0-9-]+$/i;
  const EXTENSION_PATH_RE = /^(features|ui-ux)\/[a-z0-9-]+\.js$/i;
  const VERSION_RE = /^\d+\.\d+\.\d+$/;
  const executedIds = new Set();

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
    if (
      !manifest ||
      manifest.schemaVersion !== 1 ||
      !Array.isArray(manifest.extensions)
    ) {
      throw new Error('Invalid extensions manifest');
    }

    const items = [];
    const ids = new Set();
    const paths = new Set();

    manifest.extensions.forEach((item, index) => {
      if (item?.enabled !== true) return;

      const id = String(item.id || '').trim();
      const path = String(item.path || '').trim();
      const version = String(item.version || '').trim();
      const label = `extensions[${index}]`;

      if (!EXTENSION_ID_RE.test(id)) {
        throw new Error(`${label}: invalid id`);
      }
      if (!VERSION_RE.test(version)) {
        throw new Error(`${label}: invalid version for ${id}`);
      }
      if (!EXTENSION_PATH_RE.test(path)) {
        throw new Error(`${label}: invalid path for ${id}`);
      }
      if (path.split('/').pop() !== `${id}.js`) {
        throw new Error(`${label}: path does not match id ${id}`);
      }
      if (ids.has(id)) {
        throw new Error(`${label}: duplicate id ${id}`);
      }
      if (paths.has(path)) {
        throw new Error(`${label}: duplicate path ${path}`);
      }

      ids.add(id);
      paths.add(path);
      items.push({ id, path, version });
    });

    return items;
  }

  function getSignature(items) {
    return JSON.stringify(
      items.map(({ id, path, version }) => ({ id, path, version }))
    );
  }

  function isRunnableItem(item) {
    return Boolean(
      item?.id &&
      item?.path &&
      item?.version &&
      typeof item.code === 'string' &&
      item.code.trim()
    );
  }

  function matchesManifestItem(cached, expected) {
    return Boolean(
      isRunnableItem(cached) &&
      cached.id === expected.id &&
      cached.path === expected.path &&
      cached.version === expected.version
    );
  }

  function isCacheCurrent(cache, manifest, signature) {
    if (
      !cache ||
      cache.schemaVersion !== 1 ||
      cache.signature !== signature ||
      !Array.isArray(cache.extensions) ||
      cache.extensions.length !== manifest.length
    ) {
      return false;
    }

    const byId = new Map(cache.extensions.map(item => [item?.id, item]));
    return manifest.every(item => matchesManifestItem(byId.get(item.id), item));
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
      if (!isRunnableItem(item) || executedIds.has(item.id)) continue;
      executedIds.add(item.id);

      try {
        injectExtension(item);
      } catch (error) {
        executedIds.delete(item.id);
        console.error(`[Extensions] Failed to run ${item.id}`, error);
      }
    }
  }

  async function refreshCache(currentCache) {
    const manifestText = await requestText(MANIFEST_URL);
    const manifest = normalizeManifest(JSON.parse(manifestText));
    const signature = getSignature(manifest);

    if (isCacheCurrent(currentCache, manifest, signature)) return;

    const cachedById = new Map(
      (currentCache?.extensions || [])
        .filter(isRunnableItem)
        .map(item => [item.id, item])
    );

    const extensions = await Promise.all(
      manifest.map(async item => {
        const cached = cachedById.get(item.id);
        if (matchesManifestItem(cached, item)) return cached;

        return {
          ...item,
          code: await requestText(`${RAW_ROOT}${item.path}`)
        };
      })
    );

    const nextCache = {
      schemaVersion: 1,
      signature,
      updatedAt: new Date().toISOString(),
      extensions
    };

    writeCache(nextCache);

    const hadRunnableCache = Boolean(
      currentCache?.extensions?.some(isRunnableItem)
    );

    if (!hadRunnableCache) {
      runExtensions(extensions);
      console.log(`[Extensions] Loaded ${extensions.length} extensions`);
      return;
    }

    console.log('[Extensions] Update cached. Reload Strapi to apply it.');
  }

  const cache = readCache();

  if (cache?.extensions?.length) {
    runExtensions(cache.extensions);
  }

  refreshCache(cache).catch(error => {
    if (cache?.extensions?.some(isRunnableItem)) {
      console.warn('[Extensions] GitHub unavailable or manifest invalid, using cache', error);
      return;
    }

    console.error('[Extensions] Failed to load extensions', error);
  });
})();
