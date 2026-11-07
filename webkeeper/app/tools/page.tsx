
"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ExternalLink,
  Search,
  Wrench,
  X,
  SearchX,
} from "lucide-react";

// ------------------------------------------------------------------
// Inline SVG logos
// ------------------------------------------------------------------

function JwtLogo() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      role="img"
      aria-label="JWT Editor logo"
      className="h-full w-full p-3"
    >
      <path
        fill="none"
        stroke="#10b981"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
      />
      <path
        fill="none"
        stroke="#10b981"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12l2 2 4-4"
      />
    </svg>
  );
}

// ------------------------------------------------------------------
// Tool configuration
// Add or remove tools here.
// ------------------------------------------------------------------

type Tool = {
  id: string;
  name: string;
  description: string;
  url: string;
  logo?: string;
  logoNode?: ReactNode;
  category: string;
  tags: string[];
};

const TOOLS: Tool[] = [
  {
    id: "jwt-editor",
    name: "JWT Editor",
    description:
      "Inspect, forge and stress-test JSON Web Tokens. Decode, edit and sign tokens, bruteforce HMAC secrets, generate keys and convert between JWK and PEM.",
    url: "https://jwteditor.vercel.app/",
    logoNode: <JwtLogo />,
    category: "Authentication",
    tags: ["JWT", "Decode", "Sign", "Bruteforce"],
  },
  {
    id: "crackhex",
    name: "Crackhex",
    description:
      "A hash cracking suite that detects the algorithm and recovers passwords using wordlist sweeps, filtered lists or custom generated permutations.",
    url: "https://crackhex.vercel.app/",
    logo: "https://crackhex.vercel.app/logo.png",
    category: "Cryptography",
    tags: ["Hash", "MD5", "Bcrypt", "NTLM"],
  },
];

// ------------------------------------------------------------------
// Open external tool using Tauri
// ------------------------------------------------------------------

async function handleOpenTool(url: string) {
  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== "https:") {
      throw new Error("Only HTTPS links are allowed");
    }

    console.log("[PacketSniffer] Opening external tool:", parsedUrl.href);

    await openUrl(parsedUrl.href);

    console.log("[PacketSniffer] External tool opened successfully");
  } catch (error) {
    console.error("[PacketSniffer] Failed to open external tool:", error);
  }
}

// ------------------------------------------------------------------
// Tool Logo
// ------------------------------------------------------------------

function ToolLogo({
  name,
  src,
  node,
}: {
  name: string;
  src?: string;
  node?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/[0.09] bg-gradient-to-br from-[#1c2823] to-[#121315]">
      {node ? (
        node
      ) : failed || !src ? (
        <span className="text-lg font-semibold text-emerald-300">
          {name.charAt(0)}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`${name} logo`}
          className="h-full w-full object-contain p-2"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Tool Card
// ------------------------------------------------------------------

function ToolCard({ tool }: { tool: Tool }) {
  return (
    <button
      type="button"
      onClick={() => handleOpenTool(tool.url)}
      className="group flex h-full w-full flex-col rounded-2xl border border-white/[0.08] bg-[#141416] p-5 text-left transition hover:border-emerald-400/30 hover:bg-[#161a18] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
    >
      <div className="flex w-full items-start gap-4">
        <ToolLogo name={tool.name} src={tool.logo} node={tool.logoNode} />

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold tracking-tight text-[#eeeef4]">
            {tool.name}
          </h3>

          <span className="mt-1.5 inline-flex rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
            {tool.category}
          </span>
        </div>
      </div>

      <p className="mt-4 w-full flex-1 text-left text-[13px] leading-6 text-[#92929e]">
        {tool.description}
      </p>

      <div className="mt-4 flex w-full flex-wrap gap-1.5">
        {tool.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-[#b4b4c0]"
          >
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-5 flex w-full items-center justify-between border-t border-white/[0.07] pt-4">
        <span className="truncate text-[11.5px] text-[#6c6c78]">
          {tool.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
        </span>

        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-emerald-300 transition group-hover:text-emerald-200">
          Open tool
          <ExternalLink size={13} />
        </span>
      </div>
    </button>
  );
}

// ------------------------------------------------------------------
// Tools Page
// ------------------------------------------------------------------

export default function ToolsPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(TOOLS.map((t) => t.category)))],
    []
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return TOOLS.filter((tool) => {
      const matchesCategory =
        category === "All" || tool.category === category;

      const matchesQuery =
        q === "" ||
        tool.name.toLowerCase().includes(q) ||
        tool.description.toLowerCase().includes(q) ||
        tool.tags.some((tag) => tag.toLowerCase().includes(q));

      return matchesCategory && matchesQuery;
    });
  }, [query, category]);

  function resetFilters() {
    setQuery("");
    setCategory("All");
  }

  return (
    <div className="min-h-full bg-[#0c0c0e]">

      {/* Header */}

      <div className="border-b border-white/[0.07] px-6 py-6 md:px-10">
        <div className="mx-auto max-w-6xl">

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-[#eeeef3]">
                Tools
              </h1>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#898995]">
                Web tools you can open and use directly in your browser,
                with nothing to install.
              </p>
            </div>

            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08]">
              <Wrench size={24} className="text-emerald-400" />
            </div>
          </div>

        </div>
      </div>

      {/* Main */}

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10">

        {/* Toolbar */}

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">

          <div className="relative w-full md:max-w-sm">
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6c6c78]"
            />

            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tools"
              aria-label="Search tools"
              className="w-full rounded-xl border border-white/[0.08] bg-[#141416] py-2.5 pl-10 pr-9 text-sm text-[#e5e5ec] placeholder:text-[#6c6c78] focus:border-emerald-400/40 focus:outline-none focus:ring-1 focus:ring-emerald-400/40"
            />

            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#858592] transition hover:bg-white/[0.08] hover:text-white"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {categories.length > 2 && (
            <div
              role="group"
              aria-label="Filter by category"
              className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]"
            >
              {categories.map((item) => {
                const isActive = category === item;

                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setCategory(item)}
                    aria-pressed={isActive}
                    className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                      isActive
                        ? "border-emerald-400/30 bg-emerald-400/[0.1] text-emerald-300"
                        : "border-white/[0.1] bg-white/[0.04] text-[#c4c4ce] hover:bg-white/[0.08]"
                    }`}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
          )}

        </div>

        {/* Results count */}

        <p className="mt-5 text-xs text-[#6c6c78]" aria-live="polite">
          {filtered.length} {filtered.length === 1 ? "tool" : "tools"}
        </p>

        {/* Grid */}

        {filtered.length > 0 ? (
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        ) : (
          <div className="mt-4 flex flex-col items-center rounded-2xl border border-dashed border-white/[0.1] bg-[#121315] px-6 py-16 text-center">

            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/[0.05]">
              <SearchX size={22} className="text-[#a6a6b2]" />
            </div>

            <h2 className="mt-4 text-sm font-semibold text-[#e5e5ec]">
              No tools match your search
            </h2>

            <p className="mt-1.5 max-w-sm text-xs leading-5 text-[#858592]">
              Try a different name or tag, or clear the filters to see every
              tool.
            </p>

            <button
              type="button"
              onClick={resetFilters}
              className="mt-5 rounded-lg border border-white/[0.1] bg-white/[0.05] px-4 py-2 text-xs font-medium text-[#e0e0e8] transition hover:bg-white/[0.09]"
            >
              Clear filters
            </button>

          </div>
        )}

        {/* Footer */}

        <div className="pb-6 pt-14 text-center text-[11px] text-[#666672]">
          PacketSniffer · Tools
        </div>

      </main>
    </div>
  );
}
