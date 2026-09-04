// ==UserScript==
// @name         toggle-sidebar
// @version      4.0
// @description  Sidebar скрыт по умолчанию, Alt+S переключает его
// @match        http://10.10.3.80:1337/admin/*
// @updateURL    https://raw.githubusercontent.com/mbtema/strapi/main/strapi-improve-scripts/toggle-sidebar.js
// @downloadURL  https://raw.githubusercontent.com/mbtema/strapi/main/strapi-improve-scripts/toggle-sidebar.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // При загрузке sidebar скрыт
    let hidden = true;

    let sidebar = null;
    let layout = null;
    let main = null;

    let original = null;


    // =========================================================
    // ПОИСК SIDEBAR
    // =========================================================

    function findSidebar() {
        const candidates = [
            ...document.querySelectorAll('aside, nav, div')
        ].filter(element => {

            const text = element.innerText || '';
            const rect = element.getBoundingClientRect();

            return (
                text.includes('Content Manager') &&
                text.includes('COLLECTION TYPES') &&
                rect.width >= 150 &&
                rect.width <= 350 &&
                rect.left < 300 &&
                rect.height > 300
            );
        });

        candidates.sort(
            (a, b) =>
                a.offsetWidth * a.offsetHeight -
                b.offsetWidth * b.offsetHeight
        );

        return candidates[0] || null;
    }


    // =========================================================
    // ИНИЦИАЛИЗАЦИЯ
    // =========================================================

    function init() {

        /*
         * КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ:
         *
         * если sidebar уже найден, даже если он display:none,
         * используем сохранённую ссылку и НЕ ищем его заново.
         */

        if (
            sidebar &&
            document.contains(sidebar) &&
            layout &&
            main
        ) {
            return true;
        }


        const foundSidebar = findSidebar();

        if (!foundSidebar) {
            return false;
        }

        sidebar = foundSidebar;
        layout = sidebar.parentElement;

        main = [...layout.children].find(
            child => child !== sidebar
        );

        if (!main) {
            console.log('[Sidebar] Main content not found');
            return false;
        }


        // Сохраняем исходные стили Strapi
        original = {
            sidebarDisplay:
                sidebar.style.getPropertyValue('display'),

            sidebarDisplayPriority:
                sidebar.style.getPropertyPriority('display'),

            gridTemplateColumns:
                layout.style.getPropertyValue(
                    'grid-template-columns'
                ),

            gridTemplatePriority:
                layout.style.getPropertyPriority(
                    'grid-template-columns'
                ),

            mainGridColumn:
                main.style.getPropertyValue('grid-column'),

            mainGridColumnPriority:
                main.style.getPropertyPriority('grid-column'),

            mainWidth:
                main.style.getPropertyValue('width'),

            mainWidthPriority:
                main.style.getPropertyPriority('width'),

            mainMaxWidth:
                main.style.getPropertyValue('max-width'),

            mainMaxWidthPriority:
                main.style.getPropertyPriority('max-width')
        };

        return true;
    }


    // =========================================================
    // СКРЫТЬ
    // =========================================================

    function hideSidebar() {

        sidebar.style.setProperty(
            'display',
            'none',
            'important'
        );

        layout.style.setProperty(
            'grid-template-columns',
            'minmax(0, 1fr)',
            'important'
        );

        main.style.setProperty(
            'grid-column',
            '1 / -1',
            'important'
        );

        main.style.setProperty(
            'width',
            '100%',
            'important'
        );

        main.style.setProperty(
            'max-width',
            'none',
            'important'
        );
    }


    // =========================================================
    // ПОКАЗАТЬ
    // =========================================================

    function showSidebar() {

        // Сначала удаляем наши !important
        sidebar.style.removeProperty('display');

        layout.style.removeProperty(
            'grid-template-columns'
        );

        main.style.removeProperty('grid-column');
        main.style.removeProperty('width');
        main.style.removeProperty('max-width');


        // Возвращаем исходные значения, если они были
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


    // =========================================================
    // ПРИМЕНИТЬ СОСТОЯНИЕ
    // =========================================================

    function applyState() {

        if (!init()) {
            return;
        }

        if (hidden) {
            hideSidebar();
        } else {
            showSidebar();
        }
    }


    // =========================================================
    // TOGGLE
    // =========================================================

    function toggle() {

        if (!init()) {
            return;
        }

        hidden = !hidden;

        if (hidden) {
            hideSidebar();
        } else {
            showSidebar();
        }

        console.log(
            `[Sidebar] ${hidden ? 'Hidden' : 'Visible'}`
        );
    }


    // =========================================================
    // ALT + S
    // =========================================================

    window.addEventListener(
        'keydown',
        event => {

            const isS =
                event.code === 'KeyS' ||
                event.key.toLowerCase() === 's' ||
                event.key.toLowerCase() === 'ы';

            if (
                event.altKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                isS
            ) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();

                // Защита от удерживания клавиши
                if (event.repeat) {
                    return;
                }

                toggle();
            }
        },
        true
    );


    // =========================================================
    // REACT
    // =========================================================

    let scheduled = false;

    const observer = new MutationObserver(() => {

        /*
         * Если React уничтожил sidebar при переходе
         * между страницами — ищем новый.
         */

        if (
            sidebar &&
            document.contains(sidebar)
        ) {
            return;
        }

        sidebar = null;
        layout = null;
        main = null;
        original = null;

        if (scheduled) return;

        scheduled = true;

        requestAnimationFrame(() => {
            scheduled = false;
            applyState();
        });
    });


    observer.observe(document.body, {
        childList: true,
        subtree: true
    });


    // Первый запуск
    setTimeout(
        applyState,
        300
    );

})();
