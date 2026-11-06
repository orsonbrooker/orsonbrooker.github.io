# Serves the site to phones and iPads on the home network, and passes /api requests to the local
# Worker (the game calls /api on its own address when it isn't on localhost).
#
# Usage: python3 tools/dev/lan_server.py [PORT] [FOLDER]      (defaults: 5174, dist; run `npm run build` first)
# Anyone on the same Wi-Fi can reach it, so it only serves the site: never hidden files (.dev.vars,
# .secrets.json, .cloudflare/ with its copy of the database) or the private folders.
# Then open http://<this Mac's address>:PORT/games/shootaround/ on the phone (same Wi-Fi).
# Find the address with: ipconfig getifaddr en0
# The local Worker must be running on port 8787 (see CLAUDE.md). It listens on IPv6 only, which is why
# WORKER says "localhost" and not 127.0.0.1. macOS may ask to let Python accept incoming connections.
import functools
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

WORKER = "http://localhost:8787"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5174
FOLDER = sys.argv[2] if len(sys.argv) > 2 else "dist"
PRIVATE = {"worker", "notes", "tools", "art", "node_modules"}


def private(path):
    """Hidden files and folders, and folders that aren't part of the site."""
    parts = [p for p in urllib.parse.unquote(path.split("?")[0]).split("/") if p]
    return any(p.startswith(".") for p in parts) or (parts and parts[0] in PRIVATE)


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def proxy(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {k: v for k, v in self.headers.items() if k.lower() in ("content-type", "accept", "cookie")}
        req = urllib.request.Request(WORKER + self.path, data=body, method=self.command, headers=headers)
        try:
            res = urllib.request.urlopen(req, timeout=20)
            status, data, ctype = res.status, res.read(), res.headers.get("Content-Type", "application/json")
        except urllib.error.HTTPError as e:
            status, data, ctype = e.code, e.read(), e.headers.get("Content-Type", "application/json")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/api/") or self.path.startswith("/admin"):
            return self.proxy()
        if private(self.path):
            return self.send_error(404)
        super().do_GET()

    def do_HEAD(self):
        if private(self.path):
            return self.send_error(404)
        super().do_HEAD()

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self.proxy()
        self.send_error(405)


print(f"Serving {FOLDER} on port {PORT}, /api -> {WORKER}")
ThreadingHTTPServer(("0.0.0.0", PORT), functools.partial(Handler, directory=FOLDER)).serve_forever()
