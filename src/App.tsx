/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './components/Home';
import CanvasView from './components/CanvasView';
import ControllerView from './components/ControllerView';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/canvas/:roomId" element={<CanvasView />} />
        <Route path="/controller/:roomId" element={<ControllerView />} />
      </Routes>
    </Router>
  );
}

