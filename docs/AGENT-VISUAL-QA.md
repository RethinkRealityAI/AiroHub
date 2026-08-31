# Agent visual QA — which harness can see which bug

**Status: works in this container.** SceneProof 0.8.1 is installed and its
`doctor` is green (Chromium launches, WebGL available through SwiftShader);
both pilots below were rendered, not sketched. Two things did **not** work the
documented way and needed a workaround — the GitHub install and `public/` asset
URLs. Both are written up under [Install](#install) and
[The asset-root trap](#the-asset-root-trap). WebGPU is not usable here: an
adapter is reported but `doctor`'s clear-and-readback probe fails, so
`--three-backend webgpu` is off the table in this container.

The question this document answers: *there are now three ways to put a picture
of AiroHub in front of an agent — which one actually proves the thing you are
trying to prove?* They are not interchangeable, and picking the wrong one
produces the worst outcome available: a green render of code that is broken in
the app.

## The three harnesses

| What you are actually asking | Reach for |
| --- | --- |
| Does this leaf component draw correctly in a state I can name? | `sceneproof render … dom:<id>` |
| What is the structure behind that picture — tags, bounds, roles, computed styles? | `sceneproof tree` / `sceneproof node` |
| How do several states of one component compare side by side? | `sceneproof matrix` |
| Is the scene graph what I think it is — transforms, materials, lights, camera? | `sceneproof render … three:<id>`, `node`, `scout` |
| Does the built app still *work* — router, Supabase, paint pipeline, real GLBs, multiplayer? | `scripts/preview/verify-*.mjs` |
| What does the shipped UI look like at desktop / tablet / phone? | `npm run shots` |

And, more usefully, what each one is structurally incapable of seeing:

| Harness | Blind to |
| --- | --- |
| SceneProof | Anything that requires the app to run: routing, Supabase, realtime, the paint upload, `loadModel` and its SPA-fallback 404 trap, the object catalog, `customModels` registration, anything React context supplies from `App.tsx`. |
| `verify-*.mjs` | Sub-component detail. It drives the real build, so a component only appears in whatever state the app happens to put it in — you cannot ask it for "this control with a violet accent selected". |
| `npm run shots` | Correctness of any kind. It is a screenshot sweep with error capture bolted on; it fails on console/page/request errors, not on a wrong picture. |

### Why SceneProof can never catch an integration bug

This is the one property that decides most of the table, so it is worth being
blunt about: **SceneProof does not attach to the dev server.** It bundles your
entry with esbuild, mounts the result in a Chromium page it serves itself from
`http://127.0.0.1/sceneproof`, and renders. There is no Vite, no
`src/App.tsx`, no router, no `.env`, no Supabase client, no `public/` directory
— just the module graph reachable from the file you pointed at.

So a SceneProof render is evidence about *source*, and only about source. If
`Segmented` renders perfectly under SceneProof and the studio toolbar is still
broken, SceneProof was never going to tell you, because the bug is in the wiring
it deliberately does not load. That is not a defect; it is what makes the tool
fast and deterministic. It just means the moment a question involves two modules
talking to each other over a network, a route, or a texture upload, the answer
lives in `scripts/preview/verify-*.mjs` — which builds the app, serves it, and
fails on any console error, page error or failed request
(`verify-guide-stage.mjs` is the model to copy).

Rule of thumb: **SceneProof for leaves, `verify-*.mjs` for anything with
edges.**

## Install

SceneProof needs Bun ≥ 1.4 (it runs `playwright-core` natively and drives
Chromium over CDP) and a local Chromium. Both of the documented commands needed
help in this container:

```bash
# 1. Bun. The container ships 1.3.11 and `bun upgrade` fails here two ways:
#    BUN_OPTIONS=--smol is injected into argv and the `upgrade` subcommand
#    reads it as a package name, and once that is cleared bun's own updater
#    gets HTTPForbidden through the egress proxy. The install script works,
#    because curl honours HTTPS_PROXY and the CA bundle.
curl -fsSL https://bun.com/install | bash     # -> 1.4.0

# 2. SceneProof. It is distributed via GitHub, not npm — an npm lookup 404s by
#    design. The documented command does not work behind this container's
#    proxy: bun resolves every github: dependency through
#    api.github.com/repos/<owner>/<repo>/tarball/<ref>, and the proxy gates the
#    GitHub API per repository (400 with no ref, 403 with one). git itself is
#    fine, so clone and install from the folder instead.
# bun add --global github:ReyJ94/SceneProof   <- upstream's command; fails here
git clone --depth 1 https://github.com/ReyJ94/SceneProof <dir>
bun add --global <dir>
cd <dir> && bun install    # the global bin symlinks resolve back to the real
                           # checkout, so its deps have to live there, not in
                           # ~/.bun/install/global

# 3. Chromium. Note the variable name: SceneProof reads
#    SCENEPROOF_CHROME_PATH or BUN_CHROME_PATH. It does NOT read CHROME_BIN,
#    which is what every scripts/preview/*.mjs harness in this repo uses.
SCENEPROOF_CHROME_PATH=/opt/pw-browsers/chromium sceneproof doctor
```

`sceneproof` and `uiscene` are the same binary and land in `~/.bun/bin`, which
is already on `PATH` here. `doctor` comes back `"success":true` with
`rasterizer: swiftshader-cpu` — valid visual evidence, and explicitly not
evidence about GPU performance. Every render repeats that as a warning; leave it
in rather than trimming it out of a report.

## The pilots

Both fixtures live in `scripts/fixtures/` and both were rendered with the exact
commands below. Artifacts land in `scripts/preview/out/`, alongside everything
`npm run shots` and the verify scripts write.

### `dom:` — the Segmented control

```bash
# Serves public/ so the control's mask image resolves — see the asset-root
# trap below. Skip it and the render succeeds while showing you a lie.
python3 -m http.server 80 --bind 127.0.0.1 --directory public &

SCENEPROOF_CHROME_PATH=/opt/pw-browsers/chromium sceneproof render \
  scripts/fixtures/segmented.fixture.tsx dom:segmented-sheet \
  --export SegmentedFixture \
  --css src/index.css \
  --width 760 --height 480 --scale 2 \
  --out scripts/preview/out/sceneproof-segmented.png
```

`--css src/index.css` is the whole Tailwind v4 story: the config lives in the
stylesheet (`@theme`, `@utility glass`, `@utility segmented`), SceneProof
compiles that file with `@tailwindcss/postcss`, and the control's utilities come
out the other side correct. No `tailwind.config.js` to point at, and nothing to
mirror.

No `--alias` was needed. That is worth recording rather than glossing over:
`src/ui/Glass.tsx` is a true leaf — `react`, `motion/react`, `lucide-react` and
nothing else — so there is no server-only module to stub. Reach for
`--alias <specifier>=<path>` the first time a fixture drags in something that
cannot survive a browser bundle (`src/admin/supabase.ts` is the obvious
candidate), and stub it in `scripts/fixtures/`.

`sceneproof tree` on the same entry returns the full DOM and SVG structure with
per-element bounds, and resolves `dom:segmented-sheet`, `dom:segmented-paint`,
`dom:segmented-pill` and `dom:segmented-accents` — the four `data-sceneproof-id`
attributes the fixture sets. Without those the ids fall back to positional paths
(`dom:span-0.0.1.0.0`), which change the moment anyone edits the markup.

### The asset-root trap

The first run of that command produced a *silently wrong* picture, and it is the
most useful thing this pilot found. `StrokeIndicator` masks itself with
`url(/ui/mask-stroke-2.webp)`. SceneProof serves its page from
`http://127.0.0.1/sceneproof` and routes only that exact URL — there is no
static root — so the mask 404s, Chromium treats a failed mask image as fully
masked, and **the paint stroke renders as nothing at all**. The command still
exits 0. The report still says `execution: succeeded`. Only the active label
gives it away, sitting on empty track.

Anything in `public/` behaves this way: `/ui/*`, `/models/*`, poster images.
Serving `public/` on `127.0.0.1:80` for the duration of the run fixes it, which
is the extra line in the command above — port 80 specifically, because that is
the origin SceneProof's own page is served from, so it needs root or a
capability. If a fixture's subject depends on a `public/` asset, either serve it
or expect a lie.

### `three:` — the turntable scene

```bash
SCENEPROOF_CHROME_PATH=/opt/pw-browsers/chromium sceneproof render \
  scripts/fixtures/turntable.scene.ts three:subject \
  --export createTurntableScene \
  --framing source \
  --width 900 --height 600 --scale 2 \
  --out scripts/preview/out/sceneproof-turntable.png
```

`--framing source` keeps the fixture's own camera literal, which is the point:
the review gallery's whole premise is one fixed angle for every cell, so a
harness that helpfully reframes each subject is answering a different question.
Use `--framing fit` or `scout` only while you are still deciding what the angle
should be.

The fixture is **synchronous by design** and loads no GLB. An async fixture
would pull the real asset pipeline — fetch, the SPA-fallback 404 trap,
`registerModelUrl`, draco, BVH — into a harness with no dev server behind it,
and then a failed fetch reads as a scene-graph bug. Primitive stand-ins fail for
exactly one reason: the scene is wrong. (SceneProof does support async fixtures
via an awaited `ready`; the argument here is not that it can't, it's that it
shouldn't. Real GLBs belong in `verify-*.mjs`, which drives the actual build.)

The optional `seek(timeMs)` on the returned object is what makes the turntable a
turntable: `--time 1500` renders a quarter revolution of the same scene instance
rather than a second scene, so two frames are genuinely comparable. `targets`
declares the six meshes as one logical subject with the plinth and cyclorama as
`context`, so `--isolate` and `--context-pair` mean something; without it the
harness frames whichever cylinder it selected and you get a photograph of a
tube.

Facts worth reading out of the report rather than the picture:
`context.targetRenderableCount`, `context.environmentPresent`,
`camera.resolved`, `graphics.actual` and `pipeline.toneMapping`. Those are the
scene-graph assertions no screenshot harness in this repo can make.

## Fixture conventions in this repo

- **`scripts/fixtures/`**, not `scripts/sceneproof/`. SceneProof's own docs
  suggest the latter; this repo deliberately does not, because these files are
  not SceneProof inspectors — they are plain modules any harness can render.
- **No harness imports.** No `sceneproof/react`, no `sceneproof/three`. The
  `{ scene, camera, targets, seek, dispose }` shape is a *structural* contract,
  so a tool that recognises it gets the extras and anything else ignores them.
  Two payoffs: `npm run lint` (`tsc --noEmit` over the whole tree, no `include`
  in `tsconfig.json`) typechecks every fixture for free, and swapping the
  harness later costs nothing.
- **Wrap controlled components.** `Segmented` derives the indicator position,
  its accent and which of the two label treatments the active segment gets from
  `value` alone. Mounted with a literal `value` and a throwaway `onChange` it
  renders a control that can never move, and often a state the app cannot
  actually reach. Give it a `useState` host — the wrapper is three lines and it
  is the difference between a specimen and a photograph of a bug.
- **Stable ids.** Put `data-sceneproof-id` on the elements you intend to target.
  Positional ids are correct and useless.
- **Import production code unchanged; never re-implement it.** A fixture may
  supply props, providers, wrapper markup, a backdrop and deterministic time. If
  making the subject render would mean copying its geometry or re-deriving its
  layout, stop — the render would be testing the fixture.
- **Inline styles for the fixture's own chrome.** Tailwind v4 generates
  utilities from the sources it scans, and a harness compiling `src/index.css`
  on its own may not scan `scripts/`. Keeping fixture layout out of Tailwind
  means the only utilities in the shot are the ones the component asked for,
  which is what the shot is meant to test.

## Reading a SceneProof result honestly

`execution.status: succeeded` means the command ran and wrote a file. It is not
a visual pass — the asset-root trap above exits 0 while rendering the subject
invisible. The report separates `facts` (measured: bounds, coverage, camera,
renderer, luminance) from `assertions` (only the mechanical checks you asked
for, such as `--delivery-scale`) from `review`, which says in as many words that
the agent still has to open the artifact. Do that. The one thing this repo
should never do is quote `succeeded` as evidence that a surface looks right.

## Where the boundary actually sits

Concretely, for the surfaces in flight:

- `Segmented`, `GlassPanel`, `GlassPill`, a review card in isolation, a
  liquid-glass filter's *markup* — SceneProof.
- The review gallery's shared `<Canvas>` and drei `<View>` grid, the promotion
  gate in `src/paint/customModels.ts`, `loadModel` against real uploads,
  computed `backdrop-filter` on a live page, the studio at 60fps — `verify-*.mjs`.
- Anything a human is going to look at in a PR — `npm run shots`.

When a bug could plausibly live on either side, run the leaf render first: it is
seconds rather than a build, and if it reproduces there you have just removed
the entire app from the search space.
