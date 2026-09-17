(() => {
  'use strict';

  const RAW_BASE =
    'https://raw.githubusercontent.com/mbtema/strapi/main/parsers/';

  const MANIFEST_FILE = 'manifest.json';
  const OVERLAY_ID = 'tm-parser-launcher-overlay';
  const PARSER_FILE_RE = /^[a-z0-9-]+\.js$/;
  const ACTIVE_RUNS_KEY = '__tmParserLauncherActiveRuns';

  const PARSER_GROUPS = [
    { id: 'products', title: 'Товары' },
    { id: 'offers', title: 'Предложения' },
    { id: 'attributes', title: 'Shade / Volume' },
    { id: 'drafts', title: 'Drafts' }
  ];

  const KNOWN_GROUP_IDS = new Set(PARSER_GROUPS.map(group => group.id));
  const ALLOWED_GROUP_IDS = new Set([...KNOWN_GROUP_IDS, 'service']);
  const activeRuns = window[ACTIVE_RUNS_KEY] instanceof Set
    ? window[ACTIVE_RUNS_KEY]
    : new Set();

  window[ACTIVE_RUNS_KEY] = activeRuns;

  async function loadText(file) {
    const response = await fetch(`${RAW_BASE}${file}?t=${Date.now()}`, {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`GitHub вернул HTTP ${response.status}`);
    }

    return response.text();
  }

  async function loadManifest() {
    const text = await loadText(MANIFEST_FILE);
    const manifest = JSON.parse(text);

    if (
      !manifest ||
      manifest.schemaVersion !== 1 ||
      !Array.isArray(manifest.parsers)
    ) {
      throw new Error('Некорректный manifest.json');
    }

    const files = new Set();

    return manifest.parsers.map((parser, index) => {
      const label = `parsers[${index}]`;

      if (!parser || typeof parser !== 'object' || Array.isArray(parser)) {
        throw new Error(`${label}: запись должна быть объектом`);
      }

      if (typeof parser.name !== 'string' || !parser.name.trim()) {
        throw new Error(`${label}: name должен быть непустой строкой`);
      }

      if (typeof parser.file !== 'string' || !parser.file.trim()) {
        throw new Error(`${label}: file должен быть непустой строкой`);
      }

      if (typeof parser.group !== 'string' || !parser.group.trim()) {
        throw new Error(`${label}: group должен быть непустой строкой`);
      }

      const normalized = {
        name: parser.name.trim(),
        file: parser.file.trim(),
        group: parser.group.trim().toLowerCase()
      };

      if (!PARSER_FILE_RE.test(normalized.file)) {
        throw new Error(`${label}: некорректное имя файла ${normalized.file}`);
      }

      if (!ALLOWED_GROUP_IDS.has(normalized.group)) {
        throw new Error(`${label}: неизвестная группа ${normalized.group}`);
      }

      if (files.has(normalized.file)) {
        throw new Error(`${label}: duplicate file ${normalized.file}`);
      }

      files.add(normalized.file);
      return normalized;
    });
  }

  function managedParserCode(code, file) {
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
          '[Parser Launcher] Временная ошибка ' + response.status +
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
          '[Parser Launcher] Network error, повтор ' +
          (attempt + 1) + '/' + maxAttempts,
          error
        );
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    }

    throw lastError || new Error('Parser request failed');
  };
`;

    return `${prefix}(async () => {\n  try {${fetchWrapper}${body}\n  } finally {\n    window.${ACTIVE_RUNS_KEY}?.delete(${fileLiteral});\n  }\n})();${suffix}`;
  }

  function executeParser(code, file) {
    const managed = managedParserCode(code, file);
    const script = document.createElement('script');
    script.textContent = `${managed || code}\n//# sourceURL=parser-launcher/${file}`;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
    return Boolean(managed);
  }

  async function runParser(parser, status) {
    if (activeRuns.has(parser.file)) {
      status.textContent = `Уже запущен: ${parser.file}`;
      status.style.color = '#d9822b';
      return;
    }

    activeRuns.add(parser.file);
    status.textContent = `Загрузка: ${parser.file}`;
    status.style.color = '#c7c7d4';

    try {
      const code = await loadText(parser.file);
      const managed = executeParser(code, parser.file);

      if (!managed) {
        activeRuns.delete(parser.file);
        console.warn(
          `[Parser Launcher] ${parser.file}: async IIFE не найден, lock снят сразу после запуска`
        );
      }

      console.log(`[Parser Launcher] Запущен: ${parser.file}`);
      closeLauncher();
    } catch (error) {
      activeRuns.delete(parser.file);
      console.error('[Parser Launcher]', error);
      status.textContent = `Ошибка: ${error.message}`;
      status.style.color = '#d02b20';
    }
  }

  function closeLauncher() {
    document.getElementById(OVERLAY_ID)?.remove();
  }

  function createButton(parser, status) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = activeRuns.has(parser.file)
      ? `${parser.file} · запущен`
      : parser.file;
    button.title = parser.name;
    button.disabled = activeRuns.has(parser.file);

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

    button.addEventListener('click', () => runParser(parser, status));
    return button;
  }

  function createSection(titleText, parsers, status) {
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

    for (const parser of parsers) {
      list.appendChild(createButton(parser, status));
    }

    section.append(title, list);
    return section;
  }

  function splitParsers(parsers) {
    const grouped = PARSER_GROUPS.map(group => ({
      ...group,
      parsers: parsers.filter(parser => parser.group === group.id)
    }));

    const service = parsers.filter(parser => parser.group === 'service');

    return { grouped, service };
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

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
      marginBottom: '16px'
    });

    const title = document.createElement('strong');
    title.textContent = 'Parser Launcher';
    title.style.fontSize = '16px';

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Закрыть');

    Object.assign(close.style, {
      width: '30px',
      height: '30px',
      padding: '0',
      border: '0',
      background: 'transparent',
      color: '#c7c7d4',
      fontSize: '24px',
      lineHeight: '1',
      cursor: 'pointer'
    });

    close.addEventListener('click', closeLauncher);
    header.append(title, close);

    const grid = document.createElement('div');
    Object.assign(grid.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gap: '14px',
      alignItems: 'start'
    });

    const serviceWrap = document.createElement('div');
    serviceWrap.style.marginTop = '14px';

    const status = document.createElement('div');
    status.textContent = 'Загрузка списка парсеров...';
    Object.assign(status.style, {
      minHeight: '18px',
      marginTop: '14px',
      color: '#a5a5ba',
      fontSize: '12px'
    });

    panel.append(header, grid, serviceWrap, status);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeLauncher();
    });

    try {
      const parsers = await loadManifest();

      if (!document.body.contains(overlay)) return;
      if (!parsers.length) throw new Error('В manifest.json нет парсеров');

      const { grouped, service } = splitParsers(parsers);

      for (const group of grouped) {
        if (!group.parsers.length) continue;
        grid.appendChild(createSection(group.title, group.parsers, status));
      }

      if (service.length) {
        serviceWrap.appendChild(
          createSection('Сервис', service, status)
        );
      }

      status.textContent = 'Alt+P — открыть / закрыть';
    } catch (error) {
      console.error('[Parser Launcher]', error);
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