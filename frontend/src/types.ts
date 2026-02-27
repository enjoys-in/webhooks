export interface WebhookRequest {
  id: string;
  method: string;
  path: string;
  headers: Record<string, string[]>;
  query_params: Record<string, string[]>;
  body: string;
  content_type: string;
  content_length: number;
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
