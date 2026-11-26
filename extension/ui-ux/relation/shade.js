(function () {
    'use strict';

    const TARGET = 'api::shade.shade';
    const CLEANUP = '__tmRelationShadeCleanup';
    const MARK = 'data-tm-relation-shade';
    const ROW = 'ol > li[aria-describedby]';
    const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
    const CACHE_TTL = 60000;
    const ERROR_TTL = 15000;
    const MAX_PARALLEL = 3;

    window[CLEANUP]?.();

    const cache = new Map();
    const queue = [];
    const tracked = new Set();
    const controller = new AbortController();
    let pending = 0;
    let frame = 0;
    let stopped = false;

    function currentFiber(node) {
        const key = Object.keys(node).find(key => key.startsWith('__reactFiber$'));
        const fiber = key ? node[key] : null;
        if (!fiber) return null;

        function committed(candidate) {
            let root = candidate;
            while (root?.return) root = root.return;
            return root?.stateNode?.current === root;
        }

        if (committed(fiber)) return fiber;
        if (fiber.alternate && committed(fiber.alternate)) return fiber.alternate;
        return null;
    }

    function identity(button, row) {
        let fiber = currentFiber(button);

        while (fiber && fiber.stateNode !== row) {
            const relation = fiber.memoizedProps?.relation;
            if (relation?.model && typeof relation.documentId === 'string') {
                if (relation.model !== TARGET || !/^[a-z0-9]+$/i.test(relation.documentId)) return null;
                const locale = relation.params?.locale ??
                    new URLSearchParams(location.search).get('plugins[i18n][locale]') ?? '';
                return { documentId: relation.documentId, locale };
            }
            fiber = fiber.return;
        }

        return null;
    }

    function clear(button) {
        button.removeAttribute(MARK);
        window.__tmStrapiDesignSystem?.setColorSwatch(button, [], true);
        tracked.delete(button);
    }

    function paint(button, colors, key) {
        if (!window.__tmStrapiDesignSystem?.setColorSwatch(button, colors, true)) {
            clear(button);
            return;
        }
        if (button.getAttribute(MARK) !== key) button.setAttribute(MARK, key);
        tracked.add(button);
    }

    function getToken() {
        const raw = localStorage.getItem('jwtToken');
        if (!raw) return '';
        try {
            const parsed = JSON.parse(raw);
            return typeof parsed === 'string' ? parsed : '';
        } catch {
            return raw;
        }
    }

    async function load(entry) {
        const params = new URLSearchParams();
        if (entry.locale) params.set('locale', entry.locale);
        const query = params.toString();
        const headers = { Accept: 'application/json' };
        const token = getToken();
        if (token) headers.Authorization = 'Bearer ' + token;

        const response = await fetch(
            '/content-manager/collection-types/' + TARGET + '/' +
            encodeURIComponent(entry.documentId) + (query ? '?' + query : ''),
            { method: 'GET', headers, credentials: 'include', signal: controller.signal }
        );

        if (!response.ok) throw new Error('Shade API: ' + response.status);
        const data = (await response.json())?.data;
        if (data?.documentId !== entry.documentId || !Array.isArray(data.hexes)) {
            throw new Error('Не удалось подтвердить HEX выбранного оттенка');
        }
        return data.hexes.map(item => String(item?.hex || '').trim()).filter(value => HEX.test(value));
    }

    function pump() {
        while (!stopped && pending < MAX_PARALLEL && queue.length) {
            const entry = queue.shift();
            pending++;
            load(entry).then(colors => {
                entry.colors = colors;
                entry.expires = Date.now() + CACHE_TTL;
            }).catch(error => {
                entry.colors = [];
                entry.expires = Date.now() + ERROR_TTL;
                if (!stopped) console.warn('[relationShade]', entry.documentId, error);
            }).finally(() => {
                entry.loading = false;
                pending--;
                schedule();
                pump();
            });
        }
    }

    function lookup(key, relation) {
        let entry = cache.get(key);
        if (entry?.loading || (entry && entry.expires > Date.now())) return entry;

        entry = { ...relation, loading: true, colors: [], expires: 0 };
        cache.set(key, entry);
        queue.push(entry);
        pump();
        return entry;
    }

    function apply() {
        const seen = new Set();
        if (location.pathname.startsWith('/admin/content-manager/')) {
            for (const row of document.querySelectorAll(ROW)) {
                if (row.closest('[hidden], [inert], [role="tabpanel"][data-state="inactive"], [data-tm-attribute-section-hidden], [data-tm-product-section-hidden]')) continue;
                for (const button of row.querySelectorAll('button[type="button"], a[href]')) {
                    if (button.closest(ROW) !== row) continue;
                    const relation = identity(button, row);
                    if (!relation) continue;
                    const key = relation.documentId + ':' + relation.locale;
                    seen.add(button);
                    const entry = lookup(key, relation);
                    if (entry.loading) {
                        if (button.getAttribute(MARK) !== key) clear(button);
                    } else {
                        paint(button, entry.colors, key);
                    }
                    break;
                }
            }
        }

        for (const button of tracked) {
            if (!seen.has(button)) clear(button);
        }
    }

    function schedule() {
        if (stopped || frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            apply();
        });
    }

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-state', 'hidden', 'inert', 'data-tm-attribute-section-hidden', 'data-tm-product-section-hidden']
    });
    window.addEventListener('popstate', schedule);

    window[CLEANUP] = () => {
        stopped = true;
        observer.disconnect();
        window.removeEventListener('popstate', schedule);
        cancelAnimationFrame(frame);
        controller.abort();
        queue.length = 0;
        cache.clear();
        for (const button of tracked) clear(button);
    };

    schedule();
})();
