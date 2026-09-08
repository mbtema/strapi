// ==StrapiExtension==
// @name         list-view
// @version      1.0.0
// @description  Точечные UI-правки List View Content Manager
// ==/StrapiExtension==

(function () {
    'use strict';

    const STYLE_ID = 'tm-list-view-style';
    const HIDDEN_ATTR = 'data-tm-list-view-hidden-column';
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
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    function clearHiddenColumns() {
        document.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach(element => {
            element.removeAttribute(HIDDEN_ATTR);
        });
    }

    function apply() {
        ensureStyle();
        clearHiddenColumns();

        if (!isListView()) return;

        const table = document.querySelector('main#main-content table[role="grid"]');
        if (!table) return;

        const headers = [...table.querySelectorAll('thead th')];

        headers.forEach((header, index) => {
            if (!HIDDEN_COLUMNS.has(normalize(header.textContent))) return;

            table.querySelectorAll(`tr > *:nth-child(${index + 1})`).forEach(cell => {
                cell.setAttribute(HIDDEN_ATTR, '');
            });
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
