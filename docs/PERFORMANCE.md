# Performance — where the frame goes, and whether WebGPU would help

The question this document answers: *would moving to WebGPU make AiroHub
faster, or is the current architecture right and the wins are elsewhere?*

The short version is at the bottom of "The verdict". The rest is the working:
what a frame actually costs in this codebase, what round 11 found in the
transport, and what a WebGPU port would and would not buy against what it
would cost.

Everything below is measured against the code as it stands: three r185,
`@react-three/fiber` v9.7, `@react-three/drei` v10.7, `three-mesh-bvh` 0.9.14
(`package.json`).

## Where the frame time actually goes today

### The paint upload is the single largest per-frame cost

`src/paint/PaintSurface.ts` owns one 2048² 2D canvas that every player paints
into. Stamps are `drawImage` blits of pre-tinted 128² sprites — deliberately
cheap, and deliberately *not* path fills, so four players spraying at once
costs four blit streams rather than four path rasterisations.

The expensive part is not the drawing, it is the handoff. `commit()` sets
`texture.needsUpdate` at most once per frame, and `StudioScene`'s `useFrame`
calls it exactly once at the end of the loop
(`src/scene/StudioScene.tsx`, end of the frame body) no matter how many
painters deposited stamps. That is the correct shape and it was clearly built
on purpose — the alternative, one upload per dab, would push 16 MB of texels
per dab.

What it still costs, when someone is painting continuously:

| Quantity | Value |
| --- | --- |
| Texels | 2048 × 2048 = 4.19 M |
| Bytes per upload (RGBA8) | ~16 MB |
| Uploads per second while painting | up to 60 |
| Peak bandwidth | ~1 GB/s |

One important mitigation is already in place and must stay: `generateMipmaps =
false`, so a 16 MB upload does not also drag a full mip-chain rebuild behind
it. (`flipY = false` is there for the glTF UV convention rather than for speed,
and `anisotropy = 4` is a sampling cost, not an upload cost.)

The important property for the WebGPU question: **this cost is a full-texture
re-upload, and it is paid on the driver's texture path, not in the shader.**
Nothing about the renderer API changes its order of magnitude. More on that
below.

### Raycasts: high volume, already accelerated

`src/scene/SurfacePainter.ts` is the busiest CPU code in the app. Every path
sample fires rays, and the counts are not small:

| Constant | Value | Meaning |
| --- | --- | --- |
| `PATH_STEP_PX` | 4 | Screen-space resample step |
| `MAX_STEPS_PER_FRAME` | 36 | Cap on samples per frame per painter |
| `SPRAY_RAYS_PER_STEP` | 14 | Rays per spray sample |

A fast spray stroke can therefore fire up to 36 × 14 = **504 rays in one
frame, per painter**, plus the central probe, plus up to `DRIP_MAX_ACTIVE` (5)
drips marching in 2 px steps and raycasting each step. With four remote
players plus the host, the worst case is into the low thousands of rays per
frame.

This is affordable only because of `three-mesh-bvh`: `src/paint/modelRegistry.ts`
patches `BufferGeometry.prototype.computeBoundsTree` and
`Mesh.prototype.raycast`, builds a BVH per geometry at
`maxLeafTris: 24`, and `SurfacePainter`'s constructor sets
`raycaster.firstHitOnly = true` so a cast stops at the first leaf hit instead
of collecting and sorting every intersection.

Two second-order costs sit here too:

- `texelsPerWorldUnit()` caches per `mesh.uuid:face.a`, which is the right key,
  but the cache is cleared *wholesale* at 20 000 entries. On a dense model
  that produces a periodic cliff where every subsequent cast recomputes the
  triangle's UV/world area ratio. In practice a 20 k face-hit working set is
  rare, so this is a latent issue rather than a live one.
- All of this is CPU work in JavaScript. It is untouched by the choice of
  renderer.

### The motion pipeline

Covered in depth in [TRACKING.md](./TRACKING.md). Its performance profile is
benign: `AimTracker` runs on the controller at the sensor's own rate,
`InterpolatedCursor` in `src/utils/motion.ts` keeps a bounded 48-sample buffer
per remote player and does one Catmull-Rom evaluation per player per frame.
The buffer drain in `StudioScene`'s frame loop truncates
`player.cursorSamples` in place rather than reallocating. Nothing here shows
up in a profile.

### React boundaries

The hot paths are already off React's render path, and this was clearly
deliberate:

- Incoming `motion` packets mutate `playersRef.current` records directly and
  push an arrival-stamped sample; the comment at `src/components/CanvasView.tsx`
  (the `conn.on('motion', …)` handler) says exactly why.
- `PlayerTool` reads positional fields imperatively inside `useFrame` rather
  than taking them as props, so tool transforms never trigger a render.
- `StudioScene` keeps painters, stroke ids and cursors in refs.

The remaining React cost is structural rather than per-frame: `CanvasView.tsx`
is ~2 000 lines holding 41 `useState` hooks — every sheet toggle, AI panel
field, stamp-library edit and connection badge lives in the same component as
the `<Canvas>`. Any one of them re-renders the whole subtree and re-reconciles
the R3F children. It does not cost a dropped frame today (R3F's reconciler is
cheap for a tree this small) but it is the thing that will bite first as the
UI grows.

### Draw calls — the number that decides the WebGPU question

Reading the scene graph in `src/scene/StudioScene.tsx`, a full studio frame
submits, in round numbers:

- the painted model — a handful of meshes from one glTF
- one `<PlayerTool>` per player (rig meshes + reticle + laser line + a
  `NameTag` sprite), up to five players
- `<SprayMist>` — one `InstancedMesh` for a 1 400-particle pool
- `<ContactShadows>` — its own ortho depth render plus blur passes, every frame
- one shadow-casting `directionalLight` at `shadow-mapSize={[1024, 1024]}` —
  a second geometry submission for every caster, every frame
- `<StudioEnvironment>` — `frames={1}`, so a one-time 256² cube render at
  startup, not a per-frame cost

That lands in the region of **a few dozen draw calls plus one shadow pass**.
Confirm it in the console with `renderer.info.render.calls` before acting on
any of this, but the order of magnitude is not in doubt.

Hold that number. It is the whole argument.

## What round 11 fixed in the transport

The bottlenecks this project has actually hit have been transport bottlenecks,
not raster ones, and round 11 is the clearest example. Three faults, all in
`src/net/realtime.ts`: the channel had **no reconnection path** — a
`CHANNEL_ERROR`, `TIMED_OUT` or `CLOSED` status dispatched a connection event
to the UI and then nothing re-subscribed, so a phone that locked its screen or
hopped from wifi to cellular stayed dead until the player reloaded; a **failed
`channel.track()`** was caught and `console.error`'d but otherwise ignored,
which meant a player whose presence record never landed was absent from every
peer's derived roster while their own client believed it had joined — the "I
can see them spraying but there is no cursor" bug; and the client-side
**`eventsPerSecond: 50`** cap was a whole-socket send budget sitting below what
the app legitimately emits, with the overflow dropped *silently*, since
`StampBatcher` (`src/paint/stamps.ts`) flushes on a 60 ms timer *or* whenever
96 stamps have queued — and a single fast spray stroke can deposit 500 stamps
in one frame, forcing five flushes inside 16 ms, on top of 40 Hz motion and
camera sync riding the same socket. The fixes — a jittered rejoin backoff with
`online`/`pageshow`/`visibilitychange` wake listeners for the fast path back
from a sleeping phone, presence tracking that retries until it lands, and the
ceiling re-budgeted to 200 — are in the round 11 PR; the detail lives there
rather than here.

The point for this document is the pattern: **every user-visible "lag" this app
has had came from the wire, not the GPU.**

## WebGPU: what it would and would not buy AiroHub

### What WebGPU is genuinely good at

The wins are real and well documented, and they are specific:

1. **Lower per-draw CPU overhead.** WebGPU's command-encoder model and
   pre-baked pipeline state cut the JavaScript and driver validation cost of
   submitting a draw. This is what lets WebGPU hold frame rate in scenes where
   WebGL2 starts to choke on draw-call count — the effect shows up in scenes
   with *hundreds to thousands* of calls.
2. **Compute shaders.** GPU particle systems, fluid, physics, sorting,
   culling, ML inference — anything that would otherwise round-trip through
   the CPU. This is the category where the multiples people quote are earned.
3. **Better resource and memory control**, plus modern conveniences like
   multi-draw and storage buffers.

### What our frame looks like against that list

| WebGPU strength | AiroHub's exposure |
| --- | --- |
| Draw-call CPU overhead | A few dozen calls. Two orders of magnitude below where the advantage begins. |
| Compute shaders | No compute workload exists. Mist is a 1 400-instance CPU pool; drips are screen-space marches that must raycast the mesh; paint is 2D canvas blits. |
| Instancing at scale | One `InstancedMesh`, bounded pool, already the cheap path. |
| Shader complexity | `MeshStandardMaterial` plus four small chunk injections. Not fragment-bound. |
| Texture upload | **This is our bottleneck — and WebGPU is currently worse at it.** |

That last row deserves its own paragraph, because it inverts the usual
assumption. AiroHub's hottest per-frame operation is a canvas-to-texture
upload, and canvas upload is the one place where WebGPU today measurably
regresses against WebGL. The open spec issue
[gpuweb/gpuweb#5330](https://github.com/gpuweb/gpuweb/issues/5330) benchmarks
exactly our case: on an M1 Mac in Chrome, WebGL managed "240 2048x2048 canvas
to a texture uploads at 120fps" while WebGPU's
[`copyExternalImageToTexture`](https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/copyExternalImageToTexture)
managed roughly 40, later fluctuating between ~100 and ~220 as Chrome
improved. Firefox and Safari managed "at most a single 2048x2048 at 120fps".
Performance bugs are filed with all three vendors and the issue is still open.

Read that last figure against what AiroHub does: exactly one 2048² canvas
upload per painting frame, largely on Safari. Under WebGPU on Safari today that
is the *entire* measured budget — one upload, no headroom, on the browser most
of our phone traffic runs on. WebGL2 has roughly two orders of magnitude of
slack on the same operation. It is not a reason to panic, since we only ever
need the one upload, but it firmly rules out "WebGPU will speed up our texture
path" as a motivation — the honest expectation is a small regression there.

### What the migration would actually cost

**Every patched material must be rewritten in TSL.** This is not a config
change. The three.js manual is explicit: *"Custom materials based on
`ShaderMaterial`, `RawShaderMaterial` and modifications of built-in materials
via `onBeforeCompile()` are not supported in `WebGPURenderer`. This part of
your application must be ported to node materials and TSL"*
([three.js manual — WebGPURenderer](https://threejs.org/manual/en/webgpurenderer.html)).

We have two such patches, and both are load-bearing:

- `src/paint/paintMaterial.ts` — the paint compositor. Four chunk injections
  into `MeshStandardMaterial`'s fragment shader (`common`, `map_fragment`,
  `roughnessmap_fragment`, `metalnessmap_fragment`), keyed
  `airo-paintable-v1` via `customProgramCacheKey`. This is the feature. It
  samples `paintMap` at `vMapUv`, blends over the resolved albedo, and pushes
  painted texels toward matte dielectric. Porting it means rebuilding the
  albedo/roughness/metalness override as a node graph — and `vMapUv` in
  particular has no one-line TSL equivalent; it is a recurring question on
  [the three.js forum](https://discourse.threejs.org/t/how-to-port-onbeforecompile-patch-to-tsl-nodes/88730).
- `src/scene/LandingHero.tsx` — the fresnel rim, keyed `airo-hero-rim-v1`,
  injected at `opaque_fragment` where `normal` and `vViewPosition` are both
  still in scope. Straightforward as TSL goes, but still a rewrite.

**Plus the surrounding surface.** `drei` components that are themselves built
on `ShaderMaterial` need WebGPU-compatible variants; the pattern is a known
open thread on the library
([pmndrs/drei#2320](https://github.com/pmndrs/drei/issues/2320)). We use
`ContactShadows`, `Environment`/`Lightformer`, `OrbitControls` and `Billboard`,
so each needs verifying rather than assuming.

**Plus the renderer swap.** R3F v9 does support WebGPU — `state.gl` became
`state.renderer` and `Canvas` accepts an async `gl` factory, since
`WebGPURenderer` needs `await renderer.init()`
([v9 migration guide](https://r3f.docs.pmnd.rs/tutorials/v9-migration-guide)).
Workable, but it is a real change to `CanvasView`, `ControllerView` and
`LandingHero`, and R3F v10 is expected to make this a plain `renderer` prop —
so doing it now means doing it twice.

**Plus the testing matrix.** Today we test one renderer across our device
range. A WebGPU port with a WebGL2 fallback means testing *both* code paths on
every device, because the fallback is not dead code — it is what a meaningful
share of visitors will run. Two shader implementations of the paint compositor
that must produce pixel-identical output, or the artwork looks different
depending on the phone.

### The coverage cost

WebGPU support is broadly good in 2026 but not uniform, and the gaps land
precisely where our traffic is
([gpuweb Implementation Status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)):

| Platform | Status |
| --- | --- |
| Safari macOS / iOS / iPadOS | Shipped by default, version 26 and later |
| Chrome desktop (Mac, Windows, ChromeOS) | Shipped since 113 |
| Chrome Android | Shipped since 121, Android 12+, ARM and Qualcomm GPUs; Imagination and Samsung Xclipse still rolling out |
| Chrome Linux | Intel Gen12+ since 144, NVIDIA on Wayland since 147; other GPUs behind a flag |
| Firefox | Windows since 141, Apple Silicon macOS since 145; Linux and Android still Nightly-only, both targeted for 2026 |

For a phone-first app the number that matters is the iOS floor, and it is a
hard one: **WebGPU on iPhone requires iOS 26.** Apple's own App Store figures
put iOS 26 at 79% of all active iPhones as of June 2026, and 86% of iPhones
introduced in the last four years
([MacRumors, June 2026](https://www.macrumors.com/2026/06/09/ios-26-adoption-stats-wwdc/)).
So roughly one in five iPhones that opens an AiroHub invite link today cannot
run WebGPU at all — and older phones are exactly the population that would
benefit most from a faster renderer, if a faster renderer were the problem.

### The verdict

WebGPU would buy AiroHub close to nothing today. Our draw-call count is two
orders of magnitude below where its central advantage engages; we have no
compute workload for its strongest feature; and our actual hot path — a 2048²
canvas-to-texture upload per painting frame — is the one operation where
WebGPU currently benchmarks *behind* WebGL, most severely on Safari, which is
our primary mobile target.

Against that, the cost is a TSL rewrite of the paint compositor (the feature
the whole app is built on) and the hero rim, a drei compatibility audit, an
R3F renderer swap that R3F v10 will shortly make obsolete, a permanently
doubled testing matrix, and a renderer that ~21% of iPhone visitors cannot
use. Meanwhile every performance complaint this app has actually produced came
from the transport layer, which round 11 spent its time on for good reason.

**Stay on WebGL2. The architecture is right. The remaining wins are cheap ones
in the existing renderer, listed at the end of this document.**

## Revisit checklist

Reopen this decision when *any* of these becomes true — not before:

1. **A feature lands that genuinely needs compute.** GPU particle fluid, a
   real-time paint-simulation layer (wet paint that runs and pools on the
   GPU), mesh-space stroke rendering, cloth, or a large-scale physics
   interaction. This is the strongest trigger: it is a capability WebGL2
   cannot supply at all, not a speed difference.
2. **Draw calls pass ~500 per frame sustained.** Measure with
   `renderer.info.render.calls`. That would mean a much denser scene — many
   simultaneous objects, per-player scenery, a gallery view — and it is the
   point where WebGPU's draw-submission advantage starts to pay for itself.
3. **iOS WebGPU clears ~90% of our own traffic.** Not global adoption — our
   analytics. Track the iOS major version of real visitors and the presence of
   `navigator.gpu`. At 90% the fallback path stops being a first-class code
   path we have to test on every change.
4. **TSL reaches parity for our two patches**, demonstrated by a working
   prototype: `paintMaterial.ts`'s albedo/roughness/metalness override
   sampling the paint atlas at the model's own UV set, and `LandingHero`'s
   fresnel rim, both producing pixel-identical output to the GLSL versions.
   Prototype this as a spike before committing to anything.
5. **[gpuweb#5330](https://github.com/gpuweb/gpuweb/issues/5330) closes** with
   Safari's canvas-upload throughput at or above its WebGL number. Until then
   a port would slow down our hottest path.
6. **R3F v10 ships** with WebGPU as a first-class `renderer` prop, so the
   integration is a prop rather than an async factory that v10 will then
   change again.

A reasonable trigger set is (1) alone, or (3) and (4) together.

## Refinements that do matter

These are recommendations, not changes. Each is cheap, each is in the current
renderer, and each is worth measuring before and after.

### Stop re-rendering shadows that never change

The biggest available win, and it is nearly free. The painted subject is
**static in world space** — `OrbitControls` `autoRotate` moves the *camera*
around the target, not the object. But two things re-render every frame as if
the scene were animating:

- `<ContactShadows>` (`src/scene/StudioScene.tsx`) runs its own orthographic
  depth render plus blur passes each frame. Contact shadows are rendered from
  below and are camera-independent, so with a static subject the result is
  identical every frame. drei exposes `frames={1}`, which renders once on
  mount; the object swap is the only event that needs to retrigger it, so the
  practical form is `<ContactShadows frames={1} key={objectId} />` — remounting
  on the same value `StudioScene` already receives as a prop.
- The shadow-casting `<directionalLight>` at `shadow-mapSize={[1024, 1024]}`
  submits every caster a second time each frame. With a static light and a
  static subject, `light.shadow.autoUpdate = false` plus a manual
  `shadow.needsUpdate = true` on object change removes that pass entirely.

Together these are a full depth pass, a blur chain and a second geometry
submission per frame, on the device class that can least afford them.

### Give the studio canvas the renderer hints the hero already has

`src/scene/LandingHero.tsx` sets
`gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}`.
`src/components/CanvasView.tsx` — the canvas that actually does the work —
sets `gl={{ antialias: true, preserveDrawingBuffer: true }}` and no
`powerPreference`. Two notes:

- **Add `powerPreference: 'high-performance'`** to the studio canvas. On
  dual-GPU laptops this is the difference between the discrete and integrated
  GPU.
- **Audit `preserveDrawingBuffer: true`.** It forces the browser to retain the
  backbuffer after compositing, which blocks some driver optimisations. The
  only consumer of the GL canvas is the showcase recorder, and
  `src/showcase/recorder.ts` states in its own header comment that
  `canvas.captureStream()` "does NOT require `preserveDrawingBuffer`". Artwork
  export goes through `paintSurface.toExportDataURL()`, which reads the *paint*
  canvas, not the backbuffer. If nothing else reads pixels back, this flag can
  probably go — verify by testing the showcase recorder and any screenshot
  path with it removed.

### Cap DPR harder on phones, or adapt it

Both `CanvasView` and `ControllerView` use `dpr={[1, 2]}`. On a modern phone
that clamps a device ratio of 3 down to 2, which at a 390 × 844 CSS viewport
still means 780 × 1688 ≈ 1.3 Mpx, with MSAA on top. Options, cheapest first:

- Lower the ceiling on coarse pointers: `dpr={[1, 1.75]}` is visually almost
  indistinguishable on a phone and cuts fill by ~23%.
- Add drei's `<AdaptiveDpr pixelated />`, which drops resolution during camera
  movement and restores it when the view settles.
- Add `<PerformanceMonitor>` around the stage and drive `dpr` from its
  `onIncline` / `onDecline` callbacks, with hysteresis bounds so it cannot
  ping-pong ([R3F: scaling performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance)).

`AdaptiveDpr` is the right first move: it targets exactly the moment the frame
is most expensive (orbiting while painting) and costs nothing when idle.

### Measure the paint atlas dirty rect before optimising it

The one structural improvement still available in WebGL2 is **partial texture
upload** — `texSubImage2D` over the region that actually changed, instead of
re-uploading 16 MB. Whether it pays depends on a number nobody has measured
yet, and the answer is not obvious, because of the atlasing:

Strokes are local in *screen* space but scattered in *UV* space — that is the
entire reason `PaintSurface` refuses to interpolate in UV and
`SurfacePainter` resamples in screen space instead. So one frame's stamps may
have a UV bounding box covering most of the atlas even though the stroke is
two centimetres long on screen.

The measurement to take first: instrument the per-frame bounding box of
`result.stamps` in `StudioScene`'s frame loop and log its area as a fraction of
the atlas. **If the median dirty area is below roughly 25%, partial upload is
worth building. If it is not, the atlas layout is the thing to fix, not the
upload.** Do not build this on intuition.

### Keep the React boundary where it is, then tighten it

The per-frame paths are already correctly outside React — keep it that way.
Two things worth doing as the UI keeps growing:

- Split the stage out of `CanvasView.tsx`. 41 `useState` hooks in the same
  component as the `<Canvas>` means an unrelated sheet toggle re-reconciles the
  R3F children. Extracting the `<Canvas>` subtree into a memoised component
  with a narrow prop surface makes that structurally impossible.
- The `conn.on('action', …)` handler mirrors `isPainting` into React state on
  every trigger edge so the roster badges update. That is a few calls per
  second at most and is fine — the guardrail to keep is that it must never
  become per-frame.

### Cursor delay against send rate

From `docs/TRACKING.md`: `InterpolatedCursor`'s `delayMs` (90 ms) is a jitter
budget, and `MOTION_HZ` (40, in `ControllerView`) is the send rate.
`minSpacingMs` (18 ms) must stay below the 25 ms send period or the timeline
drifts. The tradeoff:

| Change | Buys | Costs |
| --- | --- | --- |
| Lower `delayMs` | Snappier remote cursors | Less headroom for delivery jitter; dropouts show as pauses |
| Raise `MOTION_HZ` | Finer remote stroke detail, allows lower `delayMs` | More events against the Realtime budget — the round 11 constraint |
| Lower `MOTION_HZ` | Transport headroom | Coarser path; `minSpacingMs` must drop with it |

`delayMs` is the safe knob and `MOTION_HZ` is not, because the send rate is
coupled to the event budget that round 11 was fixing. Change `delayMs` first,
and only touch `MOTION_HZ` with the transport budget in front of you. The
controller's own screen is unaffected by either — only the studio view carries
the delay, which is why painting stays WYSIWYG.

### Smaller items

- `PaintSurface`'s `tintCache` clears wholesale at 96 entries (each a 128²
  canvas, ~6 MB total). `SurfacePainter`'s `texelScaleCache` clears wholesale
  at 20 000. Both are cliff evictions rather than LRU. Neither is a live
  problem; both are worth knowing about if a profile shows a periodic spike.
- `StudioScene` prunes dead painters and cursors only when
  `painters.size > roster.length + 2`. Correct and cheap, but it means a
  departed player's `SurfacePainter` and its texel cache can outlive them for
  a while. Harmless at four players.
- `<StudioEnvironment>` already uses `frames={1}` and a 256² resolution with
  no CDN fetch. This is right; do not "upgrade" it to a downloaded HDR.

## Sources

- [three.js manual — WebGPURenderer](https://threejs.org/manual/en/webgpurenderer.html)
  — the authoritative statement that `onBeforeCompile` and `ShaderMaterial`
  are not supported and must be ported to node materials and TSL.
- [gpuweb/gpuweb#5330 — copyExternalImageToTexture is very slow](https://github.com/gpuweb/gpuweb/issues/5330)
  — benchmarks for 2048² canvas-to-texture upload, WebGL vs WebGPU, per browser.
- [gpuweb Implementation Status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)
  — per-browser, per-platform WebGPU shipping status.
- [MDN — GPUQueue.copyExternalImageToTexture()](https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/copyExternalImageToTexture)
- [React Three Fiber — v9 migration guide](https://r3f.docs.pmnd.rs/tutorials/v9-migration-guide)
  — `state.gl` → `state.renderer`, async `gl` prop for `WebGPURenderer`.
- [React Three Fiber — Scaling performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance)
  — `AdaptiveDpr`, `PerformanceMonitor`, frame-loop guidance.
- [pmndrs/drei#2320 — component not compatible with NodeMaterial](https://github.com/pmndrs/drei/issues/2320)
  — the drei-under-WebGPU compatibility thread.
- [three.js forum — porting an onBeforeCompile patch to TSL nodes](https://discourse.threejs.org/t/how-to-port-onbeforecompile-patch-to-tsl-nodes/88730)
- [Chrome for Developers — What's New in WebGPU (Chrome 121)](https://developer.chrome.com/blog/new-in-webgpu-121)
  — WebGPU on Android.
- [web.dev — WebGPU is now supported in major browsers](https://web.dev/blog/webgpu-supported-major-browsers)
- [MacRumors — iOS 26 adoption ahead of WWDC, June 2026](https://www.macrumors.com/2026/06/09/ios-26-adoption-stats-wwdc/)
  — Apple's own App Store figures, the basis for the iOS coverage floor.
