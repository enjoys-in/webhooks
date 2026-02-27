import { useState, useEffect, useCallback } from "react";
import type { WebhookRequest, EndpointInfo } from "@/types";
import { createEndpoint, getRequests, getWebhookUrl } from "@/lib/api";
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

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-blue-500/15 text-blue-700 border-blue-300",
  POST: "bg-green-500/15 text-green-700 border-green-300",
  PUT: "bg-yellow-500/15 text-yellow-700 border-yellow-300",
  PATCH: "bg-orange-500/15 text-orange-700 border-orange-300",
  DELETE: "bg-red-500/15 text-red-700 border-red-300",
  HEAD: "bg-purple-500/15 text-purple-700 border-purple-300",
  OPTIONS: "bg-gray-500/15 text-gray-700 border-gray-300",
};

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

function tryPrettyJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleCopy}
      className="h-7 text-xs"
    >
      {copied ? "Copied!" : label}
    </Button>
  );
}

export default function Dashboard() {
  const [endpoint, setEndpoint] = useState<EndpointInfo | null>(null);
  const [requests, setRequests] = useState<WebhookRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const selectedRequest = requests.find((r) => r.id === selectedId) ?? null;

  // Initialize endpoint
  useEffect(() => {
    const stored = localStorage.getItem("webhook_endpoint_id");
    if (stored) {
      setEndpoint({ id: stored, url: `/webhook/${stored}`, created_at: "" });
      getRequests(stored)
        .then((reqs) => {
          setRequests(reqs);
          if (reqs.length > 0) setSelectedId(reqs[0].id);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
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

  // WebSocket for live updates
  const handleWsMessage = useCallback((req: WebhookRequest) => {
    setRequests((prev) => {
      const updated = [req, ...prev.filter((r) => r.id !== req.id)];
      return updated.slice(0, 500);
    });
    setSelectedId((prev) => prev ?? req.id);
  }, []);

  useWebSocket(endpoint?.id ?? null, handleWsMessage);

  const handleNewEndpoint = async () => {
    setLoading(true);
    try {
      const ep = await createEndpoint();
      localStorage.setItem("webhook_endpoint_id", ep.id);
      setEndpoint(ep);
      setRequests([]);
      setSelectedId(null);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
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
            <h1 className="text-lg font-semibold">Webhook Catcher</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
          {requests.length} request{requests.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      {/* Main two-pane layout */}
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup orientation="horizontal">
          {/* Left Panel – Request List */}
          <ResizablePanel defaultSize={"20%"} minSize={"12%"} maxSize={"20%"}>
            <div className="h-full flex flex-col">
              <div className="px-3 py-2 border-b bg-muted/20 shrink-0">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Requests
                </h2>
              </div>
              <ScrollArea className="flex-1">
                {requests.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground">
                    <p className="text-sm">No requests yet.</p>
                    <p className="text-xs mt-2">
                      Send a request to your webhook URL to see it here.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y">
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
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-bold px-1.5 py-0 shrink-0 ${
                              METHOD_COLORS[req.method] ?? ""
                            }`}
                          >
                            {req.method}
                          </Badge>
                          <span className="text-xs text-muted-foreground font-mono truncate flex-1">
                            {req.path}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[10px] text-muted-foreground">
                            {formatTime(req.timestamp)}
                          </span>
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {req.response_time_ms.toFixed(1)}ms
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right Panel – Request Details */}
          <ResizablePanel defaultSize={70}>
            {selectedRequest ? (
              <RequestDetail request={selectedRequest} />
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
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

function RequestDetail({ request }: { request: WebhookRequest }) {
  return (
    <div className="h-full flex flex-col">
      {/* Request summary bar */}
      <div className="px-4 py-2.5 border-b bg-muted/20 flex items-center gap-3 shrink-0">
        <Badge
          variant="outline"
          className={`font-bold ${METHOD_COLORS[request.method] ?? ""}`}
        >
          {request.method}
        </Badge>
        <span className="text-sm font-mono truncate flex-1">
          {request.path}
        </span>
        <span className="text-xs text-muted-foreground">
          {new Date(request.timestamp).toLocaleString()}
        </span>
        <Badge variant="secondary" className="tabular-nums">
          {request.response_time_ms.toFixed(2)}ms
        </Badge>
        <Badge
          variant={request.status_code < 400 ? "default" : "destructive"}
          className="tabular-nums"
        >
          {request.status_code}
        </Badge>
      </div>

      {/* Split into two rows: upper = headers, lower = body */}
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup orientation="vertical">
          {/* Upper: Headers */}
          <ResizablePanel defaultSize={45} minSize={20}>
            <div className="h-full flex flex-col">
              <Tabs defaultValue="request-headers" className="h-full flex flex-col">
                <div className="border-b px-3 shrink-0">
                  <TabsList className="h-9 bg-transparent">
                    <TabsTrigger value="request-headers" className="text-xs">
                      Request Headers
                    </TabsTrigger>
                    <TabsTrigger value="response-headers" className="text-xs">
                      Response Headers
                    </TabsTrigger>
                    <TabsTrigger value="query-params" className="text-xs">
                      Query Params
                    </TabsTrigger>
                    <TabsTrigger value="details" className="text-xs">
                      Details
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent
                  value="request-headers"
                  className="flex-1 m-0 overflow-hidden"
                >
                  <ScrollArea className="h-full">
                    <div className="p-3">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Request Headers
                        </span>
                        <CopyButton
                          text={formatHeaders(request.headers)}
                          label="Copy"
                        />
                      </div>
                      <HeaderTable headers={request.headers} />
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent
                  value="response-headers"
                  className="flex-1 m-0 overflow-hidden"
                >
                  <ScrollArea className="h-full">
                    <div className="p-3">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Response Headers
                        </span>
                        <CopyButton
                          text={formatHeaders(request.response_headers)}
                          label="Copy"
                        />
                      </div>
                      <HeaderTable headers={request.response_headers} />
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent
                  value="query-params"
                  className="flex-1 m-0 overflow-hidden"
                >
                  <ScrollArea className="h-full">
                    <div className="p-3">
                      {Object.keys(request.query_params).length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No query parameters
                        </p>
                      ) : (
                        <HeaderTable headers={request.query_params} />
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent
                  value="details"
                  className="flex-1 m-0 overflow-hidden"
                >
                  <ScrollArea className="h-full">
                    <div className="p-3 space-y-2">
                      <DetailRow label="Request ID" value={request.id} />
                      <DetailRow label="Method" value={request.method} />
                      <DetailRow label="Path" value={request.path} />
                      <DetailRow
                        label="Content-Type"
                        value={request.content_type || "N/A"}
                      />
                      <DetailRow
                        label="Content-Length"
                        value={String(request.content_length)}
                      />
                      <DetailRow label="Remote Address" value={request.remote_addr} />
                      <DetailRow label="Host" value={request.host} />
                      <DetailRow
                        label="Response Time"
                        value={`${request.response_time_ms.toFixed(2)}ms`}
                      />
                      <DetailRow
                        label="Status Code"
                        value={String(request.status_code)}
                      />
                      <DetailRow
                        label="Timestamp"
                        value={new Date(request.timestamp).toISOString()}
                      />
                    </div>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Lower: Body */}
          <ResizablePanel defaultSize={55} minSize={20}>
            <div className="h-full flex flex-col">
              <div className="border-b px-3 py-2 flex items-center justify-between shrink-0">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Request Body
                </span>
                {request.body && (
                  <CopyButton text={request.body} label="Copy Body" />
                )}
              </div>
              <ScrollArea className="flex-1">
                <div className="p-3">
                  {request.body ? (
                    <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-muted/40 rounded-md p-3 border">
                      {tryPrettyJson(request.body)}
                    </pre>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      No request body
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

function HeaderTable({
  headers,
}: {
  headers: Record<string, string[] | string>;
}) {
  const entries = Object.entries(headers);
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No headers</p>;
  }
  return (
    <div className="border rounded-md overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50">
            <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground w-[200px]">
              Name
            </th>
            <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground">
              Value
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {entries.map(([key, val]) => (
            <tr key={key} className="hover:bg-muted/30">
              <td className="px-3 py-1.5 font-mono font-medium text-foreground align-top">
                {key}
              </td>
              <td className="px-3 py-1.5 font-mono text-muted-foreground break-all">
                {Array.isArray(val) ? val.join(", ") : val}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs font-medium text-muted-foreground w-[140px] shrink-0">
        {label}
      </span>
      <Separator orientation="vertical" className="h-4" />
      <span className="text-xs font-mono break-all">{value}</span>
    </div>
  );
}
