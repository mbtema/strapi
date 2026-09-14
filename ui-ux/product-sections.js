// ==StrapiExtension==
// @name         product-sections
// @version      1.0.1
// @description  Разделяет карточку товара на смысловые вкладки; первая версия выносит поля фильтров
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
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            ${ROOT_SELECTOR} {
                display: flex;
                align-items: center;
                gap: 6px;
                width: 100%;
                margin: 0 0 20px;
                padding: 0 0 10px;
                border-bottom: 1px solid #3f3f5f;
            }

            ${ROOT_SELECTOR} [data-tm-product-section-tab] {
                min-height: 34px;
                padding: 7px 12px;
                border: 1px solid transparent;
                border-radius: 6px;
                background: transparent;
                color: #a5a5ba;
                font: inherit;
                font-size: 13px;
                font-weight: 500;
                line-height: 18px;
                cursor: pointer;
            }

            ${ROOT_SELECTOR} [data-tm-product-section-tab]:hover {
                background: #212134;
                color: #dcdce4;
            }

            ${ROOT_SELECTOR} [data-tm-product-section-tab][aria-selected="true"] {
                border-color: #5b5b80;
                background: #302c6f;
                color: #ffffff;
                font-weight: 600;
            }

            [data-tm-product-section-hidden="true"] {
                display: none !important;
            }
        `;

        document.head.appendChild(style);
    }

    function normalizeHint(text) {
        return String(text || '').trim();
    }

    function getFieldName(marker) {
        const explicitName = marker.getAttribute?.('name');

        if (explicitName && !IGNORED_NAMES.has(explicitName)) {
            return explicitName;
        }

        if (marker.matches?.('p[id$="-hint"]')) {
            const hint = normalizeHint(marker.textContent);

            for (const field of FILTER_FIELDS) {
                if (hint === field || hint.endsWith(` ${field}`)) return field;
            }

            return hint || null;
        }

        if (marker.matches?.('label')) {
            const text = normalizeHint(marker.textContent);
            if (text.includes('relatedProductsSlider')) return 'relatedProductsSlider';
        }

        return null;
    }

    function getFieldMarkers(panel) {
        const markers = [
            ...panel.querySelectorAll('[name], p[id$="-hint"], label')
        ];

        return markers.filter(marker => {
            const fieldName = getFieldName(marker);
            return fieldName && !IGNORED_NAMES.has(fieldName);
        });
    }

    function hasOtherFieldMarker(element, sourceMarker, panel) {
        return getFieldMarkers(panel).some(marker =>
            marker !== sourceMarker &&
            element.contains(marker)
        );
    }

    function findFieldContainer(marker, panel) {
        if (!marker?.isConnected) return null;

        let node = marker;

        while (node?.parentElement && node.parentElement !== panel) {
            const parent = node.parentElement;

            if (hasOtherFieldMarker(parent, marker, panel)) {
                return node;
            }

            node = parent;
        }

        return marker.parentElement;
    }

    function getFieldContainers(panel) {
        const result = new Map();

        for (const marker of getFieldMarkers(panel)) {
            const fieldName = getFieldName(marker);
            if (!fieldName) continue;

            const container = findFieldContainer(marker, panel);
            if (!container || !container.isConnected) continue;

            if (!result.has(container)) {
                result.set(container, new Set());
            }

            result.get(container).add(fieldName);
        }

        return result;
    }

    function clearManagedVisibility() {
        document
            .querySelectorAll('[data-tm-product-section-hidden]')
            .forEach(element => {
                delete element.dataset.tmProductSectionHidden;
            });
    }

    function applyVisibility() {
        clearManagedVisibility();

        if (!isProductEntry() || !currentPanel) return;

        const containers = getFieldContainers(currentPanel);

        for (const [container, names] of containers) {
            const hasFilterField = [...names].some(name => FILTER_FIELDS.has(name));

            if (activeTab === 'filters' && !hasFilterField) {
                container.dataset.tmProductSectionHidden = 'true';
                continue;
            }

            if (activeTab === 'content' && hasFilterField) {
                container.dataset.tmProductSectionHidden = 'true';
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

        const tabs = [
            ['content', 'Контент'],
            ['filters', 'Фильтры']
        ];

        for (const [key, label] of tabs) {
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
        const marker = document.querySelector(
            '[name="effect"], [name="is_hypoallergenic"], p[id$="-hint"]'
        );

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
