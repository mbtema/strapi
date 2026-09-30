(async () => {
  'use strict';

  const PARSER = 'style-stealer';
  const VERSION = '1.1.0';
  const OUTPUT_FILE = 'style-stealer.json';
  const CREATED_ATTR = 'data-tm-created';
  const MODIFIED_ATTR = 'data-tm-modified';
  const BATCH_SIZE = 150;
  const MAX_EXAMPLES = 5;
  const MAX_SELECTOR_ERROR_SAMPLES = 20;

  const UI_PROPERTIES = [
    'display', 'visibility', 'opacity', 'position', 'z-index',
    'top', 'right', 'bottom', 'left', 'inset',
    'box-sizing',
    'width', 'min-width', 'max-width',
    'height', 'min-height', 'max-height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'gap', 'row-gap', 'column-gap',
    'overflow', 'overflow-x', 'overflow-y',
    'flex', 'flex-grow', 'flex-shrink', 'flex-basis',
    'flex-direction', 'flex-wrap', 'align-items', 'align-content',
    'align-self', 'justify-content', 'justify-items', 'justify-self',
    'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
    'color', 'background-color', 'background-image',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius',
    'border-bottom-right-radius', 'border-bottom-left-radius',
    'box-shadow', 'outline', 'outline-offset',
    'font-family', 'font-size', 'font-weight', 'font-style',
    'line-height', 'letter-spacing', 'text-align',
    'text-transform', 'text-decoration', 'white-space',
    'text-overflow', 'word-break', 'overflow-wrap',
    'cursor', 'pointer-events',
    'transform', 'transform-origin',
    'transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay',
    'animation-name', 'animation-duration', 'animation-timing-function',
    'content'
  ];

  const TOKEN_PROPERTIES = [
    'color',
    'background-color',
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-right-radius',
    'border-bottom-left-radius',
    'box-shadow',
    'outline',
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'letter-spacing',
    'gap',
    'row-gap',
    'column-gap',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'transition-duration',
    'transition-timing-function'
  ];

  const started = performance.now();
  const warnings = {
    inaccessibleStylesheets: [],
    selectorErrors: []
  };

  if (!document.body) {
    console.warn('[style-stealer] document.body не найден');
    return;
  }

  console.log(`[style-stealer] v${VERSION} start`);
  console.log('[style-stealer] Подготовка CSS rules...');

  const cssIndex = collectCssRules();
  const elements = [document.body, ...document.body.querySelectorAll('*')];
  const kindState = new WeakMap();

  const buckets = {
    native: createBucket(),
    modified: createBucket(),
    custom: createBucket()
  };

  let nativeElements = 0;
  let modifiedElements = 0;
  let customElements = 0;
  let pseudoBefore = 0;
  let pseudoAfter = 0;

  for (let offset = 0; offset < elements.length; offset += BATCH_SIZE) {
    const end = Math.min(offset + BATCH_SIZE, elements.length);

    for (let index = offset; index < end; index++) {
      const element = elements[index];
      const parentKind = element.parentElement
        ? kindState.get(element.parentElement) || 'native'
        : 'native';
      const kind = classifyElement(element, parentKind);
      kindState.set(element, kind);

      if (kind === 'custom') customElements += 1;
      else if (kind === 'modified') modifiedElements += 1;
      else nativeElements += 1;

      captureProfile(buckets[kind], element, null, cssIndex);

      const before = getComputedStyle(element, '::before');
      if (isRenderedPseudo(before)) {
        pseudoBefore += 1;
        captureProfile(buckets[kind], element, 'before', cssIndex, before);
      }

      const after = getComputedStyle(element, '::after');
      if (isRenderedPseudo(after)) {
        pseudoAfter += 1;
        captureProfile(buckets[kind], element, 'after', cssIndex, after);
      }
    }

    console.log(
      `[style-stealer] ${end}/${elements.length} элементов | native ${nativeElements} | modified ${modifiedElements} | custom ${customElements} | profiles ${buckets.native.profiles.size + buckets.modified.profiles.size + buckets.custom.profiles.size}`
    );

    if (end < elements.length) {
      await yieldToBrowser();
    }
  }

  const native = finalizeBucket(buckets.native);
  const modified = finalizeBucket(buckets.modified);
  const custom = finalizeBucket(buckets.custom);

  const page = getPageMetadata();
  const durationMs = Math.round((performance.now() - started) * 10) / 10;

  const dump = {
    page,
    parser: {
      name: PARSER,
      version: VERSION
    },
    summary: {
      scannedElements: elements.length,
      nativeElements,
      modifiedElements,
      customElements,
      pseudoBefore,
      pseudoAfter,
      nativeProfiles: native.profiles.length,
      modifiedProfiles: modified.profiles.length,
      customProfiles: custom.profiles.length,
      cssStyleRules: cssIndex.rules.length,
      stylesheets: {
        total: document.styleSheets.length,
        readable: cssIndex.readableStylesheets,
        inaccessible: warnings.inaccessibleStylesheets.length
      },
      durationMs
    },
    tokens: {
      native: native.tokens,
      modified: modified.tokens,
      custom: custom.tokens
    },
    native: {
      profiles: native.profiles
    },
    modified: {
      profiles: modified.profiles
    },
    custom: {
      profiles: custom.profiles
    },
    warnings
  };

  const text = JSON.stringify(dump, null, 2);
  let copied = false;

  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    downloadJson(text, OUTPUT_FILE);
  }

  console.log(
    `[style-stealer] Готово: ${elements.length} элементов | ${native.profiles.length + modified.profiles.length + custom.profiles.length} profiles | ${Math.round(text.length / 1024).toLocaleString()} KB | ${durationMs} ms` +
    (copied ? ' | JSON скопирован в буфер' : ` | JSON скачан: ${OUTPUT_FILE}`)
  );

  function createBucket() {
    return {
      profiles: new Map(),
      tokens: new Map()
    };
  }

  function captureProfile(bucket, element, pseudo, cssIndex, providedStyle) {
    const style = providedStyle || getComputedStyle(element, pseudo ? `::${pseudo}` : null);
    const computed = pickComputed(style);
    const profileKey = `${pseudo || 'element'}\n${JSON.stringify(computed)}`;

    let profile = bucket.profiles.get(profileKey);

    if (!profile) {
      profile = {
        kind: pseudo ? `::${pseudo}` : 'element',
        count: 0,
        computed,
        examples: [],
        matchedRules: matchCssRules(element, pseudo, cssIndex.rules)
      };
      bucket.profiles.set(profileKey, profile);
    }

    profile.count += 1;

    if (profile.examples.length < MAX_EXAMPLES) {
      profile.examples.push(describeElement(element, pseudo));
    }

    countTokens(bucket.tokens, computed);
  }

  function pickComputed(style) {
    const result = {};

    for (const property of UI_PROPERTIES) {
      const value = style.getPropertyValue(property).trim();
      if (value) result[property] = value;
    }

    return result;
  }

  function isRenderedPseudo(style) {
    const content = String(style.getPropertyValue('content') || '').trim();
    const display = String(style.getPropertyValue('display') || '').trim();

    return display !== 'none' &&
      content !== '' &&
      content !== 'none' &&
      content !== 'normal';
  }

  function countTokens(tokenMap, computed) {
    for (const property of TOKEN_PROPERTIES) {
      const value = computed[property];
      if (!value) continue;

      if (!tokenMap.has(property)) tokenMap.set(property, new Map());
      const values = tokenMap.get(property);
      values.set(value, (values.get(value) || 0) + 1);
    }
  }

  function finalizeBucket(bucket) {
    const profiles = [...bucket.profiles.values()]
      .sort((a, b) => b.count - a.count);

    const tokens = {};

    for (const property of TOKEN_PROPERTIES) {
      const values = bucket.tokens.get(property);
      if (!values) continue;

      tokens[property] = [...values.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    }

    return { profiles, tokens };
  }

  function classifyElement(element, parentKind) {
    if (element.hasAttribute(CREATED_ATTR)) return 'custom';
    if (element.hasAttribute(MODIFIED_ATTR)) return 'modified';
    if (parentKind === 'custom') return 'custom';
    if (hasOwnTmMarker(element)) return 'modified';
    return 'native';
  }

  function hasOwnTmMarker(element) {
    const id = String(element.getAttribute('id') || '');
    if (id.startsWith('tm-')) return true;

    const classes = String(element.getAttribute('class') || '')
      .split(/\s+/)
      .filter(Boolean);

    if (classes.some(name => name.startsWith('tm-'))) return true;

    return element.getAttributeNames()
      .some(name => name.startsWith('data-tm-'));
  }

  function describeElement(element, pseudo) {
    const descriptor = {
      selector: buildSelectorHint(element),
      tag: element.tagName.toLowerCase()
    };

    const role = element.getAttribute('role');
    const name = element.getAttribute('name');
    const ariaLabel = element.getAttribute('aria-label');
    const type = element.getAttribute('type');
    const text = compactText(element.textContent);

    if (pseudo) descriptor.pseudo = `::${pseudo}`;
    if (role) descriptor.role = role;
    if (name) descriptor.name = name;
    if (type) descriptor.type = type;
    if (ariaLabel) descriptor.ariaLabel = ariaLabel;
    if (text) descriptor.text = text;

    const markers = getTmMarkers(element);
    if (markers.length) descriptor.tmMarkers = markers;

    return descriptor;
  }

  function buildSelectorHint(element) {
    const tag = element.tagName.toLowerCase();
    const id = String(element.getAttribute('id') || '');

    if (id && !id.startsWith('radix-') && !id.startsWith(':')) {
      return `${tag}#${cssEscape(id)}`;
    }

    const name = element.getAttribute('name');
    if (name) return `${tag}[name="${escapeAttribute(name)}"]`;

    const tmAttrName = element.getAttributeNames()
      .find(name => name.startsWith('data-tm-'));

    if (tmAttrName) {
      const tmAttrValue = element.getAttribute(tmAttrName);
      return tmAttrValue
        ? `${tag}[${tmAttrName}="${escapeAttribute(tmAttrValue)}"]`
        : `${tag}[${tmAttrName}]`;
    }

    const role = element.getAttribute('role');
    const ariaLabel = element.getAttribute('aria-label');

    if (role && ariaLabel) {
      return `${tag}[role="${escapeAttribute(role)}"][aria-label="${escapeAttribute(ariaLabel)}"]`;
    }

    if (role) return `${tag}[role="${escapeAttribute(role)}"]`;

    const tmClass = String(element.getAttribute('class') || '')
      .split(/\s+/)
      .find(name => name.startsWith('tm-'));

    if (tmClass) return `${tag}.${cssEscape(tmClass)}`;

    return tag;
  }

  function getTmMarkers(element) {
    const result = [];
    const id = String(element.getAttribute('id') || '');

    if (id.startsWith('tm-')) result.push(`#${id}`);

    for (const className of String(element.getAttribute('class') || '').split(/\s+/)) {
      if (className.startsWith('tm-')) result.push(`.${className}`);
    }

    for (const name of element.getAttributeNames()) {
      if (!name.startsWith('data-tm-')) continue;
      const value = element.getAttribute(name);

      result.push(
        value
          ? `[${name}="${value}"]`
          : `[${name}]`
      );
    }

    return result;
  }

  function compactText(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  }

  function collectCssRules() {
    const rules = [];
    const visited = new WeakSet();
    let readableStylesheets = 0;

    Array.from(document.styleSheets).forEach((sheet, index) => {
      walkStyleSheet(sheet, sheet.href || `inline:${index + 1}`);
    });

    return {
      rules,
      readableStylesheets
    };

    function walkStyleSheet(sheet, source) {
      if (!sheet || visited.has(sheet)) return;
      visited.add(sheet);

      let cssRules;

      try {
        cssRules = sheet.cssRules;
        readableStylesheets += 1;
      } catch (error) {
        warnings.inaccessibleStylesheets.push({
          source,
          error: formatError(error)
        });
        return;
      }

      walkRuleList(cssRules, source, []);
    }

    function walkRuleList(ruleList, source, context) {
      for (const rule of Array.from(ruleList)) {
        if (rule.type === CSSRule.STYLE_RULE) {
          const declarations = pickRuleDeclarations(rule.style);
          if (!Object.keys(declarations).length) continue;

          rules.push({
            selector: rule.selectorText,
            source,
            context: context.length ? [...context] : undefined,
            declarations
          });
          continue;
        }

        if (rule.type === CSSRule.IMPORT_RULE) {
          try {
            walkStyleSheet(rule.styleSheet, rule.href || source);
          } catch (error) {
            warnings.inaccessibleStylesheets.push({
              source: rule.href || source,
              error: formatError(error)
            });
          }
          continue;
        }

        if (!rule.cssRules) continue;

        if (rule.type === CSSRule.MEDIA_RULE) {
          let matches = false;
          try {
            matches = matchMedia(rule.conditionText).matches;
          } catch {}

          if (matches) {
            walkRuleList(rule.cssRules, source, [...context, `@media ${rule.conditionText}`]);
          }
          continue;
        }

        if (rule.type === CSSRule.SUPPORTS_RULE) {
          let matches = true;
          try {
            matches = CSS.supports(rule.conditionText);
          } catch {}

          if (matches) {
            walkRuleList(rule.cssRules, source, [...context, `@supports ${rule.conditionText}`]);
          }
          continue;
        }

        const label = rule.cssText
          ? String(rule.cssText).split('{', 1)[0].trim()
          : `@rule-${rule.type}`;

        walkRuleList(rule.cssRules, source, [...context, label]);
      }
    }
  }

  function pickRuleDeclarations(style) {
    const result = {};

    for (let index = 0; index < style.length; index++) {
      const property = style.item(index);
      if (!isRelevantDeclaration(property)) continue;

      const value = style.getPropertyValue(property).trim();
      if (!value) continue;

      result[property] = style.getPropertyPriority(property) === 'important'
        ? `${value} !important`
        : value;
    }

    return result;
  }

  function isRelevantDeclaration(property) {
    const name = String(property || '').toLowerCase();

    return UI_PROPERTIES.includes(name) ||
      /^(background|border|border-radius|box-shadow|outline|font|text-|word-|white-space)/.test(name) ||
      /^(margin|padding|gap|row-gap|column-gap)/.test(name) ||
      /^(display|visibility|opacity|position|z-index|inset|top|right|bottom|left)/.test(name) ||
      /^(width|min-width|max-width|height|min-height|max-height|box-sizing|overflow)/.test(name) ||
      /^(flex|align-|justify-|grid-)/.test(name) ||
      /^(cursor|pointer-events|transform|transition|animation)/.test(name) ||
      name === 'content';
  }

  function matchCssRules(element, pseudo, rules) {
    const matched = [];
    const seen = new Set();

    if (!pseudo) {
      const inlineDeclarations = pickRuleDeclarations(element.style);

      if (Object.keys(inlineDeclarations).length) {
        matched.push({
          selector: '[style]',
          source: 'element.style',
          declarations: inlineDeclarations
        });
        seen.add(JSON.stringify([
          '[style]',
          'element.style',
          [],
          inlineDeclarations
        ]));
      }
    }

    for (const rule of rules) {
      const selectors = splitSelectorList(rule.selector);
      let applies = false;

      for (const selector of selectors) {
        const normalized = normalizeSelectorForTarget(selector, pseudo);
        if (!normalized) continue;

        try {
          if (element.matches(normalized)) {
            applies = true;
            break;
          }
        } catch (error) {
          recordSelectorError(selector, error);
        }
      }

      if (!applies) continue;

      const key = JSON.stringify([
        rule.selector,
        rule.source,
        rule.context || [],
        rule.declarations
      ]);

      if (seen.has(key)) continue;
      seen.add(key);

      matched.push({
        selector: rule.selector,
        source: rule.source,
        ...(rule.context ? { context: rule.context } : {}),
        declarations: rule.declarations
      });
    }

    return matched;
  }

  function normalizeSelectorForTarget(selector, pseudo) {
    const value = String(selector || '').trim();
    if (!value) return null;

    const before = /::?before\b/i.test(value);
    const after = /::?after\b/i.test(value);

    if (!pseudo && (before || after)) return null;
    if (pseudo === 'before' && !before) return null;
    if (pseudo === 'after' && !after) return null;
    if (pseudo === 'before' && after) return null;
    if (pseudo === 'after' && before) return null;

    if (pseudo === 'before') return value.replace(/::?before\b/gi, '').trim();
    if (pseudo === 'after') return value.replace(/::?after\b/gi, '').trim();

    return value;
  }

  function splitSelectorList(selectorText) {
    const result = [];
    let current = '';
    let quote = '';
    let escaped = false;
    let round = 0;
    let square = 0;

    for (const char of String(selectorText || '')) {
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }

      if (char === '\\') {
        current += char;
        escaped = true;
        continue;
      }

      if (quote) {
        current += char;
        if (char === quote) quote = '';
        continue;
      }

      if (char === '"' || char === "'") {
        current += char;
        quote = char;
        continue;
      }

      if (char === '(') round += 1;
      else if (char === ')') round = Math.max(0, round - 1);
      else if (char === '[') square += 1;
      else if (char === ']') square = Math.max(0, square - 1);

      if (char === ',' && round === 0 && square === 0) {
        if (current.trim()) result.push(current.trim());
        current = '';
        continue;
      }

      current += char;
    }

    if (current.trim()) result.push(current.trim());
    return result;
  }

  function recordSelectorError(selector, error) {
    if (warnings.selectorErrors.length >= MAX_SELECTOR_ERROR_SAMPLES) return;

    const message = formatError(error);
    if (warnings.selectorErrors.some(item => item.selector === selector && item.error === message)) {
      return;
    }

    warnings.selectorErrors.push({
      selector,
      error: message
    });
  }

  function getPageMetadata() {
    const params = new URLSearchParams(location.search);
    const routeMatch = location.pathname.match(
      /\/admin\/content-manager\/(?:collection-types|single-types)\/([^/]+)(?:\/([^/]+))?/
    );
    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = getComputedStyle(document.body);

    return {
      url: location.href,
      pathname: location.pathname,
      query: location.search,
      title: document.title,
      locale: params.get('plugins[i18n][locale]') || params.get('locale') || null,
      contentType: routeMatch?.[1] ? decodeURIComponent(routeMatch[1]) : null,
      documentId: routeMatch?.[2] ? decodeURIComponent(routeMatch[2]) : null,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio
      },
      theme: {
        colorScheme: rootStyle.colorScheme || null,
        bodyBackground: bodyStyle.backgroundColor,
        bodyColor: bodyStyle.color
      },
      timestamp: new Date().toISOString()
    };
  }

  function yieldToBrowser() {
    return new Promise(resolve => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => resolve(), { timeout: 100 });
        return;
      }

      requestAnimationFrame(() => resolve());
    });
  }

  function downloadJson(text, filename) {
    const url = URL.createObjectURL(
      new Blob([text], { type: 'application/json;charset=utf-8' })
    );
    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: filename
    });

    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(String(value));
    return String(value).replace(/[^a-zA-Z0-9_-]/g, character => `\\${character}`);
  }

  function escapeAttribute(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function formatError(error) {
    return `${error?.name || 'Error'}: ${error?.message || String(error || 'unknown error')}`;
  }
})();
