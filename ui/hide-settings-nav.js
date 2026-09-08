// ==StrapiExtension==
// @name         hide-settings-nav
// @version      1.0.0
// @description  Скрывает пункт Settings из левого глобального меню Strapi
// ==/StrapiExtension==

(function () {
    'use strict';

    const STYLE_ID = 'tm-hide-settings-nav-style';
    const HIDDEN_ATTR = 'data-tm-settings-nav-hidden';
    const SETTINGS_LINK_SELECTOR = 'a[aria-label="Settings"][href^="/admin/settings"]';

    let scheduled = false;

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

    function apply() {
        ensureStyle();

        const links = document.querySelectorAll(SETTINGS_LINK_SELECTOR);

        for (const link of links) {
            const item = link.closest('li') || link;
            item.setAttribute(HIDDEN_ATTR, '');
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
        scheduleApply();
    }

    start();
})();
