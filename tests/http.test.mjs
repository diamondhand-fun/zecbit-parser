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

test("a stalled cancellation cannot hide the size-limit failure", async () => {
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(2)); },
    cancel() { return new Promise(() => {}); },
  });
  let timer;
  try {
    await assert.rejects(Promise.race([
      readText(new Response(body), 1),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("cleanup hung")), 500); }),
    ]), /size limit/);
    assert.equal(body.locked, false);
  } finally { clearTimeout(timer); }
});


test("abort stalled reads, preserve the reason and release the stream", async () => {
  const controller = new AbortController();
  const reason = new Error("stop reading");
  let cancelled;
  const body = new ReadableStream({ cancel(value) { cancelled = value; return new Promise(() => {}); } });
  const pending = readText(new Response(body), 100, { signal: controller.signal });
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(cancelled, reason);
  assert.equal(body.locked, false);
  const untouched = new Response("hello");
  await assert.rejects(readText(untouched, 100, { signal: controller.signal }), error => error === reason);
  assert.equal(await untouched.text(), "hello");
});
