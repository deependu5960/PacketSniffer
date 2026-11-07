'use client';

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef, type ReactNode } from "react";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { useProxyEngine } from "@/components/useProxyEngine";
import { Check, Copy, Power, RadioTower, Sparkles } from "lucide-react";
import GeminiAIModal from "@/components/GeminiAIModal";
import { onGeminiAIRequest } from "@/components/geminiAI-bridge";

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

const COLLAPSE_KEY = "packetsniff.sidebar.collapsed";

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

const Svg = ({ children }: { children: ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    className="h-[18px] w-[18px] shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const icons = {
  dashboard: (
    <Svg>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Svg>
  ),
  target: (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" />
    </Svg>
  ),
  history: (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </Svg>
  ),
  proxy: (
    <Svg>
      <path d="M17 3l4 4-4 4" />
      <path d="M3 7h18" />
      <path d="M7 21l-4-4 4-4" />
      <path d="M21 17H3" />
    </Svg>
  ),
  repeater: (
    <Svg>
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </Svg>
  ),
  intruder: (
    <Svg>
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </Svg>
  ),
  collaborator: (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
    </Svg>
  ),
  encoder: (
    <Svg>
      <path d="M8 7l-5 5 5 5" />
      <path d="M16 7l5 5-5 5" />
      <path d="M14 4l-4 16" />
    </Svg>
  ),
  tools: (
    <Svg>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </Svg>
  ),
  payloads: (
    <Svg>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </Svg>
  ),
  chevron: (
    <Svg>
      <path d="M15 6l-6 6 6 6" />
    </Svg>
  ),
};

/* ------------------------------------------------------------------ */
/* Navigation model                                                    */
/* ------------------------------------------------------------------ */

type NavItem = {
  label: string;
  icon: ReactNode;
  href?: string;
};

const groups: { title: string; items: NavItem[] }[] = [
  {
    title: "Workspace",
    items: [
      { label: "Dashboard", icon: icons.dashboard, href: "/" },
      { label: "Target", icon: icons.target, href: "/target" },
      { label: "HTTP History", icon: icons.history, href: "/http-history" },
    ],
  },
  {
    title: "Tools",
    items: [
      { label: "Interceptor", icon: icons.proxy, href: "/interceptor" },
      { label: "Repeater", icon: icons.repeater, href: "/repeater" },
      { label: "Intruder", icon: icons.intruder, href: "/intruder" },
      { label: "Collaborator", icon: icons.collaborator, href: "/collaborator" },
      { label: "Encode/Decode", icon: icons.encoder, href: "/encoder-decoder" },
      { label: "Explore Tools", icon: icons.tools, href: "/tools" },
      { label: "Payloads", icon: icons.payloads, href: "/payloads" },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Tooltip                                                             */
/* ------------------------------------------------------------------ */

function Tip({
  label,
  hint,
  enabled = true,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  enabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!enabled) setPos(null);
  }, [enabled]);

  function show() {
    if (!enabled || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: r.right + 12, y: r.top + r.height / 2 });
  }

  return (
    <div
      ref={ref}
      className={className}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
      onFocus={show}
      onBlur={() => setPos(null)}
    >
      {children}
      {enabled && pos && (
        <span
          role="tooltip"
          style={{ left: pos.x, top: pos.y }}
          className="pointer-events-none fixed z-50 flex -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-lg border border-white/[0.1] bg-[#1c1c20] px-2.5 py-1.5 text-[12px] font-medium text-[#ececf1] shadow-lg shadow-black/40"
        >
          {label}
          {hint && (
            <kbd className="rounded border border-white/[0.12] bg-white/[0.06] px-1.5 py-px text-[11px] font-medium text-[#a8a8b4]">
              {hint}
            </kbd>
          )}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Nav row                                                             */
/* ------------------------------------------------------------------ */

function NavRow({
  icon,
  label,
  href,
  active = false,
  collapsed,
}: {
  icon: ReactNode;
  label: string;
  href?: string;
  active?: boolean;
  collapsed: boolean;
}) {
  const layout = collapsed ? "justify-center" : "gap-3 px-3";
  const base = `relative flex h-10 w-full items-center rounded-lg text-[14px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 md:text-[15px] ${layout}`;

  if (!href) {
    return (
      <Tip label={`${label} (coming soon)`} enabled={collapsed}>
        <button
          type="button"
          aria-disabled="true"
          aria-label={collapsed ? `${label}, coming soon` : undefined}
          onClick={(e) => e.preventDefault()}
          className={`${base} cursor-not-allowed font-medium text-[#86869a] hover:bg-white/[0.03]`}
        >
          {icon}
          {!collapsed && (
            <>
              <span className="flex-1 text-left">{label}</span>
              <span className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[11px] font-medium text-[#8a8a98]">
                Soon
              </span>
            </>
          )}
        </button>
      </Tip>
    );
  }

  return (
    <Tip label={label} enabled={collapsed}>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? label : undefined}
        className={`${base} ${
          active
            ? "bg-emerald-400/[0.10] font-semibold text-emerald-300 hover:bg-emerald-400/[0.16]"
            : "font-medium text-[#a8a8b4] hover:bg-white/[0.05] hover:text-white"
        }`}
      >
        {active && (
          <span
            aria-hidden="true"
            className="absolute -left-3 top-2 h-6 w-[3px] rounded-r-full bg-emerald-400"
          />
        )}
        {icon}
        {!collapsed && <span className="flex-1 truncate">{label}</span>}
      </Link>
    </Tip>
  );
}

/* ------------------------------------------------------------------ */
/* AI action (lives inside the Proxy engine section)                   */
/* ------------------------------------------------------------------ */

function GeminiButton({
  collapsed,
  onOpen,
  hint,
}: {
  collapsed: boolean;
  onOpen: () => void;
  hint: string;
}) {
  if (collapsed) {
    return (
      <Tip label="PacketSniffer AI" hint={hint}>
        <button
          type="button"
          onClick={onOpen}
          aria-label="Open PacketSniffer AI"
          className="relative flex h-10 w-full items-center justify-center rounded-lg border border-white/[0.08] bg-[#141416] text-[#a8a8b4] transition-colors hover:border-emerald-400/40 hover:bg-gradient-to-br hover:from-emerald-400/[0.16] hover:to-teal-400/[0.04] hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
        >
          <Sparkles size={18} strokeWidth={1.8} />
        </button>
      </Tip>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group/ai flex h-11 w-full items-center gap-3 rounded-xl border border-white/[0.08] bg-[#141416] px-3 text-left transition-colors hover:border-emerald-400/40 hover:bg-gradient-to-br hover:from-emerald-400/[0.16] hover:to-teal-400/[0.04] focus-visible:border-emerald-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.05] text-[#9a9aa8] transition-all group-hover/ai:scale-105 group-hover/ai:bg-emerald-400/15 group-hover/ai:text-emerald-300 group-focus-visible/ai:bg-emerald-400/15 group-focus-visible/ai:text-emerald-300">
        <Sparkles size={15} strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold leading-4 text-[#e5e5ec] transition-colors group-hover/ai:text-emerald-300">
          PacketSniffer AI
        </span>
        <span className="block truncate text-[11.5px] leading-4 text-[#9a9aa8]">
          Integrated by Gemini
        </span>
      </span>
      <kbd className="shrink-0 rounded border border-white/[0.1] bg-white/[0.05] px-1.5 py-px text-[10.5px] font-medium text-[#9a9aa8] transition-colors group-hover/ai:border-emerald-400/25 group-hover/ai:text-emerald-200/80">
        {hint}
      </kbd>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Engine switch + status                                              */
/* ------------------------------------------------------------------ */

function EngineSwitch({
  running,
  busy,
  disabled,
  label,
  onToggle,
}: {
  running: boolean;
  busy: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={running}
      aria-label={label}
      title={label}
      disabled={disabled || busy}
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-50 ${
        running
          ? "border-emerald-400/50 bg-emerald-400"
          : "border-white/[0.14] bg-white/[0.08] hover:bg-white/[0.12]"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full shadow transition-transform duration-200 motion-reduce:transition-none ${
          running ? "translate-x-5 bg-[#07130d]" : "translate-x-0 bg-[#c4c4ce]"
        } ${busy ? "animate-pulse" : ""}`}
      />
    </button>
  );
}

function statusDot(running: boolean, busy: boolean, unavailable: boolean) {
  if (busy) return "bg-amber-400 animate-pulse";
  if (unavailable) return "bg-amber-400";
  if (running) return "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]";
  return "bg-[#6b6b78]";
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                             */
/* ------------------------------------------------------------------ */

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const [copied, setCopied] = useState(false);
  const [geminiOpen, setGeminiOpen] = useState(false);

  const userToggled = useRef(false);
  const copyTimer = useRef<number | undefined>(undefined);
  const pathname = usePathname();

  const { engine, error, action, running, loading, toggle } = useProxyEngine();

  const unavailable = !engine && !!error;

  const statusText = unavailable
    ? "Backend offline"
    : action === "start"
      ? "Starting…"
      : action === "stop"
        ? "Stopping…"
        : running
          ? "Running"
          : "Stopped";

  const switchLabel = unavailable
    ? "Proxy engine unavailable"
    : running
      ? "Stop proxy engine"
      : "Start proxy engine";

  const engineTip = unavailable
    ? "Backend offline"
    : action
      ? statusText
      : running
        ? "Proxy running, click to stop"
        : "Proxy stopped, click to start";

  const address = `${engine?.host ?? "127.0.0.1"}:${engine?.port ?? 8080}`;
  const mod = isMac ? "⌘" : "Ctrl ";
  const toggleHint = `${mod}B`;
  const geminiHint = `${mod}G`;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(COLLAPSE_KEY);
      if (saved === "1" || saved === "0") {
        userToggled.current = true;
        setCollapsed(saved === "1");
      }
    } catch {
      // Storage unavailable: fall back to the responsive default.
    }

    const mq = window.matchMedia("(max-width: 1100px)");
    const apply = () => {
      if (!userToggled.current) setCollapsed(mq.matches);
    };

    apply();
    mq.addEventListener("change", apply);
    setIsMac(/Mac|iPhone|iPad/i.test(navigator.platform));
    const raf = requestAnimationFrame(() => setReady(true));

    return () => {
      mq.removeEventListener("change", apply);
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  function setCollapsedByUser(next: boolean) {
    userToggled.current = true;
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      // Ignore storage errors.
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key !== "b" && key !== "g") return;

      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      ) {
        return;
      }

      e.preventDefault();
      if (key === "b") setCollapsedByUser(!collapsed);
      else setGeminiOpen(true);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);

  // Open the AI modal when anything in the app fires an "Ask AI" request
  // (e.g. the Ask AI button in Repeater). The modal's own bridge listener
  // seeds the composer + attachment; this effect just flips it visible.
  useEffect(() => {
    return onGeminiAIRequest(() => {
      setGeminiOpen(true);
    });
  }, []);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard unavailable: nothing to do.
    }
  }

  const pillTone = unavailable
    ? "border-amber-400/25 bg-amber-400/10 text-amber-300"
    : running
      ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
      : "border-white/[0.08] bg-white/[0.04] text-[#9a9aa8]";

  return (
    <>
      <aside
        className={`${sans.className} relative flex h-full shrink-0 flex-col border-r border-white/[0.08] bg-[#111113] text-white ${
          ready
            ? "transition-[width] duration-200 ease-out motion-reduce:transition-none"
            : ""
        } ${collapsed ? "w-[68px]" : "w-[264px]"}`}
      >
        {/* Brand */}
        <div
          className={`flex h-[72px] shrink-0 items-center border-b border-white/[0.08] ${
            collapsed ? "justify-center" : "gap-3.5 px-4"
          }`}
        >
          <Tip label="PacketSniffer" enabled={collapsed} className="shrink-0">
            <Link
              href="/"
              aria-label="PacketSniffer home"
              className="relative flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-400/20 bg-gradient-to-br from-emerald-400/[0.14] to-[#101012] shadow-lg shadow-emerald-900/20 transition-colors hover:border-emerald-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
            >
              <RadioTower size={26} strokeWidth={1.8} color="#34d399" />
            </Link>
          </Tip>

          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-[21px] font-semibold leading-6 tracking-tight text-[#ececf1]">
                Packet<span className="text-emerald-400">Sniffer</span>
              </p>
              <p className="mt-0.5 truncate text-[12.5px] font-medium leading-4 text-[#9a9aa8]">
                Web Testing Toolkit
              </p>
            </div>
          )}
        </div>

        {/* Edge drag/click rail */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setCollapsedByUser(!collapsed)}
          className={`group/rail absolute inset-y-0 -right-[5px] z-20 w-[10px] focus:outline-none ${
            collapsed ? "cursor-e-resize" : "cursor-w-resize"
          }`}
        >
          <span className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-transparent transition-colors group-hover/rail:bg-emerald-400/40" />
        </button>

        {/* Collapse toggle */}
        <Tip
          key={collapsed ? "collapsed" : "expanded"}
          label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          hint={toggleHint}
          className="absolute -right-3 top-[60px] z-30"
        >
          <button
            type="button"
            onClick={() => setCollapsedByUser(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-white/[0.12] bg-[#1c1c20] text-[#9a9aa8] shadow-md shadow-black/30 transition-colors hover:border-emerald-400/40 hover:bg-[#232329] hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            <span
              className={`block h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none [&_svg]:h-3.5 [&_svg]:w-3.5 ${
                collapsed ? "rotate-180" : ""
              }`}
            >
              {icons.chevron}
            </span>
          </button>
        </Tip>

        {/* Primary navigation */}
        <nav
          aria-label="Primary"
          className="flex-1 overflow-y-auto px-3 py-4 [scrollbar-color:rgba(255,255,255,0.12)_transparent] [scrollbar-width:thin]"
        >
          {groups.map((group, gi) => (
            <div
              key={group.title}
              role="group"
              aria-label={group.title}
              className={gi > 0 ? "mt-5" : ""}
            >
              {collapsed ? (
                gi > 0 && (
                  <div className="mx-2 mb-3 border-t border-white/[0.08]" />
                )
              ) : (
                <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7c7c8a]">
                  {group.title}
                </p>
              )}

              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active =
                    !!item.href &&
                    (item.href === "/"
                      ? pathname === "/"
                      : pathname.startsWith(item.href));

                  return (
                    <li key={item.label}>
                      <NavRow
                        icon={item.icon}
                        label={item.label}
                        href={item.href}
                        active={active}
                        collapsed={collapsed}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Proxy engine section (engine + AI) */}
        <div
          role="group"
          aria-label="Proxy engine"
          className="shrink-0 border-t border-white/[0.08] bg-gradient-to-b from-transparent to-black/20 p-3"
        >
          {!collapsed && (
            <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7c7c8a]">
              Proxy engine
            </p>
          )}

          <div className="space-y-2">
            {collapsed ? (
              <Tip label={engineTip}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={running}
                  aria-label={switchLabel}
                  disabled={loading || unavailable}
                  onClick={() => void toggle()}
                  className={`relative flex h-10 w-full items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-60 ${
                    running
                      ? "border-emerald-400/25 bg-emerald-400/[0.10] text-emerald-300 hover:bg-emerald-400/[0.16]"
                      : "border-white/[0.08] bg-[#141416] text-[#a8a8b4] hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <Power size={18} strokeWidth={1.9} />
                  <span
                    aria-hidden="true"
                    className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ${statusDot(
                      running,
                      loading,
                      unavailable
                    )}`}
                  />
                </button>
              </Tip>
            ) : (
              <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#141416]">
                <div className="flex items-center gap-3 p-3">
                  <div
                    className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                      running
                        ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                        : "border-white/[0.08] bg-white/[0.04] text-[#9a9aa8]"
                    }`}
                  >
                    <Power size={17} strokeWidth={1.9} />
                    <span
                      aria-hidden="true"
                      className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#141416] ${statusDot(
                        running,
                        loading,
                        unavailable
                      )}`}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold leading-5 text-[#e5e5ec]">
                      Proxy engine
                    </p>
                    <span
                      aria-live="polite"
                      className={`mt-0.5 inline-flex max-w-full items-center rounded-full border px-2 py-px text-[11px] font-medium leading-4 ${pillTone}`}
                    >
                      <span className="truncate">{statusText}</span>
                    </span>
                  </div>

                  <EngineSwitch
                    running={running}
                    busy={loading}
                    disabled={unavailable}
                    label={switchLabel}
                    onToggle={() => void toggle()}
                  />
                </div>

                {unavailable && (
                  <p className="border-t border-white/[0.06] px-3 py-2.5 text-[12px] leading-4 text-[#9a9aa8]">
                    Start the backend service to use the proxy.
                  </p>
                )}

                {running && engine && (
                  <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] bg-black/20 px-3 py-2 text-[12px]">
                    <button
                      type="button"
                      onClick={() => void copyAddress()}
                      aria-label={`Copy proxy address ${address}`}
                      className="group/copy -mx-1.5 flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                    >
                      <span
                        className={`${mono.className} truncate text-[#d4d4dc]`}
                      >
                        {address}
                      </span>
                      {copied ? (
                        <Check
                          size={13}
                          strokeWidth={2}
                          className="shrink-0 text-emerald-400"
                        />
                      ) : (
                        <Copy
                          size={13}
                          strokeWidth={1.9}
                          className="shrink-0 text-[#8a8a98] opacity-0 transition-opacity group-hover/copy:opacity-100 group-focus-visible/copy:opacity-100"
                        />
                      )}
                    </button>
                    <span className="shrink-0 tabular-nums text-[#8a8a98]">
                      {engine.active_connections} conn.
                    </span>
                    <span className="sr-only" aria-live="polite">
                      {copied ? "Address copied" : ""}
                    </span>
                  </div>
                )}

                {error && !unavailable && (
                  <p className="border-t border-white/[0.06] px-3 py-2 text-[12px] text-amber-300/90">
                    {error}
                  </p>
                )}
              </div>
            )}

            <GeminiButton
              collapsed={collapsed}
              onOpen={() => setGeminiOpen(true)}
              hint={geminiHint}
            />
          </div>
        </div>
      </aside>

      <GeminiAIModal open={geminiOpen} onClose={() => setGeminiOpen(false)} />
    </>
  );
}
