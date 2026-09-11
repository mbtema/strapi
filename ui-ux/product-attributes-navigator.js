// ==StrapiExtension==
// @name         product-attributes-navigator
// @version      1.0.2
// @description  Навигация по торговым предложениям в карточке товара: поиск, пагинация, прямой переход и удобное управление relations
// ==/StrapiExtension==

(function () {
    'use strict';

    const STYLE_ID = 'tm-product-attributes-navigator-style';
    const ROOT = 'data-tm-attributes-navigator-root';
    const PANEL = 'data-tm-attributes-navigator';
    const NATIVE = 'data-tm-attributes-native';
    const NATIVE_LIST = 'data-tm-attributes-native-list';
    const MANAGE = 'data-tm-attributes-manage-open';

    const PRODUCT_UID = 'api::product.product';
    const ATTRIBUTE_UID = 'api::attribute.attribute';
    const FIELD = 'input[type="relation"][name="attributes"]';
    const API_PAGE_SIZE = 100;
    const UI_PAGE_SIZE = 10;
    const RELOAD_DELAY = 500;
    const NATIVE_HEIGHT = 540;

    let state = null;
    let frameScheduled = false;
    let reloadTimer = null;

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            [${ROOT}] [${PANEL}]{
                display:flex;flex-direction:column;gap:10px;align-self:flex-start;
                width:100%;min-height:0!important;height:fit-content!important;
                box-sizing:border-box;margin-top:10px;padding:12px 12px 8px;
                border:1px solid #3f3f5f;border-radius:8px;background:#181826
            }
            [${ROOT}] .tm-pan-footer,[${ROOT}] .tm-pan-pages{
                display:flex;align-items:center;gap:8px;flex-wrap:wrap
            }
            [${ROOT}] .tm-pan-footer{justify-content:space-between;min-height:32px;margin:0;padding:0}
            [${ROOT}] .tm-pan-search{
                width:100%;height:36px;box-sizing:border-box;padding:8px 10px;
                border:1px solid #4a4a6a;border-radius:6px;outline:none;
                background:#212134;color:#fff;font:inherit;font-size:13px
            }
            [${ROOT}] .tm-pan-search::placeholder{color:#8e8ea9}
            [${ROOT}] .tm-pan-search:focus{border-color:#7b79ff;box-shadow:0 0 0 2px rgba(123,121,255,.18)}
            [${ROOT}] .tm-pan-button,[${ROOT}] .tm-pan-page{
                min-height:32px;box-sizing:border-box;padding:6px 10px;
                border:1px solid #4a4a6a;border-radius:6px;background:#212134;
                color:#dcdce4;font:inherit;font-size:12px;cursor:pointer
            }
            [${ROOT}] .tm-pan-button:hover,[${ROOT}] .tm-pan-page:hover{background:#292944;border-color:#5b5b80}
            [${ROOT}] .tm-pan-button:disabled,[${ROOT}] .tm-pan-page:disabled{opacity:.45;cursor:default}
            [${ROOT}] .tm-pan-page[data-active="true"]{border-color:#7b79ff;background:#302c6f;color:#fff;font-weight:600}
            [${ROOT}] .tm-pan-meta{color:#a5a5ba;font-size:12px;line-height:18px}
            [${ROOT}] .tm-pan-list{display:flex;flex-direction:column;gap:4px;min-height:44px}
            [${ROOT}] .tm-pan-row{
                display:flex;align-items:center;gap:10px;min-height:44px;box-sizing:border-box;
                padding:7px 10px;border:1px solid #3f3f5f;border-radius:6px;background:#212134
            }
            [${ROOT}] .tm-pan-row:hover{border-color:#5b5b80;background:#24243a}
            [${ROOT}] .tm-pan-link{
                min-width:0;flex:1;overflow:hidden;color:#9593ff;font-size:13px;line-height:20px;
                text-decoration:none;text-overflow:ellipsis;white-space:nowrap
            }
            [${ROOT}] .tm-pan-link:hover{text-decoration:underline}
            [${ROOT}] .tm-pan-status{
                flex:0 0 auto;padding:3px 7px;border:1px solid #5b5b80;border-radius:5px;
                color:#dcdce4;font-size:11px;line-height:16px;text-transform:capitalize
            }
            [${ROOT}] .tm-pan-empty,[${ROOT}] .tm-pan-loading,[${ROOT}] .tm-pan-error{
                padding:10px 2px;color:#a5a5ba;font-size:13px;line-height:20px
            }
            [${ROOT}] .tm-pan-error{color:#ee5e52}
            [${ROOT}] .tm-pan-manage{align-self:flex-start;margin-top:2px}
            [${ROOT}]:not([${MANAGE}]) [${NATIVE}]{display:none!important}
            [${ROOT}][${MANAGE}] [${NATIVE_LIST}]{
                height:${NATIVE_HEIGHT}px!important;max-height:${NATIVE_HEIGHT}px!important;overflow-y:auto!important
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

    function getContext() {
        const match = location.pathname.match(
            /\/admin\/content-manager\/collection-types\/api::product\.product\/([^/?#]+)/
        );
        if (!match) return null;

        const params = new URLSearchParams(location.search);
        const productDocumentId = decodeURIComponent(match[1]);
        const locale = params.get('plugins[i18n][locale]') || 'ru';

        return { productDocumentId, locale, key: `${productDocumentId}:${locale}` };
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
            if (node.querySelector?.(FIELD) !== input) continue;

            const label = input.id
                ? node.querySelector(`label[for="${CSS.escape(input.id)}"]`)
                : null;

            if (label && node.querySelector('ol')) return node;
        }
        return null;
    }

    const nativeList = root => root?.querySelector('ol') || null;

    function nativeListContainer(root) {
        const list = nativeList(root);
        return list?.parentElement?.parentElement || null;
    }

    function findLoadMore(root) {
        return [...(root?.querySelectorAll('button') || [])]
            .find(button => /load more/i.test(button.textContent || '')) || null;
    }

    function markNative(root) {
        root.querySelectorAll(`[${NATIVE}]`).forEach(element => {
            element.removeAttribute(NATIVE);
            element.removeAttribute(NATIVE_LIST);
        });

        const listContainer = nativeListContainer(root);
        const loadMore = findLoadMore(root);

        if (listContainer) {
            listContainer.setAttribute(NATIVE, '');
            listContainer.setAttribute(NATIVE_LIST, '');
        }
        if (loadMore) loadMore.setAttribute(NATIVE, '');
    }

    function placePanelAfterNative(root, panel) {
        const listContainer = nativeListContainer(root);
        if (!listContainer?.parentElement) {
            if (!panel.parentElement) root.appendChild(panel);
            return;
        }

        const parent = listContainer.parentElement;
        const loadMore = findLoadMore(root);
        const anchor = (
            loadMore &&
            loadMore.parentElement === parent &&
            (listContainer.compareDocumentPosition(loadMore) & Node.DOCUMENT_POSITION_FOLLOWING)
        ) ? loadMore : listContainer;

        if (panel.previousElementSibling !== anchor) {
            anchor.insertAdjacentElement('afterend', panel);
        }
    }

    const nativeItemCount = root => nativeList(root)?.children.length || 0;

    function isBusy(button) {
        return !!button && (
            button.disabled ||
            button.getAttribute('aria-disabled') === 'true' ||
            button.getAttribute('data-state') === 'loading'
        );
    }

    async function waitForNativeAdvance(root, beforeCount, previousButton) {
        const started = performance.now();

        while (performance.now() - started < 5000) {
            await wait(100);
            const nextButton = findLoadMore(root);
            const nextCount = nativeItemCount(root);

            if (!nextButton) return true;
            if (nextCount > beforeCount) return true;
            if (nextButton !== previousButton && !isBusy(nextButton)) return true;
        }
        return false;
    }

    async function expandAllNative(current) {
        if (!current || current !== state || current.nativeLoading) return;

        current.nativeLoading = true;
        current.ui.manage.disabled = true;
        current.ui.manage.textContent = 'Загружаю все…';

        try {
            let guard = 0;

            while (
                current === state &&
                current.root.hasAttribute(MANAGE) &&
                guard++ < 100
            ) {
                let button = findLoadMore(current.root);
                if (!button) break;

                while (
                    current === state &&
                    current.root.hasAttribute(MANAGE) &&
                    button &&
                    isBusy(button)
                ) {
                    await wait(100);
                    button = findLoadMore(current.root);
                }
                if (!button) break;

                const beforeCount = nativeItemCount(current.root);
                button.click();

                const advanced = await waitForNativeAdvance(
                    current.root,
                    beforeCount,
                    button
                );

                markNative(current.root);
                placePanelAfterNative(current.root, current.ui.panel);

                if (!advanced) {
                    console.warn('[product-attributes-navigator] Load More did not advance');
                    break;
                }
            }
        } finally {
            if (current === state) {
                current.nativeLoading = false;
                scheduleReload(current);
                current.ui.manage.disabled = false;
                current.ui.manage.textContent = current.root.hasAttribute(MANAGE)
                    ? 'Скрыть управление'
                    : 'Управление связями';
            }
        }
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function createPanel() {
        const panel = el('div');
        panel.setAttribute(PANEL, '');

        const search = el('input', 'tm-pan-search');
        search.type = 'search';
        search.placeholder = 'Поиск';
        search.autocomplete = 'off';

        const meta = el('div', 'tm-pan-meta');
        const list = el('div', 'tm-pan-list');
        const footer = el('div', 'tm-pan-footer');
        const range = el('div', 'tm-pan-meta');
        const pages = el('div', 'tm-pan-pages');
        const manage = el('button', 'tm-pan-button tm-pan-manage', 'Управление связями');
        manage.type = 'button';

        footer.append(range, pages);
        panel.append(search, meta, list, footer, manage);

        return { panel, search, manage, meta, list, footer, range, pages };
    }

    function filteredItems(current) {
        const query = normalize(current.query);
        if (!query) return current.items;

        return current.items.filter(item =>
            normalize(item.name_web).includes(query) ||
            normalize(item.documentId).includes(query)
        );
    }

    const pageCount = total => Math.max(1, Math.ceil(total / UI_PAGE_SIZE));

    function visiblePages(page, count) {
        if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);
        return [...new Set([1, count, page - 1, page, page + 1])]
            .filter(value => value >= 1 && value <= count)
            .sort((a, b) => a - b);
    }

    function attributeUrl(item, locale) {
        const params = new URLSearchParams();
        params.set('plugins[i18n][locale]', item.locale || locale);

        return (
            `/admin/content-manager/collection-types/${ATTRIBUTE_UID}/` +
            `${encodeURIComponent(item.documentId)}?${params}`
        );
    }

    function renderPagination(current, total) {
        const count = pageCount(total);
        current.page = Math.min(Math.max(1, current.page), count);
        current.ui.pages.replaceChildren();

        const previous = el('button', 'tm-pan-page', '‹');
        previous.type = 'button';
        previous.disabled = current.page <= 1;
        previous.title = 'Предыдущая страница';
        previous.onclick = () => {
            current.page -= 1;
            render(current);
        };
        current.ui.pages.appendChild(previous);

        let last = 0;
        for (const page of visiblePages(current.page, count)) {
            if (last && page - last > 1) {
                current.ui.pages.appendChild(el('span', 'tm-pan-meta', '…'));
            }

            const button = el('button', 'tm-pan-page', String(page));
            button.type = 'button';
            button.dataset.active = String(page === current.page);
            button.onclick = () => {
                current.page = page;
                render(current);
            };
            current.ui.pages.appendChild(button);
            last = page;
        }

        const next = el('button', 'tm-pan-page', '›');
        next.type = 'button';
        next.disabled = current.page >= count;
        next.title = 'Следующая страница';
        next.onclick = () => {
            current.page += 1;
            render(current);
        };
        current.ui.pages.appendChild(next);
    }

    function render(current) {
        if (!current || current !== state) return;

        const { ui } = current;
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
        current.page = Math.min(Math.max(1, current.page), pageCount(filtered.length));

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
                const label = item.name_web || item.documentId;
                const link = el('a', 'tm-pan-link', label);

                link.href = attributeUrl(item, current.context.locale);
                link.title = label;

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
            `/content-manager/relations/${PRODUCT_UID}/` +
            `${encodeURIComponent(context.productDocumentId)}/attributes?${params}`,
            { method: 'GET', headers, credentials: 'include', signal }
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
            const first = await fetchRelations(
                current.context,
                1,
                current.abortController.signal
            );

            let items = Array.isArray(first.results) ? [...first.results] : [];
            const count = Number(first.pagination?.pageCount || 1);

            for (let page = 2; page <= count; page += 1) {
                const next = await fetchRelations(
                    current.context,
                    page,
                    current.abortController.signal
                );
                if (Array.isArray(next.results)) items.push(...next.results);
            }

            if (current !== state) return;
            current.items = items;
            current.page = 1;
        } catch (error) {
            if (error?.name === 'AbortError' || current !== state) return;
            current.error = error?.message || 'Не удалось загрузить торговые предложения';
            console.warn('[product-attributes-navigator]', error);
        } finally {
            if (current === state) {
                current.loading = false;
                render(current);
            }
        }
    }

    function scheduleReload(current) {
        if (!current || current !== state) return;
        clearTimeout(reloadTimer);

        reloadTimer = setTimeout(() => {
            if (current === state) loadAll(current);
        }, RELOAD_DELAY);
    }

    function bind(current) {
        current.ui.search.addEventListener('input', () => {
            current.query = current.ui.search.value;
            current.page = 1;
            render(current);
        });

        current.ui.manage.addEventListener('click', async () => {
            const open = current.root.hasAttribute(MANAGE);

            if (open) {
                current.root.removeAttribute(MANAGE);
                current.ui.manage.textContent = 'Управление связями';
                return;
            }

            current.root.setAttribute(MANAGE, '');
            markNative(current.root);
            placePanelAfterNative(current.root, current.ui.panel);
            current.ui.manage.textContent = 'Скрыть управление';
            await expandAllNative(current);
        });
    }

    function destroy() {
        clearTimeout(reloadTimer);
        reloadTimer = null;

        if (!state) return;

        state.abortController?.abort();
        state.root?.removeAttribute(ROOT);
        state.root?.removeAttribute(MANAGE);

        state.root?.querySelectorAll(`[${NATIVE}]`).forEach(element => {
            element.removeAttribute(NATIVE);
            element.removeAttribute(NATIVE_LIST);
        });

        state.ui?.panel?.remove();
        state = null;
    }

    function createState(context, input, root) {
        const ui = createPanel();

        root.setAttribute(ROOT, '');
        markNative(root);
        placePanelAfterNative(root, ui.panel);

        const current = {
            context,
            input,
            root,
            ui,
            items: [],
            query: '',
            page: 1,
            loading: false,
            nativeLoading: false,
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

        const input = document.querySelector(FIELD);
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
            placePanelAfterNative(root, state.ui.panel);
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
                (node.matches?.(FIELD) || node.querySelector?.(FIELD))
            );
        }

        if (!document.contains(state.input) || !document.contains(state.root)) return true;
        if (state.ui?.panel?.contains(mutation.target)) return false;

        const native = nativeListContainer(state.root);

        if (
            state.root.hasAttribute(MANAGE) &&
            !state.nativeLoading &&
            native &&
            (
                mutation.target === native ||
                native.contains(mutation.target) ||
                [...mutation.addedNodes].some(node =>
                    node instanceof Element &&
                    (
                        node === native ||
                        native.contains(node) ||
                        node.contains?.(native)
                    )
                )
            )
        ) {
            scheduleReload(state);
        }

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
