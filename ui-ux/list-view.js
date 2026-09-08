// ==StrapiExtension==
// @name         list-view
// @version      1.3.0
// @description  Точечные UI-правки List View Content Manager
// ==/StrapiExtension==

(function () {
    'use strict';

    const STYLE_ID = 'tm-list-view-style';
    const HIDDEN_ATTR = 'data-tm-list-view-hidden-column';
    const LOCALES_CELL_ATTR = 'data-tm-list-view-locales-cell';
    const LOCALES_BUTTON_ATTR = 'data-tm-list-view-locales-button';
    const HAS_RU_ATTR = 'data-tm-list-view-has-ru';
    const HAS_KK_ATTR = 'data-tm-list-view-has-kk';
    const LIST_PATH_RE = /^\/admin\/content-manager\/collection-types\/[^/]+\/?$/;

    const HIDDEN_COLUMNS = new Set([
        'to be released in'
    ]);

    let scheduled = false;

    function isListView() {
        return LIST_PATH_RE.test(location.pathname);
    }

    function normalize(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ');
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            [${HIDDEN_ATTR}] {
                display: none !important;
            }

            [${LOCALES_CELL_ATTR}] {
                width: 120px !important;
                min-width: 120px !important;
                max-width: 120px !important;
            }

            th[${LOCALES_CELL_ATTR}] {
                white-space: nowrap !important;
            }

            [${LOCALES_BUTTON_ATTR}] {
                width: auto !important;
                min-width: 0 !important;
                max-width: 112px !important;
                padding-left: 6px !important;
                padding-right: 6px !important;
                gap: 4px !important;
                white-space: nowrap !important;
                font-size: 0 !important;
            }

            [${LOCALES_BUTTON_ATTR}] span {
                font-size: 0 !important;
            }

            [${LOCALES_BUTTON_ATTR}]::before,
            [${LOCALES_BUTTON_ATTR}]::after {
                display: none;
                align-items: center;
                justify-content: center;
                min-width: 28px;
                height: 20px;
                box-sizing: border-box;
                padding: 0 7px;
                border: 1px solid #4a4a6a;
                border-radius: 999px;
                background: #2a2a42;
                color: #dcdce4;
                font-size: 10px;
                font-weight: 600;
                line-height: 18px;
                letter-spacing: 0.02em;
            }

            [${LOCALES_BUTTON_ATTR}][${HAS_RU_ATTR}]::before {
                content: 'RU';
                display: inline-flex;
            }

            [${LOCALES_BUTTON_ATTR}][${HAS_KK_ATTR}]::after {
                content: 'KK';
                display: inline-flex;
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    function clearMarkers() {
        document.querySelectorAll(`
            [${HIDDEN_ATTR}],
            [${LOCALES_CELL_ATTR}],
            [${LOCALES_BUTTON_ATTR}],
            [${HAS_RU_ATTR}],
            [${HAS_KK_ATTR}]
        `).forEach(element => {
            element.removeAttribute(HIDDEN_ATTR);
            element.removeAttribute(LOCALES_CELL_ATTR);
            element.removeAttribute(LOCALES_BUTTON_ATTR);
            element.removeAttribute(HAS_RU_ATTR);
            element.removeAttribute(HAS_KK_ATTR);
        });
    }

    function decorateLocalesColumn(table, index) {
        table.querySelectorAll(`tr > *:nth-child(${index + 1})`).forEach(cell => {
            cell.setAttribute(LOCALES_CELL_ATTR, '');

            if (!(cell instanceof HTMLTableCellElement) || cell.tagName === 'TH') return;

            const button = cell.querySelector('button');
            if (!button) return;

            const text = normalize(button.textContent);
            const hasRu = /russian\s*\(ru\)|\bru\b/.test(text);
            const hasKk = /kazakh\s*\(kk\)|\bkk\b/.test(text);

            if (!hasRu && !hasKk) return;

            button.setAttribute(LOCALES_BUTTON_ATTR, '');
            if (hasRu) button.setAttribute(HAS_RU_ATTR, '');
            if (hasKk) button.setAttribute(HAS_KK_ATTR, '');
        });
    }

    function apply() {
        ensureStyle();
        clearMarkers();

        if (!isListView()) return;

        const table = document.querySelector('main#main-content table[role="grid"]');
        if (!table) return;

        const headers = [...table.querySelectorAll('thead th')];

        headers.forEach((header, index) => {
            const name = normalize(header.textContent);

            if (HIDDEN_COLUMNS.has(name)) {
                table.querySelectorAll(`tr > *:nth-child(${index + 1})`).forEach(cell => {
                    cell.setAttribute(HIDDEN_ATTR, '');
                });
                return;
            }

            if (name === 'available in') {
                decorateLocalesColumn(table, index);
            }
        });
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
        ensureStyle();

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        window.addEventListener('popstate', scheduleApply);
        scheduleApply();
    }

    start();
})();
