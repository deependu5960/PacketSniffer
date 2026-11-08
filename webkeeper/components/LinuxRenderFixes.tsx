"use client";

import { useEffect } from "react";

import { isLinuxPlatform } from "@/components/certificateDownload";

/**
 * Marks the document with data-os="linux" so globals.css can switch off the
 * heavy CSS filter effects (large blurs, drop shadows, backdrop blur).
 *
 * WebKitGTK paints those effects badly in several Linux setups (virtual
 * machines, software rendering): regions of the window are left unpainted and
 * the desktop shows through. The effects are purely decorative, so on Linux
 * they are simply not drawn. Windows and browsers are not affected.
 */
export default function LinuxRenderFixes() {
  useEffect(() => {
    if (isLinuxPlatform()) {
      document.documentElement.dataset.os = "linux";
    }
  }, []);

  return null;
}
