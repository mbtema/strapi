(function () {
    'use strict';

    const PATH = '/admin/content-manager/collection-types/api::attribute.attribute/';
    const ROOT = '[data-tm-attribute-sections="true"]';
    const HIDDEN = 'data-tm-attribute-section-hidden';
    const STYLE_ID = 'tm-attribute-sections-style';
    const TABS = [
        ['content', 'Контент'],
        ['ar', 'AR'],
        ['marketing', 'Маркетинг'],
        ['system', 'Системное']
    ];
    const SECTIONS = {
        content: new Set(['active', 'detail_picture', 'shade', 'volume', 'barcode', 'product']),
        ar: new Set(['isArTryOnAvailable', 'arSupportsIntensity', 'arTexture', 'arType']),
        marketing: new Set(['label_sales', 'label_new', 'label_hit', 'label_exclusive', 'home_new_priority', 'home_hit_priority'])
    };
    const MEDIA = new Set(['detail_picture', 'preview_picture']);
    const MEDIA_LABELS = new Map([
        ['Основная картинка', 'detail_picture'],
        ['Картинка для анонса', 'preview_picture']
    ]);
    let activeTab = 'content';
    let currentPanel = null;
    let currentPath = '';
    let frame = 0;
    let warnedPanel = null;

    window.__tmAttributeSectionsCleanup?.();

    function section(name) {
        return Object.keys(SECTIONS).find(key => SECTIONS[key].has(name)) || 'system';
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            ${ROOT} {
                display:flex !important;
                align-items:center !important;
                flex-wrap:wrap;
                gap:6px !important;
                width:100% !important;
                margin:0 0 12px !important;
                padding:0 !important;
                border:0 !important;
                box-shadow:none !important;
            }
            ${ROOT} [role="tab"] {
                min-height:34px;
                padding:7px 12px;
                border:1px solid transparent;
                border-radius:6px;
                background:transparent;
                color:var(--tm-ds-neutral600,#a5a5ba);
                font:inherit;
                font-size:13px;
                font-weight:500;
                line-height:18px;
                cursor:pointer;
            }
            ${ROOT} [role="tab"]:hover {
                background:var(--tm-ds-neutral150,#212134);
                color:var(--tm-ds-neutral800,#dcdce4);
            }
            ${ROOT} [role="tab"][aria-selected="true"] {
                border-color:var(--tm-ds-primary600,#5b5b80);
                background:var(--tm-ds-primary100,#302c6f);
                color:var(--tm-ds-primary700,#fff);
                font-weight:600;
            }
            ${ROOT} [role="tab"]:focus-visible {
                outline:2px solid var(--tm-ds-primary600,#7b79ff);
                outline-offset:2px;
            }
            [${HIDDEN}] { display:none !important; }
        `;
        document.head.appendChild(style);
    }

    function getMarkers(panel) {
        const markers = [...panel.querySelectorAll('input[name], textarea[name], select[name], [role="combobox"][name]')]
            .map(element => ({ element, name: element.getAttribute('name') }))
            .filter(item => item.name);
        const names = new Set(markers.map(item => item.name));
        for (const hint of panel.querySelectorAll('p[id$="-hint"]')) {
            const name = hint.textContent.trim();
            if (MEDIA.has(name) && !names.has(name)) {
                markers.push({ element: hint, name });
                names.add(name);
            }
        }
        for (const label of panel.querySelectorAll('label')) {
            const name = MEDIA_LABELS.get(label.textContent.trim());
            if (name && !names.has(name)) {
                markers.push({ element: label, name });
                names.add(name);
            }
        }
        return markers;
    }

    function findStack(panel, markers) {
        if (markers.length < 2) return null;
        let node = markers[0].element.parentElement;
        while (node && node !== panel) {
            if (markers.every(item => node.contains(item.element))) return node;
            node = node.parentElement;
        }
        return null;
    }

    function childUnder(node, parent) {
        if (!parent.contains(node) || node === parent) return null;
        while (node.parentElement && node.parentElement !== parent) node = node.parentElement;
        return node.parentElement === parent ? node : null;
    }

    function clearVisibility() {
        document.querySelectorAll('[' + HIDDEN + ']').forEach(node => node.removeAttribute(HIDDEN));
    }

    function applyVisibility(panel) {
        const markers = getMarkers(panel);
        const stack = findStack(panel, markers);
        if (!stack || stack.children.length < 2) {
            clearVisibility();
            if (warnedPanel !== panel) {
                warnedPanel = panel;
                console.warn('[attribute-sections] Не найден контейнер полей карточки');
            }
            return false;
        }
        warnedPanel = null;
        const rows = new Map();
        for (const item of markers) {
            const row = childUnder(item.element, stack);
            if (!row) continue;
            const branch = childUnder(item.element, row) || row;
            if (!rows.has(row)) rows.set(row, new Map());
            const branches = rows.get(row);
            if (!branches.has(branch)) branches.set(branch, new Set());
            branches.get(branch).add(section(item.name));
        }
        const hidden = new Set();
        for (const [row, branches] of rows) {
            let visible = false;
            for (const [branch, sections] of branches) {
                if (sections.has(activeTab)) visible = true;
                else hidden.add(branch);
            }
            const unknown = [...row.children].some(child =>
                !branches.has(row) && !branches.has(child));
            if (!visible && !unknown) hidden.add(row);
        }
        document.querySelectorAll('[' + HIDDEN + ']').forEach(node => {
            if (!hidden.has(node)) node.removeAttribute(HIDDEN);
        });
        for (const node of hidden) {
            if (!node.hasAttribute(HIDDEN)) node.setAttribute(HIDDEN, '');
        }
        return true;
    }

    function selectTab(root, key, focus = false) {
        activeTab = key;
        for (const button of root.querySelectorAll('[role="tab"]')) {
            const selected = button.dataset.tmAttributeSectionTab === key;
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected ? 0 : -1;
            if (selected && focus) button.focus();
        }
        if (currentPanel && document.contains(currentPanel)) applyVisibility(currentPanel);
    }

    function createTabs(panel) {
        const root = document.createElement('div');
        root.dataset.tmCreated = 'attribute-sections';
        root.dataset.tmAttributeSections = 'true';
        root.setAttribute('role', 'tablist');
        root.setAttribute('aria-label', 'Разделы карточки предложения');
        for (const [key, label] of TABS) {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.tmAttributeSectionTab = key;
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-selected', String(activeTab === key));
            button.tabIndex = activeTab === key ? 0 : -1;
            button.textContent = label;
            button.addEventListener('click', () => selectTab(root, key));
            button.addEventListener('keydown', event => {
                const index = TABS.findIndex(item => item[0] === key);
                let next;
                if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
                else if (event.key === 'ArrowLeft') next = (index + TABS.length - 1) % TABS.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = TABS.length - 1;
                else return;
                event.preventDefault();
                selectTab(root, TABS[next][0], true);
            });
            root.appendChild(button);
        }
        panel.insertBefore(root, panel.firstChild);
    }

    function clearPanel() {
        clearVisibility();
        document.querySelectorAll(ROOT).forEach(root => root.remove());
        currentPanel = null;
        warnedPanel = null;
    }

    function apply() {
        const path = location.pathname;
        if (!path.startsWith(PATH)) {
            if (currentPanel || currentPath) clearPanel();
            currentPath = '';
            activeTab = 'content';
            return;
        }
        if (currentPath !== path) {
            clearPanel();
            currentPath = path;
            activeTab = 'content';
        }
        const panel = [...document.querySelectorAll('main [role="tabpanel"][data-state="active"]')]
            .find(node => node.querySelector('[name="barcode"], [name="name_web"]'));
        if (!panel || panel !== currentPanel) {
            if (currentPanel) clearPanel();
            currentPanel = panel || null;
        }
        if (!panel) return;
        ensureStyle();
        if (!applyVisibility(panel)) {
            panel.querySelector(ROOT)?.remove();
            return;
        }
        if (!panel.querySelector(ROOT)) createTabs(panel);
    }

    function schedule() {
        if (frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            apply();
        });
    }

    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList:true, subtree:true, attributes:true, attributeFilter:['data-state'] });
    window.addEventListener('popstate', schedule);
    window.__tmAttributeSectionsCleanup = () => {
        observer.disconnect();
        window.removeEventListener('popstate', schedule);
        if (frame) cancelAnimationFrame(frame);
        clearPanel();
        document.getElementById(STYLE_ID)?.remove();
    };
    schedule();
})();
