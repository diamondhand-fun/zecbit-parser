"""Bounded Zecbit transport. Metadata parsing and quotas are handled by the caller."""
import base64
import hmac
import json
import os
import re
import socket
import struct
import threading
import time
import zlib
from contextlib import closing
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from curl_cffi import requests
from curl_cffi.curl import CURL_WRITEFUNC_ERROR
from curl_cffi.requests.exceptions import Timeout

ITEM = re.compile(r"https://zecbit\.net/item/([a-z0-9][a-z0-9_-]{0,127})/([1-9][0-9]{0,77})")
SECRET = os.environ.get("IMPORT_COLLECTOR_SECRET", "")


class SourceError(Exception):
    def __init__(self, code, status=502):
        self.code, self.status = code, status


def download(session, url, limit, content_type, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise SourceError("source_timeout", 504)
    body = bytearray()
    failure = None

    def receive(chunk):
        nonlocal failure
        if time.monotonic() > deadline:
            failure = SourceError("source_timeout", 504)
        elif len(body) + len(chunk) > limit:
            failure = SourceError("source_too_large")
        if failure:
            return CURL_WRITEFUNC_ERROR
        body.extend(chunk)
        return len(chunk)

    try:
        # Enforce bounds in libcurl's callback, before any Python streaming queue.
        response = session.get(url, content_callback=receive, allow_redirects=False, timeout=min(10, remaining))
    except requests.RequestsError as error:
        if failure:
            raise failure from None
        if isinstance(error, Timeout):
            raise SourceError("source_timeout", 504) from None
        raise SourceError("source_unavailable", 502) from None
    with closing(response):
        if response.status_code in (403, 429):
            raise SourceError("source_blocked", 503)
        if response.status_code == 404:
            raise SourceError("not_found", 404)
        actual_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if response.status_code != 200 or actual_type != content_type:
            raise SourceError("invalid_source")
        if time.monotonic() > deadline:
            raise SourceError("source_timeout", 504)
        return bytes(body)


def validate_png(png):
    if len(png) < 33 or png[:8] != b"\x89PNG\r\n\x1a\n":
        raise SourceError("invalid_image")
    offset, has_data = 8, False
    palette = idat_started = idat_closed = False
    while offset < len(png):
        if len(png) - offset < 12:
            raise SourceError("invalid_image")
        size = struct.unpack(">I", png[offset:offset + 4])[0]
        kind = png[offset + 4:offset + 8]
        if not re.fullmatch(b"[A-Za-z]{4}", kind) or kind[0] < 97 and kind not in (b"IHDR", b"PLTE", b"IDAT", b"IEND"):
            raise SourceError("invalid_image")
        end = offset + 12 + size
        if end > len(png) or zlib.crc32(png[offset + 4:end - 4]) != struct.unpack(">I", png[end - 4:end])[0]:
            raise SourceError("invalid_image")
        if offset == 8:
            if kind != b"IHDR" or size != 13:
                raise SourceError("invalid_image")
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", png[offset + 8:end - 4])
            depths = {0: (1, 2, 4, 8, 16), 2: (8, 16), 3: (1, 2, 4, 8), 4: (8, 16), 6: (8, 16)}
            if not 0 < width <= 4096 or not 0 < height <= 4096 or depth not in depths.get(color, ()) or compression or filtering or interlace not in (0, 1):
                raise SourceError("invalid_image")
        elif kind == b"IHDR":
            raise SourceError("invalid_image")
        if kind == b"PLTE":
            if palette or idat_started or color in (0, 4) or not 0 < size <= 768 or size % 3 or color == 3 and size // 3 > 2 ** depth:
                raise SourceError("invalid_image")
            palette = True
        if kind == b"IDAT":
            if idat_closed or color == 3 and not palette:
                raise SourceError("invalid_image")
            idat_started = True
            has_data = has_data or size > 0
        elif idat_started:
            idat_closed = True
        if kind == b"IEND":
            if size or end != len(png) or not has_data:
                raise SourceError("invalid_image")
            return
        offset = end
    raise SourceError("invalid_image")


def collect(source):
    match = ITEM.fullmatch(source) if isinstance(source, str) else None
    if not match:
        raise SourceError("invalid_url", 400)
    deadline = time.monotonic() + 20
    with requests.Session(impersonate="chrome142", trust_env=False) as session:
        try:
            html = download(session, source, 2_000_000, "text/html", deadline).decode("utf-8")
        except UnicodeDecodeError:
            raise SourceError("invalid_source") from None
        if "Vercel Security Checkpoint" in html:
            raise SourceError("source_blocked", 503)
        if not re.search(r"<main[\s>]", html) or "<h1" not in html:
            raise SourceError("invalid_source")
        png = download(session, f"https://zecbit.net/api/art/{match[1]}/{match[2]}", 1_000_000, "image/png", deadline)
    validate_png(png)
    return {"sourceUrl": source, "html": html, "image": base64.b64encode(png).decode(), "imageType": "image/png", "fetchedAt": datetime.now(timezone.utc).isoformat()}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON field")
        result[key] = value
    return result


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        self.request.settimeout(10)
        super().setup()

    def log_message(self, *_):
        pass

    def reply(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        if status == 503:
            self.send_header("Retry-After", "300")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.reply(200 if self.path == "/health" else 404, {"ok": self.path == "/health"})

    def do_POST(self):
        if self.path != "/collect":
            return self.reply(404, {"code": "not_found"})
        if len(self.headers.get_all("Authorization", [])) != 1 or not SECRET or not hmac.compare_digest(self.headers.get("Authorization", "").encode(), f"Bearer {SECRET}".encode()):
            return self.reply(401, {"code": "unauthorized"})
        if len(self.headers.get_all("Content-Length", [])) != 1 or self.headers.get_all("Transfer-Encoding"):
            return self.reply(400, {"code": "invalid_body"})
        if len(self.headers.get_all("Content-Type", [])) != 1 or self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
            return self.reply(415, {"code": "invalid_content_type"})
        try:
            length = self.headers.get("Content-Length", "")
            if not re.fullmatch(r"[0-9]+", length):
                return self.reply(400, {"code": "invalid_body"})
            size = int(length)
            if not 0 < size <= 2048 or self.headers.get("Transfer-Encoding"):
                return self.reply(413, {"code": "invalid_body"})
            body = self.rfile.read(size)
            if len(body) != size:
                return self.reply(400, {"code": "invalid_body"})
            data = json.loads(body, object_pairs_hook=unique_object)
            if not isinstance(data, dict):
                return self.reply(400, {"code": "invalid_body"})
            self.reply(200, collect(data.get("sourceUrl")))
        except SourceError as error:
            self.reply(error.status, {"code": error.code})
        except (ValueError, UnicodeError):
            self.reply(400, {"code": "invalid_body"})
        except requests.RequestsError:
            self.reply(502, {"code": "source_unavailable"})
        except socket.timeout:
            self.reply(408, {"code": "request_timeout"})


class Server(ThreadingHTTPServer):
    daemon_threads = True
    # ponytail: four active requests per VPS; raise only after measuring RAM and source throttling.
    slots = threading.BoundedSemaphore(4)

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            try:
                request.settimeout(1)
                request.sendall(b"HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 5\r\nContent-Length: 0\r\n\r\n")
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()


if __name__ == "__main__":
    if len(SECRET) < 32:
        raise SystemExit("IMPORT_COLLECTOR_SECRET must contain at least 32 characters")
    Server(("127.0.0.1", 8787), Handler).serve_forever()
