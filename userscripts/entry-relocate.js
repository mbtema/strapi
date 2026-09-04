// ==UserScript==
// @name         entry-relocate
// @version      1.2
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

    function flattenButtonWrappers(aside, buttons) {
        const wrappers = new Set();

        buttons.forEach(button => {
            let node = button.parentElement;

            while (node && node !== aside) {
                if (node.tagName === 'DIV') {
                    wrappers.add(node);
                }

                node = node.parentElement;
            }
        });

        wrappers.forEach(wrapper => {
            wrapper.style.setProperty(
                'display',
                'contents',
                'important'
            );
        });
    }

    function styleActions(aside) {
        const title = aside.querySelector('h2');

        if (title) {
            title.style.setProperty(
                'display',
                'none',
                'important'
            );
        }

        const buttons = [...aside.querySelectorAll('button')];

        if (!buttons.length) return false;

        flattenButtonWrappers(aside, buttons);

        aside.style.setProperty('display', 'flex', 'important');
        aside.style.setProperty('flex-direction', 'row', 'important');
        aside.style.setProperty('align-items', 'center', 'important');
        aside.style.setProperty('gap', '8px', 'important');
        aside.style.setProperty('width', 'auto', 'important');
        aside.style.setProperty('min-width', '0', 'important');
        aside.style.setProperty('padding', '0', 'important');
        aside.style.setProperty('margin', '0', 'important');
        aside.style.setProperty('border', '0', 'important');
        aside.style.setProperty('background', 'transparent', 'important');
        aside.style.setProperty('box-shadow', 'none', 'important');

        buttons.forEach(button => {
            const text = (button.textContent || '')
                .trim()
                .toLowerCase();

            const label = (
                button.getAttribute('aria-label') || ''
            ).toLowerCase();

            const isPublish = text === 'publish';
            const isSave = text === 'save';
            const isMore =
                !isPublish &&
                !isSave &&
                (
                    label.includes('more') ||
                    label.includes('action') ||
                    text === '' ||
                    text === '...'
                );

            button.style.setProperty('height', '32px', 'important');
            button.style.setProperty('margin', '0', 'important');
            button.style.setProperty('flex', '0 0 auto', 'important');

            if (isPublish) {
                button.style.setProperty('order', '1', 'important');
                button.style.setProperty('width', '128px', 'important');
            } else if (isSave) {
                button.style.setProperty('order', '2', 'important');
                button.style.setProperty('width', '128px', 'important');
            } else {
                button.style.setProperty('order', '3', 'important');

                if (isMore) {
                    button.style.setProperty('width', '32px', 'important');
                    button.style.setProperty('min-width', '32px', 'important');
                }
            }
        });

        return true;
    }

    function createToolbar(tabList) {
        const toolbar = document.createElement('div');

        toolbar.dataset.tmEntryToolbar = 'true';

        toolbar.style.setProperty('display', 'flex', 'important');
        toolbar.style.setProperty('align-items', 'center', 'important');
        toolbar.style.setProperty('justify-content', 'space-between', 'important');
        toolbar.style.setProperty('gap', '16px', 'important');
        toolbar.style.setProperty('width', '100%', 'important');

        const parent = tabList.parentElement;

        parent.insertBefore(toolbar, tabList);
        toolbar.appendChild(tabList);

        tabList.style.setProperty('flex', '0 0 auto', 'important');

        return toolbar;
    }

    function cleanupStaleToolbar(aside) {
        document
            .querySelectorAll('[data-tm-entry-toolbar="true"]')
            .forEach(toolbar => {
                if (!toolbar.contains(aside)) {
                    const tabList = toolbar.querySelector('[role="tablist"]');

                    if (tabList && toolbar.parentElement) {
                        toolbar.parentElement.insertBefore(tabList, toolbar);
                    }

                    toolbar.remove();
                }
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

        cleanupStaleToolbar(aside);

        const layout = findLayout(aside);
        const tabList = findTabList();

        if (!layout || !tabList) {
            console.log(
                '[ENTRY] Не удалось найти layout или Draft / Published'
            );
            return;
        }

        const {
            container,
            entryColumn,
            mainColumn
        } = layout;

        // Возвращаем форме обычную полноширинную схему.
        container.style.setProperty('display', 'block', 'important');
        container.style.setProperty('width', '100%', 'important');

        mainColumn.style.setProperty('width', '100%', 'important');
        mainColumn.style.setProperty('max-width', 'none', 'important');
        mainColumn.style.setProperty('grid-column', 'auto', 'important');
        mainColumn.style.setProperty('grid-row', 'auto', 'important');

        // Старую колонку Entry больше не используем.
        entryColumn.style.setProperty('display', 'none', 'important');

        // Создаём отдельную строку только вокруг табов.
        // DRAFT / PUBLISHED                    Publish Save ...
        const toolbar = createToolbar(tabList);

        // Переносим только сам aside, без внешней карточки/колонки.
        toolbar.appendChild(aside);

        if (!styleActions(aside)) {
            console.log('[ENTRY] Не удалось найти кнопки Entry');
            return;
        }

        aside.dataset.tmEntryMoved = 'true';
        currentAside = aside;

        console.log(
            '[ENTRY] v1.2: действия выровнены с Draft / Published'
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
