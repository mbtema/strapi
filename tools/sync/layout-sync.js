(async () => {
  'use strict';
  const __tm=(()=>{
    const box=document.createElement('div');
    Object.assign(box.style,{position:'fixed',right:'24px',bottom:'24px',width:'370px',padding:'18px',background:'#171923',color:'#fff',border:'1px solid #4945ff',borderRadius:'12px',boxShadow:'0 8px 35px #0008',font:'13px system-ui,sans-serif',zIndex:'2147483647'});
    box.innerHTML='<div style="display:flex;justify-content:space-between"><b>layout-sync.js</b><button data-stop style="background:#4945ff;color:#fff;border:0;border-radius:5px;padding:6px 10px;cursor:pointer">Стоп</button></div><div data-phase style="margin-top:14px">Подготовка</div><div style="height:10px;background:#363846;border-radius:8px;margin-top:9px;overflow:hidden"><div data-bar style="background:#7b79ff;width:0%;height:100%;transition:width .2s"></div></div><div data-progress style="margin-top:8px">0 / ?</div><div data-speed style="margin-top:8px;color:#b8bacb">—</div><div data-metrics style="margin-top:5px;color:#b8bacb">—</div><div data-eta style="margin-top:5px;color:#b8bacb">—</div>';
    document.body.appendChild(box);const el=k=>box.querySelector('[data-'+k+']');
    const st={stop:false,done:0,total:0,phase:'Подготовка',start:performance.now(),phaseStart:performance.now(),failed:0,concurrency:null,best:null};
    el('stop').onclick=()=>{st.stop=true;el('stop').textContent='Остановка…';el('stop').disabled=true;};
    function render(){const dt=Math.max(.001,(performance.now()-st.phaseStart)/1000),speed=st.done/dt,pct=st.total?Math.min(100,100*st.done/st.total):0;el('phase').textContent=st.phase;el('bar').style.width=pct.toFixed(1)+'%';el('progress').textContent=st.done+' / '+(st.total||'?')+' ('+pct.toFixed(1)+'%)';el('speed').textContent='Скорость: '+speed.toFixed(1)+'/сек';el('metrics').textContent='Ошибки: '+st.failed+(st.concurrency===null?'':' · concurrency: '+st.concurrency)+(st.best===null?'':' · best: '+st.best);el('eta').textContent='ETA: '+(speed&&st.total?Math.ceil((st.total-st.done)/speed)+' сек':'—')+' · прошло: '+Math.ceil((performance.now()-st.start)/1000)+' сек';}
    function phase(name,total=0){st.phase=name;st.total=total;st.done=0;st.phaseStart=performance.now();render();}
    function step(n=1){st.done+=n;render();}
    function perf(cur,best){st.concurrency=cur;st.best=best;render();}
    function finish(status='Завершено'){st.phase=status;render();el('stop').disabled=false;el('stop').textContent='Закрыть';el('stop').onclick=()=>box.remove();}
    render();return {st,phase,step,perf,finish,render};
  })();


  const PRODUCT_UID = 'api::product.product';
  const PRODUCT_ENTRY_RE = /^\/admin\/content-manager\/collection-types\/api::product\.product\/([^/]+)\/?$/;
  const CONFIG_URL = '/content-manager/content-types/' + PRODUCT_UID + '/configuration';
  const ROOT_SELECTOR = '[data-tm-product-sections="true"]';
  const TAB_SELECTOR = '[data-tm-product-section-tab]';
  const FILTER_GROUP_ORDER_ATTR = 'data-tm-product-filter-group-order';
  const SECTION_KEYS = ['content', 'filters', 'system'];
  const ROW_TOLERANCE_PX = 4;

  const entryMatch = location.pathname.match(PRODUCT_ENTRY_RE);

  if (!entryMatch || entryMatch[1] === 'configurations') {
    throw new Error(
      '[layout-sync] Открой обычную карточку Product, где уже работает product-sections'
    );
  }

  const root = document.querySelector(ROOT_SELECTOR);
  const panel = root?.closest('[role="tabpanel"]');

  if (!root || !panel) {
    throw new Error(
      '[layout-sync] Не найден product-sections. Обнови страницу и проверь extensions'
    );
  }

  const getAdminToken = () => {
    const raw = localStorage.getItem('jwtToken');
    if (!raw) return '';

    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === 'string' ? parsed : raw;
    } catch {
      return raw.replace(/^"|"$/g, '');
    }
  };

  const adminToken = getAdminToken();

  if (!adminToken) {
    throw new Error('[layout-sync] Не найден jwtToken в LocalStorage');
  }

  const headers = {
    Accept: 'application/json',
    Authorization: 'Bearer ' + adminToken
  };

  async function getConfiguration(label) {
    const response = await fetch(CONFIG_URL, {
      method: 'GET',
      credentials: 'include',
      headers
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        label + ': HTTP ' + response.status +
        (body ? ' — ' + body.slice(0, 300) : '')
      );
    }

    const json = await response.json();
    const contentType = json?.data?.contentType ?? json?.data ?? json;

    if (
      !contentType ||
      !contentType.layouts ||
      !Array.isArray(contentType.layouts.edit) ||
      !contentType.settings ||
      !contentType.metadatas
    ) {
      throw new Error(label + ': неожиданный формат configuration');
    }

    return contentType;
  }

  async function putConfiguration(payload) {
    const response = await fetch(CONFIG_URL, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        'PUT configuration: HTTP ' + response.status +
        (body ? ' — ' + body.slice(0, 400) : '')
      );
    }

    return response.json().catch(() => null);
  }

  function getLayoutFields(layout) {
    return layout.flatMap((row, rowIndex) =>
      row.map((field, columnIndex) => ({
        name: field.name,
        size: field.size,
        rowIndex,
        columnIndex
      }))
    );
  }

  function getFieldNames(layout) {
    return getLayoutFields(layout).map(field => field.name);
  }

  function escapeCss(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function getAncestors(element, stopAt) {
    const result = [];
    let node = element;

    while (node && node !== stopAt) {
      result.push(node);
      node = node.parentElement;
    }

    if (stopAt) result.push(stopAt);
    return result;
  }

  function findFieldStack(markers) {
    if (!markers.length) return null;

    const ancestorSets = markers.map(marker =>
      new Set(getAncestors(marker.element, panel))
    );

    for (const candidate of getAncestors(markers[0].element, panel)) {
      if (candidate === panel) break;

      if (ancestorSets.every(set => set.has(candidate))) {
        return candidate;
      }
    }

    return null;
  }

  function directChildUnder(element, ancestor) {
    if (!element || !ancestor || !ancestor.contains(element)) return null;

    let node = element;

    while (node?.parentElement && node.parentElement !== ancestor) {
      node = node.parentElement;
    }

    return node?.parentElement === ancestor ? node : null;
  }

  function normalizeTextLines(element) {
    return String(element?.textContent || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
  }

  function buildFieldMarkers(fieldNames) {
    const fieldSet = new Set(fieldNames);
    const markerByName = new Map();

    for (const name of fieldNames) {
      const selector = '[name="' + escapeCss(name) + '"]';
      const matches = [...panel.querySelectorAll(selector)];

      if (matches.length) {
        markerByName.set(name, matches);
      }
    }

    const textCandidates = panel.querySelectorAll(
      'p[id$="-hint"], label, p, span'
    );

    for (const element of textCandidates) {
      const lines = normalizeTextLines(element);

      for (const line of lines) {
        if (!fieldSet.has(line)) continue;

        if (!markerByName.has(line)) {
          markerByName.set(line, []);
        }

        const list = markerByName.get(line);
        if (!list.includes(element)) list.push(element);
      }
    }

    for (const name of fieldNames) {
      if (markerByName.has(name)) continue;

      const fallback = [...textCandidates].find(element =>
        String(element.textContent || '').includes(name)
      );

      if (fallback) markerByName.set(name, [fallback]);
    }

    if (!markerByName.has('relatedProductsSlider')) {
      const sliderLabel = [...panel.querySelectorAll('label')]
        .find(label =>
          String(label.textContent || '').includes('relatedProductsSlider')
        );

      if (sliderLabel) {
        markerByName.set('relatedProductsSlider', [sliderLabel]);
      }
    }

    return markerByName;
  }

  function choosePrimaryMarkers(markerByName, fieldNames) {
    const markers = [];

    for (const name of fieldNames) {
      const candidates = markerByName.get(name) || [];
      const element = candidates.find(candidate => panel.contains(candidate));

      if (element) {
        markers.push({ name, element });
      }
    }

    return markers;
  }

  function isVisible(element) {
    if (!element || !document.contains(element)) return false;

    const style = getComputedStyle(element);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      Number(style.opacity) === 0
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
  }

  function getActiveTabKey() {
    return root
      .querySelector(TAB_SELECTOR + '[aria-selected="true"]')
      ?.getAttribute('data-tm-product-section-tab') || null;
  }

  async function activateTab(key, scrollPosition) {
    const button = root.querySelector(
      TAB_SELECTOR + '[data-tm-product-section-tab="' + escapeCss(key) + '"]'
    );

    if (!button) {
      throw new Error('[layout-sync] Не найдена вкладка ' + key);
    }

    if (button.getAttribute('aria-selected') !== 'true') {
      button.click();
      await nextFrame();
      await nextFrame();
    }

    window.scrollTo(scrollPosition.x, scrollPosition.y);
  }

  function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
  }

  function groupByVisualRows(items, sizeByName, sortByFilterGroup = false) {
    const sorted = [...items].sort((a, b) =>
      Math.abs(a.top - b.top) > ROW_TOLERANCE_PX
        ? a.top - b.top
        : a.left - b.left
    );

    const rows = [];

    for (const item of sorted) {
      let row = rows.find(candidate =>
        Math.abs(candidate.top - item.top) <= ROW_TOLERANCE_PX
      );

      if (!row) {
        row = { top: item.top, items: [] };
        rows.push(row);
      }

      row.items.push(item);
    }

    rows.sort((a, b) => {
      if (sortByFilterGroup) {
        const aGroup = Math.min(
          ...a.items.map(item => item.groupOrder ?? Number.MAX_SAFE_INTEGER)
        );
        const bGroup = Math.min(
          ...b.items.map(item => item.groupOrder ?? Number.MAX_SAFE_INTEGER)
        );

        if (aGroup !== bGroup) return aGroup - bGroup;
      }

      return a.top - b.top;
    });

    return rows.map(row =>
      row.items
        .sort((a, b) => a.left - b.left)
        .map(item => ({
          name: item.name,
          size: sizeByName.get(item.name) ?? 12
        }))
    );
  }

  function scanVisibleSection(stack, markerByName, fieldNames, sizeByName, section) {
    const items = [];
    const seen = new Set();

    for (const name of fieldNames) {
      const candidates = markerByName.get(name) || [];

      for (const marker of candidates) {
        if (!panel.contains(marker)) continue;

        const row = directChildUnder(marker, stack);
        if (!row) continue;

        const branch = directChildUnder(marker, row) || row;
        if (!isVisible(branch)) continue;

        if (seen.has(name)) break;

        const rect = branch.getBoundingClientRect();

        const groupOrderRaw = row.getAttribute(FILTER_GROUP_ORDER_ATTR);
        const groupOrder = groupOrderRaw === null
          ? null
          : Number(groupOrderRaw);

        items.push({
          name,
          top: Math.round(rect.top * 10) / 10,
          left: Math.round(rect.left * 10) / 10,
          groupOrder:
            section === 'filters' &&
            groupOrder !== null &&
            Number.isFinite(groupOrder)
              ? groupOrder
              : null
        });

        seen.add(name);
        break;
      }
    }

    return {
      rows: groupByVisualRows(items, sizeByName, section === 'filters'),
      names: [...seen]
    };
  }

  function compareLayouts(currentLayout, desiredLayout) {
    const current = new Map(
      getLayoutFields(currentLayout).map(field => [
        field.name,
        {
          row: field.rowIndex + 1,
          column: field.columnIndex + 1
        }
      ])
    );

    const desired = new Map(
      getLayoutFields(desiredLayout).map(field => [
        field.name,
        {
          row: field.rowIndex + 1,
          column: field.columnIndex + 1
        }
      ])
    );

    return [...desired.entries()]
      .map(([name, next]) => {
        const prev = current.get(name) || { row: null, column: null };

        return {
          field: name,
          fromRow: prev.row,
          fromColumn: prev.column,
          toRow: next.row,
          toColumn: next.column
        };
      })
      .filter(item =>
        item.fromRow !== item.toRow ||
        item.fromColumn !== item.toColumn
      );
  }

  function sameLayout(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function pickKeys(source, allowedKeys) {
    const result = {};
    if (!source || typeof source !== 'object') return result;

    for (const key of allowedKeys) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        result[key] = source[key];
      }
    }

    return result;
  }

  function sanitizeMetadatasForPut(metadatas) {
    const cleaned = {};

    for (const [name, metadata] of Object.entries(metadatas || {})) {
      cleaned[name] = {
        edit: pickKeys(metadata?.edit, [
          'label',
          'description',
          'placeholder',
          'visible',
          'editable',
          'mainField'
        ]),
        list: pickKeys(metadata?.list, [
          'label',
          'searchable',
          'sortable'
        ])
      };
    }

    return cleaned;
  }

  function printLayout(label, layout) {
    console.log('[layout-sync] ' + label);

    console.table(
      layout.map((row, index) => ({
        row: index + 1,
        fields: row.map(field => field.name).join(' | '),
        sizes: row.map(field => field.size).join(' | ')
      }))
    );
  }

  __tm.phase('Синхронизация layout',5);
  console.log('[layout-sync] start');
  console.log('[layout-sync] Читаю штатную configuration...');

  const configuration = await getConfiguration('GET configuration');
  __tm.step();if(__tm.st.stop){__tm.finish('Остановлено');return;}
  const currentLayout = configuration.layouts.edit;
  const currentFields = getLayoutFields(currentLayout);
  const fieldNames = currentFields.map(field => field.name);
  const fieldSet = new Set(fieldNames);
  const sizeByName = new Map(
    currentFields.map(field => [field.name, field.size])
  );

  const markerByName = buildFieldMarkers(fieldNames);
  const primaryMarkers = choosePrimaryMarkers(markerByName, fieldNames);
  const stack = findFieldStack(primaryMarkers);

  if (!stack) {
    throw new Error(
      '[layout-sync] Не удалось определить общий контейнер полей Product'
    );
  }

  const originalTab = getActiveTabKey();
  const scrollPosition = {
    x: window.scrollX,
    y: window.scrollY
  };

  __tm.step();if(__tm.st.stop){__tm.finish('Остановлено');return;}
  const desiredLayout = [];
  const sectionReport = [];
  const scannedNames = new Set();

  try {
    for (const section of SECTION_KEYS) {
      await activateTab(section, scrollPosition);

      const scan = scanVisibleSection(
        stack,
        markerByName,
        fieldNames,
        sizeByName,
        section
      );

      for (const row of scan.rows) {
        const uniqueRow = row.filter(field => !scannedNames.has(field.name));

        if (!uniqueRow.length) continue;

        uniqueRow.forEach(field => scannedNames.add(field.name));
        desiredLayout.push(uniqueRow);
      }

      sectionReport.push({
        section,
        fields: scan.names.length,
        rows: scan.rows.length
      });
    }
  } finally {
    if (originalTab && SECTION_KEYS.includes(originalTab)) {
      await activateTab(originalTab, scrollPosition).catch(() => {});
    }

    window.scrollTo(scrollPosition.x, scrollPosition.y);
  }

  const missing = fieldNames.filter(name => !scannedNames.has(name));
  const unexpected = [...scannedNames].filter(name => !fieldSet.has(name));

  console.table(sectionReport);

  if (unexpected.length) {
    throw new Error(
      '[layout-sync] Найдены неизвестные поля: ' + unexpected.join(', ')
    );
  }

  if (missing.length) {
    console.warn('[layout-sync] Не удалось найти поля:', missing);
    throw new Error(
      '[layout-sync] Dry-run остановлен: не найдено ' +
      missing.length + ' полей из штатного layout'
    );
  }

  const desiredNames = getFieldNames(desiredLayout);

  if (
    desiredNames.length !== fieldNames.length ||
    new Set(desiredNames).size !== fieldNames.length
  ) {
    throw new Error(
      '[layout-sync] Dry-run остановлен: количество/уникальность полей не совпадает'
    );
  }

  const diff = compareLayouts(currentLayout, desiredLayout);

  printLayout('CURRENT layouts.edit', currentLayout);
  printLayout('DESIRED layouts.edit из текущего UI', desiredLayout);

  __tm.step();if(__tm.st.stop){__tm.finish('Остановлено');return;}
  if (!diff.length && sameLayout(currentLayout, desiredLayout)) {__tm.finish();
    console.log('[layout-sync] Layout уже синхронизирован. Запись не нужна.');
    return;
  }

  console.log(
    '[layout-sync] Dry-run: ' +
    currentLayout.length + ' → ' + desiredLayout.length +
    ' строк | перемещений: ' + diff.length
  );
  console.table(diff);

  const approved = window.confirm(
    'Layout sync\n\n' +
    'Штатных полей: ' + fieldNames.length + '\n' +
    'Строк сейчас: ' + currentLayout.length + '\n' +
    'Строк после: ' + desiredLayout.length + '\n' +
    'Изменят позицию: ' + diff.length + '\n\n' +
    'Размер каждого поля (size) сохраняется.\n' +
    'Записать новый layouts.edit в Configure the view?'
  );

  if (!approved || __tm.st.stop) {__tm.finish(__tm.st.stop?'Остановлено':'Отменено');
    console.log('[layout-sync] Отменено. Был выполнен только dry-run.');
    return;
  }

  const sanitizedMetadatas = sanitizeMetadatasForPut(configuration.metadatas);
  const forbiddenListMainFields = Object.entries(sanitizedMetadatas)
    .filter(([, metadata]) =>
      Object.prototype.hasOwnProperty.call(metadata?.list || {}, 'mainField')
    )
    .map(([name]) => name);

  if (forbiddenListMainFields.length) {
    throw new Error(
      '[layout-sync] Preflight: list.mainField не очищен у ' +
      forbiddenListMainFields.join(', ')
    );
  }

  const payload = {
    layouts: {
      ...configuration.layouts,
      edit: desiredLayout
    },
    settings: configuration.settings,
    metadatas: sanitizedMetadatas
  };

  console.log(
    '[layout-sync] PUT preflight OK | metadatas: ' +
    Object.keys(sanitizedMetadatas).length
  );
  console.log('[layout-sync] Записываю configuration...');
  await putConfiguration(payload);
  __tm.step();

  console.log('[layout-sync] Проверяю результат...');
  const verified = await getConfiguration('VERIFY configuration');

  if (!sameLayout(verified.layouts.edit, desiredLayout)) {
    console.error('[layout-sync] VERIFY failed', {
      expected: desiredLayout,
      actual: verified.layouts.edit
    });
    throw new Error(
      '[layout-sync] PUT прошёл, но GET verify вернул другой layouts.edit'
    );
  }

  __tm.step();__tm.finish();
  console.log(
    '[layout-sync] Готово: layouts.edit синхронизирован. Перезагрузи карточку Product.'
  );
})();
