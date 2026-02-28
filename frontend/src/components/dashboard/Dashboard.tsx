import { useState, useEffect, useCallback } from "react";
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

  useWebSocket(endpoint?.id ?? null, handleWsMessage);

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
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="border-b px-4 py-3 flex items-center justify-between bg-card shrink-0">
        <div className="flex items-center gap-2">
          <LinkIcon />
          <h1 className="text-lg font-semibold">Webhook Catcher</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleDark}
            title="Toggle dark mode"
          >
            {darkMode ? <SunIcon /> : <MoonIcon />}
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
      </header>

      {/* URL Bar */}
      <div className="border-b px-4 py-2.5 flex items-center gap-3 bg-muted/30 shrink-0">
        <span className="text-sm text-muted-foreground font-medium whitespace-nowrap">
          Your URL:
        </span>
        <code className="flex-1 text-sm bg-background border rounded-md px-3 py-1.5 font-mono select-all truncate">
          {webhookUrl}
        </code>
        <CopyButton text={webhookUrl} label="Copy URL" />
        <Badge variant="secondary" className="tabular-nums">
          {totalRequests} request{totalRequests !== 1 ? "s" : ""}
        </Badge>
      </div>

      {/* Main two-pane layout */}
      <div className="flex-1 min-h-0 flex">
        {/* Left sidebar — hidden on mobile when a request is selected */}
        <div
          className={`w-full md:w-72 lg:w-80 border-r flex-shrink-0 ${
            selectedId ? "hidden md:flex" : "flex"
          } flex-col`}
        >
          <RequestList
            requests={requests}
            selectedId={selectedId}
            onSelect={setSelectedId}
            page={page}
            totalPages={totalPages}
            onPageChange={handlePageChange}
          />
        </div>

        {/* Right detail pane — hidden on mobile when no request selected */}
        <div
          className={`flex-1 min-w-0 ${
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
              <div className="text-center">
                <p className="text-sm">Select a request to view details</p>
                <p className="text-xs mt-1">
                  Or send a request to your webhook URL
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

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
