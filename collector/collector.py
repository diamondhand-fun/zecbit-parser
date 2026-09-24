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
from contextlib import closing
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from curl_cffi import requests

ITEM = re.compile(r"https://zecbit\.net/item/([a-z0-9][a-z0-9_-]{0,127})/([1-9][0-9]{0,77})")
SECRET = os.environ.get("IMPORT_COLLECTOR_SECRET", "")


class SourceError(Exception):
    def __init__(self, code, status=502):
        self.code, self.status = code, status


def download(session, url, limit, content_type, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise SourceError("source_timeout", 504)
    with closing(session.get(url, stream=True, allow_redirects=False, timeout=min(10, remaining))) as response:
        if response.status_code in (403, 429):
            raise SourceError("source_blocked", 503)
        if response.status_code == 404:
            raise SourceError("not_found", 404)
        if response.status_code != 200 or content_type not in response.headers.get("content-type", ""):
            raise SourceError("invalid_source")
        chunks, size = [], 0
        for chunk in response.iter_content():
            size += len(chunk)
            if size > limit:
                raise SourceError("source_too_large")
            if time.monotonic() > deadline:
                raise SourceError("source_timeout", 504)
            chunks.append(chunk)
        return b"".join(chunks)


def collect(source):
    match = ITEM.fullmatch(source) if isinstance(source, str) else None
    if not match:
        raise SourceError("invalid_url", 400)
    deadline = time.monotonic() + 20
    with requests.Session(impersonate="chrome142", trust_env=False) as session:
        html = download(session, source, 2_000_000, "text/html", deadline).decode("utf-8")
        if "Vercel Security Checkpoint" in html:
            raise SourceError("source_blocked", 503)
        if not re.search(r"<main[\s>]", html) or "<h1" not in html:
            raise SourceError("invalid_source")
        png = download(session, f"https://zecbit.net/api/art/{match[1]}/{match[2]}", 1_000_000, "image/png", deadline)
    if len(png) < 24 or png[:8] != b"\x89PNG\r\n\x1a\n" or png[12:16] != b"IHDR" or not all(0 < n <= 4096 for n in struct.unpack(">II", png[16:24])):
        raise SourceError("invalid_image")
    return {"sourceUrl": source, "html": html, "image": base64.b64encode(png).decode(), "imageType": "image/png", "fetchedAt": datetime.now(timezone.utc).isoformat()}


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
        if not SECRET or not hmac.compare_digest(self.headers.get("Authorization", "").encode(), f"Bearer {SECRET}".encode()):
            return self.reply(401, {"code": "unauthorized"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 2048 or self.headers.get("Transfer-Encoding"):
                return self.reply(413, {"code": "invalid_body"})
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                return self.reply(400, {"code": "invalid_body"})
            self.reply(200, collect(data.get("sourceUrl")))
        except SourceError as error:
            self.reply(error.status, {"code": error.code})
        except (ValueError, UnicodeError):
            self.reply(400, {"code": "invalid_body"})
        except (requests.RequestsError, socket.timeout):
            self.reply(504, {"code": "source_timeout"})


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
