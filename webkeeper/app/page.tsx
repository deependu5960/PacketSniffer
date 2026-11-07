"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bug,
  CheckCircle2,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  FileKey,
  FileText,
  Gauge,
  Globe,
  History,
  Info,
  KeyRound,
  Loader2,
  LockKeyhole,
  Monitor,
  Play,
  Radio,
  Repeat2,
  RotateCw,
  Server,
  ShieldCheck,
  Square,
  Timer,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";

import { useTraffic } from "@/components/TrafficProvider";

const API = "http://127.0.0.1:8765";

const certificateUrl =
  process.env.NEXT_PUBLIC_CERTIFICATE_DOWNLOAD_URL ||
  `${API}/api/certificate/download`;

const CERT_DOWNLOADED_KEY = "packetsniff.cert.downloaded";
const CERT_TRUSTED_KEY = "packetsniff.cert.trusted";

type EngineStatus = {
  running: boolean;
  host: string;
  port: number;
  active_connections: number;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function readFlag(key: string) {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    if (value) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    // Ignore storage errors.
  }
}

function goTo(id: string) {
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

function Metric({
  label,
  value,
  detail,
  icon: Icon,
  accent,
  tint,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: LucideIcon;
  accent: string;
  tint: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/[0.07] bg-[#171719] p-4">
      <div
        className={`pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full blur-2xl ${tint}`}
      />
      <div className="relative flex items-center justify-between">
        <p className="text-[13px] text-[#92929e]">{label}</p>
        <div className={`rounded-lg bg-white/[0.05] p-2 ${accent}`}>
          <Icon size={15} />
        </div>
      </div>
      <div className="relative mt-4 text-2xl font-semibold tracking-tight text-white">
        {value}
      </div>
      <p className="relative mt-1 text-xs text-[#777783]">{detail}</p>
    </div>
  );
}

function ToolLink({
  title,
  description,
  href,
  icon: Icon,
  accent,
}: {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  accent: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-white/[0.07] bg-[#171719] p-4 transition hover:border-emerald-400/25 hover:bg-[#1b1b1e]"
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] ${accent}`}
      >
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium text-[#e8e8ef]">{title}</h3>
        <p className="mt-1 text-xs text-[#858591]">{description}</p>
      </div>
      <ArrowRight
        size={15}
        className="shrink-0 text-[#666672] transition group-hover:translate-x-0.5 group-hover:text-emerald-400"
      />
    </Link>
  );
}

function SectionHeading({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-5 flex gap-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08] text-xs font-semibold text-emerald-300">
        {number}
      </div>
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-[#eeeef4]">
          {title}
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-[#898995]">
          {description}
        </p>
      </div>
    </div>
  );
}

function SpecItem({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: "default" | "good";
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-black/20 p-3">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          tone === "good" ? "bg-emerald-400/10" : "bg-white/[0.05]"
        }`}
      >
        <Icon
          size={17}
          className={tone === "good" ? "text-emerald-300" : "text-[#a6a6b2]"}
        />
      </div>
      <div className="min-w-0">
        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[#6c6c78]">
          {label}
        </p>
        <p className="truncate text-[13px] font-medium text-[#e2e2ea]">
          {value}
        </p>
      </div>
    </div>
  );
}

function TimelineStep({
  number,
  title,
  last = false,
  children,
}: {
  number: number;
  title: string;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="relative flex gap-4 pb-5 last:pb-0">
      {!last && (
        <span
          aria-hidden="true"
          className="absolute left-[15px] top-9 h-[calc(100%-2.25rem)] w-px bg-gradient-to-b from-emerald-400/40 to-white/[0.06]"
        />
      )}
      <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-emerald-400/30 bg-[#0f1a15] text-[13px] font-semibold text-emerald-300">
        {number}
      </div>
      <div className="min-w-0 flex-1 rounded-xl border border-white/[0.07] bg-[#17171a] p-4">
        <h3 className="text-sm font-semibold text-[#e8e8ef]">{title}</h3>
        <div className="mt-1.5 text-[13px] leading-6 text-[#92929e]">
          {children}
        </div>
      </div>
    </li>
  );
}

function PathChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-white/[0.1] bg-white/[0.05] px-2 py-0.5 text-[12px] font-medium text-[#dedee6]">
      {children}
    </span>
  );
}

function FaqItem({
  icon: Icon,
  iconClass,
  title,
  cause,
  fix,
}: {
  icon: LucideIcon;
  iconClass: string;
  title: string;
  cause: string;
  fix: string;
}) {
  return (
    <details className="group overflow-hidden rounded-xl border border-white/[0.08] bg-[#141416] transition open:border-white/[0.14]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 text-sm font-medium text-[#e0e0e8] hover:bg-white/[0.02]">
        <span className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.05]">
            <Icon size={16} className={iconClass} />
          </span>
          {title}
        </span>
        <ChevronRight
          size={17}
          className="shrink-0 text-[#777784] transition group-open:rotate-90"
        />
      </summary>
      <div className="grid gap-3 border-t border-white/[0.06] p-4 sm:grid-cols-2">
        <div className="rounded-lg bg-white/[0.03] p-3.5">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-amber-300/90">
            Likely cause
          </p>
          <p className="mt-1.5 text-xs leading-5 text-[#a0a0ac]">{cause}</p>
        </div>
        <div className="rounded-lg bg-emerald-400/[0.05] p-3.5">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-emerald-300">
            What to try
          </p>
          <p className="mt-1.5 text-xs leading-5 text-[#a0a0ac]">{fix}</p>
        </div>
      </div>
    </details>
  );
}

function CertificateIllustration() {
  return (
    <svg
      viewBox="0 0 520 380"
      role="img"
      aria-label="Illustration of the PacketSniffer root certificate authority certificate"
      className="h-auto w-full drop-shadow-[0_30px_60px_rgba(16,185,129,0.18)]"
    >
      <defs>
        <linearGradient id="cert-paper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1c2823" />
          <stop offset="1" stopColor="#111315" />
        </linearGradient>
        <linearGradient id="cert-accent" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6ee7b7" />
          <stop offset="1" stopColor="#059669" />
        </linearGradient>
        <linearGradient id="cert-seal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a7f3d0" />
          <stop offset="1" stopColor="#10b981" />
        </linearGradient>
        <radialGradient id="cert-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#34d399" stopOpacity="0.32" />
          <stop offset="1" stopColor="#34d399" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="260" cy="190" rx="255" ry="175" fill="url(#cert-glow)" />

      <g transform="rotate(-7 260 190)">
        <rect x="72" y="52" width="380" height="270" rx="20" fill="#151718" stroke="#ffffff" strokeOpacity="0.08" />
      </g>
      <g transform="rotate(4 260 190)">
        <rect x="66" y="46" width="388" height="280" rx="20" fill="#181b1a" stroke="#34d399" strokeOpacity="0.16" />
      </g>

      <rect x="60" y="40" width="400" height="290" rx="20" fill="url(#cert-paper)" stroke="url(#cert-accent)" strokeOpacity="0.7" strokeWidth="1.5" />
      <rect x="76" y="56" width="368" height="258" rx="12" fill="none" stroke="#34d399" strokeOpacity="0.2" strokeDasharray="4 5" />

      <g transform="translate(112 98)">
        <circle r="26" fill="#34d399" fillOpacity="0.1" stroke="#34d399" strokeOpacity="0.35" />
        <path d="M0 -15 L14 -9 V3 C14 11 7 17 0 20 C-7 17 -14 11 -14 3 V-9 Z" fill="none" stroke="#6ee7b7" strokeWidth="2" strokeLinejoin="round" />
        <path d="M-6 2 L-1 7 L7 -4" fill="none" stroke="#6ee7b7" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      <text x="152" y="92" fill="#34d399" fontSize="10.5" fontWeight="600" letterSpacing="3">PACKETSNIFFER</text>
      <text x="152" y="115" fill="#f1f1f5" fontSize="17" fontWeight="600">Root Certificate Authority</text>

      <line x1="92" y1="142" x2="428" y2="142" stroke="#ffffff" strokeOpacity="0.08" />

      <g fontSize="9" letterSpacing="1.6" fill="#777784" fontWeight="600">
        <text x="96" y="170">SUBJECT</text>
        <text x="96" y="204">TYPE</text>
        <text x="96" y="238">PURPOSE</text>
        <text x="96" y="272">PRIVATE KEY</text>
      </g>
      <g fontSize="12.5" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace">
        <text x="96" y="187" fill="#d8d8e0">PacketSniffer Local CA</text>
        <text x="96" y="221" fill="#d8d8e0">Root CA · X.509</text>
        <text x="96" y="255" fill="#d8d8e0">HTTPS inspection</text>
        <text x="96" y="289" fill="#6ee7b7">Kept locally</text>
      </g>

      <g fill="#ffffff" fillOpacity="0.07">
        <rect x="250" y="176" width="110" height="7" rx="3.5" />
        <rect x="250" y="192" width="74" height="7" rx="3.5" />
        <rect x="250" y="228" width="92" height="7" rx="3.5" />
      </g>

      <g transform="translate(386 266)">
        <path d="M-18 22 L-30 62 L-14 52 L-4 66 L6 26 Z" fill="#047857" />
        <path d="M18 22 L30 62 L14 52 L4 66 L-6 26 Z" fill="#059669" />
        <circle r="40" fill="url(#cert-seal)" />
        <circle r="32" fill="none" stroke="#04231a" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="2 4" />
        <path d="M-13 1 L-3 11 L14 -9" fill="none" stroke="#04231a" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      <g transform="translate(442 64)">
        <circle r="20" fill="#0d0d0f" stroke="#34d399" strokeOpacity="0.5" />
        <rect x="-7" y="-2" width="14" height="11" rx="2.5" fill="#6ee7b7" />
        <path d="M-4.5 -2 V-5 a4.5 4.5 0 0 1 9 0 V-2" fill="none" stroke="#6ee7b7" strokeWidth="2" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Setup progress (the pointer at the top)                             */
/* ------------------------------------------------------------------ */

type SetupStep = {
  id: string;
  title: string;
  hint: string;
  done: boolean;
  target: string;
  icon: LucideIcon;
};

function SetupProgress({
  steps,
  onToggleTrusted,
}: {
  steps: SetupStep[];
  onToggleTrusted: () => void;
}) {
  const doneCount = steps.filter((s) => s.done).length;
  const percent = Math.round((doneCount / steps.length) * 100);
  const nextIndex = steps.findIndex((s) => !s.done);

  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#151a18] via-[#151517] to-[#141416]">
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 pb-4 pt-5 md:px-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-emerald-300">
            Setup progress
          </p>
          <h2 className="mt-1.5 text-base font-semibold text-white">
            {doneCount === steps.length
              ? "Everything is ready"
              : "Get ready to inspect HTTPS traffic"}
          </h2>
        </div>

        <div className="flex items-center gap-3">
          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-300 transition-all duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="font-mono text-xs text-[#a1a1ad]">
            {doneCount}/{steps.length}
          </span>
        </div>
      </div>

      <div className="grid gap-px border-t border-white/[0.06] bg-white/[0.06] sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isNext = index === nextIndex;

          return (
            <div
              key={step.id}
              className={`relative flex flex-col gap-3 bg-[#131315] p-4 ${
                isNext ? "bg-[#14181a]" : ""
              }`}
            >
              {isNext && (
                <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/70 to-transparent" />
              )}

              <button
                type="button"
                onClick={() => goTo(step.target)}
                className="group flex items-start gap-3 text-left focus-visible:outline-none"
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                    step.done
                      ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-300"
                      : isNext
                        ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                        : "border-white/[0.08] bg-white/[0.04] text-[#8a8a98]"
                  }`}
                >
                  {step.done ? <CheckCircle2 size={17} /> : <Icon size={16} />}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-[13.5px] font-semibold text-[#e8e8ef] group-hover:text-white">
                      {step.title}
                    </span>
                    {isNext && (
                      <span className="rounded-full bg-amber-400/15 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-amber-300">
                        Next
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-[#858591]">
                    {step.hint}
                  </span>
                </span>
              </button>

              {step.id === "trust" && (
                <button
                  type="button"
                  onClick={onToggleTrusted}
                  className="ml-12 w-fit rounded-md border border-white/[0.1] bg-white/[0.04] px-2.5 py-1 text-[11.5px] font-medium text-[#c4c4ce] transition hover:bg-white/[0.08] hover:text-white"
                >
                  {step.done ? "Mark as not done" : "Mark as done"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Response breakdown (visual)                                         */
/* ------------------------------------------------------------------ */

function ResponseBreakdown({
  groups,
  total,
}: {
  groups: { label: string; count: number; bar: string; text: string }[];
  total: number;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#171719] p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[#e5e5ec]">
            Response breakdown
          </h3>
          <p className="mt-1 text-xs text-[#858591]">
            Status classes across captured requests
          </p>
        </div>
        <span className="font-mono text-xs text-[#777783]">{total} total</span>
      </div>

      <div className="mt-5 flex h-3 w-full overflow-hidden rounded-full bg-white/[0.06]">
        {total > 0 &&
          groups
            .filter((g) => g.count > 0)
            .map((g) => (
              <div
                key={g.label}
                className={`${g.bar} h-full transition-all duration-500`}
                style={{ width: `${(g.count / total) * 100}%` }}
                title={`${g.label}: ${g.count}`}
              />
            ))}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${g.bar}`} />
              <span className="text-[11px] text-[#858591]">{g.label}</span>
            </div>
            <p className={`mt-1 font-mono text-lg font-semibold ${g.text}`}>
              {g.count.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {total === 0 && (
        <p className="mt-4 text-xs text-[#666672]">
          Nothing captured yet. Start the proxy and browse a site.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Home() {
  const { interceptOn, queue, history } = useTraffic();

  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [engineLoading, setEngineLoading] = useState(false);
  const [engineError, setEngineError] = useState("");

  const [certLoading, setCertLoading] = useState(false);
  const [certDownloaded, setCertDownloaded] = useState(false);
  const [certTrusted, setCertTrusted] = useState(false);
  const [browserTab, setBrowserTab] = useState<"firefox" | "chromium">(
    "firefox"
  );
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const refreshStatus = async () => {
    try {
      const response = await fetch(`${API}/api/status`, { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to read proxy status");
      const data = await response.json();
      setEngine(data.proxy);
      setEngineError("");
    } catch {
      setEngine(null);
      setEngineError("Backend unavailable");
    }
  };

  useEffect(() => {
    void refreshStatus();
    const interval = setInterval(() => {
      void refreshStatus();
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setCertDownloaded(readFlag(CERT_DOWNLOADED_KEY));
    setCertTrusted(readFlag(CERT_TRUSTED_KEY));
  }, []);

  useEffect(() => {
    if (!notification) return;
    const t = window.setTimeout(() => setNotification(null), 6000);
    return () => window.clearTimeout(t);
  }, [notification]);

  const controlEngine = async (action: "start" | "stop") => {
    setEngineLoading(true);
    setEngineError("");
    try {
      const response = await fetch(`${API}/api/proxy/${action}`, {
        method: "POST",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.detail || `Unable to ${action} proxy`);
      }
      await refreshStatus();
    } catch (error) {
      setEngineError(
        error instanceof Error ? error.message : "Proxy control failed"
      );
      await refreshStatus();
    } finally {
      setEngineLoading(false);
    }
  };

  async function downloadCertificate() {
    setCertLoading(true);
    setNotification(null);
    try {
      const response = await fetch(certificateUrl);
      if (!response.ok) {
        throw new Error(`Certificate download failed: ${response.status}`);
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error("The downloaded certificate is empty.");

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = "packetsniff-ca.crt";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

      setCertDownloaded(true);
      writeFlag(CERT_DOWNLOADED_KEY, true);
      setNotification({
        type: "success",
        message: "Saved to your Downloads folder as packetsniff-ca.crt.",
      });
    } catch (error) {
      console.error("Certificate download error:", error);
      setNotification({
        type: "error",
        message:
          "Could not download the certificate. Make sure PacketSniffer's backend is running.",
      });
    } finally {
      setCertLoading(false);
    }
  }

  function toggleTrusted() {
    const next = !certTrusted;
    setCertTrusted(next);
    writeFlag(CERT_TRUSTED_KEY, next);
  }

  /* ----------------------------- derived ---------------------------- */

  const running = engine?.running ?? false;
  const captured = history.length;

  const stats = useMemo(() => {
    let s2 = 0;
    let s3 = 0;
    let s4 = 0;
    let s5 = 0;
    let pending = 0;
    let durationSum = 0;
    let durationCount = 0;

    for (const item of history) {
      const st = item.status;
      if (st === null || st === undefined) pending++;
      else if (st >= 500) s5++;
      else if (st >= 400) s4++;
      else if (st >= 300) s3++;
      else if (st >= 200) s2++;

      if (typeof item.duration === "number") {
        durationSum += item.duration;
        durationCount++;
      }
    }

    const answered = s2 + s3 + s4 + s5;
    return {
      s2,
      s3,
      s4,
      s5,
      pending,
      successful: s2 + s3,
      errors: s4 + s5,
      successRate: answered ? Math.round(((s2 + s3) / answered) * 100) : null,
      avgDuration: durationCount ? Math.round(durationSum / durationCount) : null,
    };
  }, [history]);

  const setupSteps: SetupStep[] = [
    {
      id: "proxy",
      title: "Start the proxy",
      hint: running
        ? `Listening on ${engine?.host ?? "127.0.0.1"}:${engine?.port ?? 8080}`
        : "Launch the local listener.",
      done: running,
      target: "proxy",
      icon: Play,
    },
    {
      id: "download",
      title: "Download the CA",
      hint: certDownloaded
        ? "packetsniff-ca.crt saved."
        : "Get the public certificate.",
      done: certDownloaded,
      target: "certificate",
      icon: Download,
    },
    {
      id: "trust",
      title: "Trust it in Firefox",
      hint: certTrusted
        ? "Browser trust configured."
        : "Import it as an authority.",
      done: certTrusted,
      target: "installation",
      icon: LockKeyhole,
    },
    {
      id: "capture",
      title: "Capture HTTPS traffic",
      hint:
        captured > 0
          ? `${captured.toLocaleString()} requests recorded.`
          : "Browse a site through the proxy.",
      done: captured > 0,
      target: "tools",
      icon: Radio,
    },
  ];

  const groups = [
    { label: "2xx", count: stats.s2, bar: "bg-emerald-400", text: "text-emerald-300" },
    { label: "3xx", count: stats.s3, bar: "bg-sky-400", text: "text-sky-300" },
    { label: "4xx", count: stats.s4, bar: "bg-amber-400", text: "text-amber-300" },
    { label: "5xx", count: stats.s5, bar: "bg-rose-400", text: "text-rose-300" },
    { label: "Pending", count: stats.pending, bar: "bg-[#5c5c68]", text: "text-[#a1a1ad]" },
  ];

  return (
    <main className="min-h-full w-full px-5 py-6 md:px-8 md:py-8">
      <div className="mx-auto w-full max-w-[1400px] space-y-7">
        {/* Page header */}
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs tracking-wide text-[#777783]">
              PACKET SNIFFER / WORKSPACE
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              Dashboard
            </h1>
            <p className="mt-1 text-sm text-[#858591]">
              Proxy control, HTTPS certificate setup and session health.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                interceptOn
                  ? "border-amber-400/25 bg-amber-400/10"
                  : "border-white/[0.08] bg-[#171719]"
              }`}
            >
              <Radio
                size={14}
                className={interceptOn ? "text-amber-300" : "text-[#777783]"}
              />
              <span className="text-xs text-[#c4c4ce]">
                Intercept {interceptOn ? "on" : "off"}
              </span>
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#171719] px-3 py-2">
              {running ? (
                <Wifi size={15} className="text-emerald-400" />
              ) : (
                <WifiOff size={15} className="text-[#777783]" />
              )}
              <span className="text-xs text-[#c4c4ce]">
                {engineError || (running ? "Proxy online" : "Proxy offline")}
              </span>
            </div>
          </div>
        </header>

        {/* Proxy engine */}
        <section
          id="proxy"
          className="scroll-mt-6 relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#171a19] p-5 md:p-6"
        >
          <div
            className={`pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full blur-3xl ${
              running ? "bg-emerald-400/[0.08]" : "bg-white/[0.02]"
            }`}
          />
          <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    running
                      ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.55)]"
                      : "bg-[#777783]"
                  }`}
                />
                <span className="text-xs font-medium uppercase tracking-wider text-[#a1a1ad]">
                  Proxy engine
                </span>
              </div>

              <h2 className="mt-3 text-xl font-semibold text-white">
                {running ? "Ready to capture traffic" : "Start your proxy"}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#92929e]">
                {running
                  ? "Route your browser through PacketSniffer to capture and inspect HTTP and HTTPS traffic."
                  : "Start the local proxy, then configure your browser to use the listener below."}
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <div className="rounded-md border border-white/[0.07] bg-black/20 px-3 py-2">
                  <span className="mr-2 text-xs text-[#777783]">Listener</span>
                  <span className="font-mono text-xs text-[#d4d4dc]">
                    {engine?.host ?? "127.0.0.1"}:{engine?.port ?? 8080}
                  </span>
                </div>
                <div className="rounded-md border border-white/[0.07] bg-black/20 px-3 py-2">
                  <span className="mr-2 text-xs text-[#777783]">Connections</span>
                  <span className="font-mono text-xs text-[#d4d4dc]">
                    {engine?.active_connections ?? 0}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-2 md:w-44">
              <button
                onClick={() => void controlEngine(running ? "stop" : "start")}
                disabled={engineLoading || (!engine && !!engineError)}
                className={`flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  running
                    ? "border border-rose-400/20 bg-rose-400/10 text-rose-300 hover:bg-rose-400/15"
                    : "bg-emerald-400 text-[#07130d] hover:bg-emerald-300"
                }`}
              >
                {engineLoading ? (
                  <Activity size={16} className="animate-pulse" />
                ) : running ? (
                  <Square size={14} />
                ) : (
                  <Play size={16} />
                )}
                {engineLoading
                  ? "Please wait"
                  : running
                    ? "Stop proxy"
                    : "Start proxy"}
              </button>
              <p className="text-center text-[11px] text-[#777783]">
                Status updates automatically
              </p>
            </div>
          </div>
        </section>

        {/* Setup pointer */}
        <SetupProgress steps={setupSteps} onToggleTrusted={toggleTrusted} />

        {/* Session overview */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#e5e5ec]">
              Session overview
            </h2>
            <span className="text-xs text-[#777783]">Current history</span>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric
              label="Requests captured"
              value={captured.toLocaleString()}
              detail="Recorded this session"
              icon={Activity}
              accent="text-emerald-400"
              tint="bg-emerald-400/20"
            />
            <Metric
              label="Success rate"
              value={stats.successRate === null ? "—" : `${stats.successRate}%`}
              detail="2xx and 3xx of answered"
              icon={ShieldCheck}
              accent="text-cyan-400"
              tint="bg-cyan-400/20"
            />
            <Metric
              label="Avg response time"
              value={stats.avgDuration === null ? "—" : `${stats.avgDuration} ms`}
              detail="Across captured requests"
              icon={Timer}
              accent="text-violet-400"
              tint="bg-violet-400/20"
            />
            <Metric
              label="Waiting in queue"
              value={queue.length.toLocaleString()}
              detail={interceptOn ? "Held by the interceptor" : "Interceptor is off"}
              icon={Gauge}
              accent="text-amber-400"
              tint="bg-amber-400/20"
            />
          </div>

          <div className="mt-3">
            <ResponseBreakdown groups={groups} total={captured} />
          </div>
        </section>

        {/* Testing tools */}
        <section id="tools" className="scroll-mt-6">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-[#e5e5ec]">
              Testing tools
            </h2>
            <p className="mt-1 text-xs text-[#858591]">
              Open a workspace to continue testing.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ToolLink
              title="Interceptor"
              description={`Inspect and control requests${queue.length ? ` · ${queue.length} waiting` : ""}`}
              href="/interceptor"
              icon={Radio}
              accent="text-emerald-400"
            />
            <ToolLink
              title="HTTP History"
              description="Browse captured requests and responses"
              href="/http-history"
              icon={History}
              accent="text-cyan-400"
            />
          </div>
        </section>

        {/* ------------------------ Certificate ------------------------ */}
        <div className="flex items-center gap-4 pt-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08]">
            <ShieldCheck size={20} className="text-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight text-[#eeeef4]">
              HTTPS Certificate
            </h2>
            <p className="text-sm text-[#898995]">
              Trust PacketSniffer&apos;s local certificate authority to inspect
              HTTPS traffic.
            </p>
          </div>
          <div className="hidden h-px flex-1 bg-white/[0.07] md:block" />
        </div>

        {/* Download */}
        <section id="certificate" className="scroll-mt-6">
          <SectionHeading
            number="01"
            title="Download certificate"
            description="Download the public PacketSniffer CA certificate. You will manually import this file into a supported browser."
          />

          <div className="overflow-hidden rounded-3xl border border-white/[0.08] bg-[#121315]">
            <div className="grid lg:grid-cols-[1.05fr_1fr]">
              <div
                className="relative flex items-center justify-center overflow-hidden border-b border-white/[0.07] p-6 sm:p-10 lg:border-b-0 lg:border-r"
                style={{
                  backgroundImage:
                    "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
                  backgroundSize: "28px 28px",
                }}
              >
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-400/[0.06] via-transparent to-transparent" />
                <div className="relative w-full max-w-[460px] transition-transform duration-500 hover:scale-[1.02]">
                  <CertificateIllustration />
                </div>
              </div>

              <div className="flex flex-col p-6 sm:p-8">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Public certificate
                  </span>
                  {certDownloaded && (
                    <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-sky-400/20 bg-sky-400/[0.08] px-3 py-1 text-[11px] font-semibold text-sky-300">
                      <CheckCircle2 size={12} />
                      Downloaded
                    </span>
                  )}
                </div>

                <h3 className="mt-4 text-xl font-semibold tracking-tight text-white">
                  PacketSniffer CA Certificate
                </h3>
                <p className="mt-2 text-sm leading-6 text-[#92929e]">
                  This is the public certificate your browser needs to trust.
                  The private key is never included in this download.
                </p>

                <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <SpecItem icon={FileText} label="File name" value="packetsniff-ca.crt" />
                  <SpecItem icon={FileKey} label="Format" value="PEM / CRT" />
                  <SpecItem icon={Eye} label="Contains" value="Public certificate" tone="good" />
                  <SpecItem icon={EyeOff} label="Private key" value="Not included" tone="good" />
                </div>

                <div className="mt-6">
                  <button
                    type="button"
                    onClick={downloadCertificate}
                    disabled={certLoading}
                    className="group relative inline-flex w-full items-center justify-center gap-3 overflow-hidden rounded-xl bg-gradient-to-b from-emerald-300 to-emerald-500 px-6 py-4 text-[15px] font-semibold text-[#04231a] shadow-[0_12px_32px_-10px_rgba(52,211,153,0.7)] ring-1 ring-inset ring-white/30 transition hover:from-emerald-200 hover:to-emerald-400 hover:shadow-[0_16px_40px_-10px_rgba(52,211,153,0.85)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                    <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-black/10">
                      {certLoading ? (
                        <Loader2 size={18} className="animate-spin" />
                      ) : (
                        <Download size={18} />
                      )}
                    </span>
                    <span className="relative">
                      {certLoading
                        ? "Downloading..."
                        : certDownloaded
                          ? "Download again"
                          : "Download certificate"}
                    </span>
                  </button>

                  <p className="mt-3 text-center text-[11.5px] text-[#6c6c78]">
                    Next: import it in{" "}
                    <button
                      type="button"
                      onClick={() => goTo("installation")}
                      className="font-medium text-emerald-300 transition hover:text-emerald-200"
                    >
                      step 02
                    </button>
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3 border-t border-white/[0.07] bg-sky-400/[0.04] px-6 py-4">
              <Info size={17} className="mt-0.5 shrink-0 text-sky-300" />
              <p className="text-xs leading-5 text-[#a0a0ac]">
                Downloading only saves the certificate file. It does not
                install it or change any browser or Windows trust settings.
              </p>
            </div>
          </div>
        </section>

        {/* Installation */}
        <section id="installation" className="scroll-mt-6">
          <SectionHeading
            number="02"
            title="Import the certificate"
            description="Choose your browser. Firefox can use its own certificate authority store, so no changes to the Windows certificate store are needed."
          />

          <div
            role="tablist"
            aria-label="Browser"
            className="mb-5 inline-flex rounded-xl border border-white/[0.08] bg-[#141416] p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={browserTab === "firefox"}
              onClick={() => setBrowserTab("firefox")}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition ${
                browserTab === "firefox"
                  ? "bg-orange-400/10 text-orange-200"
                  : "text-[#8a8a98] hover:text-white"
              }`}
            >
              <Globe size={15} />
              Firefox
              <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                Recommended
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={browserTab === "chromium"}
              onClick={() => setBrowserTab("chromium")}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition ${
                browserTab === "chromium"
                  ? "bg-amber-400/10 text-amber-200"
                  : "text-[#8a8a98] hover:text-white"
              }`}
            >
              <Monitor size={15} />
              Chrome &amp; Edge
            </button>
          </div>

          {browserTab === "firefox" ? (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_260px]">
              <ol>
                <TimelineStep number={1} title="Open Firefox settings">
                  Open the Firefox menu and select{" "}
                  <PathChip>Settings → Privacy &amp; Security</PathChip>.
                </TimelineStep>
                <TimelineStep number={2} title="Find certificates">
                  Scroll down to the Certificates section and click{" "}
                  <PathChip>View Certificates</PathChip>.
                </TimelineStep>
                <TimelineStep number={3} title="Import the CA">
                  Open the <PathChip>Authorities</PathChip> tab and click{" "}
                  <PathChip>Import</PathChip>. Select the downloaded{" "}
                  <code className="rounded bg-black/30 px-1.5 py-0.5 text-emerald-300">
                    packetsniff-ca.crt
                  </code>{" "}
                  file.
                </TimelineStep>
                <TimelineStep number={4} title="Enable website trust">
                  Enable the option to trust this CA to identify websites.
                  Confirm the import.
                </TimelineStep>
                <TimelineStep number={5} title="Restart Firefox" last>
                  Close and reopen Firefox before testing HTTPS interception.
                </TimelineStep>
              </ol>

              <aside className="h-fit space-y-3 rounded-2xl border border-white/[0.08] bg-[#141416] p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-400/10">
                    <Globe size={20} className="text-orange-300" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#e5e5ec]">
                      Mozilla Firefox
                    </p>
                    <p className="text-[11.5px] text-[#858592]">
                      Own certificate store
                    </p>
                  </div>
                </div>
                <div className="border-t border-white/[0.07] pt-3 text-xs leading-5 text-[#92929e]">
                  <p className="mb-2 font-medium text-[#c4c4ce]">Quick path</p>
                  Settings → Privacy &amp; Security → View Certificates →
                  Authorities → Import
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-2 text-[11.5px] text-[#a0a0ac]">
                  <RotateCw size={13} className="shrink-0 text-emerald-300" />
                  About 2 minutes, restart required
                </div>
              </aside>
            </div>
          ) : (
            <div className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.04] p-5 md:p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-400/10">
                  <Monitor size={22} className="text-amber-300" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-amber-200">
                    Chrome and Microsoft Edge
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-[#aaa5a0]">
                    On Windows, Chrome and Edge generally use the Windows
                    certificate trust store. Importing a CA for these browsers
                    normally requires adding it to that store. PacketSniffer
                    will not make that system-level change automatically.
                  </p>
                  <p className="mt-3 text-xs leading-5 text-[#92929e]">
                    For the current setup, use Firefox with its own certificate
                    store if you want browser-specific trust without modifying
                    Windows trust settings.
                  </p>
                  <button
                    type="button"
                    onClick={() => setBrowserTab("firefox")}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.05] px-4 py-2 text-xs font-medium text-[#e0e0e8] transition hover:bg-white/[0.09]"
                  >
                    Show Firefox steps
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Troubleshooting */}
        <section id="troubleshooting" className="scroll-mt-6">
          <SectionHeading
            number="03"
            title="Troubleshooting"
            description="Common problems you may encounter while configuring HTTPS interception."
          />

          <div className="space-y-3">
            <FaqItem
              icon={AlertTriangle}
              iconClass="text-amber-300"
              title="Browser shows a certificate warning"
              cause="The CA was not imported correctly, or it is not trusted for identifying websites."
              fix="Check that you imported the correct PacketSniffer CA certificate and enabled the option to trust it for identifying websites. Restart Firefox after importing."
            />
            <FaqItem
              icon={Radio}
              iconClass="text-sky-300"
              title="HTTPS requests are not appearing"
              cause="Traffic is not reaching the proxy, so there is nothing to record."
              fix="Check that the proxy is running, Firefox is configured to use the correct proxy listener, and the website is generating traffic through that browser."
            />
            <FaqItem
              icon={LockKeyhole}
              iconClass="text-violet-300"
              title="Some websites still fail to load"
              cause="Some applications use certificate pinning, custom trust stores, or other restrictions."
              fix="These restrictions can block proxy-based HTTPS interception even when the CA is installed correctly. This is expected for those sites."
            />
          </div>
        </section>

        {/* Security notice */}
        <section id="security" className="scroll-mt-6">
          <div className="overflow-hidden rounded-2xl border border-amber-400/15 bg-amber-400/[0.04]">
            <div className="flex items-start gap-4 p-5 md:p-6">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-400/10">
                <AlertTriangle size={22} className="text-amber-300" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-amber-200">
                  Security notice
                </h3>
                <p className="mt-2 text-xs leading-6 text-[#aaa5a0]">
                  A trusted interception CA can issue certificates for
                  websites, so treat it carefully.
                </p>
              </div>
            </div>

            <div className="grid gap-px border-t border-amber-400/10 bg-amber-400/10 sm:grid-cols-3">
              {[
                {
                  icon: Server,
                  title: "Trust only your own devices",
                  body: "Only trust the PacketSniffer CA on devices and browsers you control.",
                },
                {
                  icon: KeyRound,
                  title: "Protect the private key",
                  body: "Keep the private key secret and restrict access to it.",
                },
                {
                  icon: Trash2,
                  title: "Remove it when done",
                  body: "Remove the CA from your browser when you no longer need HTTPS interception.",
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="bg-[#14130f] p-5">
                    <Icon size={18} className="text-amber-300" />
                    <p className="mt-3 text-[13px] font-semibold text-[#e8e2d4]">
                      {item.title}
                    </p>
                    <p className="mt-1.5 text-xs leading-5 text-[#9d9890]">
                      {item.body}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4 text-[10px] text-[#666672]">
          <span>PacketSniffer · Web Testing Toolkit</span>
          <span>Use only on systems you own or are authorized to test.</span>
        </footer>
      </div>

      {/* Download notification */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-[200] w-[min(380px,calc(100vw-32px))]">
          <div
            role="status"
            className={`flex items-start gap-3 rounded-xl border p-4 shadow-2xl backdrop-blur-xl ${
              notification.type === "success"
                ? "border-emerald-400/20 bg-[#171f1b] text-emerald-300"
                : "border-red-400/20 bg-[#211718] text-red-300"
            }`}
          >
            {notification.type === "success" ? (
              <CheckCircle2 size={21} className="mt-0.5 shrink-0" />
            ) : (
              <AlertCircle size={21} className="mt-0.5 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {notification.type === "success"
                  ? "Certificate downloaded"
                  : "Download failed"}
              </p>
              <p className="mt-1 text-xs leading-5 text-[#b5b5c0]">
                {notification.message}
              </p>
            </div>
            <button
              onClick={() => setNotification(null)}
              className="rounded-md p-1 text-[#858592] transition hover:bg-white/[0.08] hover:text-white"
              aria-label="Dismiss notification"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
