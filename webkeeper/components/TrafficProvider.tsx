"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// ------------------------------ Types ------------------------------

export type InterceptRequest = {
  method: string;
  url: string;
  headers: [string, string][];
  body_base64: string;
};

export type InterceptResponse = {
  status_code: number;
  reason: string;
  headers: [string, string][];
  body_base64: string;
};

export type Req = {
  id: number;
  backendId?: string;
  method: string;
  host: string;
  path: string;
  raw: string;
  time: string;
  url?: string;
  scheme?: string;
  port?: number;
  headers?: [string, string][];
  body_base64?: string;
};

export type WebSocketFrame = {
  direction: "client" | "server" | string;
  opcode: string;
  payload: string; // base64-encoded
  timestamp: number;
  edited: boolean;
};

export type PendingResponse = {
  id: number;
  backendId?: string;
  statusCode: number;
  reason: string;
  headers: [string, string][];
  body_base64: string;
  raw: string;
  requestMethod: string;
  requestUrl: string;
  scheme: string;
  time: string;
};

export type HistoryItem = Req & {
  status: number | null;
  length: number;
  mime: string;
  response: string;
  dropped: boolean;
  duration?: number;
  rawRequest?: string;
  rawResponse?: string;
  requestDecodeError?: string | null;
  responseDecodeError?: string | null;
  displayType?: string;
  detectedMime?: string;
  isText?: boolean;
  isBinary?: boolean;
  originalSize?: number;
  decodedSize?: number;
  responseBodyBase64?: string;
  rawResponseBodyBase64?: string;
  responseTag: string;
  requestDisplayType: string;
  requestDetectedMime: string;
  requestTag: string;
  requestIsText: boolean;
  requestIsBinary: boolean;
  requestBodyBase64: string;
  rawRequestBodyBase64: string;
  is_websocket?: boolean;
  frames?: WebSocketFrame[];
};

type Traffic = {
  interceptOn: boolean;
  queue: Req[];
  responseQueue: PendingResponse[];
  history: HistoryItem[];
  toggleIntercept: () => Promise<void>;
  simulate: () => void;
  forward: (id: number, editedRequest?: InterceptRequest) => Promise<void>;
  drop: (id: number) => Promise<void>;
  forwardAll: () => Promise<void>;
  forwardResponse: (
    id: number,
    editedResponse?: InterceptResponse
  ) => Promise<void>;
  dropResponse: (id: number) => Promise<void>;
  editRaw: (id: number, raw: string) => void;
  editResponseRaw: (id: number, raw: string) => void;
  clearHistory: () => void;
};

type BackendRecord = {
  id: string;
  method: string;
  url: string;
  scheme: string;
  host: string;
  port: number;
  path: string;
  request_headers: [string, string][];
  request_body: string;
  request_body_decoded?: string;
  request_decode_error?: string | null;
  status_code: number | null;
  reason: string;
  response_headers: [string, string][];
  response_body: string;
  response_body_decoded?: string;
  response_decode_error?: string | null;
  timestamp: string;
  duration_ms: number;
  error: string | null;
  declared_content_type?: string;
  detected_content_type?: string;
  display_type?: "empty" | "image" | "pdf" | "json" | "html" | "xml" | "text" | "binary";
  is_text?: boolean;
  is_binary?: boolean;
  detection_method?: string;
  response_size_original?: number;
  response_size_decoded?: number;
  is_websocket?: boolean;
  frames?: Array<{
    direction: string;
    opcode: string;
    payload: string;
    timestamp: number;
    edited: boolean;
  }>;
};

type PendingBackendRequest = {
  id: string;
  method: string;
  url: string;
  scheme?: string;
  host?: string;
  port?: number;
  path?: string;
  headers?: [string, string][];
  body_base64?: string;
};

type PendingBackendResponse = {
  id: string;
  status_code: number;
  reason?: string;
  headers?: [string, string][];
  body_base64?: string;
  request_method?: string;
  request_url?: string;
  scheme?: string;
  direction?: string;
};

type InterceptorStatus = {
  enabled: boolean;
  pending: number;
  pending_requests?: number;
  pending_responses?: number;
};

// ------------------------------ Config ------------------------------

const API = "http://127.0.0.1:8765";
const WS = "ws://127.0.0.1:8765/api/events";

// ------------------------------ Helpers ------------------------------

function decodeBase64(value: string | null | undefined): string {
  if (!value) return "";

  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) =>
      char.charCodeAt(0)
    );

    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

function bodyIsUnchanged(
  editedBase64: string,
  originalBase64: string
): boolean {
  const normalized = decodeBase64(originalBase64).replace(/\r\n/g, "\n");
  return editedBase64 === encodeBase64(normalized);
}

function parseRawRequest(
  raw: string,
  originalUrl: string
): InterceptRequest {
  const normalized = raw.replace(/\r\n/g, "\n");
  const separator = normalized.indexOf("\n\n");

  if (separator === -1) {
    throw new Error(
      "Invalid HTTP request: missing blank line before body."
    );
  }

  const headerSection = normalized.slice(0, separator);
  const body = normalized.slice(separator + 2);
  const lines = headerSection.split("\n");
  const requestLine = lines.shift()?.trim() ?? "";

  const match = requestLine.match(
    /^([A-Z!#$%&'*+.^_`|~-]+)\s+(\S+)\s+HTTP\/(\d(?:\.\d)?)$/i
  );

  if (!match) {
    throw new Error(
      "Invalid request line. Expected: METHOD /path HTTP/1.1"
    );
  }

  const method = match[1].toUpperCase();
  const target = match[2];
  const headers: [string, string][] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    const colon = line.indexOf(":");

    if (colon <= 0) {
      throw new Error(`Invalid HTTP header: ${line}`);
    }

    headers.push([
      line.slice(0, colon).trim(),
      line.slice(colon + 1).trim(),
    ]);
  }

  let url: string;

  try {
    url = new URL(target, originalUrl).toString();
  } catch {
    throw new Error("Invalid request URL.");
  }

  const parsedUrl = new URL(url);
  const original = new URL(originalUrl);

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Only HTTP and HTTPS request URLs are supported.");
  }

  if (
    parsedUrl.hostname !== original.hostname ||
    parsedUrl.port !== original.port ||
    parsedUrl.protocol !== original.protocol
  ) {
    throw new Error(
      "Changing the destination host, port, or protocol is not supported yet."
    );
  }

  return {
    method,
    url,
    headers,
    body_base64: encodeBase64(body),
  };
}

function parseRawResponse(raw: string): InterceptResponse {
  const normalized = raw.replace(/\r\n/g, "\n");
  const separator = normalized.indexOf("\n\n");

  if (separator === -1) {
    throw new Error(
      "Invalid HTTP response: missing blank line before body."
    );
  }

  const headerSection = normalized.slice(0, separator);
  const body = normalized.slice(separator + 2);
  const lines = headerSection.split("\n");
  const statusLine = lines.shift()?.trim() ?? "";

  const match = statusLine.match(
    /^HTTP\/\d(?:\.\d)?\s+(\d{3})(?:\s+(.*))?$/i
  );

  if (!match) {
    throw new Error(
      "Invalid status line. Expected: HTTP/1.1 200 OK"
    );
  }

  const statusCode = Number(match[1]);

  if (statusCode < 200 || statusCode > 599) {
    throw new Error("Response status must be between 200 and 599.");
  }

  const headers: [string, string][] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    const colon = line.indexOf(":");

    if (colon <= 0) {
      throw new Error(`Invalid HTTP header: ${line}`);
    }

    headers.push([
      line.slice(0, colon).trim(),
      line.slice(colon + 1).trim(),
    ]);
  }

  return {
    status_code: statusCode,
    reason: match[2] ?? "",
    headers,
    body_base64: encodeBase64(body),
  };
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return new Date().toLocaleTimeString([], { hour12: false });
  }

  return date.toLocaleTimeString([], { hour12: false });
}

function getHeader(
  headers: [string, string][] | undefined,
  name: string
): string {
  return (
    headers?.find(
      ([key]) => key.toLowerCase() === name.toLowerCase()
    )?.[1] ?? ""
  );
}

// ------------------------ Content Detection ------------------------

type ContentDetection = {
  displayType: string;
  detectedMime: string;
  tag: string;
  isText: boolean;
  isBinary: boolean;
};

function classifyContentType(
  contentType: string,
  bodyBase64 = ""
): ContentDetection {
  const mime = contentType.split(";")[0].trim().toLowerCase();

  if (
    mime === "message/ohttp-req" ||
    mime === "message/ohttp-res"
  ) {
    return {
      displayType: "binary",
      detectedMime: mime,
      tag: "OHTTP",
      isText: false,
      isBinary: true,
    };
  }

  if (mime.startsWith("image/")) {
    return {
      displayType: "image",
      detectedMime: mime,
      tag: "IMAGE",
      isText: false,
      isBinary: true,
    };
  }

  if (mime === "application/pdf") {
    return {
      displayType: "pdf",
      detectedMime: mime,
      tag: "PDF",
      isText: false,
      isBinary: true,
    };
  }

  if (
    mime === "application/json" ||
    mime.endsWith("+json") ||
    mime === "text/json"
  ) {
    return {
      displayType: "json",
      detectedMime: mime,
      tag: "JSON",
      isText: true,
      isBinary: false,
    };
  }

  if (
    mime === "text/html" ||
    mime === "application/xhtml+xml"
  ) {
    return {
      displayType: "html",
      detectedMime: mime,
      tag: "HTML",
      isText: true,
      isBinary: false,
    };
  }

  if (mime.includes("xml")) {
    return {
      displayType: "xml",
      detectedMime: mime,
      tag: "XML",
      isText: true,
      isBinary: false,
    };
  }

  if (
    mime.startsWith("text/") ||
    mime === "application/javascript" ||
    mime === "application/x-www-form-urlencoded"
  ) {
    return {
      displayType: "text",
      detectedMime: mime,
      tag: "TEXT",
      isText: true,
      isBinary: false,
    };
  }

  if (bodyBase64) {
    try {
      const binary = atob(bodyBase64.slice(0, 64));
      const bytes = Array.from(binary, (c) =>
        c.charCodeAt(0)
      );

      if (
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47
      ) {
        return {
          displayType: "image",
          detectedMime: "image/png",
          tag: "IMAGE",
          isText: false,
          isBinary: true,
        };
      }

      if (
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff
      ) {
        return {
          displayType: "image",
          detectedMime: "image/jpeg",
          tag: "IMAGE",
          isText: false,
          isBinary: true,
        };
      }

      if (
        bytes[0] === 0x25 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x44 &&
        bytes[3] === 0x46
      ) {
        return {
          displayType: "pdf",
          detectedMime: "application/pdf",
          tag: "PDF",
          isText: false,
          isBinary: true,
        };
      }
    } catch {
      // Unknown content.
    }
  }

  if (!mime) {
    return {
      displayType: bodyBase64 ? "binary" : "empty",
      detectedMime: "application/octet-stream",
      tag: bodyBase64 ? "BINARY" : "EMPTY",
      isText: false,
      isBinary: Boolean(bodyBase64),
    };
  }

  return {
    displayType: "binary",
    detectedMime: mime,
    tag: "BINARY",
    isText: false,
    isBinary: true,
  };
}

// -------------------------- HTTP Formatting --------------------------

function formatRequest(
  record: BackendRecord,
  useDecoded = true
): string {
  const originalBody = record.request_body ?? "";

  const selectedBody = useDecoded
    ? record.request_body_decoded ?? originalBody
    : originalBody;

  const body = decodeBase64(selectedBody);
  const headers = record.request_headers ?? [];

  const lines = [
    `${record.method} ${record.path || "/"} HTTP/1.1`,
    ...headers.map(([key, value]) => `${key}: ${value}`),
  ];

  return lines.join("\n") + "\n\n" + body;
}

function formatResponse(
  record: BackendRecord,
  useDecoded = true
): string {
  if (record.error) {
    return `# Proxy error\n${record.error}`;
  }

  const originalBody = record.response_body ?? "";

  const selectedBody = useDecoded
    ? record.response_body_decoded ?? originalBody
    : originalBody;

  const body = decodeBase64(selectedBody);

  const lines = [
    `HTTP/1.1 ${record.status_code ?? 0} ${record.reason ?? ""}`.trim(),
    ...(record.response_headers ?? []).map(
      ([key, value]) => `${key}: ${value}`
    ),
  ];

  return lines.join("\n") + "\n\n" + body;
}

// -------------------------- History Mapping --------------------------

function toHistory(
  record: BackendRecord,
  frontendId: number
): HistoryItem {
  const decodedResponseBase64 =
    record.response_body_decoded ?? record.response_body ?? "";

  const decodedResponse = decodeBase64(decodedResponseBase64);

  const requestContentType = getHeader(
    record.request_headers,
    "content-type"
  );

  const requestDetection = classifyContentType(
    requestContentType,
    record.request_body_decoded ?? record.request_body ?? ""
  );

  const responseContentType =
    getHeader(record.response_headers, "content-type") ||
    record.detected_content_type ||
    record.declared_content_type ||
    "";

  const responseFallback = classifyContentType(
    responseContentType,
    decodedResponseBase64
  );

  const responseDisplayType =
    record.display_type ?? responseFallback.displayType;

  const responseDetectedMime =
    record.detected_content_type ?? responseFallback.detectedMime;

  const responseTag =
    responseDetectedMime === "message/ohttp-res" ||
    responseDetectedMime === "message/ohttp-req"
      ? "OHTTP"
      : responseDisplayType === "empty"
        ? "EMPTY"
        : responseDisplayType.toUpperCase();

  const contentType = getHeader(
    record.response_headers,
    "content-type"
  );

  const frames: WebSocketFrame[] | undefined = record.frames?.map(
    (f) => ({
      direction: f.direction,
      opcode: f.opcode,
      payload: f.payload,
      timestamp: f.timestamp,
      edited: f.edited,
    })
  );

  return {
    id: frontendId,
    backendId: record.id,
    method: record.method,
    host: record.host,
    path: record.path,
    url: record.url,
    scheme: record.scheme,
    port: record.port,
    headers: record.request_headers ?? [],
    body_base64: record.request_body ?? "",
    raw: formatRequest(record, true),
    response: formatResponse(record, true),
    rawRequest: formatRequest(record, false),
    rawResponse: formatResponse(record, false),

    requestDecodeError: record.request_decode_error ?? null,
    responseDecodeError: record.response_decode_error ?? null,

    requestDisplayType: requestDetection.displayType,
    requestDetectedMime: requestDetection.detectedMime,
    requestTag: requestDetection.tag,
    requestIsText: requestDetection.isText,
    requestIsBinary: requestDetection.isBinary,
    requestBodyBase64:
      record.request_body_decoded ?? record.request_body ?? "",
    rawRequestBodyBase64: record.request_body ?? "",

    displayType: responseDisplayType,
    detectedMime: responseDetectedMime,
    isText: record.is_text ?? responseFallback.isText,
    isBinary: record.is_binary ?? responseFallback.isBinary,
    originalSize: record.response_size_original ?? 0,
    decodedSize: record.response_size_decoded ?? 0,
    responseBodyBase64: decodedResponseBase64,
    rawResponseBodyBase64: record.response_body ?? "",
    responseTag,

    status: record.status_code,
    length: new TextEncoder().encode(decodedResponse).length,
    mime: contentType || responseDetectedMime,
    time: formatTime(record.timestamp),
    dropped: false,
    duration: record.duration_ms,

    is_websocket: Boolean(record.is_websocket),
    frames,
  };
}

// ------------------------ Interceptor Mapping ------------------------

function toPendingRequest(
  request: PendingBackendRequest,
  frontendId: number
): Req {
  const url = request.url || "";
  let parsed: URL | null = null;

  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }

  const host = request.host || parsed?.hostname || "";
  const path = request.path || (
    parsed ? `${parsed.pathname}${parsed.search}` : "/"
  );

  const headers = request.headers ?? [];
  const body = decodeBase64(request.body_base64);

  const raw = [
    `${request.method} ${path} HTTP/1.1`,
    ...headers.map(([key, value]) => `${key}: ${value}`),
    "",
    body,
  ].join("\n");

  return {
    id: frontendId,
    backendId: request.id,
    method: request.method,
    host,
    path,
    url,
    scheme: request.scheme || parsed?.protocol.replace(":", ""),
    port: request.port || parsed?.port
      ? Number(request.port || parsed?.port)
      : undefined,
    headers,
    body_base64: request.body_base64 ?? "",
    raw,
    time: new Date().toLocaleTimeString([], {
      hour12: false,
    }),
  };
}

function toPendingResponse(
  response: PendingBackendResponse,
  frontendId: number
): PendingResponse {
  const headers = response.headers ?? [];
  const bodyBase64 = response.body_base64 ?? "";

  const raw = [
    `HTTP/1.1 ${response.status_code} ${response.reason ?? ""}`.trim(),
    ...headers.map(([key, value]) => `${key}: ${value}`),
    "",
    decodeBase64(bodyBase64),
  ].join("\n");

  return {
    id: frontendId,
    backendId: response.id,
    statusCode: response.status_code,
    reason: response.reason ?? "",
    headers,
    body_base64: bodyBase64,
    raw,
    requestMethod: response.request_method ?? "",
    requestUrl: response.request_url ?? "",
    scheme: response.scheme ?? "",
    time: new Date().toLocaleTimeString([], {
      hour12: false,
    }),
  };
}

// ------------------------------ Context ------------------------------

const TrafficContext = createContext<Traffic | null>(null);

export function useTraffic() {
  const ctx = useContext(TrafficContext);

  if (!ctx) {
    throw new Error("useTraffic must be used inside <TrafficProvider>");
  }

  return ctx;
}

// ------------------------------ Provider ------------------------------

export function TrafficProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [interceptOn, setInterceptOn] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [queue, setQueue] = useState<Req[]>([]);
  const [responseQueue, setResponseQueue] = useState<PendingResponse[]>([]);

  const nextId = useRef(0);
  const nextPendingId = useRef(0);
  const nextResponseId = useRef(0);

  const idMap = useRef(new Map<string, number>());
  const pendingIdMap = useRef(new Map<string, number>());
  const responseIdMap = useRef(new Map<string, number>());
  const seenIds = useRef(new Set<string>());

  const convertRecord = useCallback((record: BackendRecord) => {
    if (!record?.id) return null;

    if (seenIds.current.has(record.id)) return null;

    seenIds.current.add(record.id);

    let frontendId = idMap.current.get(record.id);

    if (!frontendId) {
      frontendId = ++nextId.current;
      idMap.current.set(record.id, frontendId);
    }

    return toHistory(record, frontendId);
  }, []);

  const convertPending = useCallback(
    (request: PendingBackendRequest) => {
      if (!request?.id) return null;

      let frontendId = pendingIdMap.current.get(request.id);

      if (!frontendId) {
        frontendId = ++nextPendingId.current;
        pendingIdMap.current.set(request.id, frontendId);
      }

      return toPendingRequest(request, frontendId);
    },
    []
  );

  const convertPendingResponse = useCallback(
    (response: PendingBackendResponse) => {
      if (!response?.id) return null;

      let frontendId = responseIdMap.current.get(response.id);

      if (!frontendId) {
        frontendId = ++nextResponseId.current;
        responseIdMap.current.set(response.id, frontendId);
      }

      return toPendingResponse(response, frontendId);
    },
    []
  );

  const removePending = useCallback((backendId: string) => {
    setQueue((current) =>
      current.filter((item) => item.backendId !== backendId)
    );

    pendingIdMap.current.delete(backendId);
  }, []);

  const removePendingResponse = useCallback((backendId: string) => {
    setResponseQueue((current) =>
      current.filter((item) => item.backendId !== backendId)
    );

    responseIdMap.current.delete(backendId);
  }, []);

  const loadTraffic = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/traffic`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Traffic API returned ${response.status}`);
      }

      const result = await response.json();
      const records: BackendRecord[] = result.items ?? [];

      const converted = records
        .reverse()
        .map(convertRecord)
        .filter(
          (item): item is HistoryItem => item !== null
        );

      if (converted.length) {
        setHistory((current) => [...current, ...converted]);
      }
    } catch (error) {
      console.error(
        "PacketSniff: unable to load traffic:",
        error
      );
    }
  }, [convertRecord]);

  const loadInterceptor = useCallback(async () => {
    try {
      const [
        statusResponse,
        pendingResponse,
        pendingResponsesResponse,
      ] = await Promise.all([
        fetch(`${API}/api/interceptor/status`, {
          cache: "no-store",
        }),
        fetch(`${API}/api/interceptor/pending`, {
          cache: "no-store",
        }),
        fetch(`${API}/api/interceptor/responses/pending`, {
          cache: "no-store",
        }),
      ]);

      if (
        !statusResponse.ok ||
        !pendingResponse.ok ||
        !pendingResponsesResponse.ok
      ) {
        throw new Error("Unable to load interceptor state");
      }

      const status: InterceptorStatus = await statusResponse.json();
      const pendingResult = await pendingResponse.json();
      const pendingResponsesResult =
        await pendingResponsesResponse.json();

      setInterceptOn(Boolean(status.enabled));

      const requests: PendingBackendRequest[] =
        pendingResult.items ?? [];

      const convertedRequests = requests
        .map(convertPending)
        .filter((item): item is Req => item !== null);

      setQueue(convertedRequests);

      const responses: PendingBackendResponse[] =
        pendingResponsesResult.items ?? [];

      const convertedResponses = responses
        .map(convertPendingResponse)
        .filter(
          (item): item is PendingResponse => item !== null
        );

      setResponseQueue(convertedResponses);
    } catch (error) {
      console.error(
        "PacketSniff: unable to load interceptor:",
        error
      );
    }
  }, [convertPending, convertPendingResponse]);

  // -------------------------- WebSocket --------------------------

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    void loadTraffic();
    void loadInterceptor();

    function connect() {
      if (disposed) return;

      socket = new WebSocket(WS);

      socket.onopen = () => {
        console.log("PacketSniff: live event stream connected");
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === "traffic.completed") {
            const record = convertRecord(message.data);

            if (record) {
              setHistory((current) => [...current, record]);
            }
          }

          if (message.type === "traffic.cleared") {
            seenIds.current.clear();
            idMap.current.clear();
            nextId.current = 0;
            setHistory([]);
          }

          if (message.type === "interceptor.status") {
            setInterceptOn(Boolean(message.data?.enabled));
          }

          if (message.type === "interceptor.request_paused") {
            const request = convertPending(message.data);

            if (request) {
              setQueue((current) => {
                const exists = current.some(
                  (item) => item.backendId === request.backendId
                );

                return exists ? current : [...current, request];
              });
            }
          }

          if (message.type === "interceptor.response_paused") {
            const response = convertPendingResponse(message.data);

            if (response) {
              setResponseQueue((current) => {
                const exists = current.some(
                  (item) => item.backendId === response.backendId
                );

                return exists ? current : [...current, response];
              });
            }
          }

          if (
            message.type === "interceptor.request_forwarded" ||
            message.type === "interceptor.request_dropped" ||
            message.type === "interceptor.request_removed"
          ) {
            if (message.data?.id) {
              removePending(message.data.id);
            }
          }

          if (
            message.type === "interceptor.response_forwarded" ||
            message.type === "interceptor.response_dropped" ||
            message.type === "interceptor.response_removed"
          ) {
            if (message.data?.id) {
              removePendingResponse(message.data.id);
            }
          }
        } catch (error) {
          console.error(
            "PacketSniff: invalid WebSocket event:",
            error
          );
        }
      };

      socket.onclose = () => {
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      };

      socket.onerror = () => {
        socket?.close();
      };
    }

    connect();

    return () => {
      disposed = true;

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }

      socket?.close();
    };
  }, [
    loadTraffic,
    loadInterceptor,
    convertRecord,
    convertPending,
    convertPendingResponse,
    removePending,
    removePendingResponse,
  ]);

  // -------------------------- Interceptor Actions --------------------------

  const toggleIntercept = useCallback(async () => {
    const response = await fetch(`${API}/api/interceptor/toggle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        enabled: !interceptOn,
      }),
    });

    if (!response.ok) {
      throw new Error("Unable to change interception mode");
    }

    const result: InterceptorStatus = await response.json();
    setInterceptOn(Boolean(result.enabled));
  }, [interceptOn]);

  const forward = useCallback(
    async (id: number, editedRequest?: InterceptRequest) => {
      const item = queue.find((request) => request.id === id);

      if (!item?.backendId) {
        throw new Error("Pending request not found");
      }

      const parsedRequest =
        editedRequest ??
        parseRawRequest(item.raw, item.url ?? "");

      let request: InterceptRequest = parsedRequest;

      if (!editedRequest) {
        if (
          bodyIsUnchanged(
            parsedRequest.body_base64,
            item.body_base64 ?? ""
          )
        ) {
          request = {
            ...parsedRequest,
            body_base64: item.body_base64 ?? "",
          };
        } else {
          request = {
            ...parsedRequest,
            headers: parsedRequest.headers.filter(
              ([key]) => key.toLowerCase() !== "content-encoding"
            ),
          };
        }
      }

      const response = await fetch(
        `${API}/api/interceptor/${item.backendId}/forward`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ request }),
        }
      );

      if (!response.ok) {
        throw new Error("Unable to forward request");
      }

      const result = await response.json();

      if (result.success === false) {
        throw new Error("Request is no longer pending");
      }

      removePending(item.backendId);
    },
    [queue, removePending]
  );

  const drop = useCallback(
    async (id: number) => {
      const item = queue.find((request) => request.id === id);

      if (!item?.backendId) {
        throw new Error("Pending request not found");
      }

      const response = await fetch(
        `${API}/api/interceptor/${item.backendId}/drop`,
        {
          method: "POST",
        }
      );

      if (!response.ok) {
        throw new Error("Unable to drop request");
      }

      const result = await response.json();

      if (result.success === false) {
        throw new Error("Request is no longer pending");
      }

      removePending(item.backendId);
    },
    [queue, removePending]
  );

  const forwardAll = useCallback(async () => {
    const pending = [...queue];

    for (const item of pending) {
      await forward(item.id);
    }
  }, [queue, forward]);

  const forwardResponse = useCallback(
    async (
      id: number,
      editedResponse?: InterceptResponse
    ) => {
      const item = responseQueue.find(
        (response) => response.id === id
      );

      if (!item?.backendId) {
        throw new Error("Pending response not found");
      }

      const parsedResponse =
        editedResponse ??
        parseRawResponse(item.raw);

      let responseData: InterceptResponse = parsedResponse;

      if (!editedResponse) {
        if (
          bodyIsUnchanged(
            parsedResponse.body_base64,
            item.body_base64
          )
        ) {
          responseData = {
            ...parsedResponse,
            body_base64: item.body_base64,
          };
        } else {
          responseData = {
            ...parsedResponse,
            headers: parsedResponse.headers.filter(
              ([key]) => key.toLowerCase() !== "content-encoding"
            ),
          };
        }
      }

      const response = await fetch(
        `${API}/api/interceptor/responses/${item.backendId}/forward`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            response: responseData,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Unable to forward response: ${response.status} ${errorText}`
        );
      }

      const result = await response.json();

      if (result.success === false) {
        throw new Error("Response is no longer pending");
      }

      removePendingResponse(item.backendId);
    },
    [responseQueue, removePendingResponse]
  );

  const dropResponse = useCallback(
    async (id: number) => {
      const item = responseQueue.find(
        (response) => response.id === id
      );

      if (!item?.backendId) {
        throw new Error("Pending response not found");
      }

      const response = await fetch(
        `${API}/api/interceptor/responses/${item.backendId}/drop`,
        {
          method: "POST",
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Unable to drop response: ${response.status} ${errorText}`
        );
      }

      const result = await response.json();

      if (result.success === false) {
        throw new Error("Response is no longer pending");
      }

      removePendingResponse(item.backendId);
    },
    [responseQueue, removePendingResponse]
  );

  const editRaw = useCallback((id: number, raw: string) => {
    setQueue((current) =>
      current.map((item) =>
        item.id === id ? { ...item, raw } : item
      )
    );
  }, []);

  const editResponseRaw = useCallback(
    (id: number, raw: string) => {
      setResponseQueue((current) =>
        current.map((item) =>
          item.id === id ? { ...item, raw } : item
        )
      );
    },
    []
  );

  // -------------------------- History Actions --------------------------

  const clearHistory = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/traffic`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(`Clear failed: ${response.status}`);
      }

      seenIds.current.clear();
      idMap.current.clear();
      nextId.current = 0;
      setHistory([]);
    } catch (error) {
      console.error(
        "PacketSniff: unable to clear traffic:",
        error
      );
    }
  }, []);

  const value: Traffic = {
    interceptOn,
    queue,
    responseQueue,
    history,
    toggleIntercept,
    simulate: () => {
      void loadTraffic();
    },
    forward,
    drop,
    forwardAll,
    forwardResponse,
    dropResponse,
    editRaw,
    editResponseRaw,
    clearHistory,
  };

  return (
    <TrafficContext.Provider value={value}>
      {children}
    </TrafficContext.Provider>
  );
}