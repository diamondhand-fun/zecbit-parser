"""Run: venv/bin/python test_collector.py. No upstream traffic."""
import json
import base64
import threading
import time
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


    def close(self):
        self.closed = True


def transport(*responses):
    pending = iter(responses)
    def get(url, **kwargs):
        response = next(pending)
        assert kwargs["allow_redirects"] is False
        assert "stream" not in kwargs
        callback = kwargs["content_callback"]
        if callback(response.body) == c.CURL_WRITEFUNC_ERROR:
            response.close()
            raise c.requests.RequestsError("write aborted")
        return response
    return get


for response in [Response(429), Response(404), Response(body=b"x" * 2_000_001), Response(body=b"Vercel Security Checkpoint")]:
    with patch.object(c.requests.Session, "get", side_effect=transport(response)) as get:
        try:
            c.collect(source)
            raise AssertionError("Bad source accepted")
        except c.SourceError as e:
            if response.status_code == 429 or b"Vercel Security Checkpoint" in response.body:
                assert e.status == 503 and e.code == "source_blocked"
        assert get.call_count == 1 and response.closed
with patch.object(c.requests.Session, "get", side_effect=transport(Response(), Response(body=b"not a PNG", kind="image/png"))):
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
with patch.object(c.requests.Session, "get", side_effect=transport(page, art)) as get:
    item = c.collect(source)
    assert item["sourceUrl"] == source
    assert base64.b64decode(item["image"]) == png
    assert item["imageType"] == "image/png" and item["fetchedAt"]
    assert page.closed and art.closed
    assert get.call_args_list[1].args[0] == "https://zecbit.net/api/art/zecbit-genesis/2540"
    assert all(call.kwargs["allow_redirects"] is False for call in get.call_args_list)

for response in [Response(302), Response(kind="application/json"), Response(kind="not-text/html-malicious"), Response(body=b"\xff")]:
    with patch.object(c.requests.Session, "get", side_effect=transport(response)):
        try:
            c.collect(source)
            raise AssertionError("Redirect or incorrect content type accepted")
        except c.SourceError as error:
            assert error.code == "invalid_source"
        assert response.closed

# Exercise the actual libcurl callback against a local upstream, not a mocked get().
class Upstream(c.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        body = b"x" * (100_000 if self.path == "/large" else 16)
        self.send_response(200)
        self.send_header("Content-Type", "Text/HTML; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass


upstream = c.ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
threading.Thread(target=upstream.serve_forever, daemon=True).start()
try:
    with c.requests.Session(trust_env=False) as session:
        url = f"http://127.0.0.1:{upstream.server_port}"
        assert c.download(session, url, 16, "text/html", time.monotonic() + 5) == b"x" * 16
        try:
            c.download(session, url + "/large", 1024, "text/html", time.monotonic() + 5)
            raise AssertionError("libcurl exceeded the body limit")
        except c.SourceError as error:
            assert error.code == "source_too_large"
        # A callback abort must leave the session reusable.
        assert c.download(session, url, 16, "text/html", time.monotonic() + 5) == b"x" * 16
finally:
    upstream.shutdown()
    upstream.server_close()

print("Collector checks passed: auth, bounds, source status, image headers, cleanup and real libcurl callback limits.")
