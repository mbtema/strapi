// ==StrapiExtension==
// @name         ctrl-enter-publisher
// @version      1.1
// @description  Ctrl+Enter публикует текущую запись
// ==/StrapiExtension==

(function () {
    'use strict';

    document.addEventListener('keydown', event => {
        if (!event.ctrlKey || event.code !== 'Enter' || event.repeat) return;

        const publishButton = [...document.querySelectorAll('button')]
            .find(button =>
                button.textContent.trim().toLowerCase() === 'publish'
            );

        if (!publishButton) {
            console.log('[Strapi Hotkey] Publish button not found');
            return;
        }

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
