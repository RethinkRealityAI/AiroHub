/**
 * The one place the app is wired to analytics and flags.
 *
 * Renders nothing. It sits directly inside the router so it can watch
 * `useLocation()` — an SPA changes pages without a navigation, so a page view
 * has to be observed from the router rather than inferred from a document
 * load. Mounting it here instead of calling `track('page_view')` from each
 * screen means a route added later is measured whether or not its author
 * remembered to instrument it.
 *
 * The two one-shot jobs live here for the same reason: `ensureFlags()` needs to
 * run once per page load no matter which route the visitor landed on, and error
 * capture must be installed before the first lazy chunk gets a chance to throw.
 */
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { ensureFlags } from '../config/flags';
import { installErrorCapture, track } from './track';

export function RouteTracker() {
  const { pathname } = useLocation();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    void ensureFlags();
    installErrorCapture();
  }, []);

  useEffect(() => {
    // React 18+ mounts effects twice in development StrictMode; a page view is
    // a count, so it guards on the path it last reported rather than on a
    // "first run" boolean.
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    track('page_view');
  }, [pathname]);

  return null;
}

export default RouteTracker;
