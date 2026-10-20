(() => {
  'use strict';

  const RAW_ROOT =
    'https://raw.githubusercontent.com/mbtema/strapi/main/';
  const TOOLS_BASE = `${RAW_ROOT}tools/`;
  const MANIFEST_URL = `${RAW_ROOT}manifests/tools.json`;
  const OVERLAY_ID = 'tm-tools-launcher-overlay';
  const TOOL_PATH_RE = /^(?:audits|sync|diagnostics)\/[a-z0-9-]+\.js$/;
  const VERSION_RE = /^\d+\.\d+\.\d+$/;
  const ACTIVE_RUNS_KEY = '__tmToolsLauncherActiveRuns';

  const TOOL_GROUPS = [
    { id: 'audits', title: 'audits' },
    { id: 'sync', title: 'sync' },
    { id: 'diagnostics', title: 'diagnostics' }
  ];

  const KNOWN_GROUP_IDS = new Set(TOOL_GROUPS.map(group => group.id));
  const ALLOWED_GROUP_IDS = new Set(KNOWN_GROUP_IDS);
  const activeRuns = window[ACTIVE_RUNS_KEY] instanceof Set
    ? window[ACTIVE_RUNS_KEY]
    : new Set();

  window[ACTIVE_RUNS_KEY] = activeRuns;

  async function loadText(url) {
    const response = await fetch(`${url}?t=${Date.now()}`, {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`GitHub вернул HTTP ${response.status}`);
    }

    return response.text();
  }

  async function loadManifest() {
    const text = await loadText(MANIFEST_URL);
    const manifest = JSON.parse(text);

    if (
      !manifest ||
      manifest.schemaVersion !== 1 ||
      !Array.isArray(manifest.tools)
    ) {
      throw new Error('Некорректный manifest.json');
    }

    const files = new Set();

    return manifest.tools.map((tool, index) => {
      const label = `tools[${index}]`;

      if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
        throw new Error(`${label}: запись должна быть объектом`);
      }

      if (typeof tool.file !== 'string' || !tool.file.trim()) {
        throw new Error(`${label}: file должен быть непустой строкой`);
      }

      if (typeof tool.version !== 'string' || !tool.version.trim()) {
        throw new Error(`${label}: version должен быть непустой строкой`);
      }

      if (typeof tool.group !== 'string' || !tool.group.trim()) {
        throw new Error(`${label}: group должен быть непустой строкой`);
      }

      const normalized = {
        file: tool.file.trim(),
        version: tool.version.trim(),
        group: tool.group.trim().toLowerCase()
      };

      if (!TOOL_PATH_RE.test(normalized.file)) {
        throw new Error(`${label}: некорректное имя файла ${normalized.file}`);
      }

      if (!VERSION_RE.test(normalized.version)) {
        throw new Error(`${label}: некорректная version ${normalized.version}`);
      }

      if (!ALLOWED_GROUP_IDS.has(normalized.group)) {
        throw new Error(`${label}: неизвестная группа ${normalized.group}`);
      }

      const pathGroup = normalized.file.split('/')[0];
      if (normalized.group !== pathGroup) {
        throw new Error(
          `${label}: group ${normalized.group} не совпадает с папкой ${pathGroup}`
        );
      }

      if (files.has(normalized.file)) {
        throw new Error(`${label}: duplicate file ${normalized.file}`);
      }

      files.add(normalized.file);
      return normalized;
    });
  }

  function managedToolCode(code, file) {
    const startToken = '(async () => {';
    const endToken = '})();';
    const start = code.indexOf(startToken);
    const end = code.lastIndexOf(endToken);

    if (start < 0 || end <= start) return null;

    const prefix = code.slice(0, start);
    const body = code.slice(start + startToken.length, end);
    const suffix = code.slice(end + endToken.length);
    const fileLiteral = JSON.stringify(file);

    const fetchWrapper = `
  const __tmNativeFetch = window.fetch.bind(window);
  const fetch = async (...args) => {
    const options = args[1] || {};
    const method = String(options.method || 'GET').toUpperCase();
    const maxAttempts = method === 'GET' ? 3 : 1;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await __tmNativeFetch(...args);
        const transient = response.status === 429 || response.status >= 500;

        if (!transient || attempt === maxAttempts) return response;

        const retryAfter = Number(response.headers.get('Retry-After'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 500 * attempt;

        console.warn(
          '[Tools Launcher] Временная ошибка ' + response.status +
          ', повтор ' + (attempt + 1) + '/' + maxAttempts
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      } catch (error) {
        lastError = error;

        if (attempt === maxAttempts) {
          const url = String(args[0] || '');
          throw new Error(
            'Network error после ' + maxAttempts + ' попыток: ' + url +
            ' — ' + (error?.message || error)
          );
        }

        console.warn(
          '[Tools Launcher] Network error, повтор ' +
          (attempt + 1) + '/' + maxAttempts,
          error
        );
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    }

    throw lastError || new Error('Tool request failed');
  };
`;

    return `${prefix}(async () => {\n  try {${fetchWrapper}${body}\n  } finally {\n    window.${ACTIVE_RUNS_KEY}?.delete(${fileLiteral});\n  }\n})();${suffix}`;
  }

  function executeTool(code, file) {
    const managed = managedToolCode(code, file);
    const script = document.createElement('script');
    script.textContent = `${managed || code}\n//# sourceURL=tools-launcher/${file}`;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
    return Boolean(managed);
  }

  async function runTool(tool, status) {
    if (activeRuns.has(tool.file)) {
      status.textContent = `Уже запущен: ${tool.file}`;
      status.style.display = 'block';
      status.style.color = '#d9822b';
      return;
    }

    activeRuns.add(tool.file);
    status.textContent = `Загрузка: ${tool.file}`;
    status.style.color = '#c7c7d4';

    try {
      const code = await loadText(`${TOOLS_BASE}${tool.file}`);
      const managed = executeTool(code, tool.file);

      if (!managed) {
        activeRuns.delete(tool.file);
        console.warn(
          `[Tools Launcher] ${tool.file}: async IIFE не найден, lock снят сразу после запуска`
        );
      }

      console.log(`[Tools Launcher] Запущен: ${tool.file}`);
      closeLauncher();
    } catch (error) {
      activeRuns.delete(tool.file);
      console.error('[Tools Launcher]', error);
      status.textContent = `Ошибка: ${error.message}`;
      status.style.display = 'block';
      status.style.color = '#d02b20';
    }
  }

  function closeLauncher() {
    document.getElementById(OVERLAY_ID)?.remove();
  }

  function createButton(tool, status) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = activeRuns.has(tool.file)
      ? `${tool.file} · запущен`
      : tool.file;
    button.disabled = activeRuns.has(tool.file);

    Object.assign(button.style, {
      width: '100%',
      padding: '12px 14px',
      border: '1px solid #49495f',
      borderRadius: '4px',
      background: '#212134',
      color: '#ffffff',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: '13px',
      lineHeight: '1.35',
      textAlign: 'left',
      overflowWrap: 'anywhere',
      cursor: button.disabled ? 'default' : 'pointer',
      opacity: button.disabled ? '0.55' : '1',
      transition: 'background 120ms ease, border-color 120ms ease'
    });

    button.addEventListener('mouseenter', () => {
      if (button.disabled) return;
      button.style.background = '#2b2b45';
      button.style.borderColor = '#666687';
    });

    button.addEventListener('mouseleave', () => {
      button.style.background = '#212134';
      button.style.borderColor = '#49495f';
    });

    button.addEventListener('click', () => runTool(tool, status));
    return button;
  }

  function createSection(titleText, tools, status) {
    const section = document.createElement('section');

    Object.assign(section.style, {
      minWidth: '0',
      padding: '14px',
      border: '1px solid #32324d',
      borderRadius: '6px',
      background: '#1e1e2f'
    });

    const title = document.createElement('div');
    title.textContent = titleText;

    Object.assign(title.style, {
      marginBottom: '10px',
      color: '#c7c7d4',
      fontSize: '12px',
      fontWeight: '600',
      letterSpacing: '0.02em'
    });

    const list = document.createElement('div');
    Object.assign(list.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    });

    for (const tool of tools) {
      list.appendChild(createButton(tool, status));
    }

    section.append(title, list);
    return section;
  }

  function splitTools(tools) {
    return TOOL_GROUPS.map(group => ({
      ...group,
      tools: tools.filter(tool => tool.group === group.id)
    }));
  }

  async function openLauncher() {
    if (document.getElementById(OVERLAY_ID)) {
      closeLauncher();
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;

    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      background: 'rgba(3, 3, 20, 0.58)'
    });

    const panel = document.createElement('div');

    Object.assign(panel.style, {
      width: 'min(1180px, 100%)',
      maxHeight: 'calc(100vh - 48px)',
      overflowY: 'auto',
      padding: '20px',
      boxSizing: 'border-box',
      background: '#181826',
      border: '1px solid #49495f',
      borderRadius: '6px',
      boxShadow: '0 16px 48px rgba(0, 0, 0, 0.35)',
      color: '#ffffff',
      fontFamily: 'inherit'
    });

    const grid = document.createElement('div');
    Object.assign(grid.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      gap: '14px',
      alignItems: 'start'
    });

    const status = document.createElement('div');
    Object.assign(status.style, {
      display: 'none',
      marginTop: '14px',
      color: '#a5a5ba',
      fontSize: '12px'
    });

    panel.append(grid, status);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeLauncher();
    });

    try {
      const tools = await loadManifest();

      if (!document.body.contains(overlay)) return;
      if (!tools.length) throw new Error('В manifests/tools.json нет tools');

      const grouped = splitTools(tools);

      for (const group of grouped) {
        if (!group.tools.length) continue;
        grid.appendChild(createSection(group.title, group.tools, status));
      }

      status.textContent = '';
      status.style.display = 'none';
    } catch (error) {
      console.error('[Tools Launcher]', error);
      status.textContent = `Ошибка: ${error.message}`;
      status.style.color = '#d02b20';
    }
  }

  document.addEventListener('keydown', event => {
    if (event.repeat) return;

    if (
      event.altKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      event.code === 'KeyP'
    ) {
      event.preventDefault();
      event.stopPropagation();
      openLauncher();
      return;
    }

    if (event.code === 'Escape') closeLauncher();
  }, true);
})();