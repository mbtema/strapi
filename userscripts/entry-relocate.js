// ==UserScript==
// @name         entry-relocate
// @version      1.0
// @description  Переносит блок entry
// @match        http://10.10.3.80:1337/admin/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let currentAside = null;

    function getEntry() {
        return document.querySelector(
            'aside[aria-labelledby="additional-information"]'
        );
    }

    // Ищем именно тот контейнер, где:
    //
    // [ большая форма ] [ маленький ENTRY ]
    //
    function findLayout(aside) {
        let node = aside;

        while (node?.parentElement) {
            const parent = node.parentElement;
            const children = [...parent.children];

            // Прямой ребёнок этого контейнера,
            // внутри которого находится ENTRY
            const entryColumn = children.find(
                child => child.contains(aside)
            );

            if (!entryColumn) {
                node = parent;
                continue;
            }

            const entryRect =
                entryColumn.getBoundingClientRect();

            const candidates = children
                .filter(child => child !== entryColumn)
                .filter(child => {
                    const rect =
                        child.getBoundingClientRect();

                    return (
                        rect.width > entryRect.width &&
                        rect.width > 500 &&
                        rect.height > 200
                    );
                });

            const mainColumn = candidates
                .sort(
                    (a, b) =>
                        b.getBoundingClientRect().width -
                        a.getBoundingClientRect().width
                )[0];

            if (mainColumn) {
                const mainRect =
                    mainColumn.getBoundingClientRect();

                // Они должны находиться примерно
                // на одной горизонтальной линии
                if (
                    Math.abs(
                        mainRect.top -
                        entryRect.top
                    ) < 100
                ) {
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

        if (!layout) {
            console.log(
                '[ENTRY] Не удалось найти контейнер form + ENTRY'
            );
            return;
        }

        const {
            container,
            entryColumn,
            mainColumn
        } = layout;

        // Запоминаем исходную ширину ENTRY
        const originalWidth =
            entryColumn.getBoundingClientRect().width;

        // -----------------------------------------------------
        // КЛЮЧЕВОЙ МОМЕНТ
        //
        // Физически переставляем ENTRY перед формой
        // -----------------------------------------------------

        container.insertBefore(
            entryColumn,
            mainColumn
        );

        // -----------------------------------------------------
        // Родитель теперь вертикальный:
        //
        // ENTRY
        // FORM
        // -----------------------------------------------------

        container.style.setProperty(
            'display',
            'flex',
            'important'
        );

        container.style.setProperty(
            'flex-direction',
            'column',
            'important'
        );

        container.style.setProperty(
            'align-items',
            'stretch',
            'important'
        );

        container.style.setProperty(
            'gap',
            '16px',
            'important'
        );

        container.style.setProperty(
            'width',
            '100%',
            'important'
        );

        // -----------------------------------------------------
        // ENTRY
        //
        // Сам aside НЕ меняем.
        // Меняем только его внешний контейнер.
        // -----------------------------------------------------

        entryColumn.style.setProperty(
            'align-self',
            'flex-start',
            'important'
        );

        entryColumn.style.setProperty(
            'width',
            `${originalWidth}px`,
            'important'
        );

        entryColumn.style.setProperty(
            'max-width',
            `${originalWidth}px`,
            'important'
        );

        entryColumn.style.setProperty(
            'grid-column',
            'auto',
            'important'
        );

        entryColumn.style.setProperty(
            'grid-row',
            'auto',
            'important'
        );

        // -----------------------------------------------------
        // ФОРМА
        // -----------------------------------------------------

        mainColumn.style.setProperty(
            'width',
            '100%',
            'important'
        );

        mainColumn.style.setProperty(
            'max-width',
            'none',
            'important'
        );

        mainColumn.style.setProperty(
            'flex',
            '1 1 auto',
            'important'
        );

        mainColumn.style.setProperty(
            'grid-column',
            'auto',
            'important'
        );

        mainColumn.style.setProperty(
            'grid-row',
            'auto',
            'important'
        );

        aside.dataset.tmEntryMoved = 'true';

        currentAside = aside;

        console.log(
            '[ENTRY] Перенесён над формой',
            {
                entryWidth: originalWidth,
                container,
                mainColumn,
                entryColumn
            }
        );
    }

    // Первый запуск
    setTimeout(apply, 300);

    // Strapi может пересоздать интерфейс
    let timer;

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
