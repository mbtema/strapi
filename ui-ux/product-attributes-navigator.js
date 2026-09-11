// ==StrapiExtension==
// @name         product-attributes-navigator
// @version      1.0.0
// @description  Навигация по торговым предложениям в карточке товара: все relations, поиск, пагинация и прямой переход
// ==/StrapiExtension==

(function () {
    'use strict';

    const STYLE_ID = 'tm-product-attributes-navigator-style';
    const ROOT_ATTR = 'data-tm-attributes-navigator-root';
    const PANEL_ATTR = 'data-tm-attributes-navigator';
    const NATIVE_ATTR = 'data-tm-attributes-native';
    const MANAGE_ATTR = 'data-tm-attributes-manage-open';

    const PRODUCT_UID = 'api::product.product';
    const ATTRIBUTE_UID = 'api::attribute.attribute';
    const FIELD_SELECTOR = 'input[type="relation"][name="attributes"]';
    const API_PAGE_SIZE = 100;
    const UI_PAGE_SIZE = 10;

    let state = null;
    let frameScheduled = false;

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            [${ROOT_ATTR}] [${PANEL_ATTR}] {
                display: flex;
                flex-direction: column;
                gap: 10px;
                margin-top: 10px;
                padding: 12px;
                border: 1px solid #3f3f5f;
                border-radius: 8px;
                background: #181826;
            }

            [${ROOT_ATTR}] .tm-pan-toolbar,
            [${ROOT_ATTR}] .tm-pan-footer,
            [${ROOT_ATTR}] .tm-pan-pages {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }

            [${ROOT_ATTR}] .tm-pan-footer {
                justify-content: space-between;
            }

            [${ROOT_ATTR}] .tm-pan-search {
                flex: 1 1 280px;
                min-width: 180px;
                height: 36px;
                box-sizing: border-box;
                padding: 8px 10px;
                border: 1px solid #4a4a6a;
                border-radius: 6px;
                outline: none;
                background: #212134;
                color: #fff;
                font: inherit;
                font-size: 13px;
            }

            [${ROOT_ATTR}] .tm-pan-search::placeholder { color: #8e8ea9; }
            [${ROOT_ATTR}] .tm-pan-search:focus {
                border-color: #7b79ff;
                box-shadow: 0 0 0 2px rgba(123, 121, 255, .18);
            }

            [${ROOT_ATTR}] .tm-pan-button,
            [${ROOT_ATTR}] .tm-pan-page {
                min-height: 32px;
                box-sizing: border-box;
                padding: 6px 10px;
                border: 1px solid #4a4a6a;
                border-radius: 6px;
                background: #212134;
                color: #dcdce4;
                font: inherit;
                font-size: 12px;
                cursor: pointer;
            }

            [${ROOT_ATTR}] .tm-pan-button:hover,
            [${ROOT_ATTR}] .tm-pan-page:hover {
                background: #292944;
                border-color: #5b5b80;
            }

            [${ROOT_ATTR}] .tm-pan-button:disabled,
            [${ROOT_ATTR}] .tm-pan-page:disabled {
                opacity: .45;
                cursor: default;
            }

            [${ROOT_ATTR}] .tm-pan-page[data-active="true"] {
                border-color: #7b79ff;
                background: #302c6f;
                color: #fff;
                font-weight: 600;
            }

            [${ROOT_ATTR}] .tm-pan-meta {
                color: #a5a5ba;
                font-size: 12px;
                line-height: 18px;
            }

            [${ROOT_ATTR}] .tm-pan-list {
                display: flex;
                flex-direction: column;
                gap: 4px;
                min-height: 44px;
            }

            [${ROOT_ATTR}] .tm-pan-row {
                display: flex;
                align-items: center;
                gap: 10px;
                min-height: 44px;
                box-sizing: border-box;
                padding: 7px 10px;
                border: 1px solid #3f3f5f;
                border-radius: 6px;
                background: #212134;
            }

            [${ROOT_ATTR}] .tm-pan-row:hover {
                border-color: #5b5b80;
                background: #24243a;
            }

            [${ROOT_ATTR}] .tm-pan-link {
                min-width: 0;
                flex: 1;
                overflow: hidden;
                color: #9593ff;
                font-size: 13px;
                line-height: 20px;
                text-decoration: none;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            [${ROOT_ATTR}] .tm-pan-link:hover { text-decoration: underline; }

            [${ROOT_ATTR}] .tm-pan-status {
                flex: 0 0 auto;
                padding: 3px 7px;
                border: 1px solid #5b5b80;
                border-radius: 5px;
                color: #dcdce4;
                font-size: 11px;
                line-height: 16px;
                text-transform: capitalize;
            }

            [${ROOT_ATTR}] .tm-pan-empty,
            [${ROOT_ATTR}] .tm-pan-loading,
            [${ROOT_ATTR}] .tm-pan-error {
                padding: 10px 2px;
                color: #a5a5ba;
                font-size: 13px;
                line-height: 20px;
            }

            [${ROOT_ATTR}] .tm-pan-error { color: #ee5e52; }

            [${ROOT_ATTR}]:not([${MANAGE_ATTR}]) [${NATIVE_ATTR}] {
                display: none !important;
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    function normalize(value) {
        return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    }

    function getContext() {
        const match = location.pathname.match(
            /\/admin\/content-manager\/collection-types\/api::product\.product\/([^/?#]+)/
        );
        if (!match) return null;

        const params = new URLSearchParams(location.search);
        const productDocumentId = decodeURIComponent(match[1]);
        const locale = params.get('plugins[i18n][locale]') || 'ru';

        return {
            productDocumentId,
            locale,
            key: `${productDocumentId}:${locale}`
        };
    }

    function getToken() {
        const raw = localStorage.getItem('jwtToken');
        if (!raw) return '';
        try { return JSON.parse(raw); } catch { return raw; }
    }

    function findRoot(input) {
        let node = input;

        while (node?.parentElement) {
            node = node.parentElement;
            if (node.querySelector?.(FIELD_SELECTOR) !== input) continue;

            const label = input.id
                ? node.querySelector(`label[for="${CSS.escape(input.id)}"]`)
                : null;

            if (label && node.querySelector('ol')) return node;
        }

        return null;
    }

    function nativeListContainer(root) {
        const list = root?.querySelector('ol');
        return list?.parentElement?.parentElement || null;
    }

    function markNative(root) {
        root.querySelectorAll(`[${NATIVE_ATTR}]`).forEach(element => {
            element.removeAttribute(NATIVE_ATTR);
        });

        const loadMore = [...root.querySelectorAll('button')]
            .find(button => /load more/i.test(button.textContent || ''));
        const listContainer = nativeListContainer(root);

        if (loadMore) loadMore.setAttribute(NATIVE_ATTR, '');
        if (listContainer) listContainer.setAttribute(NATIVE_ATTR, '');
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function createPanel() {
        const panel = el('div');
        panel.setAttribute(PANEL_ATTR, '');

        const toolbar = el('div', 'tm-pan-toolbar');
        const search = el('input', 'tm-pan-search');
        search.type = 'search';
        search.placeholder = 'Поиск по barcode / name_web…';
        search.autocomplete = 'off';

        const refresh = el('button', 'tm-pan-button', 'Обновить');
        refresh.type = 'button';

        const manage = el('button', 'tm-pan-button', 'Управление связями');
        manage.type = 'button';

        toolbar.append(search, refresh, manage);

        const meta = el('div', 'tm-pan-meta');
        const list = el('div', 'tm-pan-list');
        const footer = el('div', 'tm-pan-footer');
        const range = el('div', 'tm-pan-meta');
        const pages = el('div', 'tm-pan-pages');

        footer.append(range, pages);
        panel.append(toolbar, meta, list, footer);

        return { panel, search, refresh, manage, meta, list, footer, range, pages };
    }

    function filteredItems(current) {
        const query = normalize(current.query);
        if (!query) return current.items;

        return current.items.filter(item =>
            normalize(item.name_web).includes(query) ||
            normalize(item.documentId).includes(query)
        );
    }

    function pageCount(total) {
        return Math.max(1, Math.ceil(total / UI_PAGE_SIZE));
    }

    function visiblePages(page, count) {
        if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);

        const set = new Set([1, count, page - 1, page, page + 1]);
        return [...set]
            .filter(value => value >= 1 && value <= count)
            .sort((a, b) => a - b);
    }

    function attributeUrl(item, locale) {
        const params = new URLSearchParams();
        params.set('plugins[i18n][locale]', item.locale || locale);

        return `/admin/content-manager/collection-types/${ATTRIBUTE_UID}/${encodeURIComponent(item.documentId)}?${params}`;
    }

    function renderPagination(current, total) {
        const count = pageCount(total);
        current.page = Math.min(Math.max(1, current.page), count);
        current.ui.pages.replaceChildren();

        const previous = el('button', 'tm-pan-page', '‹');
        previous.type = 'button';
        previous.disabled = current.page <= 1;
        previous.title = 'Предыдущая страница';
        previous.addEventListener('click', () => {
            current.page--;
            render(current);
        });
        current.ui.pages.appendChild(previous);

        let last = 0;
        for (const page of visiblePages(current.page, count)) {
            if (last && page - last > 1) {
                current.ui.pages.appendChild(el('span', 'tm-pan-meta', '…'));
            }

            const button = el('button', 'tm-pan-page', String(page));
            button.type = 'button';
            button.dataset.active = String(page === current.page);
            button.addEventListener('click', () => {
                current.page = page;
                render(current);
            });
            current.ui.pages.appendChild(button);
            last = page;
        }

        const next = el('button', 'tm-pan-page', '›');
        next.type = 'button';
        next.disabled = current.page >= count;
        next.title = 'Следующая страница';
        next.addEventListener('click', () => {
            current.page++;
            render(current);
        });
        current.ui.pages.appendChild(next);
    }

    function render(current) {
        if (!current || current !== state) return;

        const { ui } = current;
        ui.refresh.disabled = current.loading;
        ui.search.disabled = current.loading && !current.items.length;

        if (current.loading && !current.items.length) {
            ui.meta.textContent = 'Загружаю все торговые предложения…';
            ui.list.replaceChildren(el('div', 'tm-pan-loading', 'Загрузка…'));
            ui.footer.hidden = true;
            return;
        }

        if (current.error) {
            ui.meta.textContent = '';
            ui.list.replaceChildren(el('div', 'tm-pan-error', current.error));
            ui.footer.hidden = true;
            return;
        }

        const filtered = filteredItems(current);
        const count = pageCount(filtered.length);
        current.page = Math.min(Math.max(1, current.page), count);

        const start = (current.page - 1) * UI_PAGE_SIZE;
        const pageItems = filtered.slice(start, start + UI_PAGE_SIZE);

        ui.meta.textContent = current.query
            ? `Найдено ${filtered.length} из ${current.items.length}`
            : `Загружено ${current.items.length}`;

        ui.list.replaceChildren();

        if (!pageItems.length) {
            ui.list.appendChild(el('div', 'tm-pan-empty', 'Ничего не найдено'));
        } else {
            for (const item of pageItems) {
                const row = el('div', 'tm-pan-row');
                const link = el('a', 'tm-pan-link', item.name_web || item.documentId);
                link.href = attributeUrl(item, current.context.locale);
                link.title = item.name_web || item.documentId;

                const status = el(
                    'span',
                    'tm-pan-status',
                    item.status || (item.publishedAt ? 'published' : 'draft')
                );

                row.append(link, status);
                ui.list.appendChild(row);
            }
        }

        const from = filtered.length ? start + 1 : 0;
        const to = Math.min(start + UI_PAGE_SIZE, filtered.length);
        ui.range.textContent = `Показано ${from}–${to} из ${filtered.length}`;
        renderPagination(current, filtered.length);
        ui.footer.hidden = false;
    }

    async function fetchRelations(context, page, signal) {
        const params = new URLSearchParams({
            locale: context.locale,
            pageSize: String(API_PAGE_SIZE),
            page: String(page)
        });

        const headers = { Accept: 'application/json' };
        const token = getToken();
        if (token) headers.Authorization = `Bearer ${token}`;

        const response = await fetch(
            `/content-manager/relations/${PRODUCT_UID}/${encodeURIComponent(context.productDocumentId)}/attributes?${params}`,
            {
                method: 'GET',
                headers,
                credentials: 'include',
                signal
            }
        );

        if (!response.ok) {
            throw new Error(`Relations API: ${response.status} ${response.statusText}`);
        }

        return response.json();
    }

    async function loadAll(current) {
        if (!current || current.loading) return;

        current.abortController?.abort();
        current.abortController = new AbortController();
        current.loading = true;
        current.error = '';
        render(current);

        try {
            const first = await fetchRelations(current.context, 1, current.abortController.signal);
            let items = Array.isArray(first.results) ? [...first.results] : [];
            const count = Number(first.pagination?.pageCount || 1);

            for (let page = 2; page <= count; page++) {
                const next = await fetchRelations(current.context, page, current.abortController.signal);
                if (Array.isArray(next.results)) items.push(...next.results);
            }

            if (current !== state) return;

            current.items = items;
            current.page = 1;
        } catch (error) {
            if (error?.name === 'AbortError' || current !== state) return;
            current.error = error?.message || 'Не удалось загрузить relations';
            console.warn('[product-attributes-navigator]', error);
        } finally {
            if (current === state) {
                current.loading = false;
                render(current);
            }
        }
    }

    function bind(current) {
        current.ui.search.addEventListener('input', () => {
            current.query = current.ui.search.value;
            current.page = 1;
            render(current);
        });

        current.ui.refresh.addEventListener('click', () => loadAll(current));

        current.ui.manage.addEventListener('click', () => {
            const open = current.root.hasAttribute(MANAGE_ATTR);
            current.root.toggleAttribute(MANAGE_ATTR, !open);
            current.ui.manage.textContent = open ? 'Управление связями' : 'Скрыть управление';
        });
    }

    function destroy() {
        if (!state) return;

        state.abortController?.abort();
        state.root?.removeAttribute(ROOT_ATTR);
        state.root?.removeAttribute(MANAGE_ATTR);
        state.root?.querySelectorAll(`[${NATIVE_ATTR}]`).forEach(element => {
            element.removeAttribute(NATIVE_ATTR);
        });
        state.ui?.panel?.remove();
        state = null;
    }

    function createState(context, input, root) {
        const ui = createPanel();
        root.setAttribute(ROOT_ATTR, '');
        markNative(root);

        const listContainer = nativeListContainer(root);
        if (listContainer?.parentElement) {
            listContainer.insertAdjacentElement('beforebegin', ui.panel);
        } else {
            root.appendChild(ui.panel);
        }

        const current = {
            context,
            input,
            root,
            ui,
            items: [],
            query: '',
            page: 1,
            loading: false,
            error: '',
            abortController: null
        };

        bind(current);
        return current;
    }

    function apply() {
        ensureStyle();

        const context = getContext();
        if (!context) {
            destroy();
            return;
        }

        const input = document.querySelector(FIELD_SELECTOR);
        if (!input) return;

        const root = findRoot(input);
        if (!root) {
            console.warn('[product-attributes-navigator] attributes relation root not found');
            return;
        }

        if (
            state &&
            state.context.key === context.key &&
            state.input === input &&
            state.root === root &&
            document.contains(state.ui.panel)
        ) {
            markNative(root);
            return;
        }

        destroy();
        state = createState(context, input, root);
        loadAll(state);
    }

    function scheduleApply() {
        if (frameScheduled) return;
        frameScheduled = true;

        requestAnimationFrame(() => {
            frameScheduled = false;
            apply();
        });
    }

    function relevantMutation(mutation) {
        if (!(mutation.target instanceof Element)) return false;

        if (!state) {
            return [...mutation.addedNodes].some(node =>
                node instanceof Element &&
                (node.matches?.(FIELD_SELECTOR) || node.querySelector?.(FIELD_SELECTOR))
            );
        }

        if (!document.contains(state.input) || !document.contains(state.root)) return true;
        if (state.ui?.panel?.contains(mutation.target)) return false;

        return mutation.target === state.root || state.root.contains(mutation.target);
    }

    function start() {
        if (!document.documentElement) {
            requestAnimationFrame(start);
            return;
        }

        ensureStyle();

        const observer = new MutationObserver(mutations => {
            if (mutations.some(relevantMutation)) scheduleApply();
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        window.addEventListener('popstate', scheduleApply);
        scheduleApply();
    }

    start();
})();
