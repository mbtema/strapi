(function () {
    'use strict';

    const designSystem = window.__tmStrapiDesignSystem;
    if (typeof designSystem?.createIcon !== 'function') {
        console.warn('[sidebar] Design System icon component not available');
        return;
    }

    const STYLE_ID = 'tm-sidebar-style';
    const CREATED_ATTR = 'data-tm-created';
    const SIDEBAR_STATE_KEY = 'tm-strapi-sidebar-hidden-v1';
    const GROUP_STATE_KEY = 'tm-strapi-sidebar-groups-v1';

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
    const ACTIVE_ATTR = 'data-tm-sidebar-active-collection';
    const TOOLBAR_ATTR = 'data-tm-sidebar-toolbar';
    const GROUP_HEADER_ATTR = 'data-tm-sidebar-group-header';
    const GROUP_ITEM_ATTR = 'data-tm-sidebar-group-item';
    const GROUP_COLLAPSED_ATTR = 'data-tm-sidebar-group-collapsed';
    const SUBGROUP_ATTR = 'data-tm-sidebar-subgroup';
    const ICON_ATTR = 'data-tm-sidebar-icon';
    const COLLAPSED_ATTR = 'data-tm-sidebar-collapsed';
    const LAYOUT_ATTR = 'data-tm-sidebar-layout';

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
                'api::page.page',
                'api::article.article'
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
            collapsed: false,
            subgroups: [
                {
                    id: 'filters-fragrance',
                    title: 'Парфюмерия',
                    collapsed: false,
                    uids: [
                        'api::fragrance-group.fragrance-group',
                        'api::fragrance-concentration.fragrance-concentration'
                    ]
                },
                {
                    id: 'filters-makeup',
                    title: 'Макияж',
                    collapsed: false,
                    uids: [
                        'api::shade-group.shade-group',
                        'api::product-release-form.product-release-form',
                        'api::product-finish.product-finish',
                        'api::product-coverage.product-coverage',
                        'api::product-feature.product-feature',
                        'api::shade.shade',
                        'api::color-variant.color-variant'
                    ]
                },
                {
                    id: 'filters-skin-care',
                    title: 'Уход за кожей',
                    collapsed: false,
                    uids: [
                        'api::skin-type.skin-type',
                        'api::product-age-group.product-age-group',
                        'api::product-usage-time.product-usage-time',
                        'api::ingredient.ingredient',
                        'api::product-segment.product-segment'
                    ]
                },
                {
                    id: 'filters-hair-care',
                    title: 'Уход за волосами',
                    collapsed: false,
                    uids: [
                        'api::hair-type.hair-type'
                    ]
                },
                {
                    id: 'filters-common',
                    title: 'Общие',
                    collapsed: false,
                    uids: [
                        'api::volume.volume',
                        'api::product-effect.product-effect',
                        'api::product-form.product-form',
                        'api::brand-filter-profile.brand-filter-profile',
                        'api::brand-country.brand-country',
                        'api::filtry.filtry'
                    ]
                }
            ]
        },
        {
            id: 'mobile-home',
            title: 'Главная страница MOBILE',
            collapsed: false,
            singleUids: [
                'api::home-page.home-page'
            ]
        },
        {
            id: 'web-home',
            title: 'Главная страница WEB',
            collapsed: false,
            uids: [
                'api::banner.banner'
            ],
            singleUids: [
                'api::web-home-page.web-home-page'
            ]
        },
        {
            id: 'other',
            title: 'Другое',
            collapsed: false,
            uids: [
                'api::notification-template.notification-template'
            ],
            fallbackCollections: true,
            fallbackSingleTypes: true
        }
    ];

    const STATE_GROUPS = GROUPS.flatMap(group => [group, ...(group.subgroups || [])]);

    const SINGLE_ORDER = new Map([
        ['home page', 0],
        ['web-home-page', 1],
        ['блок рекомендаций', 2]
    ]);

    const EXPLICIT_COLLECTION_UIDS = new Set(
        STATE_GROUPS.flatMap(group => group.uids || [])
    );

    const EXPLICIT_SINGLE_UIDS = new Set(
        GROUPS.flatMap(group => group.singleUids || [])
    );

    const COLLECTION_ICONS = {
        'api::product.product': 'Archive',
        'api::attribute.attribute': 'Stack',
        'api::category.category': 'Folder',
        'api::brand.brand': 'PriceTag',
        'api::promotion.promotion': 'PriceTag',
        'api::page.page': 'File',
        'api::article.article': 'File',

        'api::city.city': 'PinMap',
        'api::shop.shop': 'Store',
        'api::delivery-method.delivery-method': 'Car',
        'api::menu-item.menu-item': 'List',
        'api::gift-certificate.gift-certificate': 'Gift',
        'api::feedback-contact-info.feedback-contact-info': 'Headphones',
        'api::feedback-contact-method.feedback-contact-method': 'Discuss',
        'api::feedback-topic.feedback-topic': 'Message',

        'api::notification-template.notification-template': 'Bell',
        'api::product-age-group.product-age-group': 'User',
        'api::product-usage-time.product-usage-time': 'Clock',
        'api::fragrance-group.fragrance-group': 'Plant',
        'api::shade-group.shade-group': 'Palette',
        'api::shade.shade': 'Palette',
        'api::color-variant.color-variant': 'Palette',
        'api::product-feature.product-feature': 'Sparkle',
        'api::ingredient.ingredient': 'Plant',
        'api::fragrance-concentration.fragrance-concentration': 'ChartPie',
        'api::product-effect.product-effect': 'Magic',
        'api::product-segment.product-segment': 'GridFour',
        'api::brand-filter-profile.brand-filter-profile': 'SlidersHorizontal',
        'api::product-coverage.product-coverage': 'ChartCircle',
        'api::brand-country.brand-country': 'Earth',
        'api::hair-type.hair-type': 'Typhoon',
        'api::skin-type.skin-type': 'User',
        'api::product-form.product-form': 'PuzzlePiece',
        'api::product-finish.product-finish': 'Sparkle',
        'api::product-release-form.product-release-form': 'Archive',
        'api::volume.volume': 'ChartPie',
        'api::filtry.filtry': 'SlidersHorizontal'
    };

    const SINGLE_ICONS = {
        'home page': 'House',
        'web-home-page': 'Globe',
        'блок рекомендаций': 'Sparkle'
    };

    function readGroupStates() {
        const states = new Map(
            STATE_GROUPS.map(group => [group.id, Boolean(group.collapsed)])
        );

        try {
            const raw = localStorage.getItem(GROUP_STATE_KEY);
            if (!raw) return states;

            const stored = JSON.parse(raw);
            if (!stored || typeof stored !== 'object') return states;

            for (const group of STATE_GROUPS) {
                if (typeof stored[group.id] === 'boolean') {
                    states.set(group.id, stored[group.id]);
                }
            }
        } catch (error) {
            console.warn('[sidebar] Failed to read group state', error);
        }

        return states;
    }

    const collapsedGroups = readGroupStates();

    function writeGroupStates() {
        try {
            const stored = {};

            for (const group of STATE_GROUPS) {
                stored[group.id] = Boolean(collapsedGroups.get(group.id));
            }

            localStorage.setItem(GROUP_STATE_KEY, JSON.stringify(stored));
        } catch (error) {
            console.warn('[sidebar] Failed to persist group state', error);
        }
    }

    function readSidebarHiddenState() {
        try {
            return sessionStorage.getItem(SIDEBAR_STATE_KEY) === 'hidden';
        } catch (error) {
            console.warn('[sidebar] Failed to read session state', error);
            return false;
        }
    }

    function writeSidebarHiddenState() {
        try {
            sessionStorage.setItem(SIDEBAR_STATE_KEY, hidden ? 'hidden' : 'visible');
        } catch (error) {
            console.warn('[sidebar] Failed to persist session state', error);
        }
    }

    let hidden = readSidebarHiddenState();
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
        const sidebarPath = `+ * > [${LAYOUT_ATTR}]:first-child > [${SIDEBAR_ATTR}]`;
        const managedNav = `[${GLOBAL_NAV_ATTR}]:has(${sidebarPath})`;
        const expandedNav = `[${GLOBAL_NAV_ATTR}]:has(${sidebarPath}:not([${COLLAPSED_ATTR}]))`;
        const collapsedNav = `[${GLOBAL_NAV_ATTR}]:has(${sidebarPath}[${COLLAPSED_ATTR}])`;
        const navigationLayout = `:has(> [${GLOBAL_NAV_ATTR}] ${sidebarPath})`;
        style.textContent = `
            nav li:has(> span > a[aria-label="Settings"][href^="/admin/settings"]) {
                display: none !important;
            }

            [${GLOBAL_LOGO_ATTR}],
            [${GLOBAL_TOP_SEPARATOR_ATTR}],
            [${GLOBAL_PROFILE_SEPARATOR_ATTR}],
            [${HIDDEN_ATTR}],
            [${SINGLE_SOURCE_ATTR}] {
                display: none !important;
            }

            [${GLOBAL_NAV_ATTR}] > ul {
                margin-top: 0 !important;
                padding-top: 22px !important;
            }

            ${navigationLayout} {
                position: relative !important;
                grid-template-columns: minmax(0, 1fr) !important;
            }

            ${collapsedNav} {
                display: none !important;
            }

            ${expandedNav} {
                position: fixed !important;
                inset-block-start: 0 !important;
                inset-inline-start: 0 !important;
                inset-block-end: auto !important;
                inset-inline-end: auto !important;
                display: flex !important;
                flex-direction: row !important;
                align-items: center !important;
                justify-content: space-between !important;
                gap: var(--tm-ds-space2) !important;
                width: 320px !important;
                min-width: 0 !important;
                max-width: 320px !important;
                height: var(--tm-ds-space10) !important;
                min-height: 0 !important;
                max-height: none !important;
                padding: 0 var(--tm-ds-space4) !important;
                box-sizing: border-box !important;
                background: var(--tm-ds-neutral0) !important;
                border: 0 !important;
                border-inline-end: 1px solid var(--tm-ds-neutral200) !important;
                box-shadow: none !important;
                overflow: visible !important;
                z-index: 6 !important;
            }

            ${expandedNav} > ul {
                display: flex !important;
                flex: 1 1 auto !important;
                flex-direction: row !important;
                align-items: center !important;
                justify-content: flex-start !important;
                gap: var(--tm-ds-space2) !important;
                width: auto !important;
                min-width: 0 !important;
                height: auto !important;
                margin: 0 !important;
                padding: 0 !important;
                background: transparent !important;
                overflow-x: auto !important;
                overflow-y: hidden !important;
            }

            ${expandedNav} > ul > li {
                flex-shrink: 0 !important;
                background: transparent !important;
            }

            ${expandedNav} > ul > li a {
                background: transparent !important;
                box-shadow: none !important;
            }

            ${expandedNav} > ul > li a:hover,
            ${expandedNav} > ul > li a[aria-current="page"] {
                background: var(--tm-ds-neutral150) !important;
            }

            ${expandedNav} > [${GLOBAL_PROFILE_ATTR}] {
                flex: 0 0 auto !important;
                width: auto !important;
                margin: 0 !important;
                padding: 0 !important;
                background: transparent !important;
            }

            ${managedNav} + * {
                flex: 1 1 0% !important;
                width: 100% !important;
                min-width: 0 !important;
                max-width: none !important;
                grid-column: 1 / -1 !important;
            }

            ${expandedNav} + * > [${LAYOUT_ATTR}] > [${SIDEBAR_ATTR}] {
                padding-block-start: var(--tm-ds-space10) !important;
                box-sizing: border-box !important;
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

            [${LAYOUT_ATTR}] {
                transition: grid-template-columns 180ms cubic-bezier(0.2, 0.8, 0.2, 1) !important;
            }

            [${CLEANUP_ATTR}] {
                background-color: var(--tm-ds-neutral0) !important;
                width: 320px !important;
                min-width: 320px !important;
                max-width: 320px !important;
                opacity: 1;
                transform: translateX(0);
                transition:
                    width 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
                    min-width 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
                    max-width 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
                    opacity 140ms ease,
                    transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
                will-change: width, opacity, transform;
            }

            [${CLEANUP_ATTR}][${COLLAPSED_ATTR}] {
                width: 0 !important;
                min-width: 0 !important;
                max-width: 0 !important;
                opacity: 0 !important;
                transform: translateX(-12px);
                overflow: hidden !important;
                pointer-events: none !important;
            }

            @media (prefers-reduced-motion: reduce) {
                [${LAYOUT_ATTR}],
                [${CLEANUP_ATTR}],
                [${CLEANUP_ATTR}] [${GROUP_ITEM_ATTR}] {
                    transition: none !important;
                }
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
                padding: 12px 16px;
                background: var(--tm-ds-neutral0);
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
            }

            [${CLEANUP_ATTR}] [${GROUP_HEADER_ATTR}] {
                margin: 12px 0 2px !important;
                padding: 0 !important;
            }

            [${CLEANUP_ATTR}] [${GROUP_HEADER_ATTR}]:first-child {
                margin-top: 8px !important;
            }

            [${CLEANUP_ATTR}] [${GROUP_HEADER_ATTR}][${SUBGROUP_ATTR}] {
                margin: var(--tm-ds-space1) 0 2px !important;
            }

            [${CLEANUP_ATTR}] [${GROUP_HEADER_ATTR}][${SUBGROUP_ATTR}] > button {
                padding-inline-start: var(--tm-ds-space5);
            }

            [${CLEANUP_ATTR}] .tm-sidebar-group-title {
                min-width: 0;
                flex: 1;
            }

            [${CLEANUP_ATTR}] [${GROUP_ITEM_ATTR}] {
                margin: 0 !important;
                padding: 0 !important;
                max-height: 72px;
                opacity: 1;
                overflow: hidden;
                transform: translateY(0);
                list-style: none !important;
                transition:
                    max-height 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
                    opacity 140ms ease,
                    transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
            }

            [${CLEANUP_ATTR}] [${GROUP_ITEM_ATTR}][${GROUP_COLLAPSED_ATTR}] {
                max-height: 0 !important;
                opacity: 0;
                transform: translateY(-4px);
                pointer-events: none;
            }

            [${CLEANUP_ATTR}] ${COLLECTION_LINK_SELECTOR},
            [${CLEANUP_ATTR}] ${SINGLE_LINK_SELECTOR} {
                display: flex !important;
                align-items: center !important;
                width: 100% !important;
                min-height: 40px !important;
                margin: 0 !important;
                padding: 0 !important;
                box-sizing: border-box !important;
                border-radius: var(--tm-ds-radius) !important;
            }

            [${CLEANUP_ATTR}] ${COLLECTION_LINK_SELECTOR}:not([${ACTIVE_ATTR}]),
            [${CLEANUP_ATTR}] ${SINGLE_LINK_SELECTOR}:not([${ACTIVE_ATTR}]) {
                background: transparent !important;
            }

            [${CLEANUP_ATTR}] ${COLLECTION_LINK_SELECTOR}:not([${ACTIVE_ATTR}]):hover,
            [${CLEANUP_ATTR}] ${SINGLE_LINK_SELECTOR}:not([${ACTIVE_ATTR}]):hover {
                background: var(--tm-ds-neutral150) !important;
            }

            [${CLEANUP_ATTR}] ${COLLECTION_LINK_SELECTOR} > div,
            [${CLEANUP_ATTR}] ${SINGLE_LINK_SELECTOR} > div {
                display: flex !important;
                align-items: center !important;
                justify-content: flex-start !important;
                gap: 10px !important;
                width: 100% !important;
                min-width: 0 !important;
                min-height: 40px !important;
                height: auto !important;
                box-sizing: border-box !important;
                padding: 8px 12px !important;
            }

            [${CLEANUP_ATTR}] [${GROUP_ITEM_ATTR}][${SUBGROUP_ATTR}] ${COLLECTION_LINK_SELECTOR} > div {
                padding-inline-start: var(--tm-ds-space6) !important;
            }

            [${CLEANUP_ATTR}] ${COLLECTION_LINK_SELECTOR} > div:has(> [${ICON_ATTR}]) > span:first-child:not([${ICON_ATTR}]):not(:last-child),
            [${CLEANUP_ATTR}] ${SINGLE_LINK_SELECTOR} > div:has(> [${ICON_ATTR}]) > span:first-child:not([${ICON_ATTR}]):not(:last-child) {
                display: none !important;
                width: 0 !important;
                height: 0 !important;
                min-width: 0 !important;
                min-height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                border: 0 !important;
            }

            [${CLEANUP_ATTR}] [${ICON_ATTR}] {
                color: var(--tm-ds-neutral600) !important;
            }

            [${CLEANUP_ATTR}] ${COLLECTION_LINK_SELECTOR}:hover [${ICON_ATTR}],
            [${CLEANUP_ATTR}] ${SINGLE_LINK_SELECTOR}:hover [${ICON_ATTR}] {
                color: var(--tm-ds-neutral800) !important;
            }

            [${CLEANUP_ATTR}] ${COLLECTION_LINK_SELECTOR} > div > span:last-child,
            [${CLEANUP_ATTR}] ${SINGLE_LINK_SELECTOR} > div > span:last-child {
                min-width: 0 !important;
                max-width: none !important;
                margin-left: 0 !important;
                overflow: visible !important;
                white-space: normal !important;
                text-overflow: clip !important;
                overflow-wrap: anywhere !important;
                word-break: normal !important;
                font-size: var(--tm-ds-text-size) !important;
                font-weight: var(--tm-ds-font-regular) !important;
                line-height: var(--tm-ds-text-line) !important;
            }

            [${CLEANUP_ATTR}] a[${ACTIVE_ATTR}] {
                position: relative !important;
                background: var(--tm-ds-neutral150) !important;
                color: var(--tm-ds-primary700) !important;
                font-weight: var(--tm-ds-font-semibold) !important;
                overflow: hidden !important;
                border-right: 0 !important;
                border-inline-end: 0 !important;
            }

            [${CLEANUP_ATTR}] a[${ACTIVE_ATTR}] > div > span:last-child {
                color: var(--tm-ds-primary700) !important;
                font-weight: var(--tm-ds-font-semibold) !important;
            }

            [${CLEANUP_ATTR}] a[${ACTIVE_ATTR}] [${ICON_ATTR}] {
                color: var(--tm-ds-primary600) !important;
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

    function normalizeText(value) {
        return String(value || '')
            .trim()
            .replace(/\s+/g, ' ')
            .toLocaleLowerCase();
    }

    function getLinkLabel(link) {
        return (link?.textContent || '').trim().replace(/\s+/g, ' ');
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

    function restoreCapturedLayout() {
        if (!originalLayout) return;

        if (sidebar && document.contains(sidebar)) {
            restoreStyle(
                sidebar,
                'display',
                originalLayout.sidebarDisplay,
                originalLayout.sidebarDisplayPriority
            );
            sidebar.inert = originalLayout.sidebarInert;
        }

        if (layout && document.contains(layout)) {
            restoreStyle(
                layout,
                'grid-template-columns',
                originalLayout.gridTemplateColumns,
                originalLayout.gridTemplatePriority
            );
        }

        if (main && document.contains(main)) {
            restoreStyle(
                main,
                'grid-column',
                originalLayout.mainGridColumn,
                originalLayout.mainGridColumnPriority
            );
            restoreStyle(
                main,
                'width',
                originalLayout.mainWidth,
                originalLayout.mainWidthPriority
            );
            restoreStyle(
                main,
                'max-width',
                originalLayout.mainMaxWidth,
                originalLayout.mainMaxWidthPriority
            );
        }
    }

    function cleanupSidebarDom(currentSidebar) {
        if (!currentSidebar) return;

        currentSidebar.querySelectorAll(`[${GROUP_ITEM_ATTR}]`).forEach(node => {
            node.hidden = false;
            node.inert = false;
        });

        currentSidebar.querySelectorAll(
            `[${TOOLBAR_ATTR}], [${GROUP_HEADER_ATTR}], [${ICON_ATTR}]`
        ).forEach(node => node.remove());

        const managedAttrs = [
            SIDEBAR_ATTR,
            CLEANUP_ATTR,
            LIST_ATTR,
            HIDDEN_ATTR,
            SINGLE_SOURCE_ATTR,
            ACTIVE_ATTR,
            GROUP_ITEM_ATTR,
            GROUP_COLLAPSED_ATTR,
            SUBGROUP_ATTR,
            COLLAPSED_ATTR
        ];

        for (const attr of managedAttrs) {
            currentSidebar.removeAttribute(attr);
            currentSidebar.querySelectorAll(`[${attr}]`).forEach(node => {
                node.removeAttribute(attr);
            });
        }
    }

    function clearSidebarReferences() {
        restoreCapturedLayout();
        cleanupSidebarDom(sidebar);

        layout?.removeAttribute(LAYOUT_ATTR);

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

        if (layout === nextLayout && main === nextMain && originalLayout) return true;

        layout = nextLayout;
        main = nextMain;
        layout.setAttribute(LAYOUT_ATTR, '');
        originalLayout = {
            sidebarDisplay: currentSidebar.style.getPropertyValue('display'),
            sidebarDisplayPriority: currentSidebar.style.getPropertyPriority('display'),
            sidebarInert: currentSidebar.inert,
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
            if (singleSourceList && (child === singleSourceList || child.contains(singleSourceList))) continue;
            child.setAttribute(HIDDEN_ATTR, '');
        }
    }

    function hideNativeSingleChrome() {
        if (singleSourceList && singleSourceList !== collectionList) {
            singleSourceList.setAttribute(SINGLE_SOURCE_ATTR, '');
        }

        const candidates = [...sidebar.querySelectorAll('span, p, h1, h2, h3, h4, div')]
            .filter(node =>
                normalizeText(node.textContent) === 'single types' &&
                !node.closest(`[${GROUP_HEADER_ATTR}]`)
            );

        for (const label of candidates) {
            let row = label.closest('button') || label.parentElement || label;

            if (
                row.parentElement &&
                normalizeText(row.parentElement.textContent).startsWith('single types') &&
                !row.parentElement.contains(collectionList)
            ) {
                row = row.parentElement;
            }

            if (!row.contains(collectionList)) row.setAttribute(HIDDEN_ATTR, '');
        }
    }

    function createToolbar() {
        const wrapper = document.createElement('div');
        wrapper.setAttribute(CREATED_ATTR, 'sidebar');
        wrapper.setAttribute(TOOLBAR_ATTR, '');
        wrapper.setAttribute('data-tm-ds', '');

        const search = document.createElement('input');
        search.className = 'tm-sidebar-search tm-ds-input';
        search.type = 'search';
        search.placeholder = 'Поиск коллекции…';
        search.autocomplete = 'off';
        search.value = searchQuery;
        search.addEventListener('input', () => {
            searchQuery = normalizeText(search.value);
            applyVisibility();
        });

        wrapper.appendChild(search);
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

    function ensureGroupHeader(group, subgroup = false) {
        let header = collectionList.querySelector(
            `:scope > [${GROUP_HEADER_ATTR}="${group.id}"]`
        );

        if (!header) {
            header = document.createElement('li');
            header.setAttribute(CREATED_ATTR, 'sidebar');
            header.setAttribute(GROUP_HEADER_ATTR, group.id);
            header.setAttribute('data-tm-ds', '');

            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('aria-expanded', 'true');
            button.classList.add('tm-ds-nav-group');
            button.dataset.level = subgroup ? 'subgroup' : 'group';

            const title = document.createElement('span');
            title.className = 'tm-sidebar-group-title';

            button.append(title, designSystem.createIcon('ChevronDown'));
            button.addEventListener('click', () => {
                collapsedGroups.set(
                    group.id,
                    !(collapsedGroups.get(group.id) || false)
                );
                writeGroupStates();
                applyVisibility();
            });

            header.appendChild(button);
        }

        const title = header.querySelector('.tm-sidebar-group-title');
        if (title && title.textContent !== group.title) title.textContent = group.title;

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
        const singleByUid = new Map();

        for (const item of collectionItems) {
            const link = item.querySelector(COLLECTION_LINK_SELECTOR);
            const uid = getUid(link, 'collection');
            if (uid) byUid.set(uid, item);
        }

        for (const item of singleItems) {
            const link = item.querySelector(SINGLE_LINK_SELECTOR);
            const uid = getUid(link, 'single');
            if (uid) singleByUid.set(uid, item);
        }

        const desired = [];
        const validGroupIds = new Set();

        function appendGroup(group, items, subgroup = false) {
            if (!items.length) return;
            validGroupIds.add(group.id);
            const header = ensureGroupHeader(group, subgroup);
            header.toggleAttribute(SUBGROUP_ATTR, subgroup);
            desired.push(header);

            for (const item of items) {
                item.setAttribute(GROUP_ITEM_ATTR, group.id);
                item.toggleAttribute(SUBGROUP_ATTR, subgroup);
                desired.push(item);
            }
        }

        for (const group of GROUPS) {
            if (group.subgroups) {
                const entries = group.subgroups.map(subgroup => ({
                    subgroup,
                    items: subgroup.uids.map(uid => byUid.get(uid)).filter(Boolean)
                })).filter(entry => entry.items.length);

                if (!entries.length) continue;
                validGroupIds.add(group.id);
                desired.push(ensureGroupHeader(group));

                for (const entry of entries) {
                    appendGroup(entry.subgroup, entry.items, true);
                }
                continue;
            }
            const items = [];

            if (group.uids) {
                items.push(...group.uids.map(uid => byUid.get(uid)).filter(Boolean));
            }

            if (group.fallbackCollections) {
                items.push(...collectionItems.filter(item => {
                    const link = item.querySelector(COLLECTION_LINK_SELECTOR);
                    const uid = getUid(link, 'collection');
                    return uid && !EXPLICIT_COLLECTION_UIDS.has(uid);
                }));
            }

            if (group.singleUids) {
                items.push(...group.singleUids.map(uid => singleByUid.get(uid)).filter(Boolean));
            }

            if (group.fallbackSingleTypes) {
                items.push(...sortSingleTypes(singleItems.filter(item => {
                    const link = item.querySelector(SINGLE_LINK_SELECTOR);
                    const uid = getUid(link, 'single');
                    return uid && !EXPLICIT_SINGLE_UIDS.has(uid);
                })));
            }

            appendGroup(group, items);
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

        hideNativeSingleChrome();
    }

    function createIcon(name) {
        const icon = designSystem.createIcon(name);
        if (!icon) {
            console.warn(`[sidebar] Design System icon not found: ${name}`);
            return null;
        }
        icon.setAttribute(CREATED_ATTR, 'sidebar');
        icon.setAttribute(ICON_ATTR, name);
        return icon;
    }

    function getIconName(link) {
        if (link.matches(COLLECTION_LINK_SELECTOR)) {
            const uid = getUid(link, 'collection');
            return COLLECTION_ICONS[uid] || 'SlidersHorizontal';
        }

        const label = normalizeText(getLinkLabel(link));
        return SINGLE_ICONS[label] || 'File';
    }

    function ensureIcons() {
        if (!collectionList) return;

        const links = [
            ...collectionList.querySelectorAll(COLLECTION_LINK_SELECTOR),
            ...collectionList.querySelectorAll(SINGLE_LINK_SELECTOR)
        ];

        for (const link of links) {
            const row = link.querySelector(':scope > div');
            if (!row) {
                console.warn('[sidebar] Link row not found for icon', link);
                continue;
            }

            const name = getIconName(link);
            let icon = row.querySelector(`:scope > [${ICON_ATTR}]`);

            if (!icon) {
                icon = createIcon(name);
                if (!icon) continue;
                const label = row.querySelector(':scope > span:last-child');
                row.insertBefore(icon, label || row.firstChild);
            } else if (icon.getAttribute(ICON_ATTR) !== name) {
                const nextIcon = createIcon(name);
                if (nextIcon) icon.replaceWith(nextIcon);
            }
        }
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


        }

        lastPath = currentPath;
    }

    function applyGroupVisibility(group, parentCollapsed = false) {
        const header = collectionList.querySelector(
            `:scope > [${GROUP_HEADER_ATTR}="${group.id}"]`
        );
        if (!header) return 0;

        const collapsed = !searchQuery && Boolean(collapsedGroups.get(group.id));
        const button = header.querySelector('button');
        if (button) button.setAttribute('aria-expanded', String(!collapsed));

        let visibleCount = 0;

        if (group.subgroups) {
            for (const subgroup of group.subgroups) {
                visibleCount += applyGroupVisibility(subgroup, parentCollapsed || collapsed);
            }
        } else {
            const items = collectionList.querySelectorAll(
                `:scope > [${GROUP_ITEM_ATTR}="${group.id}"]`
            );

            for (const item of items) {
                const matches = !searchQuery || normalizeText(item.textContent).includes(searchQuery);
                const hiddenByGroup = parentCollapsed || collapsed;
                item.hidden = !matches;
                item.inert = !matches || hiddenByGroup;
                item.toggleAttribute(GROUP_COLLAPSED_ATTR, hiddenByGroup);
                if (matches) visibleCount++;
            }
        }

        header.hidden = parentCollapsed || (Boolean(searchQuery) && visibleCount === 0);
        return visibleCount;
    }

    function applyVisibility() {
        if (!collectionList) return;

        for (const group of GROUPS) {
            applyGroupVisibility(group);
        }
    }

    function hideSidebar() {
        if (!sidebar || !layout || !main) return;

        sidebar.setAttribute(COLLAPSED_ATTR, '');
        sidebar.inert = true;
        layout.style.setProperty('grid-template-columns', '0px minmax(0, 1fr)', 'important');
        restoreStyle(main, 'grid-column', originalLayout?.mainGridColumn, originalLayout?.mainGridColumnPriority);
        restoreStyle(main, 'width', originalLayout?.mainWidth, originalLayout?.mainWidthPriority);
        restoreStyle(main, 'max-width', originalLayout?.mainMaxWidth, originalLayout?.mainMaxWidthPriority);
    }

    function restoreStyle(element, property, value, priority) {
        if (!element) return;
        if (value) element.style.setProperty(property, value, priority || '');
        else element.style.removeProperty(property);
    }

    function showSidebar() {
        if (!sidebar || !layout || !main || !originalLayout) return;

        sidebar.removeAttribute(COLLAPSED_ATTR);
        sidebar.inert = false;
        restoreStyle(sidebar, 'display', originalLayout.sidebarDisplay, originalLayout.sidebarDisplayPriority);
        layout.style.setProperty('grid-template-columns', '320px minmax(0, 1fr)', 'important');
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
            hideNativeSingleChrome();
            ensureIcons();
            applyActiveState();
            applyVisibility();
        }

        applySidebarState();
    }

    function toggleSidebar() {
        if (!sidebar || !document.contains(sidebar)) apply();
        if (!sidebar) return;

        hidden = !hidden;
        writeSidebarHiddenState();
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