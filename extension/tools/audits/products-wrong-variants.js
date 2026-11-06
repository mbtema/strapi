(async () => {
  'use strict';
  const __tm=(()=>{
    const box=document.createElement('div');
    Object.assign(box.style,{position:'fixed',right:'24px',bottom:'24px',width:'370px',padding:'18px',background:'#171923',color:'#fff',border:'1px solid #4945ff',borderRadius:'12px',boxShadow:'0 8px 35px #0008',font:'13px system-ui,sans-serif',zIndex:'2147483647'});
    box.innerHTML='<div style="display:flex;justify-content:space-between"><b>products-wrong-variants.js</b><button data-stop style="background:#4945ff;color:#fff;border:0;border-radius:5px;padding:6px 10px;cursor:pointer">Стоп</button></div><div data-phase style="margin-top:14px">Подготовка</div><div style="height:10px;background:#363846;border-radius:8px;margin-top:9px;overflow:hidden"><div data-bar style="background:#7b79ff;width:0%;height:100%;transition:width .2s"></div></div><div data-progress style="margin-top:8px">0 / ?</div><div data-speed style="margin-top:8px;color:#b8bacb">—</div><div data-metrics style="margin-top:5px;color:#b8bacb">—</div><div data-eta style="margin-top:5px;color:#b8bacb">—</div>';
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
  const ATTRIBUTE_UID = 'api::attribute.attribute';
  const HEADERS = ['documentId', 'errorType'];
  const rows = [];

  const LOCALE = 'ru';
  const PAGE_SIZE = 100;

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
  if (!adminToken) throw new Error('Не найден jwtToken в LocalStorage');

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${adminToken}`
  };

  const getRows = json => Array.isArray(json?.results)
    ? json.results
    : Array.isArray(json?.data)
      ? json.data
      : [];

  const getPagination = json => json?.pagination ?? json?.meta?.pagination ?? null;

  async function getJson(url, label) {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `${label}: HTTP ${response.status}${body ? ` — ${body.slice(0, 250)}` : ''}`
      );
    }

    return response.json();
  }

  async function listAll(uid, label) {
    const result = [];
    const seen = new Set();
    let page = 1;
    let pageCount = 1;

    while (page <= pageCount) {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        sort: 'id:ASC',
        locale: LOCALE
      });

      const json = await getJson(
        `/content-manager/collection-types/${uid}?${params}`,
        `${label} page ${page}`
      );

      const items = getRows(json);
      const pagination = getPagination(json);
      pageCount = Number(pagination?.pageCount || pageCount);

      for (const item of items) {
        if (!item?.documentId || seen.has(item.documentId)) continue;
        seen.add(item.documentId);
        result.push(item);
      }

      console.log(
        `[${label}] CMS list ${page}/${pageCount} | loaded ${result.length}` +
        (pagination?.total ? `/${pagination.total}` : '')
      );

      if (!items.length) break;
      page++;
    }

    return result;
  }

  async function getDetail(uid, documentId, label) {
    const params = new URLSearchParams({ locale: LOCALE });
    const json = await getJson(
      `/content-manager/collection-types/${uid}/${encodeURIComponent(documentId)}?${params}`,
      `${label} ${documentId}`
    );
    return json?.data ?? json;
  }

  async function getRelation(uid, documentId, field, pageSize = 100) {
    const all = [];
    let page = 1;
    let pageCount = 1;

    while (page <= pageCount) {
      const params = new URLSearchParams({
        locale: LOCALE,
        page: String(page),
        pageSize: String(pageSize)
      });

      const json = await getJson(
        `/content-manager/relations/${uid}/${encodeURIComponent(documentId)}/${field}?${params}`,
        `${documentId} relation ${field} page ${page}`
      );

      const items = getRows(json);
      const pagination = getPagination(json);
      pageCount = Number(pagination?.pageCount || pageCount);
      all.push(...items);

      if (!items.length) break;
      page++;
    }

    return all;
  }

  async function mapLimit(items, limit, worker) {
    let nextIndex = 0;
    if(limit===6){
    __tm.phase('Проверка товаров',items.length);
    let cursor=0,concurrency=6,best=6,bestRate=0,misses=0;
    while(cursor<items.length&&!__tm.st.stop){
      const batch=items.slice(cursor,cursor+concurrency),start=performance.now();
      const outcomes=await Promise.allSettled(batch.map((item,i)=>worker(item,cursor+i)));
      const error=outcomes.find(x=>x.status==='rejected');
      if(error){__tm.st.failed++;__tm.render();throw error.reason;}
      cursor+=batch.length;__tm.step(batch.length);
      const rate=batch.length/Math.max(.001,(performance.now()-start)/1000);
      if(rate>bestRate*1.03){bestRate=rate;best=concurrency;misses=0;}else misses++;
      if(misses>=2){concurrency=best;misses=0;}else concurrency=Math.min(40,concurrency+5);
      __tm.perf(concurrency,best);
    }
    if(__tm.st.stop){__tm.finish('Остановлено');throw new Error('Остановлено пользователем');}
    __tm.finish();return;
  }
  const runnerCount = Math.min(limit, items.length);

    const runners = Array.from({ length: runnerCount }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) return;
        await worker(items[index], index);
      }
    });

    await Promise.all(runners);
  }

  const downloadCSV = (items, headersList, filename) => {
    const q = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [
      headersList.join(';'),
      ...items.map(row => headersList.map(key => q(row[key])).join(';'))
    ].join('\n');

    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    );
    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: filename
    });

    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  async function loadVariant(attribute) {
    const documentId = attribute?.documentId;
    if (!documentId) {
      throw new Error('Product attributes relation вернул запись без documentId');
    }

    const [shadeItems, volumeItems] = await Promise.all([
      getRelation(ATTRIBUTE_UID, documentId, 'shade', 1),
      getRelation(ATTRIBUTE_UID, documentId, 'volume', 1)
    ]);

    return {
      hasShade: shadeItems.length > 0,
      hasVolume: volumeItems.length > 0
    };
  }

  const products = await listAll(PRODUCT_UID, 'products-wrong-variants');
  let checkedProducts = 0;
  let activeProducts = 0;

  const logProgress = () => {
    if (checkedProducts % 100 === 0 || checkedProducts === products.length) {
      console.log(
        `[products-wrong-variants] checked ${checkedProducts}/${products.length} | ` +
        `active ${activeProducts} | problems ${rows.length}`
      );
    }
  };

  await mapLimit(products, 6, async item => {
    const detail = await getDetail(PRODUCT_UID, item.documentId, 'Product');

    if (typeof detail?.active !== 'boolean') {
      throw new Error(
        `Product ${item.documentId}: Content Manager detail не содержит active`
      );
    }

    if (detail.active !== true) {
      checkedProducts++;
      logProgress();
      return;
    }

    activeProducts++;

    const attributes = await getRelation(
      PRODUCT_UID,
      item.documentId,
      'attributes'
    );

    if (!attributes.length) {
      checkedProducts++;
      logProgress();
      return;
    }

    const variants = [];
    await mapLimit(attributes, 3, async attribute => {
      variants.push(await loadVariant(attribute));
    });

    const shadeOnlyCount = variants.filter(v => v.hasShade && !v.hasVolume).length;
    const volumeOnlyCount = variants.filter(v => !v.hasShade && v.hasVolume).length;
    const emptyCount = variants.filter(v => !v.hasShade && !v.hasVolume).length;
    const bothCount = variants.filter(v => v.hasShade && v.hasVolume).length;

    const issues = [];

    if (bothCount) {
      issues.push('shade-volume');
    }

    if (variants.length > 1) {
      if (emptyCount === variants.length) {
        issues.push('no-variant');
      } else {
        if (emptyCount) issues.push('missing');
        if (shadeOnlyCount && volumeOnlyCount) issues.push('mixed');
      }
    }

    if (issues.length) {
      rows.push({
        documentId: item.documentId,
        errorType: [...new Set(issues)].join(', ')
      });
    }

    checkedProducts++;
    logProgress();
  });

  rows.sort((a, b) => String(a.documentId).localeCompare(String(b.documentId)));

  if (!rows.length) {
    console.log('Готово: проблем с вариантами у active products не найдено');
    return;
  }

  console.table(rows);
  console.log(
    `Готово: проверено active products ${activeProducts} | проблемных ${rows.length}`
  );

  window.productsWrongVariants = rows;
  downloadCSV(rows, HEADERS, 'products-wrong-variants.csv');
})();
