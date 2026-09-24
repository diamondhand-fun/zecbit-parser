![Diamond Hand](assets/banner.png)

# Zecbit Parser

**Zecbit item HTML → structured NFT metadata. Built by Diamond Hand.**

Related: [NFT Radar](https://github.com/diamondhand-fun/nft-radar) traces token
launches back to their source NFT references.

A standalone extraction of the metadata parser used in Diamond Hand's NFT
import flow. One runtime dependency, no browser, no wallet, no credentials.
Bring an HTML snapshot; get a canonical item reference, name, collection,
artwork URL and traits.

For bounded HTML and artwork retrieval, use the optional Python
[collector](collector/README.md). The JavaScript parser remains offline.
The extracted [quota state machine](docs/quotas.md) limits cached requests,
fresh imports and shared upstream traffic without a framework or database dependency.
The [bounded HTTP reader](docs/bounded-http.md) consumes Fetch API bodies with
byte limits and streaming UTF-8 decoding.

## Fetch a real NFT

Requires Node.js 22+ and Python 3.11+. From the repository root:

```sh
npm ci --ignore-scripts
python3 -m venv .venv
.venv/bin/python -m pip install -r collector/requirements.txt
npm run --silent fetch -- https://zecbit.net/item/zecbit-genesis/2540
```

This downloads the item page and checks PNG dimensions and chunk integrity, then emits
parsed metadata as JSON. No wallet, service account or running HTTP server is
required. The collector enforces byte limits in the libcurl callback, rejects
redirects and stops on upstream access denials. The process has a 25-second
outer timeout. Set `ZECBIT_PYTHON` to use another Python environment.

```js
import { fetchNft } from "./src/fetch.mjs";
const item = await fetchNft("https://zecbit.net/item/zecbit-genesis/2540");
console.log(item.name, item.attributes);
// Optional: fetchNft(url, { signal: AbortSignal.timeout(10_000) })
```

## Parse an existing HTML snapshot

The offline JavaScript parser needs only Node.js and `npm ci`:

```sh
npm run --silent parse -- https://zecbit.net/item/example/42 tests/item.html
# Piped input is also supported; use --help for usage.
```

```json
{
  "sourceUrl": "https://zecbit.net/item/example/42",
  "collectionSlug": "example",
  "itemId": "42",
  "name": "Example #42",
  "collectionName": "Example Collection",
  "imageUrl": "https://zecbit.net/api/art/example/42",
  "attributes": [
    { "trait": "Material", "value": "Diamond & Gold" },
    { "trait": "Background", "value": "Violet" }
  ],
  "fetchedAt": "2026-01-01T00:00:00.000Z"
}
```

The example shows the included fixture. `parseZecbit` sets `fetchedAt` to parsing
time; `fetchNft` preserves the collector timestamp from the actual download.

## Use the parser

```js
import { readFile } from "node:fs/promises";
import { parseZecbit, zecbitItem } from "./src/index.mjs";

const source = zecbitItem("https://zecbit.net/item/example/42?ref=demo");
const item = parseZecbit(await readFile("tests/item.html", "utf8"), source.sourceUrl);
console.log(item.attributes);
```

`zecbitItem(url)` validates and canonicalizes the item reference, removing
query parameters and fragments. IDs remain strings to preserve large values.
`parseZecbit(html, url)` throws on invalid URLs, oversized HTML, missing
metadata, a conflicting declared canonical URL or a mismatched artwork path. It never fetches a URL or executes scripts.

## Boundaries

| Input | Behavior |
| --- | --- |
| Source URL | HTTPS, exact `zecbit.net` host, no credentials or non-default port |
| Item path | Collection slug up to 128 characters; positive ID up to 78 digits |
| HTML | Maximum 2,000,000 UTF-8 bytes |
| Name and collection | Required, maximum 256 characters each |
| Artwork | Matching source origin and `/api/art/{collection}/{id}` path |
| Traits | First 64 rows; names truncated to 128, values to 256 Unicode code points |

This parses **Zecbit NFT page metadata**, not Zcash blocks, transactions,
shielded data or ownership proofs. Artwork URLs are references, not verified
image bytes. Metadata is untrusted text: render it as text, never raw HTML.
The selectors follow Zecbit's item-page markup and may need updates if it changes.

Production deployment, credentials and wallet logic
are deliberately outside this repository. The package is marked private to
prevent accidental npm publication.

## Verification

```sh
npm test
.venv/bin/python collector/test_collector.py
```

CI runs the Node checks plus collector checks against a local HTTP source.
See [validation notes](docs/validation.md) for live checks and exact boundaries.

Maintained by [Diamond Hand](https://github.com/diamondhand-fun).

TypeScript declarations are included for the parser, fetch, HTTP and quota
exports. `npm test` also checks the public package imports and quota narrowing.
