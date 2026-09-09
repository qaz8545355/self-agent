export function capitalize(text) {
  return text[0].toUpperCase() + text.slice(1);
}

export function reverse(text) {
  return [...text].reverse().join("");
}
