// ==UserScript==
// @name         ctrl-enter-publisher
// @version      1.0
// @description  Ctrl+Enter публикует текущую запись
// @match        http://10.10.3.80:1337/admin/*
// @updateURL    https://raw.githubusercontent.com/mbtema/strapi/main/strapi-improve-scripts/ctrl-enter-publisher.js
// @downloadURL  https://raw.githubusercontent.com/mbtema/strapi/main/strapi-improve-scripts/ctrl-enter-publisher.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    document.addEventListener('keydown', (event) => {

        // Ctrl + Enter
        if (!event.ctrlKey || event.key !== 'Enter') return;

        const publishButton = [...document.querySelectorAll('button')]
            .find(button =>
                button.textContent.trim().toLowerCase() === 'publish'
            );

        // Кнопки нет
        if (!publishButton) {
            console.log('[Strapi Hotkey] Publish button not found');
            return;
        }

        // Кнопка недоступна
        if (publishButton.disabled) {
            console.log('[Strapi Hotkey] Nothing to publish');
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        publishButton.click();

        console.log('[Strapi Hotkey] Published');
    });
})();
