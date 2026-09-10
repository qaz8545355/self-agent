export function parseRow(line) {
  const [name, amount] = line.split(",");
  return { name, amount };
}

export function parseRows(text) {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(parseRow);
}
