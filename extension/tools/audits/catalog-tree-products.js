(async () => {
  'use strict';
  const __tm=(()=>{
    const box=document.createElement('div');
    Object.assign(box.style,{position:'fixed',right:'24px',bottom:'24px',width:'370px',padding:'18px',background:'#171923',color:'#fff',border:'1px solid #4945ff',borderRadius:'12px',boxShadow:'0 8px 35px #0008',font:'13px system-ui,sans-serif',zIndex:'2147483647'});
    box.innerHTML='<div style="display:flex;justify-content:space-between"><b>catalog-tree-products.js</b><button data-stop style="background:#4945ff;color:#fff;border:0;border-radius:5px;padding:6px 10px;cursor:pointer">Стоп</button></div><div data-phase style="margin-top:14px">Подготовка</div><div style="height:10px;background:#363846;border-radius:8px;margin-top:9px;overflow:hidden"><div data-bar style="background:#7b79ff;width:0%;height:100%;transition:width .2s"></div></div><div data-progress style="margin-top:8px">0 / ?</div><div data-speed style="margin-top:8px;color:#b8bacb">—</div><div data-metrics style="margin-top:5px;color:#b8bacb">—</div><div data-eta style="margin-top:5px;color:#b8bacb">—</div>';
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


  const CATEGORY_UID = 'api::category.category';
  const LOCALE = 'ru';
  const PAGE_SIZE = 100;
  const FILE_NAME = 'catalog-tree-products.csv';

  const rootDocumentId = decodeURIComponent(
    location.pathname.match(
      /\/collection-types\/api::category\.category\/([^/?#]+)/
    )?.[1] || ''
  );

  if (!rootDocumentId) {
    throw new Error('Открой карточку корневой категории');
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
    throw new Error('Не найден jwtToken в LocalStorage');
  }

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${adminToken}`
  };

  const getRows = json => {
    if (Array.isArray(json?.results)) return json.results;
    if (Array.isArray(json?.data?.results)) return json.data.results;
    if (Array.isArray(json?.data)) return json.data;
    return null;
  };

  const getPagination = json =>
    json?.pagination ??
    json?.meta?.pagination ??
    json?.data?.pagination ??
    json?.data?.meta?.pagination ??
    null;

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

  async function getAllRelation(categoryDocumentId, field) {
    const all = [];
    let page = 1;

    while (true) {
      const params = new URLSearchParams({
        locale: LOCALE,
        page: String(page),
        pageSize: String(PAGE_SIZE)
      });

      const json = await getJson(
        `/content-manager/relations/${CATEGORY_UID}/${encodeURIComponent(categoryDocumentId)}/${field}?${params}`,
        `${categoryDocumentId} relation ${field} page ${page}`
      );

      const items = getRows(json);

      if (!Array.isArray(items)) {
        throw new Error(
          `${categoryDocumentId} relation ${field}: неожиданный ответ API`
        );
      }

      all.push(...items);

      const pagination = getPagination(json);
      const pageCount = Number(pagination?.pageCount);

      if (Number.isFinite(pageCount) && pageCount > 0) {
        if (page >= pageCount) break;
      } else if (items.length < PAGE_SIZE) {
        break;
      }

      if (!items.length) {
        throw new Error(
          `${categoryDocumentId} relation ${field}: пустая страница ${page} до конца pagination`
        );
      }

      page++;
    }

    return all;
  }

  const queue = [rootDocumentId];
  const visitedCategories = new Set();
  const productDocumentIds = new Set();

  __tm.phase('Обход дерева категорий');
  while (queue.length && !__tm.st.stop) {
    const categoryDocumentId = queue.shift();

    if (visitedCategories.has(categoryDocumentId)) {
      continue;
    }

    visitedCategories.add(categoryDocumentId);
    __tm.st.total=visitedCategories.size+queue.length;__tm.step();

    const [children, products] = await Promise.all([
      getAllRelation(categoryDocumentId, 'categories'),
      getAllRelation(categoryDocumentId, 'product')
    ]);

    for (const product of products) {
      if (!product?.documentId) {
        throw new Error(
          `Категория ${categoryDocumentId}: relation product вернул запись без documentId`
        );
      }

      productDocumentIds.add(product.documentId);
    }

    for (const child of children) {
      if (!child?.documentId) {
        throw new Error(
          `Категория ${categoryDocumentId}: relation categories вернул запись без documentId`
        );
      }

      if (!visitedCategories.has(child.documentId)) {
        queue.push(child.documentId);
      }
    }

    console.log(
      `[catalog-tree-products] categories ${visitedCategories.size} | queue ${queue.length} | products ${productDocumentIds.size}`
    );
  }

  if(__tm.st.stop){__tm.finish('Остановлено');return;}
  __tm.finish();
  const csv = [
    'documentId',
    ...[...productDocumentIds].sort()
  ].join('\r\n');

  const url = URL.createObjectURL(
    new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  );

  const link = Object.assign(document.createElement('a'), {
    href: url,
    download: FILE_NAME
  });

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);

  console.log(
    `[catalog-tree-products] Готово: категорий ${visitedCategories.size} | уникальных товаров ${productDocumentIds.size}`
  );
})();
