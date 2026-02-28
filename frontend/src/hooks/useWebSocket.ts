import { useEffect, useRef, useCallback, useState } from "react";
import type { WebhookRequest } from "@/types";
import { getWebSocketUrl } from "@/lib/api";

const MAX_RECONNECT_DELAY = 30000;
const INITIAL_RECONNECT_DELAY = 1000;

export function useWebSocket(
  endpointId: string | null,
  onMessage: (req: WebhookRequest) => void
): boolean {
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);
  onMessageRef.current = onMessage;

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
  }, []);

  const connect = useCallback(() => {
    if (!endpointId) return;

    // Clean up any existing connection before reconnecting
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }

    const ws = new WebSocket(getWebSocketUrl(endpointId));

    ws.onopen = () => {
      console.log("WebSocket connected");
      setConnected(true);
      reconnectAttemptRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const data: WebhookRequest = JSON.parse(event.data);
        onMessageRef.current(data);
      } catch (e) {
        console.error("Failed to parse WebSocket message:", e);
      }
    };

    ws.onclose = (event) => {
      setConnected(false);
      // Don't reconnect if intentionally closed (code 1000) or component unmounted
      if (event.code === 1000) {
        console.log("WebSocket closed normally");
        return;
      }

      const delay = Math.min(
        INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttemptRef.current),
        MAX_RECONNECT_DELAY
      );
      reconnectAttemptRef.current += 1;
      console.log(`WebSocket disconnected, reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current})...`);
      reconnectTimerRef.current = setTimeout(() => connect(), delay);
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
      // Don't close here - let onclose handle reconnection
    };

    wsRef.current = ws;
  }, [endpointId]);

  useEffect(() => {
    connect();
    return cleanup;
  }, [connect, cleanup]);

  return connected;
}
