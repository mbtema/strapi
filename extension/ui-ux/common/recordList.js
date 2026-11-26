(function () {
    'use strict';

    const GLOBAL_KEY = '__tmRecordList';
    const LEGACY_SCROLLBAR_KEY = '__tmRecordListScrollbars';
    const STYLE_ID = 'tm-record-list-style';
    const CREATED_ATTR = 'data-tm-created';
    const MODIFIED_ATTR = 'data-tm-modified';

    const HIDDEN_ATTR = 'data-tm-record-list-scrollbars-hidden';
    const SHADOW_ATTR = 'data-tm-record-list-overflow-shadow';
    const SELECT_CELL_ATTR = 'data-tm-record-list-select-cell';
    const ACTIONS_ATTR = 'data-tm-record-list-select-actions';
    const LINK_ATTR = 'data-tm-record-list-row-link';
    const LINK_READY_ATTR = 'data-tm-record-list-row-link-ready';
    const COLUMN_HIDDEN_ATTR = 'data-tm-record-list-hidden-column';
    const LOCALES_CELL_ATTR = 'data-tm-record-list-locales-cell';
    const LOCALES_BUTTON_ATTR = 'data-tm-record-list-locales-button';
    const HAS_RU_ATTR = 'data-tm-record-list-has-ru';
    const HAS_KK_ATTR = 'data-tm-record-list-has-kk';

    const HIDDEN_COLUMNS = new Set([
        'to be released in'
    ]);

    const TABLE_SELECTOR = 'table, [role="table"], [role="grid"]';
    const LIST_TABLE_SELECTOR = 'main#main-content table[role="grid"]';
    const LIST_PATH_RE = /^\/admin\/content-manager\/collection-types\/([^/]+)\/?$/;
    const OVERFLOW_RE = /^(auto|scroll|overlay)$/;

    let scheduled = false;
    let frameId = 0;
    let destroyed = false;
    let mappingKey = '';
    let idToDocumentId = new Map();
    let mappingPromise = null;

    function getAdminToken() {
        const raw = localStorage.getItem('jwtToken');
        if (!raw) return '';

        try {
            const parsed = JSON.parse(raw);
            return typeof parsed === 'string' ? parsed : raw;
        } catch {
            return raw.replace(/^"|"$/g, '');
        }
    }

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

            th[${SELECT_CELL_ATTR}],
            td[${SELECT_CELL_ATTR}] {
                width: 60px !important;
                min-width: 60px !important;
                max-width: 60px !important;
                box-sizing: border-box !important;
            }

            [${ACTIONS_ATTR}] {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: flex-start !important;
                gap: 6px !important;
                width: max-content !important;
                min-width: 0 !important;
                white-space: nowrap !important;
            }

            [${LINK_ATTR}] {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                flex: 0 0 20px !important;
                width: 20px !important;
                height: 20px !important;
                box-sizing: border-box !important;
                margin: 0 !important;
                padding: 0 !important;
                border: 1px solid #4a4a6a !important;
                border-radius: 4px !important;
                background: transparent !important;
                color: #c0c0cf !important;
                text-decoration: none !important;
                line-height: 1 !important;
                cursor: pointer !important;
                outline: none !important;
            }

            [${LINK_ATTR}] svg {
                display: block !important;
                width: 12px !important;
                height: 12px !important;
                fill: none !important;
                stroke: currentColor !important;
                stroke-width: 2 !important;
                stroke-linecap: round !important;
                stroke-linejoin: round !important;
                pointer-events: none !important;
            }

            [${LINK_ATTR}]:hover {
                border-color: #7b79ff !important;
                background: #292944 !important;
                color: #ffffff !important;
            }

            [${LINK_ATTR}]:focus-visible {
                border-color: #7b79ff !important;
                box-shadow: 0 0 0 2px rgba(123, 121, 255, 0.24) !important;
            }

            [${LINK_ATTR}][${LINK_READY_ATTR}="false"] {
                opacity: 0.55 !important;
            }

            [${COLUMN_HIDDEN_ATTR}] {
                display: none !important;
            }

            [${LOCALES_CELL_ATTR}] {
                width: 120px !important;
                min-width: 120px !important;
                max-width: 120px !important;
            }

            th[${LOCALES_CELL_ATTR}] {
                white-space: nowrap !important;
            }

            [${LOCALES_BUTTON_ATTR}] {
                width: auto !important;
                min-width: 0 !important;
                max-width: 112px !important;
                padding-left: 6px !important;
                padding-right: 6px !important;
                gap: 4px !important;
                white-space: nowrap !important;
                font-size: 0 !important;
            }

            [${LOCALES_BUTTON_ATTR}] span {
                font-size: 0 !important;
            }

            [${LOCALES_BUTTON_ATTR}]::before,
            [${LOCALES_BUTTON_ATTR}]::after {
                display: none;
                align-items: center;
                justify-content: center;
                min-width: 28px;
                height: 20px;
                box-sizing: border-box;
                padding: 0 7px;
                border: 1px solid #4a4a6a;
                border-radius: 999px;
                background: #2a2a42;
                color: #dcdce4;
                font-size: 10px;
                font-weight: 600;
                line-height: 18px;
                letter-spacing: 0.02em;
            }

            [${LOCALES_BUTTON_ATTR}][${HAS_RU_ATTR}]::before {
                content: 'RU';
                display: inline-flex;
            }

            [${LOCALES_BUTTON_ATTR}][${HAS_KK_ATTR}]::after {
                content: 'KK';
                display: inline-flex;
            }
        `;
    }

    function clearVisualMarkers() {
        document
            .querySelectorAll(`[${HIDDEN_ATTR}], [${SHADOW_ATTR}]`)
            .forEach(element => {
                element.removeAttribute(HIDDEN_ATTR);
                element.removeAttribute(SHADOW_ATTR);
            });
    }

    function normalize(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ');
    }

    function clearListDecorations() {
        document.querySelectorAll(`
            [${COLUMN_HIDDEN_ATTR}],
            [${LOCALES_CELL_ATTR}],
            [${LOCALES_BUTTON_ATTR}],
            [${HAS_RU_ATTR}],
            [${HAS_KK_ATTR}]
        `).forEach(element => {
            element.removeAttribute(COLUMN_HIDDEN_ATTR);
            element.removeAttribute(LOCALES_CELL_ATTR);
            element.removeAttribute(LOCALES_BUTTON_ATTR);
            element.removeAttribute(HAS_RU_ATTR);
            element.removeAttribute(HAS_KK_ATTR);
        });
    }

    function decorateLocalesColumn(table, index) {
        table.querySelectorAll(`tr > *:nth-child(${index + 1})`).forEach(cell => {
            cell.setAttribute(LOCALES_CELL_ATTR, '');

            if (!(cell instanceof HTMLTableCellElement) || cell.tagName === 'TH') return;

            const button = cell.querySelector('button');
            if (!button) return;

            const text = normalize(button.textContent);
            const hasRu = /russian\s*\(ru\)|\bru\b/.test(text);
            const hasKk = /kazakh\s*\(kk\)|\bkk\b/.test(text);

            if (!hasRu && !hasKk) return;

            button.setAttribute(LOCALES_BUTTON_ATTR, '');
            if (hasRu) button.setAttribute(HAS_RU_ATTR, '');
            if (hasKk) button.setAttribute(HAS_KK_ATTR, '');
        });
    }

    function applyListDecorations() {
        clearListDecorations();

        const context = getListContext();
        if (!context) return;

        const table = document.querySelector(LIST_TABLE_SELECTOR);
        if (!table) return;

        const headers = [...table.querySelectorAll('thead th')];

        headers.forEach((header, index) => {
            const name = normalize(header.textContent);

            if (HIDDEN_COLUMNS.has(name)) {
                table.querySelectorAll(`tr > *:nth-child(${index + 1})`).forEach(cell => {
                    cell.setAttribute(COLUMN_HIDDEN_ATTR, '');
                });
                return;
            }

            if (name === 'available in') {
                decorateLocalesColumn(table, index);
            }
        });
    }

    function cleanupRowLinks() {
        document.querySelectorAll(`[${LINK_ATTR}], [data-tm-vimium-row-link]`).forEach(link => {
            const wrapper = link.closest(`[${ACTIONS_ATTR}]`);

            if (wrapper) {
                const checkbox = wrapper.querySelector('button[role="checkbox"]');
                const cell = wrapper.closest('td');

                if (checkbox && cell) {
                    checkbox.removeAttribute(MODIFIED_ATTR);
                    cell.insertBefore(checkbox, wrapper);
                }

                wrapper.remove();
            } else {
                link.remove();
            }
        });

        document.querySelectorAll(`[${SELECT_CELL_ATTR}]`).forEach(cell => {
            cell.removeAttribute(SELECT_CELL_ATTR);
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

    function getListContext() {
        const match = location.pathname.match(LIST_PATH_RE);
        if (!match) return null;

        const uid = decodeURIComponent(match[1]);
        const params = new URLSearchParams(location.search);
        const key = `${uid}?${params.toString()}`;

        return { uid, params, key };
    }

    function getRows(json) {
        if (Array.isArray(json?.results)) return json.results;
        if (Array.isArray(json?.data)) return json.data;
        return [];
    }

    async function fetchCurrentPageMap(context) {
        const headers = { Accept: 'application/json' };
        const token = getAdminToken();
        if (token) headers.Authorization = `Bearer ${token}`;

        const url = `/content-manager/collection-types/${context.uid}?${context.params.toString()}`;

        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const response = await fetch(url, {
                    method: 'GET',
                    credentials: 'include',
                    headers
                });

                const transient = response.status === 429 || response.status >= 500;

                if (!response.ok) {
                    if (transient && attempt < 2) {
                        await new Promise(resolve => setTimeout(resolve, 400));
                        continue;
                    }

                    throw new Error(`HTTP ${response.status}`);
                }

                const json = await response.json();
                const rows = getRows(json);
                const map = new Map();

                for (const item of rows) {
                    if (item?.id == null || !item?.documentId) continue;
                    map.set(String(item.id), String(item.documentId));
                }

                return map;
            } catch (error) {
                if (attempt < 2) {
                    await new Promise(resolve => setTimeout(resolve, 400));
                    continue;
                }

                console.warn(
                    '[record-list] Не удалось получить documentId для текущей страницы; используется row.click fallback',
                    error
                );

                return new Map();
            }
        }

        return new Map();
    }

    async function ensureCurrentPageMap(context) {
        if (mappingKey === context.key && mappingPromise) {
            return mappingPromise;
        }

        mappingKey = context.key;
        idToDocumentId = new Map();

        mappingPromise = fetchCurrentPageMap(context)
            .then(map => {
                if (mappingKey === context.key) {
                    idToDocumentId = map;
                }
                return map;
            });

        return mappingPromise;
    }

    function findIdColumnIndex(table) {
        const headers = [...table.querySelectorAll('thead th')];

        return headers.findIndex(header =>
            String(header.textContent || '').trim().toLowerCase() === 'id'
        );
    }

    function getRowId(row, idColumnIndex) {
        if (idColumnIndex >= 0) {
            const cell = row.children[idColumnIndex];
            const value = String(cell?.textContent || '').trim();
            if (value) return value;
        }

        const checkbox = row.querySelector(':scope > td:first-child button[role="checkbox"][aria-label]');
        const label = checkbox?.getAttribute('aria-label') || '';
        const match = label.match(/\b(\d+)\s*$/);

        return match?.[1] || '';
    }

    function buildEntryHref(context, documentId) {
        if (!documentId) return '';

        const params = new URLSearchParams();
        const locale = context.params.get('plugins[i18n][locale]');

        if (locale) {
            params.set('plugins[i18n][locale]', locale);
        }

        const query = params.toString();

        return (
            `/admin/content-manager/collection-types/${context.uid}/` +
            `${encodeURIComponent(documentId)}` +
            (query ? `?${query}` : '')
        );
    }

    function createRowLink(row) {
        const link = document.createElement('a');
        link.setAttribute(LINK_ATTR, '');
        link.setAttribute(LINK_READY_ATTR, 'false');
        link.setAttribute('aria-label', 'Открыть запись');
        link.setAttribute('title', 'Открыть запись');
        link.setAttribute('role', 'button');
        link.tabIndex = 0;
        link.innerHTML = `
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M14 5h5v5"></path>
                <path d="M10 14 19 5"></path>
                <path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"></path>
            </svg>
        `;

        link.addEventListener('click', event => {
            const plainLeftClick = (
                event.button === 0 &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.shiftKey &&
                !event.altKey
            );

            if (plainLeftClick) {
                event.preventDefault();
                event.stopPropagation();
                row.click();
                return;
            }

            if (!link.hasAttribute('href')) {
                event.preventDefault();
            }

            event.stopPropagation();
        });

        link.addEventListener('auxclick', event => {
            if (event.button !== 1) return;

            if (!link.hasAttribute('href')) {
                event.preventDefault();
            }

            event.stopPropagation();
        });

        link.addEventListener('mousedown', event => {
            event.stopPropagation();
        });

        return link;
    }

    function ensureRowControls(table, context) {
        const firstHeader = table.querySelector('thead th:first-child');
        if (firstHeader) firstHeader.setAttribute(SELECT_CELL_ATTR, '');

        const idColumnIndex = findIdColumnIndex(table);

        for (const row of table.querySelectorAll('tbody tr')) {
            const firstCell = row.querySelector(':scope > td:first-child');
            const checkbox = firstCell?.querySelector('button[role="checkbox"]');

            if (!firstCell || !checkbox) continue;

            firstCell.setAttribute(SELECT_CELL_ATTR, '');

            let wrapper = firstCell.querySelector(`:scope > [${ACTIONS_ATTR}]`);
            let link = wrapper?.querySelector(`[${LINK_ATTR}]`) || null;

            if (!wrapper) {
                wrapper = document.createElement('div');
                wrapper.setAttribute(CREATED_ATTR, 'record-list');
                wrapper.setAttribute(ACTIONS_ATTR, '');

                firstCell.insertBefore(wrapper, checkbox);
                checkbox.setAttribute(MODIFIED_ATTR, 'record-list');
                wrapper.appendChild(checkbox);
            } else {
                wrapper.setAttribute(CREATED_ATTR, 'record-list');
                checkbox.setAttribute(MODIFIED_ATTR, 'record-list');

                if (checkbox.parentElement !== wrapper) {
                    wrapper.insertBefore(checkbox, wrapper.firstChild);
                }
            }

            if (!link) {
                link = createRowLink(row);
                wrapper.appendChild(link);
            }

            const rowId = getRowId(row, idColumnIndex);
            const documentId = rowId ? idToDocumentId.get(rowId) : '';
            const href = buildEntryHref(context, documentId);

            if (href) {
                link.href = href;
                link.removeAttribute('role');
                link.setAttribute(LINK_READY_ATTR, 'true');
                link.setAttribute('title', 'Открыть запись; Ctrl/колесико — в новой вкладке');
            } else {
                link.removeAttribute('href');
                link.setAttribute('role', 'button');
                link.setAttribute(LINK_READY_ATTR, 'false');
                link.setAttribute('title', 'Открыть запись');
            }
        }
    }

    async function applyRowLinks() {
        const context = getListContext();
        if (!context) return;

        const table = document.querySelector(LIST_TABLE_SELECTOR);
        if (!table) return;

        ensureRowControls(table, context);

        await ensureCurrentPageMap(context);
        if (destroyed) return;

        const freshContext = getListContext();
        if (!freshContext || freshContext.key !== context.key) return;

        const freshTable = document.querySelector(LIST_TABLE_SELECTOR);
        if (!freshTable) return;

        ensureRowControls(freshTable, freshContext);
    }

    function apply() {
        if (destroyed) return;

        ensureStyle();
        clearVisualMarkers();

        const root = document.querySelector('main') || document.body;
        if (root) {
            root.querySelectorAll(TABLE_SELECTOR).forEach(markAncestorChain);
        }

        applyListDecorations();

        applyRowLinks().catch(error => {
            console.warn('[record-list] Не удалось обработать ссылки строк', error);
        });
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

        clearVisualMarkers();
        clearListDecorations();
        cleanupRowLinks();
    }

    try {
        window[GLOBAL_KEY]?.destroy?.();
        window[LEGACY_SCROLLBAR_KEY]?.destroy?.();
    } catch (error) {
        console.warn('[record-list] Не удалось очистить предыдущий instance', error);
    }

    document.querySelectorAll('[data-tm-vimium-row-link]').forEach(link => link.remove());

    window[GLOBAL_KEY] = { destroy, apply: scheduleApply };

    start();
})();