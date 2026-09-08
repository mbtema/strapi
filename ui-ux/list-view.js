// ==StrapiExtension==
// @name         list-view
// @version      1.1.0
// @description  Делает List View Content Manager компактнее, чище и удобнее
// ==/StrapiExtension==

(function () {
    'use strict';

    const STYLE_ID = 'tm-list-view-style';
    const LIST_PATH_RE = /^\/admin\/content-manager\/collection-types\/[^/]+\/?$/;

    const ATTR = {
        root: 'data-tm-list-view',
        headerShell: 'data-tm-list-view-header-shell',
        nativeToolbar: 'data-tm-list-view-native-toolbar',
        topbar: 'data-tm-list-view-topbar',
        identity: 'data-tm-list-view-identity',
        title: 'data-tm-list-view-title',
        count: 'data-tm-list-view-count',
        actions: 'data-tm-list-view-actions',
        action: 'data-tm-list-view-action',
        actionLabel: 'data-tm-list-view-action-label',
        locale: 'data-tm-list-view-locale',
        localeCode: 'data-tm-list-view-locale-code',
        tableShell: 'data-tm-list-view-table-shell',
        tableFrame: 'data-tm-list-view-table-frame',
        tableScroll: 'data-tm-list-view-table-scroll',
        table: 'data-tm-list-view-table',
        relationCount: 'data-tm-list-view-relation-count',
        localeSummary: 'data-tm-list-view-locale-summary',
        sorted: 'data-tm-list-view-sorted'
    };

    let scheduled = false;

    function isListView() {
        return LIST_PATH_RE.test(location.pathname);
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
        [ATTR.relationCount, ATTR.localeSummary, ATTR.sorted].forEach(removeMarker);
    }

    function cleanup() {
        clearDynamicMarkers();
        document.querySelector(`[${ATTR.topbar}]`)?.remove();

        [
            ATTR.root,
            ATTR.headerShell,
            ATTR.nativeToolbar,
            ATTR.tableShell,
            ATTR.tableFrame,
            ATTR.tableScroll,
            ATTR.table
        ].forEach(removeMarker);
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            [${ATTR.root}] {
                --tm-list-pad: clamp(14px, 1.35vw, 22px);
            }

            [${ATTR.headerShell}],
            [${ATTR.nativeToolbar}] {
                display: none !important;
            }

            [${ATTR.topbar}] {
                position: sticky;
                top: 0;
                z-index: 30;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 18px;
                min-height: 58px;
                box-sizing: border-box;
                padding: 10px var(--tm-list-pad);
                background: #181826;
                border-bottom: 1px solid #2f2f45;
            }

            [${ATTR.identity}] {
                display: flex;
                align-items: baseline;
                gap: 10px;
                min-width: 0;
                flex: 1 1 auto;
            }

            [${ATTR.title}] {
                margin: 0;
                min-width: 0;
                overflow: hidden;
                color: #ffffff;
                font: inherit;
                font-size: 20px;
                font-weight: 650;
                line-height: 26px;
                letter-spacing: -0.015em;
                white-space: nowrap;
                text-overflow: ellipsis;
            }

            [${ATTR.count}] {
                flex: 0 0 auto;
                color: #8e8ea9;
                font-size: 11px;
                font-weight: 400;
                line-height: 16px;
                white-space: nowrap;
            }

            [${ATTR.actions}] {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 7px;
                min-width: 0;
                flex: 0 0 auto;
            }

            [${ATTR.actions}] [${ATTR.action}],
            [${ATTR.actions}] [${ATTR.locale}] {
                min-height: 34px !important;
                height: 34px !important;
                box-sizing: border-box !important;
                border-radius: 6px !important;
            }

            [${ATTR.actions}] [${ATTR.action}] {
                gap: 6px !important;
                padding: 0 10px !important;
                font-size: 0 !important;
                white-space: nowrap !important;
            }

            [${ATTR.actions}] [${ATTR.action}]::after {
                content: attr(${ATTR.actionLabel});
                font-size: 12px;
                font-weight: 500;
                line-height: 16px;
            }

            [${ATTR.actions}] [${ATTR.action}="search"],
            [${ATTR.actions}] [${ATTR.action}="settings"] {
                width: 34px !important;
                min-width: 34px !important;
                padding: 0 !important;
                justify-content: center !important;
            }

            [${ATTR.actions}] [${ATTR.action}="search"]::after,
            [${ATTR.actions}] [${ATTR.action}="settings"]::after {
                content: none !important;
            }

            [${ATTR.actions}] [${ATTR.action}="create"] {
                padding-left: 12px !important;
                padding-right: 12px !important;
            }

            [${ATTR.locale}] {
                position: relative;
                width: 66px !important;
                min-width: 66px !important;
                padding-left: 10px !important;
                padding-right: 8px !important;
                font-size: 0 !important;
            }

            [${ATTR.locale}] > span:first-child {
                display: none !important;
            }

            [${ATTR.locale}]::before {
                content: attr(${ATTR.localeCode});
                flex: 1;
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
                top: 58px;
                z-index: 12;
            }

            [${ATTR.table}] thead th {
                height: 38px !important;
                min-height: 38px !important;
                box-sizing: border-box !important;
                padding: 0 10px !important;
                background: #181826 !important;
                border-top: 0 !important;
                border-bottom: 1px solid #3a3a50 !important;
            }

            [${ATTR.table}] thead th button,
            [${ATTR.table}] thead th span {
                color: #8e8ea9 !important;
                font-size: 10px !important;
                font-weight: 600 !important;
                line-height: 14px !important;
                letter-spacing: 0.045em !important;
            }

            [${ATTR.table}] tbody td {
                height: 46px !important;
                min-height: 46px !important;
                box-sizing: border-box !important;
                padding: 6px 10px !important;
                background: transparent !important;
                border-bottom: 1px solid #2c2c40 !important;
                vertical-align: middle !important;
            }

            [${ATTR.table}] tbody tr:hover > td {
                background: #202034 !important;
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
                right: -3px !important;
                width: 18px !important;
                height: 18px !important;
                margin: 0 !important;
                transform: translateY(-50%) !important;
                opacity: 0 !important;
                transition: opacity 120ms ease !important;
            }

            [${ATTR.table}] tbody tr:hover td:first-child > a[href="#"] {
                opacity: 0.32 !important;
            }

            [${ATTR.table}] tbody td img {
                width: 28px !important;
                height: 28px !important;
                max-width: 28px !important;
                max-height: 28px !important;
                object-fit: contain !important;
                border-radius: 5px !important;
            }

            [${ATTR.table}] tbody td button:not([role="checkbox"]) {
                min-height: 26px !important;
                padding-top: 0 !important;
                padding-bottom: 0 !important;
            }

            [${ATTR.table}] button[${ATTR.relationCount}] {
                gap: 4px !important;
                padding-left: 2px !important;
                padding-right: 2px !important;
                font-size: 0 !important;
            }

            [${ATTR.table}] button[${ATTR.relationCount}] > span:first-child {
                display: none !important;
            }

            [${ATTR.table}] button[${ATTR.relationCount}]::before {
                content: attr(${ATTR.relationCount});
                color: #dcdce4;
                font-size: 11px;
                font-weight: 500;
                line-height: 16px;
            }

            [${ATTR.table}] [${ATTR.localeSummary}] {
                max-width: 84px !important;
                overflow: hidden !important;
                font-size: 0 !important;
                white-space: nowrap !important;
            }

            [${ATTR.table}] [${ATTR.localeSummary}]::after {
                content: attr(${ATTR.localeSummary});
                color: #c0c0cf;
                font-size: 10.5px;
                font-weight: 500;
                line-height: 16px;
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
                    display: none;
                }

                [${ATTR.actions}] {
                    gap: 5px;
                }

                [${ATTR.actions}] [${ATTR.action}="filters"]::after,
                [${ATTR.actions}] [${ATTR.action}="create"]::after {
                    content: none !important;
                }

                [${ATTR.actions}] [${ATTR.action}="filters"],
                [${ATTR.actions}] [${ATTR.action}="create"] {
                    width: 34px !important;
                    min-width: 34px !important;
                    padding: 0 !important;
                    justify-content: center !important;
                }
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    function textOf(element) {
        return (element?.textContent || '').trim();
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

    function ensureTopbar(main, headerShell, nativeToolbar, titleText, countText) {
        let topbar = main.querySelector(`[${ATTR.topbar}]`);

        if (!topbar) {
            topbar = document.createElement('div');
            topbar.setAttribute(ATTR.topbar, '');

            const identity = document.createElement('div');
            identity.setAttribute(ATTR.identity, '');

            const title = document.createElement('h1');
            title.setAttribute(ATTR.title, '');

            const count = document.createElement('span');
            count.setAttribute(ATTR.count, '');

            const actions = document.createElement('div');
            actions.setAttribute(ATTR.actions, '');

            identity.append(title, count);
            topbar.append(identity, actions);
            main.insertBefore(topbar, headerShell);
        }

        topbar.querySelector(`[${ATTR.title}]`).textContent = titleText;
        topbar.querySelector(`[${ATTR.count}]`).textContent = countText;

        setMarker(headerShell, ATTR.headerShell);
        setMarker(nativeToolbar, ATTR.nativeToolbar);

        return topbar;
    }

    function markAction(element, name, label) {
        if (!(element instanceof Element)) return;
        element.setAttribute(ATTR.action, name);
        element.setAttribute(ATTR.actionLabel, label);
    }

    function syncActions(topbar, controls) {
        const actions = topbar.querySelector(`[${ATTR.actions}]`);
        if (!actions) return;

        const desired = controls.filter(Boolean);

        desired.forEach(element => {
            if (element.parentElement !== actions) {
                actions.appendChild(element);
            }
        });

        [...actions.children].forEach(child => {
            if (!desired.includes(child)) child.remove();
        });
    }

    function decorateTable(table) {
        clearDynamicMarkers();

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

        const sortValue =
            new URLSearchParams(location.search).get('sort') ||
            new URLSearchParams(location.search).get('sort[0]');

        const sortField = sortValue?.split(':')[0]?.trim().toLowerCase();
        if (!sortField) return;

        const headers = [...table.querySelectorAll('thead th')];
        const sortedIndex = headers.findIndex(th => {
            const label = textOf(th)
                .replace(/sort on .*$/i, '')
                .trim()
                .toLowerCase();
            return label === sortField;
        });

        if (sortedIndex < 0) return;

        headers[sortedIndex].setAttribute(ATTR.sorted, '');
        table.querySelectorAll(`tbody tr > td:nth-child(${sortedIndex + 1})`)
            .forEach(cell => cell.setAttribute(ATTR.sorted, ''));
    }

    function apply() {
        ensureStyle();

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
        const nativeToolbar = headerShell?.nextElementSibling;
        if (!headerShell || !nativeToolbar) return;

        const nativeTitle = header.querySelector('h1');
        const nativeCount = [...header.querySelectorAll('p')]
            .find(element => /entries found/i.test(textOf(element)));

        const topbar = ensureTopbar(
            main,
            headerShell,
            nativeToolbar,
            textOf(nativeTitle),
            textOf(nativeCount)
        );

        const actions = topbar.querySelector(`[${ATTR.actions}]`);

        const search =
            findButton(nativeToolbar, 'Search') ||
            actions?.querySelector(`[${ATTR.action}="search"]`);

        const filters =
            findButton(nativeToolbar, 'Filters') ||
            actions?.querySelector(`[${ATTR.action}="filters"]`);

        const settings =
            findButton(nativeToolbar, 'View settings') ||
            actions?.querySelector(`[${ATTR.action}="settings"]`);

        const locale =
            nativeToolbar.querySelector('[role="combobox"][aria-label="Select a locale"]') ||
            actions?.querySelector(`[${ATTR.locale}]`);

        const create =
            header.querySelector('a[href*="/create"]') ||
            actions?.querySelector(`[${ATTR.action}="create"]`);

        markAction(search, 'search', '');
        markAction(filters, 'filters', 'Фильтры');
        markAction(settings, 'settings', '');
        markAction(create, 'create', 'Создать');

        if (locale) {
            locale.setAttribute(ATTR.locale, '');
            locale.setAttribute(ATTR.localeCode, getLocaleCode());
        }

        syncActions(topbar, [search, filters, locale, settings, create]);

        const table = main.querySelector('table[role="grid"]');
        if (!table) return;

        setMarker(table, ATTR.table);
        setMarker(table.parentElement, ATTR.tableScroll);
        setMarker(table.parentElement?.parentElement, ATTR.tableFrame);

        const tableShell = nativeToolbar.nextElementSibling;
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
