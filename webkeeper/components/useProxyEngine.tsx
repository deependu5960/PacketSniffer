"use client";

import { useSyncExternalStore } from "react";

/**
 * Shared proxy-engine state.
 *
 * One module-level store is used by every component that calls
 * `useProxyEngine()` (Sidebar, Dashboard, ...). It polls the backend only
 * while at least one component is mounted, so the sidebar switch and the
 * dashboard "Start / Stop Proxy" button always show the same state.
 */

export const PROXY_API = "http://127.0.0.1:8765";
const POLL_MS = 2000;

export type EngineStatus = {
  running: boolean;
  host: string;
  port: number;
  active_connections: number;
};

export type EngineAction = "start" | "stop";

type Snapshot = {
  engine: EngineStatus | null;
  error: string;
  action: EngineAction | null;
};

const INITIAL: Snapshot = { engine: null, error: "", action: null };

let snapshot: Snapshot = INITIAL;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function sameEngine(a: EngineStatus | null, b: EngineStatus | null) {
  if (a === b) return true;
  if (!a || !b) return false;

  return (
    a.running === b.running &&
    a.host === b.host &&
    a.port === b.port &&
    a.active_connections === b.active_connections
  );
}

// Only notify subscribers when something actually changed.
function update(patch: Partial<Snapshot>) {
  const next = { ...snapshot, ...patch };

  if (
    next.error === snapshot.error &&
    next.action === snapshot.action &&
    sameEngine(next.engine, snapshot.engine)
  ) {
    return;
  }

  snapshot = next;
  listeners.forEach((listener) => listener());
}

async function refresh() {
  try {
    const response = await fetch(`${PROXY_API}/api/status`, {
      cache: "no-store",
    });

    if (!response.ok) throw new Error("Status request failed");

    const data = await response.json();
    update({ engine: data.proxy, error: "" });
  } catch {
    update({ engine: null, error: "Backend API unavailable" });
  }
}

async function control(action: EngineAction) {
  if (snapshot.action) return; // already starting / stopping

  update({ action, error: "" });

  try {
    const response = await fetch(`${PROXY_API}/api/proxy/${action}`, {
      method: "POST",
    });

    if (!response.ok) throw new Error(`Unable to ${action} proxy`);

    await refresh();
  } catch (error) {
    await refresh();

    // Keep the failure visible until the next poll if the backend is reachable.
    if (snapshot.engine) {
      update({
        error:
          error instanceof Error ? error.message : "Engine control failed",
      });
    }
  } finally {
    update({ action: null });
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  if (listeners.size === 1) {
    void refresh();
    timer = setInterval(() => void refresh(), POLL_MS);
  }

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => INITIAL;

const start = () => control("start");
const stop = () => control("stop");

export function useProxyEngine() {
  const { engine, error, action } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  const running = engine?.running ?? false;

  return {
    engine,
    error,
    action,
    running,
    loading: action !== null,
    start,
    stop,
    toggle: running ? stop : start,
  };
}
