'use client';

import {
  Children,
  Fragment,
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type UIEvent,
} from "react";
import { mono } from "./ui";

/* ------------------------------------------------------------------
   Palette
------------------------------------------------------------------ */

const C = {
  punct: "text-[#a8a8b6]", // ? / & = , ; : { } [ ] - light grey, still readable
  name: "text-[#7cc4f0]",
  value: "text-[#d8d8e0]",
  path: "text-[#ececf1]",
  string: "text-[#6ee7b7]",
  number: "text-[#fbbf77]",
  literal: "text-[#c4a7f5]",
  version: "text-[#8a8a98]",
  mark: "text-purple-400", // paired § markers and the text inside them
  session: "text-green-300", // session / token values
};

const methodColor: Record<string, string> = {
  GET: "text-emerald-300",
  POST: "text-sky-300",
  PUT: "text-amber-300",
  PATCH: "text-violet-300",
  DELETE: "text-rose-300",
};

function statusColor(code: number) {
  if (code >= 500) return "text-rose-300";
  if (code >= 400) return "text-amber-300";
  if (code >= 300) return "text-sky-300";
  return "text-emerald-300";
}

const SESSION_NAME = /(session|sess|token|sid|jwt|auth|csrf|xsrf)/i;

/* ------------------------------------------------------------------
   Tokenizers
------------------------------------------------------------------ */

function highlightJson(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re =
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|([{}[\],:])/g;

  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;

  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));

    if (m[1] !== undefined) {
      if (m[2]) {
        out.push(
          <span key={k++} className={C.name}>{m[1]}</span>,
          <span key={k++} className={C.punct}>{m[2]}</span>
        );
      } else {
        out.push(<span key={k++} className={C.string}>{m[1]}</span>);
      }
    } else if (m[3]) {
      out.push(<span key={k++} className={C.literal}>{m[3]}</span>);
    } else if (m[4]) {
      out.push(<span key={k++} className={C.punct}>{m[4]}</span>);
    } else {
      out.push(<span key={k++} className={C.number}>{m[0]}</span>);
    }

    last = re.lastIndex;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

function highlightPairs(text: string): ReactNode[] {
  return text.split("&").map((pair, i) => {
    const eq = pair.indexOf("=");

    return (
      <Fragment key={i}>
        {i > 0 && <span className={C.punct}>&amp;</span>}
        {eq < 0 ? (
          <span className={C.name}>{pair}</span>
        ) : (
          <>
            <span className={C.name}>{pair.slice(0, eq)}</span>
            <span className={C.punct}>=</span>
            <span
              className={
                SESSION_NAME.test(pair.slice(0, eq))
                  ? C.session
                  : C.string
              }
            >
              {pair.slice(eq + 1)}
            </span>
          </>
        )}
      </Fragment>
    );
  });
}

function highlightStartLine(line: string): ReactNode {
  const req = line.match(
    /^([A-Za-z]+)(\s+)(\S+)(\s+)(HTTP\/[\d.]+)(\s*)$/
  );

  if (req) {
    const [, method, s1, target, s2, ver, tail] = req;
    const q = target.indexOf("?");

    return (
      <>
        <span
          className={`${
            methodColor[method.toUpperCase()] ?? "text-[#d8d8e0]"
          } font-medium`}
        >
          {method}
        </span>
        {s1}
        <span className={C.path}>
          {q < 0 ? target : target.slice(0, q)}
        </span>
        {q >= 0 && (
          <>
            <span className={C.punct}>?</span>
            {highlightPairs(target.slice(q + 1))}
          </>
        )}
        {s2}
        <span className={C.version}>{ver}</span>
        {tail}
      </>
    );
  }

  const res = line.match(
    /^(HTTP\/[\d.]+)(\s+)(\d{3})(\s+)(.*)$/
  );

  if (res) {
    const [, ver, s1, code, s2, reason] = res;

    return (
      <>
        <span className={C.version}>{ver}</span>
        {s1}
        <span className={`${statusColor(Number(code))} font-medium`}>
          {code}
        </span>
        {s2}
        <span className={C.value}>{reason}</span>
      </>
    );
  }

  return line;
}

function highlightHeader(line: string): ReactNode {
  const m = line.match(/^([^:\s][^:]*)(:)(.*)$/);
  if (!m) return line;

  return (
    <>
      <span className={C.name}>{m[1]}</span>
      <span className={C.punct}>{m[2]}</span>
      <span className={C.value}>{m[3]}</span>
    </>
  );
}

/* ------------------------------------------------------------------
   Post-processing: purple § marks (only when paired) and green tokens
------------------------------------------------------------------ */

type HlOpts = { green: boolean };

type HlState = {
  inMark: boolean; // currently between an opening and closing §
  count: number; // number of § characters passed so far
  total: number; // total number of § characters in the whole text
  k: number; // key counter
};

function colored(st: HlState, cls: string, text: string): ReactNode {
  return (
    <span key={`hl-${st.k++}`} className={cls}>
      {text}
    </span>
  );
}

// Colors a piece of plain text that is OUTSIDE any § marks.
function colorPlain(seg: string, opts: HlOpts, st: HlState): ReactNode[] {
  if (!seg) return [];
  if (!opts.green) return [seg];

  // Groups: 1,2 Bearer | 3 JWT | 4,5,6 name=value
  const re = new RegExp(
    "(Bearer\\s+)([\\w.\\-~+/=]+)" +
      "|(eyJ[\\w-]+\\.[\\w-]+\\.[\\w-]*)" +
      "|(\\b[\\w-]*(?:session|sess|token|sid|jwt|auth|csrf|xsrf)[\\w-]*)(=)([^;&\\s§]+)",
    "gi"
  );

  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(seg)) !== null) {
    if (m[0] === "") {
      re.lastIndex++;
      continue;
    }

    if (m.index > last) out.push(seg.slice(last, m.index));

    if (m[1]) {
      out.push(m[1], colored(st, C.session, m[2]));
    } else if (m[3]) {
      out.push(colored(st, C.session, m[3]));
    } else if (m[4]) {
      out.push(m[4], m[5], colored(st, C.session, m[6]));
    }

    last = m.index + m[0].length;
  }

  if (last < seg.length) out.push(seg.slice(last));

  return out;
}

// Colors § ... § pairs purple. § characters are matched in order
// (1st with 2nd, 3rd with 4th, ...). A § without a partner is left
// uncolored. State is shared across lines, so a pair can span lines.
function colorString(s: string, opts: HlOpts, st: HlState): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;

  while (i < s.length) {
    const idx = s.indexOf("§", i);

    // No more § in this string: color the rest and stop.
    if (idx < 0) {
      const rest = s.slice(i);

      if (st.inMark) {
        out.push(colored(st, C.mark, rest));
      } else {
        out.push(...colorPlain(rest, opts, st));
      }

      break;
    }

    // Text before the §.
    const before = s.slice(i, idx);

    if (before) {
      if (st.inMark) {
        out.push(colored(st, C.mark, before));
      } else {
        out.push(...colorPlain(before, opts, st));
      }
    }

    // The § itself.
    if (st.inMark) {
      // Closing marker.
      out.push(colored(st, C.mark, "§"));
      st.inMark = false;
    } else if (st.count + 1 < st.total) {
      // Opening marker that has a closing partner later in the text.
      out.push(colored(st, C.mark, "§"));
      st.inMark = true;
    } else {
      // Lone § with no partner: keep it uncolored.
      out.push("§");
    }

    st.count++;
    i = idx + 1;
  }

  return out;
}

// Walks an already-highlighted node tree and recolors its text leaves.
function decorate(node: ReactNode, opts: HlOpts, st: HlState): ReactNode {
  if (typeof node === "string") return colorString(node, opts, st);

  if (Array.isArray(node)) {
    return Children.toArray(node).map((child) => decorate(child, opts, st));
  }

  if (isValidElement(node)) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    const children = element.props.children;

    if (children === undefined || children === null) return node;

    const processed = Children.toArray(children).map((child) =>
      decorate(child, opts, st)
    );

    return cloneElement(element, undefined, ...processed);
  }

  return node;
}

/* ------------------------------------------------------------------
   Line-aware HTTP highlighting
------------------------------------------------------------------ */

function getHighlightedLines(raw: string): ReactNode[] {
  const lines = raw.split("\n");
  const blank = lines.findIndex((line, i) => i > 0 && line.trim() === "");
  const bodyText = blank >= 0 ? lines.slice(blank + 1).join("\n") : "";
  const isJson = /^\s*[{[]/.test(bodyText);

  const isForm =
    !isJson && bodyText.includes("=") && !/\s/.test(bodyText.trim());

  // Shared across lines so a § pair can span several lines.
  const st: HlState = {
    inMark: false,
    count: 0,
    total: (raw.match(/§/g) ?? []).length,
    k: 0,
  };

  return lines.map((line, i) => {
    let content: ReactNode;
    let opts: HlOpts;

    if (i === 0) {
      content = highlightStartLine(line);
      opts = { green: true };
    } else if (blank >= 0 && i > blank) {
      if (isJson) {
        content = highlightJson(line);
      } else if (isForm) {
        content = highlightPairs(line);
      } else {
        content = line;
      }
      opts = { green: true };
    } else if (i === blank) {
      content = line;
      opts = { green: false };
    } else {
      content = highlightHeader(line);
      opts = { green: true };
    }

    return decorate(content, opts, st);
  });
}

/** Colors a raw HTTP request or response. */
export function highlightHttp(raw: string): ReactNode[] {
  const lines = getHighlightedLines(raw);

  return lines.map((content, i) => (
    <Fragment key={i}>
      {content}
      {i < lines.length - 1 ? "\n" : ""}
    </Fragment>
  ));
}

/* ------------------------------------------------------------------
   Find highlighting (used by HttpViewer to highlight Ctrl+F matches)
------------------------------------------------------------------ */

type FindMatch = { start: number; end: number };

function findMatches(text: string, query: string): FindMatch[] {
  if (!query) return [];

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, "gi");

  const matches: FindMatch[] = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++; // safety
    if (matches.length > 10_000) break;
  }

  return matches;
}

/**
 * Wraps `query` matches inside a string with <mark> spans. Used by
 * HttpViewer to highlight find results inline. Because the syntax
 * highlighter has already produced React nodes, this function is
 * applied to the *plain text* of each line before highlighting, so
 * it stays simple and fast.
 */
function highlightFindInText(
  text: string,
  query: string,
  activeMatchGlobalIndex: number,
  startingGlobalIndex: number
): { nodes: ReactNode[]; nextGlobalIndex: number } {
  if (!query) return { nodes: [text], nextGlobalIndex: startingGlobalIndex };

  const matches = findMatches(text, query);
  if (matches.length === 0) {
    return { nodes: [text], nextGlobalIndex: startingGlobalIndex };
  }

  const nodes: ReactNode[] = [];
  let last = 0;
  let k = 0;

  matches.forEach((match) => {
    if (match.start > last) nodes.push(text.slice(last, match.start));

    const globalIndex = startingGlobalIndex + k;
    const isActive = globalIndex === activeMatchGlobalIndex;

    nodes.push(
      <mark
        key={`find-${globalIndex}`}
        data-find-active={isActive ? "" : undefined}
        className={
          isActive
            ? "rounded-[2px] bg-amber-400/40 text-white ring-1 ring-amber-400/60"
            : "rounded-[2px] bg-amber-400/20 text-amber-100"
        }
      >
        {text.slice(match.start, match.end)}
      </mark>
    );

    last = match.end;
    k++;
  });

  if (last < text.length) nodes.push(text.slice(last));

  return {
    nodes,
    nextGlobalIndex: startingGlobalIndex + matches.length,
  };
}

/* ------------------------------------------------------------------
   Shared editor metrics
------------------------------------------------------------------ */

const FONT_SIZE = 13.5;
const LINE_H = 22;
const PAD_Y = 16;
const PAD_X = 20;
const GUTTER_W = 56;

const metrics = {
  fontSize: FONT_SIZE,
  lineHeight: `${LINE_H}px`,
  letterSpacing: 0,
  tabSize: 2,
} as const;

const wrapClass =
  "whitespace-pre-wrap break-all [overflow-wrap:anywhere]";

/* ------------------------------------------------------------------
   Editable HTTP Request Editor
------------------------------------------------------------------ */

export type RequestEditorHandle = {
  /** Wraps the current text selection with `before`/`after` (e.g. "§", "§")
   *  and reports the change through onChange. No-op if nothing is selected. */
  wrapSelection: (before: string, after: string) => void;
  /** Current selection offsets into the editor's value. */
  getSelection: () => { start: number; end: number };
  /** The currently selected text ("" if nothing is selected). */
  getSelectedText: () => string;
  /** Replaces the current selection with `text`, reports the change through
   *  onChange, and keeps the new text selected so transforms can be chained.
   *  No-op if nothing is selected. */
  replaceSelection: (text: string) => void;
  focus: () => void;
};

type RequestEditorProps = {
  value: string;
  onChange: (v: string) => void;
  /** Fires on every selection change (click, keyup, select). Used by
   *  Intruder to enable/disable its "Mark position" button. */
  onSelectionChange?: (selection: { start: number; end: number }) => void;
};

const RequestEditor = forwardRef<RequestEditorHandle, RequestEditorProps>(
  function RequestEditor({ value, onChange, onSelectionChange }, ref) {
    const areaRef = useRef<HTMLTextAreaElement>(null);
    const layerRef = useRef<HTMLDivElement>(null);

    const [cursor, setCursor] = useState({ line: 1, col: 1 });
    const [focused, setFocused] = useState(false);

    const lineCount = value.split("\n").length;
    const highlightedLines = getHighlightedLines(value);

    const syncScroll = () => {
      const el = areaRef.current;
      if (!el || !layerRef.current) return;

      layerRef.current.style.transform = `translateY(${-el.scrollTop}px)`;
    };

    const updateCursor = () => {
      const el = areaRef.current;
      if (!el) return;

      const parts = el.value.slice(0, el.selectionStart).split("\n");

      setCursor({
        line: parts.length,
        col: parts[parts.length - 1].length + 1,
      });

      onSelectionChange?.({
        start: el.selectionStart,
        end: el.selectionEnd,
      });
    };

    useImperativeHandle(
      ref,
      () => ({
        wrapSelection(before: string, after: string) {
          const el = areaRef.current;
          if (!el) return;

          const start = el.selectionStart;
          const end = el.selectionEnd;
          if (start === end) return;

          const savedTop = el.scrollTop;
          const savedLeft = el.scrollLeft;

          const next =
            value.slice(0, start) +
            before +
            value.slice(start, end) +
            after +
            value.slice(end);

          onChange(next);

          const caret = end + before.length + after.length;

          const restore = () => {
            el.scrollTop = savedTop;
            el.scrollLeft = savedLeft;
            syncScroll();
          };

          requestAnimationFrame(() => {
            el.focus({ preventScroll: true });
            el.setSelectionRange(caret, caret);
            restore();
            updateCursor();
            requestAnimationFrame(restore);
          });

          window.setTimeout(restore, 0);
        },
        getSelection() {
          const el = areaRef.current;
          return el
            ? { start: el.selectionStart, end: el.selectionEnd }
            : { start: 0, end: 0 };
        },
        getSelectedText() {
          const el = areaRef.current;
          if (!el) return "";
          return el.value.slice(el.selectionStart, el.selectionEnd);
        },
        replaceSelection(text: string) {
          const el = areaRef.current;
          if (!el) return;

          const start = el.selectionStart;
          const end = el.selectionEnd;
          if (start === end) return;

          const savedTop = el.scrollTop;
          const savedLeft = el.scrollLeft;

          onChange(value.slice(0, start) + text + value.slice(end));

          const restore = () => {
            el.scrollTop = savedTop;
            el.scrollLeft = savedLeft;
            syncScroll();
          };

          requestAnimationFrame(() => {
            el.focus({ preventScroll: true });
            el.setSelectionRange(start, start + text.length);
            restore();
            updateCursor();
            requestAnimationFrame(restore);
          });

          window.setTimeout(restore, 0);
        },
        focus() {
          areaRef.current?.focus();
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [value, onChange]
    );

    useEffect(() => {
      syncScroll();
      updateCursor();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#0f0f11]">
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <div
            ref={layerRef}
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0 w-full will-change-transform"
          >
            <div
              className={`${mono.className} grid min-w-0`}
              style={{
                gridTemplateColumns: `${GUTTER_W}px minmax(0, 1fr)`,
                ...metrics,
                paddingTop: PAD_Y,
                paddingBottom: PAD_Y,
              }}
            >
              {highlightedLines.map((lineContent, i) => {
                const active = focused && cursor.line === i + 1;

                return (
                  <Fragment key={i}>
                    <div
                      className={`min-w-0 select-none border-r border-white/[0.06] bg-[#0d0d0f] pr-3 text-right ${
                        active ? "text-[#c8c8d2]" : "text-[#585866]"
                      }`}
                      style={{
                        minHeight: LINE_H,
                        lineHeight: `${LINE_H}px`,
                        fontSize: 12.5,
                      }}
                    >
                      {i + 1}
                    </div>

                    <div
                      className={`relative min-w-0 ${wrapClass} text-[#d8d8e0]`}
                      style={{
                        minHeight: LINE_H,
                        lineHeight: `${LINE_H}px`,
                        paddingLeft: PAD_X,
                        paddingRight: PAD_X,
                      }}
                    >
                      {active && (
                        <span
                          className="absolute inset-0 -z-0 bg-white/[0.035]"
                        />
                      )}
                      <span className="relative">{lineContent}</span>
                    </div>
                  </Fragment>
                );
              })}
            </div>
          </div>

          <textarea
            ref={areaRef}
            value={value}
            wrap="soft"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="Raw request"
            onChange={(e) => {
              onChange(e.target.value);
              updateCursor();
            }}
            onScroll={(_e: UIEvent<HTMLTextAreaElement>) => syncScroll()}
            onSelect={updateCursor}
            onKeyUp={updateCursor}
            onClick={updateCursor}
            onFocus={() => {
              setFocused(true);
              updateCursor();
            }}
            onBlur={() => setFocused(false)}
            className={`${mono.className} absolute bottom-0 right-0 top-0 resize-none overflow-y-auto overflow-x-hidden bg-transparent text-transparent caret-emerald-400 outline-none selection:bg-emerald-400/25 [scrollbar-color:#3a3a44_transparent] [scrollbar-width:thin] ${wrapClass}`}
            style={{
              left: GUTTER_W,
              width: `calc(100% - ${GUTTER_W}px)`,
              ...metrics,
              padding: `${PAD_Y}px ${PAD_X}px 56px`,
            }}
          />
        </div>

        <div className="flex h-9 shrink-0 items-center justify-between gap-4 border-t border-white/[0.06] bg-[#0d0d0f] px-5 text-[12.5px] text-[#8a8a98]">
          <span className="truncate">
            HTTP · {lineCount} {lineCount === 1 ? "line" : "lines"} ·{" "}
            {value.length} chars
          </span>

          <span className={`${mono.className} shrink-0`}>
            Ln {cursor.line}, Col {cursor.col}
          </span>
        </div>
      </div>
    );
  }
);

export default RequestEditor;

/* ------------------------------------------------------------------
   Binary body helper: Base64 -> Hex + ASCII
------------------------------------------------------------------ */

function base64ToHex(base64: string, limit = 512): string {
  try {
    const bytes = atob(base64.slice(0, Math.ceil(limit * 4 / 3)));
    const rows: string[] = [];

    for (let i = 0; i < bytes.length; i += 16) {
      const chunk = bytes.slice(i, i + 16);

      const hex = Array.from(chunk)
        .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(" ");

      const ascii = Array.from(chunk)
        .map((c) => {
          const n = c.charCodeAt(0);
          return n >= 32 && n <= 126 ? c : ".";
        })
        .join("");

      rows.push(
        `${i.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  ${ascii}`
      );
    }

    return rows.join("\n");
  } catch {
    return "Unable to decode binary data.";
  }
}

/* ------------------------------------------------------------------
   Scroll-to-active-match helper
------------------------------------------------------------------ */

function useScrollToActiveFind(deps: unknown[]) {
  useEffect(() => {
    // Find the currently highlighted active match inside the viewer and
    // scroll it into view. Only if the find bar is actually visible.
    const el = document.querySelector<HTMLElement>("[data-find-active]");
    if (!el) return;

    el.scrollIntoView({ block: "center", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/* ------------------------------------------------------------------
   Smart HTTP Response Viewer
------------------------------------------------------------------ */

export function HttpViewer({
  text,
  className = "",
  displayType,
  detectedMime,
  responseBodyBase64,
  rawResponseBodyBase64,
  originalSize,
  decodedSize,
  decodeError,
  rawText,
  findQuery,
  activeFindIndex,
}: {
  text: string;
  className?: string;
  displayType?: string;
  detectedMime?: string;
  responseBodyBase64?: string;
  rawResponseBodyBase64?: string;
  originalSize?: number;
  decodedSize?: number;
  decodeError?: string;
  rawText?: string;
  /** Current Ctrl+F query. When non-empty, matches are highlighted. */
  findQuery?: string;
  /** Zero-based index of the active match. Scrolled into view. */
  activeFindIndex?: number;
}) {
  type View = "decoded" | "raw" | "render";

  const [view, setView] = useState<View>("decoded");

  const isResponse = displayType !== undefined;
  const isSvg = detectedMime === "image/svg+xml";

  const canRenderImage =
    isResponse &&
    (displayType === "image" || isSvg) &&
    !!responseBodyBase64 &&
    responseBodyBase64.length <= 2_800_000 &&
    !!detectedMime?.startsWith("image/");

  const canRenderPdf =
    isResponse &&
    displayType === "pdf" &&
    !!responseBodyBase64 &&
    responseBodyBase64.length <= 5_600_000;

  const canRender = canRenderImage || canRenderPdf;

  const activeView: View = view === "render" && !canRender ? "decoded" : view;

  const hexType =
    displayType === "binary" || displayType === "image" || displayType === "pdf";

  const showHex =
    isResponse && (activeView === "raw" || (activeView === "decoded" && hexType));

  const hexBase64 =
    activeView === "raw" ? rawResponseBodyBase64 : responseBodyBase64;

  const hexText = hexBase64 ? base64ToHex(hexBase64) : "No body.";

  const size = activeView === "raw" ? originalSize : decodedSize;

  const contentText =
    activeView === "raw" && rawText !== undefined ? rawText : text;

  const highlightedLines = getHighlightedLines(contentText);

  // Scroll the active find match into view whenever it changes.
  useScrollToActiveFind([activeFindIndex, findQuery, activeView]);

  const tabs: { id: View; label: string }[] = [
    { id: "decoded", label: "Response" },
    { id: "raw", label: "Raw" },
    ...(canRender ? [{ id: "render" as View, label: "Render" }] : []),
  ];

  // Track global match index across lines while rendering.
  let findGlobalIndex = 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#0f0f11]">
      {isResponse && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.06] bg-[#0d0d0f] px-3 py-2">
          <div className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-[#141416] p-0.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setView(tab.id)}
                className={`rounded-md px-3 py-1 text-[11.5px] transition ${
                  activeView === tab.id
                    ? "bg-emerald-400/15 text-emerald-300"
                    : "text-[#858592] hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <span className="rounded-md border border-white/[0.08] px-2 py-1 text-[11px] text-[#a1a1ad]">
            {activeView === "raw"
              ? "Original bytes"
              : detectedMime ?? "Unknown MIME"}
          </span>

          {typeof size === "number" && activeView !== "render" && (
            <span className="text-[11px] text-[#777784]">
              {(size / 1024).toFixed(2)} KB
            </span>
          )}

          <span className="ml-auto text-[10.5px] text-[#777784]">
            {activeView === "render"
              ? "Rendered preview"
              : activeView === "raw"
                ? "Original response"
                : "Content decoded"}
          </span>
        </div>
      )}

      {isResponse && decodeError && (
        <div className="shrink-0 border-b border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[11.5px] text-amber-300">
          Decoding warning: {decodeError}
        </div>
      )}

      <div
        className={`min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-color:#3a3a44_transparent] [scrollbar-width:thin] ${className}`}
      >
        {activeView === "render" ? (
          canRenderImage ? (
            <div className="flex min-h-full min-w-0 items-center justify-center p-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:${detectedMime};base64,${responseBodyBase64}`}
                alt="Rendered response"
                className="max-h-full max-w-full rounded-lg bg-white object-contain p-4"
              />
            </div>
          ) : (
            <iframe
              title="Rendered PDF response"
              src={`data:application/pdf;base64,${responseBodyBase64}`}
              className="block h-full min-h-[500px] w-full bg-white"
            />
          )
        ) : (
          <>
            <div
              className={`${mono.className} grid min-w-0`}
              style={{
                gridTemplateColumns: `${GUTTER_W}px minmax(0, 1fr)`,
                ...metrics,
                paddingTop: PAD_Y,
                paddingBottom: showHex ? 0 : PAD_Y,
              }}
            >
              {highlightedLines.map((lineContent, i) => {
                // Only apply find-highlighting when a query is active and
                // we're not on the raw "hex" view (which has no text).
                let rendered = lineContent;

                if (findQuery && findQuery.length > 0) {
                  // Recompute this line's plain text. This is the raw
                  // line, not the highlighted nodes — that's fine, we
                  // want to split on the plain text and highlight matches
                  // inside the rendered syntax-highlighted output.
                  //
                  // Because `lineContent` may already contain nested
                  // elements, we fall back to the plain text of the line
                  // and re-run the lighter syntax highlighter around the
                  // matches. This keeps the code simple and correct.
                  const plainLine = contentText.split("\n")[i] ?? "";

                  const result = highlightFindInText(
                    plainLine,
                    findQuery,
                    activeFindIndex ?? 0,
                    findGlobalIndex
                  );

                  findGlobalIndex = result.nextGlobalIndex;

                  // If there are matches, prefer the simple find-highlighted
                  // version (still readable); otherwise keep the syntax-
                  // highlighted version.
                  if (result.nodes.length > 1) {
                    rendered = <>{result.nodes}</>;
                  }
                }

                return (
                  <Fragment key={i}>
                    <div
                      aria-hidden="true"
                      className="min-w-0 select-none border-r border-white/[0.06] bg-[#0d0d0f] pr-3 text-right text-[#585866]"
                      style={{
                        minHeight: LINE_H,
                        lineHeight: `${LINE_H}px`,
                        fontSize: 12.5,
                      }}
                    >
                      {i + 1}
                    </div>

                    <div
                      className={`min-w-0 ${wrapClass} text-[#d8d8e0]`}
                      style={{
                        minHeight: LINE_H,
                        lineHeight: `${LINE_H}px`,
                        paddingLeft: PAD_X,
                        paddingRight: PAD_X,
                      }}
                    >
                      {rendered}
                    </div>
                  </Fragment>
                );
              })}
            </div>

            {showHex && (
              <div className="mt-2 border-t border-white/[0.06]">
                <p className="px-5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-[#8a8a98]">
                  Body · hex (first 512 bytes)
                </p>

                <pre
                  className={`${mono.className} m-0 w-max min-w-full whitespace-pre p-5 text-[12px] leading-6 text-[#c5c5d0]`}
                >
                  {hexText}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}