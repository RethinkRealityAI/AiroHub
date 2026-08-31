# Asset Review — turntable gallery + the upload promotion gate

Puts every object a session can load on a turntable at `/admin/review`, records
a verdict per asset in Supabase, and makes an admin upload wait for `approved`
before it appears in anybody's object picker.

Nine files, and it costs the rest of the app one route line and one gate edit:

- `reviews.ts` — headless. `listVerdicts()`, `upsertVerdict(input)`, `clearVerdict(key)`
- `assets.ts` — headless. `buildReviewAssets()` / `builtinReviewAssets()`
- `exportChecklist.ts` — pure. `buildChecklist(assets, verdicts, now)`, `bucketAssets(...)`
- `reviewModels.ts` — three.js only. `loadForReview(asset)`, `blankPaintTexture()`
- `reviewEnv.ts` — three.js only, no R3F. `getReviewEnvironment(renderer, kind)`
- `TurntableView.tsx` — one drei `<View>` per card
- `ReviewCard.tsx`, `ReviewDetail.tsx` — the glass surfaces
- `ReviewGallery.tsx` — the route component (default export)

## Integration recipe

```tsx
// 1. src/App.tsx — one lazy import, mirroring the AdminView block
const ReviewGallery = lazy(() => import('./review/ReviewGallery'));

// 2. src/App.tsx — one route
<Route
  path="/admin/review"
  element={
    <Suspense fallback={/* the same stage-vignette spinner /admin uses */}>
      <ReviewGallery />
    </Suspense>
  }
/>
```

```ts
// 3. src/paint/customModels.ts — the gate. Two fetches instead of one, and
//    only approved ids are registered into the catalog.
const [modelsRes, reviewsRes] = await Promise.all([
  fetch(`${URL}/rest/v1/airohub_models?select=id,name,storage_path,target_size…`, { headers }).catch(() => null),
  fetch(`${URL}/rest/v1/airohub_model_reviews?select=asset_key&kind=eq.upload&status=eq.approved`, { headers }).catch(() => null),
]);
if (!modelsRes || !modelsRes.ok) return 0;               // offline, as before
if (!reviewsRes || !reviewsRes.ok) { warnOnce(); return 0; }  // FAIL CLOSED
const approved = new Set((await reviewsRes.json()).map((r) => r.asset_key));
// … `if (!approved.has(id)) continue;` inside the registration loop
```

```ts
// 4. src/admin/supabase.ts — one accessor, so reviews.ts reuses the memoised
//    client instead of opening a second auth/realtime stack.
export function getSupabaseClient(): SupabaseClient { return getClient(); }
```

```tsx
// 5. src/components/AdminView.tsx — one header chip next to the Home link
<Link to="/admin/review" className="tap glass glass-sheen …">
  <ClipboardCheck size={14} /> Review
</Link>
```

The table itself is `supabase/migrations/20260831120000_airohub_model_reviews.sql`.
Nothing about `airohub_models` changes — in particular it gains no UPDATE policy.

## Contract

```ts
export type Verdict = 'pending' | 'approved' | 'rejected';
export type AssetKind = 'builtin' | 'upload';

export interface ReviewRow {
  asset_key: string;        // 'easel' | 'up-<uuid>' — the app-wide catalog id
  kind: AssetKind;
  model_id: string | null;  // airohub_models.id for uploads; delete cascades
  status: Verdict;
  note: string;
  reviewer: string;
  created_at: string;
  updated_at: string;
}

export interface ReviewAsset {
  key: string;
  kind: AssetKind;
  label: string;
  modelId: string | null;
  poster?: string;          // '/ui/objects/<id>.webp'; absent for uploads
  category: string;
  blurb: string;
  targetSize: number;
  url?: string;             // absolute GLB URL, uploads only
  sizeBytes?: number;
  triangles?: number;
  createdAt?: string;
}

export interface ReviewDiagnostics {
  env: 'neutral' | 'studio';
  silhouette: boolean;
  primer: boolean;
}

export interface CameraPose { azimuth: number; polar: number; zoom: number }
```

Also exported: `verdictOf(map, key)`, `toneOf(row)` (the one place the flagged
rule lives), `TONE_COLOR` / `TONE_LABEL`, `sharedTurntableYaw(elapsed, spinning)`,
`fitDistance(radius, aspect, margin?)`, `GRID_POSE`, `REVIEW_FOV`,
`buildStudioEnvScene()` and `disposeReviewEnvironments(renderer)`.

Debug hook, asserted by `scripts/preview/verify-asset-review.mjs`:

```ts
window.__airoReview(): {
  ready: boolean; cards: number; mounted: number; pending: number;
  verdictWrites: number; backend: boolean;
  stages: Record<string, 'loading' | 'ready' | 'error'>;
}
```

localStorage keys: `airo:review:reviewer`, `airo:review:cam:<assetKey>`.

## Behaviour notes

- **One canvas, many views.** Chromium keeps roughly sixteen WebGL contexts
  alive and evicts the oldest without warning, so a grid of per-card
  `<Canvas>` elements blanks cells at random as you scroll. Every card is a
  drei `<View>` scissored out of one shared context (`<Canvas eventSource
  dpr={[1,1.5]}>` + `<View.Port />`), which also puts the whole grid on one
  frame budget instead of sixteen.
- **The canvas sits above the sheet scrim.** It is `position: fixed; z-index: 70`,
  above `Sheet`'s `z-60`, so the detail modal can draw through it; grid views
  are passed `visible={false}` while the modal is open so they cannot paint
  over the scrim. `eventSource` makes r3f set `pointer-events: none` on the
  canvas, so nothing underneath loses a click.
- **Off-screen cards are not mounted.** IntersectionObserver with
  `rootMargin: '200px 0px'` (the `GuideStage` setting) mounts a stage just
  before it arrives and drops it once it leaves. The card keeps its poster in
  the meantime, so the grid never reflows under the cursor.
- **The frame loop is parked by default.** `frameloop` is `always` only while
  at least one stage is live AND Spin is on; otherwise `demand`, with
  `invalidate()` after every commit and on scroll and resize (in `demand`
  nothing repaints on its own, and scrolling moves the scissor rects without
  re-rendering React).
- **Spin defaults off under `prefers-reduced-motion`.** Sixty rotating objects
  is exactly what that setting is for.
- **Every card gets a clone.** Each `<View>` portals into its own
  `THREE.Scene`, and an Object3D has one parent — handing the cached root to a
  grid card and then to the detail modal makes the two fight over it and one
  goes blank. `loadForReview()` returns `root.clone(true)`; geometry, materials
  and the BVH stay shared, so cloning is cheap and the paint uniforms still
  resolve to one block per material. That sharing is also why Primer is a
  gallery-wide toggle rather than per card.
- **Uploads must be registered before they are loaded.** `modelUrl()` falls
  back to `/models/<id>.glb`, which for `up-<uuid>` does not exist, and both
  the dev server and Netlify answer an unknown path with `index.html` — so
  GLTFLoader gets a 200 full of HTML. `registerModelUrl` therefore runs before
  `loadModel`, not alongside it.
- **The paint sampler is never null.** `paintMaterial.ts` samples `paintMap`
  unconditionally; binding nothing to that unit is undefined behaviour and
  reads whatever was last bound. Reviewed models get a shared 1×1 fully
  transparent `DataTexture`, which blends to a no-op.
- **`listCustomModels()`, never `ensureCustomModels()`.** The latter is the
  player's view — approved-only, and it mutates the global catalog. Building
  the roster from it would mean reviewing the gate through the gate: a fresh
  upload is pending, so it would never appear here, so it could never be
  approved. The feature would be inert on day one.
- **Neutral light is the default, deliberately.** The studio rig has two
  brand-coloured rim accents that paint a flattering edge on anything, which is
  how a muddy normal map gets waved through. `neutral` is a plain
  RoomEnvironment PMREM: judge the asset, not our lighting. `studio` answers
  the second question — how it will look in a room.
- **Silhouette clears per card, not per renderer.** It sets
  `scene.overrideMaterial` plus a `Color` `scene.background`; a Color
  background makes `WebGLRenderer` force a clear, and that clear obeys the
  scissor rect drei has already set. `gl.setClearColor` is renderer-global and
  would repaint every other card too.
- **Absence is pending, and the gate fails closed.** There is no row until
  somebody judges an asset, so `publishModel()` writes nothing here — one
  source of truth, no second failure path at publish time. If the reviews query
  fails while the registry query succeeds, zero uploads are registered and the
  console carries one warning. Failing open would be worse than having no gate:
  the moment the check is most likely to be down is the moment it would be
  silently bypassed.
- **No localStorage fallback for verdicts.** With Supabase unconfigured the
  turntables and every diagnostic still work and the verdict controls go dark
  behind the `CloudOff` notice. Caching verdicts locally would be worse than a
  disabled button: the gate reads the database, so a reviewer would approve
  twenty assets, watch the chips turn green, and none of it would reach a
  single player. A control that does nothing must look like one.
- **Keyboard.** `j` / `k` / arrows move, `Enter` opens, `a` approves, `x`
  rejects, `n` jumps to the note, `Esc` closes. All of it stands down while an
  `input`, `textarea`, `select` or contenteditable has focus; `Esc` blurs the
  field first and closes the sheet only on a second press, so a half-typed note
  is never lost to a keystroke meant to unfocus.
- **Checklist order is the argument.** Needs work, then Flagged (a note with no
  verdict — the pessimistic default), then Ship it, then the unreviewed count.
  Opening with the approved pile would bury the two sections somebody has to
  act on.

## Verification

```
node scripts/test/review-export.mjs                       # pure, no browser
BASE=http://127.0.0.1:5180 CHROME_BIN=/opt/pw-browsers/chromium \
  node scripts/preview/verify-asset-review.mjs            # stubbed Supabase
BASE=http://127.0.0.1:5180 node scripts/preview/shoot-review.mjs
```

`verify-asset-review.mjs` stubs `**/rest/v1/airohub_model*` with fixtures, so it
never writes to the shared production project. It drives a second and third page
to `/canvas/GATE1` to prove the gate both closes on a failing reviews query and
opens for an approved upload — one without the other proves nothing.
