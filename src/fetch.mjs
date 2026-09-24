import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parseZecbit, zecbitItem } from "./index.mjs";

/** Fetch public HTML and artwork with the bounded Python collector. Node.js only. */
export async function fetchNft(value, { signal, timeoutMs = 25_000, includeImage = false } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 25_000) throw new Error("Collector timeout must be between 1 and 25000 milliseconds.");
  if (typeof includeImage !== "boolean") throw new Error("includeImage must be a boolean.");
  const { sourceUrl } = zecbitItem(value);
  signal?.throwIfAborted();
  const python = process.env.ZECBIT_PYTHON || fileURLToPath(new URL("../.venv/bin/python", import.meta.url));
  let stdout;
  try {
    ({ stdout } = await promisify(execFile)(python, [fileURLToPath(new URL("../collector/cli.py", import.meta.url)), sourceUrl], {
      encoding: "utf8", maxBuffer: 16_000_000, timeout: timeoutMs, signal,
    }));
  } catch (error) {
    signal?.throwIfAborted();
    if (error.killed && error.signal === "SIGTERM") throw new Error("source_timeout");
    const code = error.stderr?.trim();
    if (/^(source_(blocked|unavailable|timeout|too_large)|invalid_(source|image|url)|not_found)$/.test(code)) throw new Error(code);
    if (error.code === "ENOENT") throw new Error("Install the Python collector dependencies or set ZECBIT_PYTHON.");
    throw new Error("Collector failed or exceeded its resource limit.");
  }
  let data;
  try { data = JSON.parse(stdout); } catch { throw new Error("Invalid collector response."); }
  if (!data || data.sourceUrl !== sourceUrl || typeof data.html !== "string" || typeof data.fetchedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(data.fetchedAt) || !Number.isFinite(Date.parse(data.fetchedAt))) throw new Error("Invalid collector response.");
  const item = { ...parseZecbit(data.html, sourceUrl), fetchedAt: data.fetchedAt };
  if (!includeImage) return item;
  if (data.imageType !== "image/png" || typeof data.image !== "string" || data.image.length > 1_333_336) throw new Error("Invalid collector image.");
  const bytes = Buffer.from(data.image, "base64");
  if (bytes.length > 1_000_000 || bytes.length < 33 || bytes.toString("base64") !== data.image || !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) throw new Error("Invalid collector image.");
  return { ...item, image: { base64: data.image, mimeType: "image/png", sha256: createHash("sha256").update(bytes).digest("hex") } };
}
