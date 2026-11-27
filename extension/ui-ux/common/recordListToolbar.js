(function () {
    'use strict';

    const KEY = '__tmRecordListToolbar';
    const STYLE_ID = 'tm-record-list-toolbar-style';
    const ROOT_ATTR = 'data-tm-record-list-toolbar';
    const GROUP_ATTR = 'data-tm-record-list-toolbar-group';
    const HEADER_ATTR = 'data-tm-record-list-header';
    const HEADER_PART_ATTR = 'data-tm-record-list-header-part';
    const PAGE_ATTR = 'data-tm-record-list-compact-page';
    const WIDE_QUERY = '(min-width: 1200px)';
    const ACTIVE_FILTERS_RE = /^filters(?:\[|$)/;
    const COMPACT_ATTR = 'data-tm-ds-compact-control';
    const HIDDEN_ATTR = 'data-tm-ds-visually-hidden';
    const LABEL_ATTR = 'data-tm-ds-short-label';
    const OPTIONS_ATTR = 'data-tm-ds-compact-options';
    const LIST_PATH = /^\/admin\/content-manager\/collection-types\/[^/]+\/?$/;
    const LOCALE_SELECTOR = '[role="combobox"][aria-label="Select a locale"], [role="combobox"][aria-label="Select locale"]';
    const ds = window.__tmStrapiDesignSystem;

    if (!ds) {
        console.warn('[record-list-toolbar] Design System недоступен');
        return;
    }

    window[KEY]?.destroy?.();

    const applied = new Map();
    let desired = new Map();
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

    function directChild(parent, node) {
        while (node && node.parentElement !== parent) node = node.parentElement;
        return node || null;
    }

    function decorateHeader(main, toolbar) {
        if (!window.matchMedia(WIDE_QUERY).matches || !CSS.supports('grid-template-columns', 'subgrid')) return;

        const header = main.querySelector('[data-strapi-header]');
        const sticky = main.querySelector('[data-strapi-header-sticky]');
        const parent = toolbar.parentElement;
        const host = parent && directChild(parent, header || sticky);
        if (!host || host === toolbar || host.nextElementSibling !== toolbar || !main.contains(host)) return;

        const hasFilters = [...new URLSearchParams(location.search).keys()].some(key => ACTIVE_FILTERS_RE.test(key));
        const mode = hasFilters ? 'filters' : 'compact';

        if (!header) {
            if (sticky && applied.get(host)?.has(HEADER_PART_ATTR)) {
                mark(parent, PAGE_ATTR, mode);
                mark(host, HEADER_PART_ATTR, 'host');
            }
            return;
        }

        const title = header.querySelector('h1');
        const subtitle = header.querySelector('p');
        const body = title && directChild(header, title);
        const titleRow = body && directChild(body, title);
        const titleBox = titleRow && directChild(titleRow, title);
        const subtitleBox = body && subtitle && directChild(body, subtitle);
        if (!body || !titleRow || !titleBox || !subtitleBox || titleRow === subtitleBox) return;

        const back = [...body.querySelectorAll('a,button')].find(node => label(node) === 'Back' && node.querySelector('svg'));
        const backBox = back && directChild(body, back);
        const actionBox = [...titleRow.children].find(node => node !== titleBox);
        if (!backBox || backBox === titleRow || !actionBox || titleRow.children.length !== 2) return;
        if ([...body.children].some(node => ![backBox, titleRow, subtitleBox].includes(node))) return;

        const chain = [];
        for (let node = header; node && node !== host; node = node.parentElement) chain.push(node);
        chain.push(host);
        if (chain.slice(1).some((node, index) => node.children.length !== 1 || node.firstElementChild !== chain[index])) return;

        mark(parent, PAGE_ATTR, mode);
        for (const node of chain) mark(node, HEADER_ATTR, node === header ? 'header' : 'wrapper');
        mark(host, HEADER_PART_ATTR, 'host');
        mark(body, HEADER_PART_ATTR, 'body');
        mark(titleRow, HEADER_PART_ATTR, 'title-row');
        mark(titleBox, HEADER_PART_ATTR, 'title');
        mark(subtitleBox, HEADER_PART_ATTR, 'subtitle');
        mark(actionBox, HEADER_PART_ATTR, 'primary');
        mark(backBox, HEADER_PART_ATTR, 'back');
        mark(back, 'aria-label', 'Back');
        mark(back, 'title', 'Back');
        mark(back, HEADER_PART_ATTR, back === backBox ? 'back-link-box' : 'back-link');
        for (const child of back.children) {
            if (!child.matches('svg') && !child.querySelector('svg')) mark(child, HIDDEN_ATTR);
        }
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
        if (!trigger) return;

        const current = trigger.textContent.trim();
        const code = localeCode(current);
        if (!code) return;

        mark(trigger, COMPACT_ATTR);
        mark(trigger, LABEL_ATTR, code);
        mark(trigger, 'title', 'Select locale: ' + current);
        for (const child of trigger.children) mark(child, HIDDEN_ATTR);

        if (trigger.getAttribute('aria-expanded') !== 'true') return;
        const id = trigger.getAttribute('aria-controls');
        const listbox = id && document.getElementById(id);
        if (!listbox || listbox.getAttribute('role') !== 'listbox') return;

        const options = [...listbox.querySelectorAll('[role="option"]')];
        const entries = options.map(option => {
            const code = localeCode(option.textContent);
            const text = code && [...option.querySelectorAll('span')].reverse()
                .find(span => localeCode(span.textContent) === code && !span.querySelector('svg'));
            return { code, text };
        });

        if (!entries.length || entries.some(entry => !entry.text)) return;
        mark(listbox, OPTIONS_ATTR);
        for (const { code, text } of entries) mark(text, LABEL_ATTR, code);
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
            decorateHeader(main, root);
            decorateFilters(root);
            decorateLocale(root.querySelector(LOCALE_SELECTOR));
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
        [${PAGE_ATTR}] {
            display:grid!important;
            grid-template-columns:auto minmax(0,1fr) minmax(0,max-content) max-content;
            align-content:start;
        }
        [${PAGE_ATTR}] > * {
            grid-column:1/-1;
            min-width:0;
        }
        [${PAGE_ATTR}] > [${HEADER_PART_ATTR}="host"] {
            grid-row:1;
        }
        [${PAGE_ATTR}] [${HEADER_ATTR}],
        [${PAGE_ATTR}] [${HEADER_PART_ATTR}="body"] {
            display:grid!important;
            grid-template-columns:subgrid!important;
            grid-column:1/-1;
            min-width:0;
        }
        [${PAGE_ATTR}] [${HEADER_ATTR}="wrapper"] {
            height:auto!important;
        }
        [${PAGE_ATTR}] [${HEADER_ATTR}="header"] {
            padding-block:var(--tm-ds-space4)!important;
        }
        [${PAGE_ATTR}] [${HEADER_PART_ATTR}="body"] {
            grid-template-rows:auto auto;
            align-items:center;
            column-gap:var(--tm-ds-space2)!important;
            row-gap:var(--tm-ds-space1)!important;
        }
        [${PAGE_ATTR}] [${HEADER_PART_ATTR}="title-row"] {
            display:contents!important;
        }
        [${PAGE_ATTR}] [${HEADER_PART_ATTR}="back"],
        [${PAGE_ATTR}] [${HEADER_PART_ATTR}="back-link-box"] {
            grid-column:1;grid-row:1/3;align-self:center;
            justify-self:start;
        }
        [${PAGE_ATTR}] :is([${HEADER_PART_ATTR}="back-link"],[${HEADER_PART_ATTR}="back-link-box"]) {
            display:inline-flex!important;align-items:center;justify-content:center;
            font-size:0!important;gap:0!important;
            min-width:var(--tm-ds-button-height);
            min-height:var(--tm-ds-button-height);
        }
        [${PAGE_ATTR}] [${HEADER_PART_ATTR}="title"] {
            grid-column:2;grid-row:1;min-width:0;
        }
        [${PAGE_ATTR}] [${HEADER_PART_ATTR}="subtitle"] {
            grid-column:2;grid-row:2;margin:0!important;
        }
        [${PAGE_ATTR}] [${HEADER_PART_ATTR}="primary"] {
            grid-column:4;grid-row:1/3;align-self:center;
            justify-self:end;padding-inline-start:var(--tm-ds-space2)!important;
            margin:0!important;white-space:nowrap;
        }
        [${PAGE_ATTR}="compact"] > [${ROOT_ATTR}] {
            grid-column:3;grid-row:1;align-self:center;justify-self:end;
            padding:0!important;margin:0!important;
            position:relative;z-index:1;max-width:min(42vw,520px);
        }
        [${PAGE_ATTR}="filters"] > [${ROOT_ATTR}] {
            grid-column:1/-1;grid-row:2;padding-block-start:0!important;
        }
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
    window.addEventListener('resize', schedule, { passive: true });

    function destroy() {
        destroyed = true;
        observer.disconnect();
        window.removeEventListener('popstate', schedule);
        window.removeEventListener('pageshow', schedule);
        window.removeEventListener('resize', schedule);
        if (frame) cancelAnimationFrame(frame);
        desired = new Map();
        reconcile();
        style.remove();
        if (window[KEY]?.destroy === destroy) delete window[KEY];
    }

    window[KEY] = { destroy, apply: schedule };
    schedule();
})();
