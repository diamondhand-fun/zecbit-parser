# Bounded HTTP bodies

Diamond Hand's import and API routes use a streaming byte limit before parsing
untrusted text. `src/http.mjs` extracts that reader with explicit limit validation
and cleanup that preserves the original failure.

```js
import { readText } from "../src/http.mjs";

const request = new Request("https://example.test/import", {
  method: "POST",
  body: JSON.stringify({ sourceUrl: "https://zecbit.net/item/example/42" }),
});
const input = JSON.parse(await readText(request, 2048));
console.log(input.sourceUrl);
```

The same function accepts a Fetch API `Response`. It counts actual streamed
bytes rather than trusting `Content-Length`, decodes UTF-8 across chunk
boundaries, cancels the stream on overflow and releases its reader lock.
Network/read errors propagate unchanged. Invalid UTF-8 follows the standard
TextDecoder replacement behavior; an absent body throws and an empty stream
returns an empty string.

Use a timeout or abort signal on the surrounding fetch: a byte limit does not
limit elapsed time. Peak allocation can include the next upstream chunk even
if that chunk exceeds the limit. Do not pass arbitrary user-chosen limits.
This helper does not validate JSON schemas, URLs, authorization or content types.
