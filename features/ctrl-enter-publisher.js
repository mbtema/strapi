// ==StrapiExtension==
// @name         ctrl-enter-publisher
// @version      1.1.1
// @description  Ctrl+Enter публикует текущую запись
// ==/StrapiExtension==

(function () {
    'use strict';

    const ACTIONS_SELECTOR = '[data-tm-entry-actions="true"]';
    const ENTRY_SELECTOR = 'aside[aria-labelledby="additional-information"]';

    function findPublishButton() {
        const scopes = [
            document.querySelector(ACTIONS_SELECTOR),
            document.querySelector(ENTRY_SELECTOR)
        ].filter(Boolean);

        for (const scope of scopes) {
            const publishButton = [...scope.querySelectorAll('button')]
                .find(button =>
                    button.textContent?.trim().toLowerCase() === 'publish'
                );

            if (publishButton) return publishButton;
        }

        return null;
    }

    document.addEventListener('keydown', event => {
        if (!event.ctrlKey || event.code !== 'Enter' || event.repeat) return;

        const publishButton = findPublishButton();

        if (!publishButton) {
            console.warn('[ctrl-enter-publisher] Publish button not found');
            return;
        }

        if (publishButton.disabled || publishButton.getAttribute('aria-disabled') === 'true') {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        publishButton.click();
    });
})();
