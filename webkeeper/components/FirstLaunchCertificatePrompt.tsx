
"use client";

import { useEffect, useState } from "react";
import {
  ShieldCheck,
  Download,
  X,
  ExternalLink,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

const CERTIFICATE_URL =
  process.env.NEXT_PUBLIC_CERTIFICATE_DOWNLOAD_URL ||
  "http://127.0.0.1:8765/api/certificate/download";

const STORAGE_KEY = "certificate-prompt-dismissed";

export default function FirstLaunchCertificatePrompt() {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    let active = true;

    async function checkFirstLaunch() {
      try {
        if ("__TAURI_INTERNALS__" in window) {
          const { load } = await import("@tauri-apps/plugin-store");

          const store = await load("settings.json", {
            defaults: {},
            autoSave: true,
          });

          const dismissed = await store.get<boolean>(STORAGE_KEY);

          if (active && !dismissed) {
            setVisible(true);
          }

          return;
        }

        const dismissed = localStorage.getItem(STORAGE_KEY);

        if (active && !dismissed) {
          setVisible(true);
        }
      } catch (error) {
        console.error("Could not check certificate prompt state:", error);
      }
    }

    checkFirstLaunch();

    return () => {
      active = false;
    };
  }, []);

  async function dismissPrompt() {
    try {
      if ("__TAURI_INTERNALS__" in window) {
        const { load } = await import("@tauri-apps/plugin-store");

        const store = await load("settings.json", {
          defaults: {},
          autoSave: true,
        });

        await store.set(STORAGE_KEY, true);
        await store.save();
      } else {
        localStorage.setItem(STORAGE_KEY, "true");
      }

      setVisible(false);
    } catch (error) {
      console.error("Could not save certificate prompt state:", error);
    }
  }

  async function downloadCertificate() {
    setLoading(true);
    setNotification(null);

    try {
      const response = await fetch(CERTIFICATE_URL);

      if (!response.ok) {
        throw new Error(`Certificate download failed: ${response.status}`);
      }

      const blob = await response.blob();

      if (!blob.size) {
        throw new Error("The downloaded certificate is empty.");
      }

      const objectUrl = URL.createObjectURL(blob);

      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = "packetsniff-ca.crt";

      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 1000);

      setNotification({
        type: "success",
        message: "Certificate downloaded to your Downloads folder.",
      });

      await dismissPrompt();
    } catch (error) {
      console.error("Certificate download error:", error);

      setNotification({
        type: "error",
        message:
          "Download failed. Make sure PacketSniffer's backend is running.",
      });
    } finally {
      setLoading(false);
    }
  }

  if (!visible && !notification) return null;

  return (
    <>
      {visible && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/[0.09] bg-[#171719] p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/[0.09]">
                <ShieldCheck size={25} className="text-emerald-300" />
              </div>

              <button
                onClick={dismissPrompt}
                className="rounded-lg p-2 text-[#858592] transition hover:bg-white/[0.06] hover:text-white"
                aria-label="Close"
              >
                <X size={19} />
              </button>
            </div>

            <h2 className="text-xl font-semibold text-white">
              Enable HTTPS inspection
            </h2>

            <p className="mt-2 text-sm leading-6 text-[#a0a0ac]">
              Download the PacketSniffer Root CA certificate to enable
              HTTPS traffic inspection in your browser.
            </p>

            <div className="mt-5 flex items-center gap-3 rounded-xl border border-white/[0.07] bg-[#101012] p-4">
              <ShieldCheck size={22} className="shrink-0 text-emerald-300" />

              <div className="min-w-0">
                <p className="text-sm font-medium text-[#e5e5ec]">
                  PacketSniffer Root CA
                </p>
                <p className="mt-1 text-xs text-[#858592]">
                  Public certificate · .crt file
                </p>
              </div>
            </div>

            <div className="mt-5 flex gap-3 rounded-lg border border-amber-400/15 bg-amber-400/[0.04] p-3">
              <ShieldCheck
                size={16}
                className="mt-0.5 shrink-0 text-amber-300"
              />

              <p className="text-xs leading-5 text-[#aaa5a0]">
                Downloading does not install the certificate. You must
                manually import it into your browser's certificate settings.
                Only trust certificates on devices you control.
              </p>
            </div>

            <button
              onClick={downloadCertificate}
              disabled={loading}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-400 px-4 py-3 text-sm font-semibold text-[#062016] transition hover:bg-emerald-300 disabled:opacity-60"
            >
              {loading ? (
                <Loader2 size={17} className="animate-spin" />
              ) : (
                <Download size={17} />
              )}

              {loading ? "Downloading..." : "Download certificate"}
            </button>

            <button
              onClick={dismissPrompt}
              disabled={loading}
              className="mt-2 w-full rounded-lg border border-white/[0.08] px-4 py-3 text-sm font-medium text-[#b5b5c0] transition hover:bg-white/[0.05] disabled:opacity-60"
            >
              Not now
            </button>

            <a
              href="/settings/certificate"
              onClick={dismissPrompt}
              className="mt-4 flex items-center justify-center gap-1.5 text-xs text-[#858592] transition hover:text-white"
            >
              View installation instructions
              <ExternalLink size={12} />
            </a>
          </div>
        </div>
      )}

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
    </>
  );
}
