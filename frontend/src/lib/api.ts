import type { EndpointInfo, WebhookRequest, PaginatedRequests, EndpointConfig } from "@/types";

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

export async function getRequestsPaginated(
  endpointId: string,
  page: number = 1,
  perPage: number = 100
): Promise<PaginatedRequests> {
  const res = await fetch(
    `${API_BASE}/api/endpoints/${endpointId}/requests/page?page=${page}&per_page=${perPage}`
  );
  if (!res.ok) throw new Error("Failed to fetch paginated requests");
  return res.json();
}

export async function clearRequests(endpointId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/endpoints/${endpointId}/requests`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to clear requests");
}

export async function getEndpointConfig(endpointId: string): Promise<EndpointConfig> {
  const res = await fetch(`${API_BASE}/api/endpoints/${endpointId}/config`);
  if (!res.ok) throw new Error("Failed to fetch config");
  return res.json();
}

export async function updateEndpointConfig(
  endpointId: string,
  config: EndpointConfig
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/endpoints/${endpointId}/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error("Failed to update config");
}

export function getWebSocketUrl(endpointId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsBase = import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`;
  return `${wsBase}/ws/${endpointId}`;
}

export function getWebhookUrl(endpointId: string): string {
  return `${window.location.origin}/send/${endpointId}`;
}
