'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  Zap,
  ChevronDown,
  ChevronUp,
  Keyboard,
  Binary,
  Check,
  Search,
  X,
  Sparkles,
} from "lucide-react";
import {
  PageHeader,
  ListenerPill,
  btnPrimary,
  btnOutline,
  mono,
} from "@/components/ui";
import RequestEditor, {
  HttpViewer,
  type RequestEditorHandle,
} from "@/components/RequestEditor";
import {
  takeRepeaterInbox,
  sendToIntruder,
  type RepeaterImport,
} from "@/components/repeaterBridge";
import { openGeminiAIWith } from "@/components/geminiAI-bridge";

// ------------------------------ Config ------------------------------

const API = "http://127.0.0.1:8765";
const TABS_KEY = "packetsniff.repeater.tabs";
const SPLIT_KEY = "packetsniff.repeater.splitPct";

const SPLIT_MIN = 20;
const SPLIT_MAX = 80;
const SPLIT_DEFAULT = 50;

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH"]);

const HTTP1_ONLY_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
]);

// ------------------------------ Types ------------------------------

type RepeaterTab = {
  id: string;
  target: string;
  raw: string;
  verifyTls: boolean;
  orig?: { text: string; base64: string };
};

type RepeaterResult = {
  url: string;
  status_code: number;
  reason: string;
  http_version: string;
  headers: [string, string][];
  body_base64: string;
  body_decoded_base64: string | null;
  content_encoding: string;
  decode_error: string | null;
  duration_ms: number;
  size_raw: number;
  size_decoded: number;
};

type TabResponse = RepeaterResult & { received_at: number };

type EncodeOp =
  | "url-encode"
  | "url-decode"
  | "base64-encode"
  | "base64-decode"
  | "html-encode"
  | "html-decode";

const responseCache = new Map<string, TabResponse>();

// ------------------------------ Helpers ------------------------------

function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

function base64ToText(value: string | null | undefined): string {
  if (!value) return "";

  return new TextDecoder("utf-8").decode(base64ToBytes(value));
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function statusColor(code: number): string {
  if (code >= 500) return "text-rose-300";
  if (code >= 400) return "text-amber-300";
  if (code >= 300) return "text-sky-300";
  return "text-emerald-300";
}

function clampSplit(value: number) {
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value));
}

function blankTab(): RepeaterTab {
  return {
    id: newId(),
    target: "https://example.com",
    verifyTls: true,
    raw:
      "GET / HTTP/1.1\n" +
      "Host: example.com\n" +
      "User-Agent: PacketSniffer\n" +
      "Accept: */*\n" +
      "\n",
  };
}

function tabLabel(tab: RepeaterTab, index: number): string {
  const firstLine = tab.raw.split("\n", 1)[0].trim();
  const match = firstLine.match(/^(\S+)\s+(\S+)/);

  if (!match) return `Request ${index + 1}`;

  return `${match[1].toUpperCase()} ${match[2]}`;
}

function importToTab(item: RepeaterImport): RepeaterTab | null {
  let parsed: URL;

  try {
    parsed = new URL(item.url);
  } catch {
    return null;
  }

  const path = `${parsed.pathname}${parsed.search}` || "/";
  const bodyText = base64ToText(item.body_base64).replace(/\r\n/g, "\n");

  const raw = [
    `${item.method.toUpperCase()} ${path} HTTP/1.1`,
    ...item.headers.map(([key, value]) => `${key}: ${value}`),
    "",
    bodyText,
  ].join("\n");

  return {
    id: newId(),
    target: parsed.origin,
    verifyTls: true,
    raw,
    orig: { text: bodyText, base64: item.body_base64 },
  };
}

// ---------------- Raw request parsing / rewriting ----------------

function splitRawRequest(raw: string): {
  requestLine: string;
  headerLines: string[];
  body: string;
} {
  const normalized = raw.replace(/\r\n/g, "\n");
  const separator = normalized.indexOf("\n\n");

  const headerSection =
    separator === -1 ? normalized : normalized.slice(0, separator);
  const body = separator === -1 ? "" : normalized.slice(separator + 2);

  const lines = headerSection.split("\n");
  const requestLine = (lines.shift() ?? "").trim();

  return {
    requestLine,
    headerLines: lines.filter((line) => line.trim() !== ""),
    body,
  };
}

function joinRawRequest(
  requestLine: string,
  headerLines: string[],
  body: string
): string {
  return [requestLine, ...headerLines, "", body].join("\n");
}

function headerName(line: string): string | null {
  const colon = line.indexOf(":");
  if (colon <= 0) return null;
  return line.slice(0, colon).trim().toLowerCase();
}

function getHeader(headerLines: string[], name: string): string | undefined {
  const lower = name.toLowerCase();

  for (const line of headerLines) {
    if (headerName(line) === lower) {
      return line.slice(line.indexOf(":") + 1).trim();
    }
  }

  return undefined;
}

function setHeader(
  headerLines: string[],
  name: string,
  value: string | null
): string[] {
  const lower = name.toLowerCase();
  const filtered = headerLines.filter((line) => headerName(line) !== lower);

  return value === null ? filtered : [...filtered, `${name}: ${value}`];
}

function removeHeaders(headerLines: string[], names: string[]): string[] {
  const set = new Set(names.map((n) => n.toLowerCase()));
  return headerLines.filter((line) => {
    const name = headerName(line);
    return name === null || !set.has(name);
  });
}

function parseMethod(raw: string): string {
  const firstLine = raw.replace(/\r\n/g, "\n").split("\n", 1)[0].trim();
  const match = firstLine.match(/^(\S+)/);
  return match ? match[1].toUpperCase() : "GET";
}

function parseHttpVersion(raw: string): "HTTP/1.1" | "HTTP/2" {
  const firstLine = raw.replace(/\r\n/g, "\n").split("\n", 1)[0];
  return firstLine.includes("HTTP/2") ? "HTTP/2" : "HTTP/1.1";
}

function titleCaseHeaderName(name: string): string {
  return name
    .split("-")
    .map((part) =>
      part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part
    )
    .join("-");
}

function setHttpVersion(
  raw: string,
  version: "HTTP/1.1" | "HTTP/2",
  target?: string
): string {
  const { requestLine, headerLines, body } = splitRawRequest(raw);
  const match = requestLine.match(/^(\S+)\s+(\S+)(?:\s+HTTP\/\d(?:\.\d)?)?$/);

  if (!match) return raw;

  let nextHeaders: string[];

  if (version === "HTTP/2") {
    nextHeaders = headerLines
      .filter((line) => {
        const name = headerName(line);
        return name === null || !HTTP1_ONLY_HEADERS.has(name);
      })
      .map((line) => {
        const colon = line.indexOf(":");
        if (colon <= 0) return line;
        return `${line.slice(0, colon).trim().toLowerCase()}:${line.slice(colon + 1)}`;
      });
  } else {
    nextHeaders = headerLines.map((line) => {
      const colon = line.indexOf(":");
      if (colon <= 0) return line;
      return `${titleCaseHeaderName(line.slice(0, colon).trim())}:${line.slice(colon + 1)}`;
    });

    if (getHeader(nextHeaders, "host") === undefined && target) {
      try {
        nextHeaders = [`Host: ${new URL(target.trim()).host}`, ...nextHeaders];
      } catch {
        // Target is not a valid URL yet; leave the headers alone.
      }
    }
  }

  return joinRawRequest(
    `${match[1]} ${match[2]} ${version}`,
    nextHeaders,
    body
  );
}

function convertMethod(
  raw: string,
  nextMethodRaw: string
): { raw: string; note?: string } {
  const nextMethod = nextMethodRaw.toUpperCase();
  const { requestLine, headerLines, body } = splitRawRequest(raw);
  const match = requestLine.match(/^(\S+)\s+(\S+)(\s+HTTP\/\d(?:\.\d)?)?$/);

  if (!match) {
    return {
      raw,
      note: "Could not read the request line, so the method was not changed.",
    };
  }

  const currentMethod = match[1].toUpperCase();

  if (currentMethod === nextMethod) return { raw };

  const path = match[2];
  const versionSuffix = match[3] ?? " HTTP/1.1";

  const hadBody = METHODS_WITH_BODY.has(currentMethod);
  const willHaveBody = METHODS_WITH_BODY.has(nextMethod);

  const q = path.indexOf("?");
  const pathname = q < 0 ? path : path.slice(0, q);
  const search = q < 0 ? "" : path.slice(q + 1);

  let nextPath = path;
  let nextHeaders = headerLines;
  let nextBody = body;
  let note: string | undefined;

  if (hadBody && !willHaveBody) {
    const trimmed = body.trim();
    const contentType = (getHeader(headerLines, "content-type") ?? "").toLowerCase();
    const looksFormEncoded =
      contentType.includes("x-www-form-urlencoded") ||
      (!contentType && /^[^=&]+=[^&]*(&[^=&]+=[^&]*)*$/.test(trimmed));

    if (trimmed && looksFormEncoded) {
      const combined = search ? `${search}&${trimmed}` : trimmed;
      nextPath = `${pathname}?${combined}`;
    } else if (trimmed) {
      note = `${nextMethod} has no body — the body was dropped (it wasn't form-encoded, so it couldn't be moved into the query string).`;
    }

    nextBody = "";
    nextHeaders = removeHeaders(nextHeaders, [
      "Content-Length",
      "Content-Type",
      "Transfer-Encoding",
    ]);
  } else if (!hadBody && willHaveBody) {
    if (!body.trim() && search) {
      nextPath = pathname;
      nextBody = search;
      nextHeaders = setHeader(
        nextHeaders,
        "Content-Type",
        "application/x-www-form-urlencoded"
      );
    } else if (getHeader(nextHeaders, "content-type") === undefined) {
      nextHeaders = setHeader(
        nextHeaders,
        "Content-Type",
        "application/x-www-form-urlencoded"
      );
    }

    nextHeaders = setHeader(
      nextHeaders,
      "Content-Length",
      String(byteLength(nextBody))
    );
  }

  const nextRequestLine = `${nextMethod} ${nextPath}${versionSuffix}`;
  return { raw: joinRawRequest(nextRequestLine, nextHeaders, nextBody), note };
}

function buildPayload(tab: RepeaterTab) {
  const { requestLine, headerLines, body: bodyText } = splitRawRequest(tab.raw);

  const match = requestLine.match(
    /^([A-Za-z0-9!#$%&'*+.^_`|~-]+)\s+(\S+)(?:\s+(HTTP\/\d(?:\.\d)?))?$/
  );

  if (!match) {
    throw new Error("Invalid request line. Expected: METHOD /path HTTP/1.1");
  }

  const orig = tab.orig;
  const bodyUnchanged = orig !== undefined && orig.text === bodyText;

  const bodyLength = bodyUnchanged
    ? base64ToBytes(orig.base64).length
    : byteLength(bodyText);

  const headers: [string, string][] = [];

  for (const line of headerLines) {
    const colon = line.indexOf(":");

    if (colon <= 0) {
      throw new Error(`Invalid HTTP header: ${line}`);
    }

    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();

    headers.push([
      name,
      name.toLowerCase() === "content-length" ? String(bodyLength) : value,
    ]);
  }

  let url: string;

  try {
    url = new URL(match[2], tab.target.trim()).toString();
  } catch {
    throw new Error(
      "Invalid target. Example: https://example.com or http://127.0.0.1:3000"
    );
  }

  const protocol = new URL(url).protocol;

  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("Only http:// and https:// targets are supported.");
  }

  const httpVersion = (match[3] ?? "HTTP/1.1").replace("HTTP/", "");

  return {
    method: match[1].toUpperCase(),
    url,
    headers,
    body_base64: bodyUnchanged ? orig.base64 : utf8ToBase64(bodyText),
    verify_tls: tab.verifyTls,
    timeout: 30,
    http_version: httpVersion,
  };
}

// ---------------- Encode / decode transforms ----------------

function urlEncodeSelection(text: string): string {
  return encodeURIComponent(text);
}
function urlDecodeSelection(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
function base64EncodeSelection(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function base64DecodeSelection(text: string): string {
  try {
    const binary = atob(text.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return text;
  }
}
function htmlEncodeSelection(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
function htmlDecodeSelection(text: string): string {
  const map: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    "#x27": "'",
    "#39": "'",
  };
  return text.replace(
    /&(amp|lt|gt|quot|#x27|#39);/g,
    (full, entity: string) => map[entity] ?? full
  );
}

const ENCODE_TRANSFORMS: Record<EncodeOp, (text: string) => string> = {
  "url-encode": urlEncodeSelection,
  "url-decode": urlDecodeSelection,
  "base64-encode": base64EncodeSelection,
  "base64-decode": base64DecodeSelection,
  "html-encode": htmlEncodeSelection,
  "html-decode": htmlDecodeSelection,
};

// ---------------- Shortcut definitions ----------------

type ShortcutItem = { label: string; keys: string[] };

const ENCODE_MENU: { op: EncodeOp; label: string; keys: string[] }[] = [
  { op: "url-encode", label: "URL-encode", keys: ["Mod", "Shift", "U"] },
  { op: "url-decode", label: "URL-decode", keys: ["Mod", "Alt", "U"] },
  { op: "base64-encode", label: "Base64-encode", keys: ["Mod", "Shift", "B"] },
  { op: "base64-decode", label: "Base64-decode", keys: ["Mod", "Alt", "B"] },
  { op: "html-encode", label: "HTML-encode", keys: ["Mod", "Shift", "H"] },
  { op: "html-decode", label: "HTML-decode", keys: ["Mod", "Alt", "H"] },
];

const SHORTCUT_GROUPS: { title: string; items: ShortcutItem[] }[] = [
  {
    title: "Request",
    items: [
      { label: "Send request", keys: ["Mod", "Enter"] },
      { label: "Send to Intruder", keys: ["Mod", "I"] },
      { label: "Cycle HTTP method", keys: ["Mod", "Shift", "M"] },
      { label: "Toggle HTTP/1.1 ↔ HTTP/2", keys: ["Mod", "Shift", "2"] },
    ],
  },
  {
    title: "Response",
    items: [{ label: "Find in response", keys: ["Mod", "F"] }],
  },
  {
    title: "Selected text",
    items: ENCODE_MENU.map((e) => ({ label: e.label, keys: e.keys })),
  },
];

// ------------------------ Small UI pieces ------------------------

function useIsMac(): boolean {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/i.test(navigator.platform));
  }, []);

  return isMac;
}

function formatKey(key: string, isMac: boolean): string {
  if (key === "Mod") return isMac ? "⌘" : "Ctrl";
  if (key === "Shift") return isMac ? "⇧" : "Shift";
  if (key === "Alt") return isMac ? "⌥" : "Alt";
  if (key === "Enter") return isMac ? "↵" : "Enter";
  return key;
}

function Keys({ keys }: { keys: string[] }) {
  const isMac = useIsMac();

  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {keys.map((key) => (
        <kbd
          key={key}
          className={`${mono.className} inline-flex min-w-[22px] items-center justify-center rounded-[5px] border border-white/[0.14] border-b-white/[0.22] bg-white/[0.07] px-1.5 py-[2px] text-[10.5px] font-medium leading-none text-[#c8c8d4] shadow-[0_1px_0_rgba(0,0,0,0.5)]`}
        >
          {formatKey(key, isMac)}
        </kbd>
      ))}
    </span>
  );
}

function Tip({
  label,
  keys,
  align = "center",
  children,
}: {
  label: string;
  keys?: string[];
  align?: "start" | "center" | "end";
  children: ReactNode;
}) {
  const position =
    align === "start"
      ? "left-0"
      : align === "end"
        ? "right-0"
        : "left-1/2 -translate-x-1/2";

  return (
    <span className="group relative inline-flex">
      {children}

      <span
        role="tooltip"
        className={`pointer-events-none invisible absolute top-[calc(100%+8px)] z-40 ${position} flex items-center gap-2.5 whitespace-nowrap rounded-lg border border-white/[0.1] bg-[#1c1c20] px-2.5 py-1.5 text-[12px] text-[#d8d8e0] opacity-0 shadow-xl shadow-black/50 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-hover:delay-300 group-focus-visible:visible group-focus-visible:opacity-100`}
      >
        <span>{label}</span>
        {keys && <Keys keys={keys} />}
      </span>
    </span>
  );
}

function ShortcutsButton() {
  return (
    <div className="group relative">
      <button
        type="button"
        aria-label="Keyboard shortcuts"
        aria-describedby="repeater-shortcuts-panel"
        className={`${btnOutline} inline-flex !h-9 !w-9 items-center justify-center !px-0`}
      >
        <Keyboard size={15} />
      </button>

      <div
        id="repeater-shortcuts-panel"
        role="tooltip"
        className="pointer-events-none invisible absolute right-0 top-[calc(100%+8px)] z-40 w-[330px] rounded-xl border border-white/[0.1] bg-[#1c1c20] p-3.5 opacity-0 shadow-2xl shadow-black/60 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#8a8a98]">
          Keyboard shortcuts
        </p>

        <div className="space-y-3.5">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="mb-1.5 text-[11px] font-medium text-emerald-300/90">
                {group.title}
              </p>

              <ul className="space-y-1.5">
                {group.items.map((item) => (
                  <li
                    key={item.label}
                    className="flex items-center justify-between gap-4 text-[12.5px] text-[#c4c4ce]"
                  >
                    <span>{item.label}</span>
                    <Keys keys={item.keys} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-3 border-t border-white/[0.08] pt-2.5 text-[11.5px] leading-4 text-[#777784]">
          Select text in the request editor first, then use an encode or
          decode shortcut.
        </p>
      </div>
    </div>
  );
}

// ------------------------ Response display ------------------------

type Classified = { displayType: string; mime: string };

function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;

  let suspicious = 0;

  for (const byte of bytes) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious++;
  }

  return suspicious / bytes.length < 0.1;
}

function classifyResponse(
  contentType: string,
  bodyBase64: string
): Classified {
  const mime = contentType.split(";")[0].trim().toLowerCase();

  if (!bodyBase64) {
    return { displayType: "empty", mime: mime || "application/octet-stream" };
  }

  if (mime.startsWith("image/")) return { displayType: "image", mime };
  if (mime === "application/pdf") return { displayType: "pdf", mime };

  if (
    mime === "application/json" ||
    mime === "text/json" ||
    mime.endsWith("+json")
  ) {
    return { displayType: "json", mime };
  }

  if (mime === "text/html" || mime === "application/xhtml+xml") {
    return { displayType: "html", mime };
  }

  if (mime.includes("xml")) return { displayType: "xml", mime };

  if (
    mime.startsWith("text/") ||
    mime === "application/javascript" ||
    mime === "application/x-javascript" ||
    mime === "application/ecmascript" ||
    mime === "application/x-www-form-urlencoded"
  ) {
    return { displayType: "text", mime };
  }

  const head = base64ToBytes(bodyBase64.slice(0, 704));

  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e) {
    return { displayType: "image", mime: "image/png" };
  }

  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { displayType: "image", mime: "image/jpeg" };
  }

  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) {
    return { displayType: "image", mime: "image/gif" };
  }

  if (
    head[0] === 0x25 &&
    head[1] === 0x50 &&
    head[2] === 0x44 &&
    head[3] === 0x46
  ) {
    return { displayType: "pdf", mime: "application/pdf" };
  }

  return {
    displayType: looksLikeText(head) ? "text" : "binary",
    mime: mime || "application/octet-stream",
  };
}

function responseHead(result: RepeaterResult): string {
  const statusLine =
    `HTTP/${result.http_version} ${result.status_code} ${result.reason}`.trim();

  return [
    statusLine,
    ...result.headers.map(([key, value]) => `${key}: ${value}`),
  ].join("\n");
}

// ------------------------------ Toolbar menu ------------------------------

type MenuItem = {
  key: string;
  label: string;
  keys?: string[];
  active?: boolean;
  onClick: () => void;
};

function ToolbarMenu({
  label,
  icon,
  items,
  footer,
  widthClass = "w-48",
}: {
  label: ReactNode;
  icon?: ReactNode;
  items: MenuItem[];
  footer?: string;
  widthClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const keepEditorFocus = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onMouseDown={keepEditorFocus}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`${btnOutline} inline-flex items-center gap-1.5 !h-9 !px-3 !text-[12px]`}
      >
        {icon}
        <span className={mono.className}>{label}</span>
        <ChevronDown
          size={13}
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          onMouseDown={keepEditorFocus}
          className={`absolute left-0 top-[calc(100%+6px)] z-30 ${widthClass} overflow-hidden rounded-xl border border-white/[0.1] bg-[#1c1c20] py-1.5 shadow-2xl shadow-black/60`}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="option"
              aria-selected={!!item.active}
              onClick={() => {
                item.onClick();
                setOpen(false);
              }}
              className={`mx-1.5 flex w-[calc(100%-12px)] items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-[12.5px] transition-colors hover:bg-white/[0.07] hover:text-white ${item.active ? "text-emerald-300" : "text-[#c4c4ce]"
                }`}
            >
              <span className="inline-flex items-center gap-2">
                {item.active ? (
                  <Check size={13} className="shrink-0" />
                ) : (
                  <span className="inline-block w-[13px] shrink-0" />
                )}
                <span className={item.active ? mono.className : ""}>
                  {item.label}
                </span>
              </span>

              {item.keys && <Keys keys={item.keys} />}
            </button>
          ))}

          {footer && (
            <p className="mx-1.5 mt-1 border-t border-white/[0.08] px-2.5 pb-1 pt-2 text-[11px] leading-4 text-[#777784]">
              {footer}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------ Find bar ------------------------------

type FindBarProps = {
  visible: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  matchCount: number;
  currentMatch: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
};

function FindBar({
  visible,
  search,
  onSearchChange,
  matchCount,
  currentMatch,
  onPrev,
  onNext,
  onClose,
}: FindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible) {
      const t = window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(t);
    }
  }, [visible]);

  if (!visible) return null;

  const hasQuery = search.length > 0;
  const statusText = !hasQuery
    ? "Type to search"
    : matchCount === 0
      ? "No matches"
      : `${currentMatch} / ${matchCount}`;

  return (
    <div
      role="search"
      className="flex shrink-0 items-center gap-2 border-b border-white/[0.08] bg-[#111113] px-3 py-1.5"
    >
      <Search size={13} className="shrink-0 text-[#6c6c78]" />

      <input
        ref={inputRef}
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          }
        }}
        placeholder="Find in response..."
        spellCheck={false}
        className="h-7 min-w-0 flex-1 rounded-md border border-white/[0.1] bg-[#141416] px-2.5 text-[12.5px] text-white outline-none placeholder:text-[#6c6c78] focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20"
      />

      <span className="shrink-0 text-[11.5px] tabular-nums text-[#8a8a98]">
        {statusText}
      </span>

      <button
        type="button"
        onClick={onPrev}
        disabled={matchCount === 0}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#b5b5c2] transition-colors hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronUp size={14} />
      </button>

      <button
        type="button"
        onClick={onNext}
        disabled={matchCount === 0}
        title="Next match (Enter)"
        aria-label="Next match"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#b5b5c2] transition-colors hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronDown size={14} />
      </button>

      <button
        type="button"
        onClick={onClose}
        title="Close (Esc)"
        aria-label="Close find bar"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#b5b5c2] transition-colors hover:bg-white/[0.06] hover:text-white"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ------------------------------ Page ------------------------------

export default function RepeaterPage() {
  const router = useRouter();

  const [ready, setReady] = useState(false);
  const [tabs, setTabs] = useState<RepeaterTab[]>([]);
  const [activeId, setActiveId] = useState("");

  const [responses, setResponses] = useState<Record<string, TabResponse>>(
    () => Object.fromEntries(responseCache)
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<Set<string>>(new Set());

  // Resizable split
  const splitRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<RequestEditorHandle>(null);
  const [splitPct, setSplitPct] = useState(SPLIT_DEFAULT);
  const [dragging, setDragging] = useState(false);

  // Find-in-response state
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const findInputAnchorRef = useRef<HTMLDivElement>(null);

  // ---------------- Load saved tabs and imported requests ----------------

  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    let saved: RepeaterTab[] = [];
    let savedActive = "";

    try {
      const stored = window.localStorage.getItem(TABS_KEY);

      if (stored) {
        const parsed = JSON.parse(stored);

        if (Array.isArray(parsed?.tabs)) {
          saved = parsed.tabs.filter(
            (tab: unknown): tab is RepeaterTab =>
              !!tab &&
              typeof (tab as RepeaterTab).id === "string" &&
              typeof (tab as RepeaterTab).raw === "string" &&
              typeof (tab as RepeaterTab).target === "string"
          );
        }

        if (typeof parsed?.activeId === "string") {
          savedActive = parsed.activeId;
        }
      }

      const savedSplit = window.localStorage.getItem(SPLIT_KEY);

      if (savedSplit !== null && Number.isFinite(Number(savedSplit))) {
        setSplitPct(clampSplit(Number(savedSplit)));
      }
    } catch {
      // Ignore unreadable storage.
    }

    const imported = takeRepeaterInbox()
      .map(importToTab)
      .filter((tab): tab is RepeaterTab => tab !== null);

    const all = [...saved, ...imported];

    if (all.length === 0) all.push(blankTab());

    const nextActive = imported.length
      ? imported[imported.length - 1].id
      : all.some((tab) => tab.id === savedActive)
        ? savedActive
        : all[0].id;

    setTabs(all);
    setActiveId(nextActive);
    setReady(true);
  }, []);

  // ---------------- Save tabs ----------------

  useEffect(() => {
    if (!ready) return;

    const timer = setTimeout(() => {
      try {
        window.localStorage.setItem(
          TABS_KEY,
          JSON.stringify({ tabs, activeId })
        );
      } catch {
        // Ignore storage errors.
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [tabs, activeId, ready]);

  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0] ?? null;
  const activeResponse = active ? responses[active.id] : undefined;
  const activeError = active ? errors[active.id] : "";
  const isSending = active ? sending.has(active.id) : false;

  // ---------------- Tab actions ----------------

  const updateTab = useCallback(
    (id: string, patch: Partial<RepeaterTab>) => {
      setTabs((current) =>
        current.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab))
      );
    },
    []
  );

  const addTab = () => {
    const tab = blankTab();
    setTabs((current) => [...current, tab]);
    setActiveId(tab.id);
  };

  const duplicateTab = () => {
    if (!active) return;

    const copy: RepeaterTab = { ...active, id: newId() };
    const index = tabs.findIndex((tab) => tab.id === active.id);

    setTabs((current) => [
      ...current.slice(0, index + 1),
      copy,
      ...current.slice(index + 1),
    ]);
    setActiveId(copy.id);
  };

  const closeTab = (id: string) => {
    responseCache.delete(id);

    setResponses((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });

    const index = tabs.findIndex((tab) => tab.id === id);
    const remaining = tabs.filter((tab) => tab.id !== id);

    if (remaining.length === 0) {
      const fresh = blankTab();
      setTabs([fresh]);
      setActiveId(fresh.id);
      return;
    }

    setTabs(remaining);

    if (id === activeId) {
      const neighbor = remaining[Math.min(index, remaining.length - 1)];
      setActiveId(neighbor.id);
    }
  };

  // ---------------- Method / HTTP version / encode actions ----------------

  const applyMethod = useCallback(
    (nextMethod: string) => {
      if (!active) return;

      const { raw, note } = convertMethod(active.raw, nextMethod);
      updateTab(active.id, { raw });
      setErrors((current) => ({ ...current, [active.id]: note ?? "" }));
    },
    [active, updateTab]
  );

  const cycleMethod = useCallback(() => {
    if (!active) return;

    const current = parseMethod(active.raw);
    const idx = HTTP_METHODS.indexOf(current as (typeof HTTP_METHODS)[number]);
    const next = HTTP_METHODS[(idx + 1 + HTTP_METHODS.length) % HTTP_METHODS.length];
    applyMethod(next);
  }, [active, applyMethod]);

  const toggleHttpVersion = useCallback(() => {
    if (!active) return;

    const current = parseHttpVersion(active.raw);
    const next = current === "HTTP/2" ? "HTTP/1.1" : "HTTP/2";

    updateTab(active.id, {
      raw: setHttpVersion(active.raw, next, active.target),
    });
    setErrors((current) => ({ ...current, [active.id]: "" }));
  }, [active, updateTab]);

  const runEncode = useCallback(
    (op: EncodeOp) => {
      const editor = editorRef.current;

      if (!active || !editor) return;

      const selected = editor.getSelectedText();

      if (!selected) {
        setErrors((current) => ({
          ...current,
          [active.id]: "Select some text in the request editor first.",
        }));
        return;
      }

      editor.replaceSelection(ENCODE_TRANSFORMS[op](selected));
      setErrors((current) => ({ ...current, [active.id]: "" }));
    },
    [active]
  );

  // ---------------- Send to Intruder ----------------

  const sendActiveToIntruder = useCallback(() => {
    if (!active) return;

    let payload: ReturnType<typeof buildPayload>;

    try {
      payload = buildPayload(active);
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [active.id]:
          error instanceof Error ? error.message : "Invalid request.",
      }));
      return;
    }

    setErrors((current) => ({ ...current, [active.id]: "" }));

    sendToIntruder({
      rawRequest: active.raw,
      method: payload.method,
      url: payload.url,
      headers: payload.headers,
      body_base64: payload.body_base64,
      source: "repeater",
    });

    router.push("/intruder");
  }, [active, router]);

  // ---------------- Ask Gemini AI about this request/response ----------------

  const askAi = useCallback(() => {
    if (!active) return;

    const parts: string[] = [];


    parts.push(
      "You are now operating in PacketSniffer Repeater testing mode. " +
      "Act as a senior web application and API penetration tester. " +

      "Analyze the supplied HTTP request and response to identify " +
      "realistic attack surfaces and practical vulnerability tests. " +

      "Do not give generic security explanations or just list possible " +
      "vulnerability names. Think about how an actual pentester would " +
      "manipulate this exact request to discover security weaknesses. " +

      "For each relevant test, provide: " +
      "1. Vulnerability or attack technique to investigate. " +
      "2. Exact parameter, header, cookie, path or body field to modify. " +
      "3. Concrete payloads or modified HTTP values to try. " +
      "4. What to observe in the server response. " +
      "5. How to interpret the result and confirm or reject the issue. " +

      "Prioritize practical tests such as IDOR/BOLA, authentication " +
      "bypass, privilege escalation, parameter tampering, SQL/NoSQL " +
      "injection, XSS, SSRF, path traversal, mass assignment, JWT " +
      "manipulation and business logic flaws, but only when relevant " +
      "to the supplied traffic. " +

      "Give exact, copy-paste-ready payloads and HTTP request " +
      "modifications wherever possible. Include multiple meaningful " +
      "test variations when useful. " +

      "If a test requires another user account, a different role or " +
      "additional context, explicitly explain what is needed. " +

      "Rank tests by priority and likelihood. Start with the most " +
      "promising test instead of overwhelming the user with every " +
      "possible attack. " +

      "Format your response as: " +
      "Attack Surface, Recommended Tests, Exact Payloads, " +
      "Expected Vulnerable Response, Expected Secure Response, " +
      "and Next Step. " +

      "Your goal is to guide the user through actual vulnerability " +
      "discovery and validation using PacketSniffer Repeater, " +
      "not merely explain what vulnerabilities are."
    );


    parts.push("");
    parts.push(`Target: ${active.target}`);
    parts.push(`Verify TLS: ${active.verifyTls ? "yes" : "no"}`);
    parts.push("");
    parts.push("=== REQUEST ===");
    parts.push(active.raw.trimEnd());

    if (activeResponse) {
      const head = responseHead(activeResponse);
      const displayBase64 =
        activeResponse.body_decoded_base64 ?? activeResponse.body_base64;
      const contentType =
        activeResponse.headers.find(
          ([k]) => k.toLowerCase() === "content-type"
        )?.[1] ?? "";
      const classified = classifyResponse(contentType, displayBase64);
      const bodyText =
        classified.displayType === "binary" ||
          classified.displayType === "image" ||
          classified.displayType === "pdf"
          ? "[binary response body omitted]"
          : base64ToText(displayBase64);

      parts.push("");
      parts.push("=== RESPONSE ===");
      parts.push(head);
      parts.push("");
      parts.push(bodyText.slice(0, 8000));
    } else {
      parts.push("");
      parts.push("(No response captured yet — analyze the request alone.)");
    }

    openGeminiAIWith({
      prompt: parts.join("\n"),
      httpRequest: active.raw,
      httpRequestName: "repeater-request.http",
    });
  }, [active, activeResponse]);

  // ---------------- Global keyboard shortcuts ----------------

  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (!active) return;

      if ((e.ctrlKey || e.metaKey) && e.code === "KeyF" && !e.shiftKey && !e.altKey) {
        if (!activeResponse) return;
        e.preventDefault();
        setFindOpen(true);
        return;
      }

      if (!(e.ctrlKey || e.metaKey)) return;

      const code = e.code;

      if (code === "KeyI" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        sendActiveToIntruder();
        return;
      }

      if (e.shiftKey && !e.altKey) {
        if (code === "KeyM") {
          e.preventDefault();
          cycleMethod();
        } else if (code === "Digit2") {
          e.preventDefault();
          toggleHttpVersion();
        } else if (code === "KeyU") {
          e.preventDefault();
          runEncode("url-encode");
        } else if (code === "KeyB") {
          e.preventDefault();
          runEncode("base64-encode");
        } else if (code === "KeyH") {
          e.preventDefault();
          runEncode("html-encode");
        }
        return;
      }

      if (e.altKey && !e.shiftKey) {
        if (code === "KeyU") {
          e.preventDefault();
          runEncode("url-decode");
        } else if (code === "KeyB") {
          e.preventDefault();
          runEncode("base64-decode");
        } else if (code === "KeyH") {
          e.preventDefault();
          runEncode("html-decode");
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    active,
    activeResponse,
    cycleMethod,
    toggleHttpVersion,
    runEncode,
    sendActiveToIntruder,
  ]);

  useEffect(() => {
    if (!findOpen) return;

    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setFindOpen(false);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [findOpen]);

  useEffect(() => {
    setFindOpen(false);
    setFindQuery("");
    setFindIndex(0);
  }, [activeId]);

  // ---------------- Send ----------------

  const send = useCallback(async (tab: RepeaterTab) => {
    setErrors((current) => ({ ...current, [tab.id]: "" }));

    let payload: ReturnType<typeof buildPayload>;

    try {
      payload = buildPayload(tab);
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [tab.id]:
          error instanceof Error ? error.message : "Invalid request.",
      }));
      return;
    }

    setSending((current) => new Set(current).add(tab.id));

    try {
      const response = await fetch(`${API}/api/repeater/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let detail = `Request failed (${response.status})`;

        try {
          const data = await response.json();

          if (typeof data?.detail === "string") {
            detail = data.detail;
          }
        } catch {
          // Keep the generic message.
        }

        throw new Error(detail);
      }

      const result = (await response.json()) as RepeaterResult;
      const stored: TabResponse = { ...result, received_at: Date.now() };

      responseCache.set(tab.id, stored);
      setResponses((current) => ({ ...current, [tab.id]: stored }));
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [tab.id]:
          error instanceof TypeError
            ? "Cannot reach the PacketSniffer backend (127.0.0.1:8765)."
            : error instanceof Error
              ? error.message
              : "Request failed.",
      }));
    } finally {
      setSending((current) => {
        const next = new Set(current);
        next.delete(tab.id);
        return next;
      });
    }
  }, []);

  const sendActive = () => {
    if (active && !isSending) void send(active);
  };

  const onEditorKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      sendActive();
    }
  };

  // ---------------- Split handle ----------------

  const saveSplit = (value: number) => {
    try {
      window.localStorage.setItem(SPLIT_KEY, String(value));
    } catch {
      // Ignore storage errors.
    }
  };

  const onHandlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onHandlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;

    const rect = splitRef.current?.getBoundingClientRect();

    if (!rect || rect.width === 0) return;

    setSplitPct(clampSplit(((e.clientX - rect.left) / rect.width) * 100));
  };

  const onHandlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    setDragging(false);
    saveSplit(splitPct);
  };

  const onHandleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;

    if (e.key === "ArrowLeft") next = clampSplit(splitPct - 2);
    if (e.key === "ArrowRight") next = clampSplit(splitPct + 2);
    if (e.key === "Home") next = SPLIT_DEFAULT;

    if (next !== null) {
      e.preventDefault();
      setSplitPct(next);
      saveSplit(next);
    }
  };

  const resetSplit = () => {
    setSplitPct(SPLIT_DEFAULT);
    saveSplit(SPLIT_DEFAULT);
  };

  // ---------------- Response viewer props ----------------

  let viewer = null;
  let responsePlainText = "";

  if (activeResponse) {
    const contentType =
      activeResponse.headers.find(
        ([key]) => key.toLowerCase() === "content-type"
      )?.[1] ?? "";

    const displayBase64 =
      activeResponse.body_decoded_base64 ?? activeResponse.body_base64;

    const classified = classifyResponse(contentType, displayBase64);
    const head = responseHead(activeResponse);

    const bodyText =
      classified.displayType === "binary" ||
        classified.displayType === "image" ||
        classified.displayType === "pdf"
        ? ""
        : base64ToText(displayBase64);

    responsePlainText = `${head}\n\n${bodyText}`;

    viewer = (
      <HttpViewer
        key={`${active?.id}-${activeResponse.received_at}`}
        text={responsePlainText}
        rawText={head}
        displayType={classified.displayType}
        detectedMime={classified.mime}
        responseBodyBase64={displayBase64}
        rawResponseBodyBase64={activeResponse.body_base64}
        originalSize={activeResponse.size_raw}
        decodedSize={activeResponse.size_decoded}
        decodeError={activeResponse.decode_error ?? undefined}
        findQuery={findQuery}
        activeFindIndex={findIndex}
      />
    );
  }

  const findMatches = useMemo(() => {
    if (!findQuery || !responsePlainText) return 0;

    const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "gi");
    let count = 0;
    while (re.exec(responsePlainText) !== null) {
      count++;
      if (count > 10_000) break;
    }
    return count;
  }, [findQuery, responsePlainText]);

  useEffect(() => {
    if (findMatches === 0) {
      if (findIndex !== 0) setFindIndex(0);
      return;
    }

    if (findIndex >= findMatches) {
      setFindIndex(findMatches - 1);
    }
  }, [findMatches, findIndex]);

  const handleFindNext = () => {
    if (findMatches === 0) return;
    setFindIndex((idx) => (idx + 1) % findMatches);
  };

  const handleFindPrev = () => {
    if (findMatches === 0) return;
    setFindIndex((idx) => (idx - 1 + findMatches) % findMatches);
  };

  // ---------------- Render ----------------

  const currentMethod = active ? parseMethod(active.raw) : "GET";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Repeater"
        subtitle="Edit a request and send it again as many times as you need."
      >
        <ListenerPill />
      </PageHeader>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Repeater requests"
        className="flex shrink-0 items-end gap-1 overflow-x-auto border-b border-white/[0.08] bg-[#0d0d0f] px-3 pt-2 [scrollbar-width:none]"
      >
        {tabs.map((tab, index) => {
          const isActive = tab.id === active?.id;
          const tabResponse = responses[tab.id];

          return (
            <div
              key={tab.id}
              className={`group flex max-w-[220px] shrink-0 items-center gap-1 rounded-t-md border-b-2 pl-3 pr-1 transition-colors ${isActive
                ? "border-emerald-400 bg-white/[0.05] text-white"
                : "border-transparent text-[#9a9aa8] hover:bg-white/[0.03] hover:text-white"
                }`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveId(tab.id)}
                className="flex min-w-0 items-center gap-2 py-2 text-left text-[12px] focus-visible:outline-none"
              >
                {tabResponse && (
                  <span
                    className={`shrink-0 text-[10.5px] font-bold ${statusColor(
                      tabResponse.status_code
                    )}`}
                  >
                    {tabResponse.status_code}
                  </span>
                )}

                <span className={`${mono.className} truncate`}>
                  {tabLabel(tab, index)}
                </span>
              </button>

              <button
                type="button"
                onClick={() => closeTab(tab.id)}
                title="Close tab"
                aria-label="Close tab"
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] text-[#777784] transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
          );
        })}

        <button
          type="button"
          onClick={addTab}
          title="New request"
          aria-label="New request"
          className="mb-1 ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[15px] text-[#b5b5c2] transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>

      {active && (
        <>
          {/* Toolbar */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.08] px-3 py-2">
            <ToolbarMenu
              label={currentMethod}
              widthClass="w-56"
              items={HTTP_METHODS.map((m) => ({
                key: m,
                label: m,
                active: m === currentMethod,
                onClick: () => applyMethod(m),
              }))}
              footer="Changing the method also rewrites the request: query ⇄ body, Content-Type and Content-Length. Ctrl/Cmd+Shift+M cycles."
            />

            <Tip
              label="Switch HTTP version"
              keys={["Mod", "Shift", "2"]}
              align="start"
            >
              <button
                type="button"
                onClick={toggleHttpVersion}
                aria-label="Toggle HTTP version"
                className={`${btnOutline} ${mono.className} !h-9 !px-3 !text-[12px]`}
              >
                {parseHttpVersion(active.raw)}
              </button>
            </Tip>

            <label htmlFor="repeater-target" className="sr-only">
              Target
            </label>

            <input
              id="repeater-target"
              value={active.target}
              onChange={(e) =>
                updateTab(active.id, { target: e.target.value })
              }
              spellCheck={false}
              placeholder="https://example.com"
              className={`${mono.className} h-9 min-w-[220px] flex-1 rounded-lg border border-white/[0.1] bg-[#141416] px-3 text-[12.5px] text-white outline-none placeholder:text-[#585866] focus:border-emerald-400/60`}
            />

            <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-[12px] text-[#b5b5c2]">
              <input
                type="checkbox"
                checked={active.verifyTls}
                onChange={(e) =>
                  updateTab(active.id, { verifyTls: e.target.checked })
                }
                className="h-3.5 w-3.5 accent-emerald-400"
              />
              Verify TLS
            </label>

            <ToolbarMenu
              label="Encode"
              icon={<Binary size={14} />}
              widthClass="w-72"
              items={ENCODE_MENU.map((e) => ({
                key: e.op,
                label: e.label,
                keys: e.keys,
                onClick: () => runEncode(e.op),
              }))}
              footer="Applies to the text selected in the request editor."
            />

            <ShortcutsButton />

            <Tip label="Duplicate this request" align="end">
              <button
                type="button"
                onClick={duplicateTab}
                className={`${btnOutline} !h-9 !px-3 !text-[12px]`}
              >
                Duplicate
              </button>
            </Tip>

            <Tip label="Ask Gemini AI about this request/response" align="end">
              <button
                type="button"
                onClick={askAi}
                className={`${btnOutline} inline-flex items-center gap-1.5 !h-9 !px-3 !text-[12px]`}
              >
                <Sparkles size={14} strokeWidth={1.9} />
                Ask AI
              </button>
            </Tip>

            <Tip
              label="Send this request to Intruder"
              keys={["Mod", "I"]}
              align="end"
            >
              <button
                type="button"
                onClick={sendActiveToIntruder}
                className={`${btnOutline} inline-flex items-center gap-1.5 !h-9 !px-3 !text-[12px]`}
              >
                <Zap size={14} strokeWidth={1.9} />
                Intruder
              </button>
            </Tip>

            <Tip label="Send request" keys={["Mod", "Enter"]} align="end">
              <button
                type="button"
                onClick={sendActive}
                disabled={isSending}
                className={`${btnPrimary} !h-9 !px-5 !text-[13px] disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {isSending ? "Sending…" : "Send"}
              </button>
            </Tip>
          </div>

          {/* Request | Response */}
          <div
            ref={splitRef}
            className={`flex min-h-0 flex-1 overflow-hidden ${dragging ? "cursor-col-resize select-none" : ""
              }`}
          >
            {/* Request */}
            <div
              onKeyDown={onEditorKeyDown}
              style={{ width: `${splitPct}%` }}
              className="flex min-h-0 min-w-0 shrink-0 flex-col"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#0d0d0f] px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#8a8a98]">
                <span>Request</span>
                <span className="font-normal normal-case tracking-normal text-[#585866]">
                  Ctrl + Enter to send
                </span>
              </div>

              <RequestEditor
                ref={editorRef}
                key={active.id}
                value={active.raw}
                onChange={(raw: string) => updateTab(active.id, { raw })}
              />
            </div>

            {/* Drag handle */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize request and response panels"
              aria-valuemin={SPLIT_MIN}
              aria-valuemax={SPLIT_MAX}
              aria-valuenow={Math.round(splitPct)}
              tabIndex={0}
              title="Drag to resize · double-click to reset"
              onPointerDown={onHandlePointerDown}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
              onPointerCancel={onHandlePointerUp}
              onDoubleClick={resetSplit}
              onKeyDown={onHandleKeyDown}
              className={`group relative z-20 w-[7px] shrink-0 cursor-col-resize touch-none select-none outline-none ${dragging ? "bg-emerald-400/20" : "hover:bg-emerald-400/10"
                } focus-visible:bg-emerald-400/20`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors ${dragging
                  ? "bg-emerald-400"
                  : "bg-white/[0.1] group-hover:bg-emerald-400/70 group-focus-visible:bg-emerald-400"
                  }`}
              />
            </div>

            {/* Response */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#0f0f11]">
              <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/[0.06] bg-[#0d0d0f] px-4 py-2 text-[12px]">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8a8a98]">
                  Response
                </span>

                {isSending && (
                  <span className="text-[#9a9aa8]">Waiting for server…</span>
                )}

                {activeResponse && !isSending && (
                  <>
                    <span
                      className={`font-bold ${statusColor(
                        activeResponse.status_code
                      )}`}
                    >
                      {activeResponse.status_code} {activeResponse.reason}
                    </span>

                    <span className="text-[#9a9aa8]">
                      {activeResponse.duration_ms} ms
                    </span>

                    <span className="text-[#9a9aa8]">
                      {formatBytes(activeResponse.size_decoded)}
                    </span>

                    {activeResponse.content_encoding && (
                      <span className="text-[#777784]">
                        {activeResponse.content_encoding} ·{" "}
                        {formatBytes(activeResponse.size_raw)} on the wire
                      </span>
                    )}
                  </>
                )}

                {activeResponse && (
                  <Tip
                    label="Find in response"
                    keys={["Mod", "F"]}
                    align="end"
                  >
                    <button
                      type="button"
                      onClick={() => setFindOpen((v) => !v)}
                      aria-pressed={findOpen}
                      className={`ml-auto inline-flex h-7 items-center gap-1.5 rounded-md border border-white/[0.1] px-2 text-[11.5px] text-[#b5b5c2] transition-colors hover:bg-white/[0.06] hover:text-white ${findOpen
                        ? "!border-emerald-400/50 !text-emerald-300"
                        : ""
                        }`}
                    >
                      <Search size={12} />
                      Find
                    </button>
                  </Tip>
                )}
              </div>

              {activeError && (
                <div
                  role="alert"
                  className="shrink-0 border-b border-rose-400/20 bg-rose-400/[0.07] px-4 py-2 text-[12px] text-rose-300"
                >
                  {activeError}
                </div>
              )}

              <FindBar
                visible={findOpen && !!activeResponse}
                search={findQuery}
                onSearchChange={(v) => {
                  setFindQuery(v);
                  setFindIndex(0);
                }}
                matchCount={findMatches}
                currentMatch={findMatches === 0 ? 0 : findIndex + 1}
                onPrev={handleFindPrev}
                onNext={handleFindNext}
                onClose={() => {
                  setFindOpen(false);
                  setFindQuery("");
                  setFindIndex(0);
                }}
              />

              {viewer ?? (
                <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center">
                  <div className="max-w-sm">
                    <p className="text-[13px] font-semibold text-white">
                      No response yet
                    </p>
                    <p className="mt-1 text-[12px] leading-5 text-[#8a8a98]">
                      Press Send to deliver this request straight to the
                      target. It does not pass through the proxy and is not
                      added to HTTP History.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}