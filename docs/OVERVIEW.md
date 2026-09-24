# postSplat — what it adds, and why

A tour of the fork, organised the way the work actually happens rather than by feature list.
Every section starts with the problem it exists to solve.

> Illustrations (GIF screen captures) will be added per section. The placeholders below mark
> where each one goes.

The thesis of this fork is narrow: **stock SuperSplat is a fine editor, but cleaning a real
photogrammetry capture is a specific, repetitive job**, and the tools for that job can be much
sharper. Everything here comes out of doing that job on real scans — trees, fences, façades —
where splat training leaves floaters, veils and pale artefacts in exactly the places that are
hardest to select.

For the engineering triage of which of these is worth taking upstream, see
[CHANGES-vs-upstream.md](CHANGES-vs-upstream.md). This document is the human version.

---

## 1. See the capture honestly

**The problem.** A trained splat is full of sky-coloured artefacts, and against the editor's
black background you cannot tell which pale blobs are real geometry and which are training
residue. You end up deleting things that turn out to be part of the scene, or leaving haze that
only becomes obvious after publishing.

**Skybox layer.** Import an equirectangular image (.webp, .jpg, .png) as a Scene Manager row; it
is drawn behind everything, mapped the way the published viewer maps it, with the camera's tone
mapping and exposure applied. Suddenly the sky patches read as *wrong* because they sit against a
real sky. It is explicitly not a splat — no selection, no history, no scene bound, and every
export and publish path ignores it.

*Limits:* no rotation or intensity controls yet; no ground projection; preview only, not yet
written into a self-hosted export bundle.

> _GIF: importing a dome, the tree's trained sky patches becoming obvious against it._

**Screen space.** `F1` cycles the chrome: full UI → panels collapsed → bare viewport → back. On a
laptop the panels eat the scene you are trying to judge. `Shift+F1` is upstream's display-overlay
toggle.

> _GIF: F1 cycling through the three levels._

---

## 2. Find the junk

**The problem.** Floaters and blown-up splats are the first thing to remove, and stock leaves you
dragging two separate histograms — scale, then opacity — with no preview, guessing at both
thresholds and undoing a lot.

**Scale Largest axis.** A splat's length can sit on any of its three scale axes, so a per-axis
histogram misses the thin ones. This axis is `max(scale.x, scale.y, scale.z)`, so everything
elongated sorts to the far right whichever way it is oriented. Eighteen lines, and it changes how
quickly you find the offenders.

**Floater Selection tool** (`Ctrl+F`). The two thresholds that matter — minimum largest-scale and
maximum final opacity — in one tool with a live preview. The size slider is log-scaled, because
linear was unusable: at the midpoint, log gives you 846 splats where linear gives 17.

> _GIF: dragging the size slider, preview updating, then delete._

**Histogram colour bar.** The Splat Data axes are bare numbers; you cannot see which part of the
Hue axis *is* the sky. A colour ramp under the histogram shows the axis in colour, with a marker
per eyedropper reference. Natural scenes are very low-chroma on OKLab `a`, so those ramps stretch
to a visible range rather than rendering flat grey.

---

## 3. Select it precisely

This is where most of the work went, because it is where the job is actually hard.

**The problem.** Selecting sky *between* thin structures — foliage, railings, fence wire — is the
recurring cleanup task, and it is the one stock handles worst. Its colour match takes a
per-channel threshold from the frontmost splat under the cursor. On these areas that is the wrong
splat: very low-opacity veils sit in front of the sky, so the splat you hit is usually not the one
painting the colour you clicked. Measured on a real scan: under sky pixels, only 13 of 80 picks
were actually sky splats; 24 were veils below 0.15 opacity.

**Magic-wand eyedropper.** It samples the **rendered image** instead — a clean offscreen render,
5×5 box, un-premultiplied — then floods the similar-coloured region and selects the splats whose
footprints paint it. OKLab ΔE by default, HSV and RGB available, one tolerance slider, optional
contiguity, and reference chips you can click to *exclude* a colour that crept in.

*Where it works:* isolated objects and large connected sky patches — one click per patch. On the
test tree at tolerance 0.125, four clicks removed 75 % of the visible sky with 9 % collateral on
foliage.

*Where it does not:* sky between thin foliage is still hard, and a faint white haze usually
survives. Colour segmentation alone is hard even in 2D, and 3DGS adds pale artefacts no colour
reference catches. A click on a region *boundary* floods badly — click inside the patch, as you
would in Photoshop. The likely way forward is a 2D segmentation model feeding the same
mask → footprint → splat path, which already exists here.

> _GIF: one click per sky patch, chips appearing, a greenish chip clicked away, then delete._

**Depth gates.** On a dense capture a selection gesture grabs things far behind what you are
looking at. `N` is now a master toggle over two independent gates that answer different questions:

| | question | effect |
|---|---|---|
| **Occlusion** | is it hidden behind something? | upstream's per-pixel frontmost pick — the default |
| **Far plane** | is it too far away? | a view-space distance cutoff, splats beyond it dimmed |

They compose. On an 8,192-splat test fixture: both off selects 8,192; occlusion alone 2,358;
the plane alone 4,096 (the whole near region, *including* splats hidden behind others); both
together 2,349. So "the visible surface, within this distance" is expressible, and so is "this
whole chunk of cloud regardless of what is in front".

> _GIF: toggling the two gates with the same rectangle drag, counts changing._

**Shape preview.** With the sphere or box tool active, the splats the volume *would* select are
tinted live, so you size the volume before committing rather than select-undo-select.

**Selection modifiers.** No modifier now means **add**; Shift makes a new selection. Cleaning is
additive by nature and reaching for a modifier on every stroke is the wrong default for it. This
one is a deliberate break from upstream.

---

## 4. Get it out of the way

**The problem.** Stock has Lock, which keeps splats visible — so locked clutter still sits between
you and the thing you are working on.

**Hide replaces Lock.** Hidden splats are culled before the draw list: never sorted, drawn,
ringed, footprint-tested or picked, and unselectable and protected from delete. `H`, `Alt+H`,
`Shift+H` for hide selected / hide unselected / unhide all, acting on the active layer. It is the
3ds Max behaviour, and it is what you want while cleaning.

**Merge Splats.** Layers could not be combined — a problem after a Separate or Duplicate, or when
you want one file out of several imports. Mark rows in the Scene Manager and merge; the operation
runs the export pipeline in memory, so transforms, colour grades and rotated spherical harmonics
all bake correctly. Verified by render diff: zero of 230,400 pixels differ by more than 8/255
before versus after.

*Limits:* grades are baked, so Reset Color cannot undo them afterwards. Undo re-adds the sources
at the end of the layer list, so ordering can differ from the original load order.

> _GIF: marking three layers, merging, undo._

**Right-click context menu.** Common operations where your cursor already is, instead of
keyboard-only.

---

## 5. Navigate while you work

**SpaceMouse (3Dconnexion) over WebHID.** Fly-mode camera control with separate movement and
rotation sensitivity, a dead zone, and per-axis inversion. Wired SpaceMouse Pro, calibrated
against the hardware.

**Fly-speed fix.** One outlier splat can inflate the scene bound to kilometres; Fit then parks the
camera thousands of units out and the wheel — which moves in absolute units — appears to do
nothing. Dolly is now scaled by focal distance, so zoom works at any scale.

---

## 6. Desktop conveniences

The reason this is an Electron app rather than a browser tab.

- **Native Save / Export dialogs that remember the last directory** per kind, falling back to the
  directory of the last opened file. Browser file pickers cannot be pointed at a directory the
  shell knows about.
- **Open files from the command line or by drag-and-drop** onto the app or its launcher.
- **Persisted window bounds** and a proper native unsaved-changes dialog on close.
- **A headless test harness** driving the real app over the Chrome DevTools Protocol, which is how
  most of the numbers quoted in this document were measured.

---

## What this fork is not

It is one person's tool for one workflow, not a product. There is no support, no roadmap
commitment, and no release binaries yet. Some of the changes above — Hide replacing Lock, the
inverted selection modifiers, the remapped brush-size wheel — are **deliberate breaks** from
upstream behaviour that suit this job and might not suit yours.

If you want the maintained, official editor, use [superspl.at/editor](https://superspl.at/editor).
