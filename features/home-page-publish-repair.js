(function () {
    'use strict';

    const EXTENSION_ID = 'home-page-publish-repair';
    const MODEL = 'api::home-page.home-page';
    const HOME_PATH = `/admin/content-manager/single-types/${MODEL}`;
    const CREATED_ATTR = 'data-tm-created';
    const BUTTON_ATTR = 'data-tm-home-publish-repair';
    const TOOLBAR_SELECTOR = '[data-tm-entry-toolbar="true"]';
    const ACTIONS_SELECTOR = '[data-tm-entry-actions="true"]';
    const ENTRY_SELECTOR = 'aside[aria-labelledby="additional-information"]';
    const DOCUMENT_TABLIST_SELECTOR = '[role="tablist"][aria-label="Document status"]';
    const PRODUCT_COMPONENTS = new Set([
        'home.product-slider',
        'home.brand-zone-slider',
        'home.product-grid'
    ]);

    let busy = false;
    let frameScheduled = false;

    function pageContext() {
        const url = new URL(window.location.href);
        const isHome = url.pathname === HOME_PATH;
        const status = url.searchParams.get('status') || 'draft';
        const locale = url.searchParams.get('plugins[i18n][locale]') || 'ru';

        return { isHome, status, locale };
    }

    function readJwt() {
        let raw = localStorage.getItem('jwtToken');
        if (!raw) return '';

        try {
            const parsed = JSON.parse(raw);
            if (typeof parsed === 'string') raw = parsed;
        } catch {
            // Strapi can store the token as a plain string.
        }

        return String(raw || '').trim();
    }

    async function requestJson(path, options = {}) {
        const token = readJwt();
        const headers = {
            accept: 'application/json',
            ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(options.headers || {})
        };

        const response = await fetch(path, {
            credentials: 'same-origin',
            ...options,
            headers
        });

        const text = await response.text();
        let payload = null;

        if (text) {
            try {
                payload = JSON.parse(text);
            } catch {
                payload = text;
            }
        }

        if (!response.ok) {
            const error = new Error(`HTTP ${response.status}: ${path}`);
            error.status = response.status;
            error.payload = payload;
            throw error;
        }

        return payload;
    }

    function singleTypeUrl(locale, status) {
        const params = new URLSearchParams({ locale });
        if (status) params.set('status', status);
        return `/content-manager/single-types/${MODEL}?${params}`;
    }

    function actionUrl(action, locale) {
        const params = new URLSearchParams({ status: 'draft', locale });
        return `/content-manager/single-types/${MODEL}/actions/${action}?${params}`;
    }

    async function getDocument(locale, status) {
        const response = await requestJson(singleTypeUrl(locale, status));
        return response?.data || null;
    }

    async function getRelationPage(componentUid, componentId, status, locale, page) {
        const params = new URLSearchParams({
            status,
            locale,
            pageSize: '100',
            page: String(page)
        });

        return requestJson(
            `/content-manager/relations/${encodeURIComponent(componentUid)}/${componentId}/products?${params}`
        );
    }

    async function getRelationDocumentIds(componentUid, componentId, status, locale) {
        const first = await getRelationPage(componentUid, componentId, status, locale, 1);
        const ids = (first?.results || [])
            .map(item => item?.documentId)
            .filter(Boolean);
        const pageCount = Math.max(1, Number(first?.pagination?.pageCount || 1));

        for (let page = 2; page <= pageCount; page += 1) {
            const next = await getRelationPage(componentUid, componentId, status, locale, page);
            ids.push(
                ...(next?.results || [])
                    .map(item => item?.documentId)
                    .filter(Boolean)
            );
        }

        return ids;
    }

    async function getProductsState(document, status, locale) {
        const sections = Array.isArray(document?.sections) ? document.sections : [];
        const entries = [];

        for (let index = 0; index < sections.length; index += 1) {
            const section = sections[index];
            const component = section?.__component;

            if (!PRODUCT_COMPONENTS.has(component) || !section?.id) continue;

            const documentIds = await getRelationDocumentIds(
                component,
                section.id,
                status,
                locale
            );

            entries.push({
                index,
                component,
                title: String(section.title || '').trim(),
                documentIds
            });
        }

        return entries;
    }

    function keyOf(entry) {
        return `${entry.index}:${entry.component}`;
    }

    function labelOf(entry) {
        const title = entry.title ? ` — ${entry.title}` : '';
        return `${entry.index + 1}. ${entry.component}${title}`;
    }

    function arraysEqual(left, right) {
        return (
            left.length === right.length &&
            left.every((value, index) => value === right[index])
        );
    }

    function compareStates(draftState, publishedState) {
        const draftByKey = new Map(draftState.map(entry => [keyOf(entry), entry]));
        const publishedByKey = new Map(publishedState.map(entry => [keyOf(entry), entry]));
        const keys = new Set([...draftByKey.keys(), ...publishedByKey.keys()]);
        const rows = [];

        for (const key of keys) {
            const draft = draftByKey.get(key);
            const published = publishedByKey.get(key);
            const draftIds = draft?.documentIds || [];
            const publishedIds = published?.documentIds || [];
            const reference = draft || published;

            rows.push({
                key,
                label: labelOf(reference),
                draft: draftIds.length,
                published: publishedIds.length,
                same: Boolean(draft && published && arraysEqual(draftIds, publishedIds)),
                draftIds,
                publishedIds
            });
        }

        return rows;
    }

    function logComparison(label, rows) {
        console.group(`[${EXTENSION_ID}] ${label}`);
        console.table(
            rows.map(row => ({
                section: row.label,
                draft: row.draft,
                published: row.published,
                совпадает: row.same ? 'да' : 'нет'
            }))
        );

        rows.filter(row => !row.same).forEach(row => {
            console.log(row.label, {
                draft: row.draftIds,
                published: row.publishedIds
            });
        });
        console.groupEnd();
    }

    function findSaveButton() {
        const scopes = [
            document.querySelector(ACTIONS_SELECTOR),
            document.querySelector(ENTRY_SELECTOR)
        ].filter(Boolean);

        for (const scope of scopes) {
            const button = [...scope.querySelectorAll('button')]
                .find(item => /^save$/i.test(item.textContent?.trim() || ''));
            if (button) return button;
        }

        return null;
    }

    function hasUnsavedChanges() {
        const saveButton = findSaveButton();
        if (!saveButton) return false;

        return !(
            saveButton.disabled ||
            saveButton.getAttribute('aria-disabled') === 'true'
        );
    }

    function setButtonState(button, text, disabled) {
        if (!button) return;
        button.textContent = text;
        button.disabled = disabled;
        button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        button.style.cursor = disabled ? 'wait' : 'pointer';
        button.style.opacity = disabled ? '0.7' : '1';
    }

    async function publishWithRetry(locale) {
        try {
            return await requestJson(actionUrl('publish', locale), {
                method: 'POST',
                body: '{}'
            });
        } catch (firstError) {
            console.warn(`[${EXTENSION_ID}] Первый Publish не прошёл, повторяю один раз`, firstError);
            await new Promise(resolve => setTimeout(resolve, 800));
            return requestJson(actionUrl('publish', locale), {
                method: 'POST',
                body: '{}'
            });
        }
    }

    async function repair(button) {
        if (busy) return;

        const context = pageContext();
        if (!context.isHome || context.status !== 'draft') return;

        if (hasUnsavedChanges()) {
            alert('Сначала нажми Save. Пересборка работает только с уже сохранённым Draft.');
            return;
        }

        busy = true;
        setButtonState(button, 'Проверяю…', true);

        let unpublished = false;

        try {
            const [draft, published] = await Promise.all([
                getDocument(context.locale, 'draft'),
                getDocument(context.locale, 'published')
            ]);

            if (!draft) {
                throw new Error('Draft Home page не найден');
            }

            if (!published) {
                alert('Published-версия Home page отсутствует. Здесь достаточно обычного Publish.');
                return;
            }

            const [draftState, publishedState] = await Promise.all([
                getProductsState(draft, 'draft', context.locale),
                getProductsState(published, 'published', context.locale)
            ]);
            const before = compareStates(draftState, publishedState);
            const mismatches = before.filter(row => !row.same);

            logComparison('До пересборки', before);

            if (!mismatches.length) {
                alert('Draft и Published уже совпадают по products. Пересборка не требуется.');
                return;
            }

            const summary = mismatches
                .map(row => `${row.label}: ${row.draft} → ${row.published}`)
                .join('\n');

            const confirmed = confirm(
                `Найдены расхождения Draft / Published:\n\n${summary}\n\n` +
                `Сейчас Home page (${context.locale.toUpperCase()}) будет снята с публикации и сразу опубликована заново из сохранённого Draft.\n` +
                'Несохранённые изменения в форме не переносятся. Продолжить?'
            );

            if (!confirmed) return;

            setButtonState(button, 'Unpublish…', true);
            await requestJson(actionUrl('unpublish', context.locale), {
                method: 'POST',
                body: JSON.stringify({ discardDraft: false })
            });
            unpublished = true;

            setButtonState(button, 'Publish…', true);
            await publishWithRetry(context.locale);
            unpublished = false;

            setButtonState(button, 'Проверяю Published…', true);

            const [draftAfter, publishedAfter] = await Promise.all([
                getDocument(context.locale, 'draft'),
                getDocument(context.locale, 'published')
            ]);
            const [draftStateAfter, publishedStateAfter] = await Promise.all([
                getProductsState(draftAfter, 'draft', context.locale),
                getProductsState(publishedAfter, 'published', context.locale)
            ]);
            const after = compareStates(draftStateAfter, publishedStateAfter);
            const remaining = after.filter(row => !row.same);

            logComparison('После пересборки', after);

            if (remaining.length) {
                setButtonState(button, 'Published не совпал', false);
                alert(
                    `Пересборка выполнена, но осталось расхождений: ${remaining.length}. ` +
                    'Детали выведены в Console.'
                );
                return;
            }

            alert('Готово: Published пересобран из Draft, products совпадают.');
            window.location.reload();
        } catch (error) {
            console.error(`[${EXTENSION_ID}] Ошибка пересборки Published`, error);

            const critical = unpublished
                ? '\n\nВНИМАНИЕ: Unpublish уже прошёл, а Publish завершился ошибкой. Home page сейчас может быть снята с публикации. Нажми обычный Publish в Strapi.'
                : '';

            alert(`Не удалось пересобрать Published.${critical}\n\nДетали — в Console.`);
        } finally {
            busy = false;
            if (document.contains(button)) {
                setButtonState(button, 'Пересобрать Published', false);
            }
        }
    }

    function createButton() {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute(CREATED_ATTR, EXTENSION_ID);
        button.setAttribute(BUTTON_ATTR, 'true');
        button.textContent = 'Пересобрать Published';
        button.title = 'Unpublish → Publish текущего сохранённого Draft и проверка relations products';

        Object.assign(button.style, {
            height: '32px',
            minWidth: '176px',
            padding: '0 12px',
            border: '1px solid #dcdce4',
            borderRadius: '4px',
            background: '#ffffff',
            color: '#4945ff',
            fontSize: '14px',
            fontWeight: '600',
            lineHeight: '30px',
            whiteSpace: 'nowrap',
            cursor: 'pointer'
        });

        button.addEventListener('click', () => repair(button));
        return button;
    }

    function removeButton() {
        document.querySelector(`[${BUTTON_ATTR}="true"]`)?.remove();
    }

    function ensureButton() {
        const context = pageContext();
        if (!context.isHome || context.status !== 'draft') {
            removeButton();
            return;
        }

        const tabList = document.querySelector(DOCUMENT_TABLIST_SELECTOR);
        if (!tabList) return;

        const toolbar = document.querySelector(TOOLBAR_SELECTOR);
        const target = toolbar || tabList.parentElement;
        if (!target) return;

        let button = document.querySelector(`[${BUTTON_ATTR}="true"]`);
        if (!button) button = createButton();

        if (target === toolbar) {
            const actions = toolbar.querySelector(ACTIONS_SELECTOR);
            if (actions) {
                if (button.parentElement !== toolbar || button.nextSibling !== actions) {
                    toolbar.insertBefore(button, actions);
                }
                return;
            }
        }

        if (button.parentElement !== target) {
            target.appendChild(button);
        }
    }

    function scheduleApply() {
        if (frameScheduled) return;
        frameScheduled = true;

        requestAnimationFrame(() => {
            frameScheduled = false;
            ensureButton();
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

        window.addEventListener('popstate', scheduleApply);
        scheduleApply();
    }

    start();
})();
