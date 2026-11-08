import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import { TrafficProvider } from "@/components/TrafficProvider";
import FirstLaunchCertificatePrompt from "@/components/FirstLaunchCertificatePrompt";
import LinuxRenderFixes from "@/components/LinuxRenderFixes";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "PacketSniffer",
    template: "%s | PacketSniffer",
  },
  description:
    "PacketSniffer — Security workbench for inspecting and modifying HTTP traffic.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={geist.className}>
      <body className="flex h-screen overflow-hidden bg-[#0c0c0e] text-[#ececf1] antialiased">
        <LinuxRenderFixes />
        <TrafficProvider>
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
            {children}
          </main>

          <FirstLaunchCertificatePrompt />
        </TrafficProvider>
      </body>
    </html>
  );
}