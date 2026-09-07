// ==StrapiExtension==
// @name         vimium-open-row
// @version      1.1
// @description  Делает строки таблиц доступными для Vimium
// ==/StrapiExtension==

(function () {
    'use strict';

    let scheduled = false;

    function addLinks() {
        document
            .querySelectorAll('tbody tr:not([data-vimium-link-added])')
            .forEach(row => {
                const cells = row.querySelectorAll('td');
                if (!cells.length) return;

                row.dataset.vimiumLinkAdded = 'true';

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
            });
    }

    function scheduleAddLinks() {
        if (scheduled) return;
        scheduled = true;

        requestAnimationFrame(() => {
            scheduled = false;
            addLinks();
        });
    }

    const observer = new MutationObserver(scheduleAddLinks);

    function start() {
        if (!document.documentElement) {
            requestAnimationFrame(start);
            return;
        }

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        scheduleAddLinks();
    }

    start();
})();
