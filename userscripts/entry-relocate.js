// ==UserScript==
// @name         entry-relocate
// @version      1.3
// @description  Переносит действия Entry в строку с Draft / Published
// @match        http://10.10.3.80:1337/admin/*
// @updateURL    https://raw.githubusercontent.com/mbtema/strapi/main/userscripts/entry-relocate.js
// @downloadURL  https://raw.githubusercontent.com/mbtema/strapi/main/userscripts/entry-relocate.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let currentAside = null;
    let timer;

    function getEntry() {
        return document.querySelector(
            'aside[aria-labelledby="additional-information"]'
        );
    }

    function findLayout(aside) {
        let node = aside;

        while (node?.parentElement) {
            const parent = node.parentElement;
            const children = [...parent.children];

            const entryColumn = children.find(
                child => child.contains(aside)
            );

            if (!entryColumn) {
                node = parent;
                continue;
            }

            const entryRect = entryColumn.getBoundingClientRect();

            const mainColumn = children
                .filter(child => child !== entryColumn)
                .filter(child => {
                    const rect = child.getBoundingClientRect();

                    return (
                        rect.width > entryRect.width &&
                        rect.width > 500 &&
                        rect.height > 200
                    );
                })
                .sort(
                    (a, b) =>
                        b.getBoundingClientRect().width -
                        a.getBoundingClientRect().width
                )[0];

            if (mainColumn) {
                const mainRect = mainColumn.getBoundingClientRect();

                if (Math.abs(mainRect.top - entryRect.top) < 100) {
                    return {
                        container: parent,
                        entryColumn,
                        mainColumn
                    };
                }
            }

            node = parent;
        }

        return null;
    }

    function findTabList() {
        const tabLists = [
            ...document.querySelectorAll('[role="tablist"]')
        ];

        let tabList = tabLists.find(element => {
            const text = element.textContent || '';

            return (
                /draft/i.test(text) &&
                /published/i.test(text)
            );
        });

        if (tabList) return tabList;

        const tabs = [
            ...document.querySelectorAll('[role="tab"]')
        ];

        const draftTab = tabs.find(tab =>
            /^draft$/i.test(tab.textContent?.trim() || '')
        );

        const publishedTab = tabs.find(tab =>
            /^published$/i.test(tab.textContent?.trim() || '')
        );

        if (
            draftTab &&
            publishedTab &&
            draftTab.parentElement === publishedTab.parentElement
        ) {
            return draftTab.parentElement;
        }

        return null;
    }

    function classifyButtons(aside) {
        const buttons = [...aside.querySelectorAll('button')];

        const publish = buttons.find(button =>
            /^publish$/i.test(button.textContent?.trim() || '')
        );

        const save = buttons.find(button =>
            /^save$/i.test(button.textContent?.trim() || '')
        );

        const rest = buttons.filter(
            button => button !== publish && button !== save
        );

        return {
            publish,
            save,
            rest,
            all: buttons
        };
    }

    function styleButton(button, width) {
        button.style.setProperty('height', '32px', 'important');
        button.style.setProperty('width', width, 'important');
        button.style.setProperty('min-width', width, 'important');
        button.style.setProperty('max-width', width, 'important');
        button.style.setProperty('margin', '0', 'important');
        button.style.setProperty('flex', '0 0 auto', 'important');
    }

    function createToolbar(tabList) {
        const toolbar = document.createElement('div');
        const actions = document.createElement('div');

        toolbar.dataset.tmEntryToolbar = 'true';
        actions.dataset.tmEntryActions = 'true';

        toolbar.style.setProperty('display', 'flex', 'important');
        toolbar.style.setProperty('align-items', 'center', 'important');
        toolbar.style.setProperty('justify-content', 'space-between', 'important');
        toolbar.style.setProperty('gap', '16px', 'important');
        toolbar.style.setProperty('width', '100%', 'important');
        toolbar.style.setProperty('min-width', '0', 'important');

        actions.style.setProperty('display', 'flex', 'important');
        actions.style.setProperty('align-items', 'center', 'important');
        actions.style.setProperty('justify-content', 'flex-end', 'important');
        actions.style.setProperty('gap', '8px', 'important');
        actions.style.setProperty('margin-left', 'auto', 'important');
        actions.style.setProperty('flex-wrap', 'nowrap', 'important');
        actions.style.setProperty('width', 'auto', 'important');
        actions.style.setProperty('padding', '0', 'important');
        actions.style.setProperty('border', '0', 'important');
        actions.style.setProperty('background', 'transparent', 'important');

        const parent = tabList.parentElement;

        parent.insertBefore(toolbar, tabList);
        toolbar.appendChild(tabList);
        toolbar.appendChild(actions);

        tabList.style.setProperty('flex', '0 0 auto', 'important');
        tabList.style.setProperty('margin', '0', 'important');

        return {
            toolbar,
            actions
        };
    }

    function cleanupOldToolbars(tabList) {
        document
            .querySelectorAll('[data-tm-entry-toolbar="true"]')
            .forEach(toolbar => {
                if (toolbar.contains(tabList)) return;

                toolbar.remove();
            });
    }

    function apply() {
        const aside = getEntry();

        if (!aside) {
            currentAside = null;
            return;
        }

        if (
            aside === currentAside &&
            aside.dataset.tmEntryMoved === 'true'
        ) {
            return;
        }

        const layout = findLayout(aside);
        const tabList = findTabList();

        if (!layout || !tabList) {
            console.log(
                '[ENTRY] Не удалось найти layout или Draft / Published'
            );
            return;
        }

        const buttons = classifyButtons(aside);

        if (!buttons.publish || !buttons.save) {
            console.log('[ENTRY] Не удалось найти Publish / Save');
            return;
        }

        cleanupOldToolbars(tabList);

        const {
            container,
            entryColumn,
            mainColumn
        } = layout;

        // Основная форма остаётся полноширинной.
        container.style.setProperty('display', 'block', 'important');
        container.style.setProperty('width', '100%', 'important');

        mainColumn.style.setProperty('width', '100%', 'important');
        mainColumn.style.setProperty('max-width', 'none', 'important');
        mainColumn.style.setProperty('grid-column', 'auto', 'important');
        mainColumn.style.setProperty('grid-row', 'auto', 'important');

        // Создаём собственную строку:
        // DRAFT / PUBLISHED                    Publish Save ...
        const {
            actions
        } = createToolbar(tabList);

        // Переносим именно кнопки, без карточки Entry и её внутренних обёрток.
        actions.appendChild(buttons.publish);
        actions.appendChild(buttons.save);

        buttons.rest.forEach(button => {
            actions.appendChild(button);
        });

        styleButton(buttons.publish, '128px');
        styleButton(buttons.save, '128px');

        buttons.rest.forEach(button => {
            styleButton(button, '32px');
        });

        // Исходная колонка Entry теперь не нужна.
        entryColumn.style.setProperty('display', 'none', 'important');

        aside.dataset.tmEntryMoved = 'true';
        currentAside = aside;

        console.log(
            '[ENTRY] v1.3: Publish / Save / ... вынесены в одну строку'
        );
    }

    setTimeout(apply, 300);

    const observer = new MutationObserver(() => {
        clearTimeout(timer);

        timer = setTimeout(() => {
            if (
                currentAside &&
                !document.contains(currentAside)
            ) {
                currentAside = null;
            }

            apply();
        }, 100);
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();
