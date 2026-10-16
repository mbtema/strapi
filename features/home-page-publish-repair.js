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
    const FIXED_FROM_VERSION = '5.23.3';
    const PRODUCT_COMPONENTS = new Set([
        'home.product-slider',
        'home.brand-zone-slider',
        'home.product-grid'
    ]);

    let busy = false;
    let frameScheduled = false;

    function pageContext() {
        const url = new URL(window.location.href);
        return {
            isHome: url.pathname === HOME_PATH,
            status: url.searchParams.get('status') || 'draft',
            locale: url.searchParams.get('plugins[i18n][locale]') || 'ru'
        };
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

    function singleTypeUrl(locale, status = 'draft') {
        const params = new URLSearchParams({ status, locale });
        return `/content-manager/single-types/${MODEL}?${params}`;
    }

    function publishUrl(locale) {
        const params = new URLSearchParams({ status: 'draft', locale });
        return `/content-manager/single-types/${MODEL}/actions/publish?${params}`;
    }

    async function getDocument(locale, status = 'draft') {
        const response = await requestJson(singleTypeUrl(locale, status));
        return response?.data || null;
    }

    async function getAdminVersion() {
        const response = await requestJson('/admin/init');
        return String(
            response?.data?.strapiVersion ||
            response?.strapiVersion ||
            ''
        ).trim();
    }

    function versionParts(version) {
        const match = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)/);
        return match ? match.slice(1).map(Number) : null;
    }

    function compareVersions(left, right) {
        const a = versionParts(left);
        const b = versionParts(right);
        if (!a || !b) return null;

        for (let index = 0; index < 3; index += 1) {
            if (a[index] > b[index]) return 1;
            if (a[index] < b[index]) return -1;
        }

        return 0;
    }

    async function getRelationPage(componentUid, componentId, locale, page) {
        const params = new URLSearchParams({
            status: 'draft',
            locale,
            pageSize: '100',
            page: String(page)
        });

        return requestJson(
            `/content-manager/relations/${encodeURIComponent(componentUid)}/${componentId}/products?${params}`
        );
    }

    async function getProducts(componentUid, componentId, locale) {
        const first = await getRelationPage(componentUid, componentId, locale, 1);
        const items = [...(first?.results || [])];
        const pageCount = Math.max(1, Number(first?.pagination?.pageCount || 1));

        for (let page = 2; page <= pageCount; page += 1) {
            const next = await getRelationPage(componentUid, componentId, locale, page);
            items.push(...(next?.results || []));
        }

        return items
            .filter(item => item?.documentId)
            .map(item => ({
                id: item.id,
                documentId: item.documentId,
                locale: item.locale || locale
            }));
    }

    function baseKey(section) {
        return [
            section?.__component || '',
            String(section?.title || '').trim()
        ].join('|');
    }

    function annotateProductSections(sections) {
        const counters = new Map();
        const result = [];

        for (let index = 0; index < (sections || []).length; index += 1) {
            const section = sections[index];
            if (!PRODUCT_COMPONENTS.has(section?.__component)) continue;

            const base = baseKey(section);
            const occurrence = (counters.get(base) || 0) + 1;
            counters.set(base, occurrence);

            result.push({
                key: `${base}#${occurrence}`,
                index,
                section
            });
        }

        return result;
    }

    async function getDraftState(document, locale) {
        const entries = annotateProductSections(document?.sections || []);

        for (const entry of entries) {
            if (!entry.section?.id) {
                throw new Error(`Draft component without id: ${entry.key}`);
            }

            entry.products = await getProducts(
                entry.section.__component,
                entry.section.id,
                locale
            );
        }

        return entries;
    }

    function publicApiUrl(locale) {
        const params = new URLSearchParams({ locale, 'fields[0]': 'documentId' });
        const components = [
            'home.product-slider',
            'home.brand-zone-slider',
            'home.product-grid'
        ];

        components.forEach(uid => {
            params.append(`populate[sections][on][${uid}][fields][0]`, 'title');
            params.append(
                `populate[sections][on][${uid}][populate][products][fields][0]`,
                'documentId'
            );
        });

        return `/api/home-page?${params}`;
    }

    async function getPublicState(locale) {
        const response = await requestJson(publicApiUrl(locale));
        const entries = annotateProductSections(response?.data?.sections || []);

        return entries.map(entry => ({
            ...entry,
            products: (entry.section?.products || [])
                .filter(item => item?.documentId)
                .map(item => ({ documentId: item.documentId }))
        }));
    }

    function idsOf(entry) {
        return (entry?.products || []).map(item => item.documentId);
    }

    function arraysEqual(left, right) {
        return (
            left.length === right.length &&
            left.every((value, index) => value === right[index])
        );
    }

    function compareStates(draftState, publicState) {
        const draftByKey = new Map(draftState.map(entry => [entry.key, entry]));
        const publicByKey = new Map(publicState.map(entry => [entry.key, entry]));
        const keys = new Set([...draftByKey.keys(), ...publicByKey.keys()]);

        return [...keys].map(key => {
            const draft = draftByKey.get(key);
            const published = publicByKey.get(key);
            const draftIds = idsOf(draft);
            const publishedIds = idsOf(published);

            return {
                key,
                draft,
                published,
                draftIds,
                publishedIds,
                same: Boolean(draft && published && arraysEqual(draftIds, publishedIds))
            };
        });
    }

    function labelOf(row) {
        const section = row.draft?.section || row.published?.section || {};
        const title = String(section.title || '').trim();
        return title
            ? `${section.__component} — ${title}`
            : String(section.__component || row.key);
    }

    function logComparison(label, rows) {
        console.group(`[${EXTENSION_ID}] ${label}`);
        console.table(
            rows.map(row => ({
                section: labelOf(row),
                draft: row.draftIds.length,
                public: row.publishedIds.length,
                совпадает: row.same ? 'да' : 'нет'
            }))
        );

        rows.filter(row => !row.same).forEach(row => {
            console.log(labelOf(row), {
                draft: row.draftIds,
                public: row.publishedIds
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

    function relationInput(products) {
        return products.map(item => ({
            documentId: item.documentId,
            locale: item.locale
        }));
    }

    function cloneForRecreate(section, products) {
        const copy = structuredClone(section);
        delete copy.id;
        delete copy.__temp_key__;
        copy.products = relationInput(products);
        return copy;
    }

    function buildSectionsPayload(draftDocument, draftState, mismatchKeys) {
        const byIndex = new Map(draftState.map(entry => [entry.index, entry]));

        return (draftDocument.sections || []).map((section, index) => {
            const entry = byIndex.get(index);

            if (entry && mismatchKeys.has(entry.key)) {
                return cloneForRecreate(section, entry.products);
            }

            return {
                id: section.id,
                __component: section.__component
            };
        });
    }

    async function replaceComponents(draftDocument, draftState, mismatches, locale) {
        const mismatchKeys = new Set(mismatches.map(row => row.key));
        const sections = buildSectionsPayload(draftDocument, draftState, mismatchKeys);

        return requestJson(singleTypeUrl(locale, 'draft'), {
            method: 'PUT',
            body: JSON.stringify({ sections })
        });
    }

    async function publish(locale) {
        return requestJson(publishUrl(locale), {
            method: 'POST',
            body: '{}'
        });
    }

    async function waitForPublicMatch(locale, expectedDraftState) {
        let lastRows = [];

        for (let attempt = 1; attempt <= 4; attempt += 1) {
            if (attempt > 1) {
                await new Promise(resolve => setTimeout(resolve, 600 * attempt));
            }

            const publicState = await getPublicState(locale);
            lastRows = compareStates(expectedDraftState, publicState);

            if (lastRows.every(row => row.same)) {
                return { matched: true, rows: lastRows };
            }
        }

        return { matched: false, rows: lastRows };
    }

    async function repair(button) {
        if (busy) return;

        const context = pageContext();
        if (!context.isHome || context.status !== 'draft') return;

        if (hasUnsavedChanges()) {
            alert('Сначала нажми Save. Исправление работает только с уже сохранённым Draft.');
            return;
        }

        busy = true;
        setButtonState(button, 'Проверяю…', true);

        try {
            const [version, draftDocument] = await Promise.all([
                getAdminVersion().catch(() => ''),
                getDocument(context.locale, 'draft')
            ]);

            if (!draftDocument) {
                throw new Error('Draft Home page не найден');
            }

            const [draftState, publicState] = await Promise.all([
                getDraftState(draftDocument, context.locale),
                getPublicState(context.locale)
            ]);
            const before = compareStates(draftState, publicState);
            const mismatches = before.filter(row => !row.same);

            logComparison('До исправления', before);

            if (!mismatches.length) {
                alert('Draft и Public API уже совпадают по products. Исправление не требуется.');
                return;
            }

            const versionComparison = version
                ? compareVersions(version, FIXED_FROM_VERSION)
                : null;
            const versionWarning =
                versionComparison !== null && versionComparison < 0
                    ? `\n\nStrapi ${version} ниже ${FIXED_FROM_VERSION}: официальный fix предотвращения новых ghost relations ещё отсутствует. Текущее состояние исправим, но после будущих удалений relation баг может появиться снова.`
                    : version
                        ? `\n\nStrapi: ${version}.`
                        : '';

            const summary = mismatches
                .map(row => `${labelOf(row)}: Draft ${row.draftIds.length}, Public ${row.publishedIds.length}`)
                .join('\n');

            const confirmed = confirm(
                `Найдены ghost/stale relations:\n\n${summary}` +
                `${versionWarning}\n\n` +
                'Будут пересозданы только проблемные product-компоненты внутри sections, ' +
                'с сохранением их полей, порядка и текущего списка products из Draft. ' +
                'Остальные компоненты не меняются. Затем Home page будет опубликована и проверена через Public API.\n\nПродолжить?'
            );

            if (!confirmed) return;

            setButtonState(button, 'Пересоздаю компоненты…', true);
            await replaceComponents(
                draftDocument,
                draftState,
                mismatches,
                context.locale
            );

            setButtonState(button, 'Проверяю Draft…', true);
            const draftAfter = await getDocument(context.locale, 'draft');
            const draftStateAfter = await getDraftState(draftAfter, context.locale);

            const expectedByKey = new Map(draftState.map(entry => [entry.key, idsOf(entry)]));
            const recreatedRows = compareStates(
                draftStateAfter,
                draftState.map(entry => ({
                    ...entry,
                    products: entry.products
                }))
            );

            const damagedDraft = recreatedRows.filter(row => {
                const expected = expectedByKey.get(row.key) || [];
                return !arraysEqual(row.draftIds, expected);
            });

            if (damagedDraft.length) {
                logComparison('Draft после пересоздания', recreatedRows);
                throw new Error('После пересоздания Draft products не совпали со снимком до операции');
            }

            setButtonState(button, 'Publish…', true);
            await publish(context.locale);

            setButtonState(button, 'Проверяю Public API…', true);
            const result = await waitForPublicMatch(context.locale, draftStateAfter);
            logComparison('После исправления', result.rows);

            if (!result.matched) {
                alert(
                    'Компоненты пересозданы и Home page опубликована, но Public API всё ещё не совпадает с Draft. ' +
                    'Ничего больше автоматически не меняю. Детали выведены в Console.'
                );
                return;
            }

            alert('Готово: ghost relations удалены. Public API совпадает с сохранённым Draft.');
            window.location.reload();
        } catch (error) {
            console.error(`[${EXTENSION_ID}] Ошибка исправления ghost relations`, error);
            alert('Исправление остановлено из-за ошибки. Детали выведены в Console.');
        } finally {
            busy = false;
            if (document.contains(button)) {
                setButtonState(button, 'Исправить ghost relations', false);
            }
        }
    }

    function createButton() {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute(CREATED_ATTR, EXTENSION_ID);
        button.setAttribute(BUTTON_ATTR, 'true');
        button.textContent = 'Исправить ghost relations';
        button.title = 'Пересоздать только проблемные product-компоненты и проверить Public API';

        Object.assign(button.style, {
            height: '32px',
            minWidth: '184px',
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