// ==StrapiExtension==
// @name         list-view
// @version      1.1.1
// @description  Делает List View Content Manager компактнее, чище и удобнее
// ==/StrapiExtension==

(function () {
    'use strict';

    const STYLE_ID = 'tm-list-view-style';
    const LIST_PATH_RE = /^\/admin\/content-manager\/collection-types\/[^/]+\/?$/;

    const ATTR = {
        root: 'data-tm-list-view',
        headerShell: 'data-tm-list-view-header-shell',
        header: 'data-tm-list-view-header',
        headerMain: 'data-tm-list-view-header-main',
        back: 'data-tm-list-view-back',
        title: 'data-tm-list-view-title',
        count: 'data-tm-list-view-count',
        create: 'data-tm-list-view-create',
        toolbar: 'data-tm-list-view-toolbar',
        search: 'data-tm-list-view-search',
        filters: 'data-tm-list-view-filters',
        locale: 'data-tm-list-view-locale',
        localeCode: 'data-tm-list-view-locale-code',
        settings: 'data-tm-list-view-settings',
        tableShell: 'data-tm-list-view-table-shell',
        tableFrame: 'data-tm-list-view-table-frame',
        tableScroll: 'data-tm-list-view-table-scroll',
        table: 'data-tm-list-view-table',
        relationCount: 'data-tm-list-view-relation-count',
        localeSummary: 'data-tm-list-view-locale-summary',
        sorted: 'data-tm-list-view-sorted',
        column: 'data-tm-list-view-column'
    };

    let scheduled = false;

    function isListView() {
        return LIST_PATH_RE.test(location.pathname);
    }

    function textOf(element) {
        return (element?.textContent || '').trim();
    }

    function setMarker(element, attr, value = '') {
        if (element instanceof Element) {
            element.setAttribute(attr, value);
        }
    }

    function removeMarker(attr) {
        document.querySelectorAll(`[${attr}]`).forEach(element => {
            element.removeAttribute(attr);
        });
    }

    function clearDynamicMarkers() {
        [
            ATTR.relationCount,
            ATTR.localeSummary,
            ATTR.sorted,
            ATTR.column
        ].forEach(removeMarker);
    }

    function cleanupLegacyTopbar() {
        document.querySelectorAll('[data-tm-list-view-topbar]').forEach(element => {
            element.remove();
        });
    }

    function cleanup() {
        cleanupLegacyTopbar();
        clearDynamicMarkers();

        Object.values(ATTR).forEach(removeMarker);
    }

    function ensureStyle() {
        const oldStyle = document.getElementById(STYLE_ID);
        if (oldStyle) oldStyle.remove();

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            [${ATTR.root}] {
                --tm-list-pad: clamp(16px, 1.5vw, 24px);
            }

            [${ATTR.headerShell}] {
                height: auto !important;
                min-height: 0 !important;
            }

            [${ATTR.header}] {
                padding: 12px var(--tm-list-pad) 8px !important;
                border: 0 !important;
                box-shadow: none !important;
                background: #181826 !important;
            }

            [${ATTR.back}] {
                display: none !important;
            }

            [${ATTR.headerMain}] {
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                gap: 16px !important;
                min-height: 36px !important;
                margin: 0 !important;
            }

            [${ATTR.title}] {
                margin: 0 !important;
                color: #ffffff !important;
                font-size: 22px !important;
                font-weight: 650 !important;
                line-height: 28px !important;
                letter-spacing: -0.015em !important;
            }

            [${ATTR.count}] {
                margin: 1px 0 0 !important;
                color: #777792 !important;
                font-size: 11px !important;
                line-height: 16px !important;
            }

            [${ATTR.create}] {
                min-height: 34px !important;
                height: 34px !important;
                box-sizing: border-box !important;
                padding: 0 12px !important;
                border-radius: 6px !important;
                font-size: 0 !important;
                white-space: nowrap !important;
            }

            [${ATTR.create}]::after {
                content: 'Создать';
                font-size: 12px;
                font-weight: 600;
                line-height: 16px;
            }

            [${ATTR.toolbar}] {
                position: sticky !important;
                top: 0 !important;
                z-index: 24 !important;
                min-height: 48px !important;
                box-sizing: border-box !important;
                padding: 7px var(--tm-list-pad) !important;
                background: rgba(24, 24, 38, 0.97) !important;
                border-top: 0 !important;
                border-bottom: 1px solid #2f2f45 !important;
                box-shadow: none !important;
                backdrop-filter: blur(8px);
            }

            [${ATTR.toolbar}] button,
            [${ATTR.locale}] {
                min-height: 32px !important;
                height: 32px !important;
                box-sizing: border-box !important;
                border-radius: 6px !important;
            }

            [${ATTR.search}],
            [${ATTR.settings}] {
                width: 32px !important;
                min-width: 32px !important;
                padding: 0 !important;
            }

            [${ATTR.filters}] {
                padding-left: 10px !important;
                padding-right: 10px !important;
                font-size: 12px !important;
            }

            [${ATTR.locale}] {
                position: relative !important;
                width: 62px !important;
                min-width: 62px !important;
                padding-left: 9px !important;
                padding-right: 7px !important;
                font-size: 0 !important;
            }

            [${ATTR.locale}] > span:first-child {
                display: none !important;
            }

            [${ATTR.locale}]::before {
                content: attr(${ATTR.localeCode});
                flex: 1;
                color: #dcdce4;
                font-size: 11px;
                font-weight: 600;
                line-height: 16px;
                text-align: left;
            }

            [${ATTR.tableShell}] {
                padding: 0 var(--tm-list-pad) 28px !important;
            }

            [${ATTR.tableFrame}],
            [${ATTR.tableScroll}] {
                border: 0 !important;
                border-radius: 0 !important;
                box-shadow: none !important;
                background: transparent !important;
            }

            [${ATTR.table}] {
                width: 100% !important;
                font-size: 12px !important;
                border-collapse: separate !important;
                border-spacing: 0 !important;
            }

            [${ATTR.table}] thead {
                position: sticky;
                top: 48px;
                z-index: 14;
            }

            [${ATTR.table}] thead th {
                height: 36px !important;
                min-height: 36px !important;
                box-sizing: border-box !important;
                padding: 0 9px !important;
                background: #181826 !important;
                border-top: 0 !important;
                border-bottom: 1px solid #3a3a50 !important;
            }

            [${ATTR.table}] thead th button,
            [${ATTR.table}] thead th span {
                color: #81819b !important;
                font-size: 10px !important;
                font-weight: 650 !important;
                line-height: 14px !important;
                letter-spacing: 0.045em !important;
            }

            [${ATTR.table}] tbody td {
                height: 48px !important;
                min-height: 48px !important;
                box-sizing: border-box !important;
                padding: 6px 9px !important;
                background: transparent !important;
                border-bottom: 1px solid #2b2b3f !important;
                vertical-align: middle !important;
            }

            [${ATTR.table}] tbody tr:hover > td {
                background: #202034 !important;
            }

            [${ATTR.table}] tbody tr:hover > td:first-child {
                box-shadow: inset 2px 0 #7b79ff !important;
            }

            [${ATTR.table}] th:first-child,
            [${ATTR.table}] td:first-child {
                position: relative;
                width: 42px !important;
                min-width: 42px !important;
                padding-left: 8px !important;
                padding-right: 6px !important;
            }

            [${ATTR.table}] tbody td:first-child > a[href="#"] {
                position: absolute !important;
                top: 50% !important;
                right: -2px !important;
                width: 18px !important;
                height: 18px !important;
                margin: 0 !important;
                transform: translateY(-50%) !important;
                opacity: 0 !important;
                transition: opacity 120ms ease !important;
            }

            [${ATTR.table}] tbody tr:hover td:first-child > a[href="#"] {
                opacity: 0.34 !important;
            }

            [${ATTR.table}] tbody td img {
                width: 32px !important;
                height: 32px !important;
                max-width: 32px !important;
                max-height: 32px !important;
                object-fit: contain !important;
                border-radius: 6px !important;
            }

            [${ATTR.table}] tbody td[${ATTR.column}="name"] {
                font-weight: 550 !important;
            }

            [${ATTR.table}] tbody td[${ATTR.column}="brand"] {
                color: #c7c7d4 !important;
                font-size: 11.5px !important;
                font-weight: 600 !important;
                letter-spacing: 0.01em !important;
            }

            [${ATTR.table}] th[${ATTR.column}="detail_picture"],
            [${ATTR.table}] td[${ATTR.column}="detail_picture"] {
                text-align: center !important;
            }

            [${ATTR.table}] tbody td button:not([role="checkbox"]) {
                min-height: 26px !important;
                padding-top: 0 !important;
                padding-bottom: 0 !important;
            }

            [${ATTR.table}] button[${ATTR.relationCount}] {
                gap: 4px !important;
                padding-left: 1px !important;
                padding-right: 1px !important;
                font-size: 0 !important;
                background: transparent !important;
                border: 0 !important;
                box-shadow: none !important;
            }

            [${ATTR.table}] button[${ATTR.relationCount}] > span:first-child {
                display: none !important;
            }

            [${ATTR.table}] button[${ATTR.relationCount}]::before {
                content: attr(${ATTR.relationCount});
                min-width: 22px;
                box-sizing: border-box;
                padding: 2px 7px;
                border: 1px solid #3a3a50;
                border-radius: 999px;
                background: #242439;
                color: #dcdce4;
                font-size: 10.5px;
                font-weight: 600;
                line-height: 15px;
                text-align: center;
            }

            [${ATTR.table}] [${ATTR.localeSummary}] {
                max-width: 86px !important;
                overflow: hidden !important;
                font-size: 0 !important;
                white-space: nowrap !important;
            }

            [${ATTR.table}] [${ATTR.localeSummary}]::after {
                content: attr(${ATTR.localeSummary});
                display: inline-block;
                padding: 2px 7px;
                border: 1px solid #34344b;
                border-radius: 999px;
                color: #a9a9bd;
                font-size: 10px;
                font-weight: 600;
                line-height: 15px;
            }

            [${ATTR.table}] [role="status"] {
                display: inline-flex !important;
                align-items: center !important;
                gap: 6px !important;
                min-height: 20px !important;
                padding: 0 !important;
                border: 0 !important;
                background: transparent !important;
                box-shadow: none !important;
                font-size: 10.5px !important;
            }

            [${ATTR.table}] [role="status"]::before {
                content: '';
                width: 6px;
                height: 6px;
                flex: 0 0 6px;
                border-radius: 999px;
                background: currentColor;
                opacity: 0.9;
            }

            [${ATTR.table}] button[aria-label="Row actions"] {
                opacity: 0.38;
                transition: opacity 120ms ease;
            }

            [${ATTR.table}] tbody tr:hover button[aria-label="Row actions"] {
                opacity: 1;
            }

            [${ATTR.table}] [${ATTR.sorted}] {
                background: rgba(123, 121, 255, 0.045) !important;
            }

            [${ATTR.table}] thead [${ATTR.sorted}] button,
            [${ATTR.table}] thead [${ATTR.sorted}] span {
                color: #b9b8ff !important;
            }

            @media (max-width: 1050px) {
                [${ATTR.root}] {
                    --tm-list-pad: 12px;
                }

                [${ATTR.count}] {
                    display: none !important;
                }
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    function findButton(root, label) {
        if (!(root instanceof Element)) return null;

        const normalized = label.toLowerCase();
        return [...root.querySelectorAll('button')].find(button =>
            textOf(button).toLowerCase() === normalized
        ) || null;
    }

    function getLocaleCode() {
        const params = new URLSearchParams(location.search);
        const locale =
            params.get('plugins[i18n][locale]') ||
            params.get('locale') ||
            'ru';

        return String(locale).toUpperCase();
    }

    function normalizeColumnName(value) {
        return String(value || '')
            .replace(/sort on .*$/i, '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '_');
    }

    function decorateTable(table) {
        clearDynamicMarkers();

        const headers = [...table.querySelectorAll('thead th')];

        headers.forEach((th, index) => {
            const column = normalizeColumnName(textOf(th));
            if (!column) return;

            th.setAttribute(ATTR.column, column);
            table.querySelectorAll(`tbody tr > td:nth-child(${index + 1})`)
                .forEach(cell => cell.setAttribute(ATTR.column, column));
        });

        table.querySelectorAll('tbody button').forEach(button => {
            const match = textOf(button).match(/^(\d+)\s+items?$/i);
            if (match) {
                button.setAttribute(ATTR.relationCount, match[1]);
            }
        });

        table.querySelectorAll('tbody td span').forEach(span => {
            if (span.querySelector('svg')) return;

            const text = textOf(span);
            if (!/\((?:ru|kk)\)/i.test(text)) return;

            const locales = [];
            if (/Russian\s*\(ru\)/i.test(text)) locales.push('RU');
            if (/Kazakh\s*\(kk\)/i.test(text)) locales.push('KK');

            if (locales.length) {
                span.setAttribute(ATTR.localeSummary, locales.join(' · '));
            }
        });

        const params = new URLSearchParams(location.search);
        const sortValue = params.get('sort') || params.get('sort[0]');
        const sortField = sortValue?.split(':')[0]?.trim().toLowerCase();
        if (!sortField) return;

        const sortedIndex = headers.findIndex(th =>
            normalizeColumnName(textOf(th)) === sortField
        );

        if (sortedIndex < 0) return;

        headers[sortedIndex].setAttribute(ATTR.sorted, '');
        table.querySelectorAll(`tbody tr > td:nth-child(${sortedIndex + 1})`)
            .forEach(cell => cell.setAttribute(ATTR.sorted, ''));
    }

    function apply() {
        ensureStyle();
        cleanupLegacyTopbar();

        if (!isListView()) {
            cleanup();
            return;
        }

        const main = document.querySelector('main#main-content');
        if (!main) return;
        setMarker(main, ATTR.root);

        const header = main.querySelector('[data-strapi-header="true"]');
        if (!header) return;

        const headerShell = header.parentElement;
        const toolbar = headerShell?.nextElementSibling;
        if (!headerShell || !toolbar) return;

        setMarker(headerShell, ATTR.headerShell);
        setMarker(header, ATTR.header);
        setMarker(toolbar, ATTR.toolbar);

        const title = header.querySelector('h1');
        const create = header.querySelector('a[href*="/create"]');
        const count = [...header.querySelectorAll('p')]
            .find(element => /entries found/i.test(textOf(element)));
        const back = [...header.querySelectorAll('a')]
            .find(link => link !== create);
        const headerMain = [...header.children]
            .find(child => child.contains(title) && (!create || child.contains(create)));

        setMarker(headerMain, ATTR.headerMain);
        setMarker(back, ATTR.back);
        setMarker(title, ATTR.title);
        setMarker(count, ATTR.count);
        setMarker(create, ATTR.create);

        setMarker(findButton(toolbar, 'Search'), ATTR.search);
        setMarker(findButton(toolbar, 'Filters'), ATTR.filters);
        setMarker(findButton(toolbar, 'View settings'), ATTR.settings);

        const locale = toolbar.querySelector(
            '[role="combobox"][aria-label="Select a locale"]'
        );
        if (locale) {
            setMarker(locale, ATTR.locale);
            locale.setAttribute(ATTR.localeCode, getLocaleCode());
        }

        const table = main.querySelector('table[role="grid"]');
        if (!table) return;

        setMarker(table, ATTR.table);
        setMarker(table.parentElement, ATTR.tableScroll);
        setMarker(table.parentElement?.parentElement, ATTR.tableFrame);

        const tableShell = toolbar.nextElementSibling;
        if (tableShell?.contains(table)) {
            setMarker(tableShell, ATTR.tableShell);
        }

        decorateTable(table);
    }

    function scheduleApply() {
        if (scheduled) return;
        scheduled = true;

        requestAnimationFrame(() => {
            scheduled = false;
            apply();
        });
    }

    const observer = new MutationObserver(scheduleApply);

    function start() {
        if (!document.documentElement) {
            requestAnimationFrame(start);
            return;
        }

        ensureStyle();

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        window.addEventListener('popstate', scheduleApply);
        window.addEventListener('resize', scheduleApply, { passive: true });
        scheduleApply();
    }

    start();
})();
