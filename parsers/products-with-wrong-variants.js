// ==ConsoleParser==
// @name         products-with-wrong-variants
// @version      1.0.0
// @description  Ищет активные товары с несколькими предложениями, которые нельзя однозначно выбрать по shade или volume
// @output       CSV
// ==/ConsoleParser==

(async () => {
  'use strict';

  const BASE_URL = '/api/products';
  const PAGE_SIZE = 100;
  const HEADERS = [
    'id',
    'documentId',
    'name',
    'key',
    'attributesCount',
    'variantMode',
    'issues',
    'shadeOnlyCount',
    'volumeOnlyCount',
    'emptyCount',
    'bothCount',
    'uniqueShadeCount',
    'uniqueVolumeCount',
    'variantValues'
  ];
  const rows = [];

  const timestamp = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  };

  const getItems = relation => Array.isArray(relation)
    ? relation
    : Array.isArray(relation?.data)
      ? relation.data
      : [];

  const getRelation = relation => Array.isArray(relation)
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
    'filters[active][$eq]': 'true',
    'fields[0]': 'name',
    'fields[1]': 'key',
    'populate[attributes][fields][0]': 'documentId',
    'populate[attributes][fields][1]': 'barcode',
    'populate[attributes][populate][shade][fields][0]': 'documentId',
    'populate[attributes][populate][shade][fields][1]': 'name',
    'populate[attributes][populate][volume][fields][0]': 'documentId',
    'populate[attributes][populate][volume][fields][1]': 'name'
  });

  let page = 1;
  let pageCount = 1;
  let checkedProducts = 0;
  let multiOfferProducts = 0;

  while (page <= pageCount) {
    params.set('pagination[page]', String(page));
    const response = await fetch(`${BASE_URL}?${params}`);
    if (!response.ok) throw new Error(`Ошибка ${response.status} на странице ${page}`);

    const { data, meta } = await response.json();
    pageCount = meta.pagination.pageCount;
    checkedProducts += data.length;

    for (const item of data) {
      const attributes = getItems(item.attributes);
      if (attributes.length <= 1) continue;
      multiOfferProducts++;

      const variants = attributes.map(attribute => {
        const shade = getRelation(attribute.shade);
        const volume = getRelation(attribute.volume);
        return {
          barcode: attribute.barcode ?? attribute.documentId ?? '',
          shade,
          volume,
          hasShade: Boolean(shade),
          hasVolume: Boolean(volume)
        };
      });

      const shadeOnly = variants.filter(v => v.hasShade && !v.hasVolume);
      const volumeOnly = variants.filter(v => !v.hasShade && v.hasVolume);
      const empty = variants.filter(v => !v.hasShade && !v.hasVolume);
      const both = variants.filter(v => v.hasShade && v.hasVolume);

      const shadeKeys = shadeOnly.map(v => relationKey(v.shade)).filter(Boolean);
      const volumeKeys = volumeOnly.map(v => relationKey(v.volume)).filter(Boolean);
      const uniqueShadeCount = new Set(shadeKeys).size;
      const uniqueVolumeCount = new Set(volumeKeys).size;

      const allShade = shadeOnly.length === variants.length;
      const allVolume = volumeOnly.length === variants.length;
      const issues = [];
      let variantMode = 'mixed';

      if (allShade) {
        variantMode = 'shade';
        if (uniqueShadeCount !== variants.length) issues.push('duplicate_shade');
      } else if (allVolume) {
        variantMode = 'volume';
        if (uniqueVolumeCount !== variants.length) issues.push('duplicate_volume');
      } else {
        if (empty.length === variants.length) {
          variantMode = 'none';
          issues.push('no_variant_relations');
        } else {
          if (empty.length) issues.push('missing_variant_relation');
          if (both.length) issues.push('shade_and_volume');
          if (shadeOnly.length && volumeOnly.length) issues.push('mixed_variant_type');
        }
      }

      if (!issues.length) continue;

      const variantValues = variants.map(v => {
        const shadeName = v.shade?.name ?? relationKey(v.shade) ?? '';
        const volumeName = v.volume?.name ?? relationKey(v.volume) ?? '';
        const value = v.hasShade && v.hasVolume
          ? `shade=${shadeName}|volume=${volumeName}`
          : v.hasShade
            ? `shade=${shadeName}`
            : v.hasVolume
              ? `volume=${volumeName}`
              : 'none';
        return `${v.barcode}:${value}`;
      }).join(', ');

      rows.push({
        id: item.id,
        documentId: item.documentId,
        name: item.name ?? '',
        key: item.key ?? '',
        attributesCount: variants.length,
        variantMode,
        issues: issues.join(', '),
        shadeOnlyCount: shadeOnly.length,
        volumeOnlyCount: volumeOnly.length,
        emptyCount: empty.length,
        bothCount: both.length,
        uniqueShadeCount,
        uniqueVolumeCount,
        variantValues
      });
    }

    if (page === 1 || page % 25 === 0 || page === pageCount) {
      console.log(`Страница ${page}/${pageCount} | Проверено товаров: ${checkedProducts} | С несколькими предложениями: ${multiOfferProducts} | Проблемных: ${rows.length}`);
    }
    page++;
  }

  console.table(rows);
  console.log(`Готово: проблемных активных товаров с несколькими предложениями: ${rows.length}`);
  window.productsWithWrongVariants = rows;
  downloadCSV(rows, `products_with_wrong_variants_${timestamp()}.csv`);
})();
