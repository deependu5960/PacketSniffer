"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  History,
  Play,
  Search,
  Upload,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Filter,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Copy,
  Check,
  Plus,
  Trash2,
  Binary,
  Repeat2,
  Sparkles,
  PanelLeft,
} from "lucide-react";

import {
  ListenerPill,
  btnGhost,
  btnOutline,
  btnPrimary,
  mono,
} from "@/components/ui";

import { useTraffic } from "@/components/TrafficProvider";
import type { HistoryItem } from "@/components/TrafficProvider";

import RequestEditor, {
  highlightHttp,
  type RequestEditorHandle,
} from "@/components/RequestEditor";

import {
  takeIntruderInbox,
  sendToRepeater,
} from "@/components/repeaterBridge";
import { openGeminiAIWith } from "@/components/geminiAI-bridge";
import ResizablePanels from "@/components/ResizablePanels";

// ---------------------------------------------------------
// Types & constants
// ---------------------------------------------------------

type AttackType =
  | "sniper"
  | "battering_ram"
  | "pitchfork"
  | "cluster_bomb";

type PayloadSourceType =
  | "list"
  | "numbers"
  | "wordlist"
  | "brute"
  | "null";

type Tab = "payloads" | "settings" | "results";

type SortKey = "status" | "length" | "time";
type SortDir = "asc" | "desc";

type ModalLayout = "split" | "stacked" | "request" | "response";
type ResponseView = "raw" | "headers" | "body";

type PayloadSet = {
  id: number;
  type: PayloadSourceType;
  values: string;
  numStart: number;
  numEnd: number;
  numStep: number;
  numPad: number;
  filePath: string;
  bruteCharset: string;
  bruteMin: number;
  bruteMax: number;
  nullCount: number;

  prefix: string;
  suffix: string;
  skipIfMatch: string;

  urlEncode: boolean;
  urlEncodeChars: string;
};

type IntruderResult = {
  request_index: number;
  success: boolean;
  request: string;
  method?: string;
  url?: string;
  status_code?: number | null;
  reason?: string;
  http_version?: string;
  headers?: [string, string][];
  body_base64?: string;
  body_decoded_base64?: string | null;
  content_encoding?: string;
  decode_error?: string | null;
  duration_ms?: number;
  size_raw?: number;
  size_decoded?: number;
  error?: string;
  payload?: string;
};

type IntruderResponse = {
  success: boolean;
  attack_type: AttackType;
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  duration_ms: number;
  results: IntruderResult[];
};

type GrepMatchRule = {
  id: number;
  pattern: string;
  regex: boolean;
  invert: boolean;
};

type GrepExtractRule = {
  id: number;
  pattern: string;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8765";

const ATTACK_TYPES: {
  id: AttackType;
  name: string;
  description: string;
}[] = [
  {
    id: "sniper",
    name: "Sniper",
    description: "One list. Tests each position separately.",
  },
  {
    id: "battering_ram",
    name: "Battering ram",
    description: "Same payload inserted into every position.",
  },
  {
    id: "pitchfork",
    name: "Pitchfork",
    description: "One list per position. Pairs values by index.",
  },
  {
    id: "cluster_bomb",
    name: "Cluster bomb",
    description: "One list per position. Tests every combination.",
  },
];

const PAYLOAD_TYPES: {
  id: PayloadSourceType;
  label: string;
}[] = [
  { id: "list", label: "Simple list" },
  { id: "numbers", label: "Numbers" },
  { id: "wordlist", label: "Wordlist file" },
  { id: "brute", label: "Brute force" },
  { id: "null", label: "Null" },
];

const TABS: { id: Tab; label: string }[] = [
  { id: "payloads", label: "Payloads" },
  { id: "settings", label: "Settings" },
  { id: "results", label: "Results" },
];

function LayoutIcon({ kind }: { kind: "split" | "stacked" }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      {kind === "split" ? <path d="M8 3v10" /> : <path d="M2 8h12" />}
    </svg>
  );
}

const MODAL_LAYOUTS: { id: ModalLayout; label: string; icon?: ReactNode }[] = [
  { id: "split", label: "Side by side", icon: <LayoutIcon kind="split" /> },
  { id: "stacked", label: "Stacked", icon: <LayoutIcon kind="stacked" /> },
  { id: "request", label: "Request" },
  { id: "response", label: "Response" },
];

const RESPONSE_VIEWS: { id: ResponseView; label: string }[] = [
  { id: "raw", label: "Raw" },
  { id: "headers", label: "Headers" },
  { id: "body", label: "Body" },
];

const DEFAULT_REQUEST = `GET /search?q=test HTTP/1.1
Host: example.com
User-Agent: PacketSniffer
Accept: */*

`;

const HL_MAX_CHARS = 200_000;
const FRONTEND_EXPAND_HARD_CAP = 50_000;
const DEFAULT_URL_ENCODE_CHARS = " #$%&+,/:;=?@[]";

// Size limits for what is handed to Gemini AI.
const AI_REQUEST_LIMIT = 100_000;
const AI_RESPONSE_LIMIT = 50_000;

// Modal layout persistence + split limits.
const MODAL_LAYOUT_KEY = "packetsniff.intruder.modalLayout";
const MODAL_SPLIT_MIN = 20;
const MODAL_SPLIT_MAX = 80;
const MODAL_SPLIT_DEFAULT = 50;

function clampSplit(value: number) {
  return Math.min(MODAL_SPLIT_MAX, Math.max(MODAL_SPLIT_MIN, value));
}

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------

function getRawRequest(item: HistoryItem): string {
  const record = item as HistoryItem & {
    rawRequest?: string;
    raw?: string;
  };

  return record.rawRequest || record.raw || "";
}

function getPayloads(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function makePayloadSet(id: number): PayloadSet {
  return {
    id,
    type: "list",
    values: "",
    numStart: 1,
    numEnd: 100,
    numStep: 1,
    numPad: 0,
    filePath: "",
    bruteCharset: "abcdefghijklmnopqrstuvwxyz",
    bruteMin: 1,
    bruteMax: 3,
    nullCount: 10,

    prefix: "",
    suffix: "",
    skipIfMatch: "",

    urlEncode: false,
    urlEncodeChars: DEFAULT_URL_ENCODE_CHARS,
  };
}

function countForSet(set: PayloadSet): number | null {
  switch (set.type) {
    case "list":
      return getPayloads(set.values).length;

    case "numbers": {
      const { numStart: start, numEnd: end, numStep: step } = set;

      if (!step) return 0;
      if (step > 0 && start > end) return 0;
      if (step < 0 && start < end) return 0;

      return Math.floor(Math.abs((end - start) / step)) + 1;
    }

    case "brute": {
      const uniqueChars = new Set(set.bruteCharset.split("")).size;

      if (!uniqueChars || set.bruteMax < set.bruteMin) return 0;

      let total = 0;

      for (let length = set.bruteMin; length <= set.bruteMax; length++) {
        total += Math.pow(uniqueChars, length);
      }

      return total;
    }

    case "null":
      return Math.max(0, Math.floor(set.nullCount));

    case "wordlist":
      return null;
  }
}

function summarizeSet(set: PayloadSet): string {
  const bits: string[] = [];

  if (set.prefix) bits.push(`+prefix`);
  if (set.suffix) bits.push(`+suffix`);
  if (set.skipIfMatch.trim()) bits.push(`skip-match`);
  if (set.urlEncode) {
    bits.push(
      set.urlEncodeChars.trim()
        ? `URL-encode [${set.urlEncodeChars}]`
        : "URL-encode (all)"
    );
  }

  const suffix = bits.length ? ` · ${bits.join(", ")}` : "";

  switch (set.type) {
    case "list": {
      const n = getPayloads(set.values).length;
      return `Simple list · ${n.toLocaleString()} payload${
        n === 1 ? "" : "s"
      }${suffix}`;
    }

    case "numbers": {
      const n = countForSet(set) ?? 0;
      const pad = set.numPad ? `, padded to ${set.numPad} digits` : "";
      return `${set.numStart} → ${set.numEnd} step ${set.numStep}${pad} · ${n.toLocaleString()} payloads${suffix}`;
    }

    case "wordlist":
      return `Wordlist file${
        set.filePath ? "" : " · no path set yet"
      } · processing does NOT apply to wordlists${suffix}`;

    case "brute": {
      const n = countForSet(set) ?? 0;
      return `Brute force "${
        set.bruteCharset || "—"
      }" (${set.bruteMin}–${set.bruteMax} chars) · ${n.toLocaleString()} payloads${suffix}`;
    }

    case "null": {
      const n = countForSet(set) ?? 0;
      return `Null payloads · ${n.toLocaleString()} requests${suffix}`;
    }
  }
}

function inferScheme(rawRequest: string): "http" | "https" {
  const firstLine = rawRequest.split(/\r?\n/)[0] || "";

  const absoluteUrl = firstLine.match(/^\S+\s+(https?):\/\//i);

  if (absoluteUrl) {
    return absoluteUrl[1].toLowerCase() as "http" | "https";
  }

  const hostLine = rawRequest.match(/^Host:\s*(.+)$/im);
  const host = hostLine?.[1]?.trim().toLowerCase() || "";

  if (host.endsWith(":443")) return "https";
  if (host.endsWith(":80")) return "http";

  if (
    host.startsWith("localhost") ||
    host.startsWith("127.") ||
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    host.startsWith("[::1]")
  ) {
    return "http";
  }

  return "https";
}

function generateBrutePayloads(
  set: PayloadSet,
  limit: number
): string[] {
  const chars = [...new Set(set.bruteCharset.split(""))];

  if (
    chars.length === 0 ||
    set.bruteMin < 1 ||
    set.bruteMax < set.bruteMin
  ) {
    throw new Error("Invalid brute-force configuration.");
  }

  const output: string[] = [];

  function generate(prefix: string, remaining: number) {
    if (output.length > limit) return;

    if (remaining === 0) {
      output.push(prefix);
      return;
    }

    for (const char of chars) {
      if (output.length > limit) return;
      generate(prefix + char, remaining - 1);
    }
  }

  for (let length = set.bruteMin; length <= set.bruteMax; length++) {
    generate("", length);

    if (output.length > limit) {
      throw new Error(
        `Brute-force payload count exceeds the maximum request limit (${limit}).`
      );
    }
  }

  return output;
}

// ---------------------------------------------------------
// Payload processing + encoding
// ---------------------------------------------------------

function safeRegex(source: string): RegExp | null {
  try {
    return new RegExp(source);
  } catch {
    return null;
  }
}

function applyPayloadProcessing(
  set: PayloadSet,
  values: string[]
): string[] {
  const skipRe = set.skipIfMatch.trim()
    ? safeRegex(set.skipIfMatch.trim())
    : null;

  return values
    .filter((value) => {
      if (skipRe && skipRe.test(value)) return false;
      return true;
    })
    .map((value) => `${set.prefix}${value}${set.suffix}`);
}

function urlEncodePayload(value: string, chars: string): string {
  if (!chars) {
    return encodeURIComponent(value).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
    );
  }

  const set = new Set(chars);
  let out = "";

  for (const ch of value) {
    if (set.has(ch)) {
      for (const byte of new TextEncoder().encode(ch)) {
        out += `%${byte.toString(16).padStart(2, "0").toUpperCase()}`;
      }
    } else {
      out += ch;
    }
  }

  return out;
}

function applyPayloadEncoding(set: PayloadSet, values: string[]): string[] {
  if (!set.urlEncode) return values;
  return values.map((value) => urlEncodePayload(value, set.urlEncodeChars));
}

// ---------------------------------------------------------
// Grep – Match & Grep – Extract
// ---------------------------------------------------------

function rowMatchesGrep(
  result: IntruderResult,
  rules: GrepMatchRule[]
): boolean {
  if (rules.length === 0) return false;

  const haystack = `${result.url ?? ""}\n${buildResponseText(result)}`;

  for (const rule of rules) {
    if (!rule.pattern.trim()) continue;

    const matched = rule.regex
      ? safeRegex(rule.pattern)?.test(haystack) ?? false
      : haystack.includes(rule.pattern);

    if (rule.invert ? !matched : matched) return true;
  }

  return false;
}

function whichGrepRulesMatch(
  result: IntruderResult,
  rules: GrepMatchRule[]
): string[] {
  const fired: string[] = [];
  if (rules.length === 0) return fired;

  const haystack = `${result.url ?? ""}\n${buildResponseText(result)}`;

  for (const rule of rules) {
    if (!rule.pattern.trim()) continue;

    const matched = rule.regex
      ? safeRegex(rule.pattern)?.test(haystack) ?? false
      : haystack.includes(rule.pattern);

    if (rule.invert ? !matched : matched) fired.push(rule.pattern);
  }

  return fired;
}

function extractForRow(
  result: IntruderResult,
  rules: GrepExtractRule[]
): string[] {
  if (rules.length === 0) return [];

  const haystack = `${result.url ?? ""}\n${buildResponseText(result)}`;

  return rules.map((rule) => {
    const re = safeRegex(rule.pattern);
    if (!re) return "";
    const m = re.exec(haystack);
    return m?.[1] ?? "";
  });
}

// ---------------------------------------------------------
// Convert a UI payload set into the backend API format.
// ---------------------------------------------------------

function buildBackendPayloadSet(set: PayloadSet, maxRequests: number) {
  switch (set.type) {
    case "list": {
      const values = getPayloads(set.values);

      if (values.length === 0) {
        throw new Error("A payload list cannot be empty.");
      }

      const processed = applyPayloadProcessing(set, values);
      const encoded = applyPayloadEncoding(set, processed);

      if (encoded.length === 0) {
        throw new Error(
          "All payloads were filtered out by the payload processing rules."
        );
      }

      return { source: "list" as const, values: encoded };
    }

    case "numbers": {
      if (set.numStep === 0) {
        throw new Error("Number step cannot be zero.");
      }

      if (
        (set.numStep > 0 && set.numStart > set.numEnd) ||
        (set.numStep < 0 && set.numStart < set.numEnd)
      ) {
        throw new Error("Invalid number range or step direction.");
      }

      if (set.numPad < 0 || set.numPad > 20) {
        throw new Error("Zero padding must be between 0 and 20.");
      }

      const expanded: string[] = [];
      const step = set.numStep;
      const limit = Math.min(maxRequests, FRONTEND_EXPAND_HARD_CAP);

      if (step > 0) {
        for (let n = set.numStart; n <= set.numEnd; n += step) {
          if (expanded.length >= limit) {
            throw new Error(
              `Number range produces more than ${limit} payloads. Reduce the range or increase the step.`
            );
          }
          expanded.push(
            set.numPad ? String(n).padStart(set.numPad, "0") : String(n)
          );
        }
      } else {
        for (let n = set.numStart; n >= set.numEnd; n += step) {
          if (expanded.length >= limit) {
            throw new Error(
              `Number range produces more than ${limit} payloads. Reduce the range or increase the step.`
            );
          }
          expanded.push(
            set.numPad ? String(n).padStart(set.numPad, "0") : String(n)
          );
        }
      }

      const processed = applyPayloadProcessing(set, expanded);
      const encoded = applyPayloadEncoding(set, processed);

      if (encoded.length === 0) {
        throw new Error(
          "All payloads were filtered out by the payload processing rules."
        );
      }

      return { source: "list" as const, values: encoded };
    }

    case "wordlist": {
      if (!set.filePath.trim()) {
        throw new Error("Enter a wordlist file path.");
      }

      return {
        source: "wordlist" as const,
        values: [set.filePath.trim()],
      };
    }

    case "brute": {
      const values = generateBrutePayloads(set, maxRequests);
      const processed = applyPayloadProcessing(set, values);
      const encoded = applyPayloadEncoding(set, processed);

      if (encoded.length === 0) {
        throw new Error("Brute-force configuration generated no payloads.");
      }

      return { source: "list" as const, values: encoded };
    }

    case "null": {
      const count = Math.floor(set.nullCount);

      if (count < 1 || count > maxRequests) {
        throw new Error(
          `Null payload count must be between 1 and ${maxRequests}.`
        );
      }

      return {
        source: "list" as const,
        values: Array(count).fill(""),
      };
    }
  }
}

function decodeBase64(value?: string | null): string {
  if (!value) return "";

  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "Unable to decode response body.";
  }
}

function sortValue(result: IntruderResult, key: SortKey): number | null {
  const raw =
    key === "status"
      ? result.success
        ? result.status_code
        : null
      : key === "length"
        ? result.size_raw
        : result.duration_ms;

  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function statusBucket(result: IntruderResult): string {
  if (!result.success) return "error";
  return result.status_code != null ? String(result.status_code) : "unknown";
}

function statusChipClasses(result: IntruderResult): string {
  if (!result.success) {
    return "border-red-400/25 bg-red-400/10 text-red-300";
  }
  const code = result.status_code ?? 0;
  if (code >= 500) return "border-red-400/25 bg-red-400/10 text-red-300";
  if (code >= 400) return "border-amber-400/25 bg-amber-400/10 text-amber-300";
  if (code >= 300) return "border-sky-400/25 bg-sky-400/10 text-sky-300";
  return "border-emerald-400/25 bg-emerald-400/10 text-emerald-300";
}

// ---------------------------------------------------------
// Payload preview
// ---------------------------------------------------------

function expandNumberValues(set: PayloadSet): string[] {
  const { numStart: start, numEnd: end, numStep: step, numPad: pad } = set;

  if (!step) return [];
  if (step > 0 && start > end) return [];
  if (step < 0 && start < end) return [];

  const values: string[] = [];

  if (step > 0) {
    for (let n = start; n <= end; n += step) {
      values.push(pad ? String(n).padStart(pad, "0") : String(n));
    }
  } else {
    for (let n = start; n >= end; n += step) {
      values.push(pad ? String(n).padStart(pad, "0") : String(n));
    }
  }

  return values;
}

function expandSetValues(
  set: PayloadSet,
  maxRequests: number
): string[] | null {
  try {
    switch (set.type) {
      case "list": {
        const processed = applyPayloadProcessing(set, getPayloads(set.values));
        return applyPayloadEncoding(set, processed);
      }
      case "numbers": {
        const processed = applyPayloadProcessing(set, expandNumberValues(set));
        return applyPayloadEncoding(set, processed);
      }
      case "brute": {
        const processed = applyPayloadProcessing(
          set,
          generateBrutePayloads(set, maxRequests)
        );
        return applyPayloadEncoding(set, processed);
      }
      case "null":
        return Array(Math.max(0, Math.floor(set.nullCount))).fill("");
      case "wordlist":
        return null;
    }
  } catch {
    return null;
  }
}

function computeAttackPayloadLabels(
  attackType: AttackType,
  expandedSets: (string[] | null)[],
  positionCount: number,
  maxRequests: number
): string[] | null {
  if (expandedSets.some((values) => values === null)) return null;

  const sets = expandedSets as string[][];
  const labels: string[] = [];

  const fmt = (value: string) => (value === "" ? "(empty)" : value);

  if (attackType === "sniper") {
    const values = sets[0] ?? [];

    for (let pos = 0; pos < positionCount; pos++) {
      for (const value of values) {
        if (labels.length >= maxRequests) return labels;
        labels.push(fmt(value));
      }
    }

    return labels;
  }

  if (attackType === "battering_ram") {
    const values = sets[0] ?? [];

    for (const value of values) {
      if (labels.length >= maxRequests) return labels;
      labels.push(fmt(value));
    }

    return labels;
  }

  if (attackType === "pitchfork") {
    if (sets.length === 0) return labels;

    const minLen = Math.min(...sets.map((values) => values.length));

    for (let i = 0; i < minLen; i++) {
      if (labels.length >= maxRequests) return labels;
      labels.push(sets.map((values) => fmt(values[i])).join("  /  "));
    }

    return labels;
  }

  function cartesian(index: number, prefix: string[]) {
    if (labels.length >= maxRequests) return;

    if (index === sets.length) {
      labels.push(prefix.join("  |  "));
      return;
    }

    for (const value of sets[index]) {
      if (labels.length >= maxRequests) return;
      cartesian(index + 1, [...prefix, fmt(value)]);
    }
  }

  cartesian(0, []);

  return labels;
}

// ---------------------------------------------------------
// Response text builders
// ---------------------------------------------------------

// Backends often report just "1.1", "11" or "2". Always show a real
// HTTP status line such as "HTTP/1.1 200 OK".
function normalizeHttpVersion(version?: string | number | null): string {
  if (version === undefined || version === null || version === "") {
    return "HTTP/1.1";
  }

  const raw = String(version).trim();

  if (/^HTTP\//i.test(raw)) return raw.replace(/^http/i, "HTTP");
  if (/^\d{2}$/.test(raw)) return `HTTP/${raw[0]}.${raw[1]}`;
  if (/^\d(\.\d)?$/.test(raw)) return `HTTP/${raw}`;

  return raw;
}

function buildStatusLine(result: IntruderResult): string {
  return `${normalizeHttpVersion(result.http_version)} ${
    result.status_code ?? ""
  } ${result.reason ?? ""}`.trim();
}

function buildResponseText(result: IntruderResult): string {
  if (result.error) return result.error;

  const statusLine = buildStatusLine(result);

  const headerLines = (result.headers ?? [])
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");

  const body = decodeBase64(
    result.body_decoded_base64 || result.body_base64
  );

  return [statusLine, headerLines, "", body || "(empty body)"].join("\n");
}

function buildResponseHeadersText(result: IntruderResult): string {
  if (result.error) return result.error;

  const headerLines = (result.headers ?? [])
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");

  return [buildStatusLine(result), headerLines].filter(Boolean).join("\n");
}

function buildResponseBodyText(result: IntruderResult): string {
  if (result.error) return result.error;

  const body = decodeBase64(
    result.body_decoded_base64 || result.body_base64
  );

  if (!body) return "(empty body)";

  const trimmed = body.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return body;
    }
  }

  return body;
}

function responseTextForView(
  result: IntruderResult,
  view: ResponseView
): string {
  if (view === "headers") return buildResponseHeadersText(result);
  if (view === "body") return buildResponseBodyText(result);
  return buildResponseText(result);
}

// ---------------------------------------------------------
// Raw request -> Repeater payload
// ---------------------------------------------------------

function parseRawRequest(raw: string): {
  method: string;
  headers: [string, string][];
  body_base64: string;
} {
  const separator = raw.search(/\r?\n\r?\n/);
  const head = separator === -1 ? raw : raw.slice(0, separator);
  const bodyText =
    separator === -1 ? "" : raw.slice(separator).replace(/^\r?\n\r?\n/, "");

  const lines = head.split(/\r?\n/);
  const method = (lines[0] || "").split(/\s+/)[0] || "GET";

  const headers: [string, string][] = [];
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    headers.push([line.slice(0, idx).trim(), line.slice(idx + 1).trim()]);
  }

  let body_base64 = "";
  if (bodyText) {
    try {
      const bytes = new TextEncoder().encode(bodyText);
      let binary = "";
      bytes.forEach((b) => {
        binary += String.fromCharCode(b);
      });
      body_base64 = btoa(binary);
    } catch {
      body_base64 = "";
    }
  }

  return { method, headers, body_base64 };
}

// ---------------------------------------------------------
// Attack tabs (kept in memory)
//
// Each tab is a full, independent Intruder session. The store lives at
// module level, so it survives navigating to other pages and back, but
// it is wiped when the app is closed or launched again.
// ---------------------------------------------------------

type TabSnapshot = {
  request: string;
  attackType: AttackType;
  payloadSets: PayloadSet[];
  nextPayloadId: number;
  activePayloadSetId: number | null;
  concurrency: number;
  requestsPerSecond: number;
  timeoutSeconds: number;
  maxRequests: number;
  grepMatchRules: GrepMatchRule[];
  grepExtractRules: GrepExtractRule[];
  nextGrepMatchId: number;
  nextGrepExtractId: number;
  showOnlyGrepMatches: boolean;
  activeTab: Tab;
  selectedResultIndex: number | null;
  sortKey: SortKey | null;
  sortDir: SortDir;
  filterSearch: string;
  filterStatuses: string[];
  filterMinLength: string;
  filterMaxLength: string;
  filterMinTime: string;
  filterMaxTime: string;
  attackResults: IntruderResponse | null;
  payloadLabels: string[] | null;
  attackError: string;
};

type TabRecord = { id: number; snapshot: TabSnapshot };

const intruderStore: {
  tabs: TabRecord[];
  activeId: number | null;
  nextId: number;
} = { tabs: [], activeId: null, nextId: 1 };

function freshSnapshot(request: string): TabSnapshot {
  return {
    request,
    attackType: "sniper",
    payloadSets: [],
    nextPayloadId: 2,
    activePayloadSetId: null,
    concurrency: 5,
    requestsPerSecond: 0,
    timeoutSeconds: 10,
    maxRequests: 1000,
    grepMatchRules: [],
    grepExtractRules: [],
    nextGrepMatchId: 1,
    nextGrepExtractId: 1,
    showOnlyGrepMatches: false,
    activeTab: "payloads",
    selectedResultIndex: null,
    sortKey: null,
    sortDir: "asc",
    filterSearch: "",
    filterStatuses: [],
    filterMinLength: "",
    filterMaxLength: "",
    filterMinTime: "",
    filterMaxTime: "",
    attackResults: null,
    payloadLabels: null,
    attackError: "",
  };
}

function tabTitle(raw: string): string {
  const clean = raw.replace(/§/g, "");
  const first = (clean.split(/\r?\n/)[0] || "").trim();
  const match = first.match(/^(\S+)\s+(\S+)/);

  if (!match) return "New attack";

  const method = match[1];
  const target = match[2];

  if (/^https?:\/\//i.test(target)) {
    try {
      const url = new URL(target);
      return `${method} ${url.host}${url.pathname}`;
    } catch {
      return `${method} ${target}`;
    }
  }

  const host = clean.match(/^Host:\s*(.+)$/im)?.[1]?.trim() ?? "";
  return `${method} ${host}${target}`.trim();
}

// ---------------------------------------------------------
// Small UI building blocks
// ---------------------------------------------------------

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-[#c4c4ce]">
        {label}
      </span>

      {children}

      {hint && (
        <span className="mt-1 block text-[11.5px] text-[#6c6c78]">
          {hint}
        </span>
      )}
    </label>
  );
}

const inputClass =
  "mt-1.5 h-10 w-full rounded-lg border border-white/[0.1] bg-[#141416] px-3 text-[13.5px] tabular-nums text-white outline-none transition focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20";

const smallInputClass =
  "h-8 w-full rounded-md border border-white/[0.1] bg-[#141416] px-2.5 text-[12.5px] tabular-nums text-white outline-none transition focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20";

function NumberInput({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const n = Number(e.target.value);
        onChange(Number.isFinite(n) ? n : 0);
      }}
      className={inputClass}
    />
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-white/[0.08] bg-[#141416] p-1">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 ${
            value === option.id
              ? "bg-emerald-400/15 text-emerald-300"
              : "text-[#9a9aa8] hover:text-white"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// Compact segmented control used inside the result modal.
function MiniSegmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center gap-0.5 rounded-md border border-white/[0.08] bg-[#141416] p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          aria-pressed={value === option.id}
          aria-label={option.label}
          title={option.label}
          className={`inline-flex items-center justify-center rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 ${
            value === option.id
              ? "bg-emerald-400/15 text-emerald-300"
              : "text-[#9a9aa8] hover:text-white"
          }`}
        >
          {option.icon ?? option.label}
        </button>
      ))}
    </div>
  );
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <th
      className="px-4 py-3 font-medium"
      aria-sort={
        active ? (dir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-white ${
          active ? "text-emerald-300" : ""
        }`}
      >
        {label}

        <span className="w-3 text-center">
          {active ? (dir === "asc" ? "↑" : "↓") : ""}
        </span>
      </button>
    </th>
  );
}

function FilterChip({
  label,
  count,
  active,
  tone = "default",
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone?: "default" | "success" | "warn" | "error";
  onClick: () => void;
}) {
  const toneClasses =
    tone === "success"
      ? active
        ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-300"
        : "border-white/[0.08] text-[#9cd9bd] hover:border-emerald-400/30"
      : tone === "warn"
        ? active
          ? "border-amber-400/50 bg-amber-400/15 text-amber-300"
          : "border-white/[0.08] text-amber-300/80 hover:border-amber-400/30"
        : tone === "error"
          ? active
            ? "border-red-400/50 bg-red-400/15 text-red-300"
            : "border-white/[0.08] text-red-300/80 hover:border-red-400/30"
          : active
            ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-300"
            : "border-white/[0.08] text-[#9a9aa8] hover:border-white/20";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-medium transition ${toneClasses}`}
    >
      {label}

      <span className="rounded bg-black/25 px-1.5 py-0.5 text-[10.5px] tabular-nums">
        {count}
      </span>
    </button>
  );
}

const FIND_MAX_MATCHES = 5000;

function EditorPane({
  label,
  text,
  accent = "default",
  meta,
  headerExtra,
  onCopy,
  copied = false,
  findSignal = 0,
}: {
  label: string;
  text: string;
  accent?: "default" | "error";
  meta?: string;
  headerExtra?: ReactNode;
  onCopy?: () => void;
  copied?: boolean;
  findSignal?: number;
}) {
  const lines = (text || "").split("\n");

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [activeMatch, setActiveMatch] = useState(0);

  // Ctrl/Cmd+F from the page bumps this number to open the bar.
  useEffect(() => {
    if (findSignal <= 0) return;
    setFindOpen(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [findSignal]);

  const { regex, invalid } = useMemo(() => {
    if (!query) return { regex: null as RegExp | null, invalid: false };
    try {
      const source = useRegex
        ? query
        : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return {
        regex: new RegExp(source, caseSensitive ? "g" : "gi"),
        invalid: false,
      };
    } catch {
      return { regex: null as RegExp | null, invalid: true };
    }
  }, [query, useRegex, caseSensitive]);

  const matches = useMemo(() => {
    const out: { start: number; end: number }[] = [];
    if (!regex || !text) return out;

    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null && out.length < FIND_MAX_MATCHES) {
      if (m[0].length === 0) {
        regex.lastIndex++;
        continue;
      }
      out.push({ start: m.index, end: m.index + m[0].length });
    }
    return out;
  }, [regex, text]);

  // Restart from the first match whenever the search or the text changes.
  useEffect(() => {
    setActiveMatch(0);
  }, [query, caseSensitive, useRegex, text]);

  const searching = findOpen && matches.length > 0;

  const content = useMemo<ReactNode>(() => {
    if (!text) return " ";

    if (searching) {
      const nodes: ReactNode[] = [];
      let cursor = 0;

      matches.forEach((match, i) => {
        if (match.start > cursor) {
          nodes.push(text.slice(cursor, match.start));
        }
        nodes.push(
          <mark
            key={i}
            data-match={i}
            className={
              i === activeMatch
                ? "rounded-sm bg-amber-400 text-black"
                : "rounded-sm bg-amber-300/30 text-inherit"
            }
          >
            {text.slice(match.start, match.end)}
          </mark>
        );
        cursor = match.end;
      });

      if (cursor < text.length) nodes.push(text.slice(cursor));
      return nodes;
    }

    if (text.length > HL_MAX_CHARS) return text;
    return highlightHttp(text);
  }, [text, searching, matches, activeMatch]);

  // Keep the active match in view.
  useEffect(() => {
    if (!searching) return;
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-match="${activeMatch}"]`)
      ?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [searching, activeMatch, matches]);

  function step(delta: number) {
    if (matches.length === 0) return;
    setActiveMatch((current) => (current + delta + matches.length) % matches.length);
  }

  function closeFind() {
    setFindOpen(false);
  }

  const countLabel = !query
    ? ""
    : invalid
      ? "Invalid regex"
      : matches.length === 0
        ? "No results"
        : `${activeMatch + 1} / ${matches.length}${
            matches.length >= FIND_MAX_MATCHES ? "+" : ""
          }`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.08] bg-[#0d0d0f] px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`text-[13px] font-medium ${
              accent === "error" ? "text-red-300" : "text-[#c4c4ce]"
            }`}
          >
            {label}
          </span>

          {meta && (
            <span className="truncate text-[12px] text-[#777783]">
              {meta}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {headerExtra}

          <button
            type="button"
            onClick={() => {
              setFindOpen(true);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            title="Find (Ctrl/Cmd+F)"
            aria-label={`Find in ${label.toLowerCase()}`}
            className={`rounded p-1 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 ${
              findOpen ? "bg-white/[0.06] text-white" : "text-[#6c6c78]"
            }`}
          >
            <Search size={14} />
          </button>

          {onCopy && (
            <button
              type="button"
              onClick={onCopy}
              title="Copy to clipboard"
              aria-label={`Copy ${label.toLowerCase()}`}
              className="rounded p-1 text-[#6c6c78] transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
            >
              {copied ? (
                <Check size={14} className="text-emerald-300" />
              ) : (
                <Copy size={14} />
              )}
            </button>
          )}
        </div>
      </div>

      {findOpen && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.08] bg-[#101012] px-3 py-1.5">
          <div
            className={`flex min-w-[160px] flex-1 items-center gap-2 rounded-md border bg-[#141416] px-2.5 focus-within:ring-2 ${
              invalid
                ? "border-red-400/50 focus-within:ring-red-400/20"
                : "border-white/[0.1] focus-within:border-emerald-400/50 focus-within:ring-emerald-400/20"
            }`}
          >
            <Search size={13} className="shrink-0 text-[#6c6c78]" />

            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  step(event.shiftKey ? -1 : 1);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  closeFind();
                }
              }}
              placeholder={`Find in ${label.toLowerCase()}...`}
              spellCheck={false}
              aria-label={`Find in ${label.toLowerCase()}`}
              className="h-8 min-w-0 flex-1 appearance-none !border-0 bg-transparent text-[13px] text-white !shadow-none !outline-none !ring-0 placeholder:text-[#6c6c78] focus:!border-0 focus:!shadow-none focus:!outline-none focus:!ring-0 focus-visible:!shadow-none focus-visible:!outline-none focus-visible:!ring-0"
            />

            <span
              className={`shrink-0 text-[11.5px] tabular-nums ${
                invalid || (query && matches.length === 0)
                  ? "text-red-300"
                  : "text-[#8a8a98]"
              }`}
            >
              {countLabel}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setCaseSensitive((value) => !value)}
            aria-pressed={caseSensitive}
            title="Match case"
            className={`rounded-md border px-2 py-1 text-[12px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 ${
              caseSensitive
                ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-300"
                : "border-white/[0.08] text-[#9a9aa8] hover:text-white"
            }`}
          >
            Aa
          </button>

          <button
            type="button"
            onClick={() => setUseRegex((value) => !value)}
            aria-pressed={useRegex}
            title="Regular expression"
            className={`${mono.className} rounded-md border px-2 py-1 text-[12px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 ${
              useRegex
                ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-300"
                : "border-white/[0.08] text-[#9a9aa8] hover:text-white"
            }`}
          >
            .*
          </button>

          <div className="flex items-center">
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={matches.length === 0}
              title="Previous match (Shift+Enter)"
              aria-label="Previous match"
              className="rounded-md p-1.5 text-[#9a9aa8] transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronUp size={15} />
            </button>

            <button
              type="button"
              onClick={() => step(1)}
              disabled={matches.length === 0}
              title="Next match (Enter)"
              aria-label="Next match"
              className="rounded-md p-1.5 text-[#9a9aa8] transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronDown size={15} />
            </button>

            <button
              type="button"
              onClick={closeFind}
              title="Close (Esc)"
              aria-label="Close find"
              className="rounded-md p-1.5 text-[#9a9aa8] transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto bg-[#09090b] [scrollbar-color:#3a3a44_transparent] [scrollbar-width:thin]"
      >
        <pre
          className={`${mono.className} grid grid-cols-[auto_1fr] gap-x-4 px-4 py-4 text-[14px] leading-[1.65]`}
        >
          <code className="select-none text-right text-[#4a4a54]">
            {lines.map((_, index) => `${index + 1}\n`)}
          </code>

          <code className="whitespace-pre-wrap break-all text-[#d4d4dc]">
            {content}
          </code>
        </pre>
      </div>
    </div>
  );
}

function ModalToolButton({
  icon: Icon,
  label,
  title,
  onClick,
  disabled,
  active,
}: {
  icon: typeof Copy;
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={`inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#b5b5c2] ${
        active ? "bg-white/[0.06] text-white" : "text-[#b5b5c2]"
      }`}
    >
      <Icon size={14} strokeWidth={1.9} />
      {label}
    </button>
  );
}

// ---------------------------------------------------------
// Page
// ---------------------------------------------------------

export default function IntruderPage() {
  const { history } = useTraffic();
  const router = useRouter();

  const editorRef = useRef<RequestEditorHandle>(null);
  const nextPayloadId = useRef(2);
  const loadedInbox = useRef(false);
  const attackInFlight = useRef(false);
  const attackPayloadLabelsRef = useRef<string[] | null>(null);

  const [request, setRequest] = useState(DEFAULT_REQUEST);
  const [hasSelection, setHasSelection] = useState(false);

  const [attackType, setAttackType] = useState<AttackType>("sniper");

  const [payloadSets, setPayloadSets] = useState<PayloadSet[]>([]);
  const [activePayloadSetId, setActivePayloadSetId] = useState<number | null>(
    null
  );

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [selectedHistoryId, setSelectedHistoryId] = useState<number | null>(
    null
  );

  const [concurrency, setConcurrency] = useState(5);
  const [requestsPerSecond, setRequestsPerSecond] = useState(0);
  const [timeoutSeconds, setTimeoutSeconds] = useState(10);
  const [maxRequests, setMaxRequests] = useState(1000);
  const [followRedirects, setFollowRedirects] = useState(false);

  // Grep config
  const [grepMatchRules, setGrepMatchRules] = useState<GrepMatchRule[]>([]);
  const [grepExtractRules, setGrepExtractRules] = useState<GrepExtractRule[]>(
    []
  );
  const nextGrepMatchId = useRef(1);
  const nextGrepExtractId = useRef(1);

  const [showOnlyGrepMatches, setShowOnlyGrepMatches] = useState(false);

  const [activeTab, setActiveTab] = useState<Tab>("payloads");

  const [isRunning, setIsRunning] = useState(false);
  const [attackError, setAttackError] = useState("");
  const [attackResults, setAttackResults] =
    useState<IntruderResponse | null>(null);
  const [selectedResultIndex, setSelectedResultIndex] =
    useState<number | null>(null);
  const [resultModalOpen, setResultModalOpen] = useState(false);

  // Result modal view state
  const [modalLayout, setModalLayout] = useState<ModalLayout>("split");
  const [responseView, setResponseView] = useState<ResponseView>("raw");
  const [modalSplit, setModalSplit] = useState(MODAL_SPLIT_DEFAULT);
  const [modalSidebarOpen, setModalSidebarOpen] = useState(true);
  const [modalDragging, setModalDragging] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const modalPanesRef = useRef<HTMLDivElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // In-pane find (Ctrl/Cmd+F)
  const [findTarget, setFindTarget] = useState<"request" | "response">(
    "response"
  );
  const [findSignal, setFindSignal] = useState(0);
  const hoveredPane = useRef<"request" | "response">("response");

  // Attack tabs
  const [tabIds, setTabIds] = useState<number[]>([]);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [filtersOpen, setFiltersOpen] = useState(true);
  const [filterSearch, setFilterSearch] = useState("");
  const [filterStatuses, setFilterStatuses] = useState<Set<string>>(
    new Set()
  );
  const [filterMinLength, setFilterMinLength] = useState("");
  const [filterMaxLength, setFilterMaxLength] = useState("");
  const [filterMinTime, setFilterMinTime] = useState("");
  const [filterMaxTime, setFilterMaxTime] = useState("");

  const sharedMode =
    attackType === "sniper" || attackType === "battering_ram";

  // -------------------------------------------------------
  // Restore saved modal layout
  // -------------------------------------------------------

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(MODAL_LAYOUT_KEY);
      if (
        saved === "split" ||
        saved === "stacked" ||
        saved === "request" ||
        saved === "response"
      ) {
        setModalLayout(saved);
      }
    } catch {}
  }, []);

  function changeModalLayout(layout: ModalLayout) {
    setModalLayout(layout);
    try {
      window.localStorage.setItem(MODAL_LAYOUT_KEY, layout);
    } catch {}
  }

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  // -------------------------------------------------------
  // Tab sessions
  // -------------------------------------------------------

  function buildSnapshot(): TabSnapshot {
    return {
      request,
      attackType,
      payloadSets,
      nextPayloadId: nextPayloadId.current,
      activePayloadSetId,
      concurrency,
      requestsPerSecond,
      timeoutSeconds,
      maxRequests,
      grepMatchRules,
      grepExtractRules,
      nextGrepMatchId: nextGrepMatchId.current,
      nextGrepExtractId: nextGrepExtractId.current,
      showOnlyGrepMatches,
      activeTab,
      selectedResultIndex,
      sortKey,
      sortDir,
      filterSearch,
      filterStatuses: [...filterStatuses],
      filterMinLength,
      filterMaxLength,
      filterMinTime,
      filterMaxTime,
      attackResults,
      payloadLabels: attackPayloadLabelsRef.current,
      attackError,
    };
  }

  function applySnapshot(snap: TabSnapshot) {
    setRequest(snap.request);
    setAttackType(snap.attackType);
    setPayloadSets(snap.payloadSets);
    nextPayloadId.current = snap.nextPayloadId;
    setActivePayloadSetId(snap.activePayloadSetId);
    setConcurrency(snap.concurrency);
    setRequestsPerSecond(snap.requestsPerSecond);
    setTimeoutSeconds(snap.timeoutSeconds);
    setMaxRequests(snap.maxRequests);
    setGrepMatchRules(snap.grepMatchRules);
    setGrepExtractRules(snap.grepExtractRules);
    nextGrepMatchId.current = snap.nextGrepMatchId;
    nextGrepExtractId.current = snap.nextGrepExtractId;
    setShowOnlyGrepMatches(snap.showOnlyGrepMatches);
    setActiveTab(snap.activeTab);
    setSelectedResultIndex(snap.selectedResultIndex);
    setSortKey(snap.sortKey);
    setSortDir(snap.sortDir);
    setFilterSearch(snap.filterSearch);
    setFilterStatuses(new Set(snap.filterStatuses));
    setFilterMinLength(snap.filterMinLength);
    setFilterMaxLength(snap.filterMaxLength);
    setFilterMinTime(snap.filterMinTime);
    setFilterMaxTime(snap.filterMaxTime);

    // The labels must be in place before the results that use them.
    attackPayloadLabelsRef.current = snap.payloadLabels;
    setAttackResults(snap.attackResults);
    setAttackError(snap.attackError);

    setResultModalOpen(false);
    setHistoryOpen(false);
    setSelectedHistoryId(null);
    setHasSelection(false);
  }

  // On entering the page: bring back the tabs from this app session.
  // A request sent from History always opens in its own clean tab.
  useEffect(() => {
    if (loadedInbox.current) return;
    loadedInbox.current = true;

    const incoming = takeIntruderInbox();
    const inboxItem =
      incoming.length > 0 ? incoming[incoming.length - 1] : null;

    const store = intruderStore;

    if (store.tabs.length === 0 || inboxItem?.rawRequest) {
      const id = store.nextId++;
      store.tabs.push({
        id,
        snapshot: freshSnapshot(inboxItem?.rawRequest || DEFAULT_REQUEST),
      });
      store.activeId = id;
    }

    const active =
      store.tabs.find((tab) => tab.id === store.activeId) ?? store.tabs[0];
    store.activeId = active.id;

    applySnapshot(active.snapshot);
    setTabIds(store.tabs.map((tab) => tab.id));
    setActiveTabId(active.id);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the active tab's stored session current after every render, so
  // leaving the page never loses anything.
  useEffect(() => {
    if (!hydrated || activeTabId === null) return;

    const record = intruderStore.tabs.find((tab) => tab.id === activeTabId);
    if (record) record.snapshot = buildSnapshot();
  });

  function saveCurrentTab() {
    if (activeTabId === null) return;
    const record = intruderStore.tabs.find((tab) => tab.id === activeTabId);
    if (record) record.snapshot = buildSnapshot();
  }

  function openNewTab() {
    if (isRunning) return;

    saveCurrentTab();

    const store = intruderStore;
    const id = store.nextId++;
    const snapshot = freshSnapshot(DEFAULT_REQUEST);

    store.tabs.push({ id, snapshot });
    store.activeId = id;

    applySnapshot(snapshot);
    setTabIds(store.tabs.map((tab) => tab.id));
    setActiveTabId(id);
  }

  function switchTab(id: number) {
    if (isRunning || id === activeTabId) return;

    const record = intruderStore.tabs.find((tab) => tab.id === id);
    if (!record) return;

    saveCurrentTab();

    intruderStore.activeId = id;
    applySnapshot(record.snapshot);
    setActiveTabId(id);
  }

  function closeTab(id: number) {
    if (isRunning) return;

    const store = intruderStore;
    const index = store.tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;

    store.tabs.splice(index, 1);

    if (store.tabs.length === 0) {
      const newId = store.nextId++;
      const snapshot = freshSnapshot(DEFAULT_REQUEST);
      store.tabs.push({ id: newId, snapshot });
      store.activeId = newId;
      applySnapshot(snapshot);
      setActiveTabId(newId);
    } else if (id === activeTabId) {
      const next = store.tabs[Math.min(index, store.tabs.length - 1)];
      store.activeId = next.id;
      applySnapshot(next.snapshot);
      setActiveTabId(next.id);
    }

    setTabIds(store.tabs.map((tab) => tab.id));
  }

  // -------------------------------------------------------
  // Positions
  // -------------------------------------------------------

  const positions = useMemo(() => {
    const found: { start: number; end: number; value: string }[] = [];
    const regex = /§([\s\S]*?)§/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(request)) !== null) {
      found.push({
        start: match.index,
        end: match.index + match[0].length,
        value: match[1],
      });
    }

    return found;
  }, [request]);

  // -------------------------------------------------------
  // Keep one set per position
  // -------------------------------------------------------

  useEffect(() => {
    setPayloadSets((current) => {
      const targetCount = positions.length;
      if (current.length === targetCount) return current;

      if (current.length > targetCount) return current.slice(0, targetCount);

      const additions = Array.from(
        { length: targetCount - current.length },
        () => {
          const id = nextPayloadId.current++;
          return makePayloadSet(id);
        }
      );

      return [...current, ...additions];
    });
  }, [positions.length]);

  useEffect(() => {
    if (payloadSets.length === 0) {
      setActivePayloadSetId(null);
      return;
    }

    const selectedExists = payloadSets.some(
      (set) => set.id === activePayloadSetId
    );
    if (!selectedExists) setActivePayloadSetId(payloadSets[0].id);
  }, [payloadSets, activePayloadSetId]);

  // -------------------------------------------------------
  // Payload configuration accessors
  // -------------------------------------------------------

  const visiblePayloadSets = sharedMode
    ? payloadSets.slice(0, 1)
    : payloadSets.slice(0, positions.length);

  const activePayloadSet = sharedMode
    ? payloadSets[0]
    : visiblePayloadSets.find((set) => set.id === activePayloadSetId) ??
      visiblePayloadSets[0];

  const activePayloadSetIndex = activePayloadSet
    ? payloadSets.findIndex((set) => set.id === activePayloadSet.id)
    : -1;

  const filteredHistory = useMemo(() => {
    const query = historySearch.toLowerCase();
    return history.filter((item) => {
      const text = `${item.method} ${item.host} ${item.path}`.toLowerCase();
      return text.includes(query);
    });
  }, [history, historySearch]);

  // -------------------------------------------------------
  // Request and payload actions
  // -------------------------------------------------------

  function handleMarkPosition() {
    editorRef.current?.wrapSelection("§", "§");
  }

  function handleClearPositions() {
    setRequest((current) => current.replace(/§([\s\S]*?)§/g, "$1"));
  }

  function selectHistoryItem(item: HistoryItem) {
    const raw = getRawRequest(item);
    if (!raw) return;

    setRequest(raw);
    setSelectedHistoryId(item.id);
    setHistoryOpen(false);
  }

  function updateSet(id: number, patch: Partial<PayloadSet>) {
    setPayloadSets((sets) =>
      sets.map((set) => (set.id === id ? { ...set, ...patch } : set))
    );
  }

  function loadWordlistIntoList(
    id: number,
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      updateSet(id, { values: String(reader.result || "") });
    };

    reader.readAsText(file);
    event.target.value = "";
  }

  function resetResultFilters() {
    setFilterSearch("");
    setFilterStatuses(new Set());
    setFilterMinLength("");
    setFilterMaxLength("");
    setFilterMinTime("");
    setFilterMaxTime("");
    setShowOnlyGrepMatches(false);
  }

  function toggleStatusFilter(bucket: string) {
    setFilterStatuses((current) => {
      const next = new Set(current);
      if (next.has(bucket)) next.delete(bucket);
      else next.add(bucket);
      return next;
    });
  }

  // -------------------------------------------------------
  // Grep rule management
  // -------------------------------------------------------

  function addGrepMatchRule() {
    const id = nextGrepMatchId.current++;
    setGrepMatchRules((rules) => [
      ...rules,
      { id, pattern: "", regex: false, invert: false },
    ]);
  }

  function updateGrepMatchRule(id: number, patch: Partial<GrepMatchRule>) {
    setGrepMatchRules((rules) =>
      rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))
    );
  }

  function removeGrepMatchRule(id: number) {
    setGrepMatchRules((rules) => rules.filter((rule) => rule.id !== id));
  }

  function addGrepExtractRule() {
    const id = nextGrepExtractId.current++;
    setGrepExtractRules((rules) => [...rules, { id, pattern: "" }]);
  }

  function updateGrepExtractRule(
    id: number,
    patch: Partial<GrepExtractRule>
  ) {
    setGrepExtractRules((rules) =>
      rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))
    );
  }

  function removeGrepExtractRule(id: number) {
    setGrepExtractRules((rules) => rules.filter((rule) => rule.id !== id));
  }

  // -------------------------------------------------------
  // Start attack
  // -------------------------------------------------------

  async function handleStartAttack() {
    if (isRunning || attackInFlight.current) return;

    setAttackError("");
    setSelectedResultIndex(null);
    setResultModalOpen(false);
    resetResultFilters();
    setSortKey(null);

    if (positions.length === 0) {
      setAttackError("Mark at least one payload position in your request.");
      setActiveTab("payloads");
      return;
    }

    if (followRedirects) {
      setAttackError(
        "Redirect following is not supported by the current backend yet. Turn it off."
      );
      setActiveTab("payloads");
      return;
    }

    if (
      concurrency < 1 ||
      concurrency > 20 ||
      timeoutSeconds < 1 ||
      timeoutSeconds > 120 ||
      maxRequests < 1 ||
      maxRequests > 10000 ||
      requestsPerSecond < 0 ||
      requestsPerSecond > 100
    ) {
      setAttackError(
        "One or more execution settings are outside the allowed limits."
      );
      setActiveTab("settings");
      return;
    }

    try {
      const setsToSend = sharedMode
        ? payloadSets.slice(0, 1)
        : payloadSets.slice(0, positions.length);

      if (setsToSend.length === 0) {
        throw new Error("No payload configuration is available.");
      }

      const backendPayloadSets = setsToSend.map((set) =>
        buildBackendPayloadSet(set, maxRequests)
      );

      try {
        const expanded = setsToSend.map((set) =>
          expandSetValues(set, maxRequests)
        );

        attackPayloadLabelsRef.current = computeAttackPayloadLabels(
          attackType,
          expanded,
          positions.length,
          maxRequests
        );
      } catch {
        attackPayloadLabelsRef.current = null;
      }

      const scheme = inferScheme(request);

      const payload = {
        raw_request: request,
        scheme,
        attack_type: attackType,
        payload_sets: backendPayloadSets,
        settings: {
          concurrency,
          requests_per_second: requestsPerSecond,
          timeout_seconds: timeoutSeconds,
          max_requests: maxRequests,
          follow_redirects: false,
          verify_tls: true,
        },
      };

      attackInFlight.current = true;
      setIsRunning(true);
      setAttackResults(null);
      setActiveTab("results");

      const response = await fetch(`${API_BASE}/api/intruder/attack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
            data.message ||
            `Server returned HTTP ${response.status}`
        );
      }

      setAttackResults(data as IntruderResponse);
      setSelectedResultIndex(
        data.results?.length > 0 ? data.results[0].request_index : null
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred.";

      setAttackError(message);
      setActiveTab("results");
    } finally {
      attackInFlight.current = false;
      setIsRunning(false);
    }
  }

  // -------------------------------------------------------
  // Payload labels
  // -------------------------------------------------------

  const payloadByRequestIndex = useMemo(() => {
    const map = new Map<number, string>();
    const labels = attackPayloadLabelsRef.current;
    if (!attackResults || !labels) return map;

    const byRequestIndex = [...attackResults.results].sort(
      (a, b) => a.request_index - b.request_index
    );

    byRequestIndex.forEach((result, index) => {
      const label = labels[index];
      if (label !== undefined) map.set(result.request_index, label);
    });

    return map;
  }, [attackResults]);

  function payloadLabelFor(result: IntruderResult): string | null {
    return (
      result.payload ??
      payloadByRequestIndex.get(result.request_index) ??
      null
    );
  }

  // -------------------------------------------------------
  // Status filter options
  // -------------------------------------------------------

  const statusFilterOptions = useMemo(() => {
    const counts = new Map<string, number>();
    (attackResults?.results ?? []).forEach((result) => {
      const bucket = statusBucket(result);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    });

    return [...counts.entries()].sort(([a], [b]) => {
      if (a === "error") return 1;
      if (b === "error") return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
  }, [attackResults]);

  const activeFilterCount =
    (filterSearch.trim() ? 1 : 0) +
    filterStatuses.size +
    (filterMinLength !== "" ? 1 : 0) +
    (filterMaxLength !== "" ? 1 : 0) +
    (filterMinTime !== "" ? 1 : 0) +
    (filterMaxTime !== "" ? 1 : 0) +
    (showOnlyGrepMatches ? 1 : 0);

  // -------------------------------------------------------
  // Filtered + sorted results
  // -------------------------------------------------------

  const filteredResults = useMemo(() => {
    const rows = attackResults?.results ?? [];
    const query = filterSearch.trim().toLowerCase();

    return rows.filter((result) => {
      if (
        filterStatuses.size > 0 &&
        !filterStatuses.has(statusBucket(result))
      ) {
        return false;
      }

      if (
        filterMinLength !== "" &&
        (result.size_raw ?? -Infinity) < Number(filterMinLength)
      ) {
        return false;
      }

      if (
        filterMaxLength !== "" &&
        (result.size_raw ?? Infinity) > Number(filterMaxLength)
      ) {
        return false;
      }

      if (
        filterMinTime !== "" &&
        (result.duration_ms ?? -Infinity) < Number(filterMinTime)
      ) {
        return false;
      }

      if (
        filterMaxTime !== "" &&
        (result.duration_ms ?? Infinity) > Number(filterMaxTime)
      ) {
        return false;
      }

      if (showOnlyGrepMatches && !rowMatchesGrep(result, grepMatchRules)) {
        return false;
      }

      if (query) {
        const payloadLabel = payloadLabelFor(result) ?? "";
        const haystack = `${result.url ?? ""} ${payloadLabel}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    attackResults,
    filterSearch,
    filterStatuses,
    filterMinLength,
    filterMaxLength,
    filterMinTime,
    filterMaxTime,
    showOnlyGrepMatches,
    grepMatchRules,
    payloadByRequestIndex,
  ]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sortedResults = useMemo(() => {
    const rows = filteredResults;
    if (!sortKey) return rows;

    const dir = sortDir === "asc" ? 1 : -1;

    return [...rows].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);

      if (av === null && bv === null) return a.request_index - b.request_index;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av !== bv) return (av - bv) * dir;

      return a.request_index - b.request_index;
    });
  }, [filteredResults, sortKey, sortDir]);

  const selectedResult = attackResults?.results.find(
    (result) => result.request_index === selectedResultIndex
  );

  const selectedResultPosition = sortedResults.findIndex(
    (result) => result.request_index === selectedResultIndex
  );

  function openResultModal(requestIndex: number) {
    setSelectedResultIndex(requestIndex);
    setResultModalOpen(true);
  }

  function closeResultModal() {
    setResultModalOpen(false);
  }

  function stepResultModal(delta: number) {
    if (selectedResultPosition === -1) return;
    const nextPosition = selectedResultPosition + delta;
    if (nextPosition < 0 || nextPosition >= sortedResults.length) return;
    setSelectedResultIndex(sortedResults[nextPosition].request_index);
  }

  function copyToClipboard(text: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  function copyWithFeedback(key: string, text: string) {
    copyToClipboard(text);
    setCopiedKey(key);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopiedKey(null), 1400);
  }

  // -------------------------------------------------------
  // Modal actions: Repeater + Ask AI
  // -------------------------------------------------------

  function handleSendToRepeater() {
    if (!selectedResult?.url) return;

    const parsed = parseRawRequest(selectedResult.request);

    sendToRepeater({
      method: selectedResult.method || parsed.method,
      url: selectedResult.url,
      headers: parsed.headers,
      body_base64: parsed.body_base64,
    });

    router.push("/repeater");
  }

  function handleAskAi() {
    if (!selectedResult) return;

    // Request and response travel together as ONE attachment, so the AI
    // window's "Redact secrets" option masks Authorization / Cookie /
    // Set-Cookie headers in both before anything is sent.
    const requestPart = selectedResult.request.slice(0, AI_REQUEST_LIMIT);
    const responsePart = selectedResult.success
      ? buildResponseText(selectedResult).slice(0, AI_RESPONSE_LIMIT)
      : `(The request failed, so there is no response.)\n${
          selectedResult.error ?? ""
        }`.slice(0, AI_RESPONSE_LIMIT);

    const attachment = `${requestPart}\n\n\n### RESPONSE ###\n${responsePart}`;
    const payloadLabel = payloadLabelFor(selectedResult);

    openGeminiAIWith({
      prompt:
        "I'm working in the PacketSniffer Intruder. The attached file" +
        " contains one request sent during an Intruder attack, followed by" +
        " a line reading '### RESPONSE ###' and then the server's response." +
        " Analyze both for security issues: authentication, authorization," +
        " injection, information disclosure, cookie and header problems." +
        " Explain what this response says about the payload that was sent," +
        " and suggest concrete follow-up tests.\n\n" +
        `Request: ${selectedResult.method ?? ""} ${selectedResult.url ?? ""}` +
        (payloadLabel ? `\nPayload: ${payloadLabel}` : "") +
        (selectedResult.success
          ? `\nResponse status: ${selectedResult.status_code ?? "unknown"}`
          : "\nThe request failed."),
      httpRequest: attachment,
      httpRequestName: "intruder-request-response.http",
    });
  }

  // -------------------------------------------------------
  // Modal keyboard shortcuts
  //
  // Esc          → close
  // Arrows       → previous / next result
  // Ctrl/Cmd + R → send to Repeater (reload is suppressed while open)
  // -------------------------------------------------------

  useEffect(() => {
    if (!resultModalOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
        if (event.code === "KeyR") {
          event.preventDefault();
          handleSendToRepeater();
        }
        if (event.code === "KeyF") {
          event.preventDefault();
          const target =
            modalLayout === "request"
              ? "request"
              : modalLayout === "response"
                ? "response"
                : hoveredPane.current;
          setFindTarget(target);
          setFindSignal((n) => n + 1);
        }
        return;
      }

      // Let the find box handle its own keys (arrows, Esc).
      const el = event.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) {
        return;
      }

      if (event.key === "Escape") {
        closeResultModal();
      } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        stepResultModal(1);
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        stepResultModal(-1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    resultModalOpen,
    selectedResultPosition,
    sortedResults,
    selectedResult,
    modalLayout,
  ]);

  // Keep the active row visible in the modal sidebar.
  useEffect(() => {
    if (!resultModalOpen || selectedResultIndex === null) return;
    document
      .querySelector<HTMLElement>(
        `[data-modal-row="${selectedResultIndex}"]`
      )
      ?.scrollIntoView({ block: "nearest" });
  }, [resultModalOpen, selectedResultIndex, modalSidebarOpen]);

  // -------------------------------------------------------
  // Modal divider drag
  // -------------------------------------------------------

  function onModalDividerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setModalDragging(true);
  }

  function onModalDividerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!modalDragging) return;
    const rect = modalPanesRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;

    const pct =
      modalLayout === "stacked"
        ? ((e.clientY - rect.top) / rect.height) * 100
        : ((e.clientX - rect.left) / rect.width) * 100;

    setModalSplit(clampSplit(pct));
  }

  function onModalDividerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!modalDragging) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setModalDragging(false);
  }

  const activeGrepExtractRules = useMemo(
    () => grepExtractRules.filter((rule) => rule.pattern.trim().length > 0),
    [grepExtractRules]
  );

  // -------------------------------------------------------
  // Result modal pieces
  // -------------------------------------------------------

  const modalResponseText = selectedResult
    ? responseTextForView(selectedResult, responseView)
    : "";

  const modalPayloadLabel = selectedResult
    ? payloadLabelFor(selectedResult)
    : null;

  const modalGrepFired = selectedResult
    ? whichGrepRulesMatch(selectedResult, grepMatchRules)
    : [];

  const requestPane = selectedResult ? (
    <EditorPane
      label="Request"
      meta={selectedResult.method ? `${selectedResult.method}` : undefined}
      text={selectedResult.request}
      onCopy={() => copyWithFeedback("request", selectedResult.request)}
      copied={copiedKey === "request"}
      findSignal={findTarget === "request" ? findSignal : 0}
    />
  ) : null;

  const responsePane = selectedResult ? (
    <EditorPane
      label="Response"
      meta={
        selectedResult.content_encoding
          ? `encoding: ${selectedResult.content_encoding}`
          : undefined
      }
      text={modalResponseText}
      accent={selectedResult.success ? "default" : "error"}
      headerExtra={
        selectedResult.success ? (
          <MiniSegmented
            label="Response view"
            options={RESPONSE_VIEWS}
            value={responseView}
            onChange={setResponseView}
          />
        ) : undefined
      }
      onCopy={() => copyWithFeedback("response", modalResponseText)}
      copied={copiedKey === "response"}
      findSignal={findTarget === "response" ? findSignal : 0}
    />
  ) : null;

  const modalStacked = modalLayout === "stacked";
  const modalShowsBoth = modalLayout === "split" || modalLayout === "stacked";

  const firstPaneStyle = {
    "--p": `${modalSplit}%`,
  } as CSSProperties;

  // -------------------------------------------------------
  // Left panel
  // -------------------------------------------------------

  const leftPanel = (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/[0.08] bg-[#0d0d0f] px-3">
        <span className="text-[12.5px] font-semibold uppercase tracking-wider text-[#8a8a98]">
          Request
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setHistoryOpen((value) => !value)}
            title="Load a captured request"
            className={`${btnOutline} !h-8 !px-2.5 !text-[12px] ${
              historyOpen ? "!border-emerald-400/40 !text-emerald-300" : ""
            }`}
          >
            <History size={14} className="mr-1.5" />
            History
          </button>

          <button
            type="button"
            onClick={handleMarkPosition}
            disabled={!hasSelection}
            title="Wrap selected text in § markers"
            className={`${btnPrimary} !h-8 !px-3 !text-[12px]`}
          >
            Mark position
          </button>

          <button
            type="button"
            onClick={handleClearPositions}
            disabled={positions.length === 0}
            title="Remove all position markers"
            className={`${btnGhost} !h-8 !px-2.5 !text-[12px]`}
          >
            Clear
          </button>
        </div>
      </div>

      <RequestEditor
        ref={editorRef}
        value={request}
        onChange={setRequest}
        onSelectionChange={({ start, end }) => setHasSelection(end > start)}
      />

      {historyOpen && (
        <div className="absolute inset-x-3 top-[58px] z-30 overflow-hidden rounded-xl border border-white/10 bg-[#121214] shadow-2xl shadow-black/60">
          <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
            <span className="text-[13px] font-semibold text-[#c4c4ce]">
              Captured requests
            </span>

            <button
              type="button"
              onClick={() => setHistoryOpen(false)}
              className="rounded p-1 text-[#8a8a98] transition hover:bg-white/[0.06] hover:text-white"
            >
              <X size={16} />
            </button>
          </div>

          <div className="border-b border-white/[0.08] p-3">
            <div className="flex items-center gap-2 rounded-lg border border-white/[0.1] bg-black/30 px-3 focus-within:border-emerald-400/40">
              <Search size={14} className="text-[#6c6c78]" />

              <input
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
                placeholder="Search method, host or path..."
                className="h-10 min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-[#6c6c78]"
              />
            </div>
          </div>

          <div className="max-h-[320px] overflow-y-auto">
            {filteredHistory.length === 0 ? (
              <div className="px-4 py-10 text-center text-[12.5px] text-[#777784]">
                No matching captured requests.
              </div>
            ) : (
              filteredHistory.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => selectHistoryItem(item)}
                  className={`flex w-full items-center gap-3 border-b border-white/[0.04] px-4 py-3 text-left transition hover:bg-white/[0.04] ${
                    selectedHistoryId === item.id
                      ? "bg-emerald-400/[0.06]"
                      : ""
                  }`}
                >
                  <span className="shrink-0 rounded-md bg-white/[0.06] px-2 py-1 text-[10px] font-bold text-emerald-300">
                    {item.method}
                  </span>

                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-[#c4c4ce]">
                    {item.host}
                    {item.path}
                  </span>

                  <ChevronDown size={14} className="shrink-0 text-[#666672]" />
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );

  // -------------------------------------------------------
  // Right panel
  // -------------------------------------------------------

  const rightPanel = (
    <div className="flex h-full min-h-0 flex-col bg-[#0f0f11]">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/[0.08] bg-[#0d0d0f] px-3">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-white/[0.08] text-white"
                : "text-[#8a8a98] hover:text-white"
            }`}
          >
            {tab.label}

            {tab.id === "results" && attackResults && (
              <span className="ml-2 rounded-full bg-emerald-400/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
                {attackResults.total_requests}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:#3a3a44_transparent] [scrollbar-width:thin]">
        {/* Payloads tab */}

        {activeTab === "payloads" && (
          <div className="space-y-6 p-5">
            {positions.length === 0 && (
              <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-4 py-3 text-[13px] leading-5 text-amber-300">
                No payload positions marked. Select text in the request on the
                left and click <strong>Mark position</strong>.
              </div>
            )}

            <section>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-[14px] font-semibold text-white">
                  Attack type
                </h3>

                <span className="text-[11px] text-[#6c6c78]">
                  {ATTACK_TYPES.find((item) => item.id === attackType)?.name}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {ATTACK_TYPES.map((attack) => {
                  const selected = attackType === attack.id;
                  return (
                    <button
                      type="button"
                      key={attack.id}
                      onClick={() => setAttackType(attack.id)}
                      className={`min-h-[76px] rounded-lg border px-3 py-2.5 text-left transition ${
                        selected
                          ? "border-emerald-400/50 bg-emerald-400/[0.07]"
                          : "border-white/[0.08] bg-white/[0.015] hover:border-white/20"
                      }`}
                    >
                      <span
                        className={`text-[13px] font-semibold ${
                          selected ? "text-emerald-300" : "text-[#e4e4ea]"
                        }`}
                      >
                        {attack.name}
                      </span>

                      <p className="mt-1 text-[11.5px] leading-4 text-[#8a8a98]">
                        {attack.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-[14px] font-semibold text-white">
                  Payloads
                </h3>

                {positions.length > 0 && (
                  <span className="text-[11.5px] text-[#777784]">
                    {sharedMode
                      ? "Single configuration"
                      : `${positions.length} positions`}
                  </span>
                )}
              </div>

              {positions.length === 0 ? (
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.015] px-4 py-6 text-center text-[13px] text-[#8a8a98]">
                  Mark at least one payload position to configure payloads.
                </div>
              ) : !activePayloadSet ? (
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.015] px-4 py-6 text-center text-[13px] text-[#8a8a98]">
                  Preparing payload configuration...
                </div>
              ) : (
                <div className="space-y-3">
                  {!sharedMode && (
                    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-white/[0.07] bg-[#101012] p-1.5">
                      {positions.map((position, index) => {
                        const set = payloadSets[index];
                        if (!set) return null;

                        const selected = set.id === activePayloadSet.id;
                        const count = countForSet(set);

                        return (
                          <button
                            key={`${position.start}-${position.end}`}
                            type="button"
                            onClick={() => setActivePayloadSetId(set.id)}
                            className={`inline-flex min-w-0 items-center gap-2 rounded-md px-3 py-2 text-[12.5px] font-medium transition ${
                              selected
                                ? "bg-emerald-400/15 text-emerald-300"
                                : "text-[#92929e] hover:bg-white/[0.05] hover:text-white"
                            }`}
                            title={`Position ${index + 1}: ${
                              position.value || "empty"
                            }`}
                          >
                            <span className="truncate">
                              Position {index + 1}
                            </span>

                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[10.5px] tabular-nums ${
                                selected
                                  ? "bg-emerald-400/15 text-emerald-300"
                                  : "bg-white/[0.05] text-[#777784]"
                              }`}
                            >
                              {count === null
                                ? "…"
                                : count.toLocaleString()}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.015]">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-[#e4e4ea]">
                          {sharedMode
                            ? "Payload configuration"
                            : `Position ${activePayloadSetIndex + 1}`}
                        </p>

                        {!sharedMode && positions[activePayloadSetIndex] && (
                          <p className="mt-0.5 truncate text-[11.5px] text-[#777784]">
                            Marked value:{" "}
                            <span className={mono.className}>
                              {positions[activePayloadSetIndex].value ||
                                "(empty)"}
                            </span>
                          </p>
                        )}
                      </div>

                      <Segmented
                        options={PAYLOAD_TYPES}
                        value={activePayloadSet.type}
                        onChange={(type) =>
                          updateSet(activePayloadSet.id, { type })
                        }
                      />
                    </div>

                    <div className="border-b border-white/[0.06] bg-white/[0.012] px-4 py-2 text-[12px] font-medium text-[#9cd9bd]">
                      {summarizeSet(activePayloadSet)}
                    </div>

                    <div className="p-4 space-y-4">
                      {activePayloadSet.type === "list" && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[12.5px] text-[#8a8a98]">
                              One payload per line
                            </span>

                            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium text-[#9a9aa8] transition hover:bg-white/[0.06] hover:text-white">
                              <Upload size={13} />
                              Load file

                              <input
                                type="file"
                                accept=".txt,.list,.csv"
                                className="hidden"
                                onChange={(event) =>
                                  loadWordlistIntoList(
                                    activePayloadSet.id,
                                    event
                                  )
                                }
                              />
                            </label>
                          </div>

                          <textarea
                            value={activePayloadSet.values}
                            onChange={(event) =>
                              updateSet(activePayloadSet.id, {
                                values: event.target.value,
                              })
                            }
                            spellCheck={false}
                            placeholder={"admin\nuser\ntest"}
                            className={`${mono.className} min-h-[140px] w-full resize-y rounded-lg border border-white/[0.1] bg-[#141416] p-3.5 text-[13px] leading-6 text-[#d4d4dc] outline-none transition placeholder:text-[#54545e] focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20`}
                          />
                        </div>
                      )}

                      {activePayloadSet.type === "numbers" && (
                        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                          <Field label="Start">
                            <NumberInput
                              value={activePayloadSet.numStart}
                              onChange={(value) =>
                                updateSet(activePayloadSet.id, {
                                  numStart: value,
                                })
                              }
                            />
                          </Field>

                          <Field label="End">
                            <NumberInput
                              value={activePayloadSet.numEnd}
                              onChange={(value) =>
                                updateSet(activePayloadSet.id, {
                                  numEnd: value,
                                })
                              }
                            />
                          </Field>

                          <Field label="Step">
                            <NumberInput
                              value={activePayloadSet.numStep}
                              onChange={(value) =>
                                updateSet(activePayloadSet.id, {
                                  numStep: value,
                                })
                              }
                            />
                          </Field>

                          <Field label="Zero-pad digits" hint="0 = off">
                            <NumberInput
                              value={activePayloadSet.numPad}
                              min={0}
                              max={20}
                              onChange={(value) =>
                                updateSet(activePayloadSet.id, {
                                  numPad: value,
                                })
                              }
                            />
                          </Field>
                        </div>
                      )}

                      {activePayloadSet.type === "wordlist" && (
                        <Field
                          label="File path on this machine"
                          hint="The backend reads this path from disk. Payload processing and encoding do NOT apply to wordlist sources — they are expanded server-side."
                        >
                          <input
                            value={activePayloadSet.filePath}
                            onChange={(event) =>
                              updateSet(activePayloadSet.id, {
                                filePath: event.target.value,
                              })
                            }
                            placeholder="C:\wordlists\common.txt"
                            spellCheck={false}
                            className={`${mono.className} ${inputClass}`}
                          />
                        </Field>
                      )}

                      {activePayloadSet.type === "brute" && (
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                            <div className="sm:col-span-1">
                              <Field label="Character set">
                                <input
                                  value={activePayloadSet.bruteCharset}
                                  onChange={(event) =>
                                    updateSet(activePayloadSet.id, {
                                      bruteCharset: event.target.value,
                                    })
                                  }
                                  spellCheck={false}
                                  className={`${mono.className} ${inputClass}`}
                                />
                              </Field>
                            </div>

                            <Field label="Min length">
                              <NumberInput
                                value={activePayloadSet.bruteMin}
                                min={1}
                                onChange={(value) =>
                                  updateSet(activePayloadSet.id, {
                                    bruteMin: value,
                                  })
                                }
                              />
                            </Field>

                            <Field label="Max length">
                              <NumberInput
                                value={activePayloadSet.bruteMax}
                                min={1}
                                onChange={(value) =>
                                  updateSet(activePayloadSet.id, {
                                    bruteMax: value,
                                  })
                                }
                              />
                            </Field>
                          </div>

                          <p className="text-[11.5px] leading-5 text-[#777784]">
                            Values are generated in the browser, so payload
                            processing and encoding below apply.
                          </p>
                        </div>
                      )}

                      {activePayloadSet.type === "null" && (
                        <Field
                          label="Request count"
                          hint="Resends the marked request position with an empty value."
                        >
                          <NumberInput
                            value={activePayloadSet.nullCount}
                            min={1}
                            onChange={(value) =>
                              updateSet(activePayloadSet.id, {
                                nullCount: value,
                              })
                            }
                          />
                        </Field>
                      )}

                      {/* Payload processing */}

                      <div className="mt-2 rounded-lg border border-white/[0.07] bg-[#0d0d10] p-3.5 space-y-3">
                        <div className="flex items-center gap-2">
                          <Binary size={13} className="text-[#8a8a98]" />
                          <span className="text-[12px] font-semibold uppercase tracking-wider text-[#8a8a98]">
                            Payload processing
                          </span>
                        </div>

                        {activePayloadSet.type === "wordlist" ? (
                          <p className="text-[11.5px] leading-5 text-[#777784]">
                            Payload processing is disabled for wordlist
                            sources, because the backend reads the file. Use
                            the simple list type to encode or filter payloads.
                          </p>
                        ) : (
                          <>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <Field label="Prefix">
                                <input
                                  value={activePayloadSet.prefix}
                                  onChange={(event) =>
                                    updateSet(activePayloadSet.id, {
                                      prefix: event.target.value,
                                    })
                                  }
                                  spellCheck={false}
                                  className={`${mono.className} mt-1.5 h-9 w-full rounded-md border border-white/[0.1] bg-[#141416] px-2.5 text-[12.5px] text-white outline-none focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20`}
                                />
                              </Field>

                              <Field label="Suffix">
                                <input
                                  value={activePayloadSet.suffix}
                                  onChange={(event) =>
                                    updateSet(activePayloadSet.id, {
                                      suffix: event.target.value,
                                    })
                                  }
                                  spellCheck={false}
                                  className={`${mono.className} mt-1.5 h-9 w-full rounded-md border border-white/[0.1] bg-[#141416] px-2.5 text-[12.5px] text-white outline-none focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20`}
                                />
                              </Field>
                            </div>

                            <Field
                              label="Skip if matches"
                              hint="Regex. Payloads whose value matches are dropped."
                            >
                              <input
                                value={activePayloadSet.skipIfMatch}
                                onChange={(event) =>
                                  updateSet(activePayloadSet.id, {
                                    skipIfMatch: event.target.value,
                                  })
                                }
                                spellCheck={false}
                                placeholder="e.g. ^admin$"
                                className={`${mono.className} mt-1.5 h-9 w-full rounded-md border border-white/[0.1] bg-[#141416] px-2.5 text-[12.5px] text-white outline-none placeholder:text-[#54545e] focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20`}
                              />
                            </Field>
                          </>
                        )}
                      </div>

                      {/* Payload encoding (Burp-style, applied last) */}

                      {activePayloadSet.type !== "wordlist" && (
                        <div className="rounded-lg border border-white/[0.07] bg-[#0d0d10] p-3.5 space-y-3">
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-semibold uppercase tracking-wider text-[#8a8a98]">
                              Payload encoding
                            </span>
                          </div>

                          <label className="flex cursor-pointer items-start gap-2.5">
                            <input
                              type="checkbox"
                              checked={activePayloadSet.urlEncode}
                              onChange={(event) =>
                                updateSet(activePayloadSet.id, {
                                  urlEncode: event.target.checked,
                                })
                              }
                              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-emerald-400"
                            />
                            <span className="min-w-0">
                              <span className="block text-[12.5px] font-medium text-[#d4d4dc]">
                                URL-encode these characters
                              </span>
                              <span className="mt-0.5 block text-[11.5px] leading-5 text-[#777784]">
                                Applied to each payload after all processing
                                rules. Leave the field empty to percent-encode
                                the whole payload. Spaces are encoded as{" "}
                                <code className={mono.className}>%20</code>.
                              </span>
                            </span>
                          </label>

                          <input
                            value={activePayloadSet.urlEncodeChars}
                            onChange={(event) =>
                              updateSet(activePayloadSet.id, {
                                urlEncodeChars: event.target.value,
                              })
                            }
                            disabled={!activePayloadSet.urlEncode}
                            spellCheck={false}
                            placeholder="e.g. #?&=+,;:% "
                            className={`${mono.className} h-9 w-full rounded-md border border-white/[0.1] bg-[#141416] px-2.5 text-[12.5px] text-white outline-none placeholder:text-[#54545e] focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20 disabled:opacity-40`}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Request behavior (moved from Settings) */}

            <section>
              <h3 className="mb-3 text-[14px] font-semibold text-white">
                Request behavior
              </h3>

              <div className="rounded-xl border border-white/[0.08] bg-white/[0.015] p-5">
                <label className="flex cursor-not-allowed items-center justify-between gap-4 opacity-60">
                  <div>
                    <span className="block text-[13.5px] font-medium text-[#e4e4ea]">
                      Follow redirects
                    </span>

                    <span className="mt-0.5 block text-[12.5px] text-[#8a8a98]">
                      Not supported by the current backend yet.
                    </span>
                  </div>

                  <input
                    type="checkbox"
                    checked={followRedirects}
                    disabled
                    onChange={(event) =>
                      setFollowRedirects(event.target.checked)
                    }
                    className="h-5 w-5 shrink-0 accent-emerald-400"
                  />
                </label>
              </div>
            </section>

            {/* Grep – Match (moved from Settings) */}

            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-[14px] font-semibold text-white">
                    Grep – Match
                  </h3>
                  <p className="mt-1 text-[12px] leading-5 text-[#8a8a98]">
                    Flag results whose response contains (or matches) these
                    patterns. Flagged rows show a green mark in the results
                    table and can be filtered with "Only grep matches".
                  </p>
                </div>

                <button
                  type="button"
                  onClick={addGrepMatchRule}
                  className={`${btnOutline} shrink-0 !h-8 !px-2.5 !text-[12px]`}
                >
                  <Plus size={13} className="mr-1" />
                  Add rule
                </button>
              </div>

              <div className="space-y-2">
                {grepMatchRules.length === 0 && (
                  <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.01] px-4 py-6 text-center text-[12.5px] text-[#8a8a98]">
                    No grep-match rules yet.
                  </div>
                )}

                {grepMatchRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.015] p-2"
                  >
                    <input
                      value={rule.pattern}
                      onChange={(event) =>
                        updateGrepMatchRule(rule.id, {
                          pattern: event.target.value,
                        })
                      }
                      placeholder={
                        rule.regex
                          ? "Regex pattern"
                          : "Plain text substring"
                      }
                      spellCheck={false}
                      className={`${mono.className} h-9 min-w-0 flex-1 rounded-md border border-white/[0.1] bg-[#141416] px-2.5 text-[12.5px] text-white outline-none placeholder:text-[#54545e] focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20`}
                    />

                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-[#9a9aa8]">
                      <input
                        type="checkbox"
                        checked={rule.regex}
                        onChange={(event) =>
                          updateGrepMatchRule(rule.id, {
                            regex: event.target.checked,
                          })
                        }
                        className="h-3.5 w-3.5 accent-emerald-400"
                      />
                      Regex
                    </label>

                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-[#9a9aa8]">
                      <input
                        type="checkbox"
                        checked={rule.invert}
                        onChange={(event) =>
                          updateGrepMatchRule(rule.id, {
                            invert: event.target.checked,
                          })
                        }
                        className="h-3.5 w-3.5 accent-emerald-400"
                      />
                      Invert
                    </label>

                    <button
                      type="button"
                      onClick={() => removeGrepMatchRule(rule.id)}
                      title="Remove rule"
                      className="rounded-md p-1.5 text-[#8a8a98] transition hover:bg-red-400/10 hover:text-red-300"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {/* Grep – Extract (moved from Settings) */}

            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-[14px] font-semibold text-white">
                    Grep – Extract
                  </h3>
                  <p className="mt-1 text-[12px] leading-5 text-[#8a8a98]">
                    Extract a value from each response using a regex with one
                    capture group, e.g.{" "}
                    <code className={mono.className}>
                      CSRF:\s*([A-Za-z0-9]+)
                    </code>
                    . Extracted values appear as extra columns in the results
                    table.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={addGrepExtractRule}
                  className={`${btnOutline} shrink-0 !h-8 !px-2.5 !text-[12px]`}
                >
                  <Plus size={13} className="mr-1" />
                  Add rule
                </button>
              </div>

              <div className="space-y-2">
                {grepExtractRules.length === 0 && (
                  <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.01] px-4 py-6 text-center text-[12.5px] text-[#8a8a98]">
                    No grep-extract rules yet.
                  </div>
                )}

                {grepExtractRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.015] p-2"
                  >
                    <input
                      value={rule.pattern}
                      onChange={(event) =>
                        updateGrepExtractRule(rule.id, {
                          pattern: event.target.value,
                        })
                      }
                      placeholder="Regex with one capture group"
                      spellCheck={false}
                      className={`${mono.className} h-9 min-w-0 flex-1 rounded-md border border-white/[0.1] bg-[#141416] px-2.5 text-[12.5px] text-white outline-none placeholder:text-[#54545e] focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20`}
                    />

                    <button
                      type="button"
                      onClick={() => removeGrepExtractRule(rule.id)}
                      title="Remove rule"
                      className="rounded-md p-1.5 text-[#8a8a98] transition hover:bg-red-400/10 hover:text-red-300"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* Settings tab (only Execution limits now) */}

        {activeTab === "settings" && (
          <div className="space-y-8 p-6">
            <section>
              <h3 className="mb-1 text-[14px] font-semibold text-white">
                Execution limits
              </h3>

              <p className="mb-3 text-[12.5px] text-[#8a8a98]">
                Conservative defaults help prevent accidental request bursts.
              </p>

              <div className="grid grid-cols-1 gap-5 rounded-xl border border-white/[0.08] bg-white/[0.015] p-5 sm:grid-cols-2">
                <Field label="Concurrency" hint="1 – 20 parallel requests">
                  <NumberInput
                    value={concurrency}
                    min={1}
                    max={20}
                    onChange={setConcurrency}
                  />
                </Field>

                <Field
                  label="Requests / second"
                  hint="0 – 100; 0 disables rate limiting"
                >
                  <NumberInput
                    value={requestsPerSecond}
                    min={0}
                    max={100}
                    onChange={setRequestsPerSecond}
                  />
                </Field>

                <Field label="Timeout (seconds)" hint="1 – 120">
                  <NumberInput
                    value={timeoutSeconds}
                    min={1}
                    max={120}
                    onChange={setTimeoutSeconds}
                  />
                </Field>

                <Field
                  label="Maximum requests"
                  hint="Hard safety cap: 1 – 10,000"
                >
                  <NumberInput
                    value={maxRequests}
                    min={1}
                    max={10000}
                    onChange={setMaxRequests}
                  />
                </Field>
              </div>
            </section>
          </div>
        )}

        {/* Results tab */}

        {activeTab === "results" && (
          <div className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-[14px] font-semibold text-white">
                Attack results
              </h3>

              {attackResults && (
                <span className="rounded-full border border-white/[0.1] px-3 py-1 text-[12px] text-[#8a8a98]">
                  {attackResults.total_requests.toLocaleString()} total
                </span>
              )}
            </div>

            {attackError && (
              <div className="flex items-start gap-2 rounded-xl border border-red-400/20 bg-red-400/[0.06] p-4">
                <AlertCircle
                  size={17}
                  className="mt-0.5 shrink-0 text-red-400"
                />

                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-red-300">
                    Attack could not be completed
                  </p>

                  <p className="mt-1 break-words text-[12.5px] leading-5 text-[#c0a2a2]">
                    {attackError}
                  </p>
                </div>
              </div>
            )}

            {isRunning && (
              <div className="flex items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4">
                <Loader2
                  size={18}
                  className="animate-spin text-emerald-400"
                />

                <div>
                  <p className="text-[13px] font-medium text-emerald-300">
                    Attack is running
                  </p>

                  <p className="mt-0.5 text-[11.5px] text-[#8a8a98]">
                    Waiting for the backend to finish the requests...
                  </p>
                </div>
              </div>
            )}

            {attackResults && (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                    <p className="text-[11px] text-[#777784]">Total</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-white">
                      {attackResults.total_requests}
                    </p>
                  </div>

                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                    <p className="text-[11px] text-[#777784]">Successful</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-300">
                      {attackResults.successful_requests}
                    </p>
                  </div>

                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                    <p className="text-[11px] text-[#777784]">Failed</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-red-300">
                      {attackResults.failed_requests}
                    </p>
                  </div>

                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                    <p className="text-[11px] text-[#777784]">Duration</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-white">
                      {attackResults.duration_ms.toFixed(1)}
                      <span className="ml-1 text-xs font-normal text-[#777784]">
                        ms
                      </span>
                    </p>
                  </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.015]">
                  <button
                    type="button"
                    onClick={() => setFiltersOpen((value) => !value)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-[#c4c4ce]">
                      <Filter size={14} className="text-[#8a8a98]" />
                      Filters
                      {activeFilterCount > 0 && (
                        <span className="rounded-full bg-emerald-400/15 px-1.5 py-0.5 text-[10.5px] text-emerald-300">
                          {activeFilterCount} active
                        </span>
                      )}
                    </span>

                    <span className="inline-flex items-center gap-3 text-[11.5px] text-[#777784]">
                      Showing {filteredResults.length.toLocaleString()} of{" "}
                      {attackResults.results.length.toLocaleString()}
                      {filtersOpen ? (
                        <ChevronUp size={14} />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                    </span>
                  </button>

                  {filtersOpen && (
                    <div className="space-y-3 border-t border-white/[0.07] px-4 py-3.5">
                      <div className="flex items-center gap-2 rounded-lg border border-white/[0.1] bg-[#141416] px-3">
                        <Search size={14} className="text-[#6c6c78]" />

                        <input
                          value={filterSearch}
                          onChange={(event) =>
                            setFilterSearch(event.target.value)
                          }
                          placeholder="Search URL or payload..."
                          className="h-9 min-w-0 flex-1 bg-transparent text-[12.5px] text-white outline-none placeholder:text-[#6c6c78]"
                        />

                        {(filterSearch ||
                          filterStatuses.size > 0 ||
                          filterMinLength ||
                          filterMaxLength ||
                          filterMinTime ||
                          filterMaxTime ||
                          showOnlyGrepMatches) && (
                          <button
                            type="button"
                            onClick={resetResultFilters}
                            title="Clear all filters"
                            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium text-[#9a9aa8] transition hover:bg-white/[0.06] hover:text-white"
                          >
                            <RotateCcw size={12} />
                            Clear
                          </button>
                        )}
                      </div>

                      {grepMatchRules.length > 0 && (
                        <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-[#9a9aa8]">
                          <input
                            type="checkbox"
                            checked={showOnlyGrepMatches}
                            onChange={(event) =>
                              setShowOnlyGrepMatches(event.target.checked)
                            }
                            className="h-3.5 w-3.5 accent-emerald-400"
                          />
                          Only show grep matches
                        </label>
                      )}

                      {statusFilterOptions.length > 0 && (
                        <div>
                          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#6c6c78]">
                            Status
                          </p>

                          <div className="flex flex-wrap gap-1.5">
                            {statusFilterOptions.map(([bucket, count]) => {
                              const numeric = Number(bucket);
                              const tone =
                                bucket === "error"
                                  ? "error"
                                  : numeric >= 500
                                    ? "error"
                                    : numeric >= 400
                                      ? "warn"
                                      : numeric >= 300
                                        ? "warn"
                                        : "success";

                              return (
                                <FilterChip
                                  key={bucket}
                                  label={
                                    bucket === "error" ? "Error" : bucket
                                  }
                                  count={count}
                                  active={filterStatuses.has(bucket)}
                                  tone={tone}
                                  onClick={() => toggleStatusFilter(bucket)}
                                />
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                        <div>
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#6c6c78]">
                            Min length
                          </p>
                          <input
                            type="number"
                            value={filterMinLength}
                            onChange={(event) =>
                              setFilterMinLength(event.target.value)
                            }
                            placeholder="0"
                            className={smallInputClass}
                          />
                        </div>

                        <div>
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#6c6c78]">
                            Max length
                          </p>
                          <input
                            type="number"
                            value={filterMaxLength}
                            onChange={(event) =>
                              setFilterMaxLength(event.target.value)
                            }
                            placeholder="∞"
                            className={smallInputClass}
                          />
                        </div>

                        <div>
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#6c6c78]">
                            Min time (ms)
                          </p>
                          <input
                            type="number"
                            value={filterMinTime}
                            onChange={(event) =>
                              setFilterMinTime(event.target.value)
                            }
                            placeholder="0"
                            className={smallInputClass}
                          />
                        </div>

                        <div>
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#6c6c78]">
                            Max time (ms)
                          </p>
                          <input
                            type="number"
                            value={filterMaxTime}
                            onChange={(event) =>
                              setFilterMaxTime(event.target.value)
                            }
                            placeholder="∞"
                            className={smallInputClass}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="overflow-hidden rounded-xl border border-white/[0.08]">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] text-left text-[12.5px]">
                      <thead className="border-b border-white/[0.07] bg-white/[0.025] text-[11px] uppercase tracking-wider text-[#8a8a98]">
                        <tr>
                          <th className="px-4 py-3 font-medium">#</th>
                          <th className="px-4 py-3 font-medium">Payload</th>
                          <th className="px-4 py-3 font-medium">URL</th>
                          <SortableTh
                            label="Status"
                            active={sortKey === "status"}
                            dir={sortDir}
                            onClick={() => toggleSort("status")}
                          />
                          <SortableTh
                            label="Length"
                            active={sortKey === "length"}
                            dir={sortDir}
                            onClick={() => toggleSort("length")}
                          />
                          <SortableTh
                            label="Time"
                            active={sortKey === "time"}
                            dir={sortDir}
                            onClick={() => toggleSort("time")}
                          />
                          {activeGrepExtractRules.map((rule, i) => (
                            <th
                              key={rule.id}
                              className="px-4 py-3 font-medium"
                              title={rule.pattern}
                            >
                              Extract {i + 1}
                            </th>
                          ))}
                          {grepMatchRules.length > 0 && (
                            <th className="px-4 py-3 font-medium">Grep</th>
                          )}
                        </tr>
                      </thead>

                      <tbody>
                        {sortedResults.length === 0 ? (
                          <tr>
                            <td
                              colSpan={
                                6 +
                                activeGrepExtractRules.length +
                                (grepMatchRules.length > 0 ? 1 : 0)
                              }
                              className="px-4 py-10 text-center text-[12.5px] text-[#777784]"
                            >
                              No results match the current filters.
                            </td>
                          </tr>
                        ) : (
                          sortedResults.map((result) => {
                            const selected =
                              selectedResultIndex === result.request_index;
                            const payloadLabel = payloadLabelFor(result);
                            const grepFired = whichGrepRulesMatch(
                              result,
                              grepMatchRules
                            );
                            const extracted = extractForRow(
                              result,
                              activeGrepExtractRules
                            );

                            return (
                              <tr
                                key={result.request_index}
                                onClick={() =>
                                  openResultModal(result.request_index)
                                }
                                className={`cursor-pointer border-b border-white/[0.05] transition hover:bg-white/[0.04] ${
                                  selected ? "bg-emerald-400/[0.06]" : ""
                                }`}
                              >
                                <td className="px-4 py-3 tabular-nums text-[#8a8a98]">
                                  {result.request_index}
                                </td>

                                <td
                                  className={`${mono.className} max-w-[200px] truncate px-4 py-3 text-[#9cd9bd]`}
                                  title={payloadLabel ?? undefined}
                                >
                                  {payloadLabel ?? "—"}
                                </td>

                                <td
                                  className="max-w-[240px] truncate px-4 py-3 text-[#c4c4ce]"
                                  title={result.url}
                                >
                                  {result.url || "—"}
                                </td>

                                <td className="px-4 py-3">
                                  {result.success ? (
                                    <span
                                      className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                                        result.status_code &&
                                        result.status_code < 300
                                          ? "bg-emerald-400/10 text-emerald-300"
                                          : result.status_code &&
                                              result.status_code < 400
                                            ? "bg-amber-400/10 text-amber-300"
                                            : "bg-red-400/10 text-red-300"
                                      }`}
                                    >
                                      {result.status_code ?? "—"}
                                    </span>
                                  ) : (
                                    <span className="rounded-md bg-red-400/10 px-2 py-1 text-[11px] font-semibold text-red-300">
                                      Error
                                    </span>
                                  )}
                                </td>

                                <td className="px-4 py-3 tabular-nums text-[#a1a1ad]">
                                  {result.size_raw ?? "—"}
                                </td>

                                <td className="px-4 py-3 tabular-nums text-[#a1a1ad]">
                                  {result.duration_ms?.toFixed(1) ?? "—"} ms
                                </td>

                                {activeGrepExtractRules.map((rule, i) => (
                                  <td
                                    key={rule.id}
                                    className={`${mono.className} max-w-[160px] truncate px-4 py-3 text-[#c8c8d4]`}
                                    title={extracted[i] || undefined}
                                  >
                                    {extracted[i] || "—"}
                                  </td>
                                ))}

                                {grepMatchRules.length > 0 && (
                                  <td className="px-4 py-3">
                                    {grepFired.length > 0 ? (
                                      <span
                                        className="inline-flex items-center gap-1 rounded-md bg-emerald-400/10 px-2 py-1 text-[11px] font-semibold text-emerald-300"
                                        title={grepFired.join("\n")}
                                      >
                                        <CheckCircle2 size={11} />
                                        {grepFired.length}
                                      </span>
                                    ) : (
                                      <span className="text-[11px] text-[#666672]">
                                        —
                                      </span>
                                    )}
                                  </td>
                                )}
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {!attackResults && !isRunning && !attackError && (
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.015] px-4 py-16 text-center">
                <Clock size={24} className="mx-auto text-[#555560]" />

                <p className="mt-3 text-[13px] font-medium text-[#a1a1ad]">
                  No results yet
                </p>

                <p className="mt-1 text-[12.5px] text-[#6c6c78]">
                  Configure your payloads and start an attack.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // -------------------------------------------------------
  // Page layout
  // -------------------------------------------------------

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex h-[54px] shrink-0 items-center gap-3.5 border-b border-white/[0.08] px-3 md:px-5">
        <h1 className="shrink-0 text-[16px] font-semibold tracking-tight text-white">
          Intruder
        </h1>

        <span className="shrink-0 rounded-full border border-white/10 px-2.5 py-0.5 text-[11px] font-medium text-[#8a8a98]">
          {positions.length} position{positions.length === 1 ? "" : "s"}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <div className="origin-right scale-[0.92]">
            <ListenerPill />
          </div>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Attack tabs"
        className="flex h-10 shrink-0 items-stretch gap-1 overflow-x-auto border-b border-white/[0.08] bg-[#0d0d0f] px-2 [scrollbar-width:none]"
      >
        {tabIds.map((id) => {
          const active = id === activeTabId;
          const record = intruderStore.tabs.find((tab) => tab.id === id);
          const title = tabTitle(
            active ? request : (record?.snapshot.request ?? "")
          );

          return (
            <div
              key={id}
              role="tab"
              aria-selected={active}
              className={`group flex shrink-0 items-stretch border-b-2 transition-colors ${
                active
                  ? "border-emerald-400 bg-white/[0.04]"
                  : "border-transparent hover:bg-white/[0.04]"
              }`}
            >
              <button
                type="button"
                onClick={() => switchTab(id)}
                disabled={isRunning && !active}
                title={isRunning && !active ? "Wait for the attack to finish" : title}
                className={`flex max-w-[220px] items-center gap-2 pl-3 pr-1 text-[12.5px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-40 ${
                  active ? "text-white" : "text-[#b5b5c2] hover:text-white"
                }`}
              >
                {active && isRunning && (
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
                )}
                <span className="truncate">{title}</span>
              </button>

              <button
                type="button"
                onClick={() => closeTab(id)}
                disabled={isRunning}
                title="Close tab"
                aria-label={`Close ${title}`}
                className="my-auto mr-1.5 rounded p-1 text-[#6c6c78] transition hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X size={13} />
              </button>
            </div>
          );
        })}

        <button
          type="button"
          onClick={openNewTab}
          disabled={isRunning}
          title="New attack tab"
          aria-label="New attack tab"
          className="my-auto ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#b5b5c2] transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={15} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ResizablePanels left={leftPanel} right={rightPanel} />
      </div>

      <div className="flex h-[60px] shrink-0 items-center justify-between gap-4 border-t border-white/[0.08] bg-[#0d0d0f] px-5">
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium text-[#c4c4ce]">
            {positions.length} marked position
            {positions.length === 1 ? "" : "s"}
          </p>

          <p className="mt-0.5 text-[12px] text-[#6c6c78]">
            {ATTACK_TYPES.find((attack) => attack.id === attackType)?.name}
            {attackResults
              ? ` · ${attackResults.total_requests} requests`
              : ""}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <span className="hidden items-center gap-2 text-[12px] text-[#6c6c78] sm:flex">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isRunning ? "animate-pulse bg-amber-400" : "bg-emerald-400"
              }`}
            />

            {isRunning ? "Attack running" : "Engine connected"}
          </span>

          <button
            type="button"
            onClick={handleStartAttack}
            disabled={isRunning || positions.length === 0}
            title={
              positions.length === 0
                ? "Mark at least one payload position first."
                : "Start Intruder attack"
            }
            className={`${btnPrimary} ${
              isRunning || positions.length === 0
                ? "!cursor-not-allowed !opacity-50"
                : ""
            }`}
          >
            {isRunning ? (
              <Loader2 size={14} className="mr-2 animate-spin" />
            ) : (
              <Play size={14} className="mr-2" />
            )}

            {isRunning ? "Running..." : "Start attack"}
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------
          Result modal: request / response inspector
          --------------------------------------------------- */}

      {resultModalOpen && selectedResult && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-2 backdrop-blur-sm sm:p-4"
          onClick={closeResultModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Request ${selectedResult.request_index} details`}
            onClick={(event) => event.stopPropagation()}
            className="flex h-[92vh] w-full max-w-[1600px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d0f] shadow-2xl shadow-black/70"
          >
            {/* Header: identity, metrics, navigation */}
            <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/[0.08] bg-[#111113] px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                {selectedResult.success ? (
                  <CheckCircle2
                    size={16}
                    className={
                      selectedResult.status_code &&
                      selectedResult.status_code < 400
                        ? "shrink-0 text-emerald-400"
                        : "shrink-0 text-amber-400"
                    }
                  />
                ) : (
                  <AlertCircle size={16} className="shrink-0 text-red-400" />
                )}

                <span className="whitespace-nowrap text-[14px] font-semibold text-white">
                  Request #{selectedResult.request_index}
                </span>

                <span
                  className={`${mono.className} inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium ${statusChipClasses(
                    selectedResult
                  )}`}
                >
                  {selectedResult.success
                    ? `${selectedResult.status_code ?? "—"} ${
                        selectedResult.reason ?? ""
                      }`.trim()
                    : "Error"}
                </span>
              </div>

              <div className="flex min-w-0 flex-1 items-center gap-2">
                {selectedResult.method && (
                  <span className="shrink-0 rounded-md bg-white/[0.06] px-2 py-0.5 text-[10.5px] font-bold text-emerald-300">
                    {selectedResult.method}
                  </span>
                )}

                <span
                  className={`${mono.className} min-w-0 truncate text-[12px] text-[#9a9aa8]`}
                  title={selectedResult.url}
                >
                  {selectedResult.url ?? "—"}
                </span>

                {selectedResult.url && (
                  <button
                    type="button"
                    onClick={() =>
                      copyWithFeedback("url", selectedResult.url ?? "")
                    }
                    title="Copy URL"
                    aria-label="Copy URL"
                    className="shrink-0 rounded p-1 text-[#6c6c78] transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                  >
                    {copiedKey === "url" ? (
                      <Check size={13} className="text-emerald-300" />
                    ) : (
                      <Copy size={13} />
                    )}
                  </button>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1 border-l border-white/[0.08] pl-4">
                <button
                  type="button"
                  onClick={() => stepResultModal(-1)}
                  disabled={selectedResultPosition <= 0}
                  title="Previous result (←)"
                  aria-label="Previous result"
                  className="rounded-md p-1.5 text-[#8a8a98] transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronLeft size={16} />
                </button>

                <span className="min-w-[64px] text-center text-[11.5px] tabular-nums text-[#6c6c78]">
                  {selectedResultPosition + 1} / {sortedResults.length}
                </span>

                <button
                  type="button"
                  onClick={() => stepResultModal(1)}
                  disabled={
                    selectedResultPosition === -1 ||
                    selectedResultPosition >= sortedResults.length - 1
                  }
                  title="Next result (→)"
                  aria-label="Next result"
                  className="rounded-md p-1.5 text-[#8a8a98] transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronRight size={16} />
                </button>

                <button
                  type="button"
                  onClick={closeResultModal}
                  title="Close (Esc)"
                  aria-label="Close"
                  className="ml-1.5 rounded-md p-1.5 text-[#8a8a98] transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Metric strip */}
            <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-white/[0.08] bg-[#0f0f11] px-4 py-2 text-[11.5px] text-[#8a8a98]">
              <span className="inline-flex items-center gap-1.5">
                Payload
                <span
                  className={`${mono.className} max-w-[320px] truncate rounded bg-white/[0.05] px-1.5 py-0.5 text-[#9cd9bd]`}
                  title={modalPayloadLabel ?? undefined}
                >
                  {modalPayloadLabel ?? "—"}
                </span>
              </span>

              <span>
                Length{" "}
                <span className="tabular-nums text-[#c4c4ce]">
                  {selectedResult.size_raw ?? "—"} B
                </span>
              </span>

              {selectedResult.size_decoded != null &&
                selectedResult.size_decoded !== selectedResult.size_raw && (
                  <span>
                    Decoded{" "}
                    <span className="tabular-nums text-[#c4c4ce]">
                      {selectedResult.size_decoded} B
                    </span>
                  </span>
                )}

              <span>
                Time{" "}
                <span className="tabular-nums text-[#c4c4ce]">
                  {selectedResult.duration_ms?.toFixed(1) ?? "—"} ms
                </span>
              </span>

              {modalGrepFired.length > 0 && (
                <span
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-400/10 px-2 py-0.5 font-semibold text-emerald-300"
                  title={modalGrepFired.join("\n")}
                >
                  <CheckCircle2 size={11} />
                  {modalGrepFired.length} grep match
                  {modalGrepFired.length === 1 ? "" : "es"}
                </span>
              )}

              {selectedResult.decode_error && (
                <span className="text-amber-300">
                  Decode warning: {selectedResult.decode_error}
                </span>
              )}
            </div>

            {/* Toolbar: actions + layout */}
            <div
              role="toolbar"
              aria-label="Result tools"
              className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b border-white/[0.08] bg-[#0d0d0f] px-2 py-1.5"
            >
              <ModalToolButton
                icon={PanelLeft}
                label="Results"
                title="Show or hide the results list"
                active={modalSidebarOpen}
                onClick={() => setModalSidebarOpen((value) => !value)}
              />

              <span className="hidden h-5 w-px bg-white/[0.08] sm:block" />

              <ModalToolButton
                icon={Repeat2}
                label="Repeater"
                disabled={!selectedResult.url}
                title={
                  selectedResult.url
                    ? "Send this request to Repeater (Ctrl/Cmd+R)"
                    : "This request cannot be sent to Repeater"
                }
                onClick={handleSendToRepeater}
              />

              <ModalToolButton
                icon={Sparkles}
                label="Ask AI"
                title="Ask Gemini AI about this request and response"
                onClick={handleAskAi}
              />

              <div className="ml-auto flex items-center gap-2 pr-1">
                <span className="hidden text-[11px] text-[#6c6c78] md:inline">
                  Layout
                </span>
                <MiniSegmented
                  label="Layout"
                  options={MODAL_LAYOUTS}
                  value={modalLayout}
                  onChange={changeModalLayout}
                />
              </div>
            </div>

            {/* Body: results list + panes */}
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {modalSidebarOpen && (
                <aside
                  aria-label="Attack results"
                  className="hidden w-[270px] shrink-0 flex-col border-r border-white/[0.08] bg-[#0c0c0e] lg:flex"
                >
                  <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#777783]">
                    <span>Payload</span>
                    <span>Status · Length</span>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:#3a3a44_transparent] [scrollbar-width:thin]">
                    {sortedResults.map((result) => {
                      const active =
                        result.request_index === selectedResultIndex;
                      const label = payloadLabelFor(result);

                      return (
                        <button
                          key={result.request_index}
                          type="button"
                          data-modal-row={result.request_index}
                          onClick={() =>
                            setSelectedResultIndex(result.request_index)
                          }
                          aria-current={active ? "true" : undefined}
                          className={`flex w-full items-center gap-2 border-b border-l-2 border-b-white/[0.04] px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:bg-emerald-400/[0.06] ${
                            active
                              ? "border-l-emerald-400 bg-emerald-400/[0.07]"
                              : "border-l-transparent hover:bg-white/[0.035]"
                          }`}
                        >
                          <span className="w-7 shrink-0 text-[11px] tabular-nums text-[#6c6c78]">
                            {result.request_index}
                          </span>

                          <span
                            className={`${mono.className} min-w-0 flex-1 truncate text-[12px] text-[#9cd9bd]`}
                            title={label ?? undefined}
                          >
                            {label ?? "—"}
                          </span>

                          <span
                            className={`${mono.className} shrink-0 rounded border px-1 py-px text-[10.5px] ${statusChipClasses(
                              result
                            )}`}
                          >
                            {result.success
                              ? (result.status_code ?? "—")
                              : "ERR"}
                          </span>

                          <span className="w-12 shrink-0 text-right text-[10.5px] tabular-nums text-[#777784]">
                            {result.size_raw ?? "—"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </aside>
              )}

              <div
                ref={modalPanesRef}
                className={`flex min-h-0 min-w-0 flex-1 overflow-hidden ${
                  modalStacked ? "flex-col" : "flex-col md:flex-row"
                } ${
                  modalDragging
                    ? modalStacked
                      ? "cursor-row-resize select-none"
                      : "cursor-col-resize select-none"
                    : ""
                }`}
              >
                {modalLayout !== "response" && (
                  <div
                    onMouseEnter={() => {
                      hoveredPane.current = "request";
                    }}
                    style={modalShowsBoth ? firstPaneStyle : undefined}
                    className={
                      modalShowsBoth
                        ? modalStacked
                          ? "min-h-0 min-w-0 shrink-0 grow-0 basis-[var(--p)]"
                          : "min-h-0 min-w-0 flex-1 md:flex-none md:shrink-0 md:grow-0 md:basis-[var(--p)]"
                        : "min-h-0 min-w-0 flex-1"
                    }
                  >
                    {requestPane}
                  </div>
                )}

                {modalShowsBoth && (
                  <div
                    role="separator"
                    aria-orientation={
                      modalStacked ? "horizontal" : "vertical"
                    }
                    aria-label="Resize request and response panels"
                    title="Drag to resize · double-click to reset"
                    onPointerDown={onModalDividerDown}
                    onPointerMove={onModalDividerMove}
                    onPointerUp={onModalDividerUp}
                    onPointerCancel={onModalDividerUp}
                    onDoubleClick={() => setModalSplit(MODAL_SPLIT_DEFAULT)}
                    className={`group relative z-10 shrink-0 touch-none select-none items-center justify-center ${
                      modalStacked
                        ? "flex h-[7px] w-full cursor-row-resize"
                        : "hidden w-[7px] cursor-col-resize md:flex"
                    } ${
                      modalDragging
                        ? "bg-emerald-400/20"
                        : "bg-[#0b0b0d] hover:bg-emerald-400/10"
                    } transition-colors`}
                  >
                    <div
                      className={`rounded-full transition-colors ${
                        modalStacked ? "h-[2px] w-12" : "h-12 w-[2px]"
                      } ${
                        modalDragging
                          ? "bg-emerald-400"
                          : "bg-white/[0.16] group-hover:bg-emerald-400/70"
                      }`}
                    />
                  </div>
                )}

                {modalLayout !== "request" && (
                  <div
                    onMouseEnter={() => {
                      hoveredPane.current = "response";
                    }}
                    className={`min-h-0 min-w-0 flex-1 ${
                      modalLayout === "split"
                        ? "border-t border-white/[0.08] md:border-t-0"
                        : ""
                    }`}
                  >
                    {responsePane}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
