'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import {
  Copy, Check, ArrowLeftRight, Trash2, Play, X,
  Search, AlertCircle, History, RotateCcw, Sparkles,
  Code2, Wand2, Binary, FileCode2, Braces, Link2,
  Package, ChevronDown, Lock, Unlock, CornerDownLeft,
  Repeat, ArrowLeft,
} from 'lucide-react';

// ─── Fonts ───────────────────────────────────────────────────────────────────

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
});

// ─── Types ───────────────────────────────────────────────────────────────────

type Mode = 'encode' | 'decode';

type Operation =
  | 'base64-encode' | 'base64-decode'
  | 'base64url-encode' | 'base64url-decode'
  | 'url-encode' | 'url-decode'
  | 'uricomponent-encode' | 'uricomponent-decode'
  | 'uri-encode' | 'uri-decode'
  | 'html-encode' | 'html-decode'
  | 'js-escape' | 'js-unescape'
  | 'unicode-escape' | 'unicode-unescape'
  | 'hex-encode' | 'hex-decode'
  | 'binary-encode' | 'binary-decode'
  | 'rot13'
  | 'gzip-compress' | 'gzip-decompress'
  | 'deflate-compress' | 'deflate-decompress';

interface HistoryEntry {
  id: string; operation: Operation; label: string;
  input: string; output: string; timestamp: number; times: number;
}

// ─── Operation catalog ───────────────────────────────────────────────────────

interface OpDef {
  value: Operation;
  label: string;
  short: string;
  mode: Mode | 'both';
  group: string;
  inverse?: Operation;
}

const CATALOG: OpDef[] = [
  { value: 'base64-encode', label: 'Base64 Encode', short: 'Base64', mode: 'encode', group: 'Base64', inverse: 'base64-decode' },
  { value: 'base64-decode', label: 'Base64 Decode', short: 'Base64', mode: 'decode', group: 'Base64', inverse: 'base64-encode' },
  { value: 'base64url-encode', label: 'Base64 URL-safe Encode', short: 'Base64 URL', mode: 'encode', group: 'Base64', inverse: 'base64url-decode' },
  { value: 'base64url-decode', label: 'Base64 URL-safe Decode', short: 'Base64 URL', mode: 'decode', group: 'Base64', inverse: 'base64url-encode' },
  { value: 'url-encode', label: 'URL Encode', short: 'URL', mode: 'encode', group: 'URL', inverse: 'url-decode' },
  { value: 'url-decode', label: 'URL Decode', short: 'URL', mode: 'decode', group: 'URL', inverse: 'url-encode' },
  { value: 'uricomponent-encode', label: 'Encode URI Component', short: 'URI Component', mode: 'encode', group: 'URL', inverse: 'uricomponent-decode' },
  { value: 'uricomponent-decode', label: 'Decode URI Component', short: 'URI Component', mode: 'decode', group: 'URL', inverse: 'uricomponent-encode' },
  { value: 'uri-encode', label: 'Encode URI', short: 'URI', mode: 'encode', group: 'URL', inverse: 'uri-decode' },
  { value: 'uri-decode', label: 'Decode URI', short: 'URI', mode: 'decode', group: 'URL', inverse: 'uri-encode' },
  { value: 'html-encode', label: 'HTML Entity Encode', short: 'HTML', mode: 'encode', group: 'HTML', inverse: 'html-decode' },
  { value: 'html-decode', label: 'HTML Entity Decode', short: 'HTML', mode: 'decode', group: 'HTML', inverse: 'html-encode' },
  { value: 'js-escape', label: 'JavaScript Escape', short: 'JS Escape', mode: 'encode', group: 'JavaScript', inverse: 'js-unescape' },
  { value: 'js-unescape', label: 'JavaScript Unescape', short: 'JS Escape', mode: 'decode', group: 'JavaScript', inverse: 'js-escape' },
  { value: 'unicode-escape', label: 'Unicode Escape', short: 'Unicode', mode: 'encode', group: 'JavaScript', inverse: 'unicode-unescape' },
  { value: 'unicode-unescape', label: 'Unicode Unescape', short: 'Unicode', mode: 'decode', group: 'JavaScript', inverse: 'unicode-escape' },
  { value: 'hex-encode', label: 'Hex Encode', short: 'Hex', mode: 'encode', group: 'Hex', inverse: 'hex-decode' },
  { value: 'hex-decode', label: 'Hex Decode', short: 'Hex', mode: 'decode', group: 'Hex', inverse: 'hex-encode' },
  { value: 'binary-encode', label: 'Binary Encode', short: 'Binary', mode: 'encode', group: 'Binary', inverse: 'binary-decode' },
  { value: 'binary-decode', label: 'Binary Decode', short: 'Binary', mode: 'decode', group: 'Binary', inverse: 'binary-encode' },
  { value: 'rot13', label: 'ROT13', short: 'ROT13', mode: 'both', group: 'Text' },
  { value: 'gzip-compress', label: 'Gzip Compress', short: 'Gzip', mode: 'encode', group: 'Compression', inverse: 'gzip-decompress' },
  { value: 'gzip-decompress', label: 'Gzip Decompress', short: 'Gzip', mode: 'decode', group: 'Compression', inverse: 'gzip-compress' },
  { value: 'deflate-compress', label: 'Deflate Compress', short: 'Deflate', mode: 'encode', group: 'Compression', inverse: 'deflate-decompress' },
  { value: 'deflate-decompress', label: 'Deflate Decompress', short: 'Deflate', mode: 'decode', group: 'Compression', inverse: 'deflate-compress' },
];

const OP_BY_VALUE = new Map<Operation, OpDef>(CATALOG.map((o) => [o.value, o]));
const OP_LABEL = new Map<Operation, string>(CATALOG.map((o) => [o.value, o.label]));

const GROUP_ORDER = ['Base64', 'URL', 'HTML', 'JavaScript', 'Hex', 'Binary', 'Text', 'Compression'];

const GROUP_ICONS: Record<string, React.ReactNode> = {
  Base64: <Binary size={14} />,
  URL: <Link2 size={14} />,
  HTML: <FileCode2 size={14} />,
  JavaScript: <Braces size={14} />,
  Hex: <Code2 size={14} />,
  Binary: <Binary size={14} />,
  Text: <Wand2 size={14} />,
  Compression: <Package size={14} />,
};

function opsForMode(mode: Mode): OpDef[] {
  return CATALOG.filter((o) => o.mode === mode || o.mode === 'both');
}

function groupedOpsForMode(mode: Mode): { group: string; ops: OpDef[]; icon: React.ReactNode }[] {
  const inMode = opsForMode(mode);
  const map = new Map<string, OpDef[]>();
  for (const o of inMode) {
    if (!map.has(o.group)) map.set(o.group, []);
    map.get(o.group)!.push(o);
  }
  return GROUP_ORDER
    .filter((g) => map.has(g))
    .map((g) => ({ group: g, ops: map.get(g)!, icon: GROUP_ICONS[g] }));
}

// ─── Byte helpers ────────────────────────────────────────────────────────────

function bytesToBinaryString(bytes: Uint8Array): string {
  let result = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    result += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return result;
}
function binaryStringToBytes(bin: string): Uint8Array {
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

// ─── Codecs ──────────────────────────────────────────────────────────────────

function base64Encode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  return btoa(bytesToBinaryString(bytes));
}
function base64Decode(input: string): string {
  const normalized = input.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) throw new Error('Invalid Base64: illegal characters');
  if (normalized.length % 4 === 1) throw new Error('Invalid Base64: invalid length');
  const binary = atob(normalized);
  return new TextDecoder('utf-8', { fatal: true }).decode(binaryStringToBytes(binary));
}
function base64UrlEncode(input: string): string {
  return base64Encode(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlDecode(input: string): string {
  let b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  return base64Decode(b64);
}
function htmlEncode(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '\u00a9',
  reg: '\u00ae', trade: '\u2122', hellip: '\u2026', mdash: '\u2014', ndash: '\u2013',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', bull: '\u2022',
  deg: '\u00b0', plusmn: '\u00b1', times: '\u00d7', divide: '\u00f7', euro: '\u20ac',
  pound: '\u00a3', yen: '\u00a5', cent: '\u00a2', sect: '\u00a7', para: '\u00b6',
  middot: '\u00b7', laquo: '\u00ab', raquo: '\u00bb',
};
function htmlDecode(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = parseInt(entity.slice(2), 16);
      if (isNaN(code) || code < 0 || code > 0x10ffff) return match;
      return String.fromCodePoint(code);
    }
    if (entity.startsWith('#')) {
      const code = parseInt(entity.slice(1), 10);
      if (isNaN(code) || code < 0 || code > 0x10ffff) return match;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}
function jsEscape(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t').replace(/\b/g, '\\b').replace(/\f/g, '\\f')
    .replace(/"/g, '\\"').replace(/'/g, "\\'");
}
function jsUnescape(input: string): string {
  return input.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)/g, (match, seq: string) => {
    if (seq.startsWith('x') && seq.length === 3) {
      const code = parseInt(seq.slice(1), 16);
      return isNaN(code) ? match : String.fromCharCode(code);
    }
    if (seq.startsWith('u') && seq.length === 5) {
      const code = parseInt(seq.slice(1), 16);
      return isNaN(code) ? match : String.fromCharCode(code);
    }
    const map: Record<string, string> = {
      n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v',
      '0': '\0', '\\': '\\', '"': '"', "'": "'",
    };
    return map[seq] ?? match;
  });
}
function unicodeEscape(input: string): string {
  let result = '';
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    result += code > 0x7e || code < 0x20
      ? '\\u' + code.toString(16).padStart(4, '0')
      : input[i];
  }
  return result;
}
function unicodeUnescape(input: string): string {
  return input.replace(/\\u([0-9a-fA-F]{4})/g, (match, hex: string) => {
    const code = parseInt(hex, 16);
    return isNaN(code) ? match : String.fromCharCode(code);
  });
}
function hexEncode(input: string): string {
  return Array.from(new TextEncoder().encode(input)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function hexDecode(input: string): string {
  const cleaned = input.replace(/[\s:,-]/g, '');
  if (!/^[0-9a-fA-F]*$/.test(cleaned)) throw new Error('Invalid hex: non-hex characters');
  if (cleaned.length % 2 !== 0) throw new Error('Invalid hex: odd length');
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < cleaned.length; i += 2) bytes[i / 2] = parseInt(cleaned.slice(i, i + 2), 16);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
function binaryEncode(input: string): string {
  return Array.from(new TextEncoder().encode(input)).map((b) => b.toString(2).padStart(8, '0')).join(' ');
}
function binaryDecode(input: string): string {
  const cleaned = input.replace(/\s/g, '');
  if (!/^[01]*$/.test(cleaned)) throw new Error('Invalid binary: only 0/1 allowed');
  if (cleaned.length % 8 !== 0) throw new Error('Invalid binary: length must be multiple of 8');
  const bytes = new Uint8Array(cleaned.length / 8);
  for (let i = 0; i < cleaned.length; i += 8) bytes[i / 8] = parseInt(cleaned.slice(i, i + 8), 2);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
function rot13(input: string): string {
  return input.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

// ─── Compression ─────────────────────────────────────────────────────────────

async function compressWithStream(input: string, format: 'gzip' | 'deflate'): Promise<string> {
  if (typeof CompressionStream === 'undefined') throw new Error('CompressionStream unsupported');
  const bytes = new TextEncoder().encode(input);
  const stream = new Blob([toArrayBuffer(bytes)]).stream().pipeThrough(new CompressionStream(format));
  const compressed = await new Response(stream).arrayBuffer();
  // Raw bytes -> binary string -> Base64 (no lossy text decoding in between)
  return btoa(bytesToBinaryString(new Uint8Array(compressed)));
}
async function decompressWithStream(input: string, format: 'gzip' | 'deflate'): Promise<string> {
  if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream unsupported');
  let rawBytes: Uint8Array;
  try { rawBytes = binaryStringToBytes(atob(input.replace(/\s/g, ''))); }
  catch { throw new Error('Input must be Base64-encoded compressed data'); }
  const stream = new Blob([toArrayBuffer(rawBytes)]).stream().pipeThrough(new DecompressionStream(format));
  const decompressed = await new Response(stream).arrayBuffer();
  return new TextDecoder('utf-8', { fatal: true }).decode(decompressed);
}

async function applyOperation(op: Operation, input: string): Promise<string> {
  switch (op) {
    case 'base64-encode': return base64Encode(input);
    case 'base64-decode': return base64Decode(input);
    case 'base64url-encode': return base64UrlEncode(input);
    case 'base64url-decode': return base64UrlDecode(input);
    case 'url-encode': return encodeURIComponent(input);
    case 'url-decode': return decodeURIComponent(input);
    case 'uricomponent-encode': return encodeURIComponent(input);
    case 'uricomponent-decode': return decodeURIComponent(input);
    case 'uri-encode': return encodeURI(input);
    case 'uri-decode': return decodeURI(input);
    case 'html-encode': return htmlEncode(input);
    case 'html-decode': return htmlDecode(input);
    case 'js-escape': return jsEscape(input);
    case 'js-unescape': return jsUnescape(input);
    case 'unicode-escape': return unicodeEscape(input);
    case 'unicode-unescape': return unicodeUnescape(input);
    case 'hex-encode': return hexEncode(input);
    case 'hex-decode': return hexDecode(input);
    case 'binary-encode': return binaryEncode(input);
    case 'binary-decode': return binaryDecode(input);
    case 'rot13': return rot13(input);
    case 'gzip-compress': return compressWithStream(input, 'gzip');
    case 'gzip-decompress': return decompressWithStream(input, 'gzip');
    case 'deflate-compress': return compressWithStream(input, 'deflate');
    case 'deflate-decompress': return decompressWithStream(input, 'deflate');
    default: throw new Error(`Unknown operation: ${String(op)}`);
  }
}

// ─── Detection ───────────────────────────────────────────────────────────────

interface DetectionResult {
  format: string; confidence: 'high' | 'medium' | 'low';
  decodeOp: Operation; preview: string;
}
function detectFormats(input: string): DetectionResult[] {
  const results: DetectionResult[] = [];
  const trimmed = input.trim();
  if (!trimmed) return results;

  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length % 4 === 0 && trimmed.length >= 4) {
    try {
      const decoded = base64Decode(trimmed);
      results.push({ format: 'Base64', confidence: 'high', decodeOp: 'base64-decode', preview: decoded.slice(0, 80) });
    } catch { /* noop */ }
  }
  if (/^[A-Za-z0-9\-_]+$/.test(trimmed) && trimmed.length >= 4) {
    try {
      const decoded = base64UrlDecode(trimmed);
      results.push({ format: 'Base64 URL-safe', confidence: 'medium', decodeOp: 'base64url-decode', preview: decoded.slice(0, 80) });
    } catch { /* noop */ }
  }
  if (/%[0-9a-fA-F]{2}/.test(trimmed)) {
    try {
      const decoded = decodeURIComponent(trimmed);
      results.push({ format: 'URL-encoded', confidence: 'high', decodeOp: 'url-decode', preview: decoded.slice(0, 80) });
    } catch { /* noop */ }
  }
  const hexClean = trimmed.replace(/[\s:,-]/g, '');
  if (/^[0-9a-fA-F]+$/.test(hexClean) && hexClean.length % 2 === 0 && hexClean.length >= 2) {
    try {
      const decoded = hexDecode(hexClean);
      results.push({ format: 'Hexadecimal', confidence: 'high', decodeOp: 'hex-decode', preview: decoded.slice(0, 80) });
    } catch { /* noop */ }
  }
  const binClean = trimmed.replace(/\s/g, '');
  if (/^[01]+$/.test(binClean) && binClean.length % 8 === 0 && binClean.length >= 8) {
    try {
      const decoded = binaryDecode(binClean);
      results.push({ format: 'Binary', confidence: 'high', decodeOp: 'binary-decode', preview: decoded.slice(0, 80) });
    } catch { /* noop */ }
  }
  return results;
}

function getCounts(text: string) {
  const chars = text.length;
  let bytes = chars;
  try { bytes = new TextEncoder().encode(text).length; } catch { /* noop */ }
  return { chars, bytes };
}

const CONFIDENCE_STYLES: Record<string, string> = {
  high: 'border-emerald-400/25 bg-emerald-400/[0.1] text-emerald-300',
  medium: 'border-sky-400/25 bg-sky-400/[0.08] text-sky-300',
  low: 'border-amber-400/25 bg-amber-400/[0.08] text-amber-300',
};

// ─── Shared style tokens (match the rest of PacketSniffer) ───────────────────

const PANEL = 'rounded-2xl border border-white/[0.08] bg-[#141416]';
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60';
const ICON_BTN =
  `rounded-md p-1.5 text-[#858592] transition hover:bg-white/[0.08] hover:text-white ${FOCUS_RING}`;
const GHOST_BTN =
  `inline-flex h-9 items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3.5 text-xs font-medium text-[#c4c4ce] transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`;

// ─── Floating menu (portal, fixed position) ──────────────────────────────────

interface MenuPos { top: number; left: number; width: number; placement: 'down' | 'up' }

function useFloatingMenu(open: boolean, triggerRef: React.RefObject<HTMLElement | null>, minWidth = 280) {
  const [pos, setPos] = useState<MenuPos | null>(null);

  const measure = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const margin = 8;
    const spaceBelow = vh - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const placement: 'down' | 'up' = spaceBelow >= 260 || spaceBelow >= spaceAbove ? 'down' : 'up';
    const width = Math.max(minWidth, rect.width);
    let left = rect.left;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin);
    }
    setPos({
      top: placement === 'down' ? rect.bottom + 6 : rect.top - 6,
      left,
      width,
      placement,
    });
  }, [triggerRef, minWidth]);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    measure();
    const onScroll = () => measure();
    const onResize = () => measure();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, measure]);

  return pos;
}

function FloatingMenu({
  triggerRef, open, onClose, minWidth, children,
}: {
  triggerRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  minWidth?: number;
  children: React.ReactNode;
}) {
  const pos = useFloatingMenu(open, triggerRef, minWidth);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      const menuEl = document.getElementById('__floating_menu__');
      if (menuEl?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, triggerRef]);

  if (!open || !pos) return null;

  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const maxH = pos.placement === 'down'
    ? Math.min(vh * 0.72, vh - pos.top - 12)
    : Math.min(vh * 0.72, pos.top - 12);

  return createPortal(
    <div
      id="__floating_menu__"
      className={`${sans.className} fixed z-[9999] flex flex-col overflow-hidden rounded-xl border border-white/[0.1] bg-[#1c1c20] shadow-2xl shadow-black/60`}
      style={{
        top: pos.placement === 'down' ? pos.top : undefined,
        bottom: pos.placement === 'up' ? vh - pos.top : undefined,
        left: pos.left,
        width: pos.width,
        maxHeight: maxH,
      }}
      role="listbox"
    >
      {children}
    </div>,
    document.body
  );
}

function ScrollArea({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-0 overflow-y-auto
        [scrollbar-width:thin]
        [scrollbar-color:rgba(255,255,255,0.14)_transparent]
        [&::-webkit-scrollbar]:w-2
        [&::-webkit-scrollbar-track]:bg-transparent
        [&::-webkit-scrollbar-thumb]:rounded-full
        [&::-webkit-scrollbar-thumb]:bg-white/[0.14]
        [&::-webkit-scrollbar-thumb:hover]:bg-white/[0.24]"
    >
      {children}
    </div>
  );
}

function MenuHeader({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-white/[0.07] px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#8a8a98]">
      <span className="text-[#6c6c78]">{icon}</span>
      {children}
    </div>
  );
}

// ─── Repeat-count dropdown ───────────────────────────────────────────────────

function RepeatDropdown({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex h-10 min-w-[132px] items-center gap-2 rounded-xl border bg-[#0f0f11] pl-3 pr-2.5 text-[13px] font-medium transition ${FOCUS_RING}
          ${open
            ? 'border-emerald-400/40 text-emerald-200'
            : 'border-white/[0.1] text-[#d4d4dc] hover:border-white/[0.18]'
          }`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Repeat count: ${value}`}
      >
        <Repeat size={14} className="text-[#6c6c78]" />
        <span className="flex-1 text-left tabular-nums">Repeat ×{value}</span>
        <ChevronDown
          size={14}
          className={`transition-transform duration-150 motion-reduce:transition-none ${
            open ? 'rotate-180 text-emerald-400' : 'text-[#6c6c78]'
          }`}
        />
      </button>

      <FloatingMenu triggerRef={btnRef} open={open} onClose={() => setOpen(false)} minWidth={200}>
        <MenuHeader icon={<Repeat size={11} />}>Repeat count</MenuHeader>
        <ScrollArea>
          <div className="py-1">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
              const active = n === value;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => { onChange(n); setOpen(false); }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors
                    ${active
                      ? 'bg-emerald-400/[0.1] text-emerald-300'
                      : 'text-[#c4c4ce] hover:bg-white/[0.06] hover:text-white'
                    }`}
                  role="option"
                  aria-selected={active}
                >
                  <span className="w-8 text-right font-semibold tabular-nums text-[#e5e5ec]">{n}×</span>
                  <span className="flex-1 text-[#8a8a98]">
                    {n === 1 ? 'single' : n === 2 ? 'double' : n === 3 ? 'triple' : `${n} times`}
                  </span>
                  {active && <Check size={13} className="shrink-0 text-emerald-400" />}
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </FloatingMenu>
    </>
  );
}

// ─── Operation chips (single-op plain / multi-op dropdown) ───────────────────

interface TabGroup {
  group: string;
  ops: OpDef[];
  icon: React.ReactNode;
}

const CHIP_BASE = `inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-xs font-medium transition ${FOCUS_RING}`;
const CHIP_ACTIVE = 'border-emerald-400/30 bg-emerald-400/[0.1] text-emerald-300';
const CHIP_IDLE =
  'border-white/[0.1] bg-white/[0.04] text-[#c4c4ce] hover:bg-white/[0.08] hover:text-white';

function OpTabs({
  groups, selectedOp, variantByGroup, onSelect,
}: {
  groups: TabGroup[];
  selectedOp: Operation;
  variantByGroup: Record<string, Operation>;
  onSelect: (op: Operation) => void;
}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  return (
    <div
      role="group"
      aria-label="Operation"
      className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none]"
    >
      {groups.map(({ group, ops, icon }) => {
        const activeInGroup = ops.some((o) => o.value === selectedOp);
        const single = ops.length === 1;

        if (single) {
          const only = ops[0];
          return (
            <button
              key={group}
              type="button"
              onClick={() => { onSelect(only.value); setOpenGroup(null); }}
              title={only.label}
              aria-pressed={activeInGroup}
              className={`${CHIP_BASE} ${activeInGroup ? CHIP_ACTIVE : CHIP_IDLE}`}
            >
              <span className={activeInGroup ? 'text-emerald-400' : 'text-[#6c6c78]'}>{icon}</span>
              {group}
            </button>
          );
        }

        const remembered = variantByGroup[group] ?? ops[0].value;
        const displayLabel = OP_BY_VALUE.get(remembered)?.short ?? group;
        const isOpen = openGroup === group;

        return (
          <MultiTab
            key={group}
            group={group}
            ops={ops}
            icon={icon}
            activeInGroup={activeInGroup}
            displayLabel={displayLabel}
            isOpen={isOpen}
            selectedOp={selectedOp}
            onOpenChange={(o) => setOpenGroup(o ? group : null)}
            onSelect={(op) => { onSelect(op); setOpenGroup(null); }}
          />
        );
      })}
    </div>
  );
}

function MultiTab({
  group, ops, icon, activeInGroup, displayLabel, isOpen, selectedOp, onOpenChange, onSelect,
}: {
  group: string;
  ops: OpDef[];
  icon: React.ReactNode;
  activeInGroup: boolean;
  displayLabel: string;
  isOpen: boolean;
  selectedOp: Operation;
  onOpenChange: (open: boolean) => void;
  onSelect: (op: Operation) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => onOpenChange(!isOpen)}
        title={group}
        className={`${CHIP_BASE} ${activeInGroup ? CHIP_ACTIVE : CHIP_IDLE}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className={activeInGroup ? 'text-emerald-400' : 'text-[#6c6c78]'}>{icon}</span>
        {displayLabel}
        <ChevronDown
          size={12}
          className={`transition-transform duration-150 motion-reduce:transition-none ${
            isOpen ? 'rotate-180' : ''
          } ${activeInGroup ? 'text-emerald-400' : 'text-[#6c6c78]'}`}
        />
      </button>

      <FloatingMenu triggerRef={btnRef} open={isOpen} onClose={() => onOpenChange(false)} minWidth={260}>
        <MenuHeader icon={icon}>{group}</MenuHeader>
        <ScrollArea>
          <div className="py-1">
            {ops.map((o) => {
              const active = o.value === selectedOp;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => onSelect(o.value)}
                  className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] transition-colors
                    ${active
                      ? 'bg-emerald-400/[0.1] text-emerald-300'
                      : 'text-[#c4c4ce] hover:bg-white/[0.06] hover:text-white'
                    }`}
                  role="option"
                  aria-selected={active}
                >
                  <span className="flex-1">{o.label}</span>
                  {active && <Check size={13} className="shrink-0 text-emerald-400" />}
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </FloatingMenu>
    </>
  );
}

// ─── Editor panel (shared by Input and Output) ───────────────────────────────

function EditorPanel({
  label, tone, counts, value, onChange, onKeyDown, placeholder, readOnlyHint,
  actions, footer,
}: {
  label: string;
  tone: 'input' | 'output';
  counts: { chars: number; bytes: number };
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  readOnlyHint?: string;
  actions: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <section
      className={`${PANEL} flex h-[clamp(320px,52vh,640px)] min-w-0 flex-col overflow-hidden lg:flex-1`}
    >
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/[0.07] px-4">
        <span
          className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[11px] font-semibold ${
            tone === 'output'
              ? 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300'
              : 'border-white/[0.1] bg-white/[0.05] text-[#c4c4ce]'
          }`}
        >
          {label}
        </span>
        <span className="truncate text-[11.5px] tabular-nums text-[#6c6c78]">
          {counts.chars.toLocaleString()} chars · {counts.bytes.toLocaleString()} B
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5">{actions}</div>
      </div>

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={label}
        title={readOnlyHint}
        spellCheck={false}
        className={`${mono.className} min-h-0 w-full flex-1 resize-none whitespace-pre-wrap break-all bg-transparent px-4 py-3.5 text-[13px] leading-6 text-[#e5e5ec] caret-emerald-400 placeholder:text-[#5f5f6b] selection:bg-emerald-400/20 focus:outline-none [scrollbar-color:rgba(255,255,255,0.14)_transparent] [scrollbar-width:thin]`}
      />

      <div className="flex h-9 shrink-0 items-center justify-between border-t border-white/[0.07] px-4 text-[11.5px] text-[#6c6c78]">
        {footer}
      </div>
    </section>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function EncoderDecoderPage() {
  const [mode, setMode] = useState<Mode>('encode');
  const [selectedOp, setSelectedOp] = useState<Operation>('base64-encode');
  const [times, setTimes] = useState<number>(1);

  // Remember last-picked variant per group so chip labels stay specific
  const [variantByGroup, setVariantByGroup] = useState<Record<string, Operation>>(() => {
    const seed: Record<string, Operation> = {};
    for (const g of GROUP_ORDER) {
      const ops = CATALOG.filter((o) => o.group === g);
      if (ops.length > 0) seed[g] = ops[0].value;
    }
    return seed;
  });

  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copied, setCopied] = useState<'input' | 'output' | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [detections, setDetections] = useState<DetectionResult[]>([]);
  const [showDetect, setShowDetect] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const inputCounts = getCounts(input);
  const outputCounts = getCounts(output);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
  }, []);

  const flashSuccess = useCallback((msg: string) => {
    setSuccess(msg);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => setSuccess(null), 2000);
  }, []);

  const copyToClipboard = useCallback(async (text: string, target: 'input' | 'output') => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(target);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(null), 1500);
    } catch { setError('Clipboard access denied'); }
  }, []);

  // Pick an op and remember it for its group
  const pickOp = useCallback((op: Operation) => {
    setSelectedOp(op);
    const def = OP_BY_VALUE.get(op);
    if (def) {
      setVariantByGroup((prev) => ({ ...prev, [def.group]: op }));
    }
  }, []);

  const tabGroups = useMemo(() => groupedOpsForMode(mode), [mode]);

  const changeMode = useCallback((nextMode: Mode) => {
    const cur = OP_BY_VALUE.get(selectedOp);
    setMode(nextMode);
    if (cur?.inverse) {
      const inverse = OP_BY_VALUE.get(cur.inverse);
      if (inverse && (inverse.mode === nextMode || inverse.mode === 'both')) {
        pickOp(inverse.value);
        return;
      }
    }
    const ops = opsForMode(nextMode);
    if (ops[0]) pickOp(ops[0].value);
  }, [selectedOp, pickOp]);

  const currentOp = OP_BY_VALUE.get(selectedOp);
  const currentOpLabel = OP_LABEL.get(selectedOp) ?? selectedOp;

  const executeSingle = useCallback(async () => {
    if (!input) return;
    setError(null); setIsProcessing(true);
    const source = input;
    const n = Math.max(1, Math.min(10, times));
    try {
      let current = source;
      for (let i = 0; i < n; i++) {
        current = await applyOperation(selectedOp, current);
      }
      setOutput(current);
      const label = OP_LABEL.get(selectedOp) ?? selectedOp;
      setHistory((prev) => [{
        id: crypto.randomUUID(), operation: selectedOp,
        label: n > 1 ? `${label} ×${n}` : label,
        input: source, output: current, timestamp: Date.now(), times: n,
      }, ...prev].slice(0, 50));
      flashSuccess(n > 1 ? `${label} applied ${n}×` : `${label} applied`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed');
    } finally { setIsProcessing(false); }
  }, [input, selectedOp, times, flashSuccess]);

  const swap = useCallback(() => { setInput(output); setOutput(input); setError(null); }, [input, output]);
  const useOutputAsInput = useCallback(() => {
    if (!output) return;
    setInput(output); setOutput(''); setError(null);
  }, [output]);
  const clearWorkspace = useCallback(() => {
    setInput(''); setOutput(''); setError(null);
    setDetections([]); setShowDetect(false);
  }, []);
  const runDetection = useCallback(() => {
    setDetections(detectFormats(input)); setShowDetect(true); setError(null);
  }, [input]);
  const applyDetection = useCallback(async (det: DetectionResult) => {
    setIsProcessing(true); setError(null);
    try {
      const result = await applyOperation(det.decodeOp, input);
      setOutput(result); setShowDetect(false);
      const def = OP_BY_VALUE.get(det.decodeOp);
      if (def) { setMode('decode'); pickOp(def.value); }
      flashSuccess(`Decoded as ${det.format}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Decode failed');
    } finally { setIsProcessing(false); }
  }, [input, flashSuccess, pickOp]);
  const reuseHistory = useCallback((entry: HistoryEntry) => {
    setInput(entry.input); setOutput(entry.output); setShowHistory(false); setError(null);
  }, []);

  return (
    <div className={`${sans.className} flex min-h-full flex-col bg-[#0c0c0e] text-[#e5e5ec]`}>
      {/* ============================ Header ============================ */}
      <div className="border-b border-white/[0.07] px-6 py-6 md:px-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#eeeef3]">
              Encode / Decode
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#898995]">
              Transform data between Base64, URL, HTML, hex, binary and compression
              formats, or let Detect identify an unknown payload.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span
              role="status"
              aria-live="polite"
              className="inline-flex h-8 items-center gap-2 rounded-full border border-white/[0.08] bg-[#141416] px-3 text-xs text-[#a8a8b4]"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isProcessing
                    ? 'animate-pulse bg-amber-400'
                    : 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]'
                }`}
              />
              {isProcessing ? 'Processing' : 'Ready'}
            </span>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08]">
              <Code2 size={24} className="text-emerald-400" />
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-6 py-6 md:px-10">
        {/* ========================== Controls ========================== */}
        <section className={`${PANEL} p-4 md:p-5`}>
          <div className="flex flex-wrap items-center gap-3">
            {/* Mode switch */}
            <div
              role="group"
              aria-label="Mode"
              className="inline-flex rounded-xl border border-white/[0.08] bg-[#0f0f11] p-1"
            >
              {(['encode', 'decode'] as Mode[]).map((m) => {
                const active = mode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => changeMode(m)}
                    aria-pressed={active}
                    className={`inline-flex h-8 items-center gap-2 rounded-lg px-4 text-[13px] font-semibold transition ${FOCUS_RING}
                      ${active
                        ? 'bg-emerald-400/[0.12] text-emerald-300'
                        : 'text-[#858592] hover:text-[#d4d4dc]'
                      }`}
                  >
                    {m === 'encode' ? <Lock size={13} /> : <Unlock size={13} />}
                    {m === 'encode' ? 'Encode' : 'Decode'}
                  </button>
                );
              })}
            </div>

            <div className="flex-1" />

            <RepeatDropdown value={times} onChange={setTimes} />

            <button
              type="button"
              onClick={executeSingle}
              disabled={isProcessing || !input}
              title="Run on input (Ctrl/⌘ + Enter)"
              className={`inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-400 px-5 text-[13px] font-semibold text-[#04120b] transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-[#6c6c78] ${FOCUS_RING}`}
            >
              <Play size={13} fill="currentColor" />
              Run
              {times > 1 && (
                <span className="rounded-md bg-black/20 px-1.5 py-0.5 text-[10.5px] tabular-nums">
                  ×{times}
                </span>
              )}
            </button>
          </div>

          <div className="mt-4 border-t border-white/[0.07] pt-4">
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-[#8a8a98]">Operation</p>
              <p className="truncate text-xs text-[#6c6c78]">
                Selected: <span className="text-[#c4c4ce]">{currentOpLabel}</span>
              </p>
            </div>
            <OpTabs
              groups={tabGroups}
              selectedOp={selectedOp}
              variantByGroup={variantByGroup}
              onSelect={pickOp}
            />
          </div>
        </section>

        {/* ===================== Action row + alerts ===================== */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={runDetection}
            disabled={!input}
            title="Detect encoding format"
            className={GHOST_BTN}
          >
            <Sparkles size={13} className="text-emerald-400" />
            Detect format
          </button>

          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            aria-pressed={showHistory}
            title="Toggle history"
            className={`${GHOST_BTN} ${
              showHistory ? '!border-emerald-400/30 !bg-emerald-400/[0.1] !text-emerald-300' : ''
            }`}
          >
            <History size={13} />
            History
            {history.length > 0 && (
              <span className="rounded-md bg-white/[0.08] px-1.5 py-px text-[10.5px] tabular-nums text-[#c4c4ce]">
                {history.length}
              </span>
            )}
          </button>

          <div className="flex-1" />

          <button
            type="button"
            onClick={clearWorkspace}
            title="Clear input and output"
            className={`${GHOST_BTN} hover:!border-red-400/30 hover:!bg-red-400/[0.08] hover:!text-red-300`}
          >
            <Trash2 size={13} />
            Clear all
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-center gap-2.5 rounded-xl border border-red-400/20 bg-red-400/[0.07] px-4 py-2.5 text-[13px] text-red-300"
          >
            <AlertCircle size={15} className="shrink-0" />
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss error" className={ICON_BTN}>
              <X size={13} />
            </button>
          </div>
        )}
        {success && (
          <div
            role="status"
            className="flex items-center gap-2.5 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.07] px-4 py-2.5 text-[13px] text-emerald-300"
          >
            <Check size={15} className="shrink-0" />
            {success}
          </div>
        )}

        {/* ============================ Detect ============================ */}
        {showDetect && (
          <section className={`${PANEL} p-4`}>
            <div className="mb-3 flex items-center gap-2">
              <Sparkles size={14} className="text-emerald-400" />
              <h2 className="text-[13px] font-semibold text-[#e5e5ec]">Detected formats</h2>
              <button
                type="button"
                onClick={() => setShowDetect(false)}
                aria-label="Close detection results"
                className={`${ICON_BTN} ml-auto`}
              >
                <X size={14} />
              </button>
            </div>

            {detections.length === 0 ? (
              <div className="flex items-center gap-2 rounded-xl border border-dashed border-white/[0.1] bg-[#121315] px-4 py-5 text-[13px] text-[#898995]">
                <Search size={15} />
                No recognizable format detected in the input.
              </div>
            ) : (
              <div className="grid gap-2">
                {detections.map((det, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.07] bg-[#121315] px-3.5 py-2.5 transition hover:border-white/[0.14]"
                  >
                    <span
                      className={`inline-flex h-5 items-center rounded-full border px-2 text-[10.5px] font-semibold capitalize ${CONFIDENCE_STYLES[det.confidence]}`}
                    >
                      {det.confidence}
                    </span>
                    <span className="shrink-0 text-[13px] font-medium text-[#e5e5ec]">{det.format}</span>
                    <span className={`${mono.className} min-w-0 flex-1 truncate text-[12px] text-[#6c6c78]`}>
                      {det.preview}{det.preview.length >= 80 ? '…' : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => applyDetection(det)}
                      disabled={isProcessing}
                      className={`shrink-0 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.1] px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-400/[0.18] disabled:opacity-40 ${FOCUS_RING}`}
                    >
                      Decode
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ============================ History =========================== */}
        {showHistory && (
          <section className={`${PANEL} p-4`}>
            <div className="mb-3 flex items-center gap-2">
              <History size={14} className="text-[#8a8a98]" />
              <h2 className="text-[13px] font-semibold text-[#e5e5ec]">Session history</h2>
              <span className="text-xs tabular-nums text-[#6c6c78]">{history.length}/50</span>
              <button
                type="button"
                onClick={() => setHistory([])}
                disabled={history.length === 0}
                className={`ml-auto rounded-md px-2 py-1 text-xs font-medium text-[#858592] transition hover:bg-red-400/[0.08] hover:text-red-300 disabled:opacity-40 ${FOCUS_RING}`}
              >
                Clear history
              </button>
            </div>

            {history.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/[0.1] bg-[#121315] px-4 py-5 text-[13px] text-[#898995]">
                No operations yet. Run one and it will show up here.
              </div>
            ) : (
              <ul className="grid max-h-56 gap-1 overflow-y-auto pr-1 [scrollbar-color:rgba(255,255,255,0.14)_transparent] [scrollbar-width:thin]">
                {history.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => reuseHistory(entry)}
                      className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-white/[0.05] ${FOCUS_RING}`}
                    >
                      <RotateCcw
                        size={12}
                        className="shrink-0 text-[#6c6c78] transition group-hover:text-emerald-400"
                      />
                      <span className="shrink-0 text-[13px] font-medium text-[#d4d4dc]">{entry.label}</span>
                      <span className={`${mono.className} min-w-0 flex-1 truncate text-[12px] text-[#6c6c78]`}>
                        {entry.input.slice(0, 60)}{entry.input.length > 60 ? '…' : ''}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-[#5f5f6b]">
                        {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* =========================== Workspace ========================== */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
          <EditorPanel
            label="Input"
            tone="input"
            counts={inputCounts}
            value={input}
            onChange={setInput}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault(); void executeSingle();
              }
            }}
            placeholder={mode === 'encode' ? 'Enter text to encode…' : 'Paste encoded data to decode…'}
            actions={
              <>
                <button
                  type="button"
                  onClick={() => copyToClipboard(input, 'input')}
                  title="Copy input"
                  aria-label="Copy input"
                  className={ICON_BTN}
                >
                  {copied === 'input' ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                </button>
                <button
                  type="button"
                  onClick={() => { setInput(''); setError(null); }}
                  title="Clear input"
                  aria-label="Clear input"
                  className={`${ICON_BTN} hover:!bg-red-400/[0.1] hover:!text-red-300`}
                >
                  <Trash2 size={14} />
                </button>
              </>
            }
            footer={
              <span className="flex items-center gap-1.5">
                <CornerDownLeft size={12} />
                <kbd className="rounded border border-white/[0.12] bg-white/[0.06] px-1.5 py-px text-[10.5px] font-medium text-[#a8a8b4]">
                  Ctrl/⌘ + Enter
                </kbd>
                to run
              </span>
            }
          />

          <div className="flex shrink-0 items-center justify-center lg:flex-col">
            <button
              type="button"
              onClick={swap}
              title="Swap input and output"
              aria-label="Swap input and output"
              className={`flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.1] bg-[#141416] text-[#858592] shadow-md shadow-black/30 transition hover:border-emerald-400/40 hover:text-emerald-300 ${FOCUS_RING}`}
            >
              <ArrowLeftRight size={15} className="rotate-90 lg:rotate-0" />
            </button>
          </div>

          <EditorPanel
            label="Output"
            tone="output"
            counts={outputCounts}
            value={output}
            onChange={setOutput}
            placeholder="Result appears here…"
            actions={
              <>
                <button
                  type="button"
                  onClick={useOutputAsInput}
                  disabled={!output}
                  title="Use output as the next input"
                  className={`mr-1 inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-[#a8a8b4] transition hover:bg-white/[0.08] hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
                >
                  <ArrowLeft size={13} />
                  Use as input
                </button>
                <button
                  type="button"
                  onClick={() => copyToClipboard(output, 'output')}
                  title="Copy output"
                  aria-label="Copy output"
                  className={ICON_BTN}
                >
                  {copied === 'output' ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                </button>
                <button
                  type="button"
                  onClick={() => setOutput('')}
                  title="Clear output"
                  aria-label="Clear output"
                  className={`${ICON_BTN} hover:!bg-red-400/[0.1] hover:!text-red-300`}
                >
                  <Trash2 size={14} />
                </button>
              </>
            }
            footer={
              <>
                <span className="flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      output ? 'bg-emerald-400' : 'bg-[#4a4a55]'
                    }`}
                  />
                  {output ? 'Result ready' : 'Awaiting run'}
                </span>
                <span className="tabular-nums">
                  {outputCounts.chars > 0 ? `${outputCounts.bytes.toLocaleString()} bytes` : ''}
                </span>
              </>
            }
          />
        </div>

        {/* ============================ Status ============================ */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-2 pt-1 text-[11.5px] text-[#6c6c78]">
          <span>
            Mode: <span className="text-emerald-400">{mode}</span>
          </span>
          <span className="text-[#3a3a44]">|</span>
          <span>
            Operation: <span className="text-[#c4c4ce]">{currentOpLabel}</span>
          </span>
          {times > 1 && (
            <>
              <span className="text-[#3a3a44]">|</span>
              <span>
                Repeat: <span className="text-[#c4c4ce]">×{times}</span>
              </span>
            </>
          )}
          <div className="flex-1" />
          <span>PacketSniffer · Encode/Decode{currentOp ? ` · ${currentOp.group}` : ''}</span>
        </div>
      </main>
    </div>
  );
}