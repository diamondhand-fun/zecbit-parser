# Validation record

Checked on 2026-09-24.

## Real source

```sh
npm run --silent fetch -- https://zecbit.net/item/zecbit-genesis/2540
```

The full download → artwork-header check → HTML parse path returned `ZEC #2540`,
collection `ZecBit Genesis — Shielded` and six traits, including
`Body: Diamond-skeleton`. The source returned 94,708 HTML bytes and 8,332 base64
artwork characters during the initial live check. Source content can change.

## Regression coverage

- Canonical item URLs, identity matching, UTF-8 byte limits, bounded trait output.
- Actual libcurl transfers against a local HTTP source: exact byte boundary,
  oversized response abort, and connection reuse after failure.
- Exact media-type matching, bad upstream UTF-8, redirects and source denials.
- Collector subprocess arguments, source identity, download timestamp and
  sanitized child-process errors.
- HTTP stream overflow, split UTF-8, read errors and a stalled cancellation.
- Quota resets, leases, cooldowns, shared budgets, clock rollback and damaged state.

```sh
npm test
.venv/bin/python collector/test_collector.py
```

`npm audit` reported zero known JavaScript dependency vulnerabilities on the
check date. PNG checks inspect the header and dimensions, not the complete
compressed image or chunk checksums. Quota persistence and serialization must
be supplied by the application, as described in [quotas](quotas.md).
