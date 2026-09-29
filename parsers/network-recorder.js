(async () => {
  'use strict';

  const STATE_KEY = '__tmNetworkRecorderState';
  const MAX_REQUESTS = 200;
  const MAX_BODY_BYTES = 200 * 1024;
  const STOP_WAIT_MS = 5000;
  const UNAVAILABLE = '[UNAVAILABLE]';
  const BINARY = '[BINARY]';
  const TRUNCATED = '\n[TRUNCATED]';

  const existing = window[STATE_KEY];

  if (existing?.active) {
    await stopRecorder(existing);
    return;
  }

  startRecorder();

  function startRecorder() {
    const nativeFetch = window.fetch;
    const xhrPrototype = XMLHttpRequest.prototype;
    const nativeXhrOpen = xhrPrototype.open;
    const nativeXhrSend = xhrPrototype.send;

    const state = {
      active: true,
      accepting: true,
      pageUrl: location.href,
      startedAt: new Date().toISOString(),
      records: [],
      pending: new Set(),
      xhrMeta: new WeakMap(),
      limitWarned: false,
      nativeFetch,
      nativeXhrOpen,
      nativeXhrSend,
      fetchWrapper: null,
      xhrOpenWrapper: null,
      xhrSendWrapper: null
    };

    state.fetchWrapper = function networkRecorderFetch(input, init) {
      const target = getFetchTarget(input, init);

      if (!state.accepting || !target || !isTrackedUrl(target.url)) {
        return state.nativeFetch.call(this, input, init);
      }

      const record = createRecord(state, target.method, target.url);
      if (!record) return state.nativeFetch.call(this, input, init);

      const started = performance.now();
      const requestBodyPromise = readFetchRequestBody(input, init)
        .catch(() => UNAVAILABLE);
      const nativePromise = state.nativeFetch.call(this, input, init);

      return nativePromise.then(
        response => {
          record.status = response.status;
          record.duration = roundMs(performance.now() - started);

          let responseBodyPromise;
          try {
            responseBodyPromise = readFetchResponse(response.clone())
              .catch(() => UNAVAILABLE);
          } catch {
            responseBodyPromise = Promise.resolve(UNAVAILABLE);
          }

          trackPending(state, (async () => {
            try {
              record.requestBody = await requestBodyPromise;
              record.responseBody = await responseBodyPromise;
            } finally {
              record.done = true;
            }
          })());

          return response;
        },
        error => {
          trackPending(state, (async () => {
            try {
              record.requestBody = await requestBodyPromise;
              record.status = null;
              record.duration = roundMs(performance.now() - started);
              record.responseBody = UNAVAILABLE;
            } finally {
              record.done = true;
            }
          })());

          throw error;
        }
      );
    };

    state.xhrOpenWrapper = function networkRecorderXhrOpen(method, url) {
      const resolved = resolveUrl(url);
      state.xhrMeta.set(this, {
        method: String(method || 'GET').toUpperCase(),
        url: resolved?.href || String(url || '')
      });
      return state.nativeXhrOpen.apply(this, arguments);
    };

    state.xhrSendWrapper = function networkRecorderXhrSend(body) {
      const meta = state.xhrMeta.get(this);

      if (!state.accepting || !meta || !isTrackedUrl(meta.url)) {
        return state.nativeXhrSend.apply(this, arguments);
      }

      const record = createRecord(state, meta.method, meta.url);
      if (!record) return state.nativeXhrSend.apply(this, arguments);

      const xhr = this;
      const started = performance.now();
      const requestBodyPromise = serializeBody(body).catch(() => UNAVAILABLE);

      let resolveFinished;
      const finished = new Promise(resolve => {
        resolveFinished = resolve;
      });
      trackPending(state, finished);

      const finalize = async () => {
        try {
          record.requestBody = await requestBodyPromise;
          record.status = Number.isFinite(xhr.status) ? xhr.status : null;
          record.duration = roundMs(performance.now() - started);

          try {
            record.responseBody = await readXhrResponse(xhr);
          } catch {
            record.responseBody = UNAVAILABLE;
          }
        } finally {
          record.done = true;
          resolveFinished();
        }
      };

      xhr.addEventListener('loadend', finalize, { once: true });

      try {
        return state.nativeXhrSend.apply(this, arguments);
      } catch (error) {
        record.requestBody = UNAVAILABLE;
        record.status = null;
        record.duration = roundMs(performance.now() - started);
        record.responseBody = UNAVAILABLE;
        record.done = true;
        resolveFinished();
        throw error;
      }
    };

    window[STATE_KEY] = state;
    window.fetch = state.fetchWrapper;
    xhrPrototype.open = state.xhrOpenWrapper;
    xhrPrototype.send = state.xhrSendWrapper;

    console.log('[network-recorder] Запись началась');
  }

  async function stopRecorder(state) {
    state.accepting = false;
    state.active = false;
    restoreNative(state);

    await Promise.race([
      Promise.allSettled(Array.from(state.pending)),
      delay(STOP_WAIT_MS)
    ]);

    const stoppedAt = new Date().toISOString();
    const requests = state.records.map(toOutputRecord);
    delete window[STATE_KEY];

    if (!requests.length) {
      console.log('[network-recorder] Запросов не найдено');
      return;
    }

    const dump = {
      pageUrl: state.pageUrl,
      startedAt: state.startedAt,
      stoppedAt,
      requestCount: requests.length,
      requests
    };

    const text = JSON.stringify(dump, null, 2);
    let copied = false;

    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      downloadJson(text, 'network-recorder.json');
    }

    console.log(
      `[network-recorder] Запись остановлена: ${requests.length} requests` +
      (copied ? ' | JSON скопирован в буфер' : ' | JSON скачан файлом')
    );
  }

  function restoreNative(state) {
    if (window.fetch === state.fetchWrapper) {
      window.fetch = state.nativeFetch;
    }

    const prototype = XMLHttpRequest.prototype;
    if (prototype.open === state.xhrOpenWrapper) {
      prototype.open = state.nativeXhrOpen;
    }
    if (prototype.send === state.xhrSendWrapper) {
      prototype.send = state.nativeXhrSend;
    }
  }

  function createRecord(state, method, url) {
    if (state.records.length >= MAX_REQUESTS) {
      if (!state.limitWarned) {
        state.limitWarned = true;
        console.warn(`[network-recorder] Достигнут лимит ${MAX_REQUESTS} requests`);
      }
      return null;
    }

    const record = {
      index: state.records.length + 1,
      startedAt: new Date().toISOString(),
      method: String(method || 'GET').toUpperCase(),
      url,
      status: null,
      duration: null,
      requestBody: null,
      responseBody: UNAVAILABLE,
      done: false
    };

    state.records.push(record);
    return record;
  }

  function toOutputRecord(record) {
    return {
      index: record.index,
      startedAt: record.startedAt,
      method: record.method,
      url: record.url,
      status: record.status,
      duration: record.duration,
      requestBody: record.requestBody,
      responseBody: record.responseBody
    };
  }

  function trackPending(state, promise) {
    state.pending.add(promise);
    promise.finally(() => state.pending.delete(promise));
  }

  function getFetchTarget(input, init) {
    const rawUrl = typeof input === 'string' || input instanceof URL
      ? String(input)
      : input?.url;
    const url = resolveUrl(rawUrl);
    if (!url) return null;

    const method = init?.method || input?.method || 'GET';
    return {
      method: String(method).toUpperCase(),
      url: url.href
    };
  }

  function resolveUrl(value) {
    try {
      return new URL(String(value || ''), location.href);
    } catch {
      return null;
    }
  }

  function isTrackedUrl(value) {
    const url = value instanceof URL ? value : resolveUrl(value);
    if (!url || url.origin !== location.origin) return false;

    const path = url.pathname;
    return path === '/api' ||
      path.startsWith('/api/') ||
      path === '/content-manager' ||
      path.startsWith('/content-manager/') ||
      path === '/upload' ||
      path.startsWith('/upload/');
  }

  async function readFetchRequestBody(input, init) {
    if (init && Object.prototype.hasOwnProperty.call(init, 'body')) {
      return serializeBody(init.body, getContentType(init.headers));
    }

    if (!(input instanceof Request)) return null;
    if (['GET', 'HEAD'].includes(String(input.method || 'GET').toUpperCase())) return null;

    const clone = input.clone();
    const contentType = clone.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      try {
        return serializeFormData(await clone.formData());
      } catch {
        return UNAVAILABLE;
      }
    }

    if (isBinaryContentType(contentType)) return BINARY;
    return parseTextBody(await clone.text(), contentType);
  }

  async function serializeBody(body, contentType = '') {
    if (body == null) return null;

    if (body instanceof FormData) {
      return serializeFormData(body);
    }

    if (body instanceof URLSearchParams) {
      return parseTextBody(body.toString(), contentType || 'application/x-www-form-urlencoded');
    }

    if (body instanceof File) {
      return fileInfo(body);
    }

    if (body instanceof Blob) {
      return {
        type: body.type || '',
        size: body.size
      };
    }

    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
      return BINARY;
    }

    if (typeof body === 'string') {
      return parseTextBody(body, contentType);
    }

    if (typeof body === 'object') {
      return limitJsonValue(body);
    }

    return limitText(String(body));
  }

  function serializeFormData(formData) {
    const result = {};

    for (const [key, value] of formData.entries()) {
      const next = value instanceof File
        ? fileInfo(value)
        : value instanceof Blob
          ? { type: value.type || '', size: value.size }
          : limitText(String(value));

      if (!Object.prototype.hasOwnProperty.call(result, key)) {
        result[key] = next;
      } else if (Array.isArray(result[key])) {
        result[key].push(next);
      } else {
        result[key] = [result[key], next];
      }
    }

    return limitJsonValue(result);
  }

  function fileInfo(file) {
    return {
      name: file.name || '',
      type: file.type || '',
      size: file.size
    };
  }

  async function readFetchResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    if (isBinaryContentType(contentType)) return BINARY;
    return parseTextBody(await response.text(), contentType);
  }

  async function readXhrResponse(xhr) {
    const contentType = xhr.getResponseHeader('content-type') || '';
    const responseType = xhr.responseType || '';

    if (responseType === 'blob' || responseType === 'arraybuffer') return BINARY;
    if (isBinaryContentType(contentType)) return BINARY;

    if (responseType === 'json') {
      return limitJsonValue(xhr.response);
    }

    if (responseType === '' || responseType === 'text') {
      return parseTextBody(xhr.responseText || '', contentType);
    }

    return UNAVAILABLE;
  }

  function parseTextBody(text, contentType = '') {
    if (!text) return null;

    const limited = limitText(text);
    if (typeof limited !== 'string' || limited.endsWith(TRUNCATED)) return limited;

    const looksJson = /(?:application|text)\/(?:[\w.+-]*\+)?json/i.test(contentType) ||
      /^[\s\r\n]*[\[{]/.test(limited);

    if (!looksJson) return limited;

    try {
      return JSON.parse(limited);
    } catch {
      return limited;
    }
  }

  function limitJsonValue(value) {
    if (value == null) return value;

    try {
      const text = JSON.stringify(value);
      if (byteLength(text) <= MAX_BODY_BYTES) {
        return JSON.parse(text);
      }
      return limitText(text);
    } catch {
      return UNAVAILABLE;
    }
  }

  function limitText(value) {
    const text = String(value ?? '');
    if (byteLength(text) <= MAX_BODY_BYTES) return text;

    let low = 0;
    let high = Math.min(text.length, MAX_BODY_BYTES);

    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (byteLength(text.slice(0, mid)) <= MAX_BODY_BYTES) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }

    return text.slice(0, low) + TRUNCATED;
  }

  function byteLength(value) {
    return new TextEncoder().encode(value).length;
  }

  function getContentType(headersInit) {
    try {
      return new Headers(headersInit || {}).get('content-type') || '';
    } catch {
      return '';
    }
  }

  function isBinaryContentType(contentType) {
    const type = String(contentType || '').toLowerCase();
    if (!type) return false;

    return type.startsWith('image/') ||
      type.startsWith('audio/') ||
      type.startsWith('video/') ||
      type.startsWith('font/') ||
      type.includes('application/octet-stream') ||
      type.includes('application/pdf') ||
      type.includes('application/zip') ||
      type.includes('application/x-zip');
  }

  function roundMs(value) {
    return Math.round(value * 10) / 10;
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function downloadJson(text, filename) {
    const url = URL.createObjectURL(
      new Blob([text], { type: 'application/json;charset=utf-8' })
    );
    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: filename
    });

    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
})();
