# Changes vs. upstream SuperSplat

This is an **unofficial Windows desktop fork** of
[playcanvas/supersplat](https://github.com/playcanvas/supersplat), based on **`v3.1.2`**
(`0911f78`). It is MIT, like upstream, and not affiliated with or endorsed by PlayCanvas.

31 commits on top of that base; 141 files and about +12,600 / −1,900 lines excluding
`package-lock.json`.

This document exists because most of that diff is **not** PR material — it carries Electron and
Windows assumptions that have no place in a browser editor. But some of it is genuinely portable,
and a few pieces are upstream bug fixes. This is a map, sorted so the cheap wins come first.

**This is a reference, not a pull request.** Nothing here needs anything from you — the fork will
carry on regardless. It exists so that if any of it looks useful, you can see what was done and,
more importantly, *why*, without reading 31 commits.

**Take anything you want.** MIT, no attribution needed beyond the licence, no expectation of a
reply. If something is useful but awkwardly shaped, say so and I will reshape it.

### Finding the code behind any entry

- Base is upstream `v3.1.2` (`0911f78`), so `git diff 0911f78..main -- <path>` is the whole of
  this fork's change to any file.
- Every upstream line touched is marked `// [custom]` — `git grep "\[custom\]" -- src` lands on
  all of them (80 files).
- Commits are feature-scoped: `git log --oneline 0911f78..main` reads as a list of the entries
  below, and individual ones are `git cherry-pick`-able or `git format-patch`-able.
- **Caveat on rebasing:** this fork is based on `v3.1.2`, and upstream has since shipped 3.2.0 and
  3.3.0. The 3.2.0 splat-pass rewrite deleted `src/splat-centers.ts` and heavily reworked
  `projected-splat-renderer.ts` — which several B-section entries touch. The A-section fixes are
  unaffected.

## The one structural fact that matters

Every upstream line this fork touches is marked `// [custom]`.

The Electron/desktop bridge is imported by exactly **8 files** — `src/desktop/*`, `src/main.ts`,
`src/doc.ts`, `src/file-handler.ts`, `src/ui/editor.ts`, `src/ui/export-popup.ts`,
`src/ui/menu.ts`. **No tool, shader, kernel or panel file depends on it.** So nothing in sections
A, B or C below is entangled with desktop code. Where things are entangled it is with each other,
and that is spelled out per entry.

## How to read this

Each entry leads with **the problem**, not the mechanism, and says where it works *and where it
still does not*. A feature that only half-works is described as half-working — that is more useful
to you than a sales pitch.

| | |
|---|---|
| **A** | Upstream bug fixes. Portable as-is, about 25 lines total. Start here. |
| **B** | New features, no desktop dependency. Would work in the browser build unchanged. |
| **C** | Opinionated UX changes. Product conversations, not patches. |
| **D** | Desktop-only. Listed for completeness, not for porting. |

---

# A — Upstream bug fixes

Four fixes, about 25 lines between them. Each is framed by its user-visible symptom, because that
is how they were found.

## A1. "Colour selection picks the wrong colour"

**Problem.** On a capture with strong band-1 SH, colour selection returned almost nothing. Sky
splats that clearly rendered pale blue were read by the histogram as dark yellow-green.

**Cause.** `evaluateSH` in `src/shaders/splat-value-shader.ts` used the **world-space** view
direction. The render projector uses the direction rotated into the gaussian's local frame.
SuperSplat rotates PLY data 180 degrees about Z on load, so for any layer with a non-identity
model rotation — that is, ordinary PLY files — the band-1 x/y terms flip, and the compute kernel
histograms and colour-matches a different colour than the renderer draws. This affects the Splat
Data panel's colour axes too, not just selection.

**Fix.** Transform the view direction by `transpose(mat3(entityMatrix * paletteMatrix))`, exactly
as the projector does. About 3 lines, plus `paletteIndex` on the `SplatValue` struct and one
assignment in `readSplat` (the palette word is already read one line above for `worldPos`).

**Measured.** Same scene, same camera: the splats painting a sky patch read OKLab L 0.39 /
b +0.03 before the fix and L 0.70 / b −0.059 after — dark yellow-green to blue. Wand selection at
the same tolerance went from 6 splats to 119.

**Caveat.** Fixtures with no SH bands cannot see this bug. A regression test needs a fixture with
strong band-1 terms, asserting kernel colour equals the rendered sample from two camera
positions. We have not built that fixture.

## A2. "The eyedropper stopped responding"

**Problem.** After a `pointercancel` the eyedropper is permanently dead — every later
`pointerdown` is ignored. Touch and pen only.

**Cause.** `resetPointer` in `src/tools/eyedropper-selection.ts` calls
`releasePointerCapture(pointerId)` unconditionally. After a cancel the pointer is no longer
active, so that throws `NotFoundError` — and because `pointerId = null` is the *next* statement,
the id is never cleared and the tool never recovers.

**Fix.** Guard with `hasPointerCapture`. One line. You already applied this same pattern elsewhere
in #1032.

## A3. "The splat count is wrong after File > New"

**Problem.** The status bar keeps showing the deleted layer's Splats / Selected / Deleted figures
after File > New, or after deleting the layer it was tracking.

**Fix.** Zero the stats on `scene.elementRemoved`. About 10 lines in `src/ui/status-bar.ts`. In
our tree this sits next to a Lock-to-Hide rename — take the handler, keep your own `lockedValue`.

## A4. "I cannot zoom after Fit"

**Problem.** On a capture with outlier splats the scene bound inflates enormously — we measured
about 15 km. Fit then parks the camera roughly 10,600 units out, and fly-mode wheel steps are
**absolute** (0.01 times flySpeed), so the wheel appears to do nothing at all.

**Fix.** Scale the fly-mode wheel dolly by `Camera.focalDistance` (a small getter, plus one
multiply in `src/controllers.ts`). About 8 lines.

**Caveat.** This changes fly-wheel feel for everyone, not just in the pathological case, so you
may want it behind the existing Fly Speed preference rather than unconditional. We left the WASD
keys on upstream's absolute behaviour.

## A5. Advisory, not a patch: PCUI `NumericInput` and `Function()`

Not an upstream source bug, but worth knowing. PCUI's `NumericInput` evaluates typed text through
`Function()`. Any deployment that serves SuperSplat under a strict `script-src` **without**
`unsafe-eval` therefore has *every* numeric field — Transform, FOV, everything — silently reset to
0 on Enter. No error, no console warning.

We only had to widen our own Electron CSP, but the fragility is upstream's; a small arithmetic
parser would remove the need for eval entirely.

**Testing trap that cost us an afternoon:** CDP `Runtime.evaluate` *lifts* the eval block for its
own call stack. Scripted tests passed while real keystrokes failed. Drive input paths with real key
events and use evaluate only to read state.

## A6. Advisory: `import/order` is broken on ESLint 10

`@playcanvas/eslint-config` 2.1.0 vendors `eslint-plugin-import` 2.32.0, which predates ESLint 9.
Its `import/order` **fixer** calls `sourceCode.getTokenOrCommentAfter`, an API ESLint removed. On
`eslint@10`, any `import/order` report therefore aborts the whole lint run with

```
TypeError: sourceCode.getTokenOrCommentAfter is not a function
Rule: "import/order"
```

instead of printing the error. The failure mode is the problem, not the rule: you get a stack
trace naming an arbitrary file rather than a lint message naming the real one.

**How it shows up:** importing any *newly added* module reliably produces such a report, whatever
the placement or the name — so the first symptom is "lint crashes the moment I add a file". Both
of this fork's added modules hit it, and isolating it took a while because the crash points at the
wrong file and moving the import around never helps.

**There is no version to bump to.** 2.32.0 is the current release, and its peer range is
`^2 || ... || ^9` — ESLint 10 is not declared supported at all, while `@playcanvas/eslint-config`
declares only `eslint: ">= 8"`, so nothing warns at install time. The real options are: pin ESLint
to 9.x, move to the maintained fork `eslint-plugin-import-x` (4.17.1, peers
`^8.57 || ^9 || ^10`), or disable the rule. This fork disabled it with a comment explaining why;
import order is still maintained by hand.

Worth looking at regardless of anything else in this document — `eslint@10.10.0` sits in
`devDependencies` today, so this is waiting for whoever adds the next module.

---

# B — New features, upstream-portable

Ranked by value divided by effort. Nothing here imports the desktop bridge.

## B1. "Scale Largest" histogram axis

**Problem.** Thin, pointy splats are the main thing you hunt when cleaning a capture, but the
length can sit on *any* of the three scale axes. Per-axis histograms therefore miss them — a splat
that is 2.3 long on Z looks unremarkable on the Scale X axis.

**What we did.** One more Splat Data axis, `max(scale.x, scale.y, scale.z)`, listed between Blue
and Scale X. Thin splats sort to the far right whichever axis carries their length.

**Effort.** About 18 lines: propMode 72 in `splat-value-shader.ts`, one entry in `data-panel.ts`,
one locale key in each of 9 files. **No dependencies.** The cheapest useful thing in this document.

**Measured** on a 3,485-splat tree: per-axis max 2.26–2.29, Scale Largest range 0.031–2.289.

## B2. Merge Splats

**Problem.** Layers cannot be combined. After a Separate or Duplicate, or when you want one file
out of several imports, there is no way back to a single layer.

**What we did.** Mark rows in the Scene Manager (click / Ctrl+click / Shift+click), then merge into
one new layer. Because layers are views over one asset each, the merge runs the **export pipeline
in memory**: world transform, transform palette and colour grade baked, SH rotated by the baked
rotation, deleted rows dropped, highest band count of the inputs wins. Selected and hidden flags
are concatenated in the same order. History is
`MultiOp([RemoveSplatOp x sources, AddSplatOp(merged)])`.

**Where it works.** Verified by render diff: two planes moved, rotated and scaled next to a band-1
tree, clean offscreen frame before versus after merging all three — mean absolute channel diff
0.004, max 1, **0 of 230,400 pixels above 8**. Transforms, scales, rotations and SH all bake
correctly.

**Where it does not.** Grades are baked, so Reset Color cannot undo them afterwards (same as an
export, but it surprises people). Animated-sequence layers merge as their current frame. Undo
re-adds the sources at the **end** of the list, so ordering after an undo differs from load order,
and a later merge picks a different name.

**Porting note.** New `src/splat-merge.ts` (about 126 lines), plus `RemoveSplatOp` in
`edit-ops.ts`, `edit.merge` in `editor.ts`, and one export line in `splat-serialize.ts`. The UI
cost is the mark state in `splat-list.ts`. **One ask of you:** we ship a local `MemoryChunkSource`
only because `@playcanvas/splat-transform` does not export `compact` / `InMemoryChunkSource` at
package level. Exporting those upstream would delete our shim.

## B3. Floater Selection tool

**Problem.** Removing training floaters meant two histogram drags — scale, then opacity — with no
preview, guessing at both thresholds.

**What we did.** One tool (Ctrl+F) with two thresholds: minimum largest-scale axis and maximum
final opacity, with live preview. The size slider is **log-scaled** over at most 4 decades below
the top, because linear was unusable: at the midpoint, log gives 0.255 / 846 splats where linear
gives 1.16 / 17.

**Where it works.** Verified against the histogram: at a bin edge the kernel returns exactly the
histogram range selection (1,999 equals 1,999); opacity 0 gives 0; monotonic in opacity.

**Porting note.** New `src/tools/floater-selection.ts` and `src/data-processor/select-floaters.ts`
plus an icon; hooks are one line each in seven files. **Needs B1** (propMode 72) and a two-line
`edit.top` helper. It reads a `depthFar` uniform you can hardwire to 0.

## B4. Magic-wand eyedropper

**Problem.** Selecting sky between thin structures — trees, fences, railings — is *the* recurring
cleanup job on real captures, because splat training leaves pale low-opacity artefacts there.
Upstream's colour match is a one-shot per-channel threshold taken from the frontmost splat under
the cursor, and on these areas it selects almost nothing useful: very low-opacity splats sit in
front of the sky, so the frontmost splat is usually **not** the one painting the colour you
clicked. We measured this directly — under sky pixels, only 13 of 80 picks were sky splats, and 24
were veils below 0.15 opacity.

**What we did.** The eyedropper became a Photoshop-style magic wand that samples the **rendered
image** rather than the frontmost splat: a clean offscreen render at half resolution, 5x5 box,
un-premultiplied (box rgb sum over alpha sum), mean alpha below 0.05 counts as void. A click floods
the similar-coloured region and selects the splats whose *footprints* paint it. OKLab delta-E
(default), HSV and RGB metrics, one tolerance slider, optional contiguity, and reference chips you
can click to exclude a colour.

**Where it works.** Isolated objects and large connected sky patches — one click per patch.
Measured on the test tree at tolerance 0.125: four patch clicks selected 232 splats, removing
**75 % of the visible sky with 9 % collateral** on foliage.

**Where it does not.** Sky *between* thin foliage remains hard. Colour segmentation alone is hard
even in 2D, and 3DGS adds pale whitish haze splats that no colour reference catches; a faint haze
typically survives the cleanup. A click on a region *boundary* still floods badly — Photoshop
behaves the same way, so click inside the patch.

**Three flood lessons, all measured**, in case you build something similar:

1. The seed colour must be the 5x5 box sample. A single pixel on a sky/leaf blend seeds a teal
   that is within tolerance of *both* sides.
2. Pixels under 15 % coverage must never join the region. Their un-premultiplied colour is 8-bit
   noise, and every splat's fringe is made of them: without this, a 0.12 click grew to 98k px and
   hid 1,331 splats, mostly foliage — the blue pixel count went *up* 82 %.
3. The reference palette must come from **interior** pixels only (all four neighbours in the
   region), with clusters under 3 % of samples dropped. Rim pixels where sky blends into leaves
   form their own cluster and pull the match into the foliage.

**Porting note.** The biggest item here. Rewritten `src/tools/eyedropper-selection.ts` plus new
`src/tools/color-quantize.ts`; the `editor.ts` side is one contiguous block. **Extract
`render.offscreen(w, h, clean)` and `scene.forceSortedFrame` first** (about 15 lines across
`render.ts`, `scene.ts` and `projected-splat-shader.ts`) — a clean, tint-free,
guaranteed-sorted offscreen render is independently useful and everything else here builds on it.

## B5. Sphere / Box selection preview

**Problem.** You had to commit a selection to find out what the volume actually caught.

**What we did.** While either shape tool is active, the splats the volume *would* select are tinted
live. It runs the same `dataProcessor.intersect` the Set button runs (coalesced, so never more than
one GPU pass is queued) and hands the mask to the projector as a storage buffer. No history op, no
state bit.

**Verified.** The mask handed to the renderer equals the Set op exactly (sphere r3 gives 1,066;
r3.1 gives 1,206; box 4x4x4 gives 445 equals 445), and a screenshot diff shows 9,638 tinted pixels
inside the sphere region versus 0 with the tool off, with the region outside pixel-identical.

**Porting friction.** It inserts `previewMask` at projector binding **8** and shifts every texture
binding up by one. Given your 3.2.0 renderer work this will need re-homing.

**Harness trap:** `previewMask` has no `COPY_SRC` usage, so `StorageBuffer.read` on it returns
zeros — a *silent* validation failure, not an error. Diff screenshots instead.

## B6. Histogram colour bar and OKLab axes

**Problem.** The Splat Data axes are bare numbers. You cannot tell which part of the Hue axis is
"the sky" without trial and error.

**What we did.** A 14 px colour ramp under the histogram for every colour axis, plus a marker line
per eyedropper reference and a chip on the ramp. Added OKLab L/a/b as axes.

**One subtlety worth stealing.** Natural scenes are very low-chroma on OKLab `a` — our test tree
spans only about plus or minus 0.09 — so a true-range ramp renders as flat grey and looks broken.
The a/b ramps stretch the visible range to chroma 0.25 (gain 1–8). Marker positions are unaffected.

**Porting note.** New `src/ui/histogram-color-bar.ts` is pure and unit-tested. The ramp alone needs
nothing; the OKLab axes need the WGSL colour helpers from B4; the markers need `select.colorRefs`,
which only the wand fires (a harmless no-op without it).

## B7. Skybox layer

**Problem.** Trained sky patches are invisible against a black background, so you cannot judge what
needs cleaning — or what the scene will look like once published against a real sky.

**What we did.** An equirectangular image (.webp, .jpg, .png) imported as a Scene Manager row and
drawn behind everything. A fullscreen quad in the world layer, registered before the grid; a ray
per pixel from the inverse view-projection (a *perspective* one even in ortho, so the dome does not
collapse); the engine's own `toSphericalUv` so it turns like the published viewer's sky; camera
tone mapping and exposure re-applied in the shader.

**Explicitly not a Splat:** no selection, no edit ops, no history, no scene bound (`worldBound`
stays null so Fit is unaffected), and every export and publish path enumerates `ElementType.splat`,
so **Publish ignores it**.

**Two rendering gotchas**, both of which produced visible artefacts before we fixed them:

- Take the mip from the ray's **angular step**, not the uv derivatives. The derivatives jump at the
  atan2 seam and draw a visible line down the sky.
- Cap the 1/cos(latitude) longitude term at 4 times the latitude term, or the zenith selects the
  top mip and paints the pole the image's average colour.

**Where it does not work.** No rotation or intensity controls yet (the viewer has `skyboxRotation`
and `skyboxIntensity`); no ground projection; importing or removing it does not mark the document
dirty; and it is preview-only — we have not yet written it into a self-hosted export bundle.

## B8 to B10, briefly

- **Viewport context menu** — a right-button *tap* (under 4 px; right-drag still pans) opens a
  cursor-anchored, viewport-clamped menu. Every row reuses an existing event. New
  `src/ui/context-menu.ts` plus about 25 lines in `controllers.ts`. The row *list* references fork
  features, so it is a one-per-line edit, not a structural dependency. **Guard worth copying:**
  never open on a `pointercancel`, which 3.1 routes through `pointerup` with button −1.
- **Chrome cycling** — one key cycles default, panels collapsed, bare viewport, back to default.
  About 42 lines in a new `src/ui/chrome.ts`. **Do not bind this to Tab.** We did, and it silently
  failed whenever a tool's option bar had focus: `Tab` is in `controlKeys`, and `targetConsumesKey`
  hands such keys to any focused element that is not `document.body`, so after one click on a
  toolbar button it became plain focus traversal. It cannot be reclaimed without breaking keyboard
  accessibility. We moved to F1.
- **Context hint overlay** — per-tool modifier hints, bottom-left, off by default with a status bar
  toggle. Clean file, but the strings encode our remapped keys, so porting means rewriting about 14
  of them to your bindings.

---

# C — Opinionated UX changes

These work anywhere, but they change existing behaviour, so they are conversations rather than
patches. Each carries what it would cost to revert.

- **Hide replaces Lock.** Locked splats still render and clutter the view; while cleaning, what you
  want is them *gone* from the viewport (3ds Max semantics). Hidden splats are culled before the
  compact list — never sorted, drawn, ringed, footprint-tested or picked — and are unselectable and
  delete-protected. **Cost:** 23 files; repurposes the PLY state bit 2, so older files' locked
  splats load as hidden; removes a shipped feature. We kept the `lockedClr` plumbing dormant for a
  possible Freeze state.
- **Selection modifiers inverted** — no modifier means **add**, Shift means set, Ctrl means remove,
  Ctrl+Shift means intersect. Cleaning is additive by nature, and reaching for a modifier on every
  stroke is the wrong default for that job. **5 lines in `select-op.ts`** — the ideal preference
  candidate if you want both.
- **Brush size on Shift+wheel**, freeing Alt+wheel. Note that your 3.1.2 shortcuts popup documents
  Alt+wheel, so this is a visible divergence.
- **Esc deselects** while a selection tool is active, rather than dropping the tool.
- **Selection overlay defaults** — sliders relabelled as opacity, blend 0.75, selection colour on,
  centres and rings as flat colours with the slider as alpha. Upstream mixed centres from each
  splat's own colour, which produced odd hues and made the unselected slider look dead. **Contains
  one real bug worth taking regardless:** the selected and unselected colour pickers expose an
  alpha channel the renderer never reads.
- **Depth selection** — upstream's `N` is a per-pixel frontmost pick. We added a view-space **far
  plane** as a *second, orthogonal gate* rather than a replacement. They answer different questions
  — "is it hidden behind something" versus "is it too far away" — and they compose, because
  `picker.prepareId` already depth-gates the id pass unconditionally. So `N` is now a master toggle
  over two independent switches, **with your per-pixel pick as the default**; the plane is opt-in.
  Measured on an 8,192-splat two-plane fixture: both off gives 8,192; occlusion only gives 2,358;
  plane only gives 4,096 (the whole near plane, *including* splats hidden behind others); both
  gives 2,349; and with the plane in front of everything, 0. The master toggle is deliberately
  **not** persisted — restoring the plane at launch darkens everything beyond the focal distance
  and reads as a broken app.

---

# D — Desktop-only, not portable

Listed so you can skip them: the Electron shell and `app://` privileged scheme, WebHID SpaceMouse
support (parser, state, backend, fly controller), native file dialogs with per-kind directory
memory, persisted window bounds, a native unsaved-changes quit dialog, and a CDP-based test
harness.

**One lesson from that pile is general**, though: a stuck `forceInteracting` leaves the viewport
holding a 1 spp stochastic frame while idle, which looks like "pointy splats" and is very confusing
to diagnose. In our case a hand resting on a SpaceMouse kept sending sub-deadzone reports. Anything
that flags interaction should flag it only while something actually moves.

---

# A note on the `segmentation` branch

Since it overlaps in spirit with B4: `upstream/segmentation` is a MediaPipe `InteractiveSegmenter`
brush that grabs `canvas.getImageData()`, asks the model for a mask around the clicked point, and
feeds it into the old `selectByMask` path. Its merge-base predates v1.0 and it lives in
`src/ui/control-panel.ts`, a file that no longer exists — so it is a rewrite, not a merge.

It is a **different mechanism** from the wand (a learned 2D object mask; no tolerance, no metric,
no palette) and does not conflict with it. But they compose: the fork's
`maskRegion` to `footprintIntersect` to `select.colorMatch(region)` path is exactly the
"2D mask, so which splats painted it" plumbing that branch lacked. If you ever revive segmentation,
that half is reusable as-is, and it is the piece we think would finally crack sky-between-foliage.
