// ==StrapiExtension==
// @name         parser-launcher
// @version      1.4.6
// @description  Запускает парсеры из GitHub по Alt+P
// ==/StrapiExtension==

(() => {
  'use strict';

  const RAW_BASE =
    'https://raw.githubusercontent.com/mbtema/strapi/main/parsers/';

  const MANIFEST_FILE = 'manifest.json';
  const OVERLAY_ID = 'tm-parser-launcher-overlay';
  const PARSER_FILE_RE = /^[a-z0-9-]+\.js$/;

  const PARSER_GROUPS = [
    {
      id: 'products',
      title: 'Товары',
      files: [
        'products-without-attributes.js',
        'products-without-brand.js',
        'products-without-categories.js',
        'products-with-wrong-prices.js',
        'products-with-missing-content.js',
        'products-with-wrong-variants.js'
      ]
    },
    {
      id: 'offers',
      title: 'Предложения',
      files: [
        'attributes-without-product.js'
      ]
    },
    {
      id: 'attributes',
      title: 'Shade / Volume',
      files: [
        'missing-shades.js',
        'shade-and-volume.js',
        'sort-volume.js',
        'volume-checker.js'
      ]
    }
  ];

  const SERVICE_FILES = new Set([
    'dom-stealer.js'
  ]);

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

    return manifest.parsers
      .filter(parser =>
        parser &&
        typeof parser.name === 'string' &&
        typeof parser.file === 'string'
      )
      .map(parser => ({
        name: parser.name.trim(),
        file: parser.file.trim()
      }))
      .filter(parser =>
        parser.name.length > 0 &&
        PARSER_FILE_RE.test(parser.file)
      );
  }

  function executeParser(code, file) {
    const script = document.createElement('script');
    script.textContent = `${code}\n//# sourceURL=parser-launcher/${file}`;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  async function runParser(parser, status) {
    status.textContent = `Загрузка: ${parser.file}`;
    status.style.color = '#c7c7d4';

    try {
      const code = await loadText(parser.file);
      executeParser(code, parser.file);
      console.log(`[Parser Launcher] Запущен: ${parser.file}`);
      closeLauncher();
    } catch (error) {
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
    button.textContent = parser.file;
    button.title = parser.name;

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
      cursor: 'pointer',
      transition: 'background 120ms ease, border-color 120ms ease'
    });

    button.addEventListener('mouseenter', () => {
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
    const byFile = new Map(parsers.map(parser => [parser.file, parser]));
    const grouped = PARSER_GROUPS.map(group => ({
      ...group,
      parsers: group.files
        .map(file => byFile.get(file))
        .filter(Boolean)
    }));

    const knownFiles = new Set(
      PARSER_GROUPS.flatMap(group => group.files)
    );

    const service = [];

    for (const parser of parsers) {
      if (knownFiles.has(parser.file)) continue;
      if (SERVICE_FILES.has(parser.file)) {
        service.push(parser);
        continue;
      }
      service.push(parser);
    }

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
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
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
