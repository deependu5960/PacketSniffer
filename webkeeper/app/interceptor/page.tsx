'use client';

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  Binary,
  Check,
  ChevronDown,
  Copy,
  Repeat2,
  Search,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import {
  PageHeader,
  ListenerPill,
  MethodBadge,
  EmptyState,
  btnPrimary,
  btnDanger,
  btnOutline,
  mono,
} from "@/components/ui";
import { useTraffic } from "@/components/TrafficProvider";
import RequestEditor, {
  type RequestEditorHandle,
} from "@/components/RequestEditor";
import { sendToRepeater, sendToIntruder } from "@/components/repeaterBridge";
import { openGeminiAIWith } from "@/components/geminiAI-bridge";

// ------------------------------ Config ------------------------------

type PacketKind = "request" | "response";
type SelectedPacket = { kind: PacketKind; id: number } | null;
type FilterKind = "all" | "request" | "response";

type EncodeOp =
  | "url-encode"
  | "url-decode"
  | "base64-encode"
  | "base64-decode"
  | "html-encode"
  | "html-decode";

// Queue pane width limits, as a percentage of the available width.
const SPLIT_MIN = 25;
const SPLIT_MAX = 75;
const SPLIT_DEFAULT = 50;
const SPLIT_STORAGE_KEY = "packetsniff.interceptor.splitPct.v2";

const AI_RAW_LIMIT = 100_000;

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH"]);

const HTTP1_ONLY_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
]);

function clampSplit(value: number) {
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value));
}

// ------------------------------ Raw helpers ------------------------------

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

function parseRequestLine(
  raw: string
): { method: string; path: string } | null {
  const first = raw.replace(/\r\n/g, "\n").split("\n", 1)[0].trim();
  const match = first.match(/^(\S+)\s+(\S+)/);

  return match ? { method: match[1].toUpperCase(), path: match[2] } : null;
}

function parseMethod(raw: string): string {
  return parseRequestLine(raw)?.method ?? "GET";
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
        // Target is not a valid URL; leave the headers alone.
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

// Builds the Repeater / Intruder payload from the *edited* raw request, so
// changes made in the editor are not lost when sending to another tool.
function payloadFromRaw(raw: string, baseUrl: string) {
  const { requestLine, headerLines, body } = splitRawRequest(raw);
  const match = requestLine.match(/^(\S+)\s+(\S+)/);

  if (!match) return null;

  let url: string;

  try {
    url = new URL(match[2], baseUrl).toString();
  } catch {
    return null;
  }

  const bodyLength = byteLength(body);
  const headers: [string, string][] = [];

  for (const line of headerLines) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;

    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();

    headers.push([
      name,
      name.toLowerCase() === "content-length" ? String(bodyLength) : value,
    ]);
  }

  return {
    method: match[1].toUpperCase(),
    url,
    headers,
    body_base64: utf8ToBase64(body),
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
  return utf8ToBase64(text);
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

// ---------------- Encode menu ----------------

const ENCODE_MENU: { op: EncodeOp; label: string }[] = [
  { op: "url-encode", label: "URL-encode" },
  { op: "url-decode", label: "URL-decode" },
  { op: "base64-encode", label: "Base64-encode" },
  { op: "base64-decode", label: "Base64-decode" },
  { op: "html-encode", label: "HTML-encode" },
  { op: "html-decode", label: "HTML-decode" },
];

// ------------------------ Small UI pieces ------------------------

// Measures an element so the layout can adapt to the space it really has.
function useElementWidth<T extends HTMLElement>(): [
  (node: T | null) => void,
  number,
] {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!node) return;

    setWidth(node.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return [setNode, width];
}

function Tip({
  label,
  align = "center",
  children,
}: {
  label: string;
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
        className={`pointer-events-none invisible absolute top-[calc(100%+8px)] z-40 ${position} whitespace-nowrap rounded-lg border border-white/[0.1] bg-[#1c1c20] px-2.5 py-1.5 text-[12px] text-[#d8d8e0] opacity-0 shadow-xl shadow-black/50 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-hover:delay-300 group-focus-visible:visible group-focus-visible:opacity-100`}
      >
        {label}
      </span>
    </span>
  );
}

// Number of toolbar menus currently open. Lets the editor panel ignore the
// Escape key that is only meant to close a menu.
let openMenuCount = 0;

type MenuItem = {
  key: string;
  label: string;
  active?: boolean;
  onClick: () => void;
};

function ToolbarMenu({
  label,
  title,
  icon,
  items,
  footer,
  widthClass = "w-48",
  sizeClass = "!h-8 !px-2.5 !text-[12px]",
  disabled,
}: {
  label?: ReactNode;
  title: string;
  icon?: ReactNode;
  items: MenuItem[];
  footer?: string;
  widthClass?: string;
  sizeClass?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    openMenuCount += 1;

    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);

    return () => {
      openMenuCount = Math.max(0, openMenuCount - 1);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Keep the text selection in the editor when clicking menu buttons.
  const keepEditorFocus = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        title={title}
        aria-label={title}
        onMouseDown={keepEditorFocus}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`${btnOutline} inline-flex items-center gap-1.5 ${sizeClass} disabled:cursor-not-allowed disabled:opacity-40`}
      >
        {icon}
        {label ? <span className={mono.className}>{label}</span> : null}
        <ChevronDown
          size={13}
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          onMouseDown={keepEditorFocus}
          className={`absolute left-0 top-[calc(100%+6px)] z-30 ${widthClass} max-w-[85vw] overflow-hidden rounded-xl border border-white/[0.1] bg-[#1c1c20] py-1.5 shadow-2xl shadow-black/60`}
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
              className={`mx-1.5 flex w-[calc(100%-12px)] items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] transition-colors hover:bg-white/[0.07] hover:text-white ${
                item.active ? "text-emerald-300" : "text-[#c4c4ce]"
              }`}
            >
              {item.active ? (
                <Check size={13} className="shrink-0" />
              ) : (
                <span className="inline-block w-[13px] shrink-0" />
              )}
              <span className={item.active ? mono.className : ""}>
                {item.label}
              </span>
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

function CountBadge({ value }: { value: number }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
        value > 0
          ? "bg-emerald-400/15 text-emerald-300"
          : "bg-white/[0.06] text-[#9a9aa8]"
      }`}
    >
      {value}
    </span>
  );
}

// ------------------------------ Page ------------------------------

export default function InterceptorPage() {
  const {
    interceptOn,
    toggleIntercept,
    queue,
    responseQueue,
    forward,
    drop,
    forwardAll,
    forwardResponse,
    dropResponse,
    editRaw,
    editResponseRaw,
  } = useTraffic();

  const router = useRouter();

  const [selectedPacket, setSelectedPacket] = useState<SelectedPacket>(null);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [actionError, setActionError] = useState("");
  const [filterText, setFilterText] = useState("");
  const [filterKind, setFilterKind] = useState<FilterKind>("all");
  const [copied, setCopied] = useState(false);

  const editorRef = useRef<RequestEditorHandle>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Measured widths drive the responsive button sizes below.
  const [setPanelEl, panelWidth] = useElementWidth<HTMLElement>();
  const [setListEl, listWidth] = useElementWidth<HTMLDivElement>();

  // Resizable split between the queue (left) and the editor (right).
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [splitPct, setSplitPct] = useState(SPLIT_DEFAULT);
  const [dragging, setDragging] = useState(false);

  // Restore the saved width after mount.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SPLIT_STORAGE_KEY);

      if (saved !== null) {
        const value = Number(saved);

        if (Number.isFinite(value)) {
          setSplitPct(clampSplit(value));
        }
      }
    } catch {
      // Storage unavailable: keep the default width.
    }
  }, []);

  const saveSplit = (value: number) => {
    try {
      window.localStorage.setItem(SPLIT_STORAGE_KEY, String(value));
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

    const rect = splitContainerRef.current?.getBoundingClientRect();

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

  // ---------------- Selection ----------------

  const selectedRequest =
    selectedPacket?.kind === "request"
      ? queue.find((item) => item.id === selectedPacket.id) ?? null
      : null;

  const selectedResponse =
    selectedPacket?.kind === "response"
      ? responseQueue.find((item) => item.id === selectedPacket.id) ?? null
      : null;

  const selected = selectedRequest || selectedResponse;
  const totalPending = queue.length + responseQueue.length;
  const isRequestSelected = selectedPacket?.kind === "request";

  // Ordered list used to jump to the next packet after Forward / Drop.
  const orderedItems: { kind: PacketKind; id: number }[] = [
    ...queue.map((item) => ({ kind: "request" as const, id: item.id })),
    ...responseQueue.map((item) => ({
      kind: "response" as const,
      id: item.id,
    })),
  ];

  const pickNext = (): SelectedPacket => {
    if (!selectedPacket) return null;

    const index = orderedItems.findIndex(
      (item) =>
        item.kind === selectedPacket.kind && item.id === selectedPacket.id
    );

    if (index === -1) return null;

    return orderedItems[index + 1] ?? orderedItems[index - 1] ?? null;
  };

  // ---------------- Queue filtering ----------------

  const needle = filterText.trim().toLowerCase();

  const visibleRequests =
    filterKind === "response"
      ? []
      : queue.filter(
          (item) =>
            !needle ||
            `${item.method} ${item.host} ${item.path}`
              .toLowerCase()
              .includes(needle)
        );

  const visibleResponses =
    filterKind === "request"
      ? []
      : responseQueue.filter(
          (item) =>
            !needle ||
            `${item.statusCode} ${item.reason} ${item.requestUrl}`
              .toLowerCase()
              .includes(needle)
        );

  const visibleItems: { kind: PacketKind; id: number }[] = [
    ...visibleRequests.map((item) => ({ kind: "request" as const, id: item.id })),
    ...visibleResponses.map((item) => ({
      kind: "response" as const,
      id: item.id,
    })),
  ];

  const filtering = needle !== "" || filterKind !== "all";

  // ---------------- Packet actions ----------------

  const handleForward = async () => {
    if (!selectedPacket) return;

    setActionError("");
    const next = pickNext();

    try {
      if (selectedPacket.kind === "request") {
        await forward(selectedPacket.id);
      } else {
        await forwardResponse(selectedPacket.id);
      }

      setSelectedPacket(next);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Unable to forward packet."
      );
    }
  };

  const handleDrop = async () => {
    if (!selectedPacket) return;

    setActionError("");
    const next = pickNext();

    try {
      if (selectedPacket.kind === "request") {
        await drop(selectedPacket.id);
      } else {
        await dropResponse(selectedPacket.id);
      }

      setSelectedPacket(next);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Unable to drop packet."
      );
    }
  };

  const handleForwardAll = async () => {
    setActionError("");

    try {
      await forwardAll();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Unable to forward requests."
      );
    }
  };

  const handleForwardAllResponses = async () => {
    setActionError("");

    const pendingResponses = [...responseQueue];
    const failed: string[] = [];

    for (const response of pendingResponses) {
      try {
        await forwardResponse(response.id);
      } catch {
        failed.push(`${response.statusCode} ${response.requestUrl}`);
      }
    }

    if (failed.length > 0) {
      setActionError(
        `Unable to forward ${failed.length} response(s): ${failed.join(", ")}`
      );
    }
  };

  // ---------------- Editing helpers (method / version / encode) ----------------

  const updateSelectedRaw = (raw: string) => {
    if (selectedRequest) editRaw(selectedRequest.id, raw);
    else if (selectedResponse) editResponseRaw(selectedResponse.id, raw);
  };

  const applyMethod = (nextMethod: string) => {
    if (!selectedRequest) return;

    const { raw, note } = convertMethod(selectedRequest.raw, nextMethod);

    editRaw(selectedRequest.id, raw);
    setActionError(note ?? "");
  };

  const toggleHttpVersion = () => {
    if (!selectedRequest) return;

    const current = parseHttpVersion(selectedRequest.raw);
    const next = current === "HTTP/2" ? "HTTP/1.1" : "HTTP/2";

    editRaw(
      selectedRequest.id,
      setHttpVersion(selectedRequest.raw, next, selectedRequest.url ?? undefined)
    );
    setActionError("");
  };

  const runEncode = (op: EncodeOp) => {
    const editor = editorRef.current;

    if (!selected || !editor) return;

    const text = editor.getSelectedText();

    if (!text) {
      setActionError("Select some text in the editor first.");
      return;
    }

    editor.replaceSelection(ENCODE_TRANSFORMS[op](text));
    setActionError("");
  };

  const copyRaw = async () => {
    if (!selected) return;

    try {
      await navigator.clipboard.writeText(selected.raw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setActionError("Couldn't copy to the clipboard.");
    }
  };

  // ---------------- Send to other tools ----------------

  const handleSendToRepeater = () => {
    if (!selectedRequest?.url) return;

    const payload = payloadFromRaw(selectedRequest.raw, selectedRequest.url);

    sendToRepeater(
      payload ?? {
        method: selectedRequest.method,
        url: selectedRequest.url,
        headers: selectedRequest.headers ?? [],
        body_base64: selectedRequest.body_base64 ?? "",
      }
    );

    router.push("/repeater");
  };

  const handleSendToIntruder = () => {
    if (!selectedRequest) return;

    const payload = payloadFromRaw(
      selectedRequest.raw,
      selectedRequest.url ?? ""
    );

    sendToIntruder({
      rawRequest: selectedRequest.raw,
      method: payload?.method ?? selectedRequest.method,
      url: payload?.url ?? selectedRequest.url ?? "",
      headers: payload?.headers ?? selectedRequest.headers ?? [],
      body_base64: payload?.body_base64 ?? selectedRequest.body_base64 ?? "",
      source: "interceptor",
    });

    router.push("/intruder");
  };

  // ---------------- Ask Gemini AI ----------------

  const askAi = () => {
    if (!selected) return;

    // The raw packet travels as an attachment, so the modal's "Redact
    // secrets" option masks cookies and tokens before anything is sent.
    const raw = selected.raw.slice(0, AI_RAW_LIMIT);

    if (selectedRequest) {
      openGeminiAIWith({
        prompt:
          "I'm working in the PacketSniffer Interceptor. Analyze the attached" +
          " intercepted HTTP request for security issues. Look at" +
          " authentication, authorization, injection and" +
          " information-disclosure problems, and suggest concrete" +
          " modifications I can try before forwarding it.\n\n" +
          `Request: ${parseMethod(selectedRequest.raw)} ${selectedRequest.url ?? `${selectedRequest.host}${selectedRequest.path}`}`,
        httpRequest: raw,
        httpRequestName: "interceptor-request.http",
      });
      return;
    }

    if (selectedResponse) {
      openGeminiAIWith({
        prompt:
          "I'm working in the PacketSniffer Interceptor. Analyze the attached" +
          " intercepted HTTP response for security issues. Check the security" +
          " headers, cookies, information disclosure and anything unsafe in" +
          " the body, and suggest what I could test or change before" +
          " forwarding it.\n\n" +
          `Response: ${selectedResponse.statusCode} ${selectedResponse.reason}\n` +
          `Request URL: ${selectedResponse.requestUrl}`,
        httpRequest: raw,
        httpRequestName: "interceptor-response.http",
      });
    }
  };

  // ---------------- Keyboard ----------------

  const closePanel = () => {
    setSelectedPacket(null);
    setActionError("");
  };

  const onPanelKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!selected) return;

    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void handleForward();
    }

    // Escape also closes an open toolbar menu: don't close the panel then.
    if (e.key === "Escape" && openMenuCount === 0) {
      e.preventDefault();
      closePanel();
    }
  };

  const openPacket = (kind: PacketKind, id: number) => {
    setActionError("");
    setSelectedPacket({ kind, id });
  };

  const isSelected = (kind: PacketKind, id: number) =>
    selectedPacket?.kind === kind && selectedPacket.id === id;

  // Arrow keys move through the (filtered) queue.
  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (visibleItems.length === 0) return;

    e.preventDefault();

    const index = selectedPacket
      ? visibleItems.findIndex(
          (item) =>
            item.kind === selectedPacket.kind && item.id === selectedPacket.id
        )
      : -1;

    const nextIndex =
      e.key === "ArrowDown"
        ? Math.min(visibleItems.length - 1, index + 1)
        : Math.max(0, index === -1 ? 0 : index - 1);

    const next = visibleItems[nextIndex];

    openPacket(next.kind, next.id);

    window.requestAnimationFrame(() => {
      const row = listRef.current?.querySelector<HTMLElement>(
        '[aria-current="true"]'
      );
      row?.focus();
      row?.scrollIntoView({ block: "nearest" });
    });
  };

  const hasPanel = Boolean(selected);
  const resizable = hasPanel && !listCollapsed;

  // Responsive tiers. Buttons shrink (and lose their text) as space runs out.
  const compact = panelWidth > 0 && panelWidth < 680;
  const tiny = panelWidth > 0 && panelWidth < 460;
  const queueCompact = listWidth > 0 && listWidth < 520;
  const iconSize = compact ? 13 : 14;
  const btnSize = tiny
    ? "!h-7 !px-1.5 !text-[11px]"
    : compact
      ? "!h-7 !px-2 !text-[11.5px]"
      : "!h-8 !px-2.5 !text-[12px]";
  const headBtn = tiny
    ? "!h-7 !px-2 !text-[11px]"
    : compact
      ? "!h-7 !px-2.5 !text-[11.5px]"
      : "!h-8 !px-3 !text-[12px]";

  // Values shown in the editor header (follow edits made in the editor).
  const requestLine = selectedRequest
    ? parseRequestLine(selectedRequest.raw)
    : null;
  const currentMethod = requestLine?.method ?? selectedRequest?.method ?? "GET";
  const currentPath = requestLine?.path ?? selectedRequest?.path ?? "";
  const currentVersion = selectedRequest
    ? parseHttpVersion(selectedRequest.raw)
    : "HTTP/1.1";

  // ---------------------------------------------------------------
  // Queue pane (left)
  // ---------------------------------------------------------------

  const listPaneClass = !hasPanel
    ? "flex min-h-0 min-w-0 flex-1 flex-col"
    : listCollapsed
      ? "flex min-h-0 w-12 shrink-0 flex-col border-r border-white/[0.08]"
      : "flex min-h-0 min-w-0 shrink-0 flex-col";

  const listPaneStyle = resizable ? { width: `${splitPct}%` } : undefined;

  const queueRail = (
    <div className="flex h-full flex-col items-center gap-3 bg-[#0d0d0f] py-3">
      <button
        type="button"
        onClick={() => setListCollapsed(false)}
        title="Show queue"
        aria-label="Show queue"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#b5b5c2] transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
      >
        <span aria-hidden="true">»</span>
      </button>

      <CountBadge value={totalPending} />
    </div>
  );

  const filterChips: { id: FilterKind; label: string; count: number }[] = [
    { id: "all", label: "All", count: totalPending },
    { id: "request", label: "Requests", count: queue.length },
    { id: "response", label: "Responses", count: responseQueue.length },
  ];

  const queuePane = (
    <>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          {hasPanel && (
            <button
              type="button"
              onClick={() => setListCollapsed(true)}
              title="Hide queue"
              aria-label="Hide queue"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#b5b5c2] transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
            >
              <span aria-hidden="true">«</span>
            </button>
          )}

          <h2 className="text-[13px] font-semibold text-white">
            Intercept queue
          </h2>

          <CountBadge value={totalPending} />
        </div>

        <div className="flex items-center gap-1">
          {queue.length > 0 && (
            <button
              type="button"
              onClick={() => void handleForwardAll()}
              title="Forward all requests"
              className="rounded-md px-2.5 py-1.5 text-[11.5px] font-medium text-emerald-300 transition-colors hover:bg-emerald-400/10"
            >
              {queueCompact
                ? `Fwd req (${queue.length})`
                : `Forward all requests (${queue.length})`}
            </button>
          )}

          {responseQueue.length > 0 && (
            <button
              type="button"
              onClick={() => void handleForwardAllResponses()}
              title="Forward all responses"
              className="rounded-md px-2.5 py-1.5 text-[11.5px] font-medium text-cyan-300 transition-colors hover:bg-cyan-400/10"
            >
              {queueCompact
                ? `Fwd res (${responseQueue.length})`
                : `Forward all responses (${responseQueue.length})`}
            </button>
          )}
        </div>
      </div>

      {totalPending > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.06] bg-[#0d0d0f] px-3 py-2">
          <div className="relative min-w-[150px] flex-1">
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6c6c78]"
            />
            <input
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && filterText) {
                  e.preventDefault();
                  setFilterText("");
                }
              }}
              placeholder="Filter by host, path, method, status…"
              aria-label="Filter queue"
              spellCheck={false}
              className="h-8 w-full rounded-md border border-white/[0.1] bg-[#141416] pl-8 pr-7 text-[12px] text-white outline-none placeholder:text-[#585866] focus:border-emerald-400/50"
            />
            {filterText && (
              <button
                type="button"
                onClick={() => setFilterText("")}
                aria-label="Clear filter"
                className="absolute right-1.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-[#8a8a98] hover:bg-white/[0.08] hover:text-white"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div
            role="group"
            aria-label="Show packet type"
            className="inline-flex shrink-0 overflow-hidden rounded-md border border-white/[0.1]"
          >
            {filterChips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => setFilterKind(chip.id)}
                aria-pressed={filterKind === chip.id}
                className={`px-2.5 py-1.5 text-[11.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400/60 ${
                  filterKind === chip.id
                    ? "bg-emerald-400/15 text-emerald-300"
                    : "text-[#9a9aa8] hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                {chip.label}
                <span className="ml-1.5 text-[10.5px] opacity-70">
                  {chip.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!hasPanel && actionError && (
        <div
          role="alert"
          className="shrink-0 border-b border-rose-400/20 bg-rose-400/[0.07] px-4 py-2 text-[12px] text-rose-300"
        >
          {actionError}
        </div>
      )}

      {totalPending === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <EmptyState
            title={interceptOn ? "Waiting for packets" : "Intercept is off"}
            body={
              interceptOn
                ? "Point your browser at 127.0.0.1:8080. Requests and responses will appear here when interception is enabled."
                : "Requests and responses pass through without being paused. Turn interception on to hold and edit them. Please make sure proxy engine is on."
            }
            action={
              interceptOn ? undefined : (
                <button onClick={toggleIntercept} className={btnPrimary}>
                  Turn intercept on
                </button>
              )
            }
          />
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-[13px] font-semibold text-white">
            No packets match your filter
          </p>
          <button
            type="button"
            onClick={() => {
              setFilterText("");
              setFilterKind("all");
            }}
            className="rounded-md border border-white/[0.1] px-3 py-1.5 text-[12px] text-[#c4c4ce] transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            Clear filter
          </button>
        </div>
      ) : (
        <div
          ref={listRef}
          onKeyDown={onListKeyDown}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-color:#3a3a44_transparent] [scrollbar-width:thin]"
        >
          {visibleRequests.length > 0 && (
            <div>
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.05] bg-[#121214] px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                <span>
                  Requests · {visibleRequests.length}
                  {filtering && visibleRequests.length !== queue.length
                    ? ` of ${queue.length}`
                    : ""}
                </span>
                <span className="font-semibold text-[#777784]">
                  Client → Server
                </span>
              </div>

              <div className="divide-y divide-white/[0.05]">
                {visibleRequests.map((request) => {
                  const active = isSelected("request", request.id);

                  return (
                    <button
                      key={`request-${request.id}`}
                      type="button"
                      onClick={() => openPacket("request", request.id)}
                      aria-current={active ? "true" : undefined}
                      title={request.url ?? `${request.host}${request.path}`}
                      className={`flex w-full items-center gap-3 border-l-2 px-4 py-2.5 text-left transition-colors focus-visible:bg-emerald-400/[0.06] focus-visible:outline-none ${
                        active
                          ? "border-emerald-400 bg-emerald-400/[0.07]"
                          : "border-transparent hover:bg-white/[0.035]"
                      }`}
                    >
                      <span className="w-[64px] shrink-0">
                        <MethodBadge method={request.method} />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span
                          className={`${mono.className} block truncate text-[12px] text-[#e2e2ea]`}
                        >
                          {request.path}
                        </span>
                        <span className="block truncate text-[11px] text-[#8a8a98]">
                          {request.host}
                        </span>
                      </span>

                      <span className="shrink-0 text-[10.5px] text-[#777784]">
                        {request.time}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {visibleResponses.length > 0 && (
            <div>
              <div className="sticky top-0 z-10 flex items-center justify-between border-y border-white/[0.05] bg-[#121214] px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                <span>
                  Responses · {visibleResponses.length}
                  {filtering && visibleResponses.length !== responseQueue.length
                    ? ` of ${responseQueue.length}`
                    : ""}
                </span>
                <span className="font-semibold text-[#777784]">
                  Server → Client
                </span>
              </div>

              <div className="divide-y divide-white/[0.05]">
                {visibleResponses.map((response) => {
                  const active = isSelected("response", response.id);

                  return (
                    <button
                      key={`response-${response.id}`}
                      type="button"
                      onClick={() => openPacket("response", response.id)}
                      aria-current={active ? "true" : undefined}
                      title={response.requestUrl}
                      className={`flex w-full items-center gap-3 border-l-2 px-4 py-2.5 text-left transition-colors focus-visible:bg-cyan-400/[0.06] focus-visible:outline-none ${
                        active
                          ? "border-cyan-400 bg-cyan-400/[0.07]"
                          : "border-transparent hover:bg-white/[0.035]"
                      }`}
                    >
                      <span className="w-[64px] shrink-0">
                        <span className="inline-block rounded-md bg-cyan-400/10 px-2 py-0.5 text-[11px] font-bold text-cyan-300">
                          {response.statusCode}
                        </span>
                      </span>

                      <span className="min-w-0 flex-1">
                        <span
                          className={`${mono.className} block truncate text-[12px] text-[#e2e2ea]`}
                        >
                          {response.requestUrl}
                        </span>
                        <span className="block truncate text-[11px] text-[#8a8a98]">
                          {response.reason}
                        </span>
                      </span>

                      <span className="shrink-0 text-[10.5px] text-[#777784]">
                        {response.time}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!hasPanel && (
            <p className="px-4 py-3 text-center text-[11.5px] text-[#585866]">
              Select a packet to inspect and edit it · use ↑ ↓ to move through
              the queue
            </p>
          )}
        </div>
      )}
    </>
  );

  // ---------------------------------------------------------------
  // Drag handle between the two panes
  // ---------------------------------------------------------------

  const resizeHandle = resizable ? (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize editor panel"
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
      className={`group relative z-20 w-[7px] shrink-0 cursor-col-resize touch-none select-none outline-none ${
        dragging ? "bg-emerald-400/20" : "hover:bg-emerald-400/10"
      } focus-visible:bg-emerald-400/20`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors ${
          dragging
            ? "bg-emerald-400"
            : "bg-white/[0.1] group-hover:bg-emerald-400/70 group-focus-visible:bg-emerald-400"
        }`}
      />
    </div>
  ) : null;

  // ---------------------------------------------------------------
  // Editor panel (right)
  // ---------------------------------------------------------------

  const rawText = selected?.raw ?? "";
  const rawLines = rawText ? rawText.split("\n").length : 0;
  const rawSize = byteLength(rawText);

  const editorPanel = selected ? (
    <section
      ref={setPanelEl}
      aria-label="Packet editor"
      onKeyDown={onPanelKeyDown}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#0f0f11]"
    >
      {/* Header: what is selected + Forward / Drop / Close */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.08] bg-[#0d0d0f] px-3 py-2">
        {selectedPacket?.kind === "request" ? (
          <>
            {!tiny && (
              <span className="shrink-0 rounded bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-emerald-300">
                REQUEST
              </span>
            )}

            <div className="flex min-w-0 flex-1 items-center gap-2">
              <MethodBadge method={currentMethod} />

              <span
                className="min-w-0 truncate text-[12.5px] text-white"
                title={selectedRequest?.url ?? undefined}
              >
                {selectedRequest?.host}
                <span className={`${mono.className} text-[#9a9aa8]`}>
                  {currentPath}
                </span>
              </span>
            </div>
          </>
        ) : (
          <>
            {!tiny && (
              <span className="shrink-0 rounded bg-cyan-400/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-cyan-300">
                RESPONSE
              </span>
            )}

            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 rounded-md bg-cyan-400/10 px-2 py-0.5 text-[11px] font-bold text-cyan-300">
                {selectedResponse?.statusCode}
              </span>

              <span
                className="min-w-0 truncate text-[12.5px] text-white"
                title={selectedResponse?.requestUrl}
              >
                {selectedResponse?.reason}
                <span className={`${mono.className} ml-2 text-[#9a9aa8]`}>
                  {selectedResponse?.requestUrl}
                </span>
              </span>
            </div>
          </>
        )}

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => void handleForward()}
            title="Forward (Ctrl+Enter)"
            className={`${btnPrimary} ${headBtn}`}
          >
            Forward
          </button>

          <button
            type="button"
            onClick={() => void handleDrop()}
            title="Drop this packet"
            className={`${btnDanger} ${headBtn}`}
          >
            Drop
          </button>

          <button
            type="button"
            onClick={closePanel}
            title="Close panel (Esc)"
            aria-label="Close panel"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#b5b5c2] transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      </div>

      {/* Toolbar: method, HTTP version, encode, copy, Ask AI, other tools.
          Buttons shrink to icon-only as the panel gets narrower. */}
      <div
        role="toolbar"
        aria-label="Packet tools"
        className={`flex shrink-0 flex-wrap items-center border-b border-white/[0.08] bg-[#0d0d0f] ${
          tiny ? "gap-1.5 px-2 py-1.5" : "gap-2 px-3 py-2"
        }`}
      >
        {isRequestSelected && (
          <>
            <ToolbarMenu
              label={currentMethod}
              title="Change HTTP method"
              sizeClass={btnSize}
              widthClass="w-52"
              items={HTTP_METHODS.map((m) => ({
                key: m,
                label: m,
                active: m === currentMethod,
                onClick: () => applyMethod(m),
              }))}
              footer="Changing the method also rewrites the request: query ⇄ body, Content-Type and Content-Length."
            />

            <Tip label="Switch HTTP version" align="start">
              <button
                type="button"
                onClick={toggleHttpVersion}
                aria-label="Toggle HTTP version"
                className={`${btnOutline} ${mono.className} ${btnSize}`}
              >
                {compact ? currentVersion.replace("HTTP/", "") : currentVersion}
              </button>
            </Tip>
          </>
        )}

        <ToolbarMenu
          label={compact ? null : "Encode"}
          title="Encode / decode selected text"
          icon={<Binary size={iconSize} />}
          sizeClass={btnSize}
          widthClass="w-48"
          items={ENCODE_MENU.map((e) => ({
            key: e.op,
            label: e.label,
            onClick: () => runEncode(e.op),
          }))}
          footer="Applies to the text selected in the editor."
        />

        <div
          className={`ml-auto flex flex-wrap items-center ${
            tiny ? "gap-1.5" : "gap-2"
          }`}
        >
          <Tip label="Copy raw packet" align="end">
            <button
              type="button"
              onClick={() => void copyRaw()}
              aria-label="Copy raw packet"
              className={`${btnOutline} inline-flex items-center gap-1.5 ${btnSize}`}
            >
              {copied ? (
                <Check size={iconSize} className="text-emerald-300" />
              ) : (
                <Copy size={iconSize} />
              )}
              {!compact && (copied ? "Copied" : "Copy")}
            </button>
          </Tip>

          <Tip
            label={
              isRequestSelected
                ? "Ask Gemini AI about this request"
                : "Ask Gemini AI about this response"
            }
            align="end"
          >
            <button
              type="button"
              onClick={askAi}
              aria-label="Ask AI"
              className={`${btnOutline} inline-flex items-center gap-1.5 ${btnSize}`}
            >
              <Sparkles size={iconSize} strokeWidth={1.9} />
              {!compact && "Ask AI"}
            </button>
          </Tip>

          {isRequestSelected && (
            <>
              <Tip
                label={
                  selectedRequest?.url
                    ? "Send this request to Repeater"
                    : "This request cannot be sent to Repeater"
                }
                align="end"
              >
                <button
                  type="button"
                  onClick={handleSendToRepeater}
                  disabled={!selectedRequest?.url}
                  aria-label="Send to Repeater"
                  className={`${btnOutline} inline-flex items-center gap-1.5 ${btnSize} disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  <Repeat2 size={iconSize} strokeWidth={1.9} />
                  {!compact && "Repeater"}
                </button>
              </Tip>

              <Tip label="Send this request to Intruder" align="end">
                <button
                  type="button"
                  onClick={handleSendToIntruder}
                  aria-label="Send to Intruder"
                  className={`${btnOutline} inline-flex items-center gap-1.5 ${btnSize}`}
                >
                  <Zap size={iconSize} strokeWidth={1.9} />
                  {!compact && "Intruder"}
                </button>
              </Tip>
            </>
          )}
        </div>
      </div>

      {actionError && (
        <div
          role="alert"
          className="shrink-0 border-b border-rose-400/20 bg-rose-400/[0.07] px-4 py-2 text-[12px] text-rose-300"
        >
          {actionError}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {selectedPacket?.kind === "request" && selectedRequest ? (
          <RequestEditor
            ref={editorRef}
            key={`request-${selectedRequest.id}`}
            value={selectedRequest.raw}
            onChange={(raw: string) => updateSelectedRaw(raw)}
          />
        ) : selectedResponse ? (
          <RequestEditor
            ref={editorRef}
            key={`response-${selectedResponse.id}`}
            value={selectedResponse.raw}
            onChange={(raw: string) => updateSelectedRaw(raw)}
          />
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 border-t border-white/[0.06] px-4 py-1.5 text-[11px] text-[#777784]">
        <span>
          {selectedPacket?.kind === "request"
            ? "Request editor"
            : "Response editor"}
          <span className="ml-2 text-[#585866]">
            {rawLines} lines · {rawSize} B
          </span>
        </span>
        {!tiny && <span>Ctrl + Enter to forward · Esc to close</span>}
      </div>
    </section>
  ) : null;

  // ---------------------------------------------------------------
  // Page
  // ---------------------------------------------------------------

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Interceptor"
        subtitle="Pause, inspect, and modify requests and responses."
      >
        <button
          type="button"
          onClick={toggleIntercept}
          aria-pressed={interceptOn}
          title={interceptOn ? "Turn interception off" : "Turn interception on"}
          className="inline-flex h-9 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-2 text-[13px] font-semibold transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 sm:h-10 sm:gap-3 sm:text-[14px]"
        >
          <span
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              interceptOn ? "bg-emerald-400" : "bg-rose-400/70"
            }`}
          >
            <span
              className={`inline-block h-[14px] w-[14px] rounded-full bg-white shadow transition-transform ${
                interceptOn ? "translate-x-[19px]" : "translate-x-[3px]"
              }`}
            />
          </span>

          <span className={interceptOn ? "text-emerald-300" : "text-rose-300"}>
            Intercept {interceptOn ? "on" : "off"}
          </span>
        </button>

        <ListenerPill />
      </PageHeader>

      <div
        ref={splitContainerRef}
        className={`flex min-h-0 flex-1 overflow-hidden ${
          dragging ? "cursor-col-resize select-none" : ""
        }`}
      >
        <div ref={setListEl} className={listPaneClass} style={listPaneStyle}>
          {hasPanel && listCollapsed ? queueRail : queuePane}
        </div>

        {resizeHandle}

        {editorPanel}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-white/[0.06] px-4 py-2 text-[11px] text-[#777784] md:px-6">
        <span>
          {queue.length} requests · {responseQueue.length} responses waiting
        </span>
        <span>{interceptOn ? "Interception active" : "Pass-through mode"}</span>
      </div>
    </div>
  );
}
