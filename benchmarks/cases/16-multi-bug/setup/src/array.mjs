export function unique(list) {
  return list.filter((item, index) => list.indexOf(item) === index);
}

export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size - 1) {
    out.push(list.slice(i, i + size));
  }
  return out;
}
