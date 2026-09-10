function paginate(items, page, perPage) {
  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError("page must be a positive integer");
  }
  const totalPages = Math.ceil(items.length / perPage);
  const start = (page - 1) * perPage;
  return { items: items.slice(start, start + perPage), totalPages };
}

export function listUsers(users, page, perPage) {
  return paginate(users, page, perPage);
}
