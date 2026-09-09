// ==ConsoleParser==
// @name         dom-stealer
// @version      1.0.1
// @description  Копирует текущий DOM страницы целиком в буфер обмена
// @output       Clipboard
// ==/ConsoleParser==

(async () => {
  'use strict';

  const dom = document.documentElement.outerHTML;
  const success = () => console.log(`[dom-stealer] DOM скопирован: ${dom.length.toLocaleString()} символов`);

  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(dom);
    success();
    return;
  } catch {}

  const textarea = document.createElement('textarea');
  textarea.value = dom;
  Object.assign(textarea.style, { position: 'fixed', left: '-999999px', top: '0' });
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  const copied = document.execCommand('copy');
  textarea.remove();

  if (!copied) {
    console.warn('[dom-stealer] Не удалось скопировать DOM в буфер');
    return;
  }

  success();
})();
