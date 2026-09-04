// ==UserScript==
// @name         barcode-extractor
// @version      1.3
// @description  Копирует barcode с карточки товара
// @match        http://10.10.3.80:1337/admin/*
// @updateURL    https://raw.githubusercontent.com/mbtema/strapi/main/strapi-improve-scripts/barcode-extractor.js
// @downloadURL  https://raw.githubusercontent.com/mbtema/strapi/main/strapi-improve-scripts/barcode-extractor.js
// @grant        GM_setClipboard
// ==/UserScript==

(() => {
  'use strict';

  const TOAST_LIFETIME = 4000;

  function getToastContainer() {
    let container = document.querySelector(
      '[data-tm-barcode-toast-container="true"]'
    );

    if (container) return container;

    container = document.createElement('div');
    container.dataset.tmBarcodeToastContainer = 'true';

    Object.assign(container.style, {
      position: 'fixed',
      top: '24px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'min(500px, calc(100vw - 48px))',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      zIndex: '2147483647',
      pointerEvents: 'none'
    });

    (document.body || document.documentElement).appendChild(container);

    return container;
  }

  function showToast(type, message) {
    const container = getToastContainer();
    const toast = document.createElement('div');
    const icon = document.createElement('div');
    const text = document.createElement('div');
    const close = document.createElement('button');

    const isSuccess = type === 'success';

    Object.assign(toast.style, {
      minHeight: '62px',
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      gap: '14px',
      padding: '16px 20px',
      background: '#181826',
      border: '1px solid #49495f',
      borderRadius: '4px',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.22)',
      color: '#ffffff',
      fontFamily: 'inherit',
      fontSize: '14px',
      fontWeight: '600',
      pointerEvents: 'auto'
    });

    Object.assign(icon.style, {
      width: '18px',
      height: '18px',
      flex: '0 0 18px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '50%',
      background: isSuccess ? '#5cb176' : '#d02b20',
      color: '#ffffff',
      fontSize: '12px',
      fontWeight: '800',
      lineHeight: '1'
    });

    icon.textContent = isSuccess ? '✓' : '!';

    text.textContent = message;
    text.style.flex = '1';

    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close notification');

    Object.assign(close.style, {
      width: '28px',
      height: '28px',
      padding: '0',
      border: '0',
      background: 'transparent',
      color: '#c7c7d4',
      fontSize: '24px',
      lineHeight: '1',
      cursor: 'pointer'
    });

    toast.append(icon, text, close);
    container.appendChild(toast);

    const remove = () => {
      toast.remove();

      if (!container.children.length) {
        container.remove();
      }
    };

    close.addEventListener('click', remove);
    setTimeout(remove, TOAST_LIFETIME);
  }

  document.addEventListener('keydown', (event) => {
    if (!event.ctrlKey || event.code !== 'KeyB') return;
    if (event.repeat) return;

    event.preventDefault();
    event.stopPropagation();

    const input =
      document.querySelector('input[name="barcode"]') ||
      document.querySelector('input[id*="barcode"]');

    if (!input) {
      console.warn('Strapi Helper: поле barcode не найдено');
      showToast('error', 'Error: Barcode field not found');
      return;
    }

    const value = input.value?.trim();

    if (!value) {
      console.warn('Strapi Helper: barcode пустой');
      showToast('error', 'Error: Barcode is empty');
      return;
    }

    try {
      GM_setClipboard(value);

      console.log(`Strapi Helper: скопировано → ${value}`);
      showToast('success', 'Success: Barcode copied');
    } catch (error) {
      console.error('Strapi Helper: ошибка копирования', error);
      showToast('error', 'Error: Failed to copy barcode');
    }
  });
})();
