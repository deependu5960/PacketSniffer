// Helpers for handing the PacketSniffer Root CA certificate to the user.
//
// On Windows (WebView2) and in a normal browser, a blob + <a download> link
// saves the file. The Linux desktop app renders with WebKitGTK, which does not
// reliably handle that, so there the backend copies the (public) certificate
// into the user's Downloads folder and reports the exact path.

/** True when running on a Linux machine (used to pick the right instructions). */
export function isLinuxPlatform(): boolean {
  if (typeof navigator === "undefined") return false;

  const userAgent = navigator.userAgent || "";

  return /Linux|X11/i.test(userAgent) && !/Android/i.test(userAgent);
}

/** True inside the Tauri desktop shell on Linux (WebKitGTK). */
export function isLinuxDesktopApp(): boolean {
  if (typeof window === "undefined") return false;

  return "__TAURI_INTERNALS__" in window && isLinuxPlatform();
}

/**
 * Ask the backend to save the Root CA certificate into the Downloads folder.
 * Resolves with the full path of the saved file.
 */
export async function saveCertificateToDownloads(
  apiBase: string
): Promise<string> {
  const response = await fetch(`${apiBase}/api/certificate/save`, {
    method: "POST",
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);

    throw new Error(
      (typeof data?.detail === "string" && data.detail) ||
        `Certificate save failed: ${response.status}`
    );
  }

  const data = await response.json();

  if (typeof data?.path !== "string" || !data.path) {
    throw new Error("The backend did not report where the file was saved.");
  }

  return data.path;
}
