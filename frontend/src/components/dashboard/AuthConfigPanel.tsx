import { useState, useEffect } from "react";
import type { AuthMode, AuthLocation } from "@/types";
import { getEndpointConfig, updateEndpointConfig } from "@/lib/api";
import { Button } from "@/components/ui/button";

// ─── Helpers ─────────────────────────────────────────────

function defaultKeyForMode(mode: AuthMode, loc: AuthLocation): string {
  if (mode === "hmac") return "X-Hub-Signature-256";
  if (loc === "header")
    return mode === "password" ? "X-Webhook-Secret" : "X-API-Key";
  if (loc === "query") return mode === "password" ? "password" : "token";
  if (loc === "body") return mode === "password" ? "password" : "token";
  return "";
}

function modeLabel(m: AuthMode): string {
  if (m === "none") return "Public (No Auth)";
  if (m === "hmac") return "HMAC-SHA256";
  return m.charAt(0).toUpperCase() + m.slice(1);
}

function secretLabel(mode: AuthMode): string {
  if (mode === "password") return "Password";
  if (mode === "token") return "API Token";
  return "HMAC Secret Key";
}

function keyLabel(loc: AuthLocation): string {
  if (loc === "header") return "Header Name";
  if (loc === "query") return "Query Parameter Name";
  return "Body Field Name";
}

function keyHint(loc: AuthLocation, mode: AuthMode): string {
  if (loc === "header" && mode === "hmac")
    return "The header name containing the HMAC signature (e.g. X-Hub-Signature-256)";
  if (loc === "header")
    return "The HTTP header name that will carry the credential value";
  if (loc === "query")
    return "The URL query parameter name (e.g. ?password=xxx)";
  return "The JSON or form field name in the request body";
}

// ─── Types ───────────────────────────────────────────────

interface LocationOption {
  value: AuthLocation;
  label: string;
}

interface AuthConfigPanelProps {
  endpointId: string;
  onClose: () => void;
}

const AUTH_MODES: AuthMode[] = ["none", "password", "token", "hmac"];

// ─── Component ───────────────────────────────────────────

export default function AuthConfigPanel({
  endpointId,
  onClose,
}: AuthConfigPanelProps) {
  const [mode, setMode] = useState<AuthMode>("none");
  const [secret, setSecret] = useState("");
  const [location, setLocation] = useState<AuthLocation>("header");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getEndpointConfig(endpointId)
      .then((cfg) => {
        setMode(cfg.auth_mode);
        setSecret(cfg.auth_secret || "");
        setLocation(cfg.auth_location || "header");
        setKey(cfg.auth_key || "");
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [endpointId]);

  const handleModeChange = (m: AuthMode) => {
    setMode(m);
    if (m === "none") {
      setLocation("header");
      setKey("");
      setSecret("");
    } else if (m === "hmac") {
      setLocation("header");
      setKey((prev) => prev || "X-Hub-Signature-256");
    } else {
      setKey((prev) => prev || defaultKeyForMode(m, location));
    }
  };

  const handleLocationChange = (loc: AuthLocation) => {
    setLocation(loc);
    setKey(defaultKeyForMode(mode, loc));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateEndpointConfig(endpointId, {
        auth_mode: mode,
        auth_secret: secret,
        auth_location: location,
        auth_key: key,
      });
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return (
      <div className="p-4 text-muted-foreground text-sm">Loading...</div>
    );
  }

  const availableLocations: LocationOption[] =
    mode === "hmac"
      ? [{ value: "header", label: "Header" }]
      : [
          { value: "header", label: "Header" },
          { value: "query", label: "Query Param" },
          { value: "body", label: "Body Field" },
        ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border rounded-lg shadow-xl w-full max-w-md p-6 space-y-4">
        {/* Title */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Endpoint Auth Config</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            &times;
          </Button>
        </div>

        <div className="space-y-4">
          {/* Auth Mode */}
          <Section label="Auth Mode">
            <div className="grid grid-cols-2 gap-2">
              {AUTH_MODES.map((m) => (
                <ToggleButton
                  key={m}
                  active={mode === m}
                  onClick={() => handleModeChange(m)}
                >
                  {modeLabel(m)}
                </ToggleButton>
              ))}
            </div>
          </Section>

          {mode !== "none" && (
            <>
              {/* Credential Location */}
              <Section
                label={
                  mode === "hmac" ? "Signature Location" : "Credential Location"
                }
              >
                <div className="flex gap-2">
                  {availableLocations.map((loc) => (
                    <ToggleButton
                      key={loc.value}
                      active={location === loc.value}
                      onClick={() => handleLocationChange(loc.value)}
                      className="flex-1"
                    >
                      {loc.label}
                    </ToggleButton>
                  ))}
                </div>
              </Section>

              {/* Key Name */}
              <Section label={keyLabel(location)}>
                <input
                  type="text"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={defaultKeyForMode(mode, location)}
                  className="w-full px-3 py-2 bg-background border rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="text-xs text-muted-foreground">
                  {keyHint(location, mode)}
                </p>
              </Section>

              {/* Secret */}
              <Section label={secretLabel(mode)}>
                <input
                  type="text"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={`Enter ${mode} secret...`}
                  className="w-full px-3 py-2 bg-background border rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </Section>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || (mode !== "none" && (!secret || !key))}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Small reusable bits ─────────────────────────────────

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
  className = "",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-md border text-sm font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50"
      } ${className}`}
    >
      {children}
    </button>
  );
}
