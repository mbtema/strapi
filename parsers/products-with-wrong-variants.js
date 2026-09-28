
(async () => {
  'use strict';

  const PRODUCT_UID = 'api::product.product';
  const ATTRIBUTE_UID = 'api::attribute.attribute';
  const HEADERS = [
    'id',
    'documentId',
    'name',
    'key',
    'attributeCount',
    'variantMode',
    'issues',
    'shadeOnlyCount',
    'volumeOnlyCount',
    'emptyCount',
    'bothCount',
    'variantValues'
  ];
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

async function hasRelation(uid, documentId, field) {
  const params = new URLSearchParams({
    locale: LOCALE,
    page: '1',
    pageSize: '1'
  });

  const json = await getJson(
    `/content-manager/relations/${uid}/${encodeURIComponent(documentId)}/${field}?${params}`,
    `${documentId} relation ${field}`
  );

  return getRows(json).length > 0;
}

const timestamp = () => {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};

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


  const relationKey = relation =>
    relation?.documentId ?? relation?.id ?? null;

  async function loadVariant(attribute) {
    const documentId = attribute?.documentId;
    if (!documentId) {
      throw new Error('Product attributes relation вернул запись без documentId');
    }

    const detail = await getDetail(
      ATTRIBUTE_UID,
      documentId,
      'Attribute'
    );

    const [shadeItems, volumeItems] = await Promise.all([
      getRelation(ATTRIBUTE_UID, documentId, 'shade', 1),
      getRelation(ATTRIBUTE_UID, documentId, 'volume', 1)
    ]);

    const shade = shadeItems[0] ?? null;
    const volume = volumeItems[0] ?? null;

    return {
      documentId,
      barcode: detail?.barcode ?? attribute.barcode ?? '',
      shade,
      volume,
      hasShade: Boolean(shade),
      hasVolume: Boolean(volume)
    };
  }

  const products = await listAll(PRODUCT_UID, 'products-with-wrong-variants');
  let checkedProducts = 0;
  let activeProducts = 0;
  let multiOfferProducts = 0;

  await mapLimit(products, 4, async item => {
    const detail = await getDetail(PRODUCT_UID, item.documentId, 'Product');

    if (typeof detail?.active !== 'boolean') {
      throw new Error(
        `Product ${item.documentId}: Content Manager detail не содержит active`
      );
    }

    if (detail.active !== true) {
      checkedProducts++;
      return;
    }

    activeProducts++;

    const attributes = await getRelation(
      PRODUCT_UID,
      item.documentId,
      'attributes'
    );

    if (attributes.length <= 1) {
      checkedProducts++;
      return;
    }

    multiOfferProducts++;

    const variants = [];
    await mapLimit(attributes, 3, async attribute => {
      variants.push(await loadVariant(attribute));
    });

    const shadeOnly = variants.filter(v => v.hasShade && !v.hasVolume);
    const volumeOnly = variants.filter(v => !v.hasShade && v.hasVolume);
    const empty = variants.filter(v => !v.hasShade && !v.hasVolume);
    const both = variants.filter(v => v.hasShade && v.hasVolume);

    const allShade = shadeOnly.length === variants.length;
    const allVolume = volumeOnly.length === variants.length;
    const issues = [];
    let variantMode = 'mixed';

    if (allShade) {
      variantMode = 'shade';
    } else if (allVolume) {
      variantMode = 'volume';
    } else if (empty.length === variants.length) {
      variantMode = 'none';
      issues.push('no_variant_relations');
    } else {
      if (empty.length) issues.push('missing_variant_relation');
      if (both.length) issues.push('shade_and_volume');
      if (shadeOnly.length && volumeOnly.length) {
        issues.push('mixed_variant_type');
      }
    }

    if (issues.length) {
      const variantValues = variants.map(v => {
        const barcode = v.barcode || `[${v.documentId}]`;
        const parts = [];
        if (v.shade) {
          parts.push(`shade=${v.shade.name ?? relationKey(v.shade) ?? ''}`);
        }
        if (v.volume) {
          parts.push(`volume=${v.volume.name ?? relationKey(v.volume) ?? ''}`);
        }
        return `${barcode}:${parts.length ? parts.join('|') : 'none'}`;
      }).join(', ');

      rows.push({
        id: detail.id ?? item.id ?? '',
        documentId: item.documentId,
        name: detail.name ?? item.name ?? '',
        key: detail.key ?? item.key ?? '',
        attributeCount: variants.length,
        variantMode,
        issues: [...new Set(issues)].join(', '),
        shadeOnlyCount: shadeOnly.length,
        volumeOnlyCount: volumeOnly.length,
        emptyCount: empty.length,
        bothCount: both.length,
        variantValues
      });
    }

    checkedProducts++;
    if (
      checkedProducts % 100 === 0 ||
      checkedProducts === products.length
    ) {
      console.log(
        `[products-with-wrong-variants] checked ${checkedProducts}/${products.length} | ` +
        `active ${activeProducts} | multi-offer ${multiOfferProducts} | problems ${rows.length}`
      );
    }
  });

  rows.sort((a, b) => String(a.documentId).localeCompare(String(b.documentId)));
  console.table(rows);
  console.log(
    `Готово: в CMS проверено active multi-offer products ${multiOfferProducts} | проблемных ${rows.length}`
  );

  window.productsWithWrongVariants = rows;
  downloadCSV(rows, HEADERS, `products_with_wrong_variants_${timestamp()}.csv`);
})();
