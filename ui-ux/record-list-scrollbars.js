// ==StrapiExtension==
// @name         record-list-scrollbars
// @version      1.0.4
// @description  Скрывает scrollbar и overflow-подсветку в списке записей Content Manager, сохраняя прокрутку
// ==/StrapiExtension==

(function () {
    'use strict';

    const GLOBAL_KEY = '__tmRecordListScrollbars';
    const STYLE_ID = 'tm-record-list-scrollbars-style';
    const HIDDEN_ATTR = 'data-tm-record-list-scrollbars-hidden';
    const SHADOW_ATTR = 'data-tm-record-list-overflow-shadow';
    const TABLE_SELECTOR = 'table, [role="table"], [role="grid"]';
    const OVERFLOW_RE = /^(auto|scroll|overlay)$/;

    let scheduled = false;
    let frameId = 0;
    let destroyed = false;

    function ensureStyle() {
        let style = document.getElementById(STYLE_ID);

        if (!style) {
            style = document.createElement('style');
            style.id = STYLE_ID;
            (document.head || document.documentElement).appendChild(style);
        }

        style.textContent = `
            [${HIDDEN_ATTR}],
            main:has(${TABLE_SELECTOR}) {
                scrollbar-width: none !important;
                -ms-overflow-style: none !important;
            }

            [${HIDDEN_ATTR}]::-webkit-scrollbar,
            main:has(${TABLE_SELECTOR})::-webkit-scrollbar {
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
    }

    function clearMarkers() {
        document
            .querySelectorAll(`[${HIDDEN_ATTR}], [${SHADOW_ATTR}]`)
            .forEach(element => {
                element.removeAttribute(HIDDEN_ATTR);
                element.removeAttribute(SHADOW_ATTR);
            });
    }

    function mayScroll(element) {
        if (!(element instanceof HTMLElement)) return false;

        const style = getComputedStyle(element);

        return (
            OVERFLOW_RE.test(style.overflowX) ||
            OVERFLOW_RE.test(style.overflowY)
        );
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

    function markAncestorChain(table) {
        let node = table.parentElement;
        let depth = 0;

        while (
            node &&
            node !== document.documentElement &&
            depth < 16
        ) {
            if (mayScroll(node)) {
                node.setAttribute(HIDDEN_ATTR, '');
            }

            if (hasOverflowPseudo(node)) {
                node.setAttribute(SHADOW_ATTR, '');
            }

            if (node === document.body || node.id === 'strapi') break;

            node = node.parentElement;
            depth++;
        }
    }

    function apply() {
        if (destroyed) return;

        ensureStyle();
        clearMarkers();

        const root = document.querySelector('main') || document.body;
        if (!root) return;

        root.querySelectorAll(TABLE_SELECTOR).forEach(markAncestorChain);
    }

    function scheduleApply() {
        if (destroyed || scheduled) return;
        scheduled = true;

        frameId = requestAnimationFrame(() => {
            scheduled = false;
            frameId = 0;
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

    function mutationIsRelevant(mutation) {
        if (mutation.type === 'attributes') {
            const target = mutation.target;
            if (!(target instanceof Element)) return false;

            const main = target.matches('main')
                ? target
                : target.closest('main');

            return Boolean(main?.querySelector(TABLE_SELECTOR));
        }

        return [...mutation.addedNodes].some(nodeIsRelevant);
    }

    const observer = new MutationObserver(mutations => {
        if (mutations.some(mutationIsRelevant)) {
            scheduleApply();
        }
    });

    function onResize() {
        scheduleApply();
    }

    function onPageShow() {
        scheduleApply();
    }

    function start() {
        if (!document.documentElement) {
            frameId = requestAnimationFrame(start);
            return;
        }

        ensureStyle();

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style']
        });

        window.addEventListener('popstate', scheduleApply);
        window.addEventListener('resize', onResize, { passive: true });
        window.addEventListener('pageshow', onPageShow);

        scheduleApply();
    }

    function destroy() {
        destroyed = true;
        observer.disconnect();

        window.removeEventListener('popstate', scheduleApply);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('pageshow', onPageShow);

        if (frameId) cancelAnimationFrame(frameId);

        clearMarkers();
    }

    try {
        window[GLOBAL_KEY]?.destroy?.();
    } catch (error) {
        console.warn('[record-list-scrollbars] Не удалось очистить предыдущий instance', error);
    }

    window[GLOBAL_KEY] = { destroy, apply: scheduleApply };

    start();
})();
