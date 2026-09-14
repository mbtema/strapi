// ==StrapiExtension==
// @name         product-sections
// @version      1.1.0
// @description  Разделяет карточку товара на вкладки Контент, Фильтры и Системное
// ==/StrapiExtension==

(function () {
    'use strict';

    const PRODUCT_PATH = '/admin/content-manager/collection-types/api::product.product/';
    const ROOT_SELECTOR = '[data-tm-product-sections="true"]';
    const STYLE_ID = 'tm-product-sections-style';

    const FILTER_FIELDS = new Set([
        'is_hypoallergenic',
        'effect',
        'fragrance_group',
        'fragrance_concentration',
        'skin_types',
        'hair_types',
        'product_effects',
        'product_form',
        'spf_value',
        'usage_time',
        'ingredients',
        'product_segment',
        'age_group',
        'shade_groups',
        'release_form',
        'finish',
        'coverage',
        'product_features'
    ]);

    const SYSTEM_FIELDS = new Set([
        'relatedProductsSlider',
        'seo_description',
        'seo_name',
        'key',
        'code_1c',
        'bitrix_id',
        'xml_id',
        'code',
        'sort',
        'shareUrl'
    ]);

    const CONTENT_HINT_FIELDS = new Set([
        'detail_picture',
        'preview_picture',
        'pictures',
        'detail_text',
        'composition'
    ]);

    const IGNORED_NAMES = new Set([
        'Bold',
        'Italic',
        'Underline',
        'Strikethrough',
        'Bulleted list',
        'Numbered list',
        'Code',
        'Quote',
        'Link',
        'Image'
    ]);

    let activeTab = 'content';
    let frameScheduled = false;
    let currentPanel = null;

    function isProductEntry() {
        return location.pathname.startsWith(PRODUCT_PATH);
    }

    function ensureStyle() {
        let style = document.getElementById(STYLE_ID);

        if (!style) {
            style = document.createElement('style');
            style.id = STYLE_ID;
            document.head.appendChild(style);
        }

        style.textContent = `
            ${ROOT_SELECTOR} {
                display:flex !important;
                align-items:center !important;
                gap:6px !important;
                width:100% !important;
                margin:0 0 12px !important;
                padding:0 !important;
                border:0 !important;
                border-bottom:0 !important;
                box-shadow:none !important;
            }
            ${ROOT_SELECTOR}::before,
            ${ROOT_SELECTOR}::after {
                content:none !important;
                display:none !important;
                border:0 !important;
                box-shadow:none !important;
            }
            ${ROOT_SELECTOR} [data-tm-product-section-tab] {
                min-height:34px;
                padding:7px 12px;
                border:1px solid transparent;
                border-radius:6px;
                background:transparent;
                color:#a5a5ba;
                font:inherit;
                font-size:13px;
                font-weight:500;
                line-height:18px;
                cursor:pointer;
            }
            ${ROOT_SELECTOR} [data-tm-product-section-tab]:hover {
                background:#212134;
                color:#dcdce4;
            }
            ${ROOT_SELECTOR} [data-tm-product-section-tab][aria-selected="true"] {
                border-color:#5b5b80;
                background:#302c6f;
                color:#fff;
                font-weight:600;
            }
            [data-tm-product-section-hidden="true"] {
                display:none !important;
            }
        `;
    }

    function getNamedFieldMarkers(panel) {
        return [...panel.querySelectorAll('[name]')]
            .map(element => ({
                element,
                name: String(element.getAttribute('name') || '').trim()
            }))
            .filter(({ name }) => name && !IGNORED_NAMES.has(name));
    }

    function getSupplementalMarkers(panel, namedMarkers) {
        const namedNames = new Set(namedMarkers.map(({ name }) => name));
        const result = [];

        for (const hint of panel.querySelectorAll('p[id$="-hint"]')) {
            const lines = String(hint.textContent || '')
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(Boolean);

            const name = lines.find(line => CONTENT_HINT_FIELDS.has(line));
            if (!name || namedNames.has(name)) continue;

            result.push({ element: hint, name });
        }

        const sliderLabel = [...panel.querySelectorAll('label')]
            .find(label => (label.textContent || '').includes('relatedProductsSlider'));

        if (sliderLabel) {
            result.push({
                element: sliderLabel,
                name: 'relatedProductsSlider'
            });
        }

        return result;
    }

    function getCanonicalMarkers(panel) {
        const namedMarkers = getNamedFieldMarkers(panel);
        return [
            ...namedMarkers,
            ...getSupplementalMarkers(panel, namedMarkers)
        ];
    }

    function getAncestors(element, stopAt) {
        const result = [];
        let node = element;

        while (node && node !== stopAt) {
            result.push(node);
            node = node.parentElement;
        }

        if (stopAt) result.push(stopAt);
        return result;
    }

    function findFieldStack(panel, markers) {
        if (!markers.length) return null;

        const ancestorSets = markers.map(({ element }) =>
            new Set(getAncestors(element, panel))
        );

        for (const candidate of getAncestors(markers[0].element, panel)) {
            if (candidate === panel) break;

            if (ancestorSets.every(set => set.has(candidate))) {
                return candidate;
            }
        }

        return null;
    }

    function directChildUnder(element, ancestor) {
        if (!element || !ancestor || !ancestor.contains(element)) return null;

        let node = element;

        while (node?.parentElement && node.parentElement !== ancestor) {
            node = node.parentElement;
        }

        return node?.parentElement === ancestor ? node : null;
    }

    function clearManagedVisibility() {
        document
            .querySelectorAll('[data-tm-product-section-hidden]')
            .forEach(element => {
                delete element.dataset.tmProductSectionHidden;
            });
    }

    function getSection(names) {
        if ([...names].some(name => SYSTEM_FIELDS.has(name))) return 'system';
        if ([...names].some(name => FILTER_FIELDS.has(name))) return 'filters';
        return 'content';
    }

    function shouldShow(names) {
        return getSection(names) === activeTab;
    }

    function applyVisibility() {
        clearManagedVisibility();

        if (!isProductEntry() || !currentPanel) return;

        const markers = getCanonicalMarkers(currentPanel);
        const stack = findFieldStack(currentPanel, markers);

        if (!stack) {
            console.warn('[product-sections] Не найден контейнер строк карточки товара');
            return;
        }

        const rows = new Map();

        for (const marker of markers) {
            const row = directChildUnder(marker.element, stack);
            if (!row) continue;

            if (!rows.has(row)) rows.set(row, []);
            rows.get(row).push(marker);
        }

        for (const [row, rowMarkers] of rows) {
            const branches = new Map();

            for (const marker of rowMarkers) {
                const branch = directChildUnder(marker.element, row) || row;
                if (!branches.has(branch)) branches.set(branch, new Set());
                branches.get(branch).add(marker.name);
            }

            let visibleBranches = 0;

            for (const [branch, names] of branches) {
                if (shouldShow(names)) {
                    visibleBranches += 1;
                } else {
                    branch.dataset.tmProductSectionHidden = 'true';
                }
            }

            if (visibleBranches === 0) {
                row.dataset.tmProductSectionHidden = 'true';
            }
        }
    }

    function setActiveTab(tab) {
        activeTab = tab;

        const root = document.querySelector(ROOT_SELECTOR);
        if (root) {
            root.querySelectorAll('[data-tm-product-section-tab]')
                .forEach(button => {
                    button.setAttribute(
                        'aria-selected',
                        String(button.dataset.tmProductSectionTab === tab)
                    );
                });
        }

        applyVisibility();
    }

    function createTabs(panel) {
        const root = document.createElement('div');
        root.dataset.tmProductSections = 'true';
        root.setAttribute('role', 'tablist');
        root.setAttribute('aria-label', 'Разделы карточки товара');

        for (const [key, label] of [
            ['content', 'Контент'],
            ['filters', 'Фильтры'],
            ['system', 'Системное']
        ]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.tmProductSectionTab = key;
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-selected', String(key === activeTab));
            button.textContent = label;
            button.addEventListener('click', () => setActiveTab(key));
            root.appendChild(button);
        }

        panel.insertBefore(root, panel.firstChild);
        return root;
    }

    function findFieldsPanel() {
        const marker = document.querySelector('[name="name"], [name="effect"], [name="spf_value"]');
        return marker?.closest('[role="tabpanel"]') || null;
    }

    function cleanup() {
        clearManagedVisibility();

        const root = document.querySelector(ROOT_SELECTOR);
        if (root) root.remove();

        currentPanel = null;
        activeTab = 'content';
    }

    function apply() {
        if (!isProductEntry()) {
            if (currentPanel || document.querySelector(ROOT_SELECTOR)) cleanup();
            return;
        }

        ensureStyle();

        const panel = findFieldsPanel();
        if (!panel) return;

        if (currentPanel && currentPanel !== panel) {
            cleanup();
        }

        currentPanel = panel;

        let root = panel.querySelector(`:scope > ${ROOT_SELECTOR}`);
        if (!root) {
            root = createTabs(panel);
        }

        if (!document.contains(root)) return;

        applyVisibility();
    }

    function scheduleApply() {
        if (frameScheduled) return;
        frameScheduled = true;

        requestAnimationFrame(() => {
            frameScheduled = false;
            apply();
        });
    }

    const observer = new MutationObserver(scheduleApply);

    function start() {
        if (!document.documentElement) {
            requestAnimationFrame(start);
            return;
        }

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        window.addEventListener('popstate', scheduleApply);
        scheduleApply();
    }

    start();
})();
