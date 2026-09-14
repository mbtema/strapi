// ==StrapiExtension==
// @name         product-sections
// @version      1.0.3
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
            ${ROOT_SELECTOR} { display:flex; align-items:center; gap:6px; width:100%; margin:0 0 20px; padding:0 0 10px; border-bottom:1px solid #3f3f5f; }
            ${ROOT_SELECTOR} [data-tm-product-section-tab] { min-height:34px; padding:7px 12px; border:1px solid transparent; border-radius:6px; background:transparent; color:#a5a5ba; font:inherit; font-size:13px; font-weight:500; line-height:18px; cursor:pointer; }
            ${ROOT_SELECTOR} [data-tm-product-section-tab]:hover { background:#212134; color:#dcdce4; }
            ${ROOT_SELECTOR} [data-tm-product-section-tab][aria-selected="true"] { border-color:#5b5b80; background:#302c6f; color:#fff; font-weight:600; }
            [data-tm-product-section-hidden="true"] { display:none !important; }
        `;
        document.head.appendChild(style);
    }

    function normalizeFieldName(value) {
        const text = String(value || '').trim();
        if (!text) return '';
        if (FILTER_FIELDS.has(text)) return text;

        const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
            if (FILTER_FIELDS.has(lines[i])) return lines[i];
        }
        return text;
    }

    function getCanonicalMarkers(panel) {
        const markers = [...panel.querySelectorAll('p[id$="-hint"]')]
            .map(element => ({ element, name: normalizeFieldName(element.textContent) }))
            .filter(item => item.name);

        const sliderLabel = [...panel.querySelectorAll('label')]
            .find(label => (label.textContent || '').includes('relatedProductsSlider'));

        if (sliderLabel) markers.push({ element: sliderLabel, name: 'relatedProductsSlider' });
        return markers;
    }

    function containsAnotherMarker(element, sourceElement, markers) {
        return markers.some(({ element: marker }) => marker !== sourceElement && element.contains(marker));
    }

    function findFieldContainer(marker, panel, markers) {
        if (!marker?.isConnected) return null;
        let node = marker;
        while (node?.parentElement && node.parentElement !== panel) {
            const parent = node.parentElement;
            if (containsAnotherMarker(parent, marker, markers)) return node;
            node = parent;
        }
        return node || marker.parentElement;
    }

    function getFieldContainers(panel) {
        const markers = getCanonicalMarkers(panel);
        const result = new Map();
        for (const { element, name } of markers) {
            const container = findFieldContainer(element, panel, markers);
            if (!container || !container.isConnected) continue;
            if (!result.has(container)) result.set(container, new Set());
            result.get(container).add(name);
        }
        return result;
    }

    function clearManagedVisibility() {
        document.querySelectorAll('[data-tm-product-section-hidden]').forEach(element => {
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
            root.querySelectorAll('[data-tm-product-section-tab]').forEach(button => {
                button.setAttribute('aria-selected', String(button.dataset.tmProductSectionTab === tab));
            });
        }
        applyVisibility();
    }

    function createTabs(panel) {
        const root = document.createElement('div');
        root.dataset.tmProductSections = 'true';
        root.setAttribute('role', 'tablist');
        root.setAttribute('aria-label', 'Разделы карточки товара');
        for (const [key, label] of [['content', 'Контент'], ['filters', 'Фильтры']]) {
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
        const marker = document.querySelector('p[id$="-hint"]');
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
        if (currentPanel && currentPanel !== panel) cleanup();
        currentPanel = panel;
        let root = panel.querySelector(`:scope > ${ROOT_SELECTOR}`);
        if (!root) root = createTabs(panel);
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
        observer.observe(document.documentElement, { childList: true, subtree: true });
        window.addEventListener('popstate', scheduleApply);
        scheduleApply();
    }

    start();
})();
