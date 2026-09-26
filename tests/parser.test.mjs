import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseZecbit, zecbitItem, MAX_HTML_BYTES, ParserError } from "../src/index.mjs";

const html = readFileSync(new URL("./item.html", import.meta.url), "utf8");
const source = "https://zecbit.net/item/example/42";

test("retain NFT traits when optional tbody tags are omitted", () => {
  const page = html.replaceAll("<tbody>", "").replaceAll("</tbody>", "");
  assert.deepEqual(parseZecbit(page, source).attributes, parseZecbit(html, source).attributes);
});

test("resolve relative references against the document base URL", () => {
  const page = base => html.replace("</head>", `<base href="${base}"></head>`);
  assert.throws(() => parseZecbit(page("https://other.test/"), source), error => error.code === "invalid_metadata");
  const relative = page("https://zecbit.net/api/").replace("/api/art/example/42", "art/example/42");
  assert.equal(parseZecbit(relative, source).imageUrl, "https://zecbit.net/api/art/example/42");
  const canonical = page("https://other.test/").replace("</head>", '<link rel="canonical" href="/item/example/42"></head>');
  assert.throws(() => parseZecbit(canonical, source), error => error.code === "source_mismatch");
  assert.throws(() => parseZecbit(page("http://["), source), error => error.code === "invalid_metadata");
});

test("CLI accepts an explicit stdin marker", () => {
  const result = spawnSync(process.execPath, [new URL("../src/cli.mjs", import.meta.url).pathname, source, "-"], { input: html, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).itemId, "42");
});

test("CLI rejects malformed UTF-8 from both stdin and files", async () => {
  const cli = new URL("../src/cli.mjs", import.meta.url).pathname;
  const directory = await mkdtemp(join(tmpdir(), "parser-utf8-"));
  const file = join(directory, "item.html");
  try {
    for (const invalid of [Buffer.from([0xff]), Buffer.from([0xe2, 0x82])]) {
      const bytes = Buffer.concat([Buffer.from(html.replace("Example #42", "Example 💎")), invalid]);
      await writeFile(file, bytes);
      for (const args of [[source], [source, file]]) {
        const result = spawnSync(process.execPath, [cli, ...args], { input: bytes, encoding: "utf8" });
        assert.equal(result.status, 1);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /encoded data|encoding|UTF-8/i);
      }
    }
    const result = spawnSync(process.execPath, [cli, source], { input: html.replace("Example #42", "Example 💎"), encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).name, "Example 💎");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

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

test("reject artwork URLs carrying embedded credentials", () => {
  for (const prefix of ["https://user@zecbit.net", "https://user:password@zecbit.net"]) {
    assert.throws(() => parseZecbit(html.replace("/api/art/example/42", prefix + "/api/art/example/42"), source), /readable NFT/);
  }
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


test("truncate traits at Unicode code point boundaries", () => {
  const body = html.replace("Material", "a".repeat(127) + "💎extra").replace("Diamond &amp; Gold", "b".repeat(255) + "💎extra");
  const item = parseZecbit(body, source);
  assert.equal(item.attributes[0].trait, "a".repeat(127) + "💎");
  assert.equal(item.attributes[0].value, "b".repeat(255) + "💎");
});


test("CLI accepts HTML files and provides help without stdin", () => {
  const cli = new URL("../src/cli.mjs", import.meta.url).pathname;
  const fromFile = spawnSync(process.execPath, [cli, source, new URL("./item.html", import.meta.url).pathname], { encoding: "utf8" });
  assert.equal(fromFile.status, 0, fromFile.stderr);
  assert.equal(JSON.parse(fromFile.stdout).itemId, "42");
  for (const path of [cli, new URL("../src/fetch-cli.mjs", import.meta.url).pathname]) {
    const help = spawnSync(process.execPath, [path, "--help"], { encoding: "utf8" });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage:/);
  }
});


test("reject URL controls and backslashes before URL normalization", () => {
  for (const value of [source.replace("zecbit", "zec\tbit"), source + "\n", source.replaceAll("/", "\\"), source + "?x=\0"]) assert.throws(() => zecbitItem(value));
  assert.equal(zecbitItem("  " + source + "  ").sourceUrl, source);
});


test("bind declared canonical page identity to the requested NFT", () => {
  const page = href => html.replace("</head>", `<link rel="canonical" href="${href}"></head>`);
  assert.equal(parseZecbit(page("/item/example/42"), source).itemId, "42");
  for (const href of ["/item/example/43", "https://evil.test/item/example/42", "", "javascript:void(0)"]) {
    if (href === "") continue; // An empty relative URL denotes this same page.
    assert.throws(() => parseZecbit(page(href), source), /canonical URL/);
  }
  assert.throws(() => parseZecbit(page(source).replace("</head>", '<link rel="canonical" href="/item/example/43"></head>'), source), /canonical URL/);
});


test("expose parser error codes without changing existing error messages", () => {
  for (const [run, code] of [[() => zecbitItem("bad"), "invalid_url"], [() => parseZecbit(null, source), "invalid_html"], [() => parseZecbit("<main/>", source), "invalid_metadata"], [() => parseZecbit(html.replace("</head>", '<link rel="canonical" href="/item/example/99"></head>'), source), "source_mismatch"]]) {
    assert.throws(run, error => error instanceof ParserError && error.code === code && error.message.length > 0);
  }
});


test("exclude script, style and template contents from NFT text fields", () => {
  const noise = '<script>tracking()</script><style>.ad { color:red }</style><template>inert text</template>';
  const page = html.replace("Example #42", "Example #42" + noise).replace("Example Collection", noise + "Example Collection").replace("Material", "Material" + noise);
  const { fetchedAt, ...actual } = parseZecbit(page, source);
  const { fetchedAt: ignored, ...expected } = parseZecbit(html, source);
  assert.deepEqual(actual, expected);
  assert.throws(() => parseZecbit(html.replace("Example #42", noise), source), error => error.code === "invalid_metadata");
});


test("resolve collection navigation links without accepting foreign origins", () => {
  for (const href of ["https://zecbit.net/collection/example", "/collection/example/", "/collection/example?ref=item", "../../collection/example"]) {
    assert.equal(parseZecbit(html.replace('/collection/example', href), source).collectionName, "Example Collection");
  }
  for (const href of ["https://evil.test/collection/example", "https://user@zecbit.net/collection/example", "/collection/examples"]) {
    assert.throws(() => parseZecbit(html.replace('/collection/example', href), source), error => error.code === "invalid_metadata");
  }
});
