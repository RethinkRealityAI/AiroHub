/**
 * The 404 screen.
 *
 * A mistyped room code is the likely way anyone gets here — `/canvas/ABC` is
 * one keystroke from `/canvas/ABCD` — so the page is short, admits nothing is
 * broken, and points at the two doors worth opening.
 *
 * **The noindex meta is not cosmetic.** This is a single-page app on Netlify:
 * the SPA fallback answers every unmatched path with `index.html` and a 200,
 * because that is the only way client-side routing can work at all. A crawler
 * that follows a stale or invented link therefore gets a success status for a
 * page that does not exist, and would happily index it. Injecting
 * `<meta name="robots" content="noindex">` while this component is mounted is
 * what tells it otherwise, and removing it on unmount keeps the tag from
 * outliving the route inside a session — the real pages must stay indexable.
 */
import React, { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Compass, SprayCan } from 'lucide-react';
import { GlassPanel } from '../ui/Glass';
import { track } from '../analytics/track';
import { FeedbackButton } from '../feedback/FeedbackButton';

export default function NotFound() {
  const { pathname } = useLocation();

  // One miss is one miss: guarded on the path it last reported, because
  // StrictMode mounts effects twice in development.
  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (reported.current === pathname) return;
    reported.current = pathname;
    track('notfound', { path: pathname });
  }, [pathname]);

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);

  return (
    <div className="min-h-[100svh] stage-vignette grid place-items-center px-5 text-white">
      <GlassPanel data-testid="not-found" className="w-full max-w-md p-8 text-center">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-[15px] bg-gradient-to-tr from-[#FF4D1C] to-[#FFB020] shadow-[0_0_22px_rgba(255,77,28,0.45)]">
          <SprayCan size={20} className="text-white drop-shadow" />
        </span>

        <h1 className="paint-title text-[26px] font-black leading-none tracking-tight">
          Nothing here
        </h1>
        <p className="mt-3 text-[12.5px] leading-relaxed text-white/55">
          This wall is blank. If you were joining a studio, check the room code — they are four to
          eight letters and numbers, and they are case-sensitive.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <Link
            to="/"
            className="tap flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#FF4D1C] to-[#FF7A34] px-6 py-3 text-[12px] font-bold text-white shadow-[0_8px_24px_-6px_rgba(255,77,28,0.75)]"
          >
            Back to the studio
            <ArrowRight size={14} />
          </Link>
          <Link
            to="/how-it-works"
            className="tap flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-6 py-3 text-[12px] font-semibold text-white/75 hover:bg-white/[0.12] hover:text-white"
          >
            <Compass size={14} />
            How it works
          </Link>
        </div>
      </GlassPanel>

      <FeedbackButton variant="floating" />
    </div>
  );
}
