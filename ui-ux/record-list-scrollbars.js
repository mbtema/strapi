// ==StrapiExtension==
// @name         record-list-scrollbars
// @version      1.0.3
// @description  Скрывает scrollbar и overflow-подсветку в списке записей Content Manager, сохраняя прокрутку
// ==/StrapiExtension==

(function () {
    'use strict';

    const STYLE_ID = 'tm-record-list-scrollbars-style';
    const HIDDEN_ATTR = 'data-tm-record-list-scrollbars-hidden';
    const SHADOW_ATTR = 'data-tm-record-list-overflow-shadow';
    const TABLE_SELECTOR = 'table, [role="table"], [role="grid"]';

    let scheduled = false;

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            [${HIDDEN_ATTR}] {
                scrollbar-width: none !important;
                -ms-overflow-style: none !important;
            }

            [${HIDDEN_ATTR}]::-webkit-scrollbar {
                width: 0 !important;
                height: 0 !important;
                display: none !important;
            }

            [${SHADOW_ATTR}]::before,
            [${SHADOW_ATTR}]::after {
                content: none !important;
                display: none !important;
                background: none !important;
                background-image: none !important;
                box-shadow: none !important;
                opacity: 0 !important;
                pointer-events: none !important;
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    function clearMarkers(root) {
        root
            .querySelectorAll(`[${HIDDEN_ATTR}], [${SHADOW_ATTR}]`)
            .forEach(element => {
                element.removeAttribute(HIDDEN_ATTR);
                element.removeAttribute(SHADOW_ATTR);
            });
    }

    function isScrollable(element) {
        if (!(element instanceof HTMLElement)) return false;

        const style = getComputedStyle(element);
        const overflowX = style.overflowX;
        const overflowY = style.overflowY;

        const canScrollX =
            /^(auto|scroll|overlay)$/.test(overflowX) &&
            element.scrollWidth > element.clientWidth + 2;

        const canScrollY =
            /^(auto|scroll|overlay)$/.test(overflowY) &&
            element.scrollHeight > element.clientHeight + 2;

        return canScrollX || canScrollY;
    }

    function hasOverflowPseudo(element) {
        if (!(element instanceof HTMLElement)) return false;

        return ['::before', '::after'].some(pseudo => {
            const style = getComputedStyle(element, pseudo);
            const backgroundImage = style.backgroundImage || '';
            const boxShadow = style.boxShadow || 'none';

            return (
                backgroundImage.includes('gradient') ||
                boxShadow !== 'none'
            );
        });
    }

    function markOverflowWrapper(scrollContainer, root) {
        let node = scrollContainer.parentElement;
        let depth = 0;

        while (
            node &&
            node !== root &&
            node !== document.body &&
            node !== document.documentElement &&
            depth < 4
        ) {
            if (hasOverflowPseudo(node)) {
                node.setAttribute(SHADOW_ATTR, '');
            }

            node = node.parentElement;
            depth++;
        }
    }

    function markScrollContainers(table, root) {
        let node = table.parentElement;

        while (
            node &&
            node !== root &&
            node !== document.body &&
            node !== document.documentElement
        ) {
            if (isScrollable(node)) {
                node.setAttribute(HIDDEN_ATTR, '');
                markOverflowWrapper(node, root);
            }

            node = node.parentElement;
        }
    }

    function apply() {
        ensureStyle();

        const root = document.querySelector('main') || document.body;
        if (!root) return;

        clearMarkers(root);

        root.querySelectorAll(TABLE_SELECTOR).forEach(table => {
            markScrollContainers(table, root);
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

    function nodeIsRelevant(node) {
        if (!(node instanceof Element)) return false;

        return Boolean(
            node.matches(TABLE_SELECTOR) ||
            node.closest(TABLE_SELECTOR) ||
            node.querySelector(TABLE_SELECTOR)
        );
    }

    const observer = new MutationObserver(mutations => {
        const relevant = mutations.some(mutation =>
            [...mutation.addedNodes].some(nodeIsRelevant)
        );

        if (relevant) scheduleApply();
    });

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

        window.addEventListener('popstate', scheduleApply);
        window.addEventListener('resize', scheduleApply, { passive: true });
        scheduleApply();
    }

    start();
})();
