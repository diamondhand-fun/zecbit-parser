import { parseArgs } from "node:util";
import { fetchNft } from "./fetch.mjs";

const usage = "Usage: npm run --silent fetch -- [--timeout MS] [--include-image] <zecbit-item-url>";
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    "include-image": { type: "boolean", default: false },
    help: { type: "boolean", short: "h" }, timeout: { type: "string", default: "25000" },
  } });
  if (values.help) console.log(usage);
  else {
    if (positionals.length !== 1) throw new Error(usage);
    if (!/^[1-9][0-9]*$/.test(values.timeout)) throw new Error("Timeout must be a positive integer.");
    console.log(JSON.stringify(await fetchNft(positionals[0], { timeoutMs: Number(values.timeout), includeImage: values["include-image"] }), null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
