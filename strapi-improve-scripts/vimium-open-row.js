// ==UserScript==
// @name         vimium-open-row
// @namespace    strapi-vimium
// @version      1.0
// @description  helps vimium see react elements
// @match        http://10.10.3.80:1337/admin/*
// @updateURL    https://raw.githubusercontent.com/mbtema/strapi/main/strapi-improve-scripts/vimium-open-row.js
// @downloadURL  https://raw.githubusercontent.com/mbtema/strapi/main/strapi-improve-scripts/vimium-open-row.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    function addLinks() {
        document.querySelectorAll('tbody tr').forEach(row => {

            // Уже обработали
            if (row.dataset.vimiumLinkAdded) return;

            const cells = row.querySelectorAll('td');

            // Пропускаем странные/служебные строки
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

            // Добавляем в первую нормальную ячейку
            cells[0].prepend(link);
        });
    }

    addLinks();

    const observer = new MutationObserver(addLinks);

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();
