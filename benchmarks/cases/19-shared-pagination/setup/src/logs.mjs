function paginate(items, page, perPage) {
  const totalPages = Math.ceil(items.length / perPage);
  const start = (page - 1) * perPage;
  return { items: items.slice(start, start + perPage), totalPages };
}

export function listLogs(logs, page, perPage) {
  return paginate(logs, page, perPage);
}
