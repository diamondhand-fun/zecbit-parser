import assert from "node:assert/strict";
import { test } from "node:test";
import { readText } from "../src/http.mjs";

test("decode UTF-8 across chunks and accept exactly the byte limit", async () => {
  const bytes = new TextEncoder().encode("NFT 💎 é");
  const body = new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  assert.equal(await readText(new Response(body), bytes.length), "NFT 💎 é");
  assert.equal(body.locked, false);
  await assert.rejects(readText(new Response("é"), 1), /size limit/);
});

test("cancel oversized streams, release lock and preserve size error", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(8)); },
    cancel() { cancelled = true; throw new Error("cleanup failure"); },
  });
  await assert.rejects(readText(new Response(body), 7), /size limit/);
  assert(cancelled);
  assert.equal(body.locked, false);
});

test("propagate read failure and release errored body", async () => {
  const failure = new Error("upstream disconnected");
  const body = new ReadableStream({ pull(controller) { controller.error(failure); } });
  await assert.rejects(readText(new Response(body), 100), error => error === failure);
  assert.equal(body.locked, false);
});

test("handle request bodies, empty streams and invalid limits", async () => {
  assert.equal(await readText(new Request("https://example.test", { method: "POST", body: "{}" }), 2), "{}");
  assert.equal(await readText(new Response(""), 0), "");
  await assert.rejects(readText(new Response(null), 1), /Empty/);
  for (const limit of [-1, NaN, Infinity, 1.5, "2"]) {
    await assert.rejects(readText(new Response(""), limit), /Invalid byte limit/);
  }
});
