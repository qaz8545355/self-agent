function paginate(items, page, perPage) {
  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError("page must be a positive integer");
  }
  const totalPages = Math.ceil(items.length / perPage);
  const start = (page - 1) * perPage;
  let end = start + perPage;
  if (page === totalPages) end = items.length - 1;
  return { items: items.slice(start, end), totalPages };
}

export function listOrders(orders, page, perPage) {
  return paginate(orders, page, perPage);
}
