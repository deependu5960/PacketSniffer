// Hands requests from HTTP History, Interceptor and Repeater to Repeater or Intruder.
// localStorage allows the request to survive route navigation.

export type RepeaterImport = {
  method: string;
  url: string;
  headers: [string, string][];
  body_base64: string;
};

export type IntruderImport = {
  // Complete editable HTTP request shown in Intruder.
  rawRequest: string;

  // Structured request data, when available (for example, from HTTP History).
  method?: string;
  url?: string;
  headers?: [string, string][];
  body_base64?: string;

  source?: "history" | "interceptor" | "repeater";
};

const REPEATER_INBOX_KEY = "packetsniff.repeater.inbox";
const INTRUDER_INBOX_KEY = "packetsniff.intruder.inbox";

function readInbox(key: string): unknown[] {
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return [];

    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeInbox(key: string, items: unknown[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Storage unavailable: nothing to hand over.
  }
}

function isRepeaterImport(value: unknown): value is RepeaterImport {
  if (!value || typeof value !== "object") return false;

  const item = value as Record<string, unknown>;

  return (
    typeof item.method === "string" &&
    typeof item.url === "string" &&
    Array.isArray(item.headers) &&
    typeof item.body_base64 === "string"
  );
}

function isIntruderImport(value: unknown): value is IntruderImport {
  if (!value || typeof value !== "object") return false;

  const item = value as Record<string, unknown>;

  return (
    typeof item.rawRequest === "string" &&
    (item.method === undefined || typeof item.method === "string") &&
    (item.url === undefined || typeof item.url === "string") &&
    (item.headers === undefined || Array.isArray(item.headers)) &&
    (item.body_base64 === undefined ||
      typeof item.body_base64 === "string") &&
    (item.source === undefined ||
      item.source === "history" ||
      item.source === "interceptor" ||
      item.source === "repeater")
  );
}

/** Queue a request for Repeater. */
export function sendToRepeater(item: RepeaterImport): void {
  const inbox = readInbox(REPEATER_INBOX_KEY);
  inbox.push(item);
  writeInbox(REPEATER_INBOX_KEY, inbox);
}

/** Called by the Repeater page on load. Returns and clears its queue. */
export function takeRepeaterInbox(): RepeaterImport[] {
  const items = readInbox(REPEATER_INBOX_KEY).filter(isRepeaterImport);

  try {
    window.localStorage.removeItem(REPEATER_INBOX_KEY);
  } catch {
    // Ignore storage errors.
  }

  return items;
}

/** Queue a request for Intruder, then navigate to /intruder. */
export function sendToIntruder(item: IntruderImport): void {
  const inbox = readInbox(INTRUDER_INBOX_KEY);
  inbox.push(item);
  writeInbox(INTRUDER_INBOX_KEY, inbox);
}

/** Called by the Intruder page on load. Returns and clears its queue. */
export function takeIntruderInbox(): IntruderImport[] {
  const items = readInbox(INTRUDER_INBOX_KEY).filter(isIntruderImport);

  try {
    window.localStorage.removeItem(INTRUDER_INBOX_KEY);
  } catch {
    // Ignore storage errors.
  }

  return items;
}
