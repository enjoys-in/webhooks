export interface WebhookRequest {
  id: string;
  method: string;
  path: string;
  headers: Record<string, string[]>;
  query_params: Record<string, string[]>;
  body: string;
  content_type: string;
  content_length: number;
  body_size: number;
  remote_addr: string;
  host: string;
  timestamp: string;
  response_time_ms: number;
  response_headers: Record<string, string>;
  status_code: number;
}

export interface EndpointInfo {
  id: string;
  url: string;
  created_at: string;
}

export type AuthMode = "none" | "password" | "token" | "hmac";

export type AuthLocation = "header" | "query" | "body";

export interface EndpointConfig {
  auth_mode: AuthMode;
  auth_secret?: string;
  auth_location?: AuthLocation;
  auth_key?: string;
}

export interface PaginatedRequests {
  requests: WebhookRequest[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}
