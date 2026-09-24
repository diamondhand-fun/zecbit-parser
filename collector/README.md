# Zecbit collector

The transport extracted from Diamond Hand's importer. Accepts one canonical
Zecbit item URL and returns HTML plus base64 artwork. Runs on loopback only.
Metadata parsing, wallet authorization, quotas and persistent storage belong
to the caller. This service does not bypass upstream access denials.

## Local setup

Python 3.11 or newer:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r collector/requirements.txt
.venv/bin/python collector/test_collector.py
export IMPORT_COLLECTOR_SECRET="$(.venv/bin/python -c 'import secrets; print(secrets.token_hex(32))')"
.venv/bin/python collector/collector.py
```

Keep the generated secret in your runtime's secret store. The server refuses
to start with fewer than 32 characters. No secret is included in this repository.

`GET http://127.0.0.1:8787/health` returns `{"ok": true}`.
`POST /collect` requires `Authorization: Bearer <your secret>`, `Content-Type: application/json`,
one Content-Length header and this body:

```json
{"sourceUrl":"https://zecbit.net/item/zecbit-genesis/2540"}
```

Success returns `sourceUrl`, `html`, `image` (base64), `imageType` (`image/png`)
and `fetchedAt` (UTC). Feed `html` and `sourceUrl` into `parseZecbit`.
Unlike the parser, the collector accepts only canonical URLs, without a query,
fragment, credentials, port or trailing slash.

## Resource limits

| Resource | Limit |
| --- | --- |
| Concurrent connections handled | 4 |
| Request body | 2,048 bytes |
| HTML | 2,000,000 bytes |
| Artwork | 1,000,000 bytes |
| PNG width and height | 1–4,096 pixels |
| Source operation | 20-second checked deadline; individual requests up to 10 seconds |
| Client socket | 10-second timeout |

Only fixed Zecbit item and artwork paths are fetched. Redirects are rejected.
PNG checks cover dimensions, legal IHDR fields, chunk boundaries and CRCs,
and require image data followed by a complete IEND. Pixels are not decoded. Received bytes are bounded inside the libcurl callback without
a background streaming queue. Each request uses the remaining shared deadline.
The Node fetch command additionally terminates the collector after 25 seconds.

## Errors

| Status | Codes |
| --- | --- |
| 400 | `invalid_url`, `invalid_body` |
| 401 | `unauthorized` |
| 404 | `not_found` |
| 413 | `invalid_body` |
| 415 | `invalid_content_type` |
| 502 | `invalid_source`, `invalid_image`, `source_too_large` |
| 503 | `source_blocked`; `Retry-After: 300` |
| 504 | `source_timeout` |

When all connection slots are occupied, the server returns an empty 503
with `Retry-After: 5`. Tests cover mocked error paths and actual libcurl transfers against
a temporary local HTTP server. No live scraping is needed to test changes.
