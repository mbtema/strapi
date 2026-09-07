// ==UserScript==
// @name         sidebar-sorter
// @version      1.0.1
// @description  Позволяет вручную сортировать коллекции Content Manager перетаскиванием и сохраняет порядок в localStorage
// @match        http://10.10.3.80:1337/admin/*
// @updateURL    https://raw.githubusercontent.com/mbtema/strapi/main/strapi-ui-scripts/sidebar-sorter.js
// @downloadURL  https://raw.githubusercontent.com/mbtema/strapi/main/strapi-ui-scripts/sidebar-sorter.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'tm-content-manager-sidebar-order-v1';
    const STYLE_ID = 'tm-sidebar-sorter-style';
    const ROW_ATTR = 'data-tm-sidebar-sortable';
    const BOUND_ATTR = 'data-tm-sidebar-sort-bound';
    const DRAGGING_ATTR = 'data-tm-sidebar-dragging';
    const LINK_SELECTOR = 'a[href*="/admin/content-manager/collection-types/"]';

    let scheduled = false;
    let draggingRow = null;
    let draggingParent = null;

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            [${ROW_ATTR}] {
                cursor: grab !important;
            }

            [${ROW_ATTR}][${DRAGGING_ATTR}] {
                opacity: 0.45 !important;
                cursor: grabbing !important;
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    function findSidebar() {
        const candidates = [
            ...document.querySelectorAll('aside, nav, div')
        ].filter(element => {
            const text = element.textContent || '';
            const links = element.querySelectorAll(LINK_SELECTOR);

            return (
                text.includes('Content Manager') &&
                text.includes('COLLECTION TYPES') &&
                links.length >= 2
            );
        });

        candidates.sort(
            (a, b) =>
                a.querySelectorAll('*').length -
                b.querySelectorAll('*').length
        );

        return candidates[0] || null;
    }

    function getKey(link) {
        try {
            return new URL(link.href, location.origin).pathname;
        } catch {
            return link.getAttribute('href') || '';
        }
    }

    function getGroup(link, sidebar) {
        let row = link;

        while (
            row &&
            row.parentElement &&
            row !== sidebar
        ) {
            const parent = row.parentElement;

            const sortableChildren = [...parent.children].filter(
                child => child.querySelector?.(LINK_SELECTOR)
            );

            if (sortableChildren.length >= 2) {
                return {
                    parent,
                    row
                };
            }

            row = parent;
        }

        return null;
    }

    function getRows(parent) {
        return [...parent.children].filter(
            child => child.querySelector?.(LINK_SELECTOR)
        );
    }

    function getRowKey(row) {
        const link = row.querySelector(LINK_SELECTOR);
        return link ? getKey(link) : '';
    }

    function loadOrder() {
        try {
            const value = JSON.parse(
                localStorage.getItem(STORAGE_KEY) || '[]'
            );

            return Array.isArray(value) ? value : [];
        } catch {
            return [];
        }
    }

    function saveOrder(parent) {
        const order = getRows(parent)
            .map(getRowKey)
            .filter(Boolean);

        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(order)
        );

        console.log(
            `[Sidebar Sorter] Saved ${order.length} items`
        );
    }

    function resetOrder() {
        localStorage.removeItem(STORAGE_KEY);
        console.log('[Sidebar Sorter] Order reset');
        location.reload();
    }

    function applySavedOrder(parent) {
        const savedOrder = loadOrder();
        if (!savedOrder.length) return;

        const rows = getRows(parent);
        const byKey = new Map(
            rows.map(row => [getRowKey(row), row])
        );

        const sortedRows = [];

        for (const key of savedOrder) {
            const row = byKey.get(key);

            if (row) {
                sortedRows.push(row);
                byKey.delete(key);
            }
        }

        for (const row of rows) {
            const key = getRowKey(row);

            if (byKey.has(key)) {
                sortedRows.push(row);
                byKey.delete(key);
            }
        }

        const currentKeys = rows.map(getRowKey);
        const sortedKeys = sortedRows.map(getRowKey);

        const alreadySorted = currentKeys.every(
            (key, index) => key === sortedKeys[index]
        );

        if (alreadySorted) return;

        for (const row of sortedRows) {
            parent.appendChild(row);
        }
    }

    function bindRow(row) {
        row.setAttribute(ROW_ATTR, '');
        row.draggable = true;

        if (row.hasAttribute(BOUND_ATTR)) return;
        row.setAttribute(BOUND_ATTR, '');

        row.addEventListener('dragstart', event => {
            draggingRow = row;
            draggingParent = row.parentElement;

            row.setAttribute(DRAGGING_ATTR, '');

            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData(
                    'text/plain',
                    getRowKey(row)
                );
            }
        });

        row.addEventListener('dragover', event => {
            if (
                !draggingRow ||
                row === draggingRow ||
                row.parentElement !== draggingParent
            ) {
                return;
            }

            event.preventDefault();

            const rect = row.getBoundingClientRect();
            const insertAfter =
                event.clientY > rect.top + rect.height / 2;

            draggingParent.insertBefore(
                draggingRow,
                insertAfter ? row.nextSibling : row
            );
        });

        row.addEventListener('drop', event => {
            if (!draggingParent) return;

            event.preventDefault();
            saveOrder(draggingParent);
        });

        row.addEventListener('dragend', () => {
            if (draggingParent) {
                saveOrder(draggingParent);
            }

            row.removeAttribute(DRAGGING_ATTR);
            draggingRow = null;
            draggingParent = null;
        });
    }

    function setup() {
        ensureStyle();

        if (draggingRow) return;

        const sidebar = findSidebar();
        if (!sidebar) return;

        const links = [...sidebar.querySelectorAll(LINK_SELECTOR)];
        const parents = new Set();

        for (const link of links) {
            const group = getGroup(link, sidebar);
            if (!group) continue;

            parents.add(group.parent);
        }

        for (const parent of parents) {
            applySavedOrder(parent);

            for (const row of getRows(parent)) {
                bindRow(row);
            }
        }
    }

    function scheduleSetup() {
        if (scheduled) return;

        scheduled = true;

        requestAnimationFrame(() => {
            scheduled = false;
            setup();
        });
    }

    const observer = new MutationObserver(() => {
        if (!draggingRow) {
            scheduleSetup();
        }
    });

    window.addEventListener(
        'keydown',
        event => {
            const key = event.key?.toLowerCase() || '';
            const isS =
                event.code === 'KeyS' ||
                key === 's' ||
                key === 'ы';

            if (
                event.altKey &&
                event.shiftKey &&
                !event.ctrlKey &&
                isS
            ) {
                event.preventDefault();
                event.stopPropagation();
                resetOrder();
            }
        },
        true
    );

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    scheduleSetup();

})();
