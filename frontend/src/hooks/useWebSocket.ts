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
  const keepaliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const closingRef = useRef(false); // true only when WE intentionally close
  const [connected, setConnected] = useState(false);
  onMessageRef.current = onMessage;

  const cleanup = useCallback(() => {
    closingRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (keepaliveRef.current) {
      clearInterval(keepaliveRef.current);
      keepaliveRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
        wsRef.current.close(1000, "cleanup");
      }
      wsRef.current = null;
    }
    setConnected(false);
  }, []);

  const connect = useCallback(() => {
    if (!endpointId) return;

    // Clean up any existing connection before reconnecting
    if (keepaliveRef.current) {
      clearInterval(keepaliveRef.current);
      keepaliveRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }

    closingRef.current = false;

    const ws = new WebSocket(getWebSocketUrl(endpointId));

    ws.onopen = () => {
      console.log("WebSocket connected");
      setConnected(true);
      reconnectAttemptRef.current = 0;
    };

    // Client-side keepalive: send a text ping every 25s to prevent idle timeouts
    keepaliveRef.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send("ping");
      }
    }, 25000);

    ws.onmessage = (event) => {
      try {
        const data: WebhookRequest = JSON.parse(event.data);
        onMessageRef.current(data);
      } catch (e) {
        // Catch both JSON parse errors AND callback errors to prevent
        // unhandled exceptions from crashing React and tearing down the WS
        console.error("WebSocket message handler error:", e);
      }
    };

    ws.onclose = (event) => {
      setConnected(false);
      console.log(
        `WebSocket closed: code=${event.code} reason=${event.reason} intentional=${closingRef.current}`
      );

      // Only skip reconnection if WE intentionally closed the connection.
      // Don't rely on close codes — proxies/servers can send 1000 unexpectedly.
      if (closingRef.current) {
        return;
      }

      const delay = Math.min(
        INITIAL_RECONNECT_DELAY *
          Math.pow(2, reconnectAttemptRef.current),
        MAX_RECONNECT_DELAY
      );
      reconnectAttemptRef.current += 1;
      console.log(
        `WebSocket reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current})...`
      );
      reconnectTimerRef.current = setTimeout(() => connect(), delay);
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
    };

    wsRef.current = ws;
  }, [endpointId]);

  useEffect(() => {
    connect();
    return cleanup;
  }, [connect, cleanup]);

  return connected;
}
