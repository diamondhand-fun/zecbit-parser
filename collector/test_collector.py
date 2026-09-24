"""Run: venv/bin/python test_collector.py. No upstream traffic."""
import json
import base64
import threading
import urllib.error
import urllib.request
from unittest.mock import patch
import collector as c

source = "https://zecbit.net/item/zecbit-genesis/2540"
for value in [None, "https://evil.test/", source + "?url=https://evil.test", "https://user@zecbit.net/item/a/1", "https://zecbit.net/item/a/0", "https://zecbit.net/item/a/1\n"]:
    try:
        c.collect(value)
        raise AssertionError("Invalid URL accepted")
    except c.SourceError as e:
        assert e.status == 400


class Response:
    def __init__(self, status=200, body=b"<main><h1>NFT</h1></main>", kind="text/html"):
        self.status_code, self.body, self.headers, self.closed = status, body, {"content-type": kind}, False

    def iter_content(self):
        yield self.body

    def close(self):
        self.closed = True


for response in [Response(429), Response(404), Response(body=b"x" * 2_000_001), Response(body=b"Vercel Security Checkpoint")]:
    with patch.object(c.requests.Session, "get", return_value=response) as get:
        try:
            c.collect(source)
            raise AssertionError("Bad source accepted")
        except c.SourceError as e:
            if response.status_code == 429 or b"Vercel Security Checkpoint" in response.body:
                assert e.status == 503 and e.code == "source_blocked"
        assert get.call_count == 1 and response.closed
with patch.object(c.requests.Session, "get", side_effect=[Response(), Response(body=b"not a PNG", kind="image/png")]):
    try:
        c.collect(source)
        raise AssertionError("Invalid image accepted")
    except c.SourceError as e:
        assert e.code == "invalid_image"

c.SECRET = "test-only-collector-secret-1234567890"
server = c.Server(("127.0.0.1", 0), c.Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    for body, auth, expected in [(b"{}", "", 401), (b"x" * 2049, c.SECRET, 413), (b"[1]", c.SECRET, 400), (b"{}", c.SECRET, 400)]:
        req = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/collect", data=body, headers={"Authorization": f"Bearer {auth}"})
        try:
            urllib.request.urlopen(req)
            raise AssertionError("Invalid request accepted")
        except urllib.error.HTTPError as e:
            assert e.code == expected, e.code
            assert json.load(e)["code"]
finally:
    server.shutdown(); server.server_close()

# Synthetic 1x1 PNG; no upstream request or user artwork is needed.
png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN7kAAAAASUVORK5CYII=")
page = Response()
art = Response(body=png, kind="image/png")
with patch.object(c.requests.Session, "get", side_effect=[page, art]) as get:
    item = c.collect(source)
    assert item["sourceUrl"] == source
    assert base64.b64decode(item["image"]) == png
    assert item["imageType"] == "image/png" and item["fetchedAt"]
    assert page.closed and art.closed
    assert get.call_args_list[1].args[0] == "https://zecbit.net/api/art/zecbit-genesis/2540"
    assert all(call.kwargs["allow_redirects"] is False for call in get.call_args_list)

for response in [Response(302), Response(kind="application/json")]:
    with patch.object(c.requests.Session, "get", return_value=response):
        try:
            c.collect(source)
            raise AssertionError("Redirect or incorrect content type accepted")
        except c.SourceError as error:
            assert error.code == "invalid_source"
        assert response.closed

print("Collector checks passed: auth, URL/body bounds, source limits/status, image validation, response cleanup.")
