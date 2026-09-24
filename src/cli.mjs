import { parseZecbit, MAX_HTML_BYTES, zecbitItem } from "./index.mjs";

try {
  if (process.argv.length !== 3) throw new Error("Usage: npm run --silent parse -- <source-url> < item.html");
  const source = zecbitItem(process.argv[2]).sourceUrl;
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_HTML_BYTES) throw new Error("HTML exceeds 2 MB.");
    chunks.push(chunk);
  }
  console.log(JSON.stringify(parseZecbit(Buffer.concat(chunks).toString("utf8"), source), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
