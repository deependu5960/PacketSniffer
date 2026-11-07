export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-full min-h-[320px] w-full flex-col items-center justify-center gap-5 bg-[#0f0f11]"
    >
      <style>{`
        @keyframes logo-arc {
          0%, 100% { opacity: 0.2; }
          25%, 45% { opacity: 1; }
          70%      { opacity: 0.2; }
        }
        @keyframes logo-beacon {
          0%, 100% { transform: scale(1);   opacity: 0.7; }
          50%      { transform: scale(1.5); opacity: 1; }
        }
        .logo-arc {
          opacity: 0.2;
          animation: logo-arc 1.6s ease-in-out infinite;
        }
        .logo-arc.inner { animation-delay: 0s; }
        .logo-arc.outer { animation-delay: 0.25s; }
        .logo-beacon {
          transform-box: fill-box;
          transform-origin: center;
          animation: logo-beacon 1.6s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .logo-arc    { animation: none; opacity: 0.8; }
          .logo-beacon { animation: none; }
        }
      `}</style>

      <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-white/[0.08] bg-[#141416]">
        <svg
          viewBox="0 0 24 24"
          className="h-10 w-10"
          fill="none"
          stroke="#34d399"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* Signal arcs: inner pair, then outer pair */}
          <path className="logo-arc inner" d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5" />
          <path className="logo-arc inner" d="M16.2 4.8c2 2 2.26 5.11.8 7.47" />
          <path className="logo-arc outer" d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9" />
          <path className="logo-arc outer" d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1" />

          {/* Beacon */}
          <circle className="logo-beacon" cx="12" cy="9" r="2" />

          {/* Tower */}
          <path d="M9.5 18h5" />
          <path d="m8 22 4-11 4 11" />
        </svg>
      </div>

      <p className="text-[13px] font-medium tracking-wide text-[#8a8a98]">
        Loading...
      </p>
    </div>
  );
}