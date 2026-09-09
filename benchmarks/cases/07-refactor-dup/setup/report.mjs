const users = [
  { name: "Alice", score: 90 },
  { name: "Bob", score: 75 },
];

for (const u of users) {
  console.log(`| ${u.name.padEnd(10)} | ${String(u.score).padStart(4)} |`);
}
for (const u of users) {
  console.log(`| ${u.name.padEnd(10)} | ${String(u.score).padStart(4)} |`);
}
