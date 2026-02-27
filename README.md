# Webhook Catcher

A free, self-hosted webhook testing tool — similar to webhook.site. Generate a unique URL, send HTTP requests to it, and inspect every request in real-time with a two-pane dashboard.

## Architecture

| Component | Stack |
|-----------|-------|
| **Frontend** | Vite + React + TypeScript + shadcn/ui + Tailwind CSS |
| **Backend** | Go (stdlib + gorilla/websocket) |
| **Real-time** | WebSocket for live request streaming |
| **Deploy** | Docker + docker-compose |

## Quick Start

### With Docker Compose

```bash
docker compose up --build
```

Open http://localhost:3000 — the app auto-generates a unique webhook URL.

### Development (without Docker)

**Backend:**
```bash
cd backend
go run .
# Server runs on :8080
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
# Dev server on :5173 with proxy to backend
```

## How It Works

1. On first visit, a unique UUID-based endpoint is created and stored in localStorage
2. Send any HTTP method (GET, POST, PUT, DELETE, PATCH, etc.) to `/webhook/{uuid}`
3. The request is captured and streamed via WebSocket to the dashboard in real-time
4. The two-pane layout shows:
   - **Left pane**: List of all requests with method badge, path, and timestamp
   - **Right pane** (split into two rows):
     - **Upper**: Request headers, response headers, query params, and details (tabbed)
     - **Lower**: Request body with JSON pretty-printing

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/endpoints` | POST | Create a new webhook endpoint |
| `/api/endpoints/{id}` | GET | Get endpoint info |
| `/api/endpoints/{id}/requests` | GET | Get all captured requests |
| `/webhook/{id}` | ANY | Capture a webhook request |
| `/ws/{id}` | WS | Real-time request stream |

## Testing

```bash
# Send a test POST request
curl -X POST http://localhost:3000/send/{your-uuid} \
  -H "Content-Type: application/json" \
  -d '{"hello": "world"}'
```
