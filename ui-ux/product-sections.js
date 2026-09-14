// ==StrapiExtension==
// @name         product-sections
// @version      1.0.0
// @description  Разделяет карточку товара на смысловые вкладки; первая версия выносит поля фильтров
// ==/StrapiExtension==

(function () {
    'use strict';

    const PRODUCT_PATH = '/admin/content-manager/collection-types/api::product.product/';
    const ROOT_SELECTOR = '[data-tm-product-sections="true"]';
    const STYLE_ID = 'tm-product-sections-style';

    const FILTER_FIELDS = new Set([
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

    const IGNORED_NAMED_CONTROLS = new Set([
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

    function getNamedControls(root = document) {
        return [...root.querySelectorAll('input[name], textarea[name], select[name]')]
            .filter(control => {
                const name = control.getAttribute('name');
                return name && !IGNORED_NAMED_CONTROLS.has(name);
            });
    }

    function findFieldContainer(control) {
        if (!control?.isConnected) return null;

        let node = control;

        while (node?.parentElement) {
            const parent = node.parentElement;

            if (
                parent.matches('form') ||
                parent.matches('[role="tabpanel"]') ||
                parent === document.body
            ) {
                break;
            }

            const siblingsWithFields = [...parent.children]
                .filter(child => child !== node)
                .some(child => getNamedControls(child).length > 0);

            if (siblingsWithFields) {
                return node;
            }

            node = parent;
        }

        return control.parentElement;
    }

    function getFieldContainers() {
        const controls = getNamedControls();
        const byContainer = new Map();

        for (const control of controls) {
            const name = control.getAttribute('name');
            if (!name) continue;

            const container = findFieldContainer(control);
            if (!container || !container.isConnected) continue;

            if (!byContainer.has(container)) {
                byContainer.set(container, new Set());
            }

            byContainer.get(container).add(name);
        }

        return byContainer;
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

        if (!isProductEntry()) return;

        const containers = getFieldContainers();

        for (const [container, names] of containers) {
            const hasFilterField = [...names].some(name => FILTER_FIELDS.has(name));
            const hasContentField = [...names].some(name => !FILTER_FIELDS.has(name));

            if (activeTab === 'filters' && !hasFilterField) {
                container.dataset.tmProductSectionHidden = 'true';
                continue;
            }

            if (activeTab === 'content' && hasFilterField && !hasContentField) {
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
        const filterControl = [...FILTER_FIELDS]
            .map(name => document.querySelector(`[name="${CSS.escape(name)}"]`))
            .find(Boolean);

        const anyControl = filterControl || getNamedControls()[0];
        if (!anyControl) return null;

        return anyControl.closest('[role="tabpanel"]');
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
