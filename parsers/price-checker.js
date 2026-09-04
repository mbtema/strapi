// @version 1.0
// @description проверяет цены для всех торговых предложений, выявляет те у которых цена равна не целому числу

(async () => {
  const BASE_URL = 'http://10.10.3.80:1337/api/attributes';
  const PAGE_SIZE = 100;

  const invalidPrices = [];

  let page = 1;
  let pageCount = 1;
  let checked = 0;

  while (page <= pageCount) {
    const url =
      `${BASE_URL}?pagination[pageSize]=${PAGE_SIZE}` +
      `&pagination[page]=${page}` +
      `&fields[0]=price`;

    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Ошибка ${response.status} на странице ${page}`);
    }

    const json = await response.json();

    pageCount = json.meta.pagination.pageCount;

    for (const item of json.data) {
      checked++;

      const price = Number(item.price);

      if (
        item.price !== null &&
        item.price !== undefined &&
        !Number.isInteger(price)
      ) {
        invalidPrices.push({
          id: item.id,
          documentId: item.documentId,
          price: item.price
        });
      }
    }

    console.log(
      `Страница ${page}/${pageCount} | Проверено: ${checked} | Дробных: ${invalidPrices.length}`
    );

    page++;
  }

  console.log('Готово.');
  console.log(`Всего проверено: ${checked}`);
  console.log(`Найдено дробных price: ${invalidPrices.length}`);

  console.table(invalidPrices);

  window.invalidPrices = invalidPrices;
})();
