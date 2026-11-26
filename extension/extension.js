// ==UserScript==
// @name         strapi-extensions
// @version      1.6.0
// @description  Загружает и обновляет рабочие Strapi extensions из GitHub manifests
// @match        http://10.10.3.80:1337/admin/*
// @match        https://strapi.monamie.kz/admin/*
// @updateURL    https://raw.githubusercontent.com/mbtema/strapi/main/extension/extension.js
// @downloadURL  https://raw.githubusercontent.com/mbtema/strapi/main/extension/extension.js
// @run-at       document-start
// @connect      raw.githubusercontent.com
// @connect      api.github.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_info
// @grant        unsafeWindow
// ==/UserScript==

(() => {
  'use strict';

  const RAW_ROOT = 'https://raw.githubusercontent.com/mbtema/strapi/';
  const API_ROOT = 'https://api.github.com/repos/mbtema/strapi/';
  const SHA_RE = /^[0-9a-f]{40}$/;
  const CACHE_KEY = 'tm-strapi-extensions-cache-v1';
  const LOADER_ATTR = 'data-tm-strapi-extensions-loader';
  const EXTENSION_ID_RE = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/i;
  const MANIFEST_PATH_RE = /^manifests\/[a-z0-9-]+\.json$/i;
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
        nocache: true,
        headers: { 'Cache-Control': 'no-cache' },
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

  function checkLoaderVersion(source) {
    const localVersion = String(
      typeof GM_info !== 'undefined' ? GM_info.script.version : ''
    ).trim();

    if (!VERSION_RE.test(localVersion)) {
      throw new Error('Cannot determine installed loader version');
    }

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
      manifest.schemaVersion !== 1 ||
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
      throw new Error(`${sourcePath || 'extensions manifest'}: invalid extensions manifest`);
    }

    const items = [];
    const ids = new Set();
    const paths = new Set();

    manifest.extensions.forEach((item, index) => {
      if (item?.enabled !== true) return;

      const id = String(item.id || '').trim();
      const path = String(item.path || '').trim();
      const version = String(item.version || '').trim();
      const label = `${sourcePath || 'extensions manifest'} extensions[${index}]`;

      if (!EXTENSION_ID_RE.test(id)) {
        throw new Error(`${label}: invalid id`);
      }
      if (!VERSION_RE.test(version)) {
        throw new Error(`${label}: invalid version for ${id}`);
      }
      if (!EXTENSION_PATH_RE.test(path)) {
        throw new Error(`${label}: invalid path for ${id}`);
      }
      if (path.split('/').slice(1).join('/') !== `${id}.js`) {
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

  async function getHead() {
    const data = parseJson(await requestText(API_ROOT + 'git/ref/heads/main'), 'main ref');
    const commit = data?.object?.sha;
    if (data?.ref !== 'refs/heads/main' || data?.object?.type !== 'commit' || !SHA_RE.test(commit || '')) {
      throw new Error('Invalid main commit');
    }
    return commit;
  }

  async function getSnapshot(commit) {
    const data = parseJson(await requestText(API_ROOT + 'git/trees/' + commit + '?recursive=1'), 'commit tree');
    if (data?.truncated !== false || !Array.isArray(data.tree)) {
      throw new Error('Incomplete commit tree: ' + commit);
    }
    const files = new Map(data.tree.filter(item => item.type === 'blob' &&
      SHA_RE.test(item.sha || '') && Number.isSafeInteger(item.size) && item.size >= 0)
      .map(item => [item.path, item]));
    return { commit, files };
  }

  function gitBlobSha(source) {
    const encoder = new TextEncoder();
    const body = encoder.encode(source);
    const header = encoder.encode('blob ' + body.length + '\0');
    const length = header.length + body.length;
    const bytes = new Uint8Array(Math.ceil((length + 9) / 64) * 64);
    bytes.set(header);
    bytes.set(body, header.length);
    bytes[length] = 128;
    const view = new DataView(bytes.buffer);
    view.setUint32(bytes.length - 8, Math.floor(length / 0x20000000));
    view.setUint32(bytes.length - 4, (length * 8) >>> 0);
    const words = new Uint32Array(80);
    const rol = (value, shift) => (value << shift) | (value >>> (32 - shift));
    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    for (let offset = 0; offset < bytes.length; offset += 64) {
      for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
      for (let i = 16; i < 80; i++) words[i] = rol(words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16], 1);
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        let f, k;
        if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
        else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
        else { f = b ^ c ^ d; k = 0xca62c1d6; }
        const t = (rol(a, 5) + f + e + k + words[i]) >>> 0;
        e = d; d = c; c = rol(b, 30); b = a; a = t;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    return [h0, h1, h2, h3, h4].map(value => value.toString(16).padStart(8, '0')).join('');
  }

  function snapshotEntry(snapshot, path) {
    const entry = snapshot.files.get('extension/' + path);
    if (!entry) throw new Error('File missing at ' + snapshot.commit + ': ' + path);
    return entry;
  }

  async function snapshotText(snapshot, path) {
    const entry = snapshotEntry(snapshot, path);
    const source = await requestText(RAW_ROOT + snapshot.commit + '/extension/' + path);
    if (gitBlobSha(source) !== entry.sha) throw new Error('Git blob SHA mismatch: ' + path);
    return source;
  }

  async function loadManifest(snapshot) {
    const root = parseJson(await snapshotText(snapshot, 'manifests/extensions.json'), 'manifests/extensions.json');
    const manifestPaths = normalizeRootManifest(root);
    const groups = await Promise.all(manifestPaths.map(async path =>
      normalizeExtensionsManifest(parseJson(await snapshotText(snapshot, path), path), path)
    ));
    return validateCombinedManifest(groups.flat()).map(item => ({
      ...item,
      blobSha: snapshotEntry(snapshot, item.path).sha
    }));
  }

  function getSignature(items) {
    return JSON.stringify(
      items.map(({ id, path, version, blobSha }) => ({ id, path, version, blobSha }))
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
      cached.version === expected.version &&
      SHA_RE.test(expected.blobSha || '') &&
      cached.blobSha === expected.blobSha &&
      gitBlobSha(cached.code) === expected.blobSha
    );
  }

  function isCacheCurrent(cache, manifest, signature) {
    if (
      !cache ||
      cache.schemaVersion !== 2 ||
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
    const force = options.force === true;
    const commit = await getHead();
    if (!force && currentCache?.schemaVersion === 2 && currentCache.commit === commit &&
        Array.isArray(currentCache.extensions) &&
        isCacheCurrent(currentCache, currentCache.extensions, getSignature(currentCache.extensions))) {
      return { updated: false, commit, manifest: currentCache.extensions.map(({ code, ...item }) => item),
        updatedItems: [], removedItems: [] };
    }
    const snapshot = await getSnapshot(commit);
    const manifest = await loadManifest(snapshot);
    const signature = getSignature(manifest);
    const loader = force ? checkLoaderVersion(await snapshotText(snapshot, 'extension.js')) : null;

    const cachedById = new Map(
      (currentCache?.extensions || [])
        .filter(isRunnableItem)
        .map(item => [item.id, item])
    );

    const manifestIds = new Set(manifest.map(item => item.id));

    const updatedItems = manifest
      .filter(item => force || !matchesManifestItem(cachedById.get(item.id), item))
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
        if (!force && matchesManifestItem(cached, item)) return cached;

        const code = await snapshotText(snapshot, item.path);
        if (!code.trim()) throw new Error('Empty extension source: ' + item.path);

        return { ...item, code };
      })
    );

    const nextCache = {
      schemaVersion: 2,
      commit,
      signature,
      updatedAt: new Date().toISOString(),
      extensions
    };

    const latestCache = readCache();
    if (JSON.stringify(latestCache) !== JSON.stringify(currentCache) && latestCache?.commit !== commit) {
      throw new Error('Cache changed in another tab. Update was not applied.');
    }
    writeCache(nextCache);

    const hadRunnableCache = Boolean(
      currentCache?.extensions?.some(isRunnableItem)
    );

    if (!silent) {
      if (!hadRunnableCache) {
        runExtensions(extensions);
        announceRunning(nextCache);
      } else {
        console.log('[Extensions] Update cached. Reload Strapi to apply it.');
      }
    }

    return {
      updated: true,
      commit,
      loader,
      manifest,
      updatedItems,
      removedItems
    };
  }

  function announceRunning(cache) {
    const commit = cache?.commit || 'unverified legacy cache';
    document.documentElement?.setAttribute('data-tm-extensions-commit', commit);
    console.info('[Extensions] Running commit: ' + commit);
    console.table((cache?.extensions || []).map(({ id, version, blobSha }) => ({ id, version, blobSha: blobSha || null })));
  }

  let forceUpdatePromise = null;

  async function forceUpdateNow() {
    if (forceUpdatePromise) return forceUpdatePromise;
    forceUpdatePromise = (async () => {
      console.info('[Extensions] Downloading verified main snapshot...');
      try {
        await startupRefresh;
        const result = await refreshCache(readCache(), { silent: true, force: true });
        console.info('[Extensions] Verified commit ' + result.commit + ' (' + result.manifest.length + ' extensions)');
        console.table(result.manifest.map(({ id, version, blobSha }) => ({ id, version, blobSha })));
        if (result.loader?.updateAvailable) {
          console.warn('[Extensions] Update userscript in Tampermonkey: ' + result.loader.localVersion + ' → ' + result.loader.remoteVersion);
        }
        location.reload();
        return { ...result, failed: false };
      } catch (error) {
        console.error('[Extensions] Force update failed. Previous cache retained.', error);
        return { failed: true, error: error.message };
      }
    })().finally(() => {
      forceUpdatePromise = null;
    });
    return forceUpdatePromise;
  }

  const cache = readCache();

  if (cache?.extensions?.length) {
    runExtensions(cache.extensions);
    announceRunning(cache);
  }

  const startupRefresh = refreshCache(cache).catch(error => {
    if (cache?.extensions?.some(isRunnableItem)) {
      console.warn('[Extensions] GitHub unavailable or manifest invalid, using cache', error);
      return;
    }

    console.error('[Extensions] Failed to load extensions', error);
  });

  unsafeWindow.forceUpdate = () => forceUpdateNow();
})();
