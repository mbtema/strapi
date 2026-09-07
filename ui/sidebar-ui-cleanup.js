// ==StrapiExtension==
// @name         sidebar-ui-cleanup
// @version      1.0.2
// @description  Убирает верхний служебный блок Content Manager и оформляет активную коллекцию в sidebar
// ==/StrapiExtension==

(function () {
    'use strict';

    const STYLE_ID = 'tm-sidebar-cleanup-style';
    const SIDEBAR_ATTR = 'data-tm-sidebar-cleanup';
    const LIST_ATTR = 'data-tm-sidebar-collection-list';
    const HIDDEN_ATTR = 'data-tm-sidebar-header-hidden';
    const ACTIVE_ATTR = 'data-tm-sidebar-active-collection';
    const LINK_SELECTOR = 'a[href*="/admin/content-manager/collection-types/"]';
    const SIDEBAR_SELECTOR = 'nav[aria-label="Content Manager"]';

    let scheduled = false;
    let sidebar = null;
    let lastPath = '';

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            [${HIDDEN_ATTR}] {
                display: none !important;
            }

            [${LIST_ATTR}] {
                margin-top: 16px !important;
                padding-top: 0 !important;
            }

            [${SIDEBAR_ATTR}] ${LINK_SELECTOR} {
                width: calc(100% - 16px) !important;
                margin: 2px 8px !important;
                box-sizing: border-box !important;
                border-radius: 6px !important;
            }

            [${SIDEBAR_ATTR}] ${LINK_SELECTOR} > div {
                min-width: 0 !important;
                height: auto !important;
                min-height: 40px !important;
                box-sizing: border-box !important;
            }

            [${SIDEBAR_ATTR}] ${LINK_SELECTOR} > div > span:last-child {
                min-width: 0 !important;
                max-width: none !important;
                overflow: visible !important;
                white-space: normal !important;
                text-overflow: clip !important;
                line-height: 1.35 !important;
                overflow-wrap: anywhere !important;
                word-break: normal !important;
            }

            [${SIDEBAR_ATTR}] a[${ACTIVE_ATTR}] {
                position: relative !important;
                background: #1d1d32 !important;
                color: #7b68ff !important;
                font-weight: 600 !important;
                overflow: hidden !important;
            }

            [${SIDEBAR_ATTR}] a[${ACTIVE_ATTR}] * {
                color: #7b68ff !important;
                font-weight: 600 !important;
            }

            [${SIDEBAR_ATTR}] a[${ACTIVE_ATTR}]::after {
                content: '' !important;
                position: absolute !important;
                top: 6px !important;
                right: 0 !important;
                bottom: 6px !important;
                width: 3px !important;
                border-radius: 3px 0 0 3px !important;
                background: #725cff !important;
                pointer-events: none !important;
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    function findSidebar() {
        const direct = document.querySelector(SIDEBAR_SELECTOR);
        if (direct) return direct;

        const candidates = [...document.querySelectorAll('nav, aside, div')]
            .filter(element => {
                const links = element.querySelectorAll(LINK_SELECTOR);
                const rect = element.getBoundingClientRect();

                return (
                    links.length >= 2 &&
                    rect.left < 350 &&
                    rect.width >= 150 &&
                    rect.width <= 350 &&
                    rect.height > 300
                );
            });

        candidates.sort(
            (a, b) =>
                a.querySelectorAll('*').length -
                b.querySelectorAll('*').length
        );

        return candidates[0] || null;
    }

    function findCollectionList(currentSidebar, links) {
        if (!links.length) return null;

        let node = links[0].parentElement;

        while (node && node !== currentSidebar) {
            if (links.every(link => node.contains(link))) return node;
            node = node.parentElement;
        }

        return null;
    }

    function hideEverythingBeforeList(currentSidebar, list) {
        let node = list;

        while (node && node !== currentSidebar && node.parentElement) {
            const parent = node.parentElement;
            const children = [...parent.children];
            const index = children.indexOf(node);

            if (index > 0) {
                children.slice(0, index).forEach(child => {
                    if (!child.hasAttribute(HIDDEN_ATTR)) {
                        child.setAttribute(HIDDEN_ATTR, '');
                    }
                });
            }

            node = parent;
        }
    }

    function getPath(link) {
        try {
            return new URL(link.href, location.origin)
                .pathname
                .replace(/\/+$/, '');
        } catch {
            return (link.getAttribute('href') || '')
                .split('?')[0]
                .replace(/\/+$/, '');
        }
    }

    function applyActiveState(links) {
        const currentPath = location.pathname.replace(/\/+$/, '');

        for (const link of links) {
            const linkPath = getPath(link);
            const isActive = Boolean(linkPath) && (
                currentPath === linkPath ||
                currentPath.startsWith(`${linkPath}/`)
            );

            link.toggleAttribute(ACTIVE_ATTR, isActive);
        }

        lastPath = currentPath;
    }

    function apply() {
        ensureStyle();

        if (!sidebar || !document.contains(sidebar)) {
            sidebar = findSidebar();
        }

        if (!sidebar) return;

        const links = [...sidebar.querySelectorAll(LINK_SELECTOR)];
        if (!links.length) return;

        sidebar.setAttribute(SIDEBAR_ATTR, '');

        const list = findCollectionList(sidebar, links);

        if (list) {
            list.setAttribute(LIST_ATTR, '');
            hideEverythingBeforeList(sidebar, list);
        }

        applyActiveState(links);
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

        return (
            node.matches(SIDEBAR_SELECTOR) ||
            node.matches(LINK_SELECTOR) ||
            Boolean(node.querySelector(SIDEBAR_SELECTOR)) ||
            Boolean(node.querySelector(LINK_SELECTOR))
        );
    }

    function shouldApply(mutations) {
        const currentPath = location.pathname.replace(/\/+$/, '');
        if (currentPath !== lastPath) return true;

        if (!sidebar || !document.contains(sidebar)) {
            return mutations.some(mutation =>
                [...mutation.addedNodes].some(nodeIsRelevant)
            );
        }

        return mutations.some(mutation => {
            if (
                mutation.target === sidebar ||
                sidebar.contains(mutation.target)
            ) {
                return true;
            }

            return (
                [...mutation.addedNodes].some(nodeIsRelevant) ||
                [...mutation.removedNodes].some(node =>
                    node === sidebar ||
                    (node instanceof Element && node.contains(sidebar))
                )
            );
        });
    }

    const observer = new MutationObserver(mutations => {
        if (shouldApply(mutations)) scheduleApply();
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
        scheduleApply();
    }

    start();
})();
