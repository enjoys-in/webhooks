// ─── JWT ─────────────────────────────────────────────────

export interface DecodedJWT {
  header: unknown;
  payload: unknown;
  signature: string;
}

export function decodeJWT(token: string): DecodedJWT | null {
  try {
    const parts = token.trim().split(".");
    if (parts.length !== 3) return null;
    const header = JSON.parse(
      atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")),
    );
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return { header, payload, signature: parts[2] };
  } catch {
    return null;
  }
}

export function findJWTInText(text: string): string | null {
  const match = text.match(
    /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  );
  return match ? match[0] : null;
}

// ─── Base64 ──────────────────────────────────────────────

export function tryBase64Decode(str: string): string | null {
  try {
    if (!/^[A-Za-z0-9+/=\n\r]+$/.test(str.trim())) return null;
    const decoded = atob(str.trim());
    if (/[\x00-\x08\x0E-\x1F]/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

// ─── EML ─────────────────────────────────────────────────

export interface EMLParsed {
  headers: Record<string, string>;
  body: string;
}

export function parseEML(raw: string): EMLParsed | null {
  try {
    const idx =
      raw.indexOf("\r\n\r\n") !== -1
        ? raw.indexOf("\r\n\r\n")
        : raw.indexOf("\n\n");
    if (idx === -1) return null;

    const headerBlock = raw.substring(0, idx);
    const body = raw.substring(idx).trim();
    const headers: Record<string, string> = {};
    const lines = headerBlock.split(/\r?\n/);
    let currentKey = "";

    for (const line of lines) {
      if (/^\s+/.test(line) && currentKey) {
        headers[currentKey] += " " + line.trim();
      } else {
        const colonIndex = line.indexOf(":");
        if (colonIndex > 0) {
          currentKey = line.substring(0, colonIndex).trim();
          headers[currentKey] = line.substring(colonIndex + 1).trim();
        }
      }
    }

    if (!headers["From"] && !headers["Subject"] && !headers["To"]) return null;
    return { headers, body };
  } catch {
    return null;
  }
}

// ─── Form Data ───────────────────────────────────────────

export function parseFormData(
  body: string,
  contentType: string,
): Record<string, string> | null {
  try {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(body);
      const result: Record<string, string> = {};
      for (const [k, v] of params) result[k] = v;
      return Object.keys(result).length > 0 ? result : null;
    }

    if (contentType.includes("multipart/form-data")) {
      const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
      if (!boundaryMatch) return null;
      const boundary = boundaryMatch[1];
      const parts = body
        .split(`--${boundary}`)
        .filter((p) => p.trim() && p.trim() !== "--");
      const result: Record<string, string> = {};

      for (const part of parts) {
        const nameMatch = part.match(/name="([^"]+)"/);
        if (nameMatch) {
          const valStart =
            part.indexOf("\r\n\r\n") !== -1
              ? part.indexOf("\r\n\r\n") + 4
              : part.indexOf("\n\n") + 2;
          result[nameMatch[1]] = part.substring(valStart).trim();
        }
      }

      return Object.keys(result).length > 0 ? result : null;
    }
  } catch {
    /* noop */
  }
  return null;
}
