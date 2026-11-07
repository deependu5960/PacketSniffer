
"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";

type ResizablePanelsProps = {
  left: ReactNode;
  right: ReactNode;
  storageKey?: string;
  defaultLeftWidth?: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
};

export default function ResizablePanels({
  left,
  right,
  storageKey = "packetsniffer-intruder-panel-width",
  defaultLeftWidth = 50,
  minLeftWidth = 25,
  maxLeftWidth = 75,
}: ResizablePanelsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(50);
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const [loaded, setLoaded] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);

      if (saved !== null) {
        const parsed = Number(saved);

        if (Number.isFinite(parsed)) {
          setLeftWidth(
            Math.min(maxLeftWidth, Math.max(minLeftWidth, parsed))
          );
        }
      }
    } catch {
      // Continue with the default width if storage is unavailable.
    }

    setLoaded(true);
  }, [storageKey, minLeftWidth, maxLeftWidth]);

  useEffect(() => {
    if (!loaded) return;

    try {
      localStorage.setItem(storageKey, String(leftWidth));
    } catch {
      // The layout still works without persistence.
    }
  }, [leftWidth, loaded, storageKey]);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!containerRef.current) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    dragStartX.current = event.clientX;
    dragStartWidth.current = leftWidth;
    setDragging(true);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging || !containerRef.current) return;

    const containerWidth = containerRef.current.getBoundingClientRect().width;
    if (!containerWidth) return;

    const delta = event.clientX - dragStartX.current;
    const deltaPercent = (delta / containerWidth) * 100;

    const nextWidth = dragStartWidth.current + deltaPercent;

    setLeftWidth(
      Math.min(maxLeftWidth, Math.max(minLeftWidth, nextWidth))
    );
  }

  function handlePointerUp() {
    setDragging(false);
  }

  function resetWidth() {
    setLeftWidth(defaultLeftWidth);
  }

  return (
    <div
      ref={containerRef}
      className={`flex h-full min-h-0 w-full overflow-hidden ${
        dragging ? "select-none" : ""
      }`}
    >
      <section
        className="flex min-h-0 min-w-0 flex-col overflow-hidden"
        style={{ width: `${leftWidth}%` }}
      >
        {left}
      </section>

      <div
        role="separator"
        aria-label="Resize request editor and configuration panels"
        aria-orientation="vertical"
        aria-valuenow={Math.round(leftWidth)}
        aria-valuemin={minLeftWidth}
        aria-valuemax={maxLeftWidth}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={resetWidth}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            setLeftWidth((width) =>
              Math.max(minLeftWidth, width - 2)
            );
          }

          if (event.key === "ArrowRight") {
            event.preventDefault();
            setLeftWidth((width) =>
              Math.min(maxLeftWidth, width + 2)
            );
          }

          if (event.key === "Home") {
            event.preventDefault();
            resetWidth();
          }
        }}
        className={`group relative z-10 flex w-[7px] shrink-0 cursor-col-resize touch-none items-center justify-center outline-none ${
          dragging ? "bg-emerald-500/20" : "bg-transparent hover:bg-emerald-500/10"
        }`}
        title="Drag to resize · Double-click to reset"
      >
        <div
          className={`h-full w-px transition-colors ${
            dragging
              ? "bg-emerald-400"
              : "bg-white/10 group-hover:bg-emerald-400"
          }`}
        />
        <div
          className={`absolute h-10 w-[3px] rounded-full transition-colors ${
            dragging
              ? "bg-emerald-400"
              : "bg-white/20 group-hover:bg-emerald-400"
          }`}
        />
      </div>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {right}
      </section>
    </div>
  );
}
