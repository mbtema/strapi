// ==StrapiExtension==
// @name         vimium-open-row
// @version      1.1.1
// @description  Делает строки таблиц доступными для Vimium
// ==/StrapiExtension==

(function () {
    'use strict';

    const ROW_SELECTOR = 'tbody tr';
    const ADDED_ATTR = 'data-vimium-link-added';

    let scheduled = false;
    const pendingRoots = new Set();

    function addLink(row) {
        if (!(row instanceof Element)) return;
        if (!row.matches(ROW_SELECTOR)) return;
        if (row.hasAttribute(ADDED_ATTR)) return;

        const cells = row.querySelectorAll('td');
        if (!cells.length) return;

        row.setAttribute(ADDED_ATTR, 'true');

        const link = document.createElement('a');
        link.href = '#';
        link.textContent = '↗';

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

        cells[0].prepend(link);
    }

    function processRoot(root) {
        if (!(root instanceof Element)) return;

        addLink(root);

        root
            .querySelectorAll(`${ROW_SELECTOR}:not([${ADDED_ATTR}])`)
            .forEach(addLink);
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

        document
            .querySelectorAll(`${ROW_SELECTOR}:not([${ADDED_ATTR}])`)
            .forEach(addLink);
    }

    start();
})();
