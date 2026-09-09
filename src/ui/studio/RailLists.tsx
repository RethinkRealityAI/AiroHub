/**
 * The right rail's lists.
 *
 *   `ObjectRows` — every paintable object as a row (render, name, mono meta),
 *                  grouped by category, with the loaded one highlighted. The
 *                  desktop replacement for opening a sheet just to switch
 *                  canvas; the sheet is still what phones and tablets get.
 *   `CrewRows`   — the four phone slots as rows with the same anatomy, so the
 *                  people painting live next to the things being painted.
 */
import React from 'react';
import { Check, Copy, Loader2, Upload, Video, Smartphone, Hand, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { TargetObjectType, PlayerState } from '../../types';
import { OBJECT_CATEGORIES, objectsInCategory, PaintableObject } from '../../paint/objectCatalog';
import { ObjectThumb } from '../ObjectPicker';

const ObjectRow: React.FC<{
  object: PaintableObject;
  selected: boolean;
  loading: boolean;
  onSelect: () => void;
}> = ({ object, selected, loading, onSelect }) => (
  <button
    type="button"
    role="option"
    aria-selected={selected}
    onClick={onSelect}
    className="tap rail-row"
  >
    <ObjectThumb
      thumb={object.thumb}
      label={object.label}
      size={42}
      accent={selected ? '#c084fc' : '#a78bfa'}
      className="rounded-full bg-black/25 ring-1 ring-white/10"
    />
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[12.5px] font-semibold text-white">{object.label}</span>
      <span className="mono-caps block mt-0.5 text-[8.5px] text-white/45 truncate">
        {object.category}
        <span className="mx-1.5 text-white/25">•</span>
        {loading ? 'Loading' : object.id === 'custom3d' ? 'Upload' : 'PBR'}
      </span>
    </span>
    {loading ? (
      <Loader2 size={13} className="animate-spin text-white/70 shrink-0" />
    ) : selected ? (
      <span
        className="h-2 w-2 rounded-full shrink-0"
        style={{ background: '#c084fc', boxShadow: '0 0 10px #c084fc' }}
      />
    ) : null}
  </button>
);

export const ObjectRows: React.FC<{
  objectId: TargetObjectType;
  loading: boolean;
  onSelect: (id: TargetObjectType) => void;
  onUpload?: () => void;
  customName?: string;
}> = ({ objectId, loading, onSelect, onUpload, customName }) => (
  <div role="listbox" aria-label="Choose a canvas" className="flex flex-col gap-3">
    {OBJECT_CATEGORIES.filter((category) => objectsInCategory(category).length > 0).map((category) => (
      <div key={category}>
        <div className="mono-caps px-2 mb-1 text-[8.5px] text-white/35">{category}</div>
        <div className="flex flex-col gap-0.5">
          {objectsInCategory(category).map((object) => (
            <ObjectRow
              key={object.id}
              object={object}
              selected={object.id === objectId}
              loading={loading && object.id === objectId}
              onSelect={() => onSelect(object.id)}
            />
          ))}
        </div>
      </div>
    ))}

    {(onUpload || customName) && (
      <div>
        <div className="mono-caps px-2 mb-1 text-[8.5px] text-white/35">Your own</div>
        <div className="flex flex-col gap-0.5">
          {customName && (
            <ObjectRow
              object={{
                id: 'custom3d',
                label: customName,
                short: customName,
                category: 'Uploads',
                blurb: 'Your uploaded model.',
                targetSize: 11,
              }}
              selected={objectId === 'custom3d'}
              loading={loading && objectId === 'custom3d'}
              onSelect={() => onSelect('custom3d')}
            />
          )}
          {onUpload && (
            <button
              type="button"
              onClick={onUpload}
              className="tap rail-row border-dashed !border-white/15 text-white/65 hover:text-white"
            >
              <span className="grid h-[42px] w-[42px] place-items-center rounded-full bg-white/[0.05]">
                <Upload size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-semibold">Upload a model</span>
                <span className="mono-caps block mt-0.5 text-[8.5px] text-white/40">GLB • GLTF • OBJ • STL</span>
              </span>
            </button>
          )}
        </div>
      </div>
    )}
  </div>
);

/* ------------------------------------------------------------------
   Crew
   ------------------------------------------------------------------ */

export const CrewRows: React.FC<{
  players: PlayerState[];
  cameraSyncIds: Set<string>;
  onToggleCameraSync: (playerId: string) => void;
  onInvite: () => void;
  /** The join link, shown as a QR right on the rail so nobody hunts for it. */
  controllerUrl: string;
  roomId: string;
  copied: boolean;
  onCopyLink: () => void;
}> = ({ players, cameraSyncIds, onToggleCameraSync, onInvite, controllerUrl, roomId, copied, onCopyLink }) => (
  <div className="flex flex-col gap-0.5">
    {/* Invite block: the QR a phone camera scans, the code to read aloud. */}
    <div className="mb-3 flex items-center gap-3 rounded-[20px] border border-white/10 bg-white/[0.04] p-2.5">
      <button
        type="button"
        onClick={onInvite}
        title="Show a bigger code"
        className="tap shrink-0 rounded-2xl bg-white p-1.5 shadow-[0_16px_40px_-18px_rgba(192,132,252,0.9)]"
      >
        <QRCodeSVG value={controllerUrl} size={76} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="mono-caps text-[8.5px] text-white/40">Room code</div>
        <div className="mt-0.5 text-[20px] font-black tracking-[0.22em] pl-[0.22em] leading-none text-white">{roomId}</div>
        <p className="mt-1.5 text-[10px] leading-snug text-white/50">Scan with a phone camera to turn it into a spray can.</p>
        <button
          type="button"
          onClick={onCopyLink}
          className="tap mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.07] px-2.5 py-1 text-[9.5px] font-semibold text-white/80 hover:bg-white/[0.14] hover:text-white"
        >
          {copied ? <Check size={10} className="text-emerald-300" /> : <Copy size={10} />}
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </div>
    {[1, 2, 3, 4].map((slot) => {
      const player = players.find((p) => p.slot === slot);
      if (!player) {
        return (
          <button
            key={slot}
            type="button"
            onClick={onInvite}
            className="tap rail-row border-dashed !border-white/12 text-white/50 hover:text-white/85"
          >
            <span className="grid h-[42px] w-[42px] place-items-center rounded-full border border-dashed border-white/20">
              <QrCode size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-semibold">Slot {slot} open</span>
              <span className="mono-caps block mt-0.5 text-[8.5px] text-white/35">Scan to join</span>
            </span>
          </button>
        );
      }
      const syncOn = cameraSyncIds.has(player.id);
      return (
        <div key={slot} className="rail-row" data-active={player.isPainting || undefined}>
          <span
            className={`relative grid h-[42px] w-[42px] place-items-center rounded-full text-[14px] font-black text-black/80 ${
              player.isPainting ? 'airo-breathe' : ''
            }`}
            style={{ background: player.color, boxShadow: `0 8px 22px -8px ${player.color}` }}
          >
            {player.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-semibold text-white">{player.name}</span>
            <span className="mono-caps flex items-center gap-1.5 mt-0.5 text-[8.5px] text-white/45">
              {player.mode === 'projection' ? <Hand size={9} /> : <Smartphone size={9} />}
              {player.mode === 'projection' ? 'Touch' : 'Motion'}
              <span className="text-white/25">•</span>
              {player.isPainting ? <span className="text-fuchsia-300">Painting</span> : player.tool}
            </span>
          </span>
          <button
            type="button"
            onClick={() => onToggleCameraSync(player.id)}
            aria-pressed={syncOn}
            title={
              syncOn
                ? 'This player is steering the studio camera — click to stop'
                : "Let this player's gestures rotate the studio camera"
            }
            className={`tap shrink-0 rounded-full px-2 py-1 border text-[8.5px] font-bold flex items-center gap-1 mono-caps ${
              syncOn
                ? 'bg-fuchsia-400/25 border-fuchsia-300/50 text-fuchsia-200'
                : 'bg-white/[0.06] border-white/15 text-white/50 hover:text-white'
            }`}
          >
            <Video size={10} />
            Cam
          </button>
        </div>
      );
    })}
    <p className="mono-caps mt-2 px-2 text-[8.5px] text-white/35 flex items-center gap-1.5">
      <Check size={9} /> Up to four phones per studio
    </p>
  </div>
);
