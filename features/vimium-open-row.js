// ==StrapiExtension==
// @name         vimium-open-row
// @version      1.1.2
// @description  Делает строки таблиц доступными для Vimium
// ==/StrapiExtension==

(function () {
    'use strict';

    const ROW_SELECTOR = 'tbody tr';
    const LINK_ATTR = 'data-tm-vimium-row-link';

    let scheduled = false;
    const pendingRoots = new Set();

    function addLink(row) {
        if (!(row instanceof Element)) return;
        if (!row.matches(ROW_SELECTOR)) return;

        const firstCell = row.querySelector(':scope > td:first-child');
        if (!firstCell) return;
        if (firstCell.querySelector(`a[${LINK_ATTR}]`)) return;

        const link = document.createElement('a');
        link.href = '#';
        link.textContent = '↗';
        link.setAttribute(LINK_ATTR, '');

        link.style.cssText = `
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 22px;
            height: 22px;
            margin-right: 6px;
            text-decoration: none;
            opacity: 0.15;
            cursor: pointer;
        `;

        link.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            row.click();
        });

        firstCell.prepend(link);
    }

    function processRoot(root) {
        if (!(root instanceof Element)) return;

        const parentRow = root.closest(ROW_SELECTOR);
        if (parentRow) addLink(parentRow);

        root.querySelectorAll(ROW_SELECTOR).forEach(addLink);
    }

    function flush() {
        scheduled = false;

        const roots = [...pendingRoots];
        pendingRoots.clear();

        roots.forEach(processRoot);
    }

    function scheduleRoot(root) {
        if (!(root instanceof Element)) return;

        pendingRoots.add(root);

        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(flush);
    }

    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                scheduleRoot(node);
            }
        }
    });

    function start() {
        if (!document.documentElement) {
            requestAnimationFrame(start);
            return;
        }

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        document.querySelectorAll(ROW_SELECTOR).forEach(addLink);
    }

    start();
})();
