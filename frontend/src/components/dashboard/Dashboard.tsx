import { useState, useEffect, useCallback, useMemo } from "react";
import type { WebhookRequest, EndpointInfo } from "@/types";
import {
  createEndpoint,
  getRequestsPaginated,
  getWebhookUrl,
  clearRequests,
} from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PAGE_SIZE } from "@/utils/constants";
import { isDarkMode, toggleDarkMode } from "@/utils/theme";
import {
  AuthConfigPanel,
  CopyButton,
  RequestDetail,
  RequestList,
} from "./index";

// ─── Icons ───────────────────────────────────────────────

function LinkIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6 text-primary"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

// ─── Dashboard ───────────────────────────────────────────

// ─── Additional Icons ────────────────────────────────────

function MenuIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1="6" y2="6" />
      <line x1="4" x2="20" y1="18" y2="18" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}

function WifiIcon({ connected }: { connected: boolean }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={connected ? "text-green-500" : "text-red-500"}>
      {connected ? (
        <>
          <path d="M5 12.55a11 11 0 0 1 14.08 0" />
          <path d="M1.42 9a16 16 0 0 1 21.16 0" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <line x1="12" x2="12.01" y1="20" y2="20" />
        </>
      ) : (
        <>
          <line x1="1" x2="23" y1="1" y2="23" />
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
          <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <line x1="12" x2="12.01" y1="20" y2="20" />
        </>
      )}
    </svg>
  );
}

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const selectedRequest = requests.find((r) => r.id === selectedId) ?? null;

  // ── Filter requests by search ──
  const filteredRequests = useMemo(() => {
    if (!searchQuery.trim()) return requests;
    const q = searchQuery.toLowerCase();
    return requests.filter(
      (r) =>
        r.method.toLowerCase().includes(q) ||
        r.path.toLowerCase().includes(q) ||
        r.content_type?.toLowerCase().includes(q) ||
        r.body?.toLowerCase().includes(q)
    );
  }, [requests, searchQuery]);

  // ── Bootstrap endpoint ──

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

  // ── Load paginated requests ──

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

  // ── WebSocket live push ──

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
    [page],
  );

  const wsConnected = useWebSocket(endpoint?.id ?? null, handleWsMessage);

  // ── Actions ──

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

  const handleToggleDark = () => setDarkMode(toggleDarkMode());

  const handleExport = () => {
    if (requests.length === 0) return;
    const data = JSON.stringify(requests, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `webhook-requests-${endpoint?.id?.slice(0, 8) ?? "export"}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Loading gate ──

  if (loading && !endpoint) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const webhookUrl = endpoint ? getWebhookUrl(endpoint.id) : "";

  // ── Render ──

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Header */}
      <header className="border-b px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between bg-card shrink-0 relative">
        <div className="flex items-center gap-2">
          <LinkIcon />
          <h1 className="text-base sm:text-lg font-semibold">Webhook Catcher</h1>
          <div className="flex items-center gap-1 ml-2" title={wsConnected ? "WebSocket connected" : "WebSocket disconnected"}>
            <WifiIcon connected={wsConnected} />
            <span className={`text-[10px] hidden sm:inline ${wsConnected ? "text-green-500" : "text-red-500"}`}>
              {wsConnected ? "Live" : "Offline"}
            </span>
          </div>
        </div>

        {/* Desktop buttons */}
        <div className="hidden sm:flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleDark}
            title="Toggle dark mode"
          >
            {darkMode ? <SunIcon /> : <MoonIcon />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleExport}
            disabled={requests.length === 0}
            title="Export requests as JSON"
          >
            <DownloadIcon />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAuthConfig(true)}
          >
            Auth
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleClearAll}
            disabled={requests.length === 0}
          >
            Clear All
          </Button>
          <Button variant="outline" size="sm" onClick={handleNewEndpoint}>
            New URL
          </Button>
        </div>

        {/* Mobile menu button */}
        <Button
          variant="ghost"
          size="sm"
          className="sm:hidden"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          <MenuIcon />
        </Button>

        {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div className="absolute top-full right-0 z-50 w-48 bg-card border rounded-lg shadow-lg p-2 sm:hidden">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => { handleToggleDark(); setMobileMenuOpen(false); }}
            >
              {darkMode ? <SunIcon /> : <MoonIcon />}
              {darkMode ? "Light Mode" : "Dark Mode"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => { handleExport(); setMobileMenuOpen(false); }}
              disabled={requests.length === 0}
            >
              <DownloadIcon />
              Export JSON
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => { setShowAuthConfig(true); setMobileMenuOpen(false); }}
            >
              Auth Config
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-destructive"
              onClick={() => { handleClearAll(); setMobileMenuOpen(false); }}
              disabled={requests.length === 0}
            >
              Clear All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => { handleNewEndpoint(); setMobileMenuOpen(false); }}
            >
              New URL
            </Button>
          </div>
        )}
      </header>

      {/* URL Bar */}
      <div className="border-b px-3 sm:px-4 py-2 sm:py-2.5 flex items-center gap-2 sm:gap-3 bg-muted/30 shrink-0">
        <span className="text-xs sm:text-sm text-muted-foreground font-medium whitespace-nowrap">
          URL:
        </span>
        <code className="flex-1 text-xs sm:text-sm bg-background border rounded-md px-2 sm:px-3 py-1 sm:py-1.5 font-mono select-all truncate min-w-0">
          {webhookUrl}
        </code>
        <CopyButton text={webhookUrl} label="Copy" />
        <Badge variant="secondary" className="tabular-nums text-[10px] sm:text-xs shrink-0">
          {totalRequests}
        </Badge>
      </div>

      {/* Main two-pane layout */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left sidebar — scrollable independently */}
        <div
          className={`w-full md:w-72 lg:w-80 border-r shrink-0 overflow-hidden ${
            selectedId ? "hidden md:flex" : "flex"
          } flex-col`}
        >
          <RequestList
            requests={filteredRequests}
            selectedId={selectedId}
            onSelect={setSelectedId}
            page={page}
            totalPages={totalPages}
            onPageChange={handlePageChange}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            totalRequests={totalRequests}
          />
        </div>

        {/* Right detail pane — scrollable independently */}
        <div
          className={`flex-1 min-w-0 overflow-hidden ${
            selectedId ? "flex" : "hidden md:flex"
          } flex-col`}
        >
          {selectedRequest ? (
            <RequestDetail
              request={selectedRequest}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <div className="text-center p-4">
                <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                  <LinkIcon />
                </div>
                <p className="text-sm font-medium">No request selected</p>
                <p className="text-xs mt-1">
                  Send a webhook to your URL or select a request from the list
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Close mobile menu on backdrop click */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 sm:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Auth Config Modal */}
      {showAuthConfig && endpoint && (
        <AuthConfigPanel
          endpointId={endpoint.id}
          onClose={() => setShowAuthConfig(false)}
        />
      )}
    </div>
  );
}
