(function () {
    'use strict';

    const KEY = '__tmStrapiDesignSystem';
    const STYLE_ID = 'tm-design-system-style';
    if (window[KEY]) return;

    const root = document.documentElement;
    let scheduled = false;

    function detectTheme() {
        if (root.classList.contains('dark')) return 'dark';
        if (!document.body) return 'light';
        const color = getComputedStyle(document.body).color;
        const channels = color.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
        if (!channels || channels.length !== 3) return 'light';
        const [r, g, b] = channels;
        return (r * .299 + g * .587 + b * .114) > 150 ? 'dark' : 'light';
    }

    function syncTheme() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            const theme = detectTheme();
            if (root.getAttribute('data-tm-ds-theme') !== theme) {
                root.setAttribute('data-tm-ds-theme', theme);
            }
        });
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        :root{
            --tm-ds-alternative100:#f6ecfc;
            --tm-ds-alternative200:#e0c1f4;
            --tm-ds-alternative500:#ac73e6;
            --tm-ds-alternative600:#9736e8;
            --tm-ds-alternative700:#8312d1;
            --tm-ds-buttonNeutral0:#ffffff;
            --tm-ds-buttonPrimary500:#7b79ff;
            --tm-ds-buttonPrimary600:#4945ff;
            --tm-ds-danger100:#fcecea;
            --tm-ds-danger200:#f5c0b8;
            --tm-ds-danger500:#ee5e52;
            --tm-ds-danger600:#d02b20;
            --tm-ds-danger700:#b72b1a;
            --tm-ds-neutral0:#ffffff;
            --tm-ds-neutral100:#f6f6f9;
            --tm-ds-neutral1000:#181826;
            --tm-ds-neutral150:#eaeaef;
            --tm-ds-neutral200:#dcdce4;
            --tm-ds-neutral300:#c0c0cf;
            --tm-ds-neutral400:#a5a5ba;
            --tm-ds-neutral500:#8e8ea9;
            --tm-ds-neutral600:#666687;
            --tm-ds-neutral700:#4a4a6a;
            --tm-ds-neutral800:#32324d;
            --tm-ds-neutral900:#212134;
            --tm-ds-primary100:#f0f0ff;
            --tm-ds-primary200:#d9d8ff;
            --tm-ds-primary500:#7b79ff;
            --tm-ds-primary600:#4945ff;
            --tm-ds-primary700:#271fe0;
            --tm-ds-secondary100:#eaf5ff;
            --tm-ds-secondary200:#b8e1ff;
            --tm-ds-secondary500:#66b7f1;
            --tm-ds-secondary600:#0c75af;
            --tm-ds-secondary700:#006096;
            --tm-ds-success100:#eafbe7;
            --tm-ds-success200:#c6f0c2;
            --tm-ds-success500:#5cb176;
            --tm-ds-success600:#328048;
            --tm-ds-success700:#2f6846;
            --tm-ds-warning100:#fdf4dc;
            --tm-ds-warning200:#fae7b9;
            --tm-ds-warning500:#f29d41;
            --tm-ds-warning600:#d9822f;
            --tm-ds-warning700:#be5d01;
            --tm-ds-radius:4px;
            --tm-ds-text-size:1.6rem;
            --tm-ds-text-line:1.5;
            --tm-ds-small-size:1.2rem;
            --tm-ds-small-line:1.33;
            --tm-ds-button-height:4rem;
        }
        :root[data-tm-ds-theme="dark"]{
            --tm-ds-alternative100:#181826;
            --tm-ds-alternative200:#4a4a6a;
            --tm-ds-alternative500:#ac73e6;
            --tm-ds-alternative600:#ac73e6;
            --tm-ds-alternative700:#e0c1f4;
            --tm-ds-buttonNeutral0:#ffffff;
            --tm-ds-buttonPrimary500:#7b79ff;
            --tm-ds-buttonPrimary600:#4945ff;
            --tm-ds-danger100:#181826;
            --tm-ds-danger200:#4a4a6a;
            --tm-ds-danger500:#ee5e52;
            --tm-ds-danger600:#ee5e52;
            --tm-ds-danger700:#ee5e52;
            --tm-ds-neutral0:#212134;
            --tm-ds-neutral100:#181826;
            --tm-ds-neutral1000:#ffffff;
            --tm-ds-neutral150:#32324d;
            --tm-ds-neutral200:#4a4a6a;
            --tm-ds-neutral300:#666687;
            --tm-ds-neutral400:#a5a5ba;
            --tm-ds-neutral500:#c0c0cf;
            --tm-ds-neutral600:#a5a5ba;
            --tm-ds-neutral700:#eaeaef;
            --tm-ds-neutral800:#ffffff;
            --tm-ds-neutral900:#ffffff;
            --tm-ds-primary100:#181826;
            --tm-ds-primary200:#4a4a6a;
            --tm-ds-primary500:#4945ff;
            --tm-ds-primary600:#7b79ff;
            --tm-ds-primary700:#7b79ff;
            --tm-ds-secondary100:#181826;
            --tm-ds-secondary200:#4a4a6a;
            --tm-ds-secondary500:#66b7f1;
            --tm-ds-secondary600:#66b7f1;
            --tm-ds-secondary700:#b8e1ff;
            --tm-ds-success100:#181826;
            --tm-ds-success200:#4a4a6a;
            --tm-ds-success500:#5cb176;
            --tm-ds-success600:#5cb176;
            --tm-ds-success700:#c6f0c2;
            --tm-ds-warning100:#181826;
            --tm-ds-warning200:#4a4a6a;
            --tm-ds-warning500:#f29d41;
            --tm-ds-warning600:#f29d41;
            --tm-ds-warning700:#fae7b9;
        }
        @media(min-width:768px){
            :root{
                --tm-ds-text-size:1.4rem;
                --tm-ds-text-line:1.43;
                --tm-ds-button-height:3.2rem;
            }
        }
        [data-tm-ds] .tm-ds-text,
        [data-tm-ds] .tm-ds-link,
        [data-tm-ds] .tm-ds-status{
            font-family:inherit;font-size:var(--tm-ds-text-size);
            font-weight:400;line-height:var(--tm-ds-text-line)
        }
        [data-tm-ds] .tm-ds-text{color:var(--tm-ds-neutral800)}
        [data-tm-ds] .tm-ds-meta{
            font-family:inherit;font-size:var(--tm-ds-small-size);
            font-weight:400;line-height:var(--tm-ds-small-line);color:var(--tm-ds-neutral600)
        }
        [data-tm-ds] .tm-ds-link{color:var(--tm-ds-primary600);text-decoration:none}
        [data-tm-ds] .tm-ds-link:hover{text-decoration:underline}
        [data-tm-ds] .tm-ds-input{
            box-sizing:border-box;border:1px solid var(--tm-ds-neutral200);
            border-radius:var(--tm-ds-radius);background:var(--tm-ds-neutral0);
            color:var(--tm-ds-neutral800);font:inherit;font-size:var(--tm-ds-text-size);
            font-weight:400;line-height:2.4rem;padding:12px 16px;outline:none
        }
        @media(min-width:768px){
            [data-tm-ds] .tm-ds-input{line-height:2.2rem;padding:8px 16px}
        }
        [data-tm-ds] .tm-ds-input::placeholder{color:var(--tm-ds-neutral600);opacity:1}
        [data-tm-ds] .tm-ds-input:focus{
            border-color:var(--tm-ds-primary600);box-shadow:0 0 0 1px var(--tm-ds-primary600)
        }
        [data-tm-ds] .tm-ds-button{
            display:inline-flex;align-items:center;justify-content:center;gap:8px;
            box-sizing:border-box;min-height:var(--tm-ds-button-height);padding:0 16px;
            border:1px solid var(--tm-ds-neutral200);border-radius:var(--tm-ds-radius);
            background:var(--tm-ds-neutral0);color:var(--tm-ds-neutral800);
            font:inherit;font-size:var(--tm-ds-small-size);font-weight:600;
            line-height:var(--tm-ds-small-line);cursor:pointer
        }
        [data-tm-ds] .tm-ds-button:hover:not(:disabled){background:var(--tm-ds-neutral100)}
        [data-tm-ds] .tm-ds-button:active:not(:disabled){background:var(--tm-ds-neutral150)}
        [data-tm-ds] .tm-ds-button:disabled,
        [data-tm-ds] .tm-ds-input:disabled{
            border-color:var(--tm-ds-neutral200);background:var(--tm-ds-neutral150);
            color:var(--tm-ds-neutral600);cursor:default
        }
        [data-tm-ds] .tm-ds-button:focus-visible,
        [data-tm-ds] .tm-ds-link:focus-visible,
        [data-tm-ds] .tm-ds-page:focus-visible{
            outline:2px solid var(--tm-ds-primary600);outline-offset:2px
        }
        [data-tm-ds] .tm-ds-page{
            display:inline-flex;align-items:center;justify-content:center;
            box-sizing:border-box;min-width:32px;min-height:32px;padding:4px 8px;
            border:1px solid transparent;border-radius:var(--tm-ds-radius);
            background:transparent;color:var(--tm-ds-neutral800);
            font:inherit;font-size:var(--tm-ds-small-size);line-height:var(--tm-ds-small-line);
            cursor:pointer
        }
        [data-tm-ds] .tm-ds-page:hover:not(:disabled){border-color:var(--tm-ds-neutral200)}
        [data-tm-ds] .tm-ds-page[data-active="true"]{
            background:var(--tm-ds-neutral0);color:var(--tm-ds-primary700);
            border-color:var(--tm-ds-neutral200);font-weight:600
        }
        [data-tm-ds] .tm-ds-page:disabled{color:var(--tm-ds-neutral300);cursor:default}
        [data-tm-ds] .tm-ds-status{
            display:inline-flex;align-items:center;box-sizing:border-box;
            padding:4px 8px;border:1px solid var(--tm-ds-neutral200);border-radius:var(--tm-ds-radius);
            background:var(--tm-ds-neutral100);color:var(--tm-ds-neutral600);
            font-weight:600;text-transform:capitalize;white-space:nowrap
        }
        [data-tm-ds] .tm-ds-status[data-status="published"]{
            background:var(--tm-ds-success100);border-color:var(--tm-ds-success200);color:var(--tm-ds-success600)
        }
        [data-tm-ds] .tm-ds-status[data-status="modified"]{
            background:var(--tm-ds-alternative100);border-color:var(--tm-ds-alternative200);color:var(--tm-ds-alternative600)
        }
        [data-tm-ds] .tm-ds-status[data-status="draft"]{
            background:var(--tm-ds-secondary100);border-color:var(--tm-ds-secondary200);color:var(--tm-ds-secondary600)
        }
    `;
    if (!document.getElementById(STYLE_ID)) (document.head || root).appendChild(style);

    window[KEY] = { syncTheme };
    new MutationObserver(syncTheme).observe(root, {
        attributes: true, attributeFilter: ['class', 'style']
    });
    document.addEventListener('DOMContentLoaded', syncTheme, { once: true });
    syncTheme();
})();
