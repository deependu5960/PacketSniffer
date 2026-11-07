"use client";

import { Wrench } from "lucide-react";

export default function CollaboratorPage() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Top bar — same chrome as the rest of the app */}
      <div className="flex h-[54px] shrink-0 items-center gap-3 border-b border-white/[0.08] px-3 md:px-5">
        <h1 className="shrink-0 text-[16px] font-semibold tracking-tight text-white">
          Collaborator
        </h1>

        <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/[0.08] px-3 py-1 text-[12px] font-medium text-amber-300">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          Under maintenance
        </span>
      </div>

      {/* Centered message */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-6">
        <div className="flex max-w-[440px] flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/[0.08] bg-[#111113]">
            <Wrench size={20} className="text-[#8a8a98]" />
          </div>

          <h2 className="mt-5 text-[16px] font-semibold text-white">
            Collaborator is under maintenance
          </h2>

          <p className="mt-2 text-[13px] leading-6 text-[#8a8a98]">
            The out-of-band interaction catcher is temporarily unavailable while
            we finish rebuilding it. interaction history are
            preserved and will be available again once the update ships.
          </p>
        </div>
      </div>
    </div>
  );
}