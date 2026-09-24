import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseZecbit, zecbitItem, MAX_HTML_BYTES } from "../src/index.mjs";

const html = readFileSync(new URL("./item.html", import.meta.url), "utf8");
const source = "https://zecbit.net/item/example/42";

test("parse metadata, entities and canonical identity", () => {
  const { fetchedAt, ...item } = parseZecbit(html, source + "?ref=test#top");
  assert.deepEqual(item, {
    sourceUrl: source, collectionSlug: "example", itemId: "42",
    name: "Example #42", collectionName: "Example Collection",
    imageUrl: "https://zecbit.net/api/art/example/42",
    attributes: [{ trait: "Material", value: "Diamond & Gold" }, { trait: "Background", value: "Violet" }],
  });
  assert(Number.isFinite(Date.parse(fetchedAt)));
  assert.equal(zecbitItem(source + "/").sourceUrl, source);
  const id = "9".repeat(78);
  assert.equal(zecbitItem(`https://zecbit.net/item/example/${id}`).itemId, id);
});

test("reject invalid source, mismatched artwork and incomplete pages", () => {
  for (const input of [null, {}, "", "http://zecbit.net/item/a/1", "https://zecbit.net.evil.test/item/a/1", "https://user@zecbit.net/item/a/1", "https://zecbit.net:444/item/a/1", "https://zecbit.net/item/a/0", "https://zecbit.net/item/a/%31", "https://zecbit.net/item/a/" + "9".repeat(79)]) {
    assert.throws(() => zecbitItem(input));
  }
  for (const input of ["<title>Security checkpoint</title>", html.replace("/api/art/example/42", "https://evil.test/api/art/example/42"), html.replace("/api/art/example/42", "/api/art/example/43"), html.replace("Example #42", "x".repeat(257)), html.replace("/collection/example", "/collection/other")]) {
    assert.throws(() => parseZecbit(input, source));
  }
});

test("bound UTF-8 input and trait output", () => {
  assert.throws(() => parseZecbit(null, source));
  assert.throws(() => parseZecbit("é".repeat(MAX_HTML_BYTES / 2 + 1), source));
  const row = `<tr><td>${"t".repeat(150)}</td><td>${"v".repeat(300)}</td></tr>`;
  const item = parseZecbit(html.replace(/<tbody>[\s\S]*?<\/tbody>/, `<tbody>${row.repeat(80)}</tbody>`), source);
  assert.equal(item.attributes.length, 64);
  assert.equal(item.attributes[0].trait.length, 128);
  assert.equal(item.attributes[0].value.length, 256);
});

test("CLI emits JSON and fails on invalid or oversized input", () => {
  const cli = new URL("../src/cli.mjs", import.meta.url);
  const run = (args, input) => spawnSync(process.execPath, [cli.pathname, ...args], { input, encoding: "utf8" });
  const valid = run([source], html);
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).name, "Example #42");
  for (const result of [run([], html), run([source], "checkpoint"), run([source], "x".repeat(MAX_HTML_BYTES + 1))]) {
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert(result.stderr.trim());
  }
});
