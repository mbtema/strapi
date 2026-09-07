// ==StrapiExtension==
// @name         toggle-sidebar
// @version      1.3.4
// @description  Sidebar скрыт по умолчанию, Alt+S переключает его; scrollbar и маркеры коллекций скрыты визуально
// ==/StrapiExtension==

(function () {
    'use strict';

    const SIDEBAR_ATTR = 'data-tm-content-manager-sidebar';
    const STYLE_ID = 'tm-sidebar-ui-style';
    const LINK_SELECTOR = 'a[href*="/admin/content-manager/collection-types/"]';

    let hidden = true;
    let sidebar = null;
    let layout = null;
    let main = null;
    let original = null;
    let scheduled = false;

    function ensureSidebarStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
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

            [${SIDEBAR_ATTR}] li::marker {
                content: '' !important;
                color: transparent !important;
                font-size: 0 !important;
            }

            [${SIDEBAR_ATTR}] li::before {
                content: none !important;
                display: none !important;
            }

            [${SIDEBAR_ATTR}] a[href*="/admin/content-manager/collection-types/"] > * > span:first-child:empty,
            [${SIDEBAR_ATTR}] a[href*="/admin/content-manager/collection-types/"] span.sc-lnlaAf.fhEUqV:empty {
                display: none !important;
                width: 0 !important;
                height: 0 !important;
                min-width: 0 !important;
                min-height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                border: 0 !important;
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    function findSidebar() {
        const direct = document.querySelector(
            'nav[aria-label="Content Manager"]'
        );

        if (direct) return direct;

        const candidates = [...document.querySelectorAll('aside, nav, div')]
            .filter(element => {
                const rect = element.getBoundingClientRect();
                const links = element.querySelectorAll(LINK_SELECTOR);

                return (
                    links.length >= 2 &&
                    rect.width >= 150 &&
                    rect.width <= 350 &&
                    rect.left < 300 &&
                    rect.height > 300
                );
            });

        candidates.sort(
            (a, b) =>
                a.querySelectorAll('*').length -
                b.querySelectorAll('*').length
        );

        return candidates[0] || null;
    }

    function init() {
        ensureSidebarStyle();

        if (
            sidebar &&
            document.contains(sidebar) &&
            layout &&
            main
        ) {
            sidebar.setAttribute(SIDEBAR_ATTR, '');
            return true;
        }

        const foundSidebar = findSidebar();
        if (!foundSidebar) return false;

        sidebar = foundSidebar;
        sidebar.setAttribute(SIDEBAR_ATTR, '');
        layout = sidebar.parentElement;
        main = [...layout.children].find(child => child !== sidebar);

        if (!main) {
            console.log('[Sidebar] Main content not found');
            return false;
        }

        original = {
            sidebarDisplay: sidebar.style.getPropertyValue('display'),
            sidebarDisplayPriority: sidebar.style.getPropertyPriority('display'),
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

    function hideSidebar() {
        sidebar.style.setProperty('display', 'none', 'important');
        layout.style.setProperty(
            'grid-template-columns',
            'minmax(0, 1fr)',
            'important'
        );
        main.style.setProperty('grid-column', '1 / -1', 'important');
        main.style.setProperty('width', '100%', 'important');
        main.style.setProperty('max-width', 'none', 'important');
    }

    function showSidebar() {
        sidebar.style.removeProperty('display');
        layout.style.removeProperty('grid-template-columns');
        main.style.removeProperty('grid-column');
        main.style.removeProperty('width');
        main.style.removeProperty('max-width');

        if (original.sidebarDisplay) {
            sidebar.style.setProperty(
                'display',
                original.sidebarDisplay,
                original.sidebarDisplayPriority
            );
        }

        if (original.gridTemplateColumns) {
            layout.style.setProperty(
                'grid-template-columns',
                original.gridTemplateColumns,
                original.gridTemplatePriority
            );
        }

        if (original.mainGridColumn) {
            main.style.setProperty(
                'grid-column',
                original.mainGridColumn,
                original.mainGridColumnPriority
            );
        }

        if (original.mainWidth) {
            main.style.setProperty(
                'width',
                original.mainWidth,
                original.mainWidthPriority
            );
        }

        if (original.mainMaxWidth) {
            main.style.setProperty(
                'max-width',
                original.mainMaxWidth,
                original.mainMaxWidthPriority
            );
        }
    }

    function applyState() {
        if (!init()) return;
        hidden ? hideSidebar() : showSidebar();
    }

    function toggle() {
        if (!init()) return;
        hidden = !hidden;
        hidden ? hideSidebar() : showSidebar();
        console.log(`[Sidebar] ${hidden ? 'Hidden' : 'Visible'}`);
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

            if (!event.repeat) toggle();
        }
    }, true);

    function scheduleApply() {
        if (scheduled) return;
        scheduled = true;

        requestAnimationFrame(() => {
            scheduled = false;
            applyState();
        });
    }

    const observer = new MutationObserver(() => {
        if (sidebar && document.contains(sidebar)) return;

        sidebar = null;
        layout = null;
        main = null;
        original = null;
        scheduleApply();
    });

    function start() {
        if (!document.documentElement) {
            requestAnimationFrame(start);
            return;
        }

        ensureSidebarStyle();
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
        scheduleApply();
    }

    start();
})();
