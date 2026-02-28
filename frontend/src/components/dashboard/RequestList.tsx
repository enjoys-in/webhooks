import type { WebhookRequest } from "@/types";
import { formatTime, formatBytes } from "@/utils/formatters";
import { METHOD_COLORS } from "@/utils/constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCcw } from "lucide-react";

interface RequestListProps {
  requests: WebhookRequest[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  totalRequests?: number;
  refetchRequests: () => void;
}

export default function RequestList({
  requests,
  selectedId,
  onSelect,
  page,
  totalPages,
  onPageChange,
  searchQuery = "",
  onSearchChange,
  totalRequests,
  refetchRequests,
}: RequestListProps) {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Section header */}
      <div className="px-3 py-2 border-b bg-muted/20 shrink-0 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Requests
        </h2>
       <div className="flex items-center gap-2">
         <Button variant="secondary" className="cursor-pointer" size={"sm"}   onClick={refetchRequests}>
          <RefreshCcw className="w-3 h-3" />
        </Button>
         <div className="flex items-center gap-2">
          {totalRequests != null && (
            <Badge variant="secondary" className="text-[10px] tabular-nums">
              {requests.length}{totalRequests !== requests.length ? ` / ${totalRequests}` : ""}
            </Badge>
          )}
          {totalPages > 1 && (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              Page {page}/{totalPages}
            </span>
          )}
        </div>
       </div>
      </div>

      {/* Search bar */}
      {onSearchChange && (
        <div className="px-3 py-2 border-b shrink-0">
          <div className="relative">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              placeholder="Filter by method, path, body..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-8 pr-8 py-1.5 text-xs bg-background border rounded-md focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" x2="6" y1="6" y2="18" /><line x1="6" x2="18" y1="6" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* List items */}
      <ScrollArea className="flex-1 min-h-0">
        {requests.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground">
            {searchQuery ? (
              <>
                <p className="text-sm">No matching requests.</p>
                <p className="text-xs mt-2">Try a different search term.</p>
              </>
            ) : (
              <>
                <p className="text-sm">No requests yet.</p>
                <p className="text-xs mt-2">
                  Send a request to your webhook URL to see it here.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {requests.map((req) => (
              <button
                key={req.id}
                onClick={() => onSelect(req.id)}
                className={`w-full text-left px-3 py-2.5 hover:bg-accent/50 transition-colors ${
                  selectedId === req.id
                    ? "bg-accent border-l-2 border-l-primary"
                    : "border-l-2 border-l-transparent"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`text-[10px] font-bold px-1.5 py-0 shrink-0 ${METHOD_COLORS[req.method] ?? ""}`}
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
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {formatBytes(req.body_size || req.body?.length || 0)}
                    </span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {req.response_time_ms.toFixed(1)}ms
                    </span>
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
          >
            Prev
          </Button>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {page} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
