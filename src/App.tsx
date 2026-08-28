/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './components/Home';
import CanvasView from './components/CanvasView';
import ControllerView from './components/ControllerView';
import HowItWorks from './components/HowItWorks';

// The admin portal drags in analysis/optimization machinery nobody painting
// in a session ever needs, so it only loads when /admin is actually visited.
const AdminView = lazy(() => import('./components/AdminView'));

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/canvas/:roomId" element={<CanvasView />} />
        <Route path="/controller/:roomId" element={<ControllerView />} />
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
      </Routes>
    </Router>
  );
}

