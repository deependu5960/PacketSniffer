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

// Pehli paint se pehle chalti hai: Linux (Android nahi) par
// <html data-os="linux"> laga deti hai, taaki globals.css ke
// html[data-os="linux"] rules pehli frame se hi apply hon.
const osScript = `try{var u=navigator.userAgent;if(/Linux/.test(u)&&!/Android/.test(u)){document.documentElement.dataset.os="linux";}}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={geist.className} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: osScript }} />
      </head>
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
