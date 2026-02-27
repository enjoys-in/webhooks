import type { EndpointInfo, WebhookRequest } from "@/types";

const API_BASE = import.meta.env.VITE_API_URL || "";

export async function createEndpoint(): Promise<EndpointInfo> {
  const res = await fetch(`${API_BASE}/api/endpoints`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to create endpoint");
  return res.json();
}

export async function getRequests(endpointId: string): Promise<WebhookRequest[]> {
  const res = await fetch(`${API_BASE}/api/endpoints/${endpointId}/requests`);
  if (!res.ok) throw new Error("Failed to fetch requests");
  return res.json();
}

export function getWebSocketUrl(endpointId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsBase = import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`;
  return `${wsBase}/ws/${endpointId}`;
}

export function getWebhookUrl(endpointId: string): string {
  return `${window.location.origin}/send/${endpointId}`;
}
