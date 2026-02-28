import { useMemo } from "react";
import type { WebhookRequest } from "@/types";
import { tryPrettyJson, formatBytes } from "@/utils/formatters";
import {
  findJWTInText,
  decodeJWT,
  tryBase64Decode,
  parseEML,
  parseFormData,
} from "@/utils/parsers";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CopyButton from "./CopyButton";
import HeaderTable from "./HeaderTable";

interface BodyPanelProps {
  request: WebhookRequest;
}

export default function BodyPanel({ request }: BodyPanelProps) {
  const body = request.body || "";
  const bodySize = request.body_size || body.length;

  const { text: prettyBody, isJson } = useMemo(
    () => tryPrettyJson(body),
    [body],
  );
  const jwt = useMemo(() => findJWTInText(body), [body]);
  const decodedJWT = useMemo(() => (jwt ? decodeJWT(jwt) : null), [jwt]);
  const base64Decoded = useMemo(() => tryBase64Decode(body), [body]);
  const emlParsed = useMemo(() => parseEML(body), [body]);
  const formData = useMemo(
    () => parseFormData(body, request.content_type),
    [body, request.content_type],
  );

  const hasInspect = !!(decodedJWT || base64Decoded || emlParsed || formData);

  return (
    <div className="h-full flex flex-col">
      <Tabs
        defaultValue={isJson ? "pretty" : "raw"}
        className="h-full flex flex-col"
      >
        {/* Tab bar */}
        <div className="border-b px-3 shrink-0 flex items-center justify-between">
          <TabsList className="h-9 bg-transparent">
            <TabsTrigger value="raw" className="text-xs">
              Raw
            </TabsTrigger>
            <TabsTrigger value="pretty" className="text-xs">
              Pretty
            </TabsTrigger>
            {hasInspect && (
              <TabsTrigger value="inspect" className="text-xs">
                Inspect
              </TabsTrigger>
            )}
          </TabsList>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {formatBytes(bodySize)}
            </span>
            {body && <CopyButton text={body} label="Copy Body" />}
          </div>
        </div>

        {/* Raw */}
        <TabsContent value="raw" className="flex-1 m-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-3">
              {body ? (
                <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-muted/40 rounded-md p-3 border">
                  {body}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  No request body
                </p>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Pretty */}
        <TabsContent value="pretty" className="flex-1 m-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-3">
              {body ? (
                <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-muted/40 rounded-md p-3 border">
                  {prettyBody}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  No request body
                </p>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Inspect */}
        {hasInspect && (
          <TabsContent value="inspect" className="flex-1 m-0 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="p-3 space-y-4">
                {decodedJWT && <JWTSection jwt={decodedJWT} />}

                {base64Decoded && !decodedJWT && (
                  <Base64Section decoded={base64Decoded} />
                )}

                {emlParsed && <EMLSection eml={emlParsed} />}

                {formData && <FormDataSection data={formData} />}
              </div>
            </ScrollArea>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ─── Inspect sub-sections ────────────────────────────────

function JWTSection({
  jwt,
}: {
  jwt: { header: unknown; payload: unknown; signature: string };
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className="text-[10px] bg-amber-500/20 text-amber-400 border-amber-500/30"
        >
          JWT
        </Badge>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          JSON Web Token
        </span>
      </div>

      <div className="space-y-2">
        <CodeBlock label="Header" code={JSON.stringify(jwt.header, null, 2)} />
        <CodeBlock
          label="Payload"
          code={JSON.stringify(jwt.payload, null, 2)}
        />
        <CodeBlock label="Signature" code={jwt.signature} />
      </div>
    </div>
  );
}

function Base64Section({ decoded }: { decoded: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className="text-[10px] bg-cyan-500/20 text-cyan-400 border-cyan-500/30"
        >
          B64
        </Badge>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Base64 Decoded
        </span>
        <CopyButton text={decoded} label="Copy" />
      </div>
      <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-muted/40 rounded-md p-3 border">
        {decoded}
      </pre>
    </div>
  );
}

function EMLSection({ eml }: { eml: { headers: Record<string, string>; body: string } }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className="text-[10px] bg-pink-500/20 text-pink-400 border-pink-500/30"
        >
          EML
        </Badge>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Email Message
        </span>
      </div>
      <div>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase">
          Headers
        </span>
        <HeaderTable headers={eml.headers} />
      </div>
      <div>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase">
          Body
        </span>
        <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-muted/40 rounded-md p-3 border mt-1">
          {eml.body}
        </pre>
      </div>
    </div>
  );
}

function FormDataSection({ data }: { data: Record<string, string> }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className="text-[10px] bg-violet-500/20 text-violet-400 border-violet-500/30"
        >
          FORM
        </Badge>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Form Data
        </span>
      </div>
      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50">
              <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground w-50">
                Field
              </th>
              <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground">
                Value
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {Object.entries(data).map(([key, val]) => (
              <tr key={key} className="hover:bg-muted/30">
                <td className="px-3 py-1.5 font-mono font-medium text-foreground align-top">
                  {key}
                </td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground break-all">
                  {val}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <div>
      <span className="text-[10px] font-semibold text-muted-foreground uppercase">
        {label}
      </span>
      <pre className="text-xs font-mono bg-muted/40 rounded-md p-2 border mt-1 whitespace-pre-wrap break-all">
        {code}
      </pre>
    </div>
  );
}
