// ==StrapiExtension==
// @name         list-view
// @version      1.0.0
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
        back: 'data-tm-list-view-back',
        title: 'data-tm-list-view-title',
        count: 'data-tm-list-view-count',
        create: 'data-tm-list-view-create',
        toolbar: 'data-tm-list-view-toolbar',
        search: 'data-tm-list-view-search',
        filters: 'data-tm-list-view-filters',
        locale: 'data-tm-list-view-locale',
        settings: 'data-tm-list-view-settings',
        tableShell: 'data-tm-list-view-table-shell',
        tableFrame: 'data-tm-list-view-table-frame',
        tableScroll: 'data-tm-list-view-table-scroll',
        table: 'data-tm-list-view-table'
    };

    let scheduled = false;

    function isListView() {
        return LIST_PATH_RE.test(location.pathname);
    }

    function setMarker(element, attr) {
        if (element instanceof Element) {
            element.setAttribute(attr, '');
        }
    }

    function clearMarkers() {
        Object.values(ATTR).forEach(attr => {
            document.querySelectorAll(`[${attr}]`).forEach(element => {
                element.removeAttribute(attr);
            });
        });
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            [${ATTR.root}] {
                --tm-list-pad: clamp(22px, 2.2vw, 36px);
            }

            [${ATTR.headerShell}] {
                height: auto !important;
                min-height: 0 !important;
            }

            [${ATTR.header}] {
                padding: 18px var(--tm-list-pad) 12px !important;
                border: 0 !important;
                box-shadow: none !important;
            }

            [${ATTR.header}] > * {
                margin-top: 0 !important;
                margin-bottom: 0 !important;
            }

            [${ATTR.back}] {
                margin-bottom: 8px !important;
                opacity: 0.72;
                font-size: 12px !important;
            }

            [${ATTR.back}]:hover {
                opacity: 1;
            }

            [${ATTR.title}] {
                font-size: 24px !important;
                line-height: 30px !important;
                letter-spacing: -0.01em !important;
            }

            [${ATTR.count}] {
                margin-top: 3px !important;
                color: #8e8ea9 !important;
                font-size: 12px !important;
                line-height: 18px !important;
            }

            [${ATTR.create}] {
                min-height: 34px !important;
                height: 34px !important;
                padding: 0 12px !important;
                border-radius: 6px !important;
                font-size: 12px !important;
            }

            [${ATTR.toolbar}] {
                position: sticky !important;
                top: 0 !important;
                z-index: 20 !important;
                min-height: 52px !important;
                box-sizing: border-box !important;
                padding: 9px var(--tm-list-pad) !important;
                background: #181826 !important;
                border-top: 1px solid #2f2f45 !important;
                border-bottom: 1px solid #2f2f45 !important;
                box-shadow: none !important;
            }

            [${ATTR.toolbar}] button,
            [${ATTR.locale}] {
                min-height: 34px !important;
                height: 34px !important;
                border-radius: 6px !important;
            }

            [${ATTR.search}],
            [${ATTR.settings}] {
                width: 34px !important;
                min-width: 34px !important;
                padding: 0 !important;
            }

            [${ATTR.filters}] {
                padding-left: 11px !important;
                padding-right: 11px !important;
                font-size: 12px !important;
            }

            [${ATTR.locale}] {
                font-size: 12px !important;
            }

            [${ATTR.tableShell}] {
                padding: 12px var(--tm-list-pad) 32px !important;
            }

            [${ATTR.tableFrame}],
            [${ATTR.tableScroll}] {
                border-radius: 8px !important;
            }

            [${ATTR.table}] {
                width: 100% !important;
                font-size: 12px !important;
            }

            [${ATTR.table}] thead th {
                height: 40px !important;
                min-height: 40px !important;
                box-sizing: border-box !important;
                padding: 0 10px !important;
                background: #212134 !important;
                border-bottom: 1px solid #3a3a50 !important;
            }

            [${ATTR.table}] thead th button,
            [${ATTR.table}] thead th span {
                font-size: 10.5px !important;
                line-height: 14px !important;
                letter-spacing: 0.035em !important;
            }

            [${ATTR.table}] tbody td {
                height: 48px !important;
                min-height: 48px !important;
                box-sizing: border-box !important;
                padding: 7px 10px !important;
                border-bottom-color: #2f2f45 !important;
                vertical-align: middle !important;
            }

            [${ATTR.table}] tbody tr:hover > td {
                background: #1e1e31 !important;
            }

            [${ATTR.table}] th:first-child,
            [${ATTR.table}] td:first-child {
                width: 58px !important;
                min-width: 58px !important;
                padding-left: 10px !important;
                padding-right: 6px !important;
            }

            [${ATTR.table}] tbody td img {
                width: 30px !important;
                height: 30px !important;
                max-width: 30px !important;
                max-height: 30px !important;
                object-fit: contain !important;
                border-radius: 5px !important;
            }

            [${ATTR.table}] tbody td button:not([role="checkbox"]) {
                min-height: 28px !important;
                padding-top: 0 !important;
                padding-bottom: 0 !important;
            }

            [${ATTR.table}] tbody td [role="status"] {
                min-height: 24px !important;
                padding-top: 2px !important;
                padding-bottom: 2px !important;
                font-size: 11px !important;
            }

            [${ATTR.table}] tbody td:first-child > a[href="#"] {
                opacity: 0.05 !important;
                transition: opacity 120ms ease !important;
            }

            [${ATTR.table}] tbody tr:hover td:first-child > a[href="#"] {
                opacity: 0.42 !important;
            }

            @media (max-width: 1100px) {
                [${ATTR.root}] {
                    --tm-list-pad: 18px;
                }

                [${ATTR.header}] {
                    padding-top: 14px !important;
                }

                [${ATTR.table}] tbody td {
                    padding-left: 8px !important;
                    padding-right: 8px !important;
                }
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    function markToolbarButton(toolbar, label, attr) {
        const button = [...toolbar.querySelectorAll('button')]
            .find(candidate =>
                (candidate.textContent || '').trim().toLowerCase() === label
            );

        setMarker(button, attr);
    }

    function apply() {
        ensureStyle();

        if (!isListView()) {
            clearMarkers();
            return;
        }

        const main = document.querySelector('main#main-content');
        if (!main) return;

        setMarker(main, ATTR.root);

        const header = main.querySelector('[data-strapi-header="true"]');
        if (!header) return;

        setMarker(header, ATTR.header);
        setMarker(header.parentElement, ATTR.headerShell);
        setMarker(header.querySelector('h1'), ATTR.title);
        setMarker(header.querySelector('a[href*="/create"]'), ATTR.create);

        const back = [...header.querySelectorAll('a')]
            .find(link => !link.href.includes('/create'));
        setMarker(back, ATTR.back);

        const count = [...header.querySelectorAll('p')]
            .find(element => /entries found/i.test(element.textContent || ''));
        setMarker(count, ATTR.count);

        const headerShell = header.parentElement;
        const toolbar = headerShell?.nextElementSibling;

        if (toolbar) {
            setMarker(toolbar, ATTR.toolbar);
            setMarker(
                toolbar.querySelector('[role="combobox"][aria-label="Select a locale"]'),
                ATTR.locale
            );

            markToolbarButton(toolbar, 'search', ATTR.search);
            markToolbarButton(toolbar, 'filters', ATTR.filters);
            markToolbarButton(toolbar, 'view settings', ATTR.settings);
        }

        const table = main.querySelector('table[role="grid"]');
        if (!table) return;

        setMarker(table, ATTR.table);
        setMarker(table.parentElement, ATTR.tableScroll);
        setMarker(table.parentElement?.parentElement, ATTR.tableFrame);

        const tableShell = toolbar?.nextElementSibling;
        if (tableShell?.contains(table)) {
            setMarker(tableShell, ATTR.tableShell);
        }
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
