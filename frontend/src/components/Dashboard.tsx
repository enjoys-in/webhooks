import { useState, useEffect, useCallback, useMemo } from "react";
import type { WebhookRequest, EndpointInfo, AuthMode, AuthLocation } from "@/types";
import {
  createEndpoint,
  getRequestsPaginated,
  getWebhookUrl,
  clearRequests,
  getEndpointConfig,
  updateEndpointConfig,
} from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

// ─── Constants ───────────────────────────────────────────
const PAGE_SIZE = 100;

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  POST: "bg-green-500/20 text-green-400 border-green-500/30",
  PUT: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  PATCH: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  DELETE: "bg-red-500/20 text-red-400 border-red-500/30",
  HEAD: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  OPTIONS: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

// ─── Helpers ─────────────────────────────────────────────
function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatHeaders(headers: Record<string, string[] | string>): string {
  return Object.entries(headers)
    .map(([key, val]) => {
      const value = Array.isArray(val) ? val.join(", ") : val;
      return `${key}: ${value}`;
    })
    .join("\n");
}

function tryPrettyJson(str: string): { text: string; isJson: boolean } {
  try {
    const parsed = JSON.parse(str);
    return { text: JSON.stringify(parsed, null, 2), isJson: true };
  } catch {
    return { text: str, isJson: false };
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark");
}

function toggleDarkMode(): boolean {
  const html = document.documentElement;
  const dark = html.classList.toggle("dark");
  localStorage.setItem("theme", dark ? "dark" : "light");
  return dark;
}

// ─── JWT Decoder ─────────────────────────────────────────
function decodeJWT(token: string): { header: unknown; payload: unknown; signature: string } | null {
  try {
    const parts = token.trim().split(".");
    if (parts.length !== 3) return null;
    const header = JSON.parse(atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")));
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return { header, payload, signature: parts[2] };
  } catch {
    return null;
  }
}

function findJWTInText(text: string): string | null {
  const match = text.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  return match ? match[0] : null;
}

// ─── Base64 Decoder ──────────────────────────────────────
function tryBase64Decode(str: string): string | null {
  try {
    if (!/^[A-Za-z0-9+/=\n\r]+$/.test(str.trim())) return null;
    const decoded = atob(str.trim());
    if (/[\x00-\x08\x0E-\x1F]/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

// ─── EML Parser ──────────────────────────────────────────
interface EMLParsed {
  headers: Record<string, string>;
  body: string;
}

function parseEML(raw: string): EMLParsed | null {
  try {
    const idx = raw.indexOf("\r\n\r\n") !== -1 ? raw.indexOf("\r\n\r\n") : raw.indexOf("\n\n");
    if (idx === -1) return null;
    const headerBlock = raw.substring(0, idx);
    const body = raw.substring(idx).trim();
    const headers: Record<string, string> = {};
    const lines = headerBlock.split(/\r?\n/);
    let currentKey = "";
    for (const line of lines) {
      if (/^\s+/.test(line) && currentKey) {
        headers[currentKey] += " " + line.trim();
      } else {
        const colonIndex = line.indexOf(":");
        if (colonIndex > 0) {
          currentKey = line.substring(0, colonIndex).trim();
          headers[currentKey] = line.substring(colonIndex + 1).trim();
        }
      }
    }
    if (!headers["From"] && !headers["Subject"] && !headers["To"]) return null;
    return { headers, body };
  } catch {
    return null;
  }
}

// ─── Form Data Parser ────────────────────────────────────
function parseFormData(body: string, contentType: string): Record<string, string> | null {
  try {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(body);
      const result: Record<string, string> = {};
      for (const [k, v] of params) result[k] = v;
      return Object.keys(result).length > 0 ? result : null;
    }
    if (contentType.includes("multipart/form-data")) {
      const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
      if (!boundaryMatch) return null;
      const boundary = boundaryMatch[1];
      const parts = body.split(`--${boundary}`).filter((p) => p.trim() && p.trim() !== "--");
      const result: Record<string, string> = {};
      for (const part of parts) {
        const nameMatch = part.match(/name="([^"]+)"/);
        if (nameMatch) {
          const valStart = part.indexOf("\r\n\r\n") !== -1 ? part.indexOf("\r\n\r\n") + 4 : part.indexOf("\n\n") + 2;
          result[nameMatch[1]] = part.substring(valStart).trim();
        }
      }
      return Object.keys(result).length > 0 ? result : null;
    }
  } catch { /* noop */ }
  return null;
}

// ─── CopyButton ──────────────────────────────────────────
function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button variant="outline" size="sm" onClick={handleCopy} className="h-7 text-xs">
      {copied ? "Copied!" : label}
    </Button>
  );
}

// ─── Auth Config Dialog ──────────────────────────────────
const defaultKeyForMode = (mode: AuthMode, loc: AuthLocation): string => {
  if (mode === "hmac") return "X-Hub-Signature-256";
  if (loc === "header") return mode === "password" ? "X-Webhook-Secret" : "X-API-Key";
  if (loc === "query") return mode === "password" ? "password" : "token";
  if (loc === "body") return mode === "password" ? "password" : "token";
  return "";
};

function AuthConfigPanel({
  endpointId,
  onClose,
}: {
  endpointId: string;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<AuthMode>("none");
  const [secret, setSecret] = useState("");
  const [location, setLocation] = useState<AuthLocation>("header");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getEndpointConfig(endpointId)
      .then((cfg) => {
        setMode(cfg.auth_mode);
        setSecret(cfg.auth_secret || "");
        setLocation(cfg.auth_location || "header");
        setKey(cfg.auth_key || "");
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [endpointId]);

  const handleModeChange = (m: AuthMode) => {
    setMode(m);
    if (m === "none") {
      setLocation("header");
      setKey("");
      setSecret("");
    } else if (m === "hmac") {
      setLocation("header");
      setKey((prev) => prev || "X-Hub-Signature-256");
    } else {
      setKey((prev) => prev || defaultKeyForMode(m, location));
    }
  };

  const handleLocationChange = (loc: AuthLocation) => {
    setLocation(loc);
    setKey(defaultKeyForMode(mode, loc));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateEndpointConfig(endpointId, {
        auth_mode: mode,
        auth_secret: secret,
        auth_location: location,
        auth_key: key,
      });
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <div className="p-4 text-muted-foreground text-sm">Loading...</div>;

  const availableLocations: { value: AuthLocation; label: string }[] =
    mode === "hmac"
      ? [{ value: "header", label: "Header" }]
      : [
          { value: "header", label: "Header" },
          { value: "query", label: "Query Param" },
          { value: "body", label: "Body Field" },
        ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border rounded-lg shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Endpoint Auth Config</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>&times;</Button>
        </div>
        <div className="space-y-4">
          {/* Auth Mode */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Auth Mode</label>
            <div className="grid grid-cols-2 gap-2">
              {(["none", "password", "token", "hmac"] as AuthMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => handleModeChange(m)}
                  className={`px-3 py-2 rounded-md border text-sm font-medium transition-colors ${
                    mode === m
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50"
                  }`}
                >
                  {m === "none" ? "Public (No Auth)" : m === "hmac" ? "HMAC-SHA256" : m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {mode !== "none" && (
            <>
              {/* Credential Location */}
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {mode === "hmac" ? "Signature Location" : "Credential Location"}
                </label>
                <div className="flex gap-2">
                  {availableLocations.map((loc) => (
                    <button
                      key={loc.value}
                      onClick={() => handleLocationChange(loc.value)}
                      className={`flex-1 px-3 py-2 rounded-md border text-sm font-medium transition-colors ${
                        location === loc.value
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50"
                      }`}
                    >
                      {loc.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Key Name */}
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {location === "header" ? "Header Name" : location === "query" ? "Query Parameter Name" : "Body Field Name"}
                </label>
                <input
                  type="text"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={defaultKeyForMode(mode, location)}
                  className="w-full px-3 py-2 bg-background border rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="text-xs text-muted-foreground">
                  {location === "header" && mode !== "hmac" && "The HTTP header name that will carry the credential value"}
                  {location === "header" && mode === "hmac" && "The header name containing the HMAC signature (e.g. X-Hub-Signature-256)"}
                  {location === "query" && "The URL query parameter name (e.g. ?password=xxx)"}
                  {location === "body" && "The JSON or form field name in the request body"}
                </p>
              </div>

              {/* Secret */}
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {mode === "password" ? "Password" : mode === "token" ? "API Token" : "HMAC Secret Key"}
                </label>
                <input
                  type="text"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={`Enter ${mode} secret...`}
                  className="w-full px-3 py-2 bg-background border rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving || (mode !== "none" && (!secret || !key))}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────
export default function Dashboard() {
  const [endpoint, setEndpoint] = useState<EndpointInfo | null>(null);
  const [requests, setRequests] = useState<WebhookRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(isDarkMode());
  const [showAuthConfig, setShowAuthConfig] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRequests, setTotalRequests] = useState(0);

  const selectedRequest = requests.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    const stored = localStorage.getItem("webhook_endpoint_id");
    if (stored) {
      setEndpoint({ id: stored, url: `/webhook/${stored}`, created_at: "" });
      loadRequests(stored, 1);
    } else {
      createEndpoint()
        .then((ep) => {
          localStorage.setItem("webhook_endpoint_id", ep.id);
          setEndpoint(ep);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, []);

  const loadRequests = async (id: string, p: number) => {
    try {
      const result = await getRequestsPaginated(id, p, PAGE_SIZE);
      setRequests(result.requests);
      setPage(result.page);
      setTotalPages(result.total_pages);
      setTotalRequests(result.total);
      if (result.requests.length > 0 && !selectedId) {
        setSelectedId(result.requests[0].id);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleWsMessage = useCallback(
    (req: WebhookRequest) => {
      setRequests((prev) => {
        if (page === 1) {
          const updated = [req, ...prev.filter((r) => r.id !== req.id)];
          return updated.slice(0, PAGE_SIZE);
        }
        return prev;
      });
      setTotalRequests((prev) => prev + 1);
      setSelectedId((prev) => (page === 1 ? prev ?? req.id : prev));
    },
    [page]
  );

  useWebSocket(endpoint?.id ?? null, handleWsMessage);

  const handleNewEndpoint = async () => {
    setLoading(true);
    try {
      const ep = await createEndpoint();
      localStorage.setItem("webhook_endpoint_id", ep.id);
      setEndpoint(ep);
      setRequests([]);
      setSelectedId(null);
      setPage(1);
      setTotalPages(1);
      setTotalRequests(0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleClearAll = async () => {
    if (!endpoint) return;
    try {
      await clearRequests(endpoint.id);
      setRequests([]);
      setSelectedId(null);
      setPage(1);
      setTotalPages(1);
      setTotalRequests(0);
    } catch (e) {
      console.error(e);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (!endpoint || newPage < 1 || newPage > totalPages) return;
    setLoading(true);
    loadRequests(endpoint.id, newPage);
  };

  const handleToggleDark = () => {
    const newDark = toggleDarkMode();
    setDarkMode(newDark);
  };

  if (loading && !endpoint) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const webhookUrl = endpoint ? getWebhookUrl(endpoint.id) : "";

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="border-b px-4 py-3 flex items-center justify-between bg-card shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6 text-primary">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <h1 className="text-lg font-semibold">Webhook Catcher</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleToggleDark} title="Toggle dark mode">
            {darkMode ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowAuthConfig(true)}>Auth</Button>
          <Button variant="destructive" size="sm" onClick={handleClearAll} disabled={requests.length === 0}>Clear All</Button>
          <Button variant="outline" size="sm" onClick={handleNewEndpoint}>New URL</Button>
        </div>
      </header>

      {/* URL Bar */}
      <div className="border-b px-4 py-2.5 flex items-center gap-3 bg-muted/30 shrink-0">
        <span className="text-sm text-muted-foreground font-medium whitespace-nowrap">Your URL:</span>
        <code className="flex-1 text-sm bg-background border rounded-md px-3 py-1.5 font-mono select-all truncate">{webhookUrl}</code>
        <CopyButton text={webhookUrl} label="Copy URL" />
        <Badge variant="secondary" className="tabular-nums">
          {totalRequests} request{totalRequests !== 1 ? "s" : ""}
        </Badge>
      </div>

      {/* Main two-pane layout */}
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup orientation="horizontal">
          {/* Left Panel – Request List */}
          <ResizablePanel defaultSize={"18%"} minSize={"12%"} maxSize={"18%"}>
            <div className="h-full flex flex-col">
              <div className="px-3 py-2 border-b bg-muted/20 shrink-0 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Requests</h2>
                {totalPages > 1 && (
                  <span className="text-[10px] text-muted-foreground tabular-nums">Page {page}/{totalPages}</span>
                )}
              </div>
              <ScrollArea className="flex-1">
                {requests.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground">
                    <p className="text-sm">No requests yet.</p>
                    <p className="text-xs mt-2">Send a request to your webhook URL to see it here.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {requests.map((req) => (
                      <button
                        key={req.id}
                        onClick={() => setSelectedId(req.id)}
                        className={`w-full text-left px-3 py-2.5 hover:bg-accent/50 transition-colors ${
                          selectedId === req.id
                            ? "bg-accent border-l-2 border-l-primary"
                            : "border-l-2 border-l-transparent"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={`text-[10px] font-bold px-1.5 py-0 shrink-0 ${METHOD_COLORS[req.method] ?? ""}`}>
                            {req.method}
                          </Badge>
                          <span className="text-xs text-muted-foreground font-mono truncate flex-1">{req.path}</span>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[10px] text-muted-foreground">{formatTime(req.timestamp)}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground tabular-nums">{formatBytes(req.body_size || req.body?.length || 0)}</span>
                            <span className="text-[10px] text-muted-foreground tabular-nums">{req.response_time_ms.toFixed(1)}ms</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
              {/* Pagination */}
              {totalPages > 1 && (
                <div className="border-t px-3 py-2 flex items-center justify-between shrink-0 bg-muted/20">
                  <Button variant="ghost" size="xs" onClick={() => handlePageChange(page - 1)} disabled={page <= 1}>Prev</Button>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{page} / {totalPages}</span>
                  <Button variant="ghost" size="xs" onClick={() => handlePageChange(page + 1)} disabled={page >= totalPages}>Next</Button>
                </div>
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right Panel – Request Details */}
          <ResizablePanel defaultSize={80}>
            {selectedRequest ? (
              <RequestDetail request={selectedRequest} />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <p className="text-sm">Select a request to view details</p>
                  <p className="text-xs mt-1">Or send a request to your webhook URL</p>
                </div>
              </div>
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Auth Config Modal */}
      {showAuthConfig && endpoint && (
        <AuthConfigPanel endpointId={endpoint.id} onClose={() => setShowAuthConfig(false)} />
      )}
    </div>
  );
}

// ─── Request Detail ──────────────────────────────────────
function RequestDetail({ request }: { request: WebhookRequest }) {
  const bodySize = request.body_size || request.body?.length || 0;

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2.5 border-b bg-muted/20 flex items-center gap-3 shrink-0">
        <Badge variant="outline" className={`font-bold ${METHOD_COLORS[request.method] ?? ""}`}>{request.method}</Badge>
        <span className="text-sm font-mono truncate flex-1">{request.path}</span>
        <span className="text-xs text-muted-foreground">{new Date(request.timestamp).toLocaleString()}</span>
        <Badge variant="secondary" className="tabular-nums">{request.response_time_ms.toFixed(2)}ms</Badge>
        <Badge variant="secondary" className="tabular-nums">{formatBytes(bodySize)}</Badge>
        <Badge variant={request.status_code < 400 ? "default" : "destructive"} className="tabular-nums">{request.status_code}</Badge>
      </div>

      <div className="flex-1 min-h-0">
        <ResizablePanelGroup orientation="vertical">
          <ResizablePanel defaultSize={40} minSize={15}>
            <div className="h-full flex flex-col">
              <Tabs defaultValue="request-headers" className="h-full flex flex-col">
                <div className="border-b px-3 shrink-0">
                  <TabsList className="h-9 bg-transparent">
                    <TabsTrigger value="request-headers" className="text-xs">Request Headers</TabsTrigger>
                    <TabsTrigger value="response-headers" className="text-xs">Response Headers</TabsTrigger>
                    <TabsTrigger value="query-params" className="text-xs">Query Params</TabsTrigger>
                    <TabsTrigger value="details" className="text-xs">Details</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="request-headers" className="flex-1 m-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="p-3">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Request Headers</span>
                        <CopyButton text={formatHeaders(request.headers)} label="Copy" />
                      </div>
                      <HeaderTable headers={request.headers} />
                    </div>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="response-headers" className="flex-1 m-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="p-3">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Response Headers</span>
                        <CopyButton text={formatHeaders(request.response_headers)} label="Copy" />
                      </div>
                      <HeaderTable headers={request.response_headers} />
                    </div>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="query-params" className="flex-1 m-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="p-3">
                      {Object.keys(request.query_params).length === 0 ? (
                        <p className="text-sm text-muted-foreground">No query parameters</p>
                      ) : (
                        <HeaderTable headers={request.query_params} />
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="details" className="flex-1 m-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="p-3 space-y-2">
                      <DetailRow label="Request ID" value={request.id} />
                      <DetailRow label="Method" value={request.method} />
                      <DetailRow label="Path" value={request.path} />
                      <DetailRow label="Content-Type" value={request.content_type || "N/A"} />
                      <DetailRow label="Content-Length" value={String(request.content_length)} />
                      <DetailRow label="Body Size" value={formatBytes(bodySize)} />
                      <DetailRow label="Remote Address" value={request.remote_addr} />
                      <DetailRow label="Host" value={request.host} />
                      <DetailRow label="Response Time" value={`${request.response_time_ms.toFixed(2)}ms`} />
                      <DetailRow label="Status Code" value={String(request.status_code)} />
                      <DetailRow label="Timestamp" value={new Date(request.timestamp).toISOString()} />
                    </div>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={60} minSize={20}>
            <BodyPanel request={request} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

// ─── Body Panel with Raw / Pretty / Inspect tabs ─────────
function BodyPanel({ request }: { request: WebhookRequest }) {
  const body = request.body || "";
  const bodySize = request.body_size || body.length;
  const { text: prettyBody, isJson } = useMemo(() => tryPrettyJson(body), [body]);
  const jwt = useMemo(() => findJWTInText(body), [body]);
  const decodedJWT = useMemo(() => (jwt ? decodeJWT(jwt) : null), [jwt]);
  const base64Decoded = useMemo(() => tryBase64Decode(body), [body]);
  const emlParsed = useMemo(() => parseEML(body), [body]);
  const formData = useMemo(() => parseFormData(body, request.content_type), [body, request.content_type]);
  const hasInspect = !!(decodedJWT || base64Decoded || emlParsed || formData);

  return (
    <div className="h-full flex flex-col">
      <Tabs defaultValue={isJson ? "pretty" : "raw"} className="h-full flex flex-col">
        <div className="border-b px-3 shrink-0 flex items-center justify-between">
          <TabsList className="h-9 bg-transparent">
            <TabsTrigger value="raw" className="text-xs">Raw</TabsTrigger>
            <TabsTrigger value="pretty" className="text-xs">Pretty</TabsTrigger>
            {hasInspect && <TabsTrigger value="inspect" className="text-xs">Inspect</TabsTrigger>}
          </TabsList>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground tabular-nums">{formatBytes(bodySize)}</span>
            {body && <CopyButton text={body} label="Copy Body" />}
          </div>
        </div>

        <TabsContent value="raw" className="flex-1 m-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-3">
              {body ? (
                <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-muted/40 rounded-md p-3 border">{body}</pre>
              ) : (
                <p className="text-sm text-muted-foreground italic">No request body</p>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="pretty" className="flex-1 m-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-3">
              {body ? (
                <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-muted/40 rounded-md p-3 border">{prettyBody}</pre>
              ) : (
                <p className="text-sm text-muted-foreground italic">No request body</p>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {hasInspect && (
          <TabsContent value="inspect" className="flex-1 m-0 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="p-3 space-y-4">
                {decodedJWT && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] bg-amber-500/20 text-amber-400 border-amber-500/30">JWT</Badge>
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">JSON Web Token</span>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase">Header</span>
                        <pre className="text-xs font-mono bg-muted/40 rounded-md p-2 border mt-1 whitespace-pre-wrap break-all">{JSON.stringify(decodedJWT.header, null, 2)}</pre>
                      </div>
                      <div>
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase">Payload</span>
                        <pre className="text-xs font-mono bg-muted/40 rounded-md p-2 border mt-1 whitespace-pre-wrap break-all">{JSON.stringify(decodedJWT.payload, null, 2)}</pre>
                      </div>
                      <div>
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase">Signature</span>
                        <pre className="text-xs font-mono bg-muted/40 rounded-md p-2 border mt-1 break-all">{decodedJWT.signature}</pre>
                      </div>
                    </div>
                  </div>
                )}
                {base64Decoded && !decodedJWT && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] bg-cyan-500/20 text-cyan-400 border-cyan-500/30">B64</Badge>
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Base64 Decoded</span>
                      <CopyButton text={base64Decoded} label="Copy" />
                    </div>
                    <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-muted/40 rounded-md p-3 border">{base64Decoded}</pre>
                  </div>
                )}
                {emlParsed && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] bg-pink-500/20 text-pink-400 border-pink-500/30">EML</Badge>
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email Message</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase">Headers</span>
                      <HeaderTable headers={emlParsed.headers} />
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase">Body</span>
                      <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-muted/40 rounded-md p-3 border mt-1">{emlParsed.body}</pre>
                    </div>
                  </div>
                )}
                {formData && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] bg-violet-500/20 text-violet-400 border-violet-500/30">FORM</Badge>
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Form Data</span>
                    </div>
                    <div className="border rounded-md overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/50">
                            <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground w-[200px]">Field</th>
                            <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground">Value</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {Object.entries(formData).map(([key, val]) => (
                            <tr key={key} className="hover:bg-muted/30">
                              <td className="px-3 py-1.5 font-mono font-medium text-foreground align-top">{key}</td>
                              <td className="px-3 py-1.5 font-mono text-muted-foreground break-all">{val}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ─── Header Table ────────────────────────────────────────
function HeaderTable({ headers }: { headers: Record<string, string[] | string> }) {
  const entries = Object.entries(headers);
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No headers</p>;
  }
  return (
    <div className="border rounded-md overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50">
            <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground w-[200px]">Name</th>
            <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {entries.map(([key, val]) => (
            <tr key={key} className="hover:bg-muted/30">
              <td className="px-3 py-1.5 font-mono font-medium text-foreground align-top">{key}</td>
              <td className="px-3 py-1.5 font-mono text-muted-foreground break-all">{Array.isArray(val) ? val.join(", ") : val}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Detail Row ──────────────────────────────────────────
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs font-medium text-muted-foreground w-[140px] shrink-0">{label}</span>
      <Separator orientation="vertical" className="h-4" />
      <span className="text-xs font-mono break-all">{value}</span>
    </div>
  );
}
