import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parseZecbit, zecbitItem } from "./index.mjs";

/** Fetch public HTML and artwork with the bounded Python collector. Node.js only. */
export async function fetchNft(value) {
  const { sourceUrl } = zecbitItem(value);
  const python = process.env.ZECBIT_PYTHON || fileURLToPath(new URL("../.venv/bin/python", import.meta.url));
  let stdout;
  try {
    ({ stdout } = await promisify(execFile)(python, [fileURLToPath(new URL("../collector/cli.py", import.meta.url)), sourceUrl], {
      encoding: "utf8", maxBuffer: 16_000_000, timeout: 25_000,
    }));
  } catch (error) {
    const code = error.stderr?.trim();
    if (/^(source_(blocked|unavailable|timeout|too_large)|invalid_(source|image|url)|not_found)$/.test(code)) throw new Error(code);
    if (error.code === "ENOENT") throw new Error("Install the Python collector dependencies or set ZECBIT_PYTHON.");
    throw new Error("Collector failed or exceeded its resource limit.");
  }
  const data = JSON.parse(stdout);
  if (data.sourceUrl !== sourceUrl || !Number.isFinite(Date.parse(data.fetchedAt))) throw new Error("Invalid collector response.");
  return { ...parseZecbit(data.html, sourceUrl), fetchedAt: data.fetchedAt };
}
