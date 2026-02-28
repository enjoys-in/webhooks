import type { WebhookRequest } from "@/types";
import { formatHeaders, formatBytes } from "@/utils/formatters";
import { METHOD_COLORS } from "@/utils/constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CopyButton from "./CopyButton";
import HeaderTable from "./HeaderTable";
import DetailRow from "./DetailRow";
import BodyPanel from "./BodyPanel";

interface RequestDetailProps {
  request: WebhookRequest;
  onBack?: () => void;
}

export default function RequestDetail({ request, onBack }: RequestDetailProps) {
  const bodySize = request.body_size || request.body?.length || 0;

  return (
    <div className="h-full flex flex-col">
      {/* Summary bar */}
      <div className="px-4 py-2.5 border-b bg-muted/20 flex items-center gap-2 md:gap-3 shrink-0 overflow-x-auto">
        {onBack && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="md:hidden shrink-0 -ml-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </Button>
        )}
        <Badge
          variant="outline"
          className={`font-bold ${METHOD_COLORS[request.method] ?? ""}`}
        >
          {request.method}
        </Badge>
        <span className="text-sm font-mono truncate flex-1">
          {request.path}
        </span>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          {new Date(request.timestamp).toLocaleString()}
        </span>
        <Badge variant="secondary" className="tabular-nums hidden sm:inline-flex">
          {request.response_time_ms.toFixed(2)}ms
        </Badge>
        <Badge variant="secondary" className="tabular-nums">
          {formatBytes(bodySize)}
        </Badge>
        <Badge
          variant={request.status_code < 400 ? "default" : "destructive"}
          className="tabular-nums"
        >
          {request.status_code}
        </Badge>
      </div>

      {/* Static vertical split: headers top, body bottom */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Top: headers / query / details tabs */}
        <div className="h-2/5 min-h-0 flex flex-col border-b">
          <Tabs
            defaultValue="request-headers"
            className="h-full flex flex-col"
          >
            <div className="border-b px-3 shrink-0 overflow-x-auto">
              <TabsList className="h-9 bg-transparent">
                <TabsTrigger value="request-headers" className="text-xs">
                  Headers
                </TabsTrigger>
                <TabsTrigger value="response-headers" className="text-xs">
                  Response
                </TabsTrigger>
                <TabsTrigger value="query-params" className="text-xs">
                  Query
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
                      <DetailRow
                        label="Body Size"
                        value={formatBytes(bodySize)}
                      />
                      <DetailRow
                        label="Remote Address"
                        value={request.remote_addr}
                      />
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

        {/* Bottom: body panel */}
        <div className="flex-1 min-h-0">
          <BodyPanel request={request} />
        </div>
      </div>
    </div>
  );
}
