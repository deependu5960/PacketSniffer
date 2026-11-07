'use client';

import type { ReactNode } from "react";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";

/* ------------------------------ Fonts ------------------------------ */
export const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});
export const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

/* ----------------------------- Buttons ----------------------------- */
export const btnBase =
  "inline-flex h-10 items-center justify-center rounded-lg px-4 text-[14.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-40";

export const btnPrimary = `${btnBase} bg-emerald-400 text-[#07110b] hover:bg-emerald-300`;
export const btnOutline = `${btnBase} border border-white/[0.12] text-white hover:bg-white/[0.06]`;
export const btnDanger = `${btnBase} border border-rose-400/40 text-rose-300 hover:bg-rose-400/10`;
export const btnGhost = `${btnBase} text-[#b4b4c0] hover:bg-white/[0.06] hover:text-white`;

/* ------------------------------ Header ----------------------------- */
// Same 84px height as the sidebar brand block, so the two borders line up.
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex h-[84px] shrink-0 items-center justify-between gap-6 border-b border-white/[0.08] px-8">
      <div className="min-w-0">
        <h1 className="text-[24px] font-semibold leading-7 tracking-tight">{title}</h1>
        <p className="mt-0.5 truncate text-[14.5px] text-[#9a9aa8]">{subtitle}</p>
      </div>
      {children && <div className="flex items-center gap-4">{children}</div>}
    </header>
  );
}

export function ListenerPill() {
  return (
    <div className="hidden items-center gap-2.5 rounded-lg border border-white/[0.08] bg-[#141416] px-3.5 py-2 md:flex">
      <span className="text-[14px] text-[#9a9aa8]">Listener</span>
      <span className={`${mono.className} text-[14px] font-medium text-white`}>
        127.0.0.1:8080
      </span>
    </div>
  );
}

/* ------------------------------ Badges ----------------------------- */
const methodStyles: Record<string, string> = {
  GET: "bg-emerald-400/10 text-emerald-300 border-emerald-400/25",
  POST: "bg-sky-400/10 text-sky-300 border-sky-400/25",
  PUT: "bg-amber-400/10 text-amber-300 border-amber-400/25",
  DELETE: "bg-rose-400/10 text-rose-300 border-rose-400/25",
};

export function MethodBadge({ method }: { method: string }) {
  return (
    <span
      className={`inline-flex min-w-[64px] justify-center rounded-md border px-2 py-0.5 text-[13px] font-semibold ${
        methodStyles[method] ?? "bg-white/5 text-[#b4b4c0] border-white/10"
      }`}
    >
      {method}
    </span>
  );
}

/* --------------------------- Segmented control --------------------- */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-white/[0.08] bg-[#141416] p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3.5 py-1.5 text-[14px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 ${
            value === o.value ? "bg-white/[0.09] text-white" : "text-[#9a9aa8] hover:text-white"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------- Empty state ------------------------- */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <p className="text-[18px] font-semibold text-white">{title}</p>
      <p className="mt-2 max-w-[420px] text-[15px] leading-6 text-[#9a9aa8]">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
