"use client";

import { sendToIntruder } from "@/components/repeaterBridge";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  RefreshCw,
  Repeat2,
  Search,
  Zap,
  X,
  Radio,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import {
  ListenerPill,
  MethodBadge,
  EmptyState,
  Segmented,
  btnGhost,
  mono,
} from "@/components/ui";
import { useTraffic, type HistoryItem } from "@/components/TrafficProvider";
import { HttpViewer } from "@/components/RequestEditor";
import { sendToRepeater } from "@/components/repeaterBridge";
import { openGeminiAIWith } from "@/components/geminiAI-bridge";

// Size limits for what is handed to Gemini AI.
const AI_REQUEST_LIMIT = 100_000;
const AI_RESPONSE_LIMIT = 50_000;

// Height of the request list, as a percentage of the page body.
const LIST_MIN = 15;
const LIST_MAX = 80;
const LIST_DEFAULT = 45;
const LIST_KEY = "packetsniff.history.listPct";

function clampList(value: number) {
  return Math.min(LIST_MAX, Math.max(LIST_MIN, value));
}

function statusTone(h: HistoryItem) {
  if (h.dropped) return "text-rose-300 bg-rose-400/10 border-rose-400/25";
  const s = h.status ?? 0;
  if (s >= 500) return "text-rose-300 bg-rose-400/10 border-rose-400/25";
  if (s >= 400) return "text-amber-300 bg-amber-400/10 border-amber-400/25";
  if (s >= 300) return "text-sky-300 bg-sky-400/10 border-sky-400/25";
  return "text-emerald-300 bg-emerald-400/10 border-emerald-400/25";
}

function StatusChip({ h }: { h: HistoryItem }) {
  return (
    <span
      className={`${mono.className} inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium md:text-[12px] ${statusTone(h)}`}
    >
      {h.dropped ? "dropped" : h.status}
    </span>
  );
}

function ContentTag({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "amber" | "cyan";
}) {
  const colors = {
    neutral: "border-white/[0.12] bg-white/[0.05] text-[#b9bac5]",
    amber: "border-amber-400/25 bg-amber-400/10 text-amber-300",
    cyan: "border-cyan-400/25 bg-cyan-400/10 text-cyan-300",
  };

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${colors[tone]}`}
    >
      {label}
    </span>
  );
}

function formatResponseTime(duration?: number) {
  if (duration == null || !Number.isFinite(duration) || duration < 0) {
    return "—";
  }

  if (duration >= 1000) {
    return `${(duration / 1000).toFixed(2)} s`;
  }

  return `${duration.toFixed(2)} ms`;
}

function decodeBase64Utf8(b64: string): string {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
}

function formatTimestamp(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function WebSocketFramesViewer({ h }: { h: HistoryItem }) {
  const frames = h.frames ?? [];

  if (frames.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-10 text-[13px] text-[#7a7a88]">
        No WebSocket frames captured for this connection.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Frame column headings */}
      <div className="hidden shrink-0 items-center gap-3 border-b border-white/[0.08] bg-[#0d0d0f] px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#777783] md:flex">
        <span className="w-[80px] shrink-0">Dir</span>
        <span className="w-[80px] shrink-0">Opcode</span>
        <span className="w-[90px] shrink-0 text-right">Time</span>
        <span className="min-w-0 flex-1">Payload</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:#3a3a44_transparent] [scrollbar-width:thin]">
        <ul>
          {frames.map((f, i) => {
            const isClient = f.direction === "client";
            const dirLabel = isClient ? "→ client" : "← server";
            const dirTone = isClient
              ? "text-sky-300 border-sky-400/25 bg-sky-400/10"
              : "text-emerald-300 border-emerald-400/25 bg-emerald-400/10";

            const text = decodeBase64Utf8(f.payload);
            const byteLen = Math.floor((f.payload?.length ?? 0) * 0.75);

            return (
              <li
                key={i}
                className="border-b border-white/[0.05] px-4 py-2 hover:bg-white/[0.02]"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:gap-3">
                  <span
                    className={`${mono.className} inline-flex w-fit shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium md:w-[80px] ${dirTone}`}
                  >
                    {dirLabel}
                  </span>

                  <span
                    className={`${mono.className} inline-flex w-fit shrink-0 items-center rounded-md border border-white/[0.12] bg-white/[0.05] px-1.5 py-0.5 text-[10.5px] font-medium text-[#b9bac5] md:w-[80px]`}
                  >
                    {f.opcode}
                  </span>

                  <span className="shrink-0 text-[11.5px] text-[#8a8a98] md:w-[90px] md:text-right">
                    {formatTimestamp(f.timestamp)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-[#777783]">
                        {byteLen} B
                      </span>
                      {f.edited && (
                        <span className="rounded border border-amber-400/25 bg-amber-400/10 px-1 text-[10px] text-amber-300">
                          edited
                        </span>
                      )}
                    </div>
                    <pre
                      className={`${mono.className} mt-1 max-h-[240px] overflow-auto whitespace-pre-wrap break-all rounded border border-white/[0.06] bg-black/30 px-2 py-1.5 text-[11.5px] text-[#d4d4dc] [scrollbar-width:thin]`}
                    >
                      {text || "(binary payload)"}
                    </pre>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

type DetailTool = {
  id: string;
  label: string;
  icon: LucideIcon;
  title?: string;
  disabled?: boolean;
  onSelect: () => void;
};

export default function HttpHistoryPage() {
  const { history, clearHistory, simulate } = useTraffic();
  const router = useRouter();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [pane, setPane] = useState<"request" | "response" | "websocket">(
    "request",
  );

  const [requestWidth, setRequestWidth] = useState(50);
  const viewerContainerRef = useRef<HTMLDivElement>(null);

  const splitRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [listPct, setListPct] = useState(LIST_DEFAULT);
  const [draggingY, setDraggingY] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LIST_KEY);
      if (saved !== null && Number.isFinite(Number(saved))) {
        setListPct(clampList(Number(saved)));
      }
    } catch {}
  }, []);

  const saveListPct = (value: number) => {
    try {
      window.localStorage.setItem(LIST_KEY, String(value));
    } catch {}
  };

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = term
      ? history.filter((h) =>
          `${h.method} ${h.host}${h.path}`.toLowerCase().includes(term),
        )
      : history;
    return [...list].reverse();
  }, [history, search]);

  const selected = history.find((h) => h.id === selectedId);

  const responseText = selected
    ? selected.dropped
      ? "# This request was dropped, so the server never received it."
      : selected.response
    : "";

  function openPacket(id: number) {
    setSelectedId(id);
    setPane("request");
  }

  function closePanel() {
    setSelectedId(null);
  }

  function handleClear() {
    clearHistory();
    setSelectedId(null);
  }

  function handleSendToRepeater() {
    if (!selected?.url) return;
    sendToRepeater({
      method: selected.method,
      url: selected.url,
      headers: selected.headers ?? [],
      body_base64: selected.body_base64 ?? "",
    });
    router.push("/repeater");
  }

  function handleSendToIntruder() {
    if (!selected) return;
    sendToIntruder({
      rawRequest: selected.raw,
      method: selected.method,
      url: selected.url ?? "",
      headers: selected.headers ?? [],
      body_base64: selected.body_base64 ?? "",
      source: "history",
    });
    router.push("/intruder");
  }

  function handleAskAi() {
    if (!selected) return;

    // Request and response travel together as ONE attachment, so the AI
    // window's "Redact secrets" option masks Authorization / Cookie /
    // Set-Cookie headers in both before anything is sent.
    const request = selected.raw.slice(0, AI_REQUEST_LIMIT);
    const response = selected.dropped
      ? "(This request was dropped, so there is no response.)"
      : (selected.response ?? "").slice(0, AI_RESPONSE_LIMIT);

    const attachment = `${request}\n\n\n### RESPONSE ###\n${response}`;

    openGeminiAIWith({
      prompt:
        "I'm working in the PacketSniffer HTTP History. The attached file" +
        " contains a captured HTTP request, followed by a line reading" +
        " '### RESPONSE ###' and then the server's response. Analyze both" +
        " for security issues: authentication, authorization, injection," +
        " information disclosure, cookie and header problems. Suggest" +
        " concrete follow-up tests.\n\n" +
        `Request: ${selected.method} ${selected.url ?? `${selected.host}${selected.path}`}` +
        (selected.dropped ? "" : `\nResponse status: ${selected.status}`),
      httpRequest: attachment,
      httpRequestName: "history-request-response.http",
    });
  }

  const detailTools: DetailTool[] = [
    {
      id: "repeater",
      label: "Repeater",
      icon: Repeat2,
      disabled: !selected?.url,
      title: selected?.url
        ? "Send this request to Repeater (Ctrl/Cmd+R)"
        : "This request cannot be sent to Repeater",
      onSelect: handleSendToRepeater,
    },
    {
      id: "intruder",
      label: "Intruder",
      icon: Zap,
      title: "Send request to Intruder (Ctrl/Cmd+I)",
      onSelect: handleSendToIntruder,
    },
    {
      id: "ask-ai",
      label: "Ask AI",
      icon: Sparkles,
      title: "Ask Gemini AI about this request and response",
      onSelect: handleAskAi,
    },
    ...(selected?.is_websocket
      ? [
          {
            id: "websocket",
            label: "WebSocket",
            icon: Radio,
            title: "View WebSocket frames",
            onSelect: () => setPane("websocket"),
          } as DetailTool,
        ]
      : []),
  ];

  // ---------------- Keyboard shortcuts ----------------
  //
  // Ctrl/Cmd+R → Send selected request to Repeater
  // Ctrl/Cmd+I → Send selected request to Intruder
  //
  // Both are no-ops when nothing is selected, when the target action is
  // disabled (no URL for Repeater), or when the user is typing in the
  // search box. The focus-in-search-box check is done explicitly because
  // Ctrl+R is the browser's reload shortcut and we don't want to hijack
  // it while the user is typing a query.
  //
  // Ctrl/Cmd+R is intentionally NOT prevented when nothing is selected,
  // so the browser's normal reload still works outside of a selected
  // packet. When something IS selected we call preventDefault() so the
  // page doesn't reload mid-action.
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.shiftKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isTyping =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable === true;

      if (isTyping) return;

      if (e.code === "KeyR") {
        // Only intercept reload when there is a selected packet to send.
        if (!selected?.url) return;
        e.preventDefault();
        handleSendToRepeater();
        return;
      }

      if (e.code === "KeyI") {
        if (!selected) return;
        e.preventDefault();
        handleSendToIntruder();
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  function onListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (rows.length === 0) return;
    e.preventDefault();
    const index = rows.findIndex((h) => h.id === selectedId);
    const nextIndex =
      e.key === "ArrowDown"
        ? Math.min(rows.length - 1, index + 1)
        : Math.max(0, index === -1 ? 0 : index - 1);
    const next = rows[nextIndex];
    if (!next || next.id === selectedId) return;
    openPacket(next.id);
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-row-id="${next.id}"]`)
        ?.focus();
    });
  }

  function onPageKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Escape" || selectedId === null) return;
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    e.preventDefault();
    closePanel();
  }

  function handleDividerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.buttons !== 1) return;
    const container = viewerContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return;
    const nextWidth = ((e.clientX - rect.left) / rect.width) * 100;
    setRequestWidth(Math.min(75, Math.max(25, nextWidth)));
  }

  function onSplitPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggingY(true);
  }

  function onSplitPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingY) return;
    const rect = splitRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return;
    setListPct(clampList(((e.clientY - rect.top) / rect.height) * 100));
  }

  function onSplitPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingY) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDraggingY(false);
    saveListPct(listPct);
  }

  function onSplitKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    let next: number | null = null;
    if (e.key === "ArrowUp") next = clampList(listPct - 2);
    if (e.key === "ArrowDown") next = clampList(listPct + 2);
    if (e.key === "Home") next = LIST_DEFAULT;
    if (next !== null) {
      e.preventDefault();
      setListPct(next);
      saveListPct(next);
    }
  }

  function resetSplit() {
    setListPct(LIST_DEFAULT);
    saveListPct(LIST_DEFAULT);
  }

  const listSection = (
    <section
      aria-label="Captured requests"
      style={selected ? { height: `${listPct}%` } : undefined}
      className={`flex min-h-0 flex-col overflow-hidden ${
        selected ? "shrink-0" : "flex-1"
      }`}
    >
      <div className="hidden shrink-0 items-center gap-3 border-b border-white/[0.08] bg-[#0d0d0f] px-5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#777783] lg:flex">
        <span className="w-[75px] shrink-0">Method</span>
        <span className="min-w-0 flex-1">Host / Path</span>
        <span className="w-[90px] shrink-0 text-center">Status</span>
        <span className="w-[90px] shrink-0 text-right">Size</span>
        <span className="w-[100px] shrink-0 text-right">Response</span>
        <span className="w-[110px] shrink-0 text-right">Time</span>
        <span className="flex w-[260px] shrink-0 justify-end">Content</span>
      </div>

      <div
        ref={listRef}
        onKeyDown={onListKeyDown}
        className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:#3a3a44_transparent] [scrollbar-width:thin]"
      >
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-[#7a7a88]">
            No requests match this filter.
          </div>
        ) : (
          <ul>
            {rows.map((h) => {
              const active = h.id === selectedId;
              return (
                <li key={h.id}>
                  <button
                    type="button"
                    data-row-id={h.id}
                    onClick={() => openPacket(h.id)}
                    aria-current={active ? "true" : undefined}
                    aria-label={`Open ${h.method} ${h.host}${h.path}`}
                    className={`group flex w-full flex-col gap-1.5 border-b border-l-2 border-b-white/[0.05] py-2 pl-2.5 pr-3 text-left transition-colors focus-visible:outline-none focus-visible:bg-emerald-400/[0.06] sm:pl-[18px] sm:pr-5 lg:flex-row lg:items-center lg:gap-3 lg:py-1.5 ${
                      active
                        ? "border-l-emerald-400 bg-emerald-400/[0.07]"
                        : "border-l-transparent hover:bg-white/[0.035]"
                    }`}
                  >
                    <div className="flex shrink-0 items-center gap-2.5 lg:w-[75px]">
                      <MethodBadge method={h.method} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                        <span
                          className={`${mono.className} truncate text-[12px] text-[#d4d4dc] group-hover:text-white md:text-[13px]`}
                        >
                          {h.host}
                        </span>
                        <span
                          className={`${mono.className} truncate text-[11.5px] text-[#8a8a98] md:text-[12px]`}
                        >
                          {h.path}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      <StatusChip h={h} />

                      <span className="w-[75px] text-right text-[11.5px] text-[#8a8a98] md:text-[12px] lg:w-[90px]">
                        {!h.dropped ? `${h.length} B` : "—"}
                      </span>

                      <span className="hidden w-[75px] text-right text-[11.5px] text-[#8a8a98] sm:block md:text-[12px] lg:w-[100px]">
                        {!h.dropped ? formatResponseTime(h.duration) : "—"}
                      </span>

                      <span className="w-[90px] text-right text-[11.5px] text-[#8a8a98] md:text-[12px] lg:w-[110px]">
                        {h.time}
                      </span>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1.5 lg:w-[260px] lg:justify-end">
                      <ContentTag
                        label={`REQ · ${h.requestTag}`}
                        tone={h.requestTag === "OHTTP" ? "amber" : "neutral"}
                      />
                      <ContentTag label={`RES · ${h.responseTag}`} tone="cyan" />
                      {h.is_websocket && (
                        <ContentTag label="WS" tone="cyan" />
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );

  return (
    <div
      onKeyDown={onPageKeyDown}
      className="flex h-full min-h-0 flex-col overflow-hidden"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-white/[0.08] px-3 py-2.5 md:px-5 2xl:grid 2xl:h-[64px] 2xl:grid-cols-[1fr_minmax(0,600px)_1fr] 2xl:gap-x-6 2xl:py-0">
        <div className="order-1 flex min-w-0 items-center gap-3">
          <h1 className="whitespace-nowrap text-[16px] font-semibold tracking-tight text-white">
            HTTP History
          </h1>
          <span className="hidden shrink-0 whitespace-nowrap rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[11.5px] tabular-nums text-[#9a9aa8] sm:inline-flex">
            {rows.length}/{history.length} packets
          </span>
        </div>

        <div className="order-2 ml-auto flex shrink-0 items-center gap-2 2xl:order-3 2xl:justify-self-end">
          <button
            type="button"
            onClick={simulate}
            title="Refresh traffic"
            aria-label="Refresh traffic"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.035] text-[#b5b5c2] transition-colors hover:border-white/[0.18] hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            <RefreshCw size={17} strokeWidth={1.9} />
          </button>

          {history.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              title="Clear history"
              className={`${btnGhost} shrink-0 !h-9 !px-3 !text-[12.5px]`}
            >
              Clear
            </button>
          )}

          <div className="shrink-0">
            <ListenerPill />
          </div>
        </div>

        <div className="relative order-3 w-full min-w-0 basis-full md:mx-auto md:max-w-[640px] 2xl:order-2 2xl:basis-auto 2xl:max-w-none">
          <Search
            size={15}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#7a7a88]"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by host, path or method..."
            aria-label="Filter requests"
            className="h-9 w-full min-w-0 rounded-lg border border-white/[0.1] bg-[#141416] pl-9 pr-3.5 text-[13px] text-white placeholder:text-[#7a7a88] focus:border-emerald-400/50 focus:outline-none focus:ring-2 focus:ring-emerald-400/20"
          />
        </div>
      </div>

      {history.length === 0 ? (
        <EmptyState
          title="No traffic yet"
          body="Forwarded and dropped requests are recorded here with their responses."
        />
      ) : (
        <div
          ref={splitRef}
          className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
            draggingY ? "cursor-row-resize select-none" : ""
          }`}
        >
          {listSection}

          {selected && (
            <>
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize request list and details"
                aria-valuemin={LIST_MIN}
                aria-valuemax={LIST_MAX}
                aria-valuenow={Math.round(listPct)}
                tabIndex={0}
                title="Drag to resize · double-click to reset"
                onPointerDown={onSplitPointerDown}
                onPointerMove={onSplitPointerMove}
                onPointerUp={onSplitPointerUp}
                onPointerCancel={onSplitPointerUp}
                onDoubleClick={resetSplit}
                onKeyDown={onSplitKeyDown}
                className={`group relative z-20 h-[7px] shrink-0 cursor-row-resize touch-none select-none outline-none ${
                  draggingY
                    ? "bg-emerald-400/20"
                    : "hover:bg-emerald-400/10"
                } focus-visible:bg-emerald-400/20`}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 transition-colors ${
                    draggingY
                      ? "bg-emerald-400"
                      : "bg-white/[0.1] group-hover:bg-emerald-400/70 group-focus-visible:bg-emerald-400"
                  }`}
                />
              </div>

              <section
                aria-label="Request and response details"
                className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0f0f11]"
              >
                <div
                  role="toolbar"
                  aria-label="Request tools"
                  className="flex h-10 shrink-0 items-stretch gap-1 border-b border-white/[0.08] bg-[#0d0d0f] px-2"
                >
                  <div className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto [scrollbar-width:none]">
                    {detailTools.map((tool) => {
                      const Icon = tool.icon;
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          onClick={tool.onSelect}
                          disabled={tool.disabled}
                          title={tool.title ?? tool.label}
                          className="inline-flex shrink-0 items-center gap-2 border-b-2 border-transparent px-3 text-[12.5px] font-medium text-[#b5b5c2] transition-colors hover:bg-white/[0.04] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#b5b5c2]"
                        >
                          <Icon size={14} strokeWidth={1.9} />
                          {tool.label}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={closePanel}
                    title="Close details (Esc)"
                    aria-label="Close details"
                    className="my-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#b5b5c2] transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                  >
                    <X size={15} />
                  </button>
                </div>

                <div className="shrink-0 border-b border-white/[0.08] px-3 py-2 xl:hidden">
                  <Segmented
                    value={pane === "websocket" ? "response" : pane}
                    onChange={(v) => setPane(v as "request" | "response")}
                    options={[
                      { value: "request", label: "Request" },
                      { value: "response", label: "Response" },
                    ]}
                  />
                </div>

                <div
                  ref={viewerContainerRef}
                  className="flex min-h-0 flex-1 overflow-hidden"
                >
                  {pane === "websocket" && selected.is_websocket ? (
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#0d0d0f] px-4 py-1.5">
                        <p className="text-[12px] font-medium text-[#c4c4ce]">
                          WebSocket frames
                        </p>
                        <span className="truncate pl-3 text-[11px] text-[#777783]">
                          {selected.frames?.length ?? 0} frame
                          {(selected.frames?.length ?? 0) === 1 ? "" : "s"}
                        </span>
                      </div>
                      <WebSocketFramesViewer h={selected} />
                    </div>
                  ) : (
                    <>
                      <div
                        style={{ flex: `0 0 ${requestWidth}%` }}
                        className={`min-h-0 min-w-0 flex-col overflow-hidden xl:flex ${
                          pane === "request" ? "flex flex-1" : "hidden"
                        }`}
                      >
                        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#0d0d0f] px-4 py-1.5">
                          <p className="text-[12px] font-medium text-[#c4c4ce]">
                            Request
                          </p>
                          <span className="truncate pl-3 text-[11px] text-[#777783]">
                            {selected.requestDetectedMime}
                          </span>
                        </div>
                        <HttpViewer
                          text={selected.raw}
                          className="min-h-0 flex-1"
                        />
                      </div>

                      <div
                        role="separator"
                        aria-label="Resize request and response panels"
                        aria-orientation="vertical"
                        onPointerDown={(e) => {
                          e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={handleDividerMove}
                        className="group relative hidden w-[7px] shrink-0 cursor-col-resize touch-none items-center justify-center bg-[#0b0b0d] transition-colors hover:bg-emerald-400/10 xl:flex"
                      >
                        <div className="h-12 w-[2px] rounded-full bg-white/[0.16] transition-colors group-hover:bg-emerald-400/70" />
                      </div>

                      <div
                        style={{ flex: "1 1 0%" }}
                        className={`min-h-0 min-w-0 flex-col overflow-hidden xl:flex ${
                          pane === "response" ? "flex flex-1" : "hidden"
                        }`}
                      >
                        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#0d0d0f] px-4 py-1.5">
                          <p className="text-[12px] font-medium text-[#c4c4ce]">
                            Response
                          </p>
                          <span className="truncate pl-3 text-[11px] text-[#777783]">
                            {selected.detectedMime ?? selected.mime}
                          </span>
                        </div>
                        <HttpViewer
                          text={responseText}
                          className="min-h-0 flex-1"
                        />
                      </div>
                    </>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}