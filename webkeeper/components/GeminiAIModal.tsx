"use client";

import { onGeminiAIRequest } from "@/components/geminiAI-bridge";

import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Activity,
  ArrowUp,
  Bot,
  Braces,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  KeyRound,
  Paperclip,
  Plus,
  RefreshCw,
  Server,
  Settings2,
  Shield,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { CodeBlock, RichText, useCopy } from "@/components/gemini-markdown";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8765"
).replace(/\/+$/, "");

const KEY_URL = "https://aistudio.google.com/apikey";
const LEGACY_KEY_STORAGE = "packetsniff.gemini.apiKey";

const MAX_FILE_BYTES = 512 * 1024;
const MAX_MESSAGE_CHARS = 20000;
const MAX_API_KEY_CHARS = 500;
const MAX_MODEL_CHARS = 150;
const HISTORY_LIMIT = 10;
const TURN_CHAR_LIMIT = 4000;
const STATUS_TIMEOUT_MS = 6000;
const SETTINGS_TIMEOUT_MS = 20000;
const VALIDATE_TIMEOUT_MS = 40000;
const REQUEST_TIMEOUT_MS = 90000;

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_ANALYZE_TEXT = "Analyze this request for security issues.";

const PRESET_MODELS = [
  {
    id: "gemini-3.5-flash-lite",
    name: "Flash-Lite",
    description: "Fastest and most cost-effective. Great for quick questions.",
    tag: "Recommended",
  },
  {
    id: "gemini-3.6-flash",
    name: "Flash",
    description: "Balanced speed and capability for everyday analysis.",
    tag: "Balanced",
  },
  {
    id: "gemini-3.8-flash",
    name: "Advanced Flash",
    description: "Most capable Flash model for deeper reasoning.",
    tag: "Most capable",
  },
] as const;

/* ------------------------------------------------------------------ */
/* Types & static data                                                 */
/* ------------------------------------------------------------------ */

type Attachment = {
  name: string;
  content: string;
  size: number;
};

type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
  time: number;
  attachment?: Attachment;
  error?: boolean;
};

type Connection = "checking" | "ready" | "nokey" | "offline";
type Feedback = { ok: boolean; text: string };

const CONNECTION_UI: Record<
  Connection,
  { label: string; pill: string; dot: string }
> = {
  checking: {
    label: "Checking…",
    pill: "border-amber-400/25 bg-amber-400/10 text-amber-300",
    dot: "bg-amber-400 animate-pulse",
  },
  ready: {
    label: "Connected",
    pill: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
    dot: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]",
  },
  nokey: {
    label: "No API key",
    pill: "border-amber-400/25 bg-amber-400/10 text-amber-300",
    dot: "bg-amber-400",
  },
  offline: {
    label: "Backend offline",
    pill: "border-rose-400/25 bg-rose-400/10 text-rose-300",
    dot: "bg-rose-400",
  },
};

const suggestions = [
  {
    icon: Activity,
    title: "Analyze an HTTP request",
    description: "Review headers, parameters and potential weaknesses.",
    prompt: "Help me analyze an HTTP request for security issues.",
  },
  {
    icon: Shield,
    title: "Explain a vulnerability",
    description: "Understand a web vulnerability with practical examples.",
    prompt: "Explain IDOR with a practical HTTP request and response example.",
  },
  {
    icon: FileText,
    title: "Review security headers",
    description: "Check the common browser security headers.",
    prompt: "Which HTTP security headers should I check during a web penetration test?",
  },
  {
    icon: Braces,
    title: "Understand JWT security",
    description: "Token structure and common implementation flaws.",
    prompt: "Explain common JWT security misconfigurations.",
  },
];

/* ------------------------------------------------------------------ */
/* Backend API                                                         */
/* ------------------------------------------------------------------ */

class ApiError extends Error {
  status: number;
  kind: "offline" | "nokey" | "other";

  constructor(
    message: string,
    status = 0,
    kind: "offline" | "nokey" | "other" = "other"
  ) {
    super(message);
    this.status = status;
    this.kind = kind;
  }
}

async function readDetail(res: Response) {
  try {
    const data = await res.json();
    const d = data?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d) && d.length) {
      return d.map((x: { msg?: string }) => x?.msg ?? "invalid value").join("; ");
    }
  } catch {
    // Non-JSON error body.
  }
  return `Request failed (${res.status})`;
}

function toApiError(status: number, detail: string) {
  if (status === 503) {
    return new ApiError(
      "No Gemini API key is configured. Open Settings and add one.",
      status,
      "nokey"
    );
  }
  if (status === 429) {
    return new ApiError(
      detail || "Gemini rate limit or quota reached. Please try again later.",
      status
    );
  }
  if (status === 502) {
    return new ApiError(
      detail || "Gemini provider request failed. Check backend logs.",
      status
    );
  }
  if (status === 422) {
    return new ApiError(`The backend rejected the request: ${detail}`, status);
  }
  return new ApiError(detail, status);
}

async function api<T>(
  path: string,
  opts: { method?: "GET" | "POST" | "PUT"; body?: unknown; signal?: AbortSignal } = {}
): Promise<T> {
  const { method = "POST", body, signal } = opts;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: "no-store",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(
      `Can't reach the PacketSniffer backend at ${API_BASE}. Is it running?`,
      0,
      "offline"
    );
  }

  if (!res.ok) throw toApiError(res.status, await readDetail(res));
  return (await res.json()) as T;
}

async function apiWithTimeout<T>(
  path: string,
  opts: { method?: "GET" | "POST" | "PUT"; body?: unknown },
  ms: number
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ms);
  try {
    return await api<T>(path, { ...opts, signal: controller.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new ApiError("The request timed out. Please try again.");
    }
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
}

function readText(value: unknown) {
  if (typeof value === "string" && value.trim()) return value;
  throw new ApiError("The backend returned an empty response.");
}

type SettingsResponse = {
  configured?: boolean;
  model?: string;
  api_key_masked?: string | null;
  // "system_keyring", or "local_file" on Linux systems without a keyring.
  credential_storage?: string | null;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

// Opens an external link through Tauri, so it works inside the desktop
// app (a plain <a target="_blank"> does nothing there).
async function openExternal(url: string) {
  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== "https:") {
      throw new Error("Only HTTPS links are allowed");
    }

    await openUrl(parsedUrl.href);
  } catch (error) {
    console.error("[PacketSniffer] Failed to open link:", error);
  }
}

function parseHttp(raw: string) {
  const lines = raw.split(/\r?\n/);
  const first = (lines[0] ?? "").trim();
  const match = first.match(/^([A-Z]+)\s+(\S+)(?:\s+HTTP\/[\d.]+)?$/);
  if (!match) return null;

  const headers: Record<string, string> = {};
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      break;
    }
    const idx = line.indexOf(":");
    if (idx > 0) {
      headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
  }
  const body = lines.slice(i).join("\n").trim();

  return {
    method: match[1],
    path: match[2],
    headers,
    body,
    count: Object.keys(headers).length,
  };
}

function redactSecrets(raw: string) {
  return raw.replace(
    /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token):.*$/gim,
    "$1: [REDACTED]"
  );
}

function requestPayload(att: Attachment) {
  const parsed = parseHttp(att.content);
  if (!parsed) return { source: att.name, raw: att.content };

  return {
    source: att.name,
    method: parsed.method,
    path: parsed.path,
    headers: parsed.headers,
    body: parsed.body.slice(0, MAX_MESSAGE_CHARS),
  };
}

function toTurn(m: Message) {
  let text = m.content;
  if (m.attachment) {
    text += `\n[Attached request: ${m.attachment.name}]\n${m.attachment.content}`;
  }
  return { role: m.role, text: text.slice(0, TURN_CHAR_LIMIT) };
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isPreset(id: string) {
  return PRESET_MODELS.some((m) => m.id === id);
}

function modelLabel(id: string) {
  return PRESET_MODELS.find((m) => m.id === id)?.name ?? id;
}

/* ------------------------------------------------------------------ */
/* Shared UI primitives                                                */
/* ------------------------------------------------------------------ */

/**
 * Inputs that live inside a bordered wrapper must NEVER draw their own
 * border / ring / outline. Inline styles beat any global CSS (tailwind
 * forms plugin, globals.css `:focus` rules, browser defaults), which is
 * what was producing the "double box" look.
 */
const BARE_STYLE: CSSProperties = {
  outline: "none",
  outlineOffset: 0,
  boxShadow: "none",
  border: "none",
  background: "transparent",
  appearance: "none",
  WebkitAppearance: "none",
};

const BARE_INPUT_CLASS =
  "w-full appearance-none border-none bg-transparent text-white outline-none ring-0 ring-offset-0 shadow-none focus:border-none focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:border-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-[#666672] disabled:opacity-50";

const FIELD_CLASS =
  "h-10 w-full appearance-none rounded-lg border border-white/[0.1] bg-[#17171a] px-3 text-[13px] text-white outline-none ring-0 ring-offset-0 shadow-none transition-colors placeholder:text-[#666672] focus:border-emerald-400/50 focus:outline-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50";

const FIELD_STYLE: CSSProperties = {
  outline: "none",
  boxShadow: "none",
};

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 ${
        checked
          ? "border-emerald-400/50 bg-emerald-400"
          : "border-white/[0.14] bg-white/[0.08] hover:bg-white/[0.12]"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full shadow transition-transform duration-200 motion-reduce:transition-none ${
          checked ? "translate-x-5 bg-[#07130d]" : "translate-x-0 bg-[#c4c4ce]"
        }`}
      />
    </button>
  );
}

function PanelSection({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-[#e5e5ec]">
          {icon}
          {title}
        </h3>
        {description && (
          <p className="mt-1 text-[12.5px] leading-[19px] text-[#8a8a98]">
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function StatusPill({ connection }: { connection: Connection }) {
  const ui = CONNECTION_UI[connection];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${ui.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ui.dot}`} />
      {ui.label}
    </span>
  );
}

function FeedbackNote({
  feedback,
  refEl,
}: {
  feedback: Feedback;
  refEl?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={refEl}
      role={feedback.ok ? "status" : "alert"}
      className={`flex scroll-mt-4 items-start gap-2 rounded-lg border px-3 py-2.5 text-[12.5px] leading-[19px] ${
        feedback.ok
          ? "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200"
          : "border-rose-400/25 bg-rose-400/[0.08] text-rose-200"
      }`}
    >
      {feedback.ok ? (
        <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
      ) : (
        <XCircle size={15} className="mt-0.5 shrink-0" />
      )}
      <span className="min-w-0 break-words">{feedback.text}</span>
    </div>
  );
}

function AssistantAvatar({ error = false }: { error?: boolean }) {
  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border shadow-sm ${
        error
          ? "border-amber-400/25 bg-amber-400/10 text-amber-300"
          : "border-emerald-400/25 bg-gradient-to-br from-emerald-400/[0.18] to-emerald-400/[0.05] text-emerald-300"
      }`}
    >
      <Sparkles size={17} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Custom model dropdown                                               */
/* ------------------------------------------------------------------ */

function ModelDropdown({
  value,
  customMode,
  disabled,
  onSelectPreset,
  onSelectCustom,
}: {
  value: string;
  customMode: boolean;
  disabled?: boolean;
  onSelectPreset: (id: string) => void;
  onSelectCustom: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = customMode
    ? { name: "Custom model", tag: "Custom", id: value || "—" }
    : PRESET_MODELS.find((m) => m.id === value) ?? {
        name: "Select a model",
        tag: "",
        id: value,
      };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-10 w-full items-center justify-between gap-2 rounded-lg border bg-[#17171a] px-3 text-left text-[13px] outline-none transition-colors focus:outline-none focus-visible:outline-none ${
          open
            ? "border-emerald-400/50"
            : "border-white/[0.1] hover:border-white/[0.18]"
        } disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Cpu size={13} className="shrink-0 text-emerald-300" />
          <span className="min-w-0 truncate text-[#e5e5ec]">{current.name}</span>
          {current.tag && (
            <span className="hidden shrink-0 rounded-full border border-white/[0.1] px-1.5 py-px text-[10.5px] text-[#9a9aa8] sm:inline">
              {current.tag}
            </span>
          )}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-[#8a8a98] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-xl border border-white/[0.1] bg-[#17171a] p-1 shadow-2xl shadow-black/60"
        >
          {PRESET_MODELS.map((m) => {
            const selected = !customMode && value === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onSelectPreset(m.id);
                  setOpen(false);
                }}
                className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors outline-none focus:outline-none focus-visible:outline-none ${
                  selected ? "bg-emerald-400/[0.1]" : "hover:bg-white/[0.05]"
                }`}
              >
                <span
                  className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    selected
                      ? "border-emerald-400 bg-emerald-400"
                      : "border-white/[0.25]"
                  }`}
                >
                  {selected && (
                    <Check size={10} strokeWidth={3} className="text-[#07130d]" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-[#e5e5ec]">
                      {m.name}
                    </span>
                    <span className="rounded-full border border-white/[0.1] px-1.5 py-px text-[10px] text-[#9a9aa8]">
                      {m.tag}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-4 text-[#8a8a98]">
                    {m.description}
                  </span>
                  <span
                    className={`${mono.className} mt-0.5 block text-[10.5px] text-[#6b6b78]`}
                  >
                    {m.id}
                  </span>
                </span>
              </button>
            );
          })}

          <div className="my-1 h-px bg-white/[0.06]" />

          <button
            type="button"
            role="option"
            aria-selected={customMode}
            onClick={() => {
              onSelectCustom();
              setOpen(false);
            }}
            className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors outline-none focus:outline-none focus-visible:outline-none ${
              customMode ? "bg-emerald-400/[0.1]" : "hover:bg-white/[0.05]"
            }`}
          >
            <span
              className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                customMode
                  ? "border-emerald-400 bg-emerald-400"
                  : "border-white/[0.25]"
              }`}
            >
              {customMode && (
                <Check size={10} strokeWidth={3} className="text-[#07130d]" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-[13px] font-semibold text-[#e5e5ec]">
                Custom model
              </span>
              <span className="mt-0.5 block text-[11.5px] leading-4 text-[#8a8a98]">
                Enter any model ID your key can access.
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Message rendering                                                   */
/* ------------------------------------------------------------------ */

function MessageView({ message, model }: { message: Message; model: string }) {
  const { copied, copy } = useCopy();

  if (message.role === "user") {
    return (
      <div className="flex min-w-0 flex-col items-end gap-1.5">
        <div className="min-w-0 max-w-[88%] space-y-3 overflow-hidden rounded-2xl rounded-tr-md border border-emerald-400/20 bg-emerald-400/[0.1] px-4 py-3 text-[15px] leading-[26px] text-[#e8f8ef] shadow-sm shadow-emerald-900/10 [overflow-wrap:anywhere]">
          {message.content && (
            <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {message.content}
            </p>
          )}
          {message.attachment && (
            <div className="min-w-0 space-y-1.5">
              <div className="flex items-center gap-2 text-[12.5px] text-emerald-200/80">
                <Paperclip size={12} className="shrink-0" />
                <span className="truncate">{message.attachment.name}</span>
                <span className="shrink-0 text-emerald-200/50">
                  · {formatSize(message.attachment.size)}
                </span>
              </div>
              <div className="max-w-full overflow-x-auto [&_pre]:max-w-full [&_pre]:overflow-x-auto">
                <CodeBlock code={message.attachment.content} />
              </div>
            </div>
          )}
        </div>
        <span className="px-1.5 text-[11.5px] text-[#62626e]">
          You · {formatTime(message.time)}
        </span>
      </div>
    );
  }

  return (
    <div className="group flex min-w-0 gap-3.5">
      <AssistantAvatar error={message.error} />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2 text-[12.5px]">
          <span className="font-semibold text-[#ececf1]">PacketSniffer AI</span>
          {model && !message.error && (
            <span className={`${mono.className} text-[11px] text-[#6b6b78]`}>
              {model}
            </span>
          )}
          <span className="text-[#62626e]">{formatTime(message.time)}</span>
        </div>
        {message.error ? (
          <p className="break-words rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3.5 py-3 text-[14px] leading-[24px] text-amber-200">
            {message.content}
          </p>
        ) : (
          <>
            <div className="min-w-0 break-words text-[15px] leading-[26px] text-[#d6d6de] [&_pre]:max-w-full [&_pre]:overflow-x-auto">
              <RichText text={message.content} />
            </div>
            <button
              type="button"
              onClick={() => void copy(message.content)}
              className="mt-2 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11.5px] text-[#7c7c8a] opacity-0 transition-all hover:bg-white/[0.06] hover:text-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 group-hover:opacity-100"
            >
              {copied ? (
                <Check size={12} className="text-emerald-400" />
              ) : (
                <Copy size={12} />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3.5">
      <AssistantAvatar />
      <div className="flex items-center gap-2 pt-2" aria-label="Gemini is thinking">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{ animationDelay: `${i * 150}ms` }}
              className="h-2 w-2 animate-bounce rounded-full bg-emerald-400/70 motion-reduce:animate-none"
            />
          ))}
        </div>
        <span className="text-[12.5px] text-[#7c7c8a]">Thinking…</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

export default function GeminiAIModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // ---- state ----
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  // Settings are closed by default; they open automatically on key/errors.
  const [panelOpen, setPanelOpen] = useState(false);
  const [redact, setRedact] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");

  const [connection, setConnection] = useState<Connection>("checking");
  const [model, setModel] = useState("");
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [credentialStorage, setCredentialStorage] = useState<string | null>(
    null
  );

  const [draftKey, setDraftKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [draftModel, setDraftModel] = useState(DEFAULT_MODEL);
  const [customMode, setCustomMode] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [removingKey, setRemovingKey] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // ---- refs ----
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const statusAbort = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  const dragDepth = useRef(0);

  const panelScrollRef = useRef<HTMLDivElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  const nextId = () => ++idRef.current;
  const parsedAttachment = attachment ? parseHttp(attachment.content) : null;
  const checking = connection === "checking";
  const configured = connection === "ready";
  const busySettings = savingKey || savingModel || removingKey || testing;
  const offline = connection === "offline";

  // ---- derived helpers (not hooks) ----
  function applySettings(data: SettingsResponse) {
    if (typeof data?.model === "string" && data.model) setModel(data.model);
    setMaskedKey(data?.api_key_masked ?? null);
    setCredentialStorage(data?.credential_storage ?? null);
    setConnection(data?.configured ? "ready" : "nokey");
    // No API key -> surface the settings panel.
    if (!data?.configured) setPanelOpen(true);
  }

  async function refreshStatus() {
    statusAbort.current?.abort();
    const controller = new AbortController();
    statusAbort.current = controller;
    const timer = window.setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);

    setConnection("checking");

    try {
      const data = await api<SettingsResponse>("/api/ai/status", {
        method: "GET",
        signal: controller.signal,
      });
      if (statusAbort.current !== controller) return;
      applySettings(data);
    } catch {
      if (statusAbort.current !== controller) return;
      setConnection("offline");
      // Backend unreachable -> surface the settings panel.
      setPanelOpen(true);
    } finally {
      window.clearTimeout(timer);
    }
  }

  // ---- ALL hooks (in a stable order, none conditionally skipped) ----

  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_KEY_STORAGE);
    } catch {
      // Ignore storage errors.
    }
  }, []);

  useEffect(() => {
    if (open) void refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!model) return;
    setDraftModel(model);
    setCustomMode(!isPreset(model));
  }, [model]);

  useEffect(() => {
    if (open) return;
    setDraftKey("");
    setShowKey(false);
    setConfirmRemove(false);
    setFeedback(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      document.body.style.overflow = previous;
      window.clearTimeout(t);
    };
  }, [open]);

  // Settings start closed every time the modal opens.
  useEffect(() => {
    if (open) setPanelOpen(false);
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, thinking]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [input, open]);

  useEffect(() => {
    if (!feedback) return;
    panelScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [feedback]);

  useEffect(() => {
    if (!notice) return;
    noticeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [notice]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      statusAbort.current?.abort();
    },
    []
  );

  // External "Ask AI" bridge — MUST be before the early return so hooks
  // are never conditionally skipped.
  useEffect(() => {
    return onGeminiAIRequest((seed) => {
      startNewAnalysis();
      setInput(seed.prompt);
      if (seed.httpRequest) {
        setAttachment({
          name: seed.httpRequestName ?? "repeater-request.http",
          content: seed.httpRequest,
          size: new Blob([seed.httpRequest]).size,
        });
      }
      inputRef.current?.focus();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- early return AFTER all hooks ----
  if (!open) return null;

  /* ---------------------------- Settings --------------------------- */

  function openSettings() {
    setPanelOpen(true);
  }

  async function testConnection(prefix = ""): Promise<Feedback> {
    setTesting(true);
    try {
      const data = await apiWithTimeout<{ message?: string; model?: string }>(
        "/api/ai/validate",
        { method: "POST" },
        VALIDATE_TIMEOUT_MS
      );
      setConnection("ready");
      const reply = (data.message ?? "").trim().slice(0, 120);
      return {
        ok: true,
        text: `${prefix}Connection test passed${reply ? `: “${reply}”` : "."}`,
      };
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.kind === "offline") setConnection("offline");
        if (e.kind === "nokey") setConnection("nokey");
      }
      const reason = e instanceof Error ? e.message : "Connection test failed.";
      return { ok: false, text: `${prefix}${reason}` };
    } finally {
      setTesting(false);
    }
  }

  async function onTestClick() {
    setFeedback(null);
    setFeedback(await testConnection());
  }

  async function saveKey() {
    const key = draftKey.trim();
    if (!key) return;
    if (key.length > MAX_API_KEY_CHARS) {
      setFeedback({
        ok: false,
        text: `API key is too long (max ${MAX_API_KEY_CHARS} characters).`,
      });
      return;
    }

    setFeedback(null);
    setSavingKey(true);
    try {
      const data = await apiWithTimeout<SettingsResponse>(
        "/api/ai/settings",
        {
          method: "PUT",
          body: {
            api_key: key,
            model: (model || draftModel || DEFAULT_MODEL).trim(),
            clear_api_key: false,
          },
        },
        SETTINGS_TIMEOUT_MS
      );
      applySettings(data);
      setDraftKey("");
      setShowKey(false);
      setSavingKey(false);
      setFeedback(await testConnection("API key saved. "));
    } catch (e) {
      if (e instanceof ApiError && e.kind === "offline") setConnection("offline");
      setFeedback({
        ok: false,
        text: e instanceof Error ? e.message : "Couldn't save the API key.",
      });
    } finally {
      setSavingKey(false);
    }
  }

  async function removeKey() {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setConfirmRemove(false);
    setFeedback(null);
    setRemovingKey(true);
    try {
      const data = await apiWithTimeout<SettingsResponse>(
        "/api/ai/settings",
        {
          method: "PUT",
          body: {
            api_key: null,
            model: (model || draftModel || DEFAULT_MODEL).trim(),
            clear_api_key: true,
          },
        },
        SETTINGS_TIMEOUT_MS
      );
      applySettings(data);
      setDraftKey("");
      setFeedback({ ok: true, text: "API key removed from the backend." });
    } catch (e) {
      if (e instanceof ApiError && e.kind === "offline") setConnection("offline");
      setFeedback({
        ok: false,
        text: e instanceof Error ? e.message : "Couldn't remove the API key.",
      });
    } finally {
      setRemovingKey(false);
    }
  }

  async function saveModel() {
    const next = draftModel.trim();
    if (!next) {
      setFeedback({ ok: false, text: "Enter a model ID." });
      return;
    }
    if (next.length > MAX_MODEL_CHARS) {
      setFeedback({
        ok: false,
        text: `Model ID is too long (max ${MAX_MODEL_CHARS} characters).`,
      });
      return;
    }
    if (/\s/.test(next)) {
      setFeedback({ ok: false, text: "Model IDs can't contain spaces." });
      return;
    }

    setFeedback(null);
    setSavingModel(true);
    try {
      const data = await apiWithTimeout<SettingsResponse>(
        "/api/ai/settings",
        {
          method: "PUT",
          body: { api_key: null, model: next, clear_api_key: false },
        },
        SETTINGS_TIMEOUT_MS
      );
      applySettings(data);
      setSavingModel(false);

      if (data?.configured) {
        setFeedback(await testConnection(`Model set to ${next}. `));
      } else {
        setFeedback({
          ok: true,
          text: `Model set to ${next}. Add an API key to start using it.`,
        });
      }
    } catch (e) {
      if (e instanceof ApiError && e.kind === "offline") setConnection("offline");
      setFeedback({
        ok: false,
        text: e instanceof Error ? e.message : "Couldn't save the model.",
      });
    } finally {
      setSavingModel(false);
    }
  }

  /* ---------------------------- Attachments ------------------------ */

  async function attachFile(file?: File) {
    if (!file) return;
    setNotice("");

    if (file.size > MAX_FILE_BYTES) {
      setNotice("File is too large (max 512 KB).");
      return;
    }

    try {
      const content = await file.text();
      setAttachment({ name: file.name, content, size: file.size });
    } catch {
      setNotice("Couldn't read that file.");
    }
  }

  function startNewAnalysis() {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setInput("");
    setAttachment(null);
    setThinking(false);
    setNotice("");
    inputRef.current?.focus();
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setThinking(false);
  }

  /* ---------------------------- Chat ------------------------------- */

  async function send(text = input) {
    const trimmed = text.trim();
    if ((!trimmed && !attachment) || thinking) return;

    if (connection === "nokey") {
      setNotice("Add a Gemini API key in Settings before sending a message.");
      openSettings();
      return;
    }

    if (trimmed.length > MAX_MESSAGE_CHARS) {
      setNotice(
        `Message is too long (max ${MAX_MESSAGE_CHARS.toLocaleString()} characters). Shorten it or attach it as a file.`
      );
      return;
    }

    const req: Attachment | undefined = attachment
      ? {
          ...attachment,
          content: redact ? redactSecrets(attachment.content) : attachment.content,
        }
      : undefined;

    const userMessage: Message = {
      id: nextId(),
      role: "user",
      content: trimmed || DEFAULT_ANALYZE_TEXT,
      time: Date.now(),
      attachment: req,
    };

    const prior = messages
      .filter((m) => !m.error)
      .slice(-HISTORY_LIMIT)
      .map(toTurn);

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setAttachment(null);
    setNotice("");
    setThinking(true);

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      let reply: string;

      if (!trimmed && req) {
        const data = await api<{ analysis?: unknown }>("/api/ai/analyze", {
          body: { request: requestPayload(req) },
          signal: controller.signal,
        });
        reply = readText(data.analysis);
      } else {
        const context: Record<string, unknown> = {};
        if (prior.length) context.conversation = prior;
        if (req) context.http_request = requestPayload(req);

        const data = await api<{ response?: unknown }>("/api/ai/chat", {
          body: {
            message: trimmed,
            context: Object.keys(context).length ? context : null,
          },
          signal: controller.signal,
        });
        reply = readText(data.response);
      }

      setMessages((current) => [
        ...current,
        { id: nextId(), role: "assistant", content: reply, time: Date.now() },
      ]);
      setConnection("ready");
    } catch (e) {
      let content: string;

      if ((e as Error).name === "AbortError") {
        if (!timedOut) return;
        content = "The request timed out. Gemini took too long to respond.";
      } else {
        if (e instanceof ApiError) {
          if (e.kind === "offline") setConnection("offline");
          if (e.kind === "nokey") setConnection("nokey");
        }
        content = e instanceof Error ? e.message : "Something went wrong.";
      }

      // Any error -> open settings so the user can fix key / model / backend.
      setPanelOpen(true);

      setMessages((current) => [
        ...current,
        { id: nextId(), role: "assistant", content, time: Date.now(), error: true },
      ]);
    } finally {
      window.clearTimeout(timer);
      if (abortRef.current === controller) {
        abortRef.current = null;
        setThinking(false);
      }
    }
  }

  function onPaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const text = event.clipboardData.getData("text");
    if (text.includes("\n") && parseHttp(text)) {
      event.preventDefault();
      setAttachment({
        name: "pasted-request.http",
        content: text,
        size: new Blob([text]).size,
      });
    }
  }

  function onDragEnter(event: DragEvent) {
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }

  function onDragLeave(event: DragEvent) {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    void attachFile(event.dataTransfer.files?.[0]);
  }

  const canSend = (!!input.trim() || !!attachment) && connection !== "offline";
  // The banner is redundant while the settings panel is already showing.
  const showSetupBanner =
    (connection === "nokey" || connection === "offline") && !panelOpen;
  const modelDirty = draftModel.trim() !== model && !!draftModel.trim();

  return (
    <div
      className={`${sans.className} fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-4`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="PacketSniffer AI"
        onDragEnter={onDragEnter}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className="relative flex h-full max-h-[920px] w-full max-w-[1360px] overflow-hidden rounded-2xl border border-white/[0.1] bg-[#111113] text-white shadow-2xl shadow-black/60"
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-[#111113]/90 backdrop-blur-sm">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-dashed border-emerald-400/50 bg-emerald-400/10 text-emerald-300">
              <Paperclip size={24} />
            </div>
            <p className="text-sm font-semibold text-[#e5e5ec]">
              Drop to attach request
            </p>
            <p className="text-xs text-[#8a8a98]">
              .txt, .http, .req · up to 512 KB
            </p>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/[0.08] px-4 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-gradient-to-br from-[#17171a] to-[#101012] text-emerald-300">
                <Sparkles size={18} />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-[15.5px] font-semibold leading-5 tracking-tight text-[#ececf1]">
                  PacketSniffer <span className="text-emerald-400">AI</span>
                </h2>
                <p className="truncate text-[12px] leading-4 text-[#9a9aa8]">
                  Integrated by Gemini
                </p>
              </div>

              <span className="mx-1 hidden h-6 w-px bg-white/[0.08] md:block" />

              {model && (
                <button
                  type="button"
                  onClick={() => openSettings()}
                  title="Change model"
                  className={`${mono.className} hidden items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11.5px] text-[#b4b4c0] transition-colors hover:border-emerald-400/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 md:inline-flex`}
                >
                  <Cpu size={12} className="text-emerald-300" />
                  {model}
                </button>
              )}
              <span className="hidden sm:inline-flex">
                <StatusPill connection={connection} />
              </span>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={startNewAnalysis}
                className="flex h-9 items-center gap-2 rounded-lg px-3 text-[13.5px] font-medium text-[#a8a8b4] transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
              >
                <Plus size={15} />
                <span className="hidden sm:inline">New analysis</span>
              </button>

              <button
                type="button"
                onClick={() => setPanelOpen((v) => !v)}
                aria-pressed={panelOpen}
                title="Settings"
                aria-label="Toggle settings panel"
                className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 ${
                  panelOpen
                    ? "bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/[0.16]"
                    : "text-[#9a9aa8] hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                <Settings2 size={17} />
              </button>

              <button
                type="button"
                onClick={onClose}
                title="Close (Esc)"
                aria-label="Close assistant"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[#9a9aa8] transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
              >
                <X size={18} />
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:rgba(255,255,255,0.12)_transparent] [scrollbar-width:thin]">
            {messages.length === 0 ? (
              <div className="mx-auto flex min-h-full w-full max-w-[900px] flex-col justify-center px-5 py-8 sm:px-8">
                <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300 shadow-lg shadow-emerald-900/20">
                  <Bot size={28} />
                </div>

                <h1 className="text-3xl font-semibold tracking-tight text-[#ececf1] sm:text-[34px]">
                  What are we testing today?
                </h1>
                <p className="mt-3 max-w-xl text-[15px] leading-[26px] text-[#9a9aa8]">
                  Ask questions, understand vulnerabilities, or bring an HTTP
                  request for analysis. Paste a raw request or drop a file
                  anywhere in this window. Attach a request with no message to
                  get a full security analysis.
                </p>

                {connection === "nokey" && (
                  <div className="mt-6 flex flex-col gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-4 sm:flex-row sm:items-center">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300">
                      <KeyRound size={17} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold text-amber-100">
                        Connect Gemini to get started
                      </p>
                      <p className="mt-0.5 text-[13px] leading-5 text-[#c9c9d2]">
                        Add your API key and choose a model. The key is stored
                        in your system credential store, not in the browser.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openSettings()}
                      className="shrink-0 rounded-lg bg-amber-400 px-3.5 py-2 text-[13px] font-semibold text-[#1a1203] transition-colors hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70"
                    >
                      Add API key
                    </button>
                  </div>
                )}

                <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {suggestions.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.title}
                        type="button"
                        onClick={() => void send(item.prompt)}
                        className="group flex items-start gap-3 rounded-xl border border-white/[0.08] bg-[#141416] p-4 text-left transition-all hover:-translate-y-px hover:border-emerald-400/30 hover:bg-gradient-to-br hover:from-emerald-400/[0.08] hover:to-transparent hover:shadow-lg hover:shadow-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-[#9a9aa8] transition-colors group-hover:bg-emerald-400/15 group-hover:text-emerald-300">
                          <Icon size={17} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-[14.5px] font-semibold text-[#e5e5ec]">
                              {item.title}
                            </span>
                            <ArrowUp
                              size={14}
                              className="shrink-0 rotate-45 text-[#666672] transition-colors group-hover:text-emerald-400"
                            />
                          </span>
                          <span className="mt-1 block text-[13px] leading-5 text-[#8a8a98]">
                            {item.description}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-7 flex items-center gap-2 text-[12.5px] text-[#6b6b78]">
                  <Shield size={13} />
                  Use only on systems you own or are authorized to test.
                </div>
              </div>
            ) : (
              <div className="mx-auto w-full min-w-0 max-w-[1040px] space-y-7 px-5 py-6 sm:px-10">
                {messages.map((message) => (
                  <MessageView key={message.id} message={message} model={model} />
                ))}
                {thinking && <TypingIndicator />}
                <div ref={endRef} />
              </div>
            )}
          </div>

          <footer className="shrink-0 border-t border-white/[0.08] bg-[#0f0f11] px-4 py-4 sm:px-10">
            <div className="mx-auto max-w-[1040px]">
              {showSetupBanner && (
                <div className="mb-3 flex items-center gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2.5">
                  {connection === "offline" ? (
                    <Server size={16} className="shrink-0 text-amber-300" />
                  ) : (
                    <KeyRound size={16} className="shrink-0 text-amber-300" />
                  )}
                  <p className="min-w-0 flex-1 text-[13px] leading-5 text-[#c9c9d2]">
                    {connection === "offline"
                      ? "Can't reach the PacketSniffer backend. Start it, then recheck."
                      : "No Gemini API key is configured yet."}
                  </p>
                  {connection === "offline" ? (
                    <button
                      type="button"
                      onClick={() => void refreshStatus()}
                      className="shrink-0 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-[12.5px] font-semibold text-amber-200 transition-colors hover:bg-amber-400/[0.18] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                    >
                      Recheck
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openSettings()}
                      className="shrink-0 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-[12.5px] font-semibold text-amber-200 transition-colors hover:bg-amber-400/[0.18] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                    >
                      Add API key
                    </button>
                  )}
                </div>
              )}

              {/* ONE border only (this wrapper). The textarea is fully bare. */}
              <div className="rounded-2xl border border-white/[0.1] bg-[#17171a] shadow-xl shadow-black/25 transition-colors focus-within:border-emerald-400/40">
                {attachment && (
                  <div className="flex items-center gap-3 border-b border-white/[0.06] px-3 py-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
                      <FileText size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-[#e5e5ec]">
                        {attachment.name}
                      </p>
                      <p className={`${mono.className} truncate text-[11.5px] text-[#8a8a98]`}>
                        {parsedAttachment
                          ? `${parsedAttachment.method} ${parsedAttachment.path} · ${parsedAttachment.count} headers`
                          : "Plain text"}{" "}
                        · {formatSize(attachment.size)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAttachment(null)}
                      aria-label="Remove attachment"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-[#8a8a98] transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}

                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onPaste={onPaste}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  placeholder={
                    attachment
                      ? "Add a question, or send as is for a full analysis…"
                      : "Ask about web security, HTTP traffic, vulnerabilities…"
                  }
                  rows={1}
                  style={BARE_STYLE}
                  className={`max-h-[220px] min-h-[56px] resize-none rounded-2xl px-4 py-4 text-[15px] leading-6 caret-emerald-400 [overflow-wrap:anywhere] ${BARE_INPUT_CLASS}`}
                />

                <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
                  <div className="flex items-center gap-1.5">
                    {redact && (
                      <span
                        title="Authorization, Cookie and API-key headers are masked before sending"
                        className="hidden items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-2 py-1 text-[11.5px] font-medium text-emerald-300 sm:inline-flex"
                      >
                        <ShieldCheck size={12} />
                        Redaction on
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="hidden text-[11.5px] text-[#62626e] md:inline">
                      <kbd className="rounded border border-white/[0.1] bg-white/[0.04] px-1.5 py-px text-[10.5px]">
                        Enter
                      </kbd>{" "}
                      to send ·{" "}
                      <kbd className="rounded border border-white/[0.1] bg-white/[0.04] px-1.5 py-px text-[10.5px]">
                        Shift Enter
                      </kbd>{" "}
                      for new line
                    </span>

                    {thinking ? (
                      <button
                        type="button"
                        onClick={stop}
                        title="Stop"
                        aria-label="Stop generating"
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.14] bg-white/[0.06] text-[#e5e5ec] transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                      >
                        <Square size={12} fill="currentColor" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void send()}
                        disabled={!canSend}
                        title="Send message"
                        aria-label="Send message"
                        className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-400 text-[#07130d] shadow-md shadow-emerald-900/30 transition-all hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70 disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none disabled:hover:bg-emerald-400"
                      >
                        <ArrowUp size={18} />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {notice && (
                <p
                  ref={noticeRef}
                  className="mt-2 scroll-mt-4 text-center text-[12.5px] text-amber-300/90"
                  role="alert"
                >
                  {notice}
                </p>
              )}
            </div>
          </footer>
        </div>

        {panelOpen && (
          <aside
            aria-label="Settings"
            className="absolute inset-y-0 right-0 z-20 flex w-[400px] max-w-full shrink-0 flex-col border-l border-white/[0.08] bg-[#0f0f11] shadow-2xl shadow-black/60 lg:static lg:z-auto lg:shadow-none"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.08] px-5">
              <p className="text-[14.5px] font-semibold text-[#e5e5ec]">Settings</p>
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                aria-label="Close settings"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#9a9aa8] transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
              >
                <X size={16} />
              </button>
            </div>

            <div
              ref={panelScrollRef}
              className="min-h-0 flex-1 space-y-7 overflow-y-auto p-5 [scrollbar-color:rgba(255,255,255,0.12)_transparent] [scrollbar-width:thin]"
            >
              {feedback && <FeedbackNote feedback={feedback} refEl={feedbackRef} />}

              <PanelSection
                title="Privacy"
                icon={<ShieldCheck size={14} className="text-emerald-300" />}
              >
                <div className="flex items-start gap-3 rounded-xl border border-white/[0.08] bg-[#141416] p-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold text-[#e5e5ec]">
                      Redact secrets
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-[19px] text-[#8a8a98]">
                      Masks Authorization, Cookie and API-key headers in the
                      browser before a request is sent.
                    </p>
                  </div>
                  <Toggle checked={redact} onChange={setRedact} label="Redact secrets" />
                </div>
                <p className="text-[12px] leading-[18px] text-[#7c7c8a]">
                  On Google&apos;s free tier, submitted content may be used to
                  improve its products. Keep redaction on and avoid confidential
                  client traffic.
                </p>
              </PanelSection>

              <PanelSection
                title="Connection"
                icon={<Server size={14} className="text-emerald-300" />}
              >
                <div className="space-y-3 rounded-xl border border-white/[0.08] bg-[#141416] p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13.5px] font-medium text-[#e5e5ec]">
                      Google Gemini
                    </span>
                    <StatusPill connection={connection} />
                  </div>

                  <dl className="space-y-1.5 text-[12.5px]">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="shrink-0 text-[#8a8a98]">Backend</dt>
                      <dd className={`${mono.className} min-w-0 truncate text-[#d4d4dc]`}>
                        {API_BASE}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="shrink-0 text-[#8a8a98]">Active model</dt>
                      <dd className={`${mono.className} min-w-0 truncate text-[#d4d4dc]`}>
                        {model || "—"}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="shrink-0 text-[#8a8a98]">API key</dt>
                      <dd className={`${mono.className} text-[#d4d4dc]`}>
                        {configured ? maskedKey ?? "Saved" : "Not set"}
                      </dd>
                    </div>
                  </dl>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => void refreshStatus()}
                      disabled={checking || busySettings}
                      className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.04] text-[12.5px] font-medium text-[#d4d4dc] transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw size={13} className={checking ? "animate-spin" : ""} />
                      Recheck
                    </button>
                    <button
                      type="button"
                      onClick={() => void onTestClick()}
                      disabled={!configured || busySettings}
                      className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-400/10 text-[12.5px] font-medium text-emerald-200 transition-colors hover:bg-emerald-400/[0.18] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Zap size={13} className={testing ? "animate-pulse" : ""} />
                      {testing ? "Testing…" : "Test connection"}
                    </button>
                  </div>

                  {offline && (
                    <p className="text-[12px] leading-[18px] text-[#9a9aa8]">
                      Start the backend service. If it runs on another address,
                      set{" "}
                      <span className={mono.className}>NEXT_PUBLIC_API_URL</span> in{" "}
                      <span className={mono.className}>.env.local</span> and restart
                      Next.js.
                    </p>
                  )}
                </div>
              </PanelSection>

              <PanelSection
                title="API key"
                icon={<KeyRound size={14} className="text-emerald-300" />}
                description={
                  configured
                    ? credentialStorage === "local_file"
                      ? "A key is saved in a private file in your PacketSniffer config folder (no system keyring was available). Paste a new one to replace it."
                      : "A key is saved in the backend's system credential store. Paste a new one to replace it."
                    : "Paste a Gemini API key. It is sent once to your local backend and never stored in the browser."
                }
              >
                <div className="space-y-2.5">
                  {/* ONE border only — on this wrapper. The input is fully bare. */}
                  <div className="flex items-center rounded-lg border border-white/[0.1] bg-[#17171a] transition-colors focus-within:border-emerald-400/50">
                    <input
                      type={showKey ? "text" : "password"}
                      value={draftKey}
                      onChange={(e) => setDraftKey(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void saveKey();
                        }
                      }}
                      placeholder={configured ? "Enter a new key to replace" : "AIza…"}
                      aria-label="Gemini API key"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      maxLength={MAX_API_KEY_CHARS}
                      disabled={offline || busySettings}
                      style={BARE_STYLE}
                      className={`${mono.className} h-10 min-w-0 flex-1 px-3 text-[13px] ${BARE_INPUT_CLASS}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      aria-label={showKey ? "Hide API key" : "Show API key"}
                      className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#8a8a98] outline-none transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:outline-none focus-visible:ring-0"
                    >
                      {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>

                  {draftKey.trim() && !draftKey.trim().startsWith("AIza") && (
                    <p className="text-[12px] leading-4 text-amber-300/90">
                      Gemini keys usually start with “AIza”. Double-check the key
                      you pasted.
                    </p>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void saveKey()}
                      disabled={!draftKey.trim() || offline || busySettings}
                      className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-400 text-[13px] font-semibold text-[#07130d] transition-colors hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-emerald-400"
                    >
                      {savingKey ? (
                        <RefreshCw size={13} className="animate-spin" />
                      ) : (
                        <Check size={14} />
                      )}
                      {savingKey ? "Saving…" : configured ? "Replace key" : "Save key"}
                    </button>

                    {configured && (
                      <button
                        type="button"
                        onClick={() => void removeKey()}
                        onBlur={() => setConfirmRemove(false)}
                        disabled={offline || busySettings}
                        className={`flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60 disabled:cursor-not-allowed disabled:opacity-40 ${
                          confirmRemove
                            ? "border-rose-400/50 bg-rose-400/15 text-rose-200 hover:bg-rose-400/25"
                            : "border-white/[0.1] bg-white/[0.04] text-[#c4c4ce] hover:border-rose-400/30 hover:text-rose-200"
                        }`}
                      >
                        <Trash2 size={13} />
                        {removingKey
                          ? "Removing…"
                          : confirmRemove
                            ? "Confirm remove"
                            : "Remove"}
                      </button>
                    )}
                  </div>

                  {/* Opens through Tauri so it works in the desktop app. */}
                  <button
                    type="button"
                    onClick={() => void openExternal(KEY_URL)}
                    className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-emerald-300 transition-colors hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                  >
                    Get a free key in Google AI Studio
                    <ExternalLink size={12} />
                  </button>
                </div>
              </PanelSection>

              <PanelSection
                title="Model"
                icon={<Cpu size={14} className="text-emerald-300" />}
                description="Choose which Gemini model answers your questions. The change applies to all new messages."
              >
                <div className="space-y-2.5">
                  <ModelDropdown
                    value={draftModel}
                    customMode={customMode}
                    disabled={offline || busySettings}
                    onSelectPreset={(id) => {
                      setCustomMode(false);
                      setDraftModel(id);
                    }}
                    onSelectCustom={() => {
                      setCustomMode(true);
                      if (isPreset(draftModel)) setDraftModel("");
                    }}
                  />

                  {customMode && (
                    <input
                      type="text"
                      value={draftModel}
                      onChange={(e) => setDraftModel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void saveModel();
                        }
                      }}
                      placeholder="e.g. gemini-3.8-flash"
                      aria-label="Custom model ID"
                      maxLength={MAX_MODEL_CHARS}
                      spellCheck={false}
                      autoComplete="off"
                      disabled={offline || busySettings}
                      style={FIELD_STYLE}
                      className={`${mono.className} ${FIELD_CLASS}`}
                    />
                  )}

                  <button
                    type="button"
                    onClick={() => void saveModel()}
                    disabled={!modelDirty || offline || busySettings}
                    className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-emerald-400 text-[13px] font-semibold text-[#07130d] transition-colors hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-emerald-400"
                  >
                    {savingModel ? (
                      <RefreshCw size={13} className="animate-spin" />
                    ) : (
                      <Check size={14} />
                    )}
                    {savingModel
                      ? "Saving…"
                      : modelDirty
                        ? `Use ${modelLabel(draftModel.trim())}`
                        : "Model up to date"}
                  </button>
                </div>
              </PanelSection>
            </div>

            <div className="shrink-0 border-t border-white/[0.08] px-5 py-3">
              <div className="flex items-start gap-2 text-[12px] leading-4 text-[#6b6b78]">
                <Shield size={13} className="mt-px shrink-0" />
                Use only on systems you own or are authorized to test.
              </div>
            </div>
          </aside>
        )}
      </section>
    </div>
  );
}
