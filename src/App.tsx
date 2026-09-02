/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './components/Home';
import HowItWorks from './components/HowItWorks';
import NotFound from './components/NotFound';
import { RouteTracker } from './analytics/RouteTracker';

// The studio and the phone controller are the only screens that need three.js,
// yet importing them statically made the 1.1 MB rendering chunk a hard
// dependency of the landing page — the poster-first hero can't help if the
// router has already demanded the renderer. Splitting them means / ships only
// HTML, CSS and the small vendor bundle, and the heavy chunk starts loading
// when someone actually enters a room.
const CanvasView = lazy(() => import('./components/CanvasView'));
const ControllerView = lazy(() => import('./components/ControllerView'));

// The admin portal drags in analysis/optimization machinery nobody painting
// in a session ever needs, so it only loads when /admin is actually visited.
const AdminView = lazy(() => import('./components/AdminView'));

// `NotFound` and `RouteTracker` are deliberately NOT lazy. The tracker has to
// exist on the very first render to see the landing page view, and the 404 is
// a handful of elements that must render instantly on a mistyped URL — a
// Suspense fallback flashing before "Nothing here" would read as a real load.

// The review gallery pulls in three.js, drei and the whole model loader to put
// every catalog asset on a turntable — the same reasoning as /admin, and the
// same lazy block below.
const ReviewGallery = lazy(() => import('./review/ReviewGallery'));

export default function App() {
  return (
    <Router>
      <RouteTracker />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route
          path="/canvas/:roomId"
          element={
            <Suspense
              fallback={
                <div className="min-h-[100svh] stage-vignette grid place-items-center">
                  <span className="airo-breathe label-caps text-white/40">Loading studio…</span>
                </div>
              }
            >
              <CanvasView />
            </Suspense>
          }
        />
        <Route
          path="/controller/:roomId"
          element={
            <Suspense
              fallback={
                <div className="min-h-[100svh] stage-vignette grid place-items-center">
                  <span className="airo-breathe label-caps text-white/40">Loading controller…</span>
                </div>
              }
            >
              <ControllerView />
            </Suspense>
          }
        />
        <Route path="/how-it-works" element={<HowItWorks />} />
        <Route
          path="/admin"
          element={
            <Suspense
              fallback={
                <div className="min-h-[100svh] stage-vignette grid place-items-center">
                  <span className="airo-breathe label-caps text-white/40">Loading admin…</span>
                </div>
              }
            >
              <AdminView />
            </Suspense>
          }
        />
        <Route
          path="/admin/review"
          element={
            <Suspense
              fallback={
                <div className="min-h-[100svh] stage-vignette grid place-items-center">
                  <span className="airo-breathe label-caps text-white/40">Loading review…</span>
                </div>
              }
            >
              <ReviewGallery />
            </Suspense>
          }
        />
        {/* Last, and it must stay last: this is the catch-all. */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  );
}
