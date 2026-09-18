// ==UserScript==
// @name         strapi-extensions
// @version      1.3.1
// @description  Загружает и обновляет рабочие Strapi extensions из GitHub manifests
// @match        http://10.10.3.80:1337/admin/*
// @updateURL    https://raw.githubusercontent.com/mbtema/strapi/main/extension/loader.js
// @downloadURL  https://raw.githubusercontent.com/mbtema/strapi/main/extension/loader.js
// @run-at       document-start
// @connect      raw.githubusercontent.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_info
// @grant        unsafeWindow
// ==/UserScript==

(() => {
  'use strict';

  const RAW_ROOT = 'https://raw.githubusercontent.com/mbtema/strapi/main/';
  const LOADER_URL = `${RAW_ROOT}extension/loader.js`;
  const MANIFEST_URL = `${RAW_ROOT}extension/manifest.json`;
  const CACHE_KEY = 'tm-strapi-extensions-cache-v1';
  const LOADER_ATTR = 'data-tm-strapi-extensions-loader';
  const EXTENSION_ID_RE = /^[a-z0-9-]+$/i;
  const MANIFEST_PATH_RE = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*\/manifest\.json$/i;
  const EXTENSION_PATH_RE = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*\/[a-z0-9-]+\.js$/i;
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

  function parseJson(text, label) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${label}: invalid JSON`);
    }
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


  function compareVersions(left, right) {
    const a = left.split('.').map(Number);
    const b = right.split('.').map(Number);

    for (let index = 0; index < 3; index += 1) {
      if (a[index] > b[index]) return 1;
      if (a[index] < b[index]) return -1;
    }

    return 0;
  }

  async function checkLoaderVersion() {
    const localVersion = String(
      typeof GM_info !== 'undefined' ? GM_info.script.version : ''
    ).trim();

    if (!VERSION_RE.test(localVersion)) {
      throw new Error('Cannot determine installed loader version');
    }

    const source = await requestText(LOADER_URL);
    const match = source.match(/^\/\/ @version\s+(\d+\.\d+\.\d+)\s*$/m);

    if (!match) {
      throw new Error('Cannot determine repository loader version');
    }

    const remoteVersion = match[1];
    const comparison = compareVersions(remoteVersion, localVersion);

    return {
      localVersion,
      remoteVersion,
      updateAvailable: comparison > 0,
      localAhead: comparison < 0
    };
  }

  function normalizeRootManifest(manifest) {
    if (
      !manifest ||
      manifest.schemaVersion !== 2 ||
      !Array.isArray(manifest.manifests) ||
      manifest.manifests.length === 0
    ) {
      throw new Error('Invalid root extensions manifest');
    }

    const paths = [];
    const seen = new Set();

    manifest.manifests.forEach((value, index) => {
      const path = String(value || '').trim();
      const label = `manifests[${index}]`;

      if (!MANIFEST_PATH_RE.test(path)) {
        throw new Error(`${label}: invalid manifest path`);
      }
      if (seen.has(path)) {
        throw new Error(`${label}: duplicate manifest path ${path}`);
      }

      seen.add(path);
      paths.push(path);
    });

    return paths;
  }

  function normalizeExtensionsManifest(manifest, sourcePath = '') {
    if (
      !manifest ||
      manifest.schemaVersion !== 1 ||
      !Array.isArray(manifest.extensions)
    ) {
      throw new Error(`${sourcePath || 'extension/manifest.json'}: invalid extensions manifest`);
    }

    const sourceDir = sourcePath.includes('/')
      ? sourcePath.slice(0, sourcePath.lastIndexOf('/'))
      : '';

    const items = [];
    const ids = new Set();
    const paths = new Set();

    manifest.extensions.forEach((item, index) => {
      if (item?.enabled !== true) return;

      const id = String(item.id || '').trim();
      const path = String(item.path || '').trim();
      const version = String(item.version || '').trim();
      const label = `${sourcePath || 'extension/manifest.json'} extensions[${index}]`;

      if (!EXTENSION_ID_RE.test(id)) {
        throw new Error(`${label}: invalid id`);
      }
      if (!VERSION_RE.test(version)) {
        throw new Error(`${label}: invalid version for ${id}`);
      }
      if (!EXTENSION_PATH_RE.test(path)) {
        throw new Error(`${label}: invalid path for ${id}`);
      }
      if (sourceDir && !path.startsWith(`${sourceDir}/`)) {
        throw new Error(`${label}: path must stay inside ${sourceDir}/`);
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

  function validateCombinedManifest(items) {
    const ids = new Set();
    const paths = new Set();

    items.forEach((item, index) => {
      if (ids.has(item.id)) {
        throw new Error(`extensions[${index}]: duplicate id ${item.id} across manifests`);
      }
      if (paths.has(item.path)) {
        throw new Error(`extensions[${index}]: duplicate path ${item.path} across manifests`);
      }

      ids.add(item.id);
      paths.add(item.path);
    });

    return items;
  }

  async function loadManifest() {
    const rootText = await requestText(MANIFEST_URL);
    const root = parseJson(rootText, 'extension/manifest.json');

    const manifestPaths = normalizeRootManifest(root);

    const groups = await Promise.all(
      manifestPaths.map(async path => {
        const text = await requestText(`${RAW_ROOT}${path}`);
        const manifest = parseJson(text, path);
        return normalizeExtensionsManifest(manifest, path);
      })
    );

    return validateCombinedManifest(groups.flat());
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


  async function refreshCache(currentCache, options = {}) {
    const silent = options.silent === true;
    const manifest = await loadManifest();
    const signature = getSignature(manifest);

    if (isCacheCurrent(currentCache, manifest, signature)) {
      return {
        updated: false,
        manifest,
        updatedItems: [],
        removedItems: []
      };
    }

    const cachedById = new Map(
      (currentCache?.extensions || [])
        .filter(isRunnableItem)
        .map(item => [item.id, item])
    );

    const manifestIds = new Set(manifest.map(item => item.id));

    const updatedItems = manifest
      .filter(item => !matchesManifestItem(cachedById.get(item.id), item))
      .map(item => ({
        id: item.id,
        from: cachedById.get(item.id)?.version || null,
        to: item.version
      }));

    const removedItems = (currentCache?.extensions || [])
      .filter(isRunnableItem)
      .filter(item => !manifestIds.has(item.id))
      .map(item => ({
        id: item.id,
        from: item.version,
        to: null
      }));

    const extensions = await Promise.all(
      manifest.map(async item => {
        const cached = cachedById.get(item.id);
        if (matchesManifestItem(cached, item)) return cached;

        return {
          ...item,
          code: await requestText(RAW_ROOT + item.path)
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

    if (!silent) {
      if (!hadRunnableCache) {
        runExtensions(extensions);
        console.log('[Extensions] Loaded ' + extensions.length + ' extensions');
      } else {
        console.log('[Extensions] Update cached. Reload Strapi to apply it.');
      }
    }

    return {
      updated: true,
      manifest,
      updatedItems,
      removedItems
    };
  }

  let manualCheckPromise = null;

  async function checkUpdatesNow() {
    if (manualCheckPromise) {
      console.info('[Extensions] Update check is already running.');
      return manualCheckPromise;
    }

    manualCheckPromise = (async () => {
      console.info('[Extensions] Checking loader and extension updates...');

      const currentCache = readCache();

      const results = await Promise.allSettled([
        checkLoaderVersion(),
        refreshCache(currentCache, { silent: true })
      ]);

      const loaderResult = results[0];
      const extensionResult = results[1];

      let loaderNeedsUpdate = false;
      let extensionsUpdated = false;
      let failed = false;

      if (loaderResult.status === 'fulfilled') {
        const info = loaderResult.value;
        loaderNeedsUpdate = info.updateAvailable;

        if (info.updateAvailable) {
          console.warn(
            '[Extensions] Loader update available: ' +
            info.localVersion +
            ' → ' +
            info.remoteVersion +
            '. Update the userscript in Tampermonkey.'
          );
        } else if (info.localAhead) {
          console.warn(
            '[Extensions] Installed loader ' +
            info.localVersion +
            ' is newer than repository version ' +
            info.remoteVersion +
            '.'
          );
        }
      } else {
        failed = true;
        console.error(
          '[Extensions] Failed to check loader version',
          loaderResult.reason
        );
      }

      if (extensionResult.status === 'fulfilled') {
        const info = extensionResult.value;
        extensionsUpdated = info.updated;

        if (info.updatedItems.length) {
          console.table(
            info.updatedItems.map(item => ({
              extension: item.id,
              cached: item.from || 'not cached',
              repository: item.to
            }))
          );
        }

        if (info.removedItems.length) {
          console.table(
            info.removedItems.map(item => ({
              extension: item.id,
              cached: item.from,
              repository: 'removed'
            }))
          );
        }

        if (info.updated) {
          console.info(
            '[Extensions] Extension updates downloaded to cache. Reload Strapi to apply them.'
          );
        }
      } else {
        failed = true;
        console.error(
          '[Extensions] Failed to check extension updates',
          extensionResult.reason
        );
      }

      if (!failed && !loaderNeedsUpdate && !extensionsUpdated) {
        console.info(
          '[Extensions] Everything is up to date: loader ' +
          loaderResult.value.localVersion +
          ', ' +
          extensionResult.value.manifest.length +
          ' extensions.'
        );
      }

      return {
        loader:
          loaderResult.status === 'fulfilled' ? loaderResult.value : null,
        extensions:
          extensionResult.status === 'fulfilled' ? extensionResult.value : null,
        failed
      };
    })().finally(() => {
      manualCheckPromise = null;
    });

    return manualCheckPromise;
  }

  unsafeWindow.checkUpdates = () => checkUpdatesNow();

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
