// ==UserScript==
// @name         barcode-extractor
// @version      1.1
// @description  Копирует barcode с карточки товара
// @match        http://10.10.3.80:1337/admin/*
// @updateURL    https://raw.githubusercontent.com/mbtema/strapi/main/userscripts/barcode-extractor.js
// @downloadURL  https://raw.githubusercontent.com/mbtema/strapi/main/userscripts/barcode-extractor.js
// @grant        GM_setClipboard
// ==/UserScript==

(() => {
  'use strict';

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.code === 'KeyB') {

      const input =
        document.querySelector('input[name="barcode"]') ||
        document.querySelector('input[id*="barcode"]');

      if (!input) {
        console.warn('Strapi Helper: поле barcode не найдено');
        return;
      }

      const value = input.value;

      if (!value) {
        console.warn('Strapi Helper: barcode пустой');
        return;
      }

      GM_setClipboard(value);

      console.log(`Strapi Helper: скопировано → ${value}`);
    }
  });

  console.log('Strapi Helper запущен');
})();
