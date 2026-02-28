export function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatHeaders(
  headers: Record<string, string[] | string>,
): string {
  return Object.entries(headers)
    .map(([key, val]) => {
      const value = Array.isArray(val) ? val.join(", ") : val;
      return `${key}: ${value}`;
    })
    .join("\n");
}

export function tryPrettyJson(str: string): {
  text: string;
  isJson: boolean;
} {
  try {
    const parsed = JSON.parse(str);
    return { text: JSON.stringify(parsed, null, 2), isJson: true };
  } catch {
    return { text: str, isJson: false };
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
