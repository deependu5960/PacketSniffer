// components/geminiAI-bridge.ts
"use client";

export type AiSeed = {
  /** Text that will be placed in the composer (user-visible + editable). */
  prompt: string;
  /** Optional pre-attached HTTP request text (as if dropped as a file). */
  httpRequest?: string;
  /** Optional name for the attached request. */
  httpRequestName?: string;
};

const EVENT = "packetsniff:ai-open";

export function openGeminiAIWith(seed: AiSeed) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AiSeed>(EVENT, { detail: seed }));
}

export function onGeminiAIRequest(
  handler: (seed: AiSeed) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<AiSeed>).detail;
    if (detail) handler(detail);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}