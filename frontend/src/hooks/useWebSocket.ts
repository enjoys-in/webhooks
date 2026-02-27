import { useEffect, useRef, useCallback } from "react";
import type { WebhookRequest } from "@/types";
import { getWebSocketUrl } from "@/lib/api";

export function useWebSocket(
  endpointId: string | null,
  onMessage: (req: WebhookRequest) => void
) {
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (!endpointId) return;

    const ws = new WebSocket(getWebSocketUrl(endpointId));

    ws.onopen = () => {
      console.log("WebSocket connected");
    };

    ws.onmessage = (event) => {
      try {
        const data: WebhookRequest = JSON.parse(event.data);
        onMessageRef.current(data);
      } catch (e) {
        console.error("Failed to parse WebSocket message:", e);
      }
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected, reconnecting in 3s...");
      setTimeout(() => connect(), 3000);
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
      ws.close();
    };

    wsRef.current = ws;
  }, [endpointId]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);
}
