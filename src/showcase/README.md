# Showcase — turntable video export

Records a cinematic 360-degree orbit of the painted piece straight off the WebGL
canvas and saves it as `airohub-<room>-showcase.webm`.

Two files, zero edits to anything existing:

- `recorder.ts` — headless. `recordTurntable(handles, seconds, onProgress, signal?) => Promise<Blob>`
- `ShowcasePanel.tsx` — the glass dialog. Props: `{ open, onClose, handles }`

## Integration recipe

```tsx
// 1. imports
import { ShowcasePanel } from '../showcase/ShowcasePanel';
import type { ShowcaseHandles } from '../showcase/recorder';

// 2. state (next to the other sheet flags in CanvasView)
const [showcaseOpen, setShowcaseOpen] = useState(false);
const glCanvasRef = useRef<HTMLCanvasElement | null>(null);

// 3. handles — orbitRef already exists in CanvasView; both getters are called
//    lazily, so a ref that is still null mid-load is fine.
const showcaseHandles: ShowcaseHandles = useMemo(
  () => ({
    getCanvas: () => glCanvasRef.current,
    getOrbit: () => orbitRef.current,
    roomId,
  }),
  [roomId]
);

// 4. one added prop on the existing <Canvas>, to capture the r3f canvas element
<Canvas onCreated={({ gl }) => { glCanvasRef.current = gl.domElement; }} ...>

// 5. the two JSX lines — a trigger anywhere in the command bar, and the panel
<button onClick={() => setShowcaseOpen(true)}>Showcase</button>
<ShowcasePanel open={showcaseOpen} onClose={() => setShowcaseOpen(false)} handles={showcaseHandles} />
```

If touching `<Canvas>` is inconvenient, `getCanvas` can be
`() => document.querySelector<HTMLCanvasElement>('canvas')` instead — the
recorder only ever needs the element.

## Contract

```ts
export interface ShowcaseHandles {
  /** The WebGL canvas to capture (r3f gl.domElement). */
  getCanvas: () => HTMLCanvasElement | null;
  /** OrbitControls instance ref (drei) — has getAzimuthalAngle/setAzimuthalAngle, autoRotate props, update(). */
  getOrbit: () => any | null;
  roomId: string;
}
```

Also exported from `recorder.ts`: `checkShowcaseSupport()`, `pickMimeType()`,
`downloadBlob(blob, name)`, `showcaseFileName(roomId)`, `cinematicEase(t)`,
`ShowcaseError`, and the types `ShowcaseProgress`, `ShowcaseSupport`,
`ShowcaseSeconds`.

## Behaviour notes

- **No `preserveDrawingBuffer` needed.** `canvas.captureStream(60)` taps the
  canvas' presentation pipeline, not a readback, so a default r3f canvas records
  fine. (The studio already sets the flag for PNG snapshots; irrelevant here.)
- **Camera state is borrowed, not kept.** The recorder saves the current
  azimuth, `autoRotate` and `enableDamping`, sweeps `start + ease(t) * 2PI`, then
  restores all three — on success, on abort and on error alike.
- **The panel does not appear in the video.** `captureStream` records the canvas,
  not the page composite, so the overlay is invisible in the export. The backdrop
  thins out during the take on purpose, so the operator can watch the sweep.
- **Codec order:** `video/webm;codecs=vp9` -> `vp8` -> `video/webm` -> recorder
  default. Safari has only recently shipped WebM in MediaRecorder; on an old
  Safari the panel shows a plain explanation and offers nothing that can fail.
- **Backgrounded tabs.** `requestAnimationFrame` stalls when the tab is hidden, so
  a wall-clock backstop ends the take at `duration + 1.5s` regardless. The panel
  tells the user to keep the tab in front.
- **`frameloop`.** The studio `<Canvas>` runs the default `frameloop="always"`;
  if it were ever switched to `"demand"` the stream would capture very few frames.
