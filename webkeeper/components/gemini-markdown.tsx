"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { IBM_Plex_Mono } from "next/font/google";
import { Check, Copy, WrapText } from "lucide-react";

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

/* ------------------------------------------------------------------ */
/* Copy hook                                                           */
/* ------------------------------------------------------------------ */

export function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard unavailable.
    }
  }

  return { copied, copy };
}

/* ------------------------------------------------------------------ */
/* Syntax highlighting (no dependencies)                               */
/* ------------------------------------------------------------------ */

const C = {
  punct: "text-[#7c7c8a]",
  key: "text-sky-300",
  string: "text-emerald-200",
  number: "text-amber-300",
  keyword: "text-violet-300",
  comment: "italic text-[#6b6b78]",
  plain: "text-[#d4d4dc]",
  dim: "text-[#8a8a98]",
};

function span(cls: string, text: string, key: string | number) {
  return (
    <span key={key} className={cls}>
      {text}
    </span>
  );
}

function highlightJson(code: string): ReactNode[] {
  const re =
    /("(?:\\.|[^"\\\n])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],:])/g;
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(code)) !== null) {
    if (m.index > last) out.push(code.slice(last, m.index));
    if (m[1] !== undefined) {
      if (m[2] !== undefined) {
        out.push(span(C.key, m[1], n++));
        out.push(span(C.punct, m[2], n++));
      } else {
        out.push(span(C.string, m[1], n++));
      }
    } else if (m[3] !== undefined) out.push(span(C.keyword, m[3], n++));
    else if (m[4] !== undefined) out.push(span(C.number, m[4], n++));
    else out.push(span(C.punct, m[5], n++));
    last = m.index + m[0].length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

const METHOD_COLOR: Record<string, string> = {
  GET: "text-emerald-300",
  POST: "text-sky-300",
  PUT: "text-amber-300",
  PATCH: "text-amber-300",
  DELETE: "text-rose-300",
};

function statusColor(code: number) {
  if (code >= 500) return "text-rose-300";
  if (code >= 400) return "text-rose-300";
  if (code >= 300) return "text-amber-300";
  return "text-emerald-300";
}

function highlightHttp(code: string): ReactNode[] {
  const lines = code.split("\n");
  const out: ReactNode[] = [];
  let inBody = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nl = i < lines.length - 1 ? "\n" : "";

    if (inBody) {
      const rest = lines.slice(i).join("\n");
      const t = rest.trimStart();
      out.push(
        <Fragment key={`b${i}`}>
          {t.startsWith("{") || t.startsWith("[") ? highlightJson(rest) : rest}
        </Fragment>
      );
      break;
    }

    if (i === 0) {
      const res = line.match(/^(HTTP\/[\d.]+)(\s+)(\d{3})(.*)$/);
      const req = line.match(/^([A-Z]+)(\s+)(\S+)(\s+HTTP\/[\d.]+)?\s*$/);
      if (res) {
        out.push(
          <Fragment key={`l${i}`}>
            {span(C.dim, res[1], 0)}
            {res[2]}
            <span className={`font-medium ${statusColor(Number(res[3]))}`}>{res[3]}</span>
            <span className={statusColor(Number(res[3]))}>{res[4]}</span>
            {nl}
          </Fragment>
        );
        continue;
      }
      if (req) {
        out.push(
          <Fragment key={`l${i}`}>
            <span className={`font-medium ${METHOD_COLOR[req[1]] ?? "text-violet-300"}`}>
              {req[1]}
            </span>
            {req[2]}
            <span className="text-[#ececf1]">{req[3]}</span>
            {req[4] ? span(C.dim, req[4], 1) : null}
            {nl}
          </Fragment>
        );
        continue;
      }
    }

    if (!line.trim()) {
      inBody = true;
      out.push(nl);
      continue;
    }

    const h = line.match(/^([A-Za-z0-9!#$%&'*+.^_`|~-]+)(:\s*)(.*)$/);
    if (h) {
      out.push(
        <Fragment key={`l${i}`}>
          {span(C.key, h[1], 0)}
          {span(C.punct, h[2], 1)}
          {span(C.plain, h[3], 2)}
          {nl}
        </Fragment>
      );
    } else {
      out.push(line + nl);
    }
  }
  return out;
}

const HASH_LANGS = new Set(["bash", "sh", "shell", "zsh", "python", "py", "yaml", "yml", "env", "ini", "toml", "ruby", "rb"]);
const SLASH_LANGS = new Set(["js", "javascript", "ts", "typescript", "jsx", "tsx", "java", "c", "cpp", "go", "rust", "rs", "php", "kotlin", "swift", "css"]);
const DASH_LANGS = new Set(["sql", "lua"]);

function highlightGeneric(code: string, lang: string): ReactNode[] {
  let comment = "(?!)";
  if (HASH_LANGS.has(lang)) comment = "#.*$";
  else if (SLASH_LANGS.has(lang)) comment = "\\/\\/.*$";
  else if (DASH_LANGS.has(lang)) comment = "--.*$";

  const re = new RegExp(
    `(${comment})|("(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*')|(\\b\\d+(?:\\.\\d+)?\\b)`,
    "gm"
  );
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(code)) !== null) {
    if (m[0] === "") {
      re.lastIndex++;
      continue;
    }
    if (m.index > last) out.push(code.slice(last, m.index));
    if (m[1]) out.push(span(C.comment, m[1], n++));
    else if (m[2]) out.push(span(C.string, m[2], n++));
    else out.push(span(C.number, m[3], n++));
    last = m.index + m[0].length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

function highlight(code: string, label: string): ReactNode {
  const lang = label.toLowerCase();
  if (lang === "http" || lang === "https" || lang === "request" || lang === "response") {
    return highlightHttp(code);
  }
  if (lang === "json" || lang === "jsonc") return highlightJson(code);
  return highlightGeneric(code, lang);
}

/* ------------------------------------------------------------------ */
/* Code block                                                          */
/* ------------------------------------------------------------------ */

export function CodeBlock({ code, label = "http" }: { code: string; label?: string }) {
  const { copied, copy } = useCopy();
  const [wrap, setWrap] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0c0c0e]">
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-3 py-1.5">
        <span className={`${mono.className} text-[11.5px] text-[#8a8a98]`}>{label}</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setWrap((v) => !v)}
            aria-pressed={wrap}
            title="Toggle line wrap"
            aria-label="Toggle line wrap"
            className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 ${
              wrap ? "text-emerald-300" : "text-[#7c7c8a] hover:text-white"
            }`}
          >
            <WrapText size={13} />
          </button>
          <button
            type="button"
            onClick={() => void copy(code)}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-[#9a9aa8] transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <pre
        className={`${mono.className} max-h-[26rem] overflow-auto px-4 py-3 text-[12.5px] leading-5 text-[#d4d4dc] [scrollbar-color:rgba(255,255,255,0.12)_transparent] [scrollbar-width:thin] ${
          wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
        }`}
      >
        <code>{highlight(code, label)}</code>
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inline markdown                                                     */
/* ------------------------------------------------------------------ */

const TEX_SYMBOLS: [RegExp, string][] = [
  [/\\(?:long)?rightarrow|\\to\b/g, "→"],
  [/\\(?:long)?leftarrow/g, "←"],
  [/\\leftrightarrow/g, "↔"],
  [/\\(?:Rightarrow|implies)/g, "⇒"],
  [/\\neq?/g, "≠"],
  [/\\leq?/g, "≤"],
  [/\\geq?/g, "≥"],
  [/\\approx/g, "≈"],
  [/\\times/g, "×"],
  [/\\cdot/g, "·"],
  [/\\(?:ldots|dots)/g, "…"],
  [/\\infty/g, "∞"],
  [/\\pm/g, "±"],
  [/\\(?:text|texttt|mathrm|mathbf)\{([^}]*)\}/g, "$1"],
];

function texToText(src: string) {
  let s = src;
  for (const [re, rep] of TEX_SYMBOLS) s = s.replace(re, rep);
  return s.replace(/\s+/g, " ").trim();
}

const INLINE_RE =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^\s*][^*\n]*\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|\$[^$\n]*\\[a-zA-Z]+[^$\n]*\$)/g;

function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(INLINE_RE).map((part, i) => {
        if (!part) return null;

        if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              key={i}
              className={`${mono.className} rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[0.85em] text-emerald-200`}
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        if (
          part.length > 4 &&
          ((part.startsWith("**") && part.endsWith("**")) ||
            (part.startsWith("__") && part.endsWith("__")))
        ) {
          return (
            <strong key={i} className="font-semibold text-[#ececf1]">
              <Inline text={part.slice(2, -2)} />
            </strong>
          );
        }
        if (part.length > 4 && part.startsWith("~~") && part.endsWith("~~")) {
          return (
            <del key={i} className="text-[#8a8a98]">
              <Inline text={part.slice(2, -2)} />
            </del>
          );
        }
        if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) {
          return (
            <em key={i} className="italic text-[#b8b8c4]">
              <Inline text={part.slice(1, -1)} />
            </em>
          );
        }
        const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
        if (link) {
          return (
            <a
              key={i}
              href={link[2]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-300 underline decoration-emerald-300/30 underline-offset-2 transition-colors hover:text-emerald-200 hover:decoration-emerald-200/60"
            >
              {link[1]}
            </a>
          );
        }
        if (part.length > 2 && part.startsWith("$") && part.endsWith("$")) {
          return (
            <span key={i} className="text-[#e5e5ec]">
              {texToText(part.slice(1, -1))}
            </span>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Block parser                                                        */
/* ------------------------------------------------------------------ */

type Align = "left" | "center" | "right";

type ListItem = { text: string; children: Block[] };

type Block =
  | { t: "h"; level: number; text: string }
  | { t: "hr" }
  | { t: "code"; lang: string; code: string }
  | { t: "quote"; blocks: Block[] }
  | { t: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { t: "table"; head: string[]; align: Align[]; rows: string[][] }
  | { t: "p"; text: string };

const FENCE_OPEN = /^\s*```+\s*([\w+#.-]*)\s*$/;
const FENCE_CLOSE = /^\s*```+\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const LIST = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isTableStart(lines: string[], i: number) {
  return (
    lines[i].includes("|") &&
    i + 1 < lines.length &&
    lines[i + 1].includes("-") &&
    TABLE_SEP.test(lines[i + 1])
  );
}

function isBlockStart(lines: string[], i: number) {
  const l = lines[i];
  return (
    FENCE_OPEN.test(l) ||
    HEADING.test(l) ||
    HR.test(l) ||
    QUOTE.test(l) ||
    LIST.test(l) ||
    isTableStart(lines, i)
  );
}

type FlatItem = { indent: number; ordered: boolean; num: number; text: string };

function buildList(
  flat: FlatItem[],
  from: number,
  indent: number
): { block: Block; next: number } {
  const ordered = flat[from].ordered;
  const start = flat[from].num;
  const items: ListItem[] = [];
  let idx = from;

  while (idx < flat.length) {
    const cur = flat[idx];
    if (cur.indent < indent) break;
    if (cur.indent > indent) {
      const nested = buildList(flat, idx, cur.indent);
      items[items.length - 1].children.push(nested.block);
      idx = nested.next;
      continue;
    }
    if (items.length && cur.ordered !== ordered) break;
    items.push({ text: cur.text, children: [] });
    idx++;
  }

  return { block: { t: "list", ordered, start, items }, next: idx };
}

function parseList(lines: string[], from: number): { blocks: Block[]; next: number } {
  const flat: FlatItem[] = [];
  let i = from;

  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(LIST);

    if (m) {
      flat.push({
        indent: m[1].replace(/\t/g, "    ").length,
        ordered: /\d/.test(m[2]),
        num: parseInt(m[2], 10) || 1,
        text: m[3],
      });
      i++;
      continue;
    }

    if (!line.trim()) {
      // A blank line only continues the list if another item follows.
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && LIST.test(lines[j])) {
        i = j;
        continue;
      }
      break;
    }

    // Indented continuation of the previous item.
    if (/^\s+\S/.test(line) && flat.length && !isBlockStart(lines, i)) {
      flat[flat.length - 1].text += " " + line.trim();
      i++;
      continue;
    }
    break;
  }

  const blocks: Block[] = [];
  let idx = 0;
  while (idx < flat.length) {
    const { block, next } = buildList(flat, idx, flat[idx].indent);
    blocks.push(block);
    idx = next;
  }
  return { blocks, next: i };
}

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = line.match(FENCE_OPEN);
    if (fence) {
      const body: string[] = [];
      i++;
      // An unclosed fence swallows the rest of the text.
      while (i < lines.length && !FENCE_CLOSE.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push({ t: "code", lang: fence[1], code: body.join("\n").replace(/\n+$/, "") });
      continue;
    }

    const h = line.match(HEADING);
    if (h) {
      blocks.push({ t: "h", level: h[1].length, text: h[2] });
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        inner.push(lines[i].replace(QUOTE, ""));
        i++;
      }
      blocks.push({ t: "quote", blocks: parseBlocks(inner.join("\n")) });
      continue;
    }

    if (isTableStart(lines, i)) {
      const head = splitRow(line);
      const align: Align[] = splitRow(lines[i + 1]).map((c) =>
        c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left"
      );
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ t: "table", head, align, rows });
      continue;
    }

    if (LIST.test(line)) {
      const { blocks: listBlocks, next } = parseList(lines, i);
      blocks.push(...listBlocks);
      i = next;
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !isBlockStart(lines, i))) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ t: "p", text: para.join("\n") });
  }

  return blocks;
}

/* ------------------------------------------------------------------ */
/* Block renderer                                                      */
/* ------------------------------------------------------------------ */

const HEADING_CLASS: Record<number, string> = {
  1: "mt-2 text-[19px] font-semibold tracking-tight text-[#f1f1f5]",
  2: "mt-3 border-b border-white/[0.08] pb-1.5 text-[17px] font-semibold tracking-tight text-[#ececf1]",
  3: "mt-3 text-[15.5px] font-semibold text-[#ececf1]",
  4: "mt-2 text-[14px] font-semibold text-emerald-300",
  5: "mt-1 text-[13px] font-semibold text-[#a8a8b4]",
  6: "mt-1 text-[13px] font-medium text-[#8a8a98]",
};

const ALIGN_CLASS: Record<Align, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

function Blocks({ blocks, nested = false }: { blocks: Block[]; nested?: boolean }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h":
            return (
              <div
                key={i}
                role="heading"
                aria-level={Math.min(b.level + 1, 6)}
                className={HEADING_CLASS[b.level]}
              >
                <Inline text={b.text} />
              </div>
            );

          case "hr":
            return <hr key={i} className="my-1 border-0 border-t border-white/[0.08]" />;

          case "code":
            return <CodeBlock key={i} code={b.code} label={b.lang || "text"} />;

          case "quote":
            return (
              <blockquote
                key={i}
                className="flex flex-col gap-2 rounded-r-lg border-l-2 border-emerald-400/50 bg-emerald-400/[0.05] px-3.5 py-2.5 text-[#d6e6dd]"
              >
                <Blocks blocks={b.blocks} nested />
              </blockquote>
            );

          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag
                key={i}
                start={b.ordered && b.start !== 1 ? b.start : undefined}
                className={`${nested ? "" : ""} space-y-1.5 pl-5 ${
                  b.ordered
                    ? "list-decimal marker:text-[#7c7c8a]"
                    : "list-disc marker:text-emerald-400/70"
                }`}
              >
                {b.items.map((item, j) => (
                  <li key={j} className="pl-1">
                    <span className="whitespace-pre-wrap break-words">
                      <Inline text={item.text} />
                    </span>
                    {item.children.length > 0 && (
                      <div className="mt-1.5 flex flex-col gap-1.5">
                        <Blocks blocks={item.children} nested />
                      </div>
                    )}
                  </li>
                ))}
              </Tag>
            );
          }

          case "table":
            return (
              <div
                key={i}
                className="overflow-x-auto rounded-xl border border-white/[0.08] [scrollbar-color:rgba(255,255,255,0.12)_transparent] [scrollbar-width:thin]"
              >
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="bg-white/[0.04]">
                      {b.head.map((cell, j) => (
                        <th
                          key={j}
                          className={`whitespace-nowrap border-b border-white/[0.08] px-3 py-2 font-semibold text-[#ececf1] ${
                            ALIGN_CLASS[b.align[j] ?? "left"]
                          }`}
                        >
                          <Inline text={cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr
                        key={r}
                        className="border-b border-white/[0.05] last:border-b-0 even:bg-white/[0.02]"
                      >
                        {row.map((cell, j) => (
                          <td
                            key={j}
                            className={`px-3 py-2 align-top text-[#cfcfd8] ${
                              ALIGN_CLASS[b.align[j] ?? "left"]
                            }`}
                          >
                            <Inline text={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          default:
            return (
              <p key={i} className="whitespace-pre-wrap break-words">
                <Inline text={b.text} />
              </p>
            );
        }
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Public component                                                    */
/* ------------------------------------------------------------------ */

export function RichText({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="flex flex-col gap-3 [&>*:first-child]:mt-0">
      <Blocks blocks={blocks} />
    </div>
  );
}
