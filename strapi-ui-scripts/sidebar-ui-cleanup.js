// ==UserScript==
// @name         sidebar-ui-cleanup
// @version      1.0
// @description  Убирает верхний служебный блок Content Manager и оформляет активную коллекцию в sidebar
// @match        http://10.10.3.80:1337/admin/*
// @updateURL    https://raw.githubusercontent.com/mbtema/strapi/main/strapi-ui-scripts/sidebar-ui-cleanup.js
// @downloadURL  https://raw.githubusercontent.com/mbtema/strapi/main/strapi-ui-scripts/sidebar-ui-cleanup.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const STYLE_ID = 'tm-sidebar-cleanup-style';
    const SIDEBAR_ATTR = 'data-tm-sidebar-cleanup';
    const LIST_ATTR = 'data-tm-sidebar-collection-list';
    const HIDDEN_ATTR = 'data-tm-sidebar-header-hidden';
    const ACTIVE_ATTR = 'data-tm-sidebar-active-collection';
    const LINK_SELECTOR = 'a[href*="/admin/content-manager/collection-types/"]';

    let scheduled = false;

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

            [${SIDEBAR_ATTR}] a[${ACTIVE_ATTR}] {
                position: relative !important;
                width: 100% !important;
                box-sizing: border-box !important;
                border-radius: 6px !important;
                background: #1d1d32 !important;
                color: #7b68ff !important;
                font-weight: 600 !important;
            }

            [${SIDEBAR_ATTR}] a[${ACTIVE_ATTR}] * {
                color: #7b68ff !important;
                font-weight: 600 !important;
            }

            [${SIDEBAR_ATTR}] a[${ACTIVE_ATTR}]::after {
                content: '' !important;
                position: absolute !important;
                top: 0 !important;
                right: 0 !important;
                width: 3px !important;
                height: 100% !important;
                border-radius: 2px 0 0 2px !important;
                background: #725cff !important;
                pointer-events: none !important;
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    function findSidebar() {
        const direct = document.querySelector(
            'nav[aria-label="Content Manager"]'
        );

        if (direct) return direct;

        const candidates = [
            ...document.querySelectorAll('nav, aside, div')
        ].filter(element => {
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

    function findCollectionList(sidebar, links) {
        if (!links.length) return null;

        let node = links[0].parentElement;

        while (node && node !== sidebar) {
            const containsAll = links.every(link => node.contains(link));

            if (containsAll) {
                return node;
            }

            node = node.parentElement;
        }

        return null;
    }

    function hideEverythingBeforeList(sidebar, list) {
        let node = list;

        while (
            node &&
            node !== sidebar &&
            node.parentElement
        ) {
            const parent = node.parentElement;
            const children = [...parent.children];
            const index = children.indexOf(node);

            if (index > 0) {
                children
                    .slice(0, index)
                    .forEach(child => {
                        child.setAttribute(HIDDEN_ATTR, '');
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

            if (isActive) {
                link.setAttribute(ACTIVE_ATTR, '');
            } else {
                link.removeAttribute(ACTIVE_ATTR);
            }
        }
    }

    function apply() {
        ensureStyle();

        const sidebar = findSidebar();
        if (!sidebar) return;

        const links = [
            ...sidebar.querySelectorAll(LINK_SELECTOR)
        ];

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

        window.addEventListener('popstate', scheduleApply);
        scheduleApply();
    }

    start();

})();
