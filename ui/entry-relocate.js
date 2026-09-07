// ==StrapiExtension==
// @name         entry-relocate
// @version      1.4.1
// @description  Переносит действия Entry в строку с Draft / Published
// ==/StrapiExtension==

(function () {
    'use strict';

    let currentAside = null;
    let frameScheduled = false;

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
                .map(child => ({
                    child,
                    rect: child.getBoundingClientRect()
                }))
                .filter(({ rect }) => (
                    rect.width > entryRect.width &&
                    rect.width > 500 &&
                    rect.height > 200
                ))
                .sort((a, b) => b.rect.width - a.rect.width)[0];

            if (
                mainColumn &&
                Math.abs(mainColumn.rect.top - entryRect.top) < 100
            ) {
                return {
                    container: parent,
                    entryColumn,
                    mainColumn: mainColumn.child
                };
            }

            node = parent;
        }

        return null;
    }

    function findTabList() {
        const tabList = [...document.querySelectorAll('[role="tablist"]')]
            .find(element => {
                const text = element.textContent || '';
                return /draft/i.test(text) && /published/i.test(text);
            });

        if (tabList) return tabList;

        const tabs = [...document.querySelectorAll('[role="tab"]')];
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

        return {
            publish,
            save,
            rest: buttons.filter(button =>
                button !== publish && button !== save
            )
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

        Object.assign(toolbar.style, {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            width: '100%',
            minWidth: '0'
        });

        Object.assign(actions.style, {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '8px',
            marginLeft: 'auto',
            flexWrap: 'nowrap',
            width: 'auto',
            padding: '0',
            border: '0',
            background: 'transparent'
        });

        const parent = tabList.parentElement;
        parent.insertBefore(toolbar, tabList);
        toolbar.appendChild(tabList);
        toolbar.appendChild(actions);

        tabList.style.setProperty('flex', '0 0 auto', 'important');
        tabList.style.setProperty('margin', '0', 'important');

        return { actions };
    }

    function cleanupOldToolbars(tabList) {
        document
            .querySelectorAll('[data-tm-entry-toolbar="true"]')
            .forEach(toolbar => {
                if (!toolbar.contains(tabList)) toolbar.remove();
            });
    }

    function apply() {
        const aside = getEntry();

        if (!aside) {
            currentAside = null;
            return;
        }

        const existingToolbar = document.querySelector(
            '[data-tm-entry-toolbar="true"]'
        );

        if (
            aside === currentAside &&
            aside.dataset.tmEntryMoved === 'true' &&
            existingToolbar
        ) return;

        const layout = findLayout(aside);
        const tabList = findTabList();

        if (!layout || !tabList) return;

        const buttons = classifyButtons(aside);
        if (!buttons.publish || !buttons.save) return;

        cleanupOldToolbars(tabList);

        const { container, entryColumn, mainColumn } = layout;
        container.style.setProperty('display', 'block', 'important');
        container.style.setProperty('width', '100%', 'important');

        mainColumn.style.setProperty('width', '100%', 'important');
        mainColumn.style.setProperty('max-width', 'none', 'important');
        mainColumn.style.setProperty('grid-column', 'auto', 'important');
        mainColumn.style.setProperty('grid-row', 'auto', 'important');

        const { actions } = createToolbar(tabList);
        actions.appendChild(buttons.publish);
        actions.appendChild(buttons.save);
        buttons.rest.forEach(button => actions.appendChild(button));

        styleButton(buttons.publish, '128px');
        styleButton(buttons.save, '128px');
        buttons.rest.forEach(button => styleButton(button, '32px'));

        entryColumn.style.setProperty('display', 'none', 'important');
        aside.dataset.tmEntryMoved = 'true';
        currentAside = aside;
    }

    function scheduleApply() {
        if (frameScheduled) return;
        frameScheduled = true;

        requestAnimationFrame(() => {
            frameScheduled = false;

            if (currentAside && !document.contains(currentAside)) {
                currentAside = null;
            }

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

        scheduleApply();
    }

    start();
})();
