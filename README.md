# AiroHub

A collaborative 3D spray-paint studio. Put a real 3D object on the stage, then paint it
from any angle — with your mouse, or with up to four phones acting as motion-tracked
spray cans.

**Live:** https://airohub.netlify.app

---

## How it works

Three routes, all client-side:

| Route              | What it is                                                            |
| ------------------ | --------------------------------------------------------------------- |
| `/`                | Landing page — one **Launch Studio** button; the studio opens with its QR |
| `/canvas/:roomId`  | The studio. Full 3D stage, orbit, object picker, AI copilot            |
| `/controller/:roomId` | The phone controller. Aim, paint or pad                            |

### The studio screen

On wide displays the studio is an instrument panel of collapsible glass cards.
Left: the **tool card** shows the can, brush or stencil you are holding as a live
3D render (tap it to shake), with size, quick colours and the tool tiles; the
**stage card** has view tiles, a zoom slider, auto-orbit and a live azimuth /
elevation readout. Right: the **canvas card** lists every model and the crew of
phones, with the surface finish pinned under the list. Save and showcase live in
the header; what the pointer does and undo / redo / replay / clear share one
toolbar pill under the model. Below 1280px the same screen falls back to the
compact top bar, view island and bottom dock, so phones and tablets keep the
layout they had. The two furniture sets are rendered exclusively
(`src/ui/studio/useMediaQuery.ts`), never hidden with CSS.

The sky behind the stage is an **atmosphere** (`src/ui/studio/atmospheres.ts`):
six gradient presets in the spray-paint palette, six solid colours, a custom solid
and a crossfade between them. The glass tint, tiles and buttons take their accent
from the chosen atmosphere, and the choice is remembered per browser. Only the
studio screen changes; phones keep their own look.

### The spray can

The can is built in code (`src/scene/sprayCan.ts`), not downloaded: a lathe-profile
body with rolled seams, a valve cup, an actuator with its orifice, and a printed label
drawn once onto a canvas. It is on screen from the first frame everywhere it appears
(landing hero, studio, tool card, phone), costs about 3k triangles, and its body and
actuator are lacquered in the paint colour, so each painter's can on the stage is
theirs at a glance. The actuator sinks while the trigger is held. Geometry, the label
and the untinted materials are shared by every can; only the two tinted materials are
per can. The brush is still the generated GLB.

### Spray size

The size slider (studio card, phone dock) drives everything the nozzle does: the cone
`SurfacePainter` sprays into, the footprint ring on the model, the mist fan and the
hiss (skinny caps hiss higher). At 100% and below the stroke is the tuned one people
write their names with, unchanged. Above 100% the painter adds proportionally more,
larger grains so coverage per area holds as the fan widens, and fades in a soft core of
a few wide faint dabs, each still anchored to its own raycast. Size changes apply
mid-stroke.

`npm run test:writing` guards the default stroke: it replays handwriting through the
studio's real jitter buffer and painter (deterministic, no GPU) and fails if the paint
drifts off the line. A soft core laid under the default stroke once moved the paint's
median distance from the line from 5.2 px to 8.3 px, which is the difference between
writing your name and not.

```bash
npm run build && npx vite preview --port 4173 &
node scripts/preview/verify-spray-size.mjs   # paints at 40/100/200% and measures the band
```

### Painting model

Every player paints into one shared 2048² canvas. That canvas is **composited over each
object's own PBR texture in the shader** (`src/paint/paintMaterial.ts`) rather than
replacing it, which is what lets you spray over an already-textured object and keep its
material response everywhere you haven't painted. A `primerMix` uniform washes the base
towards a blank finish on demand — that is the "untextured variant" without shipping a
second asset.

Paint coordinates are always the model's own UVs, so the studio and every phone agree on
where paint lands regardless of camera angle.

### Realtime

Netlify has no long-lived WebSocket process, so there is no socket.io server. Peers talk
over **Supabase Realtime broadcast channels** (`src/net/realtime.ts`), which needs no
tables and no backend of ours.

Player slots come from Realtime *presence*: every peer sorts the presence map the same
way and derives identical slot numbers, so nobody needs to be the coordinator.

Motion is sent at 30 Hz and interpolated to frame rate on the studio side.

---

## 3D models

All sixteen models are generated with the [Meshy](https://meshy.ai) text-to-3D API
(`tool-spraycan.glb` is kept for the contact sheet, but the app now builds its can in
code — see above) and
committed to `public/models/` as optimised GLBs (~6 MB for the whole set).

```bash
MESHY_API_KEY=... npm run models:generate   # preview + PBR refine, resumable
npm run models:optimize                     # meshopt + WebP, ~95% smaller
npm run models:preview                      # renders a contact sheet to eyeball
```

`scripts/model-catalog.mjs` holds the prompts. Generation state lives in
`scripts/.meshy-state.json` so an interrupted run resumes instead of paying for the same
geometry twice; raw downloads are cached in `.model-cache/` (git-ignored, and kept out of
`public/` so they never reach the bundle).

To add an object: add an entry to `scripts/model-catalog.mjs`, add the matching entry to
`src/paint/objectCatalog.ts`, add its id to `TargetObjectType` in `src/types.ts`, then run
generate + optimize.

> Texture prompts state the finish positively *and* rule out grunge
> ("brand new, pristine, plain white … no dirt, no weathering"). Meshy's refine pass
> otherwise leans heavily toward weathered textures, which makes a poor painting surface.

### Reviewing assets

`/admin/review` puts every catalog model and every admin upload on a synchronized
turntable grid for a ship-it / needs-work pass, with notes persisted to Supabase
(`airohub_model_reviews`) so multiple reviewers share one checklist. Uploads are
**gated**: a custom model only appears in the object picker once a reviewer approves
it, and if the review table can't be reached the gate fails closed rather than letting
unreviewed geometry into live rooms. Full contract and behaviour notes in
[`src/review/README.md`](src/review/README.md).

`/admin` and `/admin/review` sit behind a shared password, and the gate is the API
endpoints rather than the route — reaching the URL only gets you a login card, because
every request for analytics, feedback or settings is refused without a valid admin
session cookie. The one exception, for now, is the model library and the review
verdicts on those pages: they still talk to Supabase with the public anon key. Moving
them behind the same cookie is the planned follow-up.

---

## Motion tracking

`src/utils/motion.ts` — full architecture notes in [docs/TRACKING.md](docs/TRACKING.md).

The phone aims like a **gyro mouse**, not a laser pointer: player-space rotation
*deltas* are integrated (pitch about the device's own X axis, yaw from the world
vertical), which makes tracking roll-invariant — vertical strokes stay vertical
however the phone is gripped — seam-free, and edge-ratcheting like a mouse. A
noise-cancelling movement estimate gates a banded orientation low-pass plus
tightening, so a held aim is pixel-still while flicks pass through with no lag.
Trigger presses and releases suppress deltas for ~100 ms (the thumb landing on
the glass physically rotates the phone), and **shaking the can re-centres the
aim** on top of rattling it. On the studio side, motion packets are replayed
through an arrival-stamped Catmull-Rom jitter buffer (~90 ms behind, slewed
playhead) instead of chasing the newest sample, so remote strokes render as
smooth curves under real network jitter.

Shake detection requires several direction reversals in a window rather than a
raw acceleration spike, so setting the phone down doesn't rattle the can.

Sensor samples are **de-bunched** before they reach the tracker (`sampleTime` in
`motion.ts`). Orientation events are stamped when the main thread handles them, so a
dropped frame delivers readings microseconds apart; the tracker would read that as a
flick and switch to its coarse precision curve mid-letter. The phone learns its sensor
interval and spaces bunched readings at no less than 70% of it (check K in the aim
suite: 1.10% of the stage off course on raw stamps, 0.12% de-bunched).

Fine control is tuned against a tremor model (check L: 8-12 Hz physiological
tremor plus sensor noise). The hold-tightening only squashes movement below 3°/s, so a
careful nudge moves the aim in proportion instead of hitting a dead zone (a 4°/s nudge
used to deliver 57% of its travel, 350 ms late; now 95%, 133 ms). The orientation
low-pass stays partly closed up to 100°/s, so tremor no longer rides into careful strokes
(2.5 px down to 1.0 px), while flicks still pass raw.

On the studio side, each player's floating can rides the **aim ray** (camera to paint
point, `src/scene/toolPlacement.ts`) rather than hovering off the hit triangle's normal.
The normal hung the can on a 1-unit lever: at the side of a skateboard truck it shoved the
can backwards against the stroke (it looked stuck, then jumped), and lumpy geometry came
out as jitter. On the ray the nozzle tracks the aim on screen and edges only change its
depth, which glides (`npm run test:placement`).

The **landing page** does not use the tracker. There the phone is in your hand, screen
toward you, and you tilt it like a spirit level, which the tracker (built for a phone
pointed at a TV, roll-blind by design) cannot follow. `src/utils/tiltAim.ts` aims from
gravity in screen axes instead: right edge down moves right, top edge down moves down,
a held tilt holds, landscape works, and a One-Euro filter keeps it steady
(`npm run test:tilt`).

```bash
npm test   # includes 13 aim, 10 tilt, 2 writing-precision and 2 tool-placement checks
```

---

## Local development

```bash
npm install
cp .env.example .env      # add your Supabase URL + publishable key
npm run dev               # vite, port 5173
```

The AI panel calls `/api/ai/*`, which are Netlify functions. Plain `vite` does not serve
them and the UI falls back to curated responses. To exercise them locally:

```bash
npx netlify dev
```

Without Supabase credentials the studio still runs fully as a solo painting tool; it
reports "Solo mode" instead of a phone count.

### Environment

| Variable                  | Where     | Purpose                                          |
| ------------------------- | --------- | ------------------------------------------------ |
| `VITE_SUPABASE_URL`       | build     | Realtime endpoint                                |
| `VITE_SUPABASE_ANON_KEY`  | build     | Realtime publishable key                         |
| `GEMINI_API_KEY`          | runtime   | AI copilot; falls back to curated content if unset |
| `MESHY_API_KEY`           | local only| Regenerating the 3D models                       |

### Deploy previews

Every pull request gets its own deploy preview, and Netlify gives that preview a
database branch **seeded from production**. A preview link can therefore show real
visitor feedback and real analytics rather than an empty table — which is also why the
email field on the feedback form is optional: previews are ours, but the rows in them
are not synthetic.

---

## Layout

```
src/
  components/     Home, CanvasView (studio), ControllerView (phone)
  scene/          R3F scene graph — target, tools, mist, lighting, camera fitting
  paint/          PaintSurface, the paint-over-PBR shader, model registry + catalog
  net/            Supabase Realtime transport
  ui/             Liquid-glass primitives, colour well, object picker
  utils/          Motion tracking, audio, uploaded-model parsing
netlify/functions/ AI endpoints
scripts/          Meshy generation, GLB optimisation, screenshot harnesses
```

## Verifying the UI

```bash
npm run build && npm run preview
BASE=http://127.0.0.1:4173 npm run shots
```

Screenshots land in `scripts/preview/out/` across desktop, tablet and phone viewports.
The harness fails the run on console errors, page errors or failed requests, so a page
that looks fine but is quietly broken still gets caught.

For agent-driven work there is a second tier: [docs/AGENT-VISUAL-QA.md](docs/AGENT-VISUAL-QA.md)
says which tool answers which question — SceneProof for fresh leaf-component and scene
renders, the `verify-*.mjs` harnesses for anything integrated.
