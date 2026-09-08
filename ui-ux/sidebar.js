// ==StrapiExtension==
// @name         sidebar
// @version      2.1.0
// @description  Единый UI/UX sidebar: глобальная навигация, Alt+S, поиск, быстрый доступ, группы и future-safe fallback
// ==/StrapiExtension==

(function () {
    'use strict';

    const STYLE_ID = 'tm-sidebar-style';

    const GLOBAL_NAV_ATTR = 'data-tm-global-nav';
    const GLOBAL_LOGO_ATTR = 'data-tm-global-logo-hidden';
    const GLOBAL_TOP_SEPARATOR_ATTR = 'data-tm-global-top-separator-hidden';
    const GLOBAL_PROFILE_ATTR = 'data-tm-global-profile';
    const GLOBAL_PROFILE_SEPARATOR_ATTR = 'data-tm-global-profile-separator-hidden';

    const SIDEBAR_ATTR = 'data-tm-content-manager-sidebar';
    const CLEANUP_ATTR = 'data-tm-sidebar-cleanup';
    const LIST_ATTR = 'data-tm-sidebar-main-list';
    const HIDDEN_ATTR = 'data-tm-sidebar-hidden';
    const SINGLE_SOURCE_ATTR = 'data-tm-sidebar-single-source-hidden';
    const SINGLE_WRAPPER_ATTR = 'data-tm-sidebar-single-wrapper-hidden';
    const ACTIVE_ATTR = 'data-tm-sidebar-active-collection';
    const TOOLBAR_ATTR = 'data-tm-sidebar-toolbar';
    const GROUP_HEADER_ATTR = 'data-tm-sidebar-group-header';
    const GROUP_ITEM_ATTR = 'data-tm-sidebar-group-item';
    const QUICK_ATTR = 'data-tm-sidebar-quick';

    const SIDEBAR_SELECTOR = 'nav[aria-label="Content Manager"]';
    const COLLECTION_LINK_SELECTOR = 'a[href*="/admin/content-manager/collection-types/"]';
    const SINGLE_LINK_SELECTOR = 'a[href*="/admin/content-manager/single-types/"]';

    const GROUPS = [
        {
            id: 'catalog',
            title: 'Каталог',
            collapsed: false,
            uids: [
                'api::product.product',
                'api::attribute.attribute',
                'api::category.category',
                'api::brand.brand',
                'api::promotion.promotion',
                'api::page.page'
            ]
        },
        {
            id: 'reference',
            title: 'Справочник',
            collapsed: false,
            uids: [
                'api::city.city',
                'api::shop.shop',
                'api::delivery-method.delivery-method',
                'api::menu-item.menu-item',
                'api::gift-certificate.gift-certificate',
                'api::feedback-contact-info.feedback-contact-info',
                'api::feedback-contact-method.feedback-contact-method',
                'api::feedback-topic.feedback-topic'
            ]
        },
        {
            id: 'filters',
            title: 'Фильтры',
            collapsed: true,
            fallbackCollections: true
        },
        {
            id: 'other',
            title: 'Прочее',
            collapsed: false,
            singleTypes: true
        }
    ];

    const QUICK_LINKS = [
        { uid: 'api::product.product', label: 'Товары' },
        { uid: 'api::attribute.attribute', label: 'Предложения' }
    ];

    const SINGLE_ORDER = new Map([
        ['home page', 0],
        ['web-home-page', 1],
        ['блок рекомендаций', 2]
    ]);

    const collapsedGroups = new Map(
        GROUPS.map(group => [group.id, group.collapsed])
    );

    let hidden = true;
    let sidebar = null;
    let collectionList = null;
    let singleSourceList = null;
    let toolbar = null;
    let layout = null;
    let main = null;
    let originalLayout = null;
    let scheduled = false;
    let lastPath = '';
    let searchQuery = '';

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            nav li:has(> span > a[aria-label="Settings"][href^="/admin/settings"]) {
                display: none !important;
            }

            [${GLOBAL_LOGO_ATTR}],
            [${GLOBAL_TOP_SEPARATOR_ATTR}],
            [${GLOBAL_PROFILE_SEPARATOR_ATTR}],
            [${HIDDEN_ATTR}],
            [${SINGLE_SOURCE_ATTR}],
            [${SINGLE_WRAPPER_ATTR}] {
                display: none !important;
            }

            [${GLOBAL_NAV_ATTR}] > ul {
                margin-top: 0 !important;
                padding-top: 22px !important;
            }

            [${GLOBAL_PROFILE_ATTR}] {
                border-top: 0 !important;
                border-block-start: 0 !important;
                box-shadow: none !important;
            }

            [${GLOBAL_PROFILE_ATTR}]::before,
            [${GLOBAL_PROFILE_ATTR}]::after {
                content: none !important;
                display: none !important;
            }

            [${SIDEBAR_ATTR}],
            [${SIDEBAR_ATTR}] * {
                scrollbar-width: none !important;
                -ms-overflow-style: none !important;
            }

            [${SIDEBAR_ATTR}]::-webkit-scrollbar,
            [${SIDEBAR_ATTR}] *::-webkit-scrollbar {
                width: 0 !important;
                height: 0 !important;
                display: none !important;
            }

            [${SIDEBAR_ATTR}] li {
                list-style: none !important;
            }

            [${SIDEBAR_ATTR}] li::marker,
            [${SIDEBAR_ATTR}] li::before {
                content: none !important;
                display: none !important;
            }

            [${CLEANUP_ATTR}] {
                width: 320px !important;
                min-width: 320px !important;
                max-width: 320px !important;
            }

            [${CLEANUP_ATTR}] [${LIST_ATTR}] {
                margin: 0 !important;
                padding: 0 10px 16px !important;
            }

            [${TOOLBAR_ATTR}] {
                position: sticky;
                top: 0;
                z-index: 5;
                display: flex;
                flex-direction: column;
                gap: 8px;
                padding: 12px 16px 12px;
                background: #181826;
                border: 0 !important;
                box-shadow: none !important;
            }

            [${TOOLBAR_ATTR}]::before,
            [${TOOLBAR_ATTR}]::after {
                content: none !important;
                display: none !important;
            }

            [${TOOLBAR_ATTR}] .tm-sidebar-search {
                width: 100%;
                height: 36px;
                min-height: 36px;
                box-sizing: border-box;
                padding: 8px 10px;
                border: 1px solid #4a4a6a;
                border-radius: 6px;
                outline: none;
                background: #212134;
                color: #ffffff;
                font: inherit;
                font-size: 13px;
                font-weight: 400;
                line-height: 18px;
            }

            [${TOOLBAR_ATTR}] .tm-sidebar-search::placeholder {
                color: #a5a5ba;
            }

            [${TOOLBAR_ATTR}] .tm-sidebar-search:focus {
                border-color: #7b79ff;
                box-shadow: 0 0 0 2px rgba(123, 121, 255, 0.18);
            }

            [${TOOLBAR_ATTR}] .tm-sidebar-quick-row {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }

            [${TOOLBAR_ATTR}] [${QUICK_ATTR}] {
                min-height: 28px;
                padding: 5px 9px;
                border: 1px solid #3f3f5f;
                border-radius: 6px;
                background: #212134;
                color: #dcdce4;
                font: inherit;
                font-size: 12px;
                font-weight: 500;
                line-height: 16px;
                cursor: pointer;
            }

            [${TOOLBAR_ATTR}] [${QUICK_ATTR}]:hover {
                background: #292944;
                border-color: #5b5b80;
            }

            [${TOOLBAR_ATTR}] [${QUICK_ATTR}][data-tm-active="true"] {
                background: #302c6f;
                border-color: #7b79ff;
                color: #ffffff;
            }

            [${CLEANUP_ATTR}] [${GROUP_HEADER_ATTR}] {
                margin: 12px 0 2px !important;
                padding: 0 !important;
            }

            [${CLEANUP_ATTR}] [${GROUP_HEADER_ATTR}]:first-child {
                margin-top: 8px !important;
            }

            [${CLEANUP_ATTR}] [${GROUP_HEADER_ATTR}] > button {
                display: flex;
                align-items: center;
                width: 100%;
                min-height: 24px;
                box-sizing: border-box;
                padding: 4px 12px;
                border: 0;
                border-radius: 5px;
                outline: none;
                background: transparent;
                color: #8e8ea9;
                font: inherit;
                font-size: 11px;
                font-weight: 600;
                line-height: 16px;
                letter-spacing: 0.04em;
                text-transform: uppercase;
                text-align: left;
                cursor: pointer;
                box-shadow: none;
            }

            [${CLEANUP_ATTR}] [${GROUP_HEADER_ATTR}] > button:hover {
                background: #212134;
                color: #c0c0cf;
            }

            [${CLEANUP_ATTR}] [${GROUP_HEADER_ATTR}] > button:focus {
                outline: none;
                box-shadow: none;
            }

            [${CLEANUP_ATTR}] [${GROUP_HEADER_ATTR}] > button:focus-visible {
                box-shadow: 0 0 0 2px rgba(123, 121, 255, 0.35);
            }

            [${CLEANUP_ATTR}] .tm-sidebar-group-title {
                min-width: 0;
                flex: 1;
            }

            [${CLEANUP_ATTR}] [${GROUP_ITEM_ATTR}] {
                margin: 0 !important;
                padding: 0 !important;
                list-style: none !important;
            }

            [${CLEANUP_ATTR}] ${COLLECTION_LINK_SELECTOR},
            [${CLEANUP_ATTR}] ${SINGLE_LINK_SELECTOR} {
                display: flex !important;
                align-items: center !important;
                width: 100% !important;
                min-height: 40px !important;
                margin: 0 !important;
                box-sizing: border-box !important;
                border-radius: 6px !important;
            }

            [${CLEANUP_ATTR}] ${COLLECTION_LINK_SELECTOR} > div,
            [${CLEANUP_ATTR}] ${SINGLE_LINK_SELECTOR} > div {
                display: flex !important;
                align-items: center !important;
                width: 100% !important;
                min-width: 0 !important;
                min-height: 40px !important;
                height: auto !important;
                box-sizing: border-box !important;
                padding: 8px 12px !important;
            }

            [${CLEANUP_ATTR}] ${COLLECTION_LINK_SELECTOR} > div > span:first-child:empty,
            [${CLEANUP_ATTR}] ${SINGLE_LINK_SELECTOR} > div > span:first-child:empty {
                display: none !important;
                width: 0 !important;
                height: 0 !important;
                min-width: 0 !important;
                min-height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                border: 0 !important;
            }

            [${CLEANUP_ATTR}] ${COLLECTION_LINK_SELECTOR} > div > span:last-child,
            [${CLEANUP_ATTR}] ${SINGLE_LINK_SELECTOR} > div > span:last-child {
                min-width: 0 !important;
                max-width: none !important;
                overflow: visible !important;
                white-space: normal !important;
                text-overflow: clip !important;
                overflow-wrap: anywhere !important;
                word-break: normal !important;
                font-size: 13px !important;
                font-weight: 400 !important;
                line-height: 18px !important;
            }

            [${CLEANUP_ATTR}] a[${ACTIVE_ATTR}] {
                position: relative !important;
                background: #302c6f !important;
                color: #ffffff !important;
                font-weight: 600 !important;
                overflow: hidden !important;
                border-right: 0 !important;
                border-inline-end: 0 !important;
            }

            [${CLEANUP_ATTR}] a[${ACTIVE_ATTR}] *,
            [${CLEANUP_ATTR}] a[${ACTIVE_ATTR}] > div > span:last-child {
                color: #ffffff !important;
                font-weight: 600 !important;
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    function directChildContaining(parent, node) {
        if (!parent || !node) return null;
        let current = node;

        while (current?.parentElement && current.parentElement !== parent) {
            current = current.parentElement;
        }

        return current?.parentElement === parent ? current : null;
    }

    function applyGlobalNav() {
        const homeLink = document.querySelector('nav a[aria-label="Home"][href="/admin"]');
        const nav = homeLink?.closest('nav');
        if (!nav) return;

        nav.setAttribute(GLOBAL_NAV_ATTR, '');

        const logo = nav.querySelector('img[alt="Application logo"]');
        const logoRoot = directChildContaining(nav, logo);

        if (logoRoot) {
            logoRoot.setAttribute(GLOBAL_LOGO_ATTR, '');
            const next = logoRoot.nextElementSibling;
            if (next?.getAttribute('role') === 'separator') {
                next.setAttribute(GLOBAL_TOP_SEPARATOR_ATTR, '');
            }
        }

        const menu = homeLink.closest('ul');
        const profileButton = [...nav.querySelectorAll('button[aria-haspopup="menu"]')]
            .find(button => directChildContaining(nav, button));
        const profileRoot = directChildContaining(nav, profileButton);

        if (profileRoot) profileRoot.setAttribute(GLOBAL_PROFILE_ATTR, '');

        if (menu && profileRoot) {
            let node = menu.nextElementSibling;
            while (node && node !== profileRoot) {
                if (node.getAttribute('role') === 'separator') {
                    node.setAttribute(GLOBAL_PROFILE_SEPARATOR_ATTR, '');
                }
                node = node.nextElementSibling;
            }
        }
    }

    function getUid(link, type) {
        const href = link?.getAttribute('href') || '';
        const segment = type === 'single' ? 'single-types/' : 'collection-types/';
        const index = href.indexOf(segment);
        if (index === -1) return '';

        return href
            .slice(index + segment.length)
            .split('?')[0]
            .split('/')[0];
    }

    function getPath(link) {
        try {
            return new URL(link.href, location.origin)
                .pathname
                .replace(/\/+$/, '');
        } catch {
            return (link?.getAttribute('href') || '')
                .split('?')[0]
                .replace(/\/+$/, '');
        }
    }

    function normalizeText(value) {
        return String(value || '')
            .trim()
            .replace(/\s+/g, ' ')
            .toLocaleLowerCase();
    }

    function getLinkLabel(link) {
        return (link?.textContent || '').trim().replace(/\s+/g, ' ');
    }

    function clearSidebarReferences() {
        sidebar = null;
        collectionList = null;
        singleSourceList = null;
        toolbar = null;
        layout = null;
        main = null;
        originalLayout = null;
    }

    function findSidebar() {
        return document.querySelector(SIDEBAR_SELECTOR);
    }

    function captureLayout(currentSidebar) {
        const nextLayout = currentSidebar.parentElement;
        const nextMain = nextLayout
            ? [...nextLayout.children].find(child => child !== currentSidebar)
            : null;

        if (!nextLayout || !nextMain) {
            console.warn('[sidebar] Main content not found');
            return false;
        }

        if (layout === nextLayout && main === nextMain && originalLayout) {
            return true;
        }

        layout = nextLayout;
        main = nextMain;
        originalLayout = {
            sidebarDisplay: currentSidebar.style.getPropertyValue('display'),
            sidebarDisplayPriority: currentSidebar.style.getPropertyPriority('display'),
            gridTemplateColumns: layout.style.getPropertyValue('grid-template-columns'),
            gridTemplatePriority: layout.style.getPropertyPriority('grid-template-columns'),
            mainGridColumn: main.style.getPropertyValue('grid-column'),
            mainGridColumnPriority: main.style.getPropertyPriority('grid-column'),
            mainWidth: main.style.getPropertyValue('width'),
            mainWidthPriority: main.style.getPropertyPriority('width'),
            mainMaxWidth: main.style.getPropertyValue('max-width'),
            mainMaxWidthPriority: main.style.getPropertyPriority('max-width')
        };

        return true;
    }

    function findLists() {
        const collectionLink = sidebar?.querySelector(COLLECTION_LINK_SELECTOR);
        collectionList = collectionLink?.closest('ol') || null;

        if (collectionList) collectionList.setAttribute(LIST_ATTR, '');

        if (
            !singleSourceList ||
            !document.contains(singleSourceList) ||
            singleSourceList === collectionList
        ) {
            const sourceLink = [...(sidebar?.querySelectorAll(SINGLE_LINK_SELECTOR) || [])]
                .find(link => link.closest('ol') !== collectionList);
            singleSourceList = sourceLink?.closest('ol') || null;
        }
    }

    function hideNativeSidebarHeader() {
        const heading = [...sidebar.querySelectorAll('h1, h2')]
            .find(node => node.textContent.trim() === 'Content Manager');
        if (!heading) return;

        let node = heading;
        while (node.parentElement && node.parentElement !== sidebar) {
            node = node.parentElement;
        }

        if (node.parentElement === sidebar) node.setAttribute(HIDDEN_ATTR, '');
    }

    function hideNativeCollectionHeader() {
        const parent = collectionList?.parentElement;
        if (!parent) return;

        for (const child of [...parent.children]) {
            if (child === collectionList || child.hasAttribute(TOOLBAR_ATTR)) continue;
            child.setAttribute(HIDDEN_ATTR, '');
        }
    }

    function hideSingleSource() {
        if (!singleSourceList || singleSourceList === collectionList) return;

        singleSourceList.setAttribute(SINGLE_SOURCE_ATTR, '');

        let node = singleSourceList;
        while (
            node.parentElement &&
            node.parentElement !== sidebar &&
            !node.parentElement.contains(collectionList)
        ) {
            node = node.parentElement;
        }

        if (
            node.parentElement === sidebar &&
            !node.contains(collectionList)
        ) {
            node.setAttribute(SINGLE_WRAPPER_ATTR, '');
        }
    }

    function findCollectionLink(uid) {
        return [...(sidebar?.querySelectorAll(COLLECTION_LINK_SELECTOR) || [])]
            .find(link => getUid(link, 'collection') === uid) || null;
    }

    function createToolbar() {
        const wrapper = document.createElement('div');
        wrapper.setAttribute(TOOLBAR_ATTR, '');

        const search = document.createElement('input');
        search.className = 'tm-sidebar-search';
        search.type = 'search';
        search.placeholder = 'Поиск коллекции…';
        search.autocomplete = 'off';
        search.value = searchQuery;
        search.addEventListener('input', () => {
            searchQuery = normalizeText(search.value);
            applyVisibility();
        });

        const quickRow = document.createElement('div');
        quickRow.className = 'tm-sidebar-quick-row';

        for (const item of QUICK_LINKS) {
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute(QUICK_ATTR, item.uid);
            button.textContent = item.label;
            button.addEventListener('click', () => {
                const link = findCollectionLink(item.uid);
                if (link) link.click();
                else console.warn(`[sidebar] Quick link not found: ${item.uid}`);
            });
            quickRow.appendChild(button);
        }

        wrapper.append(search, quickRow);
        return wrapper;
    }

    function ensureToolbar() {
        if (!collectionList?.parentElement) return;

        if (!toolbar || !document.contains(toolbar)) {
            toolbar = sidebar.querySelector(`[${TOOLBAR_ATTR}]`) || createToolbar();
        }

        if (toolbar.parentElement !== collectionList.parentElement) {
            collectionList.parentElement.insertBefore(toolbar, collectionList);
        } else if (toolbar.nextElementSibling !== collectionList) {
            collectionList.parentElement.insertBefore(toolbar, collectionList);
        }
    }

    function ensureGroupHeader(group) {
        let header = collectionList.querySelector(
            `:scope > [${GROUP_HEADER_ATTR}="${group.id}"]`
        );

        if (!header) {
            header = document.createElement('li');
            header.setAttribute(GROUP_HEADER_ATTR, group.id);

            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('aria-expanded', 'true');

            const title = document.createElement('span');
            title.className = 'tm-sidebar-group-title';

            button.appendChild(title);
            button.addEventListener('click', () => {
                collapsedGroups.set(
                    group.id,
                    !(collapsedGroups.get(group.id) || false)
                );
                applyVisibility();
            });

            header.appendChild(button);
        }

        const title = header.querySelector('.tm-sidebar-group-title');
        if (title) title.textContent = group.title;

        return header;
    }

    function collectItems(selector) {
        const seen = new Set();
        const items = [];

        for (const link of sidebar.querySelectorAll(selector)) {
            const item = link.closest('li');
            if (!item || item.hasAttribute(GROUP_HEADER_ATTR) || seen.has(item)) continue;
            seen.add(item);
            items.push(item);
        }

        return items;
    }

    function sortSingleTypes(items) {
        return items
            .map((item, index) => {
                const link = item.querySelector(SINGLE_LINK_SELECTOR);
                const label = normalizeText(getLinkLabel(link));
                return {
                    item,
                    index,
                    rank: SINGLE_ORDER.has(label) ? SINGLE_ORDER.get(label) : 1000
                };
            })
            .sort((a, b) => a.rank - b.rank || a.index - b.index)
            .map(entry => entry.item);
    }

    function organizeItems() {
        if (!collectionList) return;

        const collectionItems = collectItems(COLLECTION_LINK_SELECTOR);
        const singleItems = collectItems(SINGLE_LINK_SELECTOR);

        const byUid = new Map();
        for (const item of collectionItems) {
            const link = item.querySelector(COLLECTION_LINK_SELECTOR);
            const uid = getUid(link, 'collection');
            if (uid) byUid.set(uid, item);
        }

        const used = new Set();
        const desired = [];
        const validGroupIds = new Set();

        for (const group of GROUPS) {
            let items = [];

            if (group.uids) {
                items = group.uids.map(uid => byUid.get(uid)).filter(Boolean);
                for (const item of items) {
                    const link = item.querySelector(COLLECTION_LINK_SELECTOR);
                    used.add(getUid(link, 'collection'));
                }
            } else if (group.fallbackCollections) {
                items = collectionItems.filter(item => {
                    const link = item.querySelector(COLLECTION_LINK_SELECTOR);
                    return !used.has(getUid(link, 'collection'));
                });
            } else if (group.singleTypes) {
                items = sortSingleTypes(singleItems);
            }

            if (!items.length) continue;

            validGroupIds.add(group.id);
            desired.push(ensureGroupHeader(group));

            for (const item of items) {
                item.setAttribute(GROUP_ITEM_ATTR, group.id);
                desired.push(item);
            }
        }

        collectionList
            .querySelectorAll(`:scope > [${GROUP_HEADER_ATTR}]`)
            .forEach(header => {
                if (!validGroupIds.has(header.getAttribute(GROUP_HEADER_ATTR))) {
                    header.remove();
                }
            });

        desired.forEach((node, index) => {
            if (collectionList.children[index] !== node) {
                collectionList.insertBefore(node, collectionList.children[index] || null);
            }
        });

        hideSingleSource();
    }

    function applyActiveState() {
        if (!sidebar) return;

        const currentPath = location.pathname.replace(/\/+$/, '');
        const links = [
            ...sidebar.querySelectorAll(COLLECTION_LINK_SELECTOR),
            ...sidebar.querySelectorAll(SINGLE_LINK_SELECTOR)
        ];

        for (const link of links) {
            const linkPath = getPath(link);
            const isActive = Boolean(linkPath) && (
                currentPath === linkPath ||
                currentPath.startsWith(`${linkPath}/`)
            );

            link.toggleAttribute(ACTIVE_ATTR, isActive);

            if (isActive) {
                const item = link.closest(`[${GROUP_ITEM_ATTR}]`);
                const groupId = item?.getAttribute(GROUP_ITEM_ATTR);
                if (groupId) collapsedGroups.set(groupId, false);
            }
        }

        sidebar.querySelectorAll(`[${QUICK_ATTR}]`).forEach(button => {
            const uid = button.getAttribute(QUICK_ATTR);
            const link = findCollectionLink(uid);
            const linkPath = link ? getPath(link) : '';
            const active = Boolean(linkPath) && (
                currentPath === linkPath ||
                currentPath.startsWith(`${linkPath}/`)
            );
            button.dataset.tmActive = String(active);
        });

        lastPath = currentPath;
    }

    function applyVisibility() {
        if (!collectionList) return;

        for (const group of GROUPS) {
            const header = collectionList.querySelector(
                `:scope > [${GROUP_HEADER_ATTR}="${group.id}"]`
            );
            if (!header) continue;

            const items = [...collectionList.querySelectorAll(
                `:scope > [${GROUP_ITEM_ATTR}="${group.id}"]`
            )];

            const collapsed = collapsedGroups.get(group.id) || false;
            let visibleCount = 0;

            for (const item of items) {
                const matches = !searchQuery || normalizeText(item.textContent).includes(searchQuery);
                const visible = searchQuery ? matches : !collapsed;
                item.hidden = !visible;
                if (matches) visibleCount++;
            }

            header.hidden = Boolean(searchQuery) && visibleCount === 0;
            const button = header.querySelector('button');
            if (button) {
                button.setAttribute(
                    'aria-expanded',
                    String(Boolean(searchQuery) || !collapsed)
                );
            }
        }
    }

    function hideSidebar() {
        if (!sidebar || !layout || !main) return;

        sidebar.style.setProperty('display', 'none', 'important');
        layout.style.setProperty('grid-template-columns', 'minmax(0, 1fr)', 'important');
        main.style.setProperty('grid-column', '1 / -1', 'important');
        main.style.setProperty('width', '100%', 'important');
        main.style.setProperty('max-width', 'none', 'important');
    }

    function restoreStyle(element, property, value, priority) {
        if (!element) return;
        if (value) element.style.setProperty(property, value, priority || '');
        else element.style.removeProperty(property);
    }

    function showSidebar() {
        if (!sidebar || !layout || !main || !originalLayout) return;

        restoreStyle(sidebar, 'display', originalLayout.sidebarDisplay, originalLayout.sidebarDisplayPriority);
        restoreStyle(layout, 'grid-template-columns', originalLayout.gridTemplateColumns, originalLayout.gridTemplatePriority);
        restoreStyle(main, 'grid-column', originalLayout.mainGridColumn, originalLayout.mainGridColumnPriority);
        restoreStyle(main, 'width', originalLayout.mainWidth, originalLayout.mainWidthPriority);
        restoreStyle(main, 'max-width', originalLayout.mainMaxWidth, originalLayout.mainMaxWidthPriority);
    }

    function applySidebarState() {
        if (!sidebar || !captureLayout(sidebar)) return;
        hidden ? hideSidebar() : showSidebar();
    }

    function apply() {
        ensureStyle();
        applyGlobalNav();

        if (!sidebar || !document.contains(sidebar)) {
            clearSidebarReferences();
            sidebar = findSidebar();
        }

        if (!sidebar) return;

        sidebar.setAttribute(SIDEBAR_ATTR, '');
        sidebar.setAttribute(CLEANUP_ATTR, '');

        findLists();
        captureLayout(sidebar);

        if (collectionList) {
            hideNativeSidebarHeader();
            ensureToolbar();
            hideNativeCollectionHeader();
            organizeItems();
            applyActiveState();
            applyVisibility();
        }

        applySidebarState();
    }

    function toggleSidebar() {
        if (!sidebar || !document.contains(sidebar)) apply();
        if (!sidebar) return;

        hidden = !hidden;
        applySidebarState();
        console.log(`[sidebar] ${hidden ? 'Hidden' : 'Visible'}`);
    }

    function scheduleApply() {
        if (scheduled) return;
        scheduled = true;

        requestAnimationFrame(() => {
            scheduled = false;
            apply();
        });
    }

    function nodeIsRelevant(node) {
        if (!(node instanceof Element)) return false;

        return (
            node.matches(SIDEBAR_SELECTOR) ||
            node.matches(COLLECTION_LINK_SELECTOR) ||
            node.matches(SINGLE_LINK_SELECTOR) ||
            node.matches('nav') ||
            Boolean(node.querySelector(SIDEBAR_SELECTOR)) ||
            Boolean(node.querySelector(COLLECTION_LINK_SELECTOR)) ||
            Boolean(node.querySelector(SINGLE_LINK_SELECTOR)) ||
            Boolean(node.querySelector('a[aria-label="Home"][href="/admin"]'))
        );
    }

    function shouldApply(mutations) {
        const currentPath = location.pathname.replace(/\/+$/, '');
        if (currentPath !== lastPath) return true;

        if (!sidebar || !document.contains(sidebar)) {
            return mutations.some(mutation =>
                [...mutation.addedNodes].some(nodeIsRelevant)
            );
        }

        return mutations.some(mutation => {
            if (mutation.target === sidebar || sidebar.contains(mutation.target)) return true;
            return [...mutation.addedNodes].some(nodeIsRelevant);
        });
    }

    window.addEventListener('keydown', event => {
        const key = event.key?.toLowerCase() || '';
        const isS = event.code === 'KeyS' || key === 's' || key === 'ы';

        if (
            event.altKey &&
            !event.ctrlKey &&
            !event.shiftKey &&
            isS
        ) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (!event.repeat) toggleSidebar();
        }
    }, true);

    const observer = new MutationObserver(mutations => {
        if (shouldApply(mutations)) scheduleApply();
    });

    function start() {
        if (!document.documentElement) {
            requestAnimationFrame(start);
            return;
        }

        ensureStyle();
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        window.addEventListener('popstate', scheduleApply);
        scheduleApply();
    }

    start();
})();
