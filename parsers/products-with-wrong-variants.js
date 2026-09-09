// ==ConsoleParser==
// @name         products-with-wrong-variants
// @version      1.0.1
// @description  Ищет активные товары с несколькими предложениями, которые нельзя однозначно выбрать по shade или volume
// @output       CSV
// ==/ConsoleParser==

(async () => {
  'use strict';

  const BASE_URL = '/api/attributes';
  const PAGE_SIZE = 100;
  const HEADERS = [
    'id',
    'documentId',
    'name',
    'key',
    'attributeCount',
    'variantMode',
    'issues',
    'colorVariantCount',
    'shadeOnlyCount',
    'volumeOnlyCount',
    'emptyCount',
    'bothCount',
    'uniqueShadeCount',
    'uniqueVolumeCount',
    'variantValues'
  ];
  const products = new Map();

  const timestamp = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  };

  const relationOne = relation => Array.isArray(relation)
    ? relation[0] ?? null
    : Array.isArray(relation?.data)
      ? relation.data[0] ?? null
      : relation?.data ?? relation ?? null;

  const relationKey = relation => relation?.documentId ?? relation?.id ?? null;

  const downloadCSV = (items, filename) => {
    const q = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [HEADERS.join(';'), ...items.map(row => HEADERS.map(key => q(row[key])).join(';'))].join('\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const params = new URLSearchParams({
    'pagination[pageSize]': String(PAGE_SIZE),
    'sort[0]': 'id:asc',
    'filters[product][active][$eq]': 'true',
    'fields[0]': 'barcode',
    'populate[product][fields][0]': 'documentId',
    'populate[product][fields][1]': 'name',
    'populate[product][fields][2]': 'key',
    'populate[shade][fields][0]': 'documentId',
    'populate[shade][fields][1]': 'name',
    'populate[volume][fields][0]': 'documentId',
    'populate[volume][fields][1]': 'name',
    'populate[color_variant1C][fields][0]': 'documentId'
  });

  let page = 1;
  let pageCount = 1;
  let total = 0;
  let checked = 0;

  while (page <= pageCount) {
    params.set('pagination[page]', String(page));
    const response = await fetch(`${BASE_URL}?${params}`);
    if (!response.ok) throw new Error(`Ошибка ${response.status} на странице ${page}`);

    const { data, meta } = await response.json();
    pageCount = meta.pagination.pageCount;
    total = meta.pagination.total;

    for (const attribute of data) {
      checked++;
      const product = relationOne(attribute.product);
      if (!product?.documentId) continue;

      let row = products.get(product.documentId);
      if (!row) {
        row = {
          id: product.id ?? '',
          documentId: product.documentId,
          name: product.name ?? '',
          key: product.key ?? '',
          variants: []
        };
        products.set(product.documentId, row);
      }

      const shade = relationOne(attribute.shade);
      const volume = relationOne(attribute.volume);
      const colorVariant = relationOne(attribute.color_variant1C);

      row.variants.push({
        documentId: attribute.documentId ?? '',
        barcode: attribute.barcode ?? '',
        shade,
        volume,
        colorVariant,
        hasShade: Boolean(shade),
        hasVolume: Boolean(volume),
        hasColorVariant: Boolean(colorVariant)
      });
    }

    if (page === 1 || page % 25 === 0 || page === pageCount) {
      console.log(`Страница ${page}/${pageCount} | Проверено предложений: ${checked}/${total} | Товаров: ${products.size}`);
    }
    page++;
  }

  const rows = [];
  let multiOfferProducts = 0;

  for (const product of products.values()) {
    const variants = product.variants;
    if (variants.length <= 1) continue;
    multiOfferProducts++;

    const shadeOnly = variants.filter(v => v.hasShade && !v.hasVolume);
    const volumeOnly = variants.filter(v => !v.hasShade && v.hasVolume);
    const empty = variants.filter(v => !v.hasShade && !v.hasVolume);
    const both = variants.filter(v => v.hasShade && v.hasVolume);
    const colorVariantCount = variants.filter(v => v.hasColorVariant).length;

    const shadeKeys = variants.map(v => relationKey(v.shade)).filter(Boolean);
    const volumeKeys = variants.map(v => relationKey(v.volume)).filter(Boolean);
    const uniqueShadeCount = new Set(shadeKeys).size;
    const uniqueVolumeCount = new Set(volumeKeys).size;

    const allShade = shadeOnly.length === variants.length;
    const allVolume = volumeOnly.length === variants.length;
    const issues = [];
    let variantMode = 'mixed';

    if (colorVariantCount > 0) {
      variantMode = 'shade';

      if (variants.some(v => !v.hasShade)) {
        issues.push('missing_shade_for_color_variant');
      }
      if (variants.some(v => v.hasVolume)) {
        issues.push('volume_on_shade_product');
      }
      if (both.length) {
        issues.push('shade_and_volume');
      }
      if (variants.every(v => v.hasShade) && uniqueShadeCount !== variants.length) {
        issues.push('duplicate_shade');
      }
    } else if (allShade) {
      variantMode = 'shade';
      if (uniqueShadeCount !== variants.length) issues.push('duplicate_shade');
    } else if (allVolume) {
      variantMode = 'volume';
      if (uniqueVolumeCount !== variants.length) issues.push('duplicate_volume');
    } else if (empty.length === variants.length) {
      variantMode = 'none';
      issues.push('no_variant_relations');
    } else {
      if (empty.length) issues.push('missing_variant_relation');
      if (both.length) issues.push('shade_and_volume');
      if (shadeOnly.length && volumeOnly.length) issues.push('mixed_variant_type');
    }

    if (!issues.length) continue;

    const variantValues = variants.map(v => {
      const barcode = v.barcode || `[${v.documentId}]`;
      const parts = [];
      if (v.shade) parts.push(`shade=${v.shade.name ?? relationKey(v.shade) ?? ''}`);
      if (v.volume) parts.push(`volume=${v.volume.name ?? relationKey(v.volume) ?? ''}`);
      if (v.colorVariant) parts.push('color1C=yes');
      return `${barcode}:${parts.length ? parts.join('|') : 'none'}`;
    }).join(', ');

    rows.push({
      id: product.id,
      documentId: product.documentId,
      name: product.name,
      key: product.key,
      attributeCount: variants.length,
      variantMode,
      issues: [...new Set(issues)].join(', '),
      colorVariantCount,
      shadeOnlyCount: shadeOnly.length,
      volumeOnlyCount: volumeOnly.length,
      emptyCount: empty.length,
      bothCount: both.length,
      uniqueShadeCount,
      uniqueVolumeCount,
      variantValues
    });
  }

  console.table(rows);
  console.log(`Готово: проверено активных товаров с несколькими предложениями: ${multiOfferProducts} | Проблемных: ${rows.length}`);
  window.productsWithWrongVariants = rows;
  downloadCSV(rows, `products_with_wrong_variants_${timestamp()}.csv`);
})();
