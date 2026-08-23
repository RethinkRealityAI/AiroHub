import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, Monitor, Users, Upload, Box, Wand2 } from 'lucide-react';

export default function Home() {
  const [roomId, setRoomId] = useState('');
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const id = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomId(id);
  }, []);

  const controllerUrl = `${window.location.origin}/controller/${roomId}`;

  const copyLink = () => {
    navigator.clipboard.writeText(controllerUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#080808] text-[#D1D1D1] flex flex-col items-center justify-center p-6 font-sans">
      <div className="max-w-4xl w-full flex flex-col items-center bg-[#0C0C0C] rounded-3xl p-8 md:p-12 shadow-2xl border border-[#1A1A1A]">
        <div className="flex items-center space-x-4 mb-4">
          <div className="w-9 h-9 bg-gradient-to-tr from-[#FF3D00] to-[#FFD600] rounded-xl shadow-[0_0_20px_rgba(255,61,0,0.35)]"></div>
          <div>
            <span className="text-3xl font-bold tracking-tighter text-white">
              AERO•CANVAS <span className="text-[10px] font-mono text-[#555] ml-2 px-2 py-0.5 border border-[#222] rounded align-middle">3D MULTIPLAYER</span>
            </span>
          </div>
        </div>

        <p className="text-[#888] text-center mb-6 max-w-xl text-[12px] leading-relaxed">
          Full-viewport 3D collaborative graffiti studio. Up to 4 players can connect with their own 3D spray cans and brushes. Spray 3D objects or upload custom 3D models (.glb, .gltf, .obj, .stl) with AI copilot stylization.
        </p>

        {/* Feature Badges */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-8 text-[9px] font-mono uppercase tracking-wider text-[#777]">
          <span className="px-3 py-1 bg-[#141414] border border-[#222] rounded-full text-cyan-400 flex items-center gap-1">
            <Users size={11} />
            <span>Up to 4-Player Multiplayer</span>
          </span>
          <span className="px-3 py-1 bg-[#141414] border border-[#222] rounded-full text-emerald-400 flex items-center gap-1">
            <Upload size={11} />
            <span>Upload 3D Models (.glb/.obj/.stl)</span>
          </span>
          <span className="px-3 py-1 bg-[#141414] border border-[#222] rounded-full text-[#FF3D00] flex items-center gap-1">
            <Box size={11} />
            <span>9 Interactive 3D Objects</span>
          </span>
          <span className="px-3 py-1 bg-[#141414] border border-[#222] rounded-full text-violet-400 flex items-center gap-1">
            <Wand2 size={11} />
            <span>AI Copilot & Stylizer</span>
          </span>
        </div>

        <div className="flex flex-col md:flex-row gap-8 items-stretch justify-center w-full">
          {/* Desktop Canvas Screen Card */}
          <div className="flex flex-col items-center justify-between p-6 bg-[#111114] border border-[#1F1F24] rounded-2xl flex-1 text-center">
            <div className="flex flex-col items-center">
              <div className="w-14 h-14 bg-[#18181D] rounded-2xl flex items-center justify-center text-[#FF3D00] mb-3 border border-[#25252E] shadow-lg">
                <Monitor size={28} strokeWidth={1.5} />
              </div>
              <h2 className="text-sm font-bold text-white tracking-wide mb-1">1. Launch Studio Canvas</h2>
              <p className="text-[11px] text-[#777] leading-relaxed max-w-xs mb-4">
                Opens the host 3D studio. Features real-time multi-spray physics, custom 3D model upload, and 360° camera orbit.
              </p>
            </div>

            <button
              onClick={() => navigate(`/canvas/${roomId}`)}
              className="w-full py-3.5 bg-[#FF3D00] hover:bg-orange-600 text-white text-[10px] font-bold uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-orange-950/40 active:scale-95"
            >
              Open 3D Studio Canvas
            </button>
          </div>

          {/* Mobile Controller Screen Card */}
          <div className="flex flex-col items-center justify-between p-6 bg-[#111114] border border-[#1F1F24] rounded-2xl flex-1 text-center">
            <div className="flex flex-col items-center">
              <div className="w-14 h-14 bg-[#18181D] rounded-2xl flex items-center justify-center text-cyan-400 mb-3 border border-[#25252E] shadow-lg">
                <Smartphone size={28} strokeWidth={1.5} />
              </div>
              <h2 className="text-sm font-bold text-white tracking-wide mb-1">2. Connect Mobile Devices</h2>
              <p className="text-[11px] text-[#777] leading-relaxed mb-3">
                Scan QR code with up to 4 phones. Each player gets their own color slot, floating 3D tool, and alias.
              </p>

              <div className="bg-white p-2.5 rounded-xl shadow-lg mb-3">
                {roomId && <QRCodeSVG value={controllerUrl} size={120} />}
              </div>
            </div>

            <div className="w-full flex items-center justify-between bg-[#18181F] border border-[#262630] rounded-xl px-3 py-2">
              <span className="text-[9px] font-mono font-bold text-[#AAA]">ROOM: {roomId}</span>
              <button
                onClick={copyLink}
                className="text-[9px] bg-[#222] hover:bg-[#333] text-white px-2.5 py-1 rounded-lg transition-colors uppercase font-bold"
              >
                {copied ? 'Copied!' : 'Copy Link'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
