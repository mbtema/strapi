// ==StrapiExtension==
// @name         entry-relocate
// @version      1.4.5
// @description  Переносит действия Entry в строку с Draft / Published
// ==/StrapiExtension==

(function () {
    'use strict';

    const ENTRY_SELECTOR = 'aside[aria-labelledby="additional-information"]';
    const TABLIST_SELECTOR = '[role="tablist"]';
    const DOCUMENT_TABLIST_SELECTOR = '[role="tablist"][aria-label="Document status"]';
    const TOOLBAR_SELECTOR = '[data-tm-entry-toolbar="true"]';
    const ACTIONS_SELECTOR = '[data-tm-entry-actions="true"]';

    let currentState = null;
    let frameScheduled = false;

    function getEntry() {
        return document.querySelector(ENTRY_SELECTOR);
    }

    function findTabList() {
        const documentTabList = document.querySelector(DOCUMENT_TABLIST_SELECTOR);
        if (documentTabList) return documentTabList;

        const tabList = [...document.querySelectorAll(TABLIST_SELECTOR)]
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

    function findLayoutFromTabList(tabList, aside) {
        if (!tabList) return null;

        const toolbar = tabList.closest(TOOLBAR_SELECTOR);
        const tabsRoot = toolbar?.parentElement || tabList.parentElement;
        if (!tabsRoot) return null;

        const layoutContainer = [...tabsRoot.children]
            .find(child =>
                child !== tabList &&
                child !== toolbar &&
                child.querySelector?.('[role="tabpanel"]')
            );

        if (!layoutContainer) return null;

        const columns = [...layoutContainer.children];
        const mainColumn = columns.find(column =>
            column.querySelector?.('[role="tabpanel"]')
        );

        if (!mainColumn) return null;

        let entryColumn = aside
            ? columns.find(column =>
                column !== mainColumn &&
                (column === aside || column.contains(aside))
            )
            : null;

        if (!entryColumn) {
            const otherColumns = columns.filter(column => column !== mainColumn);
            if (otherColumns.length === 1) {
                [entryColumn] = otherColumns;
            }
        }

        if (!entryColumn) return null;

        return {
            container: layoutContainer,
            entryColumn,
            mainColumn
        };
    }

    function findLayoutFromEntry(aside) {
        if (!aside) return null;

        let node = aside;

        while (node?.parentElement) {
            const parent = node.parentElement;
            const children = [...parent.children];
            const entryColumn = children.find(child =>
                child === node || child.contains(aside)
            );

            if (!entryColumn) {
                node = parent;
                continue;
            }

            const siblings = children.filter(child => child !== entryColumn);
            const semanticMain = siblings.find(child =>
                child.querySelector?.('[role="tabpanel"]')
            );

            if (semanticMain) {
                return {
                    container: parent,
                    entryColumn,
                    mainColumn: semanticMain
                };
            }

            if (siblings.length === 1) {
                return {
                    container: parent,
                    entryColumn,
                    mainColumn: siblings[0]
                };
            }

            node = parent;
        }

        return null;
    }

    function findLayout(aside, tabList) {
        return (
            findLayoutFromTabList(tabList, aside) ||
            findLayoutFromEntry(aside)
        );
    }

    function createState(layout) {
        return {
            container: layout.container,
            layout,
            aside: null,
            tabList: null,
            toolbar: null,
            actions: null,
            styleSnapshots: new Map(),
            buttonOrigins: new Map()
        };
    }

    function rememberStyle(state, element, property) {
        let elementSnapshot = state.styleSnapshots.get(element);

        if (!elementSnapshot) {
            elementSnapshot = new Map();
            state.styleSnapshots.set(element, elementSnapshot);
        }

        if (elementSnapshot.has(property)) return;

        elementSnapshot.set(property, {
            value: element.style.getPropertyValue(property),
            priority: element.style.getPropertyPriority(property)
        });
    }

    function setManagedStyle(
        state,
        element,
        property,
        value,
        priority = 'important'
    ) {
        if (!element) return;
        rememberStyle(state, element, property);
        element.style.setProperty(property, value, priority);
    }

    function restoreStyles(state) {
        for (const [element, properties] of state.styleSnapshots) {
            if (!document.contains(element)) continue;

            for (const [property, snapshot] of properties) {
                if (snapshot.value) {
                    element.style.setProperty(
                        property,
                        snapshot.value,
                        snapshot.priority
                    );
                } else {
                    element.style.removeProperty(property);
                }
            }
        }

        state.styleSnapshots.clear();
    }

    function applyLayout(state, layout) {
        state.layout = layout;

        const { container, entryColumn, mainColumn } = layout;

        setManagedStyle(state, container, 'display', 'block');
        setManagedStyle(state, container, 'width', '100%');

        setManagedStyle(state, mainColumn, 'width', '100%');
        setManagedStyle(state, mainColumn, 'max-width', 'none');
        setManagedStyle(state, mainColumn, 'grid-column', 'auto');
        setManagedStyle(state, mainColumn, 'grid-row', 'auto');

        setManagedStyle(state, entryColumn, 'display', 'none');
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

    function styleButton(state, button, width) {
        setManagedStyle(state, button, 'height', '32px');
        setManagedStyle(state, button, 'width', width);
        setManagedStyle(state, button, 'min-width', width);
        setManagedStyle(state, button, 'max-width', width);
        setManagedStyle(state, button, 'margin', '0');
        setManagedStyle(state, button, 'flex', '0 0 auto');
    }

    function createToolbar(state, tabList) {
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
        if (!parent) return null;

        parent.insertBefore(toolbar, tabList);
        toolbar.appendChild(tabList);
        toolbar.appendChild(actions);

        setManagedStyle(state, tabList, 'flex', '0 0 auto');
        setManagedStyle(state, tabList, 'margin', '0');

        state.tabList = tabList;
        state.toolbar = toolbar;
        state.actions = actions;

        return { toolbar, actions };
    }

    function getToolbar(state, tabList) {
        const existingToolbar = tabList.closest(TOOLBAR_SELECTOR);

        if (existingToolbar) {
            const actions = existingToolbar.querySelector(ACTIONS_SELECTOR);

            if (actions) {
                state.tabList = tabList;
                state.toolbar = existingToolbar;
                state.actions = actions;

                setManagedStyle(state, tabList, 'flex', '0 0 auto');
                setManagedStyle(state, tabList, 'margin', '0');

                return { toolbar: existingToolbar, actions };
            }
        }

        return createToolbar(state, tabList);
    }

    function rememberButtonOrigin(state, button) {
        if (state.buttonOrigins.has(button)) return;

        state.buttonOrigins.set(button, {
            parent: button.parentNode,
            nextSibling: button.nextSibling
        });
    }

    function clearDetachedButtonOrigins(state) {
        for (const button of state.buttonOrigins.keys()) {
            if (!document.contains(button)) {
                state.buttonOrigins.delete(button);
            }
        }
    }

    function moveButtons(state, aside, actions) {
        const buttons = classifyButtons(aside);
        if (!buttons.publish || !buttons.save) return false;

        if (actions.querySelector('button')) {
            actions.replaceChildren();
            clearDetachedButtonOrigins(state);
        }

        const orderedButtons = [
            buttons.publish,
            buttons.save,
            ...buttons.rest
        ];

        orderedButtons.forEach(button => {
            rememberButtonOrigin(state, button);
            actions.appendChild(button);
        });

        styleButton(state, buttons.publish, '128px');
        styleButton(state, buttons.save, '128px');
        buttons.rest.forEach(button => styleButton(state, button, '32px'));

        aside.dataset.tmEntryMoved = 'true';
        state.aside = aside;

        return true;
    }

    function restoreButtons(state) {
        const origins = [...state.buttonOrigins.entries()];

        origins.forEach(([button, origin]) => {
            if (!document.contains(button)) return;
            if (!origin.parent || !document.contains(origin.parent)) return;

            if (
                origin.nextSibling &&
                origin.nextSibling.parentNode === origin.parent
            ) {
                origin.parent.insertBefore(button, origin.nextSibling);
            } else {
                origin.parent.appendChild(button);
            }
        });

        state.buttonOrigins.clear();
    }

    function restoreToolbar(state) {
        const { toolbar, tabList } = state;

        if (
            toolbar &&
            tabList &&
            document.contains(toolbar) &&
            document.contains(tabList) &&
            toolbar.contains(tabList) &&
            toolbar.parentNode
        ) {
            toolbar.parentNode.insertBefore(tabList, toolbar);
        }

        if (toolbar && document.contains(toolbar)) {
            toolbar.remove();
        }

        state.toolbar = null;
        state.actions = null;
        state.tabList = null;
    }

    function cleanupState(restore = true) {
        if (!currentState) return;

        const state = currentState;

        if (restore) {
            restoreButtons(state);
            restoreToolbar(state);
            restoreStyles(state);

            if (state.aside && document.contains(state.aside)) {
                delete state.aside.dataset.tmEntryMoved;
            }
        }

        currentState = null;
    }

    function ensureCurrentState(layout) {
        if (
            currentState &&
            currentState.container !== layout.container
        ) {
            cleanupState(document.contains(currentState.container));
        }

        if (!currentState) {
            currentState = createState(layout);
        }

        return currentState;
    }

    function refreshDetachedState() {
        if (!currentState) return;

        if (!document.contains(currentState.container)) {
            cleanupState(false);
            return;
        }

        if (
            currentState.toolbar &&
            !document.contains(currentState.toolbar)
        ) {
            currentState.toolbar = null;
            currentState.actions = null;
            currentState.tabList = null;
            currentState.buttonOrigins.clear();
            return;
        }

        if (
            currentState.tabList &&
            !document.contains(currentState.tabList)
        ) {
            if (
                currentState.toolbar &&
                document.contains(currentState.toolbar)
            ) {
                currentState.toolbar.remove();
            }

            currentState.toolbar = null;
            currentState.actions = null;
            currentState.tabList = null;
            currentState.buttonOrigins.clear();
        }
    }

    function apply() {
        refreshDetachedState();

        const tabList = findTabList();
        const aside = getEntry();
        const layout = findLayout(aside, tabList);

        if (!layout) return;

        const state = ensureCurrentState(layout);

        // Layout is fixed as soon as Strapi renders the document columns.
        // Buttons can arrive later without keeping the Entry column visible.
        applyLayout(state, layout);

        if (!tabList) return;

        if (
            state.tabList &&
            state.tabList !== tabList &&
            document.contains(state.tabList)
        ) {
            cleanupState(true);

            const freshLayout = findLayout(aside, tabList);
            if (!freshLayout) return;

            const freshState = ensureCurrentState(freshLayout);
            applyLayout(freshState, freshLayout);

            if (!aside) return;

            const toolbarState = getToolbar(freshState, tabList);
            if (!toolbarState) return;

            moveButtons(freshState, aside, toolbarState.actions);
            return;
        }

        if (!aside) return;

        const toolbarState = getToolbar(state, tabList);
        if (!toolbarState) return;

        moveButtons(state, aside, toolbarState.actions);
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

        scheduleApply();
    }

    start();
})();
