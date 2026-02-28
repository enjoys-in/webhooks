import { readFileSync, existsSync } from "fs";
import { join, extname } from "path";

const DIST_DIR = join(import.meta.dir, "dist");
const BACKEND_URL = process.env.BACKEND_URL || "http://backend:8080";
const PORT = Number(process.env.PORT) || 4173;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".map": "application/json",
};

function serveStatic(pathname: string): Response | null {
  const filePath = join(DIST_DIR, pathname);

  // Prevent directory traversal
  if (!filePath.startsWith(DIST_DIR)) return null;

  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath);
      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      const headers: Record<string, string> = { "Content-Type": contentType };

      // Cache static assets with hashed filenames
      if (pathname.startsWith("/assets/")) {
        headers["Cache-Control"] = "public, max-age=31536000, immutable";
      }

      return new Response(content, { headers });
    } catch {
      return null;
    }
  }
  return null;
}

const PROXY_PREFIXES = ["/api/", "/send/", "/webhook/", "/health"];

function isProxyPath(pathname: string): boolean {
  return PROXY_PREFIXES.some((p) => pathname.startsWith(p));
}

function isWebSocketUpgrade(req: Request): boolean {
  return req.headers.get("upgrade")?.toLowerCase() === "websocket";
}

const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // WebSocket proxy for /ws/
    if (pathname.startsWith("/ws/") && isWebSocketUpgrade(req)) {
      const wsUrl = `${BACKEND_URL.replace(/^http/, "ws")}${pathname}${url.search}`;
      // Upgrade client connection
      const upgraded = server.upgrade(req, { data: { target: wsUrl } });
      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 500 });
      }
      return undefined as unknown as Response;
    }

    // HTTP proxy to backend
    if (isProxyPath(pathname)) {
      try {
        const targetUrl = `${BACKEND_URL}${pathname}${url.search}`;
        const headers = new Headers(req.headers);
        headers.set("X-Forwarded-For", req.headers.get("x-forwarded-for") || "");
        headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
        headers.delete("host");

        const proxyRes = await fetch(targetUrl, {
          method: req.method,
          headers,
          body: req.body,
          redirect: "manual",
        });

        return new Response(proxyRes.body, {
          status: proxyRes.status,
          statusText: proxyRes.statusText,
          headers: proxyRes.headers,
        });
      } catch (err) {
        console.error("Proxy error:", err);
        return new Response(JSON.stringify({ error: "Backend unavailable" }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Static file serving
    const staticRes = serveStatic(pathname);
    if (staticRes) return staticRes;

    // SPA fallback — serve index.html for client-side routes
    const indexPath = join(DIST_DIR, "index.html");
    if (existsSync(indexPath)) {
      return new Response(readFileSync(indexPath), {
        headers: { "Content-Type": "text/html" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws) {
      const { target } = ws.data as { target: string };
      const upstream = new WebSocket(target);

      upstream.onmessage = (event) => {
        try {
          ws.send(typeof event.data === "string" ? event.data : new Uint8Array(event.data as ArrayBuffer));
        } catch { /* client disconnected */ }
      };

      upstream.onclose = () => {
        try { ws.close(); } catch { /* already closed */ }
      };

      upstream.onerror = () => {
        try { ws.close(); } catch { /* already closed */ }
      };

      // Store upstream ref on the ws data for message forwarding
      (ws.data as any).upstream = upstream;
    },

    message(ws, message) {
      const { upstream } = ws.data as any;
      if (upstream?.readyState === WebSocket.OPEN) {
        upstream.send(message);
      }
    },

    close(ws) {
      const { upstream } = ws.data as any;
      if (upstream?.readyState === WebSocket.OPEN) {
        upstream.close();
      }
    },
  },
});

console.log(`🚀 Frontend server running on http://localhost:${server.port}`);
