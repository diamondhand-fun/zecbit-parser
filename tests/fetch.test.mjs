import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchNft } from "../src/fetch.mjs";

test("collector subprocess integration: canonical source, timestamp, errors and response identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "collector-check-"));
  const runner = join(directory, "python");
  const previous = process.env.ZECBIT_PYTHON;
  process.env.ZECBIT_PYTHON = runner;
  const sourceUrl = "https://zecbit.net/item/example/42";
  const html = await readFile(new URL("./item.html", import.meta.url), "utf8");
  const data = { sourceUrl, html, fetchedAt: "2026-01-01T00:00:00.000Z" };
  const program = code => writeFile(runner, `#!/usr/bin/env node\n${code}\n`, { mode: 0o700 });
  try {
    await program(`if (process.argv[3] !== ${JSON.stringify(sourceUrl)}) process.exit(2); console.log(${JSON.stringify(JSON.stringify(data))});`);
    const item = await fetchNft(sourceUrl + "?ref=example");
    assert.equal(item.name, "Example #42");
    assert.equal(item.fetchedAt, data.fetchedAt);
    await program(`console.log(${JSON.stringify(JSON.stringify({ ...data, sourceUrl: sourceUrl + "0" }))});`);
    await assert.rejects(fetchNft(sourceUrl), /Invalid collector response/);
    for (const bad of ["not JSON", "null", "[]", JSON.stringify({ ...data, fetchedAt: 1 }), JSON.stringify({ ...data, html: null }), JSON.stringify({ ...data, fetchedAt: "2026-01-01" })]) {
      await program(`console.log(${JSON.stringify(bad)});`);
      await assert.rejects(fetchNft(sourceUrl), /^Error: Invalid collector response\.$/);
    }
    await program('console.error("source_blocked"); process.exit(1);');
    await assert.rejects(fetchNft(sourceUrl), /^Error: source_blocked$/);
    await program('console.error("sensitive process details"); process.exit(1);');
    await assert.rejects(fetchNft(sourceUrl), /^Error: Collector failed or exceeded its resource limit\.$/);
    await assert.rejects(fetchNft("https://evil.test/"), /Use https/);
    const stopped = AbortSignal.abort(new Error("caller cancelled"));
    await assert.rejects(fetchNft(sourceUrl, { signal: stopped }), /caller cancelled/);
    for (const timeoutMs of [0, -1, 1.5, Infinity, 25_001]) await assert.rejects(fetchNft(sourceUrl, { timeoutMs }), /Collector timeout/);
    await program("setInterval(() => {}, 1000);");
    await assert.rejects(fetchNft(sourceUrl, { timeoutMs: 100 }), /^Error: source_timeout$/);
    await assert.rejects(fetchNft(sourceUrl, { signal: AbortSignal.timeout(100) }), error => error.name === "TimeoutError");
  } finally {
    if (previous === undefined) delete process.env.ZECBIT_PYTHON;
    else process.env.ZECBIT_PYTHON = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
