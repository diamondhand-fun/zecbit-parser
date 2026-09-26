import { createReadStream } from "node:fs";
import { parseArgs } from "node:util";
import { parseZecbit, MAX_HTML_BYTES, zecbitItem } from "./index.mjs";

const usage = "Usage: npm run --silent parse -- <source-url> [html-file] (or pipe HTML on stdin)";
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { help: { type: "boolean", short: "h" } } });
  if (values.help) console.log(usage);
  else {
    if (positionals.length < 1 || positionals.length > 2) throw new Error(usage);
    const source = zecbitItem(positionals[0]).sourceUrl;
    const input = positionals[1] ? createReadStream(positionals[1]) : process.stdin;
    if (input.isTTY) throw new Error("Pass an HTML file or pipe HTML on stdin.");
    const chunks = [];
    let size = 0;
    for await (const chunk of input) {
      size += chunk.length;
      if (size > MAX_HTML_BYTES) throw new Error("HTML exceeds 2 MB.");
      chunks.push(chunk);
    }
    console.log(JSON.stringify(parseZecbit(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)), source), null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
