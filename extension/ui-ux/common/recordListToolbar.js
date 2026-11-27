(function () {
    'use strict';

    const KEY = '__tmRecordListToolbar';
    const STYLE_ID = 'tm-record-list-toolbar-style';
    const ROOT_ATTR = 'data-tm-record-list-toolbar';
    const GROUP_ATTR = 'data-tm-record-list-toolbar-group';
    const ICON_ATTR = 'data-tm-record-list-toolbar-icon';
    const COMPACT_ATTR = 'data-tm-ds-compact-control';
    const HIDDEN_ATTR = 'data-tm-ds-visually-hidden';
    const BADGE_ATTR = 'data-tm-ds-badge-label';
    const LIST_PATH = /^\/admin\/content-manager\/collection-types\/[^/]+\/?$/;
    const LOCALE_SELECTOR = '[role="combobox"][aria-label="Select a locale"], [role="combobox"][aria-label="Select locale"]';
    const ds = window.__tmStrapiDesignSystem;

    if (typeof ds?.createIcon !== 'function') {
        console.warn('[record-list-toolbar] Design System недоступен');
        return;
    }

    window[KEY]?.destroy?.();

    const applied = new Map();
    let desired = new Map();
    let icon = null;
    let frame = 0;
    let destroyed = false;

    function mark(node, attr, value = '') {
        if (!node) return;
        if (!desired.has(node)) desired.set(node, new Map());
        desired.get(node).set(attr, value);
    }

    function reconcile() {
        for (const [node, attrs] of applied) {
            for (const [attr, original] of attrs) {
                if (desired.get(node)?.has(attr)) continue;
                if (original === null) node.removeAttribute(attr);
                else node.setAttribute(attr, original);
                attrs.delete(attr);
            }
            if (!attrs.size) applied.delete(node);
        }
        for (const [node, attrs] of desired) {
            if (!applied.has(node)) applied.set(node, new Map());
            const originals = applied.get(node);
            for (const [attr, value] of attrs) {
                if (!originals.has(attr)) originals.set(attr, node.getAttribute(attr));
                if (node.getAttribute(attr) !== value) node.setAttribute(attr, value);
            }
        }
    }

    function label(node) {
        return (node.getAttribute('aria-label') || node.textContent || '').trim().replace(/\s+/g, ' ');
    }

    function findToolbar(main) {
        const settings = [...main.querySelectorAll('button[aria-haspopup="dialog"]')]
            .find(button => label(button) === 'View settings' && !button.closest('table,[role="grid"]'));
        const root = settings?.parentElement?.parentElement;
        if (!root || !main.contains(root) || root === main || root.closest('table,[role="grid"]')) return null;
        return root;
    }

    function decorateFilters(root) {
        for (const button of root.querySelectorAll('button[aria-haspopup="dialog"]')) {
            if (!/^Filters(?:\s*\(\d+\))?$/.test(label(button)) || !button.querySelector('svg')) continue;
            const text = [...button.children].find(child => /^Filters(?:\s*\(\d+\))?$/.test(child.textContent.trim()) && !child.querySelector('svg'));
            if (!text) continue;
            mark(button, COMPACT_ATTR);
            mark(text, HIDDEN_ATTR);
            mark(button, 'title', label(button));
        }
    }

    function localeCode(text) {
        const match = text.trim().match(/^(?:Russian\s*\(ru\)|Kazakh\s*\(kk\)|ru|kk)$/i);
        if (!match) return '';
        return /(?:russian|\bru\b)/i.test(match[0]) ? 'RU' : 'KK';
    }

    function decorateLocale(trigger) {
        if (!trigger) {
            icon?.remove();
            icon = null;
            return;
        }

        const current = [...trigger.children].filter(child => child !== icon).map(child => child.textContent).join(' ').trim();
        mark(trigger, COMPACT_ATTR);
        mark(trigger, 'title', current ? 'Select locale: ' + current : 'Select locale');
        if (!icon || icon.parentElement !== trigger) {
            icon?.remove();
            icon = ds.createIcon('Globe');
            if (!icon) return;
            icon.setAttribute(ICON_ATTR, '');
            trigger.appendChild(icon);
        }
        for (const child of trigger.children) {
            if (child !== icon) mark(child, HIDDEN_ATTR);
        }

        if (trigger.getAttribute('aria-expanded') !== 'true') return;
        const id = trigger.getAttribute('aria-controls');
        const listbox = id && document.getElementById(id);
        if (!listbox || listbox.getAttribute('role') !== 'listbox') return;
        for (const option of listbox.querySelectorAll('[role="option"]')) {
            const code = localeCode(option.textContent);
            if (!code) continue;
            const text = [...option.querySelectorAll('span')].reverse()
                .find(span => localeCode(span.textContent) === code && !span.querySelector('svg'));
            if (text) mark(text, BADGE_ATTR, code);
        }
    }

    function apply() {
        if (destroyed) return;
        desired = new Map();

        const main = LIST_PATH.test(location.pathname) && document.querySelector('main#main-content');
        const root = main && findToolbar(main);

        if (root) {
            mark(root, ROOT_ATTR);
            for (const group of root.children) {
                if (group.querySelector('button,[role="combobox"],input')) mark(group, GROUP_ATTR);
            }
            decorateFilters(root);
            decorateLocale(root.querySelector(LOCALE_SELECTOR));
        } else {
            decorateLocale(null);
        }

        reconcile();
    }

    function schedule() {
        if (destroyed || frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            apply();
        });
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        [${ROOT_ATTR}] {
            display:flex!important;
            justify-content:flex-end!important;
            align-items:center!important;
            flex-wrap:wrap!important;
            gap:var(--tm-ds-space2)!important;
        }
        [${ROOT_ATTR}] > [${GROUP_ATTR}] {
            flex:0 1 auto!important;
            min-width:0!important;
            justify-content:flex-end!important;
            gap:var(--tm-ds-space2)!important;
            flex-wrap:wrap;
        }
    `;
    (document.head || document.documentElement).appendChild(style);

    const observer = new MutationObserver(records => {
        if (records.some(record => {
            const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
            return target && !target.closest('table,[role="grid"]');
        })) schedule();
    });
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['aria-expanded', 'aria-controls', 'aria-label', 'data-state']
    });
    window.addEventListener('popstate', schedule);
    window.addEventListener('pageshow', schedule);

    function destroy() {
        destroyed = true;
        observer.disconnect();
        window.removeEventListener('popstate', schedule);
        window.removeEventListener('pageshow', schedule);
        if (frame) cancelAnimationFrame(frame);
        icon?.remove();
        desired = new Map();
        reconcile();
        style.remove();
        if (window[KEY]?.destroy === destroy) delete window[KEY];
    }

    window[KEY] = { destroy, apply: schedule };
    schedule();
})();
