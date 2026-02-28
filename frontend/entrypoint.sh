#!/bin/sh

# Generate runtime config from environment variables
# This allows configuring API/WS URLs at container start without rebuilding
cat > /app/dist/runtime-config.js << EOF
window.__RUNTIME_CONFIG__ = {
  API_URL: "${API_URL:-}",
  WS_URL: "${WS_URL:-}"
};
EOF

echo "Runtime config generated:"
cat /app/dist/runtime-config.js

exec serve -s dist -l 4173 -c dist/serve.json
